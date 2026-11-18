import React, { useEffect, useState } from 'react';
import { BellRing, Check, Lock, Save, Sliders } from 'lucide-react';
import { acknowledgeAlert, fetchAlerts, fetchRules, updateRules } from '../lib/api';
import type { AuthUser, SecurityAlert, TriageRulesConfig } from '../shared/clinicalSchemas';

interface RulesAndAlertsPanelProps {
  user: AuthUser;
}

export const RulesAndAlertsPanel: React.FC<RulesAndAlertsPanelProps> = ({ user }) => {
  const [rules, setRules] = useState<TriageRulesConfig | null>(null);
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [keywordsText, setKeywordsText] = useState('');
  const [cidText, setCidText] = useState('');
  const [highRiskMedsText, setHighRiskMedsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user.role === 'ADMIN_GESTOR';
  const canAckAlert = user.role === 'ADMIN_GESTOR' || user.role === 'AUDITOR_CLINICO';

  const loadAll = async () => {
    try {
      const [{ rules: r }, { alerts: a }] = await Promise.all([fetchRules(), fetchAlerts()]);
      setRules(r);
      setKeywordsText(r.urgencyKeywords.join(', '));
      setCidText(r.criticalCidPrefixes.join(', '));
      setHighRiskMedsText(r.highRiskMedications.join(', '));
      setAlerts(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar regras e alertas.');
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleSaveRules = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rules || !isAdmin) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const payload: TriageRulesConfig = {
        ...rules,
        urgencyKeywords: keywordsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        criticalCidPrefixes: cidText
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
        highRiskMedications: highRiskMedsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
      const { rules: saved } = await updateRules(payload);
      setRules(saved);
      setMessage('Regras clínicas atualizadas e registradas na trilha de auditoria.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar regras.');
    } finally {
      setSaving(false);
    }
  };

  const handleAck = async (alertId: string) => {
    try {
      const { alert } = await acknowledgeAlert(alertId);
      setAlerts((prev) => prev.map((a) => (a.id === alert.id ? alert : a)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao reconhecer alerta.');
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Coluna esquerda: regras clínicas customizáveis de decisão */}
      <div className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-teal-700" />
              <h2 className="text-base font-semibold text-slate-900">
                Fluxo Clínico Customizável (Regras de Decisão)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Ajuste limiares de confiança, destinos de roteamento e gatilhos de urgência sem
              alterar o código-fonte.
            </p>
          </div>
          {!isAdmin && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
              <Lock className="w-3.5 h-3.5" />
              <span>Edição restrita a ADMIN_GESTOR</span>
            </span>
          )}
        </div>

        {rules && (
          <form onSubmit={handleSaveRules} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <label className="font-medium text-slate-700">
                    Limiar Mínimo de Confiança (Auto-Aprovação)
                  </label>
                  <span className="font-mono font-bold text-teal-700 tabular-nums">
                    {(rules.minConfidenceThreshold * 100).toFixed(0)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={0.95}
                  step={0.01}
                  disabled={!isAdmin}
                  value={rules.minConfidenceThreshold}
                  onChange={(e) =>
                    setRules({ ...rules, minConfidenceThreshold: Number(e.target.value) })
                  }
                  className="w-full accent-teal-700"
                />
                <p className="text-xs text-slate-500 mt-0.5">
                  Abaixo deste valor, o grafo desvia para /auditoria_humana.
                </p>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!isAdmin}
                    checked={rules.requireCrmForPrescriptions}
                    onChange={(e) =>
                      setRules({ ...rules, requireCrmForPrescriptions: e.target.checked })
                    }
                    className="rounded accent-teal-700"
                  />
                  <span>Exigir CRM válido em receituários e guias</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!isAdmin}
                    checked={rules.requirePatientName}
                    onChange={(e) => setRules({ ...rules, requirePatientName: e.target.checked })}
                    className="rounded accent-teal-700"
                  />
                  <span>Exigir identificação completa do paciente</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!isAdmin}
                    checked={rules.enableRealTimeAlerts}
                    onChange={(e) =>
                      setRules({ ...rules, enableRealTimeAlerts: e.target.checked })
                    }
                    className="rounded accent-teal-700"
                  />
                  <span>Ativar alertas em tempo real (Plantão / HITL)</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Palavras-chave de Urgência Imediata (separadas por vírgula)
              </label>
              <input
                type="text"
                disabled={!isAdmin}
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md disabled:bg-slate-50"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Prefixos CID-10 Críticos
                </label>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={cidText}
                  onChange={(e) => setCidText(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md disabled:bg-slate-50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Medicamentos de Alto Risco
                </label>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={highRiskMedsText}
                  onChange={(e) => setHighRiskMedsText(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md disabled:bg-slate-50"
                />
              </div>
            </div>

            {/* Mapa de destinos de roteamento por categoria documental */}
            <div className="pt-2 border-t border-slate-200">
              <p className="text-xs font-semibold text-slate-800 mb-2">
                Destinos de Roteamento por Categoria
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {Object.entries(rules.categoryRoutingMap).map(([category, dest]) => (
                  <div key={category} className="flex flex-col gap-1">
                    <label className="text-xs text-slate-600">{category}</label>
                    <input
                      type="text"
                      disabled={!isAdmin}
                      value={dest}
                      onChange={(e) =>
                        setRules({
                          ...rules,
                          categoryRoutingMap: {
                            ...rules.categoryRoutingMap,
                            [category]: e.target.value,
                          },
                        })
                      }
                      className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md disabled:bg-slate-50"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Webhook HTTPS (Slack / n8n / Teams)
                </label>
                <input
                  type="url"
                  disabled={!isAdmin}
                  value={rules.alertWebhookUrl ?? ''}
                  onChange={(e) => setRules({ ...rules, alertWebhookUrl: e.target.value })}
                  placeholder="https://hooks.slack.com/services/..."
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md disabled:bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  E-mail de Plantão Médico
                </label>
                <input
                  type="email"
                  disabled={!isAdmin}
                  value={rules.alertEmailRecipient ?? ''}
                  onChange={(e) => setRules({ ...rules, alertEmailRecipient: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md disabled:bg-slate-50"
                />
              </div>
            </div>

            {message && (
              <div className="p-3 rounded-md border border-emerald-200 bg-emerald-50 text-xs text-emerald-900">
                {message}
              </div>
            )}
            {error && (
              <div className="p-3 rounded-md border border-red-200 bg-red-50 text-xs text-red-700">
                {error}
              </div>
            )}

            {isAdmin && (
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-xs font-medium cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? 'Salvando...' : 'Salvar Regras Clínicas'}</span>
              </button>
            )}
          </form>
        )}
      </div>

      {/* Coluna direita: fila de alertas em tempo real */}
      <div className="xl:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BellRing className="w-4 h-4 text-red-700" />
            <h3 className="text-xs font-semibold text-slate-800">
              Central de Alertas em Tempo Real ({alerts.length})
            </h3>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            Pendentes: {alerts.filter((a) => !a.acknowledged).length}
          </span>
        </div>

        <div className="divide-y divide-slate-200 max-h-[680px] overflow-y-auto">
          {alerts.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              Nenhum alerta crítico ou de segurança disparado até o momento.
            </div>
          ) : (
            alerts.map((al) => (
              <div key={al.id} className="p-4 space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span
                    className={`font-semibold ${
                      al.tipo === 'URGENCIA_MEDICA' || al.tipo === 'SEGURANCA_INJECTION'
                        ? 'text-red-700'
                        : 'text-amber-800'
                    }`}
                  >
                    {al.tipo}
                  </span>
                  <span className="font-mono text-slate-400">
                    {new Date(al.created_at).toLocaleTimeString('pt-BR')}
                  </span>
                </div>
                <p className="text-xs text-slate-800 leading-relaxed">{al.mensagem}</p>
                <div className="flex items-center justify-between gap-2 pt-1 text-xs">
                  <span className="font-mono text-slate-500">
                    {al.canal} · {al.documento_id}
                  </span>
                  {al.acknowledged ? (
                    <span className="text-emerald-700 font-medium">
                      Reconhecido por {al.acknowledged_by}
                    </span>
                  ) : canAckAlert ? (
                    <button
                      type="button"
                      onClick={() => handleAck(al.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium cursor-pointer"
                    >
                      <Check className="w-3 h-3" />
                      <span>Confirmar Ciência</span>
                    </button>
                  ) : (
                    <span className="text-slate-400">Aguardando plantão</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
