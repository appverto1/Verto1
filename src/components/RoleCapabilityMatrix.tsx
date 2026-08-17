import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  MinusCircle,
  RotateCcw,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import {
  CAPABILITY_CATALOG,
  getDefaultCapabilitiesForRole,
  type CapabilityDefinition,
  type ClinicBaseRole,
} from '../constants/authorizationModel';
import {
  moduleAllowsCapability,
  type OrganizationModuleAccessMode,
  type OrganizationModuleKey,
} from '../constants/organizationModules';
import { dataService } from '../services/dataService';

type CanonicalClinicRole = Exclude<ClinicBaseRole, 'supervisor'>;

const ROLE_LABELS: Record<CanonicalClinicRole, string> = {
  director: 'Diretor',
  coordinator: 'Coordenador',
  therapist: 'Profissional',
  receptionist: 'Recepção',
  biller: 'Faturista',
};

const DOMAIN_LABELS: Record<string, string> = {
  clinic: 'Clínica',
  team: 'Equipe',
  patient: 'Pacientes',
  insurance: 'Convênios',
  clinical: 'Prontuário clínico',
  treatment: 'Plano terapêutico',
  treatment_plan: 'Plano terapêutico',
  aba: 'ABA',
  calendar: 'Agenda',
  session: 'Sessões',
  finance: 'Financeiro',
  billing: 'Faturamento e TISS',
  documents: 'Documentos',
  communication: 'Comunicação',
  reports: 'Relatórios',
  school: 'Escolas',
  portal: 'Portal',
};

const ROLES = Object.keys(ROLE_LABELS) as CanonicalClinicRole[];

const normalizeSearch = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

type CapabilityMember = {
  memberId: string;
  membershipId: string;
  name?: string | null;
  email?: string | null;
  role: string;
  defaultEnabled: boolean;
  effectiveEnabled: boolean;
  overrideEffect: 'allow' | 'deny' | null;
  editable: boolean;
  canEnable: boolean;
  canDisable: boolean;
};

type CapabilityAssignmentDialogProps = {
  capability: CapabilityDefinition | null;
  onClose: () => void;
};

function CapabilityAssignmentDialog({ capability, onClose }: CapabilityAssignmentDialogProps) {
  const [members, setMembers] = useState<CapabilityMember[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!capability?.key) return;
    let active = true;
    setLoading(true);
    setError(null);
    setSuccess(null);
    setMembers([]);
    setSelectedIds(new Set());
    void dataService.getClinicCapabilityMembers(capability.key)
      .then((result: any) => {
        if (!active) return;
        if (!result?.success || !Array.isArray(result?.data?.members)) {
          setError(result?.error || 'Não foi possível carregar os profissionais desta clínica.');
          return;
        }
        setMembers(result.data.members as CapabilityMember[]);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar os profissionais desta clínica.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [capability?.key]);

  const filteredMembers = useMemo(() => {
    const query = normalizeSearch(search);
    if (!query) return members;
    return members.filter((member) =>
      normalizeSearch(`${member.name || ''} ${member.email || ''} ${ROLE_LABELS[member.role as keyof typeof ROLE_LABELS] || member.role}`).includes(query),
    );
  }, [members, search]);

  const selectableIds = useMemo(
    () => filteredMembers.filter((member) => member.editable).map((member) => member.memberId),
    [filteredMembers],
  );

  if (!capability) return null;

  const toggleMember = (memberId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  };

  const toggleAllVisible = () => {
    const allSelected = selectableIds.length > 0 && selectableIds.every((memberId) => selectedIds.has(memberId));
    setSelectedIds((current) => {
      const next = new Set(current);
      selectableIds.forEach((memberId) => {
        if (allSelected) next.delete(memberId);
        else next.add(memberId);
      });
      return next;
    });
  };

  const applyEffect = async (effect: 'allow' | 'deny' | null) => {
    if (saving || selectedIds.size === 0) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const memberIds = Array.from(selectedIds);
      const result: any = await dataService.updateClinicCapabilityMembers(
        capability.key,
        memberIds,
        effect,
        reason.trim() || undefined,
      );
      if (!result?.success) {
        setError(result?.error || 'Não foi possível atualizar os acessos selecionados.');
        return;
      }
      const changed = new Set(memberIds);
      setMembers((current) => current.map((member) => {
        if (!changed.has(member.memberId)) return member;
        return {
          ...member,
          overrideEffect: effect,
          effectiveEnabled: effect === 'allow' ? true : effect === 'deny' ? false : member.defaultEnabled,
        };
      }));
      setSelectedIds(new Set());
      setSuccess(
        effect === 'allow'
          ? 'Acesso concedido e registrado no log de autorização.'
          : effect === 'deny'
            ? 'Acesso bloqueado e registrado no log de autorização.'
            : 'Acesso restaurado ao padrão do cargo e registrado no log de autorização.',
      );
    } finally {
      setSaving(false);
    }
  };

  const allVisibleSelected = selectableIds.length > 0 && selectableIds.every((memberId) => selectedIds.has(memberId));

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 p-3 md:p-6">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 md:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-violet-700">
              <ShieldCheck size={18} />
              <span className="text-xs font-semibold uppercase tracking-[0.12em]">Gerenciar acesso</span>
            </div>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">{capability.label}</h2>
            <p className="mt-1 text-sm font-normal text-slate-500">
              Selecione um ou mais profissionais. A alteração é persistida por vínculo e auditada individualmente.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Fechar gerenciamento de acesso">
            <X size={20} />
          </button>
        </div>

        <div className="grid gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4 md:grid-cols-[1fr_1fr] md:px-6">
          <label className="relative block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar profissional, e-mail ou papel"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm font-normal outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-500/10"
            />
          </label>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder="Motivo da alteração (opcional)"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-500/10"
          />
        </div>

        {error && <div className="mx-5 mt-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-normal text-rose-700 md:mx-6">{error}</div>}
        {success && <div className="mx-5 mt-4 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-normal text-emerald-700 md:mx-6">{success}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 md:px-6">
          {loading ? (
            <div className="flex min-h-44 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="animate-spin" size={18} /> Carregando equipe...</div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-normal text-slate-600">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} disabled={selectableIds.length === 0 || saving} />
                  Selecionar profissionais visíveis
                </label>
                <span className="text-xs font-normal text-slate-400">{selectedIds.size} selecionado(s)</span>
              </div>
              <div className="divide-y divide-slate-100">
                {filteredMembers.map((member) => {
                  const roleLabel = ROLE_LABELS[member.role as keyof typeof ROLE_LABELS] || member.role || 'Equipe';
                  const explicitLabel = member.overrideEffect === 'allow'
                    ? 'Concedido individualmente'
                    : member.overrideEffect === 'deny'
                      ? 'Bloqueado individualmente'
                      : 'Padrão do cargo';
                  return (
                    <label key={member.memberId} className={`flex items-center gap-3 px-4 py-3 ${member.editable ? 'cursor-pointer hover:bg-slate-50' : 'bg-slate-50/60'}`}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(member.memberId)}
                        onChange={() => toggleMember(member.memberId)}
                        disabled={!member.editable || saving}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">{member.name || member.email || 'Profissional'}</p>
                        <p className="mt-0.5 truncate text-xs font-normal text-slate-500">{roleLabel}{member.email ? ` · ${member.email}` : ''}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium ${member.effectiveEnabled ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500'}`}>
                          {member.effectiveEnabled ? <CheckCircle2 size={11} /> : <MinusCircle size={11} />}
                          {member.effectiveEnabled ? 'Com acesso' : 'Sem acesso'}
                        </span>
                        <p className="mt-1 text-[10px] font-normal text-slate-400">{member.editable ? explicitLabel : 'Não delegável por você'}</p>
                      </div>
                    </label>
                  );
                })}
                {filteredMembers.length === 0 && (
                  <div className="px-4 py-10 text-center text-sm font-normal text-slate-500">Nenhum profissional encontrado.</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4 md:px-6">
          <button type="button" disabled={saving || selectedIds.size === 0} onClick={() => void applyEffect(null)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
            <RotateCcw size={15} /> Usar padrão
          </button>
          <button type="button" disabled={saving || selectedIds.size === 0} onClick={() => void applyEffect('deny')} className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40">
            Bloquear
          </button>
          <button type="button" disabled={saving || selectedIds.size === 0} onClick={() => void applyEffect('allow')} className="rounded-xl bg-[#7a32fc] px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
            {saving ? 'Salvando...' : 'Conceder acesso'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function RoleCapabilityMatrix({
  moduleAccessMode = 'legacy_full',
  organizationModules = new Set<OrganizationModuleKey>(),
  canManagePermissions = false,
}: {
  moduleAccessMode?: OrganizationModuleAccessMode;
  organizationModules?: ReadonlySet<OrganizationModuleKey>;
  canManagePermissions?: boolean;
}) {
  const [selectedCapability, setSelectedCapability] = useState<CapabilityDefinition | null>(null);
  const visibleCatalog = useMemo(
    () => CAPABILITY_CATALOG.filter((item) => moduleAllowsCapability(moduleAccessMode, organizationModules, item.key)),
    [moduleAccessMode, organizationModules],
  );
  const sections = Array.from(new Set(visibleCatalog.map((item) => item.domain)));
  const defaults = new Map(ROLES.map((role) => [role, getDefaultCapabilitiesForRole(role)]));

  return (
    <>
      <section className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm md:p-8">
        <div className="mb-8">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Acessos padrão da equipe</h2>
          <p className="mt-2 text-sm font-normal text-slate-500">
            O quadro mostra o padrão de cada papel. Em cada acesso, você pode conceder, bloquear ou restaurar o padrão para um ou vários profissionais sem alterar o cargo deles.
          </p>
        </div>

        <div className="space-y-8">
          {sections.map((domain) => {
            const items = visibleCatalog.filter((item) => item.domain === domain);
            return (
              <div key={domain} className="overflow-hidden rounded-[28px] border border-slate-100">
                <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
                  <h3 className="font-semibold text-slate-900">{DOMAIN_LABELS[domain] || domain}</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1040px]">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="px-5 py-4 text-left text-[10px] font-medium uppercase tracking-widest text-slate-400">Acesso</th>
                        {ROLES.map((role) => (
                          <th key={role} className="px-4 py-4 text-left text-[10px] font-medium uppercase tracking-widest text-slate-400">
                            {ROLE_LABELS[role]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((item) => (
                        <tr key={item.key}>
                          <td className="px-5 py-4 align-top">
                            <p className="text-sm font-medium text-slate-900">{item.label}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {item.sensitive && <span className="text-xs font-normal text-amber-600">Ação sensível</span>}
                              {item.delegable && canManagePermissions ? (
                                <button
                                  type="button"
                                  onClick={() => setSelectedCapability(item)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-100 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-700 transition hover:bg-violet-100"
                                >
                                  <Users size={13} /> Gerenciar profissionais
                                </button>
                              ) : (
                                <span className="text-[11px] font-normal text-slate-400">{item.delegable ? 'Somente leitura' : 'Acesso estrutural'}</span>
                              )}
                            </div>
                          </td>
                          {ROLES.map((role) => {
                            const allowed = defaults.get(role)?.has(item.key) === true;
                            return (
                              <td key={role} className="px-4 py-4 align-top">
                                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${allowed ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
                                  {allowed ? <CheckCircle2 size={12} /> : <MinusCircle size={12} />}
                                  {allowed ? 'Incluído' : 'Não incluído'}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <CapabilityAssignmentDialog capability={selectedCapability} onClose={() => setSelectedCapability(null)} />
    </>
  );
}
