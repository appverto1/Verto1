import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Download,
  Eye,
  FileSearch,
  FileText,
  History,
  Layers3,
  Loader2,
  PackagePlus,
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
  appointment_id?: string | null;
  abaSessionId?: string | null;
  aba_session_id?: string | null;
  focusPanel?: string | null;
  actionIntent?: string | null;
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
  validationErrors?: Array<{ code?: string; field?: string; message?: string; section?: string; action?: string; severity?: string }>;
  validationWarnings?: Array<{ code?: string; field?: string; message?: string; section?: string; action?: string; severity?: string }>;
  validationErrorCodes?: string[];
  validationWarningCodes?: string[];
  snapshot?: Record<string, any>;
  revenueCycleState?: string | null;
  revenueCycleStateReason?: string | null;
  antiGlosaChecklist?: Record<string, any>;
  antiGlosaRiskCodes?: string[];
  staleReason?: string | null;
  updatedAt?: string | null;
  lastValidatedAt?: string | null;
};

type TissPreGuideCoverage = {
  totalAppointmentsInPeriod?: number;
  billableAppointments?: number;
  eligibleForPreGuide?: number;
  materializedPreGuides?: number;
  missingPreGuides?: number;
  stalePreGuides?: number;
  validPreGuides?: number;
  pendingPreGuides?: number;
  notApplicablePreGuides?: number;
  withResolvedTuss?: number;
  withoutBillingItem?: number;
  notBillableAppointments?: number;
  withoutFinancialContext?: number;
};

type TissXmlDraftRow = {
  id?: string | null;
  payerId?: string | null;
  payerName?: string | null;
  competenceMonth?: string | null;
  guideType?: string | null;
  tissVersion?: string | null;
  status?: string | null;
  guideCount?: number | null;
  totalAmountCents?: number | null;
  generatedAt?: string | null;
  generatedBy?: string | null;
  downloadUrl?: string | null;
  xmlContent?: string | null;
  xmlHash?: string | null;
  draftFormat?: string | null;
  technicalValidationStatus?: string | null;
  technicalValidation?: TissXmlDraftValidationSummary | null;
  validatedAt?: string | null;
  validationSummary?: Record<string, any>;
  metadata?: Record<string, any>;
};

type TissOfficialDocumentRow = {
  id?: string | null;
  payerId?: string | null;
  payerName?: string | null;
  competenceMonth?: string | null;
  guideType?: string | null;
  documentType?: string | null;
  communicationVersion?: string | null;
  contentStructureVersion?: string | null;
  tussVersion?: string | null;
  schemaRootFile?: string | null;
  schemaManifestChecksum?: string | null;
  batchNumber?: string | null;
  status?: string | null;
  xmlHash?: string | null;
  xmlContent?: string | null;
  generatedFromPreGuideIds?: string[];
  validationSummary?: Record<string, any>;
  metadata?: Record<string, any>;
  guideCount?: number | null;
  totalAmountCents?: number | null;
  generatedBy?: string | null;
  generatedByName?: string | null;
  generatedAt?: string | null;
  downloadUrl?: string | null;
  xsdValidated?: boolean;
};

type TissXmlDraftValidationIssue = {
  code?: string;
  message?: string;
  severity?: string;
  path?: string;
  preGuideId?: string | null;
  entity?: string;
};

type TissXmlDraftValidationSummary = {
  status?: string;
  validatedAt?: string;
  errors?: TissXmlDraftValidationIssue[];
  warnings?: TissXmlDraftValidationIssue[];
  xsdValidation?: {
    status?: string;
    message?: string;
  };
};

type TissRevenueCycleEventRow = {
  id?: string | null;
  patientId?: string | null;
  appointmentId?: string | null;
  preGuideId?: string | null;
  xmlDraftId?: string | null;
  officialDocumentId?: string | null;
  payerId?: string | null;
  eventType?: string | null;
  previousState?: string | null;
  newState?: string | null;
  reason?: string | null;
  performedBy?: string | null;
  performedAt?: string | null;
  metadata?: Record<string, any>;
};

type TissBillingBatchDraftRow = {
  id?: string | null;
  payerId?: string | null;
  payerName?: string | null;
  competenceMonth?: string | null;
  status?: string | null;
  preGuideIds?: string[];
  xmlDraftIds?: string[];
  guideCount?: number | null;
  totalAmountCents?: number | null;
  createdBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  validatedAt?: string | null;
  validationSummary?: Record<string, any>;
  metadata?: Record<string, any>;
  linkedXmlDraftId?: string | null;
  notSentToPayer?: boolean;
};

type TissPreGuideTabProps = {
  from: string;
  to: string;
  patientId?: string;
  professionalId?: string;
  payerId?: string;
  initialPanel?: "preGuides" | "batchDrafts" | "xmlDrafts";
  navigationIntentKey?: number;
  onOpenAppointment?: (row: TissPreGuideRow) => void;
  onOpenPatient?: (row: TissPreGuideRow) => void;
  onNavigatePayers?: (section?: "convenios" | "tuss" | "prices" | "rules") => void;
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
  | "missing_authorization"
  | "authorization_expired"
  | "missing_card"
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
  PAYER_CONFIGURATION_INCOMPLETE: "Convênio incompleto",
  PAYER_TISS_VERSION_MISSING: "Versão TISS",
  PAYER_ANS_REGISTRATION_MISSING: "Registro ANS",
  PAYER_CONTRACTED_PROVIDER_CODE_MISSING: "Código do contratado",
  PAYER_CID_REQUIRED: "CID",
  PROFESSIONAL_BILLING_PROFILE_MISSING: "Perfil do profissional",
  PROFESSIONAL_NOT_DEFINED: "Profissional executante",
  PROFESSIONAL_REGISTRY_MISSING: "Registro profissional",
  PROFESSIONAL_COUNCIL_STATE_MISSING: "UF do conselho",
  CBO_MISSING: "CBO",
  PAYER_TUSS_MAPPING_MISSING: "Mapeamento TUSS",
  PAYER_TUSS_MAPPING_EXPIRED: "Mapeamento vencido",
  PAYER_PROCEDURE_PRICE_MISSING: "Sem valor negociado",
  PAYER_PROCEDURE_PRICE_CONFLICT: "Valor conflitante",
  PROCEDURE_MISSING: "Procedimento",
  TUSS_CODE_MISSING: "TUSS",
  TUSS_DESCRIPTION_MISSING: "Descrição TUSS",
  AMOUNT_MISSING: "Valor",
  GUIDE_MISSING: "Guia",
  AUTHORIZATION_MISSING: "Sem autorização",
  AUTHORIZATION_REQUIRED: "Sem autorização",
  AUTHORIZATION_EXPIRED: "Autorização vencida",
  AUTHORIZATION_EXHAUSTED: "Autorização esgotada",
  AUTHORIZATION_INACTIVE: "Autorização inativa",
  AUTHORIZATION_NOT_STARTED: "Autorização não vigente",
  AUTHORIZATION_PROCEDURE_MISMATCH: "Procedimento divergente",
  AUTHORIZED_PROCEDURE_NOT_INFORMED: "Procedimento autorizado",
  BENEFICIARY_CARD_MISSING: "Carteirinha",
  BENEFICIARY_CARD_VALIDITY_MISSING: "Validade da carteirinha",
  BENEFICIARY_CARD_EXPIRED: "Carteirinha vencida",
  RESPONSIBLE_SIGNATURE_REQUIRED: "Assinatura do responsável",
};

const issueCodeAliases: Record<string, string> = {
  PATIENT_CARD_MISSING: "BENEFICIARY_CARD_MISSING",
  PATIENT_CARD_VALIDITY_MISSING: "BENEFICIARY_CARD_VALIDITY_MISSING",
  PATIENT_CARD_EXPIRED: "BENEFICIARY_CARD_EXPIRED",
  INSURANCE_CARD_MISSING: "BENEFICIARY_CARD_MISSING",
  INSURANCE_CARD_VALIDITY_MISSING: "BENEFICIARY_CARD_VALIDITY_MISSING",
  SIGNATURE_REQUIRED: "RESPONSIBLE_SIGNATURE_REQUIRED",
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

function executantValue(value: unknown) {
  const normalized = String(value ?? "").trim();
  const comparable = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!normalized || ["equipe", "team"].includes(comparable)) return "Profissional não definido";
  return normalized;
}

function normalizeIssueCode(code?: string | null) {
  const normalized = String(code || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return issueCodeAliases[normalized] || normalized;
}

function issueLabel(code: string) {
  const normalized = normalizeIssueCode(code);
  if (issueLabels[normalized]) return issueLabels[normalized];
  if (normalized.includes("AUTHORIZATION")) return "Autorização";
  if (normalized.includes("SIGNATURE")) return "Assinatura";
  if (normalized.includes("PAYER")) return "Dados do pagador";
  if (normalized.includes("PROFESSIONAL")) return "Profissional";
  if (normalized.includes("CARD") || normalized.includes("BENEFICIARY")) return "Dados do paciente";
  return "Pendência de validação";
}

function isResponsibleSignatureIssue(item?: { code?: string | null; section?: string | null }) {
  return normalizeIssueCode(item?.code) === "RESPONSIBLE_SIGNATURE_REQUIRED" || String(item?.section || "").toLowerCase() === "signature";
}

function isAuthorizationIssue(item?: { code?: string | null; section?: string | null }) {
  const code = normalizeIssueCode(item?.code);
  const action = String((item as any)?.action || (item as any)?.suggestedAction || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (String(item?.section || "").toLowerCase() === "authorization") return true;
  if (action.includes("autorizacao")) return true;
  return [
    "GUIDE_MISSING",
    "AUTHORIZATION_MISSING",
    "AUTHORIZATION_REQUIRED",
    "AUTHORIZATION_EXPIRED",
    "AUTHORIZATION_EXHAUSTED",
    "AUTHORIZATION_INACTIVE",
    "AUTHORIZATION_NOT_STARTED",
    "AUTHORIZATION_PROCEDURE_MISMATCH",
    "AUTHORIZED_PROCEDURE_NOT_INFORMED",
  ].includes(code);
}

function authorizationActionLabel(code?: string | null) {
  const normalized = normalizeIssueCode(code);
  if (normalized === "AUTHORIZATION_PROCEDURE_MISMATCH") return "Revisar autorização";
  if (["AUTHORIZATION_EXPIRED", "AUTHORIZATION_EXHAUSTED", "AUTHORIZATION_INACTIVE", "AUTHORIZATION_NOT_STARTED", "AUTHORIZED_PROCEDURE_NOT_INFORMED"].includes(normalized)) {
    return "Atualizar autorização";
  }
  return "Adicionar autorização";
}

function isPatientIssue(item?: { code?: string | null; section?: string | null }) {
  const code = normalizeIssueCode(item?.code);
  return String(item?.section || "").toLowerCase() === "beneficiary" ||
    ["BENEFICIARY_CARD_MISSING", "BENEFICIARY_CARD_VALIDITY_MISSING", "BENEFICIARY_CARD_EXPIRED"].includes(code);
}

function isPayerProfileIssue(item?: { code?: string | null; section?: string | null }) {
  const code = normalizeIssueCode(item?.code);
  return ["PAYER_TISS_PROFILE_MISSING", "PAYER_CONFIGURATION_INCOMPLETE", "PAYER_TISS_VERSION_MISSING", "PAYER_ANS_REGISTRATION_MISSING", "PAYER_CONTRACTED_PROVIDER_CODE_MISSING", "PAYER_CID_REQUIRED"].includes(code);
}

function isProfessionalIssue(item?: { code?: string | null; section?: string | null }) {
  const code = normalizeIssueCode(item?.code);
  return ["PROFESSIONAL_BILLING_PROFILE_MISSING", "PROFESSIONAL_REGISTRY_MISSING", "PROFESSIONAL_COUNCIL_STATE_MISSING", "CBO_MISSING"].includes(code);
}

function hasAuthorizationSnapshot(row?: TissPreGuideRow | null) {
  const authorization = row?.snapshot?.authorization || {};
  return Boolean(
    authorization.authorizationId ||
    authorization.id ||
    authorization.authorizationCode ||
    authorization.guideNumber ||
    authorization.authorizationValidFrom ||
    authorization.authorizationValidUntil ||
    authorization.procedureTussCode ||
    authorization.procedureCode ||
    row?.authorizationCode ||
    row?.guideNumber ||
    row?.authorizationValidUntil
  );
}

function xmlDraftFormatLabel(value?: string | null) {
  const normalized = String(value || "").trim();
  if (normalized === "tiss_sp_sadt_draft") return "TISS/SP-SADT rascunho";
  return "Interno Verto";
}

function resolveXmlDraftValidation(draft?: TissXmlDraftRow | null): TissXmlDraftValidationSummary {
  const validation = draft?.technicalValidation || draft?.validationSummary?.technicalValidation || {};
  return {
    ...validation,
    status: draft?.technicalValidationStatus || validation.status || "not_validated",
  };
}

function xmlValidationMeta(status?: string | null) {
  const normalized = String(status || "not_validated").trim();
  if (normalized === "valid") return { label: "Válido", className: "bg-emerald-50 text-emerald-700 ring-emerald-100" };
  if (normalized === "warning") return { label: "Com avisos", className: "bg-amber-50 text-amber-700 ring-amber-100" };
  if (normalized === "invalid") return { label: "Inválido", className: "bg-rose-50 text-rose-700 ring-rose-100" };
  return { label: "Não validado", className: "bg-slate-100 text-slate-700 ring-slate-200" };
}

function revenueCycleMeta(state?: string | null) {
  const normalized = String(state || "draft").trim();
  if (normalized === "ready_for_billing") return { label: "Pronta para faturamento", className: "bg-emerald-50 text-emerald-700 ring-emerald-100" };
  if (normalized === "missing_data") return { label: "Com pendências", className: "bg-amber-50 text-amber-700 ring-amber-100" };
  if (normalized === "awaiting_authorization") return { label: "Aguardando autorização", className: "bg-amber-50 text-amber-700 ring-amber-100" };
  if (normalized === "authorized") return { label: "Autorizada", className: "bg-sky-50 text-sky-700 ring-sky-100" };
  if (normalized === "in_execution") return { label: "Em execução", className: "bg-violet-50 text-violet-700 ring-violet-100" };
  if (normalized === "xml_draft_generated") return { label: "XML rascunho gerado", className: "bg-indigo-50 text-indigo-700 ring-indigo-100" };
  if (normalized === "billing_batch_draft") return { label: "Em lote rascunho", className: "bg-cyan-50 text-cyan-700 ring-cyan-100" };
  if (normalized === "official_xml_validated") return { label: "XML oficial validado", className: "bg-emerald-50 text-emerald-700 ring-emerald-100" };
  return { label: "Em digitação", className: "bg-slate-100 text-slate-700 ring-slate-200" };
}

function batchDraftStatusMeta(status?: string | null) {
  const normalized = String(status || "draft").trim();
  if (normalized === "validated") return { label: "Validado internamente", className: "bg-emerald-50 text-emerald-700 ring-emerald-100" };
  if (normalized === "cancelled") return { label: "Cancelado", className: "bg-rose-50 text-rose-700 ring-rose-100" };
  if (normalized === "superseded") return { label: "Substituído", className: "bg-slate-100 text-slate-600 ring-slate-200" };
  return { label: "Rascunho", className: "bg-indigo-50 text-indigo-700 ring-indigo-100" };
}

function revenueCycleEventLabel(eventType?: string | null) {
  const normalized = String(eventType || "").trim();
  const labels: Record<string, string> = {
    PRE_GUIDE_MATERIALIZED: "Pré-guia materializada",
    PRE_GUIDE_VALIDATED: "Pré-guia validada",
    PRE_GUIDE_READY_FOR_BILLING: "Pré-guia pronta para faturamento",
    PRE_GUIDE_PENDING: "Pré-guia com pendências",
    AUTHORIZATION_ATTACHED: "Autorização vinculada",
    XML_DRAFT_GENERATED: "XML rascunho gerado",
    XML_DRAFT_VALIDATED: "XML rascunho validado",
    XML_DRAFT_SUPERSEDED: "XML rascunho substituído",
    TISS_BILLING_BATCH_DRAFT_CREATED: "Pré-guia incluída em lote rascunho",
    TISS_BILLING_BATCH_DRAFT_CANCELLED: "Lote rascunho cancelado",
    TISS_OFFICIAL_XML_GENERATED: "XML TISS oficial gerado",
    TISS_OFFICIAL_XML_XSD_VALIDATED: "XML TISS oficial validado no XSD",
    MANUAL_OVERRIDE_APPLIED: "Ajuste manual registrado",
  };
  return labels[normalized] || "Evento do ciclo TISS";
}

function antiGlosaCategoryLabel(category?: string | null) {
  const normalized = String(category || "").trim();
  const labels: Record<string, string> = {
    beneficiary: "Convênio e beneficiário",
    authorization: "Autorização e guia",
    professional: "Profissional executante",
    procedure: "Procedimento/TUSS",
    execution: "Execução/assinatura",
    amount: "Valores",
    physical_documents: "Documentos físicos",
  };
  return labels[normalized] || "Checklist operacional";
}

function antiGlosaStatusMeta(status?: string | null) {
  const normalized = String(status || "").trim();
  if (normalized === "ok") return { label: "OK", className: "bg-emerald-50 text-emerald-700 ring-emerald-100" };
  if (normalized === "attention") return { label: "Atenção", className: "bg-amber-50 text-amber-700 ring-amber-100" };
  if (normalized === "blocking") return { label: "Bloqueante", className: "bg-rose-50 text-rose-700 ring-rose-100" };
  return { label: "Não aplicável", className: "bg-slate-100 text-slate-600 ring-slate-200" };
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
  initialPanel,
  navigationIntentKey,
  onOpenAppointment,
  onOpenPatient,
  onNavigatePayers,
  onNavigateSettings,
  onNavigateProfessionals,
}: TissPreGuideTabProps) {
  const [rows, setRows] = useState<TissPreGuideRow[]>([]);
  const [kpis, setKpis] = useState<Record<string, number>>({});
  const [coverage, setCoverage] = useState<TissPreGuideCoverage | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [quickFilter, setQuickFilter] = useState<QuickFilter | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState<TissPreGuideRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [revalidatingId, setRevalidatingId] = useState("");
  const [periodRevalidating, setPeriodRevalidating] = useState(false);
  const [profileEditor, setProfileEditor] = useState<ProfileEditorKind | null>(null);
  const [profileForm, setProfileForm] = useState<Record<string, any>>({});
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [authorizationEditorOpen, setAuthorizationEditorOpen] = useState(false);
  const [authorizationForm, setAuthorizationForm] = useState<Record<string, any>>({});
  const [authorizationSaving, setAuthorizationSaving] = useState(false);
  const [xmlDrafts, setXmlDrafts] = useState<TissXmlDraftRow[]>([]);
  const [xmlDraftsLoading, setXmlDraftsLoading] = useState(false);
  const [xmlDraftGenerating, setXmlDraftGenerating] = useState(false);
  const [xmlDraftModalOpen, setXmlDraftModalOpen] = useState(false);
  const [xmlDraftPayerId, setXmlDraftPayerId] = useState("");
  const [batchDrafts, setBatchDrafts] = useState<TissBillingBatchDraftRow[]>([]);
  const [batchDraftsLoading, setBatchDraftsLoading] = useState(false);
  const [batchDraftCreating, setBatchDraftCreating] = useState(false);
  const [batchDraftModalOpen, setBatchDraftModalOpen] = useState(false);
  const [batchDraftPayerId, setBatchDraftPayerId] = useState("");
  const [batchDraftDetail, setBatchDraftDetail] = useState<TissBillingBatchDraftRow | null>(null);
  const [batchDraftCancellingId, setBatchDraftCancellingId] = useState("");
  const [activePanel, setActivePanel] = useState<"preGuides" | "batchDrafts" | "xmlDrafts">("preGuides");
  const [xmlDraftDetail, setXmlDraftDetail] = useState<TissXmlDraftRow | null>(null);
  const [xmlDraftDetailLoading, setXmlDraftDetailLoading] = useState(false);
  const [xmlDraftValidatingId, setXmlDraftValidatingId] = useState("");
  const [xmlValidationDetail, setXmlValidationDetail] = useState<TissXmlDraftRow | null>(null);
  const [createdXmlDraft, setCreatedXmlDraft] = useState<TissXmlDraftRow | null>(null);
  const [highlightedXmlDraftId, setHighlightedXmlDraftId] = useState("");
  const [officialDocuments, setOfficialDocuments] = useState<TissOfficialDocumentRow[]>([]);
  const [officialDocumentsLoading, setOfficialDocumentsLoading] = useState(false);
  const [officialDocumentGenerating, setOfficialDocumentGenerating] = useState(false);
  const [officialDocumentModalOpen, setOfficialDocumentModalOpen] = useState(false);
  const [officialDocumentPayerId, setOfficialDocumentPayerId] = useState("");
  const [officialDocumentDetail, setOfficialDocumentDetail] = useState<TissOfficialDocumentRow | null>(null);
  const [officialDocumentDetailLoading, setOfficialDocumentDetailLoading] = useState(false);
  const [highlightedOfficialDocumentId, setHighlightedOfficialDocumentId] = useState("");
  const [revenueCycleEvents, setRevenueCycleEvents] = useState<TissRevenueCycleEventRow[]>([]);
  const [revenueCycleEventsLoading, setRevenueCycleEventsLoading] = useState(false);

  useEffect(() => {
    if (initialPanel) setActivePanel(initialPanel);
  }, [initialPanel, navigationIntentKey]);

  const cards = useMemo(() => [
    { key: "valid" as const, label: "Pré-guias válidas", value: Number(kpis.valid || 0), tone: "text-emerald-700" },
    { key: "pending" as const, label: "Pendentes", value: Number(kpis.pending || 0), tone: "text-amber-700" },
    { key: "not_applicable" as const, label: "Não aplicáveis", value: Number(kpis.notApplicable || 0), tone: "text-slate-700" },
    { key: "missing_authorization" as const, label: "Sem autorização", value: Number(kpis.missingAuthorization || kpis.missingGuideAuthorization || 0), tone: "text-violet-700" },
    { key: "authorization_expired" as const, label: "Autorização vencida", value: Number(kpis.authorizationExpired || 0), tone: "text-rose-700" },
    { key: "missing_card" as const, label: "Sem carteirinha", value: Number(kpis.missingCard || 0), tone: "text-sky-700" },
    { key: "missing_payer_profile" as const, label: "Sem dados do pagador", value: Number(kpis.missingPayerProfile || 0), tone: "text-rose-700" },
    { key: "missing_professional_registry" as const, label: "Sem registro profissional", value: Number(kpis.missingProfessionalRegistry || 0), tone: "text-orange-700" },
    { key: "missing_amount" as const, label: "Sem valor", value: Number(kpis.missingAmount || 0), tone: "text-cyan-700" },
  ], [kpis]);

  const activeCard = cards.find((card) => card.key === quickFilter);
  const missingPreGuides = Number(coverage?.missingPreGuides || 0);
  const stalePreGuides = Number(coverage?.stalePreGuides || 0);
  const eligibleForPreGuide = Number(coverage?.eligibleForPreGuide || 0);
  const competenceMonth = `${from.slice(0, 7)}-01`;
  const validRows = useMemo(() => rows.filter((row) => String(row.status || "") === "valid"), [rows]);
  const visibleXmlPayers = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of validRows) {
      const id = String(row.payerId || "").trim();
      if (id) byId.set(id, String(row.payerName || "Pagador"));
    }
    return Array.from(byId.entries()).map(([id, name]) => ({ id, name }));
  }, [validRows]);
  const selectedXmlPayerId = xmlDraftPayerId || payerId || (visibleXmlPayers.length === 1 ? visibleXmlPayers[0].id : "");
  const selectedXmlPayerName = visibleXmlPayers.find((item) => item.id === selectedXmlPayerId)?.name || "Pagador";
  const selectedXmlRows = useMemo(
    () => validRows.filter((row) => !selectedXmlPayerId || row.payerId === selectedXmlPayerId),
    [selectedXmlPayerId, validRows]
  );
  const selectedXmlTotalAmount = selectedXmlRows.reduce((sum, row) => sum + Number(row.totalAmountCents || row.snapshot?.procedure?.totalAmountCents || 0), 0);
  const selectedXmlTissVersion = String(selectedXmlRows[0]?.snapshot?.payer?.tissVersion || selectedXmlRows[0]?.tissVersion || "configurada no pagador").trim();
  const selectedOfficialPayerId = officialDocumentPayerId || payerId || (visibleXmlPayers.length === 1 ? visibleXmlPayers[0].id : "");
  const selectedOfficialPayerName = visibleXmlPayers.find((item) => item.id === selectedOfficialPayerId)?.name || "Operadora";
  const selectedOfficialRows = useMemo(
    () => validRows.filter((row) => !selectedOfficialPayerId || row.payerId === selectedOfficialPayerId),
    [selectedOfficialPayerId, validRows]
  );
  const selectedOfficialTotalAmount = selectedOfficialRows.reduce(
    (sum, row) => sum + Number(row.totalAmountCents || row.snapshot?.procedure?.totalAmountCents || 0),
    0
  );
  const latestXmlDraft = xmlDrafts[0] || null;
  const xmlDraftGuideCount = xmlDrafts.reduce((sum, draft) => sum + Number(draft.guideCount || 0), 0);
  const xmlDraftTotalAmount = xmlDrafts.reduce((sum, draft) => sum + Number(draft.totalAmountCents || 0), 0);
  const createdXmlDraftInList = createdXmlDraft?.id
    ? xmlDrafts.find((draft) => draft.id === createdXmlDraft.id) || createdXmlDraft
    : null;
  const readyForBatchRows = useMemo(() => rows.filter((row) => {
    const state = String(row.revenueCycleState || row.snapshot?.revenueCycle?.state || (row.status === "valid" ? "ready_for_billing" : "")).trim();
    const blockingCount = Number(row.antiGlosaChecklist?.blockingCount || row.snapshot?.antiGlosaChecklist?.blockingCount || 0) || 0;
    const codes = Array.isArray(row.validationErrorCodes) ? row.validationErrorCodes : [];
    return row.status === "valid" && ["ready_for_billing", "xml_draft_generated"].includes(state) && blockingCount === 0 && codes.length === 0;
  }), [rows]);
  const visibleBatchPayers = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of readyForBatchRows) {
      const id = String(row.payerId || "").trim();
      if (id) byId.set(id, String(row.payerName || "Pagador"));
    }
    return Array.from(byId.entries()).map(([id, name]) => ({ id, name }));
  }, [readyForBatchRows]);
  const selectedBatchPayerId = batchDraftPayerId || payerId || (visibleBatchPayers.length === 1 ? visibleBatchPayers[0].id : "");
  const selectedBatchPayerName = visibleBatchPayers.find((item) => item.id === selectedBatchPayerId)?.name || "Pagador";
  const selectedBatchRows = useMemo(
    () => readyForBatchRows.filter((row) => !selectedBatchPayerId || row.payerId === selectedBatchPayerId),
    [readyForBatchRows, selectedBatchPayerId]
  );
  const selectedBatchTotalAmount = selectedBatchRows.reduce((sum, row) => sum + Number(row.totalAmountCents || row.snapshot?.procedure?.totalAmountCents || 0), 0);
  const latestBatchDraft = batchDrafts[0] || null;
  const batchDraftGuideCount = batchDrafts.reduce((sum, batch) => sum + Number(batch.guideCount || 0), 0);
  const batchDraftTotalAmount = batchDrafts.reduce((sum, batch) => sum + Number(batch.totalAmountCents || 0), 0);

  const loadRows = useCallback(async (overrides: { page?: number; quickFilter?: QuickFilter | "" } = {}) => {
    setLoading(true);
    setError("");
    try {
      const query = {
        from: toApiDate(from),
        to: toApiDate(to, true),
        patientId,
        professionalId,
        payerId,
        quickFilter: overrides.quickFilter ?? quickFilter,
        page: overrides.page ?? page,
        pageSize: PAGE_SIZE,
      };
      const [result, coverageResult] = await Promise.all([
        dataService.getTissPreGuides(query),
        dataService.getTissPreGuideCoverage({
          from: query.from,
          to: query.to,
          patientId,
          professionalId,
          payerId,
          limit: 2000,
        }),
      ]);
      if (coverageResult?.success) {
        setCoverage(coverageResult.coverage || coverageResult.data || null);
      }
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

  const loadXmlDrafts = useCallback(async () => {
    setXmlDraftsLoading(true);
    try {
      const result = await dataService.getTissXmlDrafts({
        payerId,
        competenceMonth,
        page: 1,
        pageSize: 20,
      });
      setXmlDrafts(result?.success && Array.isArray(result.data) ? result.data : []);
    } finally {
      setXmlDraftsLoading(false);
    }
  }, [competenceMonth, payerId]);

  const loadOfficialDocuments = useCallback(async () => {
    setOfficialDocumentsLoading(true);
    try {
      const result = await dataService.listTissOfficialDocuments({
        payerId,
        competenceMonth,
        page: 1,
        pageSize: 20,
      });
      setOfficialDocuments(result?.success && Array.isArray(result.data) ? result.data : []);
    } finally {
      setOfficialDocumentsLoading(false);
    }
  }, [competenceMonth, payerId]);

  const loadBatchDrafts = useCallback(async () => {
    setBatchDraftsLoading(true);
    try {
      const result = await dataService.getTissBillingBatchDrafts({
        payerId,
        competenceMonth,
        page: 1,
        pageSize: 20,
      });
      setBatchDrafts(result?.success && Array.isArray(result.data) ? result.data : []);
    } finally {
      setBatchDraftsLoading(false);
    }
  }, [competenceMonth, payerId]);

  useEffect(() => {
    void loadRows();
    void loadXmlDrafts();
    void loadBatchDrafts();
    void loadOfficialDocuments();
  }, [loadRows, loadXmlDrafts, loadBatchDrafts, loadOfficialDocuments]);

  useEffect(() => {
    setPage(1);
  }, [from, patientId, payerId, professionalId, to]);

  const openDetail = async (row: TissPreGuideRow) => {
    if (!row.appointmentId) return;
    setDetail(row);
    setRevenueCycleEvents([]);
    setDetailLoading(true);
    setRevenueCycleEventsLoading(true);
    setError("");
    try {
      const [result, eventsResult] = await Promise.all([
        dataService.getTissPreGuide(row.appointmentId),
        dataService.getTissRevenueCycleEvents({
          preGuideId: row.id,
          appointmentId: row.appointmentId,
          limit: 20,
        }),
      ]);
      if (result?.success && result.data) setDetail(result.data);
      else setError(result?.error || "Não foi possível abrir a Pré-guia TISS.");
      if (eventsResult?.success && Array.isArray(eventsResult.data)) setRevenueCycleEvents(eventsResult.data);
    } finally {
      setDetailLoading(false);
      setRevenueCycleEventsLoading(false);
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
      if (detail?.appointmentId === row.appointmentId) {
        setDetail(result.data);
        const eventsResult = await dataService.getTissRevenueCycleEvents({
          preGuideId: result.data.id || row.id,
          appointmentId: row.appointmentId,
          limit: 20,
        });
        if (eventsResult?.success && Array.isArray(eventsResult.data)) setRevenueCycleEvents(eventsResult.data);
      }
      setMessage(result.message || "Pré-guia revalidada com dados globais atualizados.");
      await loadRows();
    } finally {
      setRevalidatingId("");
    }
  };

  const revalidatePeriod = async () => {
    if (periodRevalidating) return;
    setPeriodRevalidating(true);
    setError("");
    setMessage("");
    try {
      const result = await dataService.revalidateTissPreGuidePeriod({
        from: toApiDate(from),
        to: toApiDate(to, true),
        patientId,
        professionalId,
        payerId,
        onlyBillable: true,
        limit: 500,
      });
      if (!result?.success) {
        setError(result?.error || "Não foi possível gerar ou revalidar as Pré-guias TISS do período.");
        return;
      }
      const counts = result.counts || {};
      const diagnostics = result.diagnostics || {};
      if (Number(counts.eligible || 0) === 0) {
        setMessage(
          `Nenhum atendimento elegível encontrado. ${Number(diagnostics.totalAppointments || 0)} atendimento(s) no período, ` +
          `${Number(diagnostics.billableWithInsurance || 0)} com contexto de convênio e ` +
          `${Number(diagnostics.withRealPayer || 0)} com pagador real.`
        );
      } else {
        setMessage(
          `${Number(counts.created || 0)} Pré-guia(s) criada(s), ${Number(counts.updated || 0)} atualizada(s) ` +
          `(${Number(counts.staleUpdated || 0)} desatualizada(s)), ` +
          `${Number(counts.valid || 0)} válida(s) e ${Number(counts.pendingData || 0)} com pendências.`
        );
      }
      setQuickFilter("");
      setPage(1);
      await loadRows({ page: 1, quickFilter: "" });
    } finally {
      setPeriodRevalidating(false);
    }
  };

  const openXmlDraftModal = () => {
    if (validRows.length === 0) {
      setError("Não há Pré-guias prontas para gerar XML TISS em rascunho.");
      return;
    }
    const defaultPayerId = payerId || (visibleXmlPayers.length === 1 ? visibleXmlPayers[0].id : "");
    setXmlDraftPayerId(defaultPayerId);
    setXmlDraftModalOpen(true);
  };

  const createXmlDraft = async () => {
    const payerForDraft = selectedXmlPayerId;
    if (!payerForDraft) {
      setError("Selecione um pagador para gerar o XML TISS em rascunho.");
      return;
    }
    setXmlDraftGenerating(true);
    setError("");
    setMessage("");
    try {
      const result = await dataService.createTissXmlDraft({
        payerId: payerForDraft,
        competenceMonth,
        dateFrom: toApiDate(from),
        dateTo: toApiDate(to, true),
      });
      if (!result?.success) {
        setError(result?.error || "Não foi possível gerar o XML TISS em rascunho agora.");
        return;
      }
      setXmlDraftModalOpen(false);
      const draft = result.data || null;
      setCreatedXmlDraft(draft);
      setHighlightedXmlDraftId(String(draft?.id || ""));
      setActivePanel("xmlDrafts");
      setMessage(result.message || "XML TISS em rascunho gerado para conferência interna.");
      await loadXmlDrafts();
      await loadBatchDrafts();
    } finally {
      setXmlDraftGenerating(false);
    }
  };

  const openOfficialDocumentModal = () => {
    if (validRows.length === 0) {
      setError("Não há Pré-guias válidas para gerar XML TISS oficial.");
      return;
    }
    const defaultPayerId = payerId || (visibleXmlPayers.length === 1 ? visibleXmlPayers[0].id : "");
    setOfficialDocumentPayerId(defaultPayerId);
    setOfficialDocumentModalOpen(true);
  };

  const createOfficialDocument = async () => {
    if (!selectedOfficialPayerId || selectedOfficialRows.length === 0) {
      setError("Selecione uma operadora com Pré-guias válidas.");
      return;
    }
    setOfficialDocumentGenerating(true);
    setError("");
    setMessage("");
    try {
      const result = await dataService.createTissOfficialDocument({
        payerId: selectedOfficialPayerId,
        competenceMonth,
        communicationVersion: "04.03.00",
        preGuideIds: selectedOfficialRows.map((row) => row.id).filter(Boolean),
      });
      if (!result?.success || !result.data) {
        const issues = Array.isArray(result?.issues) ? result.issues : [];
        const firstIssue = issues[0]?.message ? ` ${issues[0].message}` : "";
        setError(`${result?.error || "Não foi possível gerar o XML TISS oficial agora."}${firstIssue}`);
        return;
      }
      setOfficialDocumentModalOpen(false);
      setHighlightedOfficialDocumentId(String(result.data.id || ""));
      setActivePanel("xmlDrafts");
      setMessage(result.message || "XML TISS oficial validado contra o XSD e armazenado. Nenhum dado foi enviado à operadora.");
      await Promise.all([loadRows(), loadOfficialDocuments()]);
    } finally {
      setOfficialDocumentGenerating(false);
    }
  };

  const openOfficialDocumentDetail = async (document: TissOfficialDocumentRow) => {
    if (!document.id) return;
    setOfficialDocumentDetail(document);
    setOfficialDocumentDetailLoading(true);
    setError("");
    try {
      const result = await dataService.getTissOfficialDocument(document.id);
      if (!result?.success || !result.data) {
        setError(result?.error || "Não foi possível abrir o documento TISS oficial agora.");
        return;
      }
      setOfficialDocumentDetail(result.data);
    } finally {
      setOfficialDocumentDetailLoading(false);
    }
  };

  const downloadOfficialDocument = async (document: TissOfficialDocumentRow) => {
    if (!document.id) return;
    const result = await dataService.downloadTissOfficialDocument(document.id);
    if (!result?.success || !result.blob) {
      setError(result?.error || "Não foi possível baixar o XML TISS oficial agora.");
      return;
    }
    const url = URL.createObjectURL(result.blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = result.fileName || "verto-tiss-oficial.xml";
    window.document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const openBatchDraftModal = () => {
    if (readyForBatchRows.length === 0) {
      setError("Não há pré-guias prontas para criar lote rascunho nesta competência.");
      return;
    }
    const defaultPayerId = payerId || (visibleBatchPayers.length === 1 ? visibleBatchPayers[0].id : "");
    setBatchDraftPayerId(defaultPayerId);
    setBatchDraftModalOpen(true);
  };

  const createBatchDraft = async () => {
    const payerForBatch = selectedBatchPayerId;
    if (!payerForBatch) {
      setError("Selecione um pagador para criar o lote rascunho.");
      return;
    }
    setBatchDraftCreating(true);
    setError("");
    setMessage("");
    try {
      const result = await dataService.createTissBillingBatchDraft({
        payerId: payerForBatch,
        competenceMonth,
        preGuideIds: selectedBatchRows.map((row) => row.id).filter(Boolean),
      });
      if (!result?.success) {
        setError(result?.error || "Não foi possível criar o lote rascunho TISS agora.");
        return;
      }
      setBatchDraftModalOpen(false);
      setActivePanel("batchDrafts");
      setMessage(result.message || "Lote rascunho criado para conferência interna. Nenhum dado foi enviado à operadora.");
      await Promise.all([loadRows(), loadBatchDrafts()]);
    } finally {
      setBatchDraftCreating(false);
    }
  };

  const openBatchDraftDetail = async (batch: TissBillingBatchDraftRow) => {
    if (!batch.id) return;
    setBatchDraftDetail(batch);
    setError("");
    try {
      const result = await dataService.getTissBillingBatchDraft(batch.id);
      if (result?.success && result.data) setBatchDraftDetail(result.data);
      else setError(result?.error || "Não foi possível abrir o lote rascunho TISS agora.");
    } catch {
      setError("Não foi possível abrir o lote rascunho TISS agora.");
    }
  };

  const cancelBatchDraft = async (batch: TissBillingBatchDraftRow) => {
    if (!batch.id || batchDraftCancellingId) return;
    setBatchDraftCancellingId(batch.id);
    setError("");
    setMessage("");
    try {
      const result = await dataService.cancelTissBillingBatchDraft(batch.id);
      if (!result?.success) {
        setError(result?.error || "Não foi possível cancelar o lote rascunho TISS agora.");
        return;
      }
      setMessage(result.message || "Lote rascunho cancelado. Nenhum dado havia sido enviado à operadora.");
      await Promise.all([loadRows(), loadBatchDrafts()]);
      if (batchDraftDetail?.id === batch.id) setBatchDraftDetail(result.data || null);
    } finally {
      setBatchDraftCancellingId("");
    }
  };

  const openLinkedXmlDraft = async (batch: TissBillingBatchDraftRow) => {
    const xmlDraftId = batch.linkedXmlDraftId || batch.xmlDraftIds?.[0];
    if (!xmlDraftId) {
      setError("Este lote rascunho ainda não possui XML rascunho vinculado.");
      return;
    }
    setActivePanel("xmlDrafts");
    await openXmlDraftDetail({ id: xmlDraftId });
  };

  const openXmlDraftDetail = async (draft: TissXmlDraftRow) => {
    if (!draft.id) return;
    setXmlDraftDetail(draft);
    setXmlDraftDetailLoading(true);
    setError("");
    try {
      const result = await dataService.getTissXmlDraft(draft.id);
      if (!result?.success || !result.data) {
        setError(result?.error || "Não foi possível abrir o XML TISS em rascunho agora.");
        return;
      }
      setXmlDraftDetail(result.data);
    } finally {
      setXmlDraftDetailLoading(false);
    }
  };

  const openXmlValidationDetail = (draft: TissXmlDraftRow) => {
    setXmlValidationDetail(draft);
  };

  const validateXmlDraft = async (draft: TissXmlDraftRow) => {
    if (!draft.id || xmlDraftValidatingId) return;
    setXmlDraftValidatingId(draft.id);
    setError("");
    setMessage("");
    try {
      const result = await dataService.validateTissXmlDraft(draft.id);
      if (!result?.success || !result.data) {
        setError(result?.error || "Não foi possível validar o XML TISS em rascunho agora.");
        return;
      }
      const updatedDraft = result.data as TissXmlDraftRow;
      setXmlDrafts((current) => current.map((item) => item.id === updatedDraft.id ? { ...item, ...updatedDraft } : item));
      if (xmlDraftDetail?.id === updatedDraft.id) setXmlDraftDetail((current) => current ? { ...current, ...updatedDraft } : updatedDraft);
      setXmlValidationDetail(updatedDraft);
      setMessage(result.message || "Validação técnica do XML rascunho atualizada.");
    } finally {
      setXmlDraftValidatingId("");
    }
  };

  const downloadXmlDraft = async (draft: TissXmlDraftRow) => {
    if (!draft.id) return;
    const result = await dataService.downloadTissXmlDraft(draft.id);
    if (!result?.success || !result.blob) {
      setError(result?.error || "Não foi possível baixar o XML TISS em rascunho agora.");
      return;
    }
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = result.fileName || "verto-tiss-rascunho.xml";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const copyXmlDraftContent = async () => {
    const xml = String(xmlDraftDetail?.xmlContent || "");
    if (!xml) {
      setError("Não há conteúdo XML carregado para copiar.");
      return;
    }
    try {
      await navigator.clipboard.writeText(xml);
      setMessage("XML em rascunho copiado para a área de transferência.");
    } catch {
      setError("Não foi possível copiar o XML automaticamente. Selecione o conteúdo e copie manualmente.");
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
        beneficiaryIdentificationType: data.beneficiary_identification_type || "card_number",
        requiresAuthorization: Boolean(data.requires_authorization),
        requiresAuthorizedProcedure: Boolean(data.requires_authorized_procedure),
        requiresAuthorizationPassword: Boolean(data.requires_authorization_password),
        requiresGuideNumber: Boolean(data.requires_guide_number),
        requiresCid: Boolean(data.requires_cid),
        requiresProviderCode: Boolean(data.requires_provider_code),
        requiresCnes: Boolean(data.requires_cnes),
        requiresCbo: Boolean(data.requires_cbo),
        requiresExecutantRegistry: Boolean(data.requires_executant_registry),
        requiresBeneficiaryCard: data.requires_beneficiary_card !== false,
        requiresBeneficiaryCardValidity: Boolean(data.requires_beneficiary_card_validity),
        requiresResponsibleSignature: Boolean(data.requires_responsible_signature),
        contractedExecutant: data.contracted_executant || "",
        contractedProviderCode: data.contracted_provider_code || "",
        operatorProviderCode: data.operator_provider_code || "",
        defaultAttendanceType: data.default_attendance_type || "",
        defaultAttendanceRegime: data.default_attendance_regime || "",
        defaultAttendanceCharacter: data.default_attendance_character || "",
        specificRules: data.specific_rules || "",
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
      setMessage("Cadastro global salvo. Pré-guia atual revalidada e demais pré-guias afetadas marcadas para revalidação.");
    } finally {
      setProfileSaving(false);
    }
  };

  const openAuthorizationEditor = () => {
    if (!detail?.patientId || !detail?.payerId) {
      setError("Aplique paciente e pagador real antes de cadastrar autorização.");
      return;
    }
    const authorization = detail.snapshot?.authorization || {};
    const procedure = detail.snapshot?.procedure || {};
    const toDateInput = (value?: unknown) => String(value || "").slice(0, 10);
    setAuthorizationForm({
      authorizationNumber: authorization.authorizationCode || detail.authorizationCode || "",
      guideNumber: authorization.guideNumber || detail.guideNumber || "",
      issueDate: toDateInput(authorization.authorizationValidFrom),
      validFrom: toDateInput(authorization.authorizationValidFrom),
      validUntil: toDateInput(authorization.authorizationValidUntil || detail.authorizationValidUntil),
      procedureTussCode: authorization.procedureTussCode || procedure.tussCode || detail.tussCode || "",
      procedureCode: authorization.procedureCode || procedure.internalCode || detail.internalProcedureCode || "",
      procedureNameSnapshot: authorization.procedureName || procedure.name || detail.internalProcedureName || "",
      authorizedQuantity: String(authorization.authorizedQuantity || detail.quantity || procedure.quantity || 1),
      authorizedUnit: authorization.authorizedUnit || detail.unit || procedure.unit || "session",
      notes: "",
    });
    setAuthorizationEditorOpen(true);
  };

  const updateAuthorizationField = (key: string, value: any) => {
    setAuthorizationForm((current) => ({ ...current, [key]: value }));
  };

  const saveAuthorization = async () => {
    if (!detail?.patientId || !detail?.payerId || authorizationSaving) return;
    setAuthorizationSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await dataService.upsertPatientPayerAuthorization({
        appointmentId: detail.appointmentId,
        patientId: detail.patientId,
        payerId: detail.payerId,
        authorizationNumber: authorizationForm.authorizationNumber,
        guideNumber: authorizationForm.guideNumber,
        issueDate: authorizationForm.issueDate,
        validFrom: authorizationForm.validFrom,
        validUntil: authorizationForm.validUntil,
        procedureTussCode: authorizationForm.procedureTussCode,
        procedureCode: authorizationForm.procedureCode,
        procedureNameSnapshot: authorizationForm.procedureNameSnapshot,
        authorizedQuantity: authorizationForm.authorizedQuantity,
        authorizedUnit: authorizationForm.authorizedUnit,
        notes: authorizationForm.notes,
        status: "active",
      });
      if (!result?.success) {
        setError(result?.error || "Não foi possível salvar a autorização.");
        return;
      }
      setAuthorizationEditorOpen(false);
      await revalidate(detail);
      setMessage("Autorização salva. Pré-guia revalidada.");
    } finally {
      setAuthorizationSaving(false);
    }
  };

  const snapshot = detail?.snapshot || {};
  const errors = detail?.validationErrors || [];
  const warnings = detail?.validationWarnings || [];
  const antiGlosaChecklist = snapshot.antiGlosaChecklist || detail?.antiGlosaChecklist || {};
  const antiGlosaItems = Array.isArray(antiGlosaChecklist.items) ? antiGlosaChecklist.items : [];
  const antiGlosaReady = String(antiGlosaChecklist.status || "") === "ready";
  const antiGlosaGroups = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const item of antiGlosaItems) {
      const key = String(item.category || "operational").trim();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)?.push(item);
    }
    return Array.from(groups.entries()).map(([category, items]) => ({ category, items }));
  }, [antiGlosaItems]);
  const detailStatus = statusMeta[String(detail?.status || "draft")] || statusMeta.draft;
  const detailRevenueCycleMeta = revenueCycleMeta(detail?.revenueCycleState || detail?.snapshot?.revenueCycle?.state);
  const detailRevenueCycleReason = detail?.revenueCycleStateReason || detail?.snapshot?.revenueCycle?.reason || "Estado operacional calculado pela validação da Pré-guia.";
  const nextRevenueAction = (() => {
    const state = String(detail?.revenueCycleState || detail?.snapshot?.revenueCycle?.state || "").trim();
    if (state === "ready_for_billing") return "Gerar XML rascunho ou incluir em lote rascunho.";
    if (state === "xml_draft_generated") return "Revisar XML rascunho ou incluir em lote rascunho.";
    if (state === "billing_batch_draft") return "Conferir o lote rascunho antes de qualquer etapa futura.";
    if (state === "official_xml_validated") return "Conferir ou baixar o XML oficial validado. Nenhum envio foi realizado.";
    const firstIssue = errors[0] || warnings[0];
    const code = normalizeIssueCode(firstIssue?.code);
    if (code.includes("AUTHORIZATION") || code.includes("GUIDE")) return authorizationActionLabel(code);
    if (code === "RESPONSIBLE_SIGNATURE_REQUIRED") return "Coletar assinatura";
    if (code.includes("TUSS") || code.includes("PROCEDURE_PRICE") || code.includes("PROCEDURE")) return "Configurar convênio";
    if (code.includes("PAYER")) return "Configurar convênio";
    if (code.includes("PROFESSIONAL") || code === "CBO_MISSING") return "Corrigir profissional";
    if (code.includes("CARD") || code.includes("BENEFICIARY")) return "Corrigir carteirinha";
    return "Corrigir pendências e revalidar a Pré-guia.";
  })();
  const detailHasAuthorization = hasAuthorizationSnapshot(detail);
  const detailHasAuthorizationIssue = [...errors, ...warnings].some((item) => isAuthorizationIssue(item));
  const authorizationFooterActionLabel = detailHasAuthorization
    ? "Editar autorização"
    : detailHasAuthorizationIssue
      ? "Adicionar autorização"
      : "";
  const openAppointment = (row: TissPreGuideRow, options: Partial<TissPreGuideRow> = {}) => {
    const appointmentId = row.appointmentId || row.appointment_id || detail?.appointmentId || detail?.appointment_id || null;
    const abaSessionId =
      row.abaSessionId ||
      row.aba_session_id ||
      row.snapshot?.signature?.abaSessionId ||
      row.snapshot?.signature?.aba_session_id ||
      detail?.snapshot?.signature?.abaSessionId ||
      detail?.snapshot?.signature?.aba_session_id ||
      null;
    onOpenAppointment?.({
      ...row,
      ...options,
      appointmentId,
      appointment_id: appointmentId,
      abaSessionId,
      aba_session_id: abaSessionId,
    });
    if (detail) setDetail(null);
  };
  const openPatientCorrection = () => {
    const current = detail || {};
    if (onOpenPatient) {
      onOpenPatient({
        ...current,
        focusPanel: "insurance",
        actionIntent: "correct_patient",
      });
      setDetail(null);
      return;
    }
    openAppointment(current, { focusPanel: "patient", actionIntent: "correct_patient" });
  };
  const resolveIssueAction = (item: { code?: string; field?: string; message?: string; section?: string; action?: string; severity?: string }) => {
    const code = normalizeIssueCode(item.code);
    if (isResponsibleSignatureIssue(item)) {
      return {
        label: "Ir para atendimento e coletar assinatura",
        onClick: () => openAppointment(detail || {}, { focusPanel: "signature", actionIntent: "collect_signature" }),
      };
    }
    if (isAuthorizationIssue(item)) {
      return {
        label: authorizationActionLabel(code),
        onClick: () => openAuthorizationEditor(),
      };
    }
    if (code === "PAYER_TUSS_MAPPING_MISSING" || code === "PAYER_TUSS_MAPPING_EXPIRED" || code === "PAYER_PROCEDURE_PRICE_MISSING" || code === "PAYER_PROCEDURE_PRICE_CONFLICT") {
      return {
        label: code.includes("PRICE") ? "Tabela de Valores" : "Configurar convênio",
        onClick: () => {
          if (onNavigatePayers) {
            setDetail(null);
            onNavigatePayers(code.includes("PRICE") ? "prices" : "tuss");
            return;
          }
          void openProfileEditor("payer");
        },
      };
    }
    if (isPayerProfileIssue(item)) {
      return {
        label: "Configurar convênio",
        onClick: () => {
          if (onNavigatePayers) {
            setDetail(null);
            onNavigatePayers("rules");
            return;
          }
          void openProfileEditor("payer");
        },
      };
    }
    if (isPatientIssue(item)) {
      return {
        label: "Corrigir paciente",
        onClick: openPatientCorrection,
      };
    }
    if (code === "PROFESSIONAL_NOT_DEFINED") {
      return {
        label: "Ir para atendimento",
        onClick: () => openAppointment(detail || {}, { focusPanel: "professional", actionIntent: "define_professional" }),
      };
    }
    if (isProfessionalIssue(item)) {
      return {
        label: "Editar perfil faturável do profissional",
        onClick: () => void openProfileEditor("professional"),
      };
    }
    return null;
  };
  const renderValidationIssue = (item: { code?: string; field?: string; message?: string; section?: string; action?: string; severity?: string }, index: number, tone: "error" | "warning") => {
    const issueAction = resolveIssueAction(item);
    const className = tone === "error"
      ? "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800"
      : "rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sky-800";
    const buttonClassName = tone === "error"
      ? "mt-2 inline-flex rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100"
      : "mt-2 inline-flex rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs font-bold text-sky-900 hover:bg-sky-100";
    return (
      <div key={`${tone}-${item.code}-${index}`} className={className}>
        <div>{item.message || issueLabel(String(item.code || ""))}</div>
        {issueAction ? (
          <button
            type="button"
            onClick={issueAction.onClick}
            className={buttonClassName}
          >
            {issueAction.label}
          </button>
        ) : null}
      </div>
    );
  };
  const profileEditorMeta = profileEditor === "provider"
    ? {
        title: "Cadastro global: Dados TISS do prestador",
        subject: "Perfil faturável global da clínica",
        description: "Você está editando o perfil faturável global da clínica. Essa alteração será usada em novas pré-guias e pode revalidar pré-guias pendentes.",
        full: "Abrir Configurações > Faturamento e TISS",
      }
    : profileEditor === "payer"
      ? {
          title: "Cadastro global: Dados TISS do pagador",
          subject: detail?.payerName || "Pagador",
          description: "Você está editando o perfil TISS global deste pagador. Essa alteração será reutilizada em todos os atendimentos vinculados a este pagador.",
          full: "Abrir Convênios",
        }
      : profileEditor === "professional"
        ? {
            title: "Cadastro global: Perfil faturável do profissional",
            subject: executantValue(detail?.professionalName),
            description: "Você está editando o perfil faturável global deste profissional. Essa alteração será reutilizada em todos os atendimentos deste profissional.",
            full: "Abrir perfil completo do profissional",
          }
        : null;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Central de Fechamento TISS</div>
            <p className="mt-1 text-xs text-slate-500">
              Conferência interna de pré-guias, lotes rascunho e XMLs rascunho. Nenhum dado é enviado à operadora nesta etapa.
            </p>
          </div>
          <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-100">
            Validação interna
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
        {[
          { key: "preGuides" as const, label: "Pré-guias" },
          { key: "batchDrafts" as const, label: "Lotes rascunho" },
          { key: "xmlDrafts" as const, label: "Rascunhos XML" },
        ].map((item) => {
          const active = activePanel === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setActivePanel(item.key)}
              className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                active ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {!error && message && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <span>{message}</span>
          {createdXmlDraftInList && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void openXmlDraftDetail(createdXmlDraftInList)} className="rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
                Ver rascunho
              </button>
              <button type="button" onClick={() => void downloadXmlDraft(createdXmlDraftInList)} className="rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
                Baixar XML
              </button>
              <button type="button" onClick={() => setActivePanel("xmlDrafts")} className="rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
                Ir para Rascunhos XML
              </button>
            </div>
          )}
        </div>
      )}

      {activePanel === "preGuides" && (
        <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-indigo-100 bg-indigo-50/60 px-3 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-800">Materialização action-driven</div>
          <div className="mt-0.5 text-xs text-slate-600">
            Use esta ação para materializar dados antigos ou revalidar pré-guias pendentes/stale. O carregamento normal da aba apenas lê as pré-guias já criadas.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void revalidatePeriod()}
          disabled={periodRevalidating || loading}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {periodRevalidating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Gerar/Revalidar pré-guias do período
        </button>
      </div>

      {(missingPreGuides > 0 || stalePreGuides > 0) && !quickFilter && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
          <div>
            {missingPreGuides > 0 && (
              <div className="font-medium">
                Existem {missingPreGuides} atendimento(s) faturável(is) elegível(is) sem pré-guia materializada neste período.
              </div>
            )}
            {stalePreGuides > 0 && (
              <div className={missingPreGuides > 0 ? "mt-1" : "font-medium"}>
                {stalePreGuides} pré-guia(s) precisam de revalidação por alteração de cadastro/regra.
              </div>
            )}
            <div className="mt-1 text-xs text-amber-700">
              A verificação é somente leitura. A geração/revalidação em massa acontece apenas ao clicar no botão.
            </div>
          </div>
          <button
            type="button"
            onClick={() => void revalidatePeriod()}
            disabled={periodRevalidating || loading}
            className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
          >
            {periodRevalidating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Gerar/Revalidar pendentes do período
          </button>
        </div>
      )}

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

      <section className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <FileText size={16} className="text-indigo-600" />
              Gerar XML rascunho com pré-guias prontas
            </div>
            <p className="mt-1 text-xs text-slate-500">
              O rascunho gerado aparecerá na subaba Rascunhos XML. Ele não será enviado à operadora.
            </p>
          </div>
          <button
            type="button"
            onClick={openXmlDraftModal}
            disabled={Number(kpis.valid || 0) <= 0 || loading}
            className="inline-flex items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileText size={16} />
            Gerar XML rascunho
          </button>
        </div>
      </section>

      <section className="rounded-md border border-emerald-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <CheckCircle2 size={16} className="text-emerald-600" />
              XML TISS oficial validado
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Gera o lote SP/SADT 04.03.00, valida contra o XSD oficial da ANS e armazena o documento sem enviar à operadora.
            </p>
          </div>
          <button
            type="button"
            onClick={openOfficialDocumentModal}
            disabled={Number(kpis.valid || 0) <= 0 || loading}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckCircle2 size={16} />
            Gerar XML oficial validado
          </button>
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Layers3 size={16} className="text-cyan-600" />
              Criar lote rascunho
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Agrupa pré-guias prontas por pagador e competência para conferência interna. Nenhum lote será enviado à operadora.
            </p>
          </div>
          <button
            type="button"
            onClick={openBatchDraftModal}
            disabled={readyForBatchRows.length === 0 || loading}
            className="inline-flex items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PackagePlus size={16} />
            Criar lote rascunho
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="max-h-[70vh] overflow-auto">
          <table className="min-w-[1640px] divide-y divide-slate-200 text-sm">
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
                <th className="px-4 py-3">Estado do ciclo</th>
                <th className="px-4 py-3">Pendências TISS</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={15} className="px-4 py-12 text-center text-slate-500"><Loader2 size={20} className="mx-auto mb-2 animate-spin" />Carregando Pré-guias TISS</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-4 py-12 text-center">
                    {quickFilter ? (
                      <div className="text-sm text-slate-500">Nenhuma Pré-guia encontrada para este filtro.</div>
                    ) : eligibleForPreGuide === 0 ? (
                      <div className="mx-auto max-w-xl">
                        <FileSearch size={26} className="mx-auto text-slate-400" />
                        <div className="mt-3 text-sm font-semibold text-slate-800">Nenhum atendimento elegível para Pré-guia TISS no período.</div>
                        <p className="mt-1 text-sm text-slate-500">
                          A aba só materializa pré-guias para atendimentos faturáveis por convênio com pagador real. Contextos particular, sem cobrança e não faturável ficam fora deste fluxo.
                        </p>
                      </div>
                    ) : (
                      <div className="mx-auto max-w-xl">
                        <FileSearch size={26} className="mx-auto text-indigo-500" />
                        <p className="mt-2 text-sm text-slate-500">
                          Existem {eligibleForPreGuide} atendimento(s) elegível(is) para Pré-guia TISS neste período.
                        </p>
                        <div className="mt-3 text-sm font-semibold text-slate-800">Nenhuma pré-guia materializada para o período.</div>
                        <p className="mt-1 text-sm text-slate-500">
                          As pré-guias são criadas por revalidação para evitar backfill automático. Você pode gerar pré-guias para os atendimentos faturáveis deste período.
                        </p>
                        <button
                          type="button"
                          onClick={() => void revalidatePeriod()}
                          disabled={periodRevalidating}
                          className="mt-4 inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                        >
                          {periodRevalidating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                          Gerar/Revalidar pré-guias do período
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ) : rows.map((row) => {
                const meta = statusMeta[String(row.status || "draft")] || statusMeta.draft;
                const cycleMeta = revenueCycleMeta(row.revenueCycleState || row.snapshot?.revenueCycle?.state);
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
                    <td className="px-4 py-3 text-slate-600">{executantValue(row.professionalName)}</td>
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
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ring-1 ${cycleMeta.className}`}>{cycleMeta.label}</span>
                      {(row.revenueCycleStateReason || row.snapshot?.revenueCycle?.reason) && (
                        <div className="mt-1 max-w-[220px] text-xs text-slate-500">{row.revenueCycleStateReason || row.snapshot?.revenueCycle?.reason}</div>
                      )}
                    </td>
                    <td className="max-w-[280px] px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {codes.length === 0 ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                            {String(row.status || "") === "valid" ? "Pronta" : "Sem pendência"}
                          </span>
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
                        <button type="button" onClick={() => openAppointment(row)} title="Ir para atendimento" className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-white"><Stethoscope size={16} /></button>
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

        </>
      )}

      {activePanel === "batchDrafts" && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-cyan-100 bg-cyan-50/70 px-3 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-800">Lotes rascunho</div>
              <div className="mt-0.5 text-xs text-slate-600">
                Agrupamentos internos para conferência. Nenhum lote foi enviado à operadora.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loadBatchDrafts()}
                disabled={batchDraftsLoading}
                className="inline-flex items-center gap-2 rounded-md border border-cyan-200 bg-white px-3 py-2 text-sm text-cyan-800 hover:bg-cyan-100 disabled:opacity-60"
              >
                {batchDraftsLoading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                Atualizar lotes
              </button>
              <button
                type="button"
                onClick={openBatchDraftModal}
                disabled={readyForBatchRows.length === 0 || loading}
                className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PackagePlus size={16} />
                Criar lote rascunho
              </button>
            </div>
          </div>

          <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <div className="text-xs text-slate-500">Lotes rascunho</div>
              <div className="mt-1 text-lg font-semibold text-cyan-700">{batchDrafts.length}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <div className="text-xs text-slate-500">Último lote</div>
              <div className="mt-1 text-sm font-semibold text-slate-800">{latestBatchDraft ? formatDate(latestBatchDraft.createdAt) : "Nenhum"}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <div className="text-xs text-slate-500">Pré-guias agrupadas</div>
              <div className="mt-1 text-lg font-semibold text-slate-800">{batchDraftGuideCount}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <div className="text-xs text-slate-500">Valor total agrupado</div>
              <div className="mt-1 text-lg font-semibold text-slate-800">{formatCurrency(batchDraftTotalAmount)}</div>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="overflow-auto">
              <table className="min-w-[1280px] divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Competência</th>
                    <th className="px-4 py-3">Pagador</th>
                    <th className="px-4 py-3">Pré-guias</th>
                    <th className="px-4 py-3">Valor total</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Criado por</th>
                    <th className="px-4 py-3">Criado em</th>
                    <th className="px-4 py-3">Última validação</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {batchDraftsLoading ? (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />Carregando lotes rascunho</td></tr>
                  ) : batchDrafts.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                        Nenhum lote rascunho criado para esta competência. Use apenas pré-guias prontas para criar agrupamentos internos.
                      </td>
                    </tr>
                  ) : batchDrafts.map((batch) => {
                    const meta = batchDraftStatusMeta(batch.status);
                    const cancelling = batchDraftCancellingId === batch.id;
                    return (
                      <tr key={batch.id || `${batch.payerId}-${batch.createdAt}`} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-600">{String(batch.competenceMonth || "").slice(0, 7) || "Não informada"}</td>
                        <td className="px-4 py-3 text-slate-700">{fieldValue(batch.payerName, "Pagador")}</td>
                        <td className="px-4 py-3 text-slate-600">{Number(batch.guideCount || 0)}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{formatCurrency(batch.totalAmountCents)}</td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ring-1 ${meta.className}`}>{meta.label}</span></td>
                        <td className="px-4 py-3 text-slate-600">{batch.createdBy ? "Usuário autorizado" : "Não informado"}</td>
                        <td className="px-4 py-3 text-slate-600">{formatDate(batch.createdAt)}</td>
                        <td className="px-4 py-3 text-slate-600">{batch.validatedAt ? formatDate(batch.validatedAt) : "Não validado"}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button type="button" onClick={() => void openBatchDraftDetail(batch)} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                              <Eye size={15} />
                              Ver lote
                            </button>
                            <button type="button" onClick={() => setActivePanel("preGuides")} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                              <FileSearch size={15} />
                              Ver pré-guias
                            </button>
                            {batch.linkedXmlDraftId || batch.xmlDraftIds?.length ? (
                              <button type="button" onClick={() => void openLinkedXmlDraft(batch)} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                                <FileText size={15} />
                                Ver XMLs vinculados
                              </button>
                            ) : null}
                            {batch.status !== "cancelled" && (
                              <button type="button" onClick={() => void cancelBatchDraft(batch)} disabled={cancelling} className="inline-flex items-center gap-2 rounded-md border border-rose-200 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-60">
                                {cancelling ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}
                                Cancelar
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
          </section>
        </section>
      )}

      {activePanel === "xmlDrafts" && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-indigo-100 bg-indigo-50/60 px-3 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-800">Rascunhos XML TISS</div>
              <div className="mt-0.5 text-xs text-slate-600">
                XMLs gerados apenas para conferência interna. Nenhum rascunho foi enviado à operadora.
              </div>
            </div>
            <button
              type="button"
              onClick={openXmlDraftModal}
              disabled={Number(kpis.valid || 0) <= 0 || loading}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileText size={16} />
              Gerar novo rascunho
            </button>
          </div>

          <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <div className="text-xs text-slate-500">Rascunhos gerados</div>
              <div className="mt-1 text-lg font-semibold text-indigo-700">{xmlDrafts.length}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <div className="text-xs text-slate-500">Último rascunho</div>
              <div className="mt-1 text-sm font-semibold text-slate-800">{latestXmlDraft ? formatDate(latestXmlDraft.generatedAt) : "Nenhum"}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <div className="text-xs text-slate-500">Pré-guias incluídas</div>
              <div className="mt-1 text-lg font-semibold text-slate-800">{xmlDraftGuideCount}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <div className="text-xs text-slate-500">Valor total em rascunhos</div>
              <div className="mt-1 text-lg font-semibold text-slate-800">{formatCurrency(xmlDraftTotalAmount)}</div>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-emerald-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">Documentos oficiais TISS</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  XMLs SP/SADT validados contra o XSD oficial e armazenados. Nenhum documento foi enviado à operadora.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void loadOfficialDocuments()}
                  disabled={officialDocumentsLoading}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
                >
                  {officialDocumentsLoading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                  Atualizar
                </button>
                <button
                  type="button"
                  onClick={openOfficialDocumentModal}
                  disabled={Number(kpis.valid || 0) <= 0 || loading}
                  className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  <CheckCircle2 size={15} />
                  Gerar XML oficial validado
                </button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="min-w-[1320px] divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Geração</th>
                    <th className="px-4 py-3">Operadora</th>
                    <th className="px-4 py-3">Competência</th>
                    <th className="px-4 py-3">Lote</th>
                    <th className="px-4 py-3">Guias</th>
                    <th className="px-4 py-3">Valor total</th>
                    <th className="px-4 py-3">Versão</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Gerado por</th>
                    <th className="px-4 py-3">Hash</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {officialDocumentsLoading ? (
                    <tr><td colSpan={11} className="px-4 py-8 text-center text-slate-500"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />Carregando documentos oficiais</td></tr>
                  ) : officialDocuments.length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-8 text-center text-slate-500">Nenhum XML TISS oficial validado nesta competência.</td></tr>
                  ) : officialDocuments.map((document) => (
                    <tr key={document.id || document.xmlHash} className={highlightedOfficialDocumentId === document.id ? "bg-emerald-50/60" : "hover:bg-slate-50"}>
                      <td className="px-4 py-3 text-slate-600">{formatDate(document.generatedAt)}</td>
                      <td className="px-4 py-3 text-slate-700">{fieldValue(document.payerName, "Operadora")}</td>
                      <td className="px-4 py-3 text-slate-600">{String(document.competenceMonth || "").slice(0, 7) || "Não informada"}</td>
                      <td className="px-4 py-3 text-slate-700">{fieldValue(document.batchNumber)}</td>
                      <td className="px-4 py-3 text-slate-600">{Number(document.guideCount || 0)}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{formatCurrency(document.totalAmountCents)}</td>
                      <td className="px-4 py-3 text-slate-600">{fieldValue(document.communicationVersion)}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700 ring-1 ring-emerald-100">Validado no XSD</span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{fieldValue(document.generatedByName, "Usuário autorizado")}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{String(document.xmlHash || "").slice(0, 12) || "Não informado"}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => void openOfficialDocumentDetail(document)} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                            <Eye size={15} />
                            Visualizar
                          </button>
                          <button type="button" onClick={() => void downloadOfficialDocument(document)} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                            <Download size={15} />
                            Baixar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-slate-800">Rascunhos XML TISS</div>
            <div className="mt-0.5 text-xs text-slate-500">Prévia XML para conferência interna. Não enviado à operadora.</div>
          </div>
          <button type="button" onClick={() => void loadXmlDrafts()} disabled={xmlDraftsLoading} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 disabled:opacity-60">
            {xmlDraftsLoading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Atualizar rascunhos
          </button>
        </div>
        <div className="overflow-auto">
          <table className="min-w-[1420px] divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Geração</th>
                <th className="px-4 py-3">Pagador</th>
                <th className="px-4 py-3">Competência</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Formato</th>
                <th className="px-4 py-3">Versão TISS</th>
                <th className="px-4 py-3">Pré-guias</th>
                <th className="px-4 py-3">Valor</th>
                <th className="px-4 py-3">Validação</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Gerado por</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {xmlDraftsLoading ? (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-slate-500"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />Carregando rascunhos XML</td></tr>
              ) : xmlDrafts.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-slate-500">Nenhum XML TISS em rascunho gerado para esta competência.</td></tr>
              ) : xmlDrafts.map((draft) => {
                const status = String(draft.status || "draft");
                const statusLabel = status === "superseded" ? "Substituído" : status === "cancelled" ? "Cancelado" : "Rascunho";
                const validation = resolveXmlDraftValidation(draft);
                const validationMeta = xmlValidationMeta(validation.status);
                const validating = xmlDraftValidatingId === draft.id;
                return (
                  <tr key={draft.id || draft.xmlHash} className={`${highlightedXmlDraftId && draft.id === highlightedXmlDraftId ? "bg-indigo-50/60" : "hover:bg-slate-50"}`}>
                    <td className="px-4 py-3 text-slate-600">{formatDate(draft.generatedAt)}</td>
                    <td className="px-4 py-3 text-slate-700">{fieldValue(draft.payerName, "Pagador")}</td>
                    <td className="px-4 py-3 text-slate-600">{String(draft.competenceMonth || "").slice(0, 7) || "Não informada"}</td>
                    <td className="px-4 py-3 text-slate-600">{fieldValue(draft.guideType)}</td>
                    <td className="px-4 py-3 text-slate-600">{xmlDraftFormatLabel(draft.draftFormat || draft.metadata?.draft_format || draft.validationSummary?.draftFormat)}</td>
                    <td className="px-4 py-3 text-slate-600">{fieldValue(draft.tissVersion)}</td>
                    <td className="px-4 py-3 text-slate-600">{Number(draft.guideCount || 0)}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{formatCurrency(draft.totalAmountCents)}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ring-1 ${validationMeta.className}`}>{validationMeta.label}</span></td>
                    <td className="px-4 py-3"><span className="rounded-full bg-indigo-50 px-2 py-1 text-xs text-indigo-700 ring-1 ring-indigo-100">{statusLabel}</span></td>
                    <td className="px-4 py-3 text-slate-600">{draft.generatedBy ? "Usuário autorizado" : "Não informado"}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => void openXmlDraftDetail(draft)} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                          <Eye size={15} />
                          Ver XML
                        </button>
                        <button type="button" onClick={() => void downloadXmlDraft(draft)} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                          <Download size={15} />
                          Baixar XML
                        </button>
                        <button type="button" onClick={() => void validateXmlDraft(draft)} disabled={validating} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                          {validating ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                          Validar XML
                        </button>
                        <button type="button" onClick={() => openXmlValidationDetail(draft)} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                          <AlertTriangle size={15} />
                          Ver validação
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
        </section>
      )}

      {batchDraftModalOpen && (
        <div className="fixed inset-0 z-[150] flex items-end justify-center bg-slate-950/45 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Criar lote rascunho TISS">
          <div className="w-full max-w-xl overflow-hidden rounded-lg bg-white shadow-xl">
            <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Criar lote rascunho TISS</h2>
                <p className="mt-1 text-sm text-slate-500">Agrupamento interno para conferência. Não será enviado à operadora.</p>
              </div>
              <button type="button" onClick={() => setBatchDraftModalOpen(false)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar criação de lote"><X size={18} /></button>
            </header>
            <div className="space-y-4 px-5 py-4">
              {visibleBatchPayers.length > 1 && !payerId && (
                <label className="block text-sm font-medium text-slate-700">
                  Pagador
                  <select
                    value={batchDraftPayerId}
                    onChange={(event) => setBatchDraftPayerId(event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  >
                    <option value="">Selecione um pagador</option>
                    {visibleBatchPayers.map((payer) => <option key={payer.id} value={payer.id}>{payer.name}</option>)}
                  </select>
                </label>
              )}
              <div className="rounded-md border border-cyan-100 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
                Este lote rascunho serve apenas para conferência interna. Nenhum envio, protocolo, retorno ou glosa será registrado.
              </div>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <DetailField label="Competência" value={competenceMonth.slice(0, 7)} />
                <DetailField label="Pagador" value={selectedBatchPayerName} />
                <DetailField label="Pré-guias prontas" value={String(selectedBatchRows.length)} />
                <DetailField label="Valor total" value={formatCurrency(selectedBatchTotalAmount)} />
                <DetailField label="Estado após criação" value="Em lote rascunho" />
                <DetailField label="Envio à operadora" value="Não enviado" />
              </div>
              {selectedBatchRows.length === 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Não há pré-guias prontas para criar lote rascunho neste pagador/competência.
                </div>
              )}
            </div>
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => setBatchDraftModalOpen(false)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">Cancelar</button>
              <button
                type="button"
                onClick={() => void createBatchDraft()}
                disabled={batchDraftCreating || !selectedBatchPayerId || selectedBatchRows.length === 0}
                className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {batchDraftCreating ? <Loader2 size={15} className="animate-spin" /> : <PackagePlus size={15} />}
                Criar lote rascunho
              </button>
            </footer>
          </div>
        </div>
      )}

      {batchDraftDetail && (
        <div className="fixed inset-0 z-[150] flex items-end justify-center bg-slate-950/45 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Lote rascunho TISS">
          <div className="w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-xl">
            <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Lote rascunho TISS</h2>
                <p className="mt-1 text-sm text-slate-500">Agrupamento para conferência interna. Nenhum lote foi enviado à operadora.</p>
              </div>
              <button type="button" onClick={() => setBatchDraftDetail(null)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar lote rascunho"><X size={18} /></button>
            </header>
            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
              <div className="grid gap-4 text-sm sm:grid-cols-2">
                <DetailField label="Competência" value={String(batchDraftDetail.competenceMonth || "").slice(0, 7) || "Não informada"} />
                <DetailField label="Pagador" value={fieldValue(batchDraftDetail.payerName, "Pagador")} />
                <DetailField label="Pré-guias" value={String(Number(batchDraftDetail.guideCount || 0))} />
                <DetailField label="Valor total" value={formatCurrency(batchDraftDetail.totalAmountCents)} />
                <DetailField label="Status" value={<span className={`rounded-full px-2 py-1 text-xs font-medium ring-1 ${batchDraftStatusMeta(batchDraftDetail.status).className}`}>{batchDraftStatusMeta(batchDraftDetail.status).label}</span>} />
                <DetailField label="Criado em" value={formatDate(batchDraftDetail.createdAt)} />
                <DetailField label="Criado por" value={batchDraftDetail.createdBy ? "Usuário autorizado" : "Não informado"} />
                <DetailField label="Envio à operadora" value="Não enviado" />
              </div>
              <div className="mt-4 rounded-md border border-cyan-100 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
                Este lote é um rascunho operacional. Ele não representa remessa oficial, protocolo, retorno, pagamento ou glosa.
              </div>
              <section className="mt-4 rounded-md border border-slate-200">
                <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Vínculos do lote</div>
                <div className="space-y-3 px-3 py-3 text-sm">
                  <div>
                    <div className="text-xs font-medium uppercase text-slate-400">Pré-guias incluídas</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(batchDraftDetail.preGuideIds || []).length > 0 ? (batchDraftDetail.preGuideIds || []).map((id) => (
                        <span key={id} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{id.slice(0, 8)}</span>
                      )) : <span className="text-slate-500">Nenhuma pré-guia vinculada.</span>}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase text-slate-400">XMLs vinculados</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(batchDraftDetail.xmlDraftIds || []).length > 0 ? (batchDraftDetail.xmlDraftIds || []).map((id) => (
                        <span key={id} className="rounded-full bg-indigo-50 px-2 py-1 text-xs text-indigo-700">{id.slice(0, 8)}</span>
                      )) : <span className="text-slate-500">Nenhum XML rascunho vinculado.</span>}
                    </div>
                  </div>
                </div>
              </section>
            </div>
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
              {batchDraftDetail.linkedXmlDraftId || batchDraftDetail.xmlDraftIds?.length ? (
                <button type="button" onClick={() => void openLinkedXmlDraft(batchDraftDetail)} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  <FileText size={15} />
                  Ver XMLs vinculados
                </button>
              ) : null}
              {batchDraftDetail.status !== "cancelled" && (
                <button type="button" onClick={() => void cancelBatchDraft(batchDraftDetail)} disabled={batchDraftCancellingId === batchDraftDetail.id} className="inline-flex items-center gap-2 rounded-md border border-rose-200 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-60">
                  {batchDraftCancellingId === batchDraftDetail.id ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}
                  Cancelar lote rascunho
                </button>
              )}
              <button type="button" onClick={() => setBatchDraftDetail(null)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">Fechar</button>
            </footer>
          </div>
        </div>
      )}

      {xmlDraftModalOpen && (
        <div className="fixed inset-0 z-[150] flex items-end justify-center bg-slate-950/45 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Gerar XML TISS em rascunho">
          <div className="w-full max-w-xl overflow-hidden rounded-lg bg-white shadow-xl">
            <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Gerar XML TISS em rascunho</h2>
                <p className="mt-1 text-sm text-slate-500">Prévia XML para conferência interna. Não será enviada à operadora.</p>
              </div>
              <button type="button" onClick={() => setXmlDraftModalOpen(false)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar geração de XML"><X size={18} /></button>
            </header>
            <div className="space-y-4 px-5 py-4">
              {visibleXmlPayers.length > 1 && !payerId && (
                <label className="block text-sm font-medium text-slate-700">
                  Pagador
                  <select
                    value={xmlDraftPayerId}
                    onChange={(event) => setXmlDraftPayerId(event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  >
                    <option value="">Selecione um pagador</option>
                    {visibleXmlPayers.map((payer) => <option key={payer.id} value={payer.id}>{payer.name}</option>)}
                  </select>
                </label>
              )}
              <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
                Este XML é um rascunho para conferência interna. Ainda não houve envio à operadora.
              </div>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <DetailField label="Competência" value={competenceMonth.slice(0, 7)} />
                <DetailField label="Pagador" value={selectedXmlPayerName} />
                <DetailField label="Pré-guias prontas" value={String(selectedXmlRows.length)} />
                <DetailField label="Valor total" value={formatCurrency(selectedXmlTotalAmount)} />
                <DetailField label="Versão TISS" value={selectedXmlTissVersion} />
                <DetailField label="Status após geração" value="Rascunho interno" />
              </div>
              {selectedXmlRows.length === 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Não há pré-guias prontas para gerar XML em rascunho.
                </div>
              )}
            </div>
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => setXmlDraftModalOpen(false)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">Cancelar</button>
              <button
                type="button"
                onClick={() => void createXmlDraft()}
                disabled={xmlDraftGenerating || !selectedXmlPayerId || selectedXmlRows.length === 0}
                className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {xmlDraftGenerating ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                Gerar rascunho XML
              </button>
            </footer>
          </div>
        </div>
      )}

      {officialDocumentModalOpen && (
        <div className="fixed inset-0 z-[152] flex items-end justify-center bg-slate-950/45 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Gerar XML TISS oficial validado">
          <div className="w-full max-w-xl overflow-hidden rounded-lg bg-white shadow-xl">
            <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Gerar XML oficial validado</h2>
                <p className="mt-1 text-sm text-slate-500">Cobrança em lote com guias SP/SADT no Padrão TISS 04.03.00.</p>
              </div>
              <button type="button" onClick={() => setOfficialDocumentModalOpen(false)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar geração de XML oficial"><X size={18} /></button>
            </header>
            <div className="space-y-4 px-5 py-4">
              {visibleXmlPayers.length > 1 && !payerId && (
                <label className="block text-sm font-medium text-slate-700">
                  Operadora
                  <select
                    value={officialDocumentPayerId}
                    onChange={(event) => setOfficialDocumentPayerId(event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                  >
                    <option value="">Selecione uma operadora</option>
                    {visibleXmlPayers.map((payer) => <option key={payer.id} value={payer.id}>{payer.name}</option>)}
                  </select>
                </label>
              )}
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                O XML será validado e armazenado, mas não será enviado à operadora neste marco.
              </div>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <DetailField label="Operadora" value={selectedOfficialPayerName} />
                <DetailField label="Competência" value={competenceMonth.slice(0, 7)} />
                <DetailField label="Pré-guias" value={String(selectedOfficialRows.length)} />
                <DetailField label="Valor total" value={formatCurrency(selectedOfficialTotalAmount)} />
                <DetailField label="Comunicação TISS" value="04.03.00" />
                <DetailField label="Conteúdo e estrutura" value="202511" />
              </div>
              {selectedOfficialRows.length === 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Não há Pré-guias válidas deste pagador disponíveis nesta página.
                </div>
              )}
            </div>
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => setOfficialDocumentModalOpen(false)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">Cancelar</button>
              <button
                type="button"
                onClick={() => void createOfficialDocument()}
                disabled={officialDocumentGenerating || !selectedOfficialPayerId || selectedOfficialRows.length === 0}
                className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-60"
              >
                {officialDocumentGenerating ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                Gerar e validar no XSD
              </button>
            </footer>
          </div>
        </div>
      )}

      {officialDocumentDetail && (
        <div className="fixed inset-0 z-[156] flex items-end justify-center bg-slate-950/45 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Documento TISS oficial validado">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-xl">
            <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">XML TISS oficial validado</h2>
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700 ring-1 ring-emerald-100">Validado no XSD</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">Documento armazenado. Nenhum envio à operadora foi realizado.</p>
              </div>
              <button type="button" onClick={() => setOfficialDocumentDetail(null)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar documento oficial"><X size={18} /></button>
            </header>
            <div className="max-h-[calc(92vh-76px)] space-y-4 overflow-y-auto px-5 py-4 pb-24 sm:pb-5">
              {officialDocumentDetailLoading ? (
                <div className="py-16 text-center text-sm text-slate-500"><Loader2 className="mx-auto mb-2 animate-spin" size={20} />Carregando documento oficial</div>
              ) : (
                <>
                  <div className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-3">
                    <DetailField label="Operadora" value={fieldValue(officialDocumentDetail.payerName, "Operadora")} />
                    <DetailField label="Competência" value={String(officialDocumentDetail.competenceMonth || "").slice(0, 7)} />
                    <DetailField label="Lote" value={fieldValue(officialDocumentDetail.batchNumber)} />
                    <DetailField label="Comunicação" value={fieldValue(officialDocumentDetail.communicationVersion)} />
                    <DetailField label="Conteúdo/estrutura" value={fieldValue(officialDocumentDetail.contentStructureVersion)} />
                    <DetailField label="TUSS" value={fieldValue(officialDocumentDetail.tussVersion)} />
                    <DetailField label="XSD raiz" value={fieldValue(officialDocumentDetail.schemaRootFile)} />
                    <DetailField label="Guias" value={String(Number(officialDocumentDetail.guideCount || 0))} />
                    <DetailField label="Valor total" value={formatCurrency(officialDocumentDetail.totalAmountCents)} />
                    <DetailField label="Gerado por" value={fieldValue(officialDocumentDetail.generatedByName, "Usuário autorizado")} />
                    <DetailField label="Gerado em" value={formatDate(officialDocumentDetail.generatedAt)} />
                    <div className="sm:col-span-3">
                      <DetailField label="Checksum do manifesto" value={<span className="break-all font-mono text-xs">{fieldValue(officialDocumentDetail.schemaManifestChecksum)}</span>} />
                    </div>
                    <div className="sm:col-span-3">
                      <DetailField label="SHA-256 do XML" value={<span className="break-all font-mono text-xs">{fieldValue(officialDocumentDetail.xmlHash)}</span>} />
                    </div>
                    <div className="sm:col-span-3">
                      <DetailField label="Pré-guias vinculadas" value={(officialDocumentDetail.generatedFromPreGuideIds || []).map((id) => id.slice(0, 8)).join(", ") || "Não informadas"} />
                    </div>
                  </div>
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    Validação XML básica, XSD oficial, totais financeiros e hash concluídos antes da persistência.
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-950 text-slate-100">
                    <pre className="max-h-[38vh] overflow-auto whitespace-pre-wrap p-4 text-xs leading-relaxed">
                      {String(officialDocumentDetail.xmlContent || "XML não carregado.")}
                    </pre>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={() => void downloadOfficialDocument(officialDocumentDetail)} className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm text-white">
                      <Download size={15} />
                      Baixar XML
                    </button>
                    <button type="button" onClick={() => setOfficialDocumentDetail(null)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">Fechar</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {xmlDraftDetail && (
        <div className="fixed inset-0 z-[155] flex items-end justify-center bg-slate-950/45 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="XML TISS em rascunho">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-xl">
            <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">XML TISS em rascunho</h2>
                <p className="mt-1 text-sm text-slate-500">Rascunho interno. Não enviado à operadora.</p>
              </div>
              <button type="button" onClick={() => setXmlDraftDetail(null)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar XML em rascunho"><X size={18} /></button>
            </header>

            <div className="space-y-4 px-5 py-4">
              <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
                Este XML é uma prévia para conferência interna. Ainda não houve envio à operadora.
              </div>
              <div className="grid gap-3 text-sm sm:grid-cols-4">
                <DetailField label="Pagador" value={fieldValue(xmlDraftDetail.payerName, "Pagador")} />
                <DetailField label="Competência" value={String(xmlDraftDetail.competenceMonth || "").slice(0, 7) || "Não informada"} />
                <DetailField label="Pré-guias" value={String(Number(xmlDraftDetail.guideCount || 0))} />
                <DetailField label="Valor total" value={formatCurrency(xmlDraftDetail.totalAmountCents)} />
                <DetailField label="Formato" value={xmlDraftFormatLabel(xmlDraftDetail.draftFormat || xmlDraftDetail.metadata?.draft_format || xmlDraftDetail.validationSummary?.draftFormat)} />
                <DetailField label="Validação interna" value={xmlValidationMeta(resolveXmlDraftValidation(xmlDraftDetail).status).label} />
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-950 text-slate-100">
                {xmlDraftDetailLoading ? (
                  <div className="py-16 text-center text-sm text-slate-300"><Loader2 className="mx-auto mb-2 animate-spin" size={20} />Carregando XML</div>
                ) : (
                  <pre className="max-h-[48vh] overflow-auto whitespace-pre-wrap p-4 text-xs leading-relaxed">
                    {String(xmlDraftDetail.xmlContent || "XML não carregado. Tente atualizar o rascunho.")}
                  </pre>
                )}
              </div>
            </div>

            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => void copyXmlDraftContent()} disabled={xmlDraftDetailLoading || !xmlDraftDetail.xmlContent} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <Copy size={15} />
                Copiar XML
              </button>
              <button type="button" onClick={() => void downloadXmlDraft(xmlDraftDetail)} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
                <Download size={15} />
                Baixar XML
              </button>
              <button type="button" onClick={() => setXmlDraftDetail(null)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">Fechar</button>
            </footer>
          </div>
        </div>
      )}

      {xmlValidationDetail && (() => {
        const validation = resolveXmlDraftValidation(xmlValidationDetail);
        const meta = xmlValidationMeta(validation.status);
        const errorsList = Array.isArray(validation.errors) ? validation.errors : [];
        const warningsList = Array.isArray(validation.warnings) ? validation.warnings : [];
        const xsdMessage = validation.xsdValidation?.message || "A validação contra XSD oficial ainda não está configurada.";
        return (
          <div className="fixed inset-0 z-[156] flex items-end justify-center bg-slate-950/45 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Validação do XML rascunho">
            <div className="max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-xl">
              <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Validação do XML rascunho</h2>
                  <p className="mt-1 text-sm text-slate-500">Validação técnica interna. Ainda não houve envio à operadora.</p>
                </div>
                <button type="button" onClick={() => setXmlValidationDetail(null)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar validação do XML"><X size={18} /></button>
              </header>

              <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
                <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
                  {validation.status === "invalid"
                    ? "Corrija os erros abaixo antes de considerar este XML apto para próximas etapas."
                    : validation.status === "warning"
                      ? "O XML rascunho está bem formado, mas possui avisos para revisão."
                      : validation.status === "valid"
                        ? "O XML rascunho passou na validação técnica interna."
                        : "Este XML rascunho ainda não foi validado nesta etapa."}
                </div>

                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <DetailField label="Status geral" value={<span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ring-1 ${meta.className}`}>{meta.label}</span>} />
                  <DetailField label="Formato do draft" value={xmlDraftFormatLabel(xmlValidationDetail.draftFormat || xmlValidationDetail.metadata?.draft_format || xmlValidationDetail.validationSummary?.draftFormat)} />
                  <DetailField label="Versão TISS" value={fieldValue(xmlValidationDetail.tissVersion)} />
                  <DetailField label="Validado em" value={validation.validatedAt ? formatDate(validation.validatedAt) : "Não validado"} />
                  <DetailField label="Validação interna" value={meta.label} />
                  <DetailField label="Validação XSD oficial" value={xsdMessage} />
                </div>

                <section className="rounded-md border border-rose-100 bg-rose-50/60 px-3 py-3">
                  <div className="text-sm font-semibold text-rose-800">Erros bloqueantes</div>
                  {errorsList.length === 0 ? (
                    <div className="mt-2 text-sm text-rose-700">Nenhum erro bloqueante encontrado.</div>
                  ) : (
                    <ul className="mt-2 space-y-2 text-sm text-rose-800">
                      {errorsList.map((item, index) => (
                        <li key={`${item.code}-${index}`} className="rounded-md bg-white/70 px-3 py-2">
                          <div className="font-medium">{item.message || issueLabel(String(item.code || ""))}</div>
                          {item.code && <div className="mt-1 text-xs text-rose-600">{item.code}</div>}
                          {item.path && <div className="mt-1 text-xs text-rose-600">{item.path}</div>}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-md border border-amber-100 bg-amber-50/60 px-3 py-3">
                  <div className="text-sm font-semibold text-amber-800">Avisos</div>
                  {warningsList.length === 0 ? (
                    <div className="mt-2 text-sm text-amber-700">Nenhum aviso técnico encontrado.</div>
                  ) : (
                    <ul className="mt-2 space-y-2 text-sm text-amber-800">
                      {warningsList.map((item, index) => (
                        <li key={`${item.code}-${index}`} className="rounded-md bg-white/70 px-3 py-2">
                          <div className="font-medium">{item.message || item.code || "Aviso técnico"}</div>
                          {item.code && <div className="mt-1 text-xs text-amber-600">{item.code}</div>}
                          {item.path && <div className="mt-1 text-xs text-amber-600">{item.path}</div>}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
                <button type="button" onClick={() => void validateXmlDraft(xmlValidationDetail)} disabled={Boolean(xmlDraftValidatingId)} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                  {xmlDraftValidatingId ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                  Validar novamente
                </button>
                <button type="button" onClick={() => setXmlValidationDetail(null)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">Fechar</button>
              </footer>
            </div>
          </div>
        );
      })()}

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
                    <DetailField label="Validade da carteirinha" value={fieldValue(snapshot.beneficiary?.cardValidUntil)} />
                    <DetailField label="Plano/categoria" value={fieldValue(snapshot.beneficiary?.planCategory)} />
                    <DetailField label="Documento" value={fieldValue(snapshot.beneficiary?.documentNumber)} />
                  </Section>

                  <Section title="Prestador / clínica" icon={Building2}>
                    <DetailField label="Razão social" value={fieldValue(snapshot.provider?.legalName)} />
                    <DetailField label="Nome fantasia" value={fieldValue(snapshot.provider?.tradeName)} />
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
                    <DetailField label="Código contratado" value={fieldValue(snapshot.payer?.contractedProviderCode || snapshot.payer?.operatorProviderCode)} />
                    <DetailField label="Tipo de atendimento" value={fieldValue(snapshot.payer?.defaultAttendanceType)} />
                  </Section>

                  <Section title="Profissional executante" icon={Users}>
                    <DetailField label="Nome" value={executantValue(snapshot.professional?.name || detail.professionalName)} />
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
                    <DetailField label="Início da validade" value={fieldValue(snapshot.authorization?.authorizationValidFrom)} />
                    <DetailField label="Validade" value={fieldValue(snapshot.authorization?.authorizationValidUntil || detail.authorizationValidUntil)} />
                    <DetailField label="Procedimento autorizado" value={fieldValue(snapshot.authorization?.procedureName || snapshot.authorization?.procedureTussCode || snapshot.authorization?.procedureCode)} />
                    <DetailField label="Quantidade autorizada" value={fieldValue(snapshot.authorization?.authorizedQuantity)} />
                    <DetailField label="Unidade autorizada" value={fieldValue(snapshot.authorization?.authorizedUnit)} />
                  </Section>

                  {snapshot.signature?.present && (
                    <Section title="Assinatura" icon={ClipboardCheck}>
                      <DetailField label="Responsável" value={fieldValue(snapshot.signature?.signedByName, "Responsável")} />
                      <DetailField label="Papel" value={fieldValue(snapshot.signature?.signedByRole)} />
                      <DetailField label="Data/hora da assinatura" value={formatDate(snapshot.signature?.signedAt)} />
                      <DetailField label="Tipo de assinatura" value={fieldValue(snapshot.signature?.signatureType)} />
                    </Section>
                  )}

                  <Section title="Ciclo de receita" icon={History}>
                    <DetailField label="Estado atual" value={<span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ring-1 ${detailRevenueCycleMeta.className}`}>{detailRevenueCycleMeta.label}</span>} />
                    <DetailField label="Motivo do estado" value={fieldValue(detailRevenueCycleReason)} />
                    <DetailField label="Última validação" value={detail?.lastValidatedAt ? formatDate(detail.lastValidatedAt) : "Não validada"} />
                    <DetailField label="Próxima ação sugerida" value={nextRevenueAction} />
                    <div className="sm:col-span-2">
                      <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-slate-800">Histórico do ciclo</div>
                          {revenueCycleEventsLoading && <Loader2 size={15} className="animate-spin text-slate-400" />}
                        </div>
                        {revenueCycleEvents.length === 0 ? (
                          <div className="text-sm text-slate-500">Nenhum evento administrativo registrado para esta Pré-guia ainda.</div>
                        ) : (
                          <div className="space-y-2">
                            {revenueCycleEvents.slice(0, 8).map((event) => {
                              const previousMeta = revenueCycleMeta(event.previousState);
                              const nextMeta = revenueCycleMeta(event.newState);
                              return (
                                <div key={event.id || `${event.eventType}-${event.performedAt}`} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="font-medium text-slate-800">{revenueCycleEventLabel(event.eventType)}</div>
                                    <div className="text-xs text-slate-500">{formatDate(event.performedAt)}</div>
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                    <span className={`rounded-full px-2 py-0.5 ring-1 ${previousMeta.className}`}>{previousMeta.label}</span>
                                    <span className="text-slate-400">→</span>
                                    <span className={`rounded-full px-2 py-0.5 ring-1 ${nextMeta.className}`}>{nextMeta.label}</span>
                                    <span className="text-slate-500">por {event.performedBy ? "usuário autorizado" : "sistema"}</span>
                                  </div>
                                  {event.reason && <div className="mt-2 text-xs text-slate-600">{event.reason}</div>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </Section>

                  <Section title="Resultado da validação" icon={errors.length > 0 ? AlertTriangle : CheckCircle2}>
                    <div className="sm:col-span-2">
                      {errors.length === 0 && warnings.length === 0 ? (
                        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">Dados mínimos validados para a futura geração de guia.</div>
                      ) : (
                        <div className="space-y-2">
                          {errors.map((item, index) => renderValidationIssue(item, index, "error"))}
                          {warnings.map((item, index) => renderValidationIssue(item, index, "warning"))}
                        </div>
                      )}
                    </div>
                  </Section>

                  <Section title="Checklist antiglosa" icon={ShieldAlert}>
                    <div className="sm:col-span-2">
                      <div className={`rounded-md border px-3 py-2 text-sm ${
                        antiGlosaReady
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-amber-200 bg-amber-50 text-amber-800"
                      }`}>
                        {antiGlosaReady
                          ? "Checklist operacional pronto para faturamento futuro."
                          : "Revise os itens pendentes antes de avançar para faturamento futuro."}
                        <div className="mt-1 text-xs">
                          {Number(antiGlosaChecklist.okCount || 0)} OK · {Number(antiGlosaChecklist.blockingCount || 0)} bloqueante(s) · {Number(antiGlosaChecklist.attentionCount || 0)} atenção · {Number(antiGlosaChecklist.notApplicableCount || 0)} não aplicável(is)
                        </div>
                      </div>
                      {antiGlosaGroups.length > 0 ? (
                        <div className="mt-3 space-y-3">
                          {antiGlosaGroups.map((group) => (
                            <div key={group.category} className="rounded-md border border-slate-200 bg-white">
                              <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
                                {antiGlosaCategoryLabel(group.category)}
                              </div>
                              <div className="grid gap-2 p-3 sm:grid-cols-2">
                                {group.items.map((item: any) => {
                                  const meta = antiGlosaStatusMeta(item.status);
                                  const relatedCodes = Array.isArray(item.relatedIssueCodes) ? item.relatedIssueCodes : [];
                                  return (
                                    <div key={item.code} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="font-medium text-slate-800">{fieldValue(item.label, "Item antiglosa")}</div>
                                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${meta.className}`}>{meta.label}</span>
                                      </div>
                                      <div className="mt-1 text-xs text-slate-500">{fieldValue(item.riskClass, "Risco operacional")}</div>
                                      {item.suggestedAction && item.status !== "ok" && item.status !== "not_applicable" ? (
                                        <div className="mt-2 text-xs font-medium text-slate-700">Ação sugerida: {item.suggestedAction}</div>
                                      ) : null}
                                      {relatedCodes.length > 0 ? (
                                        <div className="mt-2 flex flex-wrap gap-1">
                                          {relatedCodes.map((code: string) => (
                                            <span key={`${item.code}-${code}`} className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">
                                              {issueLabel(code)}
                                            </span>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                          Checklist antiglosa ainda não materializado. Revalide a Pré-guia para atualizar.
                        </div>
                      )}
                    </div>
                  </Section>

                  <div className="mt-4 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
                    {String(detail?.revenueCycleState || detail?.snapshot?.revenueCycle?.state || "") === "official_xml_validated"
                      ? "XML TISS oficial validado e armazenado. Nenhum envio à operadora foi realizado."
                      : "Esta é uma pré-guia para validação interna. XML TISS ainda não foi gerado. O documento oficial validado também não foi gerado."}
                  </div>

                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={() => void openProfileEditor("provider")} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Editar Dados da clínica</button>
                    <button type="button" onClick={() => void openProfileEditor("payer")} disabled={!detail.payerId} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">Editar perfil TISS do pagador</button>
                    <button type="button" onClick={() => void openProfileEditor("professional")} disabled={!detail.professionalId} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">Editar perfil faturável do profissional</button>
                    {authorizationFooterActionLabel && (
                      <button type="button" onClick={() => openAuthorizationEditor()} disabled={!detail.patientId || !detail.payerId} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">{authorizationFooterActionLabel}</button>
                    )}
                    <button type="button" onClick={() => openAppointment(detail)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Ir para atendimento</button>
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

      {authorizationEditorOpen && (
        <div className="fixed inset-0 z-[160] flex items-end justify-center bg-slate-950/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Autorização do convênio">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
            <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{hasAuthorizationSnapshot(detail) ? "Editar autorização" : "Adicionar autorização"}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Autorização operacional de {fieldValue(detail?.patientName, "Paciente")} para {fieldValue(detail?.payerName, "pagador")}.
                </p>
              </div>
              <button type="button" onClick={() => setAuthorizationEditorOpen(false)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar autorização"><X size={18} /></button>
            </header>

            <div className="max-h-[calc(90vh-140px)] overflow-y-auto px-5 py-4 pb-24 sm:pb-5">
              <div className="space-y-4">
                <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
                  Cadastre a guia/senha liberada pelo convênio para este paciente, pagador e procedimento. Depois de salvar, a Pré-guia será revalidada.
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <EditorField label="Convênio/pagador" value={fieldValue(detail?.payerName, "")} onChange={() => undefined} maxLength={180} />
                  <EditorField label="Número da autorização/senha" value={authorizationForm.authorizationNumber || ""} onChange={(value) => updateAuthorizationField("authorizationNumber", value)} maxLength={120} />
                  <EditorField label="Número da guia" value={authorizationForm.guideNumber || ""} onChange={(value) => updateAuthorizationField("guideNumber", value)} maxLength={120} />
                  <EditorField label="Data de emissão" type="date" value={authorizationForm.issueDate || ""} onChange={(value) => updateAuthorizationField("issueDate", value)} />
                  <EditorField label="Início da validade" type="date" value={authorizationForm.validFrom || ""} onChange={(value) => updateAuthorizationField("validFrom", value)} />
                  <EditorField label="Validade final" type="date" value={authorizationForm.validUntil || ""} onChange={(value) => updateAuthorizationField("validUntil", value)} />
                  <EditorField label="Procedimento/TUSS autorizado" value={authorizationForm.procedureTussCode || ""} onChange={(value) => updateAuthorizationField("procedureTussCode", value)} maxLength={80} />
                  <EditorField label="Código interno autorizado" value={authorizationForm.procedureCode || ""} onChange={(value) => updateAuthorizationField("procedureCode", value)} maxLength={80} />
                  <EditorField label="Nome do procedimento autorizado" value={authorizationForm.procedureNameSnapshot || ""} onChange={(value) => updateAuthorizationField("procedureNameSnapshot", value)} maxLength={180} />
                  <EditorField label="Quantidade autorizada" type="number" value={authorizationForm.authorizedQuantity || ""} onChange={(value) => updateAuthorizationField("authorizedQuantity", value)} maxLength={20} />
                  <EditorField label="Unidade autorizada" value={authorizationForm.authorizedUnit || ""} onChange={(value) => updateAuthorizationField("authorizedUnit", value)} maxLength={40} />
                </div>
                <label className="block text-xs font-medium text-slate-600">
                  Observações
                  <textarea
                    value={authorizationForm.notes || ""}
                    onChange={(event) => updateAuthorizationField("notes", event.target.value)}
                    maxLength={2000}
                    rows={3}
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  />
                </label>
              </div>
            </div>

            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => setAuthorizationEditorOpen(false)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">Cancelar</button>
              <button type="button" onClick={() => void saveAuthorization()} disabled={authorizationSaving} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                {authorizationSaving && <Loader2 size={15} className="animate-spin" />}
                Salvar autorização e revalidar
              </button>
            </footer>
          </div>
        </div>
      )}

      {profileEditor && (
        <div className="fixed inset-0 z-[160] flex items-end justify-center bg-slate-950/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Configuração TISS">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
            <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {profileEditorMeta?.title}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {profileEditorMeta?.subject}
                </p>
              </div>
              <button type="button" onClick={() => setProfileEditor(null)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar configuração"><X size={18} /></button>
            </header>

            <div className="max-h-[calc(90vh-140px)] overflow-y-auto px-5 py-4 pb-24 sm:pb-5">
              {profileLoading ? (
                <div className="py-12 text-center text-sm text-slate-500"><Loader2 className="mx-auto mb-2 animate-spin" size={20} />Carregando cadastro</div>
              ) : profileEditor === "provider" ? (
                <div className="space-y-4">
                  <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">{profileEditorMeta?.description}</div>
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
                </div>
              ) : profileEditor === "payer" ? (
                <div className="space-y-5">
                  <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">{profileEditorMeta?.description}</div>
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
                    <label className="text-xs font-medium text-slate-600">
                      Identificação do beneficiário
                      <select value={profileForm.beneficiaryIdentificationType || "card_number"} onChange={(event) => updateProfileField("beneficiaryIdentificationType", event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                        <option value="card_number">Carteirinha</option>
                        <option value="cpf">CPF</option>
                        <option value="document">Documento</option>
                        <option value="other">Outro</option>
                      </select>
                    </label>
                    <EditorField label="Código do contratado na operadora" value={profileForm.contractedProviderCode || ""} onChange={(value) => updateProfileField("contractedProviderCode", value)} maxLength={120} />
                    <EditorField label="Contratado executante" value={profileForm.contractedExecutant || ""} onChange={(value) => updateProfileField("contractedExecutant", value)} maxLength={160} />
                    <EditorField label="Tipo de atendimento padrão" value={profileForm.defaultAttendanceType || ""} onChange={(value) => updateProfileField("defaultAttendanceType", value)} maxLength={80} />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      ["requiresAuthorization", "Exige autorização"],
                      ["requiresAuthorizedProcedure", "Exige procedimento autorizado"],
                      ["requiresAuthorizationPassword", "Exige senha/autorização"],
                      ["requiresGuideNumber", "Exige número de guia"],
                      ["requiresCid", "Exige CID"],
                      ["requiresProviderCode", "Exige código do prestador"],
                      ["requiresCnes", "Exige CNES"],
                      ["requiresCbo", "Exige CBO"],
                      ["requiresExecutantRegistry", "Exige registro do executante"],
                      ["requiresBeneficiaryCard", "Exige carteirinha"],
                      ["requiresBeneficiaryCardValidity", "Exige validade da carteirinha"],
                      ["requiresResponsibleSignature", "Exige assinatura do responsável"],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
                        <input type="checkbox" checked={Boolean(profileForm[key])} onChange={(event) => updateProfileField(key, event.target.checked)} />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">{profileEditorMeta?.description}</div>
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
                </div>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  if (profileEditor === "provider") onNavigateSettings?.();
                  else if (profileEditor === "payer") onNavigatePayers?.("rules");
                  else onNavigateProfessionals?.();
                }}
                className="text-sm font-medium text-indigo-700 hover:text-indigo-800"
              >
                {profileEditorMeta?.full || "Abrir cadastro completo"}
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={() => setProfileEditor(null)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">Cancelar</button>
                <button type="button" onClick={() => void saveProfile()} disabled={profileSaving || profileLoading} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {profileSaving && <Loader2 size={15} className="animate-spin" />}
                  Salvar cadastro global e revalidar pré-guia atual
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
