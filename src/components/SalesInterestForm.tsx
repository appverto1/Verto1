import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  SALES_INTEREST_SUCCESS_MESSAGE,
  SALES_INTEREST_SUCCESS_TITLE,
} from "../constants/salesCommercial";

const createIdempotencyKey = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `sales-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};

type SalesInterestFormProps = {
  initialName?: string;
  initialAcquisitionChannel?: string;
  onSubmitted?: (lead: { name: string }) => void;
};

export const SalesInterestForm = ({
  initialName = "",
  initialAcquisitionChannel = "organic",
  onSubmitted,
}: SalesInterestFormProps) => {
  const startedAtRef = useRef(Date.now());
  const idempotencyKeyRef = useRef(createIdempotencyKey());
  const submissionInFlightRef = useRef(false);
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const [clinicName, setClinicName] = useState("");
  const [website, setWebsite] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (initialName) setName(initialName);
  }, [initialName]);

  const inputClass =
    "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-normal text-slate-800 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100";
  const labelClass = "mb-1.5 block text-[11px] font-medium text-slate-600";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submissionInFlightRef.current || submitted) return;

    const normalizedName = name.trim();
    const phoneDigits = phone.replace(/\D/g, "");
    setError("");
    if (normalizedName.length < 2) {
      setError("Informe seu nome.");
      return;
    }
    if (phoneDigits.length < 10 || phoneDigits.length > 13) {
      setError("Informe um WhatsApp válido com DDD.");
      return;
    }

    submissionInFlightRef.current = true;
    setLoading(true);
    let persisted = false;
    try {
      const response = await fetch("/api/public/sales-leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKeyRef.current,
        },
        credentials: "include",
        body: JSON.stringify({
          name: normalizedName,
          phone,
          clinicName: clinicName.trim(),
          acquisitionChannel:
            initialAcquisitionChannel.trim() || "public_landing",
          source: "public_landing",
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
      persisted = true;
      setSubmitted(true);
      onSubmitted?.({ name: normalizedName });
    } catch (submitError: any) {
      setError(
        submitError?.message ||
          "Não foi possível registrar seu interesse. Tente novamente.",
      );
    } finally {
      if (!persisted) submissionInFlightRef.current = false;
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div
        className="rounded-3xl border border-emerald-100 bg-emerald-50/70 p-6 text-center sm:p-8"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 className="mx-auto mb-3 text-emerald-600" size={34} />
        <h3 className="text-base font-semibold text-slate-900">
          {SALES_INTEREST_SUCCESS_TITLE}
        </h3>
        <p className="mx-auto mt-2 max-w-lg text-sm font-normal leading-6 text-slate-600">
          {SALES_INTEREST_SUCCESS_MESSAGE}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label className={labelClass} htmlFor="sales-name">
          Nome
        </label>
        <input
          id="sales-name"
          className={inputClass}
          required
          maxLength={180}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="sales-phone">
          WhatsApp
        </label>
        <input
          id="sales-phone"
          className={inputClass}
          required
          maxLength={20}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(11) 99999-9999"
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="sales-clinic">
          Nome da clínica <span className="text-slate-400">(opcional)</span>
        </label>
        <input
          id="sales-clinic"
          className={inputClass}
          maxLength={180}
          value={clinicName}
          onChange={(event) => setClinicName(event.target.value)}
          autoComplete="organization"
        />
      </div>

      <div className="hidden" aria-hidden="true">
        <label htmlFor="sales-website">Website</label>
        <input
          id="sales-website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>

      {error ? (
        <p className="text-sm font-normal text-rose-600" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/15 transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? <Loader2 className="animate-spin" size={17} /> : null}
        {loading ? "Enviando..." : "Enviar"}
      </button>
    </form>
  );
};
