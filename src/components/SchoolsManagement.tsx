import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Contact,
  FileText,
  Filter,
  GraduationCap,
  Loader2,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { dataService } from '../services/dataService';

type School = {
  id: string;
  display_name: string;
  legal_name?: string | null;
  city?: string | null;
  state?: string | null;
  education_network?: string;
  school_type?: string;
  is_active?: boolean;
  patientCount?: number;
  units?: any[];
  contacts?: any[];
  nextMeeting?: any;
  lastMeeting?: any;
};

const NETWORK_LABELS: Record<string, string> = {
  PUBLIC_MUNICIPAL: 'Pública municipal',
  PUBLIC_STATE: 'Pública estadual',
  PUBLIC_FEDERAL: 'Pública federal',
  PRIVATE: 'Privada',
  PHILANTHROPIC: 'Filantrópica',
  PARTNERED: 'Conveniada',
  OTHER: 'Outra',
};

const TYPE_LABELS: Record<string, string> = {
  EARLY_CHILDHOOD: 'Educação infantil',
  ELEMENTARY: 'Ensino fundamental',
  HIGH_SCHOOL: 'Ensino médio',
  SPECIAL_EDUCATION: 'Educação especial',
  TECHNICAL: 'Ensino técnico',
  HIGHER_EDUCATION: 'Ensino superior',
  BILINGUAL: 'Escola bilíngue',
  SUPPORT_INSTITUTION: 'Instituição de apoio',
  OTHER: 'Outro',
};

const MEETING_TYPE_LABELS: Record<string, string> = {
  SCHOOL_MEETING: 'Reunião escolar',
  SCHOOL_VISIT: 'Visita à escola',
  ALIGNMENT: 'Reunião de alinhamento',
  FEEDBACK: 'Reunião de devolutiva',
  CASE_DISCUSSION: 'Discussão de caso',
  STAFF_TRAINING: 'Treinamento da equipe escolar',
  SCHOOL_OBSERVATION: 'Observação escolar',
  ADMINISTRATIVE: 'Reunião administrativa',
  OTHER: 'Outro',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  SCHEDULED: 'Agendada',
  CONFIRMED: 'Confirmada',
  COMPLETED: 'Realizada',
  CANCELLED: 'Cancelada',
  RESCHEDULED: 'Reagendada',
  NOT_HELD: 'Não realizada',
};

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Não informada';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Não informada';
  return parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const Modal = ({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) => (
  <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className={`max-h-[94vh] w-full overflow-y-auto rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px] ${wide ? 'sm:max-w-5xl' : 'sm:max-w-2xl'}`}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar"><X size={20} /></button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>
);

export function SchoolsManagement({ patients = [], professionals = [], userRole = 'coordinator' }: { patients?: any[]; professionals?: any[]; userRole?: string }) {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [network, setNetwork] = useState('');
  const [schoolType, setSchoolType] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1, hasNextPage: false });
  const [selectedSchool, setSelectedSchool] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<'summary' | 'patients' | 'contacts' | 'meetings' | 'documents' | 'history'>('summary');
  const [showCreateSchool, setShowCreateSchool] = useState(false);
  const [showMeeting, setShowMeeting] = useState(false);
  const [possibleDuplicates, setPossibleDuplicates] = useState<any[]>([]);
  const [schoolPatients, setSchoolPatients] = useState<any[]>([]);
  const [selectedPatientIds, setSelectedPatientIds] = useState<string[]>([]);
  const [patientFilter, setPatientFilter] = useState({ unitId: '', gradeLevel: '', className: '', shift: '' });
  const [patientLoading, setPatientLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [schoolForm, setSchoolForm] = useState({ displayName: '', legalName: '', schoolType: 'OTHER', educationNetwork: 'OTHER', taxId: '', inepCode: '', email: '', phone: '', whatsapp: '', postalCode: '', street: '', streetNumber: '', district: '', city: '', state: '', notes: '' });
  const [meetingForm, setMeetingForm] = useState({ title: 'Reunião escolar', meetingType: 'SCHOOL_MEETING', scheduledStart: '', scheduledEnd: '', status: 'DRAFT', locationType: 'SCHOOL', location: '', onlineMeetingUrl: '', agenda: '', responsibleProfessionalId: '' });

  const canManage = ['owner', 'admin', 'coordinator', 'receptionist'].includes(String(userRole).toLowerCase());

  const loadSchools = useCallback(async () => {
    setLoading(true); setError('');
    const result = await dataService.getSchools({ page, pageSize: 25, search, network, type: schoolType });
    if (result?.success) {
      setSchools(result.data || []);
      setPagination(result.pagination || { page, pageSize: 25, total: 0, totalPages: 1, hasNextPage: false });
    } else setError(result?.message || result?.error || 'Não foi possível carregar as escolas.');
    setLoading(false);
  }, [page, search, network, schoolType]);

  useEffect(() => { void loadSchools(); }, [loadSchools]);

  const openSchool = async (school: School) => {
    setDetailLoading(true); setSelectedSchool({ ...school }); setActiveDetailTab('summary');
    const result = await dataService.getSchoolDetail(school.id);
    if (result?.success) setSelectedSchool(result.data);
    else setError(result?.message || 'Não foi possível abrir a escola.');
    setDetailLoading(false);
  };

  const loadSchoolPatients = useCallback(async () => {
    if (!selectedSchool?.id) return;
    setPatientLoading(true);
    const result = await dataService.searchSchoolPatients({ schoolId: selectedSchool.id, ...patientFilter, page: 1, pageSize: 100 });
    setSchoolPatients(result?.success ? result.data || [] : []);
    setPatientLoading(false);
  }, [selectedSchool?.id, patientFilter]);

  useEffect(() => {
    if (selectedSchool?.id && (activeDetailTab === 'patients' || showMeeting)) void loadSchoolPatients();
  }, [selectedSchool?.id, activeDetailTab, showMeeting, loadSchoolPatients]);

  const submitSchool = async (confirmPossibleDuplicate = false) => {
    setSaving(true); setNotice('');
    const result = await dataService.createSchool({ ...schoolForm, confirmPossibleDuplicate, idempotencyKey: crypto.randomUUID() });
    if (result?.success) {
      setShowCreateSchool(false); setPossibleDuplicates([]); setSchoolForm({ displayName: '', legalName: '', schoolType: 'OTHER', educationNetwork: 'OTHER', taxId: '', inepCode: '', email: '', phone: '', whatsapp: '', postalCode: '', street: '', streetNumber: '', district: '', city: '', state: '', notes: '' });
      setNotice('Escola cadastrada com segurança.'); void loadSchools();
    } else if (result?.error === 'POSSIBLE_SCHOOL_DUPLICATE') setPossibleDuplicates(result.candidates || []);
    else setNotice(result?.message || 'Não foi possível cadastrar a escola.');
    setSaving(false);
  };

  const createMeeting = async () => {
    if (!selectedSchool?.id || selectedPatientIds.length === 0) return;
    setSaving(true); setNotice('');
    const result = await dataService.createSchoolMeetingBatch({
      ...meetingForm,
      schoolId: selectedSchool.id,
      schoolUnitId: patientFilter.unitId || null,
      patientIds: selectedPatientIds,
      timezone: 'America/Sao_Paulo',
      idempotencyKey: crypto.randomUUID(),
    });
    if (result?.success) {
      setShowMeeting(false); setSelectedPatientIds([]); setNotice(`Reunião criada para ${selectedPatientIds.length} paciente(s), sem duplicar o evento.`);
      const detail = await dataService.getSchoolDetail(selectedSchool.id); if (detail?.success) setSelectedSchool(detail.data);
    } else setNotice(result?.message || 'Não foi possível criar a reunião. Revise escola, unidade e autorizações.');
    setSaving(false);
  };

  const filteredPatientIds = useMemo(() => schoolPatients.map((row) => row.patient_id), [schoolPatients]);
  const allSelected = filteredPatientIds.length > 0 && filteredPatientIds.every((id) => selectedPatientIds.includes(id));

  return (
    <section className="space-y-5" data-school-management>
      <div className="rounded-[28px] border border-violet-100 bg-gradient-to-br from-violet-50 via-white to-cyan-50 p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-violet-700 shadow-sm"><GraduationCap size={15} /> Relacionamento escolar estruturado</div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Escolas</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">Instituições, unidades, vínculos históricos, autorizações, contatos, reuniões e visitas em uma única fonte de verdade.</p>
          </div>
          {canManage && <button type="button" onClick={() => setShowCreateSchool(true)} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/20"><Plus size={18} /> Nova escola</button>}
        </div>
      </div>

      {notice && <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm font-medium text-violet-800" role="status">{notice}</div>}
      {error && <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert">{error}</div>}

      <div className="rounded-[28px] border border-slate-100 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_220px_auto]">
          <label className="relative"><span className="sr-only">Buscar escola</span><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Buscar instituição, unidade ou cidade" className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-3 text-sm outline-none focus:border-violet-400" /></label>
          <select value={network} onChange={(e) => { setNetwork(e.target.value); setPage(1); }} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm"><option value="">Todas as redes</option>{Object.entries(NETWORK_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select value={schoolType} onChange={(e) => { setSchoolType(e.target.value); setPage(1); }} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm"><option value="">Todos os tipos</option>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <button type="button" onClick={() => { setSearch(''); setNetwork(''); setSchoolType(''); setPage(1); }} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600">Limpar</button>
        </div>
      </div>

      {loading ? <div className="flex min-h-64 items-center justify-center rounded-[28px] border border-slate-100 bg-white"><Loader2 className="animate-spin text-violet-600" size={28} /></div> : schools.length === 0 ? <div className="rounded-[28px] border border-dashed border-slate-200 bg-white p-12 text-center"><Building2 className="mx-auto mb-3 text-slate-300" size={42} /><h3 className="font-semibold text-slate-800">Nenhuma escola encontrada</h3><p className="mt-1 text-sm text-slate-500">Cadastre a primeira instituição ou ajuste os filtros.</p></div> : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {schools.map((school) => <button key={school.id} type="button" onClick={() => void openSchool(school)} className="rounded-[26px] border border-slate-100 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md focus:outline-none focus:ring-4 focus:ring-violet-100">
            <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 gap-3"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600"><Building2 size={23} /></div><div className="min-w-0"><h3 className="truncate text-base font-semibold text-slate-900">{school.display_name}</h3><p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><MapPin size={13} /> {[school.city, school.state].filter(Boolean).join(' / ') || 'Local não informado'}</p></div></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${school.is_active === false ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'}`}>{school.is_active === false ? 'Inativa' : 'Ativa'}</span></div>
            <div className="mt-5 grid grid-cols-3 gap-2"><div className="rounded-2xl bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-wide text-slate-400">Pacientes</p><p className="mt-1 text-lg font-semibold text-slate-900">{school.patientCount || 0}</p></div><div className="rounded-2xl bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-wide text-slate-400">Unidades</p><p className="mt-1 text-lg font-semibold text-slate-900">{school.units?.length || 0}</p></div><div className="rounded-2xl bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-wide text-slate-400">Contatos</p><p className="mt-1 text-lg font-semibold text-slate-900">{school.contacts?.length || 0}</p></div></div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-violet-50 px-3 py-1.5 text-violet-700">{NETWORK_LABELS[school.education_network || 'OTHER'] || 'Outra rede'}</span><span className="rounded-full bg-cyan-50 px-3 py-1.5 text-cyan-700">{TYPE_LABELS[school.school_type || 'OTHER'] || 'Outro tipo'}</span></div>
            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-xs"><span className="text-slate-500">Próxima reunião: <strong className="text-slate-700">{school.nextMeeting ? formatDateTime(school.nextMeeting.scheduled_start) : 'não agendada'}</strong></span><ChevronRight className="text-violet-500" size={18} /></div>
          </button>)}
        </div>
      )}

      <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-sm text-slate-600"><span>{pagination.total} escola(s)</span><div className="flex items-center gap-2"><button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-xl border border-slate-200 p-2 disabled:opacity-40" aria-label="Página anterior"><ChevronLeft size={17} /></button><span>Página {pagination.page} de {pagination.totalPages}</span><button disabled={!pagination.hasNextPage} onClick={() => setPage((value) => value + 1)} className="rounded-xl border border-slate-200 p-2 disabled:opacity-40" aria-label="Próxima página"><ChevronRight size={17} /></button></div></div>

      {showCreateSchool && <Modal title="Cadastrar escola" onClose={() => { setShowCreateSchool(false); setPossibleDuplicates([]); }} wide>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="md:col-span-2"><span className="mb-1 block text-xs font-semibold text-slate-600">Nome de exibição *</span><input value={schoolForm.displayName} onChange={(e) => setSchoolForm((f) => ({ ...f, displayName: e.target.value }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" maxLength={180} /></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Razão social</span><input value={schoolForm.legalName} onChange={(e) => setSchoolForm((f) => ({ ...f, legalName: e.target.value }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" /></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">CNPJ</span><input value={schoolForm.taxId} onChange={(e) => setSchoolForm((f) => ({ ...f, taxId: e.target.value }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" inputMode="numeric" /></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Tipo</span><select value={schoolForm.schoolType} onChange={(e) => setSchoolForm((f) => ({ ...f, schoolType: e.target.value }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3">{Object.entries(TYPE_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Rede</span><select value={schoolForm.educationNetwork} onChange={(e) => setSchoolForm((f) => ({ ...f, educationNetwork: e.target.value }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3">{Object.entries(NETWORK_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Código INEP</span><input value={schoolForm.inepCode} onChange={(e) => setSchoolForm((f) => ({ ...f, inepCode: e.target.value }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" /></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">E-mail</span><input type="email" value={schoolForm.email} onChange={(e) => setSchoolForm((f) => ({ ...f, email: e.target.value }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" /></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Telefone</span><input value={schoolForm.phone} onChange={(e) => setSchoolForm((f) => ({ ...f, phone: e.target.value }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" /></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">WhatsApp</span><input value={schoolForm.whatsapp} onChange={(e) => setSchoolForm((f) => ({ ...f, whatsapp: e.target.value }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" /></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Cidade</span><input value={schoolForm.city} onChange={(e) => setSchoolForm((f) => ({ ...f, city: e.target.value }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" /></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">UF</span><input value={schoolForm.state} onChange={(e) => setSchoolForm((f) => ({ ...f, state: e.target.value.toUpperCase().slice(0,2) }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" maxLength={2} /></label>
          <label className="md:col-span-2"><span className="mb-1 block text-xs font-semibold text-slate-600">Observações administrativas</span><textarea value={schoolForm.notes} onChange={(e) => setSchoolForm((f) => ({ ...f, notes: e.target.value }))} className="min-h-24 w-full rounded-2xl border border-slate-200 px-4 py-3" maxLength={4000} /></label>
        </div>
        {possibleDuplicates.length > 0 && <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-semibold text-amber-900">Possíveis cadastros equivalentes</h3><p className="mt-1 text-sm text-amber-800">Selecione um cadastro existente ou confirme que se trata de outra instituição.</p><div className="mt-3 space-y-2">{possibleDuplicates.map((candidate) => <button key={candidate.id} type="button" onClick={() => { setShowCreateSchool(false); void openSchool(candidate); }} className="block w-full rounded-xl bg-white p-3 text-left text-sm font-medium text-slate-700">{candidate.display_name} · {[candidate.city,candidate.state].filter(Boolean).join('/')}</button>)}</div></div>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setShowCreateSchool(false)} className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-600">Cancelar</button>{possibleDuplicates.length > 0 && <button type="button" onClick={() => void submitSchool(true)} className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-800">Confirmar nova instituição</button>}<button type="button" disabled={saving || !schoolForm.displayName.trim()} onClick={() => void submitSchool(false)} className="rounded-2xl bg-[#7a32fc] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Salvando…' : 'Verificar e cadastrar'}</button></div>
      </Modal>}

      {selectedSchool && <Modal title={selectedSchool.display_name || 'Escola'} onClose={() => { setSelectedSchool(null); setSelectedPatientIds([]); }} wide>
        {detailLoading ? <div className="flex min-h-72 items-center justify-center"><Loader2 className="animate-spin text-violet-600" size={28} /></div> : <>
          <div className="flex gap-2 overflow-x-auto pb-3">{([
            ['summary','Resumo',Building2],['patients','Pacientes',Users],['contacts','Contatos',Contact],['meetings','Reuniões e visitas',CalendarDays],['documents','Documentos',FileText],['history','Histórico',ClipboardList],
          ] as const).map(([id,label,Icon]) => <button key={id} type="button" onClick={() => setActiveDetailTab(id)} className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${activeDetailTab===id?'bg-violet-100 text-violet-700':'bg-slate-50 text-slate-600'}`}><Icon size={15} />{label}</button>)}</div>
          {activeDetailTab === 'summary' && <div className="grid grid-cols-1 gap-4 lg:grid-cols-3"><div className="rounded-2xl bg-slate-50 p-4 lg:col-span-2"><h3 className="font-semibold text-slate-900">Dados institucionais</h3><dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-400">Local</dt><dd className="font-medium text-slate-700">{[selectedSchool.city,selectedSchool.state].filter(Boolean).join(' / ') || 'Não informado'}</dd></div><div><dt className="text-xs text-slate-400">Rede</dt><dd className="font-medium text-slate-700">{NETWORK_LABELS[selectedSchool.education_network] || 'Outra'}</dd></div><div><dt className="text-xs text-slate-400">Tipo</dt><dd className="font-medium text-slate-700">{TYPE_LABELS[selectedSchool.school_type] || 'Outro'}</dd></div><div><dt className="text-xs text-slate-400">Contatos ativos</dt><dd className="font-medium text-slate-700">{selectedSchool.contacts?.filter((c:any)=>c.is_active).length || 0}</dd></div></dl></div><div className="rounded-2xl border border-violet-100 bg-violet-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-violet-500">Pacientes atuais</p><p className="mt-2 text-3xl font-semibold text-violet-900">{new Set((selectedSchool.enrollments||[]).filter((e:any)=>e.is_current).map((e:any)=>e.patient_id)).size}</p><button type="button" onClick={() => setActiveDetailTab('patients')} className="mt-4 text-sm font-semibold text-violet-700">Abrir vínculos →</button></div></div>}
          {activeDetailTab === 'patients' && <div className="space-y-4"><div className="grid grid-cols-1 gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-4"><select value={patientFilter.unitId} onChange={(e)=>setPatientFilter((f)=>({...f,unitId:e.target.value}))} className="rounded-xl border border-slate-200 bg-white p-3 text-sm"><option value="">Todas as unidades</option>{(selectedSchool.units||[]).map((u:any)=><option key={u.id} value={u.id}>{u.name}</option>)}</select><input placeholder="Série/ano" value={patientFilter.gradeLevel} onChange={(e)=>setPatientFilter((f)=>({...f,gradeLevel:e.target.value}))} className="rounded-xl border border-slate-200 p-3 text-sm" /><input placeholder="Turma" value={patientFilter.className} onChange={(e)=>setPatientFilter((f)=>({...f,className:e.target.value}))} className="rounded-xl border border-slate-200 p-3 text-sm" /><select value={patientFilter.shift} onChange={(e)=>setPatientFilter((f)=>({...f,shift:e.target.value}))} className="rounded-xl border border-slate-200 bg-white p-3 text-sm"><option value="">Todos os turnos</option><option value="MORNING">Manhã</option><option value="AFTERNOON">Tarde</option><option value="EVENING">Noite</option><option value="FULL_TIME">Integral</option></select></div>
            <div className="flex flex-wrap items-center justify-between gap-3"><label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={allSelected} onChange={() => setSelectedPatientIds(allSelected ? [] : filteredPatientIds)} className="h-4 w-4 rounded" /> Selecionar resultados</label><button type="button" disabled={selectedPatientIds.length===0} onClick={()=>setShowMeeting(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#7a32fc] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"><CalendarDays size={17}/> Criar reunião escolar ({selectedPatientIds.length})</button></div>
            {patientLoading ? <div className="py-12 text-center"><Loader2 className="mx-auto animate-spin text-violet-600" /></div> : <div className="space-y-2">{schoolPatients.map((row:any)=><label key={row.id} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-100 p-4 hover:bg-slate-50"><input type="checkbox" checked={selectedPatientIds.includes(row.patient_id)} onChange={()=>setSelectedPatientIds((ids)=>ids.includes(row.patient_id)?ids.filter((id)=>id!==row.patient_id):[...ids,row.patient_id])} className="h-4 w-4 rounded"/><div className="min-w-0 flex-1"><p className="truncate font-semibold text-slate-900">{row.patient?.name || 'Paciente'}</p><p className="text-xs text-slate-500">{[row.school_units?.name,row.grade_level,row.class_name,row.shift].filter(Boolean).join(' · ') || 'Vínculo sem detalhes de turma'}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${(row.consents||[]).some((c:any)=>c.status==='AUTHORIZED')?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}`}>{(row.consents||[]).some((c:any)=>c.status==='AUTHORIZED')?'Autorização registrada':'Revisar autorização'}</span></label>)}</div>}
          </div>}
          {activeDetailTab === 'contacts' && <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{(selectedSchool.contacts||[]).length ? selectedSchool.contacts.map((contact:any)=><div key={contact.id} className="rounded-2xl border border-slate-100 p-4"><div className="flex items-start justify-between"><div><p className="font-semibold text-slate-900">{contact.name}</p><p className="text-xs text-slate-500">{contact.role}</p></div>{contact.is_primary&&<span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700">Principal</span>}</div><div className="mt-3 space-y-1 text-sm text-slate-600"><p>{contact.email||'E-mail não informado'}</p><p>{contact.whatsapp||contact.phone||'Telefone não informado'}</p></div></div>):<div className="md:col-span-2 rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">Nenhum contato cadastrado.</div>}</div>}
          {activeDetailTab === 'meetings' && <div className="space-y-3"><div className="flex justify-end"><button type="button" onClick={()=>{setActiveDetailTab('patients');setShowMeeting(true)}} className="inline-flex items-center gap-2 rounded-xl bg-[#7a32fc] px-4 py-2.5 text-sm font-semibold text-white"><Plus size={16}/> Nova reunião em lote</button></div>{(selectedSchool.meetings||[]).map((meeting:any)=><div key={meeting.id} className="rounded-2xl border border-slate-100 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold text-slate-900">{meeting.title}</p><p className="mt-1 text-xs text-slate-500">{MEETING_TYPE_LABELS[meeting.meeting_type]||meeting.meeting_type} · {formatDateTime(meeting.scheduled_start)}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">{STATUS_LABELS[meeting.status]||meeting.status}</span></div></div>)}</div>}
          {activeDetailTab === 'documents' && <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center"><FileText className="mx-auto text-slate-300" size={36}/><p className="mt-3 font-semibold text-slate-700">Documentos vinculados</p><p className="mt-1 text-sm text-slate-500">Os vínculos reutilizam o documento canônico e preservam a visibilidade por escola, reunião ou paciente.</p></div>}
          {activeDetailTab === 'history' && <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center"><ClipboardList className="mx-auto text-slate-300" size={36}/><p className="mt-3 font-semibold text-slate-700">Histórico auditável</p><p className="mt-1 text-sm text-slate-500">Criações, alterações, vínculos, reuniões, atas e compartilhamentos são registrados de forma append-only.</p></div>}
          {canManage && <div className="mt-6 flex justify-end border-t border-slate-100 pt-4"><button type="button" onClick={async()=>{if(!confirm('Arquivar esta escola? O histórico será preservado.'))return; const result=await dataService.updateSchool(selectedSchool.id,{archive:true,reason:'Arquivamento administrativo'});if(result?.success){setSelectedSchool(null);setNotice('Escola arquivada sem apagar o histórico.');void loadSchools();}}} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"><Archive size={16}/> Arquivar escola</button></div>}
        </>}
      </Modal>}

      {showMeeting && selectedSchool && <Modal title="Criar reunião escolar em lote" onClose={()=>setShowMeeting(false)} wide>
        <div className="mb-5 rounded-2xl border border-violet-100 bg-violet-50 p-4"><p className="font-semibold text-violet-900">{selectedSchool.display_name}</p><p className="mt-1 text-sm text-violet-700">{selectedPatientIds.length} paciente(s) selecionado(s). Será criada uma única reunião, com notas individuais isoladas por paciente.</p></div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><label className="md:col-span-2"><span className="mb-1 block text-xs font-semibold text-slate-600">Título</span><input value={meetingForm.title} onChange={(e)=>setMeetingForm((f)=>({...f,title:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"/></label><label><span className="mb-1 block text-xs font-semibold text-slate-600">Tipo</span><select value={meetingForm.meetingType} onChange={(e)=>setMeetingForm((f)=>({...f,meetingType:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3">{Object.entries(MEETING_TYPE_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label><span className="mb-1 block text-xs font-semibold text-slate-600">Responsável interno</span><select value={meetingForm.responsibleProfessionalId} onChange={(e)=>setMeetingForm((f)=>({...f,responsibleProfessionalId:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"><option value="">Selecionar</option>{professionals.map((p:any)=><option key={p.id} value={p.id}>{p.name||p.email}</option>)}</select></label><label><span className="mb-1 block text-xs font-semibold text-slate-600">Início</span><input type="datetime-local" value={meetingForm.scheduledStart} onChange={(e)=>setMeetingForm((f)=>({...f,scheduledStart:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"/></label><label><span className="mb-1 block text-xs font-semibold text-slate-600">Término</span><input type="datetime-local" value={meetingForm.scheduledEnd} onChange={(e)=>setMeetingForm((f)=>({...f,scheduledEnd:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"/></label><label><span className="mb-1 block text-xs font-semibold text-slate-600">Local</span><input value={meetingForm.location} onChange={(e)=>setMeetingForm((f)=>({...f,location:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" placeholder="Escola, clínica ou endereço"/></label><label><span className="mb-1 block text-xs font-semibold text-slate-600">Status inicial</span><select value={meetingForm.status} onChange={(e)=>setMeetingForm((f)=>({...f,status:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"><option value="DRAFT">Salvar rascunho</option><option value="SCHEDULED">Agendar</option></select></label><label className="md:col-span-2"><span className="mb-1 block text-xs font-semibold text-slate-600">Pauta geral</span><textarea value={meetingForm.agenda} onChange={(e)=>setMeetingForm((f)=>({...f,agenda:e.target.value}))} className="min-h-28 w-full rounded-2xl border border-slate-200 px-4 py-3" maxLength={10000}/><p className="mt-1 text-xs text-slate-400">Não inclua observações clínicas individuais aqui. Elas serão registradas separadamente por paciente.</p></label></div>
        <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800"><div className="flex gap-2"><ShieldCheck className="shrink-0" size={19}/><p>As autorizações são validadas e congeladas como snapshot na inclusão. Conteúdo clínico não será enviado em convites externos.</p></div></div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={()=>setShowMeeting(false)} className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-600">Cancelar</button><button type="button" disabled={saving||selectedPatientIds.length===0||!meetingForm.title.trim()} onClick={()=>void createMeeting()} className="rounded-2xl bg-[#7a32fc] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving?'Criando…':meetingForm.status==='DRAFT'?'Salvar rascunho':'Agendar reunião'}</button></div>
      </Modal>}
    </section>
  );
}
