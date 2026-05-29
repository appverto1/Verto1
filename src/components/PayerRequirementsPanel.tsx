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

export function PayerRequirementsPanel() {
  const [payers, setPayers] = useState<Payer[]>([]);
  const [selectedPayerId, setSelectedPayerId] = useState("");
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [payerForm, setPayerForm] = useState({ name: "", payerType: "INSURANCE", notes: "" });
  const [requirementForm, setRequirementForm] = useState(defaultRequirement());

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

  useEffect(() => {
    void loadPayers();
  }, []);

  useEffect(() => {
    void loadRequirements(selectedPayerId);
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
    </section>
  );
}
