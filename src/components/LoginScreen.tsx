import React, { useEffect, useState } from 'react';
import {
  fetchOAuthProviders,
  fetchOAuthUrl,
  loginDemoOAuth,
  setClientSessionToken,
} from '../lib/api';
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
  const [oauthLoading, setOauthLoading] = useState<'google' | 'github' | null>(null);
  const [pendingDemoProvider, setPendingDemoProvider] = useState<'google' | 'github' | null>(null);
  const [accountName, setAccountName] = useState('');
  const [accountEmail, setAccountEmail] = useState('');
  const [oauthProviders, setOauthProviders] = useState({
    googleConfigured: false,
    githubConfigured: false,
    demoEnabled: true,
    loaded: false,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOAuthProviders()
      .then((res) =>
        setOauthProviders({
          googleConfigured: res.googleConfigured,
          githubConfigured: res.githubConfigured,
          demoEnabled: res.demoEnabled ?? true,
          loaded: true,
        })
      )
      .catch(() => {
        setOauthProviders((prev) => ({ ...prev, loaded: true }));
      });
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (
        origin !== window.location.origin &&
        !origin.endsWith('.run.app') &&
        !origin.endsWith('.netlify.app') &&
        !origin.includes('localhost')
      ) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.user) {
        if (event.data.sessionToken) {
          setClientSessionToken(event.data.sessionToken);
        }
        setOauthLoading(null);
        onAuthenticated(event.data.user as AuthUser);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onAuthenticated]);

  const handleOAuthSignIn = async (provider: 'google' | 'github') => {
    setError(null);
    const isConfigured =
      provider === 'google'
        ? oauthProviders.googleConfigured
        : oauthProviders.githubConfigured;

    if (isConfigured) {
      setOauthLoading(provider);
      try {
        const { url } = await fetchOAuthUrl(provider);
        const popup = window.open(url, `mediflow_oauth_${provider}`, 'width=560,height=680');
        if (!popup) {
          // Fora de iframe (ex.: acesso direto no Netlify), redireciona na mesma aba se pop-up estiver bloqueado
          if (window.top === window.self) {
            window.location.assign(url);
            return;
          }
          setError('Permita pop-ups no navegador para concluir a autenticação com sua conta.');
          setOauthLoading(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha na autenticação federada.');
        setOauthLoading(null);
      }
      return;
    }

    if (!oauthProviders.demoEnabled) {
      setError('Login demo desativado. Configure o OAuth real do Google e GitHub nas variáveis do Netlify.');
      return;
    }

    // Sem OAuth real configurado no servidor, abre etapa explícita de identificação (sem pular direto)
    setPendingDemoProvider(provider);
  };

  const handleConfirmDemoAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingDemoProvider) return;
    setError(null);

    const trimmedName = accountName.trim();
    const trimmedEmail = accountEmail.trim();
    if (trimmedName.length < 2) {
      setError('Informe seu nome para identificar a sessão.');
      return;
    }
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError(
        pendingDemoProvider === 'google'
          ? 'Informe um e-mail válido da sua conta Google.'
          : 'Informe o e-mail associado à sua conta GitHub.'
      );
      return;
    }

    setOauthLoading(pendingDemoProvider);
    try {
      const { user } = await loginDemoOAuth(pendingDemoProvider, selectedRole, {
        name: trimmedName,
        email: trimmedEmail,
      });
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na autenticação da sessão.');
      setOauthLoading(null);
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

        {/* Cartão direito: login federado com Google ou GitHub */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-8 flex flex-col justify-center">
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-slate-900">Acesso à Plataforma</h3>
            <p className="text-xs text-slate-500 mt-1">
              {pendingDemoProvider
                ? `Identifique sua conta ${pendingDemoProvider === 'google' ? 'Google' : 'GitHub'} para iniciar sua sessão isolada.`
                : 'Escolha entrar com sua conta Google ou GitHub usando o perfil RBAC selecionado ao lado.'}
            </p>
          </div>

          {!pendingDemoProvider ? (
            <div className="space-y-3">
              <button
                type="button"
                disabled={oauthLoading !== null || !oauthProviders.loaded}
                onClick={() => handleOAuthSignIn('google')}
                className="w-full py-3 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-900 text-sm font-medium flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                  />
                </svg>
                <span>
                  {oauthLoading === 'google' ? 'Conectando Google...' : 'Entrar com Google'}
                </span>
              </button>

              <button
                type="button"
                disabled={oauthLoading !== null || !oauthProviders.loaded}
                onClick={() => handleOAuthSignIn('github')}
                className="w-full py-3 px-4 rounded-lg border border-slate-900 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-medium flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4 shrink-0 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.17 1.18.92-.26 1.91-.39 2.89-.39.98 0 1.97.13 2.89.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.8 1.19 1.83 1.19 3.08 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.66.79.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
                </svg>
                <span>
                  {oauthLoading === 'github' ? 'Conectando GitHub...' : 'Entrar com GitHub'}
                </span>
              </button>
            </div>
          ) : (
            <form onSubmit={handleConfirmDemoAccount} className="space-y-3.5">
              <div>
                <label
                  htmlFor="oauth-account-name"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Seu nome completo
                </label>
                <input
                  id="oauth-account-name"
                  type="text"
                  required
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="Ex.: Dra. Ana Beatriz"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-[#226d5a]"
                />
              </div>

              <div>
                <label
                  htmlFor="oauth-account-email"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  {pendingDemoProvider === 'google'
                    ? 'E-mail da conta Google'
                    : 'E-mail da conta GitHub'}
                </label>
                <input
                  id="oauth-account-email"
                  type="email"
                  required
                  value={accountEmail}
                  onChange={(e) => setAccountEmail(e.target.value)}
                  placeholder={
                    pendingDemoProvider === 'google' ? 'voce@gmail.com' : 'voce@github.com'
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-[#226d5a]"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={oauthLoading !== null}
                  onClick={() => {
                    setPendingDemoProvider(null);
                    setError(null);
                  }}
                  className="px-3.5 py-2.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={oauthLoading !== null}
                  className="flex-1 py-2.5 px-4 rounded-lg bg-[#226d5a] hover:bg-[#1a5647] disabled:opacity-60 text-white text-sm font-medium cursor-pointer transition-colors"
                >
                  {oauthLoading
                    ? 'Autenticando...'
                    : `Entrar com ${pendingDemoProvider === 'google' ? 'Google' : 'GitHub'}`}
                </button>
              </div>
            </form>
          )}

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
