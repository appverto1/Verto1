import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Stethoscope,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import { dataService } from "../services/dataService";
import { classifyConferencePendingDetails } from "../services/monthlyConferenceEngine";
import { formatDateTimeInAppointmentTimezone } from "../utils/scheduling";

type ClosureStatus =
  | "READY"
  | "PENDING"
  | "WARNING"
  | "NOT_BILLABLE"
  | "DRAFT"
  | "UNKNOWN";

type ClosureRow = {
  appointment_id?: string | null;
  patient_name?: string | null;
  professional_name?: string | null;
  service_type?: string | null;
  payer_name?: string | null;
  financial_plan_name?: string | null;
  internal_procedure_code?: string | null;
  internal_procedure_name?: string | null;
  tuss_code?: string | null;
  tuss_description?: string | null;
  guide_type?: string | null;
  billing_unit?: string | null;
  billing_quantity?: number | null;
  billing_amount_cents?: number | null;
  tuss_mapping_status?: string | null;
  tuss_pending_reasons?: string[] | null;
  tuss_pending_reason_codes?: string[] | null;
  insurance_card_number?: string | null;
  professional_registry?: string | null;
  guide_number?: string | null;
  authorization_code?: string | null;
  payer_requirement_source?: string | null;
  required_document_pending_count?: number;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  scheduled_minutes?: number | null;
  actual_minutes?: number | null;
  readiness_status?: ClosureStatus | string;
  blocking_issues_count?: number;
  warning_issues_count?: number;
  main_issues?: string[];
  checklist?: ClosureChecklistItem[];
};

type ClosureChecklistItem = {
  key: string;
  label: string;
  status: "PASSED" | "FAILED" | "WARNING" | "NOT_APPLICABLE";
  required: boolean;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  message: string;
};

type OperationalClosureCenterProps = {
  patients?: any[];
  professionals?: any[];
  canOverride?: boolean;
  onOpenAppointment?: (appointment: ClosureRow) => void;
  onOpenReport?: (appointment: ClosureRow) => void;
};

const statusMeta: Record<ClosureStatus, { label: string; className: string; icon: React.ComponentType<any> }> = {
  READY: {
    label: "Pronta para conferência",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    icon: CheckCircle2,
  },
  PENDING: {
    label: "Pendente",
    className: "bg-rose-50 text-rose-700 ring-rose-200",
    icon: XCircle,
  },
  WARNING: {
    label: "Em atenção",
    className: "bg-amber-50 text-amber-700 ring-amber-200",
    icon: AlertTriangle,
  },
  NOT_BILLABLE: {
    label: "Não faturável",
    className: "bg-slate-100 text-slate-700 ring-slate-200",
    icon: ShieldAlert,
  },
  DRAFT: {
    label: "Em aberto",
    className: "bg-sky-50 text-sky-700 ring-sky-200",
    icon: Clock,
  },
  UNKNOWN: {
    label: "A revisar",
    className: "bg-zinc-100 text-zinc-700 ring-zinc-200",
    icon: AlertTriangle,
  },
};

const checkStatusMeta = {
  PASSED: { icon: CheckCircle2, className: "text-emerald-600", label: "Ok" },
  FAILED: { icon: XCircle, className: "text-rose-600", label: "Pendente" },
  WARNING: { icon: AlertTriangle, className: "text-amber-600", label: "Atenção" },
  NOT_APPLICABLE: { icon: Clock, className: "text-slate-400", label: "Não aplicável" },
};

const severityLabel: Record<string, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

const pendingTone: Record<string, string> = {
  Assinatura: "bg-rose-50 text-rose-700",
  Relatorio: "bg-orange-50 text-orange-700",
  Guia: "bg-indigo-50 text-indigo-700",
  Autorizacao: "bg-violet-50 text-violet-700",
  Duracao: "bg-amber-50 text-amber-700",
  Profissional: "bg-slate-100 text-slate-700",
  Pagador: "bg-cyan-50 text-cyan-700",
  Documento: "bg-fuchsia-50 text-fuchsia-700",
  Procedimento: "bg-sky-50 text-sky-700",
  TUSS: "bg-indigo-50 text-indigo-700",
  Valor: "bg-emerald-50 text-emerald-700",
  Carteirinha: "bg-violet-50 text-violet-700",
  "Plano financeiro": "bg-cyan-50 text-cyan-700",
  "Registro profissional": "bg-slate-100 text-slate-700",
  "Aguardando realizacao": "bg-slate-50 text-slate-500",
  "Nao aplicavel ao faturamento": "bg-slate-100 text-slate-600",
};

const pendingCategoryTone: Record<string, string> = {
  configuration: "ring-sky-100",
  operational: "ring-rose-100",
  informational: "ring-slate-100",
  not_applicable: "ring-slate-100",
};

const pendingDisplayLabel: Record<string, string> = {
  Relatorio: "Relatório",
  Autorizacao: "Autorização",
  Duracao: "Duração",
  "Aguardando realizacao": "Aguardando realização",
  "Nao aplicavel ao faturamento": "Não aplicável ao faturamento",
};

function pendingChipClass(item: { label: string; category: string }) {
  if (item.category === "informational" || item.category === "not_applicable") {
    return "bg-slate-100 text-slate-600 ring-slate-100";
  }
  return `${pendingTone[item.label] || "bg-slate-100 text-slate-700"} ${pendingCategoryTone[item.category] || ""}`;
}

function pendingChipLabel(item: { label: string; category: string }) {
  const label = pendingDisplayLabel[item.label] || item.label;
  if (item.category === "configuration") return `Configuração: ${label}`;
  if (item.category === "operational") return `Operacional: ${label}`;
  if (item.category === "not_applicable" && item.label !== "Aguardando realizacao") return `Ainda não aplicável: ${label}`;
  return label;
}

function getLocalDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthBounds() {
  const now = new Date();
  return {
    from: getLocalDateInput(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: getLocalDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function toApiDate(value: string, endOfDay = false) {
  if (!value) return "";
  return `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Sem horário";
  return formatDateTimeInAppointmentTimezone(value) || "Sem horário";
}

function formatMinutes(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "Não informado";
  return `${Math.round(Number(value))} min`;
}

function normalizeStatus(value?: string | null): ClosureStatus {
  const status = String(value || "UNKNOWN").toUpperCase();
  return Object.prototype.hasOwnProperty.call(statusMeta, status) ? (status as ClosureStatus) : "UNKNOWN";
}

function formatRevalidationMessage(counts: any, contextLabel: string) {
  const created = Number(counts?.created || 0);
  const updated = Number(counts?.updated || 0);
  const changed = created + updated;
  const reused = Number(counts?.reused || 0);
  const skipped = Number(counts?.skipped || 0);
  const errors = Number(counts?.errors || 0);
  const found = Number(counts?.found || 0);
  const evaluated = found || changed + reused + skipped + errors;
  if (evaluated <= 0) return `Período conferido; nenhuma sessão nova para ${contextLabel}.`;
  const parts = [];
  if (changed > 0) parts.push(`${changed} atualizado(s)`);
  if (reused > 0) parts.push(`${reused} sem alteração`);
  if (skipped > 0) parts.push(`${skipped} preservado(s)`);
  if (errors > 0) parts.push(`${errors} com erro`);
  return `${evaluated} item(ns) avaliado(s): ${parts.length > 0 ? parts.join(", ") : "sem alterações"}.`;
}

function getHumanIssueCount(row: ClosureRow) {
  const details = classifyConferencePendingDetails(row);
  const operational = details.operational.length;
  const configuration = details.configuration.length;
  const blocking = operational + configuration;
  const warnings = Number(row.warning_issues_count || 0);
  if (blocking === 0 && warnings === 0) {
    if (details.informational.length > 0) return details.informational.map((item) => pendingDisplayLabel[item] || item).join(", ");
    if (details.notApplicable.length > 0) return details.notApplicable.map((item) => pendingDisplayLabel[item] || item).join(", ");
    return "Sem pendências";
  }
  const parts = [];
  if (operational > 0) parts.push(`${operational} pendência${operational > 1 ? "s" : ""} operacional${operational > 1 ? "is" : ""}`);
  if (configuration > 0) parts.push(`${configuration} configuração${configuration > 1 ? "ões" : ""} pendente${configuration > 1 ? "s" : ""}`);
  if (warnings > 0) parts.push(`${warnings} alerta${warnings > 1 ? "s" : ""}`);
  return parts.join(" + ");
}

export function OperationalClosureCenter({
  patients = [],
  professionals = [],
  canOverride = false,
  onOpenAppointment,
  onOpenReport,
}: OperationalClosureCenterProps) {
  const initialBounds = useMemo(() => monthBounds(), []);
  const [from, setFrom] = useState(initialBounds.from);
  const [to, setTo] = useState(initialBounds.to);
  const [status, setStatus] = useState("");
  const [patientFilter, setPatientFilter] = useState("");
  const [professionalFilter, setProfessionalFilter] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [quickFilter, setQuickFilter] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ClosureRow[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revalidationInfo, setRevalidationInfo] = useState("");
  const [detail, setDetail] = useState<ClosureRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState("");
  const [overrideTarget, setOverrideTarget] = useState<ClosureRow | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  const patientOptions = useMemo(() => patients.filter((patient) => patient?.id && patient?.name), [patients]);
  const professionalOptions = useMemo(() => {
    const byId = new Map<string, any>();
    professionals.forEach((member) => {
      const id = String(member?.id || member?.user_id || "").trim();
      if (id) byId.set(id, member);
    });
    return Array.from(byId.values());
  }, [professionals]);
  const serviceTypeOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((row) => {
      const type = String(row.service_type || "").trim();
      if (type) set.add(type);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [rows]);

  const canGoNext = rows.length >= 50;

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const hasActiveFilters = Boolean(status || patientFilter || professionalFilter || serviceType || quickFilter);
      const revalidation = await dataService.revalidateClosurePeriod({
        from: toApiDate(from),
        to: toApiDate(to, true),
      });
      const counts = revalidation?.data || revalidation?.counts || {};
      const changed = Number(counts.created || 0) + Number(counts.updated || 0);
      const legacyMirrored = Number(counts.legacyMirrored || 0);
      const revalidationErrors = Number(counts.errors || 0);
      const revalidationMessage = formatRevalidationMessage(counts, "fechamento");
      const firstRevalidationError = (Array.isArray(revalidation?.errorDetails) ? revalidation.errorDetails[0] : null) ||
        (Array.isArray(counts.errorDetails) ? counts.errorDetails[0] : null);
      const affectedIds = Array.isArray(counts.appointmentIds) ? counts.appointmentIds : [];
      const actionRevision = [
        Date.now(),
        changed,
        Number(counts.reused || 0),
        Number(counts.found || 0),
        legacyMirrored,
        revalidationErrors,
        affectedIds.slice(0, 25).join(",")
      ].filter(Boolean).join(":");
      const requestRows = (pageNumber: number) => dataService.getClosureAppointments({
        from: toApiDate(from),
        to: toApiDate(to, true),
        status,
        patientId: patientFilter,
        professionalId: professionalFilter,
        serviceType,
        page: pageNumber,
        limit: 50,
        onlyPending: quickFilter === "pending",
        onlyReady: quickFilter === "ready",
        onlyWarnings: quickFilter === "warning",
        missing: ["signature", "report", "guide", "authorization", "documents", "procedure", "tuss", "amount", "professional_registry", "card"].includes(quickFilter) ? quickFilter : "",
        actionRevision,
      });
      let result = await requestRows(page);
      let nextRows = Array.isArray(result?.data) ? result.data : [];
      if (result?.success && changed > 0 && nextRows.length === 0 && page > 1) {
        const firstPageResult = await requestRows(1);
        if (firstPageResult?.success) {
          result = firstPageResult;
          nextRows = Array.isArray(firstPageResult.data) ? firstPageResult.data : [];
          setPage(1);
        }
      }
      if (!result?.success) {
        setRows([]);
        setTotals(null);
        setRevalidationInfo("");
        setError(result?.error || "Não foi possível carregar o fechamento agora.");
        return;
      }
      setRows(nextRows);
      setTotals(result.totals || null);
      if (revalidation?.success === false && revalidationErrors > 0) {
        setRevalidationInfo("");
        const reason = [firstRevalidationError?.reasonCode, firstRevalidationError?.dbCode].filter(Boolean).join(" · ");
        const detail = firstRevalidationError?.message ? ` Primeiro erro: ${reason || "sem código"} - ${firstRevalidationError.message}` : "";
        setError(`${revalidationMessage}${detail}`);
      } else if (revalidation?.success) {
        if (changed > 0 && nextRows.length === 0) {
          setRevalidationInfo("");
          setError(
            hasActiveFilters
              ? `${revalidationMessage} Os filtros atuais ocultam os resultados.`
              : `${revalidationMessage} Nenhum item foi carregado na tabela.`
          );
        } else if (legacyMirrored > 0 && changed === 0 && nextRows.length === 0) {
          setRevalidationInfo("");
          setError(`${legacyMirrored} agendamento(s) foram sincronizados, mas os checks de fechamento ainda nÃ£o foram materializados.`);
        } else {
          setRevalidationInfo(revalidationMessage);
        }
      } else {
        setRevalidationInfo("");
      }
    } catch {
      setRows([]);
      setTotals(null);
      setRevalidationInfo("");
      setError("Não foi possível carregar o fechamento agora.");
    } finally {
      setLoading(false);
    }
  }, [from, page, patientFilter, professionalFilter, quickFilter, serviceType, status, to]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const openDetail = async (row: ClosureRow) => {
    const appointmentId = String(row.appointment_id || "");
    if (!appointmentId) return;
    setDetail(row);
    setDetailLoading(true);
    setError("");
    try {
      const result = await dataService.getClosureAppointmentDetail(appointmentId);
      if (result?.success && result.data) setDetail(result.data);
      else setError(result?.error || "Não foi possível carregar o fechamento agora.");
    } finally {
      setDetailLoading(false);
    }
  };

  const revalidate = async (row: ClosureRow) => {
    const appointmentId = String(row.appointment_id || "");
    if (!appointmentId) return;
    setActionLoadingId(appointmentId);
    setError("");
    try {
      const result = await dataService.revalidateClosureAppointment(appointmentId);
      if (!result?.success) {
        setError(result?.error || "Não foi possível revalidar o fechamento agora.");
      } else {
        await loadRows();
        if (detail?.appointment_id === appointmentId) await openDetail(row);
      }
    } finally {
      setActionLoadingId("");
    }
  };

  const submitOverride = async () => {
    const appointmentId = String(overrideTarget?.appointment_id || "");
    if (!appointmentId || overrideReason.trim().length < 8) return;
    setActionLoadingId(appointmentId);
    setError("");
    try {
      const result = await dataService.overrideClosureAppointment(appointmentId, {
        readinessStatus: "NOT_BILLABLE",
        reason: overrideReason.trim(),
      });
      if (!result?.success) {
        setError(result?.error || "Não foi possível atualizar o fechamento agora.");
      } else {
        setOverrideTarget(null);
        setOverrideReason("");
        await loadRows();
      }
    } finally {
      setActionLoadingId("");
    }
  };

  const timeGroups = useMemo(() => {
    const byPatient = new Map<string, number>();
    const byProfessional = new Map<string, number>();
    const byType = new Map<string, number>();
    rows.forEach((row) => {
      const minutes = Number(row.actual_minutes || 0);
      if (!Number.isFinite(minutes) || minutes <= 0) return;
      byPatient.set(row.patient_name || "Paciente", (byPatient.get(row.patient_name || "Paciente") || 0) + minutes);
      byProfessional.set(row.professional_name || "Equipe", (byProfessional.get(row.professional_name || "Equipe") || 0) + minutes);
      byType.set(row.service_type || "Sessão", (byType.get(row.service_type || "Sessão") || 0) + minutes);
    });
    const top = (map: Map<string, number>) =>
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
    return { byPatient: top(byPatient), byProfessional: top(byProfessional), byType: top(byType) };
  }, [rows]);

  const kpis = [
    { label: "Prontas", value: totals?.ready ?? 0, tone: "text-emerald-700" },
    { label: "Pendências operacionais", value: totals?.pending ?? 0, tone: "text-rose-700" },
    { label: "Em aberto", value: totals?.open ?? totals?.draft ?? 0, tone: "text-sky-700" },
    { label: "Atenção", value: totals?.warning ?? 0, tone: "text-amber-700" },
    { label: "Não faturáveis", value: totals?.notBillable ?? 0, tone: "text-slate-700" },
    { label: "A revisar", value: totals?.unknown ?? 0, tone: "text-zinc-700" },
    { label: "Total de sessões", value: totals?.total ?? rows.length, tone: "text-slate-900" },
    { label: "Minutos realizados", value: totals?.actualMinutes ?? 0, tone: "text-indigo-700" },
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <ClipboardCheck size={18} className="text-indigo-600" />
              Fechamento operacional
            </div>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Sessões preparadas para conferência administrativa, auditoria e pré-faturamento.
            </p>
          </div>
          <button
            type="button"
            onClick={loadRows}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            disabled={loading}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Atualizar
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {kpis.map((item) => (
            <div key={item.label} className="rounded-md border border-slate-200 px-3 py-2">
              <div className="text-xs text-slate-500">{item.label}</div>
              <div className={`mt-1 text-xl font-semibold ${item.tone}`}>{item.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-6">
          <label className="text-xs font-medium text-slate-600">
            De
            <input
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Até
            <input
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Status
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setQuickFilter("");
                setPage(1);
              }}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
            >
              <option value="">Todos</option>
              {Object.entries(statusMeta).map(([key, meta]) => (
                <option key={key} value={key}>{meta.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Paciente
            <select
              value={patientFilter}
              onChange={(event) => {
                setPatientFilter(event.target.value);
                setPage(1);
              }}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
            >
              <option value="">Todos</option>
              {patientOptions.map((patient) => (
                <option key={patient.id} value={patient.id}>{patient.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Profissional
            <select
              value={professionalFilter}
              onChange={(event) => {
                setProfessionalFilter(event.target.value);
                setPage(1);
              }}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
            >
              <option value="">Todos</option>
              {professionalOptions.map((member) => (
                <option key={member.id || member.user_id} value={member.id || member.user_id}>
                  {member.name || member.full_name || member.email || "Equipe"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Tipo
            <select
              value={serviceType}
              onChange={(event) => {
                setServiceType(event.target.value);
                setPage(1);
              }}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
            >
              <option value="">Todos</option>
              {serviceTypeOptions.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ["pending", "Somente pendências operacionais"],
            ["ready", "Somente prontas"],
            ["warning", "Somente alertas"],
            ["signature", "Sem assinatura"],
            ["report", "Sem relatório"],
            ["guide", "Sem guia"],
            ["authorization", "Sem autorização"],
            ["documents", "Documentos pendentes"],
            ["procedure", "Sem procedimento"],
            ["tuss", "Sem TUSS"],
            ["amount", "Sem valor"],
            ["professional_registry", "Sem registro"],
            ["card", "Sem carteirinha"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setQuickFilter((current) => current === key ? "" : key);
                setStatus("");
                setPage(1);
              }}
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition ${
                quickFilter === key
                  ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Filter size={14} />
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        {[
          ["Tempo por paciente", timeGroups.byPatient],
          ["Tempo por profissional", timeGroups.byProfessional],
          ["Tempo por especialidade", timeGroups.byType],
        ].map(([label, values]) => (
          <div key={String(label)} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-sm font-semibold text-slate-700">{String(label)}</div>
            <div className="mt-2 space-y-2">
              {(values as [string, number][]).length === 0 ? (
                <div className="text-sm text-slate-500">Sem tempo realizado no período.</div>
              ) : (values as [string, number][]).map(([name, minutes]) => (
                <div key={name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-slate-600">{name}</span>
                  <span className="font-medium text-slate-800">{formatMinutes(minutes)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}
      {!error && revalidationInfo && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {revalidationInfo}
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Search size={16} className="text-slate-400" />
            Sessões do período
          </div>
          <div className="text-sm text-slate-500">Página {page}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Paciente</th>
                <th className="px-4 py-3">Profissional</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Procedimento/TUSS</th>
                <th className="px-4 py-3">Pagador</th>
                <th className="px-4 py-3">Plano</th>
                <th className="px-4 py-3">Guia/autorização</th>
                <th className="px-4 py-3">Planejado</th>
                <th className="px-4 py-3">Realizado</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Pendências e configurações</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={13} className="px-4 py-10 text-center text-slate-500">
                    <Loader2 size={20} className="mx-auto mb-2 animate-spin" />
                    Carregando fechamento
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-4 py-10 text-center text-slate-500">
                    Nenhuma sessão encontrada no período.
                  </td>
                </tr>
              ) : rows.map((row) => {
                const meta = statusMeta[normalizeStatus(row.readiness_status)];
                const StatusIcon = meta.icon;
                const isBusy = actionLoadingId === row.appointment_id;
                const pendingDetails = classifyConferencePendingDetails(row);
                return (
                  <tr key={String(row.appointment_id || `${row.patient_name}-${row.scheduled_start}`)} className="align-top hover:bg-slate-50/70">
                    <td className="px-4 py-3 text-slate-700">{formatDateTime(row.scheduled_start)}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{row.patient_name || "Paciente"}</td>
                    <td className="px-4 py-3 text-slate-600">{row.professional_name || "Equipe"}</td>
                    <td className="px-4 py-3 text-slate-600">{row.service_type || "Sessão"}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <div className="font-medium text-slate-700">{row.internal_procedure_name || "Procedimento nao configurado"}</div>
                      <div className="mt-1 text-xs text-slate-500">{row.tuss_code ? `TUSS ${row.tuss_code}` : "TUSS: pendente de mapeamento"}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.payer_name || "Sem pagador"}</td>
                    <td className="px-4 py-3 text-slate-600">{row.financial_plan_name || "Não configurado"}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.guide_number || row.authorization_code || Number(row.required_document_pending_count || 0) > 0
                        ? [row.guide_number ? `Guia ${row.guide_number}` : "", row.authorization_code ? "Autorização informada" : "", Number(row.required_document_pending_count || 0) > 0 ? `${row.required_document_pending_count} doc.` : ""].filter(Boolean).join(" · ")
                        : "Pendente/não exigida"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatMinutes(row.scheduled_minutes)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatMinutes(row.actual_minutes)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ring-1 ${meta.className}`}>
                        <StatusIcon size={13} />
                        {meta.label}
                      </span>
                    </td>
                    <td className="max-w-[260px] px-4 py-3 text-slate-600">
                      <div>{getHumanIssueCount(row)}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {pendingDetails.visible.length === 0 ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">Sem pendência</span>
                        ) : pendingDetails.visible.slice(0, 4).map((item) => (
                          <span key={`${item.category}-${item.label}`} className={`rounded-full px-2 py-1 text-xs ring-1 ${pendingChipClass(item)}`}>{pendingChipLabel(item)}</span>
                        ))}
                      </div>
                      {Array.isArray(row.main_issues) && row.main_issues.length > 0 && (
                        <div className="mt-1 truncate text-xs text-slate-500">{row.main_issues[0]}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button type="button" className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-white" onClick={() => openDetail(row)} title="Ver checklist">
                          <ClipboardCheck size={16} />
                        </button>
                        <button type="button" className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-white" onClick={() => onOpenAppointment?.(row)} title="Abrir sessão">
                          <Stethoscope size={16} />
                        </button>
                        <button type="button" className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-white" onClick={() => onOpenReport?.(row)} title="Abrir relatório">
                          <FileText size={16} />
                        </button>
                        <button type="button" className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-white disabled:opacity-60" onClick={() => revalidate(row)} disabled={isBusy} title="Revalidar">
                          {isBusy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                        </button>
                        {canOverride && (
                          <button type="button" className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-white" onClick={() => setOverrideTarget(row)} title="Marcar como não faturável">
                            <ShieldAlert size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <button type="button" className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 disabled:opacity-40" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>
            Anterior
          </button>
          <button type="button" className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 disabled:opacity-40" disabled={!canGoNext || loading} onClick={() => setPage((value) => value + 1)}>
            Próxima
          </button>
        </div>
      </section>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 sm:items-center" role="dialog" aria-modal="true">
          <div className="max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-lg font-semibold text-slate-900">Checklist de fechamento</div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                  <span className="inline-flex items-center gap-1"><UserRound size={14} />{detail.patient_name || "Paciente"}</span>
                  <span>{formatDateTime(detail.scheduled_start)}</span>
                  <span>{detail.professional_name || "Equipe"}</span>
                  <span>{detail.service_type || "Sessão"}</span>
                </div>
              </div>
              <button type="button" className="rounded-md p-2 text-slate-500 hover:bg-slate-100" onClick={() => setDetail(null)} aria-label="Fechar checklist">
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[68vh] overflow-y-auto px-5 py-4">
              <div className="mb-4 grid gap-3 sm:grid-cols-4">
                <div className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                  <div className="text-xs text-slate-500">Planejado</div>
                  <div className="font-semibold text-slate-800">{formatMinutes(detail.scheduled_minutes)}</div>
                </div>
                <div className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                  <div className="text-xs text-slate-500">Realizado</div>
                  <div className="font-semibold text-slate-800">{formatMinutes(detail.actual_minutes)}</div>
                </div>
                <div className="rounded-md border border-slate-200 px-3 py-2 text-sm sm:col-span-2">
                  <div className="text-xs text-slate-500">Status</div>
                  <div className="font-semibold text-slate-800">{statusMeta[normalizeStatus(detail.readiness_status)].label}</div>
                </div>
              </div>

              <div className="mb-4 rounded-md border border-violet-100 bg-violet-50 px-3 py-3 text-sm">
                <div className="font-semibold text-slate-800">Regras do pagador</div>
                <div className="mt-2 grid gap-2 text-slate-600 sm:grid-cols-2">
                  <span>Pagador: {detail.payer_name || "Sem pagador"}</span>
                  <span>Regra aplicada: {detail.payer_requirement_source || "Default"}</span>
                  <span>Plano financeiro: {detail.financial_plan_name || "Não configurado"}</span>
                  <span>Procedimento: {detail.internal_procedure_name || "Não configurado"}</span>
                  <span>TUSS: {detail.tuss_code || "Pendente"}</span>
                  <span>Guia provável: {detail.guide_type || "Não definida"}</span>
                  <span>Valor previsto: {detail.billing_amount_cents ? `R$ ${(Number(detail.billing_amount_cents) / 100).toFixed(2)}` : "Não configurado"}</span>
                  <span>Guia: {detail.guide_number || "Pendente/não exigida"}</span>
                  <span>Autorização: {detail.authorization_code || "Pendente/não exigida"}</span>
                </div>
              </div>

              {detailLoading ? (
                <div className="py-10 text-center text-sm text-slate-500">
                  <Loader2 size={20} className="mx-auto mb-2 animate-spin" />
                  Carregando checklist
                </div>
              ) : (
                <div className="space-y-2">
                  {(detail.checklist || []).map((item) => {
                    const meta = checkStatusMeta[item.status] || checkStatusMeta.NOT_APPLICABLE;
                    const Icon = meta.icon;
                    return (
                      <div key={item.key} className="rounded-md border border-slate-200 px-3 py-3">
                        <div className="flex items-start gap-3">
                          <Icon size={18} className={`${meta.className} mt-0.5`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-slate-800">{item.label}</span>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{meta.label}</span>
                              {item.required && (
                                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-600">Obrigatório</span>
                              )}
                              <span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs text-slate-500">{severityLabel[item.severity] || "Baixa"}</span>
                            </div>
                            <div className="mt-1 text-sm text-slate-600">{item.message}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button type="button" className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600" onClick={() => revalidate(detail)}>
                Revalidar
              </button>
              <button type="button" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white" onClick={() => setDetail(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {overrideTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 sm:items-center" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <div className="text-lg font-semibold text-slate-900">Marcar como não faturável</div>
            <p className="mt-1 text-sm text-slate-500">
              Informe a justificativa para registrar a alteração no histórico de auditoria.
            </p>
            <textarea
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
              className="mt-4 min-h-[110px] w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
              placeholder="Exemplo: sessão cancelada pela clínica e não será enviada para conferência."
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600" onClick={() => setOverrideTarget(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={overrideReason.trim().length < 8 || actionLoadingId === overrideTarget.appointment_id}
                onClick={submitOverride}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
