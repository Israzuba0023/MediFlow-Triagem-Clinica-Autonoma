import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Download,
  Eye,
  FileText,
  FileUp,
  Lock,
  Search,
  Send,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { processTriageDocument, revealDocumentPii } from '../lib/api';
import {
  SAMPLE_SCENARIOS,
  type AuthUser,
  type SampleScenario,
  type TriageRecord,
} from '../shared/clinicalSchemas';
import { AgentGraphFlow } from './AgentGraphFlow';

interface TriageWorkspaceProps {
  user: AuthUser;
  documents: TriageRecord[];
  selectedDoc: TriageRecord | null;
  onSelectDoc: (doc: TriageRecord) => void;
  onDocumentProcessed: (doc: TriageRecord) => void;
  onDocumentUpdated: (doc: TriageRecord) => void;
  focusInputSignal?: number;
}

export const TriageWorkspace: React.FC<TriageWorkspaceProps> = ({
  user,
  documents,
  selectedDoc,
  onSelectDoc,
  onDocumentProcessed,
  onDocumentUpdated,
}) => {
  const [documentoId, setDocumentoId] = useState('');
  const [tipoArquivo, setTipoArquivo] = useState<'PDF' | 'IMAGEM' | 'TEXTO' | 'JSON'>('TEXTO');
  const [canalOrigem, setCanalOrigem] = useState('Pronto_Socorro');
  const [documentoTexto, setDocumentoTexto] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);
  const [resultTab, setResultTab] = useState<'resumo' | 'grafo' | 'json'>('resumo');

  // Filtros do histórico de documentos triados
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'urgente' | 'auditoria' | 'rotina'>(
    'todos'
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stats = useMemo(() => {
    const total = documents.length;
    const urgentes = documents.filter(
      (d) =>
        d.classificacao.nivel_prioridade === 'Urgente' ||
        d.classificacao.nivel_prioridade === 'Emergência'
    ).length;
    const hitl = documents.filter((d) => d.status === 'auditoria_humana').length;
    const avgConfidence =
      total > 0
        ? (
            documents.reduce((acc, d) => acc + d.avaliacao_consistencia.score_confianca_final, 0) /
            total
          ).toFixed(2)
        : '—';
    return { total, urgentes, hitl, avgConfidence };
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      if (statusFilter === 'urgente') {
        const isUrg =
          doc.classificacao.nivel_prioridade === 'Urgente' ||
          doc.classificacao.nivel_prioridade === 'Emergência';
        if (!isUrg) return false;
      } else if (statusFilter === 'auditoria') {
        if (doc.status !== 'auditoria_humana') return false;
      } else if (statusFilter === 'rotina') {
        if (doc.status === 'auditoria_humana') return false;
      }

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        doc.documento_id.toLowerCase().includes(q) ||
        doc.classificacao.tipo_documento.toLowerCase().includes(q) ||
        (doc.dados_extraidos.paciente.nome ?? '').toLowerCase().includes(q) ||
        (doc.dados_extraidos.diagnostico_principal ?? '').toLowerCase().includes(q) ||
        doc.decisao_roteamento.destino_principal.toLowerCase().includes(q)
      );
    });
  }, [documents, searchQuery, statusFilter]);

  const loadScenario = (scenario: SampleScenario) => {
    setDocumentoId(scenario.documento_id);
    setTipoArquivo(scenario.tipo_arquivo);
    setCanalOrigem(scenario.canal_origem);
    setDocumentoTexto(scenario.documento_texto);
    setSelectedFile(null);
    setError(null);
  };

  const handleFilePick = (file: File | null) => {
    if (!file) return;
    setSelectedFile(file);
    setError(null);
    const lower = file.name.toLowerCase();
    if (file.type === 'application/pdf' || lower.endsWith('.pdf')) {
      setTipoArquivo('PDF');
    } else if (
      file.type.startsWith('image/') ||
      /\.(png|jpe?g|webp|gif|svg)$/i.test(lower)
    ) {
      setTipoArquivo('IMAGEM');
    } else if (file.type.includes('json') || lower.endsWith('.json')) {
      setTipoArquivo('JSON');
    } else {
      setTipoArquivo('TEXTO');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const processed = await processTriageDocument({
        documento_id: documentoId.trim() || undefined,
        tipo_arquivo: tipoArquivo,
        documento_texto: documentoTexto.trim() || undefined,
        canal_origem: canalOrigem,
        file: selectedFile,
      });
      onDocumentProcessed(processed);
      onSelectDoc(processed);
      setResultTab('resumo');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao executar triagem.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevealPii = async (docId: string) => {
    setRevealing(true);
    setError(null);
    try {
      const { document } = await revealDocumentPii(docId);
      onDocumentUpdated(document);
      onSelectDoc(document);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível revelar os dados.');
    } finally {
      setRevealing(false);
    }
  };

  const handleCopyJson = async (doc: TriageRecord) => {
    await navigator.clipboard.writeText(JSON.stringify(doc, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 1800);
  };

  const handleDownloadJson = (doc: TriageRecord) => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.documento_id}-triagem.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const canUnmask = user.role === 'ADMIN_GESTOR' || user.role === 'AUDITOR_CLINICO';

  return (
    <div className="space-y-6">
      {/* Banner clínico principal no topo da tela com ilustração médica */}
      <div className="bg-[#f9faf9] border border-slate-200 rounded-xl overflow-hidden grid grid-cols-1 md:grid-cols-12 items-stretch">
        <div className="md:col-span-7 p-6 sm:p-8 lg:px-10 lg:py-9 flex flex-col justify-center">
          <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-[#226d5a] mb-2.5">
            PROGRAMA ONE · HACKATHON
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-[1.12] text-balance">
            Mais clareza para
            <br />
            cada <span className="text-[#226d5a]">decisão.</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-3 max-w-lg leading-relaxed">
            Um protótipo de apoio à triagem de documentos clínicos. A tecnologia organiza
            informações; a decisão permanece com profissionais de saúde.
          </p>
        </div>

        <div className="md:col-span-5 relative min-h-[210px] sm:min-h-[240px] bg-white flex items-center justify-end overflow-hidden">
          <svg
            aria-hidden="true"
            viewBox="0 0 60 260"
            preserveAspectRatio="none"
            className="hidden md:block absolute left-0 inset-y-0 h-full w-10 z-10 pointer-events-none"
          >
            <path
              d="M 48 0 Q -8 130 48 260"
              fill="none"
              stroke="#226d5a"
              strokeWidth="2.5"
            />
          </svg>
          <img
            src="/assets/aistudio/med_ddbe8ce8.png"
            alt="Profissional de saúde analisando exame em tablet"
            className="w-full h-full max-h-[270px] object-contain object-right select-none"
          />
        </div>
      </div>

      {/* Faixa resumo com 4 indicadores clínicos principais */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Documentos Triados</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {stats.total}
          </p>
          <p className="mt-1 text-xs text-slate-500">Persistidos em cofre OCI</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Urgências Críticas</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-red-700">
            {stats.urgentes}
          </p>
          <p className="mt-1 text-xs text-slate-500">Alerta médico imediato</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Fila Auditoria HITL</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-amber-700">
            {stats.hitl}
          </p>
          <p className="mt-1 text-xs text-slate-500">Aguardando revisão humana</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Confiança Média IA</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-teal-700">
            {stats.avgConfidence}
          </p>
          <p className="mt-1 text-xs text-slate-500">Validação Zod + Gemini</p>
        </div>
      </div>

      {/* Área dividida: Ingestão à esquerda, Decisão e Grafo à direita */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Coluna esquerda: Ingestão multimodal e cenários de demonstração */}
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-900">
              Ingestão Multimodal de Documentos
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Envie PDF, imagem de receita/laudo, JSON ou texto clínico para triagem autônoma.
            </p>
          </div>

          {/* Cenários pré-carregados de demonstração do Hackathon */}
          <div className="mb-4 pb-4 border-b border-slate-200">
            <p className="text-xs font-medium text-slate-700 mb-2">
              Cenários de Demonstração (Hackathon ONE)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SAMPLE_SCENARIOS.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => loadScenario(sc)}
                  className="text-left p-2.5 rounded-md border border-slate-200 hover:border-teal-600 hover:bg-teal-50/30 transition-colors cursor-pointer"
                >
                  <div className="text-xs font-semibold text-slate-900 truncate">{sc.title}</div>
                  <div className="text-xs text-slate-500 truncate mt-0.5">{sc.categoryLabel}</div>
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ID do Documento (opcional)
                </label>
                <input
                  type="text"
                  value={documentoId}
                  onChange={(e) => setDocumentoId(e.target.value)}
                  placeholder="DOC-CLIN-2026-..."
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Canal de Origem
                </label>
                <select
                  value={canalOrigem}
                  onChange={(e) => setCanalOrigem(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
                >
                  <option value="Pronto_Socorro">Pronto_Socorro</option>
                  <option value="Ambulatorio_Endocrino">Ambulatorio_Endocrino</option>
                  <option value="Upload_Scanner_Recepcao">Upload_Scanner_Recepcao</option>
                  <option value="Portal_Operadora_TISS">Portal_Operadora_TISS</option>
                  <option value="Internacao_Hospitalar">Internacao_Hospitalar</option>
                </select>
              </div>
            </div>

            {/* Área de upload com verificação binária e detecção de ameaças */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Arquivo Clínico (PDF, PNG, JPEG, WEBP, TXT ou JSON · máx. 10 MB)
              </label>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => handleFilePick(e.target.files?.[0] ?? null)}
              />
              {!selectedFile ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border border-dashed border-slate-300 hover:border-teal-700 rounded-md p-4 text-center transition-colors cursor-pointer bg-slate-50/50"
                >
                  <FileUp className="w-5 h-5 mx-auto text-slate-400 mb-1.5" />
                  <p className="text-xs font-medium text-slate-700">
                    Clique para anexar PDF, imagem, TXT ou JSON clínico
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Identificação de tipo por magic bytes + varredura contra scripts maliciosos
                  </p>
                </button>
              ) : (
                <div className="flex items-center justify-between gap-3 p-3 rounded-md border border-teal-200 bg-teal-50/40">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText className="w-4 h-4 text-teal-700 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">
                        {selectedFile.name}
                      </p>
                      <p className="text-xs font-mono text-slate-500">
                        {(selectedFile.size / 1024).toFixed(1)} KB · {tipoArquivo}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedFile(null)}
                    className="p-1.5 text-slate-500 hover:text-red-700 rounded-md"
                    aria-label="Remover arquivo"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Campo de entrada textual ou payload JSON */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-700">
                  Conteúdo Textual / Payload JSON do Documento
                </label>
                <span className="text-xs text-slate-500 font-mono">{tipoArquivo}</span>
              </div>
              <textarea
                rows={6}
                value={documentoTexto}
                onChange={(e) => setDocumentoTexto(e.target.value)}
                placeholder="Cole o texto do laudo médico, prescrição, guia TISS ou payload JSON clínico..."
                className="w-full px-3 py-2.5 text-xs font-mono leading-relaxed border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="p-3.5 rounded-md border border-red-300 bg-red-50 text-xs text-red-900 flex items-start gap-2.5"
              >
                <ShieldAlert className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-semibold text-red-950">
                    {error.includes('Sessão')
                      ? 'Sessão expirada ou inválida'
                      : error.includes('GEMINI_API_KEY') || error.includes('Timeout')
                        ? 'Falha temporária no processamento'
                        : 'Entrada bloqueada pela inspeção de segurança'}
                  </p>
                  <p className="text-red-800 leading-relaxed">{error}</p>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-md bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>
                {submitting
                  ? 'Executando Agente Multimodal...'
                  : 'Executar Triagem Autônoma'}
              </span>
            </button>
          </form>
        </div>

        {/* Coluna direita: Resultado da triagem, grafo de decisão e backup OCI */}
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
          {!selectedDoc ? (
            <div className="py-16 text-center">
              <FileText className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-slate-900">
                Nenhum documento selecionado
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                Selecione um cenário de demonstração ao lado ou envie um documento clínico para
                visualizar a extração multimodal, o grafo de decisão e o backup criptografado no OCI.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Cabeçalho e status do documento selecionado */}
              <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
                    <span>{selectedDoc.documento_id}</span>
                    <span aria-hidden="true">·</span>
                    <span>{selectedDoc.canal_origem}</span>
                    <span aria-hidden="true">·</span>
                    <span>{selectedDoc.tipo_arquivo}</span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mt-1">
                    {selectedDoc.classificacao.tipo_documento}
                  </h3>
                  <p className="text-xs text-slate-600">
                    {selectedDoc.classificacao.especialidade} · Prioridade:{' '}
                    <span
                      className={
                        selectedDoc.classificacao.nivel_prioridade === 'Urgente' ||
                        selectedDoc.classificacao.nivel_prioridade === 'Emergência'
                          ? 'font-semibold text-red-700'
                          : 'font-semibold text-slate-900'
                      }
                    >
                      {selectedDoc.classificacao.nivel_prioridade}
                    </span>
                  </p>
                </div>

                {/* Indicador semântico de status com ícone */}
                <div className="flex items-center gap-2">
                  {selectedDoc.status === 'auditoria_humana' ? (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-300 bg-amber-50 text-xs font-semibold text-amber-900">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>Auditoria Humana Requerida</span>
                    </div>
                  ) : selectedDoc.status === 'rejeitado_auditoria' ? (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-300 bg-red-50 text-xs font-semibold text-red-900">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Rejeitado na Auditoria</span>
                    </div>
                  ) : selectedDoc.classificacao.nivel_prioridade === 'Urgente' ||
                    selectedDoc.classificacao.nivel_prioridade === 'Emergência' ? (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-300 bg-red-50 text-xs font-semibold text-red-900">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Urgência Roteada</span>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-emerald-300 bg-emerald-50 text-xs font-semibold text-emerald-900">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Processado Automaticamente</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Abas de visualização do resultado + ação de desmascaramento LGPD */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setResultTab('resumo')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      resultTab === 'resumo'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Entidades &amp; Roteamento
                  </button>
                  <button
                    type="button"
                    onClick={() => setResultTab('grafo')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      resultTab === 'grafo'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Grafo de Decisão
                  </button>
                  <button
                    type="button"
                    onClick={() => setResultTab('json')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      resultTab === 'json'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    JSON Estruturado
                  </button>
                </div>

                {selectedDoc.pii_mascarado && (
                  <div className="flex items-center gap-2">
                    {canUnmask ? (
                      <button
                        type="button"
                        disabled={revealing}
                        onClick={() => handleRevealPii(selectedDoc.documento_id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 cursor-pointer whitespace-nowrap"
                      >
                        <Eye className="w-3.5 h-3.5 text-teal-700" />
                        <span>{revealing ? 'Registrando auditoria...' : 'Revelar PII (LGPD)'}</span>
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                        <Lock className="w-3.5 h-3.5" />
                        <span>PII mascarado (perfil {user.role})</span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {resultTab === 'resumo' && (
                <div className="space-y-4">
                  {/* Tabela de entidades clínicas extraídas */}
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800">
                        Dados Clínicos Extraídos
                      </span>
                      <span className="text-xs font-mono tabular-nums text-slate-600">
                        Confiança Final:{' '}
                        {(selectedDoc.avaliacao_consistencia.score_confianca_final * 100).toFixed(0)}%
                        {' · '}Legibilidade:{' '}
                        {(selectedDoc.avaliacao_consistencia.legibilidade_score * 100).toFixed(0)}%
                      </span>
                    </div>
                    <dl className="divide-y divide-slate-200 text-xs">
                      <div className="grid grid-cols-3 px-4 py-2.5">
                        <dt className="text-slate-500 font-medium">Paciente</dt>
                        <dd className="col-span-2 text-slate-900 font-medium">
                          {selectedDoc.dados_extraidos.paciente.nome || 'Não identificado'}
                          {selectedDoc.dados_extraidos.paciente.idade != null
                            ? `, ${selectedDoc.dados_extraidos.paciente.idade} anos`
                            : ''}
                        </dd>
                      </div>
                      <div className="grid grid-cols-3 px-4 py-2.5">
                        <dt className="text-slate-500 font-medium">Médico / CRM</dt>
                        <dd className="col-span-2 text-slate-900">
                          {selectedDoc.dados_extraidos.medico_solicitante.nome || 'Não identificado'}
                          {' · '}
                          <span className="font-mono">
                            {selectedDoc.dados_extraidos.medico_solicitante.crm || 'CRM ausente'}
                          </span>
                        </dd>
                      </div>
                      <div className="grid grid-cols-3 px-4 py-2.5">
                        <dt className="text-slate-500 font-medium">Diagnóstico / CID-10</dt>
                        <dd className="col-span-2 text-slate-900">
                          {selectedDoc.dados_extraidos.diagnostico_principal || 'Não especificado'}
                          {selectedDoc.dados_extraidos.cid_sugerido && (
                            <span className="ml-2 font-mono text-teal-800 font-semibold">
                              CID {selectedDoc.dados_extraidos.cid_sugerido}
                            </span>
                          )}
                        </dd>
                      </div>
                      {selectedDoc.dados_extraidos.exame_realizado && (
                        <div className="grid grid-cols-3 px-4 py-2.5">
                          <dt className="text-slate-500 font-medium">Exame Realizado</dt>
                          <dd className="col-span-2 text-slate-900">
                            {selectedDoc.dados_extraidos.exame_realizado}
                          </dd>
                        </div>
                      )}
                      {selectedDoc.dados_extraidos.medicamentos_prescritos &&
                        selectedDoc.dados_extraidos.medicamentos_prescritos.length > 0 && (
                          <div className="grid grid-cols-3 px-4 py-2.5">
                            <dt className="text-slate-500 font-medium">Medicamentos</dt>
                            <dd className="col-span-2 space-y-1">
                              {selectedDoc.dados_extraidos.medicamentos_prescritos.map((m, idx) => (
                                <div key={idx} className="text-slate-900">
                                  <span className="font-semibold">{m.nome}</span>
                                  {m.dosagem ? ` · ${m.dosagem}` : ''}
                                  {m.posologia ? ` · ${m.posologia}` : ''}
                                  {m.alto_risco && (
                                    <span className="ml-2 text-red-700 font-medium">
                                      (Alto Risco)
                                    </span>
                                  )}
                                </div>
                              ))}
                            </dd>
                          </div>
                        )}
                      {selectedDoc.dados_extraidos.procedimentos_solicitados &&
                        selectedDoc.dados_extraidos.procedimentos_solicitados.length > 0 && (
                          <div className="grid grid-cols-3 px-4 py-2.5">
                            <dt className="text-slate-500 font-medium">Procedimentos</dt>
                            <dd className="col-span-2 text-slate-900">
                              {selectedDoc.dados_extraidos.procedimentos_solicitados.join(' · ')}
                            </dd>
                          </div>
                        )}
                    </dl>
                  </div>

                  {/* Alertas de inconsistência ou dados ausentes quando houver */}
                  {(selectedDoc.avaliacao_consistencia.dados_faltantes.length > 0 ||
                    selectedDoc.avaliacao_consistencia.conflitos_detectados.length > 0) && (
                    <div className="p-3.5 rounded-lg border border-amber-200 bg-amber-50/50 text-xs text-amber-950 space-y-1">
                      <p className="font-semibold">Inconsistências / Dados Faltantes Detectados</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {selectedDoc.avaliacao_consistencia.dados_faltantes.map((item, i) => (
                          <li key={`m-${i}`}>{item}</li>
                        ))}
                        {selectedDoc.avaliacao_consistencia.conflitos_detectados.map((item, i) => (
                          <li key={`c-${i}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Cartões de decisão de roteamento e armazenamento OCI */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border border-slate-200 rounded-lg p-3.5">
                      <p className="text-xs font-medium text-slate-500">Destino de Roteamento</p>
                      <p className="text-sm font-bold font-mono text-slate-900 mt-1">
                        {selectedDoc.decisao_roteamento.destino_principal}
                      </p>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                        {selectedDoc.decisao_roteamento.justificativa_roteamento}
                      </p>
                      <div className="mt-2.5 pt-2.5 border-t border-slate-200 text-xs text-slate-500">
                        Canal: <span className="font-mono text-slate-700">{selectedDoc.decisao_roteamento.notificacao_gerada.canal}</span>
                      </div>
                    </div>

                    <div className="border border-slate-200 rounded-lg p-3.5">
                      <p className="text-xs font-medium text-slate-500">
                        Armazenamento OCI Object Storage
                      </p>
                      <p className="text-xs font-mono font-semibold text-slate-900 mt-1 break-all">
                        {selectedDoc.armazenamento_oci.bucket}/{selectedDoc.armazenamento_oci.caminho_objeto}
                      </p>
                      <div className="mt-2 space-y-1 text-xs text-slate-600">
                        <div>
                          Criptografia:{' '}
                          <span className="font-mono text-slate-800">
                            {selectedDoc.armazenamento_oci.criptografia}
                          </span>
                        </div>
                        <div className="truncate">
                          SHA-256:{' '}
                          <span className="font-mono text-slate-800">
                            {selectedDoc.armazenamento_oci.sha256_checksum.slice(0, 20)}…
                          </span>
                        </div>
                        <div>
                          Tamanho:{' '}
                          <span className="font-mono tabular-nums text-slate-800">
                            {selectedDoc.armazenamento_oci.tamanho_bytes} bytes
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {resultTab === 'grafo' && <AgentGraphFlow record={selectedDoc} />}

              {resultTab === 'json' && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 px-3.5 py-2 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-600">
                      Saída Estruturada Validada (Zod / JSON Schema)
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopyJson(selectedDoc)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-200 bg-white rounded cursor-pointer"
                      >
                        {copiedJson ? (
                          <ClipboardCheck className="w-3.5 h-3.5 text-emerald-700" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedJson ? 'Copiado' : 'Copiar'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadJson(selectedDoc)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-200 bg-white rounded cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Baixar JSON</span>
                      </button>
                    </div>
                  </div>
                  <pre className="p-4 text-xs font-mono text-slate-800 bg-slate-950/2 overflow-x-auto max-h-[420px]">
                    {JSON.stringify(selectedDoc, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tabela inferior: Histórico de documentos triados do usuário */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Histórico de Documentos Triados
            </h3>
            <p className="text-xs text-slate-500">
              Clique em uma linha para inspecionar entidades extraídas, grafo e objeto OCI.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'todos', label: 'Todos' },
                  { id: 'urgente', label: 'Urgências' },
                  { id: 'auditoria', label: 'Auditoria HITL' },
                  { id: 'rotina', label: 'Processados' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    statusFilter === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar ID, paciente, destino..."
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-2.5 px-4">ID Documento</th>
                <th className="py-2.5 px-4">Categoria</th>
                <th className="py-2.5 px-4">Paciente</th>
                <th className="py-2.5 px-4">Prioridade</th>
                <th className="py-2.5 px-4 text-right">Confiança</th>
                <th className="py-2.5 px-4">Destino</th>
                <th className="py-2.5 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {filteredDocuments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-500">
                    Nenhum documento registrado nesta visualização. Utilize o painel de ingestão
                    acima para processar o primeiro caso.
                  </td>
                </tr>
              ) : (
                filteredDocuments.map((doc) => {
                  const isSelected = selectedDoc?.documento_id === doc.documento_id;
                  const isUrgent =
                    doc.classificacao.nivel_prioridade === 'Urgente' ||
                    doc.classificacao.nivel_prioridade === 'Emergência';
                  return (
                    <tr
                      key={doc.documento_id}
                      onClick={() => onSelectDoc(doc)}
                      className={`h-10 cursor-pointer transition-colors ${
                        isSelected ? 'bg-teal-50/50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-2 px-4 font-mono font-medium text-slate-900 whitespace-nowrap">
                        {doc.documento_id}
                      </td>
                      <td className="py-2 px-4 text-slate-700 whitespace-nowrap">
                        {doc.classificacao.tipo_documento}
                      </td>
                      <td className="py-2 px-4 text-slate-700 whitespace-nowrap">
                        {doc.dados_extraidos.paciente.nome || 'Não identificado'}
                      </td>
                      <td
                        className={`py-2 px-4 font-medium whitespace-nowrap ${
                          isUrgent ? 'text-red-700' : 'text-slate-700'
                        }`}
                      >
                        {doc.classificacao.nivel_prioridade}
                      </td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                        {(doc.avaliacao_consistencia.score_confianca_final * 100).toFixed(0)}%
                      </td>
                      <td className="py-2 px-4 font-mono text-slate-700 whitespace-nowrap">
                        {doc.decisao_roteamento.destino_principal}
                      </td>
                      <td className="py-2 px-4 whitespace-nowrap">
                        {doc.status === 'auditoria_humana' ? (
                          <span className="text-amber-800 font-medium">Auditoria HITL</span>
                        ) : doc.status === 'rejeitado_auditoria' ? (
                          <span className="text-red-700 font-medium">Rejeitado</span>
                        ) : doc.status === 'aprovado_auditoria' ? (
                          <span className="text-emerald-700 font-medium">Aprovado HITL</span>
                        ) : (
                          <span className="text-emerald-700 font-medium">Processado</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
