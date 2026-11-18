import type {
  AuditLogEntry,
  AuthUser,
  SecurityAlert,
  TriageRecord,
  TriageRulesConfig,
  UserRole,
} from '../shared/clinicalSchemas';

// Armazenamento em sessão para fallback Bearer em iframes (complementa o cookie HttpOnly)
const TOKEN_STORAGE_KEY = 'mediflow_session_token';
let memorySessionToken: string | null = null;

export function setClientSessionToken(token: string | null): void {
  memorySessionToken = token;
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignora falhas de acesso ao sessionStorage em ambientes com cookies bloqueados
  }
}

export function getClientSessionToken(): string | null {
  if (memorySessionToken) return memorySessionToken;
  try {
    memorySessionToken = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    return memorySessionToken;
  } catch {
    return null;
  }
}

// Injeta o cabeçalho Authorization Bearer quando houver token ativo no cliente
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getClientSessionToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra ?? {}),
  };
}

// Padroniza a leitura JSON e propaga mensagens claras de erro do backend (ex.: 403 / 422)
async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (data as { error?: string }).error || `Erro HTTP ${res.status} na comunicação com o servidor.`;
    throw new Error(message);
  }
  return data as T;
}

export async function fetchCurrentUser(): Promise<{ authenticated: boolean; user?: AuthUser }> {
  const res = await fetch('/api/auth/me', {
    credentials: 'include',
    headers: authHeaders(),
  });
  if (res.status === 401) {
    setClientSessionToken(null);
    return { authenticated: false };
  }
  return parseJsonOrThrow(res);
}

export async function fetchOAuthProviders(): Promise<{
  googleConfigured: boolean;
  githubConfigured: boolean;
  demoEnabled?: boolean;
}> {
  const res = await fetch('/api/auth/oauth/providers', { credentials: 'include' });
  return parseJsonOrThrow(res);
}

export async function fetchOAuthUrl(provider: 'google' | 'github'): Promise<{ url: string }> {
  const res = await fetch(`/api/auth/oauth/${provider}/url`, { credentials: 'include' });
  return parseJsonOrThrow(res);
}

export async function loginDemoOAuth(
  provider: 'google' | 'github',
  role: UserRole = 'ADMIN_GESTOR',
  account?: { name?: string; email?: string }
): Promise<{ user: AuthUser; sessionToken: string }> {
  const res = await fetch('/api/auth/oauth/demo', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      role,
      name: account?.name,
      email: account?.email,
    }),
  });
  const data = await parseJsonOrThrow<{ user: AuthUser; sessionToken: string }>(res);
  setClientSessionToken(data.sessionToken);
  return data;
}

export async function loginUser(
  email: string,
  password: string
): Promise<{ user: AuthUser; sessionToken?: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseJsonOrThrow<{ user: AuthUser; sessionToken?: string }>(res);
  if (data.sessionToken) setClientSessionToken(data.sessionToken);
  return data;
}

export async function logoutUser(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(),
  });
  setClientSessionToken(null);
}

// --- Fluxo principal de ingestão e triagem multimodal ---

export async function processTriageDocument(params: {
  documento_id?: string;
  tipo_arquivo: 'PDF' | 'IMAGEM' | 'TEXTO' | 'JSON';
  documento_texto?: string;
  canal_origem: string;
  file?: File | null;
}): Promise<TriageRecord> {
  if (params.file) {
    const form = new FormData();
    if (params.documento_id) form.append('documento_id', params.documento_id);
    form.append('tipo_arquivo', params.tipo_arquivo);
    form.append('canal_origem', params.canal_origem);
    if (params.documento_texto) form.append('documento_texto', params.documento_texto);
    form.append('file', params.file);

    const res = await fetch('/api/triage/process', {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(),
      body: form,
    });
    return parseJsonOrThrow(res);
  }

  const res = await fetch('/api/triage/process', {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      documento_id: params.documento_id || undefined,
      tipo_arquivo: params.tipo_arquivo,
      documento_texto: params.documento_texto,
      canal_origem: params.canal_origem,
    }),
  });
  return parseJsonOrThrow(res);
}

export async function fetchDocuments(): Promise<{ documents: TriageRecord[] }> {
  const res = await fetch('/api/documents', {
    credentials: 'include',
    headers: authHeaders(),
  });
  return parseJsonOrThrow(res);
}

export async function revealDocumentPii(documentoId: string): Promise<{ document: TriageRecord }> {
  const res = await fetch(`/api/documents/${encodeURIComponent(documentoId)}/reveal`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(),
  });
  return parseJsonOrThrow(res);
}

export async function submitHumanAudit(
  documentoId: string,
  payload: {
    decisao: 'aprovado' | 'rejeitado';
    observacao_auditor: string;
    destino_corrigido?: string;
    dados_corrigidos?: {
      paciente_nome?: string;
      medico_nome?: string;
      medico_crm?: string;
      diagnostico_principal?: string;
      cid_sugerido?: string;
      nivel_prioridade?: 'Rotina' | 'Prioritário' | 'Urgente' | 'Emergência';
    };
  }
): Promise<{ document: TriageRecord }> {
  const res = await fetch(`/api/documents/${encodeURIComponent(documentoId)}/audit`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export interface OciBucketsResponse {
  config: {
    bucketName: string;
    namespace: string;
    region: string;
    remoteConfigured: boolean;
    integrationMode: string;
    alwaysFreeQuotaBytes: number;
  };
  totalBytesUsed: number;
  countsByPrefix: Record<string, number>;
  objects: Array<{
    bucket: string;
    objectPath: string;
    prefix: string;
    documentoId: string;
    contentType: string;
    sizeBytes: number;
    sha256Checksum: string;
    encryption: string;
    createdAt: string;
    remoteSynced: boolean;
  }>;
}

export async function fetchOciBuckets(): Promise<OciBucketsResponse> {
  const res = await fetch('/api/oci/buckets', {
    credentials: 'include',
    headers: authHeaders(),
  });
  return parseJsonOrThrow(res);
}

export async function verifyOciObject(objectPath: string): Promise<{
  validIntegrity: boolean;
  objectPath: string;
  sha256Checksum: string;
  decryptedPreview: string;
}> {
  const res = await fetch(`/api/oci/object?path=${encodeURIComponent(objectPath)}`, {
    credentials: 'include',
    headers: authHeaders(),
  });
  return parseJsonOrThrow(res);
}

export async function fetchRules(): Promise<{ rules: TriageRulesConfig }> {
  const res = await fetch('/api/rules', {
    credentials: 'include',
    headers: authHeaders(),
  });
  return parseJsonOrThrow(res);
}

export async function updateRules(rules: TriageRulesConfig): Promise<{ rules: TriageRulesConfig }> {
  const res = await fetch('/api/rules', {
    method: 'PUT',
    credentials: 'include',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(rules),
  });
  return parseJsonOrThrow(res);
}

export async function fetchAlerts(): Promise<{ alerts: SecurityAlert[] }> {
  const res = await fetch('/api/alerts', {
    credentials: 'include',
    headers: authHeaders(),
  });
  return parseJsonOrThrow(res);
}

export async function acknowledgeAlert(alertId: string): Promise<{ alert: SecurityAlert }> {
  const res = await fetch(`/api/alerts/${encodeURIComponent(alertId)}/ack`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(),
  });
  return parseJsonOrThrow(res);
}

export async function fetchAuditLogs(): Promise<{ logs: AuditLogEntry[] }> {
  const res = await fetch('/api/audit-logs', {
    credentials: 'include',
    headers: authHeaders(),
  });
  return parseJsonOrThrow(res);
}

export async function verifyAuditLogChain(): Promise<{
  valid: boolean;
  totalEntries: number;
  brokenAtSeq?: number;
  lastHash: string;
}> {
  const res = await fetch('/api/audit-logs/verify', {
    credentials: 'include',
    headers: authHeaders(),
  });
  return parseJsonOrThrow(res);
}
