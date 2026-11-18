import { z } from 'zod';

// Perfis de controle de acesso baseado em papéis (RBAC)
export type UserRole = 'ADMIN_GESTOR' | 'AUDITOR_CLINICO' | 'OPERADOR_TRIAGEM';

// Representação pública do usuário autenticado (sessão local ou OAuth Google/GitHub)
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  crmOrRegistry: string;
  provider?: 'local' | 'google' | 'github';
  avatarUrl?: string;
}

export type DocumentCategory =
  | 'Receituário Médico'
  | 'Laudo de Exame de Imagem'
  | 'Laudo de Exame Laboratorial'
  | 'Guia de Solicitação de Procedimento'
  | 'Relatório de Alta/Internação'
  | 'Atestado Médico'
  | 'Outro Documento Clínico';

export type PriorityLevel = 'Rotina' | 'Prioritário' | 'Urgente' | 'Emergência';

export type TriageStatus =
  | 'processado'
  | 'auditoria_humana'
  | 'aprovado_auditoria'
  | 'rejeitado_auditoria';

// Contrato validado pelo servidor para requisições de ingestão e triagem clínica
export const TriageRequestSchema = z.object({
  documento_id: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/, 'ID do documento deve conter apenas letras, números, hífen ou underscore.')
    .optional(),
  tipo_arquivo: z.enum(['PDF', 'IMAGEM', 'TEXTO', 'JSON']).default('TEXTO'),
  documento_texto: z.string().trim().max(60000).optional(),
  canal_origem: z.string().trim().min(2).max(80).default('Portal_Web'),
});

export const MedicationSchema = z.object({
  nome: z.string(),
  dosagem: z.string().nullable().optional(),
  posologia: z.string().nullable().optional(),
  alto_risco: z.boolean().default(false),
});

// Schema estrito validado após a resposta do modelo multimodal Gemini
export const ClinicalExtractionOutputSchema = z.object({
  classificacao: z.object({
    tipo_documento: z.enum([
      'Receituário Médico',
      'Laudo de Exame de Imagem',
      'Laudo de Exame Laboratorial',
      'Guia de Solicitação de Procedimento',
      'Relatório de Alta/Internação',
      'Atestado Médico',
      'Outro Documento Clínico',
    ]),
    especialidade: z.string().min(2),
    nivel_prioridade: z.enum(['Rotina', 'Prioritário', 'Urgente', 'Emergência']),
    score_confianca_classificacao: z.number().min(0).max(1),
  }),
  dados_extraidos: z.object({
    paciente: z.object({
      nome: z.string().nullable(),
      idade: z.number().int().min(0).max(130).nullable().optional(),
      documento_identificacao: z.string().nullable().optional(),
    }),
    medico_solicitante: z.object({
      nome: z.string().nullable(),
      crm: z.string().nullable(),
    }),
    exame_realizado: z.string().nullable().optional(),
    procedimentos_solicitados: z.array(z.string()).optional().default([]),
    medicamentos_prescritos: z.array(MedicationSchema).optional().default([]),
    diagnostico_principal: z.string().nullable(),
    cid_sugerido: z.string().nullable().optional(),
    achados_criticos: z.array(z.string()).optional().default([]),
    observacoes_clinicas: z.string().nullable().optional(),
  }),
  avaliacao_qualidade: z.object({
    legibilidade_score: z.number().min(0).max(1),
    dados_faltantes: z.array(z.string()).default([]),
    conflitos_ou_ambiguidades: z.array(z.string()).default([]),
    indicadores_urgencia_detectados: z.array(z.string()).default([]),
    justificativa_clinica: z.string(),
  }),
});

export type ClinicalExtractionOutput = z.infer<typeof ClinicalExtractionOutputSchema>;

// Nó individual de rastreabilidade do grafo de decisão autônomo
export interface AgentTraceNode {
  node_id:
    | 'ingest_and_sanitize'
    | 'multimodal_classify_and_extract'
    | 'clinical_consistency_validator'
    | 'conditional_routing_edge'
    | 'persist_oci_and_notify';
  label: string;
  status: 'completed' | 'flagged' | 'failed';
  duration_ms: number;
  summary: string;
  timestamp: string;
}

// Registro completo de triagem persistido no cofre criptografado e isolado por proprietário (owner_id)
export interface TriageRecord {
  status: TriageStatus;
  documento_id: string;
  tipo_arquivo: string;
  canal_origem: string;
  created_at: string;
  updated_at: string;
  submitted_by: string;
  owner_id?: string;
  classificacao: {
    tipo_documento: DocumentCategory;
    especialidade: string;
    nivel_prioridade: PriorityLevel;
    score_confianca_classificacao: number;
  };
  dados_extraidos: {
    paciente: {
      nome: string | null;
      idade?: number | null;
      documento_identificacao?: string | null;
    };
    medico_solicitante: {
      nome: string | null;
      crm: string | null;
    };
    exame_realizado?: string | null;
    procedimentos_solicitados?: string[];
    medicamentos_prescritos?: Array<{
      nome: string;
      dosagem?: string | null;
      posologia?: string | null;
      alto_risco?: boolean;
    }>;
    diagnostico_principal: string | null;
    cid_sugerido?: string | null;
    achados_criticos?: string[];
    observacoes_clinicas?: string | null;
  };
  avaliacao_consistencia: {
    score_confianca_final: number;
    legibilidade_score: number;
    dados_faltantes: string[];
    conflitos_detectados: string[];
    regras_acionadas: string[];
    prompt_injection_detectado: boolean;
  };
  decisao_roteamento: {
    destino_principal: string;
    requer_auditoria_humana: boolean;
    justificativa_roteamento: string;
    notificacao_gerada: {
      canal: string;
      mensagem: string;
      prioridade: 'normal' | 'alta' | 'critica';
    };
  };
  armazenamento_oci: {
    bucket: string;
    caminho_objeto: string;
    caminho_bruto_recebido: string;
    status_backup: 'sucesso' | 'erro';
    modo_integracao: 'oci_remoto_sincronizado' | 'cofre_oci_always_free';
    sha256_checksum: string;
    criptografia: 'AES-256-GCM';
    tamanho_bytes: number;
  };
  grafo_execucao: AgentTraceNode[];
  auditoria_humana?: {
    revisado_por: string;
    revisado_em: string;
    decisao: 'aprovado' | 'rejeitado';
    observacao_auditor: string;
    destino_final: string;
  };
  pii_mascarado?: boolean;
  raw_preview?: string;
}

// Configuração dinâmica das regras clínicas e destinos de roteamento
export const TriageRulesConfigSchema = z.object({
  minConfidenceThreshold: z.number().min(0.4).max(0.98),
  requireCrmForPrescriptions: z.boolean(),
  requirePatientName: z.boolean(),
  urgencyKeywords: z.array(z.string().min(2)).min(1),
  criticalCidPrefixes: z.array(z.string().min(2)).min(1),
  highRiskMedications: z.array(z.string().min(2)),
  categoryRoutingMap: z.record(z.string(), z.string()),
  enableRealTimeAlerts: z.boolean(),
  alertWebhookUrl: z.string().max(500).optional().default(''),
  alertEmailRecipient: z.string().max(200).optional().default('plantao.emergencia@hospital.med.br'),
});

export type TriageRulesConfig = z.infer<typeof TriageRulesConfigSchema>;

// Decisão registrada pelo auditor médico humano (HITL)
export const HumanAuditDecisionSchema = z.object({
  decisao: z.enum(['aprovado', 'rejeitado']),
  observacao_auditor: z.string().trim().min(3).max(1000),
  destino_corrigido: z.string().trim().min(2).max(100).optional(),
  dados_corrigidos: z
    .object({
      paciente_nome: z.string().trim().max(200).optional(),
      medico_nome: z.string().trim().max(200).optional(),
      medico_crm: z.string().trim().max(60).optional(),
      diagnostico_principal: z.string().trim().max(300).optional(),
      cid_sugerido: z.string().trim().max(20).optional(),
      nivel_prioridade: z.enum(['Rotina', 'Prioritário', 'Urgente', 'Emergência']).optional(),
    })
    .optional(),
});

// Alerta de urgência médica, revisão HITL ou tentativa de intrusão
export interface SecurityAlert {
  id: string;
  documento_id: string;
  owner_id?: string;
  tipo: 'URGENCIA_MEDICA' | 'AUDITORIA_HITL' | 'SEGURANCA_INJECTION';
  canal: string;
  destino: string;
  mensagem: string;
  created_at: string;
  webhook_dispatched: boolean;
  acknowledged: boolean;
  acknowledged_by?: string;
  acknowledged_at?: string;
}

// Registro encadeado via SHA-256 na trilha de auditoria imutável
export interface AuditLogEntry {
  seq: number;
  id: string;
  timestamp: string;
  actor_id: string;
  actor_email: string;
  actor_role: UserRole;
  ip_address: string;
  action:
    | 'LOGIN_SUCCESS'
    | 'LOGIN_FAILED'
    | 'LOGOUT'
    | 'DOCUMENT_INGESTED'
    | 'PII_UNMASKED'
    | 'HITL_APPROVED'
    | 'HITL_REJECTED'
    | 'RULE_UPDATED'
    | 'ALERT_ACKNOWLEDGED'
    | 'SECURITY_BLOCK';
  resource_id: string;
  details: string;
  prev_hash: string;
  entry_hash: string;
}

export interface SampleScenario {
  id: string;
  title: string;
  categoryLabel: string;
  expectedBranch: 'urgencia' | 'rotina' | 'auditoria_humana';
  documento_id: string;
  tipo_arquivo: 'PDF' | 'TEXTO' | 'JSON';
  canal_origem: string;
  documento_texto: string;
}

// Cenários pré-configurados para demonstração rápida dos 4 ramos do agente
export const SAMPLE_SCENARIOS: SampleScenario[] = [
  {
    id: 'urgencia-tep',
    title: '1. Urgência Médica (TEP Agudo)',
    categoryLabel: 'Caso crítico · Pronto-Socorro',
    expectedBranch: 'urgencia',
    documento_id: 'DOC-CLIN-2026-8942',
    tipo_arquivo: 'PDF',
    canal_origem: 'Pronto_Socorro',
    documento_texto:
      'HOSPITAL SANTA LUCIA - LAUDO DE EXAME RADIOLOGICO. Paciente: Carlos Eduardo Mendes, 52 anos. Solicitante: Dra. Renata Silveira CRM-SP 145892. Exame: Tomografia de Torax com contraste. Indicacao: Suspeita de embolia pulmonar aguda, dispneia subita. Achados: Falha de enchimento em arteria pulmonar principal direita compativel com TEP agudo. CONCLUSÃO: Quadro compativel com Tromboembolismo Pulmonar Agudo. Sugere-se correlacao clinica urgente.',
  },
  {
    id: 'rotina-receita',
    title: '2. Fluxo Padrão Aprovado (Rotina)',
    categoryLabel: 'Receituário completo · Ambulatório',
    expectedBranch: 'rotina',
    documento_id: 'DOC-CLIN-2026-9015',
    tipo_arquivo: 'TEXTO',
    canal_origem: 'Ambulatorio_Endocrino',
    documento_texto:
      'CLINICA MEDICA INTEGRA - RECEITUARIO MEDICO. Paciente: Mariana Costa Ferreira, 44 anos. CPF: 389.412.770-19. Medico Prescritor: Dr. Henrique Almeida Nogueira, CRM-RJ 5298140. Diagnostico: Diabetes Mellitus Tipo 2 compensado (CID-10: E11.9). Prescricao: 1) Cloridrato de Metformina 850 mg - Tomar 1 comprimido via oral apos o jantar, uso continuo. 2) Rosuvastatina 10 mg - Tomar 1 comprimido a noite. Retorno ambulatorial em 90 dias com hemoglobina glicada.',
  },
  {
    id: 'ambiguo-hitl',
    title: '3. Caso Ambíguo (Auditoria Humana)',
    categoryLabel: 'Dados faltantes e dosagem incerta',
    expectedBranch: 'auditoria_humana',
    documento_id: 'DOC-CLIN-2026-9088',
    tipo_arquivo: 'PDF',
    canal_origem: 'Upload_Scanner_Recepcao',
    documento_texto:
      'RECEITA DIGITALIZADA (OCR PARCIAL / CALIGRAFIA ILEGIVEL). Paciente: Joao [SOBRENOME ILEGIVEL], idade nao informada. Prescricao: Varfarina [rasura: 5mg ou 50mg??] tomar 1x ao dia + Amoxicilina ??? mg se febre. Carimbo medico borrado, CRM nao legivel na digitalizacao. Assinatura sem identificacao clara.',
  },
  {
    id: 'guia-tiss',
    title: '4. Guia TISS/TUSS (Autorização)',
    categoryLabel: 'Procedimento eletivo · Convênio',
    expectedBranch: 'rotina',
    documento_id: 'DOC-CLIN-2026-9120',
    tipo_arquivo: 'JSON',
    canal_origem: 'Portal_Operadora_TISS',
    documento_texto: JSON.stringify(
      {
        guia_tiss: 'SP/SADT-2026-00481',
        paciente: { nome: 'Roberto Augusto Lima', idade: 61 },
        medico_solicitante: { nome: 'Dr. Felipe Moraes', crm: 'CRM-MG 61204' },
        procedimento_tuss: '40901114 - Ecocardiograma Transtoracico com Doppler',
        indicacao_clinica: 'Avaliacao de rotina pre-operatoria de colecistectomia eletiva',
        cid10: 'K80.2',
        carater_atendimento: 'Eletivo',
      },
      null,
      2
    ),
  },
];
