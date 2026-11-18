import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import type { AuditLogEntry, AuthUser, TriageRecord, UserRole } from '../shared/clinicalSchemas.ts';

export function isServerlessRuntime(): boolean {
  return Boolean(
    process.env.NETLIFY === 'true' ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.LAMBDA_TASK_ROOT ||
      process.env.NETLIFY_LOCAL === 'true'
  );
}

export function getVaultDir(): string {
  if (process.env.MEDIFLOW_VAULT_DIR) {
    return path.resolve(process.env.MEDIFLOW_VAULT_DIR);
  }
  if (isServerlessRuntime()) {
    return path.join('/tmp', '.mediflow-vault');
  }
  return path.resolve(process.cwd(), '.mediflow-vault');
}

const VAULT_DIR = getVaultDir();
const KEY_FILE = path.join(VAULT_DIR, '.master-keys.json');
const AUDIT_LOG_FILE = path.join(VAULT_DIR, 'audit-chain.json');

function ensureVaultDir(): void {
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 });
  }
}

interface MasterKeys {
  encryptionKeyHex: string;
  sessionSecretHex: string;
  source: 'env' | 'vault-file' | 'serverless-derived';
}

function deriveDomainKey(seed: string, domain: string): string {
  return crypto.createHmac('sha256', seed).update(domain).digest('hex');
}

function loadOrCreateMasterKeys(): MasterKeys {
  ensureVaultDir();
  const envEnc = process.env.ENCRYPTION_MASTER_KEY;
  const envSess = process.env.SESSION_SECRET;
  if (envEnc && envEnc.length >= 32 && envSess && envSess.length >= 32) {
    return {
      encryptionKeyHex: crypto.createHash('sha256').update(envEnc).digest('hex'),
      sessionSecretHex: crypto.createHash('sha256').update(envSess).digest('hex'),
      source: 'env',
    };
  }

  // Em plataformas serverless (como Netlify Functions), deriva chaves consistentes por domínio
  // a partir da entropia do ambiente quando segredos explícitos são omitidos, garantindo que cookies
  // de sessão sobrevivam entre invocações stateless.
  if (isServerlessRuntime()) {
    const runtimeSeed = [
      process.env.GEMINI_API_KEY || '',
      process.env.SITE_ID || '',
      process.env.URL || '',
      process.env.DEPLOY_ID || '',
      os.hostname(),
    ].join(':');
    return {
      encryptionKeyHex: envEnc
        ? crypto.createHash('sha256').update(envEnc).digest('hex')
        : deriveDomainKey(runtimeSeed, 'mediflow:aes256gcm'),
      sessionSecretHex: envSess
        ? crypto.createHash('sha256').update(envSess).digest('hex')
        : deriveDomainKey(runtimeSeed, 'mediflow:session-hmac'),
      source: 'serverless-derived',
    };
  }

  if (fs.existsSync(KEY_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')) as MasterKeys;
      if (parsed.encryptionKeyHex && parsed.sessionSecretHex) {
        return {
          encryptionKeyHex: envEnc
            ? crypto.createHash('sha256').update(envEnc).digest('hex')
            : parsed.encryptionKeyHex,
          sessionSecretHex: envSess
            ? crypto.createHash('sha256').update(envSess).digest('hex')
            : parsed.sessionSecretHex,
          source: 'vault-file',
        };
      }
    } catch {
      // Regenera as chaves abaixo caso o arquivo local esteja corrompido
    }
  }

  const keys: MasterKeys = {
    encryptionKeyHex: envEnc
      ? crypto.createHash('sha256').update(envEnc).digest('hex')
      : crypto.randomBytes(32).toString('hex'),
    sessionSecretHex: envSess
      ? crypto.createHash('sha256').update(envSess).digest('hex')
      : crypto.randomBytes(32).toString('hex'),
    source: 'vault-file',
  };

  fs.writeFileSync(KEY_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
  return keys;
}

const KEYS = loadOrCreateMasterKeys();
const AES_KEY = Buffer.from(KEYS.encryptionKeyHex, 'hex');
const SESSION_SECRET = Buffer.from(KEYS.sessionSecretHex, 'hex');

export function getSecurityRuntimeStatus() {
  return {
    serverless: isServerlessRuntime(),
    explicitSecretsConfigured: KEYS.source === 'env',
    keySource: KEYS.source,
    demoLoginEnabled: process.env.DISABLE_DEMO_LOGIN !== 'true',
  };
}

export interface EncryptedEnvelope {
  algorithm: 'aes-256-gcm';
  iv: string;
  authTag: string;
  ciphertext: string;
}

export function encryptAtRest(plaintext: string | Buffer): EncryptedEnvelope {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', AES_KEY, iv);
  const input = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

export function decryptAtRest(envelope: EncryptedEnvelope): Buffer {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    AES_KEY,
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
}

export function computeSha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// ---------- Hash de Senhas (scrypt + salt aleatório por usuário) e Usuários RBAC ----------

interface StoredUser extends AuthUser {
  salt: string;
  passwordHash: string;
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createSeedUser(
  id: string,
  name: string,
  email: string,
  role: UserRole,
  department: string,
  crmOrRegistry: string,
  rawPassword: string
): StoredUser {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    id,
    name,
    email,
    role,
    department,
    crmOrRegistry,
    provider: 'local',
    salt,
    passwordHash: hashPassword(rawPassword, salt),
  };
}

const USERS: StoredUser[] = [
  createSeedUser(
    'usr-gestor-01',
    'Dra. Helena Vasconcelos',
    'gestor@mediflow.health',
    'ADMIN_GESTOR',
    'Governança Clínica & DPO (LGPD)',
    'CRM-SP 112409 · DPO',
    'MediFlow@Gestor2026!'
  ),
  createSeedUser(
    'usr-auditor-02',
    'Dr. Marcos Oliveira',
    'auditor@mediflow.health',
    'AUDITOR_CLINICO',
    'Comitê de Auditoria Médica HITL',
    'CRM-SP 189340',
    'MediFlow@Auditor2026!'
  ),
  createSeedUser(
    'usr-triagem-03',
    'Enf. Camila Santos',
    'triagem@mediflow.health',
    'OPERADOR_TRIAGEM',
    'Pronto-Socorro & Admissão',
    'COREN-SP 441209',
    'MediFlow@Triagem2026!'
  ),
];

const oauthUsersCache = new Map<string, AuthUser>();

export function registerOAuthUser(user: AuthUser): AuthUser {
  oauthUsersCache.set(user.id, user);
  return user;
}

export function verifyUserCredentials(email: string, password: string): AuthUser | null {
  const normalized = email.trim().toLowerCase();
  const user = USERS.find((u) => u.email === normalized);
  if (!user) return null;

  const candidateHash = hashPassword(password, user.salt);
  const expectedBuf = Buffer.from(user.passwordHash, 'hex');
  const candidateBuf = Buffer.from(candidateHash, 'hex');
  if (expectedBuf.length !== candidateBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, candidateBuf)) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    crmOrRegistry: user.crmOrRegistry,
    provider: 'local',
  };
}

export function findUserById(id: string): AuthUser | null {
  const cached = oauthUsersCache.get(id);
  if (cached) return cached;
  const user = USERS.find((u) => u.id === id);
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    crmOrRegistry: user.crmOrRegistry,
    provider: 'local',
  };
}

// ---------- Token de Sessão Stateless Assinado com HMAC-SHA256 ----------

export const SESSION_COOKIE_NAME = 'mediflow_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // Expiração em 8 horas

interface SessionPayload {
  uid: string;
  role: UserRole;
  name?: string;
  email?: string;
  department?: string;
  crmOrRegistry?: string;
  provider?: 'local' | 'google' | 'github';
  avatarUrl?: string;
  exp: number;
  nonce: string;
}

export function signSessionToken(user: AuthUser): string {
  const payload: SessionPayload = {
    uid: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    department: user.department,
    crmOrRegistry: user.crmOrRegistry,
    provider: user.provider,
    avatarUrl: user.avatarUrl,
    exp: Date.now() + SESSION_TTL_MS,
    nonce: crypto.randomBytes(12).toString('hex'),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifySessionToken(token: string | undefined): AuthUser | null {
  if (!token || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payloadB64)
    .digest('base64url');

  const sigBuf = Buffer.from(sigB64);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.exp || Date.now() > parsed.exp) return null;
    const known = findUserById(parsed.uid);
    if (known) return known;
    if (parsed.name && parsed.email) {
      return {
        id: parsed.uid,
        name: parsed.name,
        email: parsed.email,
        role: parsed.role,
        department: parsed.department || 'Acesso Federado OAuth',
        crmOrRegistry: parsed.crmOrRegistry || 'SSO Verificado',
        provider: parsed.provider,
        avatarUrl: parsed.avatarUrl,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export const OAUTH_STATE_COOKIE_NAME = 'mediflow_oauth_state';

export function signOAuthState(state: string): string {
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`oauth-state:${state}`)
    .digest('base64url');
  return `${state}.${sig}`;
}

export function verifyOAuthState(
  returnedState: string | undefined,
  cookieToken: string | undefined
): boolean {
  if (!returnedState || !cookieToken || !cookieToken.includes('.')) return false;
  const parts = cookieToken.split('.');
  if (parts.length !== 2) return false;
  const [cookieState, sigB64] = parts;
  if (!cookieState || !sigB64 || cookieState !== returnedState) return false;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`oauth-state:${cookieState}`)
    .digest('base64url');

  const sigBuf = Buffer.from(sigB64);
  const expBuf = Buffer.from(expectedSig);
  return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
}

export function extractRequestToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  return req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = extractRequestToken(req);
  const user = verifySessionToken(token);
  if (!user) {
    res.status(401).json({
      error: 'Sessão ausente ou expirada. Autentique-se para acessar recursos clínicos.',
    });
    return;
  }
  req.authUser = user;
  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Não autenticado.' });
      return;
    }
    if (!allowedRoles.includes(req.authUser.role)) {
      res.status(403).json({
        error: `Acesso negado pelo controle RBAC. Perfil atual (${req.authUser.role}) não possui permissão para esta operação.`,
      });
      return;
    }
    next();
  };
}

// ---------- Limitador de Taxa (Rate Limiter por Janela Deslizante) ----------

interface RateBucket {
  timestamps: number[];
}
const rateBuckets = new Map<string, RateBucket>();

export function createRateLimiter(maxRequests: number, windowMs: number, scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${scope}:${ip}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key) ?? { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((ts) => now - ts < windowMs);
    if (bucket.timestamps.length >= maxRequests) {
      res.status(429).json({
        error: 'Limite de requisições excedido para proteção contra abuso. Aguarde alguns instantes.',
      });
      return;
    }
    bucket.timestamps.push(now);
    rateBuckets.set(key, bucket);
    next();
  };
}

// ---------- Mascaramento de Dados Sensíveis PII / PHI (LGPD / HIPAA) ----------

export function maskPersonName(name: string | null | undefined): string | null {
  if (!name) return name ?? null;
  return name
    .split(/\s+/)
    .map((part) => {
      if (part.length <= 1) return '*';
      return `${part[0]}${'*'.repeat(Math.min(part.length - 1, 6))}`;
    })
    .join(' ');
}

export function maskIdentifier(idStr: string | null | undefined): string | null {
  if (!idStr) return idStr ?? null;
  const cleaned = idStr.trim();
  if (cleaned.length <= 4) return '****';
  return `${'*'.repeat(cleaned.length - 3)}${cleaned.slice(-3)}`;
}

export function applyLgpdMasking(
  record: TriageRecord,
  userRole: UserRole,
  revealedDocIds: Set<string>
): TriageRecord {
  const canUnmask = userRole === 'ADMIN_GESTOR' || userRole === 'AUDITOR_CLINICO';
  const isRevealed = canUnmask && revealedDocIds.has(record.documento_id);

  if (isRevealed) {
    return { ...record, pii_mascarado: false };
  }

  const maskedPatientName = maskPersonName(record.dados_extraidos.paciente.nome);
  const maskedPatientId = maskIdentifier(record.dados_extraidos.paciente.documento_identificacao);

  let maskedPreview = record.raw_preview;
  if (maskedPreview && record.dados_extraidos.paciente.nome) {
    const escaped = record.dados_extraidos.paciente.nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    maskedPreview = maskedPreview.replace(new RegExp(escaped, 'gi'), maskedPatientName ?? '[PROTEGIDO]');
  }
  if (maskedPreview) {
    // Mascara padrões brasileiros de CPF (000.000.000-00)
    maskedPreview = maskedPreview.replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '***.***.***-**');
  }

  return {
    ...record,
    pii_mascarado: true,
    raw_preview: maskedPreview,
    dados_extraidos: {
      ...record.dados_extraidos,
      paciente: {
        ...record.dados_extraidos.paciente,
        nome: maskedPatientName,
        documento_identificacao: maskedPatientId,
      },
    },
    decisao_roteamento: {
      ...record.decisao_roteamento,
      notificacao_gerada: {
        ...record.decisao_roteamento.notificacao_gerada,
        mensagem:
          record.dados_extraidos.paciente.nome && maskedPatientName
            ? record.decisao_roteamento.notificacao_gerada.mensagem.replace(
                record.dados_extraidos.paciente.nome,
                maskedPatientName
              )
            : record.decisao_roteamento.notificacao_gerada.mensagem,
      },
    },
  };
}

// ---------- Varredura Profunda contra Malware, Injeção de Código e Validação Documental ----------

const CODE_AND_INTRUSION_RULES: Array<{ label: string; pattern: RegExp }> = [
  {
    label: 'código JavaScript / XSS ou acesso Node.js malicioso',
    pattern:
      /(<script\b[^>]*>|javascript:|on(error|load|click|mouseover|focus)\s*=|\beval\s*\(|new\s+Function\s*\(|document\.(cookie|write)|window\.location|innerHTML\s*=|require\s*\(\s*['"`](child_process|fs|net|http)['"`]|process\.env\b|\bexecSync\s*\(|\bspawnSync\s*\()/i,
  },
  {
    label: 'código Python ou execução de comandos de sistema (import os/subprocess/exec)',
    pattern:
      /(^|\s)(import\s+(os|subprocess|sys|socket|shutil|ctypes|pickle|marshal)\b|from\s+(os|subprocess|sys|socket)\s+import\b|os\.(system|popen|exec\w*|spawn\w*)\s*\(|subprocess\.(run|Popen|call|check_output)\s*\(|__import__\s*\(|pickle\.loads\s*\(|marshal\.loads\s*\(|#!\/usr\/bin\/(env\s+)?python)/im,
  },
  {
    label: 'script Shell / Bash / PowerShell ou Webshell PHP',
    pattern:
      /(^#!\/bin\/(ba)?sh\b|\/bin\/(ba)?sh\s+-[ci]|\brm\s+-rf\b|\b(curl|wget)\b[^\n]*\|\s*(ba)?sh\b|\bpowershell\b|\bInvoke-Expression\b|\bcmd\.exe\b|<\?php\b|\bshell_exec\s*\(|\bpassthru\s*\()/im,
  },
  {
    label: 'tentativa de SQL Injection',
    pattern:
      /(\bUNION\s+(ALL\s+)?SELECT\b|\bDROP\s+(TABLE|DATABASE)\b|\bDELETE\s+FROM\b|\bALTER\s+TABLE\b|'\s*OR\s+'?1'?\s*=\s*'?1|\bxp_cmdshell\b|;\s*--\s*$)/im,
  },
  {
    label: 'tentativa de Prompt Injection / manipulação do agente IA',
    pattern:
      /(ignore\s+(all\s+)?(previous|prior)\s+instructions|disregard\s+(all\s+)?(prior|above|system)\s+instructions|reveal\s+(your\s+)?system\s+prompt|you\s+are\s+now\s+(in\s+)?developer\s+mode|override\s+clinical\s+routing|forget\s+(all\s+)?(your\s+)?instructions|\bjailbreak\b)/i,
  },
];

const PDF_ACTIVE_THREAT_RULES: Array<{ label: string; pattern: RegExp }> = [
  {
    label: 'código JavaScript embutido em PDF (/JavaScript / /JS)',
    pattern: /\/(JavaScript|JS)\b/i,
  },
  {
    label: 'ação automática oculta de abertura em PDF (/OpenAction / /AA)',
    pattern: /\/(OpenAction|AA)\b/,
  },
  {
    label: 'comando externo em PDF (/Launch / /SubmitForm / /ImportData)',
    pattern: /\/(Launch|SubmitForm|ImportData)\b/i,
  },
  {
    label: 'arquivo embutido oculto em PDF (/EmbeddedFile)',
    pattern: /\/EmbeddedFile\b/i,
  },
  {
    label: 'conteúdo ativo XFA/RichMedia suspeito em PDF',
    pattern: /\/(RichMedia|XFA)\b/i,
  },
];

const PROGRAMMING_SYNTAX_PATTERN =
  /(^\s*(const|let|var|function|class|def|async\s+def|import|export|public|private)\s+[A-Za-z_$][\w$]*|\bfunction\s*\([^)]*\)\s*\{|=>\s*\{|\bconsole\.(log|error)\(|\bprint\s*\([^)]*\)\s*$|\bfor\s*\(\s*(let|var|int)\b)/m;

export function scanMaliciousContent(
  rawText: string,
  options?: { isPdf?: boolean }
): string[] {
  const findings: string[] = [];

  if (options?.isPdf) {
    for (const rule of PDF_ACTIVE_THREAT_RULES) {
      if (rule.pattern.test(rawText)) {
        findings.push(rule.label);
      }
    }
  }

  for (const rule of CODE_AND_INTRUSION_RULES) {
    if (rule.pattern.test(rawText)) {
      findings.push(rule.label);
    }
  }

  return Array.from(new Set(findings));
}

function collectJsonStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectJsonStrings(item, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(k);
      collectJsonStrings(v, out);
    }
  }
}

export function validateClinicalTextDocument(
  rawText: string,
  sourceLabel = 'O texto submetido'
): { valid: boolean; sanitizedText: string; reason?: string; findings: string[] } {
  const cleaned = rawText.replace(/\u0000/g, '').trim();

  if (cleaned.length < 10) {
    return {
      valid: false,
      sanitizedText: '',
      findings: ['texto muito curto'],
      reason: `${sourceLabel} foi recusado: forneça um documento clínico com pelo menos 10 caracteres legíveis.`,
    };
  }

  // 1. Verifica presença de código malicioso (JS/XSS, Python, Shell, SQLi ou Prompt Injection)
  const threatFindings = scanMaliciousContent(cleaned);
  if (threatFindings.length > 0) {
    return {
      valid: false,
      sanitizedText: '',
      findings: threatFindings,
      reason: `${sourceLabel} foi bloqueado por segurança: identificamos ${threatFindings.join('; ')}. Submissão cancelada.`,
    };
  }

  // 2. Bloqueia sintaxe de código de programação disfarçada de texto clínico
  if (PROGRAMMING_SYNTAX_PATTERN.test(cleaned)) {
    return {
      valid: false,
      sanitizedText: '',
      findings: ['código de programação detectado'],
      reason: `${sourceLabel} foi bloqueado por segurança: identificamos sintaxe de código de programação em vez de documento clínico. Submissão cancelada.`,
    };
  }

  // 3. Valida legibilidade em linguagem natural (proporção de letras, palavras com vogais e símbolos)
  let textToAssess = cleaned;
  if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
    try {
      const parsed = JSON.parse(cleaned);
      const parts: string[] = [];
      collectJsonStrings(parsed, parts);
      textToAssess = parts.join(' ');
    } catch {
      // Não é JSON válido: avalia diretamente como texto puro
    }
  }

  const nonSpaceChars = textToAssess.replace(/\s+/g, '');
  const letterChars = (textToAssess.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
  const words = textToAssess.match(/[A-Za-zÀ-ÿ]{2,}/g) ?? [];
  const wordsWithVowels = words.filter((w) => /[aeiouáàâãéêíóôõúüy]/i.test(w));
  const hasExcessiveRepeats = /(.)\1{9,}/.test(textToAssess);
  const symbolChars = (textToAssess.match(/[^A-Za-zÀ-ÿ0-9\s.,:;()[\]/\-+%?°ºª'"@]/g) ?? []).length;

  const letterRatio = nonSpaceChars.length > 0 ? letterChars / nonSpaceChars.length : 0;
  const vowelWordRatio = words.length > 0 ? wordsWithVowels.length / words.length : 0;
  const symbolRatio = nonSpaceChars.length > 0 ? symbolChars / nonSpaceChars.length : 0;

  if (
    words.length < 3 ||
    letterRatio < 0.42 ||
    vowelWordRatio < 0.65 ||
    symbolRatio > 0.15 ||
    hasExcessiveRepeats
  ) {
    return {
      valid: false,
      sanitizedText: '',
      findings: ['conteúdo não documental ou ruído ilegível'],
      reason: `${sourceLabel} foi recusado: o conteúdo não corresponde a um documento ou palavras legíveis normais (detectado ruído, caracteres aleatórios ou excesso de símbolos). Submissão cancelada.`,
    };
  }

  const stripped = cleaned
    .replace(/<\/?[^>]+(>|$)/g, ' ')
    .replace(/\s+\n/g, '\n')
    .trim();

  return {
    valid: true,
    sanitizedText: stripped,
    findings: [],
  };
}

export function sanitizeClinicalInput(rawText: string): {
  sanitizedText: string;
  injectionDetected: boolean;
  matchedSignals: string[];
} {
  const findings = scanMaliciousContent(rawText);
  const stripped = rawText
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '[CONTEUDO_SCRIPT_REMOVIDO]')
    .replace(/<\/?[^>]+(>|$)/g, ' ')
    .replace(/\u0000/g, '')
    .trim();

  return {
    sanitizedText: stripped,
    injectionDetected: findings.length > 0,
    matchedSignals: findings,
  };
}

// ---------- Verificação Binária (Magic Bytes) e Scanner de Ameaças em Arquivos ----------

const DANGEROUS_EXTENSIONS =
  /\.(exe|bat|cmd|ps1|sh|bash|zsh|py|pyc|js|mjs|cjs|ts|tsx|jsx|php|jsp|asp|aspx|dll|so|dylib|msi|vbs|jar|scr|html|htm|svg|xml|rb|pl)$/i;

export function verifyFileMagicBytes(
  buffer: Buffer,
  declaredMime: string,
  originalFilename = ''
): {
  valid: boolean;
  normalizedType: 'PDF' | 'IMAGEM' | 'TEXTO' | 'JSON' | null;
  identifiedLabel: string;
  mimeType: string;
  reason?: string;
} {
  if (buffer.length === 0) {
    return {
      valid: false,
      normalizedType: null,
      identifiedLabel: 'Arquivo vazio',
      mimeType: '',
      reason: 'O arquivo submetido está vazio (0 bytes).',
    };
  }

  const lowerName = originalFilename.trim().toLowerCase();
  const headAscii = buffer.subarray(0, 64).toString('utf8').trimStart();
  const rawLatin1 = buffer.toString('latin1');
  const rawUtf8 = buffer.toString('utf8');

  // Bloqueia executáveis binários e contêineres perigosos imediatamente pelos magic bytes
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return {
      valid: false,
      normalizedType: null,
      identifiedLabel: 'Executável Windows (PE/EXE/DLL)',
      mimeType: declaredMime,
      reason:
        'O arquivo submetido foi identificado como executável Windows (PE/EXE/DLL) e bloqueado por segurança.',
    };
  }

  if (
    buffer.length >= 4 &&
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  ) {
    return {
      valid: false,
      normalizedType: null,
      identifiedLabel: 'Binário Executável Linux (ELF)',
      mimeType: declaredMime,
      reason:
        'O arquivo submetido foi identificado como binário executável Linux (ELF) e bloqueado por segurança.',
    };
  }

  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return {
      valid: false,
      normalizedType: null,
      identifiedLabel: 'Arquivo Compactado / Pacote (ZIP/JAR/Macro)',
      mimeType: declaredMime,
      reason:
        'O arquivo submetido foi identificado como pacote compactado (ZIP/JAR/Office com risco de macro) e bloqueado por segurança.',
    };
  }

  if (headAscii.startsWith('#!/')) {
    return {
      valid: false,
      normalizedType: null,
      identifiedLabel: 'Script Executável (Shebang)',
      mimeType: declaredMime,
      reason:
        'O arquivo submetido foi identificado como script executável (#!/) e bloqueado por segurança.',
    };
  }

  if (/^(<!doctype\s+html|<html\b|<svg\b|<script\b|<\?php\b)/i.test(headAscii)) {
    return {
      valid: false,
      normalizedType: null,
      identifiedLabel: 'Documento Web / Script Ativo (HTML/SVG/PHP)',
      mimeType: declaredMime,
      reason:
        'O arquivo submetido foi identificado como conteúdo HTML/SVG/PHP ativo com risco de XSS/execução e bloqueado por segurança.',
    };
  }

  // 1. PDF (%PDF-)
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    const pdfFindings = scanMaliciousContent(`${rawLatin1}\n${rawUtf8}`, { isPdf: true });
    if (pdfFindings.length > 0) {
      return {
        valid: false,
        normalizedType: null,
        identifiedLabel: 'PDF',
        mimeType: 'application/pdf',
        reason: `O arquivo submetido (identificado como PDF) foi bloqueado por segurança: contém ${pdfFindings.join('; ')}.`,
      };
    }
    return {
      valid: true,
      normalizedType: 'PDF',
      identifiedLabel: 'PDF',
      mimeType: 'application/pdf',
    };
  }

  // 2. PNG (89 50 4E 47)
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    const imgFindings = scanMaliciousContent(rawLatin1);
    if (imgFindings.length > 0) {
      return {
        valid: false,
        normalizedType: null,
        identifiedLabel: 'Imagem PNG',
        mimeType: 'image/png',
        reason: `O arquivo submetido (identificado como Imagem PNG) foi bloqueado por segurança: detectamos payload oculto (${imgFindings.join('; ')}).`,
      };
    }
    return {
      valid: true,
      normalizedType: 'IMAGEM',
      identifiedLabel: 'Imagem PNG',
      mimeType: 'image/png',
    };
  }

  // 3. JPEG (FF D8 FF)
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    const imgFindings = scanMaliciousContent(rawLatin1);
    if (imgFindings.length > 0) {
      return {
        valid: false,
        normalizedType: null,
        identifiedLabel: 'Imagem JPEG',
        mimeType: 'image/jpeg',
        reason: `O arquivo submetido (identificado como Imagem JPEG) foi bloqueado por segurança: detectamos payload oculto (${imgFindings.join('; ')}).`,
      };
    }
    return {
      valid: true,
      normalizedType: 'IMAGEM',
      identifiedLabel: 'Imagem JPEG',
      mimeType: 'image/jpeg',
    };
  }

  // 4. WEBP (RIFF....WEBP)
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    const imgFindings = scanMaliciousContent(rawLatin1);
    if (imgFindings.length > 0) {
      return {
        valid: false,
        normalizedType: null,
        identifiedLabel: 'Imagem WEBP',
        mimeType: 'image/webp',
        reason: `O arquivo submetido (identificado como Imagem WEBP) foi bloqueado por segurança: detectamos payload oculto (${imgFindings.join('; ')}).`,
      };
    }
    return {
      valid: true,
      normalizedType: 'IMAGEM',
      identifiedLabel: 'Imagem WEBP',
      mimeType: 'image/webp',
    };
  }

  // Bloqueia extensões de código ou executáveis mesmo quando o MIME alega text/plain
  if (DANGEROUS_EXTENSIONS.test(lowerName)) {
    return {
      valid: false,
      normalizedType: null,
      identifiedLabel: `Arquivo de código/executável (${lowerName.split('.').pop()?.toUpperCase()})`,
      mimeType: declaredMime,
      reason: `O arquivo submetido (${originalFilename}) possui extensão executável ou de script não permitida e foi bloqueado por segurança.`,
    };
  }

  // 5. JSON estruturado ou TXT clínico legível
  const looksTextual =
    declaredMime.includes('json') ||
    declaredMime.includes('text') ||
    lowerName.endsWith('.json') ||
    lowerName.endsWith('.txt');

  if (looksTextual) {
    if (buffer.includes(0x00)) {
      return {
        valid: false,
        normalizedType: null,
        identifiedLabel: 'Arquivo Binário Disfarçado',
        mimeType: declaredMime,
        reason:
          'O arquivo submetido como texto contém bytes binários nulos e foi bloqueado por segurança.',
      };
    }

    const text = rawUtf8.trim();
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        JSON.parse(text);
        const check = validateClinicalTextDocument(text, 'O arquivo submetido (JSON)');
        if (!check.valid) {
          return {
            valid: false,
            normalizedType: null,
            identifiedLabel: 'JSON',
            mimeType: 'application/json',
            reason: check.reason,
          };
        }
        return {
          valid: true,
          normalizedType: 'JSON',
          identifiedLabel: 'JSON',
          mimeType: 'application/json',
        };
      } catch {
        return {
          valid: false,
          normalizedType: null,
          identifiedLabel: 'JSON inválido',
          mimeType: '',
          reason: 'O arquivo submetido (JSON) está inválido ou corrompido.',
        };
      }
    }

    if (text.length > 0) {
      const check = validateClinicalTextDocument(text, 'O arquivo submetido (TXT)');
      if (!check.valid) {
        return {
          valid: false,
          normalizedType: null,
          identifiedLabel: 'Texto (.txt)',
          mimeType: 'text/plain',
          reason: check.reason,
        };
      }
      return {
        valid: true,
        normalizedType: 'TEXTO',
        identifiedLabel: 'Texto (.txt)',
        mimeType: 'text/plain',
      };
    }
  }

  return {
    valid: false,
    normalizedType: null,
    identifiedLabel: declaredMime || 'Formato desconhecido',
    mimeType: declaredMime,
    reason: `O arquivo submetido (${declaredMime || originalFilename || 'desconhecido'}) foi bloqueado: assinatura binária não corresponde a PDF, PNG, JPEG, WEBP, TXT ou JSON clínico válido.`,
  };
}

// ---------- Proteção Anti-SSRF para URLs de Webhooks Externos ----------

export function isSafeExternalWebhookUrl(urlString: string): boolean {
  if (!urlString.trim()) return true;
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.endsWith('.internal') ||
      host.endsWith('.local')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ---------- Trilha de Auditoria Criptográfica Tamper-Evident (Cadeia SHA-256) ----------

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

function readAuditLogStore(): AuditLogEntry[] {
  ensureVaultDir();
  if (!fs.existsSync(AUDIT_LOG_FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(AUDIT_LOG_FILE, 'utf8')) as AuditLogEntry[];
  } catch {
    return [];
  }
}

function writeAuditLogStore(entries: AuditLogEntry[]): void {
  ensureVaultDir();
  fs.writeFileSync(AUDIT_LOG_FILE, JSON.stringify(entries, null, 2), { mode: 0o600 });
}

export function appendAuditLog(params: {
  actor: Pick<AuthUser, 'id' | 'email' | 'role'>;
  ip: string;
  action: AuditLogEntry['action'];
  resourceId: string;
  details: string;
}): AuditLogEntry {
  const entries = readAuditLogStore();
  const prevHash = entries.length > 0 ? entries[entries.length - 1].entry_hash : GENESIS_HASH;
  const seq = entries.length + 1;
  const timestamp = new Date().toISOString();
  const id = `AUD-${String(seq).padStart(5, '0')}`;

  const canonical = JSON.stringify({
    seq,
    id,
    timestamp,
    actor_id: params.actor.id,
    actor_email: params.actor.email,
    actor_role: params.actor.role,
    ip_address: params.ip,
    action: params.action,
    resource_id: params.resourceId,
    details: params.details,
    prev_hash: prevHash,
  });

  const entryHash = computeSha256(canonical);
  const entry: AuditLogEntry = {
    seq,
    id,
    timestamp,
    actor_id: params.actor.id,
    actor_email: params.actor.email,
    actor_role: params.actor.role,
    ip_address: params.ip,
    action: params.action,
    resource_id: params.resourceId,
    details: params.details,
    prev_hash: prevHash,
    entry_hash: entryHash,
  };

  entries.push(entry);
  writeAuditLogStore(entries);
  return entry;
}

export function getAuditLogs(): AuditLogEntry[] {
  return readAuditLogStore().slice().reverse();
}

export function verifyAuditChain(): {
  valid: boolean;
  totalEntries: number;
  brokenAtSeq?: number;
  lastHash: string;
} {
  const entries = readAuditLogStore();
  let expectedPrev = GENESIS_HASH;
  for (const entry of entries) {
    if (entry.prev_hash !== expectedPrev) {
      return {
        valid: false,
        totalEntries: entries.length,
        brokenAtSeq: entry.seq,
        lastHash: expectedPrev,
      };
    }
    const canonical = JSON.stringify({
      seq: entry.seq,
      id: entry.id,
      timestamp: entry.timestamp,
      actor_id: entry.actor_id,
      actor_email: entry.actor_email,
      actor_role: entry.actor_role,
      ip_address: entry.ip_address,
      action: entry.action,
      resource_id: entry.resource_id,
      details: entry.details,
      prev_hash: entry.prev_hash,
    });
    const recomputed = computeSha256(canonical);
    if (recomputed !== entry.entry_hash) {
      return {
        valid: false,
        totalEntries: entries.length,
        brokenAtSeq: entry.seq,
        lastHash: entry.entry_hash,
      };
    }
    expectedPrev = entry.entry_hash;
  }
  return {
    valid: true,
    totalEntries: entries.length,
    lastHash: expectedPrev,
  };
}
