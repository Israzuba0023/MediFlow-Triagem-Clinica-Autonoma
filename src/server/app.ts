import crypto from 'node:crypto';
import cookieParser from 'cookie-parser';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import multer from 'multer';
import {
  HumanAuditDecisionSchema,
  TriageRequestSchema,
  TriageRulesConfigSchema,
  type AuthUser,
  type TriageRecord,
  type UserRole,
} from '../shared/clinicalSchemas.ts';
import { resolveGeminiApiKey, runAutonomousTriageGraph } from './agentGraph.ts';
import {
  listOciBucketObjects,
  moveOciObject,
  readAndVerifyOciObject,
  type OciFolderPrefix,
} from './ociStorage.ts';
import {
  appendAuditLog,
  applyLgpdMasking,
  createRateLimiter,
  extractRequestToken,
  getAuditLogs,
  getSecurityRuntimeStatus,
  isSafeExternalWebhookUrl,
  isServerlessRuntime,
  OAUTH_STATE_COOKIE_NAME,
  registerOAuthUser,
  requireAuth,
  requireRole,
  SESSION_COOKIE_NAME,
  signOAuthState,
  signSessionToken,
  validateClinicalTextDocument,
  verifyAuditChain,
  verifyFileMagicBytes,
  verifyOAuthState,
  verifySessionToken,
  verifyUserCredentials,
  type AuthenticatedRequest,
} from './security.ts';
import {
  findDocumentById,
  loadAllAlerts,
  loadAllDocuments,
  loadRules,
  saveAllAlerts,
  saveRules,
  upsertDocument,
} from './store.ts';

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production' || isServerlessRuntime();

// Rastreia em memória os IDs de documentos revelados por usuário (nunca persistidos sem máscara)
const unmaskedAccessBySession = new Map<string, Set<string>>();

function getRevealedSet(userId: string): Set<string> {
  let set = unmaskedAccessBySession.get(userId);
  if (!set) {
    set = new Set<string>();
    unmaskedAccessBySession.set(userId, set);
  }
  return set;
}

function getClientIp(req: Request): string {
  const netlifyIp = req.headers['x-nf-client-connection-ip'];
  if (typeof netlifyIp === 'string' && netlifyIp.length > 0) {
    return netlifyIp.trim();
  }
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}

function getAppBaseUrl(req: Request): string {
  const candidates = [
    process.env.APP_URL,
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
  ];
  for (const envUrl of candidates) {
    if (envUrl && envUrl !== 'MY_APP_URL' && envUrl.startsWith('http')) {
      return envUrl.replace(/\/$/, '');
    }
  }
  const proto =
    (typeof req.headers['x-forwarded-proto'] === 'string'
      ? req.headers['x-forwarded-proto'].split(',')[0].trim()
      : undefined) || (req.secure ? 'https' : 'http');
  const host =
    (typeof req.headers['x-forwarded-host'] === 'string'
      ? req.headers['x-forwarded-host'].split(',')[0].trim()
      : undefined) ||
    req.headers.host ||
    `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function isRequestHttps(req: Request): boolean {
  return (
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    (process.env.APP_URL?.startsWith('https://') ?? false) ||
    (process.env.URL?.startsWith('https://') ?? false) ||
    isServerlessRuntime()
  );
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = isRequestHttps(req);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  });
}

function resolveOAuthRole(email?: string): UserRole {
  const normalized = (email || '').trim().toLowerCase();
  const admins = (process.env.OAUTH_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const auditors = (process.env.OAUTH_AUDITOR_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (normalized && admins.includes(normalized)) return 'ADMIN_GESTOR';
  if (normalized && auditors.includes(normalized)) return 'AUDITOR_CLINICO';
  if (process.env.DISABLE_DEMO_LOGIN === 'true') return 'OPERADOR_TRIAGEM';
  return 'ADMIN_GESTOR';
}

// Guarda CSRF sensível a proxies reversos e ambiente Netlify para requisições que alteram estado
function csrfOriginGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }

  try {
    const originUrl = new URL(origin);
    const originHost = originUrl.host.toLowerCase();
    const allowedHosts = new Set<string>();

    if (req.headers.host) allowedHosts.add(req.headers.host.toLowerCase());
    const xfHost = req.headers['x-forwarded-host'];
    if (typeof xfHost === 'string') {
      for (const h of xfHost.split(',')) {
        if (h.trim()) allowedHosts.add(h.trim().toLowerCase());
      }
    }

    for (const envUrl of [
      process.env.APP_URL,
      process.env.URL,
      process.env.DEPLOY_PRIME_URL,
      process.env.DEPLOY_URL,
    ]) {
      if (envUrl && envUrl !== 'MY_APP_URL') {
        try {
          allowedHosts.add(new URL(envUrl).host.toLowerCase());
        } catch {
          // Ignora URL de ambiente malformada
        }
      }
    }

    const secFetchSite = req.headers['sec-fetch-site'];
    const isSameOriginHeader = secFetchSite === 'same-origin';
    const isAiStudioRunApp =
      originHost.endsWith('.run.app') &&
      (secFetchSite === 'same-origin' ||
        secFetchSite === 'same-site' ||
        Boolean(req.headers['x-forwarded-host']) ||
        Boolean(process.env.APP_URL));
    const isNetlifyPreviewOrigin =
      isServerlessRuntime() &&
      originUrl.protocol === 'https:' &&
      (originHost.endsWith('.netlify.app') || originHost.endsWith('.netlify.live'));

    if (
      allowedHosts.has(originHost) ||
      isSameOriginHeader ||
      isAiStudioRunApp ||
      isNetlifyPreviewOrigin
    ) {
      next();
      return;
    }

    res.status(403).json({ error: 'Origem da requisição não autorizada (proteção CSRF).' });
    return;
  } catch {
    res.status(403).json({ error: 'Cabeçalho Origin inválido.' });
    return;
  }
}

const maxUploadBytes = isServerlessRuntime() ? 4 * 1024 * 1024 : 10 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxUploadBytes,
    files: 1,
  },
});

export function createMediFlowApp(): Express {
  const app = express();
  app.set('trust proxy', 1);

  // Remove o prefixo da função Netlify quando a rota chega via redirecionamento interno
  app.use((req, _res, next) => {
    if (req.url.startsWith('/.netlify/functions/api')) {
      req.url = req.url.replace(/^\/\.netlify\/functions\/api/, '') || '/';
    }
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: IS_PROD
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
              fontSrc: ["'self'", 'https://fonts.gstatic.com'],
              imgSrc: [
                "'self'",
                'data:',
                'blob:',
                'https://lh3.googleusercontent.com',
                'https://avatars.githubusercontent.com',
              ],
              connectSrc: ["'self'"],
              frameAncestors: [
                "'self'",
                'https://aistudio.google.com',
                'https://*.google.com',
                'https://*.netlify.app',
              ],
            },
          }
        : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginEmbedderPolicy: false,
      frameguard: false,
    })
  );

  app.use(cookieParser());
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', csrfOriginGuard);

  // Proteção global Anti-IDOR e Path Traversal em todas as chamadas à API
  app.use('/api', (req, res, next) => {
    const rawUrl = decodeURIComponent(req.originalUrl || req.url || '');
    if (rawUrl.includes('..') || rawUrl.includes('\\')) {
      res.status(403).json({
        error: 'Bloqueio de segurança: tentativa de manipulação de caminho (Path Traversal) detectada.',
      });
      return;
    }

    const forbiddenUserParams = ['userid', 'user_id', 'ownerid', 'owner_id', 'actorid', 'actor_id', 'impersonate', 'actas', 'switchuser'];
    const queryKeys = Object.keys(req.query || {}).map((k) => k.toLowerCase());
    const matchedParam = queryKeys.find((k) => forbiddenUserParams.includes(k));
    if (matchedParam) {
      const token = extractRequestToken(req);
      const actor = verifySessionToken(token);
      if (actor) {
        appendAuditLog({
          actor,
          ip: getClientIp(req),
          action: 'SECURITY_BLOCK',
          resourceId: matchedParam,
          details: `Tentativa de troca/forjamento de usuário via URL (?${matchedParam}=...) bloqueada pelo controle Anti-IDOR.`,
        });
      }
      res.status(403).json({
        error: 'Acesso bloqueado (Anti-IDOR): não é permitido trocar ou consultar outro usuário pela URL.',
      });
      return;
    }
    next();
  });

  const authRateLimiter = createRateLimiter(30, 15 * 60 * 1000, 'auth');
  const triageRateLimiter = createRateLimiter(30, 60 * 1000, 'triage');

  // ---------------- MONITORAMENTO E SAÚDE DO SERVIÇO ----------------
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'MediFlow Clinical Triage Agent',
      geminiConfigured: Boolean(resolveGeminiApiKey()),
      security: getSecurityRuntimeStatus(),
      timestamp: new Date().toISOString(),
    });
  });

  // ---------------- AUTENTICAÇÃO E OAUTH FEDERADO (GOOGLE / GITHUB) ----------------
  app.get('/api/auth/oauth/providers', (_req, res) => {
    res.json({
      googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      githubConfigured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      demoEnabled: process.env.DISABLE_DEMO_LOGIN !== 'true',
    });
  });

  app.post('/api/auth/oauth/demo', authRateLimiter, (req, res) => {
    if (process.env.DISABLE_DEMO_LOGIN === 'true') {
      res.status(403).json({
        error: 'Login de demonstração desativado neste ambiente. Utilize OAuth corporativo real.',
      });
      return;
    }

    const provider: 'local' | 'google' | 'github' =
      req.body?.provider === 'github'
        ? 'github'
        : req.body?.provider === 'google'
          ? 'google'
          : 'local';
    const requestedRole: UserRole =
      req.body?.role === 'AUDITOR_CLINICO' || req.body?.role === 'OPERADOR_TRIAGEM'
        ? req.body.role
        : 'ADMIN_GESTOR';

    // Sanitiza nome e e-mail opcionais informados na requisição
    const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const safeName = rawName.replace(/[<>"{}[\]\\;`]/g, '').slice(0, 80);
    const emailRegex = /^[^\s@<>"{}[\]\\;`]+@[^\s@<>"{}[\]\\;`]+\.[^\s@<>"{}[\]\\;`]+$/;
    const safeEmail = emailRegex.test(rawEmail) ? rawEmail.slice(0, 120) : '';

    if (rawName && /[<>]|\b(script|onerror|onload|import|eval)\b/i.test(rawName)) {
      res.status(422).json({ error: 'Nome de usuário contém caracteres não permitidos.' });
      return;
    }

    const roleProfiles: Record<UserRole, { dept: string; reg: string; label: string }> = {
      ADMIN_GESTOR: {
        dept: 'Governança Clínica & DPO (LGPD)',
        reg: 'CRM-SP 112409 · DPO',
        label: 'Gestor Clínico',
      },
      AUDITOR_CLINICO: {
        dept: 'Comitê de Auditoria Médica HITL',
        reg: 'CRM-SP 189340',
        label: 'Auditor Médico',
      },
      OPERADOR_TRIAGEM: {
        dept: 'Pronto-Socorro & Admissão',
        reg: 'COREN-SP 441209',
        label: 'Operador Triagem',
      },
    };

    const profile = roleProfiles[requestedRole];
    const uniqueSuffix = crypto.randomBytes(6).toString('hex');
    const defaultName =
      provider === 'google'
        ? `Conta Google (${profile.label})`
        : provider === 'github'
          ? `Conta GitHub (${profile.label})`
          : profile.label;
    const defaultEmail =
      provider === 'google'
        ? 'demo.google@mediflow.health'
        : provider === 'github'
          ? 'demo.github@mediflow.health'
          : 'acesso@mediflow.health';

    const demoUser: AuthUser = registerOAuthUser({
      id: `oauth-${provider}-${uniqueSuffix}`,
      name: safeName || defaultName,
      email: safeEmail || defaultEmail,
      role: requestedRole,
      department: profile.dept,
      crmOrRegistry:
        provider === 'local'
          ? profile.reg
          : `${profile.reg} · SSO ${provider.toUpperCase()}`,
      provider,
    });

    const token = signSessionToken(demoUser);
    setSessionCookie(req, res, token);

    appendAuditLog({
      actor: demoUser,
      ip: getClientIp(req),
      action: 'LOGIN_SUCCESS',
      resourceId: demoUser.id,
      details: `Sessão demo federada via ${provider.toUpperCase()} (${demoUser.email}) iniciada com perfil ${demoUser.role}.`,
    });

    res.json({ user: demoUser, sessionToken: token });
  });

  app.get('/api/auth/oauth/:provider/url', (req, res) => {
    const provider = req.params.provider;
    const baseUrl = getAppBaseUrl(req);
    const state = crypto.randomBytes(16).toString('hex');
    const isHttps = isRequestHttps(req);

    const setStateCookie = () => {
      res.cookie(OAUTH_STATE_COOKIE_NAME, signOAuthState(state), {
        httpOnly: true,
        sameSite: isHttps ? 'none' : 'lax',
        secure: isHttps,
        maxAge: 10 * 60 * 1000,
        path: '/',
      });
    };

    if (provider === 'google') {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) {
        res.status(400).json({ error: 'GOOGLE_CLIENT_ID não configurado.' });
        return;
      }
      setStateCookie();
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `${baseUrl}/auth/callback/google`,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        prompt: 'select_account',
      });
      res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
      return;
    }

    if (provider === 'github') {
      const clientId = process.env.GITHUB_CLIENT_ID;
      if (!clientId) {
        res.status(400).json({ error: 'GITHUB_CLIENT_ID não configurado.' });
        return;
      }
      setStateCookie();
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `${baseUrl}/auth/callback/github`,
        scope: 'read:user user:email',
        state,
      });
      res.json({ url: `https://github.com/login/oauth/authorize?${params}` });
      return;
    }

    res.status(404).json({ error: 'Provedor OAuth desconhecido.' });
  });

  app.get(['/auth/callback/google', '/auth/callback/google/'], async (req, res) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const returnedState = typeof req.query.state === 'string' ? req.query.state : '';
      const stateCookie = req.cookies?.[OAUTH_STATE_COOKIE_NAME] as string | undefined;
      res.clearCookie(OAUTH_STATE_COOKIE_NAME, { path: '/' });

      if (!verifyOAuthState(returnedState, stateCookie)) {
        res.status(403).send('Estado OAuth inválido ou expirado (proteção CSRF).');
        return;
      }

      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!code || !clientId || !clientSecret) {
        res.status(400).send('Parâmetros OAuth Google ausentes.');
        return;
      }
      const baseUrl = getAppBaseUrl(req);
      const safeOrigin = new URL(baseUrl).origin;
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: `${baseUrl}/auth/callback/google`,
          grant_type: 'authorization_code',
        }),
      });
      const tokenJson = (await tokenRes.json()) as { access_token?: string };
      if (!tokenJson.access_token) {
        res.status(401).send('Falha ao obter token do Google.');
        return;
      }
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      const profile = (await profileRes.json()) as {
        id: string;
        name?: string;
        email?: string;
        picture?: string;
      };
      const oauthUser = registerOAuthUser({
        id: `google-${profile.id}`,
        name: profile.name || profile.email || 'Usuário Google',
        email: profile.email || `google-${profile.id}@mediflow.health`,
        role: resolveOAuthRole(profile.email),
        department: 'Acesso Federado Google',
        crmOrRegistry: 'Google OAuth 2.0',
        provider: 'google',
        avatarUrl: profile.picture,
      });
      const token = signSessionToken(oauthUser);
      setSessionCookie(req, res, token);
      appendAuditLog({
        actor: oauthUser,
        ip: getClientIp(req),
        action: 'LOGIN_SUCCESS',
        resourceId: oauthUser.id,
        details: `Login real Google OAuth concluído (${oauthUser.email}, perfil ${oauthUser.role}).`,
      });
      res.send(`<html><body><script>
        if (window.opener) {
          window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', sessionToken: ${JSON.stringify(token)}, user: ${JSON.stringify(oauthUser)} }, ${JSON.stringify(safeOrigin)});
          window.close();
        } else {
          window.location.href = '/';
        }
      </script><p>Autenticação Google concluída. Fechando janela...</p></body></html>`);
    } catch {
      res.status(500).send('Erro no callback OAuth Google.');
    }
  });

  app.get(['/auth/callback/github', '/auth/callback/github/'], async (req, res) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const returnedState = typeof req.query.state === 'string' ? req.query.state : '';
      const stateCookie = req.cookies?.[OAUTH_STATE_COOKIE_NAME] as string | undefined;
      res.clearCookie(OAUTH_STATE_COOKIE_NAME, { path: '/' });

      if (!verifyOAuthState(returnedState, stateCookie)) {
        res.status(403).send('Estado OAuth inválido ou expirado (proteção CSRF).');
        return;
      }

      const clientId = process.env.GITHUB_CLIENT_ID;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET;
      if (!code || !clientId || !clientSecret) {
        res.status(400).send('Parâmetros OAuth GitHub ausentes.');
        return;
      }
      const baseUrl = getAppBaseUrl(req);
      const safeOrigin = new URL(baseUrl).origin;
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: `${baseUrl}/auth/callback/github`,
        }),
      });
      const tokenJson = (await tokenRes.json()) as { access_token?: string };
      if (!tokenJson.access_token) {
        res.status(401).send('Falha ao obter token do GitHub.');
        return;
      }
      const ghRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
          'User-Agent': 'MediFlow-App',
        },
      });
      const ghUser = (await ghRes.json()) as {
        id: number;
        login: string;
        name?: string;
        email?: string | null;
        avatar_url?: string;
      };
      // Caso o e-mail público no GitHub esteja oculto, consulta os e-mails verificados da conta
      let resolvedEmail = ghUser.email || undefined;
      if (!resolvedEmail) {
        try {
          const emailsRes = await fetch('https://api.github.com/user/emails', {
            headers: {
              Authorization: `Bearer ${tokenJson.access_token}`,
              'User-Agent': 'MediFlow-App',
            },
          });
          if (emailsRes.ok) {
            const emails = (await emailsRes.json()) as Array<{
              email: string;
              primary: boolean;
              verified: boolean;
            }>;
            const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified);
            resolvedEmail = primary?.email;
          }
        } catch {
          // Segue com e-mail fallback noreply do GitHub se a consulta secundária falhar
        }
      }
      const oauthUser = registerOAuthUser({
        id: `github-${ghUser.id}`,
        name: ghUser.name || ghUser.login,
        email: resolvedEmail || `${ghUser.login}@users.noreply.github.com`,
        role: resolveOAuthRole(resolvedEmail),
        department: 'Acesso Federado GitHub',
        crmOrRegistry: `GitHub @${ghUser.login}`,
        provider: 'github',
        avatarUrl: ghUser.avatar_url,
      });
      const token = signSessionToken(oauthUser);
      setSessionCookie(req, res, token);
      appendAuditLog({
        actor: oauthUser,
        ip: getClientIp(req),
        action: 'LOGIN_SUCCESS',
        resourceId: oauthUser.id,
        details: `Login real GitHub OAuth concluído (@${ghUser.login}, perfil ${oauthUser.role}).`,
      });
      res.send(`<html><body><script>
        if (window.opener) {
          window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', sessionToken: ${JSON.stringify(token)}, user: ${JSON.stringify(oauthUser)} }, ${JSON.stringify(safeOrigin)});
          window.close();
        } else {
          window.location.href = '/';
        }
      </script><p>Autenticação GitHub concluída. Fechando janela...</p></body></html>`);
    } catch {
      res.status(500).send('Erro no callback OAuth GitHub.');
    }
  });

  app.post('/api/auth/login', authRateLimiter, (req, res) => {
    if (process.env.DISABLE_DEMO_LOGIN === 'true') {
      res.status(403).json({
        error: 'Login local de demonstração desativado. Utilize OAuth corporativo real.',
      });
      return;
    }

    const email = typeof req.body?.email === 'string' ? req.body.email : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const ip = getClientIp(req);

    if (!email || !password) {
      res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
      return;
    }

    const user = verifyUserCredentials(email, password);
    if (!user) {
      appendAuditLog({
        actor: { id: 'anon', email: email.slice(0, 80), role: 'OPERADOR_TRIAGEM' },
        ip,
        action: 'LOGIN_FAILED',
        resourceId: 'session',
        details: `Tentativa de autenticação falhou para ${email.slice(0, 80)}`,
      });
      res.status(401).json({ error: 'Credenciais inválidas.' });
      return;
    }

    const token = signSessionToken(user);
    setSessionCookie(req, res, token);

    appendAuditLog({
      actor: user,
      ip,
      action: 'LOGIN_SUCCESS',
      resourceId: user.id,
      details: `Sessão iniciada com perfil ${user.role} (${user.department})`,
    });

    res.json({ user, sessionToken: token });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = extractRequestToken(req);
    const user = verifySessionToken(token);
    if (user) {
      unmaskedAccessBySession.delete(user.id);
      appendAuditLog({
        actor: user,
        ip: getClientIp(req),
        action: 'LOGOUT',
        resourceId: user.id,
        details: 'Sessão encerrada pelo usuário.',
      });
    }
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const token = extractRequestToken(req);
    const user = verifySessionToken(token);
    if (!user) {
      res.status(401).json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, user });
  });

  // ---------------- TRIAGEM E INGESTÃO MULTIMODAL ----------------
  app.post(
    '/api/triage/process',
    requireAuth,
    triageRateLimiter,
    upload.single('file'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const user = req.authUser!;
        const ip = getClientIp(req);

        const bodyParsed = TriageRequestSchema.safeParse({
          documento_id: req.body?.documento_id || undefined,
          tipo_arquivo: req.body?.tipo_arquivo || (req.file ? 'PDF' : 'TEXTO'),
          documento_texto: req.body?.documento_texto || undefined,
          canal_origem: req.body?.canal_origem || 'Portal_Web',
        });

        if (!bodyParsed.success) {
          res.status(400).json({
            error: 'Payload de triagem inválido.',
            details: bodyParsed.error.flatten(),
          });
          return;
        }

        const { documento_id, canal_origem } = bodyParsed.data;
        let { tipo_arquivo, documento_texto } = bodyParsed.data;

        let fileBuffer: Buffer | undefined;
        let fileMimeType: string | undefined;
        let originalFilename: string | undefined;

        if (req.file) {
          const magicCheck = verifyFileMagicBytes(
            req.file.buffer,
            req.file.mimetype,
            req.file.originalname
          );
          if (!magicCheck.valid || !magicCheck.normalizedType) {
            appendAuditLog({
              actor: user,
              ip,
              action: 'SECURITY_BLOCK',
              resourceId: req.file.originalname,
              details: `Upload bloqueado [${magicCheck.identifiedLabel}]: ${magicCheck.reason}`,
            });
            res.status(422).json({
              error: magicCheck.reason || 'Arquivo bloqueado por segurança.',
            });
            return;
          }

          fileMimeType = magicCheck.mimeType;
          originalFilename = req.file.originalname;

          if (magicCheck.normalizedType === 'JSON' || magicCheck.normalizedType === 'TEXTO') {
            tipo_arquivo = magicCheck.normalizedType;
            const textFromFile = req.file.buffer.toString('utf8');
            documento_texto = documento_texto
              ? `${documento_texto}\n\n${textFromFile}`
              : textFromFile;
          } else {
            tipo_arquivo = magicCheck.normalizedType;
            fileBuffer = req.file.buffer;
          }
        }

        if (documento_texto && documento_texto.trim().length > 0) {
          const textValidation = validateClinicalTextDocument(
            documento_texto,
            'O texto submetido'
          );
          if (!textValidation.valid) {
            appendAuditLog({
              actor: user,
              ip,
              action: 'SECURITY_BLOCK',
              resourceId: documento_id || 'text-input',
              details: `Submissão de texto cancelada: ${textValidation.findings.join('; ')}`,
            });
            res.status(422).json({
              error: textValidation.reason || 'Conteúdo de texto inválido ou malicioso bloqueado.',
            });
            return;
          }
          documento_texto = textValidation.sanitizedText;
        }

        if (!fileBuffer && (!documento_texto || documento_texto.trim().length < 10)) {
          res.status(400).json({
            error:
              'Forneça um arquivo clínico (PDF/Imagem/TXT/JSON) ou texto clínico legível com pelo menos 10 caracteres.',
          });
          return;
        }

        const finalDocId =
          documento_id ||
          `DOC-CLIN-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`;

        const result = await runAutonomousTriageGraph({
          documentoId: finalDocId,
          tipoArquivo: tipo_arquivo,
          canalOrigem: canal_origem,
          submittedBy: `${user.name} (${user.role})`,
          ownerId: user.id,
          textContent: documento_texto,
          fileBuffer,
          fileMimeType,
          originalFilename,
        });

        appendAuditLog({
          actor: user,
          ip,
          action: 'DOCUMENT_INGESTED',
          resourceId: result.documento_id,
          details: `Documento ${result.classificacao.tipo_documento} processado -> ${result.decisao_roteamento.destino_principal} (confiança ${result.avaliacao_consistencia.score_confianca_final}, status ${result.status})`,
        });

        const maskedView = applyLgpdMasking(result, user.role, getRevealedSet(user.id));
        res.status(201).json(maskedView);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro interno no pipeline de triagem.';
        const statusCode = message.includes('GEMINI_API_KEY') ? 503 : 500;
        res.status(statusCode).json({ error: message });
      }
    }
  );

  // ---------------- DOCUMENTOS E DESMASCARAMENTO LGPD (ISOLADOS POR USUÁRIO / ANTI-IDOR) ----------------
  app.get('/api/documents', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const revealed = getRevealedSet(user.id);
    const docs = loadAllDocuments()
      .filter((doc) => doc.owner_id === user.id)
      .map((doc) => applyLgpdMasking(doc, user.role, revealed));
    res.json({ documents: docs });
  });

  app.get('/api/documents/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const docId = String(req.params.id);
    const doc = findDocumentById(docId);
    if (!doc) {
      res.status(404).json({ error: 'Documento não encontrado.' });
      return;
    }
    if (doc.owner_id !== user.id) {
      appendAuditLog({
        actor: user,
        ip: getClientIp(req),
        action: 'SECURITY_BLOCK',
        resourceId: docId,
        details: `Acesso Anti-IDOR bloqueado: usuário ${user.id} tentou ler documento pertencente a outro usuário.`,
      });
      res.status(403).json({
        error: 'Acesso bloqueado (Anti-IDOR): este documento pertence a outro usuário.',
      });
      return;
    }
    res.json({
      document: applyLgpdMasking(doc, user.role, getRevealedSet(user.id)),
    });
  });

  app.post(
    '/api/documents/:id/reveal',
    requireAuth,
    requireRole('ADMIN_GESTOR', 'AUDITOR_CLINICO'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const docId = String(req.params.id);
      const doc = findDocumentById(docId);
      if (!doc) {
        res.status(404).json({ error: 'Documento não encontrado.' });
        return;
      }
      if (doc.owner_id !== user.id) {
        appendAuditLog({
          actor: user,
          ip: getClientIp(req),
          action: 'SECURITY_BLOCK',
          resourceId: docId,
          details: `Desmascaramento Anti-IDOR bloqueado para documento ${docId} de outro usuário.`,
        });
        res.status(403).json({
          error: 'Acesso bloqueado (Anti-IDOR): este documento pertence a outro usuário.',
        });
        return;
      }
      const revealed = getRevealedSet(user.id);
      revealed.add(docId);

      appendAuditLog({
        actor: user,
        ip: getClientIp(req),
        action: 'PII_UNMASKED',
        resourceId: docId,
        details: `Dados sensíveis (PII/PHI) revelados temporariamente em sessão pelo perfil ${user.role}.`,
      });

      res.json({ document: applyLgpdMasking(doc, user.role, revealed) });
    }
  );

  // ---------------- AUDITORIA CLÍNICA HUMAN-IN-THE-LOOP (HITL) ----------------
  app.post(
    '/api/documents/:id/audit',
    requireAuth,
    requireRole('ADMIN_GESTOR', 'AUDITOR_CLINICO'),
    async (req: AuthenticatedRequest, res) => {
      try {
        const user = req.authUser!;
        const docId = String(req.params.id);
        const doc = findDocumentById(docId);
        if (!doc) {
          res.status(404).json({ error: 'Documento não encontrado.' });
          return;
        }
        if (doc.owner_id !== user.id) {
          appendAuditLog({
            actor: user,
            ip: getClientIp(req),
            action: 'SECURITY_BLOCK',
            resourceId: docId,
            details: `Auditoria HITL Anti-IDOR bloqueada para documento ${docId} de outro usuário.`,
          });
          res.status(403).json({
            error: 'Acesso bloqueado (Anti-IDOR): este documento pertence a outro usuário.',
          });
          return;
        }

        const parsed = HumanAuditDecisionSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'Dados da decisão de auditoria inválidos.' });
          return;
        }

        const { decisao, observacao_auditor, destino_corrigido, dados_corrigidos } = parsed.data;
        const now = new Date().toISOString();

        const updatedDoc: TriageRecord = {
          ...doc,
          status: decisao === 'aprovado' ? 'aprovado_auditoria' : 'rejeitado_auditoria',
          updated_at: now,
          classificacao: {
            ...doc.classificacao,
            nivel_prioridade:
              dados_corrigidos?.nivel_prioridade || doc.classificacao.nivel_prioridade,
          },
          dados_extraidos: {
            ...doc.dados_extraidos,
            paciente: {
              ...doc.dados_extraidos.paciente,
              nome: dados_corrigidos?.paciente_nome || doc.dados_extraidos.paciente.nome,
            },
            medico_solicitante: {
              nome: dados_corrigidos?.medico_nome || doc.dados_extraidos.medico_solicitante.nome,
              crm: dados_corrigidos?.medico_crm || doc.dados_extraidos.medico_solicitante.crm,
            },
            diagnostico_principal:
              dados_corrigidos?.diagnostico_principal || doc.dados_extraidos.diagnostico_principal,
            cid_sugerido: dados_corrigidos?.cid_sugerido || doc.dados_extraidos.cid_sugerido,
          },
          decisao_roteamento: {
            ...doc.decisao_roteamento,
            destino_principal:
              decisao === 'aprovado'
                ? destino_corrigido || 'Prontuario_Eletronico'
                : 'Devolucao_Origem_Reenvio',
            requer_auditoria_humana: false,
            justificativa_roteamento:
              decisao === 'aprovado'
                ? `Validado por auditor humano (${user.name}): ${observacao_auditor}`
                : `Rejeitado por auditor humano (${user.name}): ${observacao_auditor}`,
          },
          auditoria_humana: {
            revisado_por: `${user.name} (${user.crmOrRegistry})`,
            revisado_em: now,
            decisao,
            observacao_auditor,
            destino_final:
              decisao === 'aprovado'
                ? destino_corrigido || 'Prontuario_Eletronico'
                : 'Devolucao_Origem_Reenvio',
          },
        };

        const targetPrefix: OciFolderPrefix =
          decisao === 'rejeitado'
            ? 'rejeitados'
            : updatedDoc.classificacao.nivel_prioridade === 'Urgente' ||
                updatedDoc.classificacao.nivel_prioridade === 'Emergência'
              ? 'processados/urgentes'
              : 'processados/rotina';

        const moved = await moveOciObject({
          sourceObjectPath: doc.armazenamento_oci.caminho_objeto,
          targetPrefix,
          updatedJsonContent: JSON.stringify(updatedDoc, null, 2),
          documentoId: docId,
        });

        updatedDoc.armazenamento_oci = {
          ...updatedDoc.armazenamento_oci,
          caminho_objeto: moved.objectPath,
          sha256_checksum: moved.sha256Checksum,
          tamanho_bytes: moved.sizeBytes,
          modo_integracao: moved.mode,
        };

        upsertDocument(updatedDoc);

        appendAuditLog({
          actor: user,
          ip: getClientIp(req),
          action: decisao === 'aprovado' ? 'HITL_APPROVED' : 'HITL_REJECTED',
          resourceId: docId,
          details: `Auditoria HITL ${decisao} -> ${moved.objectPath}. Obs: ${observacao_auditor}`,
        });

        res.json({
          document: applyLgpdMasking(updatedDoc, user.role, getRevealedSet(user.id)),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro ao registrar auditoria.';
        res.status(500).json({ error: message });
      }
    }
  );

  // ---------------- OCI OBJECT STORAGE (ISOLADO POR USUÁRIO) ----------------
  app.get('/api/oci/buckets', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const ownedDocIds = new Set(
      loadAllDocuments()
        .filter((d) => d.owner_id === user.id)
        .map((d) => d.documento_id)
    );
    const snapshot = listOciBucketObjects();
    const userObjects = snapshot.objects.filter((obj) => ownedDocIds.has(obj.documentoId));
    const countsByPrefix: Record<string, number> = {
      recebidos: 0,
      'processados/urgentes': 0,
      'processados/rotina': 0,
      auditoria_humana: 0,
      rejeitados: 0,
    };
    let totalBytesUsed = 0;
    for (const obj of userObjects) {
      countsByPrefix[obj.prefix] = (countsByPrefix[obj.prefix] || 0) + 1;
      totalBytesUsed += obj.sizeBytes;
    }
    res.json({
      config: snapshot.config,
      totalBytesUsed,
      countsByPrefix,
      objects: userObjects,
    });
  });

  app.get(
    '/api/oci/object',
    requireAuth,
    requireRole('ADMIN_GESTOR', 'AUDITOR_CLINICO'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const objectPath = typeof req.query.path === 'string' ? req.query.path : '';
      if (!objectPath) {
        res.status(400).json({ error: 'Parâmetro path obrigatório.' });
        return;
      }

      const ownedDocIds = new Set(
        loadAllDocuments()
          .filter((d) => d.owner_id === user.id)
          .map((d) => d.documento_id)
      );
      const snapshot = listOciBucketObjects();
      const targetMeta = snapshot.objects.find((o) => o.objectPath === objectPath);
      if (!targetMeta) {
        res.status(404).json({ error: 'Objeto não encontrado no bucket OCI.' });
        return;
      }
      if (!ownedDocIds.has(targetMeta.documentoId)) {
        appendAuditLog({
          actor: user,
          ip: getClientIp(req),
          action: 'SECURITY_BLOCK',
          resourceId: objectPath,
          details: `Leitura OCI Anti-IDOR bloqueada para objeto de outro usuário (${objectPath}).`,
        });
        res.status(403).json({
          error: 'Acesso bloqueado (Anti-IDOR): este objeto OCI pertence a outro usuário.',
        });
        return;
      }

      const verified = readAndVerifyOciObject(objectPath);
      if (!verified) {
        res.status(404).json({ error: 'Objeto não encontrado no bucket OCI.' });
        return;
      }
      res.json(verified);
    }
  );

  // ---------------- REGRAS CLÍNICAS CUSTOMIZÁVEIS ----------------
  app.get('/api/rules', requireAuth, (_req, res) => {
    res.json({ rules: loadRules() });
  });

  app.put(
    '/api/rules',
    requireAuth,
    requireRole('ADMIN_GESTOR'),
    (req: AuthenticatedRequest, res) => {
      const parsed = TriageRulesConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: 'Configuração de regras inválida.', details: parsed.error.flatten() });
        return;
      }
      if (parsed.data.alertWebhookUrl && !isSafeExternalWebhookUrl(parsed.data.alertWebhookUrl)) {
        res.status(400).json({
          error:
            'Webhook bloqueado pela proteção SSRF: informe uma URL HTTPS pública válida.',
        });
        return;
      }

      const saved = saveRules(parsed.data);
      appendAuditLog({
        actor: req.authUser!,
        ip: getClientIp(req),
        action: 'RULE_UPDATED',
        resourceId: 'triage-rules',
        details: `Regras atualizadas: limiar confiança=${saved.minConfidenceThreshold}, CRM obrigatório=${saved.requireCrmForPrescriptions}, alertas=${saved.enableRealTimeAlerts}`,
      });
      res.json({ rules: saved });
    }
  );

  // ---------------- ALERTAS EM TEMPO REAL (ISOLADOS POR USUÁRIO) ----------------
  app.get('/api/alerts', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const alerts = loadAllAlerts().filter((a) => a.owner_id === user.id);
    res.json({ alerts });
  });

  app.post(
    '/api/alerts/:id/ack',
    requireAuth,
    requireRole('ADMIN_GESTOR', 'AUDITOR_CLINICO'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const alerts = loadAllAlerts();
      const idx = alerts.findIndex((a) => a.id === req.params.id);
      if (idx < 0) {
        res.status(404).json({ error: 'Alerta não encontrado.' });
        return;
      }
      if (alerts[idx].owner_id !== user.id) {
        appendAuditLog({
          actor: user,
          ip: getClientIp(req),
          action: 'SECURITY_BLOCK',
          resourceId: String(req.params.id),
          details: `Tentativa Anti-IDOR de reconhecer alerta de outro usuário.`,
        });
        res.status(403).json({
          error: 'Acesso bloqueado (Anti-IDOR): este alerta pertence a outro usuário.',
        });
        return;
      }
      alerts[idx] = {
        ...alerts[idx],
        acknowledged: true,
        acknowledged_by: user.name,
        acknowledged_at: new Date().toISOString(),
      };
      saveAllAlerts(alerts);

      appendAuditLog({
        actor: user,
        ip: getClientIp(req),
        action: 'ALERT_ACKNOWLEDGED',
        resourceId: alerts[idx].id,
        details: `Alerta médico reconhecido para documento ${alerts[idx].documento_id}.`,
      });
      res.json({ alert: alerts[idx] });
    }
  );

  // ---------------- TRILHA DE AUDITORIA TAMPER-EVIDENT (ISOLADA POR USUÁRIO) ----------------
  app.get('/api/audit-logs', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const logs = getAuditLogs().filter((l) => l.actor_id === user.id);
    res.json({ logs });
  });

  app.get('/api/audit-logs/verify', requireAuth, (_req, res) => {
    res.json(verifyAuditChain());
  });

  // Tratador seguro em JSON para limites de upload do Multer ou erros inesperados
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: `Arquivo excede o limite máximo permitido (${Math.round(maxUploadBytes / (1024 * 1024))} MB).`,
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Erro interno do servidor.';
    res.status(500).json({ error: message });
  });

  return app;
}
