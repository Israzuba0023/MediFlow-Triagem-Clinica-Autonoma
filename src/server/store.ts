import fs from 'node:fs';
import path from 'node:path';
import type { SecurityAlert, TriageRecord, TriageRulesConfig } from '../shared/clinicalSchemas.ts';
import { decryptAtRest, encryptAtRest, getVaultDir, type EncryptedEnvelope } from './security.ts';

// Diretório do cofre cifrado (usa /tmp/.mediflow-vault em ambiente serverless como o Netlify)
const VAULT_DIR = getVaultDir();
const DOCS_FILE = path.join(VAULT_DIR, 'documents.enc.json');
const RULES_FILE = path.join(VAULT_DIR, 'rules.json');
const ALERTS_FILE = path.join(VAULT_DIR, 'alerts.enc.json');

// Regras clínicas padrão aplicadas na inicialização do sistema
export const DEFAULT_RULES: TriageRulesConfig = {
  minConfidenceThreshold: 0.78,
  requireCrmForPrescriptions: true,
  requirePatientName: true,
  urgencyKeywords: [
    'tep',
    'tromboembolismo',
    'embolia pulmonar',
    'infarto',
    'iam',
    'avc',
    'sepse',
    'choque',
    'parada cardiorrespiratoria',
    'pcr',
    'hemorragia',
    'dispneia subita',
    'urgente',
    'emergencia',
  ],
  criticalCidPrefixes: ['I26', 'I21', 'I63', 'I64', 'A41', 'R57', 'J96'],
  highRiskMedications: ['varfarina', 'heparina', 'enoxaparina', 'insulina', 'morfina', 'digoxina', 'metotrexato'],
  categoryRoutingMap: {
    'Receituário Médico': 'Farmacia_Hospitalar',
    'Laudo de Exame de Imagem': 'Prontuario_Eletronico',
    'Laudo de Exame Laboratorial': 'Prontuario_Eletronico',
    'Guia de Solicitação de Procedimento': 'Auditoria_Autorizacoes',
    'Relatório de Alta/Internação': 'Prontuario_Eletronico',
    'Atestado Médico': 'Gestao_Atestados_RH',
    'Outro Documento Clínico': 'Central_Triagem_Geral',
  },
  enableRealTimeAlerts: true,
  alertWebhookUrl: '',
  alertEmailRecipient: 'plantao.emergencia@hospital.med.br',
};

// Garante a criação do diretório do cofre com permissão restrita ao proprietário (0700)
function ensureDir(): void {
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadRules(): TriageRulesConfig {
  ensureDir();
  if (!fs.existsSync(RULES_FILE)) {
    fs.writeFileSync(RULES_FILE, JSON.stringify(DEFAULT_RULES, null, 2), { mode: 0o600 });
    return DEFAULT_RULES;
  }
  try {
    return JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')) as TriageRulesConfig;
  } catch {
    return DEFAULT_RULES;
  }
}

export function saveRules(rules: TriageRulesConfig): TriageRulesConfig {
  ensureDir();
  fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2), { mode: 0o600 });
  return rules;
}

// Carrega e descriptografa todos os documentos clínicos armazenados em repouso
export function loadAllDocuments(): TriageRecord[] {
  ensureDir();
  if (!fs.existsSync(DOCS_FILE)) return [];
  try {
    const envelope = JSON.parse(fs.readFileSync(DOCS_FILE, 'utf8')) as EncryptedEnvelope;
    const raw = decryptAtRest(envelope).toString('utf8');
    return JSON.parse(raw) as TriageRecord[];
  } catch {
    return [];
  }
}

// Cifra a lista de documentos com AES-256-GCM antes de gravar no disco
export function saveAllDocuments(docs: TriageRecord[]): void {
  ensureDir();
  const envelope = encryptAtRest(JSON.stringify(docs));
  fs.writeFileSync(DOCS_FILE, JSON.stringify(envelope), { mode: 0o600 });
}

export function upsertDocument(record: TriageRecord): void {
  const docs = loadAllDocuments();
  const idx = docs.findIndex((d) => d.documento_id === record.documento_id);
  if (idx >= 0) {
    docs[idx] = record;
  } else {
    docs.unshift(record);
  }
  saveAllDocuments(docs);
}

export function findDocumentById(documentoId: string): TriageRecord | undefined {
  return loadAllDocuments().find((d) => d.documento_id === documentoId);
}

// Carrega alertas de urgência e segurança do cofre cifrado
export function loadAllAlerts(): SecurityAlert[] {
  ensureDir();
  if (!fs.existsSync(ALERTS_FILE)) return [];
  try {
    const envelope = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8')) as EncryptedEnvelope;
    const raw = decryptAtRest(envelope).toString('utf8');
    return JSON.parse(raw) as SecurityAlert[];
  } catch {
    return [];
  }
}

export function saveAllAlerts(alerts: SecurityAlert[]): void {
  ensureDir();
  const envelope = encryptAtRest(JSON.stringify(alerts));
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(envelope), { mode: 0o600 });
}

export function addAlert(alert: SecurityAlert): void {
  const alerts = loadAllAlerts();
  alerts.unshift(alert);
  saveAllAlerts(alerts.slice(0, 200));
}
