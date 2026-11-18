import React, { useEffect, useState } from 'react';
import { CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { fetchAuditLogs, verifyAuditLogChain } from '../lib/api';
import type { AuditLogEntry } from '../shared/clinicalSchemas';

const SECURITY_CONTROLS = [
  {
    control: 'Criptografia em Repouso (At-Rest)',
    detail: 'AES-256-GCM com IV único de 96 bits e AuthTag 128 bits para todos os documentos e cofres OCI.',
  },
  {
    control: 'Controle de Acesso RBAC & Sessão',
    detail: 'Cookies HttpOnly assinados com HMAC-SHA256, senhas com scrypt + salt aleatório e guarda CSRF.',
  },
  {
    control: 'Minimização & Mascaramento LGPD',
    detail: 'Identificação de pacientes mascarada por padrão; desmascaramento gera evento auditado PII_UNMASKED.',
  },
  {
    control: 'Defesa Multimodal & Anti-Injection',
    detail: 'Validação binária por magic bytes (PDF/PNG/JPEG/JSON), sanitização XSS e isolamento de prompt no LLM.',
  },
  {
    control: 'Proteção de Rede & Anti-Abuso',
    detail: 'Cabeçalhos Helmet, rate limiting por janela deslizante e bloqueio SSRF em webhooks externos.',
  },
  {
    control: 'Trilha de Auditoria Tamper-Evident',
    detail: 'Cadeia criptográfica SHA-256 encadeada (prev_hash -> entry_hash) para detecção de adulteração.',
  },
];

export const SecurityAuditPanel: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [chainStatus, setChainStatus] = useState<{
    valid: boolean;
    totalEntries: number;
    brokenAtSeq?: number;
    lastHash: string;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const load = async () => {
    const [{ logs: l }, verify] = await Promise.all([fetchAuditLogs(), verifyAuditLogChain()]);
    setLogs(l);
    setChainStatus(verify);
  };

  useEffect(() => {
    load();
  }, []);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const verify = await verifyAuditLogChain();
      setChainStatus(verify);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Grade de controles de segurança e conformidade LGPD/HIPAA */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Arquitetura de Segurança &amp; Proteção de Dados Clínicos (LGPD / HIPAA)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Controles criptográficos e operacionais ativos em todas as camadas da aplicação.
            </p>
          </div>
          <button
            type="button"
            onClick={handleVerify}
            disabled={verifying}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{verifying ? 'Verificando...' : 'Verificar Cadeia SHA-256'}</span>
          </button>
        </div>

        {chainStatus && (
          <div
            className={`mt-4 p-3.5 rounded-md border flex flex-wrap items-center justify-between gap-2 text-xs ${
              chainStatus.valid
                ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                : 'border-red-200 bg-red-50 text-red-900'
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              {chainStatus.valid ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-red-700 shrink-0" />
              )}
              <span>
                {chainStatus.valid
                  ? `Cadeia criptográfica íntegra (${chainStatus.totalEntries} registros verificados sem adulteração).`
                  : `Violação de integridade detectada na sequência #${chainStatus.brokenAtSeq}.`}
              </span>
            </div>
            <span className="font-mono text-slate-600">
              Último Hash: {chainStatus.lastHash.slice(0, 18)}…
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
          {SECURITY_CONTROLS.map((item) => (
            <div key={item.control} className="p-3.5 rounded-md border border-slate-200 bg-slate-50/40">
              <p className="text-xs font-semibold text-slate-900">{item.control}</p>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabela da trilha de auditoria imutável */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-800">
            Trilha de Auditoria Imutável ({logs.length} eventos)
          </h3>
          <span className="text-xs text-slate-500">Ordenado do mais recente para o mais antigo</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-2.5 px-4">Seq</th>
                <th className="py-2.5 px-4">Data / Hora</th>
                <th className="py-2.5 px-4">Ação</th>
                <th className="py-2.5 px-4">Ator / Perfil</th>
                <th className="py-2.5 px-4">Recurso</th>
                <th className="py-2.5 px-4">Detalhes</th>
                <th className="py-2.5 px-4">Hash SHA-256</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {logs.map((entry) => (
                <tr key={entry.id} className="h-10 hover:bg-slate-50">
                  <td className="py-2 px-4 font-mono tabular-nums text-slate-500">#{entry.seq}</td>
                  <td className="py-2 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                    {new Date(entry.timestamp).toLocaleString('pt-BR')}
                  </td>
                  <td className="py-2 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                    {entry.action}
                  </td>
                  <td className="py-2 px-4 text-slate-700 whitespace-nowrap">
                    {entry.actor_email} · <span className="font-mono">{entry.actor_role}</span>
                  </td>
                  <td className="py-2 px-4 font-mono text-slate-700 whitespace-nowrap">
                    {entry.resource_id}
                  </td>
                  <td className="py-2 px-4 text-slate-600 max-w-md truncate">{entry.details}</td>
                  <td className="py-2 px-4 font-mono text-slate-400 whitespace-nowrap">
                    {entry.entry_hash.slice(0, 12)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
