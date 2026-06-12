import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, Loader2, Plus, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { dataService } from "../services/dataService";

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
  guideType?: string | null;
  billingUnit?: string | null;
  quantityRule?: string | null;
  defaultQuantity?: number | null;
  amountCents?: number | null;
  requiresAuthorization?: boolean;
  requiresGuide?: boolean;
  requiresReport?: boolean;
  requiresSignature?: boolean;
  requiresProfessionalRegistry?: boolean;
  requiresPatientDocument?: boolean;
  useActualDuration?: boolean;
  validFrom?: string | null;
  validTo?: string | null;
  active: boolean;
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
  guideType: "sp_sadt",
  billingUnit: "session",
  quantityRule: "per_session",
  defaultQuantity: "1",
  amountCents: "",
  requiresAuthorization: false,
  requiresGuide: false,
  requiresReport: false,
  requiresSignature: false,
  requiresProfessionalRegistry: false,
  requiresPatientDocument: false,
  useActualDuration: false,
  validFrom: "",
  validTo: "",
};

export function PayerRequirementsPanel() {
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
  const [tussLoading, setTussLoading] = useState(false);
  const [tussServiceForm, setTussServiceForm] = useState(defaultTussServiceForm);
  const [tussCodeForm, setTussCodeForm] = useState(defaultTussCodeForm);
  const [tussMappingForm, setTussMappingForm] = useState(defaultTussMappingForm);
  const [editingTussServiceId, setEditingTussServiceId] = useState("");
  const [editingTussCodeId, setEditingTussCodeId] = useState("");
  const [editingTussMappingId, setEditingTussMappingId] = useState("");
  const [tussActionInfo, setTussActionInfo] = useState("");

  const selectedPayer = useMemo(
    () => payers.find((payer) => payer.id === selectedPayerId) || null,
    [payers, selectedPayerId],
  );

  const loadPayers = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await dataService.getPayers({ status: "ACTIVE", limit: 80 });
      if (!result?.success) {
        setError(result?.error || "Não foi possível carregar pagadores agora.");
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
      const [servicesResult, codesResult, mappingsResult] = await Promise.all([
        dataService.getTussServices({ active: true, limit: 160 }),
        dataService.getTussCodes({ active: true, limit: 240 }),
        dataService.getPayerTussMappings({ payerId, active: true, limit: 180 }),
      ]);
      if (servicesResult?.success) setTussServices(Array.isArray(servicesResult.data) ? servicesResult.data : []);
      if (codesResult?.success) setTussCodes(Array.isArray(codesResult.data) ? codesResult.data : []);
      if (mappingsResult?.success) setTussMappings(Array.isArray(mappingsResult.data) ? mappingsResult.data : []);
      setTussMappingForm((current) => ({
        ...current,
        serviceCatalogId: current.serviceCatalogId || servicesResult?.data?.[0]?.id || "",
        tussCodeId: current.tussCodeId || codesResult?.data?.[0]?.id || "",
      }));
    } finally {
      setTussLoading(false);
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

  const upsertTussMappingInState = (item: PayerTussMapping) => {
    setTussMappings((current) => {
      const index = current.findIndex((mapping) => mapping.id === item.id);
      if (index < 0) return [item, ...current];
      return current.map((mapping) => mapping.id === item.id ? item : mapping);
    });
  };

  const upsertTussServiceInState = (item: TussService) => {
    setTussServices((current) => Array.from(new Map([item, ...current].map((service) => [service.id, service])).values()));
  };

  const upsertTussCodeInState = (item: TussCode) => {
    setTussCodes((current) => Array.from(new Map([item, ...current].map((code) => [code.id, code])).values()));
  };

  const currentMonthRange = () => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { from: from.toISOString(), to: to.toISOString() };
  };

  const createTussService = async () => {
    if (tussServiceForm.name.trim().length < 2) return;
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
        defaultAmountCents: tussServiceForm.defaultAmountCents ? Number(tussServiceForm.defaultAmountCents) : null,
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
      setTussActionInfo(editingTussCodeId ? "CÃ³digo TUSS atualizado." : "CÃ³digo TUSS cadastrado.");
    } finally {
      setSaving(false);
    }
  };

  const createTussMapping = async () => {
    if (!selectedPayerId || !tussMappingForm.serviceCatalogId) return;
    setSaving(true);
    setError("");
    setTussActionInfo("");
    try {
      const payload = {
        ...tussMappingForm,
        payerId: selectedPayerId,
        defaultQuantity: Number(tussMappingForm.defaultQuantity || 1),
        amountCents: tussMappingForm.amountCents ? Number(tussMappingForm.amountCents) : null,
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

  const editTussService = (service: TussService) => {
    setEditingTussServiceId(service.id);
    setTussServiceForm({
      internalCode: service.internalCode || "",
      name: service.name || "",
      description: service.description || "",
      specialty: service.specialty || "",
      serviceType: service.serviceType || "",
      defaultDurationMinutes: service.defaultDurationMinutes ? String(service.defaultDurationMinutes) : "",
      billingUnit: service.billingUnit || "session",
      defaultQuantity: service.defaultQuantity ? String(service.defaultQuantity) : "1",
      defaultAmountCents: service.defaultAmountCents ? String(service.defaultAmountCents) : "",
    });
  };

  const editTussCode = (code: TussCode) => {
    setEditingTussCodeId(code.id);
    setTussCodeForm({
      code: code.code || "",
      description: code.description || "",
      termType: code.termType || "",
      version: code.version || "",
      validFrom: code.validFrom || "",
      validTo: code.validTo || "",
    });
  };

  const editTussMapping = (mapping: PayerTussMapping) => {
    setEditingTussMappingId(mapping.id);
    setTussMappingForm({
      serviceCatalogId: mapping.serviceCatalogId || "",
      tussCodeId: mapping.tussCodeId || "",
      guideType: mapping.guideType || "sp_sadt",
      billingUnit: mapping.billingUnit || "session",
      quantityRule: mapping.quantityRule || "per_session",
      defaultQuantity: mapping.defaultQuantity ? String(mapping.defaultQuantity) : "1",
      amountCents: mapping.amountCents ? String(mapping.amountCents) : "",
      requiresAuthorization: Boolean(mapping.requiresAuthorization),
      requiresGuide: Boolean(mapping.requiresGuide),
      requiresReport: Boolean(mapping.requiresReport),
      requiresSignature: Boolean(mapping.requiresSignature),
      requiresProfessionalRegistry: Boolean(mapping.requiresProfessionalRegistry),
      requiresPatientDocument: Boolean(mapping.requiresPatientDocument),
      useActualDuration: Boolean(mapping.useActualDuration),
      validFrom: mapping.validFrom || "",
      validTo: mapping.validTo || "",
    });
  };

  const disableTussService = async (serviceId: string) => {
    setSaving(true);
    setError("");
    setTussActionInfo("");
    try {
      const result = await dataService.updateTussService(serviceId, { active: false });
      if (!result?.success) {
        setError(result?.error || "NÃ£o foi possÃ­vel inativar o procedimento agora.");
        return;
      }
      setTussServices((current) => current.filter((service) => service.id !== serviceId));
      if (editingTussServiceId === serviceId) {
        setEditingTussServiceId("");
        setTussServiceForm(defaultTussServiceForm);
      }
      setTussActionInfo("Procedimento inativado.");
    } finally {
      setSaving(false);
    }
  };

  const disableTussCode = async (codeId: string) => {
    setSaving(true);
    setError("");
    setTussActionInfo("");
    try {
      const result = await dataService.updateTussCode(codeId, { active: false });
      if (!result?.success) {
        setError(result?.error || "NÃ£o foi possÃ­vel inativar o cÃ³digo TUSS agora.");
        return;
      }
      setTussCodes((current) => current.filter((code) => code.id !== codeId));
      if (editingTussCodeId === codeId) {
        setEditingTussCodeId("");
        setTussCodeForm(defaultTussCodeForm);
      }
      setTussActionInfo("CÃ³digo TUSS inativado.");
    } finally {
      setSaving(false);
    }
  };

  const revalidateAffectedTussMapping = async (mappingId: string) => {
    setSaving(true);
    setError("");
    setTussActionInfo("");
    try {
      const result = await dataService.revalidatePayerTussMapping(mappingId, currentMonthRange());
      if (!result?.success) {
        setError(result?.error || "NÃ£o foi possÃ­vel revalidar os atendimentos afetados agora.");
        return;
      }
      const counts = result.counts || result.data || {};
      const resolved = Number(counts.resolved || counts.updated || 0);
      const found = Number(counts.found || 0);
      setTussActionInfo(`${found} atendimento(s) afetado(s), ${resolved} resolvido(s) para o perÃ­odo atual.`);
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
      setTussMappings((current) => current.filter((mapping) => mapping.id !== mappingId));
      if (editingTussMappingId === mappingId) {
        setEditingTussMappingId("");
        setTussMappingForm(defaultTussMappingForm);
      }
      setTussActionInfo("Mapeamento inativado.");
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
            Pagadores e regras
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Configure exigências mínimas para pré-faturamento e auditoria operacional.
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

      {error && <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div>}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(240px,0.9fr)_minmax(0,1.4fr)]">
        <div className="space-y-3">
          <div className="rounded-2xl bg-white p-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Novo pagador</p>
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
              Criar pagador
            </button>
          </div>

          <div className="space-y-2">
            {payers.length === 0 ? (
              <p className="rounded-2xl bg-white p-4 text-sm font-semibold text-slate-500">Nenhum pagador cadastrado.</p>
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
            </div>
            <ClipboardCheck size={18} className="text-slate-400" />
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

      <div className="mt-5 rounded-2xl bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-bold text-slate-900">Procedimentos e TUSS</p>
            <p className="mt-1 text-xs text-slate-500">Configure catalogo interno, codigos usados pela clinica e mapeamento por pagador para pre-faturamento.</p>
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

        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-slate-100 p-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Procedimento interno</p>
            <input
              value={tussServiceForm.name}
              onChange={(event) => setTussServiceForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Sessao ABA individual"
              className="mt-3 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
            />
            <textarea
              value={tussServiceForm.description}
              onChange={(event) => setTussServiceForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Descricao do procedimento interno"
              className="mt-2 min-h-[72px] w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
            />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                value={tussServiceForm.internalCode}
                onChange={(event) => setTussServiceForm((current) => ({ ...current, internalCode: event.target.value }))}
                placeholder="Codigo interno"
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
                placeholder="Tipo de sessao"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
              <input
                type="number"
                min="1"
                value={tussServiceForm.defaultDurationMinutes}
                onChange={(event) => setTussServiceForm((current) => ({ ...current, defaultDurationMinutes: event.target.value }))}
                placeholder="Duracao padrao (min)"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <select
                value={tussServiceForm.billingUnit}
                onChange={(event) => setTussServiceForm((current) => ({ ...current, billingUnit: event.target.value }))}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              >
                <option value="session">Sessao</option>
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
                placeholder="Quantidade padrao"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
            </div>
            <div className="mt-2">
              <input
                type="number"
                min="0"
                value={tussServiceForm.defaultAmountCents}
                onChange={(event) => setTussServiceForm((current) => ({ ...current, defaultAmountCents: event.target.value }))}
                placeholder="Valor em centavos"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
            </div>
            {editingTussServiceId && (
              <button
                type="button"
                onClick={() => { setEditingTussServiceId(""); setTussServiceForm(defaultTussServiceForm); }}
                className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500"
              >
                Cancelar edicao
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

          <div className="rounded-2xl border border-slate-100 p-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Codigo TUSS</p>
            <input
              value={tussCodeForm.code}
              onChange={(event) => setTussCodeForm((current) => ({ ...current, code: event.target.value }))}
              placeholder="Codigo"
              className="mt-3 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
            />
            <input
              value={tussCodeForm.description}
              onChange={(event) => setTussCodeForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Descricao controlada"
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
                placeholder="Versao/tabela"
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
                Cancelar edicao
              </button>
            )}
            <button
              type="button"
              onClick={() => void createTussCode()}
              disabled={saving || tussCodeForm.code.trim().length < 2 || tussCodeForm.description.trim().length < 2}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              <Plus size={15} />
              {editingTussCodeId ? "Atualizar codigo" : "Salvar codigo"}
            </button>
          </div>

          <div className="rounded-2xl border border-slate-100 p-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Mapeamento por pagador</p>
            <select
              value={tussMappingForm.serviceCatalogId}
              onChange={(event) => setTussMappingForm((current) => ({ ...current, serviceCatalogId: event.target.value }))}
              className="mt-3 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
            >
              <option value="">Procedimento</option>
              {tussServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
            </select>
            <select
              value={tussMappingForm.tussCodeId}
              onChange={(event) => setTussMappingForm((current) => ({ ...current, tussCodeId: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
            >
              <option value="">Sem codigo TUSS</option>
              {tussCodes.map((code) => <option key={code.id} value={code.id}>{code.code} - {code.description}</option>)}
            </select>
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
                <option value="session">Sessao</option>
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
                <option value="per_session">Por sessao</option>
                <option value="per_hour">Por hora</option>
                <option value="duration_based">Por duracao</option>
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
                type="number"
                min="0"
                value={tussMappingForm.amountCents}
                onChange={(event) => setTussMappingForm((current) => ({ ...current, amountCents: event.target.value }))}
                placeholder="Valor em centavos"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none"
              />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {[
                ["requiresAuthorization", "Autorizacao"],
                ["requiresGuide", "Guia"],
                ["requiresSignature", "Assinatura"],
                ["requiresReport", "Relatorio"],
                ["requiresProfessionalRegistry", "Registro"],
                ["requiresPatientDocument", "Carteirinha"],
                ["useActualDuration", "Duracao real"],
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
                Cancelar edicao
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

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-100 p-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Procedimentos cadastrados</p>
            <div className="mt-2 space-y-2">
              {tussServices.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 p-3 text-xs font-bold text-slate-500">Nenhum procedimento ativo.</p>
              ) : tussServices.slice(0, 8).map((service) => (
                <div key={service.id} className="rounded-2xl border border-slate-100 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{service.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {[service.internalCode, service.serviceType, service.billingUnit, service.defaultAmountCents ? `R$ ${(Number(service.defaultAmountCents) / 100).toFixed(2)}` : ""].filter(Boolean).join(" · ") || "Sem detalhes"}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => editTussService(service)} className="rounded-xl border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500">Editar</button>
                      <button type="button" onClick={() => void disableTussService(service.id)} className="rounded-xl border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500">Inativar</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 p-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Codigos TUSS usados</p>
            <div className="mt-2 space-y-2">
              {tussCodes.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 p-3 text-xs font-bold text-slate-500">Nenhum codigo TUSS ativo.</p>
              ) : tussCodes.slice(0, 8).map((code) => (
                <div key={code.id} className="rounded-2xl border border-slate-100 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-slate-800">TUSS {code.code}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{[code.description, code.version].filter(Boolean).join(" · ")}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => editTussCode(code)} className="rounded-xl border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500">Editar</button>
                      <button type="button" onClick={() => void disableTussCode(code.id)} className="rounded-xl border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500">Inativar</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {tussMappings.length === 0 ? (
            <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">Nenhum mapeamento ativo para este pagador.</p>
          ) : tussMappings.map((mapping) => (
            <div key={mapping.id} className="rounded-2xl border border-slate-100 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-800">{mapping.serviceName || mapping.internalCode || "Procedimento"}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {[mapping.tussCode && `TUSS ${mapping.tussCode}`, mapping.guideType, mapping.billingUnit, mapping.quantityRule, mapping.amountCents ? `R$ ${(Number(mapping.amountCents) / 100).toFixed(2)}` : "valor pendente"].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => editTussMapping(mapping)}
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-50"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => void revalidateAffectedTussMapping(mapping.id)}
                    className="rounded-xl border border-indigo-200 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-50"
                  >
                    Revalidar atendimentos afetados
                  </button>
                  <button
                    type="button"
                    onClick={() => void disableTussMapping(mapping.id)}
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-50"
                  >
                    Desativar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
