import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  Loader2,
  Plus,
  Save,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { dataService } from '../services/dataService';

const ATTENDANCE = ['INVITED', 'CONFIRMED', 'ATTENDED', 'ABSENT', 'DECLINED', 'UNKNOWN'];
const statusLabel: Record<string, string> = {
  DRAFT: 'Rascunho',
  SCHEDULED: 'Agendada',
  CONFIRMED: 'Confirmada',
  RESCHEDULED: 'Reagendada',
  COMPLETED: 'Realizada',
  CANCELLED: 'Cancelada',
  NOT_HELD: 'Não realizada',
};
const formatDateTime = (value?: string | null) => value
  ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  : 'Não informado';

const idempotencyKey = () => crypto.randomUUID();

type PatientNoteDraft = { note: string; decisions: string; referrals: string; visibility: string };
type ReferralDraft = {
  title: string;
  description: string;
  patientId: string;
  responsibleUserId: string;
  dueAt: string;
  priority: string;
};

export function SchoolMeetingWorkspace({
  meetingId,
  school,
  professionals = [],
  userRole = 'coordinator',
  onClose,
  onChanged,
}: {
  meetingId: string;
  school?: any;
  professionals?: any[];
  userRole?: string;
  onClose: () => void;
  onChanged?: (meeting: any) => void;
}) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'summary' | 'participants' | 'minutes' | 'documents'>('summary');
  const [transition, setTransition] = useState({ scheduledStart: '', scheduledEnd: '', reason: '' });
  const [participant, setParticipant] = useState({
    participantType: 'INTERNAL_USER',
    professionalId: '',
    schoolContactId: '',
    externalName: '',
    externalEmail: '',
    responsibleId: '',
    attendanceStatus: 'INVITED',
  });
  const [minutes, setMinutes] = useState({
    actualStart: '',
    actualEnd: '',
    generalSummary: '',
    decisions: '',
    nextMeetingAt: '',
    status: 'DRAFT',
  });
  const [patientNotes, setPatientNotes] = useState<Record<string, PatientNoteDraft>>({});
  const [referrals, setReferrals] = useState<ReferralDraft[]>([]);
  const [documentForm, setDocumentForm] = useState({ documentId: '', documentType: 'OTHER', visibility: 'INTERNAL', patientId: '' });
  const [candidateRows, setCandidateRows] = useState<any[]>([]);
  const [candidatePage, setCandidatePage] = useState(1);
  const [candidatePagination, setCandidatePagination] = useState<any>(null);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const normalizedRole = String(userRole || '').toLowerCase();
  const canAccessClinicalContent = ['owner', 'admin', 'coordinator', 'therapist'].includes(normalizedRole);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [meetingResult, noteResult] = await Promise.all([
      dataService.getSchoolMeetingDetail(meetingId),
      canAccessClinicalContent
        ? dataService.getSchoolMeetingPatientNotes(meetingId).catch(() => ({ success: false, data: [] }))
        : Promise.resolve({ success: false, data: [] }),
    ]);
    if (meetingResult?.success) {
      const data = meetingResult.data;
      setDetail(data);
      if (data.minutes) {
        setMinutes({
          actualStart: data.minutes.actual_start?.slice(0, 16) || '',
          actualEnd: data.minutes.actual_end?.slice(0, 16) || '',
          generalSummary: data.minutes.general_summary || '',
          decisions: data.minutes.decisions || '',
          nextMeetingAt: data.minutes.next_meeting_at?.slice(0, 16) || '',
          status: data.minutes.status || 'DRAFT',
        });
      }
      const referralDrafts = (data.referrals || [])
        .filter((row: any) => row.status === 'PENDING_TASK' || row.status === 'TASK_FAILED')
        .map((row: any) => ({
          title: row.title || '',
          description: row.description || '',
          patientId: row.patient_id || '',
          responsibleUserId: row.responsible_user_id || '',
          dueAt: row.due_at?.slice(0, 16) || '',
          priority: row.priority || 'MEDIUM',
        }));
      if (referralDrafts.length) setReferrals(referralDrafts);
    } else {
      setError(meetingResult?.message || 'Não foi possível abrir a reunião.');
    }
    if (noteResult?.success) {
      const next: Record<string, PatientNoteDraft> = {};
      (noteResult.data || []).filter((note: any) => note.is_current).forEach((note: any) => {
        next[note.patient_id] = {
          note: note.note || '',
          decisions: note.decisions || '',
          referrals: note.referrals || '',
          visibility: note.visibility || 'CLINICAL_TEAM',
        };
      });
      setPatientNotes(next);
    }
    setLoading(false);
  }, [meetingId, canAccessClinicalContent]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!canAccessClinicalContent && (tab === 'minutes' || tab === 'documents')) setTab('summary');
  }, [canAccessClinicalContent, tab]);

  const activePatients = useMemo(
    () => detail?.patients?.filter((row: any) => row.participation_status !== 'REMOVED') || [],
    [detail],
  );
  const activeParticipants = useMemo(
    () => detail?.participants?.filter((row: any) => !row.removed_at) || [],
    [detail],
  );
  const patientIds = useMemo(() => new Set(activePatients.map((row: any) => String(row.patient_id))), [activePatients]);
  const responsibleOptions = useMemo(() => {
    const map = new Map<string, string>();
    activePatients.forEach((row: any) => {
      const responsibleId = String(row.patients?.responsible_user_id || '').trim();
      if (responsibleId) map.set(responsibleId, `Responsável de ${row.patients?.name || 'paciente'}`);
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [activePatients]);

  const emitChange = (meeting: any) => {
    window.dispatchEvent(new CustomEvent('verto:school-meeting-event', { detail: meeting }));
    onChanged?.(meeting);
  };

  const runTransition = async (action: string) => {
    const reason = transition.reason.trim();
    if (['CANCEL', 'NOT_HELD'].includes(action) && !reason) {
      setNotice('Informe o motivo desta alteração.');
      return;
    }
    if (action === 'RESCHEDULE' && (!transition.scheduledStart || !transition.scheduledEnd)) {
      setNotice('Informe o novo início e término.');
      return;
    }
    setSaving(true);
    setNotice('');
    const payload: any = { action, idempotencyKey: idempotencyKey() };
    if (action === 'RESCHEDULE') {
      payload.scheduledStart = transition.scheduledStart;
      payload.scheduledEnd = transition.scheduledEnd;
    }
    if (reason) payload.reason = reason;
    const result = await dataService.updateSchoolMeeting(meetingId, payload);
    if (result?.success) {
      setNotice('Reunião atualizada com histórico preservado.');
      emitChange(result.data || result.meeting);
      await load();
    } else {
      setNotice(result?.message || 'Não foi possível atualizar a reunião.');
    }
    setSaving(false);
  };

  const loadCandidates = useCallback(async (page = 1) => {
    if (!detail?.school_id) return;
    setCandidateLoading(true);
    const result = await dataService.searchSchoolPatients({
      schoolId: detail.school_id,
      unitId: detail.school_unit_id || '',
      page,
      pageSize: 50,
    });
    if (result?.success) {
      setCandidateRows((result.data || []).filter((row: any) => !patientIds.has(String(row.patient_id))));
      setCandidatePagination(result.pagination || null);
      setCandidatePage(page);
    } else {
      setNotice(result?.message || 'Não foi possível carregar pacientes elegíveis.');
    }
    setCandidateLoading(false);
  }, [detail?.school_id, detail?.school_unit_id, patientIds]);

  useEffect(() => {
    if (tab === 'participants' && detail?.school_id) void loadCandidates(1);
  }, [tab, detail?.school_id, detail?.school_unit_id, loadCandidates]);

  const addPatients = async () => {
    if (!selectedCandidateIds.length) return;
    setSaving(true);
    const result = await dataService.addSchoolMeetingPatients(meetingId, {
      patientIds: selectedCandidateIds,
      idempotencyKey: idempotencyKey(),
    });
    if (result?.success) {
      setSelectedCandidateIds([]);
      setNotice('Pacientes adicionados em lote.');
      await load();
      await loadCandidates(candidatePage);
    } else setNotice(result?.message || 'Não foi possível adicionar os pacientes.');
    setSaving(false);
  };

  const removePatient = async (patientId: string) => {
    if (!confirm('Remover este paciente da reunião? O vínculo será preservado como removido.')) return;
    const result = await dataService.removeSchoolMeetingPatients(meetingId, {
      patientIds: [patientId],
      reason: 'Remoção pela gestão da reunião',
      idempotencyKey: idempotencyKey(),
    });
    if (result?.success) await load();
    else setNotice(result?.message || 'Não foi possível remover o paciente.');
  };

  const addParticipant = async () => {
    const payload: any = { ...participant, idempotencyKey: idempotencyKey() };
    if (participant.participantType === 'INTERNAL_USER' && !participant.professionalId) return setNotice('Selecione o profissional interno.');
    if (participant.participantType === 'SCHOOL_CONTACT' && !participant.schoolContactId) return setNotice('Selecione o contato escolar.');
    if (participant.participantType === 'FAMILY_RESPONSIBLE' && !participant.responsibleId) return setNotice('Selecione o responsável familiar.');
    if (participant.participantType === 'EXTERNAL_GUEST' && !participant.externalName.trim()) return setNotice('Informe o nome do convidado externo.');
    setSaving(true);
    setNotice('');
    const result = await dataService.addSchoolMeetingParticipant(meetingId, payload);
    if (result?.success) {
      setParticipant({ participantType: 'INTERNAL_USER', professionalId: '', schoolContactId: '', externalName: '', externalEmail: '', responsibleId: '', attendanceStatus: 'INVITED' });
      setNotice('Participante adicionado.');
      await load();
    } else setNotice(result?.message || 'Não foi possível adicionar o participante.');
    setSaving(false);
  };

  const removeParticipant = async (participantId: string) => {
    if (!confirm('Remover este participante? A participação histórica será preservada.')) return;
    const result = await dataService.removeSchoolMeetingParticipant(meetingId, participantId, {
      reason: 'Removido pela gestão da reunião',
      idempotencyKey: idempotencyKey(),
    });
    if (result?.success) await load();
    else setNotice(result?.message || 'Não foi possível remover o participante.');
  };

  const markAttendance = async (subjectType: string, subjectId: string, status: string) => {
    const result = await dataService.updateSchoolMeetingAttendance(meetingId, {
      subjectType,
      subjectId,
      status,
      joinedAt: status === 'ATTENDED' ? new Date().toISOString() : null,
      idempotencyKey: idempotencyKey(),
    });
    if (result?.success) await load();
    else setNotice(result?.message || 'Não foi possível registrar a presença.');
  };

  const saveMinutes = async (complete = false) => {
    setSaving(true);
    setNotice('');
    const payload = {
      ...minutes,
      status: complete ? 'COMPLETED' : minutes.status,
      patientNotes: activePatients.map((row: any) => ({
        patientId: row.patient_id,
        ...(patientNotes[row.patient_id] || { note: '', decisions: '', referrals: '', visibility: 'CLINICAL_TEAM' }),
      })),
      referrals: referrals.filter((row) => row.title.trim() && row.responsibleUserId && row.patientId),
      idempotencyKey: idempotencyKey(),
    };
    const invalidReferral = referrals.some((row) => row.title.trim() && (!row.patientId || !row.responsibleUserId));
    if (invalidReferral) {
      setNotice('Todo encaminhamento deve possuir paciente e responsável para gerar uma tarefa canônica.');
      setSaving(false);
      return;
    }
    const result = await dataService.saveSchoolMeetingMinutes(meetingId, payload);
    if (result?.success) {
      setNotice(complete ? 'Ata concluída e encaminhamentos sincronizados com tarefas.' : 'Ata salva.');
      await load();
      emitChange({ ...detail, status: complete ? 'COMPLETED' : detail.status });
    } else setNotice(result?.message || 'Não foi possível salvar a ata.');
    setSaving(false);
  };

  const linkDocument = async () => {
    if (!documentForm.documentId || !documentForm.patientId) {
      setNotice('Selecione o paciente e um documento do prontuário dele.');
      return;
    }
    const selectedFile = (detail.availableDocuments || []).find((file: any) => String(file.id) === documentForm.documentId);
    if (!selectedFile || String(selectedFile.patient_id) !== documentForm.patientId) {
      setNotice('O documento precisa pertencer ao paciente selecionado.');
      return;
    }
    setSaving(true);
    const result = await dataService.linkSchoolDocument({
      ...documentForm,
      schoolId: detail.school_id,
      schoolUnitId: detail.school_unit_id || null,
      meetingId,
      patientId: documentForm.patientId,
      idempotencyKey: idempotencyKey(),
    });
    if (result?.success) {
      setDocumentForm({ documentId: '', documentType: 'OTHER', visibility: 'INTERNAL', patientId: '' });
      setNotice('Documento vinculado.');
      await load();
    } else setNotice(result?.message || 'Não foi possível vincular o documento.');
    setSaving(false);
  };

  const openDocument = async (link: any) => {
    if (!link.patient_id) return setNotice('Documento sem paciente canônico associado.');
    const result = await dataService.getPatientFiles(String(link.patient_id));
    const file = result?.success ? (result.data || []).find((row: any) => String(row.id) === String(link.document_id)) : null;
    if (file?.signedUrl) window.open(file.signedUrl, '_blank', 'noopener,noreferrer');
    else setNotice('Não foi possível gerar um acesso seguro ao documento.');
  };

  const archiveDocument = async (linkId: string) => {
    if (!confirm('Arquivar este vínculo documental? O arquivo original será preservado.')) return;
    const result = await dataService.updateSchoolDocumentLink(linkId, {
      archive: true,
      reason: 'Arquivado pela gestão da reunião',
      idempotencyKey: idempotencyKey(),
    });
    if (result?.success) await load();
    else setNotice(result?.message || 'Não foi possível arquivar o vínculo.');
  };

  return (
    <div className="fixed inset-0 z-[190] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Detalhe da reunião escolar">
      <div className="max-h-[96vh] w-full max-w-6xl overflow-y-auto rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]">
        <header className="sticky top-0 z-20 flex items-start justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">Reunião escolar</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">{detail?.title || 'Carregando…'}</h2>
            <p className="mt-1 text-sm text-slate-500">{detail?.schools?.display_name || school?.display_name || 'Escola'} · {formatDateTime(detail?.scheduled_start)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 p-2" aria-label="Fechar"><X size={19} /></button>
        </header>

        {loading ? <div className="p-16 text-center"><Loader2 className="mx-auto animate-spin text-violet-600" /></div> : error ? (
          <div className="m-5 rounded-2xl bg-rose-50 p-4 text-rose-700">{error}</div>
        ) : (
          <div className="p-5">
            {notice && <div className="mb-4 rounded-2xl border border-violet-100 bg-violet-50 p-3 text-sm font-medium text-violet-800">{notice}</div>}
            <nav className="mb-5 flex gap-2 overflow-x-auto" aria-label="Seções da reunião">
              {([['summary', 'Resumo'], ['participants', 'Pacientes e participantes'], ...(canAccessClinicalContent ? [['minutes', 'Ata e encaminhamentos'], ['documents', 'Documentos']] : [])] as Array<[typeof tab, string]>).map(([value, label]) => (
                <button key={value} onClick={() => setTab(value)} className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold ${tab === value ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{label}</button>
              ))}
            </nav>

            {tab === 'summary' && (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ['Status', statusLabel[detail.status] || detail.status],
                    ['Pacientes', activePatients.length],
                    ['Participantes', activeParticipants.length],
                    ['Local', detail.location || 'Não informado'],
                  ].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-slate-100 p-4"><p className="text-xs font-semibold text-slate-400">{label}</p><p className="mt-1 font-semibold text-slate-800">{value}</p></div>)}
                </div>
                <div className="rounded-2xl border border-slate-100 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pauta geral</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{detail.agenda || 'Nenhuma pauta registrada.'}</p>
                </div>
                <div className="grid gap-3 rounded-2xl border border-slate-100 p-4 sm:grid-cols-2">
                  <input type="datetime-local" value={transition.scheduledStart} onChange={(event) => setTransition((value) => ({ ...value, scheduledStart: event.target.value }))} className="rounded-xl border border-slate-200 p-3" aria-label="Novo início" />
                  <input type="datetime-local" value={transition.scheduledEnd} onChange={(event) => setTransition((value) => ({ ...value, scheduledEnd: event.target.value }))} className="rounded-xl border border-slate-200 p-3" aria-label="Novo término" />
                  <input value={transition.reason} onChange={(event) => setTransition((value) => ({ ...value, reason: event.target.value }))} placeholder="Motivo para reagendamento, cancelamento ou não realização" className="rounded-xl border border-slate-200 p-3 sm:col-span-2" />
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    {detail.status === 'DRAFT' && <button disabled={saving} onClick={() => void runTransition('SCHEDULE')} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white">Agendar</button>}
                    {['SCHEDULED', 'RESCHEDULED'].includes(detail.status) && <button disabled={saving} onClick={() => void runTransition('CONFIRM')} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">Confirmar</button>}
                    {['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'].includes(detail.status) && <button disabled={saving} onClick={() => void runTransition('RESCHEDULE')} className="rounded-xl border border-violet-200 px-4 py-2 text-sm font-semibold text-violet-700">Reagendar</button>}
                    {['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'].includes(detail.status) && <button disabled={saving} onClick={() => void runTransition('CANCEL')} className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700">Cancelar</button>}
                    {['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'].includes(detail.status) && <button disabled={saving} onClick={() => void runTransition('NOT_HELD')} className="rounded-xl border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-700">Não realizada</button>}
                  </div>
                </div>
              </div>
            )}

            {tab === 'participants' && (
              <div className="grid gap-5 lg:grid-cols-2">
                <section>
                  <div className="flex items-center justify-between"><h3 className="font-semibold text-slate-900">Pacientes</h3><Users size={18} className="text-violet-500" /></div>
                  <div className="mt-3 space-y-2">
                    {activePatients.map((row: any) => (
                      <div key={row.id} className="rounded-2xl border border-slate-100 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div><p className="font-semibold text-slate-800">{row.patients?.name || 'Paciente'}</p><p className="text-xs text-slate-500">{row.patient_school_enrollments?.grade_level || ''} {row.patient_school_enrollments?.class_name || ''}</p></div>
                          <button onClick={() => void removePatient(row.patient_id)} className="rounded-lg p-2 text-rose-600" aria-label="Remover paciente"><Trash2 size={16} /></button>
                        </div>
                        <select value={row.participation_status || 'UNKNOWN'} onChange={(event) => void markAttendance('PATIENT', row.id, event.target.value)} className="mt-3 w-full rounded-xl border border-slate-200 p-2 text-sm" aria-label={`Presença de ${row.patients?.name || 'paciente'}`}>{ATTENDANCE.map((value) => <option key={value} value={value}>{value}</option>)}</select>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 rounded-2xl border border-dashed border-violet-200 p-4">
                    <h4 className="font-semibold text-slate-800">Adicionar pacientes da mesma escola</h4>
                    {candidateLoading ? <Loader2 className="mt-4 animate-spin text-violet-500" /> : (
                      <div className="mt-3 space-y-2">
                        {candidateRows.map((row: any) => (
                          <label key={row.patient_id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 text-sm">
                            <input type="checkbox" checked={selectedCandidateIds.includes(String(row.patient_id))} onChange={() => setSelectedCandidateIds((ids) => ids.includes(String(row.patient_id)) ? ids.filter((id) => id !== String(row.patient_id)) : [...ids, String(row.patient_id)])} />
                            <span><strong>{row.patient?.name || 'Paciente'}</strong><small className="block text-slate-500">{[row.grade_level, row.class_name, row.shift].filter(Boolean).join(' · ') || 'Sem detalhes escolares'}</small></span>
                          </label>
                        ))}
                        {!candidateRows.length && <p className="text-sm text-slate-500">Nenhum paciente elegível nesta página.</p>}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex gap-2"><button disabled={candidatePage <= 1} onClick={() => void loadCandidates(candidatePage - 1)} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-40">Anterior</button><button disabled={!candidatePagination?.hasNextPage} onClick={() => void loadCandidates(candidatePage + 1)} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-40">Próxima</button></div>
                          <button disabled={saving || !selectedCandidateIds.length} onClick={() => void addPatients()} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"><Plus size={15} className="mr-1 inline" />Adicionar selecionados</button>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <section>
                  <h3 className="font-semibold text-slate-900">Participantes internos e externos</h3>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <select value={participant.participantType} onChange={(event) => setParticipant((value) => ({ ...value, participantType: event.target.value }))} className="rounded-xl border border-slate-200 p-2">
                      <option value="INTERNAL_USER">Profissional interno</option>
                      <option value="SCHOOL_CONTACT">Contato escolar</option>
                      <option value="FAMILY_RESPONSIBLE">Responsável</option>
                      <option value="EXTERNAL_GUEST">Convidado externo</option>
                    </select>
                    {participant.participantType === 'INTERNAL_USER' && <select value={participant.professionalId} onChange={(event) => setParticipant((value) => ({ ...value, professionalId: event.target.value }))} className="rounded-xl border border-slate-200 p-2"><option value="">Selecionar profissional</option>{professionals.map((row: any) => <option key={row.id} value={row.id}>{row.name || row.email}</option>)}</select>}
                    {participant.participantType === 'SCHOOL_CONTACT' && <select value={participant.schoolContactId} onChange={(event) => setParticipant((value) => ({ ...value, schoolContactId: event.target.value }))} className="rounded-xl border border-slate-200 p-2"><option value="">Selecionar contato</option>{(detail.schoolContacts || []).map((row: any) => <option key={row.id} value={row.id}>{row.name} · {row.role}</option>)}</select>}
                    {participant.participantType === 'FAMILY_RESPONSIBLE' && <select value={participant.responsibleId} onChange={(event) => setParticipant((value) => ({ ...value, responsibleId: event.target.value }))} className="rounded-xl border border-slate-200 p-2"><option value="">Selecionar responsável</option>{responsibleOptions.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select>}
                    {participant.participantType === 'EXTERNAL_GUEST' && <><input value={participant.externalName} onChange={(event) => setParticipant((value) => ({ ...value, externalName: event.target.value }))} placeholder="Nome" className="rounded-xl border border-slate-200 p-2" /><input type="email" value={participant.externalEmail} onChange={(event) => setParticipant((value) => ({ ...value, externalEmail: event.target.value }))} placeholder="E-mail" className="rounded-xl border border-slate-200 p-2" /></>}
                    <button disabled={saving} onClick={() => void addParticipant()} className="rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white sm:col-span-2"><UserPlus size={15} className="mr-1 inline" />Adicionar</button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {activeParticipants.map((row: any) => (
                      <div key={row.id} className="rounded-2xl border border-slate-100 p-3">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-slate-800">{row.school_contacts?.name || row.external_name || professionals.find((professional: any) => String(professional.id) === String(row.professional_id))?.name || responsibleOptions.find((responsible) => responsible.id === String(row.responsible_id))?.label || row.participant_type}</p>
                          <button onClick={() => void removeParticipant(row.id)} className="rounded-lg p-2 text-rose-600" aria-label="Remover participante"><Trash2 size={16} /></button>
                        </div>
                        <select value={row.attendance_status || 'UNKNOWN'} onChange={(event) => void markAttendance('PARTICIPANT', row.id, event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 p-2 text-sm" aria-label="Presença do participante">{ATTENDANCE.map((value) => <option key={value} value={value}>{value}</option>)}</select>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {canAccessClinicalContent && tab === 'minutes' && (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input type="datetime-local" value={minutes.actualStart} onChange={(event) => setMinutes((value) => ({ ...value, actualStart: event.target.value }))} className="rounded-xl border border-slate-200 p-3" aria-label="Início real" />
                  <input type="datetime-local" value={minutes.actualEnd} onChange={(event) => setMinutes((value) => ({ ...value, actualEnd: event.target.value }))} className="rounded-xl border border-slate-200 p-3" aria-label="Término real" />
                  <textarea value={minutes.generalSummary} onChange={(event) => setMinutes((value) => ({ ...value, generalSummary: event.target.value }))} placeholder="Resumo geral, sem conteúdo clínico individual" className="min-h-28 rounded-xl border border-slate-200 p-3 sm:col-span-2" />
                  <textarea value={minutes.decisions} onChange={(event) => setMinutes((value) => ({ ...value, decisions: event.target.value }))} placeholder="Decisões gerais" className="min-h-24 rounded-xl border border-slate-200 p-3 sm:col-span-2" />
                  <input type="datetime-local" value={minutes.nextMeetingAt} onChange={(event) => setMinutes((value) => ({ ...value, nextMeetingAt: event.target.value }))} className="rounded-xl border border-slate-200 p-3" aria-label="Próxima reunião" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">Notas individuais protegidas</h3>
                  <div className="mt-3 space-y-3">{activePatients.map((row: any) => {
                    const draft = patientNotes[row.patient_id] || { note: '', decisions: '', referrals: '', visibility: 'CLINICAL_TEAM' };
                    return <div key={row.patient_id} className="rounded-2xl border border-slate-100 p-4"><p className="font-semibold text-slate-800">{row.patients?.name}</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><textarea value={draft.note} onChange={(event) => setPatientNotes((value) => ({ ...value, [row.patient_id]: { ...draft, note: event.target.value } }))} placeholder="Observação específica" className="min-h-24 rounded-xl border border-slate-200 p-2 sm:col-span-2" /><textarea value={draft.decisions} onChange={(event) => setPatientNotes((value) => ({ ...value, [row.patient_id]: { ...draft, decisions: event.target.value } }))} placeholder="Decisões do paciente" className="rounded-xl border border-slate-200 p-2" /><textarea value={draft.referrals} onChange={(event) => setPatientNotes((value) => ({ ...value, [row.patient_id]: { ...draft, referrals: event.target.value } }))} placeholder="Encaminhamentos clínicos" className="rounded-xl border border-slate-200 p-2" /><select value={draft.visibility} onChange={(event) => setPatientNotes((value) => ({ ...value, [row.patient_id]: { ...draft, visibility: event.target.value } }))} className="rounded-xl border border-slate-200 p-2 sm:col-span-2"><option value="CLINICAL_TEAM">Somente equipe clínica</option><option value="AUTHORIZED_FAMILY">Família autorizada</option><option value="AUTHORIZED_SCHOOL">Escola autorizada</option></select></div></div>;
                  })}</div>
                </div>
                <div>
                  <div className="flex items-center justify-between"><h3 className="font-semibold text-slate-900">Encaminhamentos e tarefas</h3><button onClick={() => setReferrals((rows) => [...rows, { title: '', description: '', patientId: '', responsibleUserId: '', dueAt: '', priority: 'MEDIUM' }])} className="rounded-xl border border-violet-200 px-3 py-2 text-sm font-semibold text-violet-700"><Plus size={15} className="mr-1 inline" />Adicionar</button></div>
                  <div className="mt-3 space-y-3">{referrals.map((row, index) => <div key={index} className="grid gap-2 rounded-2xl border border-slate-100 p-3 sm:grid-cols-2"><input value={row.title} onChange={(event) => setReferrals((rows) => rows.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} placeholder="Título da tarefa" className="rounded-xl border border-slate-200 p-2" /><select value={row.responsibleUserId} onChange={(event) => setReferrals((rows) => rows.map((item, itemIndex) => itemIndex === index ? { ...item, responsibleUserId: event.target.value } : item))} className="rounded-xl border border-slate-200 p-2"><option value="">Responsável</option>{professionals.map((professional: any) => <option key={professional.id} value={professional.id}>{professional.name || professional.email}</option>)}</select><select value={row.patientId} onChange={(event) => setReferrals((rows) => rows.map((item, itemIndex) => itemIndex === index ? { ...item, patientId: event.target.value } : item))} className="rounded-xl border border-slate-200 p-2"><option value="">Selecione o paciente</option>{activePatients.map((patient: any) => <option key={patient.patient_id} value={patient.patient_id}>{patient.patients?.name}</option>)}</select><input type="datetime-local" value={row.dueAt} onChange={(event) => setReferrals((rows) => rows.map((item, itemIndex) => itemIndex === index ? { ...item, dueAt: event.target.value } : item))} className="rounded-xl border border-slate-200 p-2" /><select value={row.priority} onChange={(event) => setReferrals((rows) => rows.map((item, itemIndex) => itemIndex === index ? { ...item, priority: event.target.value } : item))} className="rounded-xl border border-slate-200 p-2"><option value="LOW">Baixa prioridade</option><option value="MEDIUM">Média prioridade</option><option value="HIGH">Alta prioridade</option><option value="URGENT">Urgente</option></select><textarea value={row.description} onChange={(event) => setReferrals((rows) => rows.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} placeholder="Descrição" className="rounded-xl border border-slate-200 p-2 sm:col-span-2" /></div>)}</div>
                </div>
                <div className="flex flex-wrap justify-end gap-2"><button disabled={saving} onClick={() => void saveMinutes(false)} className="rounded-xl border border-violet-200 px-4 py-3 text-sm font-semibold text-violet-700"><Save size={16} className="mr-1 inline" />Salvar rascunho</button><button disabled={saving} onClick={() => void saveMinutes(true)} className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white"><CheckCircle2 size={16} className="mr-1 inline" />Concluir ata</button></div>
              </div>
            )}

            {canAccessClinicalContent && tab === 'documents' && (
              <div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <select value={documentForm.patientId} onChange={(event) => setDocumentForm((value) => ({ ...value, patientId: event.target.value, documentId: '' }))} className="rounded-xl border border-slate-200 p-3"><option value="">Selecione o paciente</option>{activePatients.map((row: any) => <option key={row.patient_id} value={row.patient_id}>{row.patients?.name}</option>)}</select>
                  <select value={documentForm.documentId} disabled={!documentForm.patientId} onChange={(event) => setDocumentForm((value) => ({ ...value, documentId: event.target.value }))} className="rounded-xl border border-slate-200 p-3 disabled:opacity-50"><option value="">Selecione um documento existente</option>{(detail.availableDocuments || []).filter((file: any) => String(file.patient_id) === documentForm.patientId).map((file: any) => <option key={file.id} value={file.id}>{file.file_name || file.id}</option>)}</select>
                  <select value={documentForm.documentType} onChange={(event) => setDocumentForm((value) => ({ ...value, documentType: event.target.value }))} className="rounded-xl border border-slate-200 p-3"><option value="OTHER">Outro</option><option value="MEETING_MINUTES">Ata</option><option value="CONSENT">Autorização</option><option value="PEDAGOGICAL_REPORT">Relatório pedagógico</option><option value="SCHOOL_REPORT">Relatório escolar</option></select>
                  <select value={documentForm.visibility} onChange={(event) => setDocumentForm((value) => ({ ...value, visibility: event.target.value }))} className="rounded-xl border border-slate-200 p-3"><option value="INTERNAL">Interno</option><option value="AUTHORIZED_FAMILY">Família autorizada</option><option value="AUTHORIZED_SCHOOL">Escola autorizada</option></select>
                  <button disabled={saving || !documentForm.documentId || !documentForm.patientId} onClick={() => void linkDocument()} className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white sm:col-span-2 disabled:opacity-40"><FileText size={16} className="mr-1 inline" />Vincular documento existente</button>
                </div>
                <div className="mt-5 space-y-2">{(detail.documents || []).map((link: any) => <div key={link.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 p-4"><div><p className="font-semibold text-slate-800">{link.document?.file_name || link.document_type}</p><p className="text-xs text-slate-500">{link.document_type} · {link.visibility}</p></div><div className="flex gap-2"><button onClick={() => void openDocument(link)} className="rounded-lg border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700">Abrir</button><button onClick={() => void archiveDocument(link.id)} className="rounded-lg border border-rose-200 p-2 text-rose-600" aria-label="Arquivar vínculo"><Trash2 size={15} /></button></div></div>)}{!(detail.documents || []).length && <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">Nenhum documento vinculado.</div>}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
