import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Copy, Mail, Pencil, Phone, Plus, ShieldCheck, Stethoscope, Trash2, UserRound, UsersRound, X } from 'lucide-react';
import { dataService } from '../services/dataService';

type CareNetworkMode = 'patient' | 'professional';

type CareNetworkContact = {
  id: string;
  clinic_name?: string | null;
  professional_name: string;
  specialty?: string | null;
  professional_registry?: string | null;
  phone: string;
  email?: string | null;
  source?: 'PATIENT_PORTAL' | 'CLINIC' | string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CareNetworkForm = {
  clinicName: string;
  professionalName: string;
  specialty: string;
  professionalRegistry: string;
  phone: string;
  email: string;
};

type PatientCareNetworkPanelProps = {
  mode: CareNetworkMode;
  patientId?: string;
  dark?: boolean;
  readOnly?: boolean;
};

const emptyForm = (): CareNetworkForm => ({ clinicName: '', professionalName: '', specialty: '', professionalRegistry: '', phone: '', email: '' });
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
    if (!isPatientMode && !clean(patientId)) { setContacts([]); setLoaded(true); return; }
    setLoading(true); setError('');
    const result = isPatientMode ? await dataService.getPatientSelfCareNetwork() : await dataService.getPatientCareNetwork(clean(patientId));
    if (result?.success) setContacts(Array.isArray(result.data) ? result.data : []);
    else setError(result?.error || 'Não foi possível carregar a rede de cuidado agora.');
    setLoaded(true); setLoading(false);
  };

  useEffect(() => {
    setContacts([]); setLoaded(false); setLoading(false); setEditingId(''); setFormOpen(false); setForm(emptyForm()); setError(''); setMessage('');
    void loadContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const openCreate = () => { setEditingId(''); setForm(emptyForm()); setError(''); setMessage(''); setFormOpen(true); };
  const canEditContact = (contact: CareNetworkContact) => !readOnly && (!isPatientMode || contact.source !== 'CLINIC');
  const openEdit = (contact: CareNetworkContact) => {
    if (!canEditContact(contact)) return;
    setEditingId(clean(contact.id));
    setForm({
      clinicName: clean(contact.clinic_name), professionalName: clean(contact.professional_name), specialty: clean(contact.specialty),
      professionalRegistry: clean(contact.professional_registry), phone: clean(contact.phone), email: clean(contact.email),
    });
    setError(''); setMessage(''); setFormOpen(true);
  };
  const closeForm = () => { if (saving) return; setEditingId(''); setFormOpen(false); setForm(emptyForm()); setError(''); };

  const saveContact = async (event: React.FormEvent) => {
    event.preventDefault();
    if (readOnly || saving) return;
    const professionalName = clean(form.professionalName); const phone = clean(form.phone);
    if (!professionalName || !phone) { setError('Informe o nome do profissional e o telefone.'); return; }
    const payload = {
      clinicName: clean(form.clinicName), professionalName, specialty: clean(form.specialty), professionalRegistry: clean(form.professionalRegistry),
      phone, email: clean(form.email),
    };
    setSaving(true); setError(''); setMessage('');
    let result = isPatientMode
      ? (editingId ? await dataService.updatePatientSelfCareNetworkContact(editingId, payload) : await dataService.createPatientSelfCareNetworkContact(payload))
      : (editingId ? await dataService.updatePatientCareNetworkContact(clean(patientId), editingId, payload) : await dataService.createPatientCareNetworkContact(clean(patientId), payload));

    if (!isPatientMode && result?.code === 'CARE_NETWORK_PATIENT_REVOCATION_CONFIRMATION_REQUIRED') {
      const confirmed = typeof window !== 'undefined' && window.confirm('O paciente ou responsável já desfez anteriormente este vínculo. Criar um novo vínculo explícito com esta identidade? Os acessos antigos continuarão revogados.');
      if (confirmed) {
        result = editingId
          ? await dataService.updatePatientCareNetworkContact(clean(patientId), editingId, { ...payload, restoreAfterPatientRevocation: true })
          : await dataService.createPatientCareNetworkContact(clean(patientId), { ...payload, restoreAfterPatientRevocation: true });
      }
    }
    setSaving(false);
    if (!result?.success) { setError(result?.error || 'Não foi possível salvar este profissional.'); return; }
    setMessage(editingId ? 'Profissional atualizado.' : 'Profissional adicionado à Rede de cuidado.');
    setEditingId(''); setFormOpen(false); setForm(emptyForm()); setLoaded(false); await loadContacts();
  };

  const removeContact = async (contact: CareNetworkContact) => {
    if (readOnly || saving) return;
    const id = clean(contact.id); if (!id) return;
    const prompt = isPatientMode
      ? `Desfazer o vínculo com ${contactLabel(contact)}? Os compartilhamentos ativos deste profissional para este paciente serão revogados.`
      : `Remover ${contactLabel(contact)} da Rede de cuidado? Os compartilhamentos ativos deste profissional para este paciente serão revogados.`;
    if (typeof window !== 'undefined' && !window.confirm(prompt)) return;
    setSaving(true); setError(''); setMessage('');
    const result = isPatientMode ? await dataService.archivePatientSelfCareNetworkContact(id) : await dataService.archivePatientCareNetworkContact(clean(patientId), id);
    setSaving(false);
    if (!result?.success) { setError(result?.error || 'Não foi possível desfazer este vínculo.'); return; }
    setContacts((current) => current.filter((item) => clean(item.id) !== id));
    setMessage('Vínculo encerrado. O histórico foi preservado e os compartilhamentos ativos deste contexto foram revogados.');
  };

  const copyEmail = async (contact: CareNetworkContact) => {
    const email = clean(contact.email); const id = clean(contact.id); if (!email) return;
    try { await navigator.clipboard.writeText(email); setCopiedId(id); window.setTimeout(() => setCopiedId((current) => current === id ? '' : current), 1600); }
    catch { setError('Não foi possível copiar o e-mail automaticamente.'); }
  };

  const panelClass = dark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-200 bg-white';
  const textClass = dark ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = dark ? 'text-slate-400' : 'text-slate-500';
  const cardClass = dark ? 'border-slate-700 bg-[#0d192b]' : 'border-slate-100 bg-slate-50/70';
  const inputClass = dark ? 'border-slate-700 bg-[#0d192b] text-slate-100 placeholder:text-slate-500 focus:border-violet-400' : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-[#7a32fc]';

  return (
    <section className={`rounded-[28px] border p-4 shadow-sm sm:p-5 ${panelClass}`} data-testid={`patient-care-network-${mode}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${dark ? 'bg-violet-500/15 text-violet-300' : 'bg-purple-50 text-[#7a32fc]'}`}><UsersRound size={19} /></span>
          <div className="min-w-0">
            <p className={`text-[10px] font-medium uppercase tracking-[0.2em] ${dark ? 'text-violet-300' : 'text-[#7a32fc]'}`}>Rede de cuidado</p>
            <h2 className={`mt-1 text-lg font-semibold ${textClass}`}>Profissionais externos envolvidos no cuidado deste paciente</h2>
            <p className={`mt-1 max-w-3xl text-xs leading-relaxed ${mutedClass}`}>O cadastro identifica quem participa do cuidado, mas não concede acesso clínico sozinho. Cada evolução precisa ser compartilhada explicitamente.</p>
          </div>
        </div>
        {!readOnly && <button type="button" onClick={openCreate} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#7a32fc] px-4 py-2 text-xs font-medium text-white shadow-sm transition hover:brightness-105"><Plus size={15} /> Adicionar profissional</button>}
      </div>

      {error && <p className={`mt-4 rounded-2xl px-4 py-3 text-xs font-medium ${dark ? 'bg-rose-950/40 text-rose-200' : 'bg-rose-50 text-rose-700'}`}>{error}</p>}
      {message && <p className={`mt-4 rounded-2xl px-4 py-3 text-xs font-medium ${dark ? 'bg-emerald-950/30 text-emerald-200' : 'bg-emerald-50 text-emerald-700'}`}>{message}</p>}

      {formOpen && !readOnly && (
        <form onSubmit={saveContact} className={`mt-5 rounded-3xl border p-4 sm:p-5 ${cardClass}`}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><h3 className={`text-sm font-semibold ${textClass}`}>{editingId ? 'Editar profissional' : 'Novo profissional'}</h3><p className={`mt-1 text-xs ${mutedClass}`}>Nome e telefone são obrigatórios. E-mail é necessário para receber compartilhamentos.</p></div>
            <button type="button" onClick={closeForm} className={`rounded-xl p-2 ${dark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-white'}`} aria-label="Fechar formulário"><X size={17} /></button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2"><span className={`mb-1.5 block text-xs ${mutedClass}`}>Nome do profissional *</span><input value={form.professionalName} onChange={(e) => setForm((v) => ({ ...v, professionalName: e.target.value }))} maxLength={180} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ${inputClass}`} /></label>
            <label className="block"><span className={`mb-1.5 block text-xs ${mutedClass}`}>Especialidade</span><input value={form.specialty} onChange={(e) => setForm((v) => ({ ...v, specialty: e.target.value }))} maxLength={120} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ${inputClass}`} /></label>
            <label className="block"><span className={`mb-1.5 block text-xs ${mutedClass}`}>Conselho / registro</span><input value={form.professionalRegistry} onChange={(e) => setForm((v) => ({ ...v, professionalRegistry: e.target.value }))} maxLength={120} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ${inputClass}`} /></label>
            <label className="block"><span className={`mb-1.5 block text-xs ${mutedClass}`}>Clínica / instituição</span><input value={form.clinicName} onChange={(e) => setForm((v) => ({ ...v, clinicName: e.target.value }))} maxLength={180} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ${inputClass}`} /></label>
            <label className="block"><span className={`mb-1.5 block text-xs ${mutedClass}`}>Telefone *</span><input value={form.phone} onChange={(e) => setForm((v) => ({ ...v, phone: e.target.value }))} maxLength={60} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ${inputClass}`} /></label>
            <label className="block sm:col-span-2"><span className={`mb-1.5 block text-xs ${mutedClass}`}>E-mail</span><input type="email" value={form.email} onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))} maxLength={254} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ${inputClass}`} /></label>
          </div>
          <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={closeForm} className={`rounded-xl border px-4 py-2 text-xs font-medium ${dark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}`}>Cancelar</button><button type="submit" disabled={saving} className="rounded-xl bg-[#7a32fc] px-4 py-2 text-xs font-medium text-white disabled:opacity-60">{saving ? 'Salvando...' : 'Salvar profissional'}</button></div>
        </form>
      )}

      <div className="mt-5 space-y-3">
        {!loaded || loading ? <p className={`py-8 text-center text-xs ${mutedClass}`}>Carregando Rede de cuidado...</p> : contacts.length === 0 ? (
          <div className={`rounded-3xl border border-dashed p-7 text-center ${dark ? 'border-slate-700' : 'border-slate-200'}`}><UserRound size={26} className="mx-auto text-slate-400" /><p className={`mt-3 text-sm ${mutedClass}`}>Nenhum profissional externo cadastrado.</p></div>
        ) : contacts.map((contact) => (
          <article key={contact.id} className={`rounded-2xl border p-4 ${cardClass}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><h3 className={`text-sm font-semibold ${textClass}`}>{contactLabel(contact)}</h3><span className={`rounded-full px-2 py-1 text-[10px] font-medium ${contact.source === 'CLINIC' ? (dark ? 'bg-blue-500/15 text-blue-200' : 'bg-blue-50 text-blue-700') : (dark ? 'bg-emerald-500/15 text-emerald-200' : 'bg-emerald-50 text-emerald-700')}`}>{contact.source === 'CLINIC' ? 'Cadastrado pela clínica' : 'Informado pelo paciente'}</span></div>
                <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs ${mutedClass}`}>
                  {contact.specialty && <span className="inline-flex items-center gap-1.5"><Stethoscope size={13} />{contact.specialty}</span>}
                  {contact.professional_registry && <span className="inline-flex items-center gap-1.5"><ShieldCheck size={13} />{contact.professional_registry}</span>}
                  {contact.clinic_name && <span className="inline-flex items-center gap-1.5"><Building2 size={13} />{contact.clinic_name}</span>}
                  <span className="inline-flex items-center gap-1.5"><Phone size={13} />{contact.phone}</span>
                  {contact.email && <span className="inline-flex items-center gap-1.5"><Mail size={13} />{contact.email}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {contact.email && <button type="button" onClick={() => void copyEmail(contact)} className={`rounded-lg p-2 ${dark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-white'}`} title="Copiar e-mail"><Copy size={15} />{copiedId === contact.id && <span className="sr-only">Copiado</span>}</button>}
                {canEditContact(contact) && <button type="button" onClick={() => openEdit(contact)} className={`rounded-lg p-2 ${dark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-white'}`} title="Editar"><Pencil size={15} /></button>}
                {!readOnly && <button type="button" onClick={() => void removeContact(contact)} className="rounded-lg p-2 text-rose-500 hover:bg-rose-50" title={isPatientMode ? 'Desfazer vínculo' : 'Remover da Rede de cuidado'}><Trash2 size={15} /></button>}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};
