import React, { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, MessageCircle, FileText, SlidersHorizontal, ChevronDown, Calendar, FileOutput, Download, EyeOff, Share2, Eye, Edit, X, UploadCloud, FileUp, File, Trash2, Activity, Search, Plus, Filter, Target, Zap, Info, BarChart2, CheckCircle2, RotateCcw, Clock, StopCircle } from 'lucide-react';
import { TutorialOverlay } from './Tutorial';
import { AnamnesisModal } from './Anamnesis';
import { ComparisonBarChart, EvolutionBarChart } from './Charts';
import { HistoryCard } from './History';
import { SessionMode } from './SessionMode';
import { ENERGY_TAGS } from './Common';
import { dataService } from '../services/dataService';
import { SecureImage, SecureIframe } from './SecureMedia';
import { calculateDomainMastery, normalizeScoreToPercent } from '../utils/clinicalMath';
import { AFLS_ADULT_SOCIAL_PARTICIPATION_PROTOCOL } from '../constants/aflsProtocol';
import { VBMAPP_LEVEL_1_CANONICAL_PROTOCOL } from '../constants/vbmappLevel1Protocol';
import { VBMAPP_LEVEL_2_CANONICAL_PROTOCOL } from '../constants/vbmappLevel2Protocol';
import { VBMAPP_LEVEL_3_CANONICAL_PROTOCOL } from '../constants/vbmappLevel3Protocol';
import html2canvas from 'html2canvas';

const getApprovedVertoCanonicalProtocol = (request: any) => {
  const source = `${request?.canonicalKey || ''} ${request?.canonicalName || ''} ${request?.protocolName || ''}`.toLowerCase();
  if (source.includes('afls') || source.includes('participacao-social') || source.includes('participação social')) {
    return AFLS_ADULT_SOCIAL_PARTICIPATION_PROTOCOL;
  }
  if (source.includes('vb-mapp-level-3') || source.includes('vb-mapp-nivel-3') || source.includes('vbmapp3') || source.includes('vb-mapp3') || source.includes('nivel 3') || source.includes('30 a 48')) {
    return VBMAPP_LEVEL_3_CANONICAL_PROTOCOL;
  }
  if (source.includes('vb-mapp-level-2') || source.includes('vb-mapp-nivel-2') || source.includes('vbmapp2') || source.includes('vb-mapp2') || source.includes('nivel 2') || source.includes('18 a 30')) {
    return VBMAPP_LEVEL_2_CANONICAL_PROTOCOL;
  }
  if (source.includes('vb-mapp') || source.includes('vbmapp') || source.includes('vb mapp')) {
    return VBMAPP_LEVEL_1_CANONICAL_PROTOCOL;
  }
  return null;
};

export const PatientDetailView = ({ patient, onBack, history, notes, onAddNote, onAddActivityLog, protocols, setProtocols, onAddTask, patientTasks, onToggleNoteType, onEvaluateHistoryItem, onUpdateTask, isTutorialActive, tutorialStep, setTutorialStep, onUpdatePatient, onRecordTrial, onDeleteHistoryItem, initialTab = 'history', openAnamnesisOnLoad = false, onAnamnesisOpenConsumed, clinicContext, hideBackButton = false, anamnesisTemplate, allowedTabs, userRole }: any) => { 
  const coalescePatientText = (...values: any[]) => {
    for (const value of values) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      }
    }
    return '';
  };
  const calculateAgeFromBirthDate = (birthDate: string) => {
    const normalized = String(birthDate || '').trim();
    if (!normalized) return null;
    const birth = new Date(normalized);
    if (Number.isNaN(birth.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    const dayDiff = today.getDate() - birth.getDate();
    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
      age -= 1;
    }
    return age >= 0 ? age : null;
  };
  const buildAnamnesisInitialData = (patientRecord: any) => {
    const existing = patientRecord?.anamnesisData && typeof patientRecord.anamnesisData === 'object'
      ? patientRecord.anamnesisData
      : {};
    const address = patientRecord?.address && typeof patientRecord.address === 'object'
      ? patientRecord.address
      : {};
    const guardian = patientRecord?.guardian && typeof patientRecord.guardian === 'object'
      ? patientRecord.guardian
      : {};
    const resolvedBirthDate = coalescePatientText(
      patientRecord?.dataNascimento,
      patientRecord?.birthDate,
      patientRecord?.birth_date,
      existing?.dataNascimento,
    );
    const logradouro = coalescePatientText(patientRecord?.logradouro, address?.logradouro, existing?.logradouro);
    const numero = coalescePatientText(patientRecord?.numero, address?.numero, existing?.numero);
    const bairro = coalescePatientText(patientRecord?.bairro, address?.bairro, existing?.bairro);
    const cidade = coalescePatientText(patientRecord?.cidade, address?.cidade, existing?.cidade);
    const derivedAgeFromBirthDate = calculateAgeFromBirthDate(resolvedBirthDate);

    return {
      ...existing,
      nome: coalescePatientText(patientRecord?.name, existing?.nome),
      nomeSocial: coalescePatientText(patientRecord?.socialName, existing?.nomeSocial),
      telefone: coalescePatientText(patientRecord?.phone, existing?.telefone),
      email: coalescePatientText(patientRecord?.email, existing?.email),
      cpf: coalescePatientText(patientRecord?.cpf, existing?.cpf),
      dataNascimento: resolvedBirthDate,
      genero: coalescePatientText(patientRecord?.gender, existing?.genero),
      convenioTipo: coalescePatientText(patientRecord?.insuranceType, existing?.convenioTipo) || 'particular',
      convenioNome: coalescePatientText(patientRecord?.insuranceName, existing?.convenioNome),
      convenioCarteirinha: coalescePatientText(patientRecord?.cardNumber, existing?.convenioCarteirinha),
      grupo: coalescePatientText(patientRecord?.group, existing?.grupo),
      comoConheceu: coalescePatientText(patientRecord?.source, existing?.comoConheceu),
      rg: coalescePatientText(patientRecord?.rg, existing?.rg),
      cep: coalescePatientText(patientRecord?.cep, existing?.cep),
      logradouro,
      numero,
      complemento: coalescePatientText(patientRecord?.complemento, address?.complemento, existing?.complemento),
      bairro,
      cidade,
      endereco:
        [logradouro, numero, bairro, cidade].filter(Boolean).join(', ') ||
        coalescePatientText(existing?.endereco),
      outrasInformacoes: coalescePatientText(patientRecord?.notes, existing?.outrasInformacoes),
      menorDeIdade:
        typeof patientRecord?.isMinor === 'boolean'
          ? patientRecord.isMinor
          : Boolean(existing?.menorDeIdade),
      responsavelNome: coalescePatientText(guardian?.nome, existing?.responsavelNome),
      responsavelDataNascimento: coalescePatientText(
        guardian?.dataNascimento,
        existing?.responsavelDataNascimento,
      ),
      responsavelCpf: coalescePatientText(guardian?.cpf, existing?.responsavelCpf),
      responsavelTelefone: coalescePatientText(guardian?.telefone, existing?.responsavelTelefone),
      idade:
        typeof derivedAgeFromBirthDate === 'number'
          ? derivedAgeFromBirthDate
          : typeof patientRecord?.age === 'number'
            ? patientRecord.age
          : existing?.idade ?? '',
    };
  };
  const anamnesisInitialData = useMemo(() => buildAnamnesisInitialData(patient), [patient]);
  const rawProfileType = String(
    patient?.type ||
    patient?.profileType ||
    patient?.patient_type ||
    patient?.anamnesisData?.formType ||
    ''
  ).toLowerCase();
  const isExplicitKidsType = ['kids_tea', 'kids', 'child', 'infantil', 'crianca', 'criança'].includes(rawProfileType);
  const isExplicitAdultType = ['adult', 'adulto', 'conventional', 'adult_conventional'].includes(rawProfileType);
  const rawPatientAge = patient?.age;
  const hasExplicitAge =
    rawPatientAge !== null &&
    rawPatientAge !== undefined &&
    String(rawPatientAge).trim() !== '';
  const normalizedPatientAge = hasExplicitAge ? Number(rawPatientAge) : Number.NaN;
  const hasNumericAge = Number.isFinite(normalizedPatientAge) && normalizedPatientAge >= 0;
  const isKidsProfile =
    isExplicitKidsType ||
    (!isExplicitAdultType && (
      patient?.anamnesisData?.formType === 'child' ||
      (patient?.anamnesisData?.formType !== 'adult' && hasNumericAge && normalizedPatientAge <= 12)
    ));
  const [activeTab, setActiveTab] = useState(initialTab); 
  const [newNote, setNewNote] = useState(""); 
  const [noteMode, setNoteMode] = useState('private'); 
  const [noteSearchQuery, setNoteSearchQuery] = useState("");
  const [noteSubjectFilter, setNoteSubjectFilter] = useState("");
  const [noteDateFilter, setNoteDateFilter] = useState("");
  const [newNoteSubject, setNewNoteSubject] = useState("");
  const [showNoteFilters, setShowNoteFilters] = useState(false);
  const [showAnamnesis, setShowAnamnesis] = useState(false); 
  const [reportPeriod, setReportPeriod] = useState('monthly');
  const [comparisonDate1, setComparisonDate1] = useState('');
  const [comparisonDate2, setComparisonDate2] = useState('');
  const [adultReportDate1, setAdultReportDate1] = useState('');
  const [adultReportDate2, setAdultReportDate2] = useState('');
  const [selectedReportNotes, setSelectedReportNotes] = useState<number[]>([]);
  const [selectedAdultEvolutionIds, setSelectedAdultEvolutionIds] = useState<string[]>([]);
  const [reportAdditionalNote, setReportAdditionalNote] = useState('');
  const [isGeneratingAdultReport, setIsGeneratingAdultReport] = useState(false);
  const [planType, setPlanType] = useState('task'); 
  const [isCreatingNewTask, setIsCreatingNewTask] = useState(false); 
  const [filterAge, setFilterAge] = useState(""); 
  const [filterType, setFilterType] = useState(""); 
  const [filterDomain, setFilterDomain] = useState(""); 
  const [selectedProtocolId, setSelectedProtocolId] = useState(''); 
  const [selectedDomainId, setSelectedDomainId] = useState(''); 
  const [selectedSkillId, setSelectedSkillId] = useState(''); 
  const [newTaskName, setNewTaskName] = useState(''); 
  const [newTaskCode, setNewTaskCode] = useState(''); 
  const [newTaskMaxScore, setNewTaskMaxScore] = useState(2); 
  const [newTaskObjective, setNewTaskObjective] = useState(''); 
  const [newTaskExample, setNewTaskExample] = useState(''); 
  const [newTaskCriteria, setNewTaskCriteria] = useState(''); 
  const [newTaskComment, setNewTaskComment] = useState(''); 
  const [addToProtocolMode, setAddToProtocolMode] = useState('existing'); 
  const [targetProtocolId, setTargetProtocolId] = useState(''); 
  const [targetDomainId, setTargetDomainId] = useState(''); 
  const [newProtocolName, setNewProtocolName] = useState(''); 
  const [newDomainName, setNewDomainName] = useState(''); 
  const [message, setMessage] = useState(''); 
  const [scheduleDate, setScheduleDate] = useState(''); 
  const [scheduleTime, setScheduleTime] = useState(''); 
  const [finalTaskTitle, setFinalTaskTitle] = useState(""); 
  const [finalTaskSubtitle, setFinalTaskSubtitle] = useState(""); 
  const [isCustomizationOpen, setIsCustomizationOpen] = useState(false); 
  const [isDailyReminder, setIsDailyReminder] = useState(false);
  const [linkedTask, setLinkedTask] = useState("");
  const [linkedInterventionProtocolId, setLinkedInterventionProtocolId] = useState("");
  const [showConfirmation, setShowConfirmation] = useState(false); 
  const [editingTask, setEditingTask] = useState<any>(null); 
  const [isPlanFilterOpen, setIsPlanFilterOpen] = useState(false);
  const [isAddingPEIGoal, setIsAddingPEIGoal] = useState(false);
  const [selectedPEIProtocolId, setSelectedPEIProtocolId] = useState("");
  const [selectedPEIDomainId, setSelectedPEIDomainId] = useState("");
  const [selectedPEISkillId, setSelectedPEISkillId] = useState("");
  const [isSessionModeOpen, setIsSessionModeOpen] = useState(false);
  const [isUnlinkingModalOpen, setIsUnlinkingModalOpen] = useState(false);
  const [approvedVertoProtocolStatuses, setApprovedVertoProtocolStatuses] = useState<any[]>([]);
  const [clinicTherapists, setClinicTherapists] = useState<any[]>([]);
  const [isLoadingTherapists, setIsLoadingTherapists] = useState(false);
  const [selectedTherapistId, setSelectedTherapistId] = useState<string>(
    String(patient?.therapist_id || patient?.professional_id || '').trim()
  );

  const allTabs: Array<'history' | 'notes' | 'report' | 'plan' | 'session' | 'files'> = [
    'history',
    'notes',
    'report',
    'plan',
    'session',
    'files',
  ];
  const allowedTabsSet = useMemo(() => {
    const tabsFromProps =
      !Array.isArray(allowedTabs) || allowedTabs.length === 0
        ? allTabs
        : allowedTabs.filter((tab: string) =>
            allTabs.includes(tab as 'history' | 'notes' | 'report' | 'plan' | 'session' | 'files'),
          );

    const filteredByProfile = isKidsProfile
      ? tabsFromProps
      : tabsFromProps.filter((tab: string) => tab !== 'session');

    return new Set(filteredByProfile as Array<'history' | 'notes' | 'report' | 'plan' | 'session' | 'files'>);
  }, [allowedTabs, isKidsProfile]);
  const canAccessTab = (tab: 'history' | 'notes' | 'report' | 'plan' | 'session' | 'files') =>
    allowedTabsSet.has(tab);
  const canOpenAnamnesis = canAccessTab('history') && canAccessTab('notes');

  useEffect(() => {
    if (initialTab && canAccessTab(initialTab)) {
      setActiveTab(initialTab);
      return;
    }
    const firstAllowed = allTabs.find((tab) => canAccessTab(tab)) || 'files';
    setActiveTab(firstAllowed);
  }, [initialTab, patient?.id, allowedTabsSet]);

  useEffect(() => {
    if (openAnamnesisOnLoad) {
      setShowAnamnesis(true);
      onAnamnesisOpenConsumed?.();
    }
  }, [openAnamnesisOnLoad, onAnamnesisOpenConsumed, patient?.id]);

  useEffect(() => {
    setSelectedTherapistId(String(patient?.therapist_id || patient?.professional_id || '').trim());
  }, [patient?.therapist_id, patient?.professional_id, patient?.id]);

  const canManageTherapistAssignment = useMemo(() => {
    const normalizedRole = String(userRole || '').toLowerCase();
    return ['coordinator', 'admin', 'owner'].includes(normalizedRole);
  }, [userRole]);

  useEffect(() => {
    const loadClinicTherapists = async () => {
      if (!canManageTherapistAssignment) {
        setClinicTherapists([]);
        return;
      }
      setIsLoadingTherapists(true);
      try {
        const result = await dataService.getClinicMembers();
        if (!result?.success || !Array.isArray(result?.data)) {
          setClinicTherapists([]);
          return;
        }
        const therapists = result.data.filter((member: any) => {
          const role = String(member?.role || '').toLowerCase();
          return role === 'therapist';
        });
        setClinicTherapists(therapists);
      } catch (error) {
        console.error('Erro ao carregar terapeutas da clínica:', error);
        setClinicTherapists([]);
      } finally {
        setIsLoadingTherapists(false);
      }
    };
    loadClinicTherapists();
  }, [canManageTherapistAssignment, patient?.id]);

  const handleTherapistAssignmentChange = async (nextTherapistId: string) => {
    if (!onUpdatePatient) return;
    const normalized = String(nextTherapistId || '').trim();
    const nextValue = isUuidLike(normalized) ? normalized : null;
    setSelectedTherapistId(nextValue || '');
    onUpdatePatient({
      ...patient,
      therapist_id: nextValue,
      professional_id: nextValue
    });
  };

  const buildInitialAvatarDataUrl = (name?: string) => {
    const initial = (name || 'P').trim().charAt(0).toUpperCase() || 'P';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='100%' height='100%' rx='18' fill='#7a32fc'/><text x='50%' y='56%' text-anchor='middle' font-size='42' font-family='Arial,sans-serif' fill='white'>${initial}</text></svg>`;
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  };

  const normalizeFileRecord = (file: any) => {
    const safeName = String(file?.name || file?.fileName || 'arquivo');
    const safeType = String(file?.type || file?.mimeType || 'application/octet-stream');
    const safeContent = typeof file?.content === 'string' ? file.content : '';
    const safeUrl = typeof file?.url === 'string' ? file.url : (typeof file?.signedUrl === 'string' ? file.signedUrl : '');
    const contentDataUrl = safeContent.startsWith('data:') ? safeContent : '';
    const sourceUrl = safeUrl || contentDataUrl || undefined;
    const objectUrl =
      contentDataUrl && safeType.includes('pdf')
        ? createObjectUrlFromDataUrl(contentDataUrl, safeType)
        : sourceUrl;
    return {
      id: String(file?.id || Date.now()),
      name: safeName,
      size: String(file?.size || (file?.sizeBytes ? `${Math.max(1, Math.round(Number(file.sizeBytes) / 1024))} KB` : '')),
      date: String(file?.date || (file?.createdAt ? new Date(file.createdAt).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR'))),
      type: safeType,
      source: file?.source || 'upload',
      content: safeContent,
      url: safeUrl || undefined,
      objectUrl
    };
  };

  const createObjectUrlFromDataUrl = (dataUrl: string, fallbackType = 'application/octet-stream') => {
    try {
      const [header, base64Payload = ''] = dataUrl.split(',');
      const mime = header.match(/^data:([^;]+);base64$/i)?.[1] || fallbackType;
      const binary = atob(base64Payload);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return URL.createObjectURL(new Blob([bytes], { type: mime }));
    } catch {
      return dataUrl;
    }
  };

  const resolveFileViewUrl = (file: any) => {
    const content = typeof file?.content === 'string' ? file.content : '';
    if (typeof file?.objectUrl === 'string' && file.objectUrl.startsWith('blob:')) {
      return file.objectUrl;
    }
    if (file?.objectUrl || file?.url) {
      return file.objectUrl || file.url;
    }
    if (content.startsWith('data:application/pdf')) {
      return createObjectUrlFromDataUrl(content, 'application/pdf');
    }
    return content || '';
  };

  useEffect(() => {
    const loadPersistedFiles = async () => {
      if (!patient?.id) return;
      setIsLoadingFiles(true);
      try {
        const result = await dataService.getPatientFiles(String(patient.id));
        if (result?.success && Array.isArray(result?.data)) {
          setPatientFiles(result.data.map(normalizeFileRecord));
          return;
        }
        const fallbackRecord = await dataService.getPatientRecord(String(patient.id));
        const persistedFiles = Array.isArray(fallbackRecord?.data?.payload?.files) ? fallbackRecord.data.payload.files : [];
        setPatientFiles(persistedFiles.map(normalizeFileRecord));
      } catch (error) {
        console.error('Erro ao carregar arquivos persistidos do paciente:', error);
      } finally {
        setIsLoadingFiles(false);
      }
    };
    loadPersistedFiles();
  }, [patient?.id]);
  
  const [patientFiles, setPatientFiles] = useState<any[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [showAnamnesisFileModal, setShowAnamnesisFileModal] = useState(false);
  const [pendingAnamnesisPayload, setPendingAnamnesisPayload] = useState<string>("");
  const [pendingAnamnesisData, setPendingAnamnesisData] = useState<any>(null);
  const [anamnesisFileName, setAnamnesisFileName] = useState("");
  const [anamnesisFileDate, setAnamnesisFileDate] = useState(new Date().toISOString().slice(0, 10));
  const [isPreparingAnamnesisSave, setIsPreparingAnamnesisSave] = useState(false);
  const [resolvedClinicContext, setResolvedClinicContext] = useState<any>(clinicContext || {});
  const [previewFile, setPreviewFile] = useState<any>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [assignedTasks, setAssignedTasks] = useState<any[]>([]);
  const [isLoadingAssignedTasks, setIsLoadingAssignedTasks] = useState(false);
  const [assignedReviewDrafts, setAssignedReviewDrafts] = useState<Record<string, { score: string; note: string }>>({});
  const [lastRecordedTrialId, setLastRecordedTrialId] = useState<any>(null);
  const [lastRecordedGoalId, setLastRecordedGoalId] = useState<any>(null);
  const [pendingTrial, setPendingTrial] = useState<any>(null);
  const [showTrialConfirmation, setShowTrialConfirmation] = useState(false);
  const [trialObservation, setTrialObservation] = useState("");
  const [isSavingObservation, setIsSavingObservation] = useState(false);
  const sessionStorageKey = useMemo(
    () => `verto.active_patient_session:${String(patient?.id || 'unknown')}`,
    [patient?.id]
  );
  const configuredDefaultSessionMinutes = useMemo(() => {
    const raw =
      patient?.sessionDurationMinutes ||
      resolvedClinicContext?.sessionDurationMinutes ||
      resolvedClinicContext?.defaultSessionDuration ||
      clinicContext?.sessionDurationMinutes ||
      clinicContext?.defaultSessionDuration ||
      50;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.max(5, Math.min(240, Math.round(parsed))) : 50;
  }, [
    patient?.sessionDurationMinutes,
    resolvedClinicContext?.sessionDurationMinutes,
    resolvedClinicContext?.defaultSessionDuration,
    clinicContext?.sessionDurationMinutes,
    clinicContext?.defaultSessionDuration
  ]);
  const [activeSession, setActiveSession] = useState<any>(null);
  const [sessionDurationInput, setSessionDurationInput] = useState(String(configuredDefaultSessionMinutes));
  const [remainingSessionSeconds, setRemainingSessionSeconds] = useState(0);
  const [showSessionStartConfirm, setShowSessionStartConfirm] = useState(false);
  const [showSessionEndConfirm, setShowSessionEndConfirm] = useState(false);
  const [pendingSessionAction, setPendingSessionAction] = useState<'tab' | 'fullscreen'>('tab');

  useEffect(() => {
    setResolvedClinicContext(clinicContext || {});
  }, [clinicContext]);

  useEffect(() => {
    setSessionDurationInput(String(configuredDefaultSessionMinutes));
  }, [configuredDefaultSessionMinutes, patient?.id]);

  const formatSessionCountdown = (totalSeconds: number) => {
    const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const calculateRemainingSessionSeconds = (session: any) => {
    if (!session?.endsAt) return 0;
    return Math.max(0, Math.ceil((new Date(session.endsAt).getTime() - Date.now()) / 1000));
  };

  const readPersistedSession = () => {
    try {
      const raw = localStorage.getItem(sessionStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (String(parsed?.patientId) !== String(patient?.id) || parsed?.status !== 'active') return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const persistActiveSession = (session: any) => {
    localStorage.setItem(sessionStorageKey, JSON.stringify(session));
    setActiveSession(session);
    setRemainingSessionSeconds(calculateRemainingSessionSeconds(session));
  };

  const clearActiveSession = () => {
    localStorage.removeItem(sessionStorageKey);
    setActiveSession(null);
    setRemainingSessionSeconds(0);
  };

  useEffect(() => {
    const syncSession = () => {
      const persisted = readPersistedSession();
      setActiveSession(persisted);
      setRemainingSessionSeconds(persisted ? calculateRemainingSessionSeconds(persisted) : 0);
    };

    syncSession();
    const interval = window.setInterval(syncSession, 1000);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === sessionStorageKey) syncSession();
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('storage', handleStorage);
    };
  }, [sessionStorageKey, patient?.id]);

  const requestSessionStart = (nextAction: 'tab' | 'fullscreen' = 'tab') => {
    if (activeSession) {
      if (nextAction === 'fullscreen') setIsSessionModeOpen(true);
      else setActiveTab('session');
      return;
    }
    setPendingSessionAction(nextAction);
    setSessionDurationInput(String(configuredDefaultSessionMinutes));
    if (nextAction === 'tab') setActiveTab('session');
    setShowSessionStartConfirm(true);
  };

  const handleConfirmSessionStart = () => {
    const durationMinutes = Math.max(5, Math.min(240, Math.round(Number(sessionDurationInput) || configuredDefaultSessionMinutes)));
    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + durationMinutes * 60 * 1000);
    const nextSession = {
      id: `session-${String(patient?.id || 'patient')}-${startedAt.getTime()}`,
      patientId: patient?.id,
      patientName: patient?.name || 'Paciente',
      status: 'active',
      durationMinutes,
      startedAt: startedAt.toISOString(),
      endsAt: endsAt.toISOString(),
      referenceDate: startedAt.toISOString().slice(0, 10),
      recordCount: 0
    };
    persistActiveSession(nextSession);
    setShowSessionStartConfirm(false);
    onAddActivityLog?.(
      'Sessão iniciada',
      `Sessão de ${patient?.name || 'paciente'} iniciada com duração prevista de ${durationMinutes} minutos.`,
      'clinical'
    );
    if (pendingSessionAction === 'fullscreen') setIsSessionModeOpen(true);
  };

  const handleConfirmSessionEnd = () => {
    const endedSession = activeSession;
    clearActiveSession();
    setShowSessionEndConfirm(false);
    setIsSessionModeOpen(false);
    if (endedSession) {
      onAddNote?.(
        patient.id,
        `Sessão encerrada.\nInício: ${new Date(endedSession.startedAt).toLocaleString('pt-BR')}\nTérmino: ${new Date().toLocaleString('pt-BR')}\nRegistros nesta sessão: ${Number(endedSession.recordCount || 0)}`,
        'private',
        'Sessão'
      );
      onAddActivityLog?.(
        'Sessão encerrada',
        `Sessão de ${patient?.name || 'paciente'} encerrada com ${Number(endedSession.recordCount || 0)} registro(s).`,
        'clinical'
      );
    }
  };

  const incrementActiveSessionRecordCount = () => {
    if (!activeSession) return;
    persistActiveSession({
      ...activeSession,
      recordCount: Number(activeSession.recordCount || 0) + 1
    });
  };

  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");

  const [selectedChartProtocolId, setSelectedChartProtocolId] = useState(() => {
    if (isKidsProfile) {
      const vbmapp = protocols.find((p: any) => p.title.includes('VB-MAPP'));
      if (vbmapp) return vbmapp.id;
    }
    return protocols[0]?.id || '';
  });
  const [selectedSnapshotDate, setSelectedSnapshotDate] = useState("all");
  const isUuidLike = (value: unknown) =>
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

  const parseBirthDateToAge = (rawDate?: any): number | null => {
    if (!rawDate) return null;
    const parsed = new Date(String(rawDate));
    if (Number.isNaN(parsed.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - parsed.getFullYear();
    const monthDiff = today.getMonth() - parsed.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < parsed.getDate())) {
      age -= 1;
    }
    if (!Number.isFinite(age) || age < 0) return null;
    return age;
  };

  const patientAgeYears = useMemo(() => {
    const fromBirthDate =
      parseBirthDateToAge(patient?.birth_date) ||
      parseBirthDateToAge(patient?.dataNascimento) ||
      parseBirthDateToAge(patient?.anamnesisData?.dataNascimento);
    if (fromBirthDate !== null) return fromBirthDate;
    const numericAge = Number(patient?.age);
    if (Number.isFinite(numericAge) && numericAge >= 0) return numericAge;
    return null;
  }, [patient?.birth_date, patient?.dataNascimento, patient?.anamnesisData?.dataNascimento, patient?.age]);

  const mapAgeGroupToRange = (ageGroup?: string): { min: number; max: number | null } => {
    const group = String(ageGroup || '').toLowerCase();
    if (group === 'child') return { min: 0, max: 12 };
    if (group === 'teen') return { min: 13, max: 18 };
    if (group === 'adult') return { min: 19, max: 59 };
    if (group === 'senior') return { min: 60, max: null };
    return { min: 0, max: null };
  };

  useEffect(() => {
    const loadAssignedTasks = async () => {
      if (!patient?.id || patientAgeYears === null || patientAgeYears <= 12) {
        setAssignedTasks([]);
        return;
      }
      setIsLoadingAssignedTasks(true);
      try {
        const result = await dataService.getAssignedTasks(String(patient.id));
        if (result?.success && Array.isArray(result?.data)) {
          setAssignedTasks(result.data);
        } else {
          setAssignedTasks([]);
        }
      } catch (error) {
        console.error('Erro ao carregar tarefas atribuídas:', error);
        setAssignedTasks([]);
      } finally {
        setIsLoadingAssignedTasks(false);
      }
    };
    loadAssignedTasks();
  }, [patient?.id, patientAgeYears]);

  const resolveProtocolAgeRange = (protocol: any): { min: number; max: number | null } => {
    const explicitMin = Number(
      protocol?.min_age ??
      protocol?.age_minima ??
      protocol?.idade_minima
    );
    const explicitMax = Number(
      protocol?.max_age ??
      protocol?.age_maxima ??
      protocol?.idade_maxima
    );
    const hasExplicitMin = Number.isFinite(explicitMin) && explicitMin >= 0;
    const hasExplicitMax = Number.isFinite(explicitMax) && explicitMax >= 0;
    if (hasExplicitMin || hasExplicitMax) {
      return {
        min: hasExplicitMin ? explicitMin : 0,
        max: hasExplicitMax ? explicitMax : null
      };
    }
    return mapAgeGroupToRange(protocol?.ageGroup);
  };

  const isProtocolCompatibleWithPatient = (protocol: any): boolean => {
    if (!protocol) return false;
    if (patientAgeYears === null) return true;
    const range = resolveProtocolAgeRange(protocol);
    if (patientAgeYears < range.min) return false;
    if (range.max !== null && patientAgeYears > range.max) return false;
    return true;
  };

  const escapeHtml = (value: any) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  const refreshClinicDocumentMedia = async () => {
    const baseContext = clinicContext || {};
    const currentUserId = String(baseContext?.userId || "").trim();
    if (!currentUserId) return baseContext;

    try {
      const result = await dataService.getUserProfileMedia(currentUserId);
      if (!result?.success) return baseContext;

      const media = result?.data || {};
      const nextContext = {
        ...baseContext,
        logoUrl:
          String(media?.clinicLogoUrl || media?.profilePictureUrl || baseContext?.logoUrl || "").trim() ||
          baseContext?.logoUrl ||
          null,
        signatureUrl:
          String(media?.signatureUrl || baseContext?.signatureUrl || "").trim() ||
          baseContext?.signatureUrl ||
          null,
      };
      setResolvedClinicContext(nextContext);
      return nextContext;
    } catch (error) {
      console.warn("Falha ao renovar mídia da clínica para o documento.", error);
      return baseContext;
    }
  };

  const buildAnamnesisDocumentHtml = (anamnesis: any, fichaDateIso: string, contextOverride?: any) => {
    const c = contextOverride || resolvedClinicContext || clinicContext || {};
    const fieldLabelMap: Record<string, string> = {
      nome: "Nome completo",
      nomeSocial: "Nome social",
      dataNascimento: "Data de nascimento",
      idade: "Idade",
      genero: "Gênero",
      estadoCivil: "Estado civil",
      profissao: "Profissão",
      religiao: "Religião",
      telefone: "Telefone",
      email: "E-mail",
      endereco: "Endereço",
      cep: "CEP",
      logradouro: "Logradouro",
      numero: "Número",
      complemento: "Complemento",
      bairro: "Bairro",
      cidade: "Cidade",
      rg: "RG",
      cpf: "CPF",
      convenioTipo: "Tipo de convênio",
      convenioNome: "Convênio",
      convenioCarteirinha: "Número da carteirinha",
      grupo: "Grupo",
      comoConheceu: "Como conheceu a clínica",
      outrasInformacoes: "Outras informações",
      menorDeIdade: "Paciente menor de idade",
      responsavelNome: "Nome do responsável",
      responsavelDataNascimento: "Nascimento do responsável",
      responsavelCpf: "CPF do responsável",
      responsavelTelefone: "Telefone do responsável",
      profissional: "Profissional",
      crp: "CRP",
      formType: "Tipo de ficha",
    };

    const fallbackLabel = (key: string) =>
      key
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replaceAll("_", " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^./, (l) => l.toUpperCase());

    const normalizeValue = (key: string, value: any) => {
      if (value === null || value === undefined) return "";
      if (key === "menorDeIdade") return value ? "Sim" : "Não";
      if (key === "formType") {
        if (value === "adult") return "Adulto";
        if (value === "child") return "Criança";
        return String(value);
      }
      if (Array.isArray(value)) return value.join(", ");
      if (typeof value === "object") return "";
      return String(value);
    };

    const priorityFields = [
      "nome",
      "nomeSocial",
      "dataNascimento",
      "idade",
      "genero",
      "telefone",
      "email",
      "rg",
      "cpf",
      "convenioTipo",
      "convenioNome",
      "convenioCarteirinha",
      "grupo",
      "comoConheceu",
      "cep",
      "logradouro",
      "numero",
      "complemento",
      "bairro",
      "cidade",
      "endereco",
      "menorDeIdade",
      "responsavelNome",
      "responsavelDataNascimento",
      "responsavelCpf",
      "responsavelTelefone",
      "profissional",
      "crp",
      "formType",
    ];

    const dynamicLabelMap =
      anamnesis && typeof anamnesis.questionLabels === "object" ? anamnesis.questionLabels : {};
    const excludedKeys = new Set([
      "anamnesisTemplateVersion",
      "template_version",
      "template_snapshot",
      "questionLabels",
    ]);
    const rawEntries = Object.entries(anamnesis || {}).filter(
      ([key]) => !excludedKeys.has(key),
    );
    const prioritySet = new Set(priorityFields);
    const priorityEntries: Array<[string, any]> = [];
    const extraEntries: Array<[string, any]> = [];

    priorityFields.forEach((field) => {
      const found = rawEntries.find(([k]) => k === field);
      if (found) priorityEntries.push(found);
    });
    rawEntries.forEach((entry) => {
      if (!prioritySet.has(entry[0])) extraEntries.push(entry);
    });

    const orderedEntries = [...priorityEntries, ...extraEntries];
    const patientIdentityKeys = new Set([
      "nome",
      "nomeSocial",
      "dataNascimento",
      "idade",
      "genero",
      "estadoCivil",
      "profissao",
      "religiao",
      "telefone",
      "email",
      "rg",
      "cpf",
      "convenioTipo",
      "convenioNome",
      "convenioCarteirinha",
      "grupo",
      "comoConheceu",
      "cep",
      "logradouro",
      "numero",
      "complemento",
      "bairro",
      "cidade",
      "endereco",
      "menorDeIdade",
      "responsavelNome",
      "responsavelDataNascimento",
      "responsavelCpf",
      "responsavelTelefone",
      "formType",
    ]);
    const professionalKeys = new Set(["profissional", "crp"]);

    const buildRows = (entries: Array<[string, any]>) =>
      entries
        .map(([key, value]) => {
          const normalized = normalizeValue(key, value);
          if (!normalized.trim()) return "";
          const label = dynamicLabelMap[key] || fieldLabelMap[key] || fallbackLabel(key);
          return `
            <tr>
              <td style="padding:8px 10px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;color:#334155;width:35%;">${escapeHtml(label)}</td>
              <td style="padding:8px 10px;border:1px solid #e2e8f0;color:#0f172a;">${escapeHtml(normalized)}</td>
            </tr>`;
        })
        .filter(Boolean)
        .join("");

    const patientRows = buildRows(orderedEntries.filter(([key]) => patientIdentityKeys.has(key)));
    const professionalRows = buildRows(orderedEntries.filter(([key]) => professionalKeys.has(key)));
    const clinicalRows = buildRows(
      orderedEntries.filter(([key]) => !patientIdentityKeys.has(key) && !professionalKeys.has(key)),
    );

    const fichaDate = fichaDateIso
      ? new Date(`${fichaDateIso}T00:00:00`).toLocaleDateString("pt-BR")
      : new Date().toLocaleDateString("pt-BR");

    const professionalName =
      String(anamnesis?.profissional || c.professionalName || c.userName || '').trim() ||
      'Profissional responsável';
    const professionalCrp = String(anamnesis?.crp || c.crp || c.professionalCrp || '-').trim();
    const clinicAddress =
      String(c.address || '').trim() ||
      [c.street, c.number, c.complement, c.neighborhood, c.city].filter(Boolean).join(', ') ||
      '-';
    const fichaType = normalizeValue('formType', anamnesis?.formType || patient?.anamnesisData?.formType || '');

    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ficha de Anamnese - ${escapeHtml(patient?.name || "Paciente")}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; background: #f5f7ff; color: #0f172a; margin: 0; }
    .sheet { max-width: 960px; margin: 24px auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 12px 32px rgba(15,23,42,.08); }
    .header { padding: 22px 24px; background: linear-gradient(135deg,#eef2ff,#f8f5ff); border-bottom: 1px solid #e2e8f0; display:flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    .title { margin: 0 0 6px 0; font-size: 22px; color: #312e81; }
    .meta { margin: 2px 0; font-size: 13px; color: #475569; }
    .logo { width: 90px; height: 90px; object-fit: contain; border-radius: 12px; border: 1px solid #e2e8f0; background: #fff; padding: 8px; }
    .content { padding: 20px 24px; }
    .patient { margin: 0 0 14px 0; font-size: 13px; color: #334155; }
    .table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .th { padding: 9px 10px; border: 1px solid #e2e8f0; background: #f8fafc; font-weight: 700; color: #334155; width: 35%; vertical-align: top; }
    .td { padding: 9px 10px; border: 1px solid #e2e8f0; color: #0f172a; white-space: pre-wrap; }
    .footer { padding: 16px 24px; border-top: 1px solid #e2e8f0; display:flex; justify-content: space-between; align-items: flex-end; gap: 14px; }
    .signature { text-align: right; min-width: 240px; }
    .signature img { height: 46px; max-width: 220px; object-fit: contain; display:block; margin-left:auto; }
    .signature-line { margin-top: 6px; border-top: 1px solid #cbd5e1; padding-top: 4px; font-size: 11px; color: #64748b; }
    .note { margin: 0; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <h1 class="title">Ficha de Anamnese</h1>
        <p class="meta"><strong>Clínica:</strong> ${escapeHtml(c.clinicName || "Clínica Verto")}</p>
        <p class="meta"><strong>CNPJ:</strong> ${escapeHtml(c.cnpj || "-")}</p>
        <p class="meta"><strong>Endereço:</strong> ${escapeHtml(clinicAddress)}</p>
        <p class="meta"><strong>Profissional responsável:</strong> ${escapeHtml(professionalName)} | <strong>Registro:</strong> ${escapeHtml(professionalCrp)}</p>
      </div>
      <img src="${escapeHtml(c.logoUrl || buildInitialAvatarDataUrl(c.professionalName || patient?.name || 'Profissional'))}" class="logo" />
    </div>
    <div class="content">
      <p class="patient"><strong>Paciente:</strong> ${escapeHtml(patient?.name || "-")} | <strong>Data da ficha:</strong> ${escapeHtml(fichaDate)} | <strong>Tipo:</strong> ${escapeHtml(fichaType || '-')}</p>
      <h3 style="margin:10px 0 8px;font-size:15px;color:#312e81;">1. Informações cadastrais do paciente</h3>
      <table class="table">${patientRows || `<tr><td class="td">Sem dados cadastrais preenchidos.</td></tr>`}</table>
      <h3 style="margin:18px 0 8px;font-size:15px;color:#312e81;">2. Perguntas e respostas clínicas</h3>
      <table class="table">${clinicalRows || `<tr><td class="td">Sem respostas clínicas preenchidas.</td></tr>`}</table>
      ${professionalRows ? `<h3 style="margin:18px 0 8px;font-size:15px;color:#312e81;">3. Informações do profissional</h3><table class="table">${professionalRows}</table>` : ''}
    </div>
    <div class="footer">
      <div>
        <p class="note">Documento gerado automaticamente pela plataforma Verto.</p>
      </div>
      <div class="signature">
        ${c.signatureUrl ? `<img src="${escapeHtml(c.signatureUrl)}" />` : ""}
        <p class="signature-line">Assinatura profissional</p>
      </div>
    </div>
  </div>
</body>
</html>`;
  };

  const openPrintWindowForPdf = (htmlContent: string) => {
    const htmlBlob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const htmlUrl = URL.createObjectURL(htmlBlob);
    const printWindow = window.open(htmlUrl, "_blank", "noopener,noreferrer,width=1100,height=900");
    if (!printWindow) {
      alert("Não foi possível abrir a janela de impressão. Verifique se o bloqueador de pop-up está ativo.");
      URL.revokeObjectURL(htmlUrl);
      return;
    }
    const cleanupUrl = () => {
      try {
        URL.revokeObjectURL(htmlUrl);
      } catch {}
    };
    printWindow.onload = () => {
      try {
        printWindow.focus();
        printWindow.print();
      } finally {
        setTimeout(cleanupUrl, 1200);
      }
    };
  };

  const openAnamnesisPreviewWindow = (htmlContent: string) => {
    const htmlBlob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const htmlUrl = URL.createObjectURL(htmlBlob);
    const previewWindow = window.open(
      htmlUrl,
      "_blank",
      "noopener,noreferrer,width=1100,height=900",
    );
    if (!previewWindow) {
      alert("Não foi possível abrir a visualização. Verifique o bloqueador de pop-up.");
      URL.revokeObjectURL(htmlUrl);
      return;
    }
    previewWindow.onload = () => {
      setTimeout(() => {
        try {
          URL.revokeObjectURL(htmlUrl);
        } catch {
          // noop
        }
      }, 2000);
    };
  };

  const generatePdfBlobFromAnamnesisHtml = async (htmlContent: string) => {
    const { jsPDF } = await import('jspdf');
    const sandbox = document.createElement('div');
    sandbox.style.position = 'fixed';
    sandbox.style.left = '-10000px';
    sandbox.style.top = '0';
    sandbox.style.width = '794px';
    sandbox.style.zIndex = '-1';
    sandbox.innerHTML = htmlContent;
    document.body.appendChild(sandbox);
    const target = (sandbox.querySelector('.sheet') as HTMLElement) || sandbox;

    try {
      const canvas = await html2canvas(target, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
        windowWidth: target.scrollWidth || 794,
      });

      const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 24;
      const contentWidth = pageWidth - margin * 2;
      const imgHeight = (canvas.height * contentWidth) / canvas.width;
      const imgData = canvas.toDataURL('image/png', 1.0);

      let heightLeft = imgHeight;
      let positionY = margin;
      pdf.addImage(imgData, 'PNG', margin, positionY, contentWidth, imgHeight);
      heightLeft -= (pageHeight - margin * 2);

      while (heightLeft > 0) {
        pdf.addPage();
        positionY = margin - (imgHeight - heightLeft);
        pdf.addImage(imgData, 'PNG', margin, positionY, contentWidth, imgHeight);
        heightLeft -= (pageHeight - margin * 2);
      }

      return new Blob([pdf.output('arraybuffer')], { type: 'application/pdf' });
    } finally {
      document.body.removeChild(sandbox);
    }
  };

  const availableSnapshots = useMemo(() => {
    const dates = (history || [])
      .filter((h: any) => h.patientId === patient.id && h.type === 'task' && h.score !== undefined)
      .map((h: any) => h.dateGroup);
    return Array.from(new Set(dates));
  }, [history, patient.id]);

  const patientCategory = useMemo(() => (isKidsProfile ? 'Criança' : 'Adulto'), [isKidsProfile]);

  const evaluationSkills = useMemo(() => {
    const skills: any[] = [];
    protocols.filter((p: any) => p.category === 'evaluation' || !p.category).forEach((p: any) => {
      p.data.forEach((domain: any) => {
        domain.skills.forEach((skill: any) => {
          skills.push({ id: skill.id, name: skill.name, protocol: p.title });
        });
      });
    });
    
    // Sort: Linked skills first
    return skills.sort((a, b) => {
      const aLinked = (patient.evaluationLinks && patient.evaluationLinks[a.name]) || (patient.interventionTaskLinks && patient.interventionTaskLinks[a.name]);
      const bLinked = (patient.evaluationLinks && patient.evaluationLinks[b.name]) || (patient.interventionTaskLinks && patient.interventionTaskLinks[b.name]);
      
      if (aLinked && !bLinked) return -1;
      if (!aLinked && bLinked) return 1;
      return 0;
    });
  }, [protocols, patient.evaluationLinks, patient.interventionTaskLinks]);

  const selectedProtocolMaxScore = useMemo(() => {
    const proto = protocols.find((p: any) => String(p.id) === String(selectedChartProtocolId));
    if (!proto) return 1;
    let max = 1;
    proto.data.forEach((domain: any) => {
      domain.skills.forEach((skill: any) => {
        if (skill.maxScore > max) max = skill.maxScore;
      });
    });
    return max;
  }, [protocols, selectedChartProtocolId]);

  const radarChartData = useMemo(() => {
    const selectedProto = protocols.find((p: any) => String(p.id) === String(selectedChartProtocolId));
    if (!selectedProto) return { labels: [], datasets: [] };

    const normalizeSkill = (value: any) =>
      String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    const isSameSkill = (a: string, b: string) => {
      const left = normalizeSkill(a);
      const right = normalizeSkill(b);
      if (!left || !right) return false;
      return left === right || left.includes(right) || right.includes(left);
    };

    const labels = selectedProto.data.map((d: any) => String(d?.name || '').trim()).filter(Boolean);

    const sourceHistory = (Array.isArray(history) ? history : [])
      .filter((h: any) => String(h?.patientId || h?.patient_id || '') === String(patient.id))
      .filter((h: any) => String(h?.type || '').toLowerCase() === 'task')
      .filter((h: any) => h?.score !== undefined && h?.score !== null)
      .map((h: any) => {
        const ts = new Date(h?.created_at || h?.date || 0).getTime() || 0;
        const score = Math.max(0, Math.min(1, Number(h?.score ?? 0) || 0));
        return { ...h, _ts: ts, _score: score, _titleKey: normalizeSkill(String(h?.title || '')) };
      })
      .sort((a: any, b: any) => a._ts - b._ts);

    const isVbMappProtocol = /vb[\s-]?mapp/i.test(String(selectedProto?.title || ''));
    const vbmappCriterion = Number((selectedProto as any)?.masteryCriterion ?? (selectedProto as any)?.vbmapp_mastery_criterion ?? 5) || 5;

    const getDomainPercent = (domain: any, mode: 'first' | 'latest') => {
      const domainTasks = (Array.isArray(domain?.skills) ? domain.skills : [])
        .map((s: any) => ({
          name: String(s?.name || '').trim(),
          maxScore: Math.max(1, Number(s?.maxScore ?? s?.max_score ?? 1) || 1)
        }))
        .filter((s: any) => s.name);
      if (!domainTasks.length) return 0;
      const domainEvents = sourceHistory
        .filter((row: any) => domainTasks.some((task: any) => isSameSkill(task.name, String(row?.title || ''))))
        .map((row: any) => ({
          title: row?.title || '',
          score: row?._score,
          maxScore: 1,
          consecutive_successes: row?.consecutive_successes,
          created_at: row?.created_at || row?.date || null
        }));
      return calculateDomainMastery(domainEvents, domainTasks, {
        mode: mode === 'first' ? 'baseline' : 'latest',
        protocolKind: isVbMappProtocol ? 'vbmapp' : 'other',
        vbmappMasteryCriterion: vbmappCriterion
      });
    };

    const currentData = selectedProto.data.map((domain: any) => getDomainPercent(domain, 'latest'));

    if (selectedSnapshotDate === "all") {
      return {
        labels,
        datasets: [
          {
            label: 'Intervenção Atual',
            data: currentData,
            backgroundColor: 'rgba(67, 24, 255, 0.25)',
            borderColor: '#7a32fc',
            pointBackgroundColor: '#7a32fc',
            borderWidth: 4
          }
        ]
      };
    }

    const baselineData = selectedProto.data.map((domain: any) => getDomainPercent(domain, 'first'));
    return {
      labels,
      datasets: [
        {
          label: `Avaliação ${selectedSnapshotDate}`,
          data: baselineData,
          backgroundColor: 'rgba(5, 205, 153, 0.35)',
          borderColor: '#05CD99',
          pointBackgroundColor: '#05CD99',
          borderWidth: 4
        },
        {
          label: 'Intervenção Atual',
          data: currentData,
          backgroundColor: 'rgba(122, 50, 252, 0.25)',
          borderColor: '#7a32fc',
          pointBackgroundColor: '#7a32fc',
          borderWidth: 4
        }
      ]
    };
  }, [history, protocols, patient.id, selectedChartProtocolId, selectedSnapshotDate]);

  const safeProtocols = protocols || []; 
  useEffect(() => {
    let cancelled = false;

    const loadApprovedVertoProtocols = async () => {
      try {
        const response = await fetch('/api/protocol-import-requests', { credentials: 'include' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) return;
        if (!cancelled) {
          setApprovedVertoProtocolStatuses(
            (Array.isArray(data.data) ? data.data : [])
              .filter((item: any) => String(item.status || '').toLowerCase() === 'approved')
          );
        }
      } catch {
        if (!cancelled) setApprovedVertoProtocolStatuses([]);
      }
    };

    loadApprovedVertoProtocols();
    return () => {
      cancelled = true;
    };
  }, []);

  const planProtocolCatalog = useMemo(() => {
    const catalog = new Map<string, any>();
    const addProtocol = (protocol: any) => {
      if (!protocol || !Array.isArray(protocol.data) || protocol.data.length === 0) return;
      const key = String(protocol.canonicalKey || protocol.id || protocol.title || '').trim();
      if (!key || catalog.has(key)) return;
      catalog.set(key, protocol);
    };

    safeProtocols.forEach(addProtocol);
    approvedVertoProtocolStatuses.forEach((request: any) => {
      const canonicalProtocol: any = getApprovedVertoCanonicalProtocol(request);
      if (!canonicalProtocol) return;
      addProtocol({
        ...canonicalProtocol,
        id: canonicalProtocol.id || canonicalProtocol.canonicalKey || `approved-verto-${request.id}`,
        isApprovedImport: true,
        importRequestId: request.id,
        requestStatus: 'approved'
      });
    });

    return Array.from(catalog.values());
  }, [safeProtocols, approvedVertoProtocolStatuses]);

  const ageCompatibleProtocols = useMemo(() => {
    return planProtocolCatalog.filter((p: any) => p?.isApprovedImport || isProtocolCompatibleWithPatient(p));
  }, [planProtocolCatalog, patientAgeYears]);

  const filteredProtocols = useMemo(() => { 
    return ageCompatibleProtocols.filter((p: any) => { 
      const matchAge = filterAge ? (p.ageGroup === filterAge || p.ageGroup === 'all') : true; 
      const matchType = filterType ? p.type === filterType : true; 
      const matchDomain = filterDomain ? (p.domain && p.domain.toLowerCase().includes(filterDomain.toLowerCase())) : true; 
      return matchAge && matchType && matchDomain; 
    }); 
  }, [ageCompatibleProtocols, filterAge, filterType, filterDomain]); 

  const selectedProtocol = planProtocolCatalog.find((p: any) => String(p.id) === String(selectedProtocolId)); 
  const selectedDomain = selectedProtocol?.data.find((d: any) => String(d.id) === String(selectedDomainId)); 
  const targetProtocol = planProtocolCatalog.find((p: any) => String(p.id) === String(targetProtocolId)); 
  const targetDomain = targetProtocol?.data.find((d: any) => String(d.id) === String(targetDomainId)); 

  useEffect(() => {
    if (!selectedProtocolId || selectedProtocolId === 'pei-goals') return;
    const selected = planProtocolCatalog.find((p: any) => String(p.id) === String(selectedProtocolId));
    if (!selected) return;
    if (!selected?.isApprovedImport && !isProtocolCompatibleWithPatient(selected)) {
      alert('Este protocolo não é recomendado para a faixa etária do paciente');
      setSelectedProtocolId('');
      setSelectedDomainId('');
      setSelectedSkillId('');
    }
  }, [selectedProtocolId, planProtocolCatalog, patientAgeYears]);

  useEffect(() => { 
    if (!isCreatingNewTask && selectedSkillId && selectedDomain) { 
      const skill = selectedDomain.skills.find((s: any) => String(s.id) === String(selectedSkillId)); 
      if (skill) { setFinalTaskTitle(skill.name); setFinalTaskSubtitle(skill.objective || ""); } 
    } 
  }, [selectedSkillId, selectedDomain, isCreatingNewTask]); 

  useEffect(() => { 
    if (isCreatingNewTask) { setFinalTaskTitle(newTaskName); setFinalTaskSubtitle(newTaskObjective); } 
  }, [newTaskName, newTaskObjective, isCreatingNewTask]); 

  const historyWithFamilyNotes = useMemo(() => {
    const baseHistory = Array.isArray(history) ? history : [];
    if (!isKidsProfile) return baseHistory;

    const milestoneBySource = new Map<string, { awarded: boolean; timestamp: number }>();
    (Array.isArray(notes) ? notes : []).forEach((n: any) => {
      const subject = String(n?.subject || '').trim().toLowerCase();
      const text = String(n?.text || '').trim();
      const isMilestoneEvent = subject === 'milestone_event' || text.startsWith('MILESTONE_EVENT|');
      if (!isMilestoneEvent) return;
      const sourceMatch = text.match(/source=([^|]+)/i);
      const awardedMatch = text.match(/awarded=([01])/i);
      const sourceRef = String(sourceMatch?.[1] || '').trim();
      if (!sourceRef) return;
      const awarded = String(awardedMatch?.[1] || '0') === '1';
      const ts = new Date(n?.created_at || n?.date || 0).getTime() || 0;
      const current = milestoneBySource.get(sourceRef);
      if (!current || ts >= current.timestamp) {
        milestoneBySource.set(sourceRef, { awarded, timestamp: ts });
      }
    });

    const familyNotes = (Array.isArray(notes) ? notes : [])
      .filter((n: any) => {
        const visibility = String(n?.visibility || n?.type || '').toLowerCase();
        const subject = String(n?.subject || '').toLowerCase();
        const text = String(n?.text || '').toLowerCase();
        return (
          visibility === 'family' ||
          subject.includes('fam') ||
          text.includes('registro da família') ||
          text.includes('registro da familia')
        );
      })
      .map((n: any) => {
        const rawText = String(n?.text || '');
        const hasStarMarker = /\[STAR\]/i.test(rawText) || /\u2b50|⭐/.test(String(n?.subject || ''));
        const normalizedText = rawText
          .replace(/\[STAR\]/gi, '')
          .replace(/^🏠\s*registro da fam[ií]lia\s*\n?/i, '')
          .trim();
        const createdAt = n?.created_at || n?.date || new Date().toISOString();
        const dateObj = new Date(createdAt);
        const dateGroup = Number.isNaN(dateObj.getTime())
          ? 'Hoje'
          : dateObj.toLocaleDateString('pt-BR');
        return {
          id: `note-family-${n?.id}`,
          sourceRef: `note-family-${n?.id}`,
          patientId: n?.patientId ?? n?.patient_id ?? patient?.id,
          type: 'family_note',
          title: 'Registro da Família',
          note: normalizedText || rawText,
          image:
            n?.image ||
            n?.image_url ||
            n?.imageUrl ||
            n?.photo ||
            n?.photo_url ||
            n?.photoUrl ||
            null,
          icon: '🏠',
          score:
            milestoneBySource.get(`note-family-${n?.id}`)?.awarded
              ? 1
              : hasStarMarker
                ? 1
                : (Number.isFinite(Number(n?.score)) ? Number(n.score) : 0),
          milestoneAwarded: Boolean(milestoneBySource.get(`note-family-${n?.id}`)?.awarded),
          dateGroup,
          date: createdAt,
          time: Number.isNaN(dateObj.getTime())
            ? ''
            : dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isFromNotes: true
        };
      });

    const normalizeMergeKey = (note: any, date: any) =>
      `${String(note || '').trim().toLowerCase()}::${String(date || '').trim()}`;

    const byKey = new Map<string, any>();
    baseHistory.forEach((h: any) => {
      const key = normalizeMergeKey(h?.note, h?.date || h?.created_at);
      byKey.set(key, h);
    });

    familyNotes.forEach((entry: any) => {
      const key = normalizeMergeKey(entry?.note, entry?.date);
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, entry);
        return;
      }
      const merged = {
        ...current,
        // Preserve family enrichment when duplicated with history rows
        image: current?.image || entry?.image || null,
        subject: current?.subject || entry?.subject,
        score: Math.max(Number(current?.score ?? 0) || 0, Number(entry?.score ?? 0) || 0),
        milestoneAwarded:
          Boolean(current?.milestoneAwarded) ||
          Boolean(entry?.milestoneAwarded) ||
          Boolean(milestoneBySource.get(String(current?.sourceRef || current?.id || ''))?.awarded),
        type:
          current?.type === 'family_note' || current?.type === 'photo'
            ? current?.type
            : entry?.type || current?.type
      };
      byKey.set(key, merged);
    });

    const mergedValues = Array.from(byKey.values()).map((item: any) => {
      const sourceRef = String(item?.sourceRef || item?.id || '');
      const eventAwarded = Boolean(milestoneBySource.get(sourceRef)?.awarded);
      const hasMarker = /\[STAR\]/i.test(String(item?.note || item?.text || '')) || /\u2b50|⭐/.test(String(item?.subject || ''));
      return {
        ...item,
        milestoneAwarded: Boolean(item?.milestoneAwarded) || eventAwarded,
        score: (Boolean(item?.milestoneAwarded) || eventAwarded || hasMarker || Number(item?.score ?? 0) >= 1) ? 1 : Number(item?.score ?? 0)
      };
    });

    return mergedValues.sort((a: any, b: any) => {
      const aTs = new Date(a?.date || a?.created_at || 0).getTime();
      const bTs = new Date(b?.date || b?.created_at || 0).getTime();
      return bTs - aTs;
    });
  }, [history, notes, isKidsProfile, patient?.id]);

  const normalizeNoteText = (value: string) =>
    String(value || '')
      .replace(/ðŸ“/g, '📝')
      .replace(/ðŸŽ¯/g, '🎯')
      .replace(/ðŸ /g, '🏠')
      .replace(/PontuaÃ§Ã£o/g, 'Pontuação')
      .replace(/AnotaÃ§Ãµes/g, 'Anotações')
      .replace(/observaÃ§Ã£o/gi, 'observação')
      .replace(/famÃ­lia/gi, 'família')
      .replace(/sessÃ£o/gi, 'sessão')
      .replace(/avaliaÃ§Ã£o/gi, 'avaliação')
      .replace(/Ã¡/g, 'á')
      .replace(/Ã©/g, 'é')
      .replace(/Ã­/g, 'í')
      .replace(/Ã³/g, 'ó')
      .replace(/Ãº/g, 'ú')
      .replace(/Ã£/g, 'ã')
      .replace(/Ã§/g, 'ç')
      .replace(/Â/g, '')
      .trim();

  const isSystemMilestoneEvent = (note: any) => {
    const subject = String(note?.subject || '').trim().toLowerCase();
    const text = String(note?.text || '').trim();
    return subject === 'milestone_event' || text.startsWith('MILESTONE_EVENT|');
  };

  const kidsReportSelectableNotes = useMemo(() => {
    if (!isKidsProfile) return [];
    const targetPatientId = String(patient?.id || '').trim();
    return (Array.isArray(notes) ? notes : []).filter((n: any) => {
      if (isSystemMilestoneEvent(n)) return false;
      const notePatientId = String(n?.patientId ?? n?.patient_id ?? '').trim();
      return notePatientId !== '' && notePatientId === targetPatientId;
    });
  }, [isKidsProfile, notes, patient?.id]);

  const resolveFamilyImageForNote = (note: any) => {
    if (!note) return null;
    const normalizedText = String(note?.text || '')
      .replace(/^🏠\s*registro da fam[ií]lia\s*\n?/i, '')
      .trim()
      .toLowerCase();
    if (!normalizedText) return null;
    const match = (historyWithFamilyNotes || []).find((h: any) => {
      if (!(h?.type === 'family_note' || h?.type === 'photo')) return false;
      const hText = String(h?.note || '').trim().toLowerCase();
      return hText === normalizedText && Boolean(h?.image || h?.image_url || h?.imageUrl || h?.photo || h?.photo_url || h?.photoUrl);
    });
    if (!match) return null;
    return match?.image || match?.image_url || match?.imageUrl || match?.photo || match?.photo_url || match?.photoUrl || null;
  };

  const kidsMilestoneStars = useMemo(() => {
    if (!isKidsProfile) return 0;
    return (historyWithFamilyNotes || []).filter((h: any) => {
      const isFamily = h?.type === 'family_note' || h?.type === 'photo';
      const hasStarMarker = /\u2b50|⭐/.test(String(h?.subject || '')) || /\[STAR\]/i.test(String(h?.note || h?.text || ''));
      return isFamily && (Number(h?.score ?? 0) >= 1 || hasStarMarker);
    }).length;
  }, [isKidsProfile, historyWithFamilyNotes]);

  const groupedHistory = (historyWithFamilyNotes || []).reduce((groups: any, item: any) => { const group = groups[item.dateGroup] || []; group.push(item); groups[item.dateGroup] = group; return groups; }, {}); 
  const sortedDateKeys = Object.keys(groupedHistory).sort((a, b) => { if (a === "Hoje") return -1; if (b === "Hoje") return 1; if (a === "Ontem") return -1; if (b === "Ontem") return 1; return b.localeCompare(a); }); 
  
  const filteredNotes = useMemo(() => {
    return (notes || []).filter((n: any) => {
      if (isSystemMilestoneEvent(n)) return false;
      const matchPatient = n.patientId === patient.id;
      const matchVisibility = (n.visibility || n.type || 'private') === noteMode;
      
      const searchLower = noteSearchQuery.toLowerCase();
      const matchSearch = !noteSearchQuery || 
        normalizeNoteText(n.text).toLowerCase().includes(searchLower) || 
        (n.subject && n.subject.toLowerCase().includes(searchLower));
        
      const matchSubject = !noteSubjectFilter || (n.subject && n.subject.toLowerCase().includes(noteSubjectFilter.toLowerCase()));
      
      // Date format in notes is "DD/MM/YYYY • HH:mm"
      // noteDateFilter is "YYYY-MM-DD"
      let matchDate = true;
      if (noteDateFilter) {
        const [y, m, d] = noteDateFilter.split('-');
        const formattedFilterDate = `${d}/${m}/${y}`;
        matchDate = n.date.startsWith(formattedFilterDate);
      }
      
      return matchPatient && matchVisibility && matchSearch && matchSubject && matchDate;
    });
  }, [notes, patient.id, noteMode, noteSearchQuery, noteSubjectFilter, noteDateFilter]);
  
  const handleAddNoteWithSubject = () => {
    if (newNote.trim()) {
      onAddNote(patient.id, newNote, noteMode, newNoteSubject);
      setNewNote("");
      setNewNoteSubject("");
    }
  };

  const comparisonChartData = useMemo(() => {
    const selectedProto = protocols.find((p: any) => String(p.id) === String(selectedChartProtocolId));
    if (!selectedProto) return [];

    const uniqueDates = Array.from(new Set((history || [])
      .filter((h: any) => h.patientId === patient.id && h.score !== undefined)
      .map((h: any) => h.dateGroup || h.date)
      .filter(Boolean)));
    const fallbackDates = uniqueDates.slice(0, 2);
    const d1 = comparisonDate1 || fallbackDates[0] || '';
    const d2 = comparisonDate2 || fallbackDates[1] || fallbackDates[0] || '';
    if (!d1 || !d2) return [];

    const normalizePercent = (score: number, maxScore: number) => {
      const safeMax = Math.max(1, Number(maxScore) || 1);
      const safeScore = Math.max(0, Math.min(safeMax, Number(score) || 0));
      return (safeScore / safeMax) * 100;
    };

    const getDomainScoresForDate = (date: string) => {
      const dateHistory = history.filter((h: any) => (h.dateGroup === date || h.date === date) && h.patientId === patient.id && h.score !== undefined);

      return selectedProto.data.map((domain: any) => {
        const latestBySkill = new Map<string, number>();
        const maxBySkill = new Map<string, number>();
        const domainSkills = domain.skills || [];

        dateHistory.forEach((h: any) => {
          const hTitle = String(h?.title || '').trim().toLowerCase();
          const skill = domainSkills.find((s: any) => String(s?.name || '').trim().toLowerCase() === hTitle);
          if (!skill) return;
          const key = String(skill.name);
          latestBySkill.set(key, Number(h?.score ?? 0) || 0);
          maxBySkill.set(key, Math.max(1, Number(skill?.maxScore ?? 1) || 1));
        });

        let obtained = 0;
        let possible = 0;
        latestBySkill.forEach((score, key) => {
          const skillMax = maxBySkill.get(key) || 1;
          obtained += Math.max(0, Math.min(skillMax, score));
          possible += skillMax;
        });
        if (possible <= 0) return 0;
        return Number(normalizePercent(obtained, possible).toFixed(2));
      });
    };

    const scores1 = getDomainScoresForDate(d1);
    const scores2 = getDomainScoresForDate(d2);

    const data = selectedProto.data.map((domain: any, idx: number) => ({
      name: domain.name,
      [d1]: scores1[idx] || 0,
      [d2]: scores2[idx] || 0
    }));

    return data;
  }, [history, protocols, selectedChartProtocolId, patient.id, comparisonDate1, comparisonDate2]);

  const toggleReportNote = (id: number) => {
    setSelectedReportNotes(prev => 
      prev.includes(id) ? prev.filter(nId => nId !== id) : [...prev, id]
    );
  };

  const resolvePeriodStart = (period: string): Date => {
    const now = new Date();
    const start = new Date(now);
    if (period === 'monthly') start.setMonth(start.getMonth() - 1);
    else if (period === 'bimonthly') start.setMonth(start.getMonth() - 2);
    else if (period === 'quarterly') start.setMonth(start.getMonth() - 3);
    else if (period === 'semiannual') start.setMonth(start.getMonth() - 6);
    else start.setFullYear(start.getFullYear() - 1);
    return start;
  };
  const periodLabelByValue: Record<string, string> = {
    monthly: 'Mensal',
    bimonthly: 'Bimestral',
    quarterly: 'Trimestral',
    semiannual: 'Semestral',
    annual: 'Anual'
  };

  const adultCompletedTasks = useMemo(() => {
    return (assignedTasks || [])
      .filter((task: any) => String(task?.status || '').toLowerCase() === 'completed')
      .map((task: any) => {
        const taskData = task?.task_data && typeof task.task_data === 'object' ? task.task_data : {};
        const eventDateRaw = task?.completed_at || task?.reviewed_at || task?.scheduled_at || task?.created_at;
        const eventDate = eventDateRaw ? new Date(eventDateRaw) : new Date();
        const safeMaxScore = Math.max(
          1,
          Number(taskData?.maxScore ?? taskData?.max_score ?? task?.max_score ?? 4) || 4
        );
        return {
          ...task,
          taskData,
          eventDate,
          eventDateRaw,
          taskTitle: String(taskData?.title || task?.title || 'Tarefa'),
          taskType: String(task?.task_type || task?.type || 'task'),
          maxScore: safeMaxScore,
          patientEffort: Number(task?.patient_effort ?? 0) || 0,
          patientComment: String(task?.patient_comment || ''),
          professionalScore: task?.pro_score === null || task?.pro_score === undefined ? null : Number(task.pro_score),
          evolutionNote: String(task?.pro_review_note || '')
        };
      })
      .sort((a: any, b: any) => b.eventDate.getTime() - a.eventDate.getTime());
  }, [assignedTasks]);

  const adultScheduledTasks = useMemo(() => {
    if (isKidsProfile) return [];

    const fromPatientTasks = (patientTasks || []).map((task: any) => {
      const scheduledAt = task?.scheduledAt || task?.scheduled_at || task?.created_at || new Date().toISOString();
      const date = new Date(scheduledAt);
      return {
        id: String(task?.id || `local-${scheduledAt}-${task?.title || ''}`),
        title: String(task?.title || 'Tarefa'),
        description: String(task?.description || ''),
        type: String(task?.type || task?.task_type || 'task'),
        scheduledAt,
        eventDate: Number.isNaN(date.getTime()) ? new Date() : date,
        source: 'local'
      };
    });

    const fromAssigned = (assignedTasks || [])
      .filter((task: any) => String(task?.status || 'pending').toLowerCase() !== 'completed')
      .map((task: any) => {
        const taskData = task?.task_data && typeof task.task_data === 'object' ? task.task_data : {};
        const scheduledAt = task?.scheduled_at || task?.created_at || new Date().toISOString();
        const date = new Date(scheduledAt);
        return {
          id: String(task?.id || `assigned-${scheduledAt}`),
          title: String(taskData?.title || task?.title || 'Tarefa'),
          description: String(taskData?.description || task?.description || ''),
          type: String(task?.task_type || task?.type || 'task'),
          scheduledAt,
          eventDate: Number.isNaN(date.getTime()) ? new Date() : date,
          source: 'server'
        };
      });

    const mergedMap = new Map<string, any>();
    [...fromPatientTasks, ...fromAssigned].forEach((task) => {
      mergedMap.set(String(task.id), task);
    });

    return Array.from(mergedMap.values()).sort((a: any, b: any) => a.eventDate.getTime() - b.eventDate.getTime());
  }, [patientTasks, assignedTasks, isKidsProfile]);

  const selectedChartProtocol = useMemo(
    () => protocols.find((p: any) => String(p.id) === String(selectedChartProtocolId)),
    [protocols, selectedChartProtocolId]
  );

  const resolveTaskProtocol = (task: any) => {
    const taskData = task?.taskData && typeof task.taskData === 'object' ? task.taskData : {};
    const explicitProtocolId = String(
      taskData?.protocolId ||
      taskData?.protocol_id ||
      task?.protocol_id ||
      ''
    ).trim();
    if (explicitProtocolId) {
      const byId = (protocols || []).find((p: any) => String(p?.id) === explicitProtocolId);
      if (byId) return byId;
    }

    const explicitProtocolName = String(
      taskData?.protocolTitle ||
      taskData?.protocol_name ||
      task?.protocol_name ||
      ''
    ).trim().toLowerCase();
    if (explicitProtocolName) {
      const byTitle = (protocols || []).find(
        (p: any) => String(p?.title || '').trim().toLowerCase() === explicitProtocolName
      );
      if (byTitle) return byTitle;
    }

    const normalizedTitle = String(task?.taskTitle || '').trim().toLowerCase();
    if (!normalizedTitle) return null;
    for (const protocol of protocols || []) {
      for (const domain of protocol?.data || []) {
        const found = (domain?.skills || []).find(
          (skill: any) => String(skill?.name || '').trim().toLowerCase() === normalizedTitle
        );
        if (found) return protocol;
      }
    }
    return null;
  };

  const adultProtocolTasks = useMemo(() => {
    if (isKidsProfile || !selectedChartProtocol) return [];
    return adultCompletedTasks.filter((task: any) => {
      const protocol = resolveTaskProtocol(task);
      return protocol && String(protocol.id) === String(selectedChartProtocol.id);
    });
  }, [adultCompletedTasks, selectedChartProtocol, isKidsProfile, protocols]);

  const toDateKey = (value: any) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  };

  const adultProtocolSnapshotDates = useMemo(() => {
    if (isKidsProfile) return [];
    const unique = Array.from(
      new Set<string>(
        adultProtocolTasks
          .map((task: any) => toDateKey(task?.eventDateRaw || task?.eventDate))
          .filter((value): value is string => Boolean(value))
      )
    ).sort((a, b) => a.localeCompare(b));

    return unique.map((key) => {
      const [y, m, d] = key.split('-');
      return { key, label: `${d}/${m}/${y}` };
    });
  }, [adultProtocolTasks, isKidsProfile]);

  useEffect(() => {
    if (isKidsProfile) return;
    if (!adultProtocolSnapshotDates.length) {
      setComparisonDate1('');
      setComparisonDate2('');
      return;
    }
    const baseKey = adultProtocolSnapshotDates[0]?.key || '';
    const compareKey = adultProtocolSnapshotDates[adultProtocolSnapshotDates.length - 1]?.key || baseKey;
    setComparisonDate1((prev) => (prev && adultProtocolSnapshotDates.some((d) => d.key === prev) ? prev : baseKey));
    setComparisonDate2((prev) => (prev && adultProtocolSnapshotDates.some((d) => d.key === prev) ? prev : compareKey));
  }, [adultProtocolSnapshotDates, isKidsProfile, selectedChartProtocolId]);

  const adultPeriodStart = useMemo(() => resolvePeriodStart(reportPeriod), [reportPeriod]);
  const adultTasksInPeriod = useMemo(() => {
    if (isKidsProfile) return [];
    return adultProtocolTasks.filter((task: any) => task.eventDate >= adultPeriodStart);
  }, [adultProtocolTasks, adultPeriodStart, isKidsProfile]);

  useEffect(() => {
    if (isKidsProfile) return;
    setSelectedAdultEvolutionIds(adultTasksInPeriod.map((task: any) => String(task.id)));
  }, [adultTasksInPeriod, isKidsProfile, patient?.id]);

  const toggleAdultEvolutionSelection = (taskId: string) => {
    setSelectedAdultEvolutionIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  };

  const adultEvolutionSelectedTasks = useMemo(() => {
    const selectedIds = new Set(selectedAdultEvolutionIds.map(String));
    return adultTasksInPeriod.filter((task: any) => selectedIds.has(String(task.id)));
  }, [adultTasksInPeriod, selectedAdultEvolutionIds]);

  const adultReportSnapshotDates = useMemo(() => {
    if (isKidsProfile) return [];
    const unique = Array.from(
      new Set<string>(
        adultTasksInPeriod
          .map((task: any) => toDateKey(task?.eventDateRaw || task?.eventDate))
          .filter((value): value is string => Boolean(value))
      )
    ).sort((a, b) => a.localeCompare(b));
    return unique.map((key) => {
      const [y, m, d] = key.split('-');
      return { key, label: `${d}/${m}/${y}` };
    });
  }, [adultTasksInPeriod, isKidsProfile]);

  useEffect(() => {
    if (isKidsProfile) return;
    if (!adultReportSnapshotDates.length) {
      setAdultReportDate1('');
      setAdultReportDate2('');
      return;
    }
    const baseKey = adultReportSnapshotDates[0]?.key || '';
    const compareKey = adultReportSnapshotDates[adultReportSnapshotDates.length - 1]?.key || baseKey;
    setAdultReportDate1((prev) => (prev && adultReportSnapshotDates.some((d) => d.key === prev) ? prev : baseKey));
    setAdultReportDate2((prev) => (prev && adultReportSnapshotDates.some((d) => d.key === prev) ? prev : compareKey));
  }, [adultReportSnapshotDates, isKidsProfile, reportPeriod, selectedChartProtocolId]);

  const adultDomainComparisonData = useMemo(() => {
    if (isKidsProfile || !selectedChartProtocol) return [];
    if (!comparisonDate1 || !comparisonDate2) return [];

    const taskRows = adultProtocolTasks.map((task: any) => ({
      title: task?.taskTitle || '',
      professionalScore: task?.professionalScore,
      maxScore: task?.maxScore,
      consecutive_successes: task?.consecutiveSuccesses ?? task?.consecutive_successes,
      eventDateRaw: task?.eventDateRaw || task?.eventDate
    }));

    return (selectedChartProtocol.data || []).map((domain: any) => {
      const domainName = String(domain?.name || 'Sem domínio');
      const domainTasks = (domain?.skills || []).map((skill: any) => ({
        name: String(skill?.name || ''),
        maxScore: Math.max(1, Number(skill?.maxScore ?? skill?.max_score ?? 4) || 4)
      }));
      const isVbMappProtocol = /vb[\s-]?mapp/i.test(String(selectedChartProtocol?.title || ''));
      const vbmappCriterion = Number((selectedChartProtocol as any)?.masteryCriterion ?? (selectedChartProtocol as any)?.vbmapp_mastery_criterion ?? 5) || 5;
      const d1 = calculateDomainMastery(taskRows, domainTasks, {
        mode: 'latest',
        periodStart: `${comparisonDate1}T00:00:00`,
        periodEnd: `${comparisonDate1}T23:59:59.999`,
        protocolKind: isVbMappProtocol ? 'vbmapp' : 'other',
        vbmappMasteryCriterion: vbmappCriterion
      });
      const d2 = calculateDomainMastery(taskRows, domainTasks, {
        mode: 'latest',
        periodStart: `${comparisonDate2}T00:00:00`,
        periodEnd: `${comparisonDate2}T23:59:59.999`,
        protocolKind: isVbMappProtocol ? 'vbmapp' : 'other',
        vbmappMasteryCriterion: vbmappCriterion
      });
      return {
        name: domainName,
        [comparisonDate1]: d1,
        [comparisonDate2]: d2
      };
    });
  }, [isKidsProfile, selectedChartProtocol, comparisonDate1, comparisonDate2, adultProtocolTasks]);

  const adultReportDomainComparisonData = useMemo(() => {
    if (isKidsProfile || !selectedChartProtocol) return [];
    if (!adultReportDate1 || !adultReportDate2) return [];

    const taskRows = adultTasksInPeriod.map((task: any) => ({
      title: task?.taskTitle || '',
      professionalScore: task?.professionalScore,
      maxScore: task?.maxScore,
      consecutive_successes: task?.consecutiveSuccesses ?? task?.consecutive_successes,
      eventDateRaw: task?.eventDateRaw || task?.eventDate
    }));

    return (selectedChartProtocol.data || []).map((domain: any) => {
      const domainName = String(domain?.name || 'Sem domínio');
      const domainTasks = (domain?.skills || []).map((skill: any) => ({
        name: String(skill?.name || ''),
        maxScore: Math.max(1, Number(skill?.maxScore ?? skill?.max_score ?? 4) || 4)
      }));
      const isVbMappProtocol = /vb[\s-]?mapp/i.test(String(selectedChartProtocol?.title || ''));
      const vbmappCriterion = Number((selectedChartProtocol as any)?.masteryCriterion ?? (selectedChartProtocol as any)?.vbmapp_mastery_criterion ?? 5) || 5;
      const d1 = calculateDomainMastery(taskRows, domainTasks, {
        mode: 'latest',
        periodStart: `${adultReportDate1}T00:00:00`,
        periodEnd: `${adultReportDate1}T23:59:59.999`,
        protocolKind: isVbMappProtocol ? 'vbmapp' : 'other',
        vbmappMasteryCriterion: vbmappCriterion
      });
      const d2 = calculateDomainMastery(taskRows, domainTasks, {
        mode: 'latest',
        periodStart: `${adultReportDate2}T00:00:00`,
        periodEnd: `${adultReportDate2}T23:59:59.999`,
        protocolKind: isVbMappProtocol ? 'vbmapp' : 'other',
        vbmappMasteryCriterion: vbmappCriterion
      });
      return {
        name: domainName,
        [adultReportDate1]: d1,
        [adultReportDate2]: d2
      };
    });
  }, [isKidsProfile, selectedChartProtocol, adultReportDate1, adultReportDate2, adultTasksInPeriod]);
  
  const handleSchedule = async () => { 
    if (!scheduleDate || !scheduleTime) { alert("Selecione data e hora."); return; } 
    let scheduledAt; try { scheduledAt = new Date(`${scheduleDate}T${scheduleTime}`).toISOString(); } catch (e) { alert("Data inválida"); return; } 
    if (planType === 'task' || planType === 'intervention') { 
      if (selectedProtocolId && selectedProtocolId !== 'pei-goals') {
        const selected = planProtocolCatalog.find((p: any) => String(p.id) === String(selectedProtocolId));
        if (selected && !selected?.isApprovedImport && !isProtocolCompatibleWithPatient(selected)) {
          alert('Este protocolo não é recomendado para a faixa etária do paciente');
          return;
        }
      }
      const selectedSkillMaxScore = Number(
        selectedDomain?.skills?.find((s: any) => String(s.id) === String(selectedSkillId))?.maxScore ?? 4
      );
      const resolvedTaskMaxScore = isCreatingNewTask
        ? Math.max(1, Number(isKidsProfile ? newTaskMaxScore : 4) || 4)
        : Math.max(1, Number(selectedSkillMaxScore) || 4);
      const taskPayload = { 
        id: Date.now() + (isCreatingNewTask ? 1 : 0), 
        patientId: patient.id, 
        title: finalTaskTitle || newTaskName, 
        icon: planType === 'intervention' ? "✍️" : "📋",
        color: planType === 'intervention' ? "bg-green-100 text-green-600" : "bg-blue-100 text-blue-600", 
        completed: false, 
        type: planType, 
        scheduledAt: scheduledAt, 
        description: finalTaskSubtitle,
        maxScore: resolvedTaskMaxScore,
        noRealtimeScoring: !isKidsProfile,
        isDailyReminder: planType === 'intervention' ? isDailyReminder : false,
        linkedTask: planType === 'intervention' ? linkedTask : undefined,
        linkedProtocolId: planType === 'task' ? linkedInterventionProtocolId : undefined
      }; 
      if (planType === 'task' && linkedInterventionProtocolId) {
        const updatedPatient = {
          ...patient,
          evaluationLinks: {
            ...(patient.evaluationLinks || {}),
            [finalTaskTitle || newTaskName]: linkedInterventionProtocolId
          }
        };
        onUpdatePatient(updatedPatient);
      }
      if (planType === 'intervention' && linkedTask) {
        const updatedPatient = {
          ...patient,
          interventionTaskLinks: {
            ...(patient.interventionTaskLinks || {}),
            [linkedTask]: finalTaskTitle || newTaskName
          }
        };
        onUpdatePatient(updatedPatient);
      }
      if (isCreatingNewTask) { 
        if (!newTaskName) { alert("Digite o nome da tarefa."); return; } 
        let finalSkill = {
          id: Date.now(),
          name: newTaskName,
          code: newTaskCode,
          maxScore: isKidsProfile ? parseInt(newTaskMaxScore as any) : undefined,
          objective: newTaskObjective,
          example: newTaskExample,
          criteria: isKidsProfile ? newTaskCriteria : '',
          comment: newTaskComment
        }; 
        if (addToProtocolMode === 'existing') { 
          if (!targetProtocolId || !targetDomainId) { alert("Selecione onde salvar a tarefa."); return; } 
          const updatedProtocols = protocols.map((p: any) => { 
            if (p.id && String(p.id) === targetProtocolId) { 
              const updatedData = p.data.map((d: any) => { 
                if (d.id && String(d.id) === targetDomainId) { 
                  return { ...d, skills: [...d.skills, finalSkill] }; 
                } 
                return d; 
              }); 
              return { ...p, data: updatedData }; 
            } 
            return p; 
          }); 
          setProtocols(updatedProtocols); 
        } else { 
          if (!newProtocolName || !newDomainName) { alert("Preencha os dados do novo protocolo."); return; } 
          const inferredAgeGroup =
            patientAgeYears === null
              ? 'all'
              : patientAgeYears <= 12
                ? 'child'
                : patientAgeYears <= 18
                  ? 'teen'
                  : patientAgeYears <= 59
                    ? 'adult'
                    : 'senior';
          const minAge = patientAgeYears === null ? 0 : patientAgeYears;
          const maxAge = patientAgeYears === null ? null : patientAgeYears;
          const newProtocol = {
            id: Date.now(),
            title: newProtocolName,
            data: [{ id: `dom-${Date.now()}`, name: newDomainName, skills: [finalSkill] }],
            ageGroup: inferredAgeGroup,
            age_minima: minAge,
            age_maxima: maxAge,
            min_age: minAge,
            max_age: maxAge
          }; 
          setProtocols([...protocols, newProtocol]); 
        } 
      } else { if (!selectedSkillId) { alert("Selecione uma tarefa."); return; } } 
      if (isKidsProfile) {
        const saved = (await onAddTask(taskPayload)) !== false;
        if (!saved) return;
      } else {
        const assignedPayload = {
          patient_id: String(patient.id),
          patient_email: patient?.email || null,
          task_type: planType,
          scheduled_at: scheduledAt,
          status: 'pending' as const,
          task_data: {
            title: taskPayload.title,
            description: taskPayload.description || '',
            icon: taskPayload.icon || '📌',
            color: taskPayload.color || 'bg-blue-100 text-blue-600',
            linkedTask: planType === 'intervention' ? linkedTask || undefined : undefined,
            linkedProtocolId: planType === 'task' ? linkedInterventionProtocolId || undefined : undefined,
            maxScore: resolvedTaskMaxScore,
            noRealtimeScoring: true
          }
        };
        const saved = await dataService.addAssignedTask(assignedPayload);
        if (!saved?.success || !saved?.data) {
          alert(saved?.error || 'Não foi possível agendar a tarefa para o paciente.');
          return;
        }
        setAssignedTasks((prev) => [saved.data, ...(prev || [])]);
      }
    } else { 
      if (!message) { alert("Escreva uma mensagem."); return; } 
      if (isKidsProfile) {
        const saved = (await onAddTask({ id: Date.now(), patientId: patient.id, title: "Reforço Positivo", icon: "🌟", color: "bg-yellow-100 text-yellow-600", completed: false, type: 'reinforcement', scheduledAt: scheduledAt, description: message })) !== false;
        if (!saved) return;
      } else {
        const saved = await dataService.addAssignedTask({
          patient_id: String(patient.id),
          patient_email: patient?.email || null,
          task_type: 'reinforcement',
          scheduled_at: scheduledAt,
          status: 'pending',
          task_data: {
            title: 'Reforço Positivo',
            description: message,
            icon: '🌟',
            color: 'bg-yellow-100 text-yellow-600',
            maxScore: 1,
            noRealtimeScoring: true
          }
        });
        if (!saved?.success || !saved?.data) {
          alert(saved?.error || 'Não foi possível agendar o reforço para o paciente.');
          return;
        }
        setAssignedTasks((prev) => [saved.data, ...(prev || [])]);
      }
    } 
    setShowConfirmation(true); setMessage(''); setNewTaskName(''); setFinalTaskTitle(""); setFinalTaskSubtitle(""); setNewProtocolName(''); setNewDomainName(''); setNewTaskCode(''); setNewTaskObjective(''); setNewTaskExample(''); setNewTaskCriteria(''); setNewTaskComment(''); setSelectedProtocolId(''); setSelectedDomainId(''); setSelectedSkillId(''); setLinkedTask(''); setLinkedInterventionProtocolId('');
  }; 

  const pendingAssignedReviews = useMemo(
    () =>
      (assignedTasks || []).filter(
        (task: any) =>
          String(task?.status || '').toLowerCase() === 'completed' &&
          (task?.pro_score === null || task?.pro_score === undefined)
      ),
    [assignedTasks]
  );

  const reviewedAssignedTasks = useMemo(
    () =>
      (assignedTasks || []).filter(
        (task: any) =>
          String(task?.status || '').toLowerCase() === 'completed' &&
          task?.pro_score !== null &&
          task?.pro_score !== undefined
      ),
    [assignedTasks]
  );

  const handleAssignedReviewChange = (taskId: string, next: Partial<{ score: string; note: string }>) => {
    setAssignedReviewDrafts((prev) => ({
      ...prev,
      [taskId]: {
        score: next.score ?? prev[taskId]?.score ?? '',
        note: next.note ?? prev[taskId]?.note ?? ''
      }
    }));
  };

  const handleSubmitAssignedReview = async (task: any) => {
    const taskId = String(task?.id || '');
    if (!taskId) return;
    const draft = assignedReviewDrafts[taskId] || { score: '', note: '' };
    const taskData = task?.task_data && typeof task.task_data === 'object' ? task.task_data : {};
    const dynamicMaxScore = Math.max(1, Number(taskData?.maxScore ?? taskData?.max_score ?? 4) || 4);
    const numericScore = Number(draft.score);
    if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > dynamicMaxScore) {
      alert(`A pontuação profissional deve estar entre 0 e ${dynamicMaxScore}.`);
      return;
    }

    const result = await dataService.reviewAssignedTask(taskId, {
      pro_score: numericScore,
      pro_review_note: draft.note || '',
      max_score: dynamicMaxScore
    });
    if (!result?.success || !result?.data) {
      alert(result?.error || 'Não foi possível registrar a revisão profissional.');
      return;
    }

    setAssignedTasks((prev) => prev.map((item: any) => (String(item.id) === taskId ? result.data : item)));
    setAssignedReviewDrafts((prev) => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });

    if (result?.mastery_feedback?.protocol === 'VB-MAPP') {
      alert(result.mastery_feedback.progress_text || 'Sucesso consecutivo registrado no VB-MAPP.');
    }

    const suggestedTask = result?.suggestedTask;
    if (suggestedTask) {
      const suggestedTitle = String(suggestedTask?.task_data?.title || 'Intervenção sugerida');
      alert(`Sugestão clínica gerada: "${suggestedTitle}". Use "Plano Adulto" para Atribuir/Agendar manualmente ao paciente.`);
    }
  };

  const isFormValid = () => { 
    if (planType === 'task' || planType === 'intervention') { 
      if (isCreatingNewTask) return newTaskName && scheduleDate && scheduleTime; 
      return selectedSkillId && scheduleDate && scheduleTime; 
    } 
    return message && scheduleDate && scheduleTime; 
  }; 
  const handleSaveTaskEdit = () => { if (editingTask && editingTask.title) { onUpdateTask(editingTask.id, { title: editingTask.title, description: editingTask.description }); setEditingTask(null); } }; 
  const handleUpdateAnamnesis = (updatedData: any) => {
    if (isPreparingAnamnesisSave || showAnamnesisFileModal) return;
    setIsPreparingAnamnesisSave(true);
    const normalizedBirthDate = String(updatedData?.dataNascimento || '').trim();
    const normalizedCep = String(updatedData?.cep || '').trim();
    const normalizedAddress = {
      logradouro: String(updatedData?.logradouro || '').trim() || null,
      numero: String(updatedData?.numero || '').trim() || null,
      complemento: String(updatedData?.complemento || '').trim() || null,
      bairro: String(updatedData?.bairro || '').trim() || null,
      cidade: String(updatedData?.cidade || '').trim() || null,
    };
    const normalizedGuardian = Boolean(updatedData?.menorDeIdade)
      ? {
          nome: String(updatedData?.responsavelNome || '').trim() || null,
          dataNascimento: String(updatedData?.responsavelDataNascimento || '').trim() || null,
          cpf: String(updatedData?.responsavelCpf || '').trim() || null,
          telefone: String(updatedData?.responsavelTelefone || '').trim() || null,
        }
      : null;
    const recalculatedAge = calculateAgeFromBirthDate(normalizedBirthDate);
    if (onUpdatePatient) {
      onUpdatePatient({
        id: patient.id,
        name: String(updatedData?.nome || '').trim() || patient?.name,
        socialName: String(updatedData?.nomeSocial || '').trim() || null,
        phone: String(updatedData?.telefone || '').trim() || null,
        email: String(updatedData?.email || '').trim().toLowerCase() || null,
        cpf: String(updatedData?.cpf || '').trim() || null,
        age: typeof recalculatedAge === 'number' ? recalculatedAge : patient?.age,
        gender: String(updatedData?.genero || '').trim() || null,
        dataNascimento: normalizedBirthDate || null,
        birthDate: normalizedBirthDate || null,
        cep: normalizedCep || null,
        address: normalizedAddress,
        notes: String(updatedData?.outrasInformacoes || '').trim() || null,
        isMinor: Boolean(updatedData?.menorDeIdade),
        guardian: normalizedGuardian,
        diagnosis: updatedData.motivoConsulta,
        anamnesisData: updatedData,
        anamnesisPending: false,
        lastAnamnesisAt: new Date().toISOString()
      });
    }

    const fichePayload = buildAnamnesisDocumentHtml(updatedData, anamnesisFileDate);
    const defaultName = `Ficha_Anamnese_${patient.name.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`;
    setPendingAnamnesisPayload(fichePayload);
    setPendingAnamnesisData(updatedData);
    setAnamnesisFileName(defaultName);
    setAnamnesisFileDate(new Date().toISOString().slice(0, 10));
    setShowAnamnesis(false);
    setShowAnamnesisFileModal(true);
    setIsPreparingAnamnesisSave(false);
    onAddActivityLog?.(
      "Ficha de anamnese salva",
      `A ficha de anamnese do paciente ${patient.name} foi registrada e anexada aos arquivos do prontuário.`,
      "clinical",
    );
  }; 
  
  const handleUnlinkPatient = () => {
    if (onUpdatePatient) {
      // When unlinking, we keep the history but remove the clinic association
      onUpdatePatient({ 
        id: patient.id, 
        clinic_id: null, 
        status: 'unlinked',
        unlinkedAt: new Date().toISOString()
      });
      setIsUnlinkingModalOpen(false);
      onBack(); // Go back to dashboard
    }
  };
  
  const handleFileUpload = async (e: any) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsUploadingFile(true);
    setUploadProgress(0);
    setUploadProgress(25);
    try {
      const mimeType = String(file.type || 'application/octet-stream').trim() || 'application/octet-stream';
      const extensionByMime: Record<string, string> = {
        'application/pdf': '.pdf',
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/webp': '.webp',
        'text/plain': '.txt'
      };
      const hasExtension = /\.[a-z0-9]+$/i.test(file.name || '');
      const fallbackExtension = extensionByMime[mimeType] || '';
      const normalizedName = hasExtension
        ? String(file.name)
        : `${String(file.name || `arquivo_${Date.now()}`).replace(/\.+$/g, '')}${fallbackExtension}`;
      const fileBuffer = await file.arrayBuffer();
      const fileBlob = new Blob([fileBuffer], { type: mimeType });
      setUploadProgress(80);

      const uploadResult = await dataService.uploadPatientFile(String(patient.id), {
        fileName: normalizedName,
        contentType: mimeType,
        fileBlob,
        source: 'upload',
        metadata: {
          patientName: patient?.name || null
        }
      });
      if (!uploadResult?.success || !uploadResult?.data) {
        throw new Error(uploadResult?.warning || uploadResult?.error || 'Falha no upload');
      }
      const newFile = normalizeFileRecord(uploadResult.data);

      setPatientFiles((prev) => [newFile, ...prev]);
      setUploadProgress(100);
    } catch (error) {
      console.error('Falha ao salvar arquivo do paciente:', error);
      alert('Não foi possível salvar o arquivo. Tente novamente.');
    } finally {
      setTimeout(() => {
        setIsUploadingFile(false);
        setUploadProgress(0);
      }, 250);
    }
  };

  const handleRecordTrialWithConfirmation = (pid: any, goalId: any, title: string, score: number) => {
    if (!activeSession) {
      requestSessionStart('tab');
      return;
    }
    setPendingTrial({ pid, goalId, title, score });
    setLastRecordedGoalId(goalId);
    setTrialObservation("");
    setShowTrialConfirmation(true);
  };

  const handleUndoTrial = () => {
    setShowTrialConfirmation(false);
    setLastRecordedGoalId(null);
    setPendingTrial(null);
  };

  const handleSaveTrialObservation = () => {
    if (pendingTrial) {
      setIsSavingObservation(true);
      const sessionMeta = activeSession
        ? {
            sessionId: activeSession.id,
            sessionStartedAt: activeSession.startedAt,
            sessionReferenceDate: activeSession.referenceDate
          }
        : null;
      const newId = onRecordTrial(pendingTrial.pid, pendingTrial.title, pendingTrial.score, trialObservation, sessionMeta);
      setLastRecordedTrialId(newId);
      incrementActiveSessionRecordCount();
      
      setTimeout(() => {
        setIsSavingObservation(false);
        setShowTrialConfirmation(false);
        setLastRecordedGoalId(null);
        setPendingTrial(null);
      }, 500);
    } else {
      setShowTrialConfirmation(false);
      setLastRecordedGoalId(null);
    }
  };

  const removeFile = async (id: any) => {
      if (confirm("Deseja remover este arquivo?")) {
          const removeResult = await dataService.deletePatientFile(String(patient.id), String(id));
          if (!removeResult?.success) {
            alert(removeResult?.warning || removeResult?.error || 'Não foi possível excluir o arquivo.');
            return;
          }
          const nextFiles = patientFiles.filter((f: any) => String(f.id) !== String(id));
          setPatientFiles(nextFiles);
      }
  };

  const handleConfirmAnamnesisFile = () => {
    if (!pendingAnamnesisPayload) return;
    const fileName = (anamnesisFileName || `Ficha_Anamnese_${patient.name}`).trim();
    const normalizedName = fileName.toLowerCase().endsWith(".pdf")
      ? fileName
      : `${fileName.replace(/\.html?$/i, "")}.pdf`;
    const sizeKb = Math.max(1, Math.round(pendingAnamnesisPayload.length / 1024));
    const payloadDate = anamnesisFileDate
      ? new Date(`${anamnesisFileDate}T00:00:00`).toLocaleDateString("pt-BR")
      : new Date().toLocaleDateString("pt-BR");

    const persist = async () => {
      let uploadResult: any = null;
      let uploadErrorMessage = '';
      let generatedPdfBlob: Blob | null = null;
      const buildInlineFallbackFile = async (pdfBlob: Blob, documentHtml: string) => {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Falha ao preparar fallback local do PDF.'));
          reader.readAsDataURL(pdfBlob);
        });
        const fallbackFile = {
          id: `anamnesis_fallback_${Date.now()}`,
          patientId: String(patient.id),
          fileName: normalizedName,
          name: normalizedName,
          mimeType: 'application/pdf',
          type: 'application/pdf',
          sizeBytes: pdfBlob.size || Math.max(1, Math.round(documentHtml.length / 1024)),
          size: pdfBlob.size || Math.max(1, Math.round(documentHtml.length / 1024)),
          source: 'anamnesis',
          createdAt: new Date().toISOString(),
          metadata: {
            referenceDate: payloadDate,
            patientName: patient?.name || null,
            storageFallbackReason: uploadErrorMessage || 'Falha temporária em /api/patient-files.'
          },
          content: dataUrl,
          url: dataUrl,
          signedUrl: null
        };
        try {
          const existingRecord = await dataService.getPatientRecord(String(patient.id));
          const existingPayload =
            existingRecord?.data?.payload && typeof existingRecord.data.payload === 'object'
              ? existingRecord.data.payload
              : {};
          const existingFiles = Array.isArray(existingPayload?.files) ? existingPayload.files : [];
          await dataService.savePatientRecord(String(patient.id), {
            ...existingPayload,
            files: [
              fallbackFile,
              ...existingFiles.filter((file: any) => String(file?.id) !== fallbackFile.id)
            ]
          });
        } catch (fallbackError) {
          console.warn('Falha ao persistir fallback local da anamnese:', fallbackError);
        }
        return fallbackFile;
      };
      try {
        const freshClinicContext = await refreshClinicDocumentMedia();
        const documentHtml = buildAnamnesisDocumentHtml(
          pendingAnamnesisData || patient?.anamnesisData || {},
          anamnesisFileDate,
          freshClinicContext,
        );
        setPendingAnamnesisPayload(documentHtml);
        const pdfBlob = await generatePdfBlobFromAnamnesisHtml(documentHtml);
        generatedPdfBlob = pdfBlob;

        uploadResult = await dataService.uploadPatientFile(String(patient.id), {
          fileName: normalizedName,
          contentType: 'application/pdf',
          fileBlob: pdfBlob,
          source: 'anamnesis',
          metadata: { referenceDate: payloadDate, patientName: patient?.name || null }
        });
        if (!uploadResult?.success || !uploadResult?.data) {
          uploadErrorMessage = uploadResult?.warning || uploadResult?.error || 'Falha ao salvar a ficha em Arquivos.';
          uploadResult = {
            success: true,
            data: await buildInlineFallbackFile(pdfBlob, documentHtml),
            warning: uploadErrorMessage
          };
        }
      } catch (uploadError: any) {
        uploadErrorMessage = uploadError?.message || String(uploadError);
        if (generatedPdfBlob) {
          uploadResult = {
            success: true,
            data: await buildInlineFallbackFile(generatedPdfBlob, pendingAnamnesisPayload),
            warning: uploadErrorMessage
          };
        }
      }

      try {
        await dataService.savePatientAnamnesisSubmission(String(patient.id), {
          title: normalizedName,
          referenceDate: anamnesisFileDate,
          anamnesisData: pendingAnamnesisData || patient?.anamnesisData || {},
          templateVersion: Number(anamnesisTemplate?.version || 1),
          profileType: (pendingAnamnesisData?.formType || patient?.anamnesisData?.formType) === 'child' ? 'child' : 'adult',
          patientFileId: String(uploadResult?.data?.id || '')
        });
        if (uploadResult?.success && uploadResult?.data) {
          setPatientFiles((prev) => [normalizeFileRecord(uploadResult.data), ...prev]);
        }
        setShowAnamnesisFileModal(false);
        setPendingAnamnesisPayload("");
        setPendingAnamnesisData(null);
        setIsPreparingAnamnesisSave(false);
        setActiveTab(uploadResult?.success ? "files" : "history");
        if (uploadErrorMessage && !uploadResult?.success) {
          alert('Anamnese salva no banco de dados. Falha apenas no arquivo em Arquivos; você pode tentar novamente depois.');
        }
      } catch (error) {
        console.error('Falha ao persistir ficha de anamnese em arquivos:', error);
        alert('A ficha não foi perdida: os dados principais da anamnese foram mantidos. Tente salvar o arquivo novamente.');
      }
    };

    void persist();
  };

  const handleDownloadPatientFile = (file: any) => {
    const content = typeof file?.content === 'string' ? file.content : '';
    if (content.startsWith('data:application/pdf')) {
      const href = createObjectUrlFromDataUrl(content, 'application/pdf');
      const a = document.createElement("a");
      a.href = href;
      a.download = file.name || "arquivo.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => {
        try {
          if (href.startsWith('blob:')) URL.revokeObjectURL(href);
        } catch {}
      }, 1500);
      return;
    }

    if (file?.source === "anamnesis" && file?.content) {
      openPrintWindowForPdf(file.content);
      return;
    }

    const href = file.objectUrl || file.url;
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      a.download = file.name || "arquivo";
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    if (content) {
      const blob = new Blob([content], { type: file.type || "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name || "arquivo.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleDownloadReport = () => {
    if (!reportStartDate || !reportEndDate) {
      alert("Selecione o período para gerar o relatório.");
      return;
    }
    const start = new Date(reportStartDate);
    const end = new Date(reportEndDate);
    
    const reportData = notes.filter((n: any) => {
      if (isSystemMilestoneEvent(n)) return false;
      if (n.patientId !== patient.id) return false;
      const parts = n.date.split(' ')[0].split('/');
      const noteDate = new Date(parts[2], parts[1]-1, parts[0]);
      return noteDate >= start && noteDate <= end;
    });

    if (reportData.length === 0) {
      alert("Nenhum registro encontrado no período selecionado.");
      return;
    }

    let csvContent = "Data,Tipo,Anotacao\n";
    reportData.forEach((n: any) => {
      csvContent += `"${n.date}","${(n.visibility === 'patient' || n.type === 'shared') ? 'Paciente' : (n.visibility === 'professional' || n.type === 'professional') ? 'Profissional' : 'Privada'}","${normalizeNoteText(n.text).replace(/"/g, '""')}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `Relatorio_Evolucao_${patient.name}_${reportStartDate}_a_${reportEndDate}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleGenerateAdultEvolutionReport = async () => {
    if (isKidsProfile) return;
    if (!adultDomainComparisonData.length) {
      alert('Não há dados suficientes no período para gerar o relatório adulto.');
      return;
    }
    setIsGeneratingAdultReport(true);
    try {
      const periodStart = adultPeriodStart.toLocaleDateString('pt-BR');
      const periodEnd = new Date().toLocaleDateString('pt-BR');
      const selectedNotes = adultEvolutionSelectedTasks;
      const plainTextLines = [
        `Relatório de Evolução Adulto - ${patient?.name || 'Paciente'}`,
        `Período: ${periodStart} até ${periodEnd}`,
        '',
        'Comparativo por domínio (% Proficiência - Avaliação Inicial x Intervenção Atual):',
        ...adultDomainComparisonData.map((item: any) =>
          `${item.name}: Inicial ${item['Avaliação Inicial']}% | Atual ${item['Intervenção Atual']}%`
        ),
        '',
        'Anotações de evolução selecionadas:',
        ...(selectedNotes.length
          ? selectedNotes.map((task: any) =>
              `- ${task.taskTitle} | ${task.eventDate.toLocaleDateString('pt-BR')} | esforço ${task.patientEffort}% | nota ${task.professionalScore ?? '-'} / ${task.maxScore} (${normalizeScoreToPercent(task.professionalScore ?? 0, task.maxScore).toFixed(1)}%) | ${task.evolutionNote || 'Sem anotação'}`
            )
          : ['- Nenhuma anotação selecionada']),
        '',
        `Anotação adicional do relatório: ${reportAdditionalNote || 'Sem observação adicional.'}`
      ];

      const { jsPDF } = await import('jspdf');
      const pdfDoc = new jsPDF({ unit: 'pt', format: 'a4' });
      const lines = pdfDoc.splitTextToSize(plainTextLines.join('\n'), 520);
      pdfDoc.text(lines, 36, 48);
      const pdfBlob = new Blob([pdfDoc.output('arraybuffer')], { type: 'application/pdf' });
      const fileName = `Relatorio_Evolucao_Adulto_${String(patient?.name || 'paciente').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;

      const uploadResult = await dataService.uploadPatientFile(String(patient.id), {
        fileName,
        contentType: 'application/pdf',
        fileBlob: pdfBlob,
        source: 'report',
        metadata: {
          reportType: 'adult-evolution',
          period: reportPeriod
        }
      });
      if (!uploadResult?.success || !uploadResult?.data) {
        throw new Error(uploadResult?.error || uploadResult?.warning || 'Falha ao salvar PDF do relatório.');
      }

      setPatientFiles((prev) => [normalizeFileRecord(uploadResult.data), ...prev]);
      onAddActivityLog?.(
        'Relatório adulto gerado',
        `Relatório de evolução adulto de ${patient?.name || 'paciente'} gerado e salvo em Arquivos.`,
        'clinical'
      );
      alert('Relatório de evolução adulto gerado e salvo em Arquivos.');
    } catch (error: any) {
      console.error('Falha ao gerar relatório adulto:', error);
      alert('Não foi possível gerar o relatório adulto agora.');
    } finally {
      setIsGeneratingAdultReport(false);
    }
  };

  const getMasteryProgress = (skillName: string) => {
    if (patientCategory !== 'Criança') return null;
    const goal = patient.pei?.find((g: any) => g.name === skillName);
    const skillHistory = history
      .filter((h: any) => h.patientId === patient.id && h.title === skillName && h.type === 'task' && (!goal || h.id > goal.id))
      .sort((a: any, b: any) => b.id - a.id);
    
    let count = 0;
    for (const h of skillHistory) {
      if (h.score === 1) count++;
      else break;
    }
    return Math.min(count, 5);
  };

  const MasteryDots = ({ count, status }: { count: number, status?: string }) => {
    if (status === 'completed') {
      return (
        <div className="flex gap-1 items-center">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="w-2 h-2 rounded-full bg-green-500 shadow-sm shadow-green-200"></div>
          ))}
          <CheckCircle2 size={12} className="text-green-500 ml-1" />
        </div>
      );
    }
    return (
      <div className="flex gap-1 items-center">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={`w-2 h-2 rounded-full transition-all ${i <= count ? 'bg-[#7a32fc] scale-110 shadow-sm shadow-blue-200' : 'bg-gray-200'}`}></div>
        ))}
        <span className="text-[9px] font-semibold text-gray-400 ml-1 uppercase">{count}/5</span>
      </div>
    );
  };

  useEffect(() => {
    if (isTutorialActive) {
      if (tutorialStep >= 6 && isKidsProfile && canAccessTab('plan')) setActiveTab('plan');
      else if (tutorialStep >= 0) setActiveTab('history');
    }
  }, [isTutorialActive, tutorialStep, isKidsProfile, allowedTabsSet]);

  useEffect(() => {
    if (isTutorialActive) {
      if (tutorialStep >= 19) setActiveTab('files');
      else if (tutorialStep >= 17 && isKidsProfile && canAccessTab('session')) setActiveTab('session');
      else if (tutorialStep >= 14 && isKidsProfile && canAccessTab('plan')) setActiveTab('plan');
      else if (tutorialStep >= 11) setActiveTab('report');
      else if (tutorialStep >= 7) setActiveTab('notes');
      else if (tutorialStep >= 0) setActiveTab('history');
    }
  }, [isTutorialActive, tutorialStep, isKidsProfile, allowedTabsSet]);

  return ( 
    <div className="min-h-screen bg-gray-50 flex flex-col animate-slide-up relative overflow-y-auto"> 
      {isSessionModeOpen && (
        <SessionMode 
          patient={{ ...patient, history: history.filter((h: any) => h.patientId === patient.id) }} 
          onClose={() => setIsSessionModeOpen(false)} 
          onRecordTrial={onRecordTrial} 
          onDeleteHistoryItem={onDeleteHistoryItem}
          onUpdateHistoryItem={onEvaluateHistoryItem}
          activeSession={activeSession}
          remainingSeconds={remainingSessionSeconds}
          formatCountdown={formatSessionCountdown}
          onRequestEndSession={() => setShowSessionEndConfirm(true)}
          onSessionRecordSaved={incrementActiveSessionRecordCount}
        />
      )}
      {isTutorialActive && ( 
        <TutorialOverlay 
          steps={[
            { targetId: 'back-btn', title: 'Voltar ao Dashboard', content: 'Clique aqui para retornar Ã  tela principal a qualquer momento.', placement: 'bottom' },
            { targetId: 'patient-header-info', title: 'Informações do Paciente', content: 'Aqui você vê o nome, categoria (Criança/Adulto) e acessa o WhatsApp ou Ficha de Anamnese.', placement: 'bottom' },
            { targetId: 'tab-nav', title: 'Navegação por Abas', content: 'O prontuário é organizado em abas para facilitar o acesso a diferentes tipos de informação.', placement: 'bottom' },
            { targetId: 'tab-history', title: 'Aba Histórico', content: 'Veja a evolução clínica e o histórico de todas as atividades realizadas pelo paciente.', placement: 'bottom' },
            { targetId: 'history-filters', title: 'Filtros e Comparação', content: 'Filtre por protocolo ou data para comparar o desempenho em diferentes momentos.', placement: 'bottom' },
            { targetId: 'evolution-chart-container', title: 'Gráfico de Evolução', content: 'Visualize o progresso quantitativo através de gráficos de radar ou linha.', placement: 'bottom' },
            { targetId: 'history-item-0', title: 'Detalhes da Atividade', content: 'Clique nos cards de histórico para ver notas, áudios e vídeos enviados pela família.', placement: 'top' },
            { targetId: 'tab-notes', title: 'Aba Anotações', content: 'Registre suas observações clínicas, orientações para a família ou notas para a equipe.', placement: 'bottom' },
            { targetId: 'note-export-card', title: 'Exportar Histórico', content: 'Gere um arquivo CSV com todo o histórico de notas do paciente para o período selecionado.', placement: 'bottom' },
            { targetId: 'note-type-toggles', title: 'Tipos de Notas', content: 'Alterne entre notas Privadas, compartilhadas com o Paciente ou visíveis para a Equipe.', placement: 'bottom' },
            { targetId: 'note-input-area', title: 'Registro de Notas', content: 'Escolha o tipo de nota e salve suas observações. Você pode definir temas para facilitar a busca.', placement: 'top' },
            { targetId: 'tab-report', title: 'Aba Relatório', content: 'Gere relatórios automáticos de evolução com gráficos comparativos para os pais.', placement: 'bottom' },
            { targetId: 'report-config-card', title: 'Configurar Relatório', content: 'Selecione o período e as datas de comparação para gerar o gráfico de desempenho.', placement: 'bottom' },
            { targetId: 'report-download-btn', title: 'Gerar PDF', content: 'Clique aqui para gerar o relatório final com gráficos e observações selecionadas.', placement: 'top' },
            { targetId: 'tab-plan', title: 'Aba Plano', content: 'Aqui você define o Plano de Ensino Individualizado (PEI) e prescreve tarefas.', placement: 'bottom' },
            { targetId: 'new-schedule-card', title: 'Prescrever Atividade', content: 'Envie novas tarefas ou reforços positivos diretamente para o aplicativo do paciente.', placement: 'top' },
            { targetId: 'plan-type-toggles', title: 'Tipos de Envio', content: 'Alterne entre Tarefas Técnicas dos protocolos ou Reforços Positivos motivadores.', placement: 'top' },
            { targetId: 'tab-session', title: 'Aba Sessão', content: 'Use esta aba durante o atendimento presencial para registrar tentativas em tempo real.', placement: 'bottom' },
            { targetId: 'session-start-btn', title: 'Modo Sessão', content: 'Inicie o modo de registro rápido para pontuar metas prioritárias com apenas um clique.', placement: 'top' },
            { targetId: 'tab-files', title: 'Aba Arquivos', content: 'Armazene documentos, exames, laudos e fotos importantes do paciente com segurança.', placement: 'bottom' },
            { targetId: 'file-upload-btn', title: 'Upload de Arquivos', content: 'Arraste ou selecione arquivos para manter todo o prontuário digitalizado em um só lugar.', placement: 'top' }
          ]} 
          onClose={() => setTutorialStep(-1)} 
          currentStepIndex={tutorialStep} 
          onStepChange={setTutorialStep} 
        /> 
      )} 
      {showConfirmation && ( 
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm animate-fade-in"> 
          <div className="bg-white rounded-3xl p-8 shadow-2xl text-center max-w-sm animate-pop"> 
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600"><Activity size={32} /></div> 
            <h3 className="text-xl font-semibold text-gray-800 mb-2">Agendamento Confirmado!</h3> 
            <p className="text-gray-500 text-sm mb-6">A tarefa foi enviada para a agenda do paciente e salva no protocolo.</p> 
            <button onClick={() => setShowConfirmation(false)} className="w-full py-3 bg-gray-100 rounded-xl font-semibold text-gray-700 hover:bg-gray-200 transition-colors">Fechar</button> 
          </div> 
        </div> 
      )} 
      {showSessionStartConfirm && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-[32px] p-7 shadow-2xl max-w-md w-full animate-pop border border-violet-100">
            <div className="w-14 h-14 bg-[#7a32fc]/10 rounded-2xl flex items-center justify-center mb-5 text-[#7a32fc]">
              <Clock size={28} />
            </div>
            <h3 className="text-2xl font-semibold text-gray-900 mb-2">Iniciar sessão?</h3>
            <p className="text-sm text-gray-500 leading-relaxed mb-5">
              A contagem regressiva começa agora e continuará ativa mesmo se você abrir outras abas deste paciente.
            </p>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
              Tempo da sessão em minutos
            </label>
            <input
              type="number"
              min={5}
              max={240}
              value={sessionDurationInput}
              onChange={(event) => setSessionDurationInput(event.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-lg font-semibold text-gray-800 outline-none focus:border-[#7a32fc] mb-6"
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowSessionStartConfirm(false)}
                className="flex-1 py-3 rounded-2xl bg-gray-100 text-gray-600 font-semibold hover:bg-gray-200 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmSessionStart}
                className="flex-1 py-3 rounded-2xl bg-[#7a32fc] text-white font-semibold shadow-lg shadow-purple-500/20 hover:opacity-90 transition-all"
              >
                Iniciar sessão
              </button>
            </div>
          </div>
        </div>
      )}
      {showSessionEndConfirm && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-[32px] p-7 shadow-2xl max-w-md w-full animate-pop border border-red-100">
            <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mb-5 text-red-500">
              <StopCircle size={28} />
            </div>
            <h3 className="text-2xl font-semibold text-gray-900 mb-2">Encerrar sessão?</h3>
            <p className="text-sm text-gray-500 leading-relaxed mb-6">
              Os registros feitos nesta sessão já atualizam o histórico e os gráficos. Ao encerrar, a sessão deixa de aparecer como ativa.
            </p>
            <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4 mb-6">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Tempo restante</p>
              <p className="text-3xl font-semibold text-gray-900">{formatSessionCountdown(remainingSessionSeconds)}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowSessionEndConfirm(false)}
                className="flex-1 py-3 rounded-2xl bg-gray-100 text-gray-600 font-semibold hover:bg-gray-200 transition-all"
              >
                Continuar
              </button>
              <button
                onClick={handleConfirmSessionEnd}
                className="flex-1 py-3 rounded-2xl bg-red-500 text-white font-semibold shadow-lg shadow-red-500/20 hover:bg-red-600 transition-all"
              >
                Encerrar
              </button>
            </div>
          </div>
        </div>
      )}
      {editingTask && ( 
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-fade-in"> 
          <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl animate-pop relative"> 
            <div className="flex justify-between items-center mb-4"> 
              <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2"><Edit size={18} className="text-[#7551FF]"/> Editar Tarefa</h3> 
              <button onClick={() => setEditingTask(null)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button> 
            </div> 
            <div className="space-y-4"> 
              <div> <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Título da Tarefa</label> <input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-semibold text-gray-700 outline-none focus:border-[#7551FF] transition-colors" value={editingTask.title} onChange={(e) => setEditingTask({...editingTask, title: e.target.value})} /> </div> 
              <div> <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Subtítulo / Descrição</label> <textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-[#7551FF] transition-colors resize-none" rows={3} value={editingTask.description || ''} onChange={(e) => setEditingTask({...editingTask, description: e.target.value})} placeholder="Instruções para o paciente..."></textarea> </div> 
              <button onClick={handleSaveTaskEdit} className="w-full bg-[#7551FF] text-white font-semibold py-3 rounded-xl shadow-md hover:opacity-90 transition-all">Salvar Alterações</button> 
            </div> 
          </div> 
        </div> 
      )} 
      <AnamnesisModal
        isOpen={showAnamnesis}
        onClose={() => setShowAnamnesis(false)}
        initialData={anamnesisInitialData}
        onSave={handleUpdateAnamnesis}
        mode="edit"
        template={anamnesisTemplate}
      /> 
      
      {isUnlinkingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-[32px] p-8 shadow-2xl text-center max-w-sm animate-pop border border-red-50">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600">
              <EyeOff size={32} />
            </div>
            <h3 className="text-xl font-semibold text-gray-800 mb-2">Desvincular Paciente?</h3>
            <p className="text-gray-500 text-sm mb-6 leading-relaxed">
              O paciente será removido da sua lista, mas todo o <strong>histórico clínico e anotações</strong> serão preservados e poderão ser acessados por um novo profissional caso ele seja vinculado novamente.
            </p>
            <div className="flex flex-col gap-3">
              <button 
                onClick={handleUnlinkPatient} 
                className="w-full py-3 bg-red-500 text-white rounded-xl font-semibold shadow-lg shadow-red-200 hover:bg-red-600 transition-all"
              >
                Sim, Desvincular
              </button>
              <button 
                onClick={() => setIsUnlinkingModalOpen(false)} 
                className="w-full py-3 bg-gray-100 rounded-xl font-semibold text-gray-700 hover:bg-gray-200 transition-all"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white px-6 pt-6 pb-6 shadow-sm z-20"> 
        <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-4"> 
          <div className="flex items-center gap-4"> 
            {!hideBackButton && (
              <button id="back-btn" onClick={onBack} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 rounded-xl transition-all border border-slate-100 text-slate-400 hover:text-[#7a32fc] group">
                <ChevronLeft size={20} className="group-hover:-translate-x-0.5 transition-transform" />
                <span className="text-xs font-bold uppercase tracking-widest hidden sm:inline">Painel</span>
              </button>
            )}
            <div id="patient-header-info">
                <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-semibold text-gray-800 tracking-tight">{patient.name}</h1>
                </div>
                <p className="text-gray-500 text-xs">Detalhes do Paciente</p>
                {canManageTherapistAssignment && (
                  <div className="mt-2 flex items-center gap-2">
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      Terapeuta Responsável
                    </label>
                    <select
                      className="min-w-[220px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 outline-none focus:border-[#7551FF]"
                      value={selectedTherapistId}
                      onChange={(e) => handleTherapistAssignmentChange(e.target.value)}
                      disabled={isLoadingTherapists}
                    >
                      <option value="">{isLoadingTherapists ? 'Carregando terapeutas...' : 'Não atribuído'}</option>
                      {clinicTherapists.map((therapist: any) => (
                        <option key={String(therapist.id)} value={String(therapist.id)}>
                          {therapist.name || therapist.email || 'Terapeuta'}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
            </div> 
          </div> 
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <a 
              id="whatsapp-btn"
              href={`https://wa.me/${(patient.phone || '').replace(/\D/g, '')}`} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="flex-1 sm:flex-none bg-green-500 text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-lg shadow-green-200 hover:opacity-90 transition-all flex items-center justify-center gap-2"
            >
              <MessageCircle size={16} /> WhatsApp
            </a>
            {canOpenAnamnesis && (
              <button id="anamnesis-btn" onClick={() => setShowAnamnesis(true)} className="flex-1 sm:flex-none bg-[#F4F7FE] text-[#7a32fc] px-4 py-2.5 rounded-xl text-xs font-semibold hover:bg-[#7a32fc]/10 transition-colors flex items-center justify-center gap-2 border border-blue-100"> 
                <FileText size={16} /> Ficha Anamnese 
              </button>
            )}
            <button 
              onClick={() => setIsUnlinkingModalOpen(true)}
              className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
              title="Desvincular Paciente"
            >
              <EyeOff size={20} />
            </button>
          </div>
        </div> 
        <div id="tab-nav" className="flex gap-2 bg-gray-100 p-1 rounded-xl overflow-x-auto no-scrollbar"> 
          {canAccessTab('history') && <button id="tab-history" onClick={() => setActiveTab('history')} className={`shrink-0 flex-1 py-2 px-4 text-xs font-semibold rounded-lg transition-all ${activeTab === 'history' ? 'bg-white text-[#7551FF] shadow-sm' : 'text-gray-500'}`}>Histórico</button>}
          {canAccessTab('notes') && <button id="tab-notes" onClick={() => setActiveTab('notes')} className={`shrink-0 flex-1 py-2 px-4 text-xs font-semibold rounded-lg transition-all ${activeTab === 'notes' ? 'bg-white text-[#7551FF] shadow-sm' : 'text-gray-500'}`}>Anotações</button>}
          {canAccessTab('report') && <button id="tab-report" onClick={() => setActiveTab('report')} className={`shrink-0 flex-1 py-2 px-4 text-xs font-semibold rounded-lg transition-all ${activeTab === 'report' ? 'bg-white text-[#7551FF] shadow-sm' : 'text-gray-500'}`}>Relatório</button>}
          {canAccessTab('plan') && (
            <button
              id="tab-plan"
              onClick={() => setActiveTab('plan')}
              className={`shrink-0 flex-1 py-2 px-4 text-xs font-semibold rounded-lg transition-all ${activeTab === 'plan' ? 'bg-white text-[#7551FF] shadow-sm' : 'text-gray-500'}`}
            >
              {isKidsProfile ? 'Plano' : 'Plano Adulto'}
            </button>
          )}
          {canAccessTab('session') && isKidsProfile && (
            <button id="tab-session" onClick={() => requestSessionStart('tab')} className={`shrink-0 flex-1 py-2 px-4 text-xs font-semibold rounded-lg transition-all ${activeTab === 'session' ? 'bg-white text-[#7551FF] shadow-sm' : 'text-gray-500'}`}>Sessão</button>
          )}
          {canAccessTab('files') && <button id="tab-files" onClick={() => setActiveTab('files')} className={`shrink-0 flex-1 py-2 px-4 text-xs font-semibold rounded-lg transition-all ${activeTab === 'files' ? 'bg-white text-[#7551FF] shadow-sm' : 'text-gray-500'}`}>Arquivos</button>}
        </div> 
      </div> 
      <div className="p-6"> 
        {activeTab === 'history' ? ( 
          <div className="space-y-6"> 
            {isKidsProfile && (
              <div className="bg-white border border-amber-100 rounded-3xl p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Marcos validados pela clínica</p>
                    <p className="text-xs text-gray-500 mt-1">Cada foto da família validada com ⭐ conta para premiações clínicas.</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-extrabold text-amber-600">{kidsMilestoneStars} ⭐</p>
                  </div>
                </div>
              </div>
            )}
            {!isKidsProfile && (
              <div className="space-y-4 mb-6">
                <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm">
                  <p className="text-sm font-semibold text-gray-700">Histórico Adulto</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Comparativo por domínio do protocolo, entre duas datas selecionadas.
                  </p>
                </div>
                <div className="bg-white border border-gray-100 rounded-3xl p-4 sm:p-5 shadow-sm space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Protocolo</label>
                      <select
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl p-3 text-sm font-semibold text-gray-700 outline-none focus:border-[#4318FF]"
                        value={selectedChartProtocolId}
                        onChange={(e) => setSelectedChartProtocolId(e.target.value)}
                      >
                        {ageCompatibleProtocols.map((protocol: any) => (
                          <option key={protocol.id} value={protocol.id}>{protocol.title}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Data Base</label>
                      <select
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl p-3 text-sm font-semibold text-gray-700 outline-none focus:border-[#4318FF]"
                        value={comparisonDate1}
                        onChange={(e) => setComparisonDate1(e.target.value)}
                      >
                        <option value="">Selecione...</option>
                        {adultProtocolSnapshotDates.map((date: any) => (
                          <option key={`adult-date-base-${date.key}`} value={date.key}>{date.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Data Comparação</label>
                      <select
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl p-3 text-sm font-semibold text-gray-700 outline-none focus:border-[#4318FF]"
                        value={comparisonDate2}
                        onChange={(e) => setComparisonDate2(e.target.value)}
                      >
                        <option value="">Selecione...</option>
                        {adultProtocolSnapshotDates.map((date: any) => (
                          <option key={`adult-date-comp-${date.key}`} value={date.key}>{date.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="min-h-0 min-w-0">
                    <ComparisonBarChart
                      data={adultDomainComparisonData}
                      title={`Comparativo por Domínio (${selectedChartProtocol?.title || 'Protocolo'})`}
                      maxScore={100}
                    />
                  </div>
                </div>
              </div>
            )}
            {!isKidsProfile && (
              <div className="bg-white border border-gray-100 p-5 rounded-3xl shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-800 tracking-tight">Próximas Atividades Agendadas</h3>
                  <span className="text-[10px] font-semibold text-[#7a32fc] bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full uppercase tracking-wide">
                    Painel Profissional
                  </span>
                </div>
                {adultScheduledTasks.length > 0 ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {adultScheduledTasks.map((task: any) => (
                      <div key={`adult-home-${task.id}`} className="rounded-2xl border border-gray-100 bg-gradient-to-br from-white to-slate-50 px-4 py-3 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-800">{task.title}</p>
                            {task.description ? <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.description}</p> : null}
                          </div>
                          <span className={`text-[10px] font-semibold px-2 py-1 rounded-full uppercase ${task.type === 'reinforcement' ? 'bg-yellow-100 text-yellow-700' : task.type === 'intervention' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                            {task.type === 'reinforcement' ? 'Reforço' : task.type === 'intervention' ? 'Intervenção' : 'Avaliação'}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-2">
                          {task.eventDate.toLocaleDateString('pt-BR')} às {task.eventDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">Nenhuma atividade de casa cadastrada no momento.</p>
                )}
              </div>
            )}
            {!isKidsProfile && (
              <div className="bg-white border border-gray-100 p-5 rounded-3xl shadow-sm">
                <h3 className="text-sm font-semibold text-gray-800 tracking-tight mb-4">Histórico Adulto (Auditoria Clínica)</h3>
                {adultCompletedTasks.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">Sem eventos concluídos para exibir no histórico adulto.</p>
                ) : (
                  <div className="relative pl-8 border-l-2 border-indigo-100 ml-2 space-y-4">
                    {adultCompletedTasks.map((event: any) => (
                      <div key={`adult-history-${event.id}`} className="relative">
                        <div className="absolute -left-[39px] top-5 w-5 h-5 rounded-full bg-[#7551FF] border-4 border-white ring-2 ring-indigo-100"></div>
                        <div className="bg-gradient-to-br from-white to-slate-50 border border-gray-100 rounded-2xl p-5 space-y-2 shadow-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-lg font-semibold text-gray-800 tracking-tight">{event.taskTitle}</p>
                            <span className="text-[10px] font-semibold bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full uppercase tracking-wide">
                              {event.taskType === 'intervention' ? 'Intervenção' : event.taskType === 'reinforcement' ? 'Reforço' : 'Avaliação'}
                            </span>
                          </div>
                          <p className="text-sm text-gray-500">
                            Execução: {event.eventDate.toLocaleDateString('pt-BR')} às {event.eventDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                          <p className="text-sm text-gray-600">
                            Esforço percebido: <span className="font-semibold text-gray-800">{event.patientEffort}%</span>
                          </p>
                          <p className="text-sm text-gray-600">
                            Comentário do paciente: {event.patientComment || 'Sem comentário.'}
                          </p>
                          <p className="text-sm text-gray-600">
                            Nota final do profissional: <span className="font-semibold text-gray-800">{event.professionalScore ?? '-'} / {event.maxScore}</span>
                          </p>
                          <div className="bg-white border border-gray-100 rounded-xl p-3 mt-3">
                            <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Anotação de Evolução</p>
                            <p className="text-sm text-gray-700 whitespace-pre-wrap">{event.evolutionNote || 'Sem anotação técnica registrada.'}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {isKidsProfile ? (
              <React.Fragment>
                <div id="history-filters" className="bg-white/80 border border-gray-100 p-4 rounded-3xl shadow-sm mb-6 animate-fade-in">
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <div className="flex-1 w-full">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 flex items-center gap-2 ml-1">
                        <SlidersHorizontal size={12} className="text-[#7a32fc]"/> Protocolo Ativo
                      </label>
                      <div className="relative">
                        <select 
                          id="protocol-selector"
                          className="w-full bg-gray-50 border border-gray-100 text-sm font-semibold text-gray-700 px-4 py-3 rounded-2xl outline-none focus:border-[#7a32fc]/30 transition-all appearance-none"
                          value={selectedChartProtocolId}
                          onChange={(e) => setSelectedChartProtocolId(e.target.value)}
                        >
                          {protocols.map((p: any) => (
                            <option key={p.id} value={p.id}>{p.title}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
                      </div>
                    </div>
                    <div className="flex-1 w-full">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 flex items-center gap-2 ml-1">
                        <Calendar size={12} className="text-[#05CD99]"/> Ponto no Tempo
                      </label>
                      <div className="relative">
                        <select 
                          id="snapshot-selector"
                          className="w-full bg-gray-50 border border-gray-100 text-sm font-semibold text-gray-700 px-4 py-3 rounded-2xl outline-none focus:border-[#05CD99]/30 transition-all appearance-none"
                          value={selectedSnapshotDate}
                          onChange={(e) => setSelectedSnapshotDate(e.target.value)}
                        >
                          <option value="all">Visão Geral (Últimas Notas)</option>
                          {availableSnapshots.map((date: any) => (
                            <option key={date} value={date}>Avaliação de {date}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
                      </div>
                    </div>
                  </div>
                </div>
                <div id="evolution-chart-container" className="min-h-[320px] min-w-0">
                  <EvolutionBarChart chartData={radarChartData} maxScore={100} />
                </div>
              </React.Fragment>
            ) : null}
            {isKidsProfile && ((sortedDateKeys?.length || 0) > 0 ? sortedDateKeys.map((dateKey, gIdx) => ( 
              <div key={dateKey} className="relative pl-6 border-l-2 border-gray-200 ml-2"> 
                <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-[#7551FF] border-4 border-white ring-1 ring-gray-100"></div> 
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">{dateKey}</h3> 
                <div className="space-y-4"> 
                  {(groupedHistory[dateKey] || []).map((item: any, idx: number) => (
                    <HistoryCard 
                      id={gIdx === 0 && idx === 0 ? 'history-item-0' : ''} 
                      key={item.id} 
                      item={item} 
                      energyTags={ENERGY_TAGS} 
                      isTherapist={true} 
                      onEvaluate={onEvaluateHistoryItem} 
                      protocols={protocols} 
                      isKid={patientCategory === 'Criança'}
                      fullHistory={(history || []).filter((h: any) => h.patientId === patient.id)}
                      peiGoals={patient.pei || []}
                    />
                  ))} 
                </div> 
              </div> 
            )) : <p className="text-center text-gray-400 mt-10">Nenhum histórico disponível.</p>)} 
          </div> 
        ) : activeTab === 'notes' ? ( 
          <div className="space-y-4 animate-fade-in"> 
            <div id="note-export-card" className="bg-white border border-gray-200 p-5 rounded-[24px] shadow-sm mb-6 animate-fade-in">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="flex-1">
                  <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-tight mb-3 flex items-center gap-2">
                    <FileOutput size={14} className="text-[#7a32fc]" /> Exportar Relatório de Evolução
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-semibold text-gray-400 uppercase mb-1 ml-1">Início</label>
                      <input type="date" className="w-full bg-gray-50 border border-gray-100 rounded-xl p-2 text-xs outline-none focus:border-[#7a32fc] transition-all text-gray-700" value={reportStartDate} onChange={e => setReportStartDate(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[9px] font-semibold text-gray-400 uppercase mb-1 ml-1">Fim</label>
                      <input type="date" className="w-full bg-gray-50 border border-gray-100 rounded-xl p-2 text-xs outline-none focus:border-[#7a32fc] transition-all text-gray-700" value={reportEndDate} onChange={e => setReportEndDate(e.target.value)} />
                    </div>
                  </div>
                </div>
                <button 
                  id="note-export-btn"
                  onClick={handleDownloadReport}
                  className="bg-[#7a32fc] text-white font-semibold px-6 py-2.5 rounded-xl shadow-md shadow-[#7a32fc]/20 hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2 text-xs whitespace-nowrap"
                >
                  <Download size={16} /> Baixar .CSV
                </button>
              </div>
            </div>

            <div id="note-type-toggles" className="flex bg-gray-100 p-1 rounded-xl mb-4"> 
              <button onClick={() => setNoteMode('private')} className={`flex-1 py-2 text-[10px] font-semibold rounded-lg transition-all flex items-center justify-center gap-2 ${noteMode === 'private' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400'}`}><EyeOff size={12} /> Privadas</button> 
              <button onClick={() => setNoteMode('patient')} className={`flex-1 py-2 text-[10px] font-semibold rounded-lg transition-all flex items-center justify-center gap-2 ${noteMode === 'patient' ? 'bg-white text-[#7a32fc] shadow-sm' : 'text-gray-400'}`}><Share2 size={12} /> Paciente</button> 
              <button onClick={() => setNoteMode('professional')} className={`flex-1 py-2 text-[10px] font-semibold rounded-lg transition-all flex items-center justify-center gap-2 ${noteMode === 'professional' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400'}`}><SlidersHorizontal size={12} /> Profissionais</button> 
            </div> 

            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                {noteMode === 'private' ? <FileText size={16} className="text-gray-500"/> : noteMode === 'patient' ? <Share2 size={16} className="text-[#7a32fc]"/> : <SlidersHorizontal size={16} className="text-indigo-600"/>}
                {noteMode === 'private' ? "Nova Anotação Privada" : noteMode === 'patient' ? "Enviar para Paciente (Portátil)" : "Compartilhar com Profissionais (Portátil)"}
              </h3>
              <button id="note-filters-btn" onClick={() => setShowNoteFilters(!showNoteFilters)} className={`text-[10px] font-semibold px-3 py-1 rounded-full transition-all flex items-center gap-1 ${showNoteFilters ? 'bg-gray-200 text-gray-700' : 'bg-gray-100 text-gray-400'}`}>
                <Filter size={10} /> {showNoteFilters ? "Fechar Filtros" : "Filtrar Notas"}
              </button>
            </div>

            {showNoteFilters && (
              <div className="bg-white border border-gray-100 p-4 rounded-2xl shadow-sm mb-4 animate-slide-up space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-semibold text-gray-400 uppercase mb-1 ml-1">Data</label>
                    <input type="date" className="w-full bg-gray-50 border border-gray-100 rounded-xl p-2 text-xs outline-none focus:border-[#7a32fc]" value={noteDateFilter} onChange={e => setNoteDateFilter(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[9px] font-semibold text-gray-400 uppercase mb-1 ml-1">Assunto/Tema</label>
                    <input type="text" className="w-full bg-gray-50 border border-gray-100 rounded-xl p-2 text-xs outline-none focus:border-[#7a32fc]" placeholder="Ex: Evolução..." value={noteSubjectFilter} onChange={e => setNoteSubjectFilter(e.target.value)} />
                  </div>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                  <input type="text" className="w-full bg-gray-50 border border-gray-100 rounded-xl p-2 pl-9 text-xs outline-none focus:border-[#7a32fc]" placeholder="Palavra-chave no conteúdo..." value={noteSearchQuery} onChange={e => setNoteSearchQuery(e.target.value)} />
                </div>
                <button onClick={() => { setNoteSearchQuery(""); setNoteSubjectFilter(""); setNoteDateFilter(""); }} className="text-[9px] font-semibold text-[#7a32fc] uppercase tracking-wider hover:underline">Limpar Filtros</button>
              </div>
            )}

            <div id="note-input-area" className={`bg-white p-4 rounded-2xl shadow-sm border border-gray-100 transition-colors ${noteMode === 'patient' ? 'border-[#7a32fc]/20 bg-blue-50/30' : noteMode === 'professional' ? 'border-indigo-100 bg-indigo-50/30' : ''}`}> 
              <div className="mb-3">
                <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1 ml-1">Assunto / Tema</label>
                <input type="text" className="w-full bg-gray-50 rounded-xl p-2 text-xs outline-none border border-transparent focus:border-[#7551FF] focus:bg-white transition-all" placeholder="Ex: Comportamento, Evolução, Social..." value={newNoteSubject} onChange={e => setNewNoteSubject(e.target.value)} />
              </div>
              <textarea className="w-full h-24 bg-gray-50 rounded-xl p-3 text-sm outline-none border border-transparent focus:border-[#7551FF] focus:bg-white transition-all resize-none" placeholder={noteMode === 'private' ? "Digite observações clínicas..." : noteMode === 'patient' ? "Escreva uma orientação ou feedback (Portátil)..." : "Informações para outros profissionais (Portátil)..."} value={newNote} onChange={(e) => setNewNote(e.target.value)}></textarea> 
              <button onClick={handleAddNoteWithSubject} className={`w-full mt-3 text-white font-semibold py-3 rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2 ${noteMode === 'private' ? 'bg-[#7551FF]' : noteMode === 'patient' ? 'bg-[#7a32fc]' : 'bg-indigo-600'}`}>{noteMode === 'private' ? "Salvar Nota" : noteMode === 'patient' ? "Enviar Mensagem" : "Compartilhar com Equipe"}</button> 
            </div> 

            <div className="space-y-3"> 
              {filteredNotes.length > 0 ? (filteredNotes.map((note: any) => ( 
                <div key={note.id} className={`bg-white p-4 rounded-2xl border shadow-sm relative group transition-all ${(note.visibility === 'patient' || note.type === 'shared') ? 'border-[#7a32fc]/30 bg-blue-50/20' : (note.visibility === 'professional' || note.type === 'professional') ? 'border-indigo-200 bg-indigo-50/20' : 'border-gray-100'}`}> 
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase block">{note.date}</span>
                      {note.subject && <span className="text-[11px] font-semibold text-gray-700 mt-0.5 uppercase tracking-tight">#{note.subject}</span>}
                    </div>
                    <div className="flex gap-1">
                      {(note.visibility === 'private' || note.type === 'private' || !note.visibility) && (
                        <React.Fragment>
                          <button onClick={() => (window as any).handleToggleNoteTypeApp(note.id, 'patient')} className={`p-1.5 rounded-lg transition-all ${note.hasSharedCopy ? 'bg-[#7a32fc] text-white' : 'bg-gray-100 text-gray-400 hover:bg-blue-100 hover:text-[#7a32fc]'}`} title="Compartilhar com Paciente">
                            <Share2 size={14} />
                          </button>
                          <button onClick={() => (window as any).handleToggleNoteTypeApp(note.id, 'professional')} className={`p-1.5 rounded-lg transition-all ${note.hasProfessionalCopy ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400 hover:bg-indigo-100 hover:text-indigo-600'}`} title="Compartilhar com Profissionais">
                            <SlidersHorizontal size={14} />
                          </button>
                        </React.Fragment>
                      )}
                      {note.originalId && (
                        <button onClick={() => (window as any).handleToggleNoteTypeApp(note.id, note.visibility || note.type)} className="p-1.5 bg-red-50 text-red-400 rounded-lg hover:bg-red-100 transition-all" title="Remover Cópia">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div> 
                  <p className="text-sm text-gray-700 whitespace-pre-wrap mb-1">{normalizeNoteText(note.text)}</p> 
                  <div className="flex items-center gap-2 mt-2">
                    {(note.visibility === 'patient' || note.type === 'shared') && <span className="text-[9px] font-semibold bg-[#7a32fc] text-white px-2 py-0.5 rounded-full uppercase">Visível para Paciente (Portátil)</span>}
                    {(note.visibility === 'professional' || note.type === 'professional') && <span className="text-[9px] font-semibold bg-indigo-600 text-white px-2 py-0.5 rounded-full uppercase">Visível para Equipe (Portátil)</span>}
                    {note.hasSharedCopy && <span className="text-[9px] font-semibold bg-blue-100 text-[#7a32fc] px-2 py-0.5 rounded-full uppercase">Cópia no Paciente</span>}
                    {note.hasProfessionalCopy && <span className="text-[9px] font-semibold bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full uppercase">Cópia na Equipe</span>}
                  </div>
                </div> 
              ))) : (<p className="text-center text-gray-400 text-sm mt-10">Nenhuma anotação encontrada com os filtros atuais.</p>)} 
            </div> 
          </div> 
        ) : activeTab === 'report' ? (
          <div className="space-y-6 animate-fade-in">
            <div id="report-config-card" className="bg-white border border-gray-100 p-6 rounded-[32px] shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 bg-indigo-50 rounded-2xl text-[#7a32fc]">
                  <BarChart2 size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800 tracking-tight">Relatório de Progresso</h3>
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-widest">Análise Comparativa para Clínicas e Operadores</p>
                </div>
              </div>

              <div className={`grid grid-cols-1 ${isKidsProfile ? 'md:grid-cols-3' : 'md:grid-cols-4'} gap-4 mb-6`}>
                <div>
                  <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Período de Análise</label>
                  <select 
                    id="report-period-selector"
                    className="w-full bg-gray-50 border border-gray-100 rounded-xl p-3 text-sm font-semibold text-gray-700 outline-none focus:border-[#4318FF]"
                    value={reportPeriod}
                    onChange={(e) => setReportPeriod(e.target.value)}
                  >
                    <option value="monthly">Mensal</option>
                    <option value="bimonthly">Bimestral</option>
                    <option value="quarterly">Trimestral</option>
                    <option value="semiannual">Semestral</option>
                    <option value="annual">Anual</option>
                  </select>
                </div>
                {!isKidsProfile && (
                  <React.Fragment>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Protocolo</label>
                      <select
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl p-3 text-sm font-semibold text-gray-700 outline-none focus:border-[#4318FF]"
                        value={selectedChartProtocolId}
                        onChange={(e) => setSelectedChartProtocolId(e.target.value)}
                      >
                        {ageCompatibleProtocols.map((protocol: any) => (
                          <option key={protocol.id} value={protocol.id}>{protocol.title}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Data Base</label>
                      <select
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl p-3 text-sm font-semibold text-gray-700 outline-none focus:border-[#4318FF]"
                        value={adultReportDate1}
                        onChange={(e) => setAdultReportDate1(e.target.value)}
                      >
                        <option value="">Selecione...</option>
                        {adultReportSnapshotDates.map((date: any) => (
                          <option key={`adult-report-base-${date.key}`} value={date.key}>{date.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Data Comparação</label>
                      <select
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl p-3 text-sm font-semibold text-gray-700 outline-none focus:border-[#4318FF]"
                        value={adultReportDate2}
                        onChange={(e) => setAdultReportDate2(e.target.value)}
                      >
                        <option value="">Selecione...</option>
                        {adultReportSnapshotDates.map((date: any) => (
                          <option key={`adult-report-comp-${date.key}`} value={date.key}>{date.label}</option>
                        ))}
                      </select>
                    </div>
                  </React.Fragment>
                )}
                {isKidsProfile && (
                  <React.Fragment>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Data de Início (Base)</label>
                      <select 
                        id="report-date-1"
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl p-3 text-sm font-semibold text-gray-700 outline-none focus:border-[#4318FF]"
                        value={comparisonDate1}
                        onChange={(e) => setComparisonDate1(e.target.value)}
                      >
                        <option value="">Selecione...</option>
                        {availableSnapshots.map((date: any) => (
                          <option key={date} value={date}>{date}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Data de Comparação (Final)</label>
                      <select 
                        id="report-date-2"
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl p-3 text-sm font-semibold text-gray-700 outline-none focus:border-[#4318FF]"
                        value={comparisonDate2}
                        onChange={(e) => setComparisonDate2(e.target.value)}
                      >
                        <option value="">Selecione...</option>
                        {availableSnapshots.map((date: any) => (
                          <option key={date} value={date}>{date}</option>
                        ))}
                      </select>
                    </div>
                  </React.Fragment>
                )}
              </div>

              {isKidsProfile ? (
                <ComparisonBarChart 
                  data={comparisonChartData} 
                  title={`Comparativo de Domínios (%): ${comparisonDate1 || 'Base'} vs ${comparisonDate2 || 'Atual'}`} 
                  maxScore={100}
                />
              ) : (
                <ComparisonBarChart
                  data={adultReportDomainComparisonData}
                  title={`Relatório por Domínio (${selectedChartProtocol?.title || 'Protocolo'}) - ${periodLabelByValue[reportPeriod as keyof typeof periodLabelByValue] || 'Período'}`}
                  maxScore={100}
                />
              )}

              {isKidsProfile && selectedReportNotes.length > 0 && (
                <div className="mt-8 p-8 bg-gray-50 rounded-[32px] border border-gray-100 animate-fade-in">
                  <h4 className="text-sm font-semibold text-gray-800 uppercase tracking-tight mb-6 flex items-center gap-2">
                    <FileText size={18} className="text-[#7a32fc]" /> Observações Selecionadas para o Relatório
                  </h4>
                  <div className="space-y-4">
                    {kidsReportSelectableNotes.filter((n: any) => selectedReportNotes.includes(n.id)).map((note: any) => (
                      <div key={note.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-[10px] font-semibold text-gray-400 uppercase">{note.date}</span>
                          {note.subject && <span className="text-[10px] font-semibold text-[#7a32fc] uppercase tracking-widest">#{note.subject}</span>}
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{normalizeNoteText(note.text)}</p>
                        {resolveFamilyImageForNote(note) && (
                          <div className="mt-4 rounded-xl overflow-hidden border border-orange-100 bg-orange-50">
                            <SecureImage
                              src={resolveFamilyImageForNote(note)}
                              alt="Foto do registro da família"
                              className="w-full h-auto object-contain"
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!isKidsProfile && adultEvolutionSelectedTasks.length > 0 && (
                <div className="mt-8 p-8 bg-gray-50 rounded-[32px] border border-gray-100 animate-fade-in">
                  <h4 className="text-sm font-semibold text-gray-800 uppercase tracking-tight mb-6 flex items-center gap-2">
                    <FileText size={18} className="text-[#7a32fc]" /> Anotações de Evolução Selecionadas
                  </h4>
                  <div className="space-y-4">
                    {adultEvolutionSelectedTasks.map((task: any) => (
                      <div key={`selected-adult-note-${task.id}`} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[10px] font-semibold text-gray-400 uppercase">
                            {task.eventDate.toLocaleDateString('pt-BR')}
                          </span>
                          <span className="text-[10px] font-semibold text-indigo-600 uppercase tracking-widest">
                            Nota {task.professionalScore ?? '-'} / {task.maxScore}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-gray-800">{task.taskTitle}</p>
                        <p className="text-xs text-gray-600 mt-1">Esforço: {task.patientEffort}%</p>
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap mt-2">
                          {task.evolutionNote || 'Sem anotação técnica registrada.'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-8">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-tight flex items-center gap-2">
                    <FileText size={16} className="text-[#7a32fc]" /> {isKidsProfile ? 'Incluir Observações Clínicas' : 'Incluir Anotações de Evolução'}
                  </h4>
                  <span className="text-[10px] font-semibold text-gray-400 uppercase">
                    {isKidsProfile ? `${selectedReportNotes.length} selecionadas` : `${selectedAdultEvolutionIds.length} selecionadas`}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {isKidsProfile
                    ? kidsReportSelectableNotes.map((note: any) => (
                        <div
                          key={note.id}
                          onClick={() => toggleReportNote(note.id)}
                          className={`p-4 rounded-2xl border cursor-pointer transition-all ${selectedReportNotes.includes(note.id) ? 'border-[#7a32fc] bg-blue-50/50 shadow-sm' : 'border-gray-100 bg-gray-50 hover:bg-white hover:border-gray-200'}`}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <span className="text-[9px] font-semibold text-gray-400 uppercase">{note.date}</span>
                            {selectedReportNotes.includes(note.id) && <div className="w-2 h-2 rounded-full bg-[#7a32fc]"></div>}
                          </div>
                          <p className="text-xs text-gray-600 line-clamp-3">{normalizeNoteText(note.text)}</p>
                        </div>
                      ))
                    : adultTasksInPeriod.map((task: any) => {
                        const selected = selectedAdultEvolutionIds.includes(String(task.id));
                        return (
                          <div
                            key={`adult-evo-select-${task.id}`}
                            onClick={() => toggleAdultEvolutionSelection(String(task.id))}
                            className={`p-4 rounded-2xl border cursor-pointer transition-all ${selected ? 'border-[#7a32fc] bg-blue-50/50 shadow-sm' : 'border-gray-100 bg-gray-50 hover:bg-white hover:border-gray-200'}`}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <span className="text-[9px] font-semibold text-gray-400 uppercase">
                                {task.eventDate.toLocaleDateString('pt-BR')}
                              </span>
                              {selected && <div className="w-2 h-2 rounded-full bg-[#7a32fc]"></div>}
                            </div>
                            <p className="text-xs font-semibold text-gray-700">{task.taskTitle}</p>
                            <p className="text-[11px] text-gray-500 mt-1">Esforço {task.patientEffort}% • Nota {task.professionalScore ?? '-'} / {task.maxScore}</p>
                            <p className="text-xs text-gray-600 line-clamp-2 mt-1">{task.evolutionNote || 'Sem anotação técnica.'}</p>
                          </div>
                        );
                      })}
                </div>
              </div>
              {!isKidsProfile && (
                <div className="mt-6">
                  <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">
                    Anotação adicional do relatório
                  </label>
                  <textarea
                    className="w-full bg-gray-50 border border-gray-100 rounded-xl p-3 text-sm outline-none resize-none"
                    rows={3}
                    placeholder="Resumo clínico adicional para o PDF final."
                    value={reportAdditionalNote}
                    onChange={(e) => setReportAdditionalNote(e.target.value)}
                  />
                </div>
              )}

              <div className="mt-8 flex justify-end gap-3">
                <button
                  className="px-6 py-3 bg-gray-100 text-gray-600 font-semibold rounded-xl text-xs hover:bg-gray-200 transition-all"
                  onClick={isKidsProfile ? undefined : () => setActiveTab('history')}
                >
                  {isKidsProfile ? 'Visualizar PDF' : 'Ver Histórico'}
                </button>
                <button
                  id="report-download-btn"
                  onClick={isKidsProfile ? undefined : () => void handleGenerateAdultEvolutionReport()}
                  disabled={!isKidsProfile && isGeneratingAdultReport}
                  className="px-6 py-3 bg-[#7a32fc] text-white font-semibold rounded-xl text-xs shadow-lg shadow-[#7a32fc]/20 hover:opacity-90 transition-all flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Download size={16} /> {isKidsProfile ? 'Gerar Relatório Final' : (isGeneratingAdultReport ? 'Gerando...' : 'Gerar PDF Adulto')}
                </button>
              </div>
            </div>
          </div>
        ) : activeTab === 'plan' ? ( 
          <div className="space-y-6 animate-fade-in"> 
            {isKidsProfile && (
              <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 mb-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-[#05CD99]/5 rounded-bl-full -z-0"></div>
                <div className="flex items-center justify-between mb-6 relative z-10">
                  <div>
                    <h3 className="text-xl font-semibold text-gray-800 tracking-tight">PEI - Plano de Ensino Individualizado</h3>
                    <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest mt-1">Metas e Objetivos de Intervenção</p>
                  </div>
                  <div className="flex gap-2">
                    {patient.pei?.some((g: any) => g.isPriority || g.status === 'in_progress') && (
                      <button 
                        onClick={() => requestSessionStart('fullscreen')}
                        className="bg-[#7a32fc] text-white font-semibold px-6 py-3 rounded-2xl shadow-lg shadow-[#7a32fc]/20 hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 text-sm"
                      >
                        <Activity size={20} /> Iniciar Sessão
                      </button>
                    )}
                    <div className="p-3 bg-[#05CD99]/10 rounded-2xl text-[#05CD99]">
                      <Target size={24} />
                    </div>
                  </div>
                </div>

                <div className="space-y-4 mb-8">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Metas Ativas</h4>
                    <button 
                      onClick={() => setIsAddingPEIGoal(!isAddingPEIGoal)}
                      className="text-xs font-semibold text-[#05CD99] bg-[#05CD99]/10 px-4 py-2 rounded-xl hover:bg-[#05CD99]/20 transition-all flex items-center gap-2"
                    >
                      {isAddingPEIGoal ? <X size={14} /> : <Plus size={14} />}
                      {isAddingPEIGoal ? "Cancelar" : "Adicionar Meta do Protocolo"}
                    </button>
                  </div>

                  {isAddingPEIGoal && (
                    <div className="bg-gray-50 p-5 rounded-3xl border border-dashed border-[#05CD99]/30 animate-slide-up mb-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Protocolo</label>
                          <select 
                            className="w-full bg-white border border-gray-100 rounded-xl p-3 text-sm outline-none focus:border-[#05CD99] font-semibold text-gray-700"
                            value={selectedPEIProtocolId}
                            onChange={(e) => {
                              setSelectedPEIProtocolId(e.target.value);
                              setSelectedPEIDomainId("");
                              setSelectedPEISkillId("");
                            }}
                          >
                            <option value="">Selecione...</option>
                            {protocols.map((p: any) => (
                              <option key={p.id} value={p.id}>{p.title}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Domínio</label>
                          <select 
                            className="w-full bg-white border border-gray-100 rounded-xl p-3 text-sm outline-none focus:border-[#05CD99] font-semibold text-gray-700"
                            value={selectedPEIDomainId}
                            onChange={(e) => {
                              setSelectedPEIDomainId(e.target.value);
                              setSelectedPEISkillId("");
                            }}
                            disabled={!selectedPEIProtocolId}
                          >
                            <option value="">Selecione...</option>
                            {protocols.find((p: any) => String(p.id) === String(selectedPEIProtocolId))?.data.map((d: any) => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      
                      {selectedPEIDomainId && (
                        <div className="space-y-3 animate-fade-in">
                          <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Habilidade / Meta</label>
                          <div className="grid grid-cols-1 gap-2">
                            {protocols.find((p: any) => String(p.id) === String(selectedPEIProtocolId))?.data.find((d: any) => String(d.id) === String(selectedPEIDomainId))?.skills.map((s: any) => (
                              <button 
                                key={s.id}
                                onClick={() => {
                                  const peiGoal = {
                                    id: Date.now(),
                                    skillId: s.id,
                                    name: s.name,
                                    objective: s.objective,
                                    criteria: s.criteria,
                                    maxScore: s.maxScore || 1,
                                    status: 'not_started',
                                    progress: 0,
                                    term: 'short',
                                    isPriority: false,
                                    protocolTitle: protocols.find((p: any) => String(p.id) === String(selectedPEIProtocolId))?.title,
                                    domainName: protocols.find((p: any) => String(p.id) === String(selectedPEIProtocolId))?.data.find((d: any) => String(d.id) === String(selectedPEIDomainId))?.name
                                  };
                                  const updatedPatient = {
                                    ...patient,
                                    pei: [...(patient.pei || []), peiGoal]
                                  };
                                  onUpdatePatient(updatedPatient);
                                  setIsAddingPEIGoal(false);
                                  setSelectedPEIProtocolId("");
                                  setSelectedPEIDomainId("");
                                }}
                                className="text-left p-4 bg-white border border-gray-100 rounded-2xl hover:border-[#05CD99] hover:bg-[#05CD99]/5 transition-all group"
                              >
                                <div className="flex justify-between items-center">
                                  <div>
                                    <p className="text-sm font-semibold text-gray-800">{s.name}</p>
                                    <p className="text-[10px] text-gray-500 mt-1">{s.objective}</p>
                                  </div>
                                  <Plus size={16} className="text-gray-300 group-hover:text-[#05CD99]" />
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-6">
                    {patient.pei && patient.pei.length > 0 ? (
                      ['short', 'medium', 'long'].map(term => {
                        const termGoals = patient.pei.filter((g: any) => g.term === term);
                        if (termGoals.length === 0) return null;
                        
                        return (
                          <div key={term} className="space-y-3">
                            <h5 className="text-[10px] font-semibold text-gray-400 uppercase tracking-[0.2em] ml-2">
                              {term === 'short' ? 'Curto Prazo' : term === 'medium' ? 'Médio Prazo' : 'Longo Prazo'}
                            </h5>
                            {termGoals.sort((a: any, b: any) => (b.isPriority ? 1 : 0) - (a.isPriority ? 1 : 0)).map((goal: any) => (
                              <div key={goal.id} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm group hover:shadow-md transition-all">
                                <div className="flex justify-between items-start mb-3">
                                  <div>
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-[9px] font-semibold text-[#05CD99] bg-[#05CD99]/10 px-2 py-0.5 rounded-full uppercase">{goal.protocolTitle}</span>
                                      <span className="text-[9px] font-semibold text-gray-400 uppercase">{goal.domainName}</span>
                                      <select 
                                        className="text-[9px] font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full uppercase outline-none"
                                        value={goal.term}
                                        onChange={(e) => {
                                          const updatedPEI = patient.pei.map((g: any) => g.id === goal.id ? { ...g, term: e.target.value } : g);
                                          onUpdatePatient({ ...patient, pei: updatedPEI });
                                        }}
                                      >
                                        <option value="short">Curto Prazo</option>
                                        <option value="medium">Médio Prazo</option>
                                        <option value="long">Longo Prazo</option>
                                      </select>
                                    </div>
                                    <h4 className="font-semibold text-gray-800 text-base flex items-center gap-2">
                                      {goal.name}
                                      <button 
                                        onClick={() => {
                                          const updatedPEI = patient.pei.map((g: any) => g.id === goal.id ? { ...g, isPriority: !g.isPriority } : g);
                                          onUpdatePatient({ ...patient, pei: updatedPEI });
                                        }}
                                        className={`p-1 rounded-md transition-all ${goal.isPriority ? 'text-orange-500 bg-orange-50' : 'text-gray-300 hover:text-orange-300'}`}
                                        title={goal.isPriority ? "Remover Prioridade" : "Marcar como Prioridade para Sessão"}
                                      >
                                        <Zap size={14} fill={goal.isPriority ? "currentColor" : "none"} />
                                      </button>
                                    </h4>
                                    {patientCategory === 'Criança' && (
                                      <div className="mt-1 mb-2">
                                        <MasteryDots count={getMasteryProgress(goal.name) || 0} status={goal.status} />
                                      </div>
                                    )}
                                    <p className="text-xs text-gray-500 mt-1">{goal.objective}</p>
                                  </div>
                                    <div className="flex items-center gap-2">
                                      <select 
                                        className={`text-[10px] font-semibold px-3 py-1.5 rounded-xl outline-none appearance-none uppercase tracking-wider border-2 transition-all ${
                                          goal.status === 'completed' ? 'bg-green-100 text-green-600 border-green-200' : 
                                          goal.status === 'in_progress' ? 'bg-blue-100 text-blue-600 border-blue-200' : 
                                          'bg-gray-100 text-gray-400 border-gray-200'
                                        }`}
                                        value={goal.status}
                                        onChange={(e) => {
                                          const updatedPEI = patient.pei.map((g: any) => g.id === goal.id ? { ...g, status: e.target.value } : g);
                                          onUpdatePatient({ ...patient, pei: updatedPEI });
                                        }}
                                      >
                                        <option value="not_started">Não Iniciado</option>
                                        <option value="in_progress">Em Treino</option>
                                        <option value="completed">Adquirido</option>
                                      </select>
                                      {patientCategory === 'Criança' && goal.status !== 'completed' && (
                                        <button 
                                          onClick={() => {
                                            if (confirm("Deseja zerar o progresso de maestria desta meta? Isso reiniciará a contagem de acertos consecutivos.")) {
                                              const updatedPEI = patient.pei.map((g: any) => g.id === goal.id ? { ...g, id: Date.now(), progress: 0, status: 'not_started' } : g);
                                              onUpdatePatient({ ...patient, pei: updatedPEI });
                                            }
                                          }}
                                          className="p-2 text-gray-300 hover:text-orange-500 hover:bg-orange-50 rounded-xl transition-all"
                                          title="Zerar Progresso de Maestria"
                                        >
                                          <RotateCcw size={16} />
                                        </button>
                                      )}
                                      <button 
                                        onClick={() => {
                                          const updatedPEI = patient.pei.filter((g: any) => g.id !== goal.id);
                                          onUpdatePatient({ ...patient, pei: updatedPEI });
                                        }}
                                        className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                  <div className="flex justify-between items-center">
                                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Progresso da Meta</span>
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${
                                      goal.progress >= 100 ? 'bg-green-100 text-green-600' : 
                                      goal.progress >= 60 ? 'bg-blue-100 text-blue-600' : 
                                      'bg-gray-100 text-gray-600'
                                    }`}>{goal.progress}%</span>
                                  </div>
                                  <div className="relative w-full h-4 bg-gray-100 rounded-full overflow-hidden shadow-inner border border-gray-200/50">
                                    {/* Progress Fill with Gradient */}
                                    <div 
                                      className={`absolute top-0 left-0 h-full transition-all duration-1000 ease-out ${
                                        goal.progress >= 100 ? 'bg-gradient-to-r from-green-400 to-emerald-600' :
                                        goal.progress >= 80 ? 'bg-gradient-to-r from-blue-400 to-indigo-500' :
                                        goal.progress >= 60 ? 'bg-gradient-to-r from-cyan-400 to-blue-500' :
                                        goal.progress >= 40 ? 'bg-gradient-to-r from-yellow-400 to-orange-500' :
                                        goal.progress >= 20 ? 'bg-gradient-to-r from-orange-400 to-red-500' :
                                        'bg-gradient-to-r from-red-500 to-rose-600'
                                      }`}
                                      style={{ width: `${goal.progress}%` }}
                                    >
                                      {/* Animated Shine Effect */}
                                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 animate-pulse"></div>
                                    </div>
                                    
                                    {/* Milestone Markers */}
                                    <div className="absolute inset-0 flex justify-between px-1 pointer-events-none">
                                      {[20, 40, 60, 80].map(m => (
                                        <div key={m} className="w-px h-full bg-white/30"></div>
                                      ))}
                                    </div>

                                    {/* Invisible range input for interaction */}
                                    <input 
                                      type="range" 
                                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                      value={goal.progress}
                                      onChange={(e) => {
                                        const updatedPEI = patient.pei.map((g: any) => g.id === goal.id ? { ...g, progress: parseInt(e.target.value) } : g);
                                        onUpdatePatient({ ...patient, pei: updatedPEI });
                                      }}
                                    />
                                  </div>
                                  {patientCategory === 'Criança' && (
                                    <div className="flex justify-between px-1">
                                      <span className="text-[8px] font-semibold text-gray-300 uppercase">Início</span>
                                      <span className="text-[8px] font-semibold text-gray-300 uppercase">Maestria</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center py-12 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
                        <Target size={40} className="mx-auto mb-3 text-gray-300 opacity-50" />
                        <p className="text-sm font-semibold text-gray-400">Nenhuma meta definida no PEI ainda.</p>
                        <p className="text-[10px] text-gray-400 mt-1">Adicione metas dos protocolos para começar o planejamento.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {!isKidsProfile && (
              <React.Fragment>
                <div id="new-schedule-card" className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100"> 
                  <h3 className="font-semibold text-gray-800 text-lg mb-2 tracking-tight">Plano Semanal Adulto</h3> 
                  <p className="text-xs text-gray-500 font-medium mb-4">
                    Tarefas para execução fora do consultório, sem pontuação em tempo real.
                  </p>
                  <div className="flex bg-gray-100 p-1 rounded-xl mb-6"> 
                    <button onClick={() => { setPlanType('task'); setFinalTaskTitle(""); setFinalTaskSubtitle(""); setSelectedSkillId(""); }} className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${planType === 'task' ? 'bg-white text-[#7551FF] shadow-sm' : 'text-gray-500'}`}>{!isKidsProfile ? 'Avaliação' : 'Tarefa'}</button> 
                    <button onClick={() => { setPlanType('intervention'); setFinalTaskTitle(""); setFinalTaskSubtitle(""); setSelectedSkillId(""); }} className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${planType === 'intervention' ? 'bg-white text-[#7551FF] shadow-sm' : 'text-gray-500'}`}>Intervenção</button> 
                    <button onClick={() => { setPlanType('reinforcement'); setFinalTaskTitle(""); setFinalTaskSubtitle(""); setSelectedSkillId(""); }} className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${planType === 'reinforcement' ? 'bg-white text-[#7551FF] shadow-sm' : 'text-gray-500'}`}>Reforço</button> 
                  </div> 
                  <div className="space-y-4"> 
                    {(planType === 'task' || planType === 'intervention') ? ( 
                      <React.Fragment> 
                        <div className="flex items-center justify-between mb-2"> 
                          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Modo</span> 
                          <button onClick={() => setIsCreatingNewTask(!isCreatingNewTask)} className="text-xs font-semibold text-[#7551FF] bg-[#7551FF]/10 px-3 py-1 rounded-full transition-colors hover:bg-[#7551FF]/20">{isCreatingNewTask ? "Selecionar Existente" : "Criar Nova"}</button> 
                        </div> 
                        {isCreatingNewTask ? ( 
                          <div className={`animate-fade-in space-y-4 p-4 rounded-2xl border ${planType === 'intervention' ? 'bg-green-50/30 border-green-100' : 'bg-[#F4F7FE] border-blue-100'}`}> 
                            <div><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Nome da Nova {planType === 'intervention' ? 'Intervenção' : (!isKidsProfile ? 'Avaliação' : 'Tarefa')}</label><input type="text" className="w-full bg-white rounded-xl p-3 text-sm outline-none border border-transparent focus:border-[#7551FF]" placeholder={planType === 'intervention' ? "Ex: Autoestima" : (!isKidsProfile ? "Ex: Avaliação de Autonomia" : "Ex: Arrumar a cama")} value={newTaskName} onChange={e => setNewTaskName(e.target.value)} /></div> 
                            {planType === 'task' && (
                              <div className="grid grid-cols-1 gap-3 opacity-80 hover:opacity-100 transition-opacity"> 
                                <div><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Código/Tag da atividade (opcional)</label><input type="text" className="w-full bg-white rounded-xl p-2 text-xs outline-none border border-transparent focus:border-[#7551FF]" placeholder="Ex: ADL-SEMANA-01" value={newTaskCode} onChange={e => setNewTaskCode(e.target.value)} /></div> 
                              </div> 
                            )}
                            <div><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">{planType === 'intervention' ? 'Objetivo / Instruções de Escrita' : 'Objetivo (Base para descrição)'}</label><textarea className="w-full bg-white rounded-xl p-2 text-xs outline-none border border-transparent resize-none" rows={planType === 'intervention' ? 4 : 2} placeholder={planType === 'intervention' ? "Ex: Liste 20 qualidades que você tem..." : "Objetivo da tarefa..."} value={newTaskObjective} onChange={e => setNewTaskObjective(e.target.value)}></textarea></div> 
                            {planType === 'task' && (
                              <>
                                <div><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Exemplos</label><textarea className="w-full bg-white rounded-xl p-2 text-xs outline-none border border-transparent resize-none" rows={2} placeholder="Ex: Passo a passo..." value={newTaskExample} onChange={e => setNewTaskExample(e.target.value)}></textarea></div> 
                                <div><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Orientação de execução</label><textarea className="w-full bg-white rounded-xl p-2 text-xs outline-none border border-transparent resize-none" rows={2} placeholder="Como o paciente/família deve executar durante a semana..." value={newTaskCriteria} onChange={e => setNewTaskCriteria(e.target.value)}></textarea></div> 
                              </>
                            )}
                            <div><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Anotações do Profissional</label><textarea className="w-full bg-white rounded-xl p-2 text-xs outline-none border border-transparent resize-none" rows={2} value={newTaskComment || ''} onChange={(e) => setNewTaskComment(e.target.value)} placeholder="Anotações do profissional..."></textarea></div> 
                            <div className={`pt-2 border-t mt-2 ${planType === 'intervention' ? 'border-green-100' : 'border-blue-100'}`}> 
                              <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-2">Salvar no Protocolo:</label> 
                              <div className="flex gap-2 mb-3"> 
                                <button onClick={() => setAddToProtocolMode('existing')} className={`flex-1 py-2 text-xs font-semibold rounded-lg border ${addToProtocolMode === 'existing' ? 'bg-white border-[#7551FF] text-[#7551FF]' : 'border-transparent bg-gray-100 text-gray-500'}`}>Existente</button> 
                                <button onClick={() => setAddToProtocolMode('new')} className={`flex-1 py-2 text-xs font-semibold rounded-lg border ${addToProtocolMode === 'new' ? 'bg-white border-[#7551FF] text-[#7551FF]' : 'border-transparent bg-gray-100 text-gray-500'}`}>Novo</button> 
                              </div> 
                              {addToProtocolMode === 'existing' ? ( 
                                <div className="space-y-2"> 
                                  <select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-xs outline-none" value={targetProtocolId} onChange={e => setTargetProtocolId(e.target.value)}><option value="">Selecione Protocolo...</option>{ageCompatibleProtocols.filter((p: any) => planType === 'intervention' ? p.category === 'intervention' : (p.category === 'evaluation' || !p.category)).map((p: any) => <option key={p.id} value={p.id}>{p.title}</option>)}</select> 
                                  {targetProtocol && (<select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-xs outline-none" value={targetDomainId} onChange={e => setTargetDomainId(e.target.value)}><option value="">Selecione Domínio...</option>{targetProtocol.data.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>)} 
                                </div> 
                              ) : ( 
                                <div className="space-y-2"> 
                                  <input type="text" className="w-full bg-white rounded-xl p-2 text-xs outline-none border border-gray-200" placeholder="Nome do Novo Protocolo" value={newProtocolName} onChange={e => setNewProtocolName(e.target.value)} /> 
                                  <input type="text" className="w-full bg-white rounded-xl p-2 text-xs outline-none border border-gray-200" placeholder="Nome do Domínio (Categoria)" value={newDomainName} onChange={e => setNewDomainName(e.target.value)} /> 
                                </div> 
                              )} 
                            </div> 
                          </div> 
                        ) : ( 
                          <div className="animate-fade-in space-y-4"> 
                            <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-100 mb-2"> 
                              <button onClick={() => setIsPlanFilterOpen(!isPlanFilterOpen)} className="w-full flex items-center justify-between text-[#7a32fc] mb-2">
                                <div className="flex items-center gap-2"><Filter size={14}/><span className="text-[10px] font-semibold uppercase tracking-widest">Filtrar Protocolos</span></div> 
                                <ChevronDown size={14} className={`transition-transform ${isPlanFilterOpen ? 'rotate-180' : ''}`} />
                              </button>

                              {isPlanFilterOpen && (
                                <div className="space-y-2 animate-fade-in">
                                  <div className="grid grid-cols-2 gap-2 mb-2"> 
                                    <select className="bg-white border border-blue-100 rounded-lg p-1.5 text-xs outline-none font-semibold text-gray-700" value={filterAge} onChange={(e) => setFilterAge(e.target.value)}> 
                                      <option value="">Faixa Etária (Todas)</option> <option value="child">0 a 12 anos</option> <option value="teen">13 a 18 anos</option> <option value="adult">19 a 59 anos</option> <option value="senior">60 anos ou mais</option> 
                                    </select> 
                                    <select className="bg-white border border-blue-100 rounded-lg p-1.5 text-xs outline-none font-semibold text-gray-700" value={filterType} onChange={(e) => setFilterType(e.target.value)}> 
                                      <option value="">Tipo (Todos)</option> <option value="conventional">Convencional</option> <option value="neurodevelopment">Neurodesenvolvimento</option> <option value="occupational">T. Ocupacional</option> 
                                    </select> 
                                  </div> 
                                  <div className="relative"> 
                                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={12} /> <input type="text" className="w-full bg-white border border-blue-100 rounded-lg p-1.5 pl-7 text-xs outline-none font-semibold text-gray-700" placeholder="Buscar por tema..." value={filterDomain} onChange={(e) => setFilterDomain(e.target.value)} /> 
                                  </div> 
                                </div>
                              )}
                            </div> 
                            <div><label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Protocolo ({filteredProtocols.filter((p: any) => planType === 'intervention' ? p.category === 'intervention' : (p.category === 'evaluation' || !p.category)).length})</label>
                              {patientAgeYears !== null && (
                                <p className="text-[10px] text-amber-600 font-semibold mb-2">
                                  Faixa etária do paciente: {patientAgeYears} anos. Protocolos aceitos pela Verto aparecem quando liberados pelo superadmin.
                                </p>
                              )}
                              <select 
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none font-semibold text-gray-700" 
                                value={selectedProtocolId} 
                                onChange={e => { setSelectedProtocolId(e.target.value); setSelectedDomainId(''); setSelectedSkillId(''); }}
                              >
                                <option value="">Selecione...</option>
                                {planType === 'task' && patient.pei && patient.pei.length > 0 && (
                                  <optgroup label="Plano de Ensino (PEI)">
                                    <option value="pei-goals">Metas do PEI</option>
                                  </optgroup>
                                )}
                                <optgroup label={planType === 'intervention' ? "Protocolos de Intervenção" : "Protocolos de Avaliação"}>
                                  {filteredProtocols.filter((p: any) => planType === 'intervention' ? p.category === 'intervention' : (p.category === 'evaluation' || !p.category)).map((p: any) => <option key={p.id} value={p.id}>{p.title}</option>)}
                                </optgroup>
                              </select>
                            </div> 
                            {selectedProtocolId === 'pei-goals' ? (
                              <div>
                                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Meta do PEI</label>
                                <select 
                                  className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none font-semibold text-gray-700" 
                                  value={selectedSkillId} 
                                  onChange={e => {
                                    const goal = patient.pei.find((g: any) => String(g.id) === e.target.value);
                                    setSelectedSkillId(e.target.value);
                                    if (goal) {
                                      setFinalTaskTitle(goal.name);
                                      setFinalTaskSubtitle(goal.objective);
                                    }
                                  }}
                                >
                                  <option value="">Selecione uma meta...</option>
                                  {patient.pei.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                                </select>
                              </div>
                            ) : (
                              <React.Fragment>
                                {selectedProtocol && (<div><label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Domínio</label><select className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none font-semibold text-gray-700" value={selectedDomainId} onChange={e => { setSelectedDomainId(e.target.value); setSelectedSkillId(''); }}><option value="">Selecione...</option>{selectedProtocol.data.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>)} 
                                {selectedDomain && (<div><label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{planType === 'intervention' ? 'Tarefa de Intervenção' : 'Habilidade / Tarefa'}</label><select className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none font-semibold text-gray-700" value={selectedSkillId} onChange={e => {
                                  const skill = selectedDomain.skills.find((s: any) => String(s.id) === e.target.value);
                                  setSelectedSkillId(e.target.value);
                                  if (skill) {
                                    setFinalTaskTitle(skill.name);
                                    setFinalTaskSubtitle(skill.objective);
                                  }
                                }}><option value="">Selecione...</option>{selectedDomain.skills.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>)} 
                                {planType === 'task' && selectedSkillId && patient.interventionTaskLinks && patient.interventionTaskLinks[finalTaskTitle] && (
                                  <div className="mt-2 p-3 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center gap-2 animate-pulse">
                                    <Zap size={14} className="text-indigo-600" />
                                    <p className="text-[10px] font-semibold text-indigo-700">
                                      Vinculado à Intervenção: <span className="underline">{patient.interventionTaskLinks[finalTaskTitle]}</span>
                                    </p>
                                  </div>
                                )}
                              </React.Fragment>
                            )}
                          </div> 
                        )} 
                        <div className="mt-4"> 
                          <button onClick={() => setIsCustomizationOpen(!isCustomizationOpen)} className="text-[10px] font-semibold text-gray-400 hover:text-[#7551FF] flex items-center gap-1 transition-colors ml-auto mb-2"> 
                            {isCustomizationOpen ? <ChevronDown size={14} className="rotate-180"/> : <Edit size={14} />} {isCustomizationOpen ? 'Fechar Personalização' : 'Personalizar Título e Instruções'} 
                          </button> 
                          {isCustomizationOpen && ( 
                            <div className="bg-[#F4F7FE]/50 p-4 rounded-2xl border border-blue-100 animate-slide-up relative"> 
                              <div className="absolute top-0 left-0 bg-blue-100 text-blue-600 text-[10px] font-semibold px-3 py-1 rounded-br-xl rounded-tl-xl uppercase">Personalizar Envio</div> 
                              <div className="mt-4 space-y-3"> 
                                <div> <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Título da Tarefa (O que o paciente vê)</label> <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm font-semibold text-gray-700 outline-none focus:border-[#7551FF] transition-colors" placeholder="Ex: Escovar os dentes" value={finalTaskTitle} onChange={(e) => setFinalTaskTitle(e.target.value)} /> </div> 
                                <div> <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Subtítulo / Instruções</label> <textarea className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-[#7551FF] transition-colors resize-none" rows={2} placeholder="Ex: Lembre-se de escovar a língua..." value={finalTaskSubtitle} onChange={(e) => setFinalTaskSubtitle(e.target.value)} ></textarea> </div> 
                              </div> 
                            </div> 
                          )} 
                        </div> 
                        {planType === 'task' && !isKidsProfile && (
                          <div className="mt-4 space-y-4">
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Vincular Protocolo de Intervenção</label>
                              <select 
                                className="w-full bg-white border border-gray-200 rounded-xl p-3 text-xs font-semibold text-gray-700 outline-none focus:border-[#7551FF] transition-all" 
                                value={linkedInterventionProtocolId} 
                                onChange={(e) => setLinkedInterventionProtocolId(e.target.value)}
                              >
                                <option value="">Nenhum protocolo vinculado</option>
                                {ageCompatibleProtocols.filter((p: any) => p.category === 'intervention').map((p: any) => (
                                  <option key={p.id} value={p.id}>{p.title}</option>
                                ))}
                              </select>
                              <p className="text-[9px] text-gray-400 mt-1 font-medium italic">* Define qual protocolo será sugerido para intervenção após esta avaliação.</p>
                            </div>
                          </div>
                        )}
                        {planType === 'intervention' && (
                          <div className="space-y-4">
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Vincular a Habilidade de Avaliação</label>
                              <select 
                                className="w-full bg-white border border-gray-200 rounded-xl p-3 text-xs font-semibold text-gray-700 outline-none focus:border-[#7551FF] transition-all" 
                                value={linkedTask} 
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setLinkedTask(val);
                                  if (patient.evaluationLinks && patient.evaluationLinks[val]) {
                                    setSelectedProtocolId(patient.evaluationLinks[val]);
                                    setSelectedDomainId('');
                                    setSelectedSkillId('');
                                  }
                                }}
                              >
                                <option value="">Nenhuma vinculação</option>
                                {evaluationSkills.map((s: any) => {
                                  const isLinked = (patient.evaluationLinks && patient.evaluationLinks[s.name]) || (patient.interventionTaskLinks && patient.interventionTaskLinks[s.name]);
                                  return (
                                    <option key={s.id} value={s.name}>
                                      {isLinked ? 'âœ¨ ' : ''}{s.name} ({s.protocol})
                                    </option>
                                  );
                                })}
                              </select>
                              {linkedTask && patient.evaluationLinks && patient.evaluationLinks[linkedTask] && (
                                <p className="text-[9px] text-[#05CD99] mt-1 font-semibold animate-pulse">
                                  Protocolo de intervenção sugerido automaticamente!
                                </p>
                              )}
                            </div>
                            <div className="bg-green-50/50 p-4 rounded-2xl border border-green-100 flex items-center justify-between">
                              <div>
                                <p className="text-xs font-semibold text-gray-700">Lembrete Diário</p>
                                <p className="text-[10px] text-gray-500">Notificar o paciente para ler esta tarefa todos os dias.</p>
                              </div>
                              <button 
                                onClick={() => setIsDailyReminder(!isDailyReminder)}
                                className={`w-12 h-6 rounded-full transition-all relative ${isDailyReminder ? 'bg-green-500' : 'bg-gray-200'}`}
                              >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isDailyReminder ? 'left-7' : 'left-1'}`}></div>
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-4 mt-2"> 
                          <div><label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Data</label><input type="date" className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm outline-none" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} /></div> 
                          <div><label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Hora</label><input type="time" className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm outline-none" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} /></div> 
                        </div> 
                        <button onClick={handleSchedule} disabled={!isFormValid()} className={`w-full font-semibold py-3 rounded-xl shadow-lg transition-opacity mt-4 ${isFormValid() ? 'bg-[#7551FF] text-white hover:opacity-90' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>Confirmar Agendamento</button> 
                      </React.Fragment> 
                    ) : ( 
                      <div> 
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Mensagem de Reforço</label> 
                        <textarea className="w-full h-24 bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none resize-none" placeholder="Ex: Parabéns pela dedicação hoje!" value={message} onChange={e => setMessage(e.target.value)}></textarea> 
                        <div className="grid grid-cols-2 gap-4 mt-2"> 
                          <div><label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Data</label><input type="date" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} /></div> 
                          <div><label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Hora</label><input type="time" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} /></div> 
                        </div> 
                        <button onClick={handleSchedule} disabled={!isFormValid()} className={`w-full font-semibold py-3 rounded-xl shadow-lg transition-opacity mt-4 ${isFormValid() ? 'bg-[#7551FF] text-white hover:opacity-90' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>Confirmar Agendamento</button> 
                      </div> 
                    )} 
                  </div> 
                </div> 
                <div className="space-y-3"> 
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider ml-2 tracking-widest">Agendados</h3> 
                  {((isKidsProfile ? (patientTasks || []) : adultScheduledTasks).length || 0) > 0 ? ((isKidsProfile ? (patientTasks || []) : adultScheduledTasks).map((task: any) => ( 
                    <div key={task.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between"> 
                      <div className="flex items-center gap-3"> 
                        <span className="text-xl">{task.type === 'reinforcement' ? '🌟' : task.type === 'intervention' ? '✍️' : '📋'}</span> 
                        <div><p className="font-semibold text-gray-800 text-sm tracking-tight">{task.title}</p><p className="text-xs text-gray-500">{new Date(task.scheduledAt).toLocaleDateString('pt-BR')} • {new Date(task.scheduledAt).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}</p></div> 
                      </div> 
                      <div className="flex items-center gap-2"> 
                        <span className={`text-[10px] font-semibold px-2 py-1 rounded-full uppercase ${task.type === 'reinforcement' ? 'bg-yellow-100 text-yellow-600' : task.type === 'intervention' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}`}>{task.type === 'reinforcement' ? 'Reforço' : task.type === 'intervention' ? 'Intervenção' : (!isKidsProfile ? 'Avaliação' : 'Tarefa')}</span> 
                        {task.source !== 'server' && (
                          <button onClick={() => setEditingTask(task)} className="p-2 text-gray-400 hover:text-[#7551FF] hover:bg-gray-100 rounded-lg transition-colors"> <Edit size={16} /> </button>
                        )}
                      </div> 
                    </div> 
                  ))) : <p className="text-center text-gray-400 text-sm py-4 italic">Nada agendado ainda.</p>} 
                </div>
                {patientAgeYears !== null && patientAgeYears > 12 && (
                  <div className="space-y-3 mt-4">
                    <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider ml-2 tracking-widest">
                      Revisão Profissional (Tarefas Adulto)
                    </h3>
                    {isLoadingAssignedTasks ? (
                      <p className="text-sm text-gray-400 italic py-3">Carregando tarefas concluídas...</p>
                    ) : pendingAssignedReviews.length === 0 ? (
                      <p className="text-sm text-gray-400 italic py-3">Sem tarefas pendentes de pontuação profissional.</p>
                    ) : (
                      pendingAssignedReviews.map((task: any) => {
                        const reviewKey = String(task.id);
                        const draft = assignedReviewDrafts[reviewKey] || { score: '', note: '' };
                        const taskData = task?.task_data && typeof task.task_data === 'object' ? task.task_data : {};
                        const dynamicMaxScore = Math.max(1, Number(taskData?.maxScore ?? taskData?.max_score ?? 4) || 4);
                        const displayedTitle = taskData?.title || task?.title || 'Tarefa';
                        return (
                          <div key={reviewKey} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold text-gray-800 text-sm tracking-tight">{displayedTitle}</p>
                                <p className="text-xs text-gray-500">
                                  Esforço informado: {Number(task?.patient_effort ?? 0)}%
                                </p>
                              </div>
                              <span className="text-[10px] font-semibold px-2 py-1 rounded-full uppercase bg-orange-100 text-orange-600">
                                Aguardando nota
                              </span>
                            </div>
                            {task?.patient_comment && (
                              <p className="text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-xl p-3 whitespace-pre-wrap">
                                {task.patient_comment}
                              </p>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-2">
                              <select
                                value={draft.score}
                                onChange={(e) => handleAssignedReviewChange(reviewKey, { score: e.target.value })}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none"
                              >
                                <option value="">Nota 0-{dynamicMaxScore}</option>
                                {Array.from({ length: dynamicMaxScore + 1 }, (_, i) => i).map((score) => (
                                  <option key={`score-${reviewKey}-${score}`} value={String(score)}>
                                    {score}
                                  </option>
                                ))}
                              </select>
                              <textarea
                                value={draft.note}
                                onChange={(e) => handleAssignedReviewChange(reviewKey, { note: e.target.value })}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none resize-none"
                                rows={2}
                                placeholder="Anotação de evolução (análise técnica qualitativa)"
                              />
                            </div>
                            <button
                              onClick={() => void handleSubmitAssignedReview(task)}
                              className="w-full font-semibold py-2.5 rounded-xl shadow-sm transition-opacity bg-[#7551FF] text-white hover:opacity-90"
                            >
                              Salvar Nota Profissional
                            </button>
                          </div>
                        );
                      })
                    )}
                    {reviewedAssignedTasks.length > 0 && (
                      <div className="text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-xl p-3">
                        {reviewedAssignedTasks.length} tarefa(s) adulta(s) já revisada(s) com nota profissional.
                      </div>
                    )}
                  </div>
                )}
              </React.Fragment>
            )}
 
          </div> 
        ) : activeTab === 'session' && isKidsProfile ? (
          <div className="space-y-6 animate-fade-in">
            <div className="bg-white p-8 rounded-[40px] shadow-sm border border-gray-100 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#7a32fc]/5 rounded-bl-full -z-0"></div>
              <div className="flex items-center justify-between mb-8 relative z-10">
                <div>
                  <h3 className="text-2xl font-semibold text-gray-800 tracking-tight">Registro de Sessão</h3>
                  <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest mt-1">Pontuação DinÃ¢mica de Metas Prioritárias</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  {activeSession && (
                    <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-2 text-right">
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-[#7a32fc]">Sessão em andamento</p>
                      <p className="text-xl font-semibold text-gray-900">{formatSessionCountdown(remainingSessionSeconds)}</p>
                    </div>
                  )}
                  {activeSession && (
                    <button
                      onClick={() => setShowSessionEndConfirm(true)}
                      className="bg-red-50 text-red-500 font-semibold px-5 py-3 rounded-2xl border border-red-100 hover:bg-red-100 active:scale-95 transition-all flex items-center gap-2 text-sm"
                    >
                      <StopCircle size={18} /> Encerrar sessão
                    </button>
                  )}
                  <button 
                    id="session-start-btn"
                    onClick={() => requestSessionStart('fullscreen')}
                    className="bg-[#7a32fc] text-white font-semibold px-6 py-3 rounded-2xl shadow-lg shadow-[#7a32fc]/20 hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 text-sm"
                  >
                    <Activity size={20} /> {activeSession ? 'Modo Tela Cheia' : 'Iniciar Sessão'}
                  </button>
                </div>
              </div>

              <div className="space-y-6">
                {patient.pei?.filter((g: any) => g.isPriority || g.status === 'in_progress').length > 0 ? (
                  patient.pei.filter((g: any) => g.isPriority || g.status === 'in_progress').map((goal: any) => (
                      <div key={goal.id} className="bg-gray-50 p-6 rounded-[32px] border border-gray-100 relative group">
                        {showTrialConfirmation && lastRecordedGoalId === goal.id && (
                          <div className="absolute inset-x-0 bottom-0 z-30 bg-white/95 backdrop-blur-sm border-t border-gray-100 p-4 animate-slide-up rounded-b-[32px]">
                            <div className="flex items-center gap-3">
                              <div className="flex-1">
                                <input 
                                  type="text"
                                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-green-500 transition-all"
                                  placeholder="Anotações do Profissional (opcional)..."
                                  value={trialObservation}
                                  onChange={(e) => setTrialObservation(e.target.value)}
                                  autoFocus
                                />
                              </div>
                              <div className="flex gap-2 shrink-0">
                                <button 
                                  onClick={handleUndoTrial}
                                  className="px-3 py-2 bg-red-50 text-red-500 rounded-xl text-[10px] font-semibold uppercase tracking-widest hover:bg-red-100 transition-all"
                                >
                                  Desfazer
                                </button>
                                <button 
                                  onClick={handleSaveTrialObservation}
                                  className="px-4 py-2 bg-green-500 text-white rounded-xl text-[10px] font-semibold uppercase tracking-widest hover:opacity-90 transition-all shadow-md shadow-green-500/20"
                                >
                                  Confirmar
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <span className="text-[9px] font-semibold text-[#7a32fc] bg-[#7a32fc]/10 px-3 py-1 rounded-full uppercase tracking-widest mb-2 inline-block">
                              {goal.domainName}
                            </span>
                            <h4 className="text-xl font-semibold text-gray-800 tracking-tight">{goal.name}</h4>
                            {patientCategory === 'Criança' && (
                              <div className="mt-2">
                                <MasteryDots count={getMasteryProgress(goal.name) || 0} status={goal.status} />
                              </div>
                            )}
                            <p className="text-xs text-gray-500 mt-1 font-medium">{goal.objective}</p>
                          </div>
                        </div>

                        <div className={`grid gap-4 ${(goal.maxScore || 1) > 1 ? 'grid-cols-5' : 'grid-cols-3'}`}>
                          {(goal.maxScore || 1) === 1 ? (
                            <>
                              <button 
                                onClick={() => handleRecordTrialWithConfirmation(patient.id, goal.id, goal.name, 1)}
                                className="bg-[#05CD99] text-white py-4 rounded-2xl flex items-center justify-center text-2xl font-semibold shadow-md hover:scale-[1.02] active:scale-95 transition-all"
                              >
                                1
                              </button>
                              <button 
                                onClick={() => handleRecordTrialWithConfirmation(patient.id, goal.id, goal.name, 0.5)}
                                className="bg-[#FFB547] text-white py-4 rounded-2xl flex items-center justify-center text-2xl font-semibold shadow-md hover:scale-[1.02] active:scale-95 transition-all"
                              >
                                0.5
                              </button>
                              <button 
                                onClick={() => handleRecordTrialWithConfirmation(patient.id, goal.id, goal.name, 0)}
                                className="bg-[#EE5D50] text-white py-4 rounded-2xl flex items-center justify-center text-2xl font-semibold shadow-md hover:scale-[1.02] active:scale-95 transition-all"
                              >
                                0
                              </button>
                            </>
                          ) : (
                            Array.from({ length: (goal.maxScore || 1) + 1 }, (_, i) => (goal.maxScore || 1) - i).map((score) => {
                              const colors = ['bg-[#EE5D50]', 'bg-[#FFB547]', 'bg-[#7a32fc]', 'bg-[#7551FF]', 'bg-[#05CD99]'];
                              const colorClass = colors[score] || 'bg-gray-500';
                              return (
                                <button 
                                  key={score}
                                  onClick={() => handleRecordTrialWithConfirmation(patient.id, goal.id, goal.name, score)}
                                  className={`${colorClass} text-white py-4 rounded-2xl flex items-center justify-center text-2xl font-semibold shadow-md hover:scale-[1.02] active:scale-95 transition-all`}
                                >
                                  {score}
                                </button>
                              );
                            })
                          )}
                        </div>
                      
                      <div className="mt-4 flex items-center justify-center gap-2">
                        <Info size={12} className="text-gray-300" />
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
                          Critério: {goal.criteria || "Nenhum critério definido"}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-16 bg-gray-50 rounded-[32px] border-2 border-dashed border-gray-200">
                    <Zap size={48} className="mx-auto mb-4 text-gray-300 opacity-50" />
                    <p className="text-lg font-semibold text-gray-400">Nenhuma meta prioritária.</p>
                    <p className="text-sm text-gray-400 mt-1">Marque metas no PEI como prioridade para vê-las aqui.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6 animate-fade-in">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-800 text-lg mb-4 flex items-center gap-2 tracking-tight">
                <UploadCloud className="text-[#7a32fc]" size={20} /> Upload de Documentos
              </h3>
              <div id="file-upload-btn" className="relative group">
                <input 
                  type="file" 
                  id="patient-file-upload" 
                  className="hidden" 
                  onChange={handleFileUpload}
                  disabled={isUploadingFile}
                />
                <label 
                  htmlFor="patient-file-upload" 
                  className={`w-full py-10 border-2 border-dashed rounded-[24px] flex flex-col items-center justify-center cursor-pointer transition-all duration-300 ${isUploadingFile ? 'bg-gray-50 border-gray-200' : 'bg-blue-50/30 border-blue-200 hover:border-[#7a32fc] hover:bg-blue-50'}`}
                >
                  {isUploadingFile ? (
                    <div className="w-full max-w-[240px] text-center">
                      <div className="h-2 w-full bg-gray-100 rounded-full mb-3 overflow-hidden">
                        <div className="h-full bg-[#7a32fc] transition-all duration-200" style={{ width: `${uploadProgress}%` }}></div>
                      </div>
                      <span className="text-sm font-semibold text-gray-500 animate-pulse">Enviando arquivo... {uploadProgress}%</span>
                    </div>
                  ) : (
                    <React.Fragment>
                      <div className="p-4 bg-blue-100 rounded-full text-[#7a32fc] mb-3 shadow-sm group-hover:rotate-6 transition-transform">
                        <FileUp size={32} />
                      </div>
                      <p className="text-base font-semibold text-gray-700">Clique para selecionar ou arraste arquivos</p>
                      <p className="text-xs text-gray-400 mt-1 uppercase font-medium">PDF, JPG, PNG, DOCX (Máx. 10MB)</p>
                    </React.Fragment>
                  )}
                </label>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider ml-2 flex items-center gap-2 tracking-widest">
                <File size={16} /> Arquivos Salvos ({patientFiles.length})
              </h3>
              {isLoadingFiles ? (
                <div className="text-center py-10 bg-white/50 rounded-3xl border border-dashed border-gray-200">
                  <p className="text-sm text-gray-500 font-medium">Carregando arquivos do prontuário...</p>
                </div>
              ) : patientFiles.length > 0 ? patientFiles.map((file: any) => (
                <div key={file.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between group hover:border-blue-100 transition-all animate-slide-up">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center text-[#7a32fc]">
                      {file.type.includes('pdf') ? <FileText size={24} /> : file.type.includes('image') ? <Activity size={24} /> : <File size={24} />}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800 text-sm truncate max-w-[200px] tracking-tight">{file.name}</p>
                      <p className="text-[10px] text-gray-400 font-semibold uppercase">{file.size} • {file.date}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      title="Visualizar"
                      onClick={() => setPreviewFile(file)}
                      className="p-2.5 text-gray-400 hover:text-[#7a32fc] hover:bg-blue-50 rounded-xl transition-all"
                    >
                      <Eye size={18} />
                    </button>
                    <button
                      title="Download"
                      onClick={() => handleDownloadPatientFile(file)}
                      className="p-2.5 text-gray-400 hover:text-[#7a32fc] hover:bg-blue-50 rounded-xl transition-all"
                    >
                      <Download size={18} />
                    </button>
                    <button onClick={() => removeFile(file.id)} title="Excluir" className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all">
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              )) : (
                <div className="text-center py-10 bg-white/50 rounded-3xl border border-dashed border-gray-200">
                  <FileText size={40} className="mx-auto mb-2 text-gray-300 opacity-50" />
                  <p className="text-sm text-gray-400 font-medium italic">Nenhum arquivo anexado a este prontuário.</p>
                </div>
              )}
            </div>
          </div>
        )} 
      </div> 

      {showAnamnesisFileModal && (
        <div className="fixed inset-0 z-[190] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-3xl p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Salvar ficha de anamnese em Arquivos</h3>
            <p className="text-sm text-slate-500 mb-5">
              Defina o nome e a data de referência para visualizar e baixar este documento depois.
            </p>
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
              Ficha preenchida com sucesso. Confirme abaixo para finalizar o salvamento.
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2">Nome do arquivo</label>
                <input
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                  value={anamnesisFileName}
                  onChange={(e) => setAnamnesisFileName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2">Data da ficha</label>
                <input
                  type="date"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                  value={anamnesisFileDate}
                  onChange={(e) => setAnamnesisFileDate(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => openAnamnesisPreviewWindow(pendingAnamnesisPayload)}
                className="px-4 py-2.5 rounded-xl bg-indigo-50 text-indigo-700 font-semibold text-sm"
              >
                Visualizar ficha
              </button>
              <button
                onClick={() => {
                  setShowAnamnesisFileModal(false);
                  setPendingAnamnesisPayload("");
                  setPendingAnamnesisData(null);
                  setIsPreparingAnamnesisSave(false);
                }}
                className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmAnamnesisFile}
                className="px-4 py-2.5 rounded-xl bg-[#7a32fc] text-white font-semibold text-sm"
              >
                Salvar em Arquivos
              </button>
            </div>
          </div>
        </div>
      )}

      {previewFile && (
        <div className="fixed inset-0 z-[125] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-3xl max-h-[85vh] overflow-auto rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{previewFile.name}</h3>
                <p className="text-xs text-slate-500">{previewFile.date}</p>
              </div>
              <button
                onClick={() => setPreviewFile(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            {previewFile.type?.includes("image") && resolveFileViewUrl(previewFile) ? (
              <SecureImage
                src={resolveFileViewUrl(previewFile)}
                alt={previewFile.name}
                className="w-full rounded-xl border border-slate-200"
                fallback={<p className="text-sm text-red-500">Pré-visualização bloqueada por segurança de mídia.</p>}
              />
            ) : previewFile.type?.includes("pdf") && resolveFileViewUrl(previewFile) ? (
              <SecureIframe
                src={resolveFileViewUrl(previewFile)}
                title={previewFile.name}
                className="w-full h-[65vh] rounded-xl border border-slate-200"
                fallback={<p className="text-sm text-red-500">Preview de PDF bloqueado por segurança de mídia.</p>}
              />
            ) : previewFile.type?.includes("html") && resolveFileViewUrl(previewFile) ? (
              <SecureIframe
                src={resolveFileViewUrl(previewFile)}
                title={previewFile.name}
                className="w-full h-[70vh] rounded-xl border border-slate-200 bg-white"
                fallback={<p className="text-sm text-red-500">Preview HTML bloqueado por segurança de mídia.</p>}
              />
            ) : previewFile.content && !String(previewFile.content).startsWith('data:application/pdf') ? (
              <pre className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs overflow-auto whitespace-pre-wrap">
                {previewFile.content}
              </pre>
            ) : (
              <p className="text-sm text-slate-500">
                Pré-visualização indisponível para este arquivo. Use o botão de download.
              </p>
            )}
          </div>
        </div>
      )}
    </div> 
  ); 
};
