import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileSpreadsheet, Loader2, Plus, RefreshCw, Save, ShieldCheck, Trash2 } from "lucide-react";
import { dataService } from "../services/dataService";
import { getDefaultTissOfficialStrategyDescriptor } from "../services/tissOfficial/capabilities";
import {
  attendanceCharacters040300,
  attendanceRegimes040300,
  attendanceTypes040300,
  guideTypes040300,
  isSupportedAttendanceCharacter040300,
  isSupportedAttendanceRegime040300,
  isSupportedAttendanceType040300,
} from "../services/tissOfficial/versions/communication040300/domains";
import { buildClinicMonthDateRange } from "../utils/scheduling";

type Payer = {
  id: string;
  name: string;
  payerType: string;
  status: string;
  notes?: string | null;
};

type Requirement = {
  id: string;
  serviceType?: string | null;
  requireSignature: boolean;
  requireReport: boolean;
  requireActualDuration: boolean;
  requireAuthorization: boolean;
  requireGuide: boolean;
  requireProfessionalRegistry: boolean;
  requirePatientDocument: boolean;
  minDurationMinutes?: number | null;
  maxDurationVarianceMinutes?: number | null;
  allowManualOverride: boolean;
  isActive: boolean;
};

type TussService = {
  id: string;
  internalCode?: string | null;
  name: string;
  description?: string | null;
  specialty?: string | null;
  serviceType?: string | null;
  defaultDurationMinutes?: number | null;
  billingUnit?: string | null;
  defaultQuantity?: number | null;
  defaultAmountCents?: number | null;
  active?: boolean;
};

type TussCode = {
  id: string;
  code: string;
  description: string;
  termType?: string | null;
  version?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  active?: boolean;
};

type PayerTussMapping = {
  id: string;
  payerId: string;
  serviceCatalogId: string;
  tussCodeId?: string | null;
  serviceName?: string | null;
  internalCode?: string | null;
  tussCode?: string | null;
  tussDescription?: string | null;
  contractCode?: string | null;
  contractDescription?: string | null;
  payerSpecificDescription?: string | null;
  specialty?: string | null;
  guideType?: string | null;
  billingUnit?: string | null;
  quantityRule?: string | null;
  defaultQuantity?: number | null;
  amountCents?: number | null;
  negotiatedAmountCents?: number | null;
  standardDurationMinutes?: number | null;
  requiresAuthorization?: boolean;
  requiresGuide?: boolean;
  requiresReport?: boolean;
  requiresSignature?: boolean;
  requiresProfessionalRegistry?: boolean;
  requiresPatientDocument?: boolean;
  useActualDuration?: boolean;
  validFrom?: string | null;
  validTo?: string | null;
  source?: string | null;
  notes?: string | null;
  active: boolean;
};

type PayerProcedurePrice = {
  id: string;
  payerId: string;
  serviceCatalogId?: string | null;
  tussCodeId?: string | null;
  payerTussMappingId?: string | null;
  serviceName?: string | null;
  internalCode?: string | null;
  tussCode?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  source?: string | null;
  notes?: string | null;
  active?: boolean;
};

type BillingConfigurationRow = {
  key: string;
  price: PayerProcedurePrice | null;
  mapping: PayerTussMapping | null;
  service: TussService | null;
  code: TussCode | null;
  isOperational: boolean;
};

type PayerCrudEntityType = "requirement" | "service" | "code" | "mapping" | "price";

type SectionFeedback = {
  status: "idle" | "saving" | "success" | "error";
  message?: string;
};

type DeleteImpact = {
  canDelete: boolean;
  dependencies: Record<string, number>;
  isActive?: boolean;
  recommendedAction?: "delete" | "deactivate" | "keep_inactive";
  entityLabel?: string;
  entityName?: string;
  table?: string;
  activeColumn?: string;
  validFromColumn?: string | null;
  validToColumn?: string | null;
};

type PayerTissForm = {
  ansRegistration: string;
  operatorCode: string;
  tissVersion: string;
  defaultGuideType: string;
  beneficiaryIdentificationType: string;
  requiresBeneficiaryCard: boolean;
  requiresBeneficiaryCardValidity: boolean;
  requiresAuthorization: boolean;
  requiresAuthorizedProcedure: boolean;
  requiresAuthorizationPassword: boolean;
  requiresGuideNumber: boolean;
  requiresCid: boolean;
  requiresExecutantRegistry: boolean;
  requiresCbo: boolean;
  requiresCnes: boolean;
  requiresProviderCode: boolean;
  requiresResponsibleSignature: boolean;
  contractedExecutant: string;
  contractedProviderCode: string;
  operatorProviderCode: string;
  operatorDocumentNumber: string;
  auditorContactName: string;
  billingEmail: string;
  billingPhone: string;
  operatorPortalUrl: string;
  defaultAttendanceType: string;
  defaultAttendanceRegime: string;
  defaultAttendanceCharacter: string;
  requiresPhysicalGuide: boolean;
  requiresSignedGuide: boolean;
  requiresStampedDatedGuide: boolean;
  requiresAdministrativeReport: boolean;
  allowsMixedMultidisciplinaryGuide: boolean;
  requiresSeparateGuideBySpecialty: boolean;
  administrativeNotes: string;
  specificRules: string;
};

const payerTypeLabels: Record<string, string> = {
  INSURANCE: "Convênio",
  PRIVATE: "Particular",
  PUBLIC: "Público",
  COURTESY: "Cortesia",
  OTHER: "Outro",
};

const defaultRequirement = (payerId = "") => ({
  payerId,
  serviceType: "",
  requireSignature: true,
  requireReport: true,
  requireActualDuration: true,
  requireAuthorization: false,
  requireGuide: false,
  requireProfessionalRegistry: false,
  requirePatientDocument: false,
  minDurationMinutes: "",
  maxDurationVarianceMinutes: "10",
  allowManualOverride: true,
  isActive: true,
});

const defaultTussServiceForm = {
  internalCode: "",
  name: "",
  description: "",
  specialty: "",
  serviceType: "",
  defaultDurationMinutes: "",
  billingUnit: "session",
  defaultQuantity: "1",
  defaultAmountCents: "",
};

const defaultTussCodeForm = {
  code: "",
  description: "",
  termType: "",
  version: "",
  validFrom: "",
  validTo: "",
};

const defaultTussMappingForm = {
  serviceCatalogId: "",
  tussCodeId: "",
  contractCode: "",
  contractDescription: "",
  specialty: "",
  guideType: "sp_sadt",
  billingUnit: "session",
  quantityRule: "per_session",
  defaultQuantity: "1",
  amountCents: "",
  negotiatedAmountCents: "",
  standardDurationMinutes: "",
  requiresAuthorization: false,
  requiresGuide: false,
  requiresReport: false,
  requiresSignature: false,
  requiresProfessionalRegistry: false,
  requiresPatientDocument: false,
  useActualDuration: false,
  validFrom: "",
  validTo: "",
  source: "manual",
  notes: "",
};

const defaultProcedurePriceForm = {
  serviceCatalogId: "",
  tussCodeId: "",
  payerTussMappingId: "",
  amountCents: "",
  currency: "BRL",
  validFrom: "",
  validUntil: "",
  source: "manual",
  notes: "",
};

const defaultPayerTissForm: PayerTissForm = {
  ansRegistration: "",
  operatorCode: "",
  tissVersion: "",
  defaultGuideType: "sp_sadt",
  beneficiaryIdentificationType: "card_number",
  requiresBeneficiaryCard: true,
  requiresBeneficiaryCardValidity: false,
  requiresAuthorization: false,
  requiresAuthorizedProcedure: false,
  requiresAuthorizationPassword: false,
  requiresGuideNumber: false,
  requiresCid: false,
  requiresExecutantRegistry: false,
  requiresCbo: false,
  requiresCnes: false,
  requiresProviderCode: false,
  requiresResponsibleSignature: false,
  contractedExecutant: "",
  contractedProviderCode: "",
  operatorProviderCode: "",
  operatorDocumentNumber: "",
  auditorContactName: "",
  billingEmail: "",
  billingPhone: "",
  operatorPortalUrl: "",
  defaultAttendanceType: "",
  defaultAttendanceRegime: "",
  defaultAttendanceCharacter: "",
  requiresPhysicalGuide: false,
  requiresSignedGuide: false,
  requiresStampedDatedGuide: false,
  requiresAdministrativeReport: false,
  allowsMixedMultidisciplinaryGuide: false,
  requiresSeparateGuideBySpecialty: false,
  administrativeNotes: "",
  specificRules: "",
};

const OFFICIAL_TISS_XML_STRATEGY = getDefaultTissOfficialStrategyDescriptor();
const payerTissFieldClass = "mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100";

export const isBillingConfigurationOperational = (configuration: {
  service?: { active?: boolean } | null;
  code?: { active?: boolean } | null;
  mapping?: { active?: boolean } | null;
  price?: { active?: boolean } | null;
}) => (
  configuration.service?.active === true &&
  configuration.code?.active === true &&
  configuration.mapping?.active === true &&
  configuration.price?.active === true
);

const deleteDependencyLabels: Record<string, string> = {
  prices: "Preços vinculados",
  mappings: "Mapeamentos De/Para",
  billingItems: "Itens de faturamento",
  preGuides: "Pré-guias",
  officialPreGuides: "Pré-guias vinculadas a XML oficial",
  officialDocuments: "XMLs oficiais",
  authorizations: "Autorizações",
  unknown: "Vínculo histórico não confirmado",
};

function PayerTissField({
  id,
  label,
  helperText,
  children,
}: {
  id: string;
  label: string;
  helperText?: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={id} className="block text-xs font-normal text-slate-600">
      <span className="block text-slate-700">{label}</span>
      {children}
      {helperText ? (
        <span id={`${id}-help`} className="mt-1 block text-[11px] leading-4 text-slate-500">
          {helperText}
        </span>
      ) : null}
    </label>
  );
}

function PayerFormField({
  id,
  label,
  helperText,
  error,
  children,
}: {
  id: string;
  label: string;
  helperText?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={id} className="block text-xs font-normal text-slate-700">
      <span className="mb-1 block">{label}</span>
      {children}
      {helperText ? <span id={`${id}-help`} className="mt-1 block text-[11px] leading-4 text-slate-500">{helperText}</span> : null}
      {error ? <span id={`${id}-error`} className="mt-1 block text-[11px] leading-4 text-rose-600">{error}</span> : null}
    </label>
  );
}

function SectionFormActions({
  status,
  primaryLabel,
  savingLabel = "Salvando...",
  successLabel = "✓ Salvo",
  disabled,
  onCancel,
  onSubmit,
}: {
  status: SectionFeedback["status"];
  primaryLabel: string;
  savingLabel?: string;
  successLabel?: string;
  disabled?: boolean;
  onCancel?: () => void;
  onSubmit: () => void;
}) {
  const isSaving = status === "saving";
  const isSuccess = status === "success";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-normal text-slate-600 disabled:opacity-50"
        >
          Cancelar
        </button>
      ) : null}
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || isSaving || isSuccess}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-normal text-white disabled:opacity-50"
      >
        {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
        {isSaving ? savingLabel : isSuccess ? successLabel : primaryLabel}
      </button>
    </div>
  );
}

function SectionFeedbackMessage({ feedback }: { feedback?: SectionFeedback }) {
  if (!feedback || feedback.status === "idle" || !feedback.message) return null;
  const tone = feedback.status === "error"
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : feedback.status === "success"
      ? "border-emerald-100 bg-emerald-50 text-emerald-700"
      : "border-slate-100 bg-slate-50 text-slate-600";
  return (
    <div className={`mt-3 rounded-2xl border px-3 py-2 text-xs font-normal ${tone}`}>
      {feedback.message}
    </div>
  );
}

const hasOption = (options: Array<{ code: string }>, value: string) => options.some((option) => option.code === value);
const legacyInvalidLabel = (value: string) => value ? `Legado inválido: ${value}` : "Selecione";

const normalizePayerTissProfile = (profile: any = {}): PayerTissForm => ({
  ansRegistration: profile.ans_registration || profile.ansRegistration || "",
  operatorCode: profile.operator_code || profile.operatorCode || "",
  tissVersion: profile.tiss_version || profile.tissVersion || "",
  defaultGuideType: profile.default_guide_type || profile.defaultGuideType || "sp_sadt",
  beneficiaryIdentificationType: profile.beneficiary_identification_type || profile.beneficiaryIdentificationType || "card_number",
  requiresBeneficiaryCard: profile.requires_beneficiary_card ?? profile.requiresBeneficiaryCard ?? true,
  requiresBeneficiaryCardValidity: Boolean(profile.requires_beneficiary_card_validity ?? profile.requiresBeneficiaryCardValidity),
  requiresAuthorization: Boolean(profile.requires_authorization ?? profile.requiresAuthorization),
  requiresAuthorizedProcedure: Boolean(profile.requires_authorized_procedure ?? profile.requiresAuthorizedProcedure),
  requiresAuthorizationPassword: Boolean(profile.requires_authorization_password ?? profile.requiresAuthorizationPassword),
  requiresGuideNumber: Boolean(profile.requires_guide_number ?? profile.requiresGuideNumber),
  requiresCid: Boolean(profile.requires_cid ?? profile.requiresCid),
  requiresExecutantRegistry: Boolean(profile.requires_executant_registry ?? profile.requiresExecutantRegistry),
  requiresCbo: Boolean(profile.requires_cbo ?? profile.requiresCbo),
  requiresCnes: Boolean(profile.requires_cnes ?? profile.requiresCnes),
  requiresProviderCode: Boolean(profile.requires_provider_code ?? profile.requiresProviderCode),
  requiresResponsibleSignature: Boolean(profile.requires_responsible_signature ?? profile.requiresResponsibleSignature),
  contractedExecutant: profile.contracted_executant || profile.contractedExecutant || "",
  contractedProviderCode: profile.contracted_provider_code || profile.contractedProviderCode || "",
  operatorProviderCode: profile.operator_provider_code || profile.operatorProviderCode || "",
  operatorDocumentNumber: profile.operator_document_number || profile.operatorDocumentNumber || "",
  auditorContactName: profile.auditor_contact_name || profile.auditorContactName || "",
  billingEmail: profile.billing_email || profile.billingEmail || "",
  billingPhone: profile.billing_phone || profile.billingPhone || "",
  operatorPortalUrl: profile.operator_portal_url || profile.operatorPortalUrl || "",
  defaultAttendanceType: profile.default_attendance_type || profile.defaultAttendanceType || "",
  defaultAttendanceRegime: profile.default_attendance_regime || profile.defaultAttendanceRegime || "",
  defaultAttendanceCharacter: profile.default_attendance_character || profile.defaultAttendanceCharacter || "",
  requiresPhysicalGuide: Boolean(profile.requires_physical_guide ?? profile.requiresPhysicalGuide),
  requiresSignedGuide: Boolean(profile.requires_signed_guide ?? profile.requiresSignedGuide),
  requiresStampedDatedGuide: Boolean(profile.requires_stamped_dated_guide ?? profile.requiresStampedDatedGuide),
  requiresAdministrativeReport: Boolean(profile.requires_administrative_report ?? profile.requiresAdministrativeReport),
  allowsMixedMultidisciplinaryGuide: Boolean(profile.allows_mixed_multidisciplinary_guide ?? profile.allowsMixedMultidisciplinaryGuide),
  requiresSeparateGuideBySpecialty: Boolean(profile.requires_separate_guide_by_specialty ?? profile.requiresSeparateGuideBySpecialty),
  administrativeNotes: profile.administrative_notes || profile.administrativeNotes || "",
  specificRules: profile.specific_rules || profile.specificRules || "",
});

const isInsurancePayer = (payer?: Payer | null) => String(payer?.payerType || "").toUpperCase() === "INSURANCE";
const isFilled = (value: unknown) => String(value ?? "").trim().length > 0;

export const formatCentsForBrazilianInput = (value: unknown) => {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents < 0) return "";
  const reais = Math.floor(cents / 100);
  return `${reais},${String(cents % 100).padStart(2, "0")}`;
};

export const parseBrazilianCurrencyToCents = (value: unknown): number | null => {
  const normalized = String(value ?? "").trim().replace(/^R\$\s*/i, "").replace(/\s+/g, "");
  if (!normalized) return null;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(normalized)) return null;
  const [whole, decimal = ""] = normalized.replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
};

const payerTissMissing = (payer: Payer | null, form: PayerTissForm) => {
  if (!isInsurancePayer(payer)) return [];
  const missing: string[] = [];
  if (!isFilled(form.ansRegistration)) missing.push("Registro ANS não informado");
  if (form.requiresProviderCode && !isFilled(form.contractedProviderCode) && !isFilled(form.operatorProviderCode) && !isFilled(form.operatorCode)) {
    missing.push("Código do contratado na operadora não informado");
  }
  if (form.requiresBeneficiaryCard && !isFilled(form.beneficiaryIdentificationType)) {
    missing.push("Tipo de identificação do beneficiário não configurado");
  }
  return missing;
};

type PayerRequirementsPanelProps = {
  initialSection?: "convenios" | "tuss" | "prices" | "rules";
  navigationIntentKey?: number;
};

export function PayerRequirementsPanel({
  initialSection,
  navigationIntentKey,
}: PayerRequirementsPanelProps = {}) {
  const [payers, setPayers] = useState<Payer[]>([]);
  const [selectedPayerId, setSelectedPayerId] = useState("");
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [payerForm, setPayerForm] = useState({ name: "", payerType: "INSURANCE", notes: "" });
  const [requirementForm, setRequirementForm] = useState(defaultRequirement());
  const [tussServices, setTussServices] = useState<TussService[]>([]);
  const [tussCodes, setTussCodes] = useState<TussCode[]>([]);
  const [tussMappings, setTussMappings] = useState<PayerTussMapping[]>([]);
  const [procedurePrices, setProcedurePrices] = useState<PayerProcedurePrice[]>([]);
  const [tussLoading, setTussLoading] = useState(false);
  const [tussServiceForm, setTussServiceForm] = useState(defaultTussServiceForm);
  const [tussCodeForm, setTussCodeForm] = useState(defaultTussCodeForm);
  const [tussMappingForm, setTussMappingForm] = useState(defaultTussMappingForm);
  const [procedurePriceForm, setProcedurePriceForm] = useState(defaultProcedurePriceForm);
  const [editingTussServiceId, setEditingTussServiceId] = useState("");
  const [editingTussCodeId, setEditingTussCodeId] = useState("");
  const [editingTussMappingId, setEditingTussMappingId] = useState("");
  const [editingProcedurePriceId, setEditingProcedurePriceId] = useState("");
  const [procedurePriceAmountError, setProcedurePriceAmountError] = useState("");
  const [tussActionInfo, setTussActionInfo] = useState("");
  const [supportFormOpen, setSupportFormOpen] = useState(false);
  const [supportFormTarget, setSupportFormTarget] = useState<"service" | "code" | null>(null);
  const [supportCatalogOpen, setSupportCatalogOpen] = useState(false);
  const [supportActionKey, setSupportActionKey] = useState("");
  const [sectionFeedback, setSectionFeedback] = useState<Record<string, SectionFeedback>>({});
  const [activeEditingSection, setActiveEditingSection] = useState<string>("");
  const [deleteModal, setDeleteModal] = useState<{
    entityType: PayerCrudEntityType;
    id: string;
    name: string;
    impact?: DeleteImpact | null;
    error?: string;
  } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [openBillingActionMenuKey, setOpenBillingActionMenuKey] = useState("");
  const [authorizationSyncModal, setAuthorizationSyncModal] = useState<{
    mapping: PayerTussMapping;
    summary?: Record<string, any> | null;
  } | null>(null);
  const [authorizationSyncLoading, setAuthorizationSyncLoading] = useState(false);
  const [payerTissForm, setPayerTissForm] = useState<PayerTissForm>(defaultPayerTissForm);
  const [payerTissLoading, setPayerTissLoading] = useState(false);
  const [payerTissMessage, setPayerTissMessage] = useState("");
  const payerRulesSectionRef = useRef<HTMLDivElement | null>(null);
  const payerTussSectionRef = useRef<HTMLDivElement | null>(null);
  const payerPricesSectionRef = useRef<HTMLDivElement | null>(null);
  const tussServiceFormRef = useRef<HTMLDivElement | null>(null);
  const tussServiceNameInputRef = useRef<HTMLInputElement | null>(null);
  const tussCodeFormRef = useRef<HTMLDivElement | null>(null);
  const tussCodeInputRef = useRef<HTMLInputElement | null>(null);
  const procedurePriceSaveInFlightRef = useRef(false);
  const supportActionInFlightRef = useRef(false);
  const procedurePriceAmountInputRef = useRef<HTMLInputElement | null>(null);

  const setLocalFeedback = (section: string, feedback: SectionFeedback) => {
    setSectionFeedback((current) => ({ ...current, [section]: feedback }));
  };

  const clearLocalFeedback = (section: string) => {
    setSectionFeedback((current) => {
      const next = { ...current };
      delete next[section];
      return next;
    });
  };

  const beginEditingSection = (section: string) => {
    if (activeEditingSection && activeEditingSection !== section) {
      const discard = window.confirm("Existem alterações não salvas nesta seção. Deseja descartá-las?");
      if (!discard) return false;
    }
    setActiveEditingSection(section);
    clearLocalFeedback(section);
    return true;
  };

  const finishEditingSection = (section: string) => {
    if (activeEditingSection === section) setActiveEditingSection("");
  };

  const selectedPayer = useMemo(
    () => payers.find((payer) => payer.id === selectedPayerId) || null,
    [payers, selectedPayerId],
  );
  const selectedPayerTissMissing = useMemo(
    () => payerTissMissing(selectedPayer, payerTissForm),
    [payerTissForm, selectedPayer],
  );
  const selectedPayerMappingCount = tussMappings.filter((mapping) => mapping.active === true).length;
  const selectedPayerPriceCount = procedurePrices.filter((price) => price.active === true).length;
  const selectedPayerOfficialCodeIssues = useMemo(() => {
    const issues: string[] = [];
    if (payerTissForm.defaultAttendanceType && !isSupportedAttendanceType040300(payerTissForm.defaultAttendanceType)) issues.push("Tipo de atendimento inválido");
    if (payerTissForm.defaultAttendanceRegime && !isSupportedAttendanceRegime040300(payerTissForm.defaultAttendanceRegime)) issues.push("Regime de atendimento inválido");
    if (payerTissForm.defaultAttendanceCharacter && !isSupportedAttendanceCharacter040300(payerTissForm.defaultAttendanceCharacter)) issues.push("Caráter de atendimento inválido");
    if (payerTissForm.defaultGuideType && !hasOption(guideTypes040300, payerTissForm.defaultGuideType)) issues.push("Tipo de guia inválido");
    return issues;
  }, [payerTissForm.defaultAttendanceCharacter, payerTissForm.defaultAttendanceRegime, payerTissForm.defaultAttendanceType, payerTissForm.defaultGuideType]);
  const selectedPayerReadiness = useMemo(() => {
    if (!isInsurancePayer(selectedPayer)) return { label: "TISS não aplicável", className: "bg-slate-100 text-slate-600", issues: [] as string[] };
    const issues = [
      ...selectedPayerTissMissing,
      ...selectedPayerOfficialCodeIssues,
      selectedPayerMappingCount === 0 ? "Sem De/Para TUSS ativo" : "",
      selectedPayerPriceCount === 0 ? "Sem valor negociado ativo" : "",
      payerTissMessage ? "Pré-guias precisam ser revalidadas" : "",
    ].filter(Boolean) as string[];
    if (selectedPayerOfficialCodeIssues.length > 0) return { label: "Configuração inválida", className: "bg-rose-50 text-rose-700", issues };
    if (payerTissMessage) return { label: "Pré-guias precisam ser revalidadas", className: "bg-amber-50 text-amber-700", issues };
    if (issues.length > 0) return { label: "Configuração incompleta", className: "bg-amber-50 text-amber-700", issues };
    return { label: "Pronto para gerar XML", className: "bg-emerald-50 text-emerald-700", issues };
  }, [payerTissMessage, selectedPayer, selectedPayerMappingCount, selectedPayerOfficialCodeIssues, selectedPayerPriceCount, selectedPayerTissMissing]);
  const activeTussServices = useMemo(() => tussServices.filter((service) => service.active === true), [tussServices]);
  const activeTussCodes = useMemo(() => tussCodes.filter((code) => code.active === true), [tussCodes]);
  const hasDemoTussData = [...tussMappings, ...tussCodes].some((item: any) =>
    /demo|teste/i.test(String(item?.source || item?.tussCode || item?.code || item?.contractCode || "")),
  );
  const formatCurrency = (amount?: number | null) => {
    const formatted = formatCentsForBrazilianInput(amount);
    return formatted ? `R$ ${formatted}` : "valor pendente";
  };
  const billingConfigurations = useMemo(() => {
    const servicesById = new Map<string, TussService>(tussServices.map((service) => [service.id, service]));
    const codesById = new Map<string, TussCode>(tussCodes.map((code) => [code.id, code]));
    const mappingsById = new Map<string, PayerTussMapping>(tussMappings.map((mapping) => [mapping.id, mapping]));
    const usedMappingIds = new Set<string>();
    const rows: BillingConfigurationRow[] = procedurePrices.map((price) => {
      const mapping = (price.payerTussMappingId && mappingsById.get(price.payerTussMappingId)) ||
        tussMappings.find((candidate) =>
          candidate.serviceCatalogId === price.serviceCatalogId &&
          (!price.tussCodeId || candidate.tussCodeId === price.tussCodeId),
        ) || null;
      if (mapping?.id) usedMappingIds.add(mapping.id);
      const service = servicesById.get(price.serviceCatalogId || mapping?.serviceCatalogId || "") || null;
      const code = codesById.get(price.tussCodeId || mapping?.tussCodeId || "") || null;
      const row = { key: `price:${price.id}`, price, mapping, service, code };
      return { ...row, isOperational: isBillingConfigurationOperational(row) };
    });
    for (const mapping of tussMappings) {
      if (usedMappingIds.has(mapping.id)) continue;
      const row = {
        key: `mapping:${mapping.id}`,
        price: null as PayerProcedurePrice | null,
        mapping,
        service: servicesById.get(mapping.serviceCatalogId) || null,
        code: codesById.get(mapping.tussCodeId || "") || null,
      };
      rows.push({ ...row, isOperational: isBillingConfigurationOperational(row) });
    }
    return rows;
  }, [procedurePrices, tussCodes, tussMappings, tussServices]);

  const activeBillingConfigurations = useMemo(
    () => billingConfigurations.filter((configuration) => configuration.isOperational),
    [billingConfigurations],
  );
  const inactiveBillingConfigurations = useMemo(
    () => billingConfigurations.filter((configuration) => !configuration.isOperational),
    [billingConfigurations],
  );

  const openSupportForm = (target: "service" | "code") => {
    setSupportFormTarget(target);
    setSupportFormOpen(true);
    setSupportCatalogOpen(true);
    window.setTimeout(() => {
      const formRef = target === "service" ? tussServiceFormRef : tussCodeFormRef;
      const inputRef = target === "service" ? tussServiceNameInputRef : tussCodeInputRef;
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      inputRef.current?.focus();
    }, 80);
  };

  const startNewSupportForm = (target: "service" | "code") => {
    if (!beginEditingSection(target)) return;
    if (target === "service") {
      setEditingTussServiceId("");
      setTussServiceForm(defaultTussServiceForm);
    } else {
      setEditingTussCodeId("");
      setTussCodeForm(defaultTussCodeForm);
    }
    setTussActionInfo("");
    openSupportForm(target);
  };

  const cancelSupportForm = (target: "service" | "code") => {
    if (target === "service") {
      setEditingTussServiceId("");
      setTussServiceForm(defaultTussServiceForm);
    } else {
      setEditingTussCodeId("");
      setTussCodeForm(defaultTussCodeForm);
    }
    clearLocalFeedback(target);
    finishEditingSection(target);
    setSupportFormOpen(false);
    setSupportFormTarget(null);
  };

  const startNewBillingConfigurationPart = (target: "mapping" | "price") => {
    if (!beginEditingSection(target)) return;
    if (target === "mapping") {
      setEditingTussMappingId("");
      setTussMappingForm({
        ...defaultTussMappingForm,
        serviceCatalogId: activeTussServices[0]?.id || "",
        tussCodeId: activeTussCodes[0]?.id || "",
      });
      payerTussSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setEditingProcedurePriceId("");
    setProcedurePriceForm({
      ...defaultProcedurePriceForm,
      serviceCatalogId: activeTussServices[0]?.id || "",
      tussCodeId: activeTussCodes[0]?.id || "",
    });
    setProcedurePriceAmountError("");
    payerPricesSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => procedurePriceAmountInputRef.current?.focus(), 250);
  };

  const loadPayers = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await dataService.getPayers({ status: "ACTIVE", limit: 80 });
      if (!result?.success) {
        const loadError = String(result?.error || "").trim();
        setError(/pagadores/i.test(loadError) ? "Não foi possível carregar os convênios." : loadError || "Não foi possível carregar os convênios.");
        setPayers([]);
        return;
      }
      const rows = Array.isArray(result.data) ? result.data : [];
      setPayers(rows);
      setSelectedPayerId((current) => current || rows[0]?.id || "");
    } finally {
      setLoading(false);
    }
  };

  const loadRequirements = async (payerId: string) => {
    if (!payerId) {
      setRequirements([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await dataService.getPayerRequirements(payerId);
      if (!result?.success) {
        setError(result?.error || "Não foi possível carregar regras agora.");
        setRequirements([]);
        return;
      }
      setRequirements(Array.isArray(result.data) ? result.data : []);
      setRequirementForm(defaultRequirement(payerId));
    } finally {
      setLoading(false);
    }
  };

  const loadTussConfig = async (payerId: string) => {
    setTussLoading(true);
    try {
      const [servicesResult, codesResult, mappingsResult, pricesResult] = await Promise.all([
        dataService.getTussServices({ limit: 160 }),
        dataService.getTussCodes({ limit: 240 }),
        dataService.getPayerTussMappings({ payerId, limit: 180 }),
        payerId ? dataService.getPayerProcedurePrices({ payerId, limit: 180 }) : Promise.resolve({ success: true, data: [] }),
      ]);
      if (servicesResult?.success) setTussServices(Array.isArray(servicesResult.data) ? servicesResult.data : []);
      if (codesResult?.success) setTussCodes(Array.isArray(codesResult.data) ? codesResult.data : []);
      if (mappingsResult?.success) setTussMappings(Array.isArray(mappingsResult.data) ? mappingsResult.data : []);
      if (pricesResult?.success) setProcedurePrices(Array.isArray(pricesResult.data) ? pricesResult.data : []);
      setTussMappingForm((current) => ({
        ...current,
        serviceCatalogId: current.serviceCatalogId || servicesResult?.data?.find((item: TussService) => item.active !== false)?.id || "",
        tussCodeId: current.tussCodeId || codesResult?.data?.find((item: TussCode) => item.active !== false)?.id || "",
      }));
      setProcedurePriceForm((current) => ({
        ...current,
        serviceCatalogId: current.serviceCatalogId || servicesResult?.data?.find((item: TussService) => item.active !== false)?.id || "",
        tussCodeId: current.tussCodeId || codesResult?.data?.find((item: TussCode) => item.active !== false)?.id || "",
      }));
    } finally {
      setTussLoading(false);
    }
  };

  const loadPayerTissProfile = async (payerId: string) => {
    if (!payerId) {
      setPayerTissForm(defaultPayerTissForm);
      return;
    }
    setPayerTissLoading(true);
    setPayerTissMessage("");
    try {
      const result = await dataService.getPayerTissProfile(payerId);
      if (!result?.success) {
        setError(result?.error || "Não foi possível carregar os dados TISS da operadora agora.");
        setPayerTissForm(defaultPayerTissForm);
        return;
      }
      setPayerTissForm(normalizePayerTissProfile(result.data || {}));
    } finally {
      setPayerTissLoading(false);
    }
  };

  useEffect(() => {
    void loadPayers();
  }, []);

  useEffect(() => {
    void loadRequirements(selectedPayerId);
  }, [selectedPayerId]);

  useEffect(() => {
    void loadTussConfig(selectedPayerId);
  }, [selectedPayerId]);

  useEffect(() => {
    const target =
      initialSection === "tuss"
        ? payerTussSectionRef.current
        : initialSection === "prices"
          ? payerPricesSectionRef.current
          : initialSection === "rules"
            ? payerRulesSectionRef.current
            : null;
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [initialSection, navigationIntentKey, selectedPayerId]);

  useEffect(() => {
    void loadPayerTissProfile(selectedPayerId);
  }, [selectedPayerId]);

  const createPayer = async () => {
    if (payerForm.name.trim().length < 2) return;
    setSaving(true);
    setError("");
    try {
      const result = await dataService.createPayer({
        name: payerForm.name.trim(),
        payerType: payerForm.payerType,
        notes: payerForm.notes.trim(),
      });
      if (!result?.success) {
        setError(result?.error || "Não foi possível criar o pagador agora.");
        return;
      }
      setPayerForm({ name: "", payerType: "INSURANCE", notes: "" });
      await loadPayers();
      if (result.data?.id) setSelectedPayerId(result.data.id);
    } finally {
      setSaving(false);
    }
  };

  const saveRequirement = async () => {
    if (!selectedPayerId) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...requirementForm,
        serviceType: requirementForm.serviceType.trim(),
        minDurationMinutes: requirementForm.minDurationMinutes ? Number(requirementForm.minDurationMinutes) : null,
        maxDurationVarianceMinutes: requirementForm.maxDurationVarianceMinutes ? Number(requirementForm.maxDurationVarianceMinutes) : null,
      };
      const result = await dataService.createPayerRequirement(selectedPayerId, payload);
      if (!result?.success) {
        setError(result?.error || "Não foi possível salvar a regra agora.");
        return;
      }
      await loadRequirements(selectedPayerId);
    } finally {
      setSaving(false);
    }
  };

  const disableRequirement = async (requirementId: string) => {
    setSaving(true);
    setError("");
    try {
      const result = await dataService.updatePayerRequirement(requirementId, { isActive: false });
      if (!result?.success) setError(result?.error || "Não foi possível desativar a regra agora.");
      else await loadRequirements(selectedPayerId);
    } finally {
      setSaving(false);
    }
  };

  const setRequirementActive = async (requirementId: string, isActive: boolean) => {
    setSaving(true);
    setError("");
    setLocalFeedback("requirements", { status: "saving", message: isActive ? "Reativando exceção..." : "Inativando exceção..." });
    try {
      const result = await dataService.updatePayerRequirement(requirementId, { isActive });
      if (!result?.success) {
        setError(result?.error || "Não foi possível atualizar a exceção agora.");
        setLocalFeedback("requirements", { status: "error", message: "Não foi possível salvar. Revise os campos destacados." });
        return false;
      }
      setRequirements((current) => current.map((rule) => rule.id === requirementId ? { ...rule, ...(result.data || {}), isActive } : rule));
      setLocalFeedback("requirements", { status: "success", message: isActive ? "Exceção reativada com sucesso." : "Exceção inativada com sucesso." });
      return true;
    } finally {
      setSaving(false);
    }
  };

  const toggleRequirementFlag = (key: string) => {
    setRequirementForm((current: any) => ({ ...current, [key]: !current[key] }));
  };

  const updatePayerTiss = (key: keyof PayerTissForm, value: any) => {
    setPayerTissForm((current) => ({ ...current, [key]: value }));
  };

  const savePayerTissProfile = async () => {
    if (!selectedPayerId || !isInsurancePayer(selectedPayer)) return;
    setSaving(true);
    setError("");
    setPayerTissMessage("");
    try {
      const result = await dataService.updatePayerTissProfile(selectedPayerId, payerTissForm);
      if (!result?.success) {
        setError(result?.error || "Não foi possível salvar os dados TISS da operadora agora.");
        return;
      }
      setPayerTissForm(normalizePayerTissProfile(result.data || payerTissForm));
      setPayerTissMessage("Configuração do convênio salva. Pré-guias deste pagador foram marcadas para revalidação.");
    } finally {
      setSaving(false);
    }
  };

  const upsertTussMappingInState = (item: PayerTussMapping) => {
    setTussMappings((current) => {
      const index = current.findIndex((mapping) => mapping.id === item.id);
      if (index < 0) return [item, ...current];
      return current.map((mapping) => mapping.id === item.id ? item : mapping);
    });
  };

  const upsertProcedurePriceInState = (item: PayerProcedurePrice) => {
    setProcedurePrices((current) => {
      const index = current.findIndex((price) => price.id === item.id);
      if (index < 0) return [item, ...current];
      return current.map((price) => price.id === item.id ? item : price);
    });
  };

  const upsertTussServiceInState = (item: TussService) => {
    setTussServices((current) => Array.from(new Map([item, ...current].map((service) => [service.id, service])).values()));
  };

  const upsertTussCodeInState = (item: TussCode) => {
    setTussCodes((current) => Array.from(new Map([item, ...current].map((code) => [code.id, code])).values()));
  };

  const currentMonthRange = () => {
    return buildClinicMonthDateRange(new Date());
  };

  const createTussService = async () => {
    if (tussServiceForm.name.trim().length < 2) return;
    const wasEditing = Boolean(editingTussServiceId);
    const rawDefaultAmount = String(tussServiceForm.defaultAmountCents || "").trim();
    const defaultAmountCents = rawDefaultAmount ? parseBrazilianCurrencyToCents(rawDefaultAmount) : null;
    if (rawDefaultAmount && defaultAmountCents === null) {
      setError("Informe o valor padrão em reais, com no máximo duas casas decimais.");
      return;
    }
    setSaving(true);
    setError("");
    setTussActionInfo("");
    setLocalFeedback("service", { status: "saving", message: "Salvando procedimento interno..." });
    try {
      const payload = {
        ...tussServiceForm,
        name: tussServiceForm.name.trim(),
        internalCode: tussServiceForm.internalCode.trim(),
        description: tussServiceForm.description.trim(),
        specialty: tussServiceForm.specialty.trim(),
        serviceType: tussServiceForm.serviceType.trim(),
        defaultDurationMinutes: tussServiceForm.defaultDurationMinutes ? Number(tussServiceForm.defaultDurationMinutes) : null,
        defaultQuantity: Number(tussServiceForm.defaultQuantity || 1),
        defaultAmountCents,
      };
      const result = editingTussServiceId
        ? await dataService.updateTussService(editingTussServiceId, payload)
        : await dataService.createTussService(payload);
      if (!result?.success || !result.data) {
        setError(result?.error || "Não foi possível salvar o procedimento agora.");
        return;
      }
      upsertTussServiceInState(result.data);
      setTussServiceForm(defaultTussServiceForm);
      setEditingTussServiceId("");
      setTussMappingForm((current) => ({ ...current, serviceCatalogId: current.serviceCatalogId || result.data.id }));
      setTussActionInfo(wasEditing ? "Procedimento atualizado." : "Procedimento criado.");
      setLocalFeedback("service", { status: "success", message: "Alterações salvas com sucesso." });
      finishEditingSection("service");
    } finally {
      setSaving(false);
    }
  };

  const createTussCode = async () => {
    if (tussCodeForm.code.trim().length < 2 || tussCodeForm.description.trim().length < 2) return;
    const wasEditing = Boolean(editingTussCodeId);
    setSaving(true);
    setError("");
    setTussActionInfo("");
    setLocalFeedback("code", { status: "saving", message: "Salvando código TUSS..." });
    try {
      const payload = {
        code: tussCodeForm.code.trim(),
        description: tussCodeForm.description.trim(),
        termType: tussCodeForm.termType.trim(),
        version: tussCodeForm.version.trim(),
        validFrom: tussCodeForm.validFrom,
        validTo: tussCodeForm.validTo,
        source: "manual",
      };
      const result = editingTussCodeId
        ? await dataService.updateTussCode(editingTussCodeId, payload)
        : await dataService.createTussCode(payload);
      if (!result?.success || !result.data) {
        setError(result?.error || "Não foi possível salvar o código TUSS agora.");
        return;
      }
      upsertTussCodeInState(result.data);
      setTussCodeForm(defaultTussCodeForm);
      setEditingTussCodeId("");
      setTussMappingForm((current) => ({ ...current, tussCodeId: current.tussCodeId || result.data.id }));
      setTussActionInfo(wasEditing ? "Código TUSS atualizado." : "Código TUSS cadastrado.");
      setLocalFeedback("code", { status: "success", message: "Alterações salvas com sucesso." });
      finishEditingSection("code");
    } finally {
      setSaving(false);
    }
  };

  const createTussMapping = async () => {
    if (!selectedPayerId || !tussMappingForm.serviceCatalogId) return;
    const wasEditing = Boolean(editingTussMappingId);
    setSaving(true);
    setError("");
    setTussActionInfo("");
    setLocalFeedback("mapping", { status: "saving", message: "Salvando De/Para..." });
    try {
      const payload = {
        ...tussMappingForm,
        payerId: selectedPayerId,
        defaultQuantity: Number(tussMappingForm.defaultQuantity || 1),
        amountCents: undefined,
        negotiatedAmountCents: undefined,
        standardDurationMinutes: tussMappingForm.standardDurationMinutes ? Number(tussMappingForm.standardDurationMinutes) : null,
        contractCode: tussMappingForm.contractCode.trim(),
        contractDescription: tussMappingForm.contractDescription.trim(),
        specialty: tussMappingForm.specialty.trim(),
        source: tussMappingForm.source,
        notes: tussMappingForm.notes.trim(),
      };
      const result = editingTussMappingId
        ? await dataService.updatePayerTussMapping(editingTussMappingId, payload)
        : await dataService.createPayerTussMapping(payload);
      if (!result?.success || !result.data) {
        setError(result?.error || "Não foi possível salvar o mapeamento agora.");
        return;
      }
      upsertTussMappingInState(result.data);
      setTussMappingForm((current) => ({
        ...defaultTussMappingForm,
        serviceCatalogId: current.serviceCatalogId,
        tussCodeId: current.tussCodeId,
      }));
      setEditingTussMappingId("");
      setTussActionInfo(wasEditing ? "Mapeamento atualizado." : "Mapeamento criado.");
      setLocalFeedback("mapping", { status: "success", message: "Alterações salvas com sucesso." });
      finishEditingSection("mapping");
    } finally {
      setSaving(false);
    }
  };

  const saveProcedurePrice = async () => {
    if (procedurePriceSaveInFlightRef.current || !selectedPayerId || !procedurePriceForm.serviceCatalogId) return;
    const wasEditing = Boolean(editingProcedurePriceId);
    const amountCents = parseBrazilianCurrencyToCents(procedurePriceForm.amountCents);
    if (amountCents === null) {
      setProcedurePriceAmountError("Informe um valor válido em reais, com no máximo duas casas decimais.");
      procedurePriceAmountInputRef.current?.focus();
      return;
    }
    procedurePriceSaveInFlightRef.current = true;
    setSaving(true);
    setError("");
    setProcedurePriceAmountError("");
    setTussActionInfo("");
    setLocalFeedback("price", { status: "saving", message: "Salvando valor negociado..." });
    try {
      const payload = {
        ...procedurePriceForm,
        payerId: selectedPayerId,
        amountCents,
      };
      const result = editingProcedurePriceId
        ? await dataService.updatePayerProcedurePrice(editingProcedurePriceId, payload)
        : await dataService.createPayerProcedurePrice(payload);
      if (!result?.success || !result.data) {
        setError(result?.error || "Não foi possível salvar o valor negociado agora.");
        return;
      }
      upsertProcedurePriceInState(result.data);
      setProcedurePriceForm((current) => ({
        ...defaultProcedurePriceForm,
        serviceCatalogId: current.serviceCatalogId,
        tussCodeId: current.tussCodeId,
      }));
      setEditingProcedurePriceId("");
      setTussActionInfo(wasEditing ? "Valor negociado atualizado." : "Valor negociado cadastrado.");
      setLocalFeedback("price", { status: "success", message: "Alterações salvas com sucesso." });
      finishEditingSection("price");
    } finally {
      setSaving(false);
      procedurePriceSaveInFlightRef.current = false;
    }
  };

  const editTussService = (service: TussService) => {
    if (!beginEditingSection("service")) return;
    setEditingTussServiceId(service.id);
    setError("");
    setTussActionInfo("");
    setTussServiceForm({
      internalCode: service.internalCode || "",
      name: service.name || "",
      description: service.description || "",
      specialty: service.specialty || "",
      serviceType: service.serviceType || "",
      defaultDurationMinutes: service.defaultDurationMinutes ? String(service.defaultDurationMinutes) : "",
      billingUnit: service.billingUnit || "session",
      defaultQuantity: service.defaultQuantity ? String(service.defaultQuantity) : "1",
      defaultAmountCents: formatCentsForBrazilianInput(service.defaultAmountCents),
    });
    openSupportForm("service");
  };

  const editTussCode = (code: TussCode) => {
    if (!beginEditingSection("code")) return;
    setEditingTussCodeId(code.id);
    setError("");
    setTussActionInfo("");
    setTussCodeForm({
      code: code.code || "",
      description: code.description || "",
      termType: code.termType || "",
      version: code.version || "",
      validFrom: code.validFrom || "",
      validTo: code.validTo || "",
    });
    openSupportForm("code");
  };

  const editTussMapping = (mapping: PayerTussMapping) => {
    if (!beginEditingSection("mapping")) return;
    setEditingTussMappingId(mapping.id);
    setTussMappingForm({
      serviceCatalogId: mapping.serviceCatalogId || "",
      tussCodeId: mapping.tussCodeId || "",
      contractCode: mapping.contractCode || "",
      contractDescription: mapping.contractDescription || mapping.payerSpecificDescription || "",
      specialty: mapping.specialty || "",
      guideType: mapping.guideType || "sp_sadt",
      billingUnit: mapping.billingUnit || "session",
      quantityRule: mapping.quantityRule || "per_session",
      defaultQuantity: mapping.defaultQuantity ? String(mapping.defaultQuantity) : "1",
      amountCents: formatCentsForBrazilianInput(mapping.amountCents),
      negotiatedAmountCents: formatCentsForBrazilianInput(mapping.negotiatedAmountCents),
      standardDurationMinutes: mapping.standardDurationMinutes ? String(mapping.standardDurationMinutes) : "",
      requiresAuthorization: Boolean(mapping.requiresAuthorization),
      requiresGuide: Boolean(mapping.requiresGuide),
      requiresReport: Boolean(mapping.requiresReport),
      requiresSignature: Boolean(mapping.requiresSignature),
      requiresProfessionalRegistry: Boolean(mapping.requiresProfessionalRegistry),
      requiresPatientDocument: Boolean(mapping.requiresPatientDocument),
      useActualDuration: Boolean(mapping.useActualDuration),
      validFrom: mapping.validFrom || "",
      validTo: mapping.validTo || "",
      source: mapping.source || "manual",
      notes: mapping.notes || "",
    });
    payerTussSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const editProcedurePrice = (price: PayerProcedurePrice) => {
    if (!beginEditingSection("price")) return;
    setEditingProcedurePriceId(price.id);
    setProcedurePriceForm({
      serviceCatalogId: price.serviceCatalogId || "",
      tussCodeId: price.tussCodeId || "",
      payerTussMappingId: price.payerTussMappingId || "",
      amountCents: formatCentsForBrazilianInput(price.amountCents),
      currency: price.currency || "BRL",
      validFrom: price.validFrom || "",
      validUntil: price.validUntil || "",
      source: price.source || "manual",
      notes: price.notes || "",
    });
    setProcedurePriceAmountError("");
    payerPricesSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => procedurePriceAmountInputRef.current?.focus(), 250);
  };

  const setTussServiceActive = async (serviceId: string, active: boolean) => {
    if (supportActionInFlightRef.current) return false;
    const actionKey = `service:${serviceId}:${active ? "active" : "inactive"}`;
    const confirmed = window.confirm(active
      ? "Deseja reativar este procedimento? Ele voltará a ficar disponível para novas configurações."
      : "Deseja inativar este procedimento? Ele deixará de ficar disponível para novas configurações.");
    if (!confirmed) return false;
    supportActionInFlightRef.current = true;
    setSupportCatalogOpen(true);
    setSupportActionKey(actionKey);
    setSaving(true);
    setError("");
    setTussActionInfo("");
    try {
      const result = await dataService.updateTussService(serviceId, { active });
      if (!result?.success) {
        setError(result?.error || (active ? "Não foi possível reativar o procedimento agora." : "Não foi possível inativar o procedimento agora."));
        return false;
      }
      setTussServices((current) => current.map((service) => (
        service.id === serviceId ? { ...service, ...(result.data || {}), active } : service
      )));
      if (!active && editingTussServiceId === serviceId) {
        setEditingTussServiceId("");
        setTussServiceForm(defaultTussServiceForm);
      }
      setTussActionInfo(active ? "Procedimento reativado com sucesso." : "Procedimento inativado.");
      return true;
    } finally {
      supportActionInFlightRef.current = false;
      setSaving(false);
      setSupportActionKey("");
    }
  };

  const disableTussService = (serviceId: string) => setTussServiceActive(serviceId, false);

  const reactivateTussService = (serviceId: string) => setTussServiceActive(serviceId, true);

  const setTussCodeActive = async (codeId: string, active: boolean) => {
    if (supportActionInFlightRef.current) return false;
    const actionKey = `code:${codeId}:${active ? "active" : "inactive"}`;
    const confirmed = window.confirm(active
      ? "Deseja reativar este código TUSS? Ele voltará a ficar disponível para novas configurações."
      : "Deseja inativar este código TUSS? Ele deixará de ficar disponível para novas configurações.");
    if (!confirmed) return false;
    supportActionInFlightRef.current = true;
    setSupportCatalogOpen(true);
    setSupportActionKey(actionKey);
    setSaving(true);
    setError("");
    setTussActionInfo("");
    try {
      const result = await dataService.updateTussCode(codeId, { active });
      if (!result?.success) {
        setError(result?.error || (active ? "Não foi possível reativar o código TUSS agora." : "Não foi possível inativar o código TUSS agora."));
        return false;
      }
      setTussCodes((current) => current.map((code) => (
        code.id === codeId ? { ...code, ...(result.data || {}), active } : code
      )));
      if (!active && editingTussCodeId === codeId) {
        setEditingTussCodeId("");
        setTussCodeForm(defaultTussCodeForm);
      }
      setTussActionInfo(active ? "Código TUSS reativado com sucesso." : "Código TUSS inativado.");
      return true;
    } finally {
      supportActionInFlightRef.current = false;
      setSaving(false);
      setSupportActionKey("");
    }
  };

  const disableTussCode = (codeId: string) => setTussCodeActive(codeId, false);

  const reactivateTussCode = (codeId: string) => setTussCodeActive(codeId, true);

  const revalidateAffectedTussMapping = async (mappingId: string) => {
    setSaving(true);
    setError("");
    setTussActionInfo("");
    try {
      const result = await dataService.revalidatePayerTussMapping(mappingId, currentMonthRange());
      if (!result?.success) {
        setError(result?.error || "Não foi possível revalidar os atendimentos afetados agora.");
        return;
      }
      const counts = result.counts || {};
      const affectedItems = Array.isArray(result.affectedItems) ? result.affectedItems : [];
      const found = Number(counts.found || affectedItems.length || 0);
      const resolved = Number(result.updatedCount ?? counts.resolved ?? counts.updated ?? 0);
      setTussActionInfo(`${found} atendimento(s) afetado(s), ${resolved} resolvido(s) para o período atual.`);
    } finally {
      setSaving(false);
    }
  };

  const openAuthorizationSyncModal = async (mapping: PayerTussMapping) => {
    setAuthorizationSyncModal({ mapping, summary: null });
    setAuthorizationSyncLoading(true);
    setError("");
    setTussActionInfo("");
    try {
      const result = await dataService.syncPayerTussMappingAuthorizations(mapping.id, { dryRun: true });
      if (!result?.success) {
        setError(result?.error || "Não foi possível conferir as autorizações afetadas agora.");
        setAuthorizationSyncModal(null);
        return;
      }
      setAuthorizationSyncModal({ mapping, summary: result.data || {} });
    } finally {
      setAuthorizationSyncLoading(false);
    }
  };

  const confirmAuthorizationSync = async () => {
    if (!authorizationSyncModal?.mapping?.id || authorizationSyncLoading) return;
    setAuthorizationSyncLoading(true);
    setError("");
    setTussActionInfo("");
    try {
      const result = await dataService.syncPayerTussMappingAuthorizations(authorizationSyncModal.mapping.id, { dryRun: false });
      if (!result?.success) {
        setError(result?.error || "Não foi possível sincronizar autorizações e Pré-guias agora.");
        return;
      }
      const data = result.data || {};
      setTussActionInfo(
        Number(data.authorizationsUpdated || 0) > 0
          ? `Sincronização concluída: ${Number(data.authorizationsUpdated || 0)} autorização(ões) atualizada(s) e ${Number(data.preGuidesRevalidated || 0)} Pré-guia(s) revalidada(s).`
          : "Todas as autorizações elegíveis já estão sincronizadas."
      );
      setAuthorizationSyncModal(null);
    } finally {
      setAuthorizationSyncLoading(false);
    }
  };

  const disableTussMapping = async (mappingId: string) => {
    const confirmed = window.confirm("Deseja inativar este mapeamento De/Para? Ele deixará de ser usado em novas configurações.");
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setTussActionInfo("");
    try {
      const result = await dataService.updatePayerTussMapping(mappingId, { active: false });
      if (!result?.success) {
        setError(result?.error || "Não foi possível desativar o mapeamento agora.");
        return;
      }
      setTussMappings((current) => current.map((mapping) => (
        mapping.id === mappingId ? { ...mapping, active: false } : mapping
      )));
      if (editingTussMappingId === mappingId) {
        setEditingTussMappingId("");
        setTussMappingForm(defaultTussMappingForm);
      }
      setTussActionInfo("Mapeamento inativado.");
    } finally {
      setSaving(false);
    }
  };

  const disableProcedurePrice = async (priceId: string) => {
    const confirmed = window.confirm("Deseja inativar este valor negociado? Ele deixará de ser usado em novas configurações.");
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setTussActionInfo("");
    try {
      const result = await dataService.updatePayerProcedurePrice(priceId, { active: false });
      if (!result?.success) {
        setError(result?.error || "Não foi possível inativar o valor negociado agora.");
        return;
      }
      setProcedurePrices((current) => current.map((price) => (
        price.id === priceId ? { ...price, active: false } : price
      )));
      if (editingProcedurePriceId === priceId) {
        setEditingProcedurePriceId("");
        setProcedurePriceForm(defaultProcedurePriceForm);
      }
      setTussActionInfo("Valor negociado inativado.");
    } finally {
      setSaving(false);
    }
  };

  const setTussMappingActive = async (mappingId: string, active: boolean) => {
    if (active) {
      const confirmed = window.confirm("Deseja reativar este mapeamento De/Para? Ele voltará a ficar disponível para novas configurações.");
      if (!confirmed) return false;
    }
    setSaving(true);
    setError("");
    setLocalFeedback("mapping", { status: "saving", message: active ? "Reativando De/Para..." : "Inativando De/Para..." });
    try {
      const result = await dataService.updatePayerTussMapping(mappingId, { active });
      if (!result?.success) {
        setError(result?.error || "Não foi possível atualizar o mapeamento agora.");
        setLocalFeedback("mapping", { status: "error", message: "Não foi possível salvar. Revise os campos destacados." });
        return false;
      }
      setTussMappings((current) => current.map((mapping) => (
        mapping.id === mappingId ? { ...mapping, ...(result.data || {}), active } : mapping
      )));
      setLocalFeedback("mapping", { status: "success", message: active ? "Mapeamento reativado com sucesso." : "Mapeamento inativado com sucesso." });
      return true;
    } finally {
      setSaving(false);
    }
  };

  const setProcedurePriceActive = async (priceId: string, active: boolean) => {
    if (active) {
      const confirmed = window.confirm("Deseja reativar este valor negociado? Ele voltará a ficar disponível para novas configurações.");
      if (!confirmed) return false;
    }
    setSaving(true);
    setError("");
    setLocalFeedback("price", { status: "saving", message: active ? "Reativando valor negociado..." : "Inativando valor negociado..." });
    try {
      const result = await dataService.updatePayerProcedurePrice(priceId, { active });
      if (!result?.success) {
        setError(result?.error || "Não foi possível atualizar o valor negociado agora.");
        setLocalFeedback("price", { status: "error", message: "Não foi possível salvar. Revise os campos destacados." });
        return false;
      }
      setProcedurePrices((current) => current.map((price) => (
        price.id === priceId ? { ...price, ...(result.data || {}), active } : price
      )));
      setLocalFeedback("price", { status: "success", message: active ? "Valor negociado reativado com sucesso." : "Valor negociado inativado com sucesso." });
      return true;
    } finally {
      setSaving(false);
    }
  };

  const openDeleteImpactModal = async (entityType: PayerCrudEntityType, id: string, name: string) => {
    setDeleteModal({ entityType, id, name, impact: null, error: "" });
    setDeleteLoading(true);
    setError("");
    try {
      const result = entityType === "requirement"
        ? await dataService.getPayerRequirementDeleteImpact(id)
        : await dataService.getTussDeleteImpact(
            entityType === "service" ? "services" : entityType === "code" ? "codes" : entityType === "mapping" ? "mappings" : "prices",
            id
          );
      if (!result?.success) {
        const modalError = result?.error || "Não foi possível verificar os vínculos deste cadastro.";
        setDeleteModal({ entityType, id, name, impact: null, error: modalError });
        return;
      }
      setDeleteModal({ entityType, id, name, impact: result.data || null, error: "" });
    } finally {
      setDeleteLoading(false);
    }
  };

  const removeDeletedEntityFromState = (entityType: PayerCrudEntityType, id: string) => {
    if (entityType === "requirement") setRequirements((current) => current.filter((item) => item.id !== id));
    if (entityType === "service") setTussServices((current) => current.filter((item) => item.id !== id));
    if (entityType === "code") setTussCodes((current) => current.filter((item) => item.id !== id));
    if (entityType === "mapping") setTussMappings((current) => current.filter((item) => item.id !== id));
    if (entityType === "price") setProcedurePrices((current) => current.filter((item) => item.id !== id));
  };

  const deactivateFromDeleteModal = async () => {
    if (!deleteModal) return;
    if (deleteModal.impact?.isActive === false || deleteModal.impact?.recommendedAction === "keep_inactive") {
      setDeleteModal(null);
      return;
    }
    const { entityType, id } = deleteModal;
    let ok = false;
    if (entityType === "requirement") ok = await setRequirementActive(id, false);
    if (entityType === "service") {
      await setTussServiceActive(id, false);
      ok = true;
    }
    if (entityType === "code") {
      await setTussCodeActive(id, false);
      ok = true;
    }
    if (entityType === "mapping") ok = await setTussMappingActive(id, false);
    if (entityType === "price") ok = await setProcedurePriceActive(id, false);
    if (ok) setDeleteModal(null);
  };

  const confirmDeleteEntity = async () => {
    if (!deleteModal?.impact?.canDelete || deleteLoading) return;
    setDeleteLoading(true);
    setError("");
    try {
      const result = deleteModal.entityType === "requirement"
        ? await dataService.deletePayerRequirement(deleteModal.id)
        : await dataService.deleteTussEntity(
            deleteModal.entityType === "service" ? "services" : deleteModal.entityType === "code" ? "codes" : deleteModal.entityType === "mapping" ? "mappings" : "prices",
            deleteModal.id
          );
      if (!result?.success) {
        setError(result?.error || "Não foi possível excluir o cadastro agora.");
        return;
      }
      removeDeletedEntityFromState(deleteModal.entityType, deleteModal.id);
      setTussActionInfo("Cadastro excluído com segurança.");
      setDeleteModal(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  const formatBillingDate = (value?: string | null) => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
  };

  const renderBillingConfigurationCard = (configuration: BillingConfigurationRow) => {
    const { key, price, mapping, service, code, isOperational } = configuration;
    const validFrom = price?.validFrom || mapping?.validFrom || "";
    const validUntil = price?.validUntil || mapping?.validTo || "";
    const tussCode = code?.code || price?.tussCode || mapping?.tussCode || "";
    const actionMenuOpen = openBillingActionMenuKey === key;
    const inactiveBadges = [
      service?.active !== true ? { key: "procedure_inactive", label: service ? "Procedimento inativo" : "Procedimento ausente" } : null,
      code?.active !== true ? { key: "tuss_inactive", label: code ? "Código TUSS inativo" : "Código TUSS ausente" } : null,
      mapping?.active !== true ? { key: "mapping_inactive", label: mapping ? "De/Para inativo" : "De/Para ausente" } : null,
      price?.active !== true ? { key: "price_inactive", label: price ? "Preço inativo" : "Valor ausente" } : null,
    ].filter(Boolean) as Array<{ key: string; label: string }>;
    return (
      <div key={key} className={`rounded-lg border bg-white p-3 ${isOperational ? "border-emerald-100" : "border-slate-200"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900">{service?.name || price?.serviceName || mapping?.serviceName || mapping?.internalCode || "Procedimento não identificado"}</p>
            <p className="mt-1 text-xs text-slate-600">{[`TUSS ${tussCode || "não informado"}`, price ? formatCurrency(price.amountCents) : "Sem valor negociado"].join(" · ")}</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {validFrom || validUntil
                ? `Vigência: ${formatBillingDate(validFrom) || "sem início"} a ${formatBillingDate(validUntil) || "sem fim"}`
                : "Vigência não informada"}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className={isOperational
                ? "rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700"
                : "rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700"}
              >
                {isOperational ? "Pronta para novas Pré-guias" : "Configuração inativa"}
              </span>
              {!isOperational && inactiveBadges.map((badge) => (
                <span key={badge.key} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  {badge.label}
                </span>
              ))}
            </div>
          </div>
          <div className="relative flex shrink-0 flex-wrap gap-1.5">
            {isOperational && mapping ? <button type="button" onClick={() => editTussMapping(mapping)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-normal text-slate-600 hover:bg-slate-50">Editar De/Para</button> : null}
            {isOperational && price ? <button type="button" onClick={() => editProcedurePrice(price)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-normal text-slate-600 hover:bg-slate-50">Editar valor</button> : null}
            {(mapping || price) ? (
              <button
                type="button"
                aria-expanded={actionMenuOpen}
                onClick={() => setOpenBillingActionMenuKey(actionMenuOpen ? "" : key)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-normal text-slate-600 hover:bg-slate-50"
              >
                Mais ações
              </button>
            ) : null}
            {actionMenuOpen ? (
              <div className="absolute right-0 top-9 z-20 w-64 rounded-xl border border-slate-200 bg-white p-2 text-xs shadow-lg">
                {isOperational && mapping ? <button type="button" onClick={() => { setOpenBillingActionMenuKey(""); void revalidateAffectedTussMapping(mapping.id); }} className="block w-full rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-50">Revalidar atendimentos afetados</button> : null}
                {isOperational && mapping ? <button type="button" onClick={() => { setOpenBillingActionMenuKey(""); void openAuthorizationSyncModal(mapping); }} className="block w-full rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-50">Sincronizar autorizações e Pré-guias</button> : null}
                {isOperational && mapping ? <button type="button" onClick={() => { setOpenBillingActionMenuKey(""); void disableTussMapping(mapping.id); }} className="block w-full rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-50">Inativar De/Para</button> : null}
                {isOperational && price ? <button type="button" onClick={() => { setOpenBillingActionMenuKey(""); void disableProcedurePrice(price.id); }} className="block w-full rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-50">Inativar preço</button> : null}
                {!isOperational && service?.active === false ? <button type="button" onClick={() => { setOpenBillingActionMenuKey(""); void setTussServiceActive(service.id, true); }} className="block w-full rounded-lg px-3 py-2 text-left text-emerald-700 hover:bg-emerald-50">Reativar procedimento</button> : null}
                {!isOperational && code?.active === false ? <button type="button" onClick={() => { setOpenBillingActionMenuKey(""); void setTussCodeActive(code.id, true); }} className="block w-full rounded-lg px-3 py-2 text-left text-emerald-700 hover:bg-emerald-50">Reativar código TUSS</button> : null}
                {!isOperational && mapping?.active === false ? <button type="button" onClick={() => { setOpenBillingActionMenuKey(""); void setTussMappingActive(mapping.id, true); }} className="block w-full rounded-lg px-3 py-2 text-left text-emerald-700 hover:bg-emerald-50">Reativar De/Para</button> : null}
                {!isOperational && price?.active === false ? <button type="button" onClick={() => { setOpenBillingActionMenuKey(""); void setProcedurePriceActive(price.id, true); }} className="block w-full rounded-lg px-3 py-2 text-left text-emerald-700 hover:bg-emerald-50">Reativar preço</button> : null}
                {mapping ? <button type="button" onClick={() => { setOpenBillingActionMenuKey(""); void openDeleteImpactModal("mapping", mapping.id, mapping.contractCode || mapping.serviceName || "Mapeamento De/Para"); }} className="block w-full rounded-lg px-3 py-2 text-left text-rose-700 hover:bg-rose-50">Excluir De/Para</button> : null}
                {price ? <button type="button" onClick={() => { setOpenBillingActionMenuKey(""); void openDeleteImpactModal("price", price.id, price.serviceName || "Valor negociado"); }} className="block w-full rounded-lg px-3 py-2 text-left text-rose-700 hover:bg-rose-50">Excluir preço</button> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className="rounded-3xl border border-slate-100 bg-slate-50/80 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <ShieldCheck size={18} className="text-[#7a32fc]" />
            Configuração de Convênios
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Cadastro avançado de operadoras, regras TISS, De/Para TUSS e tabela negociada por pagador.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPayers()}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Atualizar
        </button>
      </div>

      {error && (
        <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadPayers()}
            className="inline-flex items-center justify-center rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
          >
            Tentar novamente
          </button>
        </div>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(240px,0.9fr)_minmax(0,1.4fr)]">
        <div className="space-y-3">
          <div className="rounded-2xl bg-white p-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Novo convênio / pagador</p>
            <input
              value={payerForm.name}
              onChange={(event) => setPayerForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Unimed, Particular, Cortesia..."
              className="mt-3 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-violet-100"
            />
            <select
              value={payerForm.payerType}
              onChange={(event) => setPayerForm((current) => ({ ...current, payerType: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
            >
              {Object.entries(payerTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button
              type="button"
              onClick={() => void createPayer()}
              disabled={saving || payerForm.name.trim().length < 2}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              <Plus size={15} />
              Adicionar convênio
            </button>
          </div>

          <div className="space-y-2">
            {loading && payers.length === 0 ? (
              <p className="rounded-2xl bg-white p-4 text-sm font-semibold text-slate-500">Carregando convênios...</p>
            ) : payers.length === 0 ? (
              <p className="rounded-2xl bg-white p-4 text-sm font-semibold text-slate-500">Nenhum convênio configurado.</p>
            ) : payers.map((payer) => (
              <button
                key={payer.id}
                type="button"
                onClick={() => setSelectedPayerId(payer.id)}
                className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                  payer.id === selectedPayerId
                    ? "border-violet-200 bg-white text-slate-900 shadow-sm"
                    : "border-transparent bg-white/60 text-slate-600 hover:bg-white"
                }`}
              >
                <span className="block text-sm font-bold">{payer.name}</span>
                <span className="mt-1 block text-xs text-slate-500">{payerTypeLabels[payer.payerType] || "Pagador"} · {payer.status === "ACTIVE" ? "Ativo" : "Inativo"}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-slate-900">{selectedPayer?.name || "Selecione um pagador"}</p>
              <p className="mt-1 text-xs text-slate-500">
                Regra sem tipo de sessão vale para todos os serviços. Uma regra com tipo específico tem prioridade.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className={`rounded-full px-2 py-1 text-xs font-normal ${selectedPayerReadiness.className}`}>
                  {selectedPayerReadiness.label}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{selectedPayerMappingCount} De/Para TUSS</span>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{selectedPayerPriceCount} valor(es) vigentes</span>
                {hasDemoTussData && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
                    <AlertTriangle size={12} />
                    Dados demo/teste
                  </span>
                )}
              </div>
            </div>
            <ClipboardCheck size={18} className="text-slate-400" />
          </div>

          <div ref={payerRulesSectionRef} className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-indigo-500">Configuração do convênio para TISS</p>
                <p className="mt-1 text-xs font-semibold text-slate-600">
                  Dados administrativos, regras e códigos oficiais usados pela Pré-guia e pelo XML TISS.
                </p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-normal ${selectedPayerReadiness.className}`}>
                {selectedPayerReadiness.label}
              </span>
            </div>

            {isInsurancePayer(selectedPayer) ? (
              <>
                {selectedPayerReadiness.issues.length > 0 && (
                  <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    Pontos de atenção: {selectedPayerReadiness.issues.join(", ")}.
                  </div>
                )}
                {payerTissMessage && (
                  <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
                    {payerTissMessage}
                  </div>
                )}
                <p className="mt-4 text-xs font-bold uppercase tracking-widest text-indigo-500">Dados da operadora</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <PayerTissField id="payer-ans-registration" label="Registro ANS da operadora" helperText="Número oficial da operadora na Agência Nacional de Saúde Suplementar.">
                    <input
                      id="payer-ans-registration"
                      aria-describedby="payer-ans-registration-help"
                      value={payerTissForm.ansRegistration}
                      onChange={(event) => updatePayerTiss("ansRegistration", event.target.value)}
                      placeholder="Ex.: 326305"
                      className={payerTissFieldClass}
                    />
                  </PayerTissField>
                  <PayerTissField id="payer-operator-code" label="Código da operadora" helperText="Identificador usado pela clínica quando a operadora exige um código próprio.">
                    <input
                      id="payer-operator-code"
                      aria-describedby="payer-operator-code-help"
                      value={payerTissForm.operatorCode}
                      onChange={(event) => updatePayerTiss("operatorCode", event.target.value)}
                      placeholder="Ex.: AMIL"
                      className={payerTissFieldClass}
                    />
                  </PayerTissField>
                  <PayerTissField id="payer-operator-document" label="CNPJ da operadora" helperText="Documento administrativo da operadora, quando disponível no contrato.">
                    <input
                      id="payer-operator-document"
                      aria-describedby="payer-operator-document-help"
                      value={payerTissForm.operatorDocumentNumber}
                      onChange={(event) => updatePayerTiss("operatorDocumentNumber", event.target.value)}
                      placeholder="Ex.: 12.345.678/0001-95"
                      className={payerTissFieldClass}
                    />
                  </PayerTissField>
                </div>

                <p className="mt-4 text-xs font-bold uppercase tracking-widest text-indigo-500">Dados do prestador no convênio</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <PayerTissField id="payer-beneficiary-identification" label="Tipo de identificação do beneficiário" helperText="Campo usado para validar o paciente nas Pré-guias TISS.">
                    <select
                      id="payer-beneficiary-identification"
                      aria-describedby="payer-beneficiary-identification-help"
                      value={payerTissForm.beneficiaryIdentificationType}
                      onChange={(event) => updatePayerTiss("beneficiaryIdentificationType", event.target.value)}
                      className={payerTissFieldClass}
                    >
                      <option value="card_number">Carteirinha</option>
                      <option value="cpf">CPF</option>
                      <option value="document">Documento</option>
                      <option value="other">Outro</option>
                    </select>
                  </PayerTissField>
                  <PayerTissField id="payer-contracted-provider-code" label="Código do prestador na operadora" helperText="Código pelo qual a clínica é identificada no contrato com este convênio.">
                    <input
                      id="payer-contracted-provider-code"
                      aria-describedby="payer-contracted-provider-code-help"
                      value={payerTissForm.contractedProviderCode}
                      onChange={(event) => updatePayerTiss("contractedProviderCode", event.target.value)}
                      placeholder="Ex.: PRESTADOR123"
                      className={payerTissFieldClass}
                    />
                  </PayerTissField>
                  <PayerTissField id="payer-contracted-executant" label="Nome do prestador no contrato" helperText="Nome, razão social ou contratado executante informado pela operadora.">
                    <input
                      id="payer-contracted-executant"
                      aria-describedby="payer-contracted-executant-help"
                      value={payerTissForm.contractedExecutant}
                      onChange={(event) => updatePayerTiss("contractedExecutant", event.target.value)}
                      placeholder="Ex.: Melhorar Clínica Multidisciplinar"
                      className={payerTissFieldClass}
                    />
                  </PayerTissField>
                  <PayerTissField id="payer-operator-provider-code" label="Código da clínica na operadora" helperText="Use quando a operadora diferencia código da clínica e código do contratado.">
                    <input
                      id="payer-operator-provider-code"
                      aria-describedby="payer-operator-provider-code-help"
                      value={payerTissForm.operatorProviderCode}
                      onChange={(event) => updatePayerTiss("operatorProviderCode", event.target.value)}
                      placeholder="Ex.: CLINICA-001"
                      className={payerTissFieldClass}
                    />
                  </PayerTissField>
                </div>

                <p className="mt-4 text-xs font-bold uppercase tracking-widest text-indigo-500">Configuração automática do XML TISS</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-indigo-100 bg-white px-3 py-3">
                    <p className="text-xs text-slate-500">Versão do XML TISS</p>
                    <p className="mt-1 text-sm text-slate-900">{OFFICIAL_TISS_XML_STRATEGY.communicationVersion}</p>
                    <p className="mt-1 text-[11px] leading-4 text-slate-500">
                      Gerenciada automaticamente pela Verto. A versão é definida pelo gerador oficial e será atualizada somente quando uma nova versão for implementada e validada.
                    </p>
                  </div>
                  <PayerTissField id="payer-default-guide-type" label="Tipo de guia" helperText="Tipo de guia suportado pelo XML oficial gerado pela Verto.">
                    <select
                      id="payer-default-guide-type"
                      aria-describedby="payer-default-guide-type-help"
                      value={payerTissForm.defaultGuideType}
                      onChange={(event) => updatePayerTiss("defaultGuideType", event.target.value)}
                      className={payerTissFieldClass}
                    >
                      <option value="">Selecione</option>
                      {payerTissForm.defaultGuideType && !hasOption(guideTypes040300, payerTissForm.defaultGuideType) && (
                        <option value={payerTissForm.defaultGuideType}>{legacyInvalidLabel(payerTissForm.defaultGuideType)}</option>
                      )}
                      {guideTypes040300.map((option) => (
                        <option key={option.code} value={option.code}>{option.label}</option>
                      ))}
                    </select>
                  </PayerTissField>
                  <PayerTissField id="payer-default-attendance-type" label="Tipo de atendimento padrão" helperText="Código oficial usado na guia SP/SADT. Para terapias, normalmente use a opção compatível com o contrato.">
                    <select
                      id="payer-default-attendance-type"
                      aria-describedby="payer-default-attendance-type-help"
                      value={payerTissForm.defaultAttendanceType}
                      onChange={(event) => updatePayerTiss("defaultAttendanceType", event.target.value)}
                      className={payerTissFieldClass}
                    >
                      <option value="">Selecione</option>
                      {payerTissForm.defaultAttendanceType && !isSupportedAttendanceType040300(payerTissForm.defaultAttendanceType) && (
                        <option value={payerTissForm.defaultAttendanceType}>{legacyInvalidLabel(payerTissForm.defaultAttendanceType)}</option>
                      )}
                      {attendanceTypes040300.map((option) => (
                        <option key={option.code} value={option.code}>{option.code} - {option.label}</option>
                      ))}
                    </select>
                  </PayerTissField>
                  <PayerTissField id="payer-default-attendance-regime" label="Regime de atendimento padrão" helperText="Código oficial de regime de atendimento aceito pelo XML TISS.">
                    <select
                      id="payer-default-attendance-regime"
                      aria-describedby="payer-default-attendance-regime-help"
                      value={payerTissForm.defaultAttendanceRegime}
                      onChange={(event) => updatePayerTiss("defaultAttendanceRegime", event.target.value)}
                      className={payerTissFieldClass}
                    >
                      <option value="">Selecione</option>
                      {payerTissForm.defaultAttendanceRegime && !isSupportedAttendanceRegime040300(payerTissForm.defaultAttendanceRegime) && (
                        <option value={payerTissForm.defaultAttendanceRegime}>{legacyInvalidLabel(payerTissForm.defaultAttendanceRegime)}</option>
                      )}
                      {attendanceRegimes040300.map((option) => (
                        <option key={option.code} value={option.code}>{option.code} - {option.label}</option>
                      ))}
                    </select>
                  </PayerTissField>
                  <PayerTissField id="payer-default-attendance-character" label="Caráter de atendimento padrão" helperText="Código oficial que informa se o atendimento é eletivo ou de urgência/emergência.">
                    <select
                      id="payer-default-attendance-character"
                      aria-describedby="payer-default-attendance-character-help"
                      value={payerTissForm.defaultAttendanceCharacter}
                      onChange={(event) => updatePayerTiss("defaultAttendanceCharacter", event.target.value)}
                      className={payerTissFieldClass}
                    >
                      <option value="">Selecione</option>
                      {payerTissForm.defaultAttendanceCharacter && !isSupportedAttendanceCharacter040300(payerTissForm.defaultAttendanceCharacter) && (
                        <option value={payerTissForm.defaultAttendanceCharacter}>{legacyInvalidLabel(payerTissForm.defaultAttendanceCharacter)}</option>
                      )}
                      {attendanceCharacters040300.map((option) => (
                        <option key={option.code} value={option.code}>{option.code} - {option.label}</option>
                      ))}
                    </select>
                  </PayerTissField>
                </div>
                <p className="mt-4 text-xs font-bold uppercase tracking-widest text-indigo-500">Exigências gerais da operadora</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[
                    ["requiresBeneficiaryCard", "Exige carteirinha"],
                    ["requiresBeneficiaryCardValidity", "Exige validade da carteirinha"],
                    ["requiresAuthorization", "Exige autorização prévia"],
                    ["requiresAuthorizedProcedure", "Exige procedimento autorizado"],
                    ["requiresAuthorizationPassword", "Exige senha/autorização"],
                    ["requiresGuideNumber", "Exige número de guia"],
                    ["requiresCid", "Exige CID"],
                    ["requiresExecutantRegistry", "Exige conselho do executante"],
                    ["requiresCbo", "Exige CBO"],
                    ["requiresCnes", "Exige CNES do prestador"],
                    ["requiresProviderCode", "Exige código do prestador"],
                    ["requiresResponsibleSignature", "Exige assinatura do responsável"],
                    ["requiresPhysicalGuide", "Exige guia física impressa"],
                    ["requiresSignedGuide", "Exige guia assinada"],
                    ["requiresStampedDatedGuide", "Exige guia carimbada/datada"],
                    ["requiresAdministrativeReport", "Exige relatório/evolução administrativa"],
                    ["allowsMixedMultidisciplinaryGuide", "Permite guia mista multidisciplinar"],
                    ["requiresSeparateGuideBySpecialty", "Exige guia segregada por especialidade"],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm font-normal text-slate-700">
                      <input
                        type="checkbox"
                        checked={Boolean((payerTissForm as any)[key])}
                        onChange={(event) => updatePayerTiss(key as keyof PayerTissForm, event.target.checked)}
                        className="h-4 w-4 accent-[#7a32fc]"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="mt-4 text-xs font-bold uppercase tracking-widest text-indigo-500">Contatos e observações administrativas</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <PayerTissField id="payer-auditor-contact" label="Contato do auditor/operadora" helperText="Pessoa ou setor de referência para dúvidas administrativas do convênio.">
                    <input
                      id="payer-auditor-contact"
                      aria-describedby="payer-auditor-contact-help"
                      value={payerTissForm.auditorContactName}
                      onChange={(event) => updatePayerTiss("auditorContactName", event.target.value)}
                      placeholder="Ex.: Auditoria Amil"
                      className={payerTissFieldClass}
                    />
                  </PayerTissField>
                  <PayerTissField id="payer-billing-email" label="E-mail de faturamento" helperText="E-mail usado para contato administrativo com a operadora, quando houver.">
                    <input
                      id="payer-billing-email"
                      aria-describedby="payer-billing-email-help"
                      value={payerTissForm.billingEmail}
                      onChange={(event) => updatePayerTiss("billingEmail", event.target.value)}
                      placeholder="Ex.: faturamento@operadora.com.br"
                      className={payerTissFieldClass}
                    />
                  </PayerTissField>
                  <PayerTissField id="payer-billing-phone" label="Telefone/WhatsApp administrativo" helperText="Contato administrativo do convênio ou portal de faturamento.">
                    <input
                      id="payer-billing-phone"
                      aria-describedby="payer-billing-phone-help"
                      value={payerTissForm.billingPhone}
                      onChange={(event) => updatePayerTiss("billingPhone", event.target.value)}
                      placeholder="Ex.: (11) 99999-9999"
                      className={payerTissFieldClass}
                    />
                  </PayerTissField>
                  <PayerTissField id="payer-operator-portal" label="Portal da operadora" helperText="Endereço do portal usado para conferência ou envio manual, se existir.">
                    <input
                      id="payer-operator-portal"
                      aria-describedby="payer-operator-portal-help"
                      value={payerTissForm.operatorPortalUrl}
                      onChange={(event) => updatePayerTiss("operatorPortalUrl", event.target.value)}
                      placeholder="Ex.: https://portal.operadora.com.br"
                      className={payerTissFieldClass}
                    />
                  </PayerTissField>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <PayerTissField id="payer-administrative-notes" label="Observações administrativas" helperText="Informações sobre portal, contato, envio manual ou operação administrativa.">
                    <textarea
                      id="payer-administrative-notes"
                      aria-describedby="payer-administrative-notes-help"
                      value={payerTissForm.administrativeNotes}
                      onChange={(event) => updatePayerTiss("administrativeNotes", event.target.value)}
                      placeholder="Ex.: faturamento enviado pelo portal até o 5º dia útil"
                      className={`${payerTissFieldClass} min-h-[72px]`}
                    />
                  </PayerTissField>
                  <PayerTissField id="payer-specific-rules" label="Regras específicas do convênio" helperText="Regras combinadas com a operadora que ajudam a evitar pendências na Pré-guia.">
                    <textarea
                      id="payer-specific-rules"
                      aria-describedby="payer-specific-rules-help"
                      value={payerTissForm.specificRules}
                      onChange={(event) => updatePayerTiss("specificRules", event.target.value)}
                      placeholder="Ex.: exige autorização ativa e guia assinada"
                      className={`${payerTissFieldClass} min-h-[72px]`}
                    />
                  </PayerTissField>
                </div>
                <button
                  type="button"
                  disabled={!selectedPayerId || saving || payerTissLoading}
                  onClick={() => void savePayerTissProfile()}
                  className="mt-3 inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
                >
                  {saving || payerTissLoading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  Salvar dados TISS da operadora
                </button>
              </>
            ) : (
              <p className="mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                Este pagador não é convênio/plano de saúde. A Pré-guia TISS permanece não aplicável e não exige configuração TISS.
              </p>
            )}
          </div>

          <details className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/50 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">Exceções por serviço</summary>
            <p className="mt-2 text-xs text-slate-500">
              Use somente quando um procedimento possuir exigências diferentes das regras gerais da operadora.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              A exceção substitui a regra geral apenas para este serviço.
            </p>
            <SectionFeedbackMessage feedback={sectionFeedback.requirements} />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-bold text-slate-600">
              Tipo de sessão
              <input
                value={requirementForm.serviceType}
                onChange={(event) => setRequirementForm((current) => ({ ...current, serviceType: event.target.value }))}
                placeholder="ABA, Fono, TO ou vazio"
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Duração mínima
              <input
                type="number"
                min="1"
                value={requirementForm.minDurationMinutes}
                onChange={(event) => setRequirementForm((current) => ({ ...current, minDurationMinutes: event.target.value }))}
                placeholder="45"
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
            </label>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {[
              ["requireSignature", "Assinatura obrigatória"],
              ["requireReport", "Relatório/evolução"],
              ["requireActualDuration", "Duração real"],
              ["requireGuide", "Guia"],
              ["requireAuthorization", "Autorização/senha"],
              ["requireProfessionalRegistry", "Registro profissional"],
              ["requirePatientDocument", "Documento do paciente"],
              ["allowManualOverride", "Permitir override"],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 rounded-2xl border border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean((requirementForm as any)[key])}
                  onChange={() => toggleRequirementFlag(key)}
                  className="h-4 w-4 accent-[#7a32fc]"
                />
                {label}
              </label>
            ))}
          </div>

          <button
            type="button"
            disabled={!selectedPayerId || saving}
            onClick={() => void saveRequirement()}
            className="mt-4 inline-flex items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Salvar regra
          </button>

          <div className="mt-5 space-y-2">
            {requirements.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">Nenhuma regra ativa para este pagador.</p>
            ) : requirements.map((rule) => (
              <div key={rule.id} className="rounded-2xl border border-slate-100 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-bold text-slate-800">
                      <CheckCircle2 size={15} className="text-emerald-600" />
                      {rule.serviceType || "Todos os serviços"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {[
                        rule.requireSignature && "assinatura",
                        rule.requireReport && "relatório",
                        rule.requireGuide && "guia",
                        rule.requireAuthorization && "autorização",
                        rule.minDurationMinutes && `mín. ${rule.minDurationMinutes} min`,
                      ].filter(Boolean).join(" · ") || "Sem exigências adicionais"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {rule.isActive !== false ? (
                      <button type="button" onClick={() => void setRequirementActive(rule.id, false)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-normal text-slate-500 hover:bg-slate-50">Inativar</button>
                    ) : (
                      <button type="button" onClick={() => void setRequirementActive(rule.id, true)} className="rounded-xl border border-emerald-200 px-3 py-1.5 text-xs font-normal text-emerald-700 hover:bg-emerald-50">Reativar</button>
                    )}
                    <button type="button" onClick={() => void openDeleteImpactModal("requirement", rule.id, rule.serviceType || "Todos os serviços")} className="rounded-xl border border-rose-100 px-3 py-1.5 text-xs font-normal text-rose-700 hover:bg-rose-50">Excluir</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          </details>
        </div>
      </div>

      <div ref={payerTussSectionRef} className="mt-5 rounded-2xl bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-bold text-slate-900">De/Para TUSS por Convênio</p>
            <p className="mt-1 text-xs text-slate-500">Configure catálogo interno, códigos usados pela clínica, mapeamento por pagador e valores negociados para pré-faturamento.</p>
          </div>
          <button
            type="button"
            onClick={() => void loadTussConfig(selectedPayerId)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600"
          >
            {tussLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Atualizar base
          </button>
        </div>
        {tussActionInfo && (
          <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
            {tussActionInfo}
          </div>
        )}

        {supportFormOpen && supportFormTarget ? (
          <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/50 p-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                {supportFormTarget === "service"
                  ? editingTussServiceId ? "Editando procedimento interno" : "Novo procedimento interno"
                  : editingTussCodeId ? "Editando código TUSS" : "Novo código TUSS"}
              </h3>
              <p className="mt-1 text-xs text-slate-500">Este cadastro cria somente a referência selecionada. De/Para e preço são configurados separadamente.</p>
            </div>
            <div className="mt-3">
          {supportFormTarget === "service" ? (
          <div ref={tussServiceFormRef} className="rounded-2xl border border-slate-100 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{editingTussServiceId ? "Editando procedimento interno" : "Novo procedimento interno"}</p>
            {editingTussServiceId && (
              <p className="mt-1 text-xs text-slate-500">Atualize somente os dados do procedimento interno selecionado.</p>
            )}
            <SectionFeedbackMessage feedback={sectionFeedback.service} />
            <label htmlFor="support-service-name" className="mt-3 block text-xs font-normal text-slate-700">Nome do procedimento interno</label>
            <input
              id="support-service-name"
              ref={tussServiceNameInputRef}
              value={tussServiceForm.name}
              onChange={(event) => setTussServiceForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Sessão ABA individual"
              className="mt-3 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
            />
            <label htmlFor="support-service-description" className="mt-2 block text-xs font-normal text-slate-700">Descrição</label>
            <textarea
              id="support-service-description"
              value={tussServiceForm.description}
              onChange={(event) => setTussServiceForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Descrição do procedimento interno"
              className="mt-2 min-h-[72px] w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
            />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label htmlFor="support-service-internal-code" className="block text-xs font-normal text-slate-700">
              Código interno
              <input
                id="support-service-internal-code"
                value={tussServiceForm.internalCode}
                onChange={(event) => setTussServiceForm((current) => ({ ...current, internalCode: event.target.value }))}
                placeholder="Código interno"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
              </label>
              <label htmlFor="support-service-specialty" className="block text-xs font-normal text-slate-700">
              Especialidade
              <input
                id="support-service-specialty"
                value={tussServiceForm.specialty}
                onChange={(event) => setTussServiceForm((current) => ({ ...current, specialty: event.target.value }))}
                placeholder="Especialidade"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
              </label>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label htmlFor="support-service-type" className="block text-xs font-normal text-slate-700">
              Tipo de sessão
              <input
                id="support-service-type"
                value={tussServiceForm.serviceType}
                onChange={(event) => setTussServiceForm((current) => ({ ...current, serviceType: event.target.value }))}
                placeholder="Tipo de sessão"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
              </label>
              <label htmlFor="support-service-duration" className="block text-xs font-normal text-slate-700">
              Duração padrão (min)
              <input
                id="support-service-duration"
                type="number"
                min="1"
                value={tussServiceForm.defaultDurationMinutes}
                onChange={(event) => setTussServiceForm((current) => ({ ...current, defaultDurationMinutes: event.target.value }))}
                placeholder="Duração padrão (min)"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
              </label>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label htmlFor="support-service-billing-unit" className="block text-xs font-normal text-slate-700">
              Unidade
              <select
                id="support-service-billing-unit"
                value={tussServiceForm.billingUnit}
                onChange={(event) => setTussServiceForm((current) => ({ ...current, billingUnit: event.target.value }))}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              >
                <option value="session">Sessão</option>
                <option value="hour">Hora</option>
                <option value="minute">Minuto</option>
                <option value="unit">Unidade</option>
                <option value="package">Pacote</option>
              </select>
              </label>
              <label htmlFor="support-service-default-quantity" className="block text-xs font-normal text-slate-700">
              Quantidade padrão
              <input
                id="support-service-default-quantity"
                type="number"
                min="0.01"
                step="0.01"
                value={tussServiceForm.defaultQuantity}
                onChange={(event) => setTussServiceForm((current) => ({ ...current, defaultQuantity: event.target.value }))}
                placeholder="Quantidade padrão"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
              </label>
            </div>
            <div className="mt-2">
              <label htmlFor="support-service-default-amount" className="block text-xs font-normal text-slate-700">
              Valor padrão interno — não utilizado como preço do convênio
              <input
                id="support-service-default-amount"
                inputMode="decimal"
                value={tussServiceForm.defaultAmountCents}
                onChange={(event) => setTussServiceForm((current) => ({ ...current, defaultAmountCents: event.target.value }))}
                placeholder="Valor padrão. Ex.: 120,00"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
              </label>
            </div>
            <SectionFormActions
              status={sectionFeedback.service?.status || "idle"}
              primaryLabel={editingTussServiceId ? "Atualizar cadastro" : "Salvar cadastro"}
              disabled={saving || tussServiceForm.name.trim().length < 2}
              onCancel={() => cancelSupportForm("service")}
              onSubmit={() => void createTussService()}
            />
          </div>
          ) : null}

          {supportFormTarget === "code" ? (
          <div ref={tussCodeFormRef} className="rounded-2xl border border-slate-100 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{editingTussCodeId ? "Editando código TUSS" : "Novo código TUSS"}</p>
            {editingTussCodeId && (
              <p className="mt-1 text-xs text-slate-500">Atualize somente os dados do código TUSS selecionado.</p>
            )}
            <SectionFeedbackMessage feedback={sectionFeedback.code} />
            <label htmlFor="support-tuss-code" className="mt-3 block text-xs font-normal text-slate-700">Código TUSS</label>
            <input
              id="support-tuss-code"
              ref={tussCodeInputRef}
              value={tussCodeForm.code}
              onChange={(event) => setTussCodeForm((current) => ({ ...current, code: event.target.value }))}
              placeholder="Código"
              className="mt-3 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
            />
            <label htmlFor="support-tuss-description" className="mt-2 block text-xs font-normal text-slate-700">Descrição TUSS</label>
            <input
              id="support-tuss-description"
              value={tussCodeForm.description}
              onChange={(event) => setTussCodeForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Descrição controlada"
              className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
            />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label htmlFor="support-tuss-term-type" className="block text-xs font-normal text-slate-700">
              Tipo de termo
              <input
                id="support-tuss-term-type"
                value={tussCodeForm.termType}
                onChange={(event) => setTussCodeForm((current) => ({ ...current, termType: event.target.value }))}
                placeholder="Tipo de termo"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
              </label>
              <label htmlFor="support-tuss-version" className="block text-xs font-normal text-slate-700">
              Versão/tabela
              <input
                id="support-tuss-version"
                value={tussCodeForm.version}
                onChange={(event) => setTussCodeForm((current) => ({ ...current, version: event.target.value }))}
                placeholder="Versão/tabela"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
              </label>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label htmlFor="support-tuss-valid-from" className="block text-xs font-normal text-slate-700">
              Início da vigência
              <input
                id="support-tuss-valid-from"
                type="date"
                value={tussCodeForm.validFrom}
                onChange={(event) => setTussCodeForm((current) => ({ ...current, validFrom: event.target.value }))}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
              </label>
              <label htmlFor="support-tuss-valid-to" className="block text-xs font-normal text-slate-700">
              Fim da vigência
              <input
                id="support-tuss-valid-to"
                type="date"
                value={tussCodeForm.validTo}
                onChange={(event) => setTussCodeForm((current) => ({ ...current, validTo: event.target.value }))}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
              </label>
            </div>
            <SectionFormActions
              status={sectionFeedback.code?.status || "idle"}
              primaryLabel={editingTussCodeId ? "Atualizar cadastro" : "Salvar cadastro"}
              disabled={saving || tussCodeForm.code.trim().length < 2 || tussCodeForm.description.trim().length < 2}
              onCancel={() => cancelSupportForm("code")}
              onSubmit={() => void createTussCode()}
            />
          </div>
          ) : null}
            </div>
          </div>
        ) : null}

          <div className="mt-4 rounded-2xl border border-slate-100 p-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Mapeamento por pagador</p>
            <p className="mt-1 text-xs text-slate-500">
              O De/Para define o vínculo contratual entre o procedimento interno e o código TUSS. O preço operacional fica apenas em Tabela de procedimentos e valores.
            </p>
            <SectionFeedbackMessage feedback={sectionFeedback.mapping} />
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label htmlFor="payer-mapping-service" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Procedimento interno</span>
                <select
                  id="payer-mapping-service"
                  value={tussMappingForm.serviceCatalogId}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, serviceCatalogId: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                >
                  <option value="">Selecione o procedimento</option>
                  {tussServices.filter((service) => service.active === true || service.id === tussMappingForm.serviceCatalogId).map((service) => <option key={service.id} value={service.id}>{service.name}{service.active !== true ? " (inativo)" : ""}</option>)}
                </select>
              </label>
              <label htmlFor="payer-mapping-tuss-code" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Código TUSS</span>
                <select
                  id="payer-mapping-tuss-code"
                  value={tussMappingForm.tussCodeId}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, tussCodeId: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                >
                  <option value="">Selecione o código TUSS</option>
                  {tussCodes.filter((code) => code.active === true || code.id === tussMappingForm.tussCodeId).map((code) => <option key={code.id} value={code.id}>{code.code} - {code.description}{code.active !== true ? " (inativo)" : ""}</option>)}
                </select>
              </label>
              <label htmlFor="payer-mapping-contract-code" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Código contratual do pagador</span>
                <input
                  id="payer-mapping-contract-code"
                  value={tussMappingForm.contractCode}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, contractCode: event.target.value }))}
                  placeholder="Ex.: ABA-IND-CONTRATO"
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label htmlFor="payer-mapping-specialty" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Especialidade</span>
                <input
                  id="payer-mapping-specialty"
                  value={tussMappingForm.specialty}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, specialty: event.target.value }))}
                  placeholder="Ex.: ABA"
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label htmlFor="payer-mapping-contract-description" className="text-xs font-normal text-slate-700 md:col-span-2">
                <span className="mb-1 block">Descrição contratual do pagador</span>
                <textarea
                  id="payer-mapping-contract-description"
                  value={tussMappingForm.contractDescription}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, contractDescription: event.target.value }))}
                  placeholder="Ex.: descrição usada no contrato da operadora"
                  className="min-h-[64px] w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label htmlFor="payer-mapping-guide-type" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Tipo de guia</span>
                <select
                  id="payer-mapping-guide-type"
                  value={tussMappingForm.guideType}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, guideType: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                >
                  <option value="">Selecione</option>
                  {tussMappingForm.guideType && !hasOption(guideTypes040300, tussMappingForm.guideType) && (
                    <option value={tussMappingForm.guideType}>{legacyInvalidLabel(tussMappingForm.guideType)}</option>
                  )}
                  {guideTypes040300.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
                </select>
              </label>
              <label htmlFor="payer-mapping-billing-unit" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Unidade de cobrança</span>
                <select
                  id="payer-mapping-billing-unit"
                  value={tussMappingForm.billingUnit}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, billingUnit: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                >
                  <option value="session">Sessão</option>
                  <option value="hour">Hora</option>
                  <option value="minute">Minuto</option>
                  <option value="unit">Unidade</option>
                  <option value="package">Pacote</option>
                </select>
              </label>
              <label htmlFor="payer-mapping-quantity-rule" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Forma de cobrança</span>
                <select
                  id="payer-mapping-quantity-rule"
                  value={tussMappingForm.quantityRule}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, quantityRule: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                >
                  <option value="per_session">Por sessão</option>
                  <option value="per_hour">Por hora</option>
                  <option value="duration_based">Por duração</option>
                  <option value="fixed">Fixo</option>
                </select>
              </label>
              <label htmlFor="payer-mapping-default-quantity" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Quantidade padrão</span>
                <input
                  id="payer-mapping-default-quantity"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={tussMappingForm.defaultQuantity}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, defaultQuantity: event.target.value }))}
                  placeholder="Ex.: 1"
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label htmlFor="payer-mapping-valid-from" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Início da vigência</span>
                <input
                  id="payer-mapping-valid-from"
                  type="date"
                  value={tussMappingForm.validFrom}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, validFrom: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label htmlFor="payer-mapping-valid-to" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Fim da vigência</span>
                <input
                  id="payer-mapping-valid-to"
                  type="date"
                  value={tussMappingForm.validTo}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, validTo: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label htmlFor="payer-mapping-duration" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Duração padrão</span>
                <input
                  id="payer-mapping-duration"
                  type="number"
                  min="1"
                  value={tussMappingForm.standardDurationMinutes}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, standardDurationMinutes: event.target.value }))}
                  placeholder="Ex.: 50"
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label htmlFor="payer-mapping-source" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Origem do mapeamento</span>
                <select
                  id="payer-mapping-source"
                  value={tussMappingForm.source}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, source: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                >
                  <option value="manual">Manual</option>
                  <option value="imported">Importado</option>
                  <option value="demo">Demo/teste</option>
                  <option value="payer_contract">Contrato do pagador</option>
                </select>
              </label>
              <label htmlFor="payer-mapping-notes" className="text-xs font-normal text-slate-700 md:col-span-2">
                <span className="mb-1 block">Observações administrativas</span>
                <input
                  id="payer-mapping-notes"
                  value={tussMappingForm.notes}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Ex.: regra contratual combinada com a operadora"
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
            </div>
            {(tussMappingForm.amountCents || tussMappingForm.negotiatedAmountCents) && (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="font-semibold">Dados financeiros legados do De/Para</p>
                <p className="mt-1">
                  Valor legado: {tussMappingForm.amountCents || "Não informado"} · Valor negociado legado: {tussMappingForm.negotiatedAmountCents || "Não informado"}
                </p>
                <p className="mt-1 text-amber-800">
                  Mantidos apenas para compatibilidade histórica. O preço utilizado atualmente vem de Valores negociados.
                </p>
              </div>
            )}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {[
                ["requiresAuthorization", "Autorização"],
                ["requiresGuide", "Guia"],
                ["requiresSignature", "Assinatura"],
                ["requiresReport", "Relatório"],
                ["requiresProfessionalRegistry", "Registro"],
                ["requiresPatientDocument", "Carteirinha"],
                ["useActualDuration", "Duração real"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 rounded-2xl border border-slate-100 px-3 py-2 text-xs font-normal text-slate-600">
                  <input
                    type="checkbox"
                    checked={Boolean((tussMappingForm as any)[key])}
                    onChange={() => setTussMappingForm((current: any) => ({ ...current, [key]: !current[key] }))}
                    className="h-4 w-4 accent-[#7a32fc]"
                  />
                  {label}
                </label>
              ))}
            </div>
            {editingTussMappingId && (
              <button
                type="button"
                onClick={() => { setEditingTussMappingId(""); setTussMappingForm(defaultTussMappingForm); }}
                className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500"
              >
                Cancelar edição
              </button>
            )}
            <button
              type="button"
              onClick={() => void createTussMapping()}
              disabled={!selectedPayerId || !tussMappingForm.serviceCatalogId || saving}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {editingTussMappingId ? "Atualizar mapeamento" : "Salvar mapeamento"}
            </button>
          </div>

        <div ref={payerPricesSectionRef} className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <FileSpreadsheet size={16} className="text-emerald-600" />
                Tabela de procedimentos e valores
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Valores negociados por convênio, procedimento, TUSS e vigência. A Pré-guia captura snapshot do valor vigente na data do atendimento.
              </p>
            </div>
            <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-emerald-700">
              {selectedPayerPriceCount} valor(es) ativo(s)
            </span>
          </div>

          {editingProcedurePriceId && <p className="mt-3 text-xs text-emerald-800">Editando uma configuração existente. Salvar atualizará somente este valor negociado.</p>}
          <SectionFeedbackMessage feedback={sectionFeedback.price} />
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <label htmlFor="payer-price-service" className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Procedimento interno</span>
              <select id="payer-price-service" value={procedurePriceForm.serviceCatalogId} onChange={(event) => setProcedurePriceForm((current) => ({ ...current, serviceCatalogId: event.target.value }))} className="w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                <option value="">Selecione o procedimento</option>
                {tussServices.filter((service) => service.active === true || service.id === procedurePriceForm.serviceCatalogId).map((service) => <option key={service.id} value={service.id}>{service.name}{service.active !== true ? " (inativo)" : ""}</option>)}
              </select>
            </label>
            <label htmlFor="payer-price-tuss" className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Código TUSS</span>
              <select id="payer-price-tuss" value={procedurePriceForm.tussCodeId} onChange={(event) => setProcedurePriceForm((current) => ({ ...current, tussCodeId: event.target.value }))} className="w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                <option value="">Selecione o código TUSS</option>
                {tussCodes.filter((code) => code.active === true || code.id === procedurePriceForm.tussCodeId).map((code) => <option key={code.id} value={code.id}>{code.code} - {code.description}{code.active !== true ? " (inativo)" : ""}</option>)}
              </select>
            </label>
            <label htmlFor="payer-price-amount" className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Valor negociado (R$)</span>
              <input ref={procedurePriceAmountInputRef} id="payer-price-amount" inputMode="decimal" value={procedurePriceForm.amountCents} onChange={(event) => { setProcedurePriceForm((current) => ({ ...current, amountCents: event.target.value })); setProcedurePriceAmountError(""); }} placeholder="Ex.: 120,00" aria-describedby={procedurePriceAmountError ? "payer-price-amount-error" : "payer-price-amount-help"} aria-invalid={Boolean(procedurePriceAmountError)} className="w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
              <span id="payer-price-amount-help" className="mt-1 block text-xs text-slate-500">Informe o valor em reais, com até duas casas decimais.</span>
              {procedurePriceAmountError && <span id="payer-price-amount-error" className="mt-1 block text-xs text-rose-600">{procedurePriceAmountError}</span>}
            </label>
            <label htmlFor="payer-price-source" className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Origem do valor</span>
              <select id="payer-price-source" value={procedurePriceForm.source} onChange={(event) => setProcedurePriceForm((current) => ({ ...current, source: event.target.value }))} className="w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                <option value="manual">Manual</option><option value="imported">Importado</option><option value="demo">Demo/teste</option><option value="payer_contract">Contrato do pagador</option>
              </select>
            </label>
            <label htmlFor="payer-price-mapping" className="text-xs font-normal text-slate-700 lg:col-span-2">
              <span className="mb-1 block">Vínculo De/Para</span>
              <select id="payer-price-mapping" value={procedurePriceForm.payerTussMappingId} onChange={(event) => setProcedurePriceForm((current) => ({ ...current, payerTussMappingId: event.target.value }))} className="w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                <option value="">Sem vínculo De/Para</option>
                {tussMappings.filter((mapping) => mapping.active === true || mapping.id === procedurePriceForm.payerTussMappingId).map((mapping) => <option key={mapping.id} value={mapping.id}>{mapping.serviceName || mapping.internalCode || "Procedimento"} {mapping.tussCode ? `· TUSS ${mapping.tussCode}` : ""}{mapping.active !== true ? " (inativo)" : ""}</option>)}
              </select>
            </label>
            <label htmlFor="payer-price-valid-from" className="text-xs font-normal text-slate-700"><span className="mb-1 block">Início da vigência</span><input id="payer-price-valid-from" type="date" value={procedurePriceForm.validFrom} onChange={(event) => setProcedurePriceForm((current) => ({ ...current, validFrom: event.target.value }))} className="w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" /></label>
            <label htmlFor="payer-price-valid-until" className="text-xs font-normal text-slate-700"><span className="mb-1 block">Fim da vigência</span><input id="payer-price-valid-until" type="date" value={procedurePriceForm.validUntil} onChange={(event) => setProcedurePriceForm((current) => ({ ...current, validUntil: event.target.value }))} className="w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" /></label>
            <label htmlFor="payer-price-notes" className="text-xs font-normal text-slate-700 lg:col-span-2"><span className="mb-1 block">Observações</span><input id="payer-price-notes" value={procedurePriceForm.notes} onChange={(event) => setProcedurePriceForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Ex.: valor definido no contrato de junho de 2026" className="w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" /></label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {editingProcedurePriceId && (
              <button
                type="button"
                onClick={() => { setEditingProcedurePriceId(""); setProcedurePriceForm(defaultProcedurePriceForm); setProcedurePriceAmountError(""); }}
                className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-normal text-slate-600"
              >
                Cancelar edição
              </button>
            )}
            <button
              type="button"
              onClick={() => void saveProcedurePrice()}
              disabled={!selectedPayerId || !procedurePriceForm.serviceCatalogId || procedurePriceForm.amountCents === "" || saving}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-normal text-white disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {editingProcedurePriceId ? "Atualizar valor negociado" : "Salvar valor negociado"}
            </button>
          </div>

          <div className="mt-3 rounded-2xl border border-dashed border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
            Importar tabela: estrutura preparada para CSV/XLSX em ciclo futuro. Neste ciclo, o cadastro manual é a fonte auditável.
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/30 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Configurações ativas deste convênio</h3>
              <p className="mt-1 text-xs text-slate-500">Usadas para novas Pré-guias, autorizações e geração de XML.</p>
            </div>
            <span className="text-xs text-slate-500">{activeBillingConfigurations.length} ativa(s)</span>
          </div>
          <div className="mt-3 space-y-2">
            {activeBillingConfigurations.length > 0 ? activeBillingConfigurations.map(renderBillingConfigurationCard) : (
              <div className="rounded-xl border border-amber-100 bg-white p-4">
                <p className="text-sm text-slate-800">Nenhuma configuração ativa para este convênio.</p>
                <p className="mt-1 text-xs text-slate-500">Crie ou reative os cadastros necessários para faturar novas sessões.</p>
                <div className="mt-3 rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-600">Para faturar novas sessões, siga estes passos:</p>
                  <ol className="mt-2 space-y-1 text-xs text-slate-500">
                    <li>1. Crie ou escolha um procedimento interno ativo.</li>
                    <li>2. Crie ou escolha um código TUSS ativo.</li>
                    <li>3. Crie o De/Para entre procedimento e TUSS.</li>
                    <li>4. Cadastre o valor negociado.</li>
                  </ol>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => startNewSupportForm("service")} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-normal text-white"><Plus size={14} />Novo procedimento interno</button>
                    <button type="button" onClick={() => startNewSupportForm("code")} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-normal text-slate-700"><Plus size={14} />Novo código TUSS</button>
                    <button type="button" onClick={() => startNewBillingConfigurationPart("mapping")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-normal text-slate-700">Novo De/Para</button>
                    <button type="button" onClick={() => startNewBillingConfigurationPart("price")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-normal text-slate-700">Novo valor negociado</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Histórico e configurações inativas</h3>
              <p className="mt-1 text-xs text-slate-500">Registros preservados para histórico. Não são usados em novas Pré-guias enquanto estiverem inativos.</p>
            </div>
            <span className="text-xs text-slate-500">{inactiveBillingConfigurations.length} inativa(s)</span>
          </div>
          <div className="mt-3 space-y-2">
            {inactiveBillingConfigurations.length > 0
              ? inactiveBillingConfigurations.map(renderBillingConfigurationCard)
              : <p className="rounded-lg bg-white p-3 text-sm text-slate-500">Nenhuma configuração inativa preservada.</p>}
          </div>
        </div>

        <section className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Cadastros de apoio</h3>
              <p className="mt-1 text-xs text-slate-500">Esses cadastros são referências usadas nas configurações de faturamento e não representam cobranças duplicadas.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => startNewSupportForm("service")} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-normal text-white"><Plus size={14} />Novo procedimento interno</button>
              <button type="button" onClick={() => startNewSupportForm("code")} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-normal text-slate-700"><Plus size={14} />Novo código TUSS</button>
              <button type="button" aria-expanded={supportCatalogOpen} onClick={() => setSupportCatalogOpen((current) => !current)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-normal text-slate-600">
                {supportCatalogOpen ? "Ocultar cadastros" : "Ver cadastros"}
              </button>
            </div>
          </div>
          {supportCatalogOpen ? (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-100 bg-white p-3">
              <p className="text-xs font-medium text-slate-700">Catálogo de procedimentos internos</p>
              <p className="mt-1 text-xs text-slate-500">{activeTussServices.length} ativo(s) · {tussServices.length - activeTussServices.length} inativo(s)</p>
              <div className="mt-2 space-y-2">
                {tussServices.length === 0 ? <p className="text-xs text-slate-500">Nenhum procedimento de referência cadastrado.</p> : tussServices.slice(0, 12).map((service) => {
                  const serviceActionKey = `service:${service.id}:${service.active === false ? "active" : "inactive"}`;
                  const serviceActionLoading = supportActionKey === serviceActionKey;
                  return (
                    <div key={service.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
                      <div><p className="text-sm font-medium text-slate-800">{service.name}</p><p className="text-xs text-slate-500">{[service.internalCode, service.serviceType, service.active === true ? "Ativo" : "Procedimento inativo"].filter(Boolean).join(" · ")}</p></div>
                      <div className="flex gap-1">
                        <button type="button" aria-label={`Editar procedimento ${service.name || ""}`} onClick={() => editTussService(service)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-normal text-slate-600">Editar</button>
                        {service.active === true ? (
                          <button type="button" aria-label={`Inativar procedimento ${service.name || ""}`} disabled={serviceActionLoading} onClick={() => void disableTussService(service.id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-normal text-slate-600 disabled:opacity-50">{serviceActionLoading ? <Loader2 size={12} className="animate-spin" /> : null}Inativar</button>
                        ) : (
                          <button type="button" aria-label={`Reativar procedimento ${service.name || ""}`} disabled={serviceActionLoading} onClick={() => void reactivateTussService(service.id)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2 py-1 text-xs font-normal text-emerald-700 disabled:opacity-50">{serviceActionLoading ? <Loader2 size={12} className="animate-spin" /> : null}Reativar</button>
                        )}
                        <button type="button" aria-label={`Excluir procedimento ${service.name || ""}`} onClick={() => void openDeleteImpactModal("service", service.id, service.name || "Procedimento")} className="inline-flex items-center gap-1 rounded-lg border border-rose-100 px-2 py-1 text-xs font-normal text-rose-700"><Trash2 size={12} />Excluir</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="rounded-lg border border-slate-100 bg-white p-3">
              <p className="text-xs font-medium text-slate-700">Catálogo de códigos TUSS</p>
              <p className="mt-1 text-xs text-slate-500">{activeTussCodes.length} ativo(s) · {tussCodes.length - activeTussCodes.length} inativo(s)</p>
              <div className="mt-2 space-y-2">
                {tussCodes.length === 0 ? <p className="text-xs text-slate-500">Nenhum código TUSS de referência cadastrado.</p> : tussCodes.slice(0, 12).map((code) => {
                  const codeActionKey = `code:${code.id}:${code.active === false ? "active" : "inactive"}`;
                  const codeActionLoading = supportActionKey === codeActionKey;
                  return (
                    <div key={code.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
                      <div><p className="text-sm font-medium text-slate-800">TUSS {code.code}</p><p className="text-xs text-slate-500">{[code.description, code.version, code.active === true ? "Ativo" : "Inativo"].filter(Boolean).join(" · ")}</p></div>
                      <div className="flex gap-1">
                        <button type="button" aria-label={`Editar código TUSS ${code.code || ""}`} onClick={() => editTussCode(code)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-normal text-slate-600">Editar</button>
                        {code.active === true ? (
                          <button type="button" aria-label={`Inativar código TUSS ${code.code || ""}`} disabled={codeActionLoading} onClick={() => void disableTussCode(code.id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-normal text-slate-600 disabled:opacity-50">{codeActionLoading ? <Loader2 size={12} className="animate-spin" /> : null}Inativar</button>
                        ) : (
                          <button type="button" aria-label={`Reativar código TUSS ${code.code || ""}`} disabled={codeActionLoading} onClick={() => void reactivateTussCode(code.id)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2 py-1 text-xs font-normal text-emerald-700 disabled:opacity-50">{codeActionLoading ? <Loader2 size={12} className="animate-spin" /> : null}Reativar</button>
                        )}
                        <button type="button" aria-label={`Excluir código TUSS ${code.code || ""}`} onClick={() => void openDeleteImpactModal("code", code.id, `TUSS ${code.code}`)} className="inline-flex items-center gap-1 rounded-lg border border-rose-100 px-2 py-1 text-xs font-normal text-rose-700"><Trash2 size={12} />Excluir</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          ) : null}
        </section>
        {deleteModal && (
          <div className="fixed inset-0 z-[170] flex items-end justify-center bg-slate-950/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Excluir cadastro">
            <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
              <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-900">
                  {deleteModal.entityType === "price" ? "Excluir preço negociado?" : deleteModal.entityType === "mapping" ? "Excluir mapeamento De/Para?" : "Excluir cadastro?"}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {deleteModal.name}
                </p>
              </div>
              <div className="space-y-3 px-5 py-4 text-sm text-slate-700">
                {deleteLoading && !deleteModal.impact ? (
                  <div className="flex items-center gap-2 text-slate-500"><Loader2 size={16} className="animate-spin" />Verificando vínculos...</div>
                ) : deleteModal.error ? (
                  <div className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-rose-800">
                    {deleteModal.error}
                  </div>
                ) : deleteModal.impact?.canDelete ? (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-emerald-800">
                    Este cadastro nunca foi utilizado e pode ser excluído definitivamente.
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
                    <p>
                      {deleteModal.impact?.recommendedAction === "keep_inactive"
                        ? "Este cadastro possui vínculos históricos e não pode ser excluído. Ele permanecerá inativo para preservar o histórico."
                        : "Este cadastro possui vínculos históricos e não pode ser excluído. Você pode inativá-lo para impedir novos usos."}
                    </p>
                  </div>
                )}
                {deleteModal.impact?.dependencies ? (
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Vínculos encontrados</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {Object.entries(deleteModal.impact.dependencies).filter(([, value]) => Number(value || 0) > 0).map(([key, value]) => (
                        <div key={key} className="rounded-lg bg-white px-3 py-2">
                          <p className="text-xs text-slate-500">{deleteDependencyLabels[key] || "Vínculo histórico"}</p>
                          <p className="text-sm text-slate-900">{Number(value || 0)}</p>
                        </div>
                      ))}
                      {Object.values(deleteModal.impact.dependencies).every((value) => Number(value || 0) === 0) ? (
                        <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-500">Nenhum vínculo histórico encontrado.</div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-4">
                <button type="button" onClick={() => setDeleteModal(null)} disabled={deleteLoading} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-600 disabled:opacity-50">
                  {deleteModal.impact?.canDelete ? "Cancelar" : "Fechar"}
                </button>
                {deleteModal.impact?.canDelete ? (
                  <button type="button" onClick={() => void confirmDeleteEntity()} disabled={deleteLoading} className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-normal text-rose-700 disabled:opacity-50">
                    {deleteLoading ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                    {deleteLoading ? "Excluindo..." : "Excluir definitivamente"}
                  </button>
                ) : deleteModal.impact?.recommendedAction === "deactivate" ? (
                  <button type="button" onClick={() => void deactivateFromDeleteModal()} disabled={deleteLoading} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-normal text-slate-700 disabled:opacity-50">
                    Inativar cadastro
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        )}
        {authorizationSyncModal && (
          <div className="fixed inset-0 z-[170] flex items-end justify-center bg-slate-950/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Sincronizar autorizações e Pré-guias">
            <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl">
              <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-900">Sincronizar autorizações e Pré-guias afetadas</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Confira antes de aplicar. A sincronização usa o De/Para vigente e não altera XMLs oficiais já gerados.
                </p>
              </div>
              <div className="space-y-3 px-5 py-4 text-sm text-slate-700">
                {authorizationSyncLoading && !authorizationSyncModal.summary ? (
                  <div className="flex items-center gap-2 text-slate-500"><Loader2 size={16} className="animate-spin" />Carregando autorizações afetadas...</div>
                ) : (
                  <>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs uppercase text-slate-400">Convênio</p>
                      <p className="mt-1 text-slate-800">{selectedPayer?.name || authorizationSyncModal.summary?.payerName || "Convênio selecionado"}</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs uppercase text-slate-400">Procedimento interno</p><p className="mt-1">{authorizationSyncModal.summary?.procedureName || authorizationSyncModal.mapping.serviceName || "Procedimento"}</p></div>
                      <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs uppercase text-slate-400">Código TUSS novo</p><p className="mt-1">{authorizationSyncModal.summary?.newTussCode || authorizationSyncModal.mapping.tussCode || "Não informado"}</p></div>
                      <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs uppercase text-slate-400">Autorizações encontradas</p><p className="mt-1">{Number(authorizationSyncModal.summary?.authorizationsFound || 0)}</p></div>
                      <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs uppercase text-slate-400">Autorizações elegíveis</p><p className="mt-1">{Number(authorizationSyncModal.summary?.authorizationsEligible || 0)}</p></div>
                      <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs uppercase text-slate-400">Autorizações protegidas</p><p className="mt-1">{Number(authorizationSyncModal.summary?.authorizationsProtected || 0)}</p></div>
                      <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs uppercase text-slate-400">Pré-guias revalidadas</p><p className="mt-1">{Number(authorizationSyncModal.summary?.preGuidesToRevalidate || 0)}</p></div>
                    </div>
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">
                      0 documentos oficiais serão modificados. Senha, guia, validade, quantidade, consumo e preço serão preservados.
                    </div>
                  </>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-4">
                <button type="button" onClick={() => setAuthorizationSyncModal(null)} disabled={authorizationSyncLoading} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-600 disabled:opacity-50">Cancelar</button>
                <button
                  type="button"
                  onClick={() => void confirmAuthorizationSync()}
                  disabled={authorizationSyncLoading || Number(authorizationSyncModal.summary?.authorizationsEligible || 0) === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-normal text-white disabled:opacity-50"
                >
                  {authorizationSyncLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  Confirmar sincronização
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
