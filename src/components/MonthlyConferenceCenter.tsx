import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Stethoscope,
  UserRound,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { dataService } from "../services/dataService";
import { classifyConferencePendingDetails, formatConferenceMinutes } from "../services/monthlyConferenceEngine";
import { formatDateTimeInAppointmentTimezone } from "../utils/scheduling";

type ConferenceStatus = "READY" | "PENDING" | "WARNING" | "NOT_BILLABLE" | "DRAFT" | "UNKNOWN";

type ConferenceRow = {
  appointment_id?: string | null;
  patient_id?: string | null;
  patient_name?: string | null;
  professional_id?: string | null;
  professional_name?: string | null;
  service_type?: string | null;
  payer_name?: string | null;
  clinic_name?: string | null;
  unit_name?: string | null;
  financial_plan_name?: string | null;
  insurance_card_number?: string | null;
  internal_procedure_code?: string | null;
  internal_procedure_name?: string | null;
  tuss_code?: string | null;
  tuss_description?: string | null;
  tuss_version?: string | null;
  guide_type?: string | null;
  billing_unit?: string | null;
  billing_quantity?: number | null;
  billing_unit_amount_cents?: number | null;
  billing_amount_cents?: number | null;
  tuss_mapping_status?: string | null;
  tuss_pending_reasons?: string[] | null;
  professional_registry?: string | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  scheduled_minutes?: number | null;
  actual_minutes?: number | null;
  readiness_status?: string | null;
  blocking_issues_count?: number | null;
  warning_issues_count?: number | null;
  required_document_pending_count?: number | null;
  guide_number?: string | null;
  authorization_code?: string | null;
  conference_status?: string | null;
  conference_status_label?: string | null;
  export_status?: string | null;
  export_id?: string | null;
  exported_at?: string | null;
  exported_by_name?: string | null;
  conference_reason?: string | null;
  main_issues?: string[];
  checklist?: any[];
  payerRules?: any;
  audit?: any;
};

type MonthlyConferenceCenterProps = {
  patients?: any[];
  professionals?: any[];
  payers?: any[];
  canExport?: boolean;
  onOpenAppointment?: (row: ConferenceRow) => void;
  onOpenReport?: (row: ConferenceRow) => void;
};

const statusMeta: Record<ConferenceStatus, { label: string; className: string; icon: React.ComponentType<any> }> = {
  READY: { label: "Pronta para faturar", className: "bg-emerald-50 text-emerald-700 ring-emerald-200", icon: CheckCircle2 },
  PENDING: { label: "Pendente", className: "bg-orange-50 text-orange-700 ring-orange-200", icon: XCircle },
  WARNING: { label: "Em atenção", className: "bg-amber-50 text-amber-700 ring-amber-200", icon: AlertTriangle },
  NOT_BILLABLE: { label: "Não faturável", className: "bg-slate-100 text-slate-700 ring-slate-200", icon: ShieldAlert },
  DRAFT: { label: "Em aberto", className: "bg-sky-50 text-sky-700 ring-sky-200", icon: CalendarDays },
  UNKNOWN: { label: "A revisar", className: "bg-zinc-100 text-zinc-700 ring-zinc-200", icon: AlertTriangle },
};

const conferenceStatusMeta: Record<string, { label: string; className: string }> = {
  pending_review: { label: "A revisar", className: "bg-zinc-100 text-zinc-700 ring-zinc-200" },
  reviewed: { label: "Conferido", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  exported: { label: "Exportado", className: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  reopened: { label: "Reaberto", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  non_billable: { label: "Não faturável", className: "bg-slate-100 text-slate-700 ring-slate-200" },
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
  return value ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}` : "";
}

function normalizeStatus(value?: string | null): ConferenceStatus {
  const status = String(value || "UNKNOWN").toUpperCase();
  return Object.prototype.hasOwnProperty.call(statusMeta, status) ? (status as ConferenceStatus) : "UNKNOWN";
}

function normalizeConferenceWorkflowStatus(value?: string | null) {
  const status = String(value || "pending_review").toLowerCase();
  return Object.prototype.hasOwnProperty.call(conferenceStatusMeta, status) ? status : "pending_review";
}

function formatDateTime(value?: string | null) {
  if (!value) return "Sem horário";
  return formatDateTimeInAppointmentTimezone(value) || "Sem horário";
}

function formatOptionalMinutes(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "Não informado";
  return formatConferenceMinutes(value);
}

function safeName(value: any, fallback: string) {
  return String(value || fallback).trim() || fallback;
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

function shortIssueLabel(value: string) {
  const normalized = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (normalized.includes("assinatura")) return "Assinatura";
  if (normalized.includes("relatorio") || normalized.includes("evolucao")) return "Relatório";
  if (normalized.includes("guia")) return "Guia";
  if (normalized.includes("autoriz")) return "Autorização";
  if (normalized.includes("duracao")) return "Duração";
  if (normalized.includes("document")) return "Documento";
  if (normalized.includes("pagador") || normalized.includes("convenio")) return "Pagador";
  return "Conferência";
}

function pendingStatusText(row: ConferenceRow, label: string, pendingText: string, clearText: string) {
  const details = classifyConferencePendingDetails(row);
  if (details.operational.includes(label) || details.configuration.includes(label)) return pendingText;
  if (details.notApplicable.includes(label)) return "Ainda não aplicável.";
  if (details.informational.includes(label)) return "Não aplicável ao faturamento.";
  return clearText;
}

export function MonthlyConferenceCenter({
  patients = [],
  professionals = [],
  payers = [],
  canExport = false,
  onOpenAppointment,
  onOpenReport,
}: MonthlyConferenceCenterProps) {
  const initialBounds = useMemo(() => monthBounds(), []);
  const [from, setFrom] = useState(initialBounds.from);
  const [to, setTo] = useState(initialBounds.to);
  const [patientId, setPatientId] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [payerId, setPayerId] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [readinessStatus, setReadinessStatus] = useState("");
  const [appointmentStatus, setAppointmentStatus] = useState("");
  const [quickFilter, setQuickFilter] = useState("");
  const [activeTab, setActiveTab] = useState<"sessions" | "patient" | "professional" | "payer" | "service" | "procedure" | "tuss" | "guide">("sessions");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ConferenceRow[]>([]);
  const [kpis, setKpis] = useState<any>(null);
  const [pendingByType, setPendingByType] = useState<any[]>([]);
  const [summaries, setSummaries] = useState<Record<string, any[]>>({ patient: [], professional: [], payer: [], service: [], procedure: [], tuss: [], guide: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revalidationInfo, setRevalidationInfo] = useState("");
  const [detail, setDetail] = useState<ConferenceRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportType, setExportType] = useState("billing_conference_full");
  const [exportFields, setExportFields] = useState<string[]>([
    "competenceMonth",
    "clinicName",
    "unitName",
    "scheduledDate",
    "startTime",
    "endTime",
    "patientName",
    "professionalName",
    "professionalRegistry",
    "serviceType",
    "payerName",
    "financialPlanName",
    "insuranceCardNumber",
    "guideNumber",
    "authorizationCode",
    "copaymentAmount",
    "expectedAmount",
    "financialStatus",
    "scheduledMinutes",
    "actualMinutes",
    "appointmentStatus",
    "readinessStatus",
    "conferenceStatus",
    "exportStatus",
    "signaturePresent",
    "reportPresent",
    "pendingDocuments",
    "pendingDetails",
    "exportedAt",
    "exportedBy",
    "exportId",
    "notes",
    "internalProcedureCode",
    "internalProcedureName",
    "tussCode",
    "tussDescription",
    "tussVersion",
    "guideType",
    "billingUnit",
    "billingQuantity",
    "billingUnitAmount",
    "billingExpectedAmount",
    "tussMappingStatus",
    "tussPendingReasons",
  ]);
  const [exporting, setExporting] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState("");
  const [reopenTarget, setReopenTarget] = useState<ConferenceRow | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    checklist: true,
    payer: true,
    documents: false,
    signature: false,
    report: false,
    audit: false,
  });

  const serviceTypeOptions = useMemo(() => {
    const values = new Set<string>();
    rows.forEach((row) => {
      const value = String(row.service_type || "").trim();
      if (value) values.add(value);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [rows]);

  const filterPayload = useMemo(() => ({
    from: toApiDate(from),
    to: toApiDate(to, true),
    patientId,
    professionalId,
    payerId,
    serviceType,
    readinessStatus,
    appointmentStatus,
    onlyPending: quickFilter === "pending",
    onlyReady: quickFilter === "ready",
    onlyNotBillable: quickFilter === "not_billable",
    missing: ["signature", "report", "guide", "authorization", "documents", "procedure", "tuss", "amount", "professional_registry", "card"].includes(quickFilter) ? quickFilter : "",
  }), [appointmentStatus, from, patientId, payerId, professionalId, quickFilter, readinessStatus, serviceType, to]);

  const loadConference = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const hasActiveFilters = Boolean(patientId || professionalId || payerId || serviceType || readinessStatus || appointmentStatus || quickFilter);
      const revalidation = await dataService.revalidateClosurePeriod({
        from: filterPayload.from,
        to: filterPayload.to,
      });
      const counts = revalidation?.data || revalidation?.counts || {};
      const changed = Number(counts.created || 0) + Number(counts.updated || 0);
      const legacyMirrored = Number(counts.legacyMirrored || 0);
      const revalidationErrors = Number(counts.errors || 0);
      const revalidationMessage = formatRevalidationMessage(counts, "conferência mensal");
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
      const listPayload = { ...filterPayload, actionRevision };
      if (revalidation?.success) {
        setRevalidationInfo("");
      } else {
        setRevalidationInfo("");
      }
      const [main, byPatient, byProfessional, byPayer, byService, byProcedure, byTuss, byGuide] = await Promise.all([
        dataService.getMonthlyConference({ ...listPayload, page, limit: 50 }),
        dataService.getMonthlyConferenceSummary("patient", listPayload),
        dataService.getMonthlyConferenceSummary("professional", listPayload),
        dataService.getMonthlyConferenceSummary("payer", listPayload),
        dataService.getMonthlyConferenceSummary("service-type", listPayload),
        dataService.getMonthlyConferenceSummary("procedure", listPayload),
        dataService.getMonthlyConferenceSummary("tuss-code", listPayload),
        dataService.getMonthlyConferenceSummary("guide-type", listPayload),
      ]);
      if (!main?.success) {
        setRows([]);
        setKpis(null);
        setPendingByType([]);
        setError(main?.error || "Não foi possível carregar a conferência agora.");
        return;
      }
      let mainResult = main;
      let nextRows = Array.isArray(main.rows || main.data) ? (main.rows || main.data) : [];
      const totalSessions = Number(main.kpis?.totalSessions || main.kpis?.total || 0);
      if (nextRows.length === 0 && page > 1 && (changed > 0 || totalSessions > 0)) {
        const firstPage = await dataService.getMonthlyConference({ ...listPayload, page: 1, limit: 50 });
        if (firstPage?.success) {
          mainResult = firstPage;
          nextRows = Array.isArray(firstPage.rows || firstPage.data) ? (firstPage.rows || firstPage.data) : [];
          setPage(1);
        }
      }
      setRows(nextRows);
      setKpis(mainResult.kpis || null);
      setPendingByType(Array.isArray(mainResult.pendingByType) ? mainResult.pendingByType : []);
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
          setError(`${legacyMirrored} agendamento(s) foram sincronizados, mas os checks de conferência ainda não foram materializados.`);
        } else {
          setRevalidationInfo(revalidationMessage);
        }
      }
      setSummaries({
        patient: Array.isArray(byPatient?.data) ? byPatient.data : [],
        professional: Array.isArray(byProfessional?.data) ? byProfessional.data : [],
        payer: Array.isArray(byPayer?.data) ? byPayer.data : [],
        service: Array.isArray(byService?.data) ? byService.data : [],
        procedure: Array.isArray(byProcedure?.data) ? byProcedure.data : [],
        tuss: Array.isArray(byTuss?.data) ? byTuss.data : [],
        guide: Array.isArray(byGuide?.data) ? byGuide.data : [],
      });
    } catch {
      setRows([]);
      setKpis(null);
      setRevalidationInfo("");
      setError("Não foi possível carregar a conferência agora.");
    } finally {
      setLoading(false);
    }
  }, [appointmentStatus, filterPayload, page, patientId, payerId, professionalId, quickFilter, readinessStatus, serviceType]);

  useEffect(() => {
    void loadConference();
  }, [loadConference]);

  const openDetail = async (row: ConferenceRow) => {
    const appointmentId = String(row.appointment_id || "");
    if (!appointmentId) return;
    setDetail(row);
    setDetailLoading(true);
    setError("");
    try {
      const result = await dataService.getMonthlyConferenceSession(appointmentId);
      if (result?.success && result.data) setDetail(result.data);
      else setError(result?.error || "Não foi possível carregar a sessão.");
    } finally {
      setDetailLoading(false);
    }
  };

  const revalidateDetail = async () => {
    const appointmentId = String(detail?.appointment_id || "");
    if (!appointmentId) return;
    setDetailLoading(true);
    try {
      const result = await dataService.revalidateMonthlyConferenceSession(appointmentId);
      if (!result?.success) setError(result?.error || "Não foi possível revalidar.");
      else {
        await loadConference();
        const refreshed = await dataService.getMonthlyConferenceSession(appointmentId);
        if (refreshed?.success && refreshed.data) setDetail(refreshed.data);
      }
    } finally {
      setDetailLoading(false);
    }
  };

  const applyUpdatedConferenceRows = (items: ConferenceRow[]) => {
    const updates = new Map(
      (Array.isArray(items) ? items : [])
        .filter((item) => item?.appointment_id)
        .map((item) => [String(item.appointment_id), item])
    );
    if (updates.size === 0) return;
    setRows((current) => current.map((row) => updates.get(String(row.appointment_id || "")) || row));
    setDetail((current) => {
      if (!current?.appointment_id) return current;
      return updates.get(String(current.appointment_id)) || current;
    });
  };

  const markReviewed = async (row: ConferenceRow) => {
    const appointmentId = String(row.appointment_id || "");
    if (!appointmentId) return;
    setActionLoadingId(appointmentId);
    setError("");
    try {
      const result = await dataService.updateMonthlyConferenceSessionStatus(appointmentId, { status: "reviewed" });
      if (!result?.success || !result.data) {
        setError(result?.error || "Não foi possível marcar a sessão como conferida.");
        return;
      }
      applyUpdatedConferenceRows([result.data]);
    } finally {
      setActionLoadingId("");
    }
  };

  const submitReopen = async () => {
    const appointmentId = String(reopenTarget?.appointment_id || "");
    if (!appointmentId || reopenReason.trim().length < 8) return;
    setActionLoadingId(appointmentId);
    setError("");
    try {
      const result = await dataService.updateMonthlyConferenceSessionStatus(appointmentId, {
        status: "reopened",
        reason: reopenReason.trim(),
      });
      if (!result?.success || !result.data) {
        setError(result?.error || "Não foi possível reabrir a conferência.");
        return;
      }
      applyUpdatedConferenceRows([result.data]);
      setReopenTarget(null);
      setReopenReason("");
    } finally {
      setActionLoadingId("");
    }
  };

  const runExport = async () => {
    setExporting(true);
    setError("");
    try {
      const result = await dataService.exportMonthlyConference({
        exportType,
        filters: filterPayload,
        fields: exportFields,
      });
      if (!result?.success || !result.csv) {
        setError(result?.error || "Não foi possível exportar a conferência.");
        return;
      }
      const blob = new Blob([`\uFEFF${result.csv}`], { type: result.contentType || "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName || "conferencia-mensal.csv";
      link.click();
      URL.revokeObjectURL(url);
      if (Array.isArray(result.affectedItems)) applyUpdatedConferenceRows(result.affectedItems);
      setExportOpen(false);
    } finally {
      setExporting(false);
    }
  };

  const kpiItems = [
    { label: "Total", value: kpis?.totalSessions ?? 0, tone: "text-slate-900" },
    { label: "Prontas", value: kpis?.ready ?? 0, tone: "text-emerald-700" },
    { label: "Pendências operacionais", value: kpis?.pending ?? 0, tone: "text-orange-700" },
    { label: "Em aberto", value: kpis?.open ?? kpis?.draft ?? 0, tone: "text-sky-700" },
    { label: "Atenção", value: kpis?.warning ?? 0, tone: "text-amber-700" },
    { label: "Não faturáveis", value: kpis?.notBillable ?? 0, tone: "text-slate-600" },
    { label: "A revisar", value: kpis?.unknown ?? 0, tone: "text-zinc-700" },
    { label: "Tempo realizado", value: formatConferenceMinutes(kpis?.actualMinutes || 0), tone: "text-indigo-700" },
    { label: "Tempo previsto", value: formatConferenceMinutes(kpis?.scheduledMinutes || 0), tone: "text-cyan-700" },
    { label: "Assinaturas pendentes", value: kpis?.pendingSignatures ?? 0, tone: "text-rose-700" },
    { label: "Relatórios pendentes", value: kpis?.pendingReports ?? 0, tone: "text-orange-700" },
    { label: "Guias pendentes", value: kpis?.pendingGuides ?? 0, tone: "text-violet-700" },
  ];

  const summaryRows = activeTab === "patient"
    ? summaries.patient
    : activeTab === "professional"
      ? summaries.professional
    : activeTab === "payer"
      ? summaries.payer
      : activeTab === "service"
        ? summaries.service
        : activeTab === "procedure"
          ? summaries.procedure
          : activeTab === "tuss"
            ? summaries.tuss
            : activeTab === "guide"
              ? summaries.guide
          : [];

  const operationalPendingTypes = useMemo(
    () => pendingByType.filter((item) => item?.category === "operational"),
    [pendingByType]
  );
  const configurationPendingTypes = useMemo(
    () => pendingByType.filter((item) => item?.category === "configuration"),
    [pendingByType]
  );

  const renderSection = (key: string, title: string, children: React.ReactNode) => (
    <div className="border-t border-slate-200 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpenSections((current) => ({ ...current, [key]: !current[key] }))}
        className="flex w-full items-center justify-between px-5 py-3 text-left text-sm font-semibold text-slate-800"
      >
        {title}
        <ChevronDown size={16} className={`transition ${openSections[key] ? "rotate-180" : ""}`} />
      </button>
      {openSections[key] && <div className="px-5 pb-4">{children}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <ClipboardCheck size={18} className="text-indigo-600" />
              Conferência mensal
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Revisão operacional do período para pré-faturamento, auditoria e conferência administrativa.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={loadConference}
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              disabled={loading}
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Atualizar
            </button>
            {canExport && (
              <button
                type="button"
                onClick={() => setExportOpen(true)}
                className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
              >
                <Download size={16} />
                Exportar
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-8">
          <label className="text-xs font-medium text-slate-600">
            De
            <input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Até
            <input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Paciente
            <select value={patientId} onChange={(event) => { setPatientId(event.target.value); setPage(1); }} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
              <option value="">Todos</option>
              {patients.map((patient) => patient?.id && <option key={patient.id} value={patient.id}>{patient.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Profissional
            <select value={professionalId} onChange={(event) => { setProfessionalId(event.target.value); setPage(1); }} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
              <option value="">Todos</option>
              {professionals.map((member) => {
                const id = String(member?.id || member?.user_id || "");
                return id ? <option key={id} value={id}>{member?.name || member?.full_name || member?.email || "Equipe"}</option> : null;
              })}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Pagador
            <select value={payerId} onChange={(event) => { setPayerId(event.target.value); setPage(1); }} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
              <option value="">Todos</option>
              {payers.map((payer) => payer?.id && <option key={payer.id} value={payer.id}>{payer.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Especialidade
            <select value={serviceType} onChange={(event) => { setServiceType(event.target.value); setPage(1); }} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
              <option value="">Todas</option>
              {serviceTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Prontidão
            <select value={readinessStatus} onChange={(event) => { setReadinessStatus(event.target.value); setQuickFilter(""); setPage(1); }} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
              <option value="">Todas</option>
              {Object.entries(statusMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Consulta
            <select value={appointmentStatus} onChange={(event) => { setAppointmentStatus(event.target.value); setPage(1); }} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
              <option value="">Todas</option>
              <option value="completed">Realizada</option>
              <option value="scheduled">Agendada</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ["pending", "Somente pendências operacionais"],
            ["ready", "Somente prontas"],
            ["not_billable", "Não faturáveis"],
            ["signature", "Sem assinatura"],
            ["report", "Sem relatório"],
            ["guide", "Sem guia"],
            ["authorization", "Sem autorização"],
            ["documents", "Documentos"],
            ["procedure", "Sem procedimento"],
            ["tuss", "Sem TUSS"],
            ["amount", "Sem valor"],
            ["professional_registry", "Sem registro"],
            ["card", "Sem carteirinha"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => { setQuickFilter((current) => current === value ? "" : value); setReadinessStatus(""); setPage(1); }}
              className={`rounded-md border px-3 py-1.5 text-sm ${quickFilter === value ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {kpiItems.map((item) => (
          <div key={item.label} className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="text-xs text-slate-500">{item.label}</div>
            <div className={`mt-1 text-lg font-semibold ${item.tone}`}>{item.value}</div>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {[
            ["sessions", "Sessões", Search],
            ["patient", "Por paciente", UserRound],
            ["professional", "Por profissional", Users],
            ["payer", "Por pagador", ShieldAlert],
            ["service", "Por especialidade", BarChart3],
            ["procedure", "Por procedimento", ClipboardCheck],
            ["tuss", "Por TUSS", FileText],
            ["guide", "Por guia", Download],
          ].map(([value, label, Icon]: any) => (
            <button
              key={value}
              type="button"
              onClick={() => setActiveTab(value)}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${activeTab === value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </section>

      {pendingByType.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-sm font-semibold text-slate-700">Pendências e configurações mais frequentes</div>
          <div className="mt-0.5 text-xs text-slate-500">Bloqueios operacionais contam no KPI de pendências operacionais; configurações de pré-faturamento aparecem separadas.</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {operationalPendingTypes.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase text-rose-700">Bloqueios operacionais</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {operationalPendingTypes.slice(0, 8).map((item) => (
                    <span key={`operational-${item.type}`} className="rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-100">
                      {pendingDisplayLabel[item.type] || item.type}: {item.count}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {configurationPendingTypes.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase text-sky-700">Configurações pendentes</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {configurationPendingTypes.slice(0, 8).map((item) => (
                    <span key={`configuration-${item.type}`} className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 ring-1 ring-sky-100">
                      {pendingDisplayLabel[item.type] || item.type}: {item.count}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {!error && revalidationInfo && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{revalidationInfo}</div>
      )}

      {activeTab === "sessions" ? (
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="max-h-[70vh] overflow-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="sticky top-0 z-20 bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500 shadow-[0_1px_0_0_rgba(148,163,184,0.35)]">
                <tr>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Paciente</th>
                  <th className="px-4 py-3">Profissional</th>
                  <th className="px-4 py-3">Especialidade</th>
                  <th className="px-4 py-3">Procedimento/TUSS</th>
                  <th className="px-4 py-3">Pagador</th>
                  <th className="px-4 py-3">Planejado</th>
                  <th className="px-4 py-3">Realizado</th>
                  <th className="px-4 py-3">Consulta</th>
                  <th className="px-4 py-3">Fechamento</th>
                  <th className="px-4 py-3">Conferência</th>
                  <th className="px-4 py-3">Pendências e configurações</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={13} className="px-4 py-10 text-center text-slate-500"><Loader2 className="mx-auto mb-2 animate-spin" size={20} />Carregando conferência</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={13} className="px-4 py-10 text-center text-slate-500">Nenhuma sessão encontrada no período.</td></tr>
                ) : rows.map((row, index) => {
                  const status = normalizeStatus(row.readiness_status);
                  const meta = statusMeta[status];
                  const StatusIcon = meta.icon;
                  const pendingDetails = classifyConferencePendingDetails(row);
                  const workflowStatus = normalizeConferenceWorkflowStatus(row.conference_status);
                  const workflowMeta = conferenceStatusMeta[workflowStatus];
                  const isBusy = actionLoadingId === row.appointment_id;
                  return (
                    <tr key={`${row.appointment_id || "session"}-${index}`} className="align-top hover:bg-slate-50/70">
                      <td className="px-4 py-3 text-slate-700">{formatDateTime(row.scheduled_start)}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{safeName(row.patient_name, "Paciente")}</td>
                      <td className="px-4 py-3 text-slate-600">{safeName(row.professional_name, "Equipe")}</td>
                      <td className="px-4 py-3 text-slate-600">{safeName(row.service_type, "Sessão")}</td>
                      <td className="px-4 py-3 text-slate-600">
                        <div className="font-medium text-slate-700">{row.internal_procedure_name || "Procedimento nao configurado"}</div>
                        <div className="mt-1 text-xs text-slate-500">{row.tuss_code ? `TUSS ${row.tuss_code}` : "TUSS: pendente de mapeamento"}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{safeName(row.payer_name, "Sem pagador")}</td>
                      <td className="px-4 py-3 text-slate-600">{formatOptionalMinutes(row.scheduled_minutes)}</td>
                      <td className="px-4 py-3 text-slate-600">{formatOptionalMinutes(row.actual_minutes)}</td>
                      <td className="px-4 py-3 text-slate-600">{Number(row.actual_minutes || 0) > 0 ? "Realizada" : status === "NOT_BILLABLE" ? "Não faturável" : "Agendada"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ring-1 ${meta.className}`}>
                          <StatusIcon size={13} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ring-1 ${workflowMeta.className}`}>
                            {workflowMeta.label}
                          </span>
                          {row.export_id && <span className="text-[11px] text-slate-500">Export {String(row.export_id).slice(0, 8)}</span>}
                        </div>
                      </td>
                      <td className="max-w-[260px] px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {pendingDetails.visible.length === 0 ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">Sem pendência</span>
                          ) : pendingDetails.visible.slice(0, 4).map((item) => (
                            <span key={`${item.category}-${item.label}`} className={`rounded-full px-2 py-1 text-xs ring-1 ${pendingChipClass(item)}`}>{pendingChipLabel(item)}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => openDetail(row)} title="Ver checklist" className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-white"><ClipboardCheck size={16} /></button>
                          <button type="button" onClick={() => onOpenAppointment?.(row)} title="Abrir consulta" className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-white"><Stethoscope size={16} /></button>
                          <button type="button" onClick={() => onOpenReport?.(row)} title="Abrir relatório" className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-white"><FileText size={16} /></button>
                          {workflowStatus === "exported" ? (
                            <button type="button" onClick={() => setReopenTarget(row)} disabled={isBusy} title="Reabrir conferência" className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-white disabled:opacity-60">
                              {isBusy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                            </button>
                          ) : workflowStatus !== "reviewed" && workflowStatus !== "non_billable" ? (
                            <button type="button" onClick={() => markReviewed(row)} disabled={isBusy} title="Marcar como conferido" className="rounded-md border border-slate-200 p-2 text-emerald-700 hover:bg-white disabled:opacity-60">
                              {isBusy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
            <button type="button" className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 disabled:opacity-40" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</button>
            <span className="text-sm text-slate-500">Página {page}</span>
            <button type="button" className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 disabled:opacity-40" disabled={rows.length < 50 || loading} onClick={() => setPage((value) => value + 1)}>Próxima</button>
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {summaryRows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-500">Sem resumo para os filtros atuais.</div>
            ) : summaryRows.map((item, index) => {
              const title = item.name || item.code || item.guideType || item.payerName || item.serviceType || "Resumo";
              return (
                <button
                  key={`${title}-${index}`}
                  type="button"
                  onClick={() => {
                    if (activeTab === "patient") setPatientId(String(item.id || ""));
                    if (activeTab === "professional") setProfessionalId(String(item.id || ""));
                    if (activeTab === "payer") setPayerId(String(item.id || ""));
                    if (activeTab === "service") setServiceType(String(item.serviceType || ""));
                    setActiveTab("sessions");
                    setPage(1);
                  }}
                  className="grid w-full gap-3 px-4 py-3 text-left hover:bg-slate-50 md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,0.7fr))]"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-800">{title}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {activeTab === "professional" && `${item.workedDaysCount || 0} dias trabalhados`}
                      {activeTab === "payer" && `${item.ready || 0} prontas · ${item.pending || 0} pendentes`}
                      {activeTab === "service" && `${item.realizedSessions || 0} sessões realizadas`}
                      {activeTab === "patient" && `${item.pendingSignatures || 0} assinaturas · ${item.pendingReports || 0} relatórios pendentes`}
                    </div>
                  </div>
                  <div className="text-sm text-slate-600"><span className="block text-xs text-slate-400">Sessões</span>{item.totalSessions || 0}</div>
                  <div className="text-sm text-slate-600"><span className="block text-xs text-slate-400">Realizadas</span>{item.realizedSessions || item.ready || 0}</div>
                  <div className="text-sm text-slate-600"><span className="block text-xs text-slate-400">Previsto</span>{formatConferenceMinutes(item.scheduledMinutes || 0)}</div>
                  <div className="text-sm text-slate-600"><span className="block text-xs text-slate-400">Realizado</span>{formatConferenceMinutes(item.actualMinutes || 0)}</div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {detail && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/40 p-4 sm:items-center" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-lg font-semibold text-slate-900">Conferência da sessão</div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                  <span>{safeName(detail.patient_name, "Paciente")}</span>
                  <span>{safeName(detail.professional_name, "Equipe")}</span>
                  <span>{formatDateTime(detail.scheduled_start)}</span>
                  <span>{safeName(detail.service_type, "Sessão")}</span>
                </div>
              </div>
              <button type="button" onClick={() => setDetail(null)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar conferência">
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              <div className="grid gap-3 p-5 sm:grid-cols-5">
                <div className="rounded-md border border-slate-200 px-3 py-2"><div className="text-xs text-slate-500">Planejado</div><div className="font-semibold">{formatOptionalMinutes(detail.scheduled_minutes)}</div></div>
                <div className="rounded-md border border-slate-200 px-3 py-2"><div className="text-xs text-slate-500">Realizado</div><div className="font-semibold">{formatOptionalMinutes(detail.actual_minutes)}</div></div>
                <div className="rounded-md border border-slate-200 px-3 py-2"><div className="text-xs text-slate-500">Pagador</div><div className="font-semibold">{safeName(detail.payer_name, "Sem pagador")}</div></div>
                <div className="rounded-md border border-slate-200 px-3 py-2"><div className="text-xs text-slate-500">Status</div><div className="font-semibold">{statusMeta[normalizeStatus(detail.readiness_status)].label}</div></div>
                <div className="rounded-md border border-slate-200 px-3 py-2"><div className="text-xs text-slate-500">Conferência</div><div className="font-semibold">{conferenceStatusMeta[normalizeConferenceWorkflowStatus(detail.conference_status)].label}</div></div>
              </div>

              {renderSection("checklist", "Checklist de fechamento", detailLoading ? (
                <div className="py-4 text-sm text-slate-500"><Loader2 size={16} className="mr-2 inline animate-spin" />Carregando checklist</div>
              ) : (
                <div className="space-y-2">
                  {(detail.checklist || []).length === 0 ? <div className="text-sm text-slate-500">Checklist ainda não disponível.</div> : detail.checklist?.map((item: any) => (
                    <div key={item.key || item.label} className="rounded-md border border-slate-200 px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-slate-800">{item.label || "Item de conferência"}</div>
                          <div className="mt-1 text-sm text-slate-600">{item.message || "Sem observação adicional."}</div>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{shortIssueLabel(item.label || item.message)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              {renderSection("payer", "Regras do pagador aplicadas", (
                <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                  <span>Pagador: {safeName(detail.payer_name, "Sem pagador")}</span>
                  <span>Regra: {detail.payerRules?.source || "Padrão"}</span>
                  <span>Guia: {detail.guide_number || "Pendente/não exigida"}</span>
                  <span>Autorização: {detail.authorization_code || "Pendente/não exigida"}</span>
                  <span>Plano financeiro: {detail.financial_plan_name || "Não configurado"}</span>
                  <span>Procedimento: {detail.internal_procedure_name || "Não configurado"}</span>
                  <span>TUSS: {detail.tuss_code || "Pendente"}</span>
                  <span>Guia provável: {detail.guide_type || "Não definida"}</span>
                  <span>Valor previsto: {detail.billing_amount_cents ? `R$ ${(Number(detail.billing_amount_cents) / 100).toFixed(2)}` : "Não configurado"}</span>
                  <span>Carteirinha: {detail.insurance_card_number || "Não informada"}</span>
                  <span>Registro profissional: {detail.professional_registry || "Não informado"}</span>
                  <span>Exportação: {detail.export_status || "Não exportado"}</span>
                </div>
              ))}
              {renderSection("documents", "Documentos obrigatórios", <div className="text-sm text-slate-600">{Number(detail.required_document_pending_count || 0)} documento(s) pendente(s).</div>)}
              {renderSection("signature", "Assinatura", <div className="text-sm text-slate-600">{pendingStatusText(detail, "Assinatura", "Assinatura pendente.", "Sem pendência de assinatura.")}</div>)}
              {renderSection("report", "Relatório/evolução", <div className="text-sm text-slate-600">{pendingStatusText(detail, "Relatorio", "Relatório pendente.", "Sem pendência de relatório.")}</div>)}
              {renderSection("audit", "Histórico/auditoria resumida", <div className="text-sm text-slate-600">Última atualização: {formatDateTime(detail.audit?.updatedAt || detail.audit?.generatedAt)}</div>)}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
              {normalizeConferenceWorkflowStatus(detail.conference_status) === "exported" ? (
                <button type="button" onClick={() => setReopenTarget(detail)} disabled={detailLoading} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 disabled:opacity-60">
                  <RefreshCw size={16} />
                  Reabrir
                </button>
              ) : normalizeConferenceWorkflowStatus(detail.conference_status) !== "reviewed" && normalizeConferenceWorkflowStatus(detail.conference_status) !== "non_billable" ? (
                <button type="button" onClick={() => markReviewed(detail)} disabled={detailLoading || actionLoadingId === detail.appointment_id} className="inline-flex items-center gap-2 rounded-md border border-emerald-200 px-3 py-2 text-sm text-emerald-700 disabled:opacity-60">
                  <CheckCircle2 size={16} />
                  Conferir
                </button>
              ) : null}
              <button type="button" onClick={revalidateDetail} disabled={detailLoading} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 disabled:opacity-60">
                {detailLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                Revalidar
              </button>
              <button type="button" onClick={() => setDetail(null)} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {exportOpen && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/40 p-4 sm:items-center" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-slate-900">Exportar conferência</div>
                <p className="mt-1 text-sm text-slate-500">Exporte apenas dados necessários para conferência administrativa.</p>
              </div>
              <button type="button" onClick={() => setExportOpen(false)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar exportação"><X size={18} /></button>
            </div>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Tipo
              <select value={exportType} onChange={(event) => setExportType(event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                <option value="billing_conference_full">Conferência completa para financeiro</option>
                <option value="sessions_period">Sessões do período</option>
                <option value="pending_items">Pendências do período</option>
                <option value="patient_time">Tempo por paciente</option>
                <option value="professional_time">Tempo por profissional</option>
                <option value="payer_time">Tempo por pagador</option>
              </select>
            </label>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {[
                ["competenceMonth", "Competência"],
                ["clinicName", "Clínica"],
                ["unitName", "Unidade"],
                ["scheduledDate", "Data"],
                ["startTime", "Início"],
                ["endTime", "Fim"],
                ["patientName", "Paciente"],
                ["professionalName", "Profissional"],
                ["professionalRegistry", "Registro"],
                ["serviceType", "Especialidade"],
                ["internalProcedureCode", "Código interno"],
                ["internalProcedureName", "Procedimento"],
                ["tussCode", "Código TUSS"],
                ["tussDescription", "Descrição TUSS"],
                ["tussVersion", "Versão TUSS"],
                ["guideType", "Tipo de guia"],
                ["billingUnit", "Unidade"],
                ["billingQuantity", "Quantidade"],
                ["billingUnitAmount", "Valor unitario"],
                ["billingExpectedAmount", "Valor previsto TUSS"],
                ["tussMappingStatus", "Status mapeamento"],
                ["tussPendingReasons", "Pendencias TUSS"],
                ["payerName", "Pagador"],
                ["financialPlanName", "Plano financeiro"],
                ["insuranceCardNumber", "Carteirinha"],
                ["guideNumber", "Guia"],
                ["authorizationCode", "Autorização"],
                ["copaymentAmount", "Coparticipação"],
                ["expectedAmount", "Valor previsto"],
                ["financialStatus", "Status financeiro"],
                ["scheduledMinutes", "Previsto"],
                ["actualMinutes", "Realizado"],
                ["readinessStatus", "Fechamento"],
                ["conferenceStatus", "Conferência"],
                ["exportStatus", "Exportação"],
                ["signaturePresent", "Assinatura"],
                ["reportPresent", "Relatório"],
                ["pendingDocuments", "Documentos"],
                ["pendingDetails", "Pendências detalhadas"],
                ["pendingKinds", "Pendências"],
                ["exportedAt", "Data exportação"],
                ["exportedBy", "Responsável"],
                ["exportId", "Export ID"],
                ["notes", "Observações"],
              ].map(([field, label]) => (
                <label key={field} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={exportFields.includes(field)}
                    onChange={(event) => setExportFields((current) => event.target.checked ? Array.from(new Set([...current, field])) : current.filter((item) => item !== field))}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setExportOpen(false)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600">Cancelar</button>
              <button type="button" onClick={runExport} disabled={exporting || exportFields.length === 0} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                Exportar CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {reopenTarget && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/40 p-4 sm:items-center" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-slate-900">Reabrir conferência exportada</div>
                <p className="mt-1 text-sm text-slate-500">Informe a justificativa para voltar este atendimento para conferência.</p>
              </div>
              <button type="button" onClick={() => setReopenTarget(null)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar reabertura"><X size={18} /></button>
            </div>
            <div className="mt-4 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600">
              {safeName(reopenTarget.patient_name, "Paciente")} · {formatDateTime(reopenTarget.scheduled_start)}
            </div>
            <textarea
              value={reopenReason}
              onChange={(event) => setReopenReason(event.target.value)}
              className="mt-4 min-h-[110px] w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
              placeholder="Exemplo: guia corrigida depois da exportação de conferência."
            />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setReopenTarget(null)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600">Cancelar</button>
              <button
                type="button"
                onClick={submitReopen}
                disabled={reopenReason.trim().length < 8 || actionLoadingId === reopenTarget.appointment_id}
                className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {actionLoadingId === reopenTarget.appointment_id ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                Reabrir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
