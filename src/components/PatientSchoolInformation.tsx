import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Clock, History, Loader2, Pencil, Plus, ShieldAlert, Unlink, X } from 'lucide-react';
import { dataService } from '../services/dataService';
import { SchoolEnrollmentDialog } from './SchoolEnrollmentDialog';

const CONSENT_LABELS: Record<string, string> = {
  SCHOOL_CONTACT: 'Contato com a escola',
  CLINICAL_INFORMATION_SHARING: 'Compartilhamento de informações clínicas',
  SCHOOL_MEETING_PARTICIPATION: 'Participação em reuniões escolares',
  REPORT_SENDING: 'Envio de relatório',
  SCHOOL_DOCUMENT_RECEIVING: 'Recebimento de documentos',
};

const SHIFT_LABELS: Record<string, string> = {
  MORNING: 'Manhã',
  AFTERNOON: 'Tarde',
  EVENING: 'Noite',
  FULL_TIME: 'Integral',
  OTHER: 'Outro',
};

export function PatientSchoolInformation({
  patientId,
  canManage = false,
  isPanelDark = false,
}: {
  patientId: string;
  canManage?: boolean;
  isPanelDark?: boolean;
}) {
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [consents, setConsents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [dialogEnrollment, setDialogEnrollment] = useState<any | null | undefined>(undefined);
  const [endingEnrollment, setEndingEnrollment] = useState<any | null>(null);
  const [exitReason, setExitReason] = useState('');
  const [consentForm, setConsentForm] = useState({
    consentType: 'SCHOOL_CONTACT',
    status: 'AUTHORIZED',
    expiresAt: '',
    notes: '',
  });
  const endIdempotencyKey = useRef(crypto.randomUUID());
  const consentIdempotencyKey = useRef(crypto.randomUUID());

  const load = async () => {
    setLoading(true);
    const [enrollmentResult, consentResult] = await Promise.all([
      dataService.getPatientSchoolEnrollments(patientId),
      dataService.getPatientSchoolConsents(patientId),
    ]);
    setEnrollments(enrollmentResult?.success ? enrollmentResult.data || [] : []);
    setConsents(consentResult?.success ? consentResult.data || [] : []);
    if (!enrollmentResult?.success || !consentResult?.success) {
      setMessage('Não foi possível carregar todas as informações escolares. Tente novamente.');
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [patientId]);

  const current = useMemo(
    () =>
      enrollments.find((row) => row.is_current && row.enrollment_type === 'PRIMARY_SCHOOL') ||
      enrollments.find((row) => row.is_current),
    [enrollments],
  );

  const endEnrollment = async () => {
    if (!endingEnrollment?.id || !exitReason.trim()) return;
    setSaving(true);
    setMessage('');
    const result = await dataService.endPatientSchoolEnrollment(patientId, endingEnrollment.id, {
      reason: exitReason.trim(),
      idempotencyKey: endIdempotencyKey.current,
    });
    if (result?.success) {
      setMessage('Vínculo encerrado com histórico preservado.');
      setEndingEnrollment(null);
      setExitReason('');
      endIdempotencyKey.current = crypto.randomUUID();
      await load();
    } else {
      setMessage(result?.message || 'Não foi possível encerrar o vínculo escolar.');
      if (Number(result?.status || 0) >= 400 && Number(result?.status || 0) < 500) {
        endIdempotencyKey.current = crypto.randomUUID();
      }
    }
    setSaving(false);
  };

  const saveConsent = async (statusOverride?: string) => {
    if (!current?.id) {
      setMessage('Crie um vínculo escolar antes de registrar a autorização.');
      return;
    }
    setSaving(true);
    setMessage('');
    const status = statusOverride || consentForm.status;
    const result = await dataService.savePatientSchoolConsent(patientId, {
      ...consentForm,
      status,
      schoolEnrollmentId: current.id,
      grantedAt: status === 'AUTHORIZED' ? new Date().toISOString() : null,
      revokedAt: status === 'REVOKED' ? new Date().toISOString() : null,
      revocationReason: status === 'REVOKED' ? consentForm.notes.trim() || 'Revogação registrada' : null,
      idempotencyKey: consentIdempotencyKey.current,
    });
    if (result?.success) {
      setMessage(status === 'REVOKED' ? 'Autorização revogada com histórico preservado.' : 'Nova versão da autorização registrada.');
      consentIdempotencyKey.current = crypto.randomUUID();
      await load();
    } else {
      setMessage(result?.message || 'Não foi possível registrar a autorização.');
      if (Number(result?.status || 0) >= 400 && Number(result?.status || 0) < 500) {
        consentIdempotencyKey.current = crypto.randomUUID();
      }
    }
    setSaving(false);
  };

  if (loading) {
    return <div className="flex min-h-56 items-center justify-center"><Loader2 className="animate-spin text-violet-500" /></div>;
  }

  const card = isPanelDark ? 'border-slate-700 bg-[#101b2e] text-slate-100' : 'border-slate-100 bg-white text-slate-900';
  const secondary = isPanelDark ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className="space-y-5 animate-fade-in" data-patient-school-information>
      {message && <div role="status" className="rounded-2xl border border-violet-100 bg-violet-50 p-3 text-sm text-violet-800">{message}</div>}

      <section className={`rounded-3xl border p-5 shadow-sm ${card}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold"><Building2 className="text-violet-500" size={20} /> Informações escolares</h3>
            <p className={`mt-1 text-sm ${secondary}`}>Vínculo atual, turma, contatos e histórico em um só lugar.</p>
          </div>
          {canManage && (
            <button type="button" onClick={() => setDialogEnrollment(null)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-violet-300">
              <Plus size={16} /> {current ? 'Trocar escola' : 'Vincular escola'}
            </button>
          )}
        </div>

        {current ? (
          <div className={`mt-5 grid grid-cols-1 gap-3 rounded-2xl p-4 sm:grid-cols-3 ${isPanelDark ? 'bg-slate-900/60' : 'bg-slate-50'}`}>
            <div className="sm:col-span-2">
              <p className="text-xs text-slate-400">Escola atual</p>
              <p className="mt-1 font-semibold">{current.schools?.display_name || 'Escola vinculada'}</p>
              <p className="mt-1 text-xs text-slate-500">{current.school_units?.name || 'Unidade principal'} · {[current.grade_level, current.class_name].filter(Boolean).join(' · ') || 'Turma não informada'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Ano e turno</p>
              <p className="mt-1 font-semibold">{current.academic_year || '—'} · {SHIFT_LABELS[current.shift] || 'Não informado'}</p>
            </div>
          </div>
        ) : (
          <div className={`mt-5 rounded-2xl border border-dashed p-8 text-center ${isPanelDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
            <Building2 className="mx-auto mb-2 opacity-40" />
            <p className="font-medium">Nenhum vínculo escolar atual</p>
            <p className="mt-1 text-xs">O histórico continua disponível abaixo.</p>
          </div>
        )}
      </section>

      <section className={`rounded-3xl border p-5 ${card}`}>
        <div>
          <h3 className="flex items-center gap-2 font-semibold"><ShieldAlert size={18} className="text-violet-500" /> Autorizações escolares</h3>
          <p className="mt-1 text-xs text-slate-500">Concessões, renovações e revogações criam versões; registros anteriores não são apagados.</p>
        </div>
        {canManage && current && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-500">Finalidade</span>
              <select value={consentForm.consentType} onChange={(event) => setConsentForm((value) => ({ ...value, consentType: event.target.value }))} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800">
                {Object.entries(CONSENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-500">Validade (opcional)</span>
              <input type="date" value={consentForm.expiresAt} onChange={(event) => setConsentForm((value) => ({ ...value, expiresAt: event.target.value }))} className="w-full rounded-xl border border-slate-200 p-3 text-sm text-slate-800" />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-500">Observação</span>
              <input value={consentForm.notes} onChange={(event) => setConsentForm((value) => ({ ...value, notes: event.target.value }))} className="w-full rounded-xl border border-slate-200 p-3 text-sm text-slate-800" />
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button disabled={saving} onClick={() => void saveConsent('AUTHORIZED')} className="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50">Conceder ou renovar</button>
              <button disabled={saving} onClick={() => void saveConsent('REVOKED')} className="min-h-11 rounded-xl border border-rose-200 px-4 text-sm font-medium text-rose-700 disabled:opacity-50">Revogar autorização</button>
            </div>
          </div>
        )}
        <div className="mt-4 space-y-2">
          {consents.map((consent: any) => (
            <div key={consent.id} className={`rounded-2xl border p-3 ${isPanelDark ? 'border-slate-700' : 'border-slate-100'}`}>
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-medium">{CONSENT_LABELS[consent.consent_type] || consent.consent_type}</p>
                <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${consent.status === 'AUTHORIZED' && !consent.revoked_at ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{consent.status === 'AUTHORIZED' ? 'Autorizada' : consent.status === 'REVOKED' ? 'Revogada' : 'Pendente'}{consent.is_current ? ' · atual' : ''}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">Versão {consent.consent_version || 1} · {consent.effective_at ? new Date(consent.effective_at).toLocaleString('pt-BR') : 'data não informada'}{consent.expires_at ? ` · expira em ${new Date(consent.expires_at).toLocaleDateString('pt-BR')}` : ''}</p>
            </div>
          ))}
          {!consents.length && <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">Nenhuma autorização registrada.</p>}
        </div>
      </section>

      <section className={`rounded-3xl border p-5 ${card}`}>
        <h3 className="flex items-center gap-2 font-semibold"><History size={18} className="text-violet-500" /> Histórico escolar</h3>
        <div className="mt-4 space-y-3">
          {enrollments.map((row) => (
            <article key={row.id} className={`rounded-2xl border p-4 ${isPanelDark ? 'border-slate-700 bg-slate-900/50' : 'border-slate-100 bg-slate-50'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{row.schools?.display_name || 'Escola'}</p>
                  <p className="mt-1 text-xs text-slate-500">{[row.school_units?.name, row.grade_level, row.class_name, SHIFT_LABELS[row.shift]].filter(Boolean).join(' · ') || 'Detalhes não informados'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${row.is_current ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{row.is_current ? 'Atual' : 'Encerrado'}</span>
                  {canManage && row.is_current && (
                    <>
                      <button type="button" onClick={() => setDialogEnrollment(row)} className="min-h-10 min-w-10 rounded-xl border border-violet-200 p-2 text-violet-700" aria-label="Editar vínculo escolar"><Pencil size={15} className="mx-auto" /></button>
                      <button type="button" disabled={saving} onClick={() => { setEndingEnrollment(row); setExitReason(''); endIdempotencyKey.current = crypto.randomUUID(); }} className="min-h-10 min-w-10 rounded-xl border border-rose-200 p-2 text-rose-600" aria-label="Encerrar vínculo escolar"><Unlink size={15} className="mx-auto" /></button>
                    </>
                  )}
                </div>
              </div>
              <p className="mt-3 flex items-center gap-1 text-xs text-slate-500"><Clock size={13} />{row.started_at ? new Date(`${String(row.started_at).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : 'Início não informado'} até {row.ended_at ? new Date(row.ended_at).toLocaleDateString('pt-BR') : 'agora'}</p>
            </article>
          ))}
          {!enrollments.length && <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">Nenhum histórico escolar registrado.</p>}
        </div>
      </section>

      <SchoolEnrollmentDialog
        open={dialogEnrollment !== undefined}
        fixedPatient={{ id: patientId, name: 'Paciente selecionado' }}
        enrollment={dialogEnrollment || null}
        canCreateSchool={canManage}
        onClose={() => setDialogEnrollment(undefined)}
        onSaved={async () => {
          setMessage(dialogEnrollment?.id ? 'Vínculo escolar atualizado e persistido.' : 'Vínculo escolar salvo com histórico preservado.');
          await load();
        }}
      />

      {endingEnrollment && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="end-school-enrollment-title">
          <div className="w-full rounded-t-[28px] bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-[28px]">
            <div className="flex items-center justify-between"><h2 id="end-school-enrollment-title" className="text-lg font-semibold text-slate-900">Encerrar vínculo escolar</h2><button type="button" onClick={() => setEndingEnrollment(null)} className="rounded-xl p-2 text-slate-500" aria-label="Fechar"><X size={20} /></button></div>
            <p className="mt-2 text-sm text-slate-600">O vínculo deixará de ser atual. Todo o histórico permanecerá disponível.</p>
            <label className="mt-4 block"><span className="mb-1 block text-sm font-medium text-slate-700">Motivo do encerramento *</span><textarea value={exitReason} onChange={(event) => setExitReason(event.target.value)} className="min-h-24 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /></label>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setEndingEnrollment(null)} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-600">Cancelar</button><button type="button" disabled={saving || !exitReason.trim()} onClick={() => void endEnrollment()} className="min-h-11 rounded-xl bg-rose-600 px-4 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Encerrando…' : 'Encerrar vínculo'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
