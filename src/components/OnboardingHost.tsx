import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase } from '../lib/supabase';
import { onboardingService, type TenantOnboardingPublication } from '../services/onboardingService';

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
};

const ModalShell = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => (
  <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
    <div className="max-h-[92vh] w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-3xl">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <button type="button" onClick={onClose} className="rounded-xl px-3 py-2 text-sm text-slate-500 hover:bg-slate-100" aria-label="Fechar">Fechar</button>
      </div>
      <div className="max-h-[calc(92vh-68px)] overflow-y-auto p-5 sm:p-6">{children}</div>
    </div>
  </div>
);

const TenantOnboarding = ({ publication, onClose, onRefresh }: { publication: TenantOnboardingPublication; onClose: () => void; onRefresh: () => Promise<void> }) => {
  const existing = publication.onboarding_responses?.find((item) => item.status === 'responded');
  const [participants, setParticipants] = useState<string[]>(existing?.participants || []);
  const [participantDraft, setParticipantDraft] = useState('');
  const [slotId, setSlotId] = useState(existing?.slot_id || '');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const submitIntentRef = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
  const availableSlots = useMemo(() => publication.onboarding_slots?.filter((slot) => slot.status === 'available' || slot.id === existing?.slot_id) || [], [publication, existing?.slot_id]);

  useEffect(() => {
    if (publication.status === 'published') onboardingService.markViewed(publication.id).catch(() => undefined);
  }, [publication.id, publication.status]);

  const addParticipant = () => {
    const name = participantDraft.trim();
    if (!name) return;
    if (name.length > 120) return setFeedback('Cada nome pode ter no máximo 120 caracteres.');
    if (participants.length >= 20) return setFeedback('O limite é de 20 participantes.');
    setParticipants((current) => [...current, name]);
    setParticipantDraft('');
    setFeedback('');
  };

  const submit = async () => {
    if (!participants.length) return setFeedback('Adicione pelo menos um participante.');
    if (!slotId) return setFeedback('Escolha um horário disponível.');
    const fingerprint = JSON.stringify([publication.id, slotId, participants]);
    if (!submitIntentRef.current || submitIntentRef.current.fingerprint !== fingerprint) {
      submitIntentRef.current = { fingerprint, idempotencyKey: crypto.randomUUID() };
    }
    const idempotencyKey = submitIntentRef.current.idempotencyKey;
    setSubmitting(true);
    setFeedback('');
    try {
      await onboardingService.submitResponse({
        publicationId: publication.id,
        slotId,
        participants,
        idempotencyKey,
      });
      submitIntentRef.current = null;
      setFeedback('Treinamento confirmado. A Equipe Verto recebeu sua resposta.');
      await onRefresh();
    } catch (error: any) {
      if (String(error?.message) === 'SLOT_TAKEN') {
        submitIntentRef.current = null;
        setSlotId('');
        setFeedback('Esse horário acabou de ser escolhido por outra pessoa. Seus participantes foram mantidos; selecione outro horário.');
        await onRefresh();
      } else if (String(error?.message) === 'ONBOARDING_ALREADY_RESPONDED') {
        submitIntentRef.current = null;
        setFeedback('Este treinamento já foi respondido. Atualizando a confirmação…');
        await onRefresh();
      } else {
        setFeedback('Não foi possível confirmar agora. Seus participantes foram mantidos para tentar novamente.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title={publication.snapshot_title} onClose={onClose}>
      <div className="space-y-6 text-slate-700">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-600">Treinamento da sua clínica</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{publication.snapshot_message}</p>
        </div>
        <section>
          <h3 className="text-sm font-semibold text-slate-900">Pauta do treinamento</h3>
          <ul className="mt-2 space-y-2 text-sm">{publication.snapshot_topics.map((topic, index) => <li key={`${topic}-${index}`} className="rounded-xl bg-slate-50 px-3 py-2">{topic}</li>)}</ul>
        </section>
        <section>
          <h3 className="text-sm font-semibold text-slate-900">Quem deve participar</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm">{publication.snapshot_participant_guidance}</p>
        </section>
        {existing ? (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <h3 className="text-sm font-semibold text-emerald-900">Treinamento confirmado</h3>
            <p className="mt-2 text-sm text-emerald-800">Horário: {formatDateTime(publication.onboarding_slots?.find((slot) => slot.id === existing.slot_id)?.starts_at)}</p>
            <p className="mt-1 text-sm text-emerald-800">Participantes: {existing.participants.join(', ')}</p>
          </section>
        ) : (
          <>
            <section>
              <div className="flex items-end justify-between gap-3"><h3 className="text-sm font-semibold text-slate-900">Participantes</h3><span className="text-xs text-slate-400">{participants.length}/20</span></div>
              <div className="mt-2 flex gap-2">
                <input value={participantDraft} maxLength={120} onChange={(event) => setParticipantDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addParticipant(); } }} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500" placeholder="Nome do participante" />
                <button type="button" onClick={addParticipant} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white">Adicionar</button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">{participants.map((name, index) => <button type="button" key={`${name}-${index}`} onClick={() => setParticipants((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800" aria-label={`Remover ${name}`}>{name} ×</button>)}</div>
            </section>
            <section>
              <h3 className="text-sm font-semibold text-slate-900">Escolha um horário</h3>
              <div className="mt-2 grid gap-2">{availableSlots.map((slot) => <label key={slot.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm"><input type="radio" name="onboarding-slot" checked={slotId === slot.id} onChange={() => setSlotId(slot.id)} /> <span>{formatDateTime(slot.starts_at)}</span></label>)}</div>
            </section>
            {slotId && <p className="rounded-xl bg-slate-50 p-3 text-sm">Você escolheu <strong>{formatDateTime(availableSlots.find((slot) => slot.id === slotId)?.starts_at)}</strong>.</p>}
            <button type="button" disabled={submitting} onClick={submit} className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-50">{submitting ? 'Confirmando…' : 'Confirmar treinamento'}</button>
          </>
        )}
        {feedback && <p className="text-sm text-slate-700" aria-live="polite">{feedback}</p>}
      </div>
    </ModalShell>
  );
};

const OwnerOnboarding = ({ onClose }: { onClose: () => void }) => {
  const [tab, setTab] = useState<'compose' | 'inbox'>('compose');
  const [clinicSearch, setClinicSearch] = useState('');
  const [clinics, setClinics] = useState<any[]>([]);
  const [clinicId, setClinicId] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [topics, setTopics] = useState('');
  const [guidance, setGuidance] = useState('');
  const [slots, setSlots] = useState<string[]>(['']);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [inbox, setInbox] = useState<any[]>([]);
  const [selectedResponse, setSelectedResponse] = useState<any | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => onboardingService.searchClinics(clinicSearch).then(setClinics).catch(() => setClinics([])), 250);
    return () => window.clearTimeout(timer);
  }, [clinicSearch]);

  const loadInbox = async () => {
    const result = await onboardingService.listAdminInbox(0, 20);
    setInbox(result.items);
  };

  useEffect(() => { if (tab === 'inbox') loadInbox().catch(() => setFeedback('Não foi possível carregar as respostas.')); }, [tab]);

  const normalizedTopics = topics.split('\n').map((item) => item.trim()).filter(Boolean);
  const save = async () => {
    if (!title.trim() || !message.trim() || !guidance.trim() || !normalizedTopics.length) return setFeedback('Preencha título, mensagem, pauta e orientação de participantes.');
    if (title.trim().length > 160 || message.trim().length > 4000 || guidance.trim().length > 1200 || normalizedTopics.length > 20 || normalizedTopics.some((item) => item.length > 240)) return setFeedback('Revise os limites de conteúdo antes de salvar.');
    setBusy(true); setFeedback('');
    try {
      const saved = await onboardingService.saveDraft({ id: draftId, title, message, topics: normalizedTopics, participantGuidance: guidance });
      setDraftId(saved.id); setFeedback('Rascunho salvo.'); return saved.id as string;
    } catch { setFeedback('Não foi possível salvar o rascunho.'); return null; } finally { setBusy(false); }
  };

  const publish = async () => {
    if (!clinicId) return setFeedback('Selecione uma clínica antes de publicar.');
    const validSlots = slots.filter(Boolean).map((value) => new Date(value).toISOString());
    if (!validSlots.length) return setFeedback('Adicione pelo menos um horário.');
    setBusy(true); setFeedback('');
    try {
      let id = draftId;
      if (!id) {
        const saved = await onboardingService.saveDraft({ title, message, topics: normalizedTopics, participantGuidance: guidance });
        id = saved.id;
        setDraftId(id);
      }
      const clinic = clinics.find((item) => item.id === clinicId);
      if (!window.confirm(`Publicar este onboarding para ${clinic?.name || 'a clínica selecionada'} com ${validSlots.length} horário(s)?`)) return;
      await onboardingService.publishDraft({ templateId: id!, clinicId, slots: validSlots });
      setFeedback('Onboarding publicado. A clínica já pode visualizar e responder.');
    } catch { setFeedback('Não foi possível publicar. Revise o rascunho, a clínica e os horários.'); } finally { setBusy(false); }
  };

  const openResponse = async (id: string) => {
    try {
      const detail = await onboardingService.getAdminResponse(id);
      setSelectedResponse(detail);
      if (!detail.admin_ack_at) await onboardingService.acknowledgeResponse(id);
      await loadInbox();
    } catch { setFeedback('Não foi possível abrir esta resposta.'); }
  };

  return (
    <ModalShell title="Onboarding de clínicas" onClose={onClose}>
      <div className="mb-5 flex gap-2"><button type="button" onClick={() => setTab('compose')} className={`rounded-xl px-4 py-2 text-sm ${tab === 'compose' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>Compor</button><button type="button" onClick={() => setTab('inbox')} className={`rounded-xl px-4 py-2 text-sm ${tab === 'inbox' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>Respostas</button></div>
      {tab === 'compose' ? <div className="space-y-4">
        <div><label className="text-sm font-medium text-slate-800">Clínica</label><input value={clinicSearch} onChange={(event) => setClinicSearch(event.target.value)} placeholder="Buscar clínica" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /><div className="mt-2 grid max-h-32 gap-1 overflow-y-auto">{clinics.map((clinic) => <button type="button" key={clinic.id} onClick={() => setClinicId(clinic.id)} className={`rounded-lg px-3 py-2 text-left text-sm ${clinicId === clinic.id ? 'bg-emerald-50 text-emerald-800' : 'hover:bg-slate-50'}`}>{clinic.name}</button>)}</div></div>
        <div><label className="text-sm font-medium text-slate-800">Título</label><input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></div>
        <div><label className="text-sm font-medium text-slate-800">Mensagem</label><textarea value={message} maxLength={4000} onChange={(event) => setMessage(event.target.value)} rows={4} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></div>
        <div><label className="text-sm font-medium text-slate-800">Pauta do treinamento <span className="font-normal text-slate-400">(um tópico por linha)</span></label><textarea value={topics} onChange={(event) => setTopics(event.target.value)} rows={4} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></div>
        <div><label className="text-sm font-medium text-slate-800">Quem deve participar</label><textarea value={guidance} maxLength={1200} onChange={(event) => setGuidance(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></div>
        <div><div className="flex items-center justify-between"><label className="text-sm font-medium text-slate-800">Horários</label><button type="button" onClick={() => setSlots((current) => [...current, ''])} className="text-sm text-emerald-700">Adicionar horário</button></div>{slots.map((slot, index) => <div key={index} className="mt-2 flex gap-2"><input type="datetime-local" value={slot} onChange={(event) => setSlots((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm" /><button type="button" onClick={() => setSlots((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-xl px-3 text-sm text-slate-500">Remover</button></div>)}</div>
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4"><p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Prévia — ainda não publicado</p><h3 className="mt-2 text-base font-semibold text-slate-900">{title || 'Título do onboarding'}</h3><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{message || 'Sua mensagem aparecerá aqui.'}</p></div>
        <div className="flex flex-col gap-2 sm:flex-row"><button type="button" disabled={busy} onClick={save} className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-800">Salvar rascunho</button><button type="button" disabled={busy} onClick={publish} className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white">Publicar</button></div>
      </div> : <div className="space-y-3">{inbox.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Nenhuma nova resposta de onboarding.</p> : inbox.map((item) => <button type="button" key={item.id} onClick={() => openResponse(item.id)} className="w-full rounded-xl border border-slate-200 p-4 text-left"><div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-slate-900">{item.clinics?.name || 'Clínica'}</span>{!item.admin_ack_at && <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-800">Nova</span>}</div><p className="mt-1 text-xs text-slate-500">{formatDateTime(item.responded_at)} · {formatDateTime(item.onboarding_slots?.starts_at)}</p></button>)}</div>}
      {selectedResponse && <div className="mt-5 rounded-2xl bg-slate-50 p-4"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-900">Resposta de {selectedResponse.clinics?.name || 'clínica'}</h3><button type="button" onClick={() => setSelectedResponse(null)} className="text-xs text-slate-500">Fechar detalhe</button></div><p className="mt-2 text-sm text-slate-700">Horário: {formatDateTime(selectedResponse.onboarding_slots?.starts_at)}</p><p className="mt-1 text-sm text-slate-700">Participantes: {(selectedResponse.participants || []).join(', ')}</p></div>}
      {feedback && <p className="mt-4 text-sm text-slate-700" aria-live="polite">{feedback}</p>}
    </ModalShell>
  );
};

export const OnboardingHost = () => {
  const [mode, setMode] = useState<'loading' | 'owner' | 'tenant' | 'none'>('loading');
  const [publications, setPublications] = useState<TenantOnboardingPublication[]>([]);
  const [openPublicationId, setOpenPublicationId] = useState<string | null>(null);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  const refreshTenant = async () => {
    const items = await onboardingService.listTenantPublications(10);
    setPublications(items);
    setOpenPublicationId((current) => current || items.find((item) => item.status !== 'responded')?.id || null);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const supabase = await getSupabase();
        const { data } = await supabase.auth.getSession();
        const userId = data?.session?.user?.id;
        if (!userId || !active) return setMode('none');
        const { data: user } = await supabase.from('users').select('role').eq('id', userId).maybeSingle();
        const role = String(user?.role || '').toLowerCase();
        if (role === 'owner' || role === 'admin') {
          if (!active) return;
          setMode('owner');
          setUnread(await onboardingService.countUnreadAdminResponses().catch(() => 0));
          return;
        }
        const items = await onboardingService.listTenantPublications(10).catch(() => []);
        if (!active) return;
        setPublications(items);
        setMode(items.length ? 'tenant' : 'none');
        setOpenPublicationId(items.find((item) => item.status !== 'responded')?.id || null);
      } catch { if (active) setMode('none'); }
    })();
    return () => { active = false; };
  }, []);

  const selected = publications.find((item) => item.id === openPublicationId) || null;
  if (mode === 'loading' || mode === 'none') return null;
  return <>
    {mode === 'owner' && <button type="button" onClick={() => setOwnerOpen(true)} className="fixed bottom-5 right-5 z-[90] rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white shadow-lg">Onboarding{unread > 0 ? ` · ${unread}` : ''}</button>}
    {mode === 'tenant' && publications.length > 0 && <button type="button" onClick={() => setOpenPublicationId(publications[0].id)} className="fixed bottom-5 right-5 z-[90] rounded-full bg-emerald-600 px-5 py-3 text-sm font-medium text-white shadow-lg">Treinamento Verto</button>}
    {ownerOpen && <OwnerOnboarding onClose={() => { setOwnerOpen(false); onboardingService.countUnreadAdminResponses().then(setUnread).catch(() => undefined); }} />}
    {selected && <TenantOnboarding publication={selected} onClose={() => setOpenPublicationId(null)} onRefresh={refreshTenant} />}
  </>;
};