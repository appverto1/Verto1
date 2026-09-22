import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CalendarClock, Camera, CheckCircle2, ClipboardList, Library, Loader2, Plus, Save, X } from "lucide-react";
import { BillingTissSettingsPanel } from "./BillingTissSettingsPanel";
import { RoleCapabilityMatrix } from "./RoleCapabilityMatrix";
import { SubscriptionDiscountSummary } from "./SubscriptionDiscountSummary";
import { SecureImage } from "./SecureMedia";
import { dataService } from "../services/dataService";
import { normalizeAbaPromptTypeConfig, type AbaPromptTypeConfig } from "../utils/abaPromptLevels";
import { formatDocument, maskCep, maskPhoneBR, onlyDigits, parseDocumentForStorage } from "../utils/brMasks";
import { hasOrganizationModule, type OrganizationModuleAccessMode, type OrganizationModuleKey } from "../constants/organizationModules";
import { isAbaV2Enabled, isAbaV3UiEnabled } from "../utils/featureFlags";
import {
  PROFESSIONAL_COUNCIL_OPTIONS,
  formatProfessionalCouncil,
  formatProfessionalRegistry,
  getProfessionalRegistryGuidance,
  getProfessionalRegistryPlaceholder,
  isNoFormalCouncil,
} from "../utils/professionalRegistry";
import {
  BRAZIL_CLINIC_TIME_ZONE_OPTIONS,
  inferBrazilClinicTimeZoneFromState,
} from "../utils/clinicTimeZone";

type SettingsValues = Record<string, any>;
type SaveActionResult = boolean | { success?: boolean } | void;

type ClinicGlobalSettingsPanelProps = {
  mode: "professional" | "clinic";
  isTherapist: boolean;
  currentUserId: string;
  canEditAnamnesisTemplate: boolean;
  loadingAnamnesisTemplate: boolean;
  onOpenAnamnesisTemplate: () => void;
  canManageClinicSettings: boolean;
  canManageBilling: boolean;
  canManagePermissions: boolean;
  normalizedPlanName: string;
  hasInsuranceTissModule: boolean;
  moduleAccessMode: OrganizationModuleAccessMode;
  organizationModules: ReadonlySet<OrganizationModuleKey>;
  navigateToTab: (tab: string) => void;
  onSave: () => SaveActionResult | Promise<SaveActionResult>;
  values: SettingsValues;
  setters: Record<string, (value: any) => void>;
  readImageAsDataUrl: (file: File, onDone: (result: string) => void) => void;
  retryMediaIfBroken: (kind: "signature" | "profile" | "logo") => void | Promise<void>;
};

const inputClass =
  "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-normal text-slate-800 outline-none transition-all focus:border-[#7a32fc]/40 focus:ring-2 focus:ring-[#7a32fc]/10";
const labelClass = "block text-xs font-medium text-slate-600";
const BRAZILIAN_UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
];

function StatusBadge({ complete, hasAnyData }: { complete: boolean; hasAnyData: boolean }) {
  const label = complete ? "Completo" : hasAnyData ? "Pendente" : "Incompleto";
  const className = complete
    ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
    : hasAnyData
      ? "bg-amber-50 text-amber-700 ring-amber-100"
      : "bg-slate-100 text-slate-500 ring-slate-200";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${className}`}>
      {complete ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
      {label}
    </span>
  );
}

function SectionCard({
  id,
  title,
  description,
  complete,
  hasAnyData,
  children,
}: {
  id?: string;
  title: string;
  description: string;
  complete: boolean;
  hasAnyData: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-base font-semibold text-slate-900">{title}</h4>
          <p className="mt-1 text-sm font-normal text-slate-500">{description}</p>
        </div>
        <StatusBadge complete={complete} hasAnyData={hasAnyData} />
      </div>
      {children}
    </section>
  );
}

function SaveButton({
  children,
  onSave,
  feedback = false,
}: {
  children: React.ReactNode;
  onSave: () => SaveActionResult | Promise<SaveActionResult>;
  feedback?: boolean;
}) {
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved'>('idle');
  const inFlightRef = useRef(false);
  const resetTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
  }, []);

  const handleSave = async () => {
    if (!feedback) {
      void onSave();
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setPhase('saving');
    try {
      const result = await onSave();
      if (!mountedRef.current) return;
      const succeeded = result === true || (typeof result === 'object' && result !== null && result.success === true);
      if (!succeeded) {
        setPhase('idle');
        return;
      }
      setPhase('saved');
      resetTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current) setPhase('idle');
        resetTimerRef.current = null;
      }, 2000);
    } catch {
      if (mountedRef.current) setPhase('idle');
    } finally {
      inFlightRef.current = false;
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleSave()}
      disabled={feedback && phase === 'saving'}
      className="rounded-xl bg-[#7a32fc] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
    >
      {feedback ? (
        <span className="inline-flex items-center gap-2" aria-live="polite">
          {phase === 'saving' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : phase === 'saved' ? <CheckCircle2 size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
          {phase === 'saving' ? 'Salvando...' : phase === 'saved' ? 'Salvo' : children}
        </span>
      ) : children}
    </button>
  );
}

const PROFESSIONAL_WEEKDAYS = [
  ['monday', 'Segunda'],
  ['tuesday', 'Terça'],
  ['wednesday', 'Quarta'],
  ['thursday', 'Quinta'],
  ['friday', 'Sexta'],
  ['saturday', 'Sábado'],
  ['sunday', 'Domingo'],
] as const;

const defaultProfessionalSchedule = () => ({
  active: true,
  stepMinutes: 50,
  defaultSessionDurationMinutes: 50,
  minLeadMinutes: 120,
  maxSlotsPerDay: 8,
  sessionBufferMinutes: 0,
  days: Object.fromEntries(PROFESSIONAL_WEEKDAYS.map(([key], index) => [
    key,
    {
      enabled: index < 5,
      periods: [{ start: '08:00', end: '18:00' }],
      intervals: [],
    },
  ])),
  exceptions: [],
});

const normalizeProfessionalSchedule = (value: any) => {
  const fallback = defaultProfessionalSchedule();
  const source = value && typeof value === 'object' ? value : {};
  const sourceDays = source.days && typeof source.days === 'object' ? source.days : {};
  return {
    ...fallback,
    ...source,
    active: source.active !== false,
    stepMinutes: Number(source.stepMinutes ?? source.step_minutes ?? source.defaultSessionDurationMinutes ?? 50) || 50,
    defaultSessionDurationMinutes: Number(source.defaultSessionDurationMinutes ?? source.default_session_duration_minutes ?? source.stepMinutes ?? 50) || 50,
    sessionBufferMinutes: Math.max(0, Number(source.sessionBufferMinutes ?? source.session_buffer_minutes ?? 0) || 0),
    days: Object.fromEntries(PROFESSIONAL_WEEKDAYS.map(([key], index) => {
      const existing = sourceDays[key] && typeof sourceDays[key] === 'object' ? sourceDays[key] : {};
      const periods = Array.isArray(existing.periods) && existing.periods.length > 0
        ? existing.periods.map((period: any) => ({
            start: String(period?.start || '08:00').slice(0, 5),
            end: String(period?.end || '18:00').slice(0, 5),
          }))
        : [{ start: '08:00', end: '18:00' }];
      return [key, {
        ...fallback.days[key],
        ...existing,
        enabled: typeof existing.enabled === 'boolean' ? existing.enabled : index < 5,
        periods,
        intervals: Array.isArray(existing.intervals) ? existing.intervals : [],
      }];
    })),
    exceptions: Array.isArray(source.exceptions) ? source.exceptions : [],
  };
};

function ProfessionalScheduleSettings({ memberId }: { memberId: string }) {
  const [schedule, setSchedule] = useState<any>(() => defaultProfessionalSchedule());
  const [state, setState] = useState({ loading: true, saving: false, configured: false, error: '', message: '' });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!memberId) {
        setState({ loading: false, saving: false, configured: false, error: 'Não foi possível identificar o profissional.', message: '' });
        return;
      }
      setState((current) => ({ ...current, loading: true, error: '', message: '' }));
      const result = await dataService.getMemberWorkSchedule(memberId);
      if (cancelled) return;
      if (!result?.success) {
        setState({ loading: false, saving: false, configured: false, error: result?.message || result?.error || 'Não foi possível carregar sua disponibilidade.', message: '' });
        return;
      }
      setSchedule(normalizeProfessionalSchedule(result?.data?.workSchedule));
      setState({ loading: false, saving: false, configured: result?.data?.configured === true, error: '', message: '' });
    };
    void load();
    return () => { cancelled = true; };
  }, [memberId]);

  const updateDay = (dayKey: string, patch: Record<string, any>) => {
    setSchedule((current: any) => ({
      ...current,
      days: {
        ...current.days,
        [dayKey]: {
          ...current.days[dayKey],
          ...patch,
        },
      },
    }));
  };

  const updatePeriod = (dayKey: string, periodIndex: number, field: 'start' | 'end', value: string) => {
    setSchedule((current: any) => {
      const currentDay = current.days[dayKey] || {};
      const periods = Array.isArray(currentDay.periods) && currentDay.periods.length > 0
        ? [...currentDay.periods]
        : [{ start: '08:00', end: '18:00' }];
      periods[periodIndex] = { ...periods[periodIndex], [field]: value };
      return {
        ...current,
        days: {
          ...current.days,
          [dayKey]: { ...currentDay, periods },
        },
      };
    });
  };

  const addPeriod = (dayKey: string) => {
    setSchedule((current: any) => {
      const currentDay = current.days[dayKey] || {};
      const periods = Array.isArray(currentDay.periods) ? [...currentDay.periods] : [];
      if (periods.length >= 3) return current;
      const lastEnd = String(periods[periods.length - 1]?.end || '12:00').slice(0, 5);
      periods.push({ start: lastEnd, end: lastEnd < '18:00' ? '18:00' : '20:00' });
      return {
        ...current,
        days: {
          ...current.days,
          [dayKey]: { ...currentDay, periods },
        },
      };
    });
  };

  const removePeriod = (dayKey: string, periodIndex: number) => {
    setSchedule((current: any) => {
      const currentDay = current.days[dayKey] || {};
      const periods = (Array.isArray(currentDay.periods) ? currentDay.periods : [])
        .filter((_: any, index: number) => index !== periodIndex);
      return {
        ...current,
        days: {
          ...current.days,
          [dayKey]: {
            ...currentDay,
            periods: periods.length > 0 ? periods : [{ start: '08:00', end: '18:00' }],
          },
        },
      };
    });
  };

  const saveSchedule = async () => {
    if (state.saving || state.loading) return;
    const enabledDays = PROFESSIONAL_WEEKDAYS.filter(([key]) => schedule?.days?.[key]?.enabled);
    if (enabledDays.length === 0) {
      setState((current) => ({ ...current, error: 'Selecione ao menos um dia de trabalho.', message: '' }));
      return;
    }
    const invalidDay = enabledDays.find(([key]) => {
      const periods = Array.isArray(schedule?.days?.[key]?.periods) ? schedule.days[key].periods : [];
      if (periods.length === 0) return true;
      const ordered = [...periods].sort((left: any, right: any) => String(left?.start || '').localeCompare(String(right?.start || '')));
      return ordered.some((period: any, index: number) => (
        !period?.start
        || !period?.end
        || period.start >= period.end
        || (index > 0 && ordered[index - 1]?.end > period.start)
      ));
    });
    if (invalidDay) {
      setState((current) => ({ ...current, error: 'Revise os horários: cada período precisa ter início, fim e não pode se sobrepor a outro.', message: '' }));
      return;
    }
    setState((current) => ({ ...current, saving: true, error: '', message: '' }));
    const result = await dataService.updateMemberWorkSchedule(memberId, schedule);
    if (!result?.success) {
      setState((current) => ({
        ...current,
        saving: false,
        error: result?.message || result?.error || 'Não foi possível salvar sua disponibilidade.',
        message: '',
      }));
      return;
    }
    setSchedule(normalizeProfessionalSchedule(result?.data?.workSchedule || schedule));
    setState({ loading: false, saving: false, configured: true, error: '', message: 'Disponibilidade atualizada para esta clínica.' });
  };

  return (
    <SectionCard
      title="Disponibilidade nesta clínica"
      description="Defina os dias e horários em que você atende neste vínculo. A agenda usa estas informações para evitar conflitos entre clínicas."
      complete={state.configured}
      hasAnyData={Boolean(schedule)}
    >
      {state.loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 size={17} className="animate-spin" /> Carregando disponibilidade...</div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {PROFESSIONAL_WEEKDAYS.map(([key, label]) => {
              const enabled = Boolean(schedule?.days?.[key]?.enabled);
              return (
                <button key={key} type="button" onClick={() => updateDay(key, { enabled: !enabled })} className={`min-h-10 rounded-xl border px-4 text-sm font-medium transition ${enabled ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-500'}`}>
                  {label}
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {PROFESSIONAL_WEEKDAYS.filter(([key]) => schedule?.days?.[key]?.enabled).map(([key, label]) => {
              const periods = Array.isArray(schedule?.days?.[key]?.periods) && schedule.days[key].periods.length > 0 ? schedule.days[key].periods : [{ start: '08:00', end: '18:00' }];
              return (
                <div key={key} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-800">{label}</p>
                    <button type="button" onClick={() => addPeriod(key)} disabled={periods.length >= 3} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-40"><Plus size={13} /> Adicionar período</button>
                  </div>
                  <div className="mt-3 space-y-3">
                    {periods.map((period: any, periodIndex: number) => (
                      <div key={`${key}-${periodIndex}`} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                        <label className={labelClass}>Início<input type="time" value={period.start} onChange={(event) => updatePeriod(key, periodIndex, 'start', event.target.value)} className={inputClass} /></label>
                        <label className={labelClass}>Fim<input type="time" value={period.end} onChange={(event) => updatePeriod(key, periodIndex, 'end', event.target.value)} className={inputClass} /></label>
                        <button type="button" onClick={() => removePeriod(key, periodIndex)} disabled={periods.length === 1} aria-label={`Remover período de ${label}`} className="mb-0.5 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 hover:border-rose-200 hover:text-rose-600 disabled:opacity-30"><X size={16} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className={labelClass}>Duração padrão da sessão<select value={String(schedule.defaultSessionDurationMinutes || 50)} onChange={(event) => setSchedule((current: any) => ({ ...current, stepMinutes: Number(event.target.value), defaultSessionDurationMinutes: Number(event.target.value) }))} className={inputClass}>{[30, 45, 50, 60, 90].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutos</option>)}</select></label>
            <label className={labelClass}>Intervalo entre atendimentos<select value={String(schedule.sessionBufferMinutes || 0)} onChange={(event) => setSchedule((current: any) => ({ ...current, sessionBufferMinutes: Number(event.target.value) }))} className={inputClass}>{[0, 5, 10, 15, 20, 30].map((minutes) => <option key={minutes} value={minutes}>{minutes === 0 ? 'Sem intervalo' : `${minutes} minutos`}</option>)}</select></label>
          </div>
          {state.error && <p role="alert" className="text-sm text-rose-600">{state.error}</p>}
          {state.message && <p role="status" className="text-sm text-emerald-700">{state.message}</p>}
          <div className="flex justify-end"><button type="button" onClick={() => void saveSchedule()} disabled={state.saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#7a32fc] px-5 text-sm font-semibold text-white disabled:opacity-50">{state.saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{state.saving ? 'Salvando...' : 'Salvar disponibilidade'}</button></div>
        </div>
      )}
    </SectionCard>
  );
}

function PatientReschedulePolicySettings() {
  const [state, setState] = useState({
    loading: true,
    savingReschedule: false,
    savingAttendance: false,
    allowPatientReschedule: true,
    autoNoShowEnabled: true,
    noShowToleranceMinutes: 30,
    noShowMode: "AUTO" as "AUTO" | "REVIEW",
    attendanceDirty: false,
    canManage: false,
    error: "",
    message: ""
  });
  const [attendanceSaved, setAttendanceSaved] = useState(false);
  const attendanceSavedTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const idempotencyKeys = useRef(new Map<string, string>());

  const getIdempotencyKey = (operationKey: string) => {
    const existing = idempotencyKeys.current.get(operationKey);
    if (existing) return existing;
    const generated = globalThis.crypto?.randomUUID?.() || `clinic-policy-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
    idempotencyKeys.current.set(operationKey, generated);
    return generated;
  };

  useEffect(() => {
    let cancelled = false;
    void dataService.getClinicAppointmentPolicy().then((result: any) => {
      if (cancelled) return;
      if (!result?.success) {
        setState((current) => ({ ...current, loading: false, error: result?.message || result?.error || "Não foi possível carregar esta configuração." }));
        return;
      }
      setState({ loading: false, savingReschedule: false, savingAttendance: false, allowPatientReschedule: result?.data?.allowPatientReschedule !== false, autoNoShowEnabled: result?.data?.autoNoShowEnabled !== false, noShowToleranceMinutes: Math.max(5, Math.min(180, Number(result?.data?.noShowToleranceMinutes || 30))), noShowMode: result?.data?.noShowMode === "REVIEW" ? "REVIEW" : "AUTO", attendanceDirty: false, canManage: result?.data?.canManage === true, error: "", message: "" });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    mountedRef.current = false;
    if (attendanceSavedTimerRef.current) window.clearTimeout(attendanceSavedTimerRef.current);
  }, []);

  const updateReschedulePolicy = async () => {
    if (state.loading || state.savingReschedule || state.savingAttendance || !state.canManage) return;
    const nextValue = !state.allowPatientReschedule;
    const confirmed = window.confirm(nextValue ? "Reativar novas solicitações de reagendamento feitas por pacientes?" : "Desativar novas solicitações de reagendamento feitas por pacientes? Solicitações antigas serão preservadas.");
    if (!confirmed) return;
    const operationKey = `reschedule:${nextValue}`;
    setState((current) => ({ ...current, savingReschedule: true, error: "", message: "" }));
    const result = await dataService.updateClinicAppointmentPolicy({ allowPatientReschedule: nextValue, reason: nextValue ? "Reativado nas configurações da agenda" : "Desativado nas configurações da agenda", idempotencyKey: getIdempotencyKey(operationKey) });
    if (!result?.success) {
      setState((current) => ({ ...current, savingReschedule: false, error: result?.message || result?.error || "Não foi possível salvar esta configuração." }));
      return;
    }
    idempotencyKeys.current.delete(operationKey);
    setState((current) => ({ ...current, savingReschedule: false, allowPatientReschedule: result?.data?.allowPatientReschedule !== false, error: "", message: nextValue ? "Pacientes voltaram a poder solicitar reagendamento." : "Novas solicitações de pacientes foram desativadas. O histórico foi mantido." }));
  };

  const saveAttendancePolicy = async () => {
    if (state.loading || state.savingReschedule || state.savingAttendance || !state.canManage) return;
    if (attendanceSavedTimerRef.current) {
      window.clearTimeout(attendanceSavedTimerRef.current);
      attendanceSavedTimerRef.current = null;
    }
    setAttendanceSaved(false);
    const tolerance = Number(state.noShowToleranceMinutes);
    if (!Number.isInteger(tolerance) || tolerance < 5 || tolerance > 180) {
      setState((current) => ({ ...current, error: "Informe uma tolerância inteira entre 5 e 180 minutos.", message: "" }));
      return;
    }
    const operationKey = `attendance:${state.autoNoShowEnabled}:${tolerance}:${state.noShowMode}`;
    setState((current) => ({ ...current, savingAttendance: true, error: "", message: "" }));
    const result = await dataService.updateClinicAppointmentPolicy({ autoNoShowEnabled: state.autoNoShowEnabled, noShowToleranceMinutes: tolerance, noShowMode: state.noShowMode, reason: "Política de presença e falta atualizada nas configurações da clínica", idempotencyKey: getIdempotencyKey(operationKey) });
    if (!mountedRef.current) return;
    if (!result?.success) {
      setState((current) => ({ ...current, savingAttendance: false, error: result?.message || result?.error || "Não foi possível salvar a política de falta." }));
      return;
    }
    idempotencyKeys.current.delete(operationKey);
    setState((current) => ({ ...current, savingAttendance: false, autoNoShowEnabled: result?.data?.autoNoShowEnabled !== false, noShowToleranceMinutes: Number(result?.data?.noShowToleranceMinutes || tolerance), noShowMode: result?.data?.noShowMode === "REVIEW" ? "REVIEW" : "AUTO", attendanceDirty: false, error: "", message: result?.data?.autoNoShowEnabled === false ? "Classificação automática de falta desativada." : `Política salva: ${Number(result?.data?.noShowToleranceMinutes || tolerance)} minutos, modo ${result?.data?.noShowMode === "REVIEW" ? "revisão" : "automático"}.` }));
    setAttendanceSaved(true);
    attendanceSavedTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setAttendanceSaved(false);
      attendanceSavedTimerRef.current = null;
    }, 2000);
  };

  const saving = state.savingReschedule || state.savingAttendance;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#7a32fc] shadow-sm"><CalendarClock size={19} aria-hidden="true" /></span><div><p className="text-sm font-semibold text-slate-900">Permitir que pacientes solicitem reagendamento</p><p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">Quando desativado, o portal e os lembretes oferecem apenas confirmar ou cancelar. A equipe continua podendo reagendar e o histórico permanece intacto.</p></div></div>
          <button type="button" role="switch" aria-checked={state.allowPatientReschedule} aria-label="Permitir que pacientes solicitem reagendamento" disabled={state.loading || saving || !state.canManage} onClick={() => void updateReschedulePolicy()} className={`relative min-h-11 w-full shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition sm:w-32 ${state.allowPatientReschedule ? "bg-emerald-600 text-white" : "border border-slate-300 bg-white text-slate-600"} disabled:cursor-wait disabled:opacity-60`}>{state.loading || state.savingReschedule ? <span className="flex items-center justify-center gap-2"><Loader2 size={15} className="animate-spin" /> {state.loading ? "Carregando" : "Salvando"}</span> : state.allowPatientReschedule ? "Ativado" : "Desativado"}</button>
        </div>
      </div>

      <div className="rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#7a32fc] shadow-sm"><ClipboardList size={19} aria-hidden="true" /></span><div><p className="text-sm font-semibold text-slate-900">Política de ausência e falta</p><p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">A regra é executada no servidor, mesmo com o navegador fechado. O início da sessão e a classificação de falta usam bloqueio no mesmo agendamento, evitando estados duplicados.</p></div></div>
          <button type="button" role="switch" aria-checked={state.autoNoShowEnabled} disabled={state.loading || saving || !state.canManage} onClick={() => setState((current) => ({ ...current, autoNoShowEnabled: !current.autoNoShowEnabled, attendanceDirty: true, message: "", error: "" }))} className={`min-h-11 w-full shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition lg:w-36 ${state.autoNoShowEnabled ? "bg-[#7a32fc] text-white" : "border border-slate-300 bg-white text-slate-600"} disabled:opacity-60`}>{state.autoNoShowEnabled ? "Regra ativa" : "Regra inativa"}</button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className={labelClass}>Tolerância após o horário agendado<div className="relative"><input type="number" min={5} max={180} step={1} value={state.noShowToleranceMinutes} disabled={state.loading || saving || !state.canManage || !state.autoNoShowEnabled} onChange={(event) => setState((current) => ({ ...current, noShowToleranceMinutes: Number(event.target.value), attendanceDirty: true, message: "", error: "" }))} className={`${inputClass} pr-20`} /><span className="pointer-events-none absolute inset-y-0 right-3 flex items-center pt-1.5 text-xs text-slate-400">minutos</span></div><span className="mt-1.5 block text-[11px] leading-relaxed text-slate-500">Valor permitido: de 5 a 180 minutos. O padrão inicial é 30.</span></label>
          <label className={labelClass}>Ação ao atingir a tolerância<select value={state.noShowMode} disabled={state.loading || saving || !state.canManage || !state.autoNoShowEnabled} onChange={(event) => setState((current) => ({ ...current, noShowMode: event.target.value === "REVIEW" ? "REVIEW" : "AUTO", attendanceDirty: true, message: "", error: "" }))} className={inputClass}><option value="AUTO">Classificar automaticamente como falta</option><option value="REVIEW">Aguardar revisão manual da equipe</option></select><span className="mt-1.5 block text-[11px] leading-relaxed text-slate-500">{state.noShowMode === "REVIEW" ? "Nesse modo o agendamento não vira falta sozinho. A equipe deve revisar o atendimento atrasado na agenda e marcar a falta manualmente." : "Ao atingir a tolerância sem início da sessão, a Verto registra a falta no servidor. Faltas não seguem para faturamento de convênio."}</span></label>
        </div>
        <div className="mt-4 flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
          <div className="min-h-5 text-xs">{state.attendanceDirty && <span className="font-medium text-amber-700">Alterações ainda não salvas.</span>}</div>
          <button type="button" onClick={() => void saveAttendancePolicy()} disabled={state.loading || saving || !state.canManage || !state.attendanceDirty} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"><span className="inline-flex items-center gap-2" aria-live="polite">{state.savingAttendance ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : attendanceSaved ? <CheckCircle2 size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}{state.savingAttendance ? "Salvando..." : attendanceSaved ? "Salvo" : "Salvar política de falta"}</span></button>
        </div>
      </div>
      {state.error && <p role="alert" className="text-xs font-medium text-rose-700">{state.error}</p>}
      {state.message && <p role="status" className="text-xs font-medium text-emerald-700">{state.message}</p>}
      {!state.loading && !state.canManage && !state.error && <p className="text-xs text-slate-500">Somente direção, administração ou coordenação podem alterar estas políticas.</p>}
    </div>
  );
}

function AbaPromptTypesSettings() {
  const [promptTypes, setPromptTypes] = useState<AbaPromptTypeConfig[]>(() => normalizeAbaPromptTypeConfig());
  const [savingId, setSavingId] = useState('');
  const [newPrompt, setNewPrompt] = useState({ name: '', category: 'Visual', independenceScore: 80, intrusivenessOrder: 1, countsAsIndependent: false, showInSession: true, description: '' });
  const inactivePromptTypes = useMemo(() => promptTypes.filter((prompt) => !prompt.active), [promptTypes]);
  useEffect(() => { let cancelled = false; dataService.getAbaPromptTypes().then((result: any) => { if (!cancelled) setPromptTypes(normalizeAbaPromptTypeConfig(result?.data)); }).catch(() => { if (!cancelled) setPromptTypes(normalizeAbaPromptTypeConfig()); }); return () => { cancelled = true; }; }, []);
  const savePromptType = async (prompt: Partial<AbaPromptTypeConfig>) => { const id = String(prompt.id || prompt.key || `prompt-${Date.now()}`); setSavingId(id); try { const result = await dataService.saveAbaPromptType(prompt); if (result?.success !== false) { const saved = normalizeAbaPromptTypeConfig([result?.data || prompt])[0]; setPromptTypes((prev) => normalizeAbaPromptTypeConfig([...prev.filter((item) => item.id !== saved.id && item.key !== saved.key), saved])); } } finally { setSavingId(''); } };
  const addPromptType = async () => { const name = newPrompt.name.trim(); if (!name) return; await savePromptType({ ...newPrompt, name, label: name, key: name, active: true }); setNewPrompt({ name: '', category: 'Visual', independenceScore: 80, intrusivenessOrder: Math.max(1, promptTypes.length + 1), countsAsIndependent: false, showInSession: true, description: '' }); };
  return <SectionCard title="Tipos de ajuda ABA" description="Configure os tipos de ajuda usados durante as tentativas. Também chamados de prompt na prática ABA." complete={promptTypes.some((prompt) => prompt.active)} hasAnyData><div className="space-y-4"><div className="rounded-xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm font-semibold text-violet-900">Cada tipo pode ter uma pontuação de independência para gráficos, relatórios e critérios clínicos. Eventos antigos continuam usando o fallback já existente.</div><div className="grid gap-3">{promptTypes.filter((prompt) => prompt.active).map((prompt) => <div key={prompt.id || prompt.key} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-[1.3fr_1fr_110px_110px_auto]"><label className={labelClass}>Nome<input value={prompt.name} onChange={(event) => setPromptTypes((prev) => prev.map((item) => item.key === prompt.key ? { ...item, name: event.target.value, label: event.target.value } : item))} className={inputClass} /></label><label className={labelClass}>Categoria<input value={prompt.category} onChange={(event) => setPromptTypes((prev) => prev.map((item) => item.key === prompt.key ? { ...item, category: event.target.value } : item))} className={inputClass} /></label><label className={labelClass}>Pontuação<input type="number" min={0} max={100} value={prompt.independenceScore} onChange={(event) => setPromptTypes((prev) => prev.map((item) => item.key === prompt.key ? { ...item, independenceScore: Number(event.target.value) } : item))} className={inputClass} /></label><label className={labelClass}>Ordem<input type="number" min={0} value={prompt.intrusivenessOrder} onChange={(event) => setPromptTypes((prev) => prev.map((item) => item.key === prompt.key ? { ...item, intrusivenessOrder: Number(event.target.value) } : item))} className={inputClass} /></label><div className="flex flex-col justify-end gap-2"><label className="flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={prompt.showInSession} onChange={(event) => setPromptTypes((prev) => prev.map((item) => item.key === prompt.key ? { ...item, showInSession: event.target.checked } : item))} />Na sessão</label><label className="flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={prompt.countsAsIndependent} onChange={(event) => setPromptTypes((prev) => prev.map((item) => item.key === prompt.key ? { ...item, countsAsIndependent: event.target.checked } : item))} />Independente</label><button type="button" onClick={() => void savePromptType(prompt)} className="rounded-lg bg-[#7a32fc] px-3 py-2 text-xs font-black text-white">{savingId === (prompt.id || prompt.key) ? 'Salvando...' : 'Salvar'}</button><button type="button" onClick={() => void savePromptType({ ...prompt, active: false })} className="text-xs font-bold text-red-600">Inativar</button></div></div>)}</div><div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4"><p className="mb-3 text-sm font-black text-slate-800">Adicionar tipo de ajuda</p><div className="grid gap-3 md:grid-cols-[1.2fr_1fr_120px_120px]"><label className={labelClass}>Nome<input value={newPrompt.name} onChange={(event) => setNewPrompt((prev) => ({ ...prev, name: event.target.value }))} placeholder="Visual parcial leve" className={inputClass} /></label><label className={labelClass}>Categoria<input value={newPrompt.category} onChange={(event) => setNewPrompt((prev) => ({ ...prev, category: event.target.value }))} placeholder="Visual" className={inputClass} /></label><label className={labelClass}>Pontuação<input type="number" min={0} max={100} value={newPrompt.independenceScore} onChange={(event) => setNewPrompt((prev) => ({ ...prev, independenceScore: Number(event.target.value) }))} className={inputClass} /></label><label className={labelClass}>Ordem<input type="number" min={0} value={newPrompt.intrusivenessOrder} onChange={(event) => setNewPrompt((prev) => ({ ...prev, intrusivenessOrder: Number(event.target.value) }))} className={inputClass} /></label></div><button type="button" onClick={() => void addPromptType()} className="mt-4 rounded-xl bg-[#7a32fc] px-5 py-2.5 text-sm font-semibold text-white">Adicionar tipo</button></div>{inactivePromptTypes.length > 0 && <details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-black text-slate-700">Tipos inativos ({inactivePromptTypes.length})</summary><div className="mt-3 space-y-2">{inactivePromptTypes.map((prompt) => <div key={prompt.id || prompt.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2"><span className="text-sm font-semibold text-slate-700">{prompt.name}</span><button type="button" onClick={() => void savePromptType({ ...prompt, active: true })} className="text-xs font-black text-[#7a32fc]">Reativar</button></div>)}</div></details>}</div></SectionCard>;
}

function AbaPromptTypesClinicalSettings() {
  const legacyV2StillEnabled = isAbaV2Enabled();
  const v3PromptSemantics = isAbaV3UiEnabled();
  const [promptTypes, setPromptTypes] = useState<AbaPromptTypeConfig[]>(() => normalizeAbaPromptTypeConfig());
  const [savingId, setSavingId] = useState('');
  const [savedId, setSavedId] = useState('');
  const [editingPrompt, setEditingPrompt] = useState<Partial<AbaPromptTypeConfig> | null>(null);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('edit');
  const [modalError, setModalError] = useState('');
  const savedTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const activePromptTypes = useMemo(() => promptTypes.filter((prompt) => prompt.active), [promptTypes]);
  const inactivePromptTypes = useMemo(() => promptTypes.filter((prompt) => !prompt.active), [promptTypes]);
  const sessionPreviewPromptTypes = useMemo(() => activePromptTypes.filter((prompt) => prompt.showInSession).sort((a, b) => a.intrusivenessOrder - b.intrusivenessOrder || a.label.localeCompare(b.label, 'pt-BR')), [activePromptTypes]);

  useEffect(() => { let cancelled = false; dataService.getAbaPromptTypes().then((result: any) => { if (!cancelled) setPromptTypes(normalizeAbaPromptTypeConfig(result?.data)); }).catch(() => { if (!cancelled) setPromptTypes(normalizeAbaPromptTypeConfig()); }); return () => { cancelled = true; }; }, []);
  useEffect(() => () => { mountedRef.current = false; if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current); if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current); }, []);
  useEffect(() => { if (!editingPrompt) return undefined; const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setEditingPrompt(null); }; window.addEventListener('keydown', handleKeyDown); return () => window.removeEventListener('keydown', handleKeyDown); }, [editingPrompt]);

  const updateDraft = (patch: Partial<AbaPromptTypeConfig>) => setEditingPrompt((previous) => previous ? { ...previous, ...patch } : previous);
  const normalizeSavedPrompt = (rawPrompt: any, originalPrompt: Partial<AbaPromptTypeConfig>) => { const normalized = normalizeAbaPromptTypeConfig([rawPrompt || originalPrompt]); return normalized.find((item) => ((rawPrompt?.id && item.id === rawPrompt.id) || (originalPrompt.id && item.id === originalPrompt.id) || (originalPrompt.key && item.key === originalPrompt.key) || (originalPrompt.name && item.name === originalPrompt.name))) || normalized[0]; };

  const savePromptType = async (prompt: Partial<AbaPromptTypeConfig>) => {
    const id = String(prompt.id || prompt.key || prompt.name || `prompt-${Date.now()}`);
    if (savingId === id) return null;
    if (savedTimerRef.current) { window.clearTimeout(savedTimerRef.current); savedTimerRef.current = null; }
    setSavingId(id);
    setSavedId('');
    try {
      const result = await dataService.saveAbaPromptType(prompt);
      if (!mountedRef.current) return null;
      if (result?.success === true) {
        const saved = normalizeSavedPrompt(result?.data || prompt, prompt);
        setPromptTypes((prev) => normalizeAbaPromptTypeConfig([...prev.filter((item) => item.id !== saved.id && item.key !== saved.key), saved]));
        setSavedId(id);
        savedTimerRef.current = window.setTimeout(() => { if (mountedRef.current) setSavedId((current) => current === id ? '' : current); savedTimerRef.current = null; }, 2000);
        return saved;
      }
      setModalError(result?.error || 'Não foi possível salvar este tipo de ajuda.');
      return null;
    } catch {
      if (mountedRef.current) setModalError('Não foi possível salvar este tipo de ajuda.');
      return null;
    } finally {
      if (mountedRef.current) setSavingId('');
    }
  };

  const openCreatePrompt = () => { if (v3PromptSemantics && legacyV2StillEnabled) { setModalError('Durante a coexistência V2/V3, novos tipos de ajuda ficam bloqueados para não inventar uma pontuação Legacy. Tipos existentes podem ser editados normalmente.'); return; } setModalMode('create'); setModalError(''); setEditingPrompt({ name: '', category: 'Visual', independenceScore: undefined, intrusivenessOrder: Math.max(0, ...promptTypes.map((prompt) => prompt.intrusivenessOrder)) + 1, countsAsIndependent: false, showInSession: true, active: true, description: '' }); };
  const openEditPrompt = (prompt: AbaPromptTypeConfig) => { setModalMode('edit'); setModalError(''); setEditingPrompt({ ...prompt }); };
  const validatePromptDraft = (prompt: Partial<AbaPromptTypeConfig>) => { if (!String(prompt.name || '').trim()) return 'Informe o nome do tipo de ajuda.'; if (!String(prompt.category || '').trim()) return 'Informe a categoria da ajuda.'; if (!v3PromptSemantics) { if (prompt.independenceScore === undefined || prompt.independenceScore === null || Number.isNaN(Number(prompt.independenceScore))) return 'Informe a pontuação de independência.'; if (Number(prompt.independenceScore) < 0 || Number(prompt.independenceScore) > 100) return 'A pontuação de independência deve ficar entre 0 e 100.'; } if (prompt.intrusivenessOrder === undefined || prompt.intrusivenessOrder === null || Number.isNaN(Number(prompt.intrusivenessOrder)) || Number(prompt.intrusivenessOrder) < 0) return 'A ordem na sessão deve ser um número maior ou igual a zero.'; return ''; };
  const saveModalPrompt = async () => { if (!editingPrompt) return; const validationError = validatePromptDraft(editingPrompt); if (validationError) { setModalError(validationError); return; } const name = String(editingPrompt.name || '').trim(); const saved = await savePromptType({ ...editingPrompt, name, label: name, key: editingPrompt.key || name, category: String(editingPrompt.category || '').trim(), independenceScore: v3PromptSemantics ? Number(editingPrompt.independenceScore ?? 0) : Number(editingPrompt.independenceScore), intrusivenessOrder: Math.max(0, Math.round(Number(editingPrompt.intrusivenessOrder))), countsAsIndependent: v3PromptSemantics ? Boolean(editingPrompt.countsAsIndependent ?? false) : Boolean(editingPrompt.countsAsIndependent), showInSession: editingPrompt.showInSession !== false, active: editingPrompt.active !== false }); if (saved) { if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current); closeTimerRef.current = window.setTimeout(() => { if (mountedRef.current) setEditingPrompt(null); closeTimerRef.current = null; }, 2000); } };
  const movePrompt = async (prompt: AbaPromptTypeConfig, direction: -1 | 1) => { const ordered = [...activePromptTypes].sort((a, b) => a.intrusivenessOrder - b.intrusivenessOrder || a.label.localeCompare(b.label, 'pt-BR')); const index = ordered.findIndex((item) => item.key === prompt.key); const swapIndex = index + direction; if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) return; const current = ordered[index]; const swap = ordered[swapIndex]; const currentOrder = current.intrusivenessOrder; const swapOrder = swap.intrusivenessOrder; setPromptTypes((prev) => normalizeAbaPromptTypeConfig(prev.map((item) => { if (item.key === current.key) return { ...item, intrusivenessOrder: swapOrder }; if (item.key === swap.key) return { ...item, intrusivenessOrder: currentOrder }; return item; }))); await savePromptType({ ...current, intrusivenessOrder: swapOrder }); await savePromptType({ ...swap, intrusivenessOrder: currentOrder }); };
  const renderSaveLabel = (id: string, idleLabel = 'Salvar alterações') => savingId === id ? 'Salvando...' : savedId === id ? 'Salvo' : idleLabel;
  const modalSaveId = String(editingPrompt?.id || editingPrompt?.key || editingPrompt?.name || 'new-prompt');

  return (
    <SectionCard title="Tipos de ajuda ABA" description={v3PromptSemantics ? `${activePromptTypes.length} tipos ativos. Na V3, os prompts são categóricos e não usam pontuação 0–100.` : 'Configure os tipos de ajuda usados durante as tentativas. A pontuação indica o nível de independência usado em gráficos, relatórios e critérios clínicos.'} complete={promptTypes.some((prompt) => prompt.active)} hasAnyData>
      <details className="group rounded-xl border border-slate-200 bg-slate-50/60">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden"><div className="min-w-0"><p className="text-sm font-semibold text-slate-800">Configurar tipos de ajuda</p><p className="mt-0.5 text-xs font-normal text-slate-500">{activePromptTypes.length} ativos · clique para {v3PromptSemantics ? 'revisar a hierarquia categórica' : 'revisar a configuração'}</p></div><span className="shrink-0 text-xs font-semibold text-[#7a32fc]"><span className="group-open:hidden">Abrir</span><span className="hidden group-open:inline">Fechar</span></span></summary>
        <div className="space-y-5 border-t border-slate-200 bg-white p-4">
          {v3PromptSemantics ? <div className="rounded-xl border border-violet-100 bg-violet-50 p-4"><p className="text-sm font-semibold text-violet-950">Ajuda categórica na ABA V3</p><p className="mt-2 text-sm font-semibold leading-relaxed text-violet-900">O terapeuta registra qual ajuda foi usada. Independência, erro e ausência de resposta são fatos da tentativa e não são inferidos por uma escala 0–100.</p><p className="mt-2 text-xs font-semibold leading-relaxed text-violet-800">A ordem abaixo controla apenas a organização dos chips na sessão. Pontuações Legacy permanecem preservadas no histórico V2, sem participar dos cálculos V3.</p></div> : <><div className="rounded-xl border border-violet-100 bg-violet-50 p-4"><p className="text-sm font-black text-violet-950">Como funciona a pontuação</p><p className="mt-2 text-sm font-semibold leading-relaxed text-violet-900">100 = resposta independente. 0 = resposta totalmente dependente ou erro. Quanto menor a ajuda necessária, maior a pontuação de independência.</p><p className="mt-2 text-xs font-semibold leading-relaxed text-violet-800">Essas pontuações são sugestões iniciais e podem ser ajustadas pela supervisora clínica conforme o protocolo da clínica.</p></div><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm font-black text-slate-900">Escala sugerida</p><p className="text-xs font-semibold text-slate-500">Referência clínica para revisar a pontuação sem alterar dados automaticamente.</p><div className="mt-3 grid gap-2 sm:grid-cols-5">{[['100', 'Independente'], ['80-99', 'Ajuda mínima'], ['50-79', 'Ajuda moderada'], ['1-49', 'Ajuda intensa'], ['0', 'Dependente / erro']].map(([score, label]) => <div key={score} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"><p className="text-lg font-black text-slate-900">{score}</p><p className="text-xs font-bold text-slate-600">{label}</p></div>)}</div></div></>}
          <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm font-black text-slate-900">Prévia na sessão</p><p className="text-xs font-semibold text-slate-500">Esta é a ordem em que os terapeutas verão os tipos de ajuda durante a sessão.</p>{sessionPreviewPromptTypes.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">{sessionPreviewPromptTypes.map((prompt) => <span key={prompt.id || prompt.key} className="rounded-full border border-violet-100 bg-violet-50 px-3 py-1.5 text-xs font-black text-violet-800">{prompt.name}</span>)}</div> : <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-500">Nenhum tipo de ajuda ativo para aparecer na sessão.</p>}</div>
          <div className="rounded-xl border border-slate-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3"><div><p className="text-sm font-black text-slate-900">Lista de tipos ativos</p><p className="text-xs font-semibold text-slate-500">Edite cada tipo em uma janela própria para evitar alterações acidentais.</p></div><button type="button" onClick={openCreatePrompt} disabled={v3PromptSemantics && legacyV2StillEnabled} title={v3PromptSemantics && legacyV2StillEnabled ? 'Novos tipos ficam bloqueados durante a coexistência V2/V3 para não inventar pontuação Legacy.' : undefined} className="inline-flex items-center gap-2 rounded-xl bg-[#7a32fc] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"><Plus size={16} />Novo tipo de ajuda</button></div>
            <div className="hidden overflow-x-auto md:block"><table className="w-full table-fixed text-left text-sm"><thead className="bg-slate-50 text-xs font-black uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Tipo de ajuda</th><th className="px-4 py-3">Categoria da ajuda</th>{!v3PromptSemantics && <th className="px-4 py-3">Pontuação de independência</th>}<th className="px-4 py-3">Mostrar durante a sessão</th>{!v3PromptSemantics && <th className="px-4 py-3">Conta como resposta independente</th>}<th className="px-4 py-3">Status</th><th className="px-4 py-3">Ações</th></tr></thead><tbody className="divide-y divide-slate-100">{activePromptTypes.map((prompt, index) => <tr key={prompt.id || prompt.key} className="align-middle"><td className="px-4 py-3 font-black text-slate-900">{prompt.name}</td><td className="px-4 py-3 font-semibold text-slate-600">{prompt.category}</td>{!v3PromptSemantics && <td className="px-4 py-3 font-black text-slate-800">{prompt.independenceScore}</td>}<td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${prompt.showInSession ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{prompt.showInSession ? 'Sim' : 'Não'}</span></td>{!v3PromptSemantics && <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${prompt.countsAsIndependent ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{prompt.countsAsIndependent ? 'Sim' : 'Não'}</span></td>}<td className="px-4 py-3"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">Ativo</span></td><td className="px-4 py-3"><div className="flex flex-wrap items-center gap-2"><button type="button" disabled={index === 0} onClick={() => void movePrompt(prompt, -1)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-black text-slate-600 disabled:opacity-35">↑</button><button type="button" disabled={index === activePromptTypes.length - 1} onClick={() => void movePrompt(prompt, 1)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-black text-slate-600 disabled:opacity-35">↓</button><button type="button" onClick={() => openEditPrompt(prompt)} className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-1.5 text-xs font-black text-[#7a32fc]">Editar</button></div></td></tr>)}</tbody></table></div>
            <div className="space-y-3 p-3 md:hidden">{activePromptTypes.map((prompt, index) => <div key={prompt.id || prompt.key} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-slate-900">{prompt.name}</p><p className="text-xs font-bold text-slate-500">{v3PromptSemantics ? prompt.category : `${prompt.category} · ${prompt.independenceScore} pontos`}</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">Ativo</span></div><div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black"><span className={prompt.showInSession ? 'rounded-full bg-violet-50 px-2.5 py-1 text-violet-700' : 'rounded-full bg-slate-100 px-2.5 py-1 text-slate-500'}>{prompt.showInSession ? 'Aparece na sessão' : 'Oculto na sessão'}</span>{!v3PromptSemantics && <span className={prompt.countsAsIndependent ? 'rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700' : 'rounded-full bg-slate-100 px-2.5 py-1 text-slate-500'}>{prompt.countsAsIndependent ? 'Conta como independente' : 'Com ajuda'}</span>}</div><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={index === 0} onClick={() => void movePrompt(prompt, -1)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 disabled:opacity-35">Subir</button><button type="button" disabled={index === activePromptTypes.length - 1} onClick={() => void movePrompt(prompt, 1)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 disabled:opacity-35">Descer</button><button type="button" onClick={() => openEditPrompt(prompt)} className="rounded-lg bg-[#7a32fc] px-3 py-2 text-xs font-black text-white">Editar</button></div></div>)}</div>
          </div>
          {inactivePromptTypes.length > 0 && <details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-black text-slate-700">Tipos inativos ({inactivePromptTypes.length})</summary><div className="mt-3 space-y-2">{inactivePromptTypes.map((prompt) => <div key={prompt.id || prompt.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2"><span className="text-sm font-semibold text-slate-700">{prompt.name}</span><button type="button" disabled={savingId === String(prompt.id || prompt.key)} onClick={() => void savePromptType({ ...prompt, active: true })} className="rounded-lg bg-violet-50 px-3 py-2 text-xs font-black text-[#7a32fc] disabled:opacity-60"><span aria-live="polite" className="inline-flex items-center gap-1">{savingId === String(prompt.id || prompt.key) ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : savedId === String(prompt.id || prompt.key) ? <CheckCircle2 size={13} aria-hidden="true" /> : null}{renderSaveLabel(String(prompt.id || prompt.key), 'Reativar')}</span></button></div>)}</div></details>}
        </div>
      </details>
      {editingPrompt && <div className="fixed inset-0 z-[180] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={modalMode === 'create' ? 'Novo tipo de ajuda' : 'Editar tipo de ajuda'} onClick={() => setEditingPrompt(null)}><div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><h4 className="text-base font-semibold text-slate-900">{modalMode === 'create' ? 'Novo tipo de ajuda' : 'Editar tipo de ajuda'}</h4><p className="mt-1 text-sm font-semibold text-slate-500">Também chamado de prompt na prática ABA.</p></div><button type="button" onClick={() => setEditingPrompt(null)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar"><X size={18} /></button></div><div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">{modalError && <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{modalError}</div>}<div className="grid gap-4 md:grid-cols-2"><label className={labelClass}>Nome do tipo de ajuda<input autoFocus value={editingPrompt.name || ''} onChange={(event) => updateDraft({ name: event.target.value, label: event.target.value })} placeholder="Visual parcial leve" className={inputClass} /></label><label className={labelClass}>Categoria da ajuda<input value={editingPrompt.category || ''} onChange={(event) => updateDraft({ category: event.target.value })} placeholder="Visual" className={inputClass} /></label>{!v3PromptSemantics && <label className={labelClass}>Pontuação de independência<input type="number" min={0} max={100} value={editingPrompt.independenceScore ?? ''} onChange={(event) => updateDraft({ independenceScore: event.target.value === '' ? undefined : Number(event.target.value) })} className={inputClass} /><span className="mt-1.5 block text-[11px] font-semibold leading-relaxed text-slate-500">Use 100 para independente e 0 para totalmente dependente ou erro. Uma ajuda visual parcial pode ficar próxima de 80.</span></label>}<label className={labelClass}>Ordem na sessão<input type="number" min={0} value={editingPrompt.intrusivenessOrder ?? 0} onChange={(event) => updateDraft({ intrusivenessOrder: Number(event.target.value) })} className={inputClass} /><span className="mt-1.5 block text-[11px] font-semibold text-slate-500">Números menores aparecem primeiro nos chips da sessão.</span></label></div>{!v3PromptSemantics && Number(editingPrompt.independenceScore) === 100 && !editingPrompt.countsAsIndependent && <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">Pontuação 100 normalmente representa resposta independente. Confirme se este tipo deve contar como independente.</div>}<div className={`grid gap-3 ${v3PromptSemantics ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}><label className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={editingPrompt.showInSession !== false} onChange={(event) => updateDraft({ showInSession: event.target.checked })} className="mr-2" />Mostrar durante a sessão<span className="mt-1 block text-[11px] font-semibold text-slate-500">Aparece como chip rápido para o terapeuta.</span></label>{!v3PromptSemantics && <label className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={Boolean(editingPrompt.countsAsIndependent)} onChange={(event) => updateDraft({ countsAsIndependent: event.target.checked })} className="mr-2" />Conta como resposta independente<span className="mt-1 block text-[11px] font-semibold text-slate-500">Use apenas para respostas consideradas independentes.</span></label>}<label className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={editingPrompt.active !== false} onChange={(event) => updateDraft({ active: event.target.checked })} className="mr-2" />Status ativo<span className="mt-1 block text-[11px] font-semibold text-slate-500">Inative para remover da lista principal sem apagar histórico.</span></label></div><label className={labelClass}>Descrição clínica opcional<textarea value={editingPrompt.description || ''} onChange={(event) => updateDraft({ description: event.target.value })} placeholder="Ex.: Dica visual parcial sem entregar a resposta completa." className={`${inputClass} min-h-[96px] resize-y`} /></label></div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4">{modalMode === 'edit' && <button type="button" onClick={() => void savePromptType({ ...editingPrompt, active: false }).then((saved) => { if (saved) setEditingPrompt(null); })} className="rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm font-black text-red-600">Inativar</button>}<div className="ml-auto flex flex-wrap gap-2"><button type="button" onClick={() => setEditingPrompt(null)} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-600">Cancelar</button><button type="button" onClick={() => void saveModalPrompt()} className="rounded-xl bg-[#7a32fc] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-60" disabled={Boolean(savingId)}><span className="inline-flex items-center gap-2" aria-live="polite">{savingId === modalSaveId ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : savedId === modalSaveId ? <CheckCircle2 size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}{renderSaveLabel(modalSaveId, modalMode === 'create' ? 'Salvar tipo' : 'Salvar alterações')}</span></button></div></div></div></div>}
    </SectionCard>
  );
}

function MediaDropzone({ label, value, alt, accept, emptyText, imageClassName, onChange, onError }: { label: string; value: string | null; alt: string; accept: string; emptyText: string; imageClassName: string; onChange: (file: File) => void; onError: () => void; }) {
  return <div><label className="mb-2 block text-xs font-medium text-slate-600">{label}</label><label className="flex min-h-[150px] w-full cursor-pointer items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-4 transition-all hover:border-[#7a32fc]">{value ? <SecureImage src={value} alt={alt} className={imageClassName} onError={onError} /> : <span className="text-xs font-normal text-slate-500">{emptyText}</span>}<input type="file" className="hidden" accept={accept} onChange={(event) => { const file = event.target.files?.[0]; if (file) onChange(file); }} /></label></div>;
}

export function ClinicGlobalSettingsPanel({ mode, isTherapist, currentUserId, canEditAnamnesisTemplate, loadingAnamnesisTemplate, onOpenAnamnesisTemplate, canManageClinicSettings, canManageBilling, canManagePermissions, normalizedPlanName, hasInsuranceTissModule, moduleAccessMode, organizationModules, navigateToTab, onSave, values, setters, readImageAsDataUrl, retryMediaIfBroken }: ClinicGlobalSettingsPanelProps) {
  const isProfessionalView = mode === "professional";
  const hasAppointmentsCommunicationModule = hasOrganizationModule(moduleAccessMode, organizationModules, "appointments_communication");
  const scrollToClinicData = () => { document.getElementById("clinic-master-data")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const clinicDocumentDigits = parseDocumentForStorage(values.clinicCnpj);
  const clinicCoreComplete = Boolean(values.clinicDisplayName?.trim() && clinicDocumentDigits && (values.clinicPhone?.trim() || values.clinicEmail?.trim()));
  const clinicFiscalComplete = Boolean(values.clinicLegalName?.trim() && clinicDocumentDigits && values.clinicCnesCode?.trim());
  const contactComplete = Boolean(values.clinicEmail?.trim() || values.clinicPhone?.trim() || values.clinicWhatsapp?.trim());
  const responsibleComplete = Boolean(values.therapistFullName?.trim() && values.therapistRoleTitle?.trim() && (values.therapistEmail?.trim() || values.therapistPhone?.trim()));
  const professionalCouncilIsInformal = isNoFormalCouncil(values.therapistCouncilType);
  const professionalBillingComplete = professionalCouncilIsInformal ? Boolean(values.therapistCouncilType?.trim()) : Boolean(values.therapistCouncilType?.trim() && values.therapistCrp?.trim() && values.therapistCouncilState?.trim() && values.therapistCboCode?.trim());
  const mediaComplete = Boolean(values.therapistSignatureDataUrl || values.therapistProfilePhotoUrl);

  const professionalFields = <div className="grid grid-cols-1 gap-5 md:grid-cols-2">{isProfessionalView && <p className="md:col-span-2 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-normal leading-relaxed text-indigo-800">Este cadastro é pessoal e acompanha você em todos os vínculos autorizados. A clínica não substitui sua identidade profissional.</p>}<label className={`${labelClass} md:col-span-2`}>Nome completo ou nome profissional<input type="text" value={values.therapistFullName} onChange={(event) => setters.setTherapistFullName(event.target.value)} placeholder="Nome usado em documentos e relatórios" className={inputClass} /></label><div className="grid grid-cols-[130px_1fr] gap-3"><label className={labelClass}>Tipo de documento<select value={values.therapistDocumentType || "CPF"} onChange={(event) => { setters.setTherapistDocumentType(event.target.value); setters.setTherapistCpf(formatDocument(values.therapistCpf, event.target.value)); }} className={inputClass}><option value="CPF">CPF</option><option value="CNPJ">CNPJ</option><option value="OTHER">Outro</option></select></label><label className={labelClass}>Documento<input type="text" value={values.therapistCpf} onChange={(event) => setters.setTherapistCpf(formatDocument(event.target.value, values.therapistDocumentType))} placeholder={values.therapistDocumentType === "CNPJ" ? "00.000.000/0000-00" : "000.000.000-00"} className={inputClass} /></label></div><label className={labelClass}>E-mail<input type="email" value={values.therapistEmail} readOnly aria-readonly="true" title="O e-mail de acesso é alterado pelo fluxo de conta verificado." placeholder="seu@email.com" className={`${inputClass} bg-slate-50 text-slate-500`} /></label><label className={labelClass}>Telefone / WhatsApp<input type="text" value={values.therapistPhone} onChange={(event) => setters.setTherapistPhone(maskPhoneBR(event.target.value))} placeholder="(00) 00000-0000" className={inputClass} /></label><label className={labelClass}>Cargo ou função profissional<input type="text" value={values.therapistRoleTitle} onChange={(event) => setters.setTherapistRoleTitle(event.target.value)} placeholder="Ex.: Fonoaudiólogo clínico" className={inputClass} /></label><label className={labelClass}>Conselho / tipo de registro<select value={values.therapistCouncilType} onChange={(event) => setters.setTherapistCouncilType(formatProfessionalCouncil(event.target.value))} className={inputClass}><option value="">Selecione o conselho ou tipo de registro</option>{PROFESSIONAL_COUNCIL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}{values.therapistCouncilType && !PROFESSIONAL_COUNCIL_OPTIONS.some((option) => option.value === values.therapistCouncilType) && <option value={values.therapistCouncilType}>{values.therapistCouncilType} · registro existente</option>}</select></label><label className={labelClass}>Registro profissional / identificação<input type="text" maxLength={80} value={values.therapistCrp} onChange={(event) => setters.setTherapistCrp(formatProfessionalRegistry(event.target.value, values.therapistCouncilType))} placeholder={getProfessionalRegistryPlaceholder(values.therapistCouncilType, values.therapistSpecialtyName)} className={inputClass} /><span className="mt-1 block text-[11px] font-normal leading-5 text-slate-500">{getProfessionalRegistryGuidance(values.therapistCouncilType)}</span></label><label className={labelClass}>UF do conselho<select value={values.therapistCouncilState} onChange={(event) => setters.setTherapistCouncilState(event.target.value)} className={inputClass}><option value="">Selecione</option>{BRAZILIAN_UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}</select></label><label className={labelClass}>CBO<input type="text" value={values.therapistCboCode} onChange={(event) => setters.setTherapistCboCode(onlyDigits(event.target.value, 12))} placeholder="Código CBO" className={inputClass} /></label><label className={labelClass}>Área principal de atuação<input type="text" value={values.therapistSpecialtyName} onChange={(event) => setters.setTherapistSpecialtyName(event.target.value)} placeholder="Ex.: Linguagem, motricidade oral" className={inputClass} /></label>{hasInsuranceTissModule && <label className={labelClass}>Código do prestador<input type="text" value={values.therapistProviderCode} onChange={(event) => setters.setTherapistProviderCode(event.target.value)} placeholder="Opcional, conforme operadora" className={inputClass} /></label>}<div className="md:col-span-2 mt-2 border-t border-slate-100 pt-5"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Endereço profissional</p></div><label className={labelClass}>Endereço<input type="text" value={values.therapistAddressLine || ""} onChange={(event) => setters.setTherapistAddressLine(event.target.value)} placeholder="Rua, avenida, travessa" className={inputClass} /></label><label className={labelClass}>Número<input type="text" value={values.therapistAddressNumber || ""} onChange={(event) => setters.setTherapistAddressNumber(event.target.value)} placeholder="Número" className={inputClass} /></label><label className={labelClass}>Complemento<input type="text" value={values.therapistAddressComplement || ""} onChange={(event) => setters.setTherapistAddressComplement(event.target.value)} placeholder="Sala, conjunto, bloco" className={inputClass} /></label><label className={labelClass}>Bairro<input type="text" value={values.therapistDistrict || ""} onChange={(event) => setters.setTherapistDistrict(event.target.value)} placeholder="Bairro" className={inputClass} /></label><label className={labelClass}>Cidade<input type="text" value={values.therapistCity || ""} onChange={(event) => setters.setTherapistCity(event.target.value)} placeholder="Cidade" className={inputClass} /></label><label className={labelClass}>UF<input type="text" value={values.therapistState || ""} onChange={(event) => setters.setTherapistState(event.target.value.toUpperCase().slice(0, 2))} placeholder="SP" maxLength={2} className={inputClass} /></label><label className={labelClass}>CEP<input type="text" value={values.therapistPostalCode || ""} onChange={(event) => setters.setTherapistPostalCode(maskCep(event.target.value))} placeholder="00000-000" className={inputClass} /></label><label className={`${labelClass} md:col-span-2`}>Mini currículo<textarea rows={3} value={values.therapistMiniCurriculum} onChange={(event) => setters.setTherapistMiniCurriculum(event.target.value)} placeholder="Resumo profissional usado em relatórios e documentos." className={`${inputClass} resize-none`} /></label><div className="md:col-span-2 flex justify-end"><SaveButton onSave={onSave}>Salvar perfil profissional</SaveButton></div></div>;

  const mediaFields = <div className="grid grid-cols-1 gap-5 md:grid-cols-2"><MediaDropzone label="Assinatura Digital" value={values.therapistSignatureDataUrl} alt="Assinatura digital" accept="image/png,image/webp,image/jpeg" emptyText="Clique para enviar assinatura" imageClassName="max-h-28 object-contain" onChange={(file) => readImageAsDataUrl(file, setters.setTherapistSignatureDataUrl)} onError={() => void retryMediaIfBroken("signature")} /><MediaDropzone label="Foto de Perfil" value={values.therapistProfilePhotoUrl} alt="Foto de perfil" accept="image/*" emptyText="Clique para enviar foto" imageClassName="h-24 w-24 rounded-2xl object-cover" onChange={(file) => readImageAsDataUrl(file, setters.setTherapistProfilePhotoUrl)} onError={() => void retryMediaIfBroken("profile")} /><div className="md:col-span-2 flex justify-end"><SaveButton onSave={onSave}>Salvar documentos</SaveButton></div></div>;

  const professionalResources = <SectionCard title="Ferramentas profissionais" description="Suas fichas e modelos pessoais ficam vinculados à sua identidade profissional e podem ser reutilizados nos seus vínculos ativos." complete hasAnyData><div className="grid gap-4 md:grid-cols-2"><button type="button" onClick={onOpenAnamnesisTemplate} disabled={loadingAnamnesisTemplate} className="flex min-h-[132px] items-start gap-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-5 text-left transition hover:border-violet-300 hover:bg-violet-50/40 disabled:opacity-60"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-violet-600 shadow-sm"><ClipboardList size={21} /></span><span><span className="block text-base font-semibold text-slate-900">Minhas fichas de anamnese</span><span className="mt-1 block text-sm font-normal leading-relaxed text-slate-500">Crie, edite e reutilize fichas próprias sem misturar os dados de uma clínica com outra.</span><span className="mt-3 block text-sm font-medium text-violet-700">{loadingAnamnesisTemplate ? 'Carregando...' : 'Gerenciar fichas'}</span></span></button><button type="button" onClick={() => { try { sessionStorage.setItem('verto:protocols:library-section', 'programs'); } catch { /* noop */ } navigateToTab('protocols'); }} className="flex min-h-[132px] items-start gap-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-5 text-left transition hover:border-violet-300 hover:bg-violet-50/40"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-violet-600 shadow-sm"><Library size={21} /></span><span><span className="block text-base font-semibold text-slate-900">Minha biblioteca terapêutica</span><span className="mt-1 block text-sm font-normal leading-relaxed text-slate-500">Edite modelos pessoais e use a mesma estrutura clínica em outras clínicas, sem carregar dados de pacientes.</span><span className="mt-3 block text-sm font-medium text-violet-700">Abrir biblioteca</span></span></button></div></SectionCard>;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">{isProfessionalView ? "Perfil profissional" : "Configurações da unidade"}</p><h3 className="mt-1 text-2xl font-semibold text-slate-900">{isProfessionalView ? "Meu perfil profissional" : "Configurações da clínica"}</h3><p className="mt-2 max-w-3xl text-sm font-normal text-slate-500">{isProfessionalView ? "Seus dados pessoais, documentos, registro profissional, assinatura e foto ficam em um cadastro único e acompanham seus vínculos." : "Dados institucionais da unidade atual. Apenas Direção e Coordenação autorizadas podem editar estas informações."}</p></div><div className="flex flex-wrap items-center gap-3">{canEditAnamnesisTemplate && <button type="button" onClick={onOpenAnamnesisTemplate} disabled={loadingAnamnesisTemplate} className="rounded-xl border border-[#7a32fc]/25 bg-white px-4 py-2.5 text-sm font-medium text-[#7a32fc] transition-all hover:bg-[#f6f0ff] disabled:opacity-60">{loadingAnamnesisTemplate ? "Carregando ficha..." : isProfessionalView ? "Minhas fichas" : "Editar ficha de anamnese"}</button>}<SaveButton feedback={!isProfessionalView} onSave={onSave}>{isProfessionalView ? "Salvar meu perfil" : "Salvar configurações da clínica"}</SaveButton></div></div></div>
      {isProfessionalView ? <><SectionCard title="Cadastro e credenciais profissionais" description="Mantenha seus dados de identificação, conselho, especialidade e informações usadas em documentos clínicos e faturamento." complete={responsibleComplete && professionalBillingComplete} hasAnyData={Boolean(values.therapistFullName || values.therapistPhone || values.therapistEmail || values.therapistCrp || values.therapistCboCode)}>{professionalFields}</SectionCard>{isTherapist && <ProfessionalScheduleSettings memberId={currentUserId} />}<SectionCard title="Assinatura e foto profissional" description="Estes arquivos acompanham seu perfil e são usados em relatórios, documentos e registros assinados." complete={mediaComplete} hasAnyData={mediaComplete}>{mediaFields}</SectionCard>{professionalResources}</> : <>{canManageClinicSettings ? <><SectionCard id="clinic-master-data" title="Dados da clínica" description="Dados usados em documentos, notificações, relatórios e identificação pública da clínica." complete={clinicCoreComplete} hasAnyData={Boolean(values.clinicDisplayName || values.clinicCnpj || values.clinicPhone || values.clinicEmail)}><div className="grid grid-cols-1 gap-5 md:grid-cols-2"><label className={`${labelClass} md:col-span-2`}>Nome fantasia da clínica<input type="text" value={values.clinicDisplayName} onChange={(event) => setters.setClinicDisplayName(event.target.value)} placeholder="Nome público da clínica" className={inputClass} /></label><label className={labelClass}>Razão social<input type="text" value={values.clinicLegalName} onChange={(event) => setters.setClinicLegalName(event.target.value)} placeholder="Razão social do prestador" className={inputClass} /></label><div className="grid grid-cols-[130px_1fr] gap-3"><label className={labelClass}>Tipo<select value={values.clinicDocumentType} onChange={(event) => { setters.setClinicDocumentType(event.target.value); setters.setClinicCnpj(formatDocument(values.clinicCnpj, event.target.value)); }} className={inputClass}><option value="CNPJ">CNPJ</option><option value="CPF">CPF</option></select></label><label className={labelClass}>CPF/CNPJ<input type="text" value={values.clinicCnpj} onChange={(event) => setters.setClinicCnpj(formatDocument(event.target.value, values.clinicDocumentType))} placeholder={values.clinicDocumentType === "CPF" ? "000.000.000-00" : "00.000.000/0000-00"} className={inputClass} /></label></div><label className={labelClass}>CNES<input type="text" value={values.clinicCnesCode} onChange={(event) => setters.setClinicCnesCode(onlyDigits(event.target.value, 12))} placeholder="CNES da clínica" className={inputClass} /></label>{hasInsuranceTissModule && <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-normal leading-relaxed text-indigo-800">O código contratual do prestador é específico de cada operadora. Configure-o em<button type="button" onClick={() => navigateToTab("payers")} className="ml-1 font-semibold underline underline-offset-2">Convênios e TISS</button>.</div>}<div className="md:col-span-2"><MediaDropzone label="Logotipo da Clínica" value={values.clinicLogoDataUrl} alt="Logo da clínica" accept="image/png,image/webp,image/jpeg" emptyText="Clique para enviar logotipo" imageClassName="max-h-28 object-contain" onChange={(file) => readImageAsDataUrl(file, setters.setClinicLogoDataUrl)} onError={() => void retryMediaIfBroken("logo")} /></div><div className="md:col-span-2 flex justify-end"><SaveButton feedback onSave={onSave}>Salvar dados da clínica</SaveButton></div></div></SectionCard>
        <SectionCard title="Dados de contato" description="Contatos e endereço reutilizados em documentos, notificações e relatórios." complete={contactComplete} hasAnyData={Boolean(values.clinicEmail || values.clinicPhone || values.clinicWhatsapp || values.clinicAddressLine || values.clinicCity)}><div className="grid grid-cols-1 gap-5 md:grid-cols-2"><label className={labelClass}>E-mail institucional<input type="email" value={values.clinicEmail} onChange={(event) => setters.setClinicEmail(event.target.value)} placeholder="contato@clinica.com" className={inputClass} /></label><label className={labelClass}>Telefone principal<input type="text" value={values.clinicPhone} onChange={(event) => setters.setClinicPhone(maskPhoneBR(event.target.value))} placeholder="(00) 00000-0000" className={inputClass} /></label><label className={labelClass}>WhatsApp<input type="text" value={values.clinicWhatsapp} onChange={(event) => setters.setClinicWhatsapp(maskPhoneBR(event.target.value))} placeholder="(00) 00000-0000" className={inputClass} /></label><label className={labelClass}>Site<input type="url" value={values.clinicSite} onChange={(event) => setters.setClinicSite(event.target.value)} placeholder="https://clinica.com.br" className={inputClass} /></label><label className={labelClass}>Endereço<input type="text" value={values.clinicAddressLine} onChange={(event) => { setters.setClinicAddressLine(event.target.value); setters.setClinicAddress(event.target.value); }} placeholder="Rua, avenida, travessa" className={inputClass} /></label><label className={labelClass}>Número<input type="text" value={values.clinicAddressNumber} onChange={(event) => setters.setClinicAddressNumber(event.target.value)} placeholder="Número" className={inputClass} /></label><label className={labelClass}>Complemento<input type="text" value={values.clinicAddressComplement} onChange={(event) => setters.setClinicAddressComplement(event.target.value)} placeholder="Sala, bloco, andar" className={inputClass} /></label><label className={labelClass}>Bairro<input type="text" value={values.clinicDistrict} onChange={(event) => setters.setClinicDistrict(event.target.value)} placeholder="Bairro" className={inputClass} /></label><label className={labelClass}>Cidade<input type="text" value={values.clinicCity} onChange={(event) => setters.setClinicCity(event.target.value)} placeholder="Cidade" className={inputClass} /></label><label className={labelClass}>UF<input type="text" value={values.clinicStateUf} onChange={(event) => { const nextState = event.target.value.toUpperCase().slice(0, 2); const previousInferredTimeZone = inferBrazilClinicTimeZoneFromState(values.clinicStateUf); setters.setClinicStateUf(nextState); if (!values.clinicTimeZone || values.clinicTimeZone === previousInferredTimeZone) setters.setClinicTimeZone(inferBrazilClinicTimeZoneFromState(nextState)); }} placeholder="SP" maxLength={2} className={inputClass} /></label><label className={labelClass}>CEP<input type="text" value={values.clinicPostalCode} onChange={(event) => setters.setClinicPostalCode(maskCep(event.target.value))} placeholder="00000-000" className={inputClass} /></label><label className={`${labelClass} md:col-span-2`}>Fuso horário da clínica<select value={values.clinicTimeZone || ''} onChange={(event) => setters.setClinicTimeZone(event.target.value)} className={inputClass}>{BRAZIL_CLINIC_TIME_ZONE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><span className="mt-1.5 block text-[11px] font-normal leading-relaxed text-slate-500">Horários clínicos, PTS e registros usam este fuso, independentemente do computador ou celular que abrir o prontuário.</span></label><div className="md:col-span-2 flex justify-end"><SaveButton feedback onSave={onSave}>Salvar contato</SaveButton></div></div></SectionCard>
        <SectionCard title="Dados fiscais e documentais" description={hasInsuranceTissModule ? "Dados fiscais e estruturais globais da clínica usados em documentos e Pré-guias." : "Dados fiscais e estruturais globais reutilizados nos documentos institucionais da clínica."} complete={clinicFiscalComplete} hasAnyData={Boolean(values.clinicLegalName || values.clinicCnesCode)}><p className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-normal text-indigo-800">{hasInsuranceTissModule ? "Razão social, documento e CNES são globais. O código atribuído à clínica pelo convênio deve ser configurado dentro de cada operadora." : "Razão social, documento e CNES permanecem disponíveis para documentos e cadastros institucionais."}</p></SectionCard>
        <SectionCard title="Preferências da clínica" description="Preferências operacionais usadas na agenda, no prontuário e nas rotinas administrativas." complete={Boolean(values.workStart && values.workEnd && values.clinicPatientPhotoPolicy && values.clinicTimeZone)} hasAnyData><div className="grid grid-cols-1 gap-5 md:grid-cols-2"><label className={labelClass}>Início do expediente<input type="time" value={values.workStart} onChange={(event) => setters.setWorkStart(event.target.value)} className={inputClass} /></label><label className={labelClass}>Fim do expediente<input type="time" value={values.workEnd} onChange={(event) => setters.setWorkEnd(event.target.value)} className={inputClass} /></label><div className="md:col-span-2 rounded-2xl border border-violet-100 bg-violet-50/40 p-4"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#7a32fc] shadow-sm"><Camera size={18} /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-900">Foto exibida no prontuário do paciente</p><p className="mt-1 text-xs leading-relaxed text-slate-500">Escolha uma única fonte para manter a identidade visual da clínica consistente. A troca de política não apaga fotos já enviadas.</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => setters.setClinicPatientPhotoPolicy('PORTAL')} className={`rounded-xl border px-4 py-3 text-left text-sm transition ${values.clinicPatientPhotoPolicy !== 'CLINIC' ? 'border-violet-300 bg-white text-violet-800 ring-2 ring-violet-100' : 'border-slate-200 bg-white text-slate-600'}`}><span className="block font-semibold">Usar foto do portal</span><span className="mt-1 block text-xs font-normal leading-relaxed">A foto enviada pelo paciente ou responsável passa a aparecer automaticamente no prontuário.</span></button><button type="button" onClick={() => setters.setClinicPatientPhotoPolicy('CLINIC')} className={`rounded-xl border px-4 py-3 text-left text-sm transition ${values.clinicPatientPhotoPolicy === 'CLINIC' ? 'border-violet-300 bg-white text-violet-800 ring-2 ring-violet-100' : 'border-slate-200 bg-white text-slate-600'}`}><span className="block font-semibold">Foto gerenciada pela clínica</span><span className="mt-1 block text-xs font-normal leading-relaxed">Direção, Coordenação e Recepção autorizada podem tirar ou enviar a foto usada no prontuário.</span></button></div></div></div></div>{hasAppointmentsCommunicationModule && <div className="md:col-span-2"><PatientReschedulePolicySettings /></div>}<div className="md:col-span-2 flex justify-end"><SaveButton feedback onSave={onSave}>Salvar preferências da clínica</SaveButton></div></div></SectionCard>
        <AbaPromptTypesClinicalSettings />
        {hasInsuranceTissModule && <BillingTissSettingsPanel onEditClinicData={scrollToClinicData} onNavigatePayers={() => navigateToTab("payers")} onNavigateProfessionals={() => navigateToTab("team")} />}</> : <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-500 shadow-sm">Configurações iniciais da clínica disponíveis apenas para coordenação.</div>}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">{canManageBilling && <div className="space-y-4"><SubscriptionDiscountSummary /><div className="rounded-2xl border border-blue-100 bg-blue-50 p-6"><div className="mb-4 flex items-center justify-between"><p className="text-sm font-bold text-blue-900">Plano {normalizedPlanName}</p><span className="rounded-lg bg-blue-100 px-3 py-1 text-[10px] font-bold uppercase text-[#7a32fc]">Ativo</span></div><p className="mb-6 text-xs text-blue-600">Sua clínica possui acesso às ferramentas de gestão e prontuário eletrônico.</p><button onClick={() => navigateToTab("billing")} className="w-full rounded-2xl bg-[#7a32fc] py-3 text-xs font-bold text-white shadow-sm transition-all hover:opacity-90">Gerenciar Assinatura</button></div></div>}<div className="lg:col-span-2"><RoleCapabilityMatrix moduleAccessMode={moduleAccessMode} organizationModules={organizationModules} canManagePermissions={canManagePermissions} /></div></div>
      </>}
    </div>
  );
}
