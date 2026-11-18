import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Database,
  GitBranch,
  ShieldAlert,
} from 'lucide-react';
import type { AgentTraceNode, TriageRecord } from '../shared/clinicalSchemas';

interface AgentGraphFlowProps {
  record: TriageRecord;
}

const NODE_ICONS: Record<AgentTraceNode['node_id'], React.ComponentType<{ className?: string }>> = {
  ingest_and_sanitize: ShieldAlert,
  multimodal_classify_and_extract: Cpu,
  clinical_consistency_validator: CheckCircle2,
  conditional_routing_edge: GitBranch,
  persist_oci_and_notify: Database,
};

export const AgentGraphFlow: React.FC<AgentGraphFlowProps> = ({ record }) => {
  const isHitl = record.decisao_roteamento.requer_auditoria_humana;
  const isUrgent =
    !isHitl &&
    (record.classificacao.nivel_prioridade === 'Urgente' ||
      record.classificacao.nivel_prioridade === 'Emergência');

  return (
    <div className="border border-slate-200 rounded-lg bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">
            Execução do Grafo de Decisão Condicional
          </h4>
          <p className="text-xs text-slate-500">
            Rastreabilidade nó a nó do agente autônomo · {record.grafo_execucao.length} etapas
          </p>
        </div>
        <div className="text-xs font-mono tabular-nums text-slate-600">
          Tempo total:{' '}
          {record.grafo_execucao.reduce((sum, n) => sum + n.duration_ms, 0)} ms
        </div>
      </div>

      {/* Nós sequenciais do grafo de decisão */}
      <div className="space-y-2.5">
        {record.grafo_execucao.map((node, index) => {
          const Icon = NODE_ICONS[node.node_id] || Cpu;
          const isFlagged = node.status === 'flagged';
          return (
            <div
              key={node.node_id}
              className={`flex items-start gap-3 p-3 rounded-lg border ${
                isFlagged
                  ? 'border-amber-200 bg-amber-50/40'
                  : 'border-slate-200 bg-slate-50/50'
              }`}
            >
              <div
                className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
                  isFlagged ? 'bg-amber-100 text-amber-800' : 'bg-teal-50 text-teal-800'
                }`}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900">
                    {index + 1}. {node.label}
                  </span>
                  <span className="text-xs font-mono tabular-nums text-slate-500 shrink-0">
                    {node.duration_ms} ms
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{node.summary}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Resumo dos ramos condicionais de roteamento */}
      <div className="mt-4 pt-3 border-t border-slate-200">
        <p className="text-xs font-medium text-slate-600 mb-2">
          Ramificação condicional selecionada
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <div
            className={`p-2.5 rounded-md border flex items-center gap-2 ${
              isUrgent
                ? 'border-red-300 bg-red-50 text-red-900 font-semibold'
                : 'border-slate-200 bg-white text-slate-400'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Ramo Urgência Médica</span>
          </div>
          <div
            className={`p-2.5 rounded-md border flex items-center gap-2 ${
              isHitl
                ? 'border-amber-300 bg-amber-50 text-amber-900 font-semibold'
                : 'border-slate-200 bg-white text-slate-400'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Ramo Auditoria HITL</span>
          </div>
          <div
            className={`p-2.5 rounded-md border flex items-center gap-2 ${
              !isUrgent && !isHitl
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900 font-semibold'
                : 'border-slate-200 bg-white text-slate-400'
            }`}
          >
            <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Ramo Rotina Automática</span>
          </div>
        </div>
      </div>
    </div>
  );
};
