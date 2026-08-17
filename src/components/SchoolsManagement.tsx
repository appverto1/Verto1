import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Contact,
  ExternalLink,
  FileText,
  Filter,
  GraduationCap,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Unlink,
  Users,
  X,
} from 'lucide-react';
import { dataService } from '../services/dataService';
import { SchoolEnrollmentDialog } from './SchoolEnrollmentDialog';
import { SchoolMeetingWorkspace } from './SchoolMeetingWorkspace';

const notifySchoolOptionsChanged = () => {
  window.dispatchEvent(new Event('verto:school-options-changed'));
};

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

const ENROLLMENT_TYPE_LABELS: Record<string, string> = {
  PRIMARY_SCHOOL: 'Escola principal',
  SECONDARY_SCHOOL: 'Escola secundária',
  SUPPORT_INSTITUTION: 'Instituição de apoio',
  HOME_EDUCATION: 'Educação domiciliar',
  COURSE: 'Curso',
  OTHER: 'Outro vínculo',
};

const SHIFT_LABELS: Record<string, string> = {
  MORNING: 'Manhã',
  AFTERNOON: 'Tarde',
  EVENING: 'Noite',
  FULL_TIME: 'Integral',
  OTHER: 'Outro turno',
};

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Não informada';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Não informada';
  return parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const formatDateOnly = (value?: string | null) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
};


const formatSchoolAddress = (record: any) => {
  const streetLine = [
    String(record?.street || '').trim(),
    String(record?.street_number || record?.streetNumber || '').trim(),
  ].filter(Boolean).join(', ');
  return [
    streetLine,
    String(record?.address_complement || record?.addressComplement || '').trim(),
    String(record?.district || '').trim(),
    [String(record?.city || '').trim(), String(record?.state || '').trim()].filter(Boolean).join('/'),
    String(record?.postal_code || record?.postalCode || '').trim()
      ? `CEP ${String(record?.postal_code || record?.postalCode || '').trim()}`
      : '',
  ].filter(Boolean).join(' · ');
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

export function SchoolsManagement({
  workspaceScopeKey = '',
  patients = [],
  professionals = [],
  userRole = 'coordinator',
  capabilities,
  onOpenPatient,
  onScheduleSchoolSession,
}: {
  workspaceScopeKey?: string;
  patients?: any[];
  professionals?: any[];
  userRole?: string;
  capabilities?: any;
  onOpenPatient?: (patientId: string, patientName?: string) => void;
  onScheduleSchoolSession?: (enrollment: any) => void;
}) {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [network, setNetwork] = useState('');
  const [schoolType, setSchoolType] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1, hasNextPage: false });
  const [selectedSchool, setSelectedSchool] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSectionLoading, setDetailSectionLoading] = useState('');
  const loadedDetailSectionsRef = useRef(new Set<string>());
  const detailSectionRequestsRef = useRef(new Map<string, Promise<void>>());
  const [activeDetailTab, setActiveDetailTab] = useState<'summary' | 'patients' | 'contacts' | 'meetings' | 'documents' | 'history'>('summary');
  const [showCreateSchool, setShowCreateSchool] = useState(false);
  const [showMeeting, setShowMeeting] = useState(false);
  const [possibleDuplicates, setPossibleDuplicates] = useState<any[]>([]);
  const [schoolPatients, setSchoolPatients] = useState<any[]>([]);
  const [selectedPatientIds, setSelectedPatientIds] = useState<string[]>([]);
  const [patientFilter, setPatientFilter] = useState({ unitId: '', gradeLevel: '', className: '', shift: '' });
  const [debouncedPatientFilter, setDebouncedPatientFilter] = useState(patientFilter);
  const [patientLoading, setPatientLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [selectedMeetingId, setSelectedMeetingId] = useState('');
  const [showUnitForm, setShowUnitForm] = useState(false);
  const [showEditSchool, setShowEditSchool] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [editingUnit, setEditingUnit] = useState<any>(null);
  const [editingContact, setEditingContact] = useState<any>(null);
  const [unitForm, setUnitForm] = useState({ name: '', code: '', postalCode: '', street: '', streetNumber: '', addressComplement: '', district: '', city: '', state: '', phone: '', isActive: true, reason: '' });
  const [contactForm, setContactForm] = useState({ name: '', role: 'OTHER', schoolUnitId: '', email: '', phone: '', whatsapp: '', isPrimary: false, isActive: true, reason: '' });
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRows, setReviewRows] = useState<any[]>([]);
  const [reviewCounts, setReviewCounts] = useState<Record<string,number>>({});
  const [reviewLoading, setReviewLoading] = useState(false);
  const [pendingReviewForNewSchool, setPendingReviewForNewSchool] = useState<any>(null);
  const [enrollmentDialog, setEnrollmentDialog] = useState<any | null | undefined>(undefined);
  const [endingEnrollment, setEndingEnrollment] = useState<any | null>(null);
  const [endingReason, setEndingReason] = useState('');
  const [endingIdempotencyKey, setEndingIdempotencyKey] = useState('');
  const [schoolForm, setSchoolForm] = useState({ displayName: '', legalName: '', schoolType: 'OTHER', educationNetwork: 'OTHER', taxId: '', inepCode: '', email: '', phone: '', whatsapp: '', postalCode: '', street: '', streetNumber: '', addressComplement: '', district: '', city: '', state: '', notes: '' });
  const [schoolEditForm, setSchoolEditForm] = useState({ displayName: '', legalName: '', schoolType: 'OTHER', educationNetwork: 'OTHER', taxId: '', inepCode: '', email: '', phone: '', whatsapp: '', postalCode: '', street: '', streetNumber: '', addressComplement: '', district: '', city: '', state: '', notes: '' });
  const [meetingForm, setMeetingForm] = useState({ title: 'Reunião escolar', meetingType: 'SCHOOL_MEETING', scheduledStart: '', scheduledEnd: '', status: 'DRAFT', locationType: 'SCHOOL', location: '', onlineMeetingUrl: '', agenda: '', responsibleProfessionalId: '' });

  const hasCapability = useCallback((capability: string) => {
    if (capabilities instanceof Set) return capabilities.has(capability);
    if (Array.isArray(capabilities)) return capabilities.includes(capability);
    if (capabilities && typeof capabilities.has === 'function') return capabilities.has(capability);
    return false;
  }, [capabilities]);
  const canManage = hasCapability('school.manage');
  const canManageMeetings = hasCapability('school.meetings.manage');

  useEffect(() => {
    loadedDetailSectionsRef.current.clear();
    detailSectionRequestsRef.current.clear();
    setSchools([]);
    setSelectedSchool(null);
    setSelectedMeetingId('');
    setSchoolPatients([]);
    setSelectedPatientIds([]);
    setError('');
    setPage(1);
  }, [workspaceScopeKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedPatientFilter(patientFilter), 300);
    return () => window.clearTimeout(timer);
  }, [patientFilter]);

  const loadSchools = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try {
      const result = await dataService.getSchools({ page, pageSize: 25, search: debouncedSearch, network, type: schoolType }, { signal });
      if (signal?.aborted) return;
      if (result?.success) {
        setSchools(result.data || []);
        setPagination(result.pagination || { page, pageSize: 25, total: 0, totalPages: 1, hasNextPage: false });
      } else setError(result?.message || result?.error || 'Não foi possível carregar as escolas.');
    } catch (requestError: any) {
      if (!signal?.aborted) setError(requestError?.message || 'Não foi possível carregar as escolas.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, debouncedSearch, network, schoolType]);

  useEffect(() => {
    const controller = new AbortController();
    void loadSchools(controller.signal);
    return () => controller.abort();
  }, [loadSchools]);

  const openSchool = async (school: School) => {
    loadedDetailSectionsRef.current.clear();
    detailSectionRequestsRef.current.clear();
    setDetailSectionLoading('');
    setDetailLoading(true); setSelectedSchool({ ...school }); setActiveDetailTab('summary');
    const result = await dataService.getSchoolDetail(school.id, { section: 'summary' });
    if (result?.success) {
      loadedDetailSectionsRef.current.add(`${school.id}:summary`);
      setSelectedSchool((current: any) => String(current?.id) === String(school.id) ? { ...current, ...result.data } : current);
    }
    else setError(result?.message || 'Não foi possível abrir a escola.');
    setDetailLoading(false);
  };

  const loadSchoolDetailSection = useCallback((section: 'meetings' | 'documents' | 'history', force = false) => {
    const schoolId = String(selectedSchool?.id || '');
    if (!schoolId) return Promise.resolve();
    const key = `${schoolId}:${section}`;
    if (!force && loadedDetailSectionsRef.current.has(key)) return Promise.resolve();
    const inFlight = detailSectionRequestsRef.current.get(key);
    if (!force && inFlight) return inFlight;

    setDetailSectionLoading(section);
    let request!: Promise<void>;
    request = (async () => {
      try {
        const result = section === 'meetings'
          ? await dataService.getSchoolMeetings({ schoolId, page: 1, pageSize: 100 })
          : section === 'documents'
            ? await dataService.getSchoolDocuments({ schoolId })
            : await dataService.getSchoolDetail(schoolId, { section: 'audit' });
        if (!result?.success) throw new Error(result?.message || result?.error || 'Não foi possível carregar esta seção.');
        const sectionPatch = section === 'history'
          ? { audit: result.data?.audit || [] }
          : { [section]: result.data || [] };
        setSelectedSchool((current: any) => String(current?.id) === schoolId ? { ...current, ...sectionPatch } : current);
        loadedDetailSectionsRef.current.add(key);
      } catch (requestError: any) {
        setError(requestError?.message || 'Não foi possível carregar esta seção.');
      } finally {
        if (detailSectionRequestsRef.current.get(key) === request) {
          detailSectionRequestsRef.current.delete(key);
          setDetailSectionLoading((current) => current === section ? '' : current);
        }
      }
    })();
    detailSectionRequestsRef.current.set(key, request);
    return request;
  }, [selectedSchool?.id]);

  useEffect(() => {
    if (activeDetailTab === 'meetings' || activeDetailTab === 'documents' || activeDetailTab === 'history') {
      void loadSchoolDetailSection(activeDetailTab);
    }
  }, [activeDetailTab, loadSchoolDetailSection]);

  const loadSchoolPatients = useCallback(async (signal?: AbortSignal) => {
    if (!selectedSchool?.id) return;
    setPatientLoading(true);
    setSchoolPatients([]);
    try {
      const result = await dataService.searchSchoolPatients({ schoolId: selectedSchool.id, ...debouncedPatientFilter, page: 1, pageSize: 100 }, { signal });
      if (signal?.aborted) return;
      if (!result?.success) throw new Error(result?.message || result?.error || 'Não foi possível carregar os pacientes desta escola.');
      setSchoolPatients(result.data || []);
      if (!debouncedPatientFilter.unitId && !debouncedPatientFilter.gradeLevel && !debouncedPatientFilter.className && !debouncedPatientFilter.shift) {
        const total = Number(result.pagination?.total ?? result.data?.length ?? 0);
        setSelectedSchool((current: any) => current ? { ...current, patientCount: Math.max(0, total) } : current);
      }
    } catch (requestError: any) {
      if (!signal?.aborted) setError(requestError?.message || 'Não foi possível carregar os pacientes desta escola.');
    } finally {
      if (!signal?.aborted) setPatientLoading(false);
    }
  }, [selectedSchool?.id, debouncedPatientFilter]);

  useEffect(() => {
    if (!selectedSchool?.id || (activeDetailTab !== 'patients' && !showMeeting)) return;
    const controller = new AbortController();
    void loadSchoolPatients(controller.signal);
    return () => controller.abort();
  }, [selectedSchool?.id, activeDetailTab, showMeeting, loadSchoolPatients]);

  const submitSchool = async (confirmPossibleDuplicate = false) => {
    setSaving(true); setNotice('');
    const result = await dataService.createSchool({ ...schoolForm, confirmPossibleDuplicate, idempotencyKey: crypto.randomUUID() });
    if (result?.success) {
      const createdSchoolId = String(result.data?.id || '');
      if (pendingReviewForNewSchool?.id && createdSchoolId) {
        const reviewResult = await dataService.resolveSchoolMigrationReview({
          queueIds: [pendingReviewForNewSchool.id], action: 'ASSOCIATE', schoolId: createdSchoolId,
          reason: 'Nova escola criada durante a revisão do campo legado.', idempotencyKey: crypto.randomUUID(),
        });
        if (reviewResult?.success) {
          setNotice('Escola criada e item legado associado com histórico preservado.');
          await loadReviewQueue();
        } else setNotice('A escola foi criada, mas o item legado permaneceu pendente para revisão manual.');
      } else setNotice('Escola cadastrada com segurança.');
      setPendingReviewForNewSchool(null);
      setShowCreateSchool(false); setPossibleDuplicates([]); setSchoolForm({ displayName: '', legalName: '', schoolType: 'OTHER', educationNetwork: 'OTHER', taxId: '', inepCode: '', email: '', phone: '', whatsapp: '', postalCode: '', street: '', streetNumber: '', addressComplement: '', district: '', city: '', state: '', notes: '' });
      notifySchoolOptionsChanged();
      void loadSchools();
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
      await loadSchoolDetailSection('meetings', true);
    } else setNotice(result?.message || 'Não foi possível criar a reunião. Revise escola, unidade e autorizações.');
    setSaving(false);
  };

  const filteredPatientIds = useMemo(() => schoolPatients.map((row) => row.patient_id), [schoolPatients]);
  const refreshSelectedSchool = async () => {
    if (!selectedSchool?.id) return;
    const result = await dataService.getSchoolDetail(selectedSchool.id, { section: 'summary' });
    if (result?.success) {
      setSelectedSchool((current: any) => current ? { ...current, ...result.data } : current);
      if (activeDetailTab === 'meetings' || activeDetailTab === 'documents' || activeDetailTab === 'history') {
        await loadSchoolDetailSection(activeDetailTab, true);
      }
    }
  };

  const endSchoolEnrollment = async () => {
    if (!endingEnrollment?.patient_id || !endingEnrollment?.id || !endingReason.trim()) return;
    setSaving(true);
    setNotice('');
    const result = await dataService.endPatientSchoolEnrollment(endingEnrollment.patient_id, endingEnrollment.id, {
      reason: endingReason.trim(),
      idempotencyKey: endingIdempotencyKey,
    });
    if (result?.success) {
      setNotice('Vínculo encerrado sem apagar o histórico escolar.');
      setEndingEnrollment(null);
      setEndingReason('');
      await Promise.all([refreshSelectedSchool(), loadSchoolPatients()]);
    } else {
      setNotice(result?.message || 'Não foi possível encerrar o vínculo escolar.');
    }
    setSaving(false);
  };

  const openSchoolDocument = async (link: any) => {
    if (!link?.patient_id) {
      setNotice('Este vínculo documental não possui paciente canônico para gerar acesso seguro.');
      return;
    }
    const result = await dataService.accessPatientFile(String(link.patient_id), String(link.document_id), 'view');
    const file = result?.success ? result.data : null;
    if (file?.signedUrl) window.open(file.signedUrl, '_blank', 'noopener,noreferrer');
    else setNotice('Não foi possível gerar um acesso seguro ao documento.');
  };

  const archiveSchoolDocument = async (link: any) => {
    if (!canManage || !link?.id || !confirm('Arquivar este vínculo documental? O arquivo original e o histórico serão preservados.')) return;
    const result = await dataService.updateSchoolDocumentLink(String(link.id), {
      archive: true,
      reason: 'Arquivado no cadastro da escola',
      idempotencyKey: crypto.randomUUID(),
    });
    if (result?.success) {
      setNotice('Vínculo documental arquivado sem apagar o arquivo original.');
      await refreshSelectedSchool();
    } else setNotice(result?.message || 'Não foi possível arquivar o vínculo documental.');
  };

  const openSchoolEditor = () => {
    if (!selectedSchool?.id) return;
    setSchoolEditForm({
      displayName: selectedSchool.display_name || '',
      legalName: selectedSchool.legal_name || '',
      schoolType: selectedSchool.school_type || 'OTHER',
      educationNetwork: selectedSchool.education_network || 'OTHER',
      taxId: selectedSchool.tax_id || '',
      inepCode: selectedSchool.inep_code || '',
      email: selectedSchool.email || '',
      phone: selectedSchool.phone || '',
      whatsapp: selectedSchool.whatsapp || '',
      postalCode: selectedSchool.postal_code || '',
      street: selectedSchool.street || '',
      streetNumber: selectedSchool.street_number || '',
      addressComplement: selectedSchool.address_complement || '',
      district: selectedSchool.district || '',
      city: selectedSchool.city || '',
      state: selectedSchool.state || '',
      notes: selectedSchool.notes || '',
    });
    setShowEditSchool(true);
  };

  const saveSchoolDetails = async () => {
    if (!selectedSchool?.id || !schoolEditForm.displayName.trim()) return;
    setSaving(true);
    setNotice('');
    const result = await dataService.updateSchool(selectedSchool.id, {
      ...schoolEditForm,
      reason: 'Atualização dos dados institucionais e do endereço',
      idempotencyKey: crypto.randomUUID(),
    });
    if (result?.success) {
      setShowEditSchool(false);
      setNotice('Dados e endereço da escola atualizados. Novos agendamentos usarão o endereço atual; sessões já salvas mantêm o snapshot histórico.');
      notifySchoolOptionsChanged();
      await Promise.all([refreshSelectedSchool(), loadSchools()]);
    } else {
      setNotice(result?.message || result?.error || 'Não foi possível atualizar os dados da escola.');
    }
    setSaving(false);
  };

  const saveUnit = async () => {
    if (!selectedSchool?.id || !unitForm.name.trim()) return;
    setSaving(true);
    const payload = { ...unitForm, idempotencyKey: crypto.randomUUID() };
    const result = editingUnit ? await dataService.updateSchoolUnit(selectedSchool.id, editingUnit.id, payload) : await dataService.createSchoolUnit(selectedSchool.id, payload);
    if (result?.success) { setShowUnitForm(false); setEditingUnit(null); setUnitForm({ name: '', code: '', postalCode: '', street: '', streetNumber: '', addressComplement: '', district: '', city: '', state: '', phone: '', isActive: true, reason: '' }); setNotice('Unidade e endereço salvos sem perder o histórico.'); notifySchoolOptionsChanged(); await refreshSelectedSchool(); } else setNotice(result?.message || 'Não foi possível salvar a unidade.');
    setSaving(false);
  };

  const saveContact = async () => {
    if (!selectedSchool?.id || !contactForm.name.trim()) return;
    setSaving(true);
    const payload = { ...contactForm, idempotencyKey: crypto.randomUUID() };
    const result = editingContact ? await dataService.updateSchoolContact(selectedSchool.id, editingContact.id, payload) : await dataService.createSchoolContact(selectedSchool.id, payload);
    if (result?.success) { setShowContactForm(false); setEditingContact(null); setContactForm({ name: '', role: 'OTHER', schoolUnitId: '', email: '', phone: '', whatsapp: '', isPrimary: false, isActive: true, reason: '' }); setNotice('Contato salvo e histórico preservado.'); await refreshSelectedSchool(); } else setNotice(result?.message || 'Não foi possível salvar o contato.');
    setSaving(false);
  };

  const loadReviewQueue = async () => {
    setReviewLoading(true);
    const result = await dataService.getSchoolMigrationReview({ page: 1, pageSize: 100 });
    if (result?.success) { setReviewRows(result.data || []); setReviewCounts(result.counts || {}); }
    setReviewLoading(false);
  };

  const resolveReview = async (row: any, action: string, schoolId?: string) => {
    const result = await dataService.resolveSchoolMigrationReview({ queueIds: [row.id], action, schoolId: schoolId || null, reason: `Revisão manual: ${action}`, idempotencyKey: crypto.randomUUID() });
    if (result?.success) await loadReviewQueue(); else setNotice(result?.message || 'Não foi possível processar a revisão.');
  };

  const startSchoolFromReview = (row: any) => {
    setPendingReviewForNewSchool(row);
    setSchoolForm((current) => ({ ...current, displayName: String(row.original_value || '').trim(), notes: `Cadastro iniciado pela revisão do campo legado ${row.source_field || 'escola'}.` }));
    setPossibleDuplicates([]); setReviewOpen(false); setShowCreateSchool(true);
  };

  const allSelected = filteredPatientIds.length > 0 && filteredPatientIds.every((id) => selectedPatientIds.includes(id));
  const hasActiveFilters = Boolean(search.trim() || network || schoolType);
  const totalInstitutionsLabel = `${pagination.total} ${pagination.total === 1 ? 'instituição' : 'instituições'}`;

  return (
    <section className="space-y-4" data-school-management>
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-medium text-violet-700"><GraduationCap size={15} aria-hidden="true" /> Relacionamento escolar</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">Instituições vinculadas</h2>
            <p className="mt-1 max-w-2xl text-sm font-normal leading-6 text-slate-500">Centralize unidades, contatos, vínculos, autorizações e reuniões.</p>
          </div>
          {canManage && <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"><button type="button" onClick={()=>{setReviewOpen(true);void loadReviewQueue();}} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-violet-200"><ClipboardList size={17} aria-hidden="true"/> Revisar cadastros</button><button type="button" onClick={() => setShowCreateSchool(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:ring-offset-2"><Plus size={17} aria-hidden="true" /> Nova instituição</button></div>}
        </div>
      </div>

      {notice && <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-normal text-violet-800" role="status">{notice}</div>}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-normal text-rose-700" role="alert">{error}</div>}

      <div className="rounded-2xl border border-slate-200/80 bg-white p-2 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(260px,1fr)_190px_190px_auto]">
          <label className="relative"><span className="sr-only">Buscar instituição</span><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} aria-hidden="true"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome, unidade ou cidade" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2.5 pl-10 pr-3 text-sm text-slate-800 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100" /></label>
          <label><span className="sr-only">Filtrar por rede</span><select aria-label="Filtrar por rede" value={network} onChange={(e) => { setNetwork(e.target.value); setPage(1); }} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 text-sm text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"><option value="">Todas as redes</option>{Object.entries(NETWORK_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span className="sr-only">Filtrar por tipo</span><select aria-label="Filtrar por tipo" value={schoolType} onChange={(e) => { setSchoolType(e.target.value); setPage(1); }} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 text-sm text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"><option value="">Todos os tipos</option>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <button type="button" disabled={!hasActiveFilters} onClick={() => { setSearch(''); setDebouncedSearch(''); setNetwork(''); setSchoolType(''); setPage(1); }} className="min-h-11 rounded-xl border border-transparent px-4 text-sm font-medium text-slate-600 transition hover:border-slate-200 hover:bg-slate-50 disabled:cursor-default disabled:opacity-40">Limpar filtros</button>
        </div>
      </div>

      {loading ? <div className="flex min-h-56 items-center justify-center rounded-2xl border border-slate-200/80 bg-white" role="status" aria-label="Carregando instituições"><Loader2 className="animate-spin text-violet-600" size={24} /></div> : schools.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 text-slate-400"><Building2 size={21} aria-hidden="true"/></div><h3 className="mt-3 text-sm font-medium text-slate-800">Nenhuma instituição encontrada</h3><p className="mt-1 text-sm text-slate-500">{hasActiveFilters ? 'Ajuste ou limpe os filtros para ampliar a busca.' : 'Cadastre a primeira instituição para começar.'}</p></div> : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {schools.map((school) => <button key={school.id} type="button" onClick={() => void openSchool(school)} className="group rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition duration-200 hover:-translate-y-px hover:border-violet-200 hover:shadow-[0_10px_25px_rgba(76,29,149,0.08)] focus:outline-none focus:ring-2 focus:ring-violet-300 focus:ring-offset-2 sm:p-5">
            <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-100 bg-violet-50/70 text-violet-600"><Building2 size={19} aria-hidden="true"/></div><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-slate-900 sm:text-base">{school.display_name}</h3><p className="mt-1 flex items-center gap-1 text-xs font-normal text-slate-500"><MapPin size={12} aria-hidden="true"/> {[school.city, school.state].filter(Boolean).join(' / ') || 'Local não informado'}</p></div></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium ${school.is_active === false ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>{school.is_active === false ? 'Inativa' : 'Ativa'}</span></div>
            <dl className="mt-4 grid grid-cols-3 divide-x divide-slate-200 rounded-xl border border-slate-200/70 bg-slate-50/60 py-3"><div className="px-3"><dt className="text-[10px] font-normal text-slate-500">Pacientes</dt><dd className="mt-0.5 text-base font-semibold text-slate-900">{school.patientCount || 0}</dd></div><div className="px-3"><dt className="text-[10px] font-normal text-slate-500">Unidades</dt><dd className="mt-0.5 text-base font-semibold text-slate-900">{school.units?.length || 0}</dd></div><div className="px-3"><dt className="text-[10px] font-normal text-slate-500">Contatos</dt><dd className="mt-0.5 text-base font-semibold text-slate-900">{school.contacts?.length || 0}</dd></div></dl>
            <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full border border-violet-100 bg-violet-50/60 px-2.5 py-1 text-violet-700">{NETWORK_LABELS[school.education_network || 'OTHER'] || 'Outra rede'}</span><span className="rounded-full border border-cyan-100 bg-cyan-50/60 px-2.5 py-1 text-cyan-700">{TYPE_LABELS[school.school_type || 'OTHER'] || 'Outro tipo'}</span></div>
            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs"><span className="text-slate-500">Próxima reunião <strong className="ml-1 font-medium text-slate-700">{school.nextMeeting ? formatDateTime(school.nextMeeting.scheduled_start) : 'Não agendada'}</strong></span><ChevronRight className="text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-violet-600" size={17} aria-hidden="true"/></div>
          </button>)}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span>{totalInstitutionsLabel}</span><nav className="flex items-center justify-between gap-2 sm:justify-end" aria-label="Paginação das instituições"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:opacity-40" aria-label="Página anterior"><ChevronLeft size={16} /></button><span className="px-1 text-xs">Página {pagination.page} de {pagination.totalPages}</span><button type="button" disabled={!pagination.hasNextPage} onClick={() => setPage((value) => value + 1)} className="flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:opacity-40" aria-label="Próxima página"><ChevronRight size={16} /></button></nav></div>

      {showCreateSchool && <Modal title={pendingReviewForNewSchool ? 'Criar escola para item legado' : 'Cadastrar escola'} onClose={() => { setShowCreateSchool(false); setPossibleDuplicates([]); setPendingReviewForNewSchool(null); }} wide>
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
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">CEP</span><input value={schoolForm.postalCode} onChange={(e) => setSchoolForm((f) => ({ ...f, postalCode: e.target.value }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" inputMode="numeric" /></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Logradouro</span><input value={schoolForm.street} onChange={(e) => setSchoolForm((f) => ({ ...f, street: e.target.value }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" placeholder="Rua, avenida ou rodovia" /></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Número</span><input value={schoolForm.streetNumber} onChange={(e) => setSchoolForm((f) => ({ ...f, streetNumber: e.target.value }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" /></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Complemento</span><input value={schoolForm.addressComplement} onChange={(e) => setSchoolForm((f) => ({ ...f, addressComplement: e.target.value }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" /></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Bairro</span><input value={schoolForm.district} onChange={(e) => setSchoolForm((f) => ({ ...f, district: e.target.value }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" /></label>
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
          {activeDetailTab === 'summary' && <div className="space-y-4"><div className="grid grid-cols-1 gap-4 lg:grid-cols-3"><div className="rounded-2xl bg-slate-50 p-4 lg:col-span-2"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-slate-900">Dados institucionais</h3>{canManage&&<button type="button" onClick={openSchoolEditor} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-700"><Pencil size={15}/> Editar dados e endereço</button>}</div><dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2"><div className="sm:col-span-2"><dt className="text-xs text-slate-400">Endereço</dt><dd className="font-medium text-slate-700">{formatSchoolAddress(selectedSchool) || 'Endereço não informado'}</dd>{!formatSchoolAddress(selectedSchool)&&<p className="mt-1 text-xs text-amber-700">Preencha o endereço para permitir sessões clínicas nesta instituição.</p>}</div><div><dt className="text-xs text-slate-400">Rede</dt><dd className="font-medium text-slate-700">{NETWORK_LABELS[selectedSchool.education_network] || 'Outra'}</dd></div><div><dt className="text-xs text-slate-400">Tipo</dt><dd className="font-medium text-slate-700">{TYPE_LABELS[selectedSchool.school_type] || 'Outro'}</dd></div><div><dt className="text-xs text-slate-400">Contatos ativos</dt><dd className="font-medium text-slate-700">{selectedSchool.contacts?.filter((c:any)=>c.is_active).length || 0}</dd></div></dl></div><div className="rounded-2xl border border-violet-100 bg-violet-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-violet-500">Pacientes atuais</p><p className="mt-2 text-3xl font-semibold text-violet-900">{Math.max(0, Number(selectedSchool.patientCount || 0))}</p><button type="button" onClick={() => setActiveDetailTab('patients')} className="mt-4 text-sm font-semibold text-violet-700">Abrir vínculos →</button></div></div><section className="rounded-2xl border border-slate-100 p-4"><div className="flex items-center justify-between"><div><h3 className="font-semibold text-slate-900">Unidades e campi</h3><p className="text-xs text-slate-500">Quando houver unidades ativas, o agendamento usa o endereço da unidade selecionada.</p></div>{canManage&&<button onClick={()=>{setEditingUnit(null);setUnitForm({name:'',code:'',postalCode:'',street:'',streetNumber:'',addressComplement:'',district:'',city:'',state:'',phone:'',isActive:true,reason:''});setShowUnitForm(true)}} className="rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white"><Plus size={14} className="mr-1 inline"/>Unidade</button>}</div><div className="mt-3 grid gap-2 md:grid-cols-2">{(selectedSchool.units||[]).map((unit:any)=><button key={unit.id} type="button" onClick={()=>{if(!canManage)return;setEditingUnit(unit);setUnitForm({name:unit.name||'',code:unit.code||'',postalCode:unit.postal_code||'',street:unit.street||'',streetNumber:unit.street_number||'',addressComplement:unit.address_complement||'',district:unit.district||'',city:unit.city||'',state:unit.state||'',phone:unit.phone||'',isActive:unit.is_active!==false,reason:''});setShowUnitForm(true)}} className="rounded-2xl border border-slate-100 p-3 text-left"><p className="font-semibold text-slate-800">{unit.name}</p><p className="mt-1 text-xs text-slate-500">{formatSchoolAddress(unit)||'Endereço não informado'} · {unit.is_active?'Ativa':'Arquivada'}</p></button>)}</div></section></div>}
          {activeDetailTab === 'patients' && <div className="space-y-4"><div className="grid grid-cols-1 gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-4"><select value={patientFilter.unitId} onChange={(e)=>setPatientFilter((f)=>({...f,unitId:e.target.value}))} className="rounded-xl border border-slate-200 bg-white p-3 text-sm"><option value="">Todas as unidades</option>{(selectedSchool.units||[]).map((u:any)=><option key={u.id} value={u.id}>{u.name}</option>)}</select><input placeholder="Série/ano" value={patientFilter.gradeLevel} onChange={(e)=>setPatientFilter((f)=>({...f,gradeLevel:e.target.value}))} className="rounded-xl border border-slate-200 p-3 text-sm" /><input placeholder="Turma" value={patientFilter.className} onChange={(e)=>setPatientFilter((f)=>({...f,className:e.target.value}))} className="rounded-xl border border-slate-200 p-3 text-sm" /><select value={patientFilter.shift} onChange={(e)=>setPatientFilter((f)=>({...f,shift:e.target.value}))} className="rounded-xl border border-slate-200 bg-white p-3 text-sm"><option value="">Todos os turnos</option><option value="MORNING">Manhã</option><option value="AFTERNOON">Tarde</option><option value="EVENING">Noite</option><option value="FULL_TIME">Integral</option></select></div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700">
                <input type="checkbox" checked={allSelected} onChange={() => setSelectedPatientIds(allSelected ? [] : filteredPatientIds)} className="h-4 w-4 rounded" /> Selecionar resultados
              </label>
              <div className="flex flex-wrap gap-2">
                {canManage && <button type="button" onClick={() => setEnrollmentDialog(null)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-200 px-4 text-sm font-medium text-violet-700"><Plus size={17}/> Vincular paciente</button>}
                <button type="button" disabled={selectedPatientIds.length===0} onClick={()=>setShowMeeting(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-sm font-medium text-white disabled:opacity-40"><CalendarDays size={17}/> Criar reunião escolar ({selectedPatientIds.length})</button>
              </div>
            </div>
            {patientLoading ? (
              <div className="py-12 text-center"><Loader2 className="mx-auto animate-spin text-violet-600" /></div>
            ) : (
              <div className="space-y-2">
                {schoolPatients.map((row:any) => (
                  <div key={row.id} className="flex flex-col gap-3 rounded-2xl border border-slate-100 p-4 hover:bg-slate-50 sm:flex-row sm:items-center">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input type="checkbox" checked={selectedPatientIds.includes(row.patient_id)} onChange={()=>setSelectedPatientIds((ids)=>ids.includes(row.patient_id)?ids.filter((id)=>id!==row.patient_id):[...ids,row.patient_id])} className="h-4 w-4 rounded"/>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-slate-900">{row.patient?.name || 'Paciente'}</p>
                        <p className="text-xs text-slate-500">
                          {[row.school_units?.name,ENROLLMENT_TYPE_LABELS[row.enrollment_type] || 'Vínculo escolar',row.grade_level,row.class_name,SHIFT_LABELS[row.shift] || null,formatDateOnly(row.started_at) ? `desde ${formatDateOnly(row.started_at)}` : ''].filter(Boolean).join(' · ') || 'Vínculo sem detalhes de turma'}
                        </p>
                      </div>
                    </label>
                    <span className={`w-fit rounded-full px-2 py-1 text-[10px] font-medium ${(row.consents||[]).some((c:any)=>c.status==='AUTHORIZED')?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}`}>
                      {(row.consents||[]).some((c:any)=>c.status==='AUTHORIZED')?'Autorização registrada':'Revisar autorização'}
                    </span>
                    <span className="w-fit rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600">Vínculo atual</span>
                    <div className="flex flex-wrap gap-1">
                      {onOpenPatient && <button type="button" onClick={()=>onOpenPatient(String(row.patient_id), row.patient?.name)} className="min-h-10 min-w-10 rounded-xl border border-slate-200 p-2 text-slate-600" aria-label={`Abrir paciente ${row.patient?.name || ''}`}><ExternalLink size={15} className="mx-auto"/></button>}
                      <button type="button" onClick={()=>{setSelectedPatientIds([String(row.patient_id)]);setShowMeeting(true)}} className="min-h-10 min-w-10 rounded-xl border border-slate-200 p-2 text-slate-600" aria-label={`Criar reunião para ${row.patient?.name || 'paciente'}`}><CalendarDays size={15} className="mx-auto"/></button>
                      {onScheduleSchoolSession && <button type="button" onClick={()=>onScheduleSchoolSession(row)} className="min-h-10 min-w-10 rounded-xl border border-emerald-200 p-2 text-emerald-700" aria-label={`Agendar sessão na escola para ${row.patient?.name || 'paciente'}`}><Plus size={15} className="mx-auto"/></button>}
                      {canManage && <button type="button" onClick={()=>setEnrollmentDialog(row)} className="min-h-10 min-w-10 rounded-xl border border-violet-200 p-2 text-violet-700" aria-label={`Editar vínculo de ${row.patient?.name || 'paciente'}`}><Pencil size={15} className="mx-auto"/></button>}
                      {canManage && <button type="button" onClick={()=>{setEndingEnrollment(row);setEndingReason('');setEndingIdempotencyKey(crypto.randomUUID())}} className="min-h-10 min-w-10 rounded-xl border border-rose-200 p-2 text-rose-600" aria-label={`Encerrar vínculo de ${row.patient?.name || 'paciente'}`}><Unlink size={15} className="mx-auto"/></button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>}
          {detailSectionLoading === activeDetailTab && <div className="flex min-h-40 items-center justify-center" role="status" aria-label="Carregando seção"><Loader2 className="animate-spin text-violet-600" size={24}/></div>}
          {activeDetailTab === 'contacts' && <div><div className="mb-3 flex justify-end">{canManage&&<button onClick={()=>{setEditingContact(null);setContactForm({name:'',role:'OTHER',schoolUnitId:'',email:'',phone:'',whatsapp:'',isPrimary:false,isActive:true,reason:''});setShowContactForm(true)}} className="rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white"><Plus size={14} className="mr-1 inline"/>Contato</button>}</div><div className="grid grid-cols-1 gap-3 md:grid-cols-2">{(selectedSchool.contacts||[]).length ? selectedSchool.contacts.map((contact:any)=><button type="button" onClick={()=>{if(!canManage)return;setEditingContact(contact);setContactForm({name:contact.name||'',role:contact.role||'OTHER',schoolUnitId:contact.school_unit_id||'',email:contact.email||'',phone:contact.phone||'',whatsapp:contact.whatsapp||'',isPrimary:Boolean(contact.is_primary),isActive:contact.is_active!==false,reason:''});setShowContactForm(true)}} key={contact.id} className="rounded-2xl border border-slate-100 p-4 text-left"><div className="flex items-start justify-between"><div><p className="font-semibold text-slate-900">{contact.name}</p><p className="text-xs text-slate-500">{contact.role} · {contact.is_active?'Ativo':'Inativo'}</p></div>{contact.is_primary&&<span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700">Principal</span>}</div><div className="mt-3 space-y-1 text-sm text-slate-600"><p>{contact.email||'E-mail não informado'}</p><p>{contact.whatsapp||contact.phone||'Telefone não informado'}</p></div></button>):<div className="md:col-span-2 rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">Nenhum contato cadastrado.</div>}</div></div>}
          {activeDetailTab === 'meetings' && <div className="space-y-3"><div className="flex justify-end">{canManageMeetings && <button type="button" onClick={()=>{setActiveDetailTab('patients');setShowMeeting(true)}} className="inline-flex items-center gap-2 rounded-xl bg-[#7a32fc] px-4 py-2.5 text-sm font-semibold text-white"><Plus size={16}/> Nova reunião em lote</button>}</div>{(selectedSchool.meetings||[]).map((meeting:any)=><button type="button" onClick={()=>setSelectedMeetingId(meeting.id)} key={meeting.id} className="w-full rounded-2xl border border-slate-100 p-4 text-left hover:border-violet-200"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold text-slate-900">{meeting.title}</p><p className="mt-1 text-xs text-slate-500">{MEETING_TYPE_LABELS[meeting.meeting_type]||meeting.meeting_type} · {formatDateTime(meeting.scheduled_start)}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">{STATUS_LABELS[meeting.status]||meeting.status}</span></div></button>)}</div>}
          {activeDetailTab === 'documents' && <div className="space-y-2">{(selectedSchool.documents||[]).map((doc:any)=><div key={doc.id} className="flex flex-col gap-3 rounded-2xl border border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate font-semibold text-slate-800">{doc.document?.file_name || doc.document_type || 'Documento escolar'}</p><p className="mt-1 text-xs text-slate-500">{doc.document_type} · {doc.visibility}{doc.patients?.name ? ` · ${doc.patients.name}` : ''}{doc.school_meetings?.title ? ` · ${doc.school_meetings.title}` : ''}</p><p className="mt-1 text-[11px] text-slate-400">Vinculado em {formatDateTime(doc.created_at)}</p></div><div className="flex shrink-0 gap-2"><button type="button" onClick={()=>void openSchoolDocument(doc)} className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700"><ExternalLink size={14}/> Abrir</button>{canManageMeetings&&<button type="button" onClick={()=>void archiveSchoolDocument(doc)} className="rounded-xl border border-rose-200 p-2 text-rose-600" aria-label="Arquivar vínculo documental"><Trash2 size={15}/></button>}</div></div>)}{!(selectedSchool.documents||[]).length&&<div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center"><FileText className="mx-auto text-slate-300" size={36}/><p className="mt-3 font-semibold text-slate-700">Nenhum documento vinculado</p><p className="mt-1 text-sm text-slate-500">Vincule documentos existentes do prontuário pelo detalhe de uma reunião escolar.</p></div>}</div>}
          {activeDetailTab === 'history' && <div className="space-y-2">{(selectedSchool.audit||[]).map((event:any)=><div key={event.id} className="rounded-2xl border border-slate-100 p-4"><div className="flex justify-between gap-3"><p className="font-semibold text-slate-800">{event.action}</p><span className="text-xs text-slate-400">{formatDateTime(event.created_at)}</span></div><p className="mt-1 text-xs text-slate-500">{event.reason||'Ação auditada sem motivo adicional.'}</p></div>)}{!(selectedSchool.audit||[]).length&&<div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">Nenhum evento disponível para seu papel.</div>}</div>}
          {canManage && <div className="mt-6 flex justify-end border-t border-slate-100 pt-4"><button type="button" onClick={async()=>{if(!confirm('Arquivar esta escola? O histórico será preservado.'))return; const result=await dataService.updateSchool(selectedSchool.id,{archive:true,reason:'Arquivamento administrativo'});if(result?.success){setSelectedSchool(null);setNotice('Escola arquivada sem apagar o histórico.');notifySchoolOptionsChanged();void loadSchools();}}} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"><Archive size={16}/> Arquivar escola</button></div>}
        </>}
      </Modal>}

      {showEditSchool && selectedSchool && <Modal title="Editar dados e endereço da escola" onClose={()=>setShowEditSchool(false)} wide>
        <div className="mb-5 rounded-2xl border border-violet-100 bg-violet-50 p-4 text-sm text-violet-800">
          Para agendar uma sessão na escola, informe pelo menos o logradouro e a cidade. Se houver unidades ativas, preencha o endereço de cada unidade, pois ele terá prioridade no agendamento.
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="md:col-span-2"><span className="mb-1 block text-xs font-semibold text-slate-600">Nome de exibição *</span><input value={schoolEditForm.displayName} onChange={(e)=>setSchoolEditForm((f)=>({...f,displayName:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"/></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Razão social</span><input value={schoolEditForm.legalName} onChange={(e)=>setSchoolEditForm((f)=>({...f,legalName:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"/></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">CNPJ</span><input value={schoolEditForm.taxId} onChange={(e)=>setSchoolEditForm((f)=>({...f,taxId:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" inputMode="numeric"/></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Tipo</span><select value={schoolEditForm.schoolType} onChange={(e)=>setSchoolEditForm((f)=>({...f,schoolType:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3">{Object.entries(TYPE_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Rede</span><select value={schoolEditForm.educationNetwork} onChange={(e)=>setSchoolEditForm((f)=>({...f,educationNetwork:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3">{Object.entries(NETWORK_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Código INEP</span><input value={schoolEditForm.inepCode} onChange={(e)=>setSchoolEditForm((f)=>({...f,inepCode:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"/></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">E-mail</span><input type="email" value={schoolEditForm.email} onChange={(e)=>setSchoolEditForm((f)=>({...f,email:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"/></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Telefone</span><input value={schoolEditForm.phone} onChange={(e)=>setSchoolEditForm((f)=>({...f,phone:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"/></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">WhatsApp</span><input value={schoolEditForm.whatsapp} onChange={(e)=>setSchoolEditForm((f)=>({...f,whatsapp:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"/></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">CEP</span><input value={schoolEditForm.postalCode} onChange={(e)=>setSchoolEditForm((f)=>({...f,postalCode:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" inputMode="numeric"/></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Logradouro *</span><input value={schoolEditForm.street} onChange={(e)=>setSchoolEditForm((f)=>({...f,street:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" placeholder="Rua, avenida ou rodovia"/></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Número</span><input value={schoolEditForm.streetNumber} onChange={(e)=>setSchoolEditForm((f)=>({...f,streetNumber:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"/></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Complemento</span><input value={schoolEditForm.addressComplement} onChange={(e)=>setSchoolEditForm((f)=>({...f,addressComplement:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"/></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Bairro</span><input value={schoolEditForm.district} onChange={(e)=>setSchoolEditForm((f)=>({...f,district:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"/></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Cidade *</span><input value={schoolEditForm.city} onChange={(e)=>setSchoolEditForm((f)=>({...f,city:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"/></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">UF</span><input value={schoolEditForm.state} onChange={(e)=>setSchoolEditForm((f)=>({...f,state:e.target.value.toUpperCase().slice(0,2)}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" maxLength={2}/></label>
          <label className="md:col-span-2"><span className="mb-1 block text-xs font-semibold text-slate-600">Observações administrativas</span><textarea value={schoolEditForm.notes} onChange={(e)=>setSchoolEditForm((f)=>({...f,notes:e.target.value}))} className="min-h-24 w-full rounded-2xl border border-slate-200 px-4 py-3" maxLength={4000}/></label>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={()=>setShowEditSchool(false)} className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-600">Cancelar</button><button type="button" disabled={saving||!schoolEditForm.displayName.trim()} onClick={()=>void saveSchoolDetails()} className="rounded-2xl bg-[#7a32fc] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving?'Salvando…':'Salvar dados e endereço'}</button></div>
      </Modal>}

      {showMeeting && selectedSchool && <Modal title="Criar reunião escolar em lote" onClose={()=>setShowMeeting(false)} wide>
        <div className="mb-5 rounded-2xl border border-violet-100 bg-violet-50 p-4"><p className="font-semibold text-violet-900">{selectedSchool.display_name}</p><p className="mt-1 text-sm text-violet-700">{selectedPatientIds.length} paciente(s) selecionado(s). Será criada uma única reunião, com notas individuais isoladas por paciente.</p></div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><label className="md:col-span-2"><span className="mb-1 block text-xs font-semibold text-slate-600">Título</span><input value={meetingForm.title} onChange={(e)=>setMeetingForm((f)=>({...f,title:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"/></label><label><span className="mb-1 block text-xs font-semibold text-slate-600">Tipo</span><select value={meetingForm.meetingType} onChange={(e)=>setMeetingForm((f)=>({...f,meetingType:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3">{Object.entries(MEETING_TYPE_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label><span className="mb-1 block text-xs font-semibold text-slate-600">Responsável interno</span><select value={meetingForm.responsibleProfessionalId} onChange={(e)=>setMeetingForm((f)=>({...f,responsibleProfessionalId:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"><option value="">Selecionar</option>{professionals.map((p:any)=><option key={p.id} value={p.id}>{p.name||p.email}</option>)}</select></label><label><span className="mb-1 block text-xs font-semibold text-slate-600">Início</span><input type="datetime-local" value={meetingForm.scheduledStart} onChange={(e)=>setMeetingForm((f)=>({...f,scheduledStart:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"/></label><label><span className="mb-1 block text-xs font-semibold text-slate-600">Término</span><input type="datetime-local" value={meetingForm.scheduledEnd} onChange={(e)=>setMeetingForm((f)=>({...f,scheduledEnd:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"/></label><label><span className="mb-1 block text-xs font-semibold text-slate-600">Local</span><input value={meetingForm.location} onChange={(e)=>setMeetingForm((f)=>({...f,location:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3" placeholder="Escola, clínica ou endereço"/></label><label><span className="mb-1 block text-xs font-semibold text-slate-600">Status inicial</span><select value={meetingForm.status} onChange={(e)=>setMeetingForm((f)=>({...f,status:e.target.value}))} className="w-full rounded-2xl border border-slate-200 px-4 py-3"><option value="DRAFT">Salvar rascunho</option><option value="SCHEDULED">Agendar</option></select></label><label className="md:col-span-2"><span className="mb-1 block text-xs font-semibold text-slate-600">Pauta geral</span><textarea value={meetingForm.agenda} onChange={(e)=>setMeetingForm((f)=>({...f,agenda:e.target.value}))} className="min-h-28 w-full rounded-2xl border border-slate-200 px-4 py-3" maxLength={10000}/><p className="mt-1 text-xs text-slate-400">Não inclua observações clínicas individuais aqui. Elas serão registradas separadamente por paciente.</p></label></div>
        <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800"><div className="flex gap-2"><ShieldCheck className="shrink-0" size={19}/><p>As autorizações são validadas e congeladas como snapshot na inclusão. Conteúdo clínico não será enviado em convites externos.</p></div></div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={()=>setShowMeeting(false)} className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-600">Cancelar</button><button type="button" disabled={saving||selectedPatientIds.length===0||!meetingForm.title.trim()} onClick={()=>void createMeeting()} className="rounded-2xl bg-[#7a32fc] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving?'Criando…':meetingForm.status==='DRAFT'?'Salvar rascunho':'Agendar reunião'}</button></div>
      </Modal>}
      {showUnitForm && <Modal title={editingUnit?'Editar unidade e endereço':'Nova unidade'} onClose={()=>setShowUnitForm(false)}><div className="mb-4 rounded-xl bg-violet-50 p-3 text-xs text-violet-800">Se esta escola possui unidades ativas, o endereço da unidade selecionada será usado no agendamento escolar.</div><div className="grid gap-3 sm:grid-cols-2"><input value={unitForm.name} onChange={(e)=>setUnitForm((v)=>({...v,name:e.target.value}))} placeholder="Nome da unidade *" className="rounded-xl border border-slate-200 p-3 sm:col-span-2"/><input value={unitForm.code} onChange={(e)=>setUnitForm((v)=>({...v,code:e.target.value}))} placeholder="Código interno" className="rounded-xl border border-slate-200 p-3"/><input value={unitForm.phone} onChange={(e)=>setUnitForm((v)=>({...v,phone:e.target.value}))} placeholder="Telefone" className="rounded-xl border border-slate-200 p-3"/><input value={unitForm.postalCode} onChange={(e)=>setUnitForm((v)=>({...v,postalCode:e.target.value}))} placeholder="CEP" inputMode="numeric" className="rounded-xl border border-slate-200 p-3"/><input value={unitForm.street} onChange={(e)=>setUnitForm((v)=>({...v,street:e.target.value}))} placeholder="Logradouro *" className="rounded-xl border border-slate-200 p-3"/><input value={unitForm.streetNumber} onChange={(e)=>setUnitForm((v)=>({...v,streetNumber:e.target.value}))} placeholder="Número" className="rounded-xl border border-slate-200 p-3"/><input value={unitForm.addressComplement} onChange={(e)=>setUnitForm((v)=>({...v,addressComplement:e.target.value}))} placeholder="Complemento" className="rounded-xl border border-slate-200 p-3"/><input value={unitForm.district} onChange={(e)=>setUnitForm((v)=>({...v,district:e.target.value}))} placeholder="Bairro" className="rounded-xl border border-slate-200 p-3"/><input value={unitForm.city} onChange={(e)=>setUnitForm((v)=>({...v,city:e.target.value}))} placeholder="Cidade *" className="rounded-xl border border-slate-200 p-3"/><input value={unitForm.state} onChange={(e)=>setUnitForm((v)=>({...v,state:e.target.value.toUpperCase().slice(0,2)}))} placeholder="UF" className="rounded-xl border border-slate-200 p-3"/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={unitForm.isActive} onChange={(e)=>setUnitForm((v)=>({...v,isActive:e.target.checked}))}/>Unidade ativa</label><input value={unitForm.reason} onChange={(e)=>setUnitForm((v)=>({...v,reason:e.target.value}))} placeholder="Motivo ao arquivar" className="rounded-xl border border-slate-200 p-3"/></div><div className="mt-5 flex justify-end"><button disabled={saving||!unitForm.name.trim()||(unitForm.isActive&&(!unitForm.street.trim()||!unitForm.city.trim()))} onClick={()=>void saveUnit()} className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">Salvar unidade e endereço</button></div></Modal>}
      {showContactForm && <Modal title={editingContact?'Editar contato':'Novo contato'} onClose={()=>setShowContactForm(false)}><div className="grid gap-3 sm:grid-cols-2"><input value={contactForm.name} onChange={(e)=>setContactForm((v)=>({...v,name:e.target.value}))} placeholder="Nome" className="rounded-xl border border-slate-200 p-3 sm:col-span-2"/><select value={contactForm.role} onChange={(e)=>setContactForm((v)=>({...v,role:e.target.value}))} className="rounded-xl border border-slate-200 p-3"><option value="DIRECTOR">Direção</option><option value="PEDAGOGICAL_COORDINATOR">Coordenação</option><option value="TEACHER">Professor</option><option value="SCHOOL_MEDIATOR">Mediador</option><option value="SECRETARY">Secretaria</option><option value="OTHER">Outro</option></select><select value={contactForm.schoolUnitId} onChange={(e)=>setContactForm((v)=>({...v,schoolUnitId:e.target.value}))} className="rounded-xl border border-slate-200 p-3"><option value="">Instituição geral</option>{(selectedSchool?.units||[]).map((u:any)=><option key={u.id} value={u.id}>{u.name}</option>)}</select><input value={contactForm.email} onChange={(e)=>setContactForm((v)=>({...v,email:e.target.value}))} placeholder="E-mail" className="rounded-xl border border-slate-200 p-3"/><input value={contactForm.phone} onChange={(e)=>setContactForm((v)=>({...v,phone:e.target.value}))} placeholder="Telefone" className="rounded-xl border border-slate-200 p-3"/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={contactForm.isPrimary} onChange={(e)=>setContactForm((v)=>({...v,isPrimary:e.target.checked}))}/>Contato principal</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={contactForm.isActive} onChange={(e)=>setContactForm((v)=>({...v,isActive:e.target.checked}))}/>Contato ativo</label></div><div className="mt-5 flex justify-end"><button disabled={saving||!contactForm.name.trim()} onClick={()=>void saveContact()} className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">Salvar contato</button></div></Modal>}
      {reviewOpen && <Modal title="Revisão de escolas migradas" onClose={()=>setReviewOpen(false)} wide><div className="mb-4 flex flex-wrap gap-2">{Object.entries(reviewCounts).map(([status,count])=><span key={status} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{status}: {count}</span>)}</div>{reviewLoading?<div className="py-12 text-center"><Loader2 className="mx-auto animate-spin"/></div>:<div className="space-y-2">{reviewRows.map((row:any)=><div key={row.id} className="rounded-2xl border border-slate-100 p-4"><p className="font-semibold text-slate-900">{row.patients?.name||'Paciente'}</p><p className="mt-1 text-sm text-slate-600">Texto original: “{row.original_value}”</p><p className="text-xs text-slate-400">{row.source_field||'Campo legado'} · {row.status}</p>{['PENDING','AMBIGUOUS','DEFERRED'].includes(row.status)&&<div className="mt-3 flex flex-wrap gap-2"><select id={`review-school-${row.id}`} className="rounded-xl border border-slate-200 p-2 text-sm"><option value="">Selecionar escola</option>{schools.map((sc:any)=><option key={sc.id} value={sc.id}>{sc.display_name}</option>)}</select><button onClick={()=>{const el=document.getElementById(`review-school-${row.id}`) as HTMLSelectElement; if(el?.value)void resolveReview(row,'ASSOCIATE',el.value)}} className="rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white">Associar</button><button onClick={()=>startSchoolFromReview(row)} className="rounded-xl border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700">Criar nova escola</button><button onClick={()=>void resolveReview(row,'IGNORE')} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">Ignorar</button><button onClick={()=>void resolveReview(row,'NOT_SCHOOL')} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">Não é escola</button><button onClick={()=>void resolveReview(row,'DEFER')} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">Adiar</button></div>}</div>)}{!reviewRows.length&&<div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">Nenhum item pendente.</div>}</div>}</Modal>}
      <SchoolEnrollmentDialog
        open={enrollmentDialog !== undefined && Boolean(selectedSchool)}
        fixedSchool={selectedSchool}
        fixedPatient={enrollmentDialog?.patient ? { ...enrollmentDialog.patient } : null}
        enrollment={enrollmentDialog || null}
        onClose={() => setEnrollmentDialog(undefined)}
        onSaved={async () => {
          setNotice(enrollmentDialog?.id ? 'Vínculo escolar atualizado e persistido.' : 'Paciente vinculado à escola com sucesso.');
          await Promise.all([refreshSelectedSchool(), loadSchoolPatients()]);
        }}
      />
      {endingEnrollment && <Modal title="Encerrar vínculo escolar" onClose={()=>setEndingEnrollment(null)}>
        <p className="text-sm text-slate-600">O vínculo de <strong className="font-medium text-slate-800">{endingEnrollment.patient?.name || 'paciente'}</strong> deixará de ser atual. O histórico permanecerá disponível.</p>
        <label className="mt-4 block"><span className="mb-1 block text-sm font-medium text-slate-700">Motivo do encerramento *</span><textarea value={endingReason} onChange={(event)=>setEndingReason(event.target.value)} className="min-h-24 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"/></label>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={()=>setEndingEnrollment(null)} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-600">Cancelar</button><button type="button" disabled={saving||!endingReason.trim()} onClick={()=>void endSchoolEnrollment()} className="min-h-11 rounded-xl bg-rose-600 px-4 text-sm font-medium text-white disabled:opacity-50">{saving?'Encerrando…':'Encerrar vínculo'}</button></div>
      </Modal>}
      {selectedMeetingId && <SchoolMeetingWorkspace meetingId={selectedMeetingId} school={selectedSchool} professionals={professionals} userRole={userRole} capabilities={capabilities} onClose={()=>setSelectedMeetingId('')} onChanged={()=>void refreshSelectedSchool()}/>}
    </section>
  );
}
