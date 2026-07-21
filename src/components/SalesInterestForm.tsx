import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { GoogleIcon } from "./GoogleIcon";
import {
  PUBLIC_ACTIVE_PATIENT_PRICE_LABEL,
  SALES_CONTACT_CONSENT_VERSION,
  SALES_OPERATION_TYPE_LABELS,
  SALES_OPERATION_TYPES,
  type SalesOperationType,
} from "../constants/salesCommercial";
import { formatProfessionalRegistry } from "../utils/professionalRegistry";

const BRAZIL_STATES = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;

const createIdempotencyKey = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `sales-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};

type SalesInterestFormProps = {
  initialName?: string;
  initialEmail?: string;
  initialAcquisitionChannel?: string;
  googleVerified?: boolean;
  onStartGoogle?: () => void;
  onSubmitted?: () => void;
};

export const SalesInterestForm = ({
  initialName = "",
  initialEmail = "",
  initialAcquisitionChannel = "organic",
  googleVerified = false,
  onStartGoogle,
  onSubmitted,
}: SalesInterestFormProps) => {
  const startedAtRef = useRef(Date.now());
  const idempotencyKeyRef = useRef(createIdempotencyKey());
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState("");
  const [professionalRegistry, setProfessionalRegistry] = useState("");
  const [clinicName, setClinicName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [estimatedActivePatients, setEstimatedActivePatients] = useState("");
  const [estimatedProfessionals, setEstimatedProfessionals] = useState("");
  const [operationType, setOperationType] = useState<SalesOperationType>(
    "independent_professional",
  );
  const [acquisitionChannel, setAcquisitionChannel] = useState(
    initialAcquisitionChannel || "organic",
  );
  const [jobTitle, setJobTitle] = useState("");
  const [preferredContactPeriod, setPreferredContactPeriod] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState("");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (initialName) setName(initialName);
  }, [initialName]);

  useEffect(() => {
    if (initialEmail) setEmail(initialEmail);
  }, [initialEmail]);

  const inputClass =
    "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-normal text-slate-800 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100";
  const labelClass = "mb-1.5 block text-[11px] font-medium text-slate-600";
  const operationOptions = useMemo(
    () =>
      SALES_OPERATION_TYPES.map((value) => ({
        value,
        label: SALES_OPERATION_TYPE_LABELS[value],
      })),
    [],
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!consent) {
      setError("Autorize o contato comercial para enviar seu interesse.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/public/sales-leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKeyRef.current,
        },
        credentials: "include",
        body: JSON.stringify({
          name,
          email,
          phone,
          professionalRegistry,
          clinicName,
          city,
          state,
          estimatedActivePatients:
            estimatedActivePatients === ""
              ? 0
              : Number(estimatedActivePatients),
          estimatedProfessionals:
            estimatedProfessionals === ""
              ? null
              : Number(estimatedProfessionals),
          operationType,
          acquisitionChannel,
          jobTitle,
          preferredContactPeriod,
          notes,
          contactConsent: consent,
          consentVersion: SALES_CONTACT_CONSENT_VERSION,
          consentPurpose: "sales_contact",
          source: googleVerified ? "google_interest" : "public_landing",
          googleVerified,
          website,
          formStartedAt: startedAtRef.current,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(
          data?.message ||
            data?.error ||
            "Não foi possível registrar seu interesse.",
        );
      }
      setSubmitted(true);
      onSubmitted?.();
    } catch (submitError: any) {
      setError(
        submitError?.message ||
          "Não foi possível registrar seu interesse. Tente novamente.",
      );
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div
        className="rounded-3xl border border-emerald-100 bg-emerald-50/70 p-6 text-center"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 className="mx-auto mb-3 text-emerald-600" size={34} />
        <h3 className="text-base font-semibold text-slate-900">
          Interesse recebido
        </h3>
        <p className="mt-2 text-sm font-normal leading-6 text-slate-600">
          Recebemos seu interesse na Verto. Entraremos em contato para conhecer
          sua operação e apresentar a plataforma.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-3">
        <p className="text-sm font-semibold text-violet-900">
          {PUBLIC_ACTIVE_PATIENT_PRICE_LABEL}
        </p>
        <p className="mt-1 text-xs font-normal leading-5 text-violet-700">
          Condições especiais podem ser disponibilizadas após uma apresentação
          da Verto.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className={labelClass} htmlFor="sales-name">
            Nome completo
          </label>
          <input
            id="sales-name"
            className={inputClass}
            required
            maxLength={180}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="sales-phone">
            WhatsApp com DDD
          </label>
          <input
            id="sales-phone"
            className={inputClass}
            required
            maxLength={20}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(11) 99999-9999"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="sales-email">
            E-mail
          </label>
          <input
            id="sales-email"
            className={inputClass}
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            readOnly={googleVerified && Boolean(initialEmail)}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="sales-registry">
            Registro profissional{" "}
            {operationType !== "independent_professional" ? (
              <span className="text-slate-400">(quando aplicável)</span>
            ) : null}
          </label>
          <input
            id="sales-registry"
            className={inputClass}
            required={operationType === "independent_professional"}
            maxLength={80}
            value={professionalRegistry}
            onChange={(e) =>
              setProfessionalRegistry(
                formatProfessionalRegistry(e.target.value),
              )
            }
            placeholder="Ex.: CRP 06/123456"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="sales-clinic">
            Clínica ou consultório
          </label>
          <input
            id="sales-clinic"
            className={inputClass}
            required
            maxLength={180}
            value={clinicName}
            onChange={(e) => setClinicName(e.target.value)}
            autoComplete="organization"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="sales-city">
            Cidade
          </label>
          <input
            id="sales-city"
            className={inputClass}
            required
            maxLength={120}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            autoComplete="address-level2"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="sales-state">
            Estado
          </label>
          <select
            id="sales-state"
            className={inputClass}
            required
            value={state}
            onChange={(e) => setState(e.target.value)}
            autoComplete="address-level1"
          >
            <option value="">Selecione</option>
            {BRAZIL_STATES.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="sales-patients">
            Pacientes ativos aproximados
          </label>
          <input
            id="sales-patients"
            className={inputClass}
            required
            min={0}
            max={100000}
            value={estimatedActivePatients}
            onChange={(e) => setEstimatedActivePatients(e.target.value)}
            type="number"
            inputMode="numeric"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="sales-operation">
            Tipo de operação
          </label>
          <select
            id="sales-operation"
            className={inputClass}
            required
            value={operationType}
            onChange={(e) =>
              setOperationType(e.target.value as SalesOperationType)
            }
          >
            {operationOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="sales-channel">
            Como conheceu a Verto
          </label>
          <input
            id="sales-channel"
            className={inputClass}
            required
            maxLength={120}
            value={acquisitionChannel}
            onChange={(e) => setAcquisitionChannel(e.target.value)}
            placeholder="Indicação, Instagram, Google..."
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="sales-title">
            Cargo ou função <span className="text-slate-400">(opcional)</span>
          </label>
          <input
            id="sales-title"
            className={inputClass}
            maxLength={120}
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="sales-professionals">
            Profissionais aproximados{" "}
            <span className="text-slate-400">(opcional)</span>
          </label>
          <input
            id="sales-professionals"
            className={inputClass}
            min={0}
            max={10000}
            value={estimatedProfessionals}
            onChange={(e) => setEstimatedProfessionals(e.target.value)}
            type="number"
            inputMode="numeric"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="sales-period">
            Melhor período <span className="text-slate-400">(opcional)</span>
          </label>
          <select
            id="sales-period"
            className={inputClass}
            value={preferredContactPeriod}
            onChange={(e) => setPreferredContactPeriod(e.target.value)}
          >
            <option value="">Sem preferência</option>
            <option value="morning">Manhã</option>
            <option value="afternoon">Tarde</option>
            <option value="evening">Noite</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className={labelClass} htmlFor="sales-notes">
            Observação <span className="text-slate-400">(opcional)</span>
          </label>
          <textarea
            id="sales-notes"
            className={`${inputClass} min-h-24 resize-y`}
            maxLength={1500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <div className="hidden" aria-hidden="true">
        <label htmlFor="sales-website">Website</label>
        <input
          id="sales-website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-xs font-normal leading-5 text-slate-600">
        <input
          className="mt-1 h-4 w-4 accent-violet-600"
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          Autorizo contato da Verto exclusivamente para conhecer minha operação
          e tratar desta possível contratação.
        </span>
      </label>

      {error ? (
        <p className="text-sm font-normal text-rose-600" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/15 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? <Loader2 className="animate-spin" size={17} /> : null}
        {loading ? "Enviando interesse..." : "Solicitar apresentação"}
      </button>

      {onStartGoogle && !googleVerified ? (
        <button
          type="button"
          onClick={onStartGoogle}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <GoogleIcon size={16} /> Preencher nome e e-mail com Google
        </button>
      ) : null}
    </form>
  );
};
