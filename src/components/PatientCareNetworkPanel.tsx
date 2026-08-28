import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Copy, Mail, Pencil, Phone, Plus, Stethoscope, Trash2, UserRound, UsersRound, X } from 'lucide-react';
import { dataService } from '../services/dataService';

type CareNetworkMode = 'patient' | 'professional';

type CareNetworkContact = {
  id: string;
  clinic_name?: string | null;
  professional_name: string;
  specialty?: string | null;
  phone: string;
  email?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CareNetworkForm = {
  clinicName: string;
  professionalName: string;
  specialty: string;
  phone: string;
  email: string;
};

type PatientCareNetworkPanelProps = {
  mode: CareNetworkMode;
  patientId?: string;
  dark?: boolean;
  readOnly?: boolean;
};

const emptyForm = (): CareNetworkForm => ({
  clinicName: '',
  professionalName: '',
  specialty: '',
  phone: '',
  email: '',
});

const clean = (value: unknown) => String(value ?? '').trim();

const contactLabel = (contact: CareNetworkContact) => clean(contact.professional_name) || 'Profissional';

export const PatientCareNetworkPanel = ({ mode, patientId = '', dark = false, readOnly = false }: PatientCareNetworkPanelProps) => {
  const isPatientMode = mode === 'patient';
  const [contacts, setContacts] = useState<CareNetworkContact[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CareNetworkForm>(emptyForm);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [copiedId, setCopiedId] = useState('');

  const scopeKey = useMemo(() => `${mode}:${clean(patientId) || 'self'}`, [mode, patientId]);

  const loadContacts = async () => {
    if (loading) return;
    if (!isPatientMode && !clean(patientId)) {
      setContacts([]);
      setLoaded(true);
      return;
    }
    setLoading(true);
    setError('');
    const result = isPatientMode
      ? await dataService.getPatientSelfCareNetwork()
      : await dataService.getPatientCareNetwork(clean(patientId));
    if (result?.success) {
      setContacts(Array.isArray(result.data) ? result.data : []);
    } else {
      setError(result?.error || 'Não foi possível carregar a rede de cuidado agora.');
    }
    setLoaded(true);
    setLoading(false);
  };

  useEffect(() => {
    setContacts([]);
    setLoaded(false);
    setLoading(false);
    setEditingId('');
    setFormOpen(false);
    setForm(emptyForm());
    setError('');
    setMessage('');
    void loadContacts();
    // scopeKey intentionally resets the panel when the active patient/context changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const openCreate = () => {
    setEditingId('');
    setForm(emptyForm());
    setError('');
    setMessage('');
    setFormOpen(true);
  };

  const openEdit = (contact: CareNetworkContact) => {
    setEditingId(clean(contact.id));
    setForm({
      clinicName: clean(contact.clinic_name),
      professionalName: clean(contact.professional_name),
      specialty: clean(contact.specialty),
      phone: clean(contact.phone),
      email: clean(contact.email),
    });
    setError('');
    setMessage('');
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    setEditingId('');
    setFormOpen(false);
    setForm(emptyForm());
    setError('');
  };

  const saveContact = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isPatientMode || readOnly || saving) return;
    const professionalName = clean(form.professionalName);
    const phone = clean(form.phone);
    if (!professionalName || !phone) {
      setError('Informe o nome do profissional e o telefone.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    const payload = {
      clinicName: clean(form.clinicName),
      professionalName,
      specialty: clean(form.specialty),
      phone,
      email: clean(form.email),
    };
    const result = editingId
      ? await dataService.updatePatientSelfCareNetworkContact(editingId, payload)
      : await dataService.createPatientSelfCareNetworkContact(payload);
    setSaving(false);
    if (!result?.success) {
      setError(result?.error || 'Não foi possível salvar este profissional.');
      return;
    }
    setMessage(editingId ? 'Profissional atualizado.' : 'Profissional adicionado à sua rede de cuidado.');
    setEditingId('');
    setFormOpen(false);
    setForm(emptyForm());
    setLoaded(false);
    await loadContacts();
  };

  const removeContact = async (contact: CareNetworkContact) => {
    if (!isPatientMode || readOnly || saving) return;
    const id = clean(contact.id);
    if (!id) return;
    if (typeof window !== 'undefined' && !window.confirm(`Remover ${contactLabel(contact)} da sua rede de cuidado?`)) return;
    setSaving(true);
    setError('');
    setMessage('');
    const result = await dataService.archivePatientSelfCareNetworkContact(id);
    setSaving(false);
    if (!result?.success) {
      setError(result?.error || 'Não foi possível remover este profissional.');
      return;
    }
    setContacts((current) => current.filter((item) => clean(item.id) !== id));
    setMessage('Profissional removido da sua rede de cuidado.');
  };

  const copyEmail = async (contact: CareNetworkContact) => {
    const email = clean(contact.email);
    const id = clean(contact.id);
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => current === id ? '' : current), 1600);
    } catch {
      setError('Não foi possível copiar o e-mail automaticamente.');
    }
  };

  const panelClass = dark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-200 bg-white';
  const textClass = dark ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = dark ? 'text-slate-400' : 'text-slate-500';
  const cardClass = dark ? 'border-slate-700 bg-[#0d192b]' : 'border-slate-100 bg-slate-50/70';
  const inputClass = dark
    ? 'border-slate-700 bg-[#0d192b] text-slate-100 placeholder:text-slate-500 focus:border-violet-400'
    : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-[#7a32fc]';

  return (
    <section className={`rounded-[28px] border p-4 shadow-sm sm:p-5 ${panelClass}`} data-testid={`patient-care-network-${mode}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${dark ? 'bg-violet-500/15 text-violet-300' : 'bg-purple-50 text-[#7a32fc]'}`}>
            <UsersRound size={19} />
          </span>
          <div className="min-w-0">
            <p className={`text-[10px] font-bold uppercase tracking-[0.2em] ${dark ? 'text-violet-300' : 'text-[#7a32fc]'}`}>Rede de cuidado</p>
            <h2 className={`mt-1 text-lg font-semibold ${textClass}`}>{isPatientMode ? 'Profissionais que participam do seu cuidado' : 'Profissionais externos informados pelo paciente'}</h2>
            <p className={`mt-1 max-w-3xl text-xs font-medium leading-relaxed ${mutedClass}`}>
              {isPatientMode
                ? 'Cadastre aqui quem participa do seu cuidado. Este cadastro é apenas informativo e não concede acesso a dados clínicos ou documentos.'
                : 'Esta lista é informada pelo paciente ou responsável. Ela não representa, por si só, autorização para compartilhamento de dados clínicos.'}
            </p>
          </div>
        </div>
        {isPatientMode && !readOnly && (
          <button type="button" onClick={openCreate} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#7a32fc] px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:brightness-105">
            <Plus size={15} /> Adicionar profissional
          </button>
        )}
      </div>

      {error && <p className={`mt-4 rounded-2xl px-4 py-3 text-xs font-semibold ${dark ? 'bg-rose-950/40 text-rose-200' : 'bg-rose-50 text-rose-700'}`}>{error}</p>}
      {message && <p className={`mt-4 rounded-2xl px-4 py-3 text-xs font-semibold ${dark ? 'bg-emerald-950/30 text-emerald-200' : 'bg-emerald-50 text-emerald-700'}`}>{message}</p>}

      {isPatientMode && formOpen && !readOnly && (
        <form onSubmit={saveContact} className={`mt-5 rounded-3xl border p-4 sm:p-5 ${cardClass}`}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className={`text-sm font-semibold ${textClass}`}>{editingId ? 'Editar profissional' : 'Novo profissional'}</h3>
              <p className={`mt-1 text-xs ${mutedClass}`}>Somente nome do profissional e telefone são obrigatórios.</p>
            </div>
            <button type="button" onClick={closeForm} className={`rounded-xl p-2 ${dark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-white'}`} aria-label="Fechar formulário">
              <X size={17} />
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className={`mb-1.5 block text-xs font-semibold ${mutedClass}`}>1. Nome da clínica <span className="font-normal">(opcional)</span></span>
              <input value={form.clinicName} onChange={(event) => setForm((current) => ({ ...current, clinicName: event.target.value }))} maxLength={180} className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition ${inputClass}`} placeholder="Ex.: Clínica Horizonte" />
            </label>
            <label className="block sm:col-span-2">
              <span className={`mb-1.5 block text-xs font-semibold ${mutedClass}`}>2. Nome do profissional <span className="text-rose-500">*</span></span>
              <input required value={form.professionalName} onChange={(event) => setForm((current) => ({ ...current, professionalName: event.target.value }))} maxLength={180} className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition ${inputClass}`} placeholder="Nome completo" />
            </label>
            <label className="block sm:col-span-2">
              <span className={`mb-1.5 block text-xs font-semibold ${mutedClass}`}>3. Especialidade <span className="font-normal">(opcional)</span></span>
              <input value={form.specialty} onChange={(event) => setForm((current) => ({ ...current, specialty: event.target.value }))} maxLength={120} className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition ${inputClass}`} placeholder="Ex.: Fonoaudiologia, Nutrição, Psiquiatria" />
            </label>
            <label className="block">
              <span className={`mb-1.5 block text-xs font-semibold ${mutedClass}`}>4. Telefone <span className="text-rose-500">*</span></span>
              <input required type="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} maxLength={60} className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition ${inputClass}`} placeholder="Telefone ou WhatsApp" />
            </label>
            <label className="block">
              <span className={`mb-1.5 block text-xs font-semibold ${mutedClass}`}>5. E-mail <span className="font-normal">(opcional)</span></span>
              <input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} maxLength={254} className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition ${inputClass}`} placeholder="profissional@exemplo.com" />
            </label>
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={closeForm} disabled={saving} className={`rounded-xl border px-4 py-2.5 text-xs font-semibold disabled:opacity-50 ${dark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}`}>Cancelar</button>
            <button type="submit" disabled={saving} className="rounded-xl bg-[#7a32fc] px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Adicionar à rede'}</button>
          </div>
        </form>
      )}

      <div className="mt-5 space-y-3">
        {!loaded || loading ? (
          <div className={`h-24 animate-pulse rounded-2xl ${dark ? 'bg-slate-800' : 'bg-slate-100'}`} />
        ) : contacts.length === 0 ? (
          <div className={`rounded-2xl border border-dashed px-4 py-6 text-center text-sm font-medium ${dark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
            {isPatientMode ? 'Nenhum profissional cadastrado na sua rede de cuidado.' : 'O paciente ainda não informou profissionais externos da rede de cuidado.'}
          </div>
        ) : contacts.map((contact) => (
          <article key={contact.id} className={`rounded-2xl border p-4 ${cardClass}`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${dark ? 'bg-slate-800 text-violet-300' : 'bg-white text-[#7a32fc]'}`}><UserRound size={17} /></span>
                  <div className="min-w-0">
                    <h3 className={`truncate text-sm font-semibold ${textClass}`}>{contactLabel(contact)}</h3>
                    <p className={`mt-1 text-xs font-medium ${mutedClass}`}>{clean(contact.specialty) || 'Especialidade não informada'}</p>
                  </div>
                </div>
                <div className={`mt-4 grid gap-2 text-xs ${mutedClass} sm:grid-cols-2`}>
                  <p className="flex min-w-0 items-center gap-2"><Building2 size={14} className="shrink-0" /><span className="truncate">{clean(contact.clinic_name) || 'Clínica não informada'}</span></p>
                  <p className="flex min-w-0 items-center gap-2"><Stethoscope size={14} className="shrink-0" /><span className="truncate">{clean(contact.specialty) || 'Especialidade não informada'}</span></p>
                  <p className="flex min-w-0 items-center gap-2"><Phone size={14} className="shrink-0" /><span className="break-all">{clean(contact.phone)}</span></p>
                  <p className="flex min-w-0 items-center gap-2"><Mail size={14} className="shrink-0" /><span className="break-all">{clean(contact.email) || 'E-mail não informado'}</span></p>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {!isPatientMode && clean(contact.email) && (
                  <button type="button" onClick={() => void copyEmail(contact)} className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${dark ? 'border-slate-700 text-violet-300 hover:bg-slate-800' : 'border-purple-100 bg-white text-[#7a32fc] hover:bg-purple-50'}`}>
                    <Copy size={14} /> {copiedId === clean(contact.id) ? 'Copiado' : 'Copiar e-mail'}
                  </button>
                )}
                {isPatientMode && !readOnly && (
                  <>
                    <button type="button" onClick={() => openEdit(contact)} className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold ${dark ? 'border-slate-700 text-slate-300' : 'border-slate-200 bg-white text-slate-600'}`}><Pencil size={14} /> Editar</button>
                    <button type="button" onClick={() => void removeContact(contact)} className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold ${dark ? 'border-rose-900/60 text-rose-300' : 'border-rose-100 bg-white text-rose-600'}`}><Trash2 size={14} /> Remover</button>
                  </>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};
