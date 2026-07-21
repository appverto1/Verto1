import React, { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { formatPublicActivePatientPrice } from '../config/commercial';
import {
  BRAZILIAN_STATE_CODES,
  normalizeSalesLeadPhone,
  validateSalesLeadPayload,
  type SalesLeadPayload
} from '../utils/salesLead';

type SalesLeadFormProps = {
  initialName?: string;
  initialEmail?: string;
  acquisitionChannel?: string;
  onSubmitted?: (lead: any) => void;
};

const fieldClass = 'mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-800 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100';
const labelClass = 'block text-xs font-medium text-slate-600';

export const SalesLeadForm = ({ initialName = '', initialEmail = '', acquisitionChannel = '', onSubmitted }: SalesLeadFormProps) => {
  const [form, setForm] = useState<SalesLeadPayload>({
    name: initialName,
    email: initialEmail,
    phone: '',
    professionalRegistry: '',
    clinicName: '',
    city: '',
    state: '',
    estimatedActivePatients: 0,
    estimatedProfessionals: null,
    operationType: 'clinic',
    acquisitionChannel,
    preferredContactPeriod: '',
    roleTitle: '',
    notes: '',
    contactConsent: false,
    website: ''
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [requestError, setRequestError] = useState('');

  const update = (key: keyof SalesLeadPayload, value: any) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setRequestError('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const validation = validateSalesLeadPayload(form);
    setErrors(validation.errors);
    if (Object.keys(validation.errors).length > 0) return;

    setSubmitting(true);
    setRequestError('');
    try {
      const response = await fetch('/api/public/sales-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(validation.value)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success === false) {
        throw new Error(result?.error || 'Não foi possível enviar seu interesse agora.');
      }
      setSubmitted(true);
      onSubmitted?.(result?.data || null);
    } catch (error: any) {
      setRequestError(error?.message || 'Não foi possível enviar seu interesse agora. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="py-8 text-center" role="status" aria-live="polite">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 size={24} />
        </span>
        <h3 className="mt-4 text-lg font-semibold text-slate-900">Interesse recebido</h3>
        <p className="mx-auto mt-2 max-w-md text-sm font-normal leading-6 text-slate-600">
          Recebemos seu interesse na Verto. Entraremos em contato para conhecer sua operação e apresentar a plataforma.
        </p>
      </div>
    );
  }

  const errorFor = (key: string) => errors[key] ? <p className="mt-1 text-xs text-rose-600">{errors[key]}</p> : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3">
        <p className="text-sm font-medium text-slate-800">{formatPublicActivePatientPrice()} por paciente ativo/mês</p>
        <p className="mt-1 text-xs font-normal leading-5 text-slate-600">Condições especiais podem ser disponibilizadas após uma apresentação da Verto.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>Nome completo
          <input className={fieldClass} value={form.name} onChange={(e) => update('name', e.target.value)} maxLength={180} autoComplete="name" />
          {errorFor('name')}
        </label>
        <label className={labelClass}>WhatsApp com DDD
          <input className={fieldClass} value={form.phone} onChange={(e) => update('phone', e.target.value)} onBlur={() => update('phone', normalizeSalesLeadPhone(form.phone))} maxLength={20} inputMode="tel" autoComplete="tel" />
          {errorFor('phone')}
        </label>
        <label className={labelClass}>E-mail
          <input className={fieldClass} value={form.email} onChange={(e) => update('email', e.target.value)} maxLength={254} type="email" autoComplete="email" />
          {errorFor('email')}
        </label>
        <label className={labelClass}>Registro profissional <span className="text-slate-400">(opcional)</span>
          <input className={fieldClass} value={form.professionalRegistry} onChange={(e) => update('professionalRegistry', e.target.value)} maxLength={80} />
        </label>
        <label className={labelClass}>Clínica ou consultório
          <input className={fieldClass} value={form.clinicName} onChange={(e) => update('clinicName', e.target.value)} maxLength={180} autoComplete="organization" />
          {errorFor('clinicName')}
        </label>
        <label className={labelClass}>Tipo de operação
          <select className={fieldClass} value={form.operationType} onChange={(e) => update('operationType', e.target.value)}>
            <option value="independent_professional">Profissional autônomo</option>
            <option value="clinic">Clínica</option>
            <option value="multidisciplinary_team">Equipe multidisciplinar</option>
          </select>
          {errorFor('operationType')}
        </label>
        <label className={labelClass}>Cidade
          <input className={fieldClass} value={form.city} onChange={(e) => update('city', e.target.value)} maxLength={120} autoComplete="address-level2" />
          {errorFor('city')}
        </label>
        <label className={labelClass}>Estado
          <select className={fieldClass} value={form.state} onChange={(e) => update('state', e.target.value)} autoComplete="address-level1">
            <option value="">Selecione</option>
            {BRAZILIAN_STATE_CODES.map((state) => <option key={state} value={state}>{state}</option>)}
          </select>
          {errorFor('state')}
        </label>
        <label className={labelClass}>Pacientes ativos aproximados
          <input className={fieldClass} value={form.estimatedActivePatients} onChange={(e) => update('estimatedActivePatients', e.target.valueAsNumber)} type="number" min={0} max={100000} />
          {errorFor('estimatedActivePatients')}
        </label>
        <label className={labelClass}>Profissionais aproximados <span className="text-slate-400">(opcional)</span>
          <input className={fieldClass} value={form.estimatedProfessionals ?? ''} onChange={(e) => update('estimatedProfessionals', e.target.value === '' ? null : e.target.valueAsNumber)} type="number" min={0} max={10000} />
          {errorFor('estimatedProfessionals')}
        </label>
        <label className={labelClass}>Como conheceu a Verto?
          <input className={fieldClass} value={form.acquisitionChannel} onChange={(e) => update('acquisitionChannel', e.target.value)} maxLength={120} />
        </label>
        <label className={labelClass}>Melhor período para contato <span className="text-slate-400">(opcional)</span>
          <select className={fieldClass} value={form.preferredContactPeriod} onChange={(e) => update('preferredContactPeriod', e.target.value)}>
            <option value="">Sem preferência</option>
            <option value="morning">Manhã</option>
            <option value="afternoon">Tarde</option>
            <option value="evening">Noite</option>
          </select>
        </label>
      </div>

      <label className={labelClass}>Observação <span className="text-slate-400">(opcional)</span>
        <textarea className={`${fieldClass} min-h-24 resize-y`} value={form.notes} onChange={(e) => update('notes', e.target.value)} maxLength={1500} />
      </label>

      <label className="hidden" aria-hidden="true">Site
        <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => update('website', e.target.value)} />
      </label>

      <label className="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-normal leading-5 text-slate-600">
        <input type="checkbox" checked={form.contactConsent} onChange={(e) => update('contactConsent', e.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-600" />
        <span>Autorizo a Verto a entrar em contato para apresentar a plataforma e condições comerciais.</span>
      </label>
      {errorFor('contactConsent')}

      {requestError ? <p className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">{requestError}</p> : null}

      <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60">
        {submitting ? <Loader2 size={17} className="animate-spin" /> : null}
        {submitting ? 'Enviando interesse...' : 'Quero conhecer a Verto'}
      </button>
    </form>
  );
};
