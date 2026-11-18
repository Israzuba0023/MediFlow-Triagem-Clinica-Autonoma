import React, { useEffect, useState } from 'react';
import { CheckCircle2, Eye, Lock, ShieldAlert, XCircle } from 'lucide-react';
import { revealDocumentPii, submitHumanAudit } from '../lib/api';
import type { AuthUser, TriageRecord } from '../shared/clinicalSchemas';

interface HumanAuditPanelProps {
  user: AuthUser;
  documents: TriageRecord[];
  onDocumentUpdated: (doc: TriageRecord) => void;
}

export const HumanAuditPanel: React.FC<HumanAuditPanelProps> = ({
  user,
  documents,
  onDocumentUpdated,
}) => {
  const pendingDocs = documents.filter((d) => d.status === 'auditoria_humana');
  const reviewedDocs = documents.filter(
    (d) => d.status === 'aprovado_auditoria' || d.status === 'rejeitado_auditoria'
  );

  const [selectedId, setSelectedId] = useState<string | null>(
    pendingDocs[0]?.documento_id ?? null
  );
  const selected =
    pendingDocs.find((d) => d.documento_id === selectedId) ?? pendingDocs[0] ?? null;

  const [patientName, setPatientName] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [doctorCrm, setDoctorCrm] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [cid, setCid] = useState('');
  const [priority, setPriority] = useState<'Rotina' | 'Prioritário' | 'Urgente' | 'Emergência'>(
    'Rotina'
  );
  const [destination, setDestination] = useState('Farmacia_Hospitalar');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (selected) {
      setPatientName(
        selected.pii_mascarado ? '' : selected.dados_extraidos.paciente.nome ?? ''
      );
      setDoctorName(selected.dados_extraidos.medico_solicitante.nome ?? '');
      setDoctorCrm(selected.dados_extraidos.medico_solicitante.crm ?? '');
      setDiagnosis(selected.dados_extraidos.diagnostico_principal ?? '');
      setCid(selected.dados_extraidos.cid_sugerido ?? '');
      setPriority(selected.classificacao.nivel_prioridade);
      setDestination(
        selected.classificacao.tipo_documento === 'Receituário Médico'
          ? 'Farmacia_Hospitalar'
          : 'Prontuario_Eletronico'
      );
      setNotes('');
      setError(null);
    }
  }, [selected?.documento_id, selected?.pii_mascarado]);

  const canAudit = user.role === 'ADMIN_GESTOR' || user.role === 'AUDITOR_CLINICO';

  const handleReveal = async (docId: string) => {
    setError(null);
    try {
      const { document } = await revealDocumentPii(docId);
      onDocumentUpdated(document);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao revelar PII.');
    }
  };

  const handleDecision = async (decisao: 'aprovado' | 'rejeitado') => {
    if (!selected) return;
    if (notes.trim().length < 3) {
      setError('Informe uma justificativa clínica da auditoria (mínimo 3 caracteres).');
      return;
    }
    setError(null);
    setSuccessMsg(null);
    setSubmitting(true);
    try {
      const { document } = await submitHumanAudit(selected.documento_id, {
        decisao,
        observacao_auditor: notes.trim(),
        destino_corrigido: destination,
        dados_corrigidos: {
          paciente_nome: patientName.trim() || undefined,
          medico_nome: doctorName.trim() || undefined,
          medico_crm: doctorCrm.trim() || undefined,
          diagnostico_principal: diagnosis.trim() || undefined,
          cid_sugerido: cid.trim() || undefined,
          nivel_prioridade: priority,
        },
      });
      onDocumentUpdated(document);
      setSuccessMsg(
        `Documento ${document.documento_id} ${decisao === 'aprovado' ? 'aprovado e movido' : 'rejeitado e movido'} no OCI Object Storage para ${document.armazenamento_oci.caminho_objeto}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao registrar decisão.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Painel de Auditoria Clínica Human-in-the-Loop (HITL)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Documentos com baixa confiabilidade, dados faltantes ou conflitos clínicos aguardando
              validação antes do roteamento final.
            </p>
          </div>
          <div className="text-xs font-mono tabular-nums text-slate-700">
            Pendentes: <span className="font-bold text-amber-800">{pendingDocs.length}</span>
            {' · '}
            Auditados: <span className="font-bold text-emerald-700">{reviewedDocs.length}</span>
          </div>
        </div>
      </div>

      {!canAudit && (
        <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900 flex items-center gap-2.5">
          <Lock className="w-4 h-4 shrink-0" />
          <span>
            Modo somente leitura: o perfil <span className="font-mono font-semibold">{user.role}</span> não
            possui permissão RBAC para aprovar ou rejeitar auditorias clínicas. Utilize uma conta
            AUDITOR_CLINICO ou ADMIN_GESTOR.
          </span>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs text-emerald-900">
          {successMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Fila de documentos pendentes em auditoria humana */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
            <h3 className="text-xs font-semibold text-slate-800">
              Fila em /auditoria_humana ({pendingDocs.length})
            </h3>
          </div>
          {pendingDocs.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              Nenhum documento pendente de auditoria humana no momento.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {pendingDocs.map((doc) => {
                const active = selected?.documento_id === doc.documento_id;
                return (
                  <button
                    key={doc.documento_id}
                    type="button"
                    onClick={() => setSelectedId(doc.documento_id)}
                    className={`w-full text-left p-3.5 transition-colors cursor-pointer ${
                      active ? 'bg-teal-50/50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono font-semibold text-slate-900">
                        {doc.documento_id}
                      </span>
                      <span className="text-xs font-mono tabular-nums text-amber-800 font-semibold">
                        {(doc.avaliacao_consistencia.score_confianca_final * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 mt-1">{doc.classificacao.tipo_documento}</p>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {doc.decisao_roteamento.justificativa_roteamento}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Bancada de revisão clínica e correção assistida */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg p-5">
          {!selected ? (
            <div className="py-12 text-center text-xs text-slate-500">
              Selecione um documento pendente na fila ao lado para revisar ou processe o cenário 3
              (Caso Ambíguo) na aba de Triagem.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div>
                  <span className="text-xs font-mono text-slate-500">{selected.documento_id}</span>
                  <h3 className="text-base font-bold text-slate-900">
                    Revisão Clínica Assistida · {selected.classificacao.tipo_documento}
                  </h3>
                </div>
                {canAudit && selected.pii_mascarado && (
                  <button
                    type="button"
                    onClick={() => handleReveal(selected.documento_id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5 text-teal-700" />
                    <span>Revelar Dados Originais (Auditado)</span>
                  </button>
                )}
              </div>

              {/* Alertas e justificativas geradas pelo agente */}
              <div className="p-3.5 rounded-md border border-amber-200 bg-amber-50/50 text-xs text-amber-950 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold">
                  <ShieldAlert className="w-4 h-4 text-amber-700" />
                  <span>Motivos do encaminhamento para auditoria humana</span>
                </div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {selected.avaliacao_consistencia.dados_faltantes.map((m, i) => (
                    <li key={`df-${i}`}>{m}</li>
                  ))}
                  {selected.avaliacao_consistencia.conflitos_detectados.map((c, i) => (
                    <li key={`cf-${i}`}>{c}</li>
                  ))}
                </ul>
              </div>

              {selected.raw_preview && (
                <div>
                  <p className="text-xs font-medium text-slate-700 mb-1">
                    Texto / Conteúdo Ingerido
                  </p>
                  <pre className="p-3 rounded-md border border-slate-200 bg-slate-50 text-xs font-mono text-slate-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {selected.raw_preview}
                  </pre>
                </div>
              )}

              {/* Campos editáveis para correção e confirmação médica */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Paciente (Correção / Confirmação)
                  </label>
                  <input
                    type="text"
                    disabled={!canAudit}
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    placeholder={selected.dados_extraidos.paciente.nome || 'Informar nome completo'}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    CRM do Médico Solicitante
                  </label>
                  <input
                    type="text"
                    disabled={!canAudit}
                    value={doctorCrm}
                    onChange={(e) => setDoctorCrm(e.target.value)}
                    placeholder="Ex: CRM-SP 145892"
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nome do Médico
                  </label>
                  <input
                    type="text"
                    disabled={!canAudit}
                    value={doctorName}
                    onChange={(e) => setDoctorName(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    CID-10 / Diagnóstico
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      disabled={!canAudit}
                      value={cid}
                      onChange={(e) => setCid(e.target.value)}
                      placeholder="CID"
                      className="w-24 px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-md disabled:bg-slate-50"
                    />
                    <input
                      type="text"
                      disabled={!canAudit}
                      value={diagnosis}
                      onChange={(e) => setDiagnosis(e.target.value)}
                      placeholder="Diagnóstico principal"
                      className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-md disabled:bg-slate-50"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Prioridade Validada
                  </label>
                  <select
                    disabled={!canAudit}
                    value={priority}
                    onChange={(e) =>
                      setPriority(
                        e.target.value as 'Rotina' | 'Prioritário' | 'Urgente' | 'Emergência'
                      )
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white disabled:bg-slate-50"
                  >
                    <option value="Rotina">Rotina</option>
                    <option value="Prioritário">Prioritário</option>
                    <option value="Urgente">Urgente</option>
                    <option value="Emergência">Emergência</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Destino de Roteamento Final
                  </label>
                  <select
                    disabled={!canAudit}
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md bg-white disabled:bg-slate-50"
                  >
                    <option value="Farmacia_Hospitalar">Farmacia_Hospitalar</option>
                    <option value="Prontuario_Eletronico">Prontuario_Eletronico</option>
                    <option value="Auditoria_Autorizacoes">Auditoria_Autorizacoes</option>
                    <option value="Fila_Emergencia_Medica">Fila_Emergencia_Medica</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Parecer do Auditor Clínico (Obrigatório para trilha imutável)
                </label>
                <textarea
                  rows={2}
                  disabled={!canAudit}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Descreva a validação realizada ou o motivo da rejeição/devolução..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md disabled:bg-slate-50"
                />
              </div>

              {error && (
                <div className="p-3 rounded-md border border-red-200 bg-red-50 text-xs text-red-700">
                  {error}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  disabled={!canAudit || submitting}
                  onClick={() => handleDecision('aprovado')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Aprovar e Rotear para Destino</span>
                </button>
                <button
                  type="button"
                  disabled={!canAudit || submitting}
                  onClick={() => handleDecision('rejeitado')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-red-300 bg-white hover:bg-red-50 disabled:opacity-50 text-red-700 text-xs font-medium cursor-pointer"
                >
                  <XCircle className="w-4 h-4" />
                  <span>Rejeitar e Devolver Origem</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Histórico recente de auditorias concluídas */}
      {reviewedDocs.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
            <h3 className="text-xs font-semibold text-slate-800">
              Auditoria Concluída ({reviewedDocs.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-200 text-xs">
            {reviewedDocs.map((doc) => (
              <div key={doc.documento_id} className="p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="font-mono font-semibold text-slate-900">{doc.documento_id}</span>
                  <span className="mx-2 text-slate-300">·</span>
                  <span className="text-slate-700">{doc.auditoria_humana?.revisado_por}</span>
                  <p className="text-slate-500 mt-0.5">{doc.auditoria_humana?.observacao_auditor}</p>
                </div>
                <div className="text-right">
                  <span
                    className={`font-semibold ${
                      doc.auditoria_humana?.decisao === 'aprovado'
                        ? 'text-emerald-700'
                        : 'text-red-700'
                    }`}
                  >
                    {doc.auditoria_humana?.decisao === 'aprovado' ? 'Aprovado' : 'Rejeitado'}
                  </span>
                  <div className="font-mono text-slate-500 mt-0.5">
                    {doc.armazenamento_oci.caminho_objeto}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
