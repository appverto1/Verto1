import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Building2, CheckCircle2, Loader2, Plus, Search, X } from 'lucide-react';
import { dataService } from '../services/dataService';

type SelectedEntity = {
  id: string;
  name?: string;
  display_name?: string;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  units?: any[];
  contacts?: any[];
};

type ConsentState = Record<string, '' | 'AUTHORIZED' | 'PENDING'>;

const CONSENT_OPTIONS = [
  ['SCHOOL_CONTACT', 'Contato com a escola'],
  ['CLINICAL_INFORMATION_SHARING', 'Compartilhamento de informações clínicas'],
  ['SCHOOL_MEETING_PARTICIPATION', 'Participação em reuniões escolares'],
] as const;

const initialForm = () => ({
  enrollmentType: 'PRIMARY_SCHOOL',
  schoolUnitId: '',
  academicYear: String(new Date().getFullYear()),
  gradeLevel: '',
  className: '',
  shift: '',
  enrollmentCode: '',
  teacherContactId: '',
  coordinatorContactId: '',
  startedAt: new Date().toISOString().slice(0, 10),
  notes: '',
  exitReason: '',
  confirmPrimaryReplacement: false,
});

const initialConsents = (): ConsentState => ({
  SCHOOL_CONTACT: '',
  CLINICAL_INFORMATION_SHARING: '',
  SCHOOL_MEETING_PARTICIPATION: '',
});

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-800 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:bg-slate-50 disabled:text-slate-500';

const normalizeJoined = (value: any) => (Array.isArray(value) ? value[0] || null : value || null);

export function SchoolEnrollmentDialog({
  open,
  onClose,
  onSaved,
  fixedPatient,
  fixedSchool,
  enrollment,
  canCreateSchool = false,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  fixedPatient?: SelectedEntity | null;
  fixedSchool?: SelectedEntity | null;
  enrollment?: any | null;
  canCreateSchool?: boolean;
}) {
  const [patient, setPatient] = useState<SelectedEntity | null>(fixedPatient || null);
  const [school, setSchool] = useState<SelectedEntity | null>(fixedSchool || null);
  const [patientSearch, setPatientSearch] = useState('');
  const [schoolSearch, setSchoolSearch] = useState('');
  const [patientOptions, setPatientOptions] = useState<any[]>([]);
  const [schoolOptions, setSchoolOptions] = useState<any[]>([]);
  const [form, setForm] = useState(initialForm);
  const [consents, setConsents] = useState<ConsentState>(initialConsents);
  const [consentExpiresAt, setConsentExpiresAt] = useState('');
  const [currentPrimary, setCurrentPrimary] = useState<any | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showCreateSchool, setShowCreateSchool] = useState(false);
  const [newSchool, setNewSchool] = useState({ displayName: '', city: '', state: '' });
  const idempotencyKey = useRef(crypto.randomUUID());
  const isEditing = Boolean(enrollment?.id);

  useEffect(() => {
    if (!open) return;
    const joinedSchool = normalizeJoined(enrollment?.schools);
    setPatient(fixedPatient || null);
    setSchool(fixedSchool || (joinedSchool ? { ...joinedSchool } : null));
    setPatientSearch('');
    setSchoolSearch('');
    setPatientOptions([]);
    setSchoolOptions([]);
    setCurrentPrimary(null);
    setError('');
    setLoadingDetails(false);
    setShowCreateSchool(false);
    setConsents(initialConsents());
    setConsentExpiresAt('');
    setForm({
      ...initialForm(),
      enrollmentType: enrollment?.enrollment_type || 'PRIMARY_SCHOOL',
      schoolUnitId: enrollment?.school_unit_id || '',
      academicYear: String(enrollment?.academic_year || new Date().getFullYear()),
      gradeLevel: enrollment?.grade_level || '',
      className: enrollment?.class_name || '',
      shift: enrollment?.shift || '',
      enrollmentCode: enrollment?.enrollment_code || '',
      teacherContactId: enrollment?.teacher_contact_id || '',
      coordinatorContactId: enrollment?.coordinator_contact_id || '',
      startedAt: enrollment?.started_at ? String(enrollment.started_at).slice(0, 10) : new Date().toISOString().slice(0, 10),
      notes: enrollment?.notes || '',
      exitReason: '',
      confirmPrimaryReplacement: false,
    });
    idempotencyKey.current = crypto.randomUUID();
  }, [open, fixedPatient, fixedSchool, enrollment]);

  useEffect(() => {
    if (!open || fixedPatient || !fixedSchool?.id || isEditing) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingOptions(true);
      const result = await dataService.searchPatientsForSchool(fixedSchool.id, {
        search: patientSearch,
        page: 1,
        pageSize: 20,
      }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setPatientOptions(result?.success ? result.data || [] : []);
      if (!result?.success) setError(result?.message || 'Não foi possível buscar pacientes.');
      setLoadingOptions(false);
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, fixedPatient, fixedSchool?.id, isEditing, patientSearch]);

  useEffect(() => {
    if (!open || fixedSchool || !fixedPatient?.id || isEditing) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingOptions(true);
      const result = await dataService.getSchoolAutocomplete(schoolSearch, 1, 20, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setSchoolOptions(result?.success ? result.data || [] : []);
      if (!result?.success) setError(result?.message || 'Não foi possível buscar escolas.');
      setLoadingOptions(false);
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, fixedSchool, fixedPatient?.id, isEditing, schoolSearch]);

  const hasEnrollmentOptions = Boolean(school && Array.isArray(school.units) && Array.isArray(school.contacts));

  useEffect(() => {
    if (!open || !school?.id || hasEnrollmentOptions) return;
    const controller = new AbortController();
    setLoadingDetails(true);
    void dataService.getSchoolEnrollmentOptions(school.id, { signal: controller.signal })
      .then((result: any) => {
        if (controller.signal.aborted) return;
        if (result?.success) setSchool((current) => ({ ...(current || {}), ...(result.data || {}) }));
        else setError(result?.message || 'Não foi possível carregar unidades e contatos desta escola.');
      })
      .catch((requestError: any) => {
        if (!controller.signal.aborted) setError(requestError?.message || 'Não foi possível carregar unidades e contatos desta escola.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingDetails(false);
      });
    return () => controller.abort();
  }, [open, school?.id, hasEnrollmentOptions]);

  useEffect(() => {
    if (!open || !patient?.id) {
      setCurrentPrimary(null);
      return;
    }
    let cancelled = false;
    void dataService.getPatientSchoolEnrollments(patient.id).then((result: any) => {
      if (cancelled) return;
      const rows = result?.success ? result.data || [] : [];
      setCurrentPrimary(
        rows.find(
          (row: any) =>
            row.is_current &&
            row.enrollment_type === 'PRIMARY_SCHOOL' &&
            String(row.id) !== String(enrollment?.id || ''),
        ) || null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, patient?.id, enrollment?.id]);

  const units = useMemo(() => (school?.units || []).filter((unit: any) => unit.is_active !== false && !unit.archived_at), [school]);
  const contacts = useMemo(
    () => (school?.contacts || []).filter((contact: any) => contact.is_active !== false && !contact.archived_at),
    [school],
  );
  const replacingPrimary =
    form.enrollmentType === 'PRIMARY_SCHOOL' &&
    Boolean(currentPrimary) &&
    String(currentPrimary?.school_id || normalizeJoined(currentPrimary?.schools)?.id || '') !== String(school?.id || '');
  const selectedPatientAlreadyLinked = Boolean((patient as any)?.alreadyLinkedToSchool);

  if (!open) return null;

  const selectPatient = (option: any) => {
    setPatient(option);
    setPatientOptions([]);
    setPatientSearch(option.name || '');
    setError('');
  };

  const selectSchool = (option: any) => {
    setLoadingDetails(false);
    setSchool(option);
    setSchoolOptions([]);
    setSchoolSearch(option.display_name || '');
    setForm((value) => ({ ...value, schoolUnitId: '', teacherContactId: '', coordinatorContactId: '' }));
    setError('');
  };

  const createSchoolInline = async () => {
    if (!newSchool.displayName.trim()) return;
    setSaving(true);
    setError('');
    const result = await dataService.createSchool({
      ...newSchool,
      educationNetwork: 'OTHER',
      schoolType: 'OTHER',
      idempotencyKey: idempotencyKey.current + ':school',
    });
    if (result?.success) {
      selectSchool(result.data);
      setShowCreateSchool(false);
      setNewSchool({ displayName: '', city: '', state: '' });
    } else if (result?.error === 'POSSIBLE_SCHOOL_DUPLICATE' && result.candidates?.length) {
      setSchoolOptions(result.candidates);
      setShowCreateSchool(false);
      setError('Encontramos possíveis duplicidades. Selecione a instituição existente na lista.');
    } else {
      setError(result?.message || 'Não foi possível cadastrar a escola.');
    }
    setSaving(false);
  };

  const save = async () => {
    if (!patient?.id || !school?.id) {
      setError('Selecione o paciente e a escola para continuar.');
      return;
    }
    if (units.length > 0 && !form.schoolUnitId) {
      setError('Selecione a unidade correta desta escola para continuar.');
      return;
    }
    if (selectedPatientAlreadyLinked && !isEditing) {
      setError('Este paciente já possui vínculo atual com esta escola. Edite o vínculo existente.');
      return;
    }
    if (replacingPrimary && (!form.confirmPrimaryReplacement || !form.exitReason.trim())) {
      setError('Confirme a troca e informe o motivo de saída da escola principal anterior.');
      return;
    }
    setSaving(true);
    setError('');
    const consentPayload = Object.entries(consents)
      .filter(([, status]) => Boolean(status))
      .map(([consentType, status]) => ({
        consentType,
        status,
        effectiveAt: new Date().toISOString(),
        grantedAt: status === 'AUTHORIZED' ? new Date().toISOString() : null,
        expiresAt: status === 'AUTHORIZED' && consentExpiresAt ? consentExpiresAt : null,
        notes: 'Status revisado durante o vínculo escolar.',
      }));
    const payload = {
      ...form,
      schoolId: school.id,
      academicYear: Number(form.academicYear) || null,
      closeCurrent: replacingPrimary && form.confirmPrimaryReplacement,
      previousExitReason: replacingPrimary ? form.exitReason.trim() : null,
      exitReason: replacingPrimary ? form.exitReason.trim() : null,
      consents: consentPayload,
      reason: isEditing ? 'Dados do vínculo escolar atualizados' : 'Vínculo escolar registrado',
      idempotencyKey: idempotencyKey.current,
    };
    const result = isEditing
      ? await dataService.updatePatientSchoolEnrollment(patient.id, enrollment.id, payload)
      : await dataService.createPatientSchoolEnrollment(patient.id, payload);
    if (result?.success) {
      await onSaved();
      onClose();
    } else {
      setError(result?.message || result?.error || 'Não foi possível salvar o vínculo escolar.');
      if (Number(result?.status || 0) >= 400 && Number(result?.status || 0) < 500) {
        idempotencyKey.current = crypto.randomUUID();
      }
    }
    setSaving(false);
  };

  return createPortal(
    <div className="fixed inset-0 z-[180] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="school-enrollment-title">
      <div className="max-h-[96vh] w-full overflow-y-auto rounded-t-[28px] bg-white shadow-2xl sm:max-w-3xl sm:rounded-[28px]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 id="school-enrollment-title" className="text-lg font-semibold text-slate-900">
              {isEditing ? 'Editar vínculo escolar' : 'Vincular paciente e escola'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">Os dados são salvos no cadastro canônico e o histórico anterior é preservado.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-300" aria-label="Fechar">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {error && (
            <div role="alert" className="flex gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <AlertTriangle className="mt-0.5 shrink-0" size={17} />
              <p>{error}</p>
            </div>
          )}

          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Paciente *</label>
              {patient ? (
                <div className="flex min-h-12 items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{patient.name || 'Paciente selecionado'}</p>
                    {patient.email && <p className="truncate text-xs text-slate-500">{patient.email}</p>}
                  </div>
                  {!fixedPatient && !isEditing && <button type="button" onClick={() => setPatient(null)} className="rounded-lg px-2 py-1 text-xs font-medium text-violet-700">Trocar</button>}
                </div>
              ) : (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-3.5 text-slate-400" size={17} />
                  <input value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} className={`${inputClass} pl-10`} placeholder="Buscar por nome ou e-mail" autoComplete="off" />
                  {(patientOptions.length > 0 || loadingOptions) && (
                    <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                      {loadingOptions ? <Loader2 className="mx-auto my-4 animate-spin text-violet-600" size={20} /> : patientOptions.map((option) => (
                        <button key={option.id} type="button" onClick={() => selectPatient(option)} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50">
                          <span className="block truncate text-sm font-medium text-slate-800">{option.name}</span>
                          <span className="block text-xs text-slate-500">{option.alreadyLinkedToSchool ? 'Já vinculado a esta escola' : option.email || 'Sem e-mail'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Escola ou instituição *</label>
              {school ? (
                <div className="flex min-h-12 items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{school.display_name}</p>
                    <p className="truncate text-xs text-slate-500">{[school.city, school.state].filter(Boolean).join(' / ') || 'Local não informado'}</p>
                  </div>
                  {!fixedSchool && !isEditing && <button type="button" onClick={() => setSchool(null)} className="rounded-lg px-2 py-1 text-xs font-medium text-violet-700">Trocar</button>}
                </div>
              ) : (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-3.5 text-slate-400" size={17} />
                  <input value={schoolSearch} onChange={(event) => setSchoolSearch(event.target.value)} className={`${inputClass} pl-10`} placeholder="Buscar instituição" autoComplete="off" />
                  {(schoolOptions.length > 0 || loadingOptions) && (
                    <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                      {loadingOptions ? <Loader2 className="mx-auto my-4 animate-spin text-violet-600" size={20} /> : schoolOptions.map((option) => (
                        <button key={option.id} type="button" onClick={() => selectSchool(option)} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50">
                          <span className="block truncate text-sm font-medium text-slate-800">{option.display_name}</span>
                          <span className="block text-xs text-slate-500">{[option.city, option.state].filter(Boolean).join(' / ') || 'Local não informado'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {canCreateSchool && !fixedSchool && !isEditing && !school && (
                <button type="button" onClick={() => setShowCreateSchool((value) => !value)} className="mt-2 inline-flex min-h-10 items-center gap-1.5 text-xs font-medium text-violet-700">
                  <Plus size={15} /> Cadastrar instituição sem sair
                </button>
              )}
            </div>
          </section>

          {showCreateSchool && (
            <section className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-violet-900"><Building2 size={17} /> Cadastro rápido de instituição</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_80px]">
                <input className={inputClass} value={newSchool.displayName} onChange={(event) => setNewSchool((value) => ({ ...value, displayName: event.target.value }))} placeholder="Nome da instituição *" />
                <input className={inputClass} value={newSchool.city} onChange={(event) => setNewSchool((value) => ({ ...value, city: event.target.value }))} placeholder="Cidade" />
                <input className={inputClass} value={newSchool.state} onChange={(event) => setNewSchool((value) => ({ ...value, state: event.target.value.toUpperCase().slice(0, 2) }))} placeholder="UF" maxLength={2} />
              </div>
              <button type="button" disabled={saving || !newSchool.displayName.trim()} onClick={() => void createSchoolInline()} className="mt-3 min-h-11 rounded-xl bg-violet-600 px-4 text-sm font-medium text-white disabled:opacity-50">
                {saving ? 'Cadastrando…' : 'Cadastrar e selecionar'}
              </button>
            </section>
          )}

          {patient && school && (
            <>
              <section className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">Tipo de vínculo</span>
                  <select className={inputClass} value={form.enrollmentType} onChange={(event) => setForm((value) => ({ ...value, enrollmentType: event.target.value }))}>
                    <option value="PRIMARY_SCHOOL">Escola principal</option>
                    <option value="SECONDARY_SCHOOL">Escola secundária</option>
                    <option value="SUPPORT_INSTITUTION">Instituição de apoio</option>
                    <option value="HOME_EDUCATION">Educação domiciliar</option>
                    <option value="COURSE">Curso</option>
                    <option value="OTHER">Outro</option>
                  </select>
                </label>
                <label>
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">Unidade {units.length > 0 && <span className="text-rose-500">*</span>}</span>
                  <select className={inputClass} value={form.schoolUnitId} onChange={(event) => setForm((value) => ({ ...value, schoolUnitId: event.target.value }))} disabled={loadingDetails}>
                    <option value="">{units.length > 0 ? 'Selecione a unidade…' : 'Instituição sem unidades'}</option>
                    {units.map((unit: any) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                  </select>
                  {units.length > 0 && !form.schoolUnitId && <span className="mt-1 block text-xs text-slate-500">Obrigatória porque esta instituição possui unidades ativas.</span>}
                </label>
                <label><span className="mb-1.5 block text-sm font-medium text-slate-700">Ano letivo</span><input className={inputClass} inputMode="numeric" value={form.academicYear} onChange={(event) => setForm((value) => ({ ...value, academicYear: event.target.value }))} /></label>
                <label><span className="mb-1.5 block text-sm font-medium text-slate-700">Série/ano</span><input className={inputClass} value={form.gradeLevel} onChange={(event) => setForm((value) => ({ ...value, gradeLevel: event.target.value }))} /></label>
                <label><span className="mb-1.5 block text-sm font-medium text-slate-700">Turma</span><input className={inputClass} value={form.className} onChange={(event) => setForm((value) => ({ ...value, className: event.target.value }))} /></label>
                <label>
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">Turno</span>
                  <select className={inputClass} value={form.shift} onChange={(event) => setForm((value) => ({ ...value, shift: event.target.value }))}>
                    <option value="">Não informado</option>
                    <option value="MORNING">Manhã</option>
                    <option value="AFTERNOON">Tarde</option>
                    <option value="EVENING">Noite</option>
                    <option value="FULL_TIME">Integral</option>
                    <option value="OTHER">Outro</option>
                  </select>
                </label>
                <label><span className="mb-1.5 block text-sm font-medium text-slate-700">Matrícula</span><input className={inputClass} value={form.enrollmentCode} onChange={(event) => setForm((value) => ({ ...value, enrollmentCode: event.target.value }))} /></label>
                <label><span className="mb-1.5 block text-sm font-medium text-slate-700">Início</span><input type="date" className={inputClass} value={form.startedAt} onChange={(event) => setForm((value) => ({ ...value, startedAt: event.target.value }))} /></label>
                <label>
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">Professor(a)</span>
                  <select className={inputClass} value={form.teacherContactId} onChange={(event) => setForm((value) => ({ ...value, teacherContactId: event.target.value }))}>
                    <option value="">Não informado</option>
                    {contacts.map((contact: any) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
                  </select>
                </label>
                <label>
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">Coordenação escolar</span>
                  <select className={inputClass} value={form.coordinatorContactId} onChange={(event) => setForm((value) => ({ ...value, coordinatorContactId: event.target.value }))}>
                    <option value="">Não informada</option>
                    {contacts.map((contact: any) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
                  </select>
                </label>
                <label className="sm:col-span-2"><span className="mb-1.5 block text-sm font-medium text-slate-700">Observações administrativas</span><textarea className={`${inputClass} min-h-24`} value={form.notes} onChange={(event) => setForm((value) => ({ ...value, notes: event.target.value }))} /></label>
              </section>

              {replacingPrimary && (
                <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex gap-2 text-sm text-amber-900"><AlertTriangle className="mt-0.5 shrink-0" size={18} /><p>Já existe uma escola principal atual. A troca encerra o vínculo anterior, mas nunca apaga seu histórico.</p></div>
                  <label className="mt-3 flex items-start gap-2 text-sm text-amber-950">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 rounded" checked={form.confirmPrimaryReplacement} onChange={(event) => setForm((value) => ({ ...value, confirmPrimaryReplacement: event.target.checked }))} />
                    Confirmo que desejo tornar esta a nova escola principal.
                  </label>
                  <label className="mt-3 block"><span className="mb-1 block text-xs font-medium text-amber-900">Motivo da saída anterior *</span><input className={inputClass} value={form.exitReason} onChange={(event) => setForm((value) => ({ ...value, exitReason: event.target.value }))} /></label>
                </section>
              )}

              {!isEditing && (
                <section className="rounded-2xl border border-slate-200 p-4">
                  <h3 className="text-sm font-medium text-slate-900">Autorizações relacionadas</h3>
                  <p className="mt-1 text-xs text-slate-500">Registre somente o que foi efetivamente revisado. Cada alteração cria uma versão auditável.</p>
                  <div className="mt-3 space-y-2">
                    {CONSENT_OPTIONS.map(([value, label]) => (
                      <label key={value} className="grid items-center gap-2 sm:grid-cols-[1fr_190px]">
                        <span className="text-sm text-slate-700">{label}</span>
                        <select className={inputClass} value={consents[value]} onChange={(event) => setConsents((current) => ({ ...current, [value]: event.target.value as ConsentState[string] }))}>
                          <option value="">Não registrar agora</option>
                          <option value="AUTHORIZED">Autorizada</option>
                          <option value="PENDING">Pendente</option>
                        </select>
                      </label>
                    ))}
                  </div>
                  {Object.values(consents).includes('AUTHORIZED') && <label className="mt-3 block sm:max-w-xs"><span className="mb-1 block text-xs font-medium text-slate-600">Validade das autorizações (opcional)</span><input type="date" className={inputClass} value={consentExpiresAt} onChange={(event) => setConsentExpiresAt(event.target.value)} /></label>}
                </section>
              )}
            </>
          )}
        </div>

        <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-600">Cancelar</button>
          <button type="button" disabled={saving || !patient?.id || !school?.id || loadingDetails || (units.length > 0 && !form.schoolUnitId)} onClick={() => void save()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-5 text-sm font-medium text-white disabled:opacity-50">
            {saving ? <><Loader2 className="animate-spin" size={17} /> Salvando…</> : <><CheckCircle2 size={17} /> Salvar vínculo</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
