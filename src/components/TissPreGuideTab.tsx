import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileSearch,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Stethoscope,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { ActiveFilterBanner } from "./ActiveFilterBanner";
import { dataService } from "../services/dataService";
import { formatDateTimeInAppointmentTimezone } from "../utils/scheduling";

type TissPreGuideRow = {
  id?: string | null;
  appointmentId?: string | null;
  patientId?: string | null;
  professionalId?: string | null;
  payerId?: string | null;
  guideType?: string | null;
  guideNumber?: string | null;
  authorizationCode?: string | null;
  authorizationValidUntil?: string | null;
  beneficiaryCardNumber?: string | null;
  internalProcedureCode?: string | null;
  internalProcedureName?: string | null;
  tussCode?: string | null;
  tussDescription?: string | null;
  tussVersion?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unitAmountCents?: number | null;
  totalAmountCents?: number | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  patientName?: string | null;
  professionalName?: string | null;
  payerName?: string | null;
  clinicName?: string | null;
  status?: string | null;
  validationErrors?: Array<{ code?: string; field?: string; message?: string; section?: string }>;
  validationWarnings?: Array<{ code?: string; field?: string; message?: string; section?: string }>;
  validationErrorCodes?: string[];
  validationWarningCodes?: string[];
  snapshot?: Record<string, any>;
  staleReason?: string | null;
  updatedAt?: string | null;
  lastValidatedAt?: string | null;
};

type TissPreGuideTabProps = {
  from: string;
  to: string;
  patientId?: string;
  professionalId?: string;
  payerId?: string;
  onOpenAppointment?: (row: TissPreGuideRow) => void;
  onNavigatePayers?: () => void;
  onNavigateSettings?: () => void;
  onNavigateProfessionals?: () => void;
};

type QuickFilter =
  | "valid"
  | "pending"
  | "not_applicable"
  | "missing_provider"
  | "missing_payer_profile"
  | "missing_professional_registry"
  | "missing_cbo"
  | "missing_tuss"
  | "missing_guide_authorization"
  | "missing_amount";

type ProfileEditorKind = "provider" | "payer" | "professional";

const PAGE_SIZE = 50;

const statusMeta: Record<string, { label: string; className: string }> = {
  valid: { label: "Válida", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  pending_data: { label: "Pendente", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  not_applicable: { label: "Não aplicável", className: "bg-slate-100 text-slate-700 ring-slate-200" },
  draft: { label: "Rascunho", className: "bg-sky-50 text-sky-700 ring-sky-200" },
  cancelled: { label: "Cancelada", className: "bg-rose-50 text-rose-700 ring-rose-200" },
};

const issueLabels: Record<string, string> = {
  CLINIC_TISS_PROFILE_MISSING: "Dados do prestador",
  PROVIDER_DOCUMENT_MISSING: "Documento do prestador",
  PROVIDER_CODE_MISSING: "Código do prestador",
  CNES_MISSING: "CNES",
  PAYER_TISS_PROFILE_MISSING: "Dados do pagador",
  PAYER_ANS_REGISTRATION_MISSING: "Registro ANS",
  PROFESSIONAL_BILLING_PROFILE_MISSING: "Perfil do profissional",
  PROFESSIONAL_REGISTRY_MISSING: "Registro profissional",
  PROFESSIONAL_COUNCIL_STATE_MISSING: "UF do conselho",
  CBO_MISSING: "CBO",
  PROCEDURE_MISSING: "Procedimento",
  TUSS_CODE_MISSING: "TUSS",
  TUSS_DESCRIPTION_MISSING: "Descrição TUSS",
  AMOUNT_MISSING: "Valor",
  GUIDE_MISSING: "Guia",
  AUTHORIZATION_MISSING: "Autorização",
  AUTHORIZATION_EXPIRED: "Autorização vencida",
  BENEFICIARY_CARD_MISSING: "Carteirinha",
};

function toApiDate(value: string, endOfDay = false) {
  return value ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}` : "";
}

function formatCurrency(value?: number | null) {
  return (Number(value || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value?: string | null) {
  return value ? formatDateTimeInAppointmentTimezone(value) || "Horário não informado" : "Horário não informado";
}

function fieldValue(value: unknown, fallback = "Não informado") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function issueLabel(code: string) {
  return issueLabels[code] || code.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-slate-100 py-4 last:border-b-0">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Icon size={16} className="text-indigo-600" />
        {title}
      </div>
      <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">{children}</div>
    </section>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium uppercase text-slate-400">{label}</div>
      <div className="mt-1 break-words text-slate-700">{value}</div>
    </div>
  );
}

function EditorField({
  label,
  value,
  onChange,
  type = "text",
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  maxLength?: number;
}) {
  return (
    <label className="text-xs font-medium text-slate-600">
      {label}
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
      />
    </label>
  );
}

export function TissPreGuideTab({
  from,
  to,
  patientId = "",
  professionalId = "",
  payerId = "",
  onOpenAppointment,
  onNavigatePayers,
  onNavigateSettings,
  onNavigateProfessionals,
}: TissPreGuideTabProps) {
  const [rows, setRows] = useState<TissPreGuideRow[]>([]);
  const [kpis, setKpis] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [quickFilter, setQuickFilter] = useState<QuickFilter | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState<TissPreGuideRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [revalidatingId, setRevalidatingId] = useState("");
  const [profileEditor, setProfileEditor] = useState<ProfileEditorKind | null>(null);
  const [profileForm, setProfileForm] = useState<Record<string, any>>({});
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);

  const cards = useMemo(() => [
    { key: "valid" as const, label: "Pré-guias válidas", value: Number(kpis.valid || 0), tone: "text-emerald-700" },
    { key: "pending" as const, label: "Pendentes", value: Number(kpis.pending || 0), tone: "text-amber-700" },
    { key: "not_applicable" as const, label: "Não aplicáveis", value: Number(kpis.notApplicable || 0), tone: "text-slate-700" },
    { key: "missing_provider" as const, label: "Sem dados do prestador", value: Number(kpis.missingProvider || 0), tone: "text-rose-700" },
    { key: "missing_payer_profile" as const, label: "Sem dados do pagador", value: Number(kpis.missingPayerProfile || 0), tone: "text-rose-700" },
    { key: "missing_professional_registry" as const, label: "Sem registro profissional", value: Number(kpis.missingProfessionalRegistry || 0), tone: "text-orange-700" },
    { key: "missing_cbo" as const, label: "Sem CBO", value: Number(kpis.missingCbo || 0), tone: "text-orange-700" },
    { key: "missing_tuss" as const, label: "Sem TUSS", value: Number(kpis.missingTuss || 0), tone: "text-indigo-700" },
    { key: "missing_guide_authorization" as const, label: "Sem guia/autorização", value: Number(kpis.missingGuideAuthorization || 0), tone: "text-violet-700" },
    { key: "missing_amount" as const, label: "Sem valor", value: Number(kpis.missingAmount || 0), tone: "text-cyan-700" },
  ], [kpis]);

  const activeCard = cards.find((card) => card.key === quickFilter);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await dataService.getTissPreGuides({
        from: toApiDate(from),
        to: toApiDate(to, true),
        patientId,
        professionalId,
        payerId,
        quickFilter,
        page,
        pageSize: PAGE_SIZE,
      });
      if (!result?.success) {
        setRows([]);
        setKpis({});
        setTotal(0);
        setError(result?.error || "Não foi possível carregar as Pré-guias TISS agora.");
        return;
      }
      setRows(Array.isArray(result.data) ? result.data : []);
      setKpis(result.kpis || {});
      setTotal(Number(result.total || 0));
    } finally {
      setLoading(false);
    }
  }, [from, page, patientId, payerId, professionalId, quickFilter, to]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    setPage(1);
  }, [from, patientId, payerId, professionalId, to]);

  const openDetail = async (row: TissPreGuideRow) => {
    if (!row.appointmentId) return;
    setDetail(row);
    setDetailLoading(true);
    setError("");
    try {
      const result = await dataService.getTissPreGuide(row.appointmentId);
      if (result?.success && result.data) setDetail(result.data);
      else setError(result?.error || "Não foi possível abrir a Pré-guia TISS.");
    } finally {
      setDetailLoading(false);
    }
  };

  const revalidate = async (row: TissPreGuideRow) => {
    if (!row.appointmentId || revalidatingId) return;
    setRevalidatingId(row.appointmentId);
    setError("");
    setMessage("");
    try {
      const result = await dataService.revalidateTissPreGuide(row.appointmentId);
      if (!result?.success || !result.data) {
        setError(result?.error || "Não foi possível revalidar a Pré-guia TISS.");
        return;
      }
      setRows((current) => current.map((item) => item.appointmentId === row.appointmentId ? result.data : item));
      if (detail?.appointmentId === row.appointmentId) setDetail(result.data);
      setMessage(result.message || "Pré-guia TISS revalidada.");
      await loadRows();
    } finally {
      setRevalidatingId("");
    }
  };

  const openProfileEditor = async (kind: ProfileEditorKind) => {
    if (kind === "payer" && !detail?.payerId) {
      setError("Aplique um pagador real ao atendimento antes de configurar seus dados TISS.");
      return;
    }
    if (kind === "professional" && !detail?.professionalId) {
      setError("Vincule um profissional ao atendimento antes de configurar o perfil faturável.");
      return;
    }
    setProfileEditor(kind);
    setProfileLoading(true);
    setProfileForm({});
    setError("");
    try {
      const result = kind === "provider"
        ? await dataService.getClinicTissProfile()
        : kind === "payer"
          ? await dataService.getPayerTissProfile(String(detail?.payerId))
          : await dataService.getProfessionalBillingProfile(String(detail?.professionalId));
      if (!result?.success) {
        setError(result?.error || "Não foi possível carregar o cadastro.");
        setProfileEditor(null);
        return;
      }
      const data = result.data || {};
      setProfileForm(kind === "provider" ? {
        legalName: data.legal_name || "",
        tradeName: data.trade_name || "",
        documentType: data.document_type || "CNPJ",
        documentNumber: data.document_number || "",
        cnesCode: data.cnes_code || "",
        providerCode: data.provider_code || "",
        ansProviderCode: data.ans_provider_code || "",
      } : kind === "payer" ? {
        ansRegistration: data.ans_registration || "",
        operatorCode: data.operator_code || "",
        tissVersion: data.tiss_version || "",
        defaultGuideType: data.default_guide_type || "sp_sadt",
        requiresAuthorization: Boolean(data.requires_authorization),
        requiresProviderCode: Boolean(data.requires_provider_code),
        requiresCnes: Boolean(data.requires_cnes),
        requiresCbo: Boolean(data.requires_cbo),
        requiresExecutantRegistry: Boolean(data.requires_executant_registry),
        requiresBeneficiaryCard: data.requires_beneficiary_card !== false,
      } : {
        displayName: data.display_name || detail?.professionalName || "",
        documentType: data.document_type || "CPF",
        documentNumber: data.document_number || "",
        councilType: data.council_type || "",
        councilNumber: data.council_number || "",
        councilState: data.council_state || "",
        cboCode: data.cbo_code || "",
        specialtyName: data.specialty_name || "",
        providerCode: data.provider_code || "",
      });
    } finally {
      setProfileLoading(false);
    }
  };

  const updateProfileField = (key: string, value: any) => {
    setProfileForm((current) => ({ ...current, [key]: value }));
  };

  const saveProfile = async () => {
    if (!profileEditor || profileSaving) return;
    setProfileSaving(true);
    setError("");
    try {
      const result = profileEditor === "provider"
        ? await dataService.updateClinicTissProfile(profileForm)
        : profileEditor === "payer"
          ? await dataService.updatePayerTissProfile(String(detail?.payerId), profileForm)
          : await dataService.updateProfessionalBillingProfile(String(detail?.professionalId), profileForm);
      if (!result?.success) {
        setError(result?.error || "Não foi possível salvar o cadastro.");
        return;
      }
      setProfileEditor(null);
      if (detail) await revalidate(detail);
      setMessage("Cadastro salvo e Pré-guia revalidada.");
    } finally {
      setProfileSaving(false);
    }
  };

  const snapshot = detail?.snapshot || {};
  const errors = detail?.validationErrors || [];
  const warnings = detail?.validationWarnings || [];
  const detailStatus = statusMeta[String(detail?.status || "draft")] || statusMeta.draft;

  return (
    <div className="space-y-3">
      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => {
          const active = quickFilter === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => {
                setQuickFilter(active ? "" : card.key);
                setPage(1);
              }}
              aria-pressed={active}
              title={`Filtrar por ${card.label}`}
              className={`rounded-md border px-3 py-2 text-left transition ${
                active
                  ? "border-indigo-300 bg-indigo-50 shadow-sm ring-2 ring-indigo-100"
                  : "border-slate-200 bg-white shadow-sm hover:border-indigo-200 hover:bg-indigo-50/40"
              }`}
            >
              <div className="text-xs text-slate-500">{card.label}</div>
              <div className={`mt-1 text-lg font-semibold ${card.tone}`}>{card.value}</div>
            </button>
          );
        })}
      </section>

      {activeCard && (
        <ActiveFilterBanner
          label={activeCard.label}
          count={total}
          onClear={() => {
            setQuickFilter("");
            setPage(1);
          }}
        />
      )}
      {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {!error && message && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="max-h-[70vh] overflow-auto">
          <table className="min-w-[1500px] divide-y divide-slate-200 text-sm">
            <thead className="sticky top-0 z-20 bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500 shadow-[0_1px_0_0_rgba(148,163,184,0.35)]">
              <tr>
                <th className="px-4 py-3">Data/hora</th>
                <th className="px-4 py-3">Paciente</th>
                <th className="px-4 py-3">Pagador</th>
                <th className="px-4 py-3">Guia</th>
                <th className="px-4 py-3">Autorização</th>
                <th className="px-4 py-3">Profissional</th>
                <th className="px-4 py-3">Registro/CBO</th>
                <th className="px-4 py-3">Procedimento</th>
                <th className="px-4 py-3">TUSS</th>
                <th className="px-4 py-3">Quantidade</th>
                <th className="px-4 py-3">Valor</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Pendências TISS</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={14} className="px-4 py-12 text-center text-slate-500"><Loader2 size={20} className="mx-auto mb-2 animate-spin" />Carregando Pré-guias TISS</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={14} className="px-4 py-12 text-center text-slate-500">{quickFilter ? "Nenhuma Pré-guia encontrada para este filtro." : "Nenhuma Pré-guia materializada para o período."}</td></tr>
              ) : rows.map((row) => {
                const meta = statusMeta[String(row.status || "draft")] || statusMeta.draft;
                const codes = Array.isArray(row.validationErrorCodes) ? row.validationErrorCodes : [];
                const busy = revalidatingId === row.appointmentId;
                const professionalSnapshot = row.snapshot?.professional || {};
                return (
                  <tr key={row.id || row.appointmentId} className="align-top hover:bg-slate-50/70">
                    <td className="px-4 py-3 text-slate-700">{formatDate(row.scheduledStart)}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{fieldValue(row.patientName, "Paciente")}</td>
                    <td className="px-4 py-3 text-slate-600">{fieldValue(row.payerName, "Sem pagador")}</td>
                    <td className="px-4 py-3 text-slate-600">{fieldValue(row.guideNumber)}</td>
                    <td className="px-4 py-3 text-slate-600">{fieldValue(row.authorizationCode)}</td>
                    <td className="px-4 py-3 text-slate-600">{fieldValue(row.professionalName, "Equipe")}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{[professionalSnapshot.councilType, professionalSnapshot.councilNumber].filter(Boolean).join(" ") || "Registro não informado"}</div>
                      <div className="mt-1 text-xs text-slate-500">CBO: {fieldValue(professionalSnapshot.cboCode)}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{fieldValue(row.internalProcedureName)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <div className="font-medium text-slate-700">{fieldValue(row.tussCode)}</div>
                      {row.tussDescription && <div className="mt-1 max-w-[180px] truncate text-xs text-slate-500">{row.tussDescription}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.quantity || 0} {row.unit || ""}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{formatCurrency(row.totalAmountCents)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ring-1 ${meta.className}`}>{meta.label}</span>
                      {row.staleReason && <div className="mt-1 text-xs text-amber-700">Revalidação necessária</div>}
                    </td>
                    <td className="max-w-[280px] px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {codes.length === 0 ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">Sem pendência bloqueante</span>
                        ) : codes.slice(0, 4).map((code) => (
                          <span key={code} className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-700 ring-1 ring-amber-100">{issueLabel(code)}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => void openDetail(row)} title="Ver Pré-guia" className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-white"><FileSearch size={16} /></button>
                        <button type="button" onClick={() => void revalidate(row)} disabled={busy} title="Revalidar Pré-guia" className="rounded-md border border-slate-200 p-2 text-indigo-700 hover:bg-white disabled:opacity-60">
                          {busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                        </button>
                        <button type="button" onClick={() => onOpenAppointment?.(row)} title="Ir para atendimento" className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-white"><Stethoscope size={16} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 disabled:opacity-40"><ChevronLeft size={15} />Anterior</button>
          <span className="text-sm text-slate-500">Página {page} de {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
          <button type="button" disabled={page * PAGE_SIZE >= total || loading} onClick={() => setPage((current) => current + 1)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 disabled:opacity-40">Próxima<ChevronRight size={15} /></button>
        </div>
      </section>

      {detail && (
        <div className="fixed inset-0 z-[140] flex items-end justify-center bg-slate-950/45 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Pré-guia TISS">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-xl">
            <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">Pré-guia TISS</h2>
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ring-1 ${detailStatus.className}`}>{detailStatus.label}</span>
                </div>
                <div className="mt-1 text-sm text-slate-500">{fieldValue(detail.patientName, "Paciente")} · {formatDate(detail.scheduledStart)}</div>
              </div>
              <button type="button" onClick={() => setDetail(null)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar Pré-guia"><X size={18} /></button>
            </header>

            <div className="max-h-[calc(92vh-76px)] overflow-y-auto px-5 pb-24 sm:pb-6">
              {detailLoading ? (
                <div className="py-16 text-center text-sm text-slate-500"><Loader2 className="mx-auto mb-2 animate-spin" size={20} />Carregando dados da Pré-guia</div>
              ) : (
                <>
                  <Section title="Beneficiário / paciente" icon={UserRound}>
                    <DetailField label="Nome" value={fieldValue(snapshot.beneficiary?.name || detail.patientName)} />
                    <DetailField label="Carteirinha" value={fieldValue(snapshot.beneficiary?.cardNumber || detail.beneficiaryCardNumber)} />
                    <DetailField label="Documento" value={fieldValue(snapshot.beneficiary?.documentNumber)} />
                  </Section>

                  <Section title="Prestador / clínica" icon={Building2}>
                    <DetailField label="Razão social" value={fieldValue(snapshot.provider?.legalName)} />
                    <DetailField label="Nome fantasia" value={fieldValue(snapshot.provider?.tradeName || detail.clinicName)} />
                    <DetailField label="CPF/CNPJ" value={fieldValue(snapshot.provider?.documentNumber)} />
                    <DetailField label="CNES" value={fieldValue(snapshot.provider?.cnesCode)} />
                    <DetailField label="Código do prestador" value={fieldValue(snapshot.provider?.providerCode)} />
                  </Section>

                  <Section title="Operadora / pagador" icon={ShieldAlert}>
                    <DetailField label="Pagador" value={fieldValue(snapshot.payer?.name || detail.payerName, "Sem pagador")} />
                    <DetailField label="Registro ANS" value={fieldValue(snapshot.payer?.ansRegistration)} />
                    <DetailField label="Código da operadora" value={fieldValue(snapshot.payer?.operatorCode)} />
                    <DetailField label="Versão TISS configurada" value={fieldValue(snapshot.payer?.tissVersion)} />
                    <DetailField label="Tipo de guia" value={fieldValue(snapshot.payer?.guideType || detail.guideType)} />
                  </Section>

                  <Section title="Profissional executante" icon={Users}>
                    <DetailField label="Nome" value={fieldValue(snapshot.professional?.name || detail.professionalName)} />
                    <DetailField label="Conselho" value={fieldValue(snapshot.professional?.councilType)} />
                    <DetailField label="Número" value={fieldValue(snapshot.professional?.councilNumber)} />
                    <DetailField label="UF" value={fieldValue(snapshot.professional?.councilState)} />
                    <DetailField label="CBO" value={fieldValue(snapshot.professional?.cboCode)} />
                  </Section>

                  <Section title="Procedimento" icon={ClipboardCheck}>
                    <DetailField label="Procedimento interno" value={fieldValue(snapshot.procedure?.name || detail.internalProcedureName)} />
                    <DetailField label="Código interno" value={fieldValue(snapshot.procedure?.internalCode || detail.internalProcedureCode)} />
                    <DetailField label="TUSS" value={fieldValue(snapshot.procedure?.tussCode || detail.tussCode)} />
                    <DetailField label="Descrição TUSS" value={fieldValue(snapshot.procedure?.tussDescription || detail.tussDescription)} />
                    <DetailField label="Quantidade / unidade" value={`${detail.quantity || snapshot.procedure?.quantity || 0} ${detail.unit || snapshot.procedure?.unit || ""}`.trim()} />
                    <DetailField label="Valor previsto" value={formatCurrency(detail.totalAmountCents || snapshot.procedure?.totalAmountCents)} />
                  </Section>

                  <Section title="Guia / autorização" icon={FileSearch}>
                    <DetailField label="Guia" value={fieldValue(snapshot.authorization?.guideNumber || detail.guideNumber)} />
                    <DetailField label="Senha / autorização" value={fieldValue(snapshot.authorization?.authorizationCode || detail.authorizationCode)} />
                    <DetailField label="Validade" value={fieldValue(snapshot.authorization?.authorizationValidUntil || detail.authorizationValidUntil)} />
                  </Section>

                  <Section title="Resultado da validação" icon={errors.length > 0 ? AlertTriangle : CheckCircle2}>
                    <div className="sm:col-span-2">
                      {errors.length === 0 && warnings.length === 0 ? (
                        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">Dados mínimos validados para a futura geração de guia.</div>
                      ) : (
                        <div className="space-y-2">
                          {errors.map((item, index) => (
                            <div key={`${item.code}-${index}`} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">{item.message || issueLabel(String(item.code || ""))}</div>
                          ))}
                          {warnings.map((item, index) => (
                            <div key={`${item.code}-${index}`} className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sky-800">{item.message || issueLabel(String(item.code || ""))}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  </Section>

                  <div className="mt-4 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
                    Esta é uma pré-guia para validação interna. XML TISS ainda não foi gerado.
                  </div>

                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={() => void openProfileEditor("provider")} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Dados do prestador</button>
                    <button type="button" onClick={() => void openProfileEditor("payer")} disabled={!detail.payerId} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">Dados do pagador</button>
                    <button type="button" onClick={() => void openProfileEditor("professional")} disabled={!detail.professionalId} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">Dados do profissional</button>
                    <button type="button" onClick={() => onOpenAppointment?.(detail)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Ir para atendimento</button>
                    <button type="button" onClick={() => void revalidate(detail)} disabled={revalidatingId === detail.appointmentId} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                      {revalidatingId === detail.appointmentId ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                      Revalidar pré-guia
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {profileEditor && (
        <div className="fixed inset-0 z-[160] flex items-end justify-center bg-slate-950/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Configuração TISS">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
            <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {profileEditor === "provider" ? "Dados TISS do prestador" : profileEditor === "payer" ? "Dados TISS do pagador" : "Perfil faturável do profissional"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {profileEditor === "provider" ? detail?.clinicName || "Clínica" : profileEditor === "payer" ? detail?.payerName || "Pagador" : detail?.professionalName || "Profissional"}
                </p>
              </div>
              <button type="button" onClick={() => setProfileEditor(null)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar configuração"><X size={18} /></button>
            </header>

            <div className="max-h-[calc(90vh-140px)] overflow-y-auto px-5 py-4 pb-24 sm:pb-5">
              {profileLoading ? (
                <div className="py-12 text-center text-sm text-slate-500"><Loader2 className="mx-auto mb-2 animate-spin" size={20} />Carregando cadastro</div>
              ) : profileEditor === "provider" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <EditorField label="Razão social" value={profileForm.legalName || ""} onChange={(value) => updateProfileField("legalName", value)} maxLength={180} />
                  <EditorField label="Nome fantasia" value={profileForm.tradeName || ""} onChange={(value) => updateProfileField("tradeName", value)} maxLength={180} />
                  <label className="text-xs font-medium text-slate-600">
                    Tipo de documento
                    <select value={profileForm.documentType || "CNPJ"} onChange={(event) => updateProfileField("documentType", event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                      <option value="CNPJ">CNPJ</option>
                      <option value="CPF">CPF</option>
                    </select>
                  </label>
                  <EditorField label="CPF/CNPJ" value={profileForm.documentNumber || ""} onChange={(value) => updateProfileField("documentNumber", value)} maxLength={40} />
                  <EditorField label="CNES" value={profileForm.cnesCode || ""} onChange={(value) => updateProfileField("cnesCode", value)} maxLength={40} />
                  <EditorField label="Código do prestador" value={profileForm.providerCode || ""} onChange={(value) => updateProfileField("providerCode", value)} maxLength={80} />
                  <EditorField label="Código do prestador na operadora" value={profileForm.ansProviderCode || ""} onChange={(value) => updateProfileField("ansProviderCode", value)} maxLength={80} />
                </div>
              ) : profileEditor === "payer" ? (
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <EditorField label="Registro ANS" value={profileForm.ansRegistration || ""} onChange={(value) => updateProfileField("ansRegistration", value)} maxLength={80} />
                    <EditorField label="Código da operadora" value={profileForm.operatorCode || ""} onChange={(value) => updateProfileField("operatorCode", value)} maxLength={80} />
                    <EditorField label="Versão TISS" value={profileForm.tissVersion || ""} onChange={(value) => updateProfileField("tissVersion", value)} maxLength={80} />
                    <label className="text-xs font-medium text-slate-600">
                      Tipo de guia padrão
                      <select value={profileForm.defaultGuideType || "sp_sadt"} onChange={(event) => updateProfileField("defaultGuideType", event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                        <option value="sp_sadt">SP/SADT</option>
                        <option value="consulta">Consulta</option>
                        <option value="other">Outro</option>
                      </select>
                    </label>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      ["requiresAuthorization", "Exige autorização"],
                      ["requiresProviderCode", "Exige código do prestador"],
                      ["requiresCnes", "Exige CNES"],
                      ["requiresCbo", "Exige CBO"],
                      ["requiresExecutantRegistry", "Exige registro do executante"],
                      ["requiresBeneficiaryCard", "Exige carteirinha"],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
                        <input type="checkbox" checked={Boolean(profileForm[key])} onChange={(event) => updateProfileField(key, event.target.checked)} />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <EditorField label="Nome de exibição" value={profileForm.displayName || ""} onChange={(value) => updateProfileField("displayName", value)} maxLength={180} />
                  <label className="text-xs font-medium text-slate-600">
                    Tipo de documento
                    <select value={profileForm.documentType || "CPF"} onChange={(event) => updateProfileField("documentType", event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                      <option value="CPF">CPF</option>
                      <option value="CNPJ">CNPJ</option>
                      <option value="OTHER">Outro</option>
                    </select>
                  </label>
                  <EditorField label="Documento" value={profileForm.documentNumber || ""} onChange={(value) => updateProfileField("documentNumber", value)} maxLength={40} />
                  <EditorField label="Conselho" value={profileForm.councilType || ""} onChange={(value) => updateProfileField("councilType", value)} maxLength={40} />
                  <EditorField label="Número do conselho" value={profileForm.councilNumber || ""} onChange={(value) => updateProfileField("councilNumber", value)} maxLength={80} />
                  <EditorField label="UF do conselho" value={profileForm.councilState || ""} onChange={(value) => updateProfileField("councilState", value.toUpperCase().slice(0, 2))} maxLength={2} />
                  <EditorField label="CBO" value={profileForm.cboCode || ""} onChange={(value) => updateProfileField("cboCode", value)} maxLength={40} />
                  <EditorField label="Especialidade" value={profileForm.specialtyName || ""} onChange={(value) => updateProfileField("specialtyName", value)} maxLength={120} />
                  <EditorField label="Código do prestador" value={profileForm.providerCode || ""} onChange={(value) => updateProfileField("providerCode", value)} maxLength={80} />
                </div>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={profileEditor === "provider" ? onNavigateSettings : profileEditor === "payer" ? onNavigatePayers : onNavigateProfessionals}
                className="text-sm font-medium text-indigo-700 hover:text-indigo-800"
              >
                Abrir cadastro completo
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={() => setProfileEditor(null)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">Cancelar</button>
                <button type="button" onClick={() => void saveProfile()} disabled={profileSaving || profileLoading} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {profileSaving && <Loader2 size={15} className="animate-spin" />}
                  Salvar e revalidar
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
