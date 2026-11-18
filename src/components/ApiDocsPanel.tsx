import React from 'react';
import { CheckCircle2, Code2, GitBranch } from 'lucide-react';

const REQUEST_EXAMPLE = `{
  "documento_id": "DOC-CLIN-2026-8942",
  "tipo_arquivo": "PDF",
  "documento_texto": "HOSPITAL SANTA LUCIA - LAUDO DE EXAME RADIOLOGICO. Paciente: Carlos Eduardo Mendes, 52 anos. Solicitante: Dra. Renata Silveira CRM-SP 145892. Exame: Tomografia de Torax com contraste. Indicacao: Suspeita de embolia pulmonar aguda, dispneia subita. Achados: Falha de enchimento em arteria pulmonar principal direita compativel com TEP agudo.",
  "canal_origem": "Pronto_Socorro"
}`;

const CHECKLIST_ITEMS = [
  'Ingestão funcional de documentos clínicos em texto, JSON, PDF ou imagem (com validação binária por magic bytes)',
  'Classificação automática multimodal com Google Gemini 4 Hydrogen e esquema estruturado estrito',
  'Extração de entidades clínicas essenciais (Paciente, CRM, CID-10, Medicamentos, Achados Críticos) validada via Zod',
  'Grafo de decisão condicional em 5 etapas com detecção de urgências e desvio automático para Human-in-the-Loop',
  'Integração OCI Object Storage Always Free com buckets segregados (/recebidos, /processados, /auditoria_humana) e criptografia AES-256-GCM',
  'Regras clínicas customizáveis, alertas em tempo real com proteção SSRF e trilha de auditoria SHA-256 tamper-evident',
];

export const ApiDocsPanel: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-2">
          <GitBranch className="w-4 h-4 text-teal-700" />
          <h2 className="text-base font-semibold text-slate-900">
            Arquitetura do Agente Autônomo &amp; Contrato REST API
          </h2>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed max-w-3xl">
          O MediFlow implementa um grafo de decisão condicional determinístico acoplado ao modelo
          multimodal Gemini, garantindo que documentos legíveis e completos sigam automaticamente
          para seus destinos clínicos enquanto casos ambíguos são retidos em segurança para auditoria
          humana.
        </p>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          {CHECKLIST_ITEMS.map((item) => (
            <div key={item} className="flex items-start gap-2.5 p-3 rounded-md border border-slate-200 bg-slate-50/40 text-xs text-slate-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <Code2 className="w-4 h-4 text-teal-700" />
            <h3 className="text-sm font-semibold text-slate-900">
              Endpoint Principal de Triagem Clínica
            </h3>
          </div>
          <p className="text-xs font-mono text-slate-800 bg-slate-100 px-3 py-2 rounded-md mb-3">
            POST /api/triage/process
          </p>
          <p className="text-xs text-slate-600 mb-3">
            Aceita <span className="font-mono">application/json</span> ou{' '}
            <span className="font-mono">multipart/form-data</span> (campo{' '}
            <span className="font-mono">file</span> em PDF, PNG, JPEG, WEBP ou JSON) mediante sessão
            autenticada via cookie HttpOnly.
          </p>
          <pre className="p-3.5 rounded-md border border-slate-200 bg-slate-50 text-xs font-mono text-slate-800 overflow-x-auto">
            {REQUEST_EXAMPLE}
          </pre>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            Topologia do Grafo de Decisão Condicional
          </h3>
          <div className="space-y-2.5 text-xs">
            <div className="p-3 rounded-md border border-slate-200 bg-slate-50/50">
              <span className="font-semibold text-slate-900">Nó 1 · Ingestão &amp; Sanitização</span>
              <p className="text-slate-600 mt-0.5">
                Validação de magic bytes, detector de prompt injection, hash SHA-256 e gravação
                criptografada em <span className="font-mono">/recebidos</span>.
              </p>
            </div>
            <div className="p-3 rounded-md border border-slate-200 bg-slate-50/50">
              <span className="font-semibold text-slate-900">Nó 2 · Visão &amp; NLP Multimodal</span>
              <p className="text-slate-600 mt-0.5">
                Classificação clínica e extração de entidades via Gemini 4 Hydrogen com schema
                JSON estrito.
              </p>
            </div>
            <div className="p-3 rounded-md border border-slate-200 bg-slate-50/50">
              <span className="font-semibold text-slate-900">Nó 3 · Validador Zod &amp; Regras</span>
              <p className="text-slate-600 mt-0.5">
                Audita completude (CRM, paciente), verifica medicamentos de alto risco, palavras-chave
                e prefixos CID-10 críticos.
              </p>
            </div>
            <div className="p-3 rounded-md border border-slate-200 bg-slate-50/50">
              <span className="font-semibold text-slate-900">Aresta Condicional · Roteamento OCI</span>
              <p className="text-slate-600 mt-0.5">
                Baixa confiança/conflito → <span className="font-mono">/auditoria_humana</span> ·
                Urgência → <span className="font-mono">/processados/urgentes</span> · Padrão →{' '}
                <span className="font-mono">/processados/rotina</span>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
