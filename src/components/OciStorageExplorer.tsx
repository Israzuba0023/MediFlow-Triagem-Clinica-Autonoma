import React, { useEffect, useState } from 'react';
import { CheckCircle2, Database, FolderOpen, Lock, RefreshCw, ShieldCheck } from 'lucide-react';
import { fetchOciBuckets, verifyOciObject, type OciBucketsResponse } from '../lib/api';
import type { AuthUser } from '../shared/clinicalSchemas';

interface OciStorageExplorerProps {
  user: AuthUser;
}

const PREFIX_TABS = [
  { id: 'todos', label: 'Todos os Buckets' },
  { id: 'recebidos', label: '/recebidos' },
  { id: 'processados/urgentes', label: '/processados/urgentes' },
  { id: 'processados/rotina', label: '/processados/rotina' },
  { id: 'auditoria_humana', label: '/auditoria_humana' },
  { id: 'rejeitados', label: '/rejeitados' },
] as const;

export const OciStorageExplorer: React.FC<OciStorageExplorerProps> = ({ user }) => {
  const [data, setData] = useState<OciBucketsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [prefixFilter, setPrefixFilter] = useState<string>('todos');
  const [verifyingPath, setVerifyingPath] = useState<string | null>(null);
  const [verifiedObject, setVerifiedObject] = useState<{
    validIntegrity: boolean;
    objectPath: string;
    sha256Checksum: string;
    decryptedPreview: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOciBuckets();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao listar buckets OCI.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const canInspectObject = user.role === 'ADMIN_GESTOR' || user.role === 'AUDITOR_CLINICO';

  const handleVerify = async (objectPath: string) => {
    setVerifyingPath(objectPath);
    setError(null);
    try {
      const res = await verifyOciObject(objectPath);
      setVerifiedObject(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao verificar integridade do objeto.');
    } finally {
      setVerifyingPath(null);
    }
  };

  const filteredObjects =
    data?.objects.filter((o) => prefixFilter === 'todos' || o.prefix === prefixFilter) ?? [];

  const quotaPct = data
    ? Math.min(100, (data.totalBytesUsed / data.config.alwaysFreeQuotaBytes) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Visão geral do bucket segregado OCI */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Oracle Cloud Infrastructure (OCI)</span>
              <span aria-hidden="true">·</span>
              <span>Camada Always Free (20 GB)</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{data?.config.region ?? 'sa-saopaulo-1'}</span>
            </div>
            <h2 className="text-base font-semibold text-slate-900 mt-1">
              Bucket Segregado: <span className="font-mono">{data?.config.bucketName ?? 'mediflow-documentos-clinicos'}</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Modo ativo: <span className="font-mono text-slate-700">{data?.config.integrationMode ?? 'ENCRYPTED_ALWAYS_FREE_VAULT'}</span>
              {' · '}Criptografia em repouso: <span className="font-mono text-slate-700">AES-256-GCM</span>
            </p>
          </div>

          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar Buckets</span>
          </button>
        </div>

        {/* Barra de consumo da camada OCI Always Free (20 GB) */}
        <div className="mt-4 pt-4 border-t border-slate-200">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-slate-600 font-medium">
              Consumo Always Free Object Storage (Standard)
            </span>
            <span className="font-mono tabular-nums text-slate-800">
              {((data?.totalBytesUsed ?? 0) / 1024).toFixed(2)} KB / 20.00 GB ({quotaPct.toFixed(4)}%)
            </span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-700 transition-all"
              style={{ width: `${Math.max(quotaPct, data && data.totalBytesUsed > 0 ? 1 : 0)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Abas de filtragem por prefixo do bucket */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        {PREFIX_TABS.map((tab) => {
          const count =
            tab.id === 'todos'
              ? data?.objects.length ?? 0
              : data?.countsByPrefix[tab.id] ?? 0;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPrefixFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                prefixFilter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>{tab.label}</span>
              <span className="ml-1.5 font-mono tabular-nums text-slate-500">({count})</span>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="p-3 rounded-md border border-red-200 bg-red-50 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Tabela de objetos armazenados e inspetor criptográfico */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-slate-500" />
            <h3 className="text-xs font-semibold text-slate-800">
              Objetos Armazenados ({filteredObjects.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Caminho do Objeto</th>
                  <th className="py-2.5 px-4 text-right">Tamanho</th>
                  <th className="py-2.5 px-4">SHA-256</th>
                  <th className="py-2.5 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredObjects.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-slate-500">
                      Nenhum objeto neste prefixo do bucket.
                    </td>
                  </tr>
                ) : (
                  filteredObjects.map((obj) => (
                    <tr key={obj.objectPath} className="h-10 hover:bg-slate-50">
                      <td className="py-2 px-4 font-mono text-slate-900 max-w-[260px] truncate">
                        {obj.objectPath}
                      </td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {obj.sizeBytes} B
                      </td>
                      <td className="py-2 px-4 font-mono text-slate-500 whitespace-nowrap">
                        {obj.sha256Checksum.slice(0, 14)}…
                      </td>
                      <td className="py-2 px-4 text-right whitespace-nowrap">
                        {canInspectObject ? (
                          <button
                            type="button"
                            disabled={verifyingPath === obj.objectPath}
                            onClick={() => handleVerify(obj.objectPath)}
                            className="text-xs font-medium text-teal-700 hover:text-teal-900 cursor-pointer"
                          >
                            {verifyingPath === obj.objectPath ? 'Verificando...' : 'Verificar & Ler'}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-slate-400">
                            <Lock className="w-3 h-3" />
                            <span>Restrito</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Inspetor de integridade SHA-256 e descriptografia AES-256-GCM */}
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <Database className="w-4 h-4 text-teal-700" />
            <h3 className="text-sm font-semibold text-slate-900">
              Verificador Criptográfico de Objeto
            </h3>
          </div>

          {!verifiedObject ? (
            <p className="text-xs text-slate-500 leading-relaxed">
              Clique em <span className="font-medium text-slate-700">Verificar &amp; Ler</span> em
              qualquer objeto ao lado para validar a autenticação GCM (AES-256-GCM), recalcular o
              checksum SHA-256 e inspecionar o conteúdo descriptografado em memória.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded-md border border-emerald-200 bg-emerald-50 flex items-center gap-2 text-xs text-emerald-900">
                {verifiedObject.validIntegrity ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>Integridade SHA-256 e Tag AES-256-GCM verificadas com sucesso.</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4 text-red-700 shrink-0" />
                    <span>Divergência de checksum detectada!</span>
                  </>
                )}
              </div>

              <div className="text-xs space-y-1">
                <div className="text-slate-500">Objeto:</div>
                <div className="font-mono text-slate-900 break-all">{verifiedObject.objectPath}</div>
                <div className="text-slate-500 pt-1">SHA-256:</div>
                <div className="font-mono text-slate-700 break-all">
                  {verifiedObject.sha256Checksum}
                </div>
              </div>

              <pre className="p-3 rounded-md border border-slate-200 bg-slate-50 text-xs font-mono text-slate-800 max-h-64 overflow-y-auto whitespace-pre-wrap">
                {verifiedObject.decryptedPreview}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
