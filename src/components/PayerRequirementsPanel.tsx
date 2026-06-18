import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileSpreadsheet, Loader2, Plus, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { dataService } from "../services/dataService";
import { getDefaultTissOfficialStrategyDescriptor } from "../services/tissOfficial/capabilities";
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
  const [supportCatalogOpen, setSupportCatalogOpen] = useState(false);
  const [supportActionKey, setSupportActionKey] = useState("");
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

  const selectedPayer = useMemo(
    () => payers.find((payer) => payer.id === selectedPayerId) || null,
    [payers, selectedPayerId],
  );
  const selectedPayerTissMissing = useMemo(
    () => payerTissMissing(selectedPayer, payerTissForm),
    [payerTissForm, selectedPayer],
  );
  const selectedPayerMappingCount = tussMappings.filter((mapping) => mapping.active !== false).length;
  const selectedPayerPriceCount = procedurePrices.filter((price) => price.active !== false).length;
  const activeTussServices = useMemo(() => tussServices.filter((service) => service.active !== false), [tussServices]);
  const activeTussCodes = useMemo(() => tussCodes.filter((code) => code.active !== false), [tussCodes]);
  const hasDemoTussData = [...tussMappings, ...tussCodes].some((item: any) =>
    /demo|teste/i.test(String(item?.source || item?.tussCode || item?.code || item?.contractCode || "")),
  );
  const formatCurrency = (amount?: number | null) => {
    const formatted = formatCentsForBrazilianInput(amount);
    return formatted ? `R$ ${formatted}` : "valor pendente";
  };
  const billingConfigurations = useMemo(() => {
    const servicesById = new Map(tussServices.map((service) => [service.id, service]));
    const codesById = new Map(tussCodes.map((code) => [code.id, code]));
    const mappingsById = new Map(tussMappings.map((mapping) => [mapping.id, mapping]));
    const usedMappingIds = new Set<string>();
    const rows = procedurePrices.map((price) => {
      const mapping = (price.payerTussMappingId && mappingsById.get(price.payerTussMappingId)) ||
        tussMappings.find((candidate) =>
          candidate.serviceCatalogId === price.serviceCatalogId &&
          (!price.tussCodeId || candidate.tussCodeId === price.tussCodeId),
        ) || null;
      if (mapping?.id) usedMappingIds.add(mapping.id);
      const service = servicesById.get(price.serviceCatalogId || mapping?.serviceCatalogId || "") || null;
      const code = codesById.get(price.tussCodeId || mapping?.tussCodeId || "") || null;
      return { key: `price:${price.id}`, price, mapping, service, code };
    });
    for (const mapping of tussMappings) {
      if (usedMappingIds.has(mapping.id)) continue;
      rows.push({
        key: `mapping:${mapping.id}`,
        price: null as PayerProcedurePrice | null,
        mapping,
        service: servicesById.get(mapping.serviceCatalogId) || null,
        code: codesById.get(mapping.tussCodeId || "") || null,
      });
    }
    return rows;
  }, [procedurePrices, tussCodes, tussMappings, tussServices]);

  const openSupportForm = (target: "service" | "code") => {
    setSupportFormOpen(true);
    setSupportCatalogOpen(true);
    window.setTimeout(() => {
      const formRef = target === "service" ? tussServiceFormRef : tussCodeFormRef;
      const inputRef = target === "service" ? tussServiceNameInputRef : tussCodeInputRef;
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      inputRef.current?.focus();
    }, 80);
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
      setPayerTissMessage("Dados TISS da operadora salvos. Pré-guias deste pagador foram marcadas para revalidação.");
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
    const rawDefaultAmount = String(tussServiceForm.defaultAmountCents || "").trim();
    const defaultAmountCents = rawDefaultAmount ? parseBrazilianCurrencyToCents(rawDefaultAmount) : null;
    if (rawDefaultAmount && defaultAmountCents === null) {
      setError("Informe o valor padrão em reais, com no máximo duas casas decimais.");
      return;
    }
    setSaving(true);
    setError("");
    setTussActionInfo("");
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
      setTussActionInfo(editingTussServiceId ? "Procedimento atualizado." : "Procedimento criado.");
    } finally {
      setSaving(false);
    }
  };

  const createTussCode = async () => {
    if (tussCodeForm.code.trim().length < 2 || tussCodeForm.description.trim().length < 2) return;
    setSaving(true);
    setError("");
    setTussActionInfo("");
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
      setTussActionInfo(editingTussCodeId ? "Código TUSS atualizado." : "Código TUSS cadastrado.");
    } finally {
      setSaving(false);
    }
  };

  const createTussMapping = async () => {
    if (!selectedPayerId || !tussMappingForm.serviceCatalogId) return;
    const rawLegacyAmount = String(tussMappingForm.amountCents || "").trim();
    const rawNegotiatedAmount = String(tussMappingForm.negotiatedAmountCents || "").trim();
    const legacyAmountCents = rawLegacyAmount ? parseBrazilianCurrencyToCents(rawLegacyAmount) : null;
    const negotiatedAmountCents = rawNegotiatedAmount ? parseBrazilianCurrencyToCents(rawNegotiatedAmount) : null;
    if ((rawLegacyAmount && legacyAmountCents === null) || (rawNegotiatedAmount && negotiatedAmountCents === null)) {
      setError("Informe os valores do De/Para em reais, com no máximo duas casas decimais.");
      return;
    }
    setSaving(true);
    setError("");
    setTussActionInfo("");
    try {
      const payload = {
        ...tussMappingForm,
        payerId: selectedPayerId,
        defaultQuantity: Number(tussMappingForm.defaultQuantity || 1),
        amountCents: legacyAmountCents,
        negotiatedAmountCents: negotiatedAmountCents ?? legacyAmountCents,
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
      setTussActionInfo(editingTussMappingId ? "Mapeamento atualizado." : "Mapeamento criado.");
    } finally {
      setSaving(false);
    }
  };

  const saveProcedurePrice = async () => {
    if (procedurePriceSaveInFlightRef.current || !selectedPayerId || !procedurePriceForm.serviceCatalogId) return;
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
      setTussActionInfo(editingProcedurePriceId ? "Valor negociado atualizado." : "Valor negociado cadastrado.");
    } finally {
      setSaving(false);
      procedurePriceSaveInFlightRef.current = false;
    }
  };

  const editTussService = (service: TussService) => {
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
  };

  const editProcedurePrice = (price: PayerProcedurePrice) => {
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
    if (supportActionInFlightRef.current) return;
    const actionKey = `service:${serviceId}:${active ? "active" : "inactive"}`;
    const confirmed = window.confirm(active
      ? "Deseja reativar este procedimento? Ele voltará a ficar disponível para novas configurações."
      : "Deseja inativar este procedimento? Ele deixará de ficar disponível para novas configurações.");
    if (!confirmed) return;
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
        return;
      }
      setTussServices((current) => current.map((service) => (
        service.id === serviceId ? { ...service, ...(result.data || {}), active } : service
      )));
      if (!active && editingTussServiceId === serviceId) {
        setEditingTussServiceId("");
        setTussServiceForm(defaultTussServiceForm);
      }
      setTussActionInfo(active ? "Procedimento reativado com sucesso." : "Procedimento inativado.");
    } finally {
      supportActionInFlightRef.current = false;
      setSaving(false);
      setSupportActionKey("");
    }
  };

  const disableTussService = (serviceId: string) => setTussServiceActive(serviceId, false);

  const reactivateTussService = (serviceId: string) => setTussServiceActive(serviceId, true);

  const setTussCodeActive = async (codeId: string, active: boolean) => {
    if (supportActionInFlightRef.current) return;
    const actionKey = `code:${codeId}:${active ? "active" : "inactive"}`;
    const confirmed = window.confirm(active
      ? "Deseja reativar este código TUSS? Ele voltará a ficar disponível para novas configurações."
      : "Deseja inativar este código TUSS? Ele deixará de ficar disponível para novas configurações.");
    if (!confirmed) return;
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
        return;
      }
      setTussCodes((current) => current.map((code) => (
        code.id === codeId ? { ...code, ...(result.data || {}), active } : code
      )));
      if (!active && editingTussCodeId === codeId) {
        setEditingTussCodeId("");
        setTussCodeForm(defaultTussCodeForm);
      }
      setTussActionInfo(active ? "Código TUSS reativado com sucesso." : "Código TUSS inativado.");
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

  const disableTussMapping = async (mappingId: string) => {
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
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${selectedPayerTissMissing.length === 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                  {isInsurancePayer(selectedPayer) ? (selectedPayerTissMissing.length === 0 ? "TISS completo" : "TISS incompleto") : "TISS não aplicável"}
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
                <p className="text-xs font-bold uppercase tracking-widest text-indigo-500">Dados TISS da operadora</p>
                <p className="mt-1 text-xs font-semibold text-slate-600">
                  Fonte global do pagador usada pela Pré-guia TISS. Particular fica como não aplicável.
                </p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-bold ${
                !isInsurancePayer(selectedPayer)
                  ? "bg-slate-100 text-slate-600"
                  : selectedPayerTissMissing.length === 0
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
              }`}>
                {!isInsurancePayer(selectedPayer) ? "Não aplicável" : selectedPayerTissMissing.length === 0 ? "Completo" : "Incompleto"}
              </span>
            </div>

            {isInsurancePayer(selectedPayer) ? (
              <>
                {selectedPayerTissMissing.length > 0 && (
                  <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    Pendências: {selectedPayerTissMissing.join(", ")}.
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
                  <PayerTissField id="payer-default-guide-type" label="Tipo de guia" helperText="Tipo de guia usado por padrão para este convênio.">
                    <select
                      id="payer-default-guide-type"
                      aria-describedby="payer-default-guide-type-help"
                      value={payerTissForm.defaultGuideType}
                      onChange={(event) => updatePayerTiss("defaultGuideType", event.target.value)}
                      className={payerTissFieldClass}
                    >
                      <option value="sp_sadt">Guia SP/SADT</option>
                      <option value="consulta">Guia de consulta</option>
                      <option value="other">Outra guia</option>
                    </select>
                  </PayerTissField>
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
                  <PayerTissField id="payer-default-attendance-type" label="Tipo de atendimento padrão" helperText="Código administrativo usado na guia quando aplicável.">
                    <input
                      id="payer-default-attendance-type"
                      aria-describedby="payer-default-attendance-type-help"
                      value={payerTissForm.defaultAttendanceType}
                      onChange={(event) => updatePayerTiss("defaultAttendanceType", event.target.value)}
                      placeholder="Ex.: 03"
                      className={payerTissFieldClass}
                    />
                  </PayerTissField>
                  <PayerTissField id="payer-default-attendance-regime" label="Regime de atendimento padrão" helperText="Código do regime exigido pelo convênio, se houver.">
                    <input
                      id="payer-default-attendance-regime"
                      aria-describedby="payer-default-attendance-regime-help"
                      value={payerTissForm.defaultAttendanceRegime}
                      onChange={(event) => updatePayerTiss("defaultAttendanceRegime", event.target.value)}
                      placeholder="Ex.: 01"
                      className={payerTissFieldClass}
                    />
                  </PayerTissField>
                  <PayerTissField id="payer-default-attendance-character" label="Caráter de atendimento padrão" helperText="Código do caráter de atendimento usado quando o convênio exige.">
                    <input
                      id="payer-default-attendance-character"
                      aria-describedby="payer-default-attendance-character-help"
                      value={payerTissForm.defaultAttendanceCharacter}
                      onChange={(event) => updatePayerTiss("defaultAttendanceCharacter", event.target.value)}
                      placeholder="Ex.: 1"
                      className={payerTissFieldClass}
                    />
                  </PayerTissField>
                </div>

                <p className="mt-4 text-xs font-bold uppercase tracking-widest text-indigo-500">Configuração automática do XML TISS</p>
                <div className="mt-3 rounded-2xl border border-indigo-100 bg-white px-3 py-3">
                  <p className="text-xs text-slate-500">Versão do XML TISS</p>
                  <p className="mt-1 text-sm text-slate-900">{OFFICIAL_TISS_XML_STRATEGY.communicationVersion}</p>
                  <p className="mt-1 text-[11px] leading-4 text-slate-500">
                    Gerenciada automaticamente pela Verto. A versão é definida pelo gerador oficial e será atualizada somente quando uma nova versão for implementada e validada.
                  </p>
                </div>
                <p className="mt-4 text-xs font-bold uppercase tracking-widest text-indigo-500">Regras TISS e autorização</p>
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
            {requirements.filter((rule) => rule.isActive !== false).length === 0 ? (
              <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">Nenhuma regra ativa para este pagador.</p>
            ) : requirements.filter((rule) => rule.isActive !== false).map((rule) => (
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
                  <button
                    type="button"
                    onClick={() => void disableRequirement(rule.id)}
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-50"
                  >
                    Desativar
                  </button>
                </div>
              </div>
            ))}
          </div>
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

        <div className="mt-4">
          <details
            open={supportFormOpen}
            onToggle={(event) => setSupportFormOpen(event.currentTarget.open)}
            className="rounded-2xl border border-slate-100 bg-slate-50/50 p-3"
          >
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">Cadastrar procedimento ou código TUSS</summary>
            <p className="mt-2 text-xs text-slate-500">Procedimentos internos e códigos TUSS são referências usadas pelo De/Para; não representam cobranças duplicadas.</p>
            <div className="mt-3 grid gap-4 xl:grid-cols-2">
          <div ref={tussServiceFormRef} className="rounded-2xl border border-slate-100 bg-white p-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{editingTussServiceId ? "Editando procedimento interno" : "Procedimento interno"}</p>
            {editingTussServiceId && (
              <p className="mt-1 text-xs text-slate-500">Atualize somente os dados do procedimento interno selecionado.</p>
            )}
            <input
              ref={tussServiceNameInputRef}
              value={tussServiceForm.name}
              onChange={(event) => setTussServiceForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Sessão ABA individual"
              className="mt-3 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
            />
            <textarea
              value={tussServiceForm.description}
              onChange={(event) => setTussServiceForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Descrição do procedimento interno"
              className="mt-2 min-h-[72px] w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
            />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                value={tussServiceForm.internalCode}
                onChange={(event) => setTussServiceForm((current) => ({ ...current, internalCode: event.target.value }))}
                placeholder="Código interno"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
              <input
                value={tussServiceForm.specialty}
                onChange={(event) => setTussServiceForm((current) => ({ ...current, specialty: event.target.value }))}
                placeholder="Especialidade"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                value={tussServiceForm.serviceType}
                onChange={(event) => setTussServiceForm((current) => ({ ...current, serviceType: event.target.value }))}
                placeholder="Tipo de sessão"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
              <input
                type="number"
                min="1"
                value={tussServiceForm.defaultDurationMinutes}
                onChange={(event) => setTussServiceForm((current) => ({ ...current, defaultDurationMinutes: event.target.value }))}
                placeholder="Duração padrão (min)"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <select
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
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={tussServiceForm.defaultQuantity}
                onChange={(event) => setTussServiceForm((current) => ({ ...current, defaultQuantity: event.target.value }))}
                placeholder="Quantidade padrão"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
            </div>
            <div className="mt-2">
              <input
                inputMode="decimal"
                value={tussServiceForm.defaultAmountCents}
                onChange={(event) => setTussServiceForm((current) => ({ ...current, defaultAmountCents: event.target.value }))}
                placeholder="Valor padrão. Ex.: 120,00"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
            </div>
            {editingTussServiceId && (
              <button
                type="button"
                onClick={() => { setEditingTussServiceId(""); setTussServiceForm(defaultTussServiceForm); }}
                className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500"
              >
                Cancelar edição
              </button>
            )}
            <button
              type="button"
              onClick={() => void createTussService()}
              disabled={saving || tussServiceForm.name.trim().length < 2}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              <Plus size={15} />
              {editingTussServiceId ? "Atualizar procedimento" : "Salvar procedimento"}
            </button>
          </div>

          <div ref={tussCodeFormRef} className="rounded-2xl border border-slate-100 bg-white p-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{editingTussCodeId ? "Editando código TUSS" : "Código TUSS"}</p>
            {editingTussCodeId && (
              <p className="mt-1 text-xs text-slate-500">Atualize somente os dados do código TUSS selecionado.</p>
            )}
            <input
              ref={tussCodeInputRef}
              value={tussCodeForm.code}
              onChange={(event) => setTussCodeForm((current) => ({ ...current, code: event.target.value }))}
              placeholder="Código"
              className="mt-3 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
            />
            <input
              value={tussCodeForm.description}
              onChange={(event) => setTussCodeForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Descrição controlada"
              className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
            />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                value={tussCodeForm.termType}
                onChange={(event) => setTussCodeForm((current) => ({ ...current, termType: event.target.value }))}
                placeholder="Tipo de termo"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
              <input
                value={tussCodeForm.version}
                onChange={(event) => setTussCodeForm((current) => ({ ...current, version: event.target.value }))}
                placeholder="Versão/tabela"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                type="date"
                value={tussCodeForm.validFrom}
                onChange={(event) => setTussCodeForm((current) => ({ ...current, validFrom: event.target.value }))}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
              <input
                type="date"
                value={tussCodeForm.validTo}
                onChange={(event) => setTussCodeForm((current) => ({ ...current, validTo: event.target.value }))}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
            </div>
            {editingTussCodeId && (
              <button
                type="button"
                onClick={() => { setEditingTussCodeId(""); setTussCodeForm(defaultTussCodeForm); }}
                className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500"
              >
                Cancelar edição
              </button>
            )}
            <button
              type="button"
              onClick={() => void createTussCode()}
              disabled={saving || tussCodeForm.code.trim().length < 2 || tussCodeForm.description.trim().length < 2}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              <Plus size={15} />
              {editingTussCodeId ? "Atualizar código" : "Salvar código"}
            </button>
          </div>

            </div>
          </details>

          <div className="mt-4 rounded-2xl border border-slate-100 p-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Mapeamento por pagador</p>
            <select
              value={tussMappingForm.serviceCatalogId}
              onChange={(event) => setTussMappingForm((current) => ({ ...current, serviceCatalogId: event.target.value }))}
              className="mt-3 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
            >
              <option value="">Procedimento</option>
              {tussServices.filter((service) => service.active !== false || service.id === tussMappingForm.serviceCatalogId).map((service) => <option key={service.id} value={service.id}>{service.name}{service.active === false ? " (inativo)" : ""}</option>)}
            </select>
            <select
              value={tussMappingForm.tussCodeId}
              onChange={(event) => setTussMappingForm((current) => ({ ...current, tussCodeId: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
            >
              <option value="">Sem código TUSS</option>
              {tussCodes.filter((code) => code.active !== false || code.id === tussMappingForm.tussCodeId).map((code) => <option key={code.id} value={code.id}>{code.code} - {code.description}{code.active === false ? " (inativo)" : ""}</option>)}
            </select>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                value={tussMappingForm.contractCode}
                onChange={(event) => setTussMappingForm((current) => ({ ...current, contractCode: event.target.value }))}
                placeholder="Código contratual do pagador"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
              <input
                value={tussMappingForm.specialty}
                onChange={(event) => setTussMappingForm((current) => ({ ...current, specialty: event.target.value }))}
                placeholder="Especialidade"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
            </div>
            <textarea
              value={tussMappingForm.contractDescription}
              onChange={(event) => setTussMappingForm((current) => ({ ...current, contractDescription: event.target.value }))}
              placeholder="Descrição contratual do pagador, se diferente da descrição TUSS"
              className="mt-2 min-h-[64px] w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
            />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <select
                value={tussMappingForm.guideType}
                onChange={(event) => setTussMappingForm((current) => ({ ...current, guideType: event.target.value }))}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              >
                <option value="sp_sadt">SP/SADT</option>
                <option value="consulta">Consulta</option>
                <option value="other">Outra</option>
              </select>
              <select
                value={tussMappingForm.billingUnit}
                onChange={(event) => setTussMappingForm((current) => ({ ...current, billingUnit: event.target.value }))}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              >
                <option value="session">Sessão</option>
                <option value="hour">Hora</option>
                <option value="minute">Minuto</option>
                <option value="unit">Unidade</option>
                <option value="package">Pacote</option>
              </select>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <select
                value={tussMappingForm.quantityRule}
                onChange={(event) => setTussMappingForm((current) => ({ ...current, quantityRule: event.target.value }))}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              >
                <option value="per_session">Por sessão</option>
                <option value="per_hour">Por hora</option>
                <option value="duration_based">Por duração</option>
                <option value="fixed">Fixo</option>
              </select>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={tussMappingForm.defaultQuantity}
                onChange={(event) => setTussMappingForm((current) => ({ ...current, defaultQuantity: event.target.value }))}
                placeholder="Quantidade"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                type="date"
                value={tussMappingForm.validFrom}
                onChange={(event) => setTussMappingForm((current) => ({ ...current, validFrom: event.target.value }))}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
              <input
                type="date"
                value={tussMappingForm.validTo}
                onChange={(event) => setTussMappingForm((current) => ({ ...current, validTo: event.target.value }))}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
            </div>
            <div className="mt-2">
              <input
                inputMode="decimal"
                value={tussMappingForm.amountCents}
                onChange={(event) => setTussMappingForm((current) => ({ ...current, amountCents: event.target.value }))}
                placeholder="Ex.: 120,00"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                inputMode="decimal"
                value={tussMappingForm.negotiatedAmountCents}
                onChange={(event) => setTussMappingForm((current) => ({ ...current, negotiatedAmountCents: event.target.value }))}
                placeholder="Ex.: 120,00"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
              <input
                type="number"
                min="1"
                value={tussMappingForm.standardDurationMinutes}
                onChange={(event) => setTussMappingForm((current) => ({ ...current, standardDurationMinutes: event.target.value }))}
                placeholder="Duração padrão (min)"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <select
                value={tussMappingForm.source}
                onChange={(event) => setTussMappingForm((current) => ({ ...current, source: event.target.value }))}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              >
                <option value="manual">Manual</option>
                <option value="imported">Importado</option>
                <option value="demo">Demo/teste</option>
                <option value="payer_contract">Contrato do pagador</option>
              </select>
              <input
                value={tussMappingForm.notes}
                onChange={(event) => setTussMappingForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Observações administrativas"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
            </div>
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
                <label key={key} className="flex items-center gap-2 rounded-2xl border border-slate-100 px-3 py-2 text-xs font-bold text-slate-600">
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
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <label htmlFor="payer-price-service" className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Procedimento interno</span>
              <select id="payer-price-service" value={procedurePriceForm.serviceCatalogId} onChange={(event) => setProcedurePriceForm((current) => ({ ...current, serviceCatalogId: event.target.value }))} className="w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                <option value="">Selecione o procedimento</option>
                {tussServices.filter((service) => service.active !== false || service.id === procedurePriceForm.serviceCatalogId).map((service) => <option key={service.id} value={service.id}>{service.name}{service.active === false ? " (inativo)" : ""}</option>)}
              </select>
            </label>
            <label htmlFor="payer-price-tuss" className="text-xs font-normal text-slate-700">
              <span className="mb-1 block">Código TUSS</span>
              <select id="payer-price-tuss" value={procedurePriceForm.tussCodeId} onChange={(event) => setProcedurePriceForm((current) => ({ ...current, tussCodeId: event.target.value }))} className="w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                <option value="">Selecione o código TUSS</option>
                {tussCodes.filter((code) => code.active !== false || code.id === procedurePriceForm.tussCodeId).map((code) => <option key={code.id} value={code.id}>{code.code} - {code.description}{code.active === false ? " (inativo)" : ""}</option>)}
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
                {tussMappings.filter((mapping) => mapping.active !== false || mapping.id === procedurePriceForm.payerTussMappingId).map((mapping) => <option key={mapping.id} value={mapping.id}>{mapping.serviceName || mapping.internalCode || "Procedimento"} {mapping.tussCode ? `· TUSS ${mapping.tussCode}` : ""}{mapping.active === false ? " (inativo)" : ""}</option>)}
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

        <div className="mt-4 rounded-2xl border border-slate-100 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Configurações de faturamento deste convênio</h3>
              <p className="mt-1 text-xs text-slate-500">Cada item reúne procedimento, De/Para TUSS, preço e vigência em uma única visão.</p>
            </div>
            <span className="text-xs text-slate-500">{billingConfigurations.length} configuração(ões) cadastrada(s)</span>
          </div>
          <div className="mt-3 space-y-2">
            {billingConfigurations.length === 0 ? (
              <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Nenhuma configuração de faturamento cadastrada para este convênio.</p>
            ) : billingConfigurations.map(({ key, price, mapping, service, code }) => {
              const today = new Date().toISOString().slice(0, 10);
              const validFrom = price?.validFrom || mapping?.validFrom || "";
              const validUntil = price?.validUntil || mapping?.validTo || "";
              const statusBadges = [
                { key: "mapping", label: mapping ? "De/Para configurado" : "De/Para ausente", tone: mapping ? "neutral" : "warning" },
                { key: "procedure_active", label: service?.active === false ? "Procedimento inativo" : "Procedimento ativo", tone: service?.active === false ? "warning" : "neutral" },
                !price ? { key: "value_missing", label: "Valor ausente", tone: "warning" } : null,
                !code?.id && !price?.tussCode && !mapping?.tussCode ? { key: "tuss_missing", label: "Código TUSS ausente", tone: "warning" } : null,
                validUntil && validUntil < today ? { key: "validity_expired", label: "Vigência expirada", tone: "warning" } : null,
                validFrom && validFrom > today ? { key: "validity_future", label: "Vigência futura", tone: "warning" } : null,
                price && mapping && price.serviceCatalogId !== mapping.serviceCatalogId ? { key: "inconsistent_configuration", label: "Configuração inconsistente", tone: "warning" } : null,
              ].filter(Boolean) as Array<{ key: string; label: string; tone: "neutral" | "warning" }>;
              const uniqueStatusBadges = Array.from(new Map(statusBadges.map((badge) => [badge.key, badge])).values());
              return (
                <div key={key} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{service?.name || price?.serviceName || mapping?.serviceName || mapping?.internalCode || "Procedimento não identificado"}</p>
                      <p className="mt-1 text-xs text-slate-500">{[code?.code || price?.tussCode || mapping?.tussCode ? `TUSS ${code?.code || price?.tussCode || mapping?.tussCode}` : "Sem TUSS", code?.description || mapping?.tussDescription, price ? formatCurrency(price.amountCents) : "Sem valor negociado", validFrom && `Vigência: ${validFrom}`, validUntil && `até ${validUntil}`, price?.source || mapping?.source].filter(Boolean).join(" · ")}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {uniqueStatusBadges.map((badge) => (
                          <span
                            key={badge.key}
                            className={badge.tone === "warning"
                              ? "rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800"
                              : "rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600"}
                          >
                            {badge.label}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      <button type="button" onClick={() => { if (mapping) editTussMapping(mapping); if (price) editProcedurePrice(price); }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-normal text-slate-600 hover:bg-slate-50">Editar configuração</button>
                      {mapping && <button type="button" onClick={() => void revalidateAffectedTussMapping(mapping.id)} className="rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-normal text-indigo-700 hover:bg-indigo-50">Revalidar atendimentos afetados</button>}
                      {price?.active !== false && <button type="button" onClick={() => void disableProcedurePrice(price.id)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-normal text-slate-600 hover:bg-slate-50">Desativar preço</button>}
                      {!price && mapping?.active !== false && <button type="button" onClick={() => void disableTussMapping(mapping.id)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-normal text-slate-600 hover:bg-slate-50">Desativar De/Para</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <details
          open={supportCatalogOpen}
          onToggle={(event) => setSupportCatalogOpen(event.currentTarget.open)}
          className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/50 p-4"
        >
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">Cadastros de apoio</summary>
          <p className="mt-2 text-xs text-slate-500">Esses cadastros são referências usadas nas configurações de faturamento e não representam cobranças duplicadas.</p>
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
                      <div><p className="text-sm font-medium text-slate-800">{service.name}</p><p className="text-xs text-slate-500">{[service.internalCode, service.serviceType, service.active === false ? "Procedimento inativo" : "Ativo"].filter(Boolean).join(" · ")}</p></div>
                      <div className="flex gap-1">
                        <button type="button" aria-label={`Editar procedimento ${service.name || ""}`} onClick={() => editTussService(service)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-normal text-slate-600">Editar</button>
                        {service.active !== false ? (
                          <button type="button" aria-label={`Inativar procedimento ${service.name || ""}`} disabled={serviceActionLoading} onClick={() => void disableTussService(service.id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-normal text-slate-600 disabled:opacity-50">{serviceActionLoading ? <Loader2 size={12} className="animate-spin" /> : null}Inativar</button>
                        ) : (
                          <button type="button" aria-label={`Reativar procedimento ${service.name || ""}`} disabled={serviceActionLoading} onClick={() => void reactivateTussService(service.id)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2 py-1 text-xs font-normal text-emerald-700 disabled:opacity-50">{serviceActionLoading ? <Loader2 size={12} className="animate-spin" /> : null}Reativar</button>
                        )}
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
                      <div><p className="text-sm font-medium text-slate-800">TUSS {code.code}</p><p className="text-xs text-slate-500">{[code.description, code.version, code.active === false ? "Inativo" : "Ativo"].filter(Boolean).join(" · ")}</p></div>
                      <div className="flex gap-1">
                        <button type="button" aria-label={`Editar código TUSS ${code.code || ""}`} onClick={() => editTussCode(code)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-normal text-slate-600">Editar</button>
                        {code.active !== false ? (
                          <button type="button" aria-label={`Inativar código TUSS ${code.code || ""}`} disabled={codeActionLoading} onClick={() => void disableTussCode(code.id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-normal text-slate-600 disabled:opacity-50">{codeActionLoading ? <Loader2 size={12} className="animate-spin" /> : null}Inativar</button>
                        ) : (
                          <button type="button" aria-label={`Reativar código TUSS ${code.code || ""}`} disabled={codeActionLoading} onClick={() => void reactivateTussCode(code.id)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2 py-1 text-xs font-normal text-emerald-700 disabled:opacity-50">{codeActionLoading ? <Loader2 size={12} className="animate-spin" /> : null}Reativar</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}
