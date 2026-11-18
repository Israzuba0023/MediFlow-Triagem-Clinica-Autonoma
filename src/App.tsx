import React, { useEffect, useState } from 'react';
import {
  Activity,
  BookOpen,
  Database,
  FilePlus2,
  HelpCircle,
  LogOut,
  Menu,
  ShieldCheck,
  Sliders,
  UserCheck,
  X,
} from 'lucide-react';
import { ApiDocsPanel } from './components/ApiDocsPanel';
import { HowItWorksPanel } from './components/HowItWorksPanel';
import { HumanAuditPanel } from './components/HumanAuditPanel';
import { LoginScreen } from './components/LoginScreen';
import { OciStorageExplorer } from './components/OciStorageExplorer';
import { RulesAndAlertsPanel } from './components/RulesAndAlertsPanel';
import { SecurityAuditPanel } from './components/SecurityAuditPanel';
import { TriageWorkspace } from './components/TriageWorkspace';
import { fetchCurrentUser, fetchDocuments, logoutUser } from './lib/api';
import type { AuthUser, TriageRecord } from './shared/clinicalSchemas';

type ActiveSection = 'triagem' | 'auditoria' | 'oci' | 'regras' | 'seguranca' | 'api';

const SECTION_LABELS: Record<ActiveSection, string> = {
  triagem: 'Triagem & Ingestão',
  auditoria: 'Auditoria Humana (HITL)',
  oci: 'OCI Object Storage',
  regras: 'Regras & Alertas',
  seguranca: 'Segurança & Auditoria',
  api: 'API & Arquitetura',
};

export default function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeSection, setActiveSection] = useState<ActiveSection>('triagem');
  const [mainTab, setMainTab] = useState<'triagem' | 'como_funciona'>('triagem');
  const [documents, setDocuments] = useState<TriageRecord[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<TriageRecord | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const loadWorkspaceData = async () => {
    try {
      const { documents: docs } = await fetchDocuments();
      setDocuments(docs);
      if (docs.length > 0) {
        setSelectedDoc((prev) => prev ?? docs[0]);
      }
    } catch {
      // Trata graciosamente quando a sessão estiver expirada
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchCurrentUser();
        if (res.authenticated && res.user) {
          setUser(res.user);
          await loadWorkspaceData();
        }
      } finally {
        setAuthLoading(false);
      }
    })();
  }, []);

  const handleAuthenticated = async (loggedUser: AuthUser) => {
    setUser(loggedUser);
    setSelectedDoc(null);
    await loadWorkspaceData();
  };

  const handleLogout = async () => {
    await logoutUser();
    setUser(null);
    setDocuments([]);
    setSelectedDoc(null);
  };

  const handleDocumentProcessed = (doc: TriageRecord) => {
    setDocuments((prev) => [doc, ...prev.filter((d) => d.documento_id !== doc.documento_id)]);
    setSelectedDoc(doc);
  };

  const handleDocumentUpdated = (doc: TriageRecord) => {
    setDocuments((prev) => prev.map((d) => (d.documento_id === doc.documento_id ? doc : d)));
    setSelectedDoc((prev) => (prev?.documento_id === doc.documento_id ? doc : prev));
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs font-medium text-slate-600">
          Inicializando ambiente seguro MediFlow...
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onAuthenticated={handleAuthenticated} />;
  }

  const pendingHitlCount = documents.filter((d) => d.status === 'auditoria_humana').length;

  const navItems: Array<{
    id: ActiveSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
  }> = [
    { id: 'triagem', label: 'Triagem & Ingestão', icon: Activity },
    { id: 'auditoria', label: 'Auditoria Humana', icon: UserCheck, count: pendingHitlCount },
    { id: 'oci', label: 'OCI Object Storage', icon: Database },
    { id: 'regras', label: 'Regras & Alertas', icon: Sliders },
    { id: 'seguranca', label: 'Segurança & Auditoria', icon: ShieldCheck },
    { id: 'api', label: 'API & Arquitetura', icon: BookOpen },
  ];

  const selectSection = (section: ActiveSection) => {
    setActiveSection(section);
    if (section === 'triagem') {
      setMainTab('triagem');
    }
    setMobileMenuOpen(false);
  };

  const openMainTab = (tab: 'triagem' | 'como_funciona') => {
    setActiveSection('triagem');
    setMainTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Barra lateral fixa para desktop (256px) */}
      <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 bg-white border-r border-slate-200 sticky top-0 h-screen">
        <div className="h-16 px-5 border-b border-slate-200 flex items-center gap-2.5">
          <img
            src="/assets/aistudio/favicon_bbce6d06.svg"
            alt="MediFlow"
            className="w-8 h-8 rounded-md shrink-0"
          />
          <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            MediFlow
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectSection(item.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-teal-50 text-teal-900 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-teal-700' : 'text-slate-400'}`} />
                  <span className="truncate">{item.label}</span>
                </span>
                {typeof item.count === 'number' && item.count > 0 && (
                  <span className="font-mono tabular-nums text-xs font-semibold text-amber-800">
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Rodapé do perfil autenticado e botão de saída */}
        <div className="p-4 border-t border-slate-200 space-y-3">
          <div>
            <p className="text-xs font-semibold text-slate-900 truncate">{user.name}</p>
            <p className="text-xs font-mono text-slate-500 truncate">{user.role}</p>
            <p className="text-xs text-slate-500 truncate mt-0.5">{user.crmOrRegistry}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Encerrar Sessão</span>
          </button>
        </div>
      </aside>

      {/* Menu lateral deslizante para dispositivos móveis */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-50 w-64 bg-white h-full border-r border-slate-200 flex flex-col">
            <div className="h-16 px-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <img
                  src="/assets/aistudio/favicon_bbce6d06.svg"
                  alt="MediFlow"
                  className="w-7 h-7 rounded-md shrink-0"
                />
                <span className="text-base font-bold text-slate-900">MediFlow</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 text-slate-500"
                aria-label="Fechar menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectSection(item.id)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-md text-xs font-medium ${
                      active ? 'bg-teal-50 text-teal-900 font-semibold' : 'text-slate-600'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </span>
                    {typeof item.count === 'number' && item.count > 0 && (
                      <span className="font-mono tabular-nums text-amber-800">{item.count}</span>
                    )}
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200">
              <p className="text-xs font-semibold text-slate-900">{user.name}</p>
              <p className="text-xs font-mono text-slate-500 mb-3">{user.role}</p>
              <button
                type="button"
                onClick={handleLogout}
                className="w-full py-2 px-3 border border-slate-200 rounded-md text-xs font-medium text-slate-700"
              >
                Encerrar Sessão
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Área principal de conteúdo */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Barra superior: breadcrumb, abas principais no topo e ação primária */}
        <header className="min-h-16 bg-white border-b border-slate-200 px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-md border border-slate-200 text-slate-600"
              aria-label="Abrir navegação"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-500 truncate">
              <span className="font-semibold text-slate-900">MediFlow</span>
              <span aria-hidden="true">/</span>
              <span className="font-medium text-slate-700 truncate">
                {activeSection === 'triagem' && mainTab === 'como_funciona'
                  ? 'Como funciona'
                  : SECTION_LABELS[activeSection]}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <nav
              role="tablist"
              aria-label="Navegação principal do topo"
              className="inline-flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeSection === 'triagem' && mainTab === 'triagem'}
                onClick={() => openMainTab('triagem')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  activeSection === 'triagem' && mainTab === 'triagem'
                    ? 'bg-[#226d5a] text-white'
                    : 'text-slate-700 hover:bg-white hover:text-slate-900'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Triagem e Ingestão</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeSection === 'triagem' && mainTab === 'como_funciona'}
                onClick={() => openMainTab('como_funciona')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  activeSection === 'triagem' && mainTab === 'como_funciona'
                    ? 'bg-[#226d5a] text-white'
                    : 'text-slate-700 hover:bg-white hover:text-slate-900'
                }`}
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Como funciona</span>
              </button>
            </nav>

            <button
              type="button"
              onClick={() => {
                setActiveSection('triagem');
                setMainTab('triagem');
                setSelectedDoc(null);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              <span>Nova Triagem</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {activeSection === 'triagem' &&
            (mainTab === 'triagem' ? (
              <TriageWorkspace
                user={user}
                documents={documents}
                selectedDoc={selectedDoc}
                onSelectDoc={setSelectedDoc}
                onDocumentProcessed={handleDocumentProcessed}
                onDocumentUpdated={handleDocumentUpdated}
              />
            ) : (
              <HowItWorksPanel onGoToTriage={() => openMainTab('triagem')} />
            ))}

          {activeSection === 'auditoria' && (
            <HumanAuditPanel
              user={user}
              documents={documents}
              onDocumentUpdated={handleDocumentUpdated}
            />
          )}

          {activeSection === 'oci' && <OciStorageExplorer user={user} />}

          {activeSection === 'regras' && <RulesAndAlertsPanel user={user} />}

          {activeSection === 'seguranca' && <SecurityAuditPanel />}

          {activeSection === 'api' && <ApiDocsPanel />}
        </main>

        <footer className="bg-[#226d5a] text-white border-t border-emerald-900/30 px-4 sm:px-6 py-4">
          <div className="max-w-[1440px] w-full mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <img
                src="/assets/aistudio/favicon_bbce6d06.svg"
                alt="Logo MediFlow"
                className="w-8 h-8 rounded-lg ring-1 ring-white/30 shrink-0"
              />
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                <span className="text-sm font-semibold tracking-tight text-white">
                  Hackathon ONE
                </span>
                <span className="text-white/50" aria-hidden="true">
                  ·
                </span>
                <span className="text-xs text-emerald-50/90">
                  MediFlow · Triagem Clínica Autônoma
                </span>
              </div>
            </div>

            <p className="text-xs font-medium text-emerald-50">
              Desenvolvido por <span className="font-semibold text-white">Equipa 23</span>
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
