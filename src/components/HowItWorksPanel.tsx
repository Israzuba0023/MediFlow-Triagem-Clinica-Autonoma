import React from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  FileSearch,
  Layers,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';

interface HowItWorksPanelProps {
  onGoToTriage: () => void;
}

const FLOW_PILLARS = [
  {
    step: '01',
    title: 'Receber',
    description: 'Documentos chegam ao fluxo de triagem e são organizados por status.',
  },
  {
    step: '02',
    title: 'Estruturar',
    description: 'Informações relevantes são preparadas para revisão em um formato claro.',
  },
  {
    step: '03',
    title: 'Revisar',
    description: 'Casos urgentes ou ambíguos são destacados para análise humana.',
  },
];

const TEST_STEPS = [
  {
    number: '1',
    icon: FileSearch,
    title: 'Escolha um cenário pronto ou envie um arquivo',
    description:
      'Na aba Triagem & Ingestão, clique em um dos 4 cenários pré-carregados (Urgência TEP Agudo, Rotina, Caso Ambíguo HITL ou Guia TISS/TUSS) ou arraste um PDF, imagem médica ou JSON.',
  },
  {
    number: '2',
    icon: Layers,
    title: 'Execute o agente autônomo de triagem',
    description:
      'Clique em Executar Triagem com IA. O servidor sanitiza o documento, aplica mascaramento LGPD em identificadores sensíveis, classifica o risco clínico e extrai campos estruturados validados por Zod.',
  },
  {
    number: '3',
    icon: CheckCircle2,
    title: 'Analise o roteamento e o cofre OCI',
    description:
      'O resultado mostra a justificativa clínica, o grafo de execução do agente, o JSON estruturado e o bucket de destino (processados/urgentes, processados/rotina ou auditoria_humana).',
  },
  {
    number: '4',
    icon: UserCheck,
    title: 'Teste a Auditoria Humana (HITL) e Segurança',
    description:
      'Documentos ambíguos ou com baixa confiança vão para Auditoria Humana para aprovação/rejeição. Perfis Gestor e Auditor podem revelar PII com registro criptográfico na cadeia SHA-256.',
  },
];

export const HowItWorksPanel: React.FC<HowItWorksPanelProps> = ({ onGoToTriage }) => {
  return (
    <div className="space-y-6">
      {/* Seção editorial de apresentação do fluxo responsável */}
      <section className="bg-[#f9faf9] border border-slate-200 rounded-xl p-6 sm:p-10">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-8 border-b border-slate-200">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-[#226d5a] mb-3">
              UM FLUXO, COM RESPONSABILIDADE
            </p>
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-[1.15]">
              Tecnologia que organiza.
              <br />
              Gente que decide.
            </h2>
          </div>

          <p className="text-xs sm:text-sm text-slate-600 max-w-sm leading-relaxed">
            O projeto propõe um fluxo rastreável para apoiar equipes — nunca substituir o
            julgamento clínico.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200 border-b border-slate-200">
          {FLOW_PILLARS.map((pillar) => (
            <div key={pillar.step} className="py-6 md:px-6 first:md:pl-0 last:md:pr-0">
              <p className="font-mono text-xs font-semibold text-[#226d5a] mb-3">
                {pillar.step}
              </p>
              <h3 className="text-base font-semibold text-slate-900 mb-2">{pillar.title}</h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                {pillar.description}
              </p>
            </div>
          ))}
        </div>

        <div className="pt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <ArrowUpRight className="w-3.5 h-3.5 text-[#226d5a] shrink-0" />
            <span>Texto enviado ao provedor após mascaramento local de identificadores.</span>
          </div>

          <button
            type="button"
            onClick={onGoToTriage}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#226d5a] hover:bg-[#1a5546] text-white text-xs font-medium transition-colors cursor-pointer self-start sm:self-auto"
          >
            <span>Testar na aba Triagem &amp; Ingestão</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      {/* Guia prático passo a passo para visitantes de primeira viagem */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-slate-900">
              Guia prático: como usar e testar a ferramenta
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Passo a passo rápido para visitantes e avaliadores experimentarem o MediFlow em menos
              de 1 minuto.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#226d5a]">
            <ShieldCheck className="w-4 h-4" />
            <span>Ambiente Seguro · LGPD &amp; AES-256-GCM</span>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {TEST_STEPS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.number}
                className="border border-slate-200 rounded-lg p-5 bg-slate-50/50 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-md bg-[#226d5a] text-white font-mono text-xs font-semibold flex items-center justify-center shrink-0">
                      {item.number}
                    </span>
                    <h4 className="text-sm font-semibold text-slate-900">{item.title}</h4>
                  </div>
                  <Icon className="w-4 h-4 text-[#226d5a] shrink-0" />
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{item.description}</p>
              </div>
            );
          })}
        </div>

        <div className="border-t border-slate-200 pt-5 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
            <p className="font-semibold text-slate-900">Urgência / Emergência</p>
            <p className="text-slate-600 mt-1">
              Roteamento prioritário para <span className="font-mono">processados/urgentes</span> e
              alerta imediato à equipe médica.
            </p>
          </div>
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
            <p className="font-semibold text-slate-900">Fluxo Padrão (Rotina)</p>
            <p className="text-slate-600 mt-1">
              Alta confiança e dados completos seguem automaticamente para{' '}
              <span className="font-mono">processados/rotina</span>.
            </p>
          </div>
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
            <p className="font-semibold text-slate-900">Auditoria Humana (HITL)</p>
            <p className="text-slate-600 mt-1">
              Baixa confiança ou dados críticos ausentes retêm o documento em{' '}
              <span className="font-mono">auditoria_humana</span>.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
