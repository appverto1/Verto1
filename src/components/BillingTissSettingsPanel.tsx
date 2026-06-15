import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import { dataService } from "../services/dataService";

type Payer = {
  id: string;
  name: string;
  payerType?: string | null;
};

type Member = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
};

type ProfileMap = Record<string, any>;

const emptyProviderForm = {
  legalName: "",
  tradeName: "",
  documentType: "CNPJ",
  documentNumber: "",
  cnesCode: "",
  providerCode: "",
  ansProviderCode: "",
  addressLine: "",
  addressNumber: "",
  addressComplement: "",
  district: "",
  city: "",
  state: "",
  postalCode: "",
  phone: "",
  email: "",
};

const emptyPayerForm = {
  ansRegistration: "",
  operatorCode: "",
  tissVersion: "",
  defaultGuideType: "sp_sadt",
  requiresAuthorization: false,
  requiresProviderCode: false,
  requiresCnes: false,
  requiresCbo: false,
  requiresExecutantRegistry: false,
  requiresBeneficiaryCard: true,
};

const emptyProfessionalForm = {
  displayName: "",
  documentType: "CPF",
  documentNumber: "",
  councilType: "",
  councilNumber: "",
  councilState: "",
  cboCode: "",
  specialtyName: "",
  providerCode: "",
};

const normalizeProfile = (profile: any = {}) => ({
  legalName: profile.legal_name || "",
  tradeName: profile.trade_name || "",
  documentType: profile.document_type || "CNPJ",
  documentNumber: profile.document_number || "",
  cnesCode: profile.cnes_code || "",
  providerCode: profile.provider_code || "",
  ansProviderCode: profile.ans_provider_code || "",
  addressLine: profile.address_line || "",
  addressNumber: profile.address_number || "",
  addressComplement: profile.address_complement || "",
  district: profile.district || "",
  city: profile.city || "",
  state: profile.state || "",
  postalCode: profile.postal_code || "",
  phone: profile.phone || "",
  email: profile.email || "",
});

const normalizePayerProfile = (profile: any = {}) => ({
  ansRegistration: profile.ans_registration || "",
  operatorCode: profile.operator_code || "",
  tissVersion: profile.tiss_version || "",
  defaultGuideType: profile.default_guide_type || "sp_sadt",
  requiresAuthorization: Boolean(profile.requires_authorization),
  requiresProviderCode: Boolean(profile.requires_provider_code),
  requiresCnes: Boolean(profile.requires_cnes),
  requiresCbo: Boolean(profile.requires_cbo),
  requiresExecutantRegistry: Boolean(profile.requires_executant_registry),
  requiresBeneficiaryCard: profile.requires_beneficiary_card !== false,
});

const normalizeProfessionalProfile = (profile: any = {}, member?: Member | null) => ({
  displayName: profile.display_name || member?.name || "",
  documentType: profile.document_type || "CPF",
  documentNumber: profile.document_number || "",
  councilType: profile.council_type || "",
  councilNumber: profile.council_number || "",
  councilState: profile.council_state || "",
  cboCode: profile.cbo_code || "",
  specialtyName: profile.specialty_name || "",
  providerCode: profile.provider_code || "",
});

const isFilled = (value: unknown) => String(value ?? "").trim().length > 0;

function providerMissing(form: Record<string, any>) {
  const missing = [];
  if (!isFilled(form.legalName)) missing.push("razão social");
  if (!isFilled(form.documentNumber)) missing.push("CPF/CNPJ");
  return missing;
}

function payerMissing(profile: any) {
  const missing = [];
  if (!isFilled(profile?.ans_registration)) missing.push("registro ANS");
  if (!isFilled(profile?.tiss_version)) missing.push("versão TISS");
  return missing;
}

function professionalMissing(profile: any) {
  const missing = [];
  if (!isFilled(profile?.council_type)) missing.push("sem conselho");
  if (!isFilled(profile?.council_number)) missing.push("sem número");
  if (!isFilled(profile?.council_state)) missing.push("sem UF");
  if (!isFilled(profile?.cbo_code)) missing.push("sem CBO");
  return missing;
}

function Field({
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
    <label className="text-xs font-bold text-slate-600">
      {label}
      <input
        type={type}
        value={value || ""}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
      />
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function StatusPill({ missing }: { missing: string[] }) {
  if (missing.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-100">
        <CheckCircle2 size={13} /> completo
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-100">
      <AlertCircle size={13} /> {missing[0]}
    </span>
  );
}

export function BillingTissSettingsPanel({
  onNavigatePayers,
  onNavigateProfessionals,
}: {
  onNavigatePayers?: () => void;
  onNavigateProfessionals?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [savingKind, setSavingKind] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [providerForm, setProviderForm] = useState<Record<string, any>>(emptyProviderForm);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [payerProfiles, setPayerProfiles] = useState<ProfileMap>({});
  const [selectedPayerId, setSelectedPayerId] = useState("");
  const [payerForm, setPayerForm] = useState<Record<string, any>>(emptyPayerForm);
  const [members, setMembers] = useState<Member[]>([]);
  const [professionalProfiles, setProfessionalProfiles] = useState<ProfileMap>({});
  const [selectedProfessionalId, setSelectedProfessionalId] = useState("");
  const [professionalForm, setProfessionalForm] = useState<Record<string, any>>(emptyProfessionalForm);

  const professionals = useMemo(
    () => members.filter((member) => !["patient", "receptionist"].includes(String(member.role || "").toLowerCase())),
    [members],
  );
  const selectedPayer = payers.find((payer) => payer.id === selectedPayerId) || null;
  const selectedProfessional = professionals.find((member) => member.id === selectedProfessionalId) || null;

  const loadAll = async () => {
    setLoading(true);
    setError("");
    try {
      const [provider, payersResult, payerProfilesResult, membersResult, professionalProfilesResult] = await Promise.all([
        dataService.getClinicTissProfile(),
        dataService.getPayers({ status: "ACTIVE", limit: 100 }),
        dataService.getPayerTissProfiles(),
        dataService.getClinicMembers(),
        dataService.getProfessionalBillingProfiles(),
      ]);

      if (provider?.success) setProviderForm({ ...emptyProviderForm, ...normalizeProfile(provider.data || {}) });
      if (payersResult?.success) {
        const nextPayers = Array.isArray(payersResult.data) ? payersResult.data : [];
        setPayers(nextPayers);
        setSelectedPayerId((current) => current || nextPayers[0]?.id || "");
      }
      if (payerProfilesResult?.success) {
        const nextProfiles = Object.fromEntries(
          (Array.isArray(payerProfilesResult.data) ? payerProfilesResult.data : [])
            .map((profile: any) => [String(profile.payer_id || ""), profile])
            .filter(([id]) => id),
        );
        setPayerProfiles(nextProfiles);
      }
      if (membersResult?.success) {
        const nextMembers = Array.isArray(membersResult.data) ? membersResult.data : [];
        setMembers(nextMembers);
        const selectable = nextMembers.filter((member: Member) => !["patient", "receptionist"].includes(String(member.role || "").toLowerCase()));
        setSelectedProfessionalId((current) => current || selectable[0]?.id || "");
      }
      if (professionalProfilesResult?.success) {
        const nextProfiles = Object.fromEntries(
          (Array.isArray(professionalProfilesResult.data) ? professionalProfilesResult.data : [])
            .map((profile: any) => [String(profile.professional_id || ""), profile])
            .filter(([id]) => id),
        );
        setProfessionalProfiles(nextProfiles);
      }
    } catch {
      setError("Não foi possível carregar os cadastros globais de Faturamento e TISS.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    setPayerForm({ ...emptyPayerForm, ...normalizePayerProfile(payerProfiles[selectedPayerId] || {}) });
  }, [payerProfiles, selectedPayerId]);

  useEffect(() => {
    setProfessionalForm({
      ...emptyProfessionalForm,
      ...normalizeProfessionalProfile(professionalProfiles[selectedProfessionalId] || {}, selectedProfessional),
    });
  }, [professionalProfiles, selectedProfessional, selectedProfessionalId]);

  const updateProvider = (key: string, value: any) => setProviderForm((current) => ({ ...current, [key]: value }));
  const updatePayer = (key: string, value: any) => setPayerForm((current) => ({ ...current, [key]: value }));
  const updateProfessional = (key: string, value: any) => setProfessionalForm((current) => ({ ...current, [key]: value }));

  const saveProvider = async () => {
    setSavingKind("provider");
    setError("");
    setMessage("");
    try {
      const result = await dataService.updateClinicTissProfile(providerForm);
      if (!result?.success) {
        setError(result?.error || "Não foi possível salvar os dados globais do prestador.");
        return;
      }
      setProviderForm({ ...emptyProviderForm, ...normalizeProfile(result.data || providerForm) });
      setMessage("Dados do prestador salvos. Pré-guias afetadas foram marcadas para revalidação.");
    } finally {
      setSavingKind("");
    }
  };

  const savePayer = async () => {
    if (!selectedPayerId) return;
    setSavingKind("payer");
    setError("");
    setMessage("");
    try {
      const result = await dataService.updatePayerTissProfile(selectedPayerId, payerForm);
      if (!result?.success) {
        setError(result?.error || "Não foi possível salvar o perfil TISS global do pagador.");
        return;
      }
      setPayerProfiles((current) => ({ ...current, [selectedPayerId]: result.data || {} }));
      setMessage("Dados do pagador salvos. Pré-guias deste pagador foram marcadas para revalidação.");
    } finally {
      setSavingKind("");
    }
  };

  const saveProfessional = async () => {
    if (!selectedProfessionalId) return;
    setSavingKind("professional");
    setError("");
    setMessage("");
    try {
      const result = await dataService.updateProfessionalBillingProfile(selectedProfessionalId, professionalForm);
      if (!result?.success) {
        setError(result?.error || "Não foi possível salvar o perfil faturável global do profissional.");
        return;
      }
      setProfessionalProfiles((current) => ({ ...current, [selectedProfessionalId]: result.data || {} }));
      setMessage("Perfil do profissional salvo. Pré-guias deste profissional foram marcadas para revalidação.");
    } finally {
      setSavingKind("");
    }
  };

  const selectedPayerMissing = payerMissing(payerProfiles[selectedPayerId]);
  const selectedProfessionalMissing = professionalMissing(professionalProfiles[selectedProfessionalId]);

  return (
    <section className="space-y-5 border-t border-slate-200 pt-8" aria-label="Configurações de Faturamento e TISS">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold uppercase tracking-widest text-slate-400">Faturamento e TISS</h4>
          <p className="mt-1 max-w-3xl text-sm font-medium text-slate-600">
            Cadastros mestres reutilizados por Pré-guia TISS, Pré-faturamento, Fechamento, relatórios e exportações. Estes dados não são preenchidos atendimento por atendimento.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAll()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Atualizar cadastros
        </button>
      </div>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div>}
      {message && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{message}</div>}

      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Building2 size={18} className="text-indigo-600" />
            <div>
              <div className="text-sm font-bold text-slate-900">Dados do prestador / clínica</div>
              <div className="text-xs font-medium text-slate-500">Fonte mestre: clinic_tiss_profiles.</div>
            </div>
          </div>
          <StatusPill missing={providerMissing(providerForm)} />
        </div>
        <p className="rounded-md border border-indigo-100 bg-white px-3 py-2 text-xs font-medium text-slate-600">
          Você está editando o perfil faturável global da clínica. Essa alteração será usada em novas pré-guias e pode revalidar pré-guias pendentes.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Razão social" value={providerForm.legalName} onChange={(value) => updateProvider("legalName", value)} maxLength={180} />
          <Field label="Nome fantasia" value={providerForm.tradeName} onChange={(value) => updateProvider("tradeName", value)} maxLength={180} />
          <label className="text-xs font-bold text-slate-600">
            Tipo de documento
            <select value={providerForm.documentType || "CNPJ"} onChange={(event) => updateProvider("documentType", event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium">
              <option value="CNPJ">CNPJ</option>
              <option value="CPF">CPF</option>
            </select>
          </label>
          <Field label="CPF/CNPJ" value={providerForm.documentNumber} onChange={(value) => updateProvider("documentNumber", value)} maxLength={40} />
          <Field label="CNES" value={providerForm.cnesCode} onChange={(value) => updateProvider("cnesCode", value)} maxLength={40} />
          <Field label="Código do prestador" value={providerForm.providerCode} onChange={(value) => updateProvider("providerCode", value)} maxLength={80} />
          <Field label="Endereço" value={providerForm.addressLine} onChange={(value) => updateProvider("addressLine", value)} maxLength={180} />
          <Field label="Número" value={providerForm.addressNumber} onChange={(value) => updateProvider("addressNumber", value)} maxLength={40} />
          <Field label="Cidade" value={providerForm.city} onChange={(value) => updateProvider("city", value)} maxLength={120} />
          <Field label="UF" value={providerForm.state} onChange={(value) => updateProvider("state", value.toUpperCase().slice(0, 2))} maxLength={2} />
          <Field label="Telefone" value={providerForm.phone} onChange={(value) => updateProvider("phone", value)} maxLength={40} />
          <Field label="E-mail" value={providerForm.email} onChange={(value) => updateProvider("email", value)} type="email" maxLength={160} />
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={() => void saveProvider()} disabled={savingKind === "provider"} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-60">
            {savingKind === "provider" ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Salvar dados do prestador
          </button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-indigo-600" />
              <div>
                <div className="text-sm font-bold text-slate-900">Operadoras / pagadores</div>
                <div className="text-xs font-medium text-slate-500">Fonte mestre: payer_tiss_profiles.</div>
              </div>
            </div>
            {selectedPayerId && <StatusPill missing={selectedPayerMissing} />}
          </div>
          <div className="flex gap-2">
            <select value={selectedPayerId} onChange={(event) => setSelectedPayerId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium">
              {payers.length === 0 ? <option value="">Nenhum pagador ativo</option> : payers.map((payer) => <option key={payer.id} value={payer.id}>{payer.name}</option>)}
            </select>
            <button type="button" onClick={onNavigatePayers} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Pagadores</button>
          </div>
          <p className="rounded-md border border-indigo-100 bg-white px-3 py-2 text-xs font-medium text-slate-600">
            Você está editando o perfil TISS global deste pagador. Regras de ANS, guia, autorização, CBO, registro e carteirinha serão reutilizadas automaticamente.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Registro ANS" value={payerForm.ansRegistration} onChange={(value) => updatePayer("ansRegistration", value)} maxLength={80} />
            <Field label="Código da operadora" value={payerForm.operatorCode} onChange={(value) => updatePayer("operatorCode", value)} maxLength={80} />
            <Field label="Versão TISS" value={payerForm.tissVersion} onChange={(value) => updatePayer("tissVersion", value)} maxLength={80} />
            <label className="text-xs font-bold text-slate-600">
              Tipo de guia padrão
              <select value={payerForm.defaultGuideType || "sp_sadt"} onChange={(event) => updatePayer("defaultGuideType", event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium">
                <option value="sp_sadt">SP/SADT</option>
                <option value="consulta">Consulta</option>
                <option value="other">Outro</option>
              </select>
            </label>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <Toggle label="Exige autorização" checked={Boolean(payerForm.requiresAuthorization)} onChange={(value) => updatePayer("requiresAuthorization", value)} />
            <Toggle label="Exige CNES" checked={Boolean(payerForm.requiresCnes)} onChange={(value) => updatePayer("requiresCnes", value)} />
            <Toggle label="Exige CBO" checked={Boolean(payerForm.requiresCbo)} onChange={(value) => updatePayer("requiresCbo", value)} />
            <Toggle label="Exige registro profissional" checked={Boolean(payerForm.requiresExecutantRegistry)} onChange={(value) => updatePayer("requiresExecutantRegistry", value)} />
            <Toggle label="Exige código do prestador" checked={Boolean(payerForm.requiresProviderCode)} onChange={(value) => updatePayer("requiresProviderCode", value)} />
            <Toggle label="Exige carteirinha" checked={Boolean(payerForm.requiresBeneficiaryCard)} onChange={(value) => updatePayer("requiresBeneficiaryCard", value)} />
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={() => void savePayer()} disabled={!selectedPayerId || savingKind === "payer"} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-60">
              {savingKind === "payer" ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Salvar pagador global
            </button>
          </div>
          {selectedPayer && <div className="text-xs font-medium text-slate-500">Selecionado: {selectedPayer.name}</div>}
        </div>

        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Stethoscope size={18} className="text-indigo-600" />
              <div>
                <div className="text-sm font-bold text-slate-900">Profissionais executantes</div>
                <div className="text-xs font-medium text-slate-500">Fonte mestre: professional_billing_profiles.</div>
              </div>
            </div>
            {selectedProfessionalId && <StatusPill missing={selectedProfessionalMissing} />}
          </div>
          <div className="flex gap-2">
            <select value={selectedProfessionalId} onChange={(event) => setSelectedProfessionalId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium">
              {professionals.length === 0 ? <option value="">Nenhum profissional</option> : professionals.map((member) => (
                <option key={member.id} value={member.id}>{member.name || member.email || "Profissional"}</option>
              ))}
            </select>
            <button type="button" onClick={onNavigateProfessionals} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Equipe</button>
          </div>
          <p className="rounded-md border border-indigo-100 bg-white px-3 py-2 text-xs font-medium text-slate-600">
            Você está editando o perfil faturável global deste profissional. Essa alteração será reutilizada em todos os atendimentos deste profissional.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome de exibição" value={professionalForm.displayName} onChange={(value) => updateProfessional("displayName", value)} maxLength={180} />
            <label className="text-xs font-bold text-slate-600">
              Tipo de documento
              <select value={professionalForm.documentType || "CPF"} onChange={(event) => updateProfessional("documentType", event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium">
                <option value="CPF">CPF</option>
                <option value="CNPJ">CNPJ</option>
                <option value="OTHER">Outro</option>
              </select>
            </label>
            <Field label="Documento" value={professionalForm.documentNumber} onChange={(value) => updateProfessional("documentNumber", value)} maxLength={40} />
            <Field label="Conselho" value={professionalForm.councilType} onChange={(value) => updateProfessional("councilType", value)} maxLength={40} />
            <Field label="Número do conselho" value={professionalForm.councilNumber} onChange={(value) => updateProfessional("councilNumber", value)} maxLength={80} />
            <Field label="UF do conselho" value={professionalForm.councilState} onChange={(value) => updateProfessional("councilState", value.toUpperCase().slice(0, 2))} maxLength={2} />
            <Field label="CBO" value={professionalForm.cboCode} onChange={(value) => updateProfessional("cboCode", value)} maxLength={40} />
            <Field label="Especialidade" value={professionalForm.specialtyName} onChange={(value) => updateProfessional("specialtyName", value)} maxLength={120} />
            <Field label="Código do prestador" value={professionalForm.providerCode} onChange={(value) => updateProfessional("providerCode", value)} maxLength={80} />
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={() => void saveProfessional()} disabled={!selectedProfessionalId || savingKind === "professional"} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-60">
              {savingKind === "professional" ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Salvar profissional global
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {professionals.slice(0, 8).map((member) => {
              const missing = professionalMissing(professionalProfiles[member.id]);
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setSelectedProfessionalId(member.id)}
                  className={`rounded-full px-2 py-1 text-xs font-bold ring-1 ${member.id === selectedProfessionalId ? "bg-indigo-50 text-indigo-700 ring-indigo-200" : "bg-white text-slate-600 ring-slate-200"}`}
                  title={missing.length ? missing.join(", ") : "Completo"}
                >
                  {member.name || member.email || "Profissional"} · {missing.length ? missing[0] : "completo"}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
