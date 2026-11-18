import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { loginDemoOAuth } from '../lib/api';
import type { AuthUser, UserRole } from '../shared/clinicalSchemas';

interface LoginScreenProps {
  onAuthenticated: (user: AuthUser) => void;
}

const DEMO_ACCOUNTS: Array<{
  label: string;
  roleTag: UserRole;
  permissions: string;
}> = [
  {
    label: 'Gestor Clínico & DPO',
    roleTag: 'ADMIN_GESTOR',
    permissions: 'Acesso total · Regras de fluxo · Desmascaramento LGPD · Auditoria',
  },
  {
    label: 'Auditor Médico HITL',
    roleTag: 'AUDITOR_CLINICO',
    permissions: 'Triagem · Aprovação/Rejeição HITL · Inspeção OCI · Desmascaramento',
  },
  {
    label: 'Operador de Triagem',
    roleTag: 'OPERADOR_TRIAGEM',
    permissions: 'Ingestão de documentos · Dados sensíveis mascarados por padrão (LGPD)',
  },
];

export const LoginScreen: React.FC<LoginScreenProps> = ({ onAuthenticated }) => {
  const [selectedRole, setSelectedRole] = useState<UserRole>('ADMIN_GESTOR');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEnter = async () => {
    setError(null);
    setLoading(true);
    try {
      const { user } = await loginDemoOAuth('local', selectedRole);
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível iniciar a sessão.');
      setLoading(false);
    }
  };

  const applyAccount = (acc: (typeof DEMO_ACCOUNTS)[number]) => {
    setSelectedRole(acc.roleTag);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Coluna esquerda: contexto de segurança e seleção de perfil RBAC */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <img
                  src="/assets/aistudio/favicon_bbce6d06.svg"
                  alt="Logo MediFlow"
                  className="w-10 h-10 rounded-lg shrink-0"
                />
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-slate-900">MediFlow</h1>
                  <p className="text-xs text-slate-500">
                    Triagem Clínica Autônoma · Oracle OCI Always Free · LGPD &amp; HIPAA
                  </p>
                </div>
              </div>
              <img
                src="/assets/aistudio/health-illustration_5e0bb52c.png"
                alt="Emblema Saúde MediFlow"
                className="w-10 h-10 rounded-full object-cover shrink-0"
              />
            </div>

            <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-3 text-balance">
              Plataforma segura de processamento, extração e roteamento clínico multimodal
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed mb-8">
              O acesso aos prontuários, laudos e receituários é protegido por autenticação baseada
              em papéis (RBAC), criptografia AES-256-GCM em repouso e trilha de auditoria com
              cadeia criptográfica SHA-256.
            </p>

            <div className="border-t border-slate-200 pt-6">
              <p className="text-xs font-semibold text-slate-700 mb-3">
                Selecione o Perfil de Acesso para Avaliação (RBAC)
              </p>
              <div className="space-y-2.5">
                {DEMO_ACCOUNTS.map((acc) => {
                  const selected = selectedRole === acc.roleTag;
                  return (
                    <button
                      key={acc.roleTag}
                      type="button"
                      onClick={() => applyAccount(acc)}
                      className={`w-full text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                        selected
                          ? 'border-[#226d5a] bg-emerald-50/40'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-semibold text-slate-900">{acc.label}</span>
                        <span className="font-mono text-xs text-slate-500">{acc.roleTag}</span>
                      </div>
                      <p className="text-xs text-slate-600">{acc.permissions}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-8 pt-4 border-t border-slate-200 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>Sessão HMAC-SHA256</span>
            <span aria-hidden="true">·</span>
            <span>Cofre AES-256-GCM</span>
            <span aria-hidden="true">·</span>
            <span>Mascaramento PII por padrão</span>
          </div>
        </div>

        {/* Cartão direito: entrada direta com 1 clique */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-8 flex flex-col justify-center">
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-slate-900">Acesso à Plataforma</h3>
            <p className="text-xs text-slate-500 mt-1">
              Clique em Entrar para acessar imediatamente com o perfil RBAC selecionado ao lado.
            </p>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={handleEnter}
            className="w-full py-3 px-4 rounded-lg bg-[#226d5a] hover:bg-[#1a5647] disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <span>{loading ? 'Entrando...' : 'Entrar'}</span>
            {!loading && <ArrowRight className="w-4 h-4 shrink-0" />}
          </button>

          {error && (
            <div className="mt-4 p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="mt-6 pt-5 border-t border-slate-200 text-xs text-slate-500">
            Perfil selecionado:{' '}
            <span className="font-mono font-semibold text-slate-700">{selectedRole}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
