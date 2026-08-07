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
import {
  getTissProviderCodeLengthError,
  isValidTissCivilDate,
  normalizeTissCivilDate,
} from "../utils/tissFieldValidation";

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
  officialTussCode?: string | null;
  tussDescription?: string | null;
  contractCode?: string | null;
  contractDescription?: string | null;
  payerSpecificDescription?: string | null;
  authorizedCode?: string | null;
  authorizedCodeDescription?: string | null;
  billingCode?: string | null;
  billingCodeDescription?: string | null;
  operatorPackageCode?: string | null;
  operatorPackageDescription?: string | null;
  billingCodeSource?: string | null;
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
  metadata?: Record<string, any>;
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
  completionState: "active" | "awaiting_price" | "inactive";
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
  antiGlosaReviewed: boolean;
  antiGlosaReviewedAt: string;
  antiGlosaReviewedBy: string;
  operatorHasNoAdditionalRequirements: boolean;
  allowsZeroAmountXml: boolean;
  zeroAmountXmlReason: string;
  administrativeNotes: string;
  specificRules: string;
};

export type PayerSetupStepStatus = "not_started" | "incomplete" | "ready" | "warning" | "blocked";

export type PayerSetupStepKey =
  | "identification"
  | "clinic"
  | "tiss"
  | "procedures"
  | "tuss"
  | "prices"
  | "authorizations"
  | "anti_glosa"
  | "test"
  | "ready";

export type PayerSetupStep = {
  key: PayerSetupStepKey;
  title: string;
  shortDescription: string;
  status: PayerSetupStepStatus;
  requiredActions: string[];
  nextActionLabel: string;
  canContinue: boolean;
  blockingReasons?: string[];
  warnings?: string[];
};

export type PayerSetupReadiness = {
  overallStatus: "not_started" | "incomplete" | "ready_for_pre_guide" | "ready_for_xml_with_warning" | "ready_for_xml";
  overallLabel: string;
  currentStepKey: PayerSetupStepKey;
  nextActionLabel: string;
  steps: PayerSetupStep[];
  blockers: string[];
  warnings: string[];
};

type SetupPreGuideTestStatus = "not_tested" | "ready" | "warning" | "blocked";

type SetupPreGuideTestResult = {
  status: SetupPreGuideTestStatus;
  issues: string[];
  preGuide?: any | null;
  message?: string;
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
  authorizedCode: "",
  authorizedCodeDescription: "",
  billingCode: "",
  billingCodeDescription: "",
  operatorPackageCode: "",
  operatorPackageDescription: "",
  billingCodeSource: "official_tuss",
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
  antiGlosaReviewed: false,
  antiGlosaReviewedAt: "",
  antiGlosaReviewedBy: "",
  operatorHasNoAdditionalRequirements: false,
  allowsZeroAmountXml: false,
  zeroAmountXmlReason: "",
  administrativeNotes: "",
  specificRules: "",
};

const antiGlosaRequirementKeys: Array<keyof PayerTissForm> = [
  "requiresBeneficiaryCard",
  "requiresBeneficiaryCardValidity",
  "requiresAuthorization",
  "requiresAuthorizedProcedure",
  "requiresAuthorizationPassword",
  "requiresGuideNumber",
  "requiresCid",
  "requiresExecutantRegistry",
  "requiresCbo",
  "requiresCnes",
  "requiresProviderCode",
  "requiresResponsibleSignature",
  "requiresPhysicalGuide",
  "requiresSignedGuide",
  "requiresStampedDatedGuide",
  "requiresAdministrativeReport",
];

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

export const getBillingConfigurationCompletionState = (configuration: {
  service?: { active?: boolean } | null;
  code?: { active?: boolean } | null;
  mapping?: { active?: boolean } | null;
  price?: { active?: boolean } | null;
}): "active" | "awaiting_price" | "inactive" => {
  if (isBillingConfigurationOperational(configuration)) return "active";
  if (
    configuration.service?.active === true &&
    configuration.code?.active === true &&
    configuration.mapping?.active === true &&
    configuration.price?.active !== true
  ) {
    return "awaiting_price";
  }
  return "inactive";
};

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
    <label htmlFor={id} className="block text-xs font-normal text-slate-600">
      <span className="block text-slate-700">{label}</span>
      {children}
      {helperText ? (
        <span id={`${id}-help`} className="mt-1 block text-[11px] leading-4 text-slate-500">
          {helperText}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-error`} className="mt-1 block text-[11px] leading-4 text-rose-600">
          {error}
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
  successLabel = "Salvo",
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
  const saveStatus: SaveActionStatus =
    status === "saving" ? "loading" : status === "success" ? "success" : status === "error" ? "error" : "idle";
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
      <SaveActionButton
        status={saveStatus}
        idleLabel={primaryLabel}
        loadingLabel={savingLabel}
        successLabel={successLabel}
        disabled={disabled || isSaving || isSuccess}
        onClick={onSubmit}
      />
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

type SaveActionStatus = "idle" | "loading" | "success" | "error";

function SaveActionButton({
  status,
  idleLabel,
  loadingLabel = "Salvando...",
  successLabel = "Salvo",
  errorLabel = "Não foi possível salvar",
  disabled,
  onClick,
}: {
  status: SaveActionStatus;
  idleLabel: string;
  loadingLabel?: string;
  successLabel?: string;
  errorLabel?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const isLoading = status === "loading";
  const isSuccess = status === "success";
  const isError = status === "error";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isLoading}
      data-save-action-button
      data-save-action-status={status}
      className={`inline-flex min-h-[42px] min-w-[156px] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
        isError ? "bg-rose-600 hover:bg-rose-700" : "bg-[#7a32fc] hover:bg-[#6827df]"
      }`}
    >
      {isLoading ? <Loader2 size={16} className="animate-spin" /> : isSuccess ? <CheckCircle2 size={16} /> : isError ? <AlertTriangle size={16} /> : <Save size={16} />}
      {isLoading ? loadingLabel : isSuccess ? `✓ ${successLabel}` : isError ? errorLabel : idleLabel}
    </button>
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
  antiGlosaReviewed: Boolean(profile.anti_glosa_reviewed ?? profile.antiGlosaReviewed),
  antiGlosaReviewedAt: profile.anti_glosa_reviewed_at || profile.antiGlosaReviewedAt || "",
  antiGlosaReviewedBy: profile.anti_glosa_reviewed_by || profile.antiGlosaReviewedBy || "",
  operatorHasNoAdditionalRequirements: Boolean(profile.operator_has_no_additional_requirements ?? profile.operatorHasNoAdditionalRequirements),
  allowsZeroAmountXml: Boolean(profile.allows_zero_amount_xml ?? profile.allowsZeroAmountXml),
  zeroAmountXmlReason: profile.zero_amount_xml_reason || profile.zeroAmountXmlReason || "",
  administrativeNotes: profile.administrative_notes || profile.administrativeNotes || "",
  specificRules: profile.specific_rules || profile.specificRules || "",
});

const isInsurancePayer = (payer?: Payer | null) => String(payer?.payerType || "").toUpperCase() === "INSURANCE";
const isFilled = (value: unknown) => String(value ?? "").trim().length > 0;

const normalizeSetupText = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const setupEventSourcePayload = (event: any) => {
  const raw = event?.sourcePayload || event?.source_payload || {};
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const setupEventPatientId = (event: any) => {
  const source = setupEventSourcePayload(event);
  return String(event?.patientId || event?.patient_id || event?.patient?.id || source?.patientId || source?.patient_id || "").trim();
};
const setupEventPayerId = (event: any) => String(
  event?.payerId ||
    event?.payer_id ||
    event?.billingContext?.payerId ||
    event?.billing_context?.payer_id ||
    event?.sourcePayload?.payerId ||
    event?.sourcePayload?.payer_id ||
    event?.source_payload?.payerId ||
    event?.source_payload?.payer_id ||
    "",
).trim();
const setupEventPayerName = (event: any) => String(
  event?.payerName ||
    event?.payer_name ||
    event?.payer_name_snapshot ||
    event?.billingContext?.payerName ||
    event?.billing_context?.payer_name ||
    event?.sourcePayload?.payerName ||
    event?.sourcePayload?.payer_name ||
    event?.source_payload?.payerName ||
    event?.source_payload?.payer_name ||
    "",
).trim();
const setupEventPatientName = (event: any) => String(event?.patientName || event?.patient_name || event?.patient?.name || event?.name || "Paciente não informado").trim();
const setupEventProfessionalName = (event: any) => String(
  event?.therapistName ||
    event?.therapist_name ||
    event?.professionalName ||
    event?.professional_name ||
    event?.responsibleProfessionalName ||
    event?.responsible_professional_name ||
    event?.professional ||
    "",
).trim();
const setupEventProfessionalId = (event: any) => String(event?.therapistId || event?.therapist_id || event?.professionalId || event?.professional_id || "").trim();
const setupEventRoomName = (event: any) => String(event?.roomName || event?.room_name || event?.roomDisplayName || event?.room_display_name || "").trim();
const setupEventRoomId = (event: any) => String(event?.roomId || event?.room_id || event?.room || "").trim();
const setupEventProcedureName = (event: any) => String(event?.serviceType || event?.service_type || event?.procedureName || event?.procedure_name || event?.type || event?.approach || "Procedimento não informado").trim();

const setupEventResolvedPatientName = (event: any) => {
  const source = setupEventSourcePayload(event);
  return String(setupEventPatientName(event) || source?.patientName || source?.patient_name || "Paciente não informado").trim();
};

const setupEventResolvedProfessionalName = (event: any) => {
  const source = setupEventSourcePayload(event);
  return String(
    setupEventProfessionalName(event) ||
      event?.professional?.name ||
      event?.therapist?.name ||
      source?.therapistName ||
      source?.therapist_name ||
      source?.professionalName ||
      source?.professional_name ||
      source?.professional?.name ||
      "",
  ).trim();
};

const setupEventResolvedProfessionalId = (event: any) => {
  const source = setupEventSourcePayload(event);
  return String(setupEventProfessionalId(event) || source?.therapistId || source?.therapist_id || source?.professionalId || source?.professional_id || "").trim();
};

const setupEventResolvedRoomName = (event: any) => {
  const source = setupEventSourcePayload(event);
  return String(
    setupEventRoomName(event) ||
      event?.room?.name ||
      source?.roomName ||
      source?.room_name ||
      source?.room?.name ||
      "",
  ).trim();
};

const setupEventResolvedRoomId = (event: any) => {
  const source = setupEventSourcePayload(event);
  return String(setupEventRoomId(event) || source?.roomId || source?.room_id || "").trim();
};

const setupEventAuthorizationCode = (event: any) => {
  const source = setupEventSourcePayload(event);
  return String(event?.authorizationCode || event?.authorization_code || event?.billingContext?.authorizationCode || event?.billing_context?.authorization_code || source?.authorizationCode || source?.authorization_code || "").trim();
};

const setupEventGuideNumber = (event: any) => {
  const source = setupEventSourcePayload(event);
  return String(event?.guideNumber || event?.guide_number || event?.billingContext?.guideNumber || event?.billing_context?.guide_number || source?.guideNumber || source?.guide_number || "").trim();
};

const setupEventStatusKey = (event: any) => normalizeSetupText(event?.status || event?.appointment_status || setupEventSourcePayload(event)?.status || "");
const setupEventSyncStatusKey = (event: any) => normalizeSetupText(event?.syncStatus || event?.sync_status || event?.offlineSyncStatus || event?.offline_sync_status || "");
const setupEventOfficialDocumentId = (event: any) => String(event?.officialDocumentId || event?.official_document_id || event?.preGuide?.officialDocumentId || event?.pre_guide?.official_document_id || event?.billingContext?.officialDocumentId || event?.billing_context?.official_document_id || "").trim();

const buildSetupPreGuideEligibilityReasons = (event: any, payerId: string, payerName?: string | null) => {
  const reasons: string[] = [];
  const eventPayerId = setupEventPayerId(event);
  const eventPayerName = setupEventPayerName(event);
  const expectedPayerNameKey = normalizeSetupText(payerName);
  const eventPayerNameKey = normalizeSetupText(eventPayerName);
  const hasExpectedPayer = Boolean(payerId || expectedPayerNameKey);
  const payerMatches =
    !hasExpectedPayer ||
    (payerId && eventPayerId === payerId) ||
    (expectedPayerNameKey && eventPayerNameKey === expectedPayerNameKey);
  if (hasExpectedPayer && !eventPayerId && !eventPayerNameKey) reasons.push("Sessão sem pagador de convênio.");
  else if (!payerMatches) reasons.push(`Sessão está com outro pagador${eventPayerName ? ` (${eventPayerName})` : ""}.`);
  if (/cancel|cancell|remarc|resched|recus|refus/.test(setupEventStatusKey(event))) reasons.push("Sessão cancelada, recusada ou remarcada.");
  if (/pending sync|pendente.*sincron|offline/.test(setupEventSyncStatusKey(event))) reasons.push("Sessão pendente de sincronização.");
  if (setupEventOfficialDocumentId(event)) reasons.push("Sessão ou Pré-guia já vinculada a lote XML.");
  if (!setupEventResolvedProfessionalId(event) && !setupEventResolvedProfessionalName(event)) reasons.push("Sessão sem profissional carregado.");
  if (!setupEventResolvedRoomId(event) && !setupEventResolvedRoomName(event)) reasons.push("Sessão sem sala/local carregado.");
  if (!setupEventAuthorizationCode(event) && !setupEventGuideNumber(event)) reasons.push("Sessão sem guia ou autorização vigente vinculada.");
  return reasons;
};

const summarizeSetupEligibilityDiagnostics = (diagnostics: Array<{ reasons: string[] }>) => {
  const counts = new Map<string, number>();
  diagnostics.forEach((item) => item.reasons.forEach((reason) => counts.set(reason, (counts.get(reason) || 0) + 1)));
  return Array.from(counts.entries()).map(([reason, count]) => `${count} sessão(ões): ${reason}`);
};

const formatSetupSessionDateTime = (event: any) => {
  const raw = event?.start || event?.scheduledStart || event?.scheduled_start || event?.start_at || event?.date;
  const start = raw ? new Date(raw) : null;
  if (!start || Number.isNaN(start.getTime())) return event?.time || "Data não informada";
  return start.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

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

export const isPayerTussMappingReady = (mapping: Pick<PayerTussMapping, "active" | "validFrom"> | null | undefined) => (
  mapping?.active === true && isValidTissCivilDate(mapping.validFrom)
);

export const resolvePayerTussMappingForForm = ({
  mappings,
  payerId,
  serviceCatalogId,
  editingId,
}: {
  mappings: PayerTussMapping[];
  payerId: string;
  serviceCatalogId?: string;
  editingId?: string;
}): PayerTussMapping | null => {
  const scoped = mappings.filter((mapping) => mapping.payerId === payerId);
  if (editingId) {
    const editing = scoped.find((mapping) => mapping.id === editingId);
    if (editing && (!serviceCatalogId || editing.serviceCatalogId === serviceCatalogId)) return editing;
  }
  if (serviceCatalogId) {
    const matching = scoped.find((mapping) => mapping.serviceCatalogId === serviceCatalogId && mapping.active === true);
    if (matching) return matching;
  }
  return scoped.find((mapping) => mapping.active === true) || null;
};

export const getPayerTussMappingPersistenceError = ({
  persisted,
  expectedId,
  expectedPayerId,
  expectedServiceCatalogId,
  expectedValidFrom,
}: {
  persisted?: Partial<PayerTussMapping> | null;
  expectedId?: string;
  expectedPayerId: string;
  expectedServiceCatalogId: string;
  expectedValidFrom: string;
}): string => {
  const validFrom = normalizeTissCivilDate(expectedValidFrom);
  if (!validFrom) return "Informe uma vigência inicial válida antes de salvar o De/Para.";
  if (!persisted?.id) return "O servidor não confirmou qual De/Para foi atualizado.";
  if (expectedId && persisted.id !== expectedId) return "O servidor retornou outro De/Para. Nenhuma confirmação de salvamento foi exibida.";
  if (persisted.payerId !== expectedPayerId || persisted.serviceCatalogId !== expectedServiceCatalogId) {
    return "O servidor retornou um De/Para de outro contexto. Recarregue a configuração antes de tentar novamente.";
  }
  if (normalizeTissCivilDate(persisted.validFrom) !== validFrom) {
    return `A vigência ${validFrom.split("-").reverse().join("/")} não foi confirmada pelo banco. O valor digitado foi mantido para nova tentativa.`;
  }
  return "";
};

export const getProcedureSetupDependencyLabels = ({
  serviceId,
  mappings,
  prices,
}: {
  serviceId: string;
  mappings: PayerTussMapping[];
  prices: PayerProcedurePrice[];
}): string[] => {
  const dependencies: string[] = [];
  if (mappings.some((mapping) => mapping.serviceCatalogId === serviceId)) dependencies.push("De/Para cadastrado");
  if (prices.some((price) => price.serviceCatalogId === serviceId)) dependencies.push("valor negociado cadastrado");
  return dependencies;
};

export const payerTussMappingToForm = (mapping: PayerTussMapping) => {
  const metadata = mapping.metadata || {};
  return {
    serviceCatalogId: mapping.serviceCatalogId || "",
    tussCodeId: mapping.tussCodeId || "",
    contractCode: mapping.contractCode || "",
    contractDescription: mapping.contractDescription || mapping.payerSpecificDescription || "",
    authorizedCode: mapping.authorizedCode || metadata.authorized_code || metadata.authorizedCode || "",
    authorizedCodeDescription: mapping.authorizedCodeDescription || metadata.authorized_code_description || metadata.authorizedCodeDescription || "",
    billingCode: mapping.billingCode || metadata.billing_code || metadata.billingCode || "",
    billingCodeDescription: mapping.billingCodeDescription || metadata.billing_code_description || metadata.billingCodeDescription || "",
    operatorPackageCode: mapping.operatorPackageCode || metadata.operator_package_code || metadata.operatorPackageCode || mapping.contractCode || "",
    operatorPackageDescription: mapping.operatorPackageDescription || metadata.operator_package_description || metadata.operatorPackageDescription || "",
    billingCodeSource: mapping.billingCodeSource || metadata.billing_code_source || metadata.billingCodeSource || "official_tuss",
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
    validFrom: normalizeTissCivilDate(mapping.validFrom),
    validTo: normalizeTissCivilDate(mapping.validTo),
    source: mapping.source || "manual",
    notes: mapping.notes || "",
  };
};

export const payerProcedurePriceToForm = (price: PayerProcedurePrice) => ({
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

const setupStatusLabel: Record<PayerSetupStepStatus, string> = {
  not_started: "Pendente",
  incomplete: "Incompleta",
  ready: "Pronta",
  warning: "Alerta",
  blocked: "Bloqueada",
};

const legacyTussCodesForSetup = new Set(["10101012", "TESTE-ABA"]);

export const isLegacyOrInvalidTussCodeForSetup = (code: unknown) => (
  legacyTussCodesForSetup.has(String(code ?? "").trim().toUpperCase())
);

const getOfficialTussCodeForSetupValidation = (configuration: BillingConfigurationRow) => {
  const resolvedOfficialCode = String(configuration.code?.code || "").trim();
  if (resolvedOfficialCode) return resolvedOfficialCode;
  const mappingHasUnresolvedCode = Boolean(configuration.mapping?.tussCodeId) && !configuration.code?.id;
  const priceHasUnresolvedCode = Boolean(configuration.price?.tussCodeId) && !configuration.code?.id;
  if (!mappingHasUnresolvedCode && String(configuration.mapping?.tussCode || "").trim()) {
    return String(configuration.mapping?.tussCode || "").trim();
  }
  if (!priceHasUnresolvedCode && String(configuration.price?.tussCode || "").trim()) {
    return String(configuration.price?.tussCode || "").trim();
  }
  return "";
};

const makeSetupStep = (step: PayerSetupStep): PayerSetupStep => step;

export function getPayerSetupReadiness(input: {
  payer?: { name?: string | null; payerType?: string | null; status?: string | null } | null;
  tissProfile?: Partial<PayerTissForm> | null;
  tissMissing?: string[];
  officialCodeIssues?: string[];
  activeProcedureCount?: number;
  activeMappingCount?: number;
  readyMappingCount?: number;
  activePriceCount?: number;
  activeBillingConfigurationCount?: number;
  pendingPriceCount?: number;
  hasLegacyTussCode?: boolean;
  antiGlosaProfileNeedsReview?: boolean;
  payerTissMessage?: string;
  preGuideTestStatus?: "not_tested" | "ready" | "warning" | "blocked";
  preGuideTestIssues?: string[];
}): PayerSetupReadiness {
  const payer = input.payer || null;
  const tiss = input.tissProfile || {};
  const isInsurance = String(payer?.payerType || "").toUpperCase() === "INSURANCE";
  const hasPayer = Boolean(payer && isFilled(payer.name));
  const hasProviderCode = isFilled(tiss.contractedProviderCode) || isFilled(tiss.operatorProviderCode) || isFilled(tiss.operatorCode);
  const hasAns = !isInsurance || isFilled(tiss.ansRegistration);
  const officialIssues = input.officialCodeIssues || [];
  const tissMissing = input.tissMissing || [];
  const activeProcedureCount = Number(input.activeProcedureCount || 0);
  const activeMappingCount = Number(input.activeMappingCount || 0);
  const readyMappingCount = Number(input.readyMappingCount || 0);
  const allActiveMappingsReady = activeMappingCount > 0 && readyMappingCount === activeMappingCount;
  const activePriceCount = Number(input.activePriceCount || 0);
  const activeBillingConfigurationCount = Number(input.activeBillingConfigurationCount || 0);
  const pendingPriceCount = Number(input.pendingPriceCount || 0);
  const hasLegacyTussCode = Boolean(input.hasLegacyTussCode);
  const antiGlosaProfileNeedsReview = Boolean(input.antiGlosaProfileNeedsReview);
  const preGuideTestStatus = input.preGuideTestStatus || "not_tested";
  const preGuideTestIssues = input.preGuideTestIssues || [];

  const steps: PayerSetupStep[] = [
    makeSetupStep({
      key: "identification",
      title: "Identificação da operadora",
      shortDescription: "Informe quem é a operadora e o registro ANS usado no XML TISS.",
      status: !hasPayer ? "not_started" : hasAns ? "ready" : "incomplete",
      requiredActions: hasPayer && hasAns ? ["Operadora identificada."] : ["Informe nome da operadora e Registro ANS."],
      nextActionLabel: hasPayer && hasAns ? "Avançar para dados da clínica" : "Completar identificação",
      canContinue: hasPayer && hasAns,
      blockingReasons: hasPayer && hasAns ? [] : ["Registro ANS e nome da operadora são necessários para convênio TISS."],
    }),
    makeSetupStep({
      key: "clinic",
      title: "Dados da clínica no convênio",
      shortDescription: "Informe como a clínica é reconhecida por esta operadora.",
      status: !hasPayer ? "not_started" : hasProviderCode ? "ready" : "incomplete",
      requiredActions: hasProviderCode ? ["Código da clínica/prestador informado."] : ["Informe o código da clínica ou prestador na operadora."],
      nextActionLabel: hasProviderCode ? "Avançar para padrão TISS" : "Informar código da clínica",
      canContinue: hasProviderCode,
      blockingReasons: hasProviderCode ? [] : ["Informe o código da clínica na operadora."],
    }),
    makeSetupStep({
      key: "tiss",
      title: "Padrão TISS",
      shortDescription: "O Verto usa o padrão oficial 04.03.00 para gerar o XML.",
      status: officialIssues.length > 0 ? "blocked" : tissMissing.length > 0 ? "warning" : "ready",
      requiredActions: officialIssues.length > 0
        ? officialIssues
        : ["Comunicação 04.03.00, estrutura 202511 e TUSS 202605 serão usados pelo gerador oficial."],
      nextActionLabel: officialIssues.length > 0 ? "Revisar códigos oficiais" : "Confirmar padrão TISS",
      canContinue: officialIssues.length === 0,
      blockingReasons: officialIssues,
      warnings: tissMissing,
    }),
    makeSetupStep({
      key: "procedures",
      title: "Procedimentos atendidos",
      shortDescription: "Selecione quais procedimentos internos podem ser faturados por convênio.",
      status: activeProcedureCount > 0 ? "ready" : "incomplete",
      requiredActions: activeProcedureCount > 0 ? [`${activeProcedureCount} procedimento(s) interno(s) ativo(s).`] : ["Cadastre pelo menos um procedimento faturável."],
      nextActionLabel: activeProcedureCount > 0 ? "Avançar para TUSS/DePara" : "Adicionar procedimento",
      canContinue: activeProcedureCount > 0,
      blockingReasons: activeProcedureCount > 0 ? [] : ["Cadastre um procedimento interno faturável."],
    }),
    makeSetupStep({
      key: "tuss",
      title: "TUSS e De/Para",
      shortDescription: "Vincule cada procedimento ao código TUSS aceito pela operadora.",
      status: hasLegacyTussCode ? "blocked" : allActiveMappingsReady ? "ready" : "incomplete",
      requiredActions: hasLegacyTussCode
        ? ["Troque códigos legados/inadequados por TUSS oficial ativo."]
        : allActiveMappingsReady
          ? [`${readyMappingCount} De/Para ativo(s) com vigência inicial persistida.`]
          : activeMappingCount > 0
            ? [`${activeMappingCount} De/Para ativo(s), mas a vigência inicial obrigatória ainda não foi salva.`]
            : ["Crie De/Para entre procedimento interno e código TUSS oficial."],
      nextActionLabel: hasLegacyTussCode ? "Corrigir TUSS legado" : allActiveMappingsReady ? "Avançar para valores" : "Completar De/Para",
      canContinue: allActiveMappingsReady && !hasLegacyTussCode,
      blockingReasons: hasLegacyTussCode
        ? ["Código TUSS legado/inadequado para XML."]
        : allActiveMappingsReady
          ? []
          : activeMappingCount > 0
            ? ["Informe e salve a vigência inicial obrigatória do De/Para."]
            : ["De/Para TUSS ativo é obrigatório para Pré-guia/XML."],
    }),
    makeSetupStep({
      key: "prices",
      title: "Valores negociados",
      shortDescription: "Cadastre o valor contratado por procedimento para calcular Pré-guia e XML.",
      status: activePriceCount > 0 ? "ready" : pendingPriceCount > 0 ? "incomplete" : "incomplete",
      requiredActions: activePriceCount > 0 ? [`${activePriceCount} valor(es) negociado(s) vigente(s).`] : ["Cadastre valor negociado positivo e ativo."],
      nextActionLabel: activePriceCount > 0 ? "Avançar para autorizações" : "Cadastrar valor negociado",
      canContinue: activePriceCount > 0,
      blockingReasons: activePriceCount > 0 ? [] : ["Cadastre valor negociado vigente."],
    }),
    makeSetupStep({
      key: "authorizations",
      title: "Autorizações dos pacientes",
      shortDescription: "Acompanhe autorizações, senhas, guias, validade e saldo por paciente.",
      status: "ready",
      requiredActions: ["Cadastre autorizações quando o paciente e a sessão exigirem convênio/autorização."],
      nextActionLabel: "Abrir autorizações dos pacientes",
      canContinue: true,
      warnings: [],
    }),
    makeSetupStep({
      key: "anti_glosa",
      title: "Exigências anti-glosa",
      shortDescription: "Revise regras operacionais da operadora antes do XML.",
      status: antiGlosaProfileNeedsReview ? "warning" : "ready",
      requiredActions: antiGlosaProfileNeedsReview
        ? ["Revise exigências reais da operadora ou confirme que não há exigências adicionais."]
        : ["Perfil anti-glosa revisado ou confirmado sem exigências adicionais."],
      nextActionLabel: antiGlosaProfileNeedsReview ? "Revisar anti-glosa" : "Avançar para teste",
      canContinue: true,
      warnings: antiGlosaProfileNeedsReview ? ["Pré-guias terão risco médio até revisar."] : [],
    }),
    makeSetupStep({
      key: "test",
      title: "Teste de Pré-guia",
      shortDescription: "Valide uma sessão real ou de teste antes de gerar XML em lote.",
      status: preGuideTestStatus === "blocked"
        ? "blocked"
        : preGuideTestStatus === "ready"
          ? "ready"
          : preGuideTestStatus === "warning"
            ? "warning"
            : activeBillingConfigurationCount > 0 ? "warning" : "incomplete",
      requiredActions: preGuideTestStatus === "ready"
        ? ["Teste de Pré-guia aprovado."]
        : ["Revalide uma Pré-guia de teste e confira TISS técnico e anti-glosa."],
      nextActionLabel: preGuideTestStatus === "ready" ? "Ver resumo final" : "Ir para Pré-Guias TISS",
      canContinue: preGuideTestStatus !== "blocked",
      blockingReasons: preGuideTestStatus === "blocked" ? preGuideTestIssues : [],
      warnings: preGuideTestStatus === "ready" ? [] : preGuideTestIssues.length > 0 ? preGuideTestIssues : ["Teste ainda não executado nesta esteira."],
    }),
  ];

  const criticalSteps = steps.filter((step) => !["authorizations", "anti_glosa", "test"].includes(step.key));
  const blockers = steps.flatMap((step) => step.blockingReasons || []);
  const warnings = steps.flatMap((step) => step.warnings || []);
  const hasCriticalIncomplete = criticalSteps.some((step) => ["not_started", "incomplete", "blocked"].includes(step.status));
  const coreReadyForPreGuide = !hasCriticalIncomplete && activeBillingConfigurationCount > 0;
  let overallStatus: PayerSetupReadiness["overallStatus"] = "incomplete";
  let overallLabel = "Configuração incompleta";

  if (!hasPayer) {
    overallStatus = "not_started";
    overallLabel = "Configuração não iniciada";
  } else if (coreReadyForPreGuide && preGuideTestStatus === "ready" && !antiGlosaProfileNeedsReview && warnings.length === 0) {
    overallStatus = "ready_for_xml";
    overallLabel = "Pronto para XML";
  } else if (coreReadyForPreGuide && preGuideTestStatus === "ready") {
    overallStatus = "ready_for_xml_with_warning";
    overallLabel = "Pronto para XML com alerta";
  } else if (coreReadyForPreGuide) {
    overallStatus = "ready_for_pre_guide";
    overallLabel = "Pronto para Pré-guia";
  }

  const finalStatus: PayerSetupStepStatus = overallStatus === "ready_for_xml"
    ? "ready"
    : overallStatus === "ready_for_xml_with_warning" || overallStatus === "ready_for_pre_guide"
      ? "warning"
      : blockers.length > 0 ? "blocked" : "incomplete";

  const finalStep = makeSetupStep({
    key: "ready",
    title: "Pronto para XML",
    shortDescription: "Resumo final da configuração do convênio.",
    status: finalStatus,
    requiredActions: overallStatus === "ready_for_xml"
      ? ["Convênio configurado para XML oficial."]
      : ["Conclua os bloqueios e revise alertas antes de gerar XML em lote."],
    nextActionLabel: overallStatus === "ready_for_xml" ? "Ir para Pré-Guias TISS" : "Concluir etapas pendentes",
    canContinue: finalStatus !== "blocked",
    blockingReasons: finalStatus === "blocked" ? blockers : [],
    warnings: finalStatus === "warning" ? warnings : [],
  });

  const allSteps = [...steps, finalStep];
  const current = allSteps.find((step) => step.status !== "ready") || finalStep;

  return {
    overallStatus,
    overallLabel,
    currentStepKey: current.key,
    nextActionLabel: current.nextActionLabel,
    steps: allSteps,
    blockers,
    warnings,
  };
}

type PayerRequirementsPanelProps = {
  initialSection?: "convenios" | "tuss" | "prices" | "rules";
  initialPayerId?: string;
  navigationIntentKey?: number;
  theme?: "light" | "dark";
  onNavigateToPatientAuthorizations?: (context: { payerId: string; payerName: string }) => void;
  onNavigateToPreGuides?: (context: { payerId: string; payerName: string }) => void;
};

export function PayerRequirementsPanel({
  initialSection,
  initialPayerId,
  navigationIntentKey,
  theme = "light",
  onNavigateToPatientAuthorizations,
  onNavigateToPreGuides,
}: PayerRequirementsPanelProps = {}) {
  const [payers, setPayers] = useState<Payer[]>([]);
  const [selectedPayerId, setSelectedPayerId] = useState("");
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [payerForm, setPayerForm] = useState({ name: "", payerType: "INSURANCE", notes: "" });
  const [payerSetupIdentityForm, setPayerSetupIdentityForm] = useState({ name: "", status: "ACTIVE", notes: "" });
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
  const [tussMappingValidFromError, setTussMappingValidFromError] = useState("");
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
  const [payerTissFieldErrors, setPayerTissFieldErrors] = useState<Partial<Record<keyof PayerTissForm, string>>>({});
  const [activeSetupStepKey, setActiveSetupStepKey] = useState<PayerSetupStepKey>("identification");
  const [setupActionStatus, setSetupActionStatus] = useState<Record<string, SaveActionStatus>>({});
  const [setupPatients, setSetupPatients] = useState<any[]>([]);
  const [setupAppointments, setSetupAppointments] = useState<any[]>([]);
  const [setupPatientId, setSetupPatientId] = useState("");
  const [setupAppointmentId, setSetupAppointmentId] = useState("");
  const [setupTestLoadState, setSetupTestLoadState] = useState<{ loading: boolean; error: string }>({ loading: false, error: "" });
  const [setupTestResult, setSetupTestResult] = useState<SetupPreGuideTestResult>({ status: "not_tested", issues: [] });
  const [advancedModeOpen, setAdvancedModeOpen] = useState(false);
  const payerRulesSectionRef = useRef<HTMLDivElement | null>(null);
  const payerTussSectionRef = useRef<HTMLDivElement | null>(null);
  const payerPricesSectionRef = useRef<HTMLDivElement | null>(null);
  const tussServiceFormRef = useRef<HTMLDivElement | null>(null);
  const tussServiceNameInputRef = useRef<HTMLInputElement | null>(null);
  const tussCodeFormRef = useRef<HTMLDivElement | null>(null);
  const tussCodeInputRef = useRef<HTMLInputElement | null>(null);
  const procedurePriceSaveInFlightRef = useRef(false);
  const tussMappingSaveInFlightRef = useRef(false);
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
  const selectedPayerMappings = tussMappings.filter((mapping) => mapping.payerId === selectedPayerId);
  const selectedPayerMappingCount = selectedPayerMappings.filter((mapping) => mapping.active === true).length;
  const selectedPayerReadyMappingCount = selectedPayerMappings.filter(isPayerTussMappingReady).length;
  const selectedPayerPriceCount = procedurePrices.filter((price) => price.payerId === selectedPayerId && price.active === true).length;
  const selectedPayerOfficialCodeIssues = useMemo(() => {
    const issues: string[] = [];
    if (payerTissForm.defaultAttendanceType && !isSupportedAttendanceType040300(payerTissForm.defaultAttendanceType)) issues.push("Tipo de atendimento inválido");
    if (payerTissForm.defaultAttendanceRegime && !isSupportedAttendanceRegime040300(payerTissForm.defaultAttendanceRegime)) issues.push("Regime de atendimento inválido");
    if (payerTissForm.defaultAttendanceCharacter && !isSupportedAttendanceCharacter040300(payerTissForm.defaultAttendanceCharacter)) issues.push("Caráter de atendimento inválido");
    if (payerTissForm.defaultGuideType && !hasOption(guideTypes040300, payerTissForm.defaultGuideType)) issues.push("Tipo de guia inválido");
    return issues;
  }, [payerTissForm.defaultAttendanceCharacter, payerTissForm.defaultAttendanceRegime, payerTissForm.defaultAttendanceType, payerTissForm.defaultGuideType]);
  const hasAnySpecificAntiGlosaRequirement = useMemo(
    () => antiGlosaRequirementKeys.some((key) => Boolean((payerTissForm as any)[key])),
    [payerTissForm],
  );
  const antiGlosaProfileNeedsReview = isInsurancePayer(selectedPayer) &&
    !payerTissForm.antiGlosaReviewed &&
    !payerTissForm.operatorHasNoAdditionalRequirements;
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
      return { ...row, isOperational: isBillingConfigurationOperational(row), completionState: getBillingConfigurationCompletionState(row) };
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
      rows.push({ ...row, isOperational: isBillingConfigurationOperational(row), completionState: getBillingConfigurationCompletionState(row) });
    }
    return rows;
  }, [procedurePrices, tussCodes, tussMappings, tussServices]);

  const activeBillingConfigurations = useMemo(
    () => billingConfigurations.filter((configuration) => configuration.completionState === "active"),
    [billingConfigurations],
  );
  const pendingBillingConfigurations = useMemo(
    () => billingConfigurations.filter((configuration) => configuration.completionState === "awaiting_price"),
    [billingConfigurations],
  );
  const inactiveBillingConfigurations = useMemo(
    () => billingConfigurations.filter((configuration) => configuration.completionState === "inactive"),
    [billingConfigurations],
  );
  const selectedPayerLegacyTussCodes = useMemo(
    () => billingConfigurations
      .filter((configuration) => configuration.completionState !== "inactive")
      .map(getOfficialTussCodeForSetupValidation)
      .filter(isLegacyOrInvalidTussCodeForSetup),
    [billingConfigurations],
  );
  const setupAppointmentDiagnostics = useMemo(() => {
    const payerNameKey = normalizeSetupText(selectedPayer?.name);
    return setupAppointments
      .map((appointment) => {
        const appointmentPayerId = setupEventPayerId(appointment);
        const appointmentPayerNameKey = normalizeSetupText(setupEventPayerName(appointment));
        const payerRelated = (selectedPayerId && appointmentPayerId === selectedPayerId) || (payerNameKey && appointmentPayerNameKey === payerNameKey);
        const reasons = buildSetupPreGuideEligibilityReasons(appointment, selectedPayerId, selectedPayer?.name);
        return { appointment, reasons, eligible: payerRelated && reasons.length === 0, payerRelated };
      })
      .sort((left, right) => {
        const leftAppointment = left.appointment;
        const rightAppointment = right.appointment;
        const leftTime = new Date(leftAppointment?.start || leftAppointment?.scheduledStart || leftAppointment?.scheduled_start || 0).getTime();
        const rightTime = new Date(rightAppointment?.start || rightAppointment?.scheduledStart || rightAppointment?.scheduled_start || 0).getTime();
        return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
      });
  }, [selectedPayer?.name, selectedPayerId, setupAppointments]);
  const setupPayerAppointments = useMemo(
    () => setupAppointmentDiagnostics.filter((item) => item.eligible).map((item) => item.appointment),
    [setupAppointmentDiagnostics],
  );
  const setupIneligibleAppointments = useMemo(
    () => setupAppointmentDiagnostics.filter((item) => !item.eligible),
    [setupAppointmentDiagnostics],
  );
  const setupEligibilitySummary = useMemo(
    () => summarizeSetupEligibilityDiagnostics(setupIneligibleAppointments),
    [setupIneligibleAppointments],
  );
  const setupPatientIdsForPayer = useMemo(
    () => new Set(setupAppointmentDiagnostics.map((item) => setupEventPatientId(item.appointment)).filter(Boolean)),
    [setupAppointmentDiagnostics],
  );
  const setupPatientsForPayer = useMemo(() => {
    if (setupPatientIdsForPayer.size === 0) return setupPatients;
    return setupPatients.filter((patient) => setupPatientIdsForPayer.has(String(patient?.id || patient?.patientId || "").trim()));
  }, [setupPatientIdsForPayer, setupPatients]);
  const setupAppointmentsForSelectedPatient = useMemo(
    () => setupPayerAppointments.filter((appointment) => !setupPatientId || setupEventPatientId(appointment) === setupPatientId),
    [setupPatientId, setupPayerAppointments],
  );
  const setupIneligibleAppointmentsForSelectedPatient = useMemo(
    () => setupIneligibleAppointments.filter((item) => !setupPatientId || setupEventPatientId(item.appointment) === setupPatientId),
    [setupIneligibleAppointments, setupPatientId],
  );
  const selectedSetupAppointment = useMemo(
    () => setupAppointments.find((appointment) => String(appointment?.id || appointment?.appointmentId || appointment?.appointment_id || "") === setupAppointmentId) || null,
    [setupAppointmentId, setupAppointments],
  );
  const payerSetupReadiness = useMemo(
    () => getPayerSetupReadiness({
      payer: selectedPayer,
      tissProfile: payerTissForm,
      tissMissing: selectedPayerTissMissing,
      officialCodeIssues: selectedPayerOfficialCodeIssues,
      activeProcedureCount: activeTussServices.length,
      activeMappingCount: selectedPayerMappingCount,
      readyMappingCount: selectedPayerReadyMappingCount,
      activePriceCount: selectedPayerPriceCount,
      activeBillingConfigurationCount: activeBillingConfigurations.length,
      pendingPriceCount: pendingBillingConfigurations.length,
      hasLegacyTussCode: selectedPayerLegacyTussCodes.length > 0,
      antiGlosaProfileNeedsReview,
      payerTissMessage,
      preGuideTestStatus: setupTestResult.status,
      preGuideTestIssues: setupTestResult.issues,
    }),
    [
      activeBillingConfigurations.length,
      activeTussServices.length,
      antiGlosaProfileNeedsReview,
      payerTissForm,
      payerTissMessage,
      pendingBillingConfigurations.length,
      selectedPayer,
      selectedPayerLegacyTussCodes.length,
      selectedPayerMappingCount,
      selectedPayerReadyMappingCount,
      selectedPayerOfficialCodeIssues,
      selectedPayerPriceCount,
      selectedPayerTissMissing,
      setupTestResult.issues,
      setupTestResult.status,
    ],
  );
  const selectedPayerReadiness = useMemo(() => {
    if (!isInsurancePayer(selectedPayer)) {
      return { label: "TISS não aplicável", className: "bg-slate-100 text-slate-600", issues: [] as string[] };
    }
    const issues = Array.from(new Set([...payerSetupReadiness.blockers, ...payerSetupReadiness.warnings]));
    const className = payerSetupReadiness.overallStatus === "ready_for_xml"
      ? "bg-emerald-50 text-emerald-700"
      : payerSetupReadiness.blockers.length > 0
        ? "bg-rose-50 text-rose-700"
        : "bg-amber-50 text-amber-700";
    return { label: payerSetupReadiness.overallLabel, className, issues };
  }, [payerSetupReadiness, selectedPayer]);
  const activeSetupStep = payerSetupReadiness.steps.find((step) => step.key === activeSetupStepKey) || payerSetupReadiness.steps[0];
  const activeSetupStepIndex = Math.max(0, payerSetupReadiness.steps.findIndex((step) => step.key === activeSetupStep.key));

  const scrollToSetupAdvanced = (stepKey: PayerSetupStepKey) => {
    setAdvancedModeOpen(true);
    const target = ["procedures", "tuss"].includes(stepKey)
      ? payerTussSectionRef.current
      : stepKey === "prices"
        ? payerPricesSectionRef.current
        : ["identification", "clinic", "tiss", "anti_glosa"].includes(stepKey)
          ? payerRulesSectionRef.current
          : null;
    window.setTimeout(() => {
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  const runSetupAdvancedAction = (stepKey: PayerSetupStepKey) => {
    const context = { payerId: selectedPayerId, payerName: selectedPayer?.name || "" };
    if (stepKey === "authorizations" && onNavigateToPatientAuthorizations) {
      onNavigateToPatientAuthorizations(context);
      return;
    }
    if ((stepKey === "test" || stepKey === "ready") && onNavigateToPreGuides) {
      onNavigateToPreGuides(context);
      return;
    }
    scrollToSetupAdvanced(stepKey);
  };

  const selectSetupStep = (stepKey: PayerSetupStepKey) => {
    setActiveSetupStepKey(stepKey);
  };

  const goToAdjacentSetupStep = (direction: -1 | 1) => {
    const next = payerSetupReadiness.steps[activeSetupStepIndex + direction];
    if (next) selectSetupStep(next.key);
  };

  const setupStepStatus = (stepKey: PayerSetupStepKey): SaveActionStatus => setupActionStatus[stepKey] || "idle";

  const setSetupStepStatus = (stepKey: PayerSetupStepKey, status: SaveActionStatus) => {
    setSetupActionStatus((current) => ({ ...current, [stepKey]: status }));
  };

  const runSetupPreGuideTest = async () => {
    if (!setupAppointmentId) {
      setSetupTestResult({
        status: "blocked",
        issues: ["Selecione uma sessão elegível para rodar o teste de Pré-guia."],
        message: "Nenhuma sessão selecionada.",
      });
      return false;
    }
    const result = await dataService.revalidateTissPreGuide(setupAppointmentId);
    if (!result?.success || !result.data) {
      setSetupTestResult({
        status: "blocked",
        issues: [result?.error || "Não foi possível revalidar a Pré-guia de teste."],
        message: "Teste não concluído.",
      });
      return false;
    }
    const preGuide = result.data || {};
    const checklist = preGuide?.antiGlosaChecklist && typeof preGuide.antiGlosaChecklist === "object" ? preGuide.antiGlosaChecklist : {};
    const blockingCount = Number(checklist.blockingCount ?? preGuide.blockingCount ?? 0) || 0;
    const warningCount = Number(checklist.warningCount ?? checklist.attentionCount ?? preGuide.warningCount ?? 0) || 0;
    const preGuideStatus = String(preGuide.status || result?.tissPreGuideStatus || "").toLowerCase();
    const antiGlosaStatus = String(checklist.status || preGuide.antiGlosaStatus || "").toLowerCase();
    const issues = [
      ...(Array.isArray(checklist.items) ? checklist.items : [])
        .filter((item: any) => ["blocking", "warning"].includes(String(item?.severity || "").toLowerCase()))
        .map((item: any) => String(item?.title || item?.description || item?.code || "").trim())
        .filter(Boolean),
      ...(!preGuideStatus || preGuideStatus === "valid" ? [] : [`Pré-guia com status ${preGuide.status}.`]),
    ];
    if (blockingCount > 0 || (preGuideStatus && preGuideStatus !== "valid")) {
      setSetupTestResult({
        status: "blocked",
        issues: issues.length > 0 ? issues : ["Pré-guia de teste ainda possui bloqueios."],
        preGuide,
        message: "Teste concluído com bloqueios.",
      });
      return true;
    }
    if (warningCount > 0 || antiGlosaStatus === "medium_risk" || antiGlosaStatus === "low_risk" || antiGlosaProfileNeedsReview) {
      setSetupTestResult({
        status: "warning",
        issues: issues.length > 0 ? issues : ["Teste aprovado com alerta anti-glosa."],
        preGuide,
        message: "Teste concluído com alerta.",
      });
      return true;
    }
    setSetupTestResult({
      status: "ready",
      issues: [],
      preGuide,
      message: "Teste de Pré-guia aprovado.",
    });
    return true;
  };

  const canAdvanceSetupStep = (stepKey: PayerSetupStepKey) => {
    if (stepKey === "identification") return Boolean(selectedPayerId && isInsurancePayer(selectedPayer) && payerSetupIdentityForm.name.trim().length >= 2 && payerTissForm.ansRegistration.trim());
    if (stepKey === "clinic") {
      const hasProviderIdentifier = payerTissForm.contractedProviderCode.trim() || payerTissForm.operatorProviderCode.trim() || payerTissForm.operatorCode.trim();
      return Boolean(
        selectedPayerId &&
        isInsurancePayer(selectedPayer) &&
        hasProviderIdentifier &&
        !getTissProviderCodeLengthError(payerTissForm.contractedProviderCode) &&
        !getTissProviderCodeLengthError(payerTissForm.operatorProviderCode),
      );
    }
    if (stepKey === "tiss") return Boolean(selectedPayerId && isInsurancePayer(selectedPayer) && payerTissForm.tissVersion === OFFICIAL_TISS_XML_STRATEGY.communicationVersion);
    if (stepKey === "anti_glosa") return Boolean(selectedPayerId && isInsurancePayer(selectedPayer));
    if (stepKey === "procedures") return activeTussServices.length > 0 || tussServiceForm.name.trim().length >= 2;
    if (stepKey === "tuss") return (selectedPayerMappingCount > 0 && selectedPayerReadyMappingCount === selectedPayerMappingCount) || Boolean(tussMappingForm.serviceCatalogId && tussMappingForm.tussCodeId && isValidTissCivilDate(tussMappingForm.validFrom));
    if (stepKey === "prices") return selectedPayerPriceCount > 0 || Boolean(procedurePriceForm.serviceCatalogId && procedurePriceForm.amountCents);
    if (stepKey === "test") return Boolean(setupAppointmentId);
    return true;
  };

  const runSetupPrimaryAction = async () => {
    const stepKey = activeSetupStep.key;
    setSetupStepStatus(stepKey, "loading");
    let saved = true;
    try {
      if (["identification", "clinic", "tiss", "anti_glosa"].includes(stepKey)) {
        if (stepKey === "identification") {
          const payerSaved = await saveSetupPayerIdentity();
          const tissSaved = await savePayerTissProfile();
          saved = payerSaved && tissSaved === true;
        } else {
          saved = await savePayerTissProfile() === true;
        }
      } else if (stepKey === "procedures" && tussServiceForm.name.trim().length >= 2) {
        saved = await createTussService() === true;
      } else if (stepKey === "tuss" && tussMappingForm.serviceCatalogId && tussMappingForm.tussCodeId) {
        saved = await createTussMapping() === true;
      } else if (stepKey === "prices") {
        const profileSaved = await savePayerTissProfile() === true;
        if (!profileSaved) {
          saved = false;
        } else if (procedurePriceForm.serviceCatalogId && procedurePriceForm.amountCents !== "") {
          saved = await saveProcedurePrice() === true;
        }
      } else if (stepKey === "test") {
        saved = await runSetupPreGuideTest() === true;
      }
      if (!saved) {
        setSetupStepStatus(stepKey, "error");
        window.setTimeout(() => setSetupStepStatus(stepKey, "idle"), 2600);
        return;
      }
      setSetupStepStatus(stepKey, "success");
      window.setTimeout(() => {
        setSetupStepStatus(stepKey, "idle");
        goToAdjacentSetupStep(1);
      }, 900);
    } catch {
      setSetupStepStatus(stepKey, "error");
      window.setTimeout(() => setSetupStepStatus(stepKey, "idle"), 2600);
    }
  };

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
      setTussMappingValidFromError("");
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

  const startPriceForMapping = (mapping: PayerTussMapping) => {
    if (!beginEditingSection("price")) return;
    setEditingProcedurePriceId("");
    setProcedurePriceForm({
      ...defaultProcedurePriceForm,
      serviceCatalogId: mapping.serviceCatalogId || "",
      tussCodeId: mapping.tussCodeId || "",
      payerTussMappingId: mapping.id || "",
      validFrom: mapping.validFrom || "",
      validUntil: mapping.validTo || "",
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
      setSelectedPayerId((current) => {
        if (current && rows.some((payer: Payer) => payer.id === current)) return current;
        if (initialPayerId && rows.some((payer: Payer) => payer.id === initialPayerId)) return initialPayerId;
        return rows[0]?.id || "";
      });
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
      const services = servicesResult?.success && Array.isArray(servicesResult.data) ? servicesResult.data : [];
      const codes = codesResult?.success && Array.isArray(codesResult.data) ? codesResult.data : [];
      const mappings = mappingsResult?.success && Array.isArray(mappingsResult.data) ? mappingsResult.data : [];
      const prices = pricesResult?.success && Array.isArray(pricesResult.data) ? pricesResult.data : [];
      setTussServices(services);
      setTussCodes(codes);
      setTussMappings(mappings);
      setProcedurePrices(prices);

      const activeMapping = mappings.find((item: PayerTussMapping) => item.active !== false && !isPayerTussMappingReady(item))
        || mappings.find((item: PayerTussMapping) => item.active !== false)
        || null;
      const activePrice = prices.find((item: PayerProcedurePrice) =>
        item.active !== false && (!activeMapping?.id || item.payerTussMappingId === activeMapping.id),
      ) || prices.find((item: PayerProcedurePrice) => item.active !== false) || null;
      const fallbackServiceId = activeMapping?.serviceCatalogId || services.find((item: TussService) => item.active !== false)?.id || "";
      const fallbackTussCodeId = activeMapping?.tussCodeId || codes.find((item: TussCode) => item.active !== false)?.id || "";

      setTussMappingForm(activeMapping
        ? payerTussMappingToForm(activeMapping)
        : { ...defaultTussMappingForm, serviceCatalogId: fallbackServiceId, tussCodeId: fallbackTussCodeId });
      setTussMappingValidFromError("");
      setEditingTussMappingId(activeMapping?.id || "");
      setProcedurePriceForm(activePrice
        ? payerProcedurePriceToForm(activePrice)
        : {
            ...defaultProcedurePriceForm,
            serviceCatalogId: fallbackServiceId,
            tussCodeId: fallbackTussCodeId,
            payerTussMappingId: activeMapping?.id || "",
          });
      setEditingProcedurePriceId(activePrice?.id || "");
    } finally {
      setTussLoading(false);
    }
  };

  const loadPayerTissProfile = async (payerId: string) => {
    setPayerTissFieldErrors({});
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

  useEffect(() => {
    setActiveSetupStepKey(payerSetupReadiness.currentStepKey);
    // A etapa acompanha o diagnóstico apenas ao trocar de convênio. Digitar ou
    // marcar um campo nunca deve navegar sem a ação explícita de salvar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPayerId]);

  useEffect(() => {
    if (initialPayerId && payers.some((payer) => payer.id === initialPayerId)) {
      setSelectedPayerId(initialPayerId);
    }
  }, [initialPayerId, navigationIntentKey, payers]);

  useEffect(() => {
    setPayerSetupIdentityForm({
      name: selectedPayer?.name || "",
      status: selectedPayer?.status || "ACTIVE",
      notes: selectedPayer?.notes || "",
    });
  }, [selectedPayer]);

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
      return true;
    } finally {
      setSaving(false);
    }
  };

  const saveSetupPayerIdentity = async () => {
    if (!selectedPayerId || payerSetupIdentityForm.name.trim().length < 2) return false;
    setSaving(true);
    setError("");
    try {
      const result = await dataService.updatePayer(selectedPayerId, {
        name: payerSetupIdentityForm.name.trim(),
        payerType: selectedPayer?.payerType || "INSURANCE",
        status: payerSetupIdentityForm.status,
        notes: payerSetupIdentityForm.notes.trim(),
      });
      if (!result?.success || !result.data) {
        setError(result?.error || "Não foi possível salvar a identificação do convênio agora.");
        return false;
      }
      setPayers((current) => current.map((payer) => payer.id === selectedPayerId ? { ...payer, ...(result.data || {}) } : payer));
      return true;
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
    setPayerTissFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setPayerTissMessage("");
  };

  const setOfficialTissVersionConfirmation = (checked: boolean) => {
    setPayerTissForm((current) => ({
      ...current,
      tissVersion: checked ? OFFICIAL_TISS_XML_STRATEGY.communicationVersion : "",
    }));
  };

  const updateAntiGlosaRequirement = (key: keyof PayerTissForm, value: boolean) => {
    setPayerTissForm((current) => ({
      ...current,
      [key]: value,
      operatorHasNoAdditionalRequirements: value ? false : current.operatorHasNoAdditionalRequirements,
    }));
  };

  const updateAntiGlosaReviewed = (value: boolean) => {
    setPayerTissForm((current) => ({
      ...current,
      antiGlosaReviewed: value,
      operatorHasNoAdditionalRequirements: value ? current.operatorHasNoAdditionalRequirements : false,
    }));
  };

  const updateOperatorNoAdditionalRequirements = (value: boolean) => {
    setPayerTissForm((current) => ({
      ...current,
      operatorHasNoAdditionalRequirements: value,
      antiGlosaReviewed: value ? true : current.antiGlosaReviewed,
    }));
  };

  const savePayerTissProfile = async () => {
    if (!selectedPayerId || !isInsurancePayer(selectedPayer)) return false;
    if (payerTissForm.allowsZeroAmountXml && !payerTissForm.zeroAmountXmlReason.trim()) {
      setError("Informe a justificativa operacional para permitir XML com valor R$ 0,00.");
      return false;
    }
    const providerCodeErrors: Partial<Record<keyof PayerTissForm, string>> = {
      contractedProviderCode: getTissProviderCodeLengthError(payerTissForm.contractedProviderCode),
      operatorProviderCode: getTissProviderCodeLengthError(payerTissForm.operatorProviderCode, "Código operacional na operadora"),
    };
    const nextFieldErrors = Object.fromEntries(
      Object.entries(providerCodeErrors).filter(([, message]) => Boolean(message)),
    ) as Partial<Record<keyof PayerTissForm, string>>;
    if (Object.keys(nextFieldErrors).length > 0) {
      setPayerTissFieldErrors(nextFieldErrors);
      setPayerTissMessage("");
      setError("");
      return false;
    }
    setSaving(true);
    setError("");
    setPayerTissMessage("");
    setPayerTissFieldErrors({});
    const savingWithoutAntiGlosaReview = !payerTissForm.antiGlosaReviewed && !payerTissForm.operatorHasNoAdditionalRequirements;
    try {
      const result = await dataService.updatePayerTissProfile(selectedPayerId, payerTissForm);
      if (!result?.success) {
        const message = result?.error || "Não foi possível salvar os dados TISS da operadora agora.";
        if (result?.code === "TISS_PROVIDER_CODE_TOO_LONG") {
          setPayerTissFieldErrors({
            ...(getTissProviderCodeLengthError(payerTissForm.contractedProviderCode) ? { contractedProviderCode: message } : {}),
            ...(getTissProviderCodeLengthError(payerTissForm.operatorProviderCode) ? { operatorProviderCode: message } : {}),
          });
        }
        setError(message);
        return false;
      }
      setPayerTissForm(normalizePayerTissProfile(result.data || payerTissForm));
      setPayerTissMessage(savingWithoutAntiGlosaReview
        ? "Perfil anti-glosa ainda não revisado. As Pré-guias dessa operadora aparecerão com risco médio até a revisão ser confirmada."
        : "Configuração do convênio salva. Pré-guias deste pagador foram atualizadas automaticamente.");
      return true;
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

  useEffect(() => {
    setSetupPatientId("");
    setSetupAppointmentId("");
    setSetupTestResult({ status: "not_tested", issues: [] });
  }, [selectedPayerId]);

  useEffect(() => {
    if (activeSetupStepKey !== "test" || !selectedPayerId) return undefined;
    let cancelled = false;
    const loadSetupTestOptions = async () => {
      setSetupTestLoadState({ loading: true, error: "" });
      const range = currentMonthRange();
      try {
        const [patientsResult, appointmentsResult] = await Promise.all([
          dataService.getPatients(),
          dataService.getCalendarEvents({ from: range.from, to: range.to, view: "month", limit: 120 }),
        ]);
        if (cancelled) return;
        setSetupPatients(patientsResult?.success && Array.isArray(patientsResult.data) ? patientsResult.data : []);
        setSetupAppointments(appointmentsResult?.success && Array.isArray(appointmentsResult.data) ? appointmentsResult.data : []);
        setSetupTestLoadState({
          loading: false,
          error: appointmentsResult?.success ? "" : appointmentsResult?.error || "Não foi possível carregar sessões elegíveis agora.",
        });
      } catch {
        if (cancelled) return;
        setSetupPatients([]);
        setSetupAppointments([]);
        setSetupTestLoadState({ loading: false, error: "Não foi possível carregar sessões elegíveis agora." });
      }
    };
    void loadSetupTestOptions();
    return () => {
      cancelled = true;
    };
  }, [activeSetupStepKey, selectedPayerId]);

  useEffect(() => {
    if (activeSetupStepKey !== "test") return;
    const firstAppointment = setupPayerAppointments[0] || null;
    const currentPatientIsEligible = setupPatientId ? setupPatientIdsForPayer.has(setupPatientId) : false;
    if (!setupPatientId && firstAppointment) {
      setSetupPatientId(setupEventPatientId(firstAppointment));
      return;
    }
    if (setupPatientId && setupPatientIdsForPayer.size > 0 && !currentPatientIsEligible) {
      setSetupPatientId(firstAppointment ? setupEventPatientId(firstAppointment) : "");
      setSetupAppointmentId("");
    }
  }, [activeSetupStepKey, setupPatientId, setupPatientIdsForPayer, setupPayerAppointments]);

  useEffect(() => {
    if (activeSetupStepKey !== "test") return;
    if (setupAppointmentId && setupAppointmentsForSelectedPatient.some((appointment) => String(appointment?.id || appointment?.appointmentId || appointment?.appointment_id || "") === setupAppointmentId)) return;
    const firstAppointment = setupAppointmentsForSelectedPatient[0] || null;
    setSetupAppointmentId(firstAppointment ? String(firstAppointment?.id || firstAppointment?.appointmentId || firstAppointment?.appointment_id || "") : "");
  }, [activeSetupStepKey, setupAppointmentId, setupAppointmentsForSelectedPatient]);

  const createTussService = async () => {
    if (tussServiceForm.name.trim().length < 2) return false;
    const wasEditing = Boolean(editingTussServiceId);
    const rawDefaultAmount = String(tussServiceForm.defaultAmountCents || "").trim();
    const defaultAmountCents = rawDefaultAmount ? parseBrazilianCurrencyToCents(rawDefaultAmount) : null;
    if (rawDefaultAmount && defaultAmountCents === null) {
      setError("Informe o valor padrão em reais, com no máximo duas casas decimais.");
      return false;
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
        return false;
      }
      upsertTussServiceInState(result.data);
      setTussServiceForm(defaultTussServiceForm);
      setEditingTussServiceId("");
      setTussMappingForm((current) => ({ ...current, serviceCatalogId: current.serviceCatalogId || result.data.id }));
      setTussActionInfo(wasEditing ? "Procedimento atualizado." : "Procedimento criado.");
      setLocalFeedback("service", { status: "success", message: "Alterações salvas com sucesso." });
      finishEditingSection("service");
      return true;
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
    if (tussMappingSaveInFlightRef.current || !selectedPayerId || !tussMappingForm.serviceCatalogId) return false;
    const submittedValidFrom = normalizeTissCivilDate(tussMappingForm.validFrom);
    if (!submittedValidFrom) {
      const message = "Informe uma vigência inicial válida antes de salvar o De/Para.";
      setTussMappingValidFromError(message);
      setLocalFeedback("mapping", { status: "error", message });
      return false;
    }
    const existingMapping = resolvePayerTussMappingForForm({
      mappings: tussMappings,
      payerId: selectedPayerId,
      serviceCatalogId: tussMappingForm.serviceCatalogId,
      editingId: editingTussMappingId,
    });
    const targetMappingId = existingMapping?.id || "";
    const wasEditing = Boolean(targetMappingId);
    tussMappingSaveInFlightRef.current = true;
    setSaving(true);
    setError("");
    setTussMappingValidFromError("");
    setTussActionInfo("");
    setLocalFeedback("mapping", { status: "saving", message: "Salvando De/Para..." });
    try {
      const payload = {
        ...tussMappingForm,
        payerId: selectedPayerId,
        validFrom: submittedValidFrom,
        validTo: tussMappingForm.validTo ? normalizeTissCivilDate(tussMappingForm.validTo) : "",
        defaultQuantity: Number(tussMappingForm.defaultQuantity || 1),
        amountCents: undefined,
        negotiatedAmountCents: undefined,
        standardDurationMinutes: tussMappingForm.standardDurationMinutes ? Number(tussMappingForm.standardDurationMinutes) : null,
        contractCode: tussMappingForm.contractCode.trim(),
        contractDescription: tussMappingForm.contractDescription.trim(),
        authorizedCode: tussMappingForm.authorizedCode.trim(),
        authorizedCodeDescription: tussMappingForm.authorizedCodeDescription.trim(),
        billingCode: tussMappingForm.billingCode.trim(),
        billingCodeDescription: tussMappingForm.billingCodeDescription.trim(),
        operatorPackageCode: tussMappingForm.operatorPackageCode.trim(),
        operatorPackageDescription: tussMappingForm.operatorPackageDescription.trim(),
        billingCodeSource: tussMappingForm.billingCodeSource,
        specialty: tussMappingForm.specialty.trim(),
        source: tussMappingForm.source,
        notes: tussMappingForm.notes.trim(),
      };
      const result = targetMappingId
        ? await dataService.updatePayerTussMapping(targetMappingId, payload)
        : await dataService.createPayerTussMapping(payload);
      if (!result?.success || !result.data) {
        const message = result?.error || "Não foi possível salvar o mapeamento agora.";
        setError(message);
        setLocalFeedback("mapping", { status: "error", message });
        return false;
      }
      const persistenceError = getPayerTussMappingPersistenceError({
        persisted: result.data,
        expectedId: targetMappingId || undefined,
        expectedPayerId: selectedPayerId,
        expectedServiceCatalogId: tussMappingForm.serviceCatalogId,
        expectedValidFrom: submittedValidFrom,
      });
      if (persistenceError) {
        setTussMappingValidFromError(persistenceError);
        setError(persistenceError);
        setLocalFeedback("mapping", { status: "error", message: persistenceError });
        return false;
      }
      upsertTussMappingInState(result.data);
      setTussMappingForm(payerTussMappingToForm(result.data));
      setEditingTussMappingId(result.data.id || "");
      setProcedurePriceForm((current) => ({
        ...current,
        serviceCatalogId: result.data.serviceCatalogId || current.serviceCatalogId,
        tussCodeId: result.data.tussCodeId || current.tussCodeId,
        payerTussMappingId: result.data.id || current.payerTussMappingId,
      }));
      setTussActionInfo(wasEditing ? "Mapeamento atualizado." : "Mapeamento criado.");
      setLocalFeedback("mapping", { status: "success", message: "Alterações salvas com sucesso." });
      finishEditingSection("mapping");
      return true;
    } finally {
      setSaving(false);
      tussMappingSaveInFlightRef.current = false;
    }
  };

  const saveProcedurePrice = async () => {
    if (procedurePriceSaveInFlightRef.current || !selectedPayerId || !procedurePriceForm.serviceCatalogId) return false;
    const wasEditing = Boolean(editingProcedurePriceId);
    const amountCents = parseBrazilianCurrencyToCents(procedurePriceForm.amountCents);
    if (amountCents === null) {
      setProcedurePriceAmountError("Informe um valor válido em reais, com no máximo duas casas decimais.");
      procedurePriceAmountInputRef.current?.focus();
      return false;
    }
    if (amountCents === 0 && !payerTissForm.allowsZeroAmountXml) {
      setProcedurePriceAmountError("Ative e justifique a política de XML com valor R$ 0,00 para esta operadora antes de salvar.");
      procedurePriceAmountInputRef.current?.focus();
      return false;
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
        return false;
      }
      upsertProcedurePriceInState(result.data);
      setProcedurePriceForm(payerProcedurePriceToForm(result.data));
      setEditingProcedurePriceId(result.data.id || "");
      setTussActionInfo(wasEditing ? "Valor negociado atualizado." : "Valor negociado cadastrado.");
      setLocalFeedback("price", { status: "success", message: "Alterações salvas com sucesso." });
      finishEditingSection("price");
      return true;
    } finally {
      setSaving(false);
      procedurePriceSaveInFlightRef.current = false;
    }
  };

  const selectTussMappingService = (serviceCatalogId: string) => {
    const existing = resolvePayerTussMappingForForm({
      mappings: tussMappings,
      payerId: selectedPayerId,
      serviceCatalogId,
    });
    if (existing && existing.serviceCatalogId === serviceCatalogId) {
      setEditingTussMappingId(existing.id);
      setTussMappingForm(payerTussMappingToForm(existing));
    } else {
      setEditingTussMappingId("");
      setTussMappingForm((current) => ({
        ...defaultTussMappingForm,
        serviceCatalogId,
        tussCodeId: current.tussCodeId || activeTussCodes[0]?.id || "",
      }));
    }
    setTussMappingValidFromError("");
    clearLocalFeedback("mapping");
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
    setTussMappingForm(payerTussMappingToForm(mapping));
    setTussMappingValidFromError("");
    payerTussSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const editProcedurePrice = (price: PayerProcedurePrice) => {
    if (!beginEditingSection("price")) return;
    setEditingProcedurePriceId(price.id);
    setProcedurePriceForm(payerProcedurePriceToForm(price));
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
    const { key, price, mapping, service, code, isOperational, completionState } = configuration;
    const isAwaitingPrice = completionState === "awaiting_price";
    const validFrom = price?.validFrom || mapping?.validFrom || "";
    const validUntil = price?.validUntil || mapping?.validTo || "";
    const tussCode = code?.code || price?.tussCode || mapping?.tussCode || "";
    const authorizedCode = mapping?.authorizedCode || tussCode;
    const billingCode = mapping?.billingCode || tussCode;
    const operatorPackageCode = mapping?.operatorPackageCode || "";
    const actionMenuOpen = openBillingActionMenuKey === key;
    const inactiveBadges = [
      service?.active !== true ? { key: "procedure_inactive", label: service ? "Procedimento inativo" : "Procedimento ausente" } : null,
      code?.active !== true ? { key: "tuss_inactive", label: code ? "Código TUSS inativo" : "Código TUSS ausente" } : null,
      mapping?.active !== true ? { key: "mapping_inactive", label: mapping ? "De/Para inativo" : "De/Para ausente" } : null,
      price?.active !== true ? { key: "price_inactive", label: price ? "Preço inativo" : "Valor ausente" } : null,
    ].filter(Boolean) as Array<{ key: string; label: string }>;
    return (
      <div key={key} className={`rounded-lg border bg-white p-3 ${isOperational ? "border-emerald-100" : isAwaitingPrice ? "border-amber-100" : "border-slate-200"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900">{service?.name || price?.serviceName || mapping?.serviceName || mapping?.internalCode || "Procedimento não identificado"}</p>
            <p className="mt-1 text-xs text-slate-600">{[`TUSS ${tussCode || "não informado"}`, price ? formatCurrency(price.amountCents) : "Sem valor negociado"].join(" · ")}</p>
            {mapping ? (
              <p className="mt-0.5 text-xs text-slate-500">
                Autorizado {authorizedCode || "não informado"} · Faturado/XML {billingCode || "não informado"}
                {operatorPackageCode ? ` · Pacote ${operatorPackageCode}` : ""}
              </p>
            ) : null}
            <p className="mt-0.5 text-xs text-slate-400">
              {validFrom || validUntil
                ? `Vigência: ${formatBillingDate(validFrom) || "sem início"} a ${formatBillingDate(validUntil) || "sem fim"}`
                : "Vigência não informada"}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className={isOperational
                ? "rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700"
                : isAwaitingPrice
                  ? "rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-800"
                  : "rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700"}
              >
                {isOperational ? "Pronta para novas Pré-guias" : isAwaitingPrice ? "De/Para configurado" : "Configuração inativa"}
              </span>
              {isAwaitingPrice ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  Preço pendente
                </span>
              ) : null}
              {!isOperational && !isAwaitingPrice && inactiveBadges.map((badge) => (
                <span key={badge.key} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  {badge.label}
                </span>
              ))}
            </div>
            {isAwaitingPrice ? <p className="mt-2 text-xs text-amber-700">Próximo passo: cadastrar valor negociado.</p> : null}
          </div>
          <div className="relative flex shrink-0 flex-wrap gap-1.5">
            {(isOperational || isAwaitingPrice) && mapping ? <button type="button" onClick={() => editTussMapping(mapping)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-normal text-slate-600 hover:bg-slate-50">Editar De/Para</button> : null}
            {isOperational && price ? <button type="button" onClick={() => editProcedurePrice(price)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-normal text-slate-600 hover:bg-slate-50">Editar valor</button> : null}
            {isAwaitingPrice && mapping ? <button type="button" onClick={() => startPriceForMapping(mapping)} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-normal text-amber-800 hover:bg-amber-100">Cadastrar valor negociado</button> : null}
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
                {isAwaitingPrice && mapping ? <button type="button" onClick={() => { setOpenBillingActionMenuKey(""); startPriceForMapping(mapping); }} className="block w-full rounded-lg px-3 py-2 text-left text-amber-800 hover:bg-amber-50">Cadastrar valor negociado</button> : null}
                {!isOperational && !isAwaitingPrice && service?.active === false ? <button type="button" onClick={() => { setOpenBillingActionMenuKey(""); void setTussServiceActive(service.id, true); }} className="block w-full rounded-lg px-3 py-2 text-left text-emerald-700 hover:bg-emerald-50">Reativar procedimento</button> : null}
                {!isOperational && !isAwaitingPrice && code?.active === false ? <button type="button" onClick={() => { setOpenBillingActionMenuKey(""); void setTussCodeActive(code.id, true); }} className="block w-full rounded-lg px-3 py-2 text-left text-emerald-700 hover:bg-emerald-50">Reativar código TUSS</button> : null}
                {!isOperational && !isAwaitingPrice && mapping?.active === false ? <button type="button" onClick={() => { setOpenBillingActionMenuKey(""); void setTussMappingActive(mapping.id, true); }} className="block w-full rounded-lg px-3 py-2 text-left text-emerald-700 hover:bg-emerald-50">Reativar De/Para</button> : null}
                {!isOperational && !isAwaitingPrice && price?.active === false ? <button type="button" onClick={() => { setOpenBillingActionMenuKey(""); void setProcedurePriceActive(price.id, true); }} className="block w-full rounded-lg px-3 py-2 text-left text-emerald-700 hover:bg-emerald-50">Reativar preço</button> : null}
                {mapping ? <button type="button" onClick={() => { setOpenBillingActionMenuKey(""); void openDeleteImpactModal("mapping", mapping.id, mapping.contractCode || mapping.serviceName || "Mapeamento De/Para"); }} className="block w-full rounded-lg px-3 py-2 text-left text-rose-700 hover:bg-rose-50">Excluir De/Para</button> : null}
                {price ? <button type="button" onClick={() => { setOpenBillingActionMenuKey(""); void openDeleteImpactModal("price", price.id, price.serviceName || "Valor negociado"); }} className="block w-full rounded-lg px-3 py-2 text-left text-rose-700 hover:bg-rose-50">Excluir preço</button> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const setupStatusClass = (status: PayerSetupStepStatus) => {
    if (status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (status === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
    if (status === "blocked") return "border-rose-200 bg-rose-50 text-rose-700";
    if (status === "not_started") return "border-slate-200 bg-slate-50 text-slate-500";
    return "border-amber-200 bg-white text-amber-700";
  };

  const advancedActionLabel = (stepKey: PayerSetupStepKey) => {
    if (stepKey === "procedures") return "Editar avançado em procedimentos";
    if (stepKey === "tuss") return "Editar avançado em De/Para TUSS";
    if (stepKey === "prices") return "Editar avançado em tabela de valores";
    if (stepKey === "anti_glosa") return "Editar avançado em anti-glosa";
    if (["identification", "clinic", "tiss"].includes(stepKey)) return "Editar avançado em dados TISS";
    if (stepKey === "authorizations") return "Abrir Autorizações dos pacientes no menu";
    if (stepKey === "test" || stepKey === "ready") return "Abrir Pré-Guias TISS no menu";
    return "Editar avançado";
  };

  const setupStepGuidance = (stepKey: PayerSetupStepKey) => {
    if (stepKey === "tiss") {
      return `Comunicação ${OFFICIAL_TISS_XML_STRATEGY.communicationVersion} · Estrutura ${OFFICIAL_TISS_XML_STRATEGY.contentStructureVersion} · TUSS ${OFFICIAL_TISS_XML_STRATEGY.tussVersion}.`;
    }
    if (stepKey === "authorizations") {
      return "Esta etapa orienta o cadastro; a validação de autorização acontece na Pré-guia da sessão.";
    }
    if (stepKey === "test") {
      return "Use uma sessão real ou de teste para confirmar TISS técnico, De/Para, preço, autorização e anti-glosa antes do lote.";
    }
    if (stepKey === "ready") {
      return "Quando o teste de Pré-guia estiver aprovado, siga para Pré-Guias TISS e gere o XML como antes.";
    }
    return "Agora faça isso e depois avance para a próxima etapa.";
  };

  const setupPrimaryLabel = (stepKey: PayerSetupStepKey) => {
    if (["identification", "clinic", "tiss", "procedures", "tuss", "prices", "authorizations", "anti_glosa"].includes(stepKey)) return "Salvar e continuar";
    if (stepKey === "test") return "Rodar teste de Pré-guia";
    if (stepKey === "ready") return "Ir para Pré-Guias TISS";
    return "Salvar e continuar";
  };

  const setupFieldClass = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100";

  const renderSetupCheckbox = (checked: boolean, onChange: (checked: boolean) => void, label: string, helper?: string) => (
    <label className="flex gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-[#7a32fc] focus:ring-[#7a32fc]"
      />
      <span>
        <span className="block font-medium text-slate-800">{label}</span>
        {helper ? <span className="mt-1 block text-xs leading-5 text-slate-500">{helper}</span> : null}
      </span>
    </label>
  );

  const renderSetupStepFields = () => {
    const selectedMappingTussCode = tussCodes.find((code) => code.id === tussMappingForm.tussCodeId) || null;
    const selectedPriceTussCode = tussCodes.find((code) => code.id === procedurePriceForm.tussCodeId) || null;
    const selectedPriceMapping = tussMappings.find((mapping) => mapping.id === procedurePriceForm.payerTussMappingId) || null;
    const selectedProcedure = tussServices.find((service) => service.id === tussMappingForm.serviceCatalogId || service.id === procedurePriceForm.serviceCatalogId) || null;
    const selectedCodeText = selectedMappingTussCode?.code || "";
    const hasLegacySetupCode = isLegacyOrInvalidTussCodeForSetup(selectedCodeText);

    if (activeSetupStep.key === "identification") {
      return (
        <div className="mt-4 rounded-2xl border border-indigo-50 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Dados principais</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Nome da operadora</span>
              <input value={payerSetupIdentityForm.name} onChange={(event) => setPayerSetupIdentityForm((current) => ({ ...current, name: event.target.value }))} className={setupFieldClass} placeholder="Ex.: Amil" />
            </label>
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Registro ANS</span>
              <input value={payerTissForm.ansRegistration} onChange={(event) => updatePayerTiss("ansRegistration", event.target.value)} className={setupFieldClass} placeholder="Ex.: 326305" />
            </label>
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">CNPJ da operadora</span>
              <input value={payerTissForm.operatorDocumentNumber} onChange={(event) => updatePayerTiss("operatorDocumentNumber", event.target.value)} className={setupFieldClass} placeholder="Opcional" />
            </label>
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Status</span>
              <select value={payerSetupIdentityForm.status} onChange={(event) => setPayerSetupIdentityForm((current) => ({ ...current, status: event.target.value }))} className={setupFieldClass}>
                <option value="ACTIVE">Ativo</option>
                <option value="INACTIVE">Inativo</option>
              </select>
            </label>
          </div>
        </div>
      );
    }

    if (activeSetupStep.key === "clinic") {
      return (
        <div className="mt-4 rounded-2xl border border-indigo-50 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Como a clínica aparece para a operadora</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Código da clínica/prestador na operadora</span>
              <input
                value={payerTissForm.contractedProviderCode}
                onChange={(event) => updatePayerTiss("contractedProviderCode", event.target.value)}
                aria-invalid={Boolean(payerTissFieldErrors.contractedProviderCode)}
                aria-describedby={payerTissFieldErrors.contractedProviderCode ? "setup-contracted-provider-code-error" : undefined}
                className={`${setupFieldClass} ${payerTissFieldErrors.contractedProviderCode ? "border-rose-400 focus:border-rose-400 focus:ring-rose-100" : ""}`}
                placeholder="Informe o código contratual"
              />
              <span className="mt-1 block text-[11px] leading-4 text-slate-500">Até 14 caracteres; o valor é validado sem truncamento.</span>
              {payerTissFieldErrors.contractedProviderCode ? <span id="setup-contracted-provider-code-error" className="mt-1 block text-[11px] leading-4 text-rose-600">{payerTissFieldErrors.contractedProviderCode}</span> : null}
            </label>
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Nome contratado</span>
              <input value={payerTissForm.contractedExecutant} onChange={(event) => updatePayerTiss("contractedExecutant", event.target.value)} className={setupFieldClass} placeholder="Nome da clínica no contrato" />
            </label>
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Código operacional na operadora</span>
              <input
                value={payerTissForm.operatorProviderCode}
                onChange={(event) => updatePayerTiss("operatorProviderCode", event.target.value)}
                aria-invalid={Boolean(payerTissFieldErrors.operatorProviderCode)}
                aria-describedby={payerTissFieldErrors.operatorProviderCode ? "setup-operator-provider-code-error" : undefined}
                className={`${setupFieldClass} ${payerTissFieldErrors.operatorProviderCode ? "border-rose-400 focus:border-rose-400 focus:ring-rose-100" : ""}`}
                placeholder="Se houver outro código de envio"
              />
              <span className="mt-1 block text-[11px] leading-4 text-slate-500">Até 14 caracteres; o valor é validado sem truncamento.</span>
              {payerTissFieldErrors.operatorProviderCode ? <span id="setup-operator-provider-code-error" className="mt-1 block text-[11px] leading-4 text-rose-600">{payerTissFieldErrors.operatorProviderCode}</span> : null}
            </label>
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Código da operadora</span>
              <input value={payerTissForm.operatorCode} onChange={(event) => updatePayerTiss("operatorCode", event.target.value)} className={setupFieldClass} placeholder="Código interno/portal, se usado" />
            </label>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">CNES e dados fiscais da clínica continuam no cadastro da clínica; aqui ficam os identificadores específicos deste convênio.</p>
        </div>
      );
    }

    if (activeSetupStep.key === "tiss") {
      const confirmed = payerTissForm.tissVersion === OFFICIAL_TISS_XML_STRATEGY.communicationVersion;
      return (
        <div className="mt-4 rounded-2xl border border-indigo-50 bg-white p-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-widest text-slate-400">Comunicação</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{OFFICIAL_TISS_XML_STRATEGY.communicationVersion}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-widest text-slate-400">Conteúdo/Estrutura</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{OFFICIAL_TISS_XML_STRATEGY.contentStructureVersion}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-widest text-slate-400">TUSS</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{OFFICIAL_TISS_XML_STRATEGY.tussVersion}</p>
            </div>
          </div>
          <div className="mt-3">
            {renderSetupCheckbox(confirmed, setOfficialTissVersionConfirmation, "Confirmei que a operadora aceita este padrão TISS", "A versão é oficial e gerenciada pelo Verto; esta etapa só registra a confirmação operacional.")}
          </div>
        </div>
      );
    }

    if (activeSetupStep.key === "procedures") {
      return (
        <div className="mt-4 rounded-2xl border border-indigo-50 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Procedimentos atendidos</p>
          <div className="mt-3 grid gap-2">
            {activeTussServices.length > 0 ? activeTussServices.slice(0, 5).map((service) => {
              const dependencies = getProcedureSetupDependencyLabels({ serviceId: service.id, mappings: tussMappings, prices: procedurePrices });
              const explanation = dependencies.length > 0
                ? `Não pode ser removido nesta etapa porque possui ${dependencies.join(" e ")}.`
                : "Procedimento ativo no catálogo da clínica. A inativação é feita no modo avançado, que verifica vínculos de todos os convênios e documentos antes de alterar.";
              return (
                <div key={service.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked readOnly disabled aria-label={`${service.name}: ativo e protegido contra remoção sem conferência`} className="h-4 w-4 rounded border-slate-300 text-[#7a32fc] disabled:cursor-not-allowed disabled:opacity-70" />
                    <span className="min-w-0 truncate">{service.name}</span>
                    <span className="ml-auto rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-600">Ativo</span>
                  </div>
                  <p className="mt-1 pl-6 text-[11px] leading-4 text-slate-500">{explanation}</p>
                </div>
              );
            }) : (
              <p className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">Nenhum procedimento faturável ativo encontrado. Cadastre o primeiro procedimento abaixo.</p>
            )}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-normal text-slate-700 md:col-span-2">
              <span className="mb-1 block">Adicionar procedimento ao convênio</span>
              <input value={tussServiceForm.name} onChange={(event) => setTussServiceForm((current) => ({ ...current, name: event.target.value }))} className={setupFieldClass} placeholder="Ex.: Sessão ABA individual" />
            </label>
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Código interno</span>
              <input value={tussServiceForm.internalCode} onChange={(event) => setTussServiceForm((current) => ({ ...current, internalCode: event.target.value }))} className={setupFieldClass} placeholder="Opcional" />
            </label>
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Tipo de serviço</span>
              <input value={tussServiceForm.serviceType} onChange={(event) => setTussServiceForm((current) => ({ ...current, serviceType: event.target.value }))} className={setupFieldClass} placeholder="Ex.: ABA" />
            </label>
          </div>
        </div>
      );
    }

    if (activeSetupStep.key === "tuss") {
      return (
        <div className="mt-4 rounded-2xl border border-indigo-50 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Procedimento interno para código TUSS</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Procedimento interno</span>
              <select value={tussMappingForm.serviceCatalogId} onChange={(event) => selectTussMappingService(event.target.value)} className={setupFieldClass}>
                <option value="">Selecione</option>
                {activeTussServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Código TUSS</span>
              <select value={tussMappingForm.tussCodeId} onChange={(event) => setTussMappingForm((current) => ({ ...current, tussCodeId: event.target.value }))} className={setupFieldClass}>
                <option value="">Selecione</option>
                {activeTussCodes.map((code) => <option key={code.id} value={code.id}>{code.code} - {code.description}</option>)}
              </select>
            </label>
            <label className="text-xs font-normal text-slate-700 md:col-span-2">
              <span className="mb-1 block">Descrição TUSS</span>
              <input value={selectedMappingTussCode?.description || ""} readOnly className={`${setupFieldClass} bg-slate-50 text-slate-600`} placeholder="Selecione um código TUSS oficial" />
            </label>
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Código no contrato, se diferente</span>
              <input value={tussMappingForm.contractCode} onChange={(event) => setTussMappingForm((current) => ({ ...current, contractCode: event.target.value }))} className={setupFieldClass} placeholder="Opcional" />
            </label>
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Vigência inicial</span>
              <input
                type="date"
                value={tussMappingForm.validFrom}
                aria-invalid={Boolean(tussMappingValidFromError)}
                aria-describedby={tussMappingValidFromError ? "setup-mapping-valid-from-error" : undefined}
                onChange={(event) => { setTussMappingForm((current) => ({ ...current, validFrom: event.target.value })); setTussMappingValidFromError(""); clearLocalFeedback("mapping"); }}
                className={`${setupFieldClass} ${tussMappingValidFromError ? "border-rose-400 focus:border-rose-400 focus:ring-rose-100" : ""}`}
              />
              {tussMappingValidFromError ? <span id="setup-mapping-valid-from-error" className="mt-1 block text-[11px] leading-4 text-rose-600">{tussMappingValidFromError}</span> : null}
            </label>
          </div>
          {hasLegacySetupCode ? <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">Código TUSS legado/inadequado para XML. Use um código oficial, como 50000470 quando aplicável ao procedimento.</div> : null}
          {selectedProcedure ? <p className="mt-3 text-xs text-slate-500">Procedimento selecionado: {selectedProcedure.name}</p> : null}
        </div>
      );
    }

    if (activeSetupStep.key === "prices") {
      return (
        <div className="mt-4 rounded-2xl border border-indigo-50 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Valores negociados</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Procedimento</span>
              <select value={procedurePriceForm.serviceCatalogId} onChange={(event) => setProcedurePriceForm((current) => ({ ...current, serviceCatalogId: event.target.value }))} className={setupFieldClass}>
                <option value="">Selecione</option>
                {activeTussServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">TUSS</span>
              <select value={procedurePriceForm.tussCodeId} onChange={(event) => setProcedurePriceForm((current) => ({ ...current, tussCodeId: event.target.value }))} className={setupFieldClass}>
                <option value="">Selecione</option>
                {activeTussCodes.map((code) => <option key={code.id} value={code.id}>{code.code} - {code.description}</option>)}
              </select>
            </label>
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Valor negociado</span>
              <input inputMode="decimal" value={procedurePriceForm.amountCents} onChange={(event) => { setProcedurePriceForm((current) => ({ ...current, amountCents: event.target.value })); setProcedurePriceAmountError(""); }} className={setupFieldClass} placeholder="Ex.: 120,00" />
              {procedurePriceAmountError ? <span className="mt-1 block text-[11px] text-rose-600">{procedurePriceAmountError}</span> : null}
            </label>
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Vínculo De/Para</span>
              <select
                value={procedurePriceForm.payerTussMappingId}
                onChange={(event) => {
                  const mapping = tussMappings.find((item) => item.id === event.target.value);
                  setProcedurePriceForm((current) => ({
                    ...current,
                    payerTussMappingId: event.target.value,
                    serviceCatalogId: mapping?.serviceCatalogId || current.serviceCatalogId,
                    tussCodeId: mapping?.tussCodeId || current.tussCodeId,
                  }));
                }}
                className={setupFieldClass}
              >
                <option value="">Sem vínculo direto</option>
                {tussMappings.filter((mapping) => mapping.active === true).map((mapping) => <option key={mapping.id} value={mapping.id}>{mapping.serviceName || "Procedimento"} {mapping.tussCode ? `· TUSS ${mapping.tussCode}` : ""}</option>)}
              </select>
            </label>
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Vigência inicial</span>
              <input type="date" value={procedurePriceForm.validFrom} onChange={(event) => setProcedurePriceForm((current) => ({ ...current, validFrom: event.target.value }))} className={setupFieldClass} />
            </label>
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Vigência final opcional</span>
              <input type="date" value={procedurePriceForm.validUntil} onChange={(event) => setProcedurePriceForm((current) => ({ ...current, validUntil: event.target.value }))} className={setupFieldClass} />
            </label>
          </div>
          <div className={`mt-3 rounded-xl border px-3 py-3 ${payerTissForm.allowsZeroAmountXml ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={payerTissForm.allowsZeroAmountXml}
                onChange={(event) => updatePayerTiss("allowsZeroAmountXml", event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#7a32fc] focus:ring-[#7a32fc]"
              />
              <span>
                <strong className="block font-semibold text-slate-900">A operadora calcula o valor após importar o XML</strong>
                Permitir valor unitário e total em R$ 0,00 somente para este convênio. A exceção ficará registrada na Pré-guia e no documento oficial.
              </span>
            </label>
            {payerTissForm.allowsZeroAmountXml ? (
              <label className="mt-3 block text-xs font-normal text-slate-700">
                <span className="mb-1 block">Justificativa obrigatória</span>
                <input
                  value={payerTissForm.zeroAmountXmlReason}
                  onChange={(event) => updatePayerTiss("zeroAmountXmlReason", event.target.value)}
                  className={setupFieldClass}
                  placeholder="Ex.: Vivest calcula o valor contratado no portal após a importação"
                />
              </label>
            ) : null}
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Informe o valor contratado para este procedimento. Quando a política acima estiver explicitamente ativa, R$ 0,00 será aceito com alerta e enviado como 0.00 no XML.
            {selectedPriceTussCode ? ` TUSS selecionado: ${selectedPriceTussCode.code}.` : ""}
            {selectedPriceMapping ? ` De/Para: ${selectedPriceMapping.serviceName || selectedPriceMapping.contractCode || "selecionado"}.` : ""}
          </p>
        </div>
      );
    }

    if (activeSetupStep.key === "authorizations") {
      return (
        <div className="mt-4 rounded-2xl border border-indigo-50 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Autorizações dos pacientes</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Vigentes</p><p className="text-lg font-semibold text-slate-900">Ver no painel</p></div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Vencidas</p><p className="text-lg font-semibold text-slate-900">Revisar</p></div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Sem autorização</p><p className="text-lg font-semibold text-slate-900">Cadastrar quando houver paciente</p></div>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">A autorização conecta paciente, convênio, procedimento, guia, senha, validade e quantidade autorizada. O convênio pode avançar sem cadastrar todas agora; a Pré-guia valida cada sessão.</p>
        </div>
      );
    }

    if (activeSetupStep.key === "anti_glosa") {
      return (
        <div className="mt-4 rounded-2xl border border-indigo-50 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Exigências anti-glosa da operadora</p>
          <div className="mt-3 grid gap-2">
            {renderSetupCheckbox(payerTissForm.antiGlosaReviewed, updateAntiGlosaReviewed, "Revisei as exigências anti-glosa desta operadora")}
            {renderSetupCheckbox(payerTissForm.operatorHasNoAdditionalRequirements, updateOperatorNoAdditionalRequirements, "Esta operadora não possui exigências adicionais além do TISS padrão e do contrato cadastrado")}
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {[
              ["requiresBeneficiaryCard", "Carteirinha obrigatória"],
              ["requiresAuthorization", "Autorização obrigatória"],
              ["requiresAuthorizationPassword", "Senha obrigatória"],
              ["requiresGuideNumber", "Guia da operadora obrigatória"],
              ["requiresProviderCode", "Código do prestador obrigatório"],
              ["requiresCnes", "CNES obrigatório"],
              ["requiresCbo", "CBOS obrigatório"],
              ["requiresAdministrativeReport", "Relatório/anexo obrigatório"],
              ["requiresResponsibleSignature", "Assinatura obrigatória"],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <input type="checkbox" checked={Boolean((payerTissForm as any)[key])} onChange={(event) => updateAntiGlosaRequirement(key as keyof PayerTissForm, event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-[#7a32fc] focus:ring-[#7a32fc]" />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      );
    }

    if (activeSetupStep.key === "test") {
      const selectedProfessionalName = setupEventResolvedProfessionalName(selectedSetupAppointment);
      const selectedProfessionalId = setupEventResolvedProfessionalId(selectedSetupAppointment);
      const selectedRoomName = setupEventResolvedRoomName(selectedSetupAppointment);
      const selectedRoomId = setupEventResolvedRoomId(selectedSetupAppointment);
      const preGuide = setupTestResult.preGuide || null;
      const checklist = preGuide?.antiGlosaChecklist && typeof preGuide.antiGlosaChecklist === "object" ? preGuide.antiGlosaChecklist : {};
      const technicalStatus = preGuide?.status === "valid" ? "Válida" : preGuide ? "Com pendências" : "Aguardando teste";
      const antiGlosaStatus = setupTestResult.status === "blocked"
        ? "Bloqueada"
        : setupTestResult.status === "warning"
          ? "Risco médio"
          : setupTestResult.status === "ready"
            ? "Pronta"
            : antiGlosaProfileNeedsReview ? "Risco médio" : "Aguardando teste";
      const xmlDecision = setupTestResult.status === "blocked"
        ? "Não pode gerar"
        : setupTestResult.status === "warning"
          ? "Pode gerar com alerta"
          : setupTestResult.status === "ready"
            ? "Pode gerar"
            : "Aguardando teste";
      return (
        <div className="mt-4 rounded-2xl border border-indigo-50 bg-white p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Teste de Pré-guia</p>
            {setupTestLoadState.loading ? (
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-700"><Loader2 size={14} className="animate-spin" />Carregando sessões</span>
            ) : null}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Paciente</span>
              <select
                value={setupPatientId}
                onChange={(event) => {
                  setSetupPatientId(event.target.value);
                  setSetupAppointmentId("");
                  setSetupTestResult({ status: "not_tested", issues: [] });
                }}
                className={setupFieldClass}
              >
                <option value="">Selecione</option>
                {setupPatientsForPayer.map((patient) => <option key={patient.id || patient.patientId} value={patient.id || patient.patientId}>{patient.name || patient.fullName || patient.full_name || "Paciente"}</option>)}
              </select>
            </label>
            <label className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Sessão/atendimento</span>
              <select
                value={setupAppointmentId}
                onChange={(event) => {
                  setSetupAppointmentId(event.target.value);
                  setSetupTestResult({ status: "not_tested", issues: [] });
                }}
                className={setupFieldClass}
              >
                <option value="">Selecione</option>
                {setupAppointmentsForSelectedPatient.map((appointment) => {
                  const id = String(appointment?.id || appointment?.appointmentId || appointment?.appointment_id || "");
                  return <option key={id} value={id}>{formatSetupSessionDateTime(appointment)} - {setupEventPatientName(appointment)} - {setupEventProcedureName(appointment)}</option>;
                })}
              </select>
            </label>
          </div>
          {setupTestLoadState.error ? <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">{setupTestLoadState.error}</div> : null}
          {!setupTestLoadState.loading && setupPayerAppointments.length === 0 && setupIneligibleAppointments.length > 0 ? (
            <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-semibold">Sessões encontradas, mas não elegíveis:</p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {setupEligibilitySummary.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}
          {!setupTestLoadState.loading && setupPayerAppointments.length === 0 && setupIneligibleAppointments.length === 0 ? (
            <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Nenhuma sessão encontrada para este paciente e período.
            </div>
          ) : null}
          {setupIneligibleAppointmentsForSelectedPatient.length > 0 ? (
            <div className="mt-3 rounded-xl border border-slate-100 bg-white px-3 py-2 text-sm text-slate-700">
              <p className="font-semibold">Sessões não elegíveis deste paciente</p>
              <div className="mt-2 space-y-2">
                {setupIneligibleAppointmentsForSelectedPatient.slice(0, 4).map((item) => {
                  const appointment = item.appointment;
                  const id = String(appointment?.id || appointment?.appointmentId || appointment?.appointment_id || formatSetupSessionDateTime(appointment));
                  return (
                    <div key={id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                      <p className="font-semibold text-slate-800">{formatSetupSessionDateTime(appointment)} - {setupEventResolvedPatientName(appointment)}</p>
                      <p className="mt-1 text-slate-500">{item.reasons.join(" ")}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Convênio/pagador selecionado</p><p className="text-sm font-semibold text-slate-900">{selectedPayer?.name || "Selecione um convênio"}</p></div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Procedimento</p><p className="text-sm font-semibold text-slate-900">{selectedSetupAppointment ? setupEventProcedureName(selectedSetupAppointment) : "Selecione uma sessão"}</p></div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Data/hora da sessão</p><p className="text-sm font-semibold text-slate-900">{selectedSetupAppointment ? formatSetupSessionDateTime(selectedSetupAppointment) : "Selecione uma sessão"}</p></div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Profissional</p><p className={`text-sm font-semibold ${selectedProfessionalName || selectedProfessionalId ? "text-slate-900" : "text-amber-800"}`}>{selectedProfessionalName || (selectedProfessionalId ? "Profissional cadastrado não carregado" : "Profissional não definido")}</p></div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Sala/local</p><p className={`text-sm font-semibold ${selectedRoomName || selectedRoomId ? "text-slate-900" : "text-amber-800"}`}>{selectedRoomName || (selectedRoomId ? "Sala cadastrada não carregada" : "Sala/local não definido")}</p></div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Pré-guia</p><p className="text-sm font-semibold text-slate-900">{preGuide?.id ? `ID ${String(preGuide.id).slice(0, 8)}` : "Ainda não testada"}</p></div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">TISS técnico</p><p className="text-sm font-semibold text-slate-900">{technicalStatus}</p></div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Anti-glosa</p><p className="text-sm font-semibold text-slate-900">{antiGlosaStatus}</p></div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">XML</p><p className="text-sm font-semibold text-slate-900">{xmlDecision}</p></div>
          </div>
          {setupTestResult.message ? <p className="mt-3 text-sm font-semibold text-slate-700">{setupTestResult.message}</p> : null}
          {setupTestResult.issues.length > 0 ? (
            <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {setupTestResult.issues.join(" ")}
            </div>
          ) : null}
          {Number(checklist.blockingCount || 0) > 0 ? <p className="mt-2 text-xs text-rose-700">A Pré-guia de teste ainda tem {Number(checklist.blockingCount || 0)} bloqueio(s).</p> : null}
        </div>
      );
    }

    if (activeSetupStep.key === "ready") {
      const isReady = payerSetupReadiness.overallStatus === "ready_for_xml";
      const isReadyWithWarning = payerSetupReadiness.overallStatus === "ready_for_xml_with_warning";
      const title = isReady
        ? "Convênio pronto para XML"
        : isReadyWithWarning
          ? "Convênio pronto para XML com alerta"
          : "Configuração ainda não está pronta para XML";
      const summaryItems = [
        ["Identificação da operadora", payerSetupReadiness.steps.find((step) => step.key === "identification")?.status],
        ["Dados da clínica", payerSetupReadiness.steps.find((step) => step.key === "clinic")?.status],
        ["Padrão TISS", payerSetupReadiness.steps.find((step) => step.key === "tiss")?.status],
        ["Procedimentos", payerSetupReadiness.steps.find((step) => step.key === "procedures")?.status],
        ["TUSS/DePara", payerSetupReadiness.steps.find((step) => step.key === "tuss")?.status],
        ["Valores", payerSetupReadiness.steps.find((step) => step.key === "prices")?.status],
        ["Autorizações", payerSetupReadiness.steps.find((step) => step.key === "authorizations")?.status],
        ["Anti-glosa", payerSetupReadiness.steps.find((step) => step.key === "anti_glosa")?.status],
        ["Teste de Pré-guia", payerSetupReadiness.steps.find((step) => step.key === "test")?.status],
      ];
      return (
        <div className={`mt-4 rounded-2xl border p-3 ${isReady ? "border-emerald-100 bg-emerald-50" : isReadyWithWarning ? "border-amber-100 bg-amber-50" : "border-rose-100 bg-rose-50"}`}>
          <p className={`text-sm font-semibold ${isReady ? "text-emerald-900" : isReadyWithWarning ? "text-amber-900" : "text-rose-900"}`}>{title}</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {summaryItems.map(([item, status]) => (
              <span key={item} className={`inline-flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-sm ${status === "ready" ? "text-emerald-800" : status === "warning" ? "text-amber-800" : "text-rose-800"}`}>
                <span className="inline-flex items-center gap-2"><CheckCircle2 size={15} />{item}</span>
                <span className="text-xs font-semibold">{setupStatusLabel[(status || "incomplete") as PayerSetupStepStatus]}</span>
              </span>
            ))}
          </div>
          {payerSetupReadiness.blockers.length > 0 ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm text-rose-800">
              {payerSetupReadiness.blockers.join(" ")}
            </div>
          ) : null}
          {payerSetupReadiness.warnings.length > 0 ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-amber-800">
              {payerSetupReadiness.warnings.join(" ")}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-xl border border-white bg-white px-3 py-2 text-xs font-semibold text-slate-700">Ir para Pré-Guias TISS</span>
            <span className="rounded-xl border border-white bg-white px-3 py-2 text-xs font-semibold text-slate-700">Gerar lote XML</span>
            <span className="rounded-xl border border-white bg-white px-3 py-2 text-xs font-semibold text-slate-700">Ver lotes XML</span>
          </div>
        </div>
      );
    }

    return null;
  };

  const renderPayerSetupWizard = () => (
    <div
      data-payer-setup-wizard
      className={`mt-4 rounded-3xl border p-4 ${
        theme === "dark"
          ? "border-slate-700 bg-[#16243b]"
          : "border-indigo-100 bg-gradient-to-br from-white to-indigo-50/40"
      }`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-500">Esteira de configuração</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-950">Configurar convênio até ficar pronto para XML</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            Siga uma sequência única para sair do cadastro da operadora até o teste de Pré-guia, sem alternar entre topo, meio e fim da tela.
          </p>
        </div>
        <span className={`inline-flex w-fit rounded-full border px-3 py-1.5 text-xs font-semibold ${setupStatusClass(activeSetupStep.status)}`}>
          {payerSetupReadiness.overallLabel}
        </span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(240px,0.42fr)_minmax(0,1fr)] xl:grid-cols-[minmax(260px,0.36fr)_minmax(0,1fr)]">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          {payerSetupReadiness.steps.map((step, index) => (
            <button
              key={step.key}
              type="button"
              onClick={() => selectSetupStep(step.key)}
              className={`flex items-start gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                step.key === activeSetupStep.key
                  ? "border-indigo-200 bg-white shadow-sm"
                  : "border-transparent bg-white/60 hover:bg-white"
              }`}
            >
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${setupStatusClass(step.status)}`}>
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-900">{step.title}</span>
                <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${setupStatusClass(step.status)}`}>
                  {setupStatusLabel[step.status]}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-white bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Etapa {activeSetupStepIndex + 1}</p>
              <h4 className="mt-1 text-base font-semibold text-slate-950">{activeSetupStep.title}</h4>
              <p className="mt-1 text-sm leading-6 text-slate-600">{activeSetupStep.shortDescription}</p>
            </div>
            <span className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${setupStatusClass(activeSetupStep.status)}`}>
              {setupStatusLabel[activeSetupStep.status]}
            </span>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Agora faça isso</p>
            <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-700">
              {activeSetupStep.requiredActions.map((action) => (
                <li key={action} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#7a32fc]" />
                  <span>{action}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-5 text-slate-500">{setupStepGuidance(activeSetupStep.key)}</p>
          </div>

          {renderSetupStepFields()}

          {activeSetupStep.blockingReasons && activeSetupStep.blockingReasons.length > 0 ? (
            <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {activeSetupStep.blockingReasons.join(" ")}
            </div>
          ) : null}

          {activeSetupStep.warnings && activeSetupStep.warnings.length > 0 ? (
            <div className="mt-3 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {activeSetupStep.warnings.join(" ")}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => goToAdjacentSetupStep(-1)}
              disabled={activeSetupStepIndex === 0}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-40"
            >
              Voltar
            </button>
            <SaveActionButton
              status={setupStepStatus(activeSetupStep.key)}
              idleLabel={setupPrimaryLabel(activeSetupStep.key)}
              loadingLabel={activeSetupStep.key === "test" ? "Testando..." : "Salvando..."}
              successLabel={activeSetupStep.key === "test" ? "Teste concluído" : "Salvo"}
              errorLabel={setupPrimaryLabel(activeSetupStep.key)}
              disabled={saving || !canAdvanceSetupStep(activeSetupStep.key)}
              onClick={() => void runSetupPrimaryAction()}
            />
            <button
              type="button"
              onClick={() => runSetupAdvancedAction(activeSetupStep.key)}
              className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700"
            >
              {advancedActionLabel(activeSetupStep.key)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

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

      <div className="mt-5 space-y-5">
        <div className="rounded-3xl border border-slate-100 bg-white p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 lg:w-72 lg:shrink-0">
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

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Convênios cadastrados</p>
                <p className="mt-1 text-xs text-slate-500">Escolha um convênio para seguir a esteira abaixo.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{payers.length} cadastrado(s)</span>
            </div>
            <div data-payer-list-grid className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {loading && payers.length === 0 ? (
              <p className="rounded-2xl bg-white p-4 text-sm font-semibold text-slate-500">Carregando convênios...</p>
            ) : payers.length === 0 ? (
              <p className="rounded-2xl bg-white p-4 text-sm font-semibold text-slate-500">Nenhum convênio configurado.</p>
            ) : payers.map((payer) => {
              const isSelected = payer.id === selectedPayerId;
              return (
              <button
                key={payer.id}
                type="button"
                onClick={() => setSelectedPayerId(payer.id)}
                data-payer-card
                aria-pressed={isSelected}
                className={`min-h-[132px] w-full rounded-2xl border px-4 py-3 text-left transition ${
                  isSelected
                    ? "border-[#7a32fc] bg-violet-50 text-slate-950 shadow-sm"
                    : "border-slate-100 bg-white text-slate-700 hover:border-violet-100 hover:bg-violet-50/40"
                }`}
              >
                <span className="block text-sm font-bold">{payer.name}</span>
                <span className="mt-1 block text-xs text-slate-500">{payerTypeLabels[payer.payerType] || "Pagador"} · {payer.status === "ACTIVE" ? "Ativo" : "Inativo"}</span>
                <span className={`mt-3 inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${isSelected ? selectedPayerReadiness.className : "bg-slate-100 text-slate-600"}`}>
                  {isSelected ? selectedPayerReadiness.label : "Selecionar para configurar"}
                </span>
                {isSelected ? (
                  <span className="mt-3 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-600">{selectedPayerMappingCount} De/Para</span>
                    <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-600">{selectedPayerPriceCount} valores</span>
                    <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-600">{antiGlosaProfileNeedsReview ? "Anti-glosa pendente" : "Anti-glosa ok"}</span>
                  </span>
                ) : null}
              </button>
              );
            })}
          </div>
        </div>
          </div>
        </div>

        <div data-payer-setup-area className="rounded-2xl bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-slate-900">{selectedPayer?.name || "Selecione um pagador"}</p>
              <p className="mt-1 text-xs text-slate-500">
                Fluxo principal: configure o básico pela esteira. Use o modo avançado apenas para ajustes completos ou técnicos.
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

          {selectedPayer ? renderPayerSetupWizard() : null}
        </div>
          <details
            open={advancedModeOpen}
            onToggle={(event) => setAdvancedModeOpen(event.currentTarget.open)}
            className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-3"
          >
            <summary className="cursor-pointer list-none rounded-xl px-2 py-1 text-sm font-semibold text-slate-800">
              Modo avançado
              <span className="ml-2 text-xs font-normal text-slate-500">Ajustes técnicos do convênio: De/Para completo, tabela de valores, regras TISS, cadastros de apoio e exceções.</span>
            </summary>
            <div className="mt-2 flex flex-wrap gap-2 px-2 text-[11px] font-semibold text-slate-500" data-payer-advanced-mode-tabs>
              {["Dados TISS avançados", "De/Para completo", "Tabela de valores", "Regras anti-glosa", "Cadastros de apoio", "Exceções por serviço"].map((item) => (
                <span key={item} className="rounded-full border border-slate-200 bg-white px-2.5 py-1">{item}</span>
              ))}
            </div>
            <div className="mt-3">
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
                  <PayerTissField id="payer-contracted-provider-code" label="Código do prestador na operadora" helperText="Código contratual de até 14 caracteres. O valor nunca é truncado." error={payerTissFieldErrors.contractedProviderCode}>
                    <input
                      id="payer-contracted-provider-code"
                      aria-describedby={payerTissFieldErrors.contractedProviderCode ? "payer-contracted-provider-code-help payer-contracted-provider-code-error" : "payer-contracted-provider-code-help"}
                      aria-invalid={Boolean(payerTissFieldErrors.contractedProviderCode)}
                      value={payerTissForm.contractedProviderCode}
                      onChange={(event) => updatePayerTiss("contractedProviderCode", event.target.value)}
                      placeholder="Ex.: PRESTADOR123"
                      className={`${payerTissFieldClass} ${payerTissFieldErrors.contractedProviderCode ? "border-rose-400 focus:border-rose-400 focus:ring-rose-100" : ""}`}
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
                  <PayerTissField id="payer-operator-provider-code" label="Código da clínica na operadora" helperText="Use quando a operadora diferencia código da clínica e código do contratado; máximo de 14 caracteres." error={payerTissFieldErrors.operatorProviderCode}>
                    <input
                      id="payer-operator-provider-code"
                      aria-describedby={payerTissFieldErrors.operatorProviderCode ? "payer-operator-provider-code-help payer-operator-provider-code-error" : "payer-operator-provider-code-help"}
                      aria-invalid={Boolean(payerTissFieldErrors.operatorProviderCode)}
                      value={payerTissForm.operatorProviderCode}
                      onChange={(event) => updatePayerTiss("operatorProviderCode", event.target.value)}
                      placeholder="Ex.: CLINICA-001"
                      className={`${payerTissFieldClass} ${payerTissFieldErrors.operatorProviderCode ? "border-rose-400 focus:border-rose-400 focus:ring-rose-100" : ""}`}
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
                <p className="mt-4 text-xs font-bold uppercase tracking-widest text-indigo-500">Exigências anti-glosa da operadora</p>
                <p className="mt-1 text-xs text-slate-500">
                  Essas regras alimentam a conferência anti-glosa antes do XML oficial. Marque apenas exigências reais do contrato ou portal da operadora.
                </p>
                <div className={`mt-3 rounded-2xl border px-3 py-3 ${antiGlosaProfileNeedsReview ? "border-amber-200 bg-amber-50" : "border-emerald-100 bg-emerald-50"}`}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Status da configuração anti-glosa</p>
                      <p className="mt-1 text-xs leading-5 text-slate-600">
                        Confirme a revisão das exigências da operadora para que as Pré-guias possam sair como prontas para XML. Requisitos universais de TISS e contrato continuam valendo.
                      </p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-normal ${antiGlosaProfileNeedsReview ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                      {antiGlosaProfileNeedsReview ? "Não revisado" : "Revisado"}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2">
                    <label className="flex items-start gap-2 text-sm font-normal text-slate-700">
                      <input
                        type="checkbox"
                        checked={payerTissForm.antiGlosaReviewed}
                        onChange={(event) => updateAntiGlosaReviewed(event.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-[#7a32fc]"
                      />
                      <span>Revisei as exigências anti-glosa desta operadora</span>
                    </label>
                    <label className={`flex items-start gap-2 text-sm font-normal ${hasAnySpecificAntiGlosaRequirement ? "text-slate-400" : "text-slate-700"}`}>
                      <input
                        type="checkbox"
                        checked={payerTissForm.operatorHasNoAdditionalRequirements}
                        disabled={hasAnySpecificAntiGlosaRequirement}
                        onChange={(event) => updateOperatorNoAdditionalRequirements(event.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-[#7a32fc] disabled:opacity-50"
                      />
                      <span>Esta operadora não possui exigências adicionais além do TISS padrão e do contrato cadastrado</span>
                    </label>
                    {hasAnySpecificAntiGlosaRequirement ? (
                      <p className="text-[11px] leading-4 text-slate-500">
                        A confirmação de sem exigências adicionais fica disponível quando todas as exigências específicas estiverem desmarcadas.
                      </p>
                    ) : null}
                    {antiGlosaProfileNeedsReview ? (
                      <p className="rounded-xl border border-amber-200 bg-white/70 px-3 py-2 text-xs leading-5 text-amber-800">
                        Perfil anti-glosa ainda não revisado. As Pré-guias dessa operadora aparecerão com risco médio até a revisão ser confirmada.
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[
                    ["requiresBeneficiaryCard", "Carteirinha obrigatória"],
                    ["requiresBeneficiaryCardValidity", "Exige validade da carteirinha"],
                    ["requiresAuthorization", "Autorização obrigatória"],
                    ["requiresAuthorizedProcedure", "Exige procedimento autorizado"],
                    ["requiresAuthorizationPassword", "Senha da autorização obrigatória"],
                    ["requiresGuideNumber", "Número da guia da operadora obrigatório"],
                    ["requiresCid", "Exige CID"],
                    ["requiresExecutantRegistry", "Exige conselho do executante"],
                    ["requiresCbo", "Exige CBO"],
                    ["requiresCnes", "Exige CNES do prestador"],
                    ["requiresProviderCode", "Exige código do prestador"],
                    ["requiresResponsibleSignature", "Exige assinatura do responsável"],
                    ["requiresPhysicalGuide", "Exige guia física impressa"],
                    ["requiresSignedGuide", "Exige guia assinada"],
                    ["requiresStampedDatedGuide", "Exige guia carimbada/datada"],
                    ["requiresAdministrativeReport", "Relatório/anexo obrigatório antes do envio"],
                    ["allowsMixedMultidisciplinaryGuide", "Permite guia mista multidisciplinar"],
                    ["requiresSeparateGuideBySpecialty", "Exige guia segregada por especialidade"],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm font-normal text-slate-700">
                      <input
                        type="checkbox"
                        checked={Boolean((payerTissForm as any)[key])}
                        onChange={(event) => updateAntiGlosaRequirement(key as keyof PayerTissForm, event.target.checked)}
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
                <div className="mt-3">
            <SaveActionButton
              status={saving || payerTissLoading ? "loading" : payerTissMessage ? "success" : "idle"}
              idleLabel="Salvar alterações"
              loadingLabel="Atualizando Pré-Guia..."
              disabled={!selectedPayerId || saving || payerTissLoading}
              onClick={() => void savePayerTissProfile()}
            />
                </div>
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

          <div className="mt-4">
            <SaveActionButton
              status={sectionFeedback.requirements?.status === "saving" ? "loading" : sectionFeedback.requirements?.status === "success" ? "success" : sectionFeedback.requirements?.status === "error" ? "error" : "idle"}
              idleLabel="Salvar alterações"
              disabled={!selectedPayerId || saving}
              onClick={() => void saveRequirement()}
            />
          </div>

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
              primaryLabel="Salvar alterações"
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
              primaryLabel="Salvar alterações"
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
                  onChange={(event) => selectTussMappingService(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                >
                  <option value="">Selecione o procedimento</option>
                  {tussServices.filter((service) => service.active === true || service.id === tussMappingForm.serviceCatalogId).map((service) => <option key={service.id} value={service.id}>{service.name}{service.active !== true ? " (inativo)" : ""}</option>)}
                </select>
              </label>
              <label htmlFor="payer-mapping-tuss-code" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Código TUSS oficial</span>
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
              <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-3 text-xs text-sky-900 md:col-span-2">
                <p className="font-medium">Códigos por etapa da operadora</p>
                <p className="mt-1">
                  Se os campos abaixo ficarem vazios, o Verto usa o TUSS oficial. Preencha apenas quando a autorização ou o XML exigirem códigos diferentes.
                </p>
              </div>
              <label htmlFor="payer-mapping-authorized-code" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Código usado na autorização</span>
                <input
                  id="payer-mapping-authorized-code"
                  value={tussMappingForm.authorizedCode}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, authorizedCode: event.target.value }))}
                  placeholder="Opcional. Ex.: 50000470"
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label htmlFor="payer-mapping-billing-code" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Código usado no faturamento/XML</span>
                <input
                  id="payer-mapping-billing-code"
                  value={tussMappingForm.billingCode}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, billingCode: event.target.value }))}
                  placeholder="Opcional. Ex.: 6680"
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label htmlFor="payer-mapping-authorized-description" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Descrição do código autorizado</span>
                <input
                  id="payer-mapping-authorized-description"
                  value={tussMappingForm.authorizedCodeDescription}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, authorizedCodeDescription: event.target.value }))}
                  placeholder="Opcional"
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label htmlFor="payer-mapping-billing-description" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Descrição do código faturado</span>
                <input
                  id="payer-mapping-billing-description"
                  value={tussMappingForm.billingCodeDescription}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, billingCodeDescription: event.target.value }))}
                  placeholder="Opcional"
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label htmlFor="payer-mapping-package-code" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Código/pacote da operadora</span>
                <input
                  id="payer-mapping-package-code"
                  value={tussMappingForm.operatorPackageCode}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, operatorPackageCode: event.target.value }))}
                  placeholder="Opcional. Ex.: pacote contratual"
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label htmlFor="payer-mapping-billing-code-source" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Origem do código faturado</span>
                <select
                  id="payer-mapping-billing-code-source"
                  value={tussMappingForm.billingCodeSource}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, billingCodeSource: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                >
                  <option value="official_tuss">TUSS oficial</option>
                  <option value="authorized_code">Código autorizado</option>
                  <option value="payer_mapping_billing_code">Regra de faturamento da operadora</option>
                  <option value="operator_package">Pacote/código da operadora</option>
                  <option value="payer_contract">Contrato do pagador</option>
                </select>
              </label>
              <label htmlFor="payer-mapping-package-description" className="text-xs font-normal text-slate-700 md:col-span-2">
                <span className="mb-1 block">Descrição do pacote/regra da operadora</span>
                <input
                  id="payer-mapping-package-description"
                  value={tussMappingForm.operatorPackageDescription}
                  onChange={(event) => setTussMappingForm((current) => ({ ...current, operatorPackageDescription: event.target.value }))}
                  placeholder="Opcional. Ex.: operadora autoriza como TUSS, mas fatura como pacote contratual"
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label htmlFor="payer-mapping-contract-code" className="text-xs font-normal text-slate-700">
                <span className="mb-1 block">Código contratual legado</span>
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
                  aria-invalid={Boolean(tussMappingValidFromError)}
                  aria-describedby={tussMappingValidFromError ? "payer-mapping-valid-from-error" : undefined}
                  onChange={(event) => { setTussMappingForm((current) => ({ ...current, validFrom: event.target.value })); setTussMappingValidFromError(""); clearLocalFeedback("mapping"); }}
                  className={`w-full rounded-2xl border px-3 py-2 text-sm font-normal outline-none focus:ring-2 ${tussMappingValidFromError ? "border-rose-400 focus:border-rose-400 focus:ring-rose-100" : "border-slate-200 focus:border-violet-300 focus:ring-violet-100"}`}
                />
                {tussMappingValidFromError ? <span id="payer-mapping-valid-from-error" className="mt-1 block text-[11px] leading-4 text-rose-600">{tussMappingValidFromError}</span> : null}
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
                onClick={() => { setEditingTussMappingId(""); setTussMappingForm(defaultTussMappingForm); setTussMappingValidFromError(""); clearLocalFeedback("mapping"); }}
                className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500"
              >
                Cancelar edição
              </button>
            )}
            <div className="mt-3">
              <SaveActionButton
                status={sectionFeedback.mapping?.status === "saving" ? "loading" : sectionFeedback.mapping?.status === "success" ? "success" : "idle"}
                idleLabel="Salvar alterações"
                loadingLabel="Atualizando Pré-Guia..."
                disabled={!selectedPayerId || !tussMappingForm.serviceCatalogId || saving}
                onClick={() => void createTussMapping()}
              />
            </div>
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

          <div className={`mt-3 rounded-xl border px-3 py-3 ${payerTissForm.allowsZeroAmountXml ? "border-amber-200 bg-amber-50" : "border-emerald-100 bg-white"}`}>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={payerTissForm.allowsZeroAmountXml}
                onChange={(event) => updatePayerTiss("allowsZeroAmountXml", event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#7a32fc] focus:ring-[#7a32fc]"
              />
              <span>
                <strong className="block font-semibold text-slate-900">Permitir XML com valor R$ 0,00 para esta operadora</strong>
                Use somente quando a operadora confirmar que calcula o valor contratado no portal ou após a importação.
              </span>
            </label>
            {payerTissForm.allowsZeroAmountXml ? (
              <label className="mt-3 block text-xs font-normal text-slate-700">
                <span className="mb-1 block">Justificativa operacional obrigatória</span>
                <input
                  value={payerTissForm.zeroAmountXmlReason}
                  onChange={(event) => updatePayerTiss("zeroAmountXmlReason", event.target.value)}
                  className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                  placeholder="Ex.: valor calculado automaticamente no portal da Vivest"
                />
              </label>
            ) : null}
            <div className="mt-3">
              <SaveActionButton
                status="idle"
                idleLabel="Salvar política do XML"
                disabled={!selectedPayerId || saving || (payerTissForm.allowsZeroAmountXml && !payerTissForm.zeroAmountXmlReason.trim())}
                onClick={() => void savePayerTissProfile()}
              />
            </div>
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
              <span id="payer-price-amount-help" className="mt-1 block text-xs text-slate-500">
                Informe o valor em reais, com até duas casas decimais. R$ 0,00 exige a política explícita da operadora acima.
              </span>
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
            <SaveActionButton
              status={sectionFeedback.price?.status === "saving" ? "loading" : sectionFeedback.price?.status === "success" ? "success" : sectionFeedback.price?.status === "error" ? "error" : "idle"}
              idleLabel="Salvar alterações"
              loadingLabel="Atualizando Pré-Guia..."
              disabled={!selectedPayerId || !procedurePriceForm.serviceCatalogId || procedurePriceForm.amountCents === "" || saving}
              onClick={() => void saveProcedurePrice()}
            />
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
                    <button type="button" onClick={() => startNewSupportForm("service")} className="inline-flex items-center gap-1.5 rounded-lg bg-[#7a32fc] px-3 py-2 text-xs font-normal text-white"><Plus size={14} />Novo procedimento interno</button>
                    <button type="button" onClick={() => startNewSupportForm("code")} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-normal text-slate-700"><Plus size={14} />Novo código TUSS</button>
                    <button type="button" onClick={() => startNewBillingConfigurationPart("mapping")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-normal text-slate-700">Novo De/Para</button>
                    <button type="button" onClick={() => startNewBillingConfigurationPart("price")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-normal text-slate-700">Novo valor negociado</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50/30 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Configurações incompletas</h3>
              <p className="mt-1 text-xs text-slate-500">De/Para já salvo aguardando valor negociado. Ainda não é usado em novas Pré-guias.</p>
            </div>
            <span className="text-xs text-slate-500">{pendingBillingConfigurations.length} aguardando valor</span>
          </div>
          <div className="mt-3 space-y-2">
            {pendingBillingConfigurations.length > 0
              ? pendingBillingConfigurations.map(renderBillingConfigurationCard)
              : <p className="rounded-lg bg-white p-3 text-sm text-slate-500">Nenhum De/Para ativo aguardando valor negociado.</p>}
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
              <button type="button" onClick={() => startNewSupportForm("service")} className="inline-flex items-center gap-1.5 rounded-lg bg-[#7a32fc] px-3 py-2 text-xs font-normal text-white"><Plus size={14} />Novo procedimento interno</button>
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
            </div>
          </details>
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
                      <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs uppercase text-slate-400">Código autorizado novo</p><p className="mt-1">{authorizationSyncModal.summary?.newTussCode || authorizationSyncModal.mapping.authorizedCode || authorizationSyncModal.mapping.tussCode || "Não informado"}</p></div>
                      <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs uppercase text-slate-400">Código faturado/XML</p><p className="mt-1">{authorizationSyncModal.summary?.billingCode || authorizationSyncModal.mapping.billingCode || authorizationSyncModal.mapping.tussCode || "Não informado"}</p></div>
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
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[#7a32fc] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
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
