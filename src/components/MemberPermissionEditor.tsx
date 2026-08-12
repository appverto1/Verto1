import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, RotateCcw, Search, ShieldCheck, X } from 'lucide-react';
import { dataService } from '../services/dataService';

export type PermissionEditorMember = {
  id: string;
  name?: string;
  email?: string;
  role?: string;
};

type PermissionItem = {
  key: string;
  label: string;
  domain: string;
  sensitive?: boolean;
  defaultEnabled: boolean;
  effectiveEnabled: boolean;
  overrideEffect: 'allow' | 'deny' | null;
  editable: boolean;
  canEnable?: boolean;
  canDisable?: boolean;
  scopeLimited?: boolean;
};

type AuthorizationPayload = {
  memberId: string;
  membershipId: string;
  role: string;
  scopes: string[];
  catalog: PermissionItem[];
};

const DOMAIN_LABELS: Record<string, string> = {
  clinic: 'Unidade / clínica',
  team: 'Equipe',
  patient: 'Pacientes',
  insurance: 'Convênios',
  clinical: 'Prontuário',
  treatment: 'Plano terapêutico',
  school: 'Escolas e ambiente escolar',
  aba: 'ABA',
  calendar: 'Agenda',
  session: 'Sessão',
  finance: 'Financeiro',
  billing: 'Faturamento / TISS',
  documents: 'Documentos',
  communication: 'Comunicação',
  reports: 'Relatórios',
};

const ROLE_LABELS: Record<string, string> = {
  director: 'Diretor',
  coordinator: 'Coordenador',
  supervisor: 'Supervisor',
  therapist: 'Profissional de atendimento',
  receptionist: 'Recepcionista/Assistente',
  biller: 'Faturista',
};

const SCOPE_LABELS: Record<string, string> = {
  ACTIVE_CLINIC: 'esta unidade',
  AUTHORIZED_CLINICS: 'unidades autorizadas',
  ASSIGNED_PATIENTS: 'pacientes vinculados',
  SUPERVISED_CASES: 'casos sob supervisão',
  OWN_RESOURCES: 'próprios registros',
  BILLING_SCOPE: 'somente dados necessários ao faturamento',
  SELF_OR_DEPENDENTS: 'próprios dados e dependentes',
  PLATFORM: 'administração da plataforma',
};

const humanizeScopes = (scopes: string[] = []) => {
  const labels = scopes.map((scope) => SCOPE_LABELS[scope]).filter(Boolean);
  if (!labels.length) return '';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} e ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`;
};

const normalizeSearch = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export function MemberPermissionEditor({
  member,
  onClose,
}: {
  member: PermissionEditorMember | null;
  onClose: () => void;
}) {
  const [authorization, setAuthorization] = useState<AuthorizationPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [showUnavailable, setShowUnavailable] = useState(false);

  useEffect(() => {
    if (!member?.id) return;
    let active = true;
    setLoading(true);
    setError(null);
    setAuthorization(null);
    void dataService.getClinicMemberAuthorization(member.id)
      .then((result: any) => {
        if (!active) return;
        if (!result?.success || !result?.data) {
          setError(result?.error || 'Não foi possível carregar as permissões deste membro.');
          return;
        }
        setAuthorization(result.data as AuthorizationPayload);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar as permissões deste membro.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [member?.id]);

  const unavailableCount = useMemo(
    () => (authorization?.catalog || []).filter((item) => item.scopeLimited && !item.effectiveEnabled && item.canEnable === false).length,
    [authorization?.catalog],
  );

  const filteredGroups = useMemo(() => {
    const query = normalizeSearch(search);
    const items = (authorization?.catalog || []).filter((item) => {
      const unavailableForRole = item.scopeLimited && !item.effectiveEnabled && item.canEnable === false;
      if (!showUnavailable && unavailableForRole) return false;
      if (!query) return true;
      return normalizeSearch(`${item.label} ${item.key} ${DOMAIN_LABELS[item.domain] || item.domain}`).includes(query);
    });
    const grouped = new Map<string, PermissionItem[]>();
    for (const item of items) {
      const current = grouped.get(item.domain) || [];
      current.push(item);
      grouped.set(item.domain, current);
    }
    return Array.from(grouped.entries());
  }, [authorization?.catalog, search, showUnavailable]);

  if (!member) return null;

  const updatePermission = async (item: PermissionItem, nextEnabled: boolean) => {
    if (!item.editable || savingKey) return;
    const nextEffect: 'allow' | 'deny' | null =
      nextEnabled === item.defaultEnabled
        ? null
        : nextEnabled
          ? 'allow'
          : 'deny';

    setSavingKey(item.key);
    setError(null);
    try {
      const result: any = await dataService.updateClinicMemberPermissionOverride(
        member.id,
        item.key,
        nextEffect,
        reason.trim() || undefined,
      );
      if (!result?.success) {
        setError(result?.error || 'Não foi possível atualizar esta permissão.');
        return;
      }
      setAuthorization((current) => {
        if (!current) return current;
        return {
          ...current,
          catalog: current.catalog.map((candidate) =>
            candidate.key === item.key
              ? {
                  ...candidate,
                  effectiveEnabled: result?.data?.effectiveEnabled === true,
                  overrideEffect: nextEffect,
                }
              : candidate,
          ),
        };
      });
    } finally {
      setSavingKey(null);
    }
  };

  const resetPermission = async (item: PermissionItem) => {
    if (!item.editable || !item.overrideEffect || savingKey) return;
    setSavingKey(item.key);
    setError(null);
    try {
      const result: any = await dataService.updateClinicMemberPermissionOverride(
        member.id,
        item.key,
        null,
        reason.trim() || undefined,
      );
      if (!result?.success) {
        setError(result?.error || 'Não foi possível restaurar o padrão desta permissão.');
        return;
      }
      setAuthorization((current) => {
        if (!current) return current;
        return {
          ...current,
          catalog: current.catalog.map((candidate) =>
            candidate.key === item.key
              ? {
                  ...candidate,
                  effectiveEnabled: candidate.defaultEnabled,
                  overrideEffect: null,
                }
              : candidate,
          ),
        };
      });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/40 p-3 md:p-6">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 md:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-violet-700">
              <ShieldCheck size={18} />
              <span className="text-xs font-semibold uppercase tracking-[0.12em]">Acessos do profissional</span>
            </div>
            <h2 className="mt-2 truncate text-xl font-semibold text-slate-900">{member.name || member.email || 'Membro da equipe'}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {ROLE_LABELS[authorization?.role || member.role || ''] || authorization?.role || member.role || 'Equipe'}
              {authorization?.scopes?.length ? ` · Acesso limitado a ${humanizeScopes(authorization.scopes)}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Fechar acessos"
          >
            <X size={20} />
          </button>
        </div>

        <div className="grid gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4 md:grid-cols-[1fr_1fr] md:px-6">
          <label className="relative block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar acesso ou função"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-500/10"
            />
          </label>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder="Motivo da alteração (opcional)"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-500/10"
          />
        </div>

        {unavailableCount > 0 && (
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-white px-5 py-2.5 text-xs md:px-6">
            <span className="text-slate-500">
              Mostrando apenas os acessos que podem ser usados por este perfil.
            </span>
            <button
              type="button"
              onClick={() => setShowUnavailable((current) => !current)}
              className="shrink-0 font-semibold text-violet-700 hover:text-violet-800"
            >
              {showUnavailable ? 'Ocultar indisponíveis' : `Mostrar indisponíveis (${unavailableCount})`}
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">
          {loading ? (
            <div className="py-16 text-center text-sm text-slate-500">Carregando permissões…</div>
          ) : error && !authorization ? (
            <div className="flex items-start gap-3 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
              <AlertCircle className="mt-0.5 shrink-0" size={18} />
              <span>{error}</span>
            </div>
          ) : (
            <div className="space-y-6">
              {error && (
                <div className="flex items-start gap-3 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 shrink-0" size={18} />
                  <span>{error}</span>
                </div>
              )}

              {filteredGroups.map(([domain, items]) => (
                <section key={domain}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                      {DOMAIN_LABELS[domain] || domain}
                    </h3>
                    <span className="text-[11px] text-slate-400">{items.length} opções</span>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
                    {items.map((item) => {
                      const saving = savingKey === item.key;
                      const canToggle = item.effectiveEnabled
                        ? item.canDisable !== false
                        : item.canEnable !== false;
                      return (
                        <div
                          key={item.key}
                          className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3.5 last:border-b-0 md:flex-row md:items-center md:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-slate-800">{item.label}</p>
                              {item.sensitive && (
                                <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Acesso sensível</span>
                              )}
                              {item.overrideEffect && (
                                <span className="rounded-md bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">Ajuste individual</span>
                              )}
                              {item.scopeLimited && !item.effectiveEnabled && (
                                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">Não disponível para este perfil</span>
                              )}
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            {item.overrideEffect && (
                              <button
                                type="button"
                                onClick={() => void resetPermission(item)}
                                disabled={!item.editable || Boolean(savingKey)}
                                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <RotateCcw size={13} /> Usar padrão do perfil
                              </button>
                            )}
                            <label className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 ${item.effectiveEnabled ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'} ${!item.editable || !canToggle ? 'opacity-50' : ''}`}>
                              <input
                                type="checkbox"
                                checked={item.effectiveEnabled}
                                disabled={!item.editable || !canToggle || Boolean(savingKey)}
                                onChange={(event) => void updatePermission(item, event.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
                              />
                              <span className={`text-xs font-semibold ${item.effectiveEnabled ? 'text-emerald-700' : 'text-slate-500'}`}>
                                {saving ? 'Salvando…' : item.effectiveEnabled ? 'Liberado' : 'Sem acesso'}
                              </span>
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}

              {!loading && filteredGroups.length === 0 && (
                <div className="py-12 text-center text-sm text-slate-500">Nenhum acesso encontrado.</div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 bg-white px-5 py-3 text-xs leading-5 text-slate-500 md:px-6">
          O perfil profissional define os acessos iniciais. Mudanças feitas aqui valem somente para este membro da equipe. Algumas opções permanecem indisponíveis quando não fazem parte das responsabilidades desse perfil ou do vínculo dele com a clínica.
        </div>
      </div>
    </div>
  );
}
