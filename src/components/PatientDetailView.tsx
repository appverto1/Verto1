import React, { useState, useMemo, useEffect, useRef } from 'react';
import { PatientSchoolInformation } from "./PatientSchoolInformation";
import { ChevronLeft, ChevronRight, MessageCircle, FileText, SlidersHorizontal, ChevronDown, Calendar, FileOutput, Download, EyeOff, Share2, Eye, Edit, X, UploadCloud, FileUp, File, Trash2, Activity, Search, Plus, Filter, Target, Zap, Info, BarChart2, CheckCircle2, RotateCcw, Clock, Camera } from 'lucide-react';
import { createPortal } from 'react-dom';
import { TutorialOverlay } from './Tutorial';
import { AnamnesisModal } from './Anamnesis';
import { ComparisonBarChart, EvolutionBarChart } from './Charts';
import { HistoryCard } from './History';
import { SessionMode } from './SessionMode';
import { RadarDomainAssessmentChart } from './RadarDomainAssessmentChart';
import { CumulativeGrowthChart } from './CumulativeGrowthChart';
import { ClinicalChartsWorkspace } from './ClinicalChartsWorkspace';
import { ProgressReportPDFLayout } from './ProgressReportPDFLayout';
import { TherapeuticPlanPanel } from './TherapeuticPlanPanel';
import { PatientProfessionalLinksPanel } from './PatientProfessionalLinksPanel';
import { ENERGY_TAGS } from './Common';
import { dataService } from '../services/dataService';
import { SecureImage, SecureIframe } from './SecureMedia';
import { calculateDomainMastery, normalizeScoreToPercent } from '../utils/clinicalMath';
import { prepareElementForPdfCapture } from '../utils/pdfCapture';
import { formatProfessionalRegistry } from '../utils/professionalRegistry';
import { sanitizeDescriptionForDisplay } from '../utils/mediaSecurity';
import { resolveAbaPromptLevel } from '../utils/abaPromptLevels';
import { abaMasteryCriterionSourceLabel, formatAbaMasteryCriterion, normalizeAbaMasteryCriterion } from '../utils/abaMasteryEngine';
import { isAbaV2Enabled, isAbaV3UiEnabled } from '../utils/featureFlags';
import { filterHumanDisplayEntries, formatSessionLabel, safeDisplayValue } from '../utils/displayLabels';
import { normalizePatientInsuranceEligibility } from '../utils/patientInsuranceEligibility';
import {
  PEI_PLAN_SUBTABS,
  buildPeiMaintenanceEligibleSkills,
  buildPeiMaintenanceRows,
  buildPeiPlanHistoryEvents,
  createEmptyPeiMaintenanceTargetFirstSections,
  formatPeiMaintenanceAppointmentLabel,
  formatPeiMaintenanceScheduleLabel,
  isActivePeiMaintenanceScheduleRow,
  isPeiMaintenanceEligibleSkill,
  mapMaintenancePanelResponse,
  resolveMaintenanceTargetDisplay,
  type PeiMaintenanceGroupKey,
  type PeiMaintenanceTargetFirstGroupKey,
  type PeiPlanSubtab,
} from '../utils/peiMaintenancePanel';
import { debugEligibleRowsRender, debugFallbackTriggered } from '../utils/debugPeiMaintenance';
import {
  buildAppointmentDateTime,
  calculateAppointmentEnd,
  formatDateInAppointmentTimezone,
  getAppointmentDurationMinutes,
} from '../utils/scheduling';
import {
  buildPeiSessionProgressReset,
  getPeiHistoryProgressMarker,
  getPeiProgressResetMarker,
  isPeiClinicalRowAfterProgressReset,
} from '../utils/peiSessionReset';
import { AFLS_ADULT_SOCIAL_PARTICIPATION_PROTOCOL } from '../constants/aflsProtocol';
import { VBMAPP_LEVEL_1_CANONICAL_PROTOCOL } from '../constants/vbmappLevel1Protocol';
import { VBMAPP_LEVEL_2_CANONICAL_PROTOCOL } from '../constants/vbmappLevel2Protocol';
import { VBMAPP_LEVEL_3_CANONICAL_PROTOCOL } from '../constants/vbmappLevel3Protocol';
import html2canvas from 'html2canvas';
import { decodeClinicalTextEntities } from '../utils/clinicalText';
import { isPatientCaseTeamMembershipRole, resolvePatientPrimaryProfessionalId } from '../utils/patientProfessionalLinks';

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

const isVbMappProtocol = (protocol: any) => {
  const source = `${protocol?.canonicalKey || ''} ${protocol?.id || ''} ${protocol?.title || ''} ${protocol?.domain || ''}`.toLowerCase();
  return source.includes('vb-mapp') || source.includes('vbmapp') || source.includes('vb mapp');
};

type PatientDetailTab = 'history' | 'notes' | 'report' | 'plan' | 'session' | 'aba-charts' | 'school' | 'files';
type PatientHistoryPeriod = 'all' | '30d' | '90d' | '180d' | '365d' | 'custom';
type PatientHistoryPaginationState = {
  initialized: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string;
  hasMore: boolean;
  nextCursor: string;
  offline: boolean;
};

const PATIENT_HISTORY_PAGE_SIZE = 40;
const PATIENT_FILE_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const PATIENT_FILE_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;

const formatPatientFileStorageBytes = (value: number) => {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${Math.round(bytes)} B`;
};

const resolvePatientFileStorageUsage = (value: any) => {
  const usedBytes = Math.max(0, Number(value?.usedBytes ?? value?.used_bytes ?? 0) || 0);
  const limitBytes = Math.max(
    PATIENT_FILE_STORAGE_LIMIT_BYTES,
    Number(value?.limitBytes ?? value?.limit_bytes ?? PATIENT_FILE_STORAGE_LIMIT_BYTES) || PATIENT_FILE_STORAGE_LIMIT_BYTES
  );
  return {
    usedBytes,
    limitBytes,
    remainingBytes: Math.max(0, Number(value?.remainingBytes ?? value?.remaining_bytes ?? (limitBytes - usedBytes)) || 0)
  };
};

const resolvePatientHistoryRange = (period: PatientHistoryPeriod, customFrom: string, customTo: string) => {
  if (period === 'all') return { from: '', to: '', ready: true };
  if (period === 'custom') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(customFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(customTo)) {
      return { from: '', to: '', ready: false };
    }
    const from = new Date(`${customFrom}T00:00:00`);
    const to = new Date(`${customTo}T23:59:59.999`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() > to.getTime()) {
      return { from: '', to: '', ready: false };
    }
    return { from: from.toISOString(), to: to.toISOString(), ready: true };
  }

  const daysByPeriod: Record<Exclude<PatientHistoryPeriod, 'all' | 'custom'>, number> = {
    '30d': 30,
    '90d': 90,
    '180d': 180,
    '365d': 365,
  };
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (daysByPeriod[period] - 1));
  return { from: from.toISOString(), to: to.toISOString(), ready: true };
};

const isUuidLike = (value: any) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());


const patientPhotoSource = (patient: any) => String(
  patient?.profilePicture
  || patient?.profile_picture
  || patient?.profilePictureUrl
  || patient?.profile_picture_url
  || patient?.photoUrl
  || patient?.photo_url
  || patient?.avatarUrl
  || patient?.avatar_url
  || patient?.imageUrl
  || patient?.image_url
  || ''
).trim();

const patientInitials = (value: unknown) => String(value || 'P')
  .trim()
  .split(/\s+/)
  .slice(0, 2)
  .map((part) => part.charAt(0).toUpperCase())
  .join('') || 'P';

export const PatientDetailView = ({ patient, onBack, history, notes: externalNotes, onAddNote, onAddActivityLog, protocols, setProtocols, onAddTask, patientTasks, onToggleNoteType, onEvaluateHistoryItem, onUpdateTask, isTutorialActive, tutorialStep, setTutorialStep, onUpdatePatient, onRecordTrial, onDeleteHistoryItem, onRefreshPatientHistory, initialTab = 'history', sessionReportId = '', onSessionReportConsumed, openAnamnesisOnLoad = false, onAnamnesisOpenConsumed, clinicContext, clinicProfessionals: preloadedClinicProfessionals = [], hideBackButton = false, anamnesisTemplate, allowedTabs, userRole, themeMode, scheduledSession, startScheduledSessionKey, capabilities, focusNoteId = '', onFocusNoteConsumed }: any) => {
  const safeSetProtocols =
    typeof setProtocols === 'function' ? setProtocols : null;
  const hasCapability = (capability: string) => {
    if (capabilities instanceof Set) return capabilities.has(capability);
    if (Array.isArray(capabilities)) return capabilities.includes(capability);
    if (capabilities && typeof capabilities.has === 'function') return capabilities.has(capability);
    return false;
  };
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
    const asObject = (value: any) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const metadata = asObject(patientRecord?.metadata);
    const address = {
      ...asObject(metadata?.address),
      ...asObject(patientRecord?.address),
    };
    const guardian = {
      ...asObject(metadata?.guardian),
      ...asObject(metadata?.responsible),
      ...asObject(patientRecord?.guardian),
      ...asObject(patientRecord?.responsible),
    };
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
    const responsavelNome = coalescePatientText(
      patientRecord?.responsavelNome,
      patientRecord?.responsibleName,
      patientRecord?.responsible_name,
      guardian?.nome,
      guardian?.name,
      existing?.responsavelNome,
    );
    const responsavelDataNascimento = coalescePatientText(
      patientRecord?.responsavelDataNascimento,
      patientRecord?.responsibleBirthDate,
      patientRecord?.responsible_birth_date,
      guardian?.dataNascimento,
      guardian?.birthDate,
      guardian?.birth_date,
      existing?.responsavelDataNascimento,
    );
    const responsavelCpf = coalescePatientText(
      patientRecord?.responsavelCpf,
      patientRecord?.responsibleCpf,
      patientRecord?.responsible_cpf,
      guardian?.cpf,
      existing?.responsavelCpf,
    );
    const responsavelTelefone = coalescePatientText(
      patientRecord?.responsavelTelefone,
      patientRecord?.responsiblePhone,
      patientRecord?.responsible_phone,
      guardian?.telefone,
      guardian?.phone,
      existing?.responsavelTelefone,
    );
    const responsavelEmail = coalescePatientText(
      patientRecord?.responsavelEmail,
      patientRecord?.responsibleEmail,
      patientRecord?.responsible_email,
      guardian?.email,
      existing?.responsavelEmail,
    );
    const responsavelRelacao = coalescePatientText(
      patientRecord?.responsavelRelacao,
      patientRecord?.responsibleRelationship,
      patientRecord?.responsible_relationship,
      guardian?.relacao,
      guardian?.relationship,
      metadata?.responsibleRelationship,
      existing?.responsavelRelacao,
    );
    const explicitMinor =
      typeof patientRecord?.menorDeIdade === 'boolean'
        ? patientRecord.menorDeIdade
        : typeof patientRecord?.isMinor === 'boolean'
          ? patientRecord.isMinor
          : typeof patientRecord?.is_minor === 'boolean'
            ? patientRecord.is_minor
            : typeof existing?.menorDeIdade === 'boolean'
              ? existing.menorDeIdade
              : undefined;
    const hasResponsibleData = Boolean(
      responsavelNome ||
      responsavelDataNascimento ||
      responsavelCpf ||
      responsavelTelefone ||
      responsavelEmail ||
      responsavelRelacao,
    );
    const insuranceEligibility = normalizePatientInsuranceEligibility(
      {
        ...patientRecord,
        payload: existing,
        anamnese: existing,
        anamnesisData: existing,
      },
      { useResponsibleFallback: true },
    );

    return {
      ...existing,
      nome: coalescePatientText(patientRecord?.nome, patientRecord?.name, existing?.nome),
      nomeSocial: coalescePatientText(patientRecord?.nomeSocial, patientRecord?.socialName, existing?.nomeSocial),
      telefone: coalescePatientText(patientRecord?.telefone, patientRecord?.phone, existing?.telefone),
      email: coalescePatientText(patientRecord?.email, existing?.email),
      cpf: coalescePatientText(patientRecord?.cpf, existing?.cpf),
      dataNascimento: resolvedBirthDate,
      genero: coalescePatientText(patientRecord?.genero, patientRecord?.gender, existing?.genero),
      convenioTipo: insuranceEligibility.convenioTipo,
      convenioNome: insuranceEligibility.convenioNome,
      convenioCarteirinha: insuranceEligibility.convenioCarteirinha,
      convenioCarteirinhaValidade: insuranceEligibility.convenioCarteirinhaValidade,
      convenioPlanoCategoria: insuranceEligibility.convenioPlanoCategoria,
      convenioTitularNome: insuranceEligibility.convenioTitularNome,
      convenioTitularCpf: insuranceEligibility.convenioTitularCpf,
      convenioTitularRelacao: insuranceEligibility.convenioTitularRelacao,
      convenioElegibilidadeObs: insuranceEligibility.convenioElegibilidadeObs,
      insuranceType: insuranceEligibility.insuranceType,
      insuranceName: insuranceEligibility.insuranceName,
      insuranceCardNumber: insuranceEligibility.insuranceCardNumber,
      cardNumber: insuranceEligibility.insuranceCardNumber,
      insuranceCardValidUntil: insuranceEligibility.insuranceCardValidUntil,
      insurancePlanCategory: insuranceEligibility.insurancePlanCategory,
      insuranceHolderName: insuranceEligibility.insuranceHolderName,
      insuranceHolderCpf: insuranceEligibility.insuranceHolderCpf,
      insuranceHolderRelationship: insuranceEligibility.insuranceHolderRelationship,
      insuranceEligibilityNotes: insuranceEligibility.insuranceEligibilityNotes,
      eligibilityNotes: insuranceEligibility.insuranceEligibilityNotes,
      grupo: coalescePatientText(patientRecord?.grupo, patientRecord?.group, existing?.grupo),
      comoConheceu: coalescePatientText(patientRecord?.comoConheceu, patientRecord?.source, existing?.comoConheceu),
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
        explicitMinor === true || hasResponsibleData || (typeof derivedAgeFromBirthDate === 'number' && derivedAgeFromBirthDate < 18)
          ? true
          : explicitMinor === false
            ? false
            : Boolean(existing?.menorDeIdade),
      responsavelNome,
      responsavelDataNascimento,
      responsavelCpf,
      responsavelTelefone,
      responsavelEmail,
      responsavelRelacao,
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
  const abaV2Enabled = isAbaV2Enabled();
  const abaV3UiEnabled = isAbaV3UiEnabled();
  const patientApproachKey = String(patient?.approach || patient?.abordagem || patient?.treatmentApproach || '').toLowerCase();
  const useCanonicalMasteryGrowth = abaV2Enabled && (
    isKidsProfile ||
    rawProfileType.includes('aba') ||
    rawProfileType.includes('tea') ||
    patientApproachKey.includes('aba')
  );
  const chartFiltersStorageKey = `verto.patient-chart-filters:${String(patient?.id || 'unknown')}:${isKidsProfile ? 'kids' : 'adult'}`;
  const readPersistedChartFilters = () => {
    if (typeof window === 'undefined') return {};
    try {
      return JSON.parse(window.localStorage.getItem(chartFiltersStorageKey) || '{}') || {};
    } catch {
      return {};
    }
  };
  const initialChartFilters = readPersistedChartFilters();
  const [activeTab, setActiveTab] = useState(initialTab); 
  const [historyPeriod, setHistoryPeriod] = useState<PatientHistoryPeriod>('all');
  const [historyCustomFrom, setHistoryCustomFrom] = useState('');
  const [historyCustomTo, setHistoryCustomTo] = useState('');
  const [historyPaginationByKey, setHistoryPaginationByKey] = useState<Record<string, PatientHistoryPaginationState>>({});
  const historyRequestsInFlightRef = React.useRef(new Set<string>());
  const [newNote, setNewNote] = useState(""); 
  const [noteMode, setNoteMode] = useState('private'); 
  const [mentionCandidates, setMentionCandidates] = useState<any[]>([]);
  const [selectedMentionUserIds, setSelectedMentionUserIds] = useState<string[]>([]);
  const [focusedNoteId, setFocusedNoteId] = useState('');
  const mentionCandidatesLoadedForPatientRef = useRef('');
  const [noteSearchQuery, setNoteSearchQuery] = useState("");
  const [noteSubjectFilter, setNoteSubjectFilter] = useState("");
  const [noteDateFilter, setNoteDateFilter] = useState("");
  const [newNoteSubject, setNewNoteSubject] = useState("");
  const [showNoteFilters, setShowNoteFilters] = useState(false);
  const [showAnamnesis, setShowAnamnesis] = useState(false); 
  const [anamnesisFlow, setAnamnesisFlow] = useState<any>(null);
  const [anamnesisFlowMessage, setAnamnesisFlowMessage] = useState("");
  const [isSendingAnamnesisRequest, setIsSendingAnamnesisRequest] = useState(false);
  const [showAnamnesisSendModal, setShowAnamnesisSendModal] = useState(false);
  const [selectedAnamnesisTemplateId, setSelectedAnamnesisTemplateId] = useState("");
  const [isReviewingAnamnesis, setIsReviewingAnamnesis] = useState(false);
  const [reportPeriod, setReportPeriod] = useState(() => String(initialChartFilters.reportPeriod || 'monthly'));
  const [comparisonDate1, setComparisonDate1] = useState(() => String(initialChartFilters.comparisonDate1 || ''));
  const [comparisonDate2, setComparisonDate2] = useState(() => String(initialChartFilters.comparisonDate2 || ''));
  const [adultReportDate1, setAdultReportDate1] = useState(() => String(initialChartFilters.adultReportDate1 || ''));
  const [adultReportDate2, setAdultReportDate2] = useState(() => String(initialChartFilters.adultReportDate2 || ''));
  const [selectedReportNotes, setSelectedReportNotes] = useState<Array<string | number>>([]);
  const [selectedAdultEvolutionIds, setSelectedAdultEvolutionIds] = useState<string[]>([]);
  const [reportAdditionalNote, setReportAdditionalNote] = useState('');
  const [isGeneratingAdultReport, setIsGeneratingAdultReport] = useState(false);
  const [isGeneratingProgressPdf, setIsGeneratingProgressPdf] = useState(false);
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
  const [activePeiPlanSubtab, setActivePeiPlanSubtab] = useState<PeiPlanSubtab>('teaching');
  const [therapeuticPlanMode, setTherapeuticPlanMode] = useState<'pts' | 'pei'>('pts');
  const [isAddingPEIGoal, setIsAddingPEIGoal] = useState(false);
  const [selectedPEIProtocolId, setSelectedPEIProtocolId] = useState("");
  const [selectedPEIDomainId, setSelectedPEIDomainId] = useState("");
  const [selectedPEISkillId, setSelectedPEISkillId] = useState("");
  const [confirmedPEIGoalId, setConfirmedPEIGoalId] = useState<any>(null);
  const [confirmedPEISkillId, setConfirmedPEISkillId] = useState<any>(null);
  const [hasLoadedPeiMaintenancePanel, setHasLoadedPeiMaintenancePanel] = useState(false);
  const [isLoadingPeiMaintenancePanel, setIsLoadingPeiMaintenancePanel] = useState(false);
  const [peiMaintenancePanelMessage, setPeiMaintenancePanelMessage] = useState("");
  const [abaMaintenancePanel, setAbaMaintenancePanel] = useState<any>(null);
  const [peiMaintenanceAssignSchedule, setPeiMaintenanceAssignSchedule] = useState<any>(null);
  const [peiMaintenanceScheduleRow, setPeiMaintenanceScheduleRow] = useState<any>(null);
  const [peiMaintenanceScheduleMode, setPeiMaintenanceScheduleMode] = useState('NEXT_PATIENT_SESSION');
  const [peiMaintenanceScheduleDate, setPeiMaintenanceScheduleDate] = useState('');
  const [isPeiMaintenanceCalendarOpen, setIsPeiMaintenanceCalendarOpen] = useState(false);
  const [peiMaintenanceCalendarMonth, setPeiMaintenanceCalendarMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [peiMaintenanceReviewRow, setPeiMaintenanceReviewRow] = useState<any>(null);
  const [peiMaintenanceReviewTargetId, setPeiMaintenanceReviewTargetId] = useState('');
  const [peiMaintenanceLinkableTargetsState, setPeiMaintenanceLinkableTargetsState] = useState<any>({ loading: false, error: '', items: [], loadedFor: '' });
  const peiMaintenanceLinkableTargetsRequestRef = React.useRef<{ patientId: string; promise: Promise<any> } | null>(null);
  const [peiMaintenanceAppointmentsState, setPeiMaintenanceAppointmentsState] = useState<any>({ loading: false, error: '', items: [] });
  const [selectedPeiMaintenanceAppointmentId, setSelectedPeiMaintenanceAppointmentId] = useState('');
  const [peiMaintenanceActionKey, setPeiMaintenanceActionKey] = useState('');
  const [isPeiMaintenanceTechnicalExpanded, setIsPeiMaintenanceTechnicalExpanded] = useState(false);
  const peiMaintenancePanelRequestSeqRef = React.useRef(0);
  const peiMaintenancePanelMountedRef = React.useRef(true);
  const peiMaintenancePanelPatientIdRef = React.useRef(String(patient?.id || ''));
  const peiConfirmationTimerRef = React.useRef<number | null>(null);
  const [isSessionModeOpen, setIsSessionModeOpen] = useState(false);
  const [localSessionReportId, setLocalSessionReportId] = useState('');
  const [completedSessionReports, setCompletedSessionReports] = useState<any[]>([]);
  const [completedSessionReportsLoading, setCompletedSessionReportsLoading] = useState(false);
  const [completedSessionReportsError, setCompletedSessionReportsError] = useState('');
  const completedSessionReportsLoadedForRef = React.useRef('');
  const [sessionPatientOverride, setSessionPatientOverride] = useState<any>(null);
  const [isUnlinkingModalOpen, setIsUnlinkingModalOpen] = useState(false);
  const [approvedVertoProtocolStatuses, setApprovedVertoProtocolStatuses] = useState<any[]>([]);
  const [clinicTherapists, setClinicTherapists] = useState<any[]>([]);
  const [isLoadingTherapists, setIsLoadingTherapists] = useState(false);
  const [selectedTherapistId, setSelectedTherapistId] = useState<string>(
    String(
      patient?.therapist_id ||
        patient?.therapistId ||
        patient?.professional_id ||
        patient?.professionalId ||
        patient?.responsible_professional_id ||
        patient?.responsibleProfessionalId ||
        '',
    ).trim()
  );
  const [isSavingPrimaryProfessional, setIsSavingPrimaryProfessional] = useState(false);
  const [primaryProfessionalError, setPrimaryProfessionalError] = useState('');
  const [caseTeamRefreshKey, setCaseTeamRefreshKey] = useState(0);
  const [caseTeamManagementAllowed, setCaseTeamManagementAllowed] = useState(false);
  const [caseTeamLinksSnapshot, setCaseTeamLinksSnapshot] = useState<any[]>([]);
  const [showChartsCaseTeam, setShowChartsCaseTeam] = useState(false);
  const primaryProfessionalOverrideRef = React.useRef<string | null | undefined>(undefined);

  const activeCaseTeamLinks = useMemo(
    () => caseTeamLinksSnapshot.filter((link: any) => String(link?.status || '').toLowerCase() === 'active'),
    [caseTeamLinksSnapshot],
  );
  const caseTeamIntegrityPendingCount = useMemo(
    () => activeCaseTeamLinks.filter((link: any) => Boolean(link?.integrityStatus) || link?.accessEnabled === false).length,
    [activeCaseTeamLinks],
  );

  useEffect(() => {
    setShowChartsCaseTeam(false);
    setCaseTeamLinksSnapshot([]);
  }, [patient?.id]);

  const historyRange = useMemo(
    () => resolvePatientHistoryRange(historyPeriod, historyCustomFrom, historyCustomTo),
    [historyPeriod, historyCustomFrom, historyCustomTo]
  );
  const historyRequestKey = [
    String(clinicContext?.clinicId || clinicContext?.organizationId || 'current-clinic'),
    String(patient?.id || ''),
    historyPeriod,
    historyRange.from,
    historyRange.to,
  ].join(':');
  const historyPagination = historyPaginationByKey[historyRequestKey] || {
    initialized: false,
    loading: false,
    loadingMore: false,
    error: '',
    hasMore: false,
    nextCursor: '',
    offline: false,
  };

  const requestPatientHistoryPage = React.useCallback(async (cursor = '') => {
    const patientId = String(patient?.id || '').trim();
    if (!patientId || !historyRange.ready || typeof onRefreshPatientHistory !== 'function') return;
    const requestKey = `${historyRequestKey}:${cursor || 'first'}`;
    if (historyRequestsInFlightRef.current.has(requestKey)) return;
    historyRequestsInFlightRef.current.add(requestKey);
    setHistoryPaginationByKey((current) => ({
      ...current,
      [historyRequestKey]: {
        ...(current[historyRequestKey] || {
          initialized: false,
          error: '',
          hasMore: false,
          nextCursor: '',
          offline: false,
        }),
        loading: !cursor,
        loadingMore: Boolean(cursor),
        error: '',
      },
    }));

    try {
      const result = await onRefreshPatientHistory(patientId, {
        limit: PATIENT_HISTORY_PAGE_SIZE,
        cursor: cursor || undefined,
        from: historyRange.from || undefined,
        to: historyRange.to || undefined,
      });
      if (!result?.success) throw new Error(result?.error || 'Não foi possível carregar o histórico.');
      setHistoryPaginationByKey((current) => ({
        ...current,
        [historyRequestKey]: {
          initialized: true,
          loading: false,
          loadingMore: false,
          error: '',
          hasMore: Boolean(result?.pagination?.hasMore),
          nextCursor: String(result?.pagination?.nextCursor || ''),
          offline: Boolean(result?.offline),
        },
      }));
    } catch (error: any) {
      setHistoryPaginationByKey((current) => ({
        ...current,
        [historyRequestKey]: {
          ...(current[historyRequestKey] || {
            initialized: false,
            hasMore: false,
            nextCursor: '',
            offline: false,
          }),
          loading: false,
          loadingMore: false,
          error: String(error?.message || 'Não foi possível carregar o histórico.'),
        },
      }));
    } finally {
      historyRequestsInFlightRef.current.delete(requestKey);
    }
  }, [historyRange.from, historyRange.ready, historyRange.to, historyRequestKey, onRefreshPatientHistory, patient?.id]);

  useEffect(() => {
    if (activeTab !== 'history' || !historyRange.ready || historyPagination.initialized || historyPagination.loading || historyPagination.error) return;
    void requestPatientHistoryPage();
  }, [activeTab, historyPagination.error, historyPagination.initialized, historyPagination.loading, historyRange.ready, requestPatientHistoryPage]);

  const flashPEIConfirmation = (goalId: any, skillId: any) => {
    if (peiConfirmationTimerRef.current) {
      window.clearTimeout(peiConfirmationTimerRef.current);
    }
    setConfirmedPEIGoalId(goalId);
    setConfirmedPEISkillId(skillId);
    peiConfirmationTimerRef.current = window.setTimeout(() => {
      setConfirmedPEIGoalId(null);
      setConfirmedPEISkillId(null);
      peiConfirmationTimerRef.current = null;
    }, 1500);
  };

  useEffect(() => () => {
    if (peiConfirmationTimerRef.current) {
      window.clearTimeout(peiConfirmationTimerRef.current);
    }
  }, []);

  useEffect(() => {
    peiMaintenancePanelMountedRef.current = true;
    return () => {
      peiMaintenancePanelMountedRef.current = false;
      peiMaintenancePanelRequestSeqRef.current += 1;
    };
  }, []);

  const debugPeiMaintenancePanelLoad = React.useCallback((event: any) => {
    if (!import.meta.env.DEV) return;
    console.debug('[pei-maintenance-panel]', {
      source: event?.source || 'maintenance-panel-target-first',
      requestId: Number(event?.requestId || 0),
      patientIdPresent: Boolean(event?.patientIdPresent),
      eligibleSkillsCount: Number(event?.eligibleSkillsCount || 0),
      technicalIssuesCount: Number(event?.technicalIssuesCount || 0),
      appliedToState: Boolean(event?.appliedToState),
      ignoredAsStale: Boolean(event?.ignoredAsStale),
    });
  }, []);

  const allTabs: PatientDetailTab[] = [
    'history',
    'notes',
    'report',
    'plan',
    'session',
    'aba-charts',
    'school',
    'files',
  ];
  const allowedTabsSet = useMemo(() => {
    const tabsFromProps =
      !Array.isArray(allowedTabs) || allowedTabs.length === 0
        ? allTabs
        : allowedTabs.filter((tab: string) =>
            allTabs.includes(tab as PatientDetailTab),
          );

    const filteredByProfile = isKidsProfile
      ? tabsFromProps
      : tabsFromProps.filter((tab: string) => tab !== 'session' && tab !== 'aba-charts');

    return new Set(filteredByProfile as PatientDetailTab[]);
  }, [allowedTabs, isKidsProfile]);
  const canAccessTab = (tab: PatientDetailTab) =>
    allowedTabsSet.has(tab);
  const canOpenAnamnesis = canAccessTab('history') && canAccessTab('notes');
  const getSessionFallbackTab = () =>
    allTabs.find((tab) => tab !== 'session' && canAccessTab(tab)) || 'files';

  useEffect(() => {
    if (initialTab && canAccessTab(initialTab)) {
      setActiveTab(initialTab === 'session' ? getSessionFallbackTab() : initialTab);
      return;
    }
    const firstAllowed = allTabs.find((tab) => tab !== 'session' && canAccessTab(tab)) || 'files';
    setActiveTab(firstAllowed);
  }, [initialTab, patient?.id, allowedTabsSet]);

  useEffect(() => {
    if (openAnamnesisOnLoad) {
      setShowAnamnesis(true);
      onAnamnesisOpenConsumed?.();
    }
  }, [openAnamnesisOnLoad, onAnamnesisOpenConsumed, patient?.id]);

  const resolvePatientProfessionalId = resolvePatientPrimaryProfessionalId;

  const formatPatientProfessionalOptionLabel = (source: any) => {
    const title = String(
      source?.professionalTitle ||
        source?.professional_title ||
        source?.profileRole ||
        source?.metadata?.professionalTitle ||
        source?.metadata?.professional_title ||
        '',
    ).trim();
    const rawName = String(source?.full_name || source?.fullName || source?.name || source?.email || 'Profissional').trim();
    const name = rawName.replace(/^terapeuta\s+/i, '').trim() || rawName;
    if (title && !name.toLowerCase().startsWith(title.toLowerCase())) return `${title} ${name}`;
    return name || 'Profissional';
  };

  useEffect(() => {
    primaryProfessionalOverrideRef.current = undefined;
    setSelectedTherapistId(resolvePatientProfessionalId(patient));
  }, [
    patient?.therapist_id,
    patient?.therapistId,
    patient?.professional_id,
    patient?.professionalId,
    patient?.responsible_professional_id,
    patient?.responsibleProfessionalId,
    patient?.id,
  ]);

  const loadAnamnesisFlow = async () => {
    if (!patient?.id || !canOpenAnamnesis) return null;
    try {
      const result = await dataService.getPatientAnamnesisFlow(String(patient.id));
      if (result?.success) {
        const nextFlow = result.data || null;
        setAnamnesisFlow(nextFlow);
        return nextFlow;
      }
    } catch (error) {
      console.warn('Falha ao carregar status da anamnese:', error);
    }
    return null;
  };

  useEffect(() => {
    void loadAnamnesisFlow();
  }, [patient?.id, canOpenAnamnesis]);

  const getAnamnesisStatusLabel = () => {
    const requestStatus = String(anamnesisFlow?.request?.status || '').toUpperCase();
    const responseStatus = String(anamnesisFlow?.response?.status || '').toUpperCase();
    const onboarding = String(anamnesisFlow?.patient?.onboardingStatus || patient?.onboardingStatus || patient?.onboarding_status || '').toUpperCase();
    if (requestStatus === 'REVIEWED' || responseStatus === 'REVIEWED' || onboarding === 'READY_FOR_CARE' || onboarding === 'ANAMNESIS_REVIEWED') return 'Anamnese revisada';
    if (requestStatus === 'SUBMITTED' || responseStatus === 'SUBMITTED' || onboarding === 'ANAMNESIS_SUBMITTED') return 'Anamnese em análise';
    if (requestStatus === 'IN_PROGRESS' || responseStatus === 'DRAFT' || onboarding === 'ANAMNESIS_IN_PROGRESS') return 'Anamnese em preenchimento';
    if (requestStatus === 'SENT' || onboarding === 'ANAMNESIS_SENT') return 'Anamnese enviada';
    return 'Anamnese pendente';
  };
  const hasSubmittedAnamnesisFlow = ['SUBMITTED', 'REVIEWED'].includes(String(anamnesisFlow?.response?.status || '').toUpperCase());

  const formatAnamnesisTemplateAge = (months: any) => {
    const value = Number(months);
    if (!Number.isFinite(value) || value < 0) return "";
    const years = Math.floor(value / 12);
    const restMonths = value % 12;
    if (years <= 0) return `${restMonths}m`;
    return restMonths > 0 ? `${years}a ${restMonths}m` : `${years}a`;
  };

  const formatAnamnesisTemplateAgeRange = (template: any) => {
    const min = Number(template?.ageMinMonths);
    const max = Number(template?.ageMaxMonths);
    const hasMin = Number.isFinite(min);
    const hasMax = Number.isFinite(max);
    if (!hasMin && !hasMax) return "Todas as idades";
    if (!hasMin) return `Até ${formatAnamnesisTemplateAge(max)}`;
    if (!hasMax) return `${formatAnamnesisTemplateAge(min)}+`;
    return `${formatAnamnesisTemplateAge(min)} a ${formatAnamnesisTemplateAge(max)}`;
  };

  const formatAnamnesisTemplateProfile = (value: any) => {
    const profile = String(value || "").trim().toUpperCase();
    const labels: Record<string, string> = {
      KIDS_TEA: "Infantil TEA",
      KIDS: "Infantil",
      TEEN: "Adolescente",
      ABA: "Adulto ABA",
      ADULT: "Adulto"
    };
    return labels[profile] || "Perfil livre";
  };

  const normalizeAnamnesisTemplateOption = (template: any, selectedId = "") => {
    if (!template || typeof template !== "object") return null;
    const id = String(template?.id || template?.selectedTemplateId || "").trim();
    const name = String(template?.name || template?.templateName || "").trim();
    if (!name) return null;
    return {
      id,
      name,
      description: String(template?.description || template?.templateDescription || "").trim(),
      ageMinMonths: template?.ageMinMonths ?? template?.age_min_months ?? null,
      ageMaxMonths: template?.ageMaxMonths ?? template?.age_max_months ?? null,
      patientProfileType: template?.patientProfileType || template?.patient_profile_type || "",
      templateScope: String(template?.templateScope || template?.scope || "").trim().toLowerCase(),
      templateRevision: Math.max(1, Number(template?.templateRevision || template?.revision || 1)),
      recommended: Boolean(template?.recommended) || Boolean(id && selectedId && id === selectedId)
    };
  };

  const buildAnamnesisTemplateOptions = (flow: any) => {
    const selectedId = String(
      flow?.selectedTemplateId ||
        flow?.request?.template_id ||
        flow?.request?.templateId ||
        flow?.response?.template_id ||
        flow?.response?.templateId ||
        ""
    ).trim();
    const sources = [
      ...(Array.isArray(flow?.availableTemplates) ? flow.availableTemplates : []),
      ...(Array.isArray(flow?.template?.availableTemplates) ? flow.template.availableTemplates : []),
      ...(Array.isArray(flow?.template?.compatibleTemplates) ? flow.template.compatibleTemplates : []),
      anamnesisTemplate
    ];
    const options = sources
      .map((template) => normalizeAnamnesisTemplateOption(template, selectedId))
      .filter(Boolean) as any[];
    const unique = new Map<string, any>();
    options.forEach((option) => {
      const key = option.id || option.name.toLowerCase();
      if (!unique.has(key)) unique.set(key, option);
    });
    const deduped = Array.from(unique.values());
    if (deduped.length > 0) return deduped;
    const automaticName =
      String(flow?.template?.templateName || anamnesisTemplate?.templateName || anamnesisTemplate?.name || "").trim() ||
      "Seleção automática";
    return [
      {
        id: selectedId,
        name: automaticName,
        description: "Ficha definida pela idade e perfil do paciente.",
        ageMinMonths: flow?.template?.ageMinMonths ?? null,
        ageMaxMonths: flow?.template?.ageMaxMonths ?? null,
        patientProfileType: flow?.template?.patientProfileType || "",
        recommended: true
      }
    ];
  };

  const availableAnamnesisTemplates = useMemo(
    () => buildAnamnesisTemplateOptions(anamnesisFlow),
    [anamnesisFlow, anamnesisTemplate]
  );
  const availableAnamnesisTemplateKey = availableAnamnesisTemplates
    .map((template: any) => `${template.id || ""}:${template.name}`)
    .join("|");
  const defaultAnamnesisTemplateId = useMemo(() => {
    const flowSelectedId = String(
      anamnesisFlow?.selectedTemplateId ||
        anamnesisFlow?.request?.template_id ||
        anamnesisFlow?.request?.templateId ||
        anamnesisFlow?.response?.template_id ||
        anamnesisFlow?.response?.templateId ||
        ""
    ).trim();
    if (flowSelectedId && availableAnamnesisTemplates.some((template: any) => template.id === flowSelectedId)) {
      return flowSelectedId;
    }
    return (
      availableAnamnesisTemplates.find((template: any) => template.recommended && template.id)?.id ||
      availableAnamnesisTemplates.find((template: any) => template.id)?.id ||
      ""
    );
  }, [anamnesisFlow, availableAnamnesisTemplateKey]);

  useEffect(() => {
    if (!showAnamnesisSendModal) return;
    setSelectedAnamnesisTemplateId((current) => {
      if (current && availableAnamnesisTemplates.some((template: any) => template.id === current)) return current;
      return defaultAnamnesisTemplateId;
    });
  }, [showAnamnesisSendModal, defaultAnamnesisTemplateId, availableAnamnesisTemplateKey]);

  const formatPatientContextDate = (value: any) => {
    const raw = String(value || "").trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    return raw;
  };

  const formatPatientContextValue = (value: any) => {
    if (typeof value === "boolean") return value ? "Sim" : "Não";
    if (Array.isArray(value)) return value.filter(Boolean).join(", ") || "Não informado";
    const text = String(value ?? "").trim();
    return text || "Não informado";
  };

  const patientRegistrationContextSections = useMemo(() => {
    const data = anamnesisInitialData || {};
    const address =
      data.endereco ||
      [data.logradouro, data.numero, data.complemento, data.bairro, data.cidade]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .join(", ");
    const insurance = [data.convenioTipo, data.convenioNome, data.convenioCarteirinha]
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join(" - ");
    return [
      {
        title: "Paciente",
        items: [
          { label: "Nome", value: data.nome || patient?.name },
          { label: "Nome social", value: data.nomeSocial },
          { label: "Nascimento", value: formatPatientContextDate(data.dataNascimento) },
          { label: "Idade", value: data.idade },
          { label: "CPF", value: data.cpf },
          { label: "Telefone", value: data.telefone || patient?.phone },
          { label: "E-mail", value: data.email || patient?.email }
        ]
      },
      {
        title: "Cadastro",
        items: [
          { label: "Convênio", value: insurance },
          { label: "Grupo", value: data.grupo },
          { label: "Origem", value: data.comoConheceu },
          { label: "Endereço", value: address },
          { label: "Observações", value: data.outrasInformacoes }
        ]
      },
      {
        title: "Responsável",
        items: [
          { label: "Menor de idade", value: data.menorDeIdade },
          { label: "Nome", value: data.responsavelNome },
          { label: "Nascimento", value: formatPatientContextDate(data.responsavelDataNascimento) },
          { label: "CPF", value: data.responsavelCpf },
          { label: "Telefone", value: data.responsavelTelefone },
          { label: "E-mail", value: data.responsavelEmail },
          { label: "Relação", value: data.responsavelRelacao }
        ]
      }
    ];
  }, [anamnesisInitialData, patient?.name, patient?.phone, patient?.email]);

  const buildQuestionLabelsFromAnamnesisFlow = (flow: any) => {
    const profileType = flow?.profileType === 'child' ? 'child' : 'adult';
    const questions = Array.isArray(flow?.template?.profiles?.[profileType]?.questions)
      ? flow.template.profiles[profileType].questions
      : [];
    return Object.fromEntries(
      questions
        .map((question: any) => [String(question?.id || '').trim(), String(question?.label || '').trim()])
        .filter(([id, label]: any[]) => id && label)
    );
  };

  const buildSubmittedAnamnesisDocumentData = () => {
    const responseAnswers =
      anamnesisFlow?.response?.answers && typeof anamnesisFlow.response.answers === 'object'
        ? anamnesisFlow.response.answers
        : {};
    const prefillAnswers =
      anamnesisFlow?.prefillAnswers && typeof anamnesisFlow.prefillAnswers === 'object'
        ? anamnesisFlow.prefillAnswers
        : {};
    const questionLabels = {
      ...buildQuestionLabelsFromAnamnesisFlow(anamnesisFlow),
      ...(responseAnswers?.questionLabels && typeof responseAnswers.questionLabels === 'object' ? responseAnswers.questionLabels : {})
    };
    return {
      ...prefillAnswers,
      ...responseAnswers,
      questionLabels,
      formType: anamnesisFlow?.profileType === 'child' ? 'child' : 'adult',
      anamnesisTemplateVersion: Number(anamnesisFlow?.template?.version || responseAnswers?.anamnesisTemplateVersion || 1)
    };
  };

  const openSubmittedAnamnesisForFiles = () => {
    if (!hasSubmittedAnamnesisFlow) return;
    const submittedData = buildSubmittedAnamnesisDocumentData();
    const submittedAt = String(
      anamnesisFlow?.response?.submitted_at ||
        anamnesisFlow?.response?.submittedAt ||
        anamnesisFlow?.request?.submitted_at ||
        new Date().toISOString()
    );
    const referenceDate = submittedAt.slice(0, 10);
    const safePatientName = String(patient?.name || 'Paciente').replace(/\s+/g, '_');
    const documentHtml = buildAnamnesisDocumentHtml(submittedData, referenceDate);
    setPendingAnamnesisPayload(documentHtml);
    setPendingAnamnesisData(submittedData);
    setAnamnesisFileName(`Ficha_Anamnese_${safePatientName}_${referenceDate}.pdf`);
    setAnamnesisFileDate(referenceDate);
    setShowAnamnesisFileModal(true);
    setShowAnamnesis(false);
    setIsPreparingAnamnesisSave(false);
  };

  const handleSendAnamnesisRequest = async () => {
    if (!patient?.id || isSendingAnamnesisRequest) return;
    setAnamnesisFlowMessage("");
    setShowAnamnesisSendModal(true);
    const latestFlow = await loadAnamnesisFlow();
    const nextOptions = buildAnamnesisTemplateOptions(latestFlow || anamnesisFlow);
    const selectedId =
      nextOptions.find((template: any) => template.recommended && template.id)?.id ||
      nextOptions.find((template: any) => template.id)?.id ||
      "";
    setSelectedAnamnesisTemplateId(selectedId);
  };

  const handleConfirmSendAnamnesisRequest = async () => {
    if (!patient?.id || isSendingAnamnesisRequest) return;
    setIsSendingAnamnesisRequest(true);
    setAnamnesisFlowMessage("");
    try {
      const selectedTemplate =
        availableAnamnesisTemplates.find((template: any) => template.id === selectedAnamnesisTemplateId) ||
        availableAnamnesisTemplates[0] ||
        null;
      const templateIdToSend = selectedTemplate?.id || selectedAnamnesisTemplateId || null;
      const result = await dataService.sendPatientAnamnesisRequest(String(patient.id), templateIdToSend);
      if (!result?.success) throw new Error(result?.error || result?.message || 'Não foi possível enviar a ficha.');
      const sentTemplateName = selectedTemplate?.name || result?.data?.templateName || "ficha de anamnese";
      setAnamnesisFlowMessage(result?.message || 'Ficha enviada para a família.');
      onAddActivityLog?.('Ficha de anamnese enviada', `Ficha "${sentTemplateName}" solicitada para ${patient?.name || 'paciente'}.`, 'clinical');
      setShowAnamnesisSendModal(false);
      await loadAnamnesisFlow();
    } catch (error: any) {
      setAnamnesisFlowMessage(error?.message || 'Não foi possível enviar a ficha agora.');
    } finally {
      setIsSendingAnamnesisRequest(false);
    }
  };

  const handleReviewAnamnesisFlow = async () => {
    if (!patient?.id || isReviewingAnamnesis) return;
    setIsReviewingAnamnesis(true);
    setAnamnesisFlowMessage("");
    try {
      const result = await dataService.reviewPatientAnamnesis(
        String(patient.id),
        anamnesisFlow?.request?.id || null,
        anamnesisFlow?.response?.id || null
      );
      if (!result?.success) throw new Error(result?.error || result?.message || 'Não foi possível revisar a anamnese.');
      const growthMilestone = Number(result?.billing?.growthMilestone || result?.data?.billing?.growthMilestone || 0);
      setAnamnesisFlowMessage(
        Number.isInteger(growthMilestone) && growthMilestone >= 10 && growthMilestone % 10 === 0
          ? 'Parabéns! Sua clínica está crescendo.'
          : 'Anamnese marcada como revisada.'
      );
      onUpdatePatient?.({
        id: patient.id,
        status: 'ACTIVE',
        onboardingStatus: 'READY_FOR_CARE',
        onboarding_status: 'READY_FOR_CARE',
        anamnesisPending: false,
        anamnesisData: buildSubmittedAnamnesisDocumentData(),
        lastAnamnesisAt: new Date().toISOString()
      });
      await loadAnamnesisFlow();
    } catch (error: any) {
      setAnamnesisFlowMessage(error?.message || 'Não foi possível revisar a anamnese agora.');
    } finally {
      setIsReviewingAnamnesis(false);
    }
  };

  const canManageTherapistAssignment = useMemo(
    () => hasCapability('team.patient_primary.manage'),
    [capabilities],
  );
  const canManageCaseTeam = useMemo(
    () => hasCapability('team.case.manage'),
    [capabilities],
  );
  const effectiveCaseTeamRole = String(
    userRole || clinicContext?.role || ''
  ).trim().toLowerCase();
  const isUnitCaseTeamManager =
    effectiveCaseTeamRole === 'director' || effectiveCaseTeamRole === 'coordinator';
  const canManagePrimaryProfessionalForPatient =
    canManageTherapistAssignment && (isUnitCaseTeamManager || caseTeamManagementAllowed);
  const canManageSchool = useMemo(
    () => hasCapability('school.manage'),
    [capabilities],
  );
  const isPanelDark = useMemo(() => {
    if (themeMode === 'dark') return true;
    if (themeMode === 'light') return false;
    if (typeof document === 'undefined') return false;
    return document.body.classList.contains('theme-dark');
  }, [themeMode]);
  const showCoordinatorPatientRadar = String(userRole || '').toLowerCase() === 'coordinator';

  useEffect(() => {
    setCaseTeamManagementAllowed(isUnitCaseTeamManager);
  }, [patient?.id, isUnitCaseTeamManager]);
  const [expandedSessionHistoryDates, setExpandedSessionHistoryDates] = useState<Record<string, boolean>>({});
  const progressReportPdfRef = React.useRef<HTMLDivElement | null>(null);

  const toggleSessionHistoryDate = (dateKey: string) => {
    setExpandedSessionHistoryDates((prev) => ({
      ...prev,
      [dateKey]: !prev[dateKey]
    }));
  };

  useEffect(() => {
    const selectCaseTeamProfessionals = (members: any[]) => members.filter((member: any) =>
      isPatientCaseTeamMembershipRole(member?.role) &&
      String(member?.status || '').toLowerCase() === 'active' &&
      String(member?.specialty || '').trim().length >= 2
    );

    const provided = Array.isArray(preloadedClinicProfessionals)
      ? selectCaseTeamProfessionals(preloadedClinicProfessionals)
      : [];
    if (provided.length > 0) {
      setClinicTherapists(provided);
      setIsLoadingTherapists(false);
      return;
    }

    const loadClinicTherapists = async () => {
      if (!canManageTherapistAssignment && !canManageCaseTeam) {
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
        setClinicTherapists(selectCaseTeamProfessionals(result.data));
      } catch (error) {
        console.error('Erro ao carregar profissionais da clínica:', error);
        setClinicTherapists([]);
      } finally {
        setIsLoadingTherapists(false);
      }
    };
    void loadClinicTherapists();
  }, [canManageCaseTeam, canManageTherapistAssignment, patient?.id, preloadedClinicProfessionals]);

  const handleTherapistAssignmentChange = async (nextTherapistId: string) => {
    const patientId = String(patient?.id || '').trim();
    if (!patientId || isSavingPrimaryProfessional) return;
    const normalized = String(nextTherapistId || '').trim();
    const nextValue = isUuidLike(normalized) ? normalized : null;
    const previousValue = selectedTherapistId;
    const previousOverride = primaryProfessionalOverrideRef.current;
    setSelectedTherapistId(nextValue || '');
    setPrimaryProfessionalError('');
    setIsSavingPrimaryProfessional(true);
    try {
      const result = await dataService.setPatientPrimaryProfessional(patientId, nextValue);
      if (!result?.success) {
        throw new Error(result?.message || result?.error || 'Não foi possível atualizar o profissional responsável.');
      }
      primaryProfessionalOverrideRef.current = nextValue;
      setCaseTeamRefreshKey((current) => current + 1);
    } catch (error: any) {
      primaryProfessionalOverrideRef.current = previousOverride;
      setSelectedTherapistId(previousValue);
      setPrimaryProfessionalError(
        String(error?.message || 'Não foi possível atualizar o profissional responsável.'),
      );
    } finally {
      setIsSavingPrimaryProfessional(false);
    }
  };

  const handleCaseTeamLinksChanged = (links: any[]) => {
    const normalizedLinks = Array.isArray(links) ? links : [];
    setCaseTeamLinksSnapshot(normalizedLinks);
    const primaryLink = normalizedLinks.find((link: any) =>
      String(link?.status || '').toLowerCase() === 'active'
      && String(link?.relationship_type || '').toLowerCase() === 'primary'
    );
    if (primaryLink?.professional_id) {
      primaryProfessionalOverrideRef.current = undefined;
      setSelectedTherapistId(String(primaryLink.professional_id));
      return;
    }
    if (isSavingPrimaryProfessional) return;
    if (primaryProfessionalOverrideRef.current === null) {
      setSelectedTherapistId('');
      return;
    }
    if (typeof primaryProfessionalOverrideRef.current === 'string') {
      setSelectedTherapistId(primaryProfessionalOverrideRef.current);
      return;
    }
    setSelectedTherapistId(resolvePatientProfessionalId(patient));
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
    return {
      id: String(file?.id || Date.now()),
      name: safeName,
      size: String(file?.size || (file?.sizeBytes ? `${Math.max(1, Math.round(Number(file.sizeBytes) / 1024))} KB` : '')),
      sizeBytes: Math.max(0, Number(file?.sizeBytes ?? file?.file_size_bytes ?? 0) || 0),
      date: String(file?.date || (file?.createdAt ? new Date(file.createdAt).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR'))),
      type: safeType,
      source: file?.source || 'upload',
      content: safeContent,
      url: safeUrl || undefined,
      uploadedBy: String(file?.uploadedBy || file?.uploaded_by || '').trim() || null,
      accessScope: String(file?.accessScope || file?.access_scope || 'PATIENT_ACCESS').trim().toUpperCase(),
      patientPortalVisible: file?.patientPortalVisible === true || file?.patient_portal_visible === true,
      canManageAccess: file?.canManageAccess === true || file?.can_manage_access === true,
      // PDFs em base64 so viram Blob quando o usuario realmente abre o preview.
      objectUrl: safeUrl || (safeType.includes('pdf') ? undefined : sourceUrl)
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

  const [patientFiles, setPatientFiles] = useState<any[]>([]);
  const [patientFileStorageUsage, setPatientFileStorageUsage] = useState(() =>
    resolvePatientFileStorageUsage(null)
  );
  const syncPatientFileStorageUsage = (value: any, fallbackDeltaBytes = 0) => {
    if (value && typeof value === 'object') {
      setPatientFileStorageUsage(resolvePatientFileStorageUsage(value));
      return;
    }
    if (!fallbackDeltaBytes) return;
    setPatientFileStorageUsage((current) =>
      resolvePatientFileStorageUsage({
        usedBytes: Math.max(0, current.usedBytes + fallbackDeltaBytes),
        limitBytes: current.limitBytes
      })
    );
  };
  const patientFileStorageIsFull = patientFileStorageUsage.usedBytes >= patientFileStorageUsage.limitBytes;
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [patientFilesLoadError, setPatientFilesLoadError] = useState<string | null>(null);
  const [patientFilesReloadKey, setPatientFilesReloadKey] = useState(0);
  const patientFilesPatientIdRef = React.useRef(String(patient?.id || ''));
  const patientFilesLoadedForRef = React.useRef('');
  const patientFilesRequestInFlightRef = React.useRef('');
  const [previewFile, setPreviewFile] = useState<any>(null);
  const [fileAccessEditor, setFileAccessEditor] = useState<any>(null);
  const [fileAccessCandidates, setFileAccessCandidates] = useState<any[]>([]);
  const [fileAccessLoading, setFileAccessLoading] = useState(false);
  const [fileAccessSaving, setFileAccessSaving] = useState(false);
  const [fileAccessError, setFileAccessError] = useState('');

  const patientFileAccessLabels: Record<string, string> = {
    OWNER: 'Somente eu',
    CASE_TEAM: 'Equipe do caso',
    PATIENT_ACCESS: 'Quem já acessa o paciente',
    SELECTED: 'Pessoas selecionadas'
  };

  const openPatientFileAccessEditor = async (file: any) => {
    const patientId = String(patient?.id || '').trim();
    const fileId = String(file?.id || '').trim();
    if (!patientId || !fileId || file?.canManageAccess !== true) return;
    setFileAccessLoading(true);
    setFileAccessError('');
    setFileAccessCandidates([]);
    setFileAccessEditor({
      file,
      accessScope: String(file?.accessScope || 'PATIENT_ACCESS').toUpperCase(),
      patientPortalVisible: file?.patientPortalVisible === true,
      selectedUserIds: []
    });
    try {
      const [permissionsResult, linksResult] = await Promise.all([
        dataService.getPatientFilePermissions(patientId, fileId),
        dataService.getPatientProfessionalLinks(patientId)
      ]);
      if (!permissionsResult?.success || !permissionsResult?.data) {
        throw new Error(permissionsResult?.error || 'Não foi possível carregar os níveis de acesso deste arquivo.');
      }
      const candidates = (Array.isArray(linksResult?.links) ? linksResult.links : [])
        .filter((link: any) => String(link?.status || '').toLowerCase() === 'active' && link?.accessEnabled !== false)
        .map((link: any) => ({
          id: String(link?.professional_id || link?.professional?.id || '').trim(),
          name: String(link?.professional?.name || link?.professional_name || '').trim() || 'Profissional',
          specialty: String(link?.specialty || link?.professional?.specialty || '').trim()
        }))
        .filter((item: any) => isUuidLike(item.id));
      setFileAccessCandidates(Array.from(new Map(candidates.map((item: any) => [item.id, item])).values()));
      setFileAccessEditor({
        file,
        accessScope: String(permissionsResult.data.accessScope || 'PATIENT_ACCESS').toUpperCase(),
        patientPortalVisible: permissionsResult.data.patientPortalVisible === true,
        selectedUserIds: Array.isArray(permissionsResult.data.selectedUserIds) ? permissionsResult.data.selectedUserIds.map(String) : []
      });
    } catch (error: any) {
      setFileAccessError(String(error?.message || 'Não foi possível carregar os níveis de acesso.'));
    } finally {
      setFileAccessLoading(false);
    }
  };

  const savePatientFileAccess = async () => {
    const patientId = String(patient?.id || '').trim();
    const fileId = String(fileAccessEditor?.file?.id || '').trim();
    if (!patientId || !fileId || fileAccessSaving) return;
    setFileAccessSaving(true);
    setFileAccessError('');
    try {
      const result = await dataService.updatePatientFilePermissions(patientId, fileId, {
        accessScope: fileAccessEditor.accessScope,
        patientPortalVisible: fileAccessEditor.patientPortalVisible === true,
        selectedUserIds: fileAccessEditor.accessScope === 'SELECTED' ? fileAccessEditor.selectedUserIds : []
      });
      if (!result?.success || !result?.data) throw new Error(result?.error || 'Não foi possível salvar os níveis de acesso.');
      setPatientFiles((current) => current.map((item: any) => String(item.id) === fileId ? {
        ...item,
        accessScope: String(result.data.accessScope || fileAccessEditor.accessScope).toUpperCase(),
        patientPortalVisible: result.data.patientPortalVisible === true,
        canManageAccess: true
      } : item));
      setFileAccessEditor(null);
      setFileAccessCandidates([]);
    } catch (error: any) {
      setFileAccessError(String(error?.message || 'Não foi possível salvar os níveis de acesso.'));
    } finally {
      setFileAccessSaving(false);
    }
  };

  const openPatientFilePreview = async (file: any) => {
    const patientId = String(patient?.id || '').trim();
    const fileId = String(file?.id || '').trim();
    let resolvedFile = file;
    if (patientId && fileId) {
      const accessResult = await dataService.accessPatientFile(patientId, fileId, 'view');
      if (!accessResult?.success || !accessResult?.data) {
        alert(accessResult?.error || 'Não foi possível abrir este arquivo com auditoria.');
        return;
      }
      resolvedFile = normalizeFileRecord(accessResult.data);
    }
    const objectUrl = resolveFileViewUrl(resolvedFile);
    setPreviewFile(objectUrl ? { ...resolvedFile, objectUrl } : resolvedFile);
  };

  useEffect(() => () => {
    const objectUrl = String(previewFile?.objectUrl || '');
    if (!objectUrl.startsWith('blob:')) return;
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {}
  }, [previewFile?.objectUrl]);

  useEffect(() => {
    const patientId = String(patient?.id || '');
    if (patientFilesPatientIdRef.current === patientId) return;
    patientFilesPatientIdRef.current = patientId;
    patientFilesLoadedForRef.current = '';
    setPatientFiles([]);
    setPatientFileStorageUsage(resolvePatientFileStorageUsage(null));
    setPreviewFile(null);
    setIsLoadingFiles(false);
    setPatientFilesLoadError(null);
  }, [patient?.id]);

  useEffect(() => {
    const patientId = String(patient?.id || '');
    const shouldLoadFiles = activeTab === 'files' || Boolean(previewFile);
    if (!patientId || !shouldLoadFiles) return;
    if (
      patientFilesLoadedForRef.current === patientId ||
      patientFilesRequestInFlightRef.current === patientId
    ) return;

    patientFilesRequestInFlightRef.current = patientId;
    setIsLoadingFiles(true);
    setPatientFilesLoadError(null);
    const loadPersistedFiles = async () => {
      let loaded = false;
      try {
        const result = await dataService.getPatientFiles(patientId);
        if (patientFilesPatientIdRef.current !== patientId) return;
        if (result?.success && Array.isArray(result?.data)) {
          const normalizedFiles = result.data.map(normalizeFileRecord);
          setPatientFiles(normalizedFiles);
          if (result?.storageUsage) {
            setPatientFileStorageUsage(resolvePatientFileStorageUsage(result.storageUsage));
          } else {
            const visibleUsedBytes = normalizedFiles.reduce(
              (total: number, file: any) => total + Math.max(0, Number(file?.sizeBytes || 0) || 0),
              0
            );
            setPatientFileStorageUsage(resolvePatientFileStorageUsage({ usedBytes: visibleUsedBytes }));
          }
          loaded = true;
          return;
        }
        throw new Error('Resposta inválida ao carregar arquivos do prontuário.');
      } catch (error) {
        if (patientFilesPatientIdRef.current === patientId) {
          console.error('Erro ao carregar arquivos persistidos do paciente:', error);
          setPatientFilesLoadError('Não foi possível carregar os arquivos. Tente novamente.');
        }
      } finally {
        if (patientFilesPatientIdRef.current === patientId) {
          if (loaded) patientFilesLoadedForRef.current = patientId;
          setIsLoadingFiles(false);
        }
        if (patientFilesRequestInFlightRef.current === patientId) {
          patientFilesRequestInFlightRef.current = '';
        }
      }
    };
    void loadPersistedFiles();
  }, [activeTab, patient?.id, patientFilesReloadKey, previewFile]);
  
  const [showAnamnesisFileModal, setShowAnamnesisFileModal] = useState(false);
  const [pendingAnamnesisPayload, setPendingAnamnesisPayload] = useState<string>("");
  const [pendingAnamnesisData, setPendingAnamnesisData] = useState<any>(null);
  const [anamnesisFileName, setAnamnesisFileName] = useState("");
  const [anamnesisFileDate, setAnamnesisFileDate] = useState(new Date().toISOString().slice(0, 10));
  const [isPreparingAnamnesisSave, setIsPreparingAnamnesisSave] = useState(false);
  const [isSavingAnamnesisFile, setIsSavingAnamnesisFile] = useState(false);
  const [resolvedClinicContext, setResolvedClinicContext] = useState<any>(clinicContext || {});
  const patientPhotoInputRef = React.useRef<HTMLInputElement | null>(null);
  const [patientPhotoOverride, setPatientPhotoOverride] = useState('');
  const [isSavingPatientPhoto, setIsSavingPatientPhoto] = useState(false);
  const [patientPhotoError, setPatientPhotoError] = useState('');
  const patientPhotoPolicy = String(
    resolvedClinicContext?.patientPhotoPolicy ||
    resolvedClinicContext?.patient_photo_policy ||
    clinicContext?.patientPhotoPolicy ||
    clinicContext?.patient_photo_policy ||
    'PORTAL'
  ).toUpperCase() === 'CLINIC' ? 'CLINIC' : 'PORTAL';
  const portalPatientPhotoSource = String(
    patient?.portalProfilePicture ||
    patient?.portal_profile_picture ||
    patient?.portalProfilePictureUrl ||
    patient?.portal_profile_picture_url ||
    ''
  ).trim();
  const resolvedPatientPhotoSource = patientPhotoOverride || (
    patientPhotoPolicy === 'PORTAL'
      ? (portalPatientPhotoSource || patientPhotoSource(patient))
      : patientPhotoSource(patient)
  );
  const normalizedPatientPhotoRole = String(userRole || resolvedClinicContext?.role || clinicContext?.role || '').trim().toLowerCase();
  const canManagePatientPhoto = patientPhotoPolicy === 'CLINIC' &&
    ['director', 'coordinator', 'receptionist'].includes(normalizedPatientPhotoRole) &&
    typeof onUpdatePatient === 'function';

  useEffect(() => {
    setPatientPhotoOverride('');
    setPatientPhotoError('');
  }, [patient?.id, patientPhotoPolicy]);

  const handleClinicalPatientPhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !canManagePatientPhoto || !patient?.id) return;
    if (!String(file.type || '').toLowerCase().startsWith('image/')) {
      setPatientPhotoError('Selecione uma imagem válida.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setPatientPhotoError('Escolha uma imagem de até 2MB.');
      return;
    }

    setIsSavingPatientPhoto(true);
    setPatientPhotoError('');
    try {
      const extension = file.type.includes('jpeg') || file.type.includes('jpg') ? 'jpg' : file.type.includes('webp') ? 'webp' : 'png';
      const uploadPath = `${String(patient.id)}/clinic-profile-${Date.now()}.${extension}`;
      const upload = await dataService.uploadFile('patient-photos', uploadPath, file);
      if (!upload?.success || !upload?.url) {
        throw new Error(upload?.error || 'Não foi possível enviar a foto.');
      }

      const updatedPatient = {
        ...patient,
        profilePicture: upload.url,
        profile_picture: upload.url,
        profilePicturePath: upload.path || null,
        profile_picture_path: upload.path || null,
      };
      const updateResult = await onUpdatePatient(updatedPatient);
      if (updateResult?.success === false) {
        throw new Error(updateResult?.error || updateResult?.message || 'Não foi possível salvar a foto do paciente.');
      }
      setPatientPhotoOverride(String(upload.url));
    } catch (error: any) {
      setPatientPhotoError(error?.message || 'Não foi possível salvar a foto do paciente.');
    } finally {
      setIsSavingPatientPhoto(false);
    }
  };

  const canReopenAutomaticNoShow = useMemo(
    () => hasCapability('session.no_show.classify'),
    [capabilities],
  );
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [assignedTasks, setAssignedTasks] = useState<any[]>([]);
  const [isLoadingAssignedTasks, setIsLoadingAssignedTasks] = useState(false);
  const [assignedTasksLoadError, setAssignedTasksLoadError] = useState<string | null>(null);
  const [assignedTasksReloadKey, setAssignedTasksReloadKey] = useState(0);
  const assignedTasksLoadedForRef = React.useRef('');
  const assignedTasksRequestRef = React.useRef<{ patientId: string; promise: Promise<any> } | null>(null);
  const [assignedReviewDrafts, setAssignedReviewDrafts] = useState<Record<string, { score: string; note: string }>>({});
  const [generatedReviewNotes, setGeneratedReviewNotes] = useState<any[]>([]);
  const [suggestedInterventionTasks, setSuggestedInterventionTasks] = useState<any[]>([]);
  const [suggestionsHydratedKey, setSuggestionsHydratedKey] = useState('');
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
  const interventionSuggestionsStorageKey = useMemo(
    () => `verto.adult-intervention-suggestions:${String(patient?.id || 'unknown')}`,
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
  const scheduledSessionForPatient = useMemo(() => {
    if (!scheduledSession) return null;
    const scheduledPatientId = String(scheduledSession?.patientId || scheduledSession?.patient_id || '').trim();
    const patientId = String(patient?.id || '').trim();
    if (scheduledPatientId && patientId && scheduledPatientId !== patientId) return null;
    return scheduledSession;
  }, [patient?.id, scheduledSession]);
  const scheduledSessionDurationMinutes = useMemo(
    () => getAppointmentDurationMinutes(scheduledSessionForPatient, configuredDefaultSessionMinutes),
    [configuredDefaultSessionMinutes, scheduledSessionForPatient],
  );
  const [activeSession, setActiveSession] = useState<any>(null);
  const [sessionDurationInput, setSessionDurationInput] = useState(String(configuredDefaultSessionMinutes));
  const [remainingSessionSeconds, setRemainingSessionSeconds] = useState(0);
  const [showSessionStartConfirm, setShowSessionStartConfirm] = useState(false);
  const [pendingSessionAction, setPendingSessionAction] = useState<'tab' | 'fullscreen'>('tab');
  const [restoreSessionData, setRestoreSessionData] = useState(false);
  const [clearMaintenanceOnSessionRestore, setClearMaintenanceOnSessionRestore] = useState(false);
  const [noShowReopenPrompt, setNoShowReopenPrompt] = useState<{
    appointmentId: string;
    durationMinutes: number;
    openSessionMode: boolean;
  } | null>(null);
  const [noShowReopenReason, setNoShowReopenReason] = useState('');
  const [noShowReopenError, setNoShowReopenError] = useState('');
  const [isReopeningNoShow, setIsReopeningNoShow] = useState(false);
  const noShowReopenIdempotencyKeyRef = React.useRef('');
  const consumedScheduledSessionStartKeyRef = React.useRef('');
  const [abaSessions, setAbaSessions] = useState<any[]>([]);
  const [abaTrials, setAbaTrials] = useState<any[]>([]);
  const [abaBehaviorEvents, setAbaBehaviorEvents] = useState<any[]>([]);
  const [abaMasteryEvaluations, setAbaMasteryEvaluations] = useState<any[]>([]);
  const [abaMasteryPreviewEvaluations, setAbaMasteryPreviewEvaluations] = useState<any[]>([]);
  const [abaPatientSummary, setAbaPatientSummary] = useState<any>(null);
  const [abaMaintenanceOverview, setAbaMaintenanceOverview] = useState<any>({ schedules: [], probeResults: [], alerts: [], summary: null });
  const [isLoadingAbaRecords, setIsLoadingAbaRecords] = useState(false);
  const [abaRecordsError, setAbaRecordsError] = useState("");
  const [abaRecordTypeFilter, setAbaRecordTypeFilter] = useState("all");
  const [abaSessionFilter, setAbaSessionFilter] = useState("all");
  const [abaRecordSearch, setAbaRecordSearch] = useState("");
  const [abaRecordsRefreshKey, setAbaRecordsRefreshKey] = useState(0);
  const abaRecordsPatientIdRef = React.useRef(String(patient?.id || ''));
  const abaRecordsLoadedKeyRef = React.useRef('');
  const abaRecordsFailedKeyRef = React.useRef('');
  const abaRecordsExpectedKeyRef = React.useRef('');
  const abaRecordsRequestRef = React.useRef<{ key: string; promise: Promise<void> } | null>(null);
  const [isAbaPanelExpanded, setIsAbaPanelExpanded] = useState(false);
  const notes = useMemo(() => {
    const baseNotes = Array.isArray(externalNotes) ? externalNotes : [];
    if (!generatedReviewNotes.length) return baseNotes;
    const existingIds = new Set(baseNotes.map((note: any) => String(note?.id || '')));
    const localOnly = generatedReviewNotes.filter((note: any) => !existingIds.has(String(note?.id || '')));
    return [...localOnly, ...baseNotes];
  }, [externalNotes, generatedReviewNotes]);

  const abaMasteryEvaluationsForPlan = useMemo(() => {
    const persisted = Array.isArray(abaMasteryEvaluations) ? abaMasteryEvaluations : [];
    const preview = Array.isArray(abaMasteryPreviewEvaluations) ? abaMasteryPreviewEvaluations : [];
    if (preview.length === 0) return persisted;
    const normalizeName = (value: any) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('pt-BR');
    const identityKeys = (row: any) => {
      const id = String(row?.target_id || row?.targetId || '').trim();
      const name = normalizeName(row?.target_name || row?.targetName || row?.name);
      return [id ? `id:${id}` : '', name ? `name:${name}` : ''].filter(Boolean);
    };
    const previewKeys = new Set(preview.flatMap(identityKeys));
    return [
      ...preview,
      ...persisted.filter((row: any) => !identityKeys(row).some((key: string) => previewKeys.has(key)))
    ];
  }, [abaMasteryEvaluations, abaMasteryPreviewEvaluations]);

  useEffect(() => {
    setResolvedClinicContext(clinicContext || {});
  }, [clinicContext]);

  useEffect(() => {
    setSessionDurationInput(String(scheduledSessionForPatient ? scheduledSessionDurationMinutes : configuredDefaultSessionMinutes));
  }, [configuredDefaultSessionMinutes, patient?.id, scheduledSessionDurationMinutes, scheduledSessionForPatient]);

  useEffect(() => {
    const nextPatientId = String(patient?.id || '');
    if (abaRecordsPatientIdRef.current !== nextPatientId) {
      abaRecordsPatientIdRef.current = nextPatientId;
      abaRecordsLoadedKeyRef.current = '';
      abaRecordsFailedKeyRef.current = '';
      abaRecordsExpectedKeyRef.current = '';
      setAbaSessions([]);
      setAbaTrials([]);
      setAbaBehaviorEvents([]);
      setAbaMasteryEvaluations([]);
      setAbaMasteryPreviewEvaluations([]);
      setAbaPatientSummary(null);
      setAbaMaintenanceOverview({ schedules: [], probeResults: [], alerts: [], summary: null });
      setAbaRecordsError('');
      setIsLoadingAbaRecords(false);
    }
    peiMaintenancePanelPatientIdRef.current = String(patient?.id || '');
    peiMaintenancePanelRequestSeqRef.current += 1;
    setGeneratedReviewNotes([]);
    setSessionPatientOverride(null);
    setLocalSessionReportId('');
    setCompletedSessionReports([]);
    setCompletedSessionReportsError('');
    setCompletedSessionReportsLoading(false);
    completedSessionReportsLoadedForRef.current = '';
    setRestoreSessionData(false);
    setClearMaintenanceOnSessionRestore(false);
    setActivePeiPlanSubtab('teaching');
    setHasLoadedPeiMaintenancePanel(false);
    setPeiMaintenancePanelMessage('');
    setAbaMaintenancePanel(null);
    setPeiMaintenanceAssignSchedule(null);
    setPeiMaintenanceScheduleRow(null);
    setPeiMaintenanceScheduleMode('NEXT_PATIENT_SESSION');
    setPeiMaintenanceScheduleDate('');
    setPeiMaintenanceReviewRow(null);
    setPeiMaintenanceReviewTargetId('');
    setPeiMaintenanceLinkableTargetsState({ loading: false, error: '', items: [], loadedFor: '' });
    setSelectedPeiMaintenanceAppointmentId('');
    setPeiMaintenanceAppointmentsState({ loading: false, error: '', items: [] });
    setIsPeiMaintenanceTechnicalExpanded(false);
  }, [patient?.id]);

  const sessionModePatient = useMemo(() => {
    if (
      sessionPatientOverride &&
      String(sessionPatientOverride?.id || '') === String(patient?.id || '') &&
      Array.isArray(sessionPatientOverride?.pei)
    ) {
      return { ...patient, pei: sessionPatientOverride.pei };
    }
    return patient;
  }, [patient, sessionPatientOverride]);

  const requestedSessionReportId = String(sessionReportId || localSessionReportId || '').trim();

  useEffect(() => {
    const externalReportId = String(sessionReportId || '').trim();
    if (!externalReportId) return;
    setLocalSessionReportId('');
    setIsSessionModeOpen(true);
  }, [patient?.id, sessionReportId]);

  useEffect(() => {
    const patientId = String(patient?.id || '').trim();
    if (!patientId || !isKidsProfile || !(abaV2Enabled || abaV3UiEnabled) || activeTab !== 'history') return;
    if (completedSessionReportsLoadedForRef.current === patientId) return;
    let cancelled = false;
    setCompletedSessionReportsLoading(true);
    setCompletedSessionReportsError('');
    dataService.getAbaSessions(patientId, { page: 1, pageSize: 10 })
      .then((result: any) => {
        if (cancelled) return;
        if (result?.success === false || !Array.isArray(result?.data)) {
          setCompletedSessionReportsError(result?.error || 'Não foi possível carregar as sessões finalizadas.');
          return;
        }
        const completed = result.data
          .filter((session: any) => ['completed', 'concluida', 'concluída'].includes(String(session?.status || '').trim().toLowerCase()))
          .sort((left: any, right: any) => new Date(right?.ended_at || right?.actual_end_at || right?.updated_at || 0).getTime() - new Date(left?.ended_at || left?.actual_end_at || left?.updated_at || 0).getTime());
        setCompletedSessionReports(completed);
        completedSessionReportsLoadedForRef.current = patientId;
      })
      .catch(() => {
        if (!cancelled) setCompletedSessionReportsError('Não foi possível carregar as sessões finalizadas.');
      })
      .finally(() => {
        if (!cancelled) setCompletedSessionReportsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, abaV2Enabled, abaV3UiEnabled, isKidsProfile, patient?.id]);

  const openCompletedSessionReport = (sessionId: any) => {
    const nextSessionId = String(sessionId || '').trim();
    if (!nextSessionId) return;
    setLocalSessionReportId(nextSessionId);
    setIsSessionModeOpen(true);
  };

  const closeSessionMode = () => {
    setIsSessionModeOpen(false);
    if (requestedSessionReportId) {
      setLocalSessionReportId('');
      onSessionReportConsumed?.();
    }
  };

  useEffect(() => {
    const patientId = String(patient?.id || '');
    if (!patientId || !isKidsProfile || !abaV2Enabled) return;

    const requestKey = `${patientId}:${abaRecordsRefreshKey}`;
    abaRecordsExpectedKeyRef.current = requestKey;

    // O detalhamento desta tela alimenta apenas o PEI. Historico usa sua pagina
    // paginada, Graficos possui workspace proprio e Sessao carrega o necessario
    // no fluxo de atendimento, portanto nao devem repetir este burst de 6 leituras.
    if (activeTab !== 'plan') return;

    if (abaRecordsLoadedKeyRef.current === requestKey) return;
    // Uma tentativa incompleta aguarda retry explicito. Assim, alternar abas nao
    // dispara novamente o mesmo conjunto de leituras e o vazio de fallback nao
    // e promovido a cache valido.
    if (abaRecordsFailedKeyRef.current === requestKey) return;
    if (abaRecordsRequestRef.current?.key === requestKey) return;

    const loadAbaRecords = async () => {
      setIsLoadingAbaRecords(true);
      setAbaRecordsError("");
      try {
        const recentRecordLimit = 10;
        const peiProgressRecordLimit = 50;
        const [patientSummaryResult, sessionsResult, trialsResult, behaviorResult, masteryResult, maintenanceResult] = await Promise.allSettled([
          dataService.getPatientAbaSummary(patientId),
          dataService.getAbaSessions(patientId, { page: 1, pageSize: recentRecordLimit }),
          dataService.getAbaTrials(patientId, { page: 1, pageSize: peiProgressRecordLimit }),
          dataService.getAbaBehaviorEvents(patientId, { page: 1, pageSize: recentRecordLimit }),
          dataService.getAbaMasteryEvaluations(patientId, { page: 1, pageSize: peiProgressRecordLimit }),
          dataService.getAbaMaintenanceOverview(patientId, { page: 1, pageSize: recentRecordLimit })
        ]);
        if (abaRecordsExpectedKeyRef.current !== requestKey) return;
        const hasOwnData = (value: any) => Boolean(value && Object.prototype.hasOwnProperty.call(value, 'data'));
        const readListData = (result: PromiseSettledResult<any>) => {
          if (result.status !== 'fulfilled') return { confirmed: false, data: null as any[] | null };
          const payload = result.value;
          if (payload?.success === false || !Array.isArray(payload?.data)) {
            return { confirmed: false, data: null as any[] | null };
          }
          const data = payload.data as any[];
          // Respostas canonicas paginadas confirmam inclusive um vazio real.
          // Fallbacks offline nao paginados so sao considerados utilizaveis
          // quando possuem registros persistidos localmente.
          const hasCanonicalPage = Number.isFinite(Number(payload?.page)) && Number(payload?.page) >= 1;
          const confirmed = hasCanonicalPage || data.length > 0;
          return { confirmed, data: confirmed ? data : null };
        };
        const readMaintenanceData = (result: PromiseSettledResult<any>) => {
          if (result.status !== 'fulfilled') return { confirmed: false, data: null as any };
          const payload = result.value;
          const data = payload?.data;
          if (payload?.success === false || !data || typeof data !== 'object' || Array.isArray(data)) {
            return { confirmed: false, data: null as any };
          }
          const hasPersistedData = ['schedules', 'probeResults', 'alerts']
            .some((key) => Array.isArray(data?.[key]) && data[key].length > 0) || Boolean(data?.summary);
          const hasCanonicalPage = Number.isFinite(Number(payload?.page)) && Number(payload?.page) >= 1;
          const confirmed = hasCanonicalPage || hasPersistedData;
          return { confirmed, data: confirmed ? data : null };
        };

        const summaryConfirmed = patientSummaryResult.status === 'fulfilled'
          && patientSummaryResult.value?.success !== false
          && hasOwnData(patientSummaryResult.value);
        const sessionsRead = readListData(sessionsResult);
        const trialsRead = readListData(trialsResult);
        const behaviorRead = readListData(behaviorResult);
        const masteryRead = readListData(masteryResult);
        const maintenanceRead = readMaintenanceData(maintenanceResult);
        const allAbaSourcesConfirmed = summaryConfirmed
          && sessionsRead.confirmed
          && trialsRead.confirmed
          && behaviorRead.confirmed
          && masteryRead.confirmed
          && maintenanceRead.confirmed;

        // Uma falha parcial nunca apaga o ultimo conjunto conhecido. Dados
        // offline nao vazios continuam validos e podem atualizar sua secao.
        if (summaryConfirmed && (patientSummaryResult.value?.data != null || allAbaSourcesConfirmed)) {
          setAbaPatientSummary(patientSummaryResult.value?.data || null);
        }
        if (sessionsRead.data !== null) setAbaSessions(sessionsRead.data);
        if (trialsRead.data !== null) setAbaTrials(trialsRead.data);
        if (behaviorRead.data !== null) setAbaBehaviorEvents(behaviorRead.data);
        if (masteryRead.data !== null) setAbaMasteryEvaluations(masteryRead.data);
        if (maintenanceRead.data !== null) setAbaMaintenanceOverview(maintenanceRead.data);

        if (allAbaSourcesConfirmed) {
          abaRecordsFailedKeyRef.current = '';
          abaRecordsLoadedKeyRef.current = requestKey;
        } else {
          abaRecordsFailedKeyRef.current = requestKey;
          setAbaRecordsError('Alguns registros ABA não puderam ser confirmados. Tente novamente.');
        }
      } catch (error) {
        if (abaRecordsExpectedKeyRef.current === requestKey) {
          console.error('Falha ao carregar registros ABA:', error);
          abaRecordsFailedKeyRef.current = requestKey;
          setAbaRecordsError('Não foi possível carregar os registros ABA. Tente novamente.');
        }
      } finally {
        if (abaRecordsExpectedKeyRef.current === requestKey) setIsLoadingAbaRecords(false);
        if (abaRecordsRequestRef.current?.key === requestKey) {
          abaRecordsRequestRef.current = null;
        }
      }
    };

    const promise = loadAbaRecords();
    abaRecordsRequestRef.current = { key: requestKey, promise };
  }, [activeTab, patient?.id, isKidsProfile, abaV2Enabled, abaRecordsRefreshKey]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setSuggestedInterventionTasks([]);
      return;
    }
    try {
      const persisted = JSON.parse(window.localStorage.getItem(interventionSuggestionsStorageKey) || '[]');
      setSuggestedInterventionTasks(Array.isArray(persisted) ? persisted : []);
    } catch {
      setSuggestedInterventionTasks([]);
    }
    setSuggestionsHydratedKey(interventionSuggestionsStorageKey);
  }, [interventionSuggestionsStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined' || suggestionsHydratedKey !== interventionSuggestionsStorageKey) return;
    window.localStorage.setItem(interventionSuggestionsStorageKey, JSON.stringify(suggestedInterventionTasks.slice(0, 12)));
  }, [interventionSuggestionsStorageKey, suggestedInterventionTasks, suggestionsHydratedKey]);

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
      const status = String(parsed?.status || '').toLowerCase();
      if (String(parsed?.patientId) !== String(patient?.id) || !['active', 'in_progress'].includes(status)) return null;
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

  const requestSessionStart = (nextAction: 'tab' | 'fullscreen' = 'fullscreen') => {
    const resolvedAction = nextAction === 'tab' ? 'fullscreen' : nextAction;
    if (!abaV2Enabled) {
      setActiveTab(getSessionFallbackTab());
      return;
    }
    if (activeSession) {
      setIsSessionModeOpen(true);
      return;
    }
    setPendingSessionAction(resolvedAction);
    setSessionDurationInput(String(scheduledSessionForPatient ? scheduledSessionDurationMinutes : configuredDefaultSessionMinutes));
    setRestoreSessionData(false);
    setClearMaintenanceOnSessionRestore(false);
    setShowSessionStartConfirm(true);
  };

  const handleConfirmSessionStart = async (options?: {
    durationMinutes?: number;
    openSessionMode?: boolean;
    skipSessionPreparation?: boolean;
  }) => {
    const requestedDuration = options?.durationMinutes ?? Number(sessionDurationInput);
    const parsedDuration = Number(requestedDuration);
    const fallbackDuration = scheduledSessionForPatient ? scheduledSessionDurationMinutes : configuredDefaultSessionMinutes;
    const durationMinutes = Math.max(
      5,
      Math.min(
        240,
        Math.round(Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : fallbackDuration),
      ),
    );
    const startedAt = new Date();
    const resetAt = startedAt.getTime();
    const shouldPrepareSession = !options?.skipSessionPreparation;
    const shouldClearMaintenance = Boolean(
      shouldPrepareSession && restoreSessionData && clearMaintenanceOnSessionRestore && isKidsProfile && patient?.id
    );
    if (shouldPrepareSession && restoreSessionData && isKidsProfile && Array.isArray(patient?.pei) && onUpdatePatient) {
      const updatedPei = buildPeiSessionProgressReset(patient.pei, resetAt, {
        clearMaintenance: shouldClearMaintenance
      });
      const restoredPatient = {
        ...patient,
        id: patient.id,
        pei: updatedPei
      };
      const updateResult = await onUpdatePatient({
        ...restoredPatient
      });
      if (updateResult?.success === false) {
        alert(`Não foi possível restaurar os dados de sessão agora: ${updateResult?.error || 'falha ao salvar o PEI.'}`);
        return;
      }
      setSessionPatientOverride(restoredPatient);
      onAddNote?.(
        patient.id,
        `Dados de preenchimento do PEI restaurados em ${startedAt.toLocaleString('pt-BR')}. O plano estruturado foi mantido e os novos registros passam a contar a partir desta sessão.`,
        'private',
        'Sessão'
      );
      onAddActivityLog?.(
        'Dados de sessão restaurados',
        `Preenchimento do PEI de ${patient?.name || 'paciente'} reiniciado sem apagar o plano estruturado.`,
        'clinical'
      );
    }
    if (shouldClearMaintenance) {
      const clearResult = await dataService.clearPatientAbaMaintenance(String(patient.id), {
        resetAt: startedAt.toISOString(),
        reason: 'SESSION_RESTORE_CLEAR_MAINTENANCE'
      });
      if (clearResult?.success === false) {
        alert(`Não foi possível apagar as manutenções agora: ${clearResult?.error || clearResult?.message || 'falha ao atualizar a manutenção.'}`);
        return;
      }
      setAbaMaintenanceOverview((prev: any) => ({
        ...(prev || {}),
        schedules: [],
        summary: prev?.summary || null
      }));
      setAbaMaintenancePanel(null);
      setHasLoadedPeiMaintenancePanel(false);
      setPeiMaintenancePanelMessage('Manutenções apagadas para esta nova sessão.');
      setAbaRecordsRefreshKey((value) => value + 1);
      onAddNote?.(
        patient.id,
        `Manutenções ativas apagadas em ${startedAt.toLocaleString('pt-BR')} durante a restauração dos dados de sessão.`,
        'private',
        'Sessão'
      );
      onAddActivityLog?.(
        'Manutenções apagadas',
        `Sondagens de manutenção de ${patient?.name || 'paciente'} foram removidas do fluxo ativo para a nova sessão.`,
        'clinical'
      );
    }
    const endsAt = new Date(startedAt.getTime() + durationMinutes * 60 * 1000);
    const scheduledStartFromLocalFields =
      scheduledSessionForPatient?.date && scheduledSessionForPatient?.time
        ? buildAppointmentDateTime(scheduledSessionForPatient.date, scheduledSessionForPatient.time)
        : null;
    const scheduledStart =
      scheduledSessionForPatient?.scheduled_start_at ||
      scheduledSessionForPatient?.scheduledStartAt ||
      scheduledSessionForPatient?.scheduledAt ||
      scheduledSessionForPatient?.scheduled_at ||
      scheduledStartFromLocalFields?.toISOString() ||
      null;
    const calculatedScheduledEnd = calculateAppointmentEnd(scheduledStart, scheduledSessionDurationMinutes);
    const scheduledEnd =
      scheduledSessionForPatient?.scheduled_end_at ||
      scheduledSessionForPatient?.scheduledEndAt ||
      scheduledSessionForPatient?.end_time ||
      scheduledSessionForPatient?.endTime ||
      calculatedScheduledEnd?.toISOString() ||
      null;
    const scheduledProfessionalId =
      scheduledSessionForPatient?.professional_id ||
      scheduledSessionForPatient?.professionalId ||
      scheduledSessionForPatient?.therapist_id ||
      scheduledSessionForPatient?.therapistId ||
      resolvedClinicContext?.userId ||
      clinicContext?.userId ||
      null;
    const scheduledServiceType =
      scheduledSessionForPatient?.service_type ||
      scheduledSessionForPatient?.serviceType ||
      scheduledSessionForPatient?.type ||
      scheduledSessionForPatient?.approach ||
      null;
    const scheduledAppointmentId =
      scheduledSessionForPatient?.appointment_id ||
      scheduledSessionForPatient?.appointmentId ||
      scheduledSessionForPatient?.id ||
      null;
    if (scheduledSessionForPatient && !isUuidLike(scheduledAppointmentId)) {
      setShowSessionStartConfirm(false);
      alert('Esta sessão ainda não foi salva no servidor. Atualize a agenda e tente novamente.');
      return;
    }
    const nextSession = {
      id: `session-${String(patient?.id || 'patient')}-${startedAt.getTime()}`,
      patientId: patient?.id,
      patientName: patient?.name || 'Paciente',
      appointmentId: scheduledAppointmentId,
      appointment_id: scheduledAppointmentId,
      professionalId: scheduledProfessionalId,
      professional_id: scheduledProfessionalId,
      therapistId: scheduledProfessionalId,
      therapist_id: scheduledProfessionalId,
      therapistName: resolvedClinicContext?.professionalName || resolvedClinicContext?.userName || clinicContext?.professionalName || clinicContext?.userName || patient?.therapistName || patient?.therapist_name || null,
      clinicId: resolvedClinicContext?.clinicId || clinicContext?.clinicId || patient?.clinicId || patient?.clinic_id || null,
      serviceType: scheduledServiceType,
      service_type: scheduledServiceType,
      status: 'active',
      durationMinutes,
      scheduledDurationMinutes: scheduledSessionForPatient ? scheduledSessionDurationMinutes : durationMinutes,
      scheduled_duration_minutes: scheduledSessionForPatient ? scheduledSessionDurationMinutes : durationMinutes,
      scheduledStart,
      scheduled_start: scheduledStart,
      scheduledEnd,
      scheduled_end: scheduledEnd,
      roomId: scheduledSessionForPatient?.roomId || scheduledSessionForPatient?.room_id || scheduledSessionForPatient?.room || null,
      room_id: scheduledSessionForPatient?.roomId || scheduledSessionForPatient?.room_id || scheduledSessionForPatient?.room || null,
      roomName: scheduledSessionForPatient?.roomName || scheduledSessionForPatient?.room_name || scheduledSessionForPatient?.roomDisplayName || null,
      room_name: scheduledSessionForPatient?.roomName || scheduledSessionForPatient?.room_name || scheduledSessionForPatient?.roomDisplayName || null,
      locationType: scheduledSessionForPatient?.locationType || scheduledSessionForPatient?.location_type || scheduledSessionForPatient?.location || null,
      location_type: scheduledSessionForPatient?.locationType || scheduledSessionForPatient?.location_type || scheduledSessionForPatient?.location || null,
      startedAt: startedAt.toISOString(),
      endsAt: endsAt.toISOString(),
      referenceDate: formatDateInAppointmentTimezone(startedAt) || startedAt.toISOString().slice(0, 10),
      recordCount: 0
    };
    persistActiveSession(nextSession);
    if (abaV2Enabled) {
      const saveResult = await dataService.saveAbaSession({
        id: nextSession.id,
        patient_id: patient?.id,
        patientId: patient?.id,
        patient_name: patient?.name || 'Paciente',
        appointment_id: nextSession.appointment_id,
        appointmentId: nextSession.appointmentId,
        scheduled_start: nextSession.scheduledStart,
        scheduled_start_at: nextSession.scheduledStart,
        scheduledStartAt: nextSession.scheduledStart,
        scheduled_end: nextSession.scheduledEnd,
        scheduled_end_at: nextSession.scheduledEnd,
        scheduledEndAt: nextSession.scheduledEnd,
        scheduled_duration_minutes: nextSession.scheduled_duration_minutes,
        actual_start: nextSession.startedAt,
        room_id: nextSession.room_id,
        room_name: nextSession.room_name,
        location_type: nextSession.location_type,
        clinic_id: resolvedClinicContext?.clinicId || clinicContext?.clinicId || patient?.clinicId || patient?.clinic_id || undefined,
        clinicId: resolvedClinicContext?.clinicId || clinicContext?.clinicId || patient?.clinicId || patient?.clinic_id || undefined,
        professional_id: nextSession.professional_id || undefined,
        professionalId: nextSession.professionalId || undefined,
        therapist_id: nextSession.therapist_id || undefined,
        therapistId: nextSession.therapistId || undefined,
        therapistName: resolvedClinicContext?.professionalName || resolvedClinicContext?.userName || clinicContext?.professionalName || clinicContext?.userName || patient?.therapistName || patient?.therapist_name || undefined,
        service_type: nextSession.service_type || undefined,
        serviceType: nextSession.serviceType || undefined,
        appointment_snapshot: scheduledSessionForPatient
          ? {
              ...scheduledSessionForPatient,
              id: nextSession.appointment_id,
              patientId: patient?.id,
              patient_id: patient?.id,
              patientName: patient?.name || scheduledSessionForPatient?.patientName || scheduledSessionForPatient?.name || 'Paciente',
              patient_name: patient?.name || scheduledSessionForPatient?.patient_name || scheduledSessionForPatient?.patientName || 'Paciente',
              professionalId: nextSession.professional_id || undefined,
              professional_id: nextSession.professional_id || undefined,
              therapistId: nextSession.therapist_id || undefined,
              therapist_id: nextSession.therapist_id || undefined,
              scheduledAt: scheduledStart,
              scheduled_at: scheduledStart,
              scheduledStartAt: scheduledStart,
              scheduled_start_at: scheduledStart,
              scheduledEndAt: scheduledEnd,
              scheduled_end_at: scheduledEnd,
              scheduledDurationMinutes: nextSession.scheduled_duration_minutes,
              scheduled_duration_minutes: nextSession.scheduled_duration_minutes,
              durationMinutes: nextSession.scheduled_duration_minutes,
              duration_minutes: nextSession.scheduled_duration_minutes,
              roomId: nextSession.room_id,
              room_id: nextSession.room_id,
              roomName: nextSession.room_name,
              room_name: nextSession.room_name,
              locationType: nextSession.location_type,
              location_type: nextSession.location_type,
              serviceType: nextSession.service_type,
              service_type: nextSession.service_type
            }
          : undefined,
        appointmentSnapshot: scheduledSessionForPatient
          ? {
              id: nextSession.appointment_id,
              patientId: patient?.id,
              patient_id: patient?.id,
              patientName: patient?.name || 'Paciente',
              patient_name: patient?.name || 'Paciente',
              professionalId: nextSession.professional_id || undefined,
              professional_id: nextSession.professional_id || undefined,
              therapistId: nextSession.therapist_id || undefined,
              therapist_id: nextSession.therapist_id || undefined,
              scheduledAt: scheduledStart,
              scheduled_at: scheduledStart,
              scheduledStartAt: scheduledStart,
              scheduled_start_at: scheduledStart,
              scheduledEndAt: scheduledEnd,
              scheduled_end_at: scheduledEnd,
              scheduledDurationMinutes: nextSession.scheduled_duration_minutes,
              scheduled_duration_minutes: nextSession.scheduled_duration_minutes,
              durationMinutes: nextSession.scheduled_duration_minutes,
              duration_minutes: nextSession.scheduled_duration_minutes,
              roomId: nextSession.room_id,
              room_id: nextSession.room_id,
              roomName: nextSession.room_name,
              room_name: nextSession.room_name,
              locationType: nextSession.location_type,
              location_type: nextSession.location_type,
              serviceType: nextSession.service_type,
              service_type: nextSession.service_type
            }
          : undefined,
        status: 'active',
        started_at: nextSession.startedAt,
        duration_minutes: durationMinutes,
        reference_date: nextSession.referenceDate,
        record_count: 0,
        source: nextSession.appointment_id ? 'appointment' : 'verto_web',
        clientSource: nextSession.appointment_id ? 'appointment' : 'verto_web'
      });
      if (saveResult?.success === false && !saveResult?.offline && nextSession.appointment_id) {
        clearActiveSession();
        if (saveResult?.code === 'APPOINTMENT_NO_SHOW_REOPEN_REQUIRED') {
          noShowReopenIdempotencyKeyRef.current =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `reopen-no-show-${nextSession.appointment_id}-${Date.now()}`;
          setNoShowReopenReason('');
          setNoShowReopenError('');
          setNoShowReopenPrompt({
            appointmentId: String(nextSession.appointment_id),
            durationMinutes,
            openSessionMode: Boolean(options?.openSessionMode || pendingSessionAction === 'fullscreen')
          });
          setShowSessionStartConfirm(false);
          return;
        }
        const errorText = String(saveResult?.error || '');
        const humanError =
          saveResult?.code === 'INVALID_APPOINTMENT_ID' || saveResult?.code === 'APPOINTMENT_NOT_PERSISTED'
            ? 'Esta sessão ainda não foi salva no servidor. Atualize a agenda e tente novamente.'
            : saveResult?.status === 404 || /sessão n[aã]o encontrada/i.test(errorText)
              ? 'Sessão não encontrada. Atualize a agenda e tente novamente.'
              : errorText || 'Não foi possível vincular a Sessão ABA a este agendamento clínico.';
        alert(humanError);
        return;
      }
      const savedSession = saveResult?.session || saveResult?.data;
      if (saveResult?.success && savedSession?.id) {
        const serverReferenceDate = savedSession.reference_date || savedSession.referenceDate || nextSession.referenceDate;
        persistActiveSession({
          ...nextSession,
          id: String(savedSession.id),
          status: savedSession.status || nextSession.status,
          startedAt: savedSession.actual_start_at || savedSession.started_at || nextSession.startedAt,
          referenceDate: serverReferenceDate,
          reference_date: serverReferenceDate,
          appointmentId: savedSession.appointment_id || nextSession.appointmentId,
          appointment_id: savedSession.appointment_id || nextSession.appointment_id,
          scheduledStart: savedSession.scheduled_start_at || nextSession.scheduledStart,
          scheduled_start: savedSession.scheduled_start_at || nextSession.scheduled_start,
          scheduledEnd: savedSession.scheduled_end_at || nextSession.scheduledEnd,
          scheduled_end: savedSession.scheduled_end_at || nextSession.scheduled_end,
          locationContextSnapshot: savedSession.location_context_snapshot || nextSession.locationContextSnapshot,
          location_context_snapshot: savedSession.location_context_snapshot || nextSession.location_context_snapshot
        });
      }
    }
    setShowSessionStartConfirm(false);
    setRestoreSessionData(false);
    setClearMaintenanceOnSessionRestore(false);
    onAddActivityLog?.(
      'Sessão iniciada',
      `Sessão de ${patient?.name || 'paciente'} iniciada com duração prevista de ${durationMinutes} minutos.`,
      'clinical'
    );
    if (options?.openSessionMode || pendingSessionAction === 'fullscreen') setIsSessionModeOpen(true);
  };

  const handleReopenNoShowAndStart = async () => {
    if (!noShowReopenPrompt || isReopeningNoShow) return;
    const reason = noShowReopenReason.trim();
    if (!canReopenAutomaticNoShow) {
      setNoShowReopenError('Somente coordenação ou administração pode reabrir uma falta.');
      return;
    }
    if (reason.length < 5) {
      setNoShowReopenError('Informe uma justificativa com pelo menos 5 caracteres.');
      return;
    }

    setIsReopeningNoShow(true);
    setNoShowReopenError('');
    try {
      if (!noShowReopenIdempotencyKeyRef.current) {
        noShowReopenIdempotencyKeyRef.current =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `reopen-no-show-${noShowReopenPrompt.appointmentId}-${Date.now()}`;
      }
      const result = await dataService.reopenAppointmentNoShow(noShowReopenPrompt.appointmentId, {
        reason,
        patientId: patient?.id,
        idempotencyKey: noShowReopenIdempotencyKeyRef.current
      });
      if (!result?.success) {
        throw new Error(result?.error || result?.message || 'Não foi possível reabrir a falta agora.');
      }

      const retry = noShowReopenPrompt;
      setNoShowReopenPrompt(null);
      setNoShowReopenReason('');
      noShowReopenIdempotencyKeyRef.current = '';
      await handleConfirmSessionStart({
        durationMinutes: retry.durationMinutes,
        openSessionMode: retry.openSessionMode,
        skipSessionPreparation: true
      });
    } catch (error: any) {
      setNoShowReopenError(error?.message || 'Não foi possível reabrir a falta agora.');
    } finally {
      setIsReopeningNoShow(false);
    }
  };

  const applySessionMasterySummaryToPei = async (sessionSummary: any) => {
    const masterySummary = Array.isArray(sessionSummary?.masterySummary)
      ? sessionSummary.masterySummary
      : Array.isArray(sessionSummary?.mastery_summary)
        ? sessionSummary.mastery_summary
        : [];
    if (masterySummary.length > 0) {
      const evaluatedAt = new Date().toISOString();
      setAbaMasteryPreviewEvaluations(masterySummary.map((row: any) => ({
        ...row,
        patient_id: patient?.id || row?.patient_id || row?.patientId || null,
        patientId: patient?.id || row?.patientId || row?.patient_id || null,
        target_id: row?.target_id || row?.targetId || null,
        targetId: row?.targetId || row?.target_id || null,
        target_name: row?.target_name || row?.targetName || row?.name || null,
        targetName: row?.targetName || row?.target_name || row?.name || null,
        status: row?.status || row?.statusCode || null,
        statusCode: row?.statusCode || row?.status || null,
        criterion_progress_count: row?.criterion_progress_count ?? row?.criterionProgressCount ?? row?.consecutive_successes ?? row?.consecutiveSuccesses ?? 0,
        criterionProgressCount: row?.criterionProgressCount ?? row?.criterion_progress_count ?? row?.consecutiveSuccesses ?? row?.consecutive_successes ?? 0,
        consecutive_successes: row?.consecutive_successes ?? row?.consecutiveSuccesses ?? row?.criterion_progress_count ?? row?.criterionProgressCount ?? 0,
        criterion_required_count: row?.criterion_required_count ?? row?.criterionRequiredCount ?? row?.min_consecutive_successes ?? row?.minConsecutiveSuccesses ?? 1,
        criterionRequiredCount: row?.criterionRequiredCount ?? row?.criterion_required_count ?? row?.minConsecutiveSuccesses ?? row?.min_consecutive_successes ?? 1,
        min_consecutive_successes: row?.min_consecutive_successes ?? row?.minConsecutiveSuccesses ?? row?.criterion_required_count ?? row?.criterionRequiredCount ?? 1,
        evaluated_at: row?.evaluated_at || row?.evaluatedAt || evaluatedAt,
        evaluatedAt: row?.evaluatedAt || row?.evaluated_at || evaluatedAt,
        live_preview: true,
        livePreview: true
      })));
      setAbaRecordsRefreshKey((value) => value + 1);
    }
    const currentPei = Array.isArray(sessionModePatient?.pei) ? sessionModePatient.pei : patient?.pei;
    if (!patient?.id || !Array.isArray(currentPei) || masterySummary.length === 0) return;

    const normalizeKey = (value: any) => String(value ?? '').trim().toLowerCase();
    const normalizeNameKey = (value: any) =>
      String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    const readIdentityPayload = (...values: any[]) => {
      const merged: Record<string, any> = {};
      values.forEach((value: any) => {
        if (!value) return;
        if (typeof value === 'object' && !Array.isArray(value)) {
          Object.assign(merged, value);
          return;
        }
        if (typeof value === 'string') {
          try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(merged, parsed);
          } catch {
            // Payload textual antigo nao participa do casamento por ID.
          }
        }
      });
      return merged;
    };
    const uniqueIdentityKeys = (values: any[]) =>
      values
        .map((value: any) => normalizeKey(value))
        .filter((value: string, index: number, list: string[]) => Boolean(value) && list.indexOf(value) === index);
    const collectMasteryIdentityKeys = (value: any, options: { includeNames?: boolean } = {}) => {
      const raw = readIdentityPayload(value?.raw_payload, value?.rawPayload, value?.criteria, value?.mastery_criteria, value?.masteryCriteria, value?.source);
      const ids = uniqueIdentityKeys([
        value?.targetId,
        value?.target_id,
        value?.abaTargetId,
        value?.aba_target_id,
        value?.id,
        value?.goalId,
        value?.goal_id,
        value?.peiGoalId,
        value?.pei_goal_id,
        value?.skillId,
        value?.skill_id,
        value?.localTargetRef,
        value?.local_target_ref,
        value?.source?.id,
        value?.source?.targetId,
        value?.source?.target_id,
        value?.source?.goalId,
        value?.source?.goal_id,
        value?.source?.peiGoalId,
        value?.source?.pei_goal_id,
        value?.source?.skillId,
        value?.source?.skill_id,
        value?.source?.localTargetRef,
        value?.source?.local_target_ref,
        raw?.targetId,
        raw?.target_id,
        raw?.abaTargetId,
        raw?.aba_target_id,
        raw?.id,
        raw?.goalId,
        raw?.goal_id,
        raw?.peiGoalId,
        raw?.pei_goal_id,
        raw?.skillId,
        raw?.skill_id,
        raw?.localTargetRef,
        raw?.local_target_ref
      ]).map((key: string) => `id:${key}`);
      if (options.includeNames === false) return ids;
      const names = [
        value?.name,
        value?.targetName,
        value?.target_name,
        value?.title,
        raw?.name,
        raw?.targetName,
        raw?.target_name,
        raw?.title
      ]
        .map((entry: any) => normalizeNameKey(entry))
        .filter((entry: string, index: number, list: string[]) => Boolean(entry) && list.indexOf(entry) === index)
        .map((key: string) => `name:${key}`);
      return [...ids, ...names];
    };
    const rowByKey = new Map<string, any>();
    masterySummary.forEach((row: any) => {
      collectMasteryIdentityKeys(row).forEach((key: string) => {
        if (key && !rowByKey.has(key)) rowByKey.set(key, row);
      });
    });

    let changed = false;
    const updatedPei = currentPei.map((goal: any) => {
      const rowFromId = collectMasteryIdentityKeys(goal, { includeNames: false })
        .map((key: string) => rowByKey.get(key))
        .find(Boolean);
      const row = rowFromId || collectMasteryIdentityKeys(goal)
        .map((key: string) => rowByKey.get(key))
        .find(Boolean);
      if (!row) return goal;

      const progressCount = Number(row?.criterionProgressCount ?? row?.criterion_progress_count ?? row?.consecutive_successes ?? row?.consecutiveSuccesses ?? 0);
      const requiredCount = Number(row?.criterionRequiredCount ?? row?.criterion_required_count ?? row?.min_consecutive_successes ?? row?.minConsecutiveSuccesses ?? 0);
      const statusCode = String(row?.statusCode || row?.status_code || row?.status || row?.evaluation_status || row?.evaluationStatus || '').toUpperCase();
      const criterionReached = Boolean(
        row?.contributes ||
          ['MET_TODAY', 'READY_FOR_REVIEW', 'MASTERED', 'MASTERED_APPROVED', 'ADQUIRIDO', 'ACQUIRED'].includes(statusCode) ||
          (Number.isFinite(progressCount) && Number.isFinite(requiredCount) && requiredCount > 0 && progressCount >= requiredCount)
      );
      const currentProgress = Number(goal?.progressPercent ?? goal?.progress_percent ?? goal?.progress ?? goal?.masteryProgressPercent ?? goal?.mastery_progress_percent ?? 0);
      const computedProgress = criterionReached
        ? 100
        : Number.isFinite(progressCount) && Number.isFinite(requiredCount) && requiredCount > 0
          ? Math.min(100, Math.max(0, Math.round((progressCount / requiredCount) * 100)))
          : Number.isFinite(currentProgress)
            ? currentProgress
            : 0;
      if (!criterionReached && computedProgress <= currentProgress) return goal;

      changed = true;
      return {
        ...goal,
        status: criterionReached ? 'completed' : goal?.status,
        clinicalStatus: criterionReached ? 'completed' : goal?.clinicalStatus,
        clinical_status: criterionReached ? 'completed' : goal?.clinical_status,
        masteryStatus: criterionReached ? 'READY_FOR_MAINTENANCE' : goal?.masteryStatus,
        mastery_status: criterionReached ? 'READY_FOR_MAINTENANCE' : goal?.mastery_status,
        progress: computedProgress,
        progressPercent: computedProgress,
        progress_percent: computedProgress,
        masteryProgressPercent: computedProgress,
        mastery_progress_percent: computedProgress,
        criterionProgressCount: Number.isFinite(progressCount) ? progressCount : goal?.criterionProgressCount,
        criterion_progress_count: Number.isFinite(progressCount) ? progressCount : goal?.criterion_progress_count,
        consecutive_successes: Number.isFinite(progressCount) ? progressCount : goal?.consecutive_successes,
        consecutiveSuccesses: Number.isFinite(progressCount) ? progressCount : goal?.consecutiveSuccesses,
        criterionRequiredCount: Number.isFinite(requiredCount) ? requiredCount : goal?.criterionRequiredCount,
        criterion_required_count: Number.isFinite(requiredCount) ? requiredCount : goal?.criterion_required_count,
        min_consecutive_successes: Number.isFinite(requiredCount) ? requiredCount : goal?.min_consecutive_successes,
        sessionMasteryUpdatedAt: new Date().toISOString()
      };
    });

    if (!changed) return;
    const updatedPatient = { ...patient, pei: updatedPei };
    setSessionPatientOverride(updatedPatient);
    setHasLoadedPeiMaintenancePanel(false);
    setPeiMaintenancePanelMessage('');
    if (typeof onUpdatePatient === 'function') {
      const updateResult = await onUpdatePatient(updatedPatient);
      if (updateResult?.success === false) {
        console.warn('[PEI] Não foi possível persistir progresso de maestria pós-sessão:', updateResult?.error || updateResult?.message);
      }
    }
  };

  useEffect(() => {
    const startKey = String(startScheduledSessionKey || '').trim();
    if (!startKey || consumedScheduledSessionStartKeyRef.current === startKey) return;
    if (!abaV2Enabled || !scheduledSessionForPatient || !patient?.id) return;

    consumedScheduledSessionStartKeyRef.current = startKey;
    setSessionDurationInput(String(scheduledSessionDurationMinutes));
    setPendingSessionAction('fullscreen');

    const persistedSession = readPersistedSession();
    if (activeSession || persistedSession) {
      const sessionToOpen = activeSession || persistedSession;
      const scheduledAppointmentId =
        scheduledSessionForPatient?.appointment_id ||
        scheduledSessionForPatient?.appointmentId ||
        scheduledSessionForPatient?.id ||
        null;
      const sessionAppointmentId = sessionToOpen?.appointment_id || sessionToOpen?.appointmentId || null;
      if (scheduledAppointmentId && !sessionAppointmentId) {
        const linkedSession = {
          ...sessionToOpen,
          appointmentId: scheduledAppointmentId,
          appointment_id: scheduledAppointmentId,
          scheduledStart: sessionToOpen?.scheduledStart || scheduledSessionForPatient?.scheduled_start_at || scheduledSessionForPatient?.scheduledStartAt || null,
          scheduled_start: sessionToOpen?.scheduled_start || scheduledSessionForPatient?.scheduled_start_at || scheduledSessionForPatient?.scheduledStartAt || null,
          scheduledEnd: sessionToOpen?.scheduledEnd || scheduledSessionForPatient?.scheduled_end_at || scheduledSessionForPatient?.scheduledEndAt || null,
          scheduled_end: sessionToOpen?.scheduled_end || scheduledSessionForPatient?.scheduled_end_at || scheduledSessionForPatient?.scheduledEndAt || null,
          roomId: sessionToOpen?.roomId || scheduledSessionForPatient?.roomId || scheduledSessionForPatient?.room_id || null,
          room_id: sessionToOpen?.room_id || scheduledSessionForPatient?.room_id || scheduledSessionForPatient?.roomId || null,
          roomName: sessionToOpen?.roomName || scheduledSessionForPatient?.roomName || scheduledSessionForPatient?.room_name || null,
          room_name: sessionToOpen?.room_name || scheduledSessionForPatient?.room_name || scheduledSessionForPatient?.roomName || null
        };
        persistActiveSession(linkedSession);
        void dataService.saveAbaSession({
          id: linkedSession.id,
          patient_id: patient.id,
          patientId: patient.id,
          patient_name: patient?.name || linkedSession.patientName || 'Paciente',
          appointment_id: scheduledAppointmentId,
          appointmentId: scheduledAppointmentId,
          scheduled_start: linkedSession.scheduled_start || linkedSession.scheduledStart || undefined,
          scheduled_start_at: linkedSession.scheduled_start || linkedSession.scheduledStart || undefined,
          scheduled_end: linkedSession.scheduled_end || linkedSession.scheduledEnd || undefined,
          scheduled_end_at: linkedSession.scheduled_end || linkedSession.scheduledEnd || undefined,
          actual_start: linkedSession.startedAt || linkedSession.actual_start_at || undefined,
          room_id: linkedSession.room_id || undefined,
          room_name: linkedSession.room_name || undefined,
          location_type: linkedSession.location_type || linkedSession.locationType || undefined,
          clinic_id: linkedSession.clinicId || linkedSession.clinic_id || resolvedClinicContext?.clinicId || clinicContext?.clinicId || patient?.clinicId || patient?.clinic_id || undefined,
          professional_id: linkedSession.professional_id || linkedSession.professionalId || undefined,
          professionalId: linkedSession.professionalId || linkedSession.professional_id || undefined,
          therapist_id: linkedSession.therapist_id || linkedSession.therapistId || undefined,
          therapistId: linkedSession.therapistId || linkedSession.therapist_id || undefined,
          service_type: linkedSession.service_type || linkedSession.serviceType || scheduledSessionForPatient?.service_type || scheduledSessionForPatient?.serviceType || undefined,
          serviceType: linkedSession.serviceType || linkedSession.service_type || scheduledSessionForPatient?.serviceType || scheduledSessionForPatient?.service_type || undefined,
          status: linkedSession.status || 'active',
          started_at: linkedSession.startedAt || linkedSession.actual_start_at || new Date().toISOString(),
          duration_minutes: linkedSession.durationMinutes || scheduledSessionDurationMinutes,
          reference_date: linkedSession.referenceDate || new Date().toISOString().slice(0, 10),
          source: 'appointment',
          clientSource: 'appointment'
        }).then((saveResult: any) => {
          const savedSession = saveResult?.session || saveResult?.data;
          if (saveResult?.success && savedSession?.id) {
            const serverReferenceDate = savedSession.reference_date || savedSession.referenceDate || linkedSession.referenceDate;
            persistActiveSession({
              ...linkedSession,
              id: String(savedSession.id),
              status: savedSession.status || linkedSession.status,
              referenceDate: serverReferenceDate,
              reference_date: serverReferenceDate,
              appointmentId: savedSession.appointment_id || scheduledAppointmentId,
              appointment_id: savedSession.appointment_id || scheduledAppointmentId,
              locationContextSnapshot: savedSession.location_context_snapshot || linkedSession.locationContextSnapshot,
              location_context_snapshot: savedSession.location_context_snapshot || linkedSession.location_context_snapshot
            });
          }
        }).catch((error: any) => {
          console.warn('[ABA] Não foi possível vincular a Sessão ABA ativa ao agendamento clínico:', error?.message || String(error));
        });
      } else if (persistedSession && !activeSession) {
        persistActiveSession(persistedSession);
      }
      setIsSessionModeOpen(true);
      return;
    }

    void handleConfirmSessionStart({ durationMinutes: scheduledSessionDurationMinutes, openSessionMode: true });
  }, [
    abaV2Enabled,
    activeSession,
    patient?.id,
    scheduledSessionDurationMinutes,
    scheduledSessionForPatient,
    startScheduledSessionKey,
  ]);

  const handleConfirmSessionEnd = (options?: { alreadyPersisted?: boolean; summary?: any }) => {
    if (!options?.alreadyPersisted) return;
    clearActiveSession();
    setIsSessionModeOpen(false);
    void applySessionMasterySummaryToPei(options.summary);
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

  const [selectedChartProtocolId, setSelectedChartProtocolId] = useState(() => String(initialChartFilters.selectedChartProtocolId || ''));
  const [latestProtocolReference, setLatestProtocolReference] = useState<any>(null);
  const [hasUserChangedChartProtocol, setHasUserChangedChartProtocol] = useState(() => Boolean(initialChartFilters.selectedChartProtocolId));
  const [selectedSnapshotDate, setSelectedSnapshotDate] = useState(() => String(initialChartFilters.selectedSnapshotDate || "all"));
  const [chartFiltersHydratedKey, setChartFiltersHydratedKey] = useState(chartFiltersStorageKey);
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

  useEffect(() => {
    const persisted = readPersistedChartFilters();
    const safeReportPeriod = ['monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual'].includes(String(persisted.reportPeriod || ''))
      ? String(persisted.reportPeriod)
      : 'monthly';
    setReportPeriod(safeReportPeriod);
    setComparisonDate1(String(persisted.comparisonDate1 || ''));
    setComparisonDate2(String(persisted.comparisonDate2 || ''));
    setAdultReportDate1(String(persisted.adultReportDate1 || ''));
    setAdultReportDate2(String(persisted.adultReportDate2 || ''));
    setSelectedChartProtocolId(String(persisted.selectedChartProtocolId || ''));
    setSelectedSnapshotDate(String(persisted.selectedSnapshotDate || 'all'));
    setHasUserChangedChartProtocol(Boolean(persisted.selectedChartProtocolId));
    setChartFiltersHydratedKey(chartFiltersStorageKey);
  }, [chartFiltersStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined' || chartFiltersHydratedKey !== chartFiltersStorageKey) return;
    window.localStorage.setItem(
      chartFiltersStorageKey,
      JSON.stringify({
        selectedChartProtocolId,
        selectedSnapshotDate,
        comparisonDate1,
        comparisonDate2,
        adultReportDate1,
        adultReportDate2,
        reportPeriod
      })
    );
  }, [
    adultReportDate1,
    adultReportDate2,
    chartFiltersHydratedKey,
    chartFiltersStorageKey,
    comparisonDate1,
    comparisonDate2,
    reportPeriod,
    selectedChartProtocolId,
    selectedSnapshotDate
  ]);

  useEffect(() => {
    let cancelled = false;

    const loadLatestProtocolReference = async () => {
      const patientId = String(patient?.id || '').trim();
      if (!patientId) {
        if (!cancelled) setLatestProtocolReference(null);
        return;
      }

      const result = await dataService.discoverLatestPatientProtocol(patientId);
      if (!cancelled) {
        setLatestProtocolReference(result?.success ? result.data || null : null);
      }
    };

    void loadLatestProtocolReference();
    return () => {
      cancelled = true;
    };
  }, [patient?.id]);

  useEffect(() => {
    const protocolList = Array.isArray(protocols) ? protocols : [];
    if (!protocolList.length) {
      setSelectedChartProtocolId('');
      return;
    }

    const normalizeProtocolName = (value: any) =>
      String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    const resolveMatchingProtocolId = (rawId: any, rawName: any) => {
      const targetId = String(rawId || '').trim();
      const targetName = normalizeProtocolName(rawName);
      const match = protocolList.find((protocol: any) => {
        const protocolId = String(protocol?.id || '').trim();
        const protocolName = normalizeProtocolName(protocol?.title || protocol?.name || '');
        return (targetId && protocolId === targetId) || (targetName && protocolName === targetName);
      });
      return String(match?.id || '').trim();
    };

    const assignedGoal = (Array.isArray(patient?.pei) ? patient.pei : []).find((goal: any) => {
      const status = String(goal?.status || '').toLowerCase();
      return goal?.protocolTitle && status !== 'completed';
    }) || (Array.isArray(patient?.pei) ? patient.pei : []).find((goal: any) => goal?.protocolTitle);

    const discoveredMatchId = resolveMatchingProtocolId(
      latestProtocolReference?.protocolId || latestProtocolReference?.levelId || '',
      latestProtocolReference?.protocolName || ''
    );
    const assignedMatchId = resolveMatchingProtocolId(
      assignedGoal?.protocolId ?? assignedGoal?.protocol_id ?? '',
      assignedGoal?.protocolTitle || ''
    );
    const defaultVbMappId = String(
      protocolList.find((p: any) => /vb[\s-]?mapp/i.test(String(p?.title || p?.name || '')))?.id || ''
    ).trim();
    const fallbackProtocolId =
      discoveredMatchId ||
      assignedMatchId ||
      defaultVbMappId ||
      String(protocolList[0]?.id || '').trim();

    setSelectedChartProtocolId((prev) => {
      const previousIsValid = prev && protocolList.some((protocol: any) => String(protocol?.id) === String(prev));
      if (hasUserChangedChartProtocol && previousIsValid) return prev;
      return fallbackProtocolId;
    });
  }, [hasUserChangedChartProtocol, latestProtocolReference, patient?.pei, protocols]);

  const mapAgeGroupToRange = (ageGroup?: string): { min: number; max: number | null } => {
    const group = String(ageGroup || '').toLowerCase();
    if (group === 'child') return { min: 0, max: 12 };
    if (group === 'teen') return { min: 13, max: 18 };
    if (group === 'adult') return { min: 19, max: 59 };
    if (group === 'senior') return { min: 60, max: null };
    return { min: 0, max: null };
  };

  useEffect(() => {
    const patientId = String(patient?.id || '');
    if (!patientId || patientAgeYears === null || patientAgeYears <= 12) {
      assignedTasksLoadedForRef.current = '';
      setAssignedTasks([]);
      setIsLoadingAssignedTasks(false);
      setAssignedTasksLoadError(null);
      return;
    }
    if (assignedTasksLoadedForRef.current === patientId) return;

    if (assignedTasksRequestRef.current?.patientId !== patientId) {
      setAssignedTasks([]);
      setIsLoadingAssignedTasks(true);
      setAssignedTasksLoadError(null);
      const promise = dataService.getAssignedTasks(patientId);
      assignedTasksRequestRef.current = { patientId, promise };
    }

    let cancelled = false;
    const request = assignedTasksRequestRef.current;
    void request?.promise
      .then((result: any) => {
        if (cancelled || String(patient?.id || '') !== patientId) return;
        if (result?.success && Array.isArray(result?.data)) {
          setAssignedTasks(result.data);
          assignedTasksLoadedForRef.current = patientId;
          return;
        }
        setAssignedTasksLoadError('Não foi possível carregar as tarefas concluídas.');
      })
      .catch((error: any) => {
        if (cancelled || String(patient?.id || '') !== patientId) return;
        console.error('Erro ao carregar tarefas atribuídas:', error);
        setAssignedTasks([]);
        setAssignedTasksLoadError('Não foi possível carregar as tarefas concluídas.');
      })
      .finally(() => {
        if (!cancelled && String(patient?.id || '') === patientId) {
          setIsLoadingAssignedTasks(false);
        }
        if (assignedTasksRequestRef.current === request) {
          assignedTasksRequestRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [assignedTasksReloadKey, patient?.id, patientAgeYears]);

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

  const sanitizeDocumentImageUrl = (value: any) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw) || /^blob:/i.test(raw)) return raw;
    if (/^data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/=\s]+$/i.test(raw)) return raw;
    return "";
  };

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
          String(media?.clinicLogoUrl || baseContext?.logoUrl || baseContext?.clinicLogoUrl || "").trim() ||
          baseContext?.logoUrl ||
          baseContext?.clinicLogoUrl ||
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

    const normalizeBooleanText = (value: any) => {
      if (typeof value === "boolean") return value ? "Sim" : "Não";
      const normalized = String(value ?? "").trim().toLowerCase();
      if (normalized === "true") return "Sim";
      if (normalized === "false") return "Não";
      return null;
    };

    const normalizeValue = (key: string, value: any) => {
      if (value === null || value === undefined) return "";
      const booleanText = normalizeBooleanText(value);
      if (booleanText) return booleanText;
      if (key === "formType") {
        if (value === "adult") return "Adulto";
        if (value === "child") return "Criança";
        return String(value);
      }
      if (Array.isArray(value)) return safeDisplayValue(value, "");
      if (typeof value === "object") return "";
      return safeDisplayValue(value, "");
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
    const rawEntries = filterHumanDisplayEntries(anamnesis || {}).filter(
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

    const buildRowData = (entries: Array<[string, any]>) =>
      entries
        .map(([key, value]) => {
          const normalized = normalizeValue(key, value);
          if (!normalized.trim()) return null;
          return {
            key,
            label: dynamicLabelMap[key] || fieldLabelMap[key] || fallbackLabel(key),
            value: normalized,
          };
        })
        .filter(Boolean) as Array<{ key: string; label: string; value: string }>;

    const buildRows = (rows: Array<{ key: string; label: string; value: string }>) =>
      rows
        .map(
          (row) => `
            <tr>
              <td class="th">${escapeHtml(row.label)}</td>
              <td class="td">${escapeHtml(row.value)}</td>
            </tr>`,
        )
        .join("");

    const chunkRows = (rows: Array<{ key: string; label: string; value: string }>, firstChunkSize: number, nextChunkSize: number) => {
      if (!rows.length) return [[]];
      const chunks: Array<Array<{ key: string; label: string; value: string }>> = [];
      let index = 0;
      let chunkSize = firstChunkSize;
      while (index < rows.length) {
        chunks.push(rows.slice(index, index + chunkSize));
        index += chunkSize;
        chunkSize = nextChunkSize;
      }
      return chunks;
    };

    const patientRowData = buildRowData(orderedEntries.filter(([key]) => patientIdentityKeys.has(key)));
    const professionalRowData = buildRowData(orderedEntries.filter(([key]) => professionalKeys.has(key)));
    const clinicalRowData = buildRowData(
      orderedEntries.filter(([key]) => !patientIdentityKeys.has(key) && !professionalKeys.has(key)),
    );

    const fichaDate = fichaDateIso
      ? new Date(`${fichaDateIso}T00:00:00`).toLocaleDateString("pt-BR")
      : new Date().toLocaleDateString("pt-BR");

    const professionalName =
      String(anamnesis?.profissional || c.professionalName || c.userName || '').trim() ||
      'Profissional responsável';
    const professionalCrp =
      formatProfessionalRegistry(anamnesis?.crp || c.crp || c.professionalCrp || c.registry || "") || "-";
    const clinicName = String(c.clinicName || c.name || c.professionalClinicName || "").trim() || "Clínica Verto";
    const clinicCnpj = formatCnpj(c.cnpj || c.clinicCnpj || c.document || "") || "-";
    const clinicAddress =
      String(c.address || c.clinicAddress || '').trim() ||
      [c.street, c.number, c.complement, c.neighborhood, c.city].filter(Boolean).join(', ') ||
      '-';
    const clinicLogoUrl = sanitizeDocumentImageUrl(c.logoUrl || c.clinicLogoUrl);
    const signatureUrl = sanitizeDocumentImageUrl(c.signatureUrl || c.signatureDataUrl || c.professionalSignatureUrl);
    const fichaType = normalizeValue('formType', anamnesis?.formType || patient?.anamnesisData?.formType || '');
    const headerSummaryHtml = `
      <p class="meta"><strong>Clínica:</strong> ${escapeHtml(clinicName)}</p>
      <p class="meta"><strong>CNPJ:</strong> ${escapeHtml(clinicCnpj)}</p>
      <p class="meta"><strong>Endereço:</strong> ${escapeHtml(clinicAddress)}</p>
      <p class="meta"><strong>Profissional responsável:</strong> ${escapeHtml(professionalName)} | <strong>Registro:</strong> ${escapeHtml(professionalCrp)}</p>
    `;
    const patientSummaryHtml = `
      <p class="patient"><strong>Paciente:</strong> ${escapeHtml(patient?.name || "-")} | <strong>Data da ficha:</strong> ${escapeHtml(fichaDate)} | <strong>Tipo:</strong> ${escapeHtml(fichaType || '-')}</p>
    `;
    const footerHtml = `
      <div class="footer">
        <div>
          <p class="note">Documento gerado automaticamente pela plataforma Verto.</p>
        </div>
        <div class="signature">
          ${signatureUrl ? `<img src="${escapeHtml(signatureUrl)}" alt="Assinatura profissional" />` : `<div class="signature-placeholder"></div>`}
          <p class="signature-line">${escapeHtml(professionalName)}</p>
          <p class="signature-subtitle">Registro profissional: ${escapeHtml(professionalCrp)}</p>
        </div>
      </div>
    `;

    const pages: Array<string> = [];
    const patientChunks = chunkRows(patientRowData, 15, 19);
    const clinicalChunks = chunkRows(clinicalRowData, patientRowData.length > 15 ? 18 : 15, 19);
    const professionalChunks = professionalRowData.length ? chunkRows(professionalRowData, 8, 12) : [];

    patientChunks.forEach((chunk, index) => {
      pages.push(`
        <section class="section-block">
          ${index === 0 ? patientSummaryHtml : `<p class="patient patient-continuation"><strong>Paciente:</strong> ${escapeHtml(patient?.name || "-")} | <strong>Continuação da ficha</strong></p>`}
          <h3 class="section-title">${index === 0 ? "1. Informações cadastrais do paciente" : "1. Informações cadastrais do paciente (continuação)"}</h3>
          <table class="table">${buildRows(chunk) || `<tr><td class="td">Sem dados cadastrais preenchidos.</td></tr>`}</table>
        </section>
      `);
    });

    clinicalChunks.forEach((chunk, index) => {
      pages.push(`
        <section class="section-block">
          ${pages.length === 0 ? patientSummaryHtml : ""}
          <h3 class="section-title">${index === 0 ? "2. Perguntas e respostas clínicas" : "2. Perguntas e respostas clínicas (continuação)"}</h3>
          <table class="table">${buildRows(chunk) || `<tr><td class="td">Sem respostas clínicas preenchidas.</td></tr>`}</table>
        </section>
      `);
    });

    professionalChunks.forEach((chunk, index) => {
      pages.push(`
        <section class="section-block">
          ${pages.length === 0 ? patientSummaryHtml : ""}
          <h3 class="section-title">${index === 0 ? "3. Informações do profissional" : "3. Informações do profissional (continuação)"}</h3>
          <table class="table">${buildRows(chunk)}</table>
        </section>
      `);
    });

    if (!pages.length) {
      pages.push(`
        <section class="section-block">
          ${patientSummaryHtml}
          <h3 class="section-title">1. Informações cadastrais do paciente</h3>
          <table class="table"><tr><td class="td">Sem dados preenchidos na ficha.</td></tr></table>
        </section>
      `);
    }

    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ficha de Anamnese - ${escapeHtml(patient?.name || "Paciente")}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; background: #f5f7ff; color: #0f172a; margin: 0; }
    .anamnesis-pdf-page { width: 794px; min-height: 1123px; margin: 24px auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 12px 32px rgba(15,23,42,.08); page-break-after: always; break-after: page; display: flex; flex-direction: column; }
    .anamnesis-pdf-page:last-child { page-break-after: auto; break-after: auto; }
    .header { padding: 22px 24px; background: linear-gradient(135deg,#eef2ff,#f8f5ff); border-bottom: 1px solid #e2e8f0; display:flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    .title { margin: 0 0 6px 0; font-size: 22px; color: #312e81; }
    .meta { margin: 2px 0; font-size: 13px; color: #475569; }
    .logo-wrap { width: 90px; height: 90px; border-radius: 12px; border: 1px solid #e2e8f0; background: #fff; padding: 8px; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink: 0; }
    .logo { width: 100%; height: 100%; object-fit: contain; }
    .logo-fallback { font-size: 10px; font-weight: 800; color: #94a3b8; letter-spacing: 1px; text-transform: uppercase; text-align: center; }
    .content { padding: 20px 24px; flex: 1; }
    .patient { margin: 0 0 14px 0; font-size: 13px; color: #334155; }
    .patient-continuation { color: #64748b; }
    .section-block { break-inside: avoid; page-break-inside: avoid; }
    .section-title { margin: 10px 0 8px; font-size: 15px; color: #312e81; }
    .table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .table tr { break-inside: avoid; page-break-inside: avoid; }
    .th { padding: 9px 10px; border: 1px solid #e2e8f0; background: #f8fafc; font-weight: 700; color: #334155; width: 35%; vertical-align: top; word-break: break-word; }
    .td { padding: 9px 10px; border: 1px solid #e2e8f0; color: #0f172a; white-space: pre-wrap; word-break: break-word; }
    .footer { padding: 16px 24px; border-top: 1px solid #e2e8f0; display:flex; justify-content: space-between; align-items: flex-end; gap: 14px; }
    .signature { text-align: right; min-width: 240px; }
    .signature img { height: 58px; max-width: 220px; object-fit: contain; display:block; margin-left:auto; }
    .signature-placeholder { height: 58px; width: 220px; margin-left: auto; }
    .signature-line { margin: 6px 0 2px; border-top: 1px solid #cbd5e1; padding-top: 4px; font-size: 11px; color: #334155; font-weight: 600; }
    .signature-subtitle { margin: 0; font-size: 10px; color: #64748b; }
    .note { margin: 0; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  ${pages
    .map(
      (pageHtml, index) => `
        <div class="anamnesis-pdf-page">
          <div class="header">
            <div>
              <h1 class="title">Ficha de Anamnese</h1>
              ${headerSummaryHtml}
            </div>
            <div class="logo-wrap">
              ${
                clinicLogoUrl
                  ? `<img src="${escapeHtml(clinicLogoUrl)}" class="logo" alt="Logo da clínica" />`
                  : `<span class="logo-fallback">Logo da clínica</span>`
              }
            </div>
          </div>
          <div class="content">${pageHtml}</div>
          ${index === pages.length - 1 ? footerHtml : ""}
        </div>`,
    )
    .join("")}
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
    const pages = Array.from(sandbox.querySelectorAll('.anamnesis-pdf-page')) as HTMLElement[];
    const captureTargets = pages.length ? pages : [sandbox];

    try {
      const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      for (let index = 0; index < captureTargets.length; index += 1) {
        const captureNode = await prepareElementForPdfCapture(captureTargets[index]);
        try {
          const canvas = await html2canvas(captureNode, {
            backgroundColor: '#ffffff',
            scale: 1.35,
            useCORS: true,
            allowTaint: true,
            logging: false,
            windowWidth: captureNode.scrollWidth || 794,
            windowHeight: captureNode.scrollHeight || 1123,
          });
          const imgData = canvas.toDataURL('image/jpeg', 0.82);
          if (index > 0) pdf.addPage();
          pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
        } finally {
          if (captureNode.parentNode) {
            captureNode.parentNode.removeChild(captureNode);
          }
        }
      }

      return new Blob([pdf.output('arraybuffer')], { type: 'application/pdf' });
    } finally {
      document.body.removeChild(sandbox);
    }
  };

  const patientCategory = useMemo(() => (isKidsProfile ? 'Criança' : 'Adulto'), [isKidsProfile]);
  const normalizeClinicalTaskKey = (value: any) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const isSameClinicalTask = (a: any, b: any) => {
    const left = normalizeClinicalTaskKey(a);
    const right = normalizeClinicalTaskKey(b);
    if (!left || !right) return false;
    return left === right || left.includes(right) || right.includes(left);
  };

  const resolveHistorySnapshotKey = (item: any) => {
    const raw = String(item?.dateGroup || item?.date_group || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const brDate = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brDate) return `${brDate[3]}-${brDate[2]}-${brDate[1]}`;
    const date = new Date(item?.created_at || item?.date || '');
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  };

  const formatPatientTimelineDateLabel = (value: any) => {
    const raw = String(value || '').trim();
    if (!raw) return 'Sem data';
    if (/^hoje$/i.test(raw)) return 'Hoje';
    if (/^ontem$/i.test(raw)) return 'Ontem';
    const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDate) return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;
    const brDate = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (brDate) return `${brDate[1]}/${brDate[2]}/${brDate[3]}`;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const getPatientTimelineGroupKey = (item: any) => {
    const key = resolveHistorySnapshotKey(item);
    if (key) return key;
    return String(item?.dateGroup || item?.date_group || 'Sem data').trim() || 'Sem data';
  };

  const firstPatientDetailText = (...values: any[]) =>
    values.map((value) => String(value || '').trim()).find(Boolean) || '';

  const resolveFamilyMediaForTimeline = (source: any) => {
    const metadata = source?.metadata && typeof source.metadata === 'object' ? source.metadata : {};
    const attachments = [
      ...(Array.isArray(source?.attachments) ? source.attachments : []),
      ...(Array.isArray(source?.files) ? source.files : []),
      ...(Array.isArray(source?.photos) ? source.photos : []),
      ...(Array.isArray(metadata?.attachments) ? metadata.attachments : []),
      ...(Array.isArray(metadata?.files) ? metadata.files : []),
      ...(Array.isArray(metadata?.photos) ? metadata.photos : [])
    ].filter((entry) => entry && typeof entry === 'object');
    const image = firstPatientDetailText(
      source?.image,
      source?.image_url,
      source?.imageUrl,
      source?.photo,
      source?.photo_url,
      source?.photoUrl,
      source?.url,
      metadata?.image,
      metadata?.image_url,
      metadata?.imageUrl,
      metadata?.photo,
      metadata?.photo_url,
      metadata?.photoUrl,
      metadata?.url,
      ...attachments.flatMap((entry: any) => [
        entry?.image,
        entry?.image_url,
        entry?.imageUrl,
        entry?.photo,
        entry?.photo_url,
        entry?.photoUrl,
        entry?.url
      ])
    );
    const imagePath = firstPatientDetailText(
      source?.image_path,
      source?.imagePath,
      source?.storage_path,
      source?.storagePath,
      source?.photo_path,
      source?.photoPath,
      source?.path,
      metadata?.image_path,
      metadata?.imagePath,
      metadata?.storage_path,
      metadata?.storagePath,
      metadata?.photo_path,
      metadata?.photoPath,
      metadata?.path,
      ...attachments.flatMap((entry: any) => [
        entry?.image_path,
        entry?.imagePath,
        entry?.storage_path,
        entry?.storagePath,
        entry?.photo_path,
        entry?.photoPath,
        entry?.path
      ])
    );
    return { image: image || null, image_path: imagePath || null };
  };

  const availableSnapshots = useMemo(() => {
    const dates = (history || [])
      .filter((h: any) => String(h?.patientId || h?.patient_id || '') === String(patient.id))
      .filter((h: any) => String(h?.type || '').toLowerCase() === 'task')
      .filter((h: any) => h?.score !== undefined && h?.score !== null)
      .map(resolveHistorySnapshotKey)
      .filter(Boolean);
    return Array.from(new Set(dates)).sort((a: any, b: any) => String(b).localeCompare(String(a)));
  }, [history, patient.id]);

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
            label: 'Último registro',
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
          label: 'Primeira avaliação registrada',
          data: baselineData,
          backgroundColor: 'rgba(5, 205, 153, 0.35)',
          borderColor: '#05CD99',
          pointBackgroundColor: '#05CD99',
          borderWidth: 4
        },
        {
          label: 'Último registro',
          data: currentData,
          backgroundColor: 'rgba(122, 50, 252, 0.25)',
          borderColor: '#7a32fc',
          pointBackgroundColor: '#7a32fc',
          borderWidth: 4
        }
      ]
    };
  }, [history, protocols, patient.id, selectedChartProtocolId, selectedSnapshotDate]);

  const safeProtocols = Array.isArray(protocols) ? protocols : []; 
  useEffect(() => {
    let cancelled = false;

    const loadApprovedVertoProtocols = async () => {
      try {
        const response = await fetch('/api/protocol-import-requests', {
          credentials: 'include',
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-store',
            Pragma: 'no-cache'
          }
        });
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

  const filteredProtocols = useMemo(() => { 
    return planProtocolCatalog.filter((p: any) => { 
      const matchAge = filterAge ? (p.ageGroup === filterAge || p.ageGroup === 'all') : true; 
      const matchType = filterType ? p.type === filterType : true; 
      const matchDomain = filterDomain ? (p.domain && p.domain.toLowerCase().includes(filterDomain.toLowerCase())) : true; 
      return matchAge && matchType && matchDomain; 
    }); 
  }, [planProtocolCatalog, filterAge, filterType, filterDomain]); 

  const selectedProtocol = planProtocolCatalog.find((p: any) => String(p.id) === String(selectedProtocolId)); 
  const selectedDomain = selectedProtocol?.data.find((d: any) => String(d.id) === String(selectedDomainId)); 
  const targetProtocol = planProtocolCatalog.find((p: any) => String(p.id) === String(targetProtocolId)); 
  const targetDomain = targetProtocol?.data.find((d: any) => String(d.id) === String(targetDomainId)); 
  const selectedPEIProtocol = planProtocolCatalog.find((p: any) => String(p.id) === String(selectedPEIProtocolId));
  const selectedPEIDomain = selectedPEIProtocol?.data.find((d: any) => String(d.id) === String(selectedPEIDomainId));

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
        const rawText = String(n?.text || '');
        const text = rawText.toLowerCase();
        if (subject === 'milestone_event' || rawText.startsWith('MILESTONE_EVENT|')) return false;
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
        const media = resolveFamilyMediaForTimeline(n);
        const noteType = String(n?.type || n?.kind || '').toLowerCase() === 'photo' ? 'photo' : 'family_note';
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
          patient_id: n?.patient_id ?? n?.patientId ?? patient?.id,
          patient_email: n?.patient_email ?? n?.patientEmail ?? patient?.email ?? null,
          type: noteType,
          title: noteType === 'photo' ? 'Foto enviada' : 'Registro da Família',
          note: normalizedText || rawText,
          image: media.image,
          image_path: media.image_path,
          icon: noteType === 'photo' ? '📷' : '🏠',
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
        image_path: current?.image_path || current?.imagePath || entry?.image_path || null,
        patientId: current?.patientId || current?.patient_id || entry?.patientId || entry?.patient_id || patient?.id,
        patient_id: current?.patient_id || current?.patientId || entry?.patient_id || entry?.patientId || patient?.id,
        patient_email: current?.patient_email || entry?.patient_email || patient?.email || null,
        sourceRef: current?.sourceRef || entry?.sourceRef || String(current?.id || entry?.id || ''),
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
      const media = resolveFamilyMediaForTimeline(item);
      const resolvedPatientId = item?.patientId || item?.patient_id || patient?.id;
      return {
        ...item,
        sourceRef,
        patientId: resolvedPatientId,
        patient_id: item?.patient_id || item?.patientId || resolvedPatientId,
        patient_email: item?.patient_email || patient?.email || null,
        image: item?.image || media.image,
        image_path: item?.image_path || item?.imagePath || media.image_path,
        milestoneAwarded: Boolean(item?.milestoneAwarded) || eventAwarded,
        score: (Boolean(item?.milestoneAwarded) || eventAwarded || hasMarker || Number(item?.score ?? 0) >= 1) ? 1 : Number(item?.score ?? 0)
      };
    });

    return mergedValues.sort((a: any, b: any) => {
      const aTs = new Date(a?.date || a?.created_at || 0).getTime();
      const bTs = new Date(b?.date || b?.created_at || 0).getTime();
      return bTs - aTs;
    });
  }, [history, notes, isKidsProfile, patient?.id, patient?.email]);

  const visibleHistoryWithFamilyNotes = useMemo(() => {
    const rows = Array.isArray(historyWithFamilyNotes) ? historyWithFamilyNotes : [];
    if (historyPeriod === 'all' || !historyRange.ready || !historyRange.from || !historyRange.to) return rows;
    const fromMs = new Date(historyRange.from).getTime();
    const toMs = new Date(historyRange.to).getTime();
    return rows.filter((item: any) => {
      const rawDate = item?.created_at || item?.createdAt || item?.date || '';
      let timestamp = new Date(rawDate).getTime();
      if (Number.isNaN(timestamp)) {
        const group = String(item?.date_group || item?.dateGroup || '').trim();
        const isoMatch = group.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const brMatch = group.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
        const normalized = isoMatch
          ? `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
          : brMatch
            ? `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`
            : '';
        timestamp = normalized ? new Date(`${normalized}T12:00:00`).getTime() : Number.NaN;
      }
      return Number.isFinite(timestamp) && timestamp >= fromMs && timestamp <= toMs;
    });
  }, [historyPeriod, historyRange.from, historyRange.ready, historyRange.to, historyWithFamilyNotes]);

  const normalizeNoteText = (value: string) => decodeClinicalTextEntities(
    String(value || '')
      .replace(/ðŸ“/g, '📝')
      .replace(/ðŸŽ¯/g, '🎯')
      .replace(/ðŸ /g, '🏠')
      .replace(/\?\s*TAREFA CONCLUÍDA PELO PACIENTE/g, 'TAREFA CONCLUÍDA PELO PACIENTE')
      .replace(/TAREFA CONCLUÃDA PELO PACIENTE/g, 'TAREFA CONCLUÍDA PELO PACIENTE')
      .replace(/TAREFA CONCLUÃ DA PELO PACIENTE/g, 'TAREFA CONCLUÍDA PELO PACIENTE')
      .replace(/EvoluÃ§Ã£o/g, 'Evolução')
      .replace(/CONCLUÃDA/g, 'CONCLUÍDA')
      .replace(/PontuaÃ§Ã£o/g, 'Pontuação')
      .replace(/AnotaÃ§Ãµes/g, 'Anotações')
      .replace(/prontuÃ¡rio/gi, 'prontuário')
      .replace(/observaÃ§Ã£o/gi, 'observação')
      .replace(/famÃ­lia/gi, 'família')
      .replace(/sessÃ£o/gi, 'sessão')
      .replace(/avaliaÃ§Ã£o/gi, 'avaliação')
      .replace(/Energia restante após a tarefa/gi, 'Energia após a atividade')
      .replace(/Esforço informado/gi, 'Energia após a atividade')
      .replace(/Ã¡/g, 'á')
      .replace(/Ã©/g, 'é')
      .replace(/Ã­/g, 'í')
      .replace(/Ã³/g, 'ó')
      .replace(/Ãº/g, 'ú')
      .replace(/Ã£/g, 'ã')
      .replace(/Ã§/g, 'ç')
      .replace(/Â/g, ''),
  ).trim();

  const isTherapeuticProgramMeasurementTrial = (trial: any) => {
    const raw = trial?.raw_payload || trial?.rawPayload || {};
    return raw?.therapeuticMeasurement === true || raw?.therapeutic_measurement === true || String(raw?.source || '').trim() === 'therapeutic_program_measurement';
  };

  const formatAbaDateTime = (value: any) => {
    const date = new Date(value || 0);
    if (Number.isNaN(date.getTime())) return 'Sem data';
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const abaCollectionTypeLabels: Record<string, string> = {
    dtt: 'DTT',
    net: 'NET',
    cold_probe: 'Cold Probe',
    baseline_probe: 'Baseline Probe',
    maintenance_probe: 'Maintenance Probe'
  };

  const abaMeasurementTypeLabels: Record<string, string> = {
    frequency: 'Frequencia',
    duration: 'Duracao',
    rate: 'Taxa',
    partial_interval: 'Intervalo parcial',
    whole_interval: 'Intervalo total',
    momentary_time_sampling: 'Amostragem momentanea',
    abc: 'ABC'
  };

  const abaMasteryStatusLabels: Record<string, string> = {
    not_met: 'Em progresso',
    met: 'Critério atingido',
    mastered: 'Maestria',
    regressed: 'Regressao',
    maintenance_due: 'Manutencao pendente',
    insufficient_data: 'Dados insuficientes'
  };

  const abaSessionOptions = useMemo(() => {
    const byId = new Map<string, any>();
    const includeSession = (session: any) => {
      const id = String(session?.id || session?.session_id || session?.sessionId || '').trim();
      if (!id || byId.has(id)) return;
      byId.set(id, session);
    };
    (Array.isArray(abaSessions) ? abaSessions : []).forEach(includeSession);
    [
      ...(Array.isArray(abaTrials) ? abaTrials : []),
      ...(Array.isArray(abaBehaviorEvents) ? abaBehaviorEvents : []),
      ...(Array.isArray(abaMasteryEvaluations) ? abaMasteryEvaluations : []),
      ...(Array.isArray(abaMaintenanceOverview?.probeResults) ? abaMaintenanceOverview.probeResults : [])
    ]
      .forEach((record: any) => {
        const sessionId = String(record?.session_id || record?.sessionId || '').trim();
        if (sessionId && !byId.has(sessionId)) {
          byId.set(sessionId, { id: sessionId, started_at: record?.occurred_at || record?.evaluated_at || record?.created_at });
        }
      });
    return Array.from(byId.values())
      .map((session: any) => ({
        id: String(session?.id || session?.session_id || session?.sessionId || ''),
        label: `${formatAbaDateTime(session?.started_at || session?.startedAt || session?.created_at)}${Number(session?.record_count ?? session?.recordCount ?? 0) ? ` - ${Number(session?.record_count ?? session?.recordCount)} registro(s)` : ''}`
      }))
      .sort((a, b) => b.label.localeCompare(a.label));
  }, [abaSessions, abaTrials, abaBehaviorEvents, abaMasteryEvaluations, abaMaintenanceOverview]);

  const abaStructuredRecords = useMemo(() => {
    const search = abaRecordSearch.trim().toLowerCase();
    const trials = (Array.isArray(abaTrials) ? abaTrials : []).map((trial: any) => {
      const collectionType = String(trial?.collection_type || trial?.collectionType || 'dtt').toLowerCase();
      const score = trial?.response_score ?? trial?.responseScore ?? trial?.score;
      const maxScore = trial?.max_score ?? trial?.maxScore;
      const rawPayload = trial?.raw_payload || trial?.rawPayload || {};
      const therapeuticMeasurement = isTherapeuticProgramMeasurementTrial(trial);
      const therapeuticMeasurementType = String(rawPayload?.measurementType || rawPayload?.measurement_type || '').trim().toLowerCase();
      const therapeuticMeasurementValue = Number(rawPayload?.measurementValue ?? rawPayload?.measurement_value);
      const therapeuticDisplayLabel = String(rawPayload?.displayLabel || rawPayload?.display_label || '').trim();
      const prompt = therapeuticMeasurement ? '' : resolveAbaPromptLevel({
        promptLevelKey: trial?.prompt_level_key || trial?.promptLevelKey,
        promptLevelName: trial?.prompt_level_name || trial?.promptLevelName,
        score,
        maxScore,
        correct: trial?.correct,
        independent: trial?.independent
      }).label;
      const title = normalizeNoteText(safeDisplayValue(trial?.target_name || trial?.targetName || trial?.title, 'Meta sem nome'));
      const sessionId = String(trial?.session_id || trial?.sessionId || '').trim();
      const occurredAt = trial?.occurred_at || trial?.occurredAt || trial?.created_at || trial?.createdAt;
      const therapeuticDetail = therapeuticDisplayLabel || (Number.isFinite(therapeuticMeasurementValue)
        ? therapeuticMeasurementType === 'duration' || therapeuticMeasurementType === 'latency'
          ? `${therapeuticMeasurementType === 'duration' ? 'Duração' : 'Latência'} ${Math.round(therapeuticMeasurementValue * 100) / 100}s`
          : therapeuticMeasurementType === 'percentage' || therapeuticMeasurementType === 'task_analysis'
            ? `${Math.round(therapeuticMeasurementValue * 100) / 100}%`
            : therapeuticMeasurementType === 'frequency'
              ? `Frequência +${Math.round(therapeuticMeasurementValue * 100) / 100}`
              : therapeuticMeasurementType === 'correct_incorrect'
                ? (therapeuticMeasurementValue > 0 ? 'Acerto' : 'Erro')
                : String(therapeuticMeasurementValue)
        : 'Medida registrada');
      return {
        id: `trial-${String(trial?.id || `${title}-${occurredAt}`)}`,
        kind: 'trial',
        tableName: 'aba_trials',
        sourceLabel: therapeuticMeasurement ? 'Medida terapêutica' : 'Tentativa ABA',
        sessionId,
        occurredAt,
        title,
        label: therapeuticMeasurement ? (therapeuticMeasurementType === 'duration' ? 'Duração' : therapeuticMeasurementType === 'latency' ? 'Latência' : therapeuticMeasurementType === 'frequency' ? 'Frequência' : therapeuticMeasurementType === 'correct_incorrect' ? 'Acerto / Erro' : therapeuticMeasurementType === 'task_analysis' ? 'Etapas' : therapeuticMeasurementType === 'percentage' ? 'Percentual' : 'Medida') : (abaCollectionTypeLabels[collectionType] || collectionType.toUpperCase()),
        detail: therapeuticMeasurement ? therapeuticDetail : `Pontuacao ${score ?? '-'}${maxScore !== null && maxScore !== undefined ? `/${maxScore}` : ''} - ${prompt}`,
        note: normalizeNoteText(trial?.notes || trial?.note || ''),
        meta: trial,
        searchText: `${title} ${collectionType} ${therapeuticMeasurementType} ${therapeuticDetail} ${prompt} ${trial?.domain_name || trial?.domainName || ''} ${trial?.protocol_title || trial?.protocolTitle || ''}`.toLowerCase()
      };
    });

    const behaviorEvents = (Array.isArray(abaBehaviorEvents) ? abaBehaviorEvents : []).map((event: any) => {
      const measurementType = String(event?.measurement_type || event?.measurementType || 'frequency').toLowerCase();
      const title = normalizeNoteText(safeDisplayValue(event?.behavior_name || event?.behaviorName || event?.name, 'Comportamento sem nome'));
      const sessionId = String(event?.session_id || event?.sessionId || '').trim();
      const occurredAt = event?.occurred_at || event?.occurredAt || event?.created_at || event?.createdAt;
      const countDelta = event?.count_delta ?? event?.countDelta;
      const location = normalizeNoteText(event?.location || '');
      const antecedent = normalizeNoteText(event?.antecedent || '');
      const consequence = normalizeNoteText(event?.consequence || '');
      const note = normalizeNoteText(event?.notes || event?.note || '');
      return {
        id: `behavior-${String(event?.id || `${title}-${occurredAt}`)}`,
        kind: 'behavior',
        tableName: 'aba_behavior_events',
        sourceLabel: 'Registro comportamental',
        sessionId,
        occurredAt,
        title,
        label: abaMeasurementTypeLabels[measurementType] || measurementType,
        detail:
          measurementType === 'abc'
            ? `A: ${antecedent || '-'} | C: ${consequence || '-'}`
            : `${countDelta !== null && countDelta !== undefined ? `Contagem ${countDelta}` : 'Evento registrado'}${location ? ` - ${location}` : ''}`,
        note,
        meta: event,
        searchText: `${title} ${measurementType} ${location} ${antecedent} ${consequence} ${note}`.toLowerCase()
      };
    });

    const masteryEvaluations = (Array.isArray(abaMasteryEvaluations) ? abaMasteryEvaluations : []).map((evaluation: any) => {
      const status = String(evaluation?.evaluation_status || evaluation?.evaluationStatus || 'not_met').toLowerCase();
      const title = normalizeNoteText(safeDisplayValue(evaluation?.target_name || evaluation?.targetName || evaluation?.title, 'Meta sem nome'));
      const sessionId = String(evaluation?.session_id || evaluation?.sessionId || '').trim();
      const occurredAt = evaluation?.evaluated_at || evaluation?.evaluatedAt || evaluation?.created_at || evaluation?.createdAt;
      const consecutive = Number(evaluation?.consecutive_successes ?? evaluation?.consecutiveSuccesses ?? 0) || 0;
      const minimum = Number(evaluation?.min_consecutive_successes ?? evaluation?.minConsecutiveSuccesses ?? 1) || 1;
      const accuracy = evaluation?.accuracy_percent ?? evaluation?.accuracyPercent;
      const reasons = Array.isArray(evaluation?.reasons) ? evaluation.reasons : [];
      const reasonText = reasons.map((reason: any) => normalizeNoteText(reason)).filter(Boolean).join(' ');
      return {
        id: `mastery-${String(evaluation?.id || `${title}-${occurredAt}`)}`,
        kind: 'mastery',
        tableName: 'aba_mastery_evaluations',
        sourceLabel: 'Avaliacao de maestria',
        sessionId,
        occurredAt,
        title,
        label: abaMasteryStatusLabels[status] || status,
        detail: `Sequencia ${consecutive}/${minimum}${accuracy !== null && accuracy !== undefined ? ` - Precisao ${accuracy}%` : ''}`,
        note: reasonText,
        meta: evaluation,
        searchText: `${title} ${status} ${reasonText}`.toLowerCase()
      };
    });

    const maintenanceProbeResults = (Array.isArray(abaMaintenanceOverview?.probeResults) ? abaMaintenanceOverview.probeResults : []).map((result: any) => {
      const status = String(result?.status || 'WATCH').toUpperCase();
      const title = normalizeNoteText(safeDisplayValue(result?.target_name || result?.targetName || result?.raw_payload?.targetName || result?.rawPayload?.targetName || result?.target_id || result?.targetId, 'Meta sem nome'));
      const sessionId = String(result?.session_id || result?.sessionId || '').trim();
      const occurredAt = result?.occurred_at || result?.occurredAt || result?.created_at || result?.createdAt;
      const accuracy = result?.accuracy_percent ?? result?.accuracyPercent ?? 0;
      const independence = result?.independence_percent ?? result?.independencePercent ?? 0;
      return {
        id: `maintenance-${String(result?.id || `${title}-${occurredAt}`)}`,
        kind: 'maintenance',
        tableName: 'aba_maintenance_probe_results',
        sourceLabel: 'Manutencao',
        sessionId,
        occurredAt,
        title,
        label: status === 'MAINTAINED' ? 'Mantido' : status === 'REGRESSION_RISK' ? 'Risco de regressao' : 'Observar',
        detail: `Acuracia ${accuracy}% - independencia ${independence}%`,
        note: normalizeNoteText(result?.raw_payload?.reasons?.map?.((reason: any) => reason?.message || reason).join(' ') || ''),
        meta: result,
        searchText: `${title} maintenance probe ${status} ${accuracy} ${independence}`.toLowerCase()
      };
    });

    const regressionAlerts = (Array.isArray(abaMaintenanceOverview?.alerts) ? abaMaintenanceOverview.alerts : []).map((alert: any) => {
      const title = normalizeNoteText(safeDisplayValue(alert?.target_name || alert?.targetName || alert?.target_id || alert?.targetId, 'Meta sem nome'));
      const occurredAt = alert?.created_at || alert?.createdAt;
      const severity = String(alert?.severity || 'LOW').toUpperCase();
      const message = normalizeNoteText(alert?.message || 'Risco de regressao');
      return {
        id: `regression-alert-${String(alert?.id || `${title}-${occurredAt}`)}`,
        kind: 'maintenance',
        tableName: 'aba_regression_alerts',
        sourceLabel: 'Alerta clinico',
        sessionId: '',
        occurredAt,
        title,
        label: `Alerta ${severity}`,
        detail: message,
        note: '',
        meta: alert,
        searchText: `${title} regressao regression risk ${severity} ${message}`.toLowerCase()
      };
    });

    return [...trials, ...behaviorEvents, ...masteryEvaluations, ...maintenanceProbeResults, ...regressionAlerts]
      .filter((record) => abaRecordTypeFilter === 'all' || record.kind === abaRecordTypeFilter)
      .filter((record) => abaSessionFilter === 'all' || record.sessionId === abaSessionFilter)
      .filter((record) => !search || record.searchText.includes(search))
      .sort((a, b) => new Date(b.occurredAt || 0).getTime() - new Date(a.occurredAt || 0).getTime());
  }, [abaTrials, abaBehaviorEvents, abaMasteryEvaluations, abaMaintenanceOverview, abaRecordTypeFilter, abaSessionFilter, abaRecordSearch]);

  const approvedMasteryTargetCount = useMemo(() => {
    const masteredTargets = new Set<string>();
    (Array.isArray(abaMasteryEvaluations) ? abaMasteryEvaluations : []).forEach((evaluation: any) => {
      const status = String(evaluation?.status || evaluation?.statusCode || '').trim().toUpperCase();
      const legacyStatus = String(evaluation?.evaluation_status || evaluation?.evaluationStatus || '').trim().toLowerCase();
      if (status !== 'MASTERED_APPROVED' && status !== 'MASTERED' && legacyStatus !== 'mastered') return;
      const targetId = String(evaluation?.target_id || evaluation?.targetId || '').trim();
      const targetName = String(evaluation?.target_name || evaluation?.targetName || '').trim().toLocaleLowerCase('pt-BR');
      const key = targetId || targetName;
      if (key) masteredTargets.add(key);
    });
    return masteredTargets.size;
  }, [abaMasteryEvaluations]);

  const abaSummaryMetrics = useMemo(() => {
    const summary = abaPatientSummary || {};
    return {
      totalSessions: Number(summary.total_sessions ?? summary.totalSessions ?? abaSessionOptions.length) || 0,
      totalTrials: Number(summary.total_trials ?? summary.totalTrials ?? (Array.isArray(abaTrials) ? abaTrials.filter((trial: any) => !isTherapeuticProgramMeasurementTrial(trial)).length : 0)) || 0,
      totalBehaviorEvents: Number(summary.total_behavior_events ?? summary.totalBehaviorEvents ?? abaBehaviorEvents.length) || 0,
      masteredTargets: Number(summary.mastered_targets_count ?? summary.masteredTargetsCount ?? approvedMasteryTargetCount) || 0,
      maintenanceTargets: Number(summary.maintenance_targets_count ?? summary.maintenanceTargetsCount ?? abaMaintenanceOverview?.summary?.maintenance_targets_count ?? abaMaintenanceOverview?.summary?.maintenanceTargetsCount ?? (Array.isArray(abaMaintenanceOverview?.schedules) ? new Set(abaMaintenanceOverview.schedules.map((item: any) => String(item?.target_id || item?.targetId || ''))).size : 0)) || 0,
      pendingMaintenanceProbes: Number(summary.pending_maintenance_probes_count ?? summary.pendingMaintenanceProbesCount ?? abaMaintenanceOverview?.summary?.pending_maintenance_probes_count ?? abaMaintenanceOverview?.summary?.pendingMaintenanceProbesCount ?? (Array.isArray(abaMaintenanceOverview?.schedules) ? abaMaintenanceOverview.schedules.filter((item: any) => String(item?.status || '').toUpperCase() === 'PENDING').length : 0)) || 0,
      activeRegressionRisks: Number(summary.active_regression_risks_count ?? summary.activeRegressionRisksCount ?? abaMaintenanceOverview?.summary?.active_regression_risks_count ?? abaMaintenanceOverview?.summary?.activeRegressionRisksCount ?? (Array.isArray(abaMaintenanceOverview?.alerts) ? abaMaintenanceOverview.alerts.filter((item: any) => !(item?.resolved_at || item?.resolvedAt)).length : 0)) || 0,
      lastEventLabel: summary.last_behavior_event_label || summary.lastBehaviorEventLabel || '',
      lastEventAt: summary.last_behavior_event_at || summary.lastBehaviorEventAt || ''
    };
  }, [abaPatientSummary, abaSessionOptions.length, abaTrials.length, abaBehaviorEvents.length, approvedMasteryTargetCount, abaMaintenanceOverview]);

  const renderAbaRecordsPanel = () => {
    const latestRecord = abaStructuredRecords[0];
    const hasActiveAbaFilters =
      abaRecordTypeFilter !== 'all' ||
      abaSessionFilter !== 'all' ||
      abaRecordSearch.trim().length > 0;

    return (
      <div className={`rounded-[32px] border shadow-sm overflow-hidden transition-colors ${isPanelDark ? 'bg-[#101b2e] border-slate-700' : 'bg-white border-gray-100'}`}>
        <div className={`p-5 sm:p-6 ${isPanelDark ? 'bg-gradient-to-br from-slate-900 via-[#101b2e] to-slate-900' : 'bg-gradient-to-br from-white via-violet-50/50 to-slate-50'}`}>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-4">
              <div className={`mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${isPanelDark ? 'bg-violet-500/15 text-violet-200' : 'bg-[#7a32fc]/10 text-[#7a32fc]'}`}>
                <Target size={22} />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#7a32fc]">Central ABA</p>
                <h3 className={`mt-1 text-xl font-semibold tracking-tight ${isPanelDark ? 'text-slate-50' : 'text-gray-900'}`}>Registros estruturados da sessão</h3>
                <p className={`mt-1 max-w-3xl text-xs leading-relaxed ${isPanelDark ? 'text-slate-300' : 'text-gray-500'}`}>
                  Acompanhe tentativas, comportamentos, maestria e manutencao em uma lista clinica unificada.
                </p>
                {latestRecord && (
                  <p className={`mt-3 text-[11px] font-semibold ${isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}>
                    Último registro: {latestRecord.title} • {formatAbaDateTime(latestRecord.occurredAt)}
                  </p>
                )}
                {!latestRecord && abaSummaryMetrics.lastEventLabel && (
                  <p className={`mt-3 text-[11px] font-semibold ${isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}>
                    Último evento: {abaSummaryMetrics.lastEventLabel} • {formatAbaDateTime(abaSummaryMetrics.lastEventAt)}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAbaRecordsRefreshKey((value) => value + 1)}
                className={`rounded-2xl px-4 py-3 text-[10px] font-semibold uppercase tracking-widest transition-colors ${isPanelDark ? 'bg-slate-800 text-slate-100 hover:bg-slate-700' : 'bg-white text-slate-700 shadow-sm hover:bg-slate-50'}`}
              >
                Atualizar
              </button>
              <button
                type="button"
                onClick={() => setIsAbaPanelExpanded((value) => !value)}
                aria-expanded={isAbaPanelExpanded}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#7a32fc] px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-white shadow-lg shadow-violet-500/20 transition-all hover:opacity-90"
              >
                {isAbaPanelExpanded ? 'Recolher' : 'Ver registros'}
                <ChevronDown size={14} className={`transition-transform ${isAbaPanelExpanded ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-7">
            <button
              type="button"
              onClick={() => {
                setAbaRecordTypeFilter('trial');
                setIsAbaPanelExpanded(true);
              }}
              className={`rounded-2xl border p-4 text-left transition-all ${abaRecordTypeFilter === 'trial' ? 'border-[#7a32fc] ring-2 ring-[#7a32fc]/15' : isPanelDark ? 'border-slate-700' : 'border-slate-100'} ${isPanelDark ? 'bg-slate-900/50' : 'bg-white/80'}`}
            >
              <p className={`text-[10px] font-semibold uppercase tracking-widest ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Tentativas</p>
              <p className={`text-3xl font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>{abaSummaryMetrics.totalTrials}</p>
            </button>
            <button
              type="button"
              onClick={() => {
                setAbaRecordTypeFilter('behavior');
                setIsAbaPanelExpanded(true);
              }}
              className={`rounded-2xl border p-4 text-left transition-all ${abaRecordTypeFilter === 'behavior' ? 'border-emerald-500 ring-2 ring-emerald-500/15' : isPanelDark ? 'border-slate-700' : 'border-slate-100'} ${isPanelDark ? 'bg-slate-900/50' : 'bg-white/80'}`}
            >
              <p className={`text-[10px] font-semibold uppercase tracking-widest ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Comportamentos</p>
              <p className={`text-3xl font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>{abaSummaryMetrics.totalBehaviorEvents}</p>
            </button>
            <button
              type="button"
              onClick={() => {
                setAbaRecordTypeFilter('mastery');
                setIsAbaPanelExpanded(true);
              }}
              className={`rounded-2xl border p-4 text-left transition-all ${abaRecordTypeFilter === 'mastery' ? 'border-amber-500 ring-2 ring-amber-500/15' : isPanelDark ? 'border-slate-700' : 'border-slate-100'} ${isPanelDark ? 'bg-slate-900/50' : 'bg-white/80'}`}
            >
              <p className={`text-[10px] font-semibold uppercase tracking-widest ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Maestria</p>
              <p className={`text-3xl font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>{abaSummaryMetrics.masteredTargets}</p>
            </button>
            <button
              type="button"
              onClick={() => {
                setAbaSessionFilter('all');
                setAbaRecordTypeFilter('all');
                setIsAbaPanelExpanded(true);
              }}
              className={`rounded-2xl border p-4 text-left transition-all ${isPanelDark ? 'bg-slate-900/50 border-slate-700' : 'bg-white/80 border-slate-100'}`}
            >
              <p className={`text-[10px] font-semibold uppercase tracking-widest ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Sessões</p>
              <p className={`text-3xl font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>{abaSummaryMetrics.totalSessions}</p>
            </button>
            <button
              type="button"
              onClick={() => {
                setAbaRecordTypeFilter('maintenance');
                setIsAbaPanelExpanded(true);
              }}
              className={`rounded-2xl border p-4 text-left transition-all ${abaRecordTypeFilter === 'maintenance' ? 'border-amber-500 ring-2 ring-amber-500/15' : isPanelDark ? 'border-slate-700' : 'border-slate-100'} ${isPanelDark ? 'bg-slate-900/50' : 'bg-white/80'}`}
            >
              <p className={`text-[10px] font-semibold uppercase tracking-widest ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Manutenção</p>
              <p className={`text-3xl font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>{abaSummaryMetrics.maintenanceTargets}</p>
            </button>
            <button
              type="button"
              onClick={() => {
                setAbaRecordTypeFilter('maintenance');
                setIsAbaPanelExpanded(true);
              }}
              className={`rounded-2xl border p-4 text-left transition-all ${isPanelDark ? 'bg-slate-900/50 border-slate-700' : 'bg-white/80 border-slate-100'}`}
            >
              <p className={`text-[10px] font-semibold uppercase tracking-widest ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Probes pendentes</p>
              <p className={`text-3xl font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>{abaSummaryMetrics.pendingMaintenanceProbes}</p>
            </button>
            <button
              type="button"
              onClick={() => {
                setAbaRecordTypeFilter('maintenance');
                setIsAbaPanelExpanded(true);
              }}
              className={`rounded-2xl border p-4 text-left transition-all ${abaSummaryMetrics.activeRegressionRisks > 0 ? 'border-red-400 ring-2 ring-red-400/15' : isPanelDark ? 'border-slate-700' : 'border-slate-100'} ${isPanelDark ? 'bg-slate-900/50' : 'bg-white/80'}`}
            >
              <p className={`text-[10px] font-semibold uppercase tracking-widest ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Riscos ativos</p>
              <p className={`text-3xl font-semibold ${abaSummaryMetrics.activeRegressionRisks > 0 ? 'text-red-500' : isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>{abaSummaryMetrics.activeRegressionRisks}</p>
            </button>
          </div>
        </div>

        {isAbaPanelExpanded && (
          <div className={`border-t p-5 sm:p-6 animate-fade-in ${isPanelDark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-100 bg-white'}`}>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[160px_1fr_1fr] mb-5">
              <select
                value={abaRecordTypeFilter}
                onChange={(e) => setAbaRecordTypeFilter(e.target.value)}
                className={`rounded-2xl border px-4 py-3 text-xs font-semibold outline-none focus:border-[#7a32fc] ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-gray-50 border-gray-200 text-slate-800'}`}
              >
                <option value="all">Tudo</option>
                <option value="trial">Tentativas</option>
                <option value="behavior">Comportamentos</option>
                <option value="mastery">Maestria</option>
                <option value="maintenance">Manutencao</option>
              </select>
              <select
                value={abaSessionFilter}
                onChange={(e) => setAbaSessionFilter(e.target.value)}
                className={`rounded-2xl border px-4 py-3 text-xs font-semibold outline-none focus:border-[#7a32fc] ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-gray-50 border-gray-200 text-slate-800'}`}
              >
                <option value="all">Todas as sessões</option>
                {abaSessionOptions.map((session) => (
                  <option key={session.id} value={session.id}>{session.label}</option>
                ))}
              </select>
              <div className="relative">
                <Search size={14} className={`absolute left-4 top-1/2 -translate-y-1/2 ${isPanelDark ? 'text-slate-400' : 'text-slate-400'}`} />
                <input
                  type="text"
                  value={abaRecordSearch}
                  onChange={(e) => setAbaRecordSearch(e.target.value)}
                  placeholder="Buscar por meta, comportamento, local, prompt..."
                  className={`w-full rounded-2xl border px-4 py-3 pl-10 text-xs font-semibold outline-none focus:border-[#7a32fc] ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500' : 'bg-gray-50 border-gray-200 text-slate-800 placeholder:text-slate-400'}`}
                />
              </div>
            </div>

            {hasActiveAbaFilters && (
              <button
                type="button"
                onClick={() => {
                  setAbaRecordTypeFilter('all');
                  setAbaSessionFilter('all');
                  setAbaRecordSearch('');
                }}
                className={`mb-4 rounded-full px-3 py-2 text-[10px] font-semibold uppercase tracking-widest transition-colors ${isPanelDark ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                Limpar filtros
              </button>
            )}

            {abaRecordsError && (
              <div role="alert" className={`mb-4 flex flex-col gap-3 rounded-2xl border p-3 text-xs font-semibold sm:flex-row sm:items-center sm:justify-between ${isPanelDark ? 'bg-amber-500/10 border-amber-400/20 text-amber-100' : 'bg-amber-50 border-amber-100 text-amber-700'}`}>
                <span>{abaRecordsError}</span>
                <button
                  type="button"
                  onClick={() => setAbaRecordsRefreshKey((value) => value + 1)}
                  disabled={isLoadingAbaRecords}
                  className={`min-h-10 shrink-0 rounded-xl border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${isPanelDark ? 'border-amber-300/30 bg-slate-900/50 text-amber-100 hover:bg-slate-800' : 'border-amber-200 bg-white text-amber-800 hover:bg-amber-100'}`}
                >
                  Tentar novamente
                </button>
              </div>
            )}

            {isLoadingAbaRecords ? (
              <div className={`rounded-3xl border border-dashed py-10 text-center ${isPanelDark ? 'border-slate-700 bg-slate-900/40 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                <p className="text-sm font-semibold">Carregando registros ABA...</p>
              </div>
            ) : abaStructuredRecords.length > 0 ? (
              <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
                {abaStructuredRecords.map((record) => (
                  <div key={record.id} className={`rounded-2xl border p-4 transition-colors ${isPanelDark ? 'bg-slate-900/50 border-slate-700' : 'bg-white border-slate-100'}`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className={`rounded-full px-3 py-1 text-[9px] font-semibold uppercase tracking-widest ${record.kind === 'trial' ? 'bg-[#7a32fc]/10 text-[#7a32fc]' : record.kind === 'mastery' ? 'bg-amber-500/10 text-amber-600' : record.kind === 'maintenance' ? 'bg-red-500/10 text-red-600' : 'bg-emerald-500/10 text-emerald-600'}`}>
                            {record.kind === 'trial' ? 'Tentativa' : record.kind === 'mastery' ? 'Maestria' : record.kind === 'maintenance' ? 'Manutencao' : 'Comportamento'}
                          </span>
                          <span className={`rounded-full px-3 py-1 text-[9px] font-semibold uppercase tracking-widest ${isPanelDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-500'}`}>
                            {record.label}
                          </span>
                          <span className={`text-[10px] font-semibold ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>
                            {formatAbaDateTime(record.occurredAt)}
                          </span>
                        </div>
                        <p className={`text-sm font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-800'}`}>{record.title}</p>
                        <p className={`text-xs mt-1 ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>{record.detail}</p>
                        {record.note && (
                          <p className={`text-xs mt-2 whitespace-pre-wrap ${isPanelDark ? 'text-slate-400' : 'text-slate-600'}`}>{record.note}</p>
                        )}
                      </div>
                      <div className="shrink-0 text-left sm:text-right">
                        <p className={`text-[9px] font-semibold uppercase tracking-widest ${isPanelDark ? 'text-slate-500' : 'text-slate-400'}`}>Origem</p>
                        <p className={`text-[11px] font-semibold ${isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}>{record.sourceLabel}</p>
                        {record.sessionId && (
                          <p className={`mt-2 max-w-[180px] truncate text-[10px] ${isPanelDark ? 'text-slate-500' : 'text-slate-400'}`} title={formatSessionLabel({ id: record.sessionId, startedAt: record.occurredAt })}>
                            {formatSessionLabel({ id: record.sessionId, startedAt: record.occurredAt })}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={`rounded-3xl border border-dashed py-10 text-center ${isPanelDark ? 'border-slate-700 bg-slate-900/40' : 'border-slate-200 bg-slate-50'}`}>
                <Target size={34} className={`mx-auto mb-3 ${isPanelDark ? 'text-slate-600' : 'text-slate-300'}`} />
                <p className={`text-sm font-semibold ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
                  {abaRecordsError
                    ? 'Os registros disponíveis não puderam ser confirmados.'
                    : 'Nenhum registro ABA encontrado com estes filtros.'}
                </p>
                {!abaRecordsError && (
                  <p className={`text-xs mt-1 ${isPanelDark ? 'text-slate-500' : 'text-slate-400'}`}>Registre uma tentativa ou comportamento no modo tela cheia e atualize esta lista.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

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

  const groupedHistory = (visibleHistoryWithFamilyNotes || []).reduce((groups: any, item: any) => {
    const groupKey = getPatientTimelineGroupKey(item);
    const group = groups[groupKey] || [];
    group.push(item);
    groups[groupKey] = group;
    return groups;
  }, {});
  const sortedDateKeys = Object.keys(groupedHistory).sort((a, b) => {
    if (a === "Hoje") return -1;
    if (b === "Hoje") return 1;
    if (a === "Ontem") return -1;
    if (b === "Ontem") return 1;
    return b.localeCompare(a);
  });
  
  useEffect(() => {
    const patientId = String(patient?.id || '').trim();
    if (noteMode !== 'professional' || !patientId || mentionCandidatesLoadedForPatientRef.current === patientId) return;
    let cancelled = false;
    void (async () => {
      const result = await dataService.getPatientProfessionalLinks(patientId);
      if (cancelled || result?.success === false) return;
      const currentUserId = String(clinicContext?.userId || '').trim();
      const next = (Array.isArray(result?.links) ? result.links : [])
        .filter((link: any) => String(link?.status || '').toLowerCase() === 'active' && link?.accessEnabled !== false)
        .map((link: any) => ({
          id: String(link?.professional_id || link?.professional?.id || '').trim(),
          name: String(link?.professional?.name || '').trim(),
          specialty: String(link?.specialty || link?.professional?.specialty || '').trim(),
        }))
        .filter((item: any) => item.id && item.name && item.id !== currentUserId);
      setMentionCandidates(Array.from(new Map(next.map((item: any) => [item.id, item])).values()));
      mentionCandidatesLoadedForPatientRef.current = patientId;
    })();
    return () => { cancelled = true; };
  }, [noteMode, patient?.id, clinicContext?.userId]);

  useEffect(() => {
    const targetId = String(focusNoteId || '').trim();
    if (!targetId || activeTab !== 'notes') return;
    const targetNote = (Array.isArray(notes) ? notes : []).find((note: any) => String(note?.id || '') === targetId);
    if (targetNote) {
      const audience = String(targetNote?.visibility || targetNote?.type || '').toLowerCase();
      const expectedMode = ['professional', 'shared_clinic', 'team'].includes(audience)
        ? 'professional'
        : ['patient', 'shared', 'shared_patient', 'family'].includes(audience)
          ? 'patient'
          : 'private';
      if (noteMode !== expectedMode) {
        setNoteMode(expectedMode);
        return;
      }
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const target = document.getElementById(`patient-note-${targetId}`);
      if (!target) return;
      setFocusedNoteId(targetId);
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => setFocusedNoteId((current) => current === targetId ? '' : current), 2600);
      if (typeof onFocusNoteConsumed === 'function') onFocusNoteConsumed();
    }, 120);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activeTab, focusNoteId, notes, noteMode, onFocusNoteConsumed]);

  const mentionQuery = useMemo(() => {
    if (noteMode !== 'professional') return '';
    const match = String(newNote || '').match(/(?:^|\s)@([^@\n]{0,50})$/);
    return match ? String(match[1] || '').trim().toLowerCase() : '';
  }, [newNote, noteMode]);

  const visibleMentionCandidates = useMemo(() => {
    if (noteMode !== 'professional' || !String(newNote || '').includes('@') || /\s$/.test(String(newNote || ''))) return [];
    return mentionCandidates
      .filter((item: any) => !mentionQuery || String(item?.name || '').toLowerCase().includes(mentionQuery))
      .slice(0, 6);
  }, [mentionCandidates, mentionQuery, newNote, noteMode]);

  const insertMention = (candidate: any) => {
    const name = String(candidate?.name || '').trim();
    const id = String(candidate?.id || '').trim();
    if (!name || !id) return;
    setNewNote((current: string) => {
      const source = String(current || '');
      if (/(?:^|\s)@[^@\n]{0,50}$/.test(source)) {
        return source.replace(/@[^@\n]{0,50}$/, `@${name} `);
      }
      return `${source}${source && !source.endsWith(' ') ? ' ' : ''}@${name} `;
    });
    setSelectedMentionUserIds((current) => current.includes(id) ? current : [...current, id]);
  };

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
      onAddNote(patient.id, newNote, noteMode, newNoteSubject, {
        mentionUserIds: noteMode === 'professional' ? selectedMentionUserIds : [],
      });
      setNewNote("");
      setNewNoteSubject("");
      setSelectedMentionUserIds([]);
    }
  };

  const comparisonChartData = useMemo(() => {
    const selectedProto = protocols.find((p: any) => String(p.id) === String(selectedChartProtocolId));
    if (!selectedProto) return [];

    const uniqueDates = Array.from(new Set((history || [])
      .filter((h: any) => String(h?.patientId || h?.patient_id || '') === String(patient.id))
      .filter((h: any) => String(h?.type || '').toLowerCase() === 'task')
      .filter((h: any) => h?.score !== undefined && h?.score !== null)
      .map(resolveHistorySnapshotKey)
      .filter(Boolean)))
      .sort((a: any, b: any) => String(b).localeCompare(String(a)));
    const fallbackDates = uniqueDates.slice(0, 2);
    const d1 = comparisonDate1 || fallbackDates[0] || '';
    const d2 = comparisonDate2 || fallbackDates.find((date: any) => String(date) !== String(d1)) || fallbackDates[0] || '';
    if (!d1 || !d2) return [];

    const scoredEvents = (history || [])
      .filter((h: any) => String(h?.patientId || h?.patient_id || '') === String(patient.id))
      .filter((h: any) => String(h?.type || '').toLowerCase() === 'task')
      .filter((h: any) => h?.score !== undefined && h?.score !== null)
      .map((h: any) => {
        const ts = new Date(h?.created_at || h?.date || 0).getTime() || 0;
        const title = String(h?.title || h?.taskTitle || h?.task_data?.title || '').trim();
        const score = Math.max(0, Math.min(1, Number(h?.score ?? 0) || 0));
        return {
          ...h,
          _timestamp: ts,
          _title: title,
          _score: score,
          _domain: String(h?.domain || h?.domainName || h?.task_data?.domain || h?.task_data?.domainName || '').trim()
        };
      })
      .filter((h: any) => h._title)
      .sort((a: any, b: any) => a._timestamp - b._timestamp);

    const resolveCutoffTimestamp = (dateKey: string) => {
      const parsed = new Date(`${dateKey}T23:59:59.999`).getTime();
      return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
    };

    const isVbMappProtocol = /vb[\s-]?mapp/i.test(String(selectedProto?.title || ''));
    const vbmappCriterion = Number((selectedProto as any)?.masteryCriterion ?? (selectedProto as any)?.vbmapp_mastery_criterion ?? 5) || 5;

    const getDomainScoresForDate = (date: string) => {
      const cutoffTs = resolveCutoffTimestamp(date);

      return selectedProto.data.map((domain: any) => {
        const domainName = String(domain?.name || '').trim();
        const domainTasks = (Array.isArray(domain?.skills) ? domain.skills : [])
          .map((skill: any) => ({
            name: String(skill?.name || '').trim(),
            maxScore: Math.max(1, Number(skill?.maxScore ?? skill?.max_score ?? 1) || 1),
            meta_sucessos: skill?.meta_sucessos ?? skill?.metaSucessos ?? skill?.masteryTarget ?? skill?.mastery_target
          }))
          .filter((skill: any) => skill.name);

        const domainEvents = scoredEvents
          .filter((event: any) => event._timestamp <= cutoffTs)
          .filter((event: any) => {
            const matchesDomain = domainName && normalizeClinicalTaskKey(event?._domain || '') === normalizeClinicalTaskKey(domainName);
            const matchesSkill = domainTasks.some((task: any) => isSameClinicalTask(task.name, event?._title || ''));
            return matchesDomain || matchesSkill;
          })
          .map((event: any) => ({
            title: event?._title || '',
            score: event?._score,
            maxScore: 1,
            consecutive_successes: event?.consecutive_successes,
            created_at: event?.created_at || event?.date || null
          }));

        return calculateDomainMastery(domainEvents, domainTasks, {
          mode: 'latest',
          protocolKind: isVbMappProtocol ? 'vbmapp' : 'other',
          vbmappMasteryCriterion: vbmappCriterion
        });
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

  const toggleReportNote = (id: string | number) => {
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

  const getEffortEmoji = (value: any) => {
    const percent = Number(value);
    if (!Number.isFinite(percent)) return '😐';
    if (percent < 20) return '😫';
    if (percent < 40) return '😕';
    if (percent < 60) return '😐';
    if (percent < 80) return '🙂';
    return '🤩';
  };

  const normalizeEffortPercent = (value: any) => {
    const percent = Number(value);
    if (!Number.isFinite(percent)) return 0;
    return Math.max(0, Math.min(100, Math.round(percent)));
  };

  const getAssignedTaskData = (task: any) =>
    task?.task_data && typeof task.task_data === 'object'
      ? task.task_data
      : task?.taskData && typeof task.taskData === 'object'
        ? task.taskData
        : {};

  const resolveAssignedTaskNumber = (...values: any[]) => {
    for (const value of values) {
      if (value === null || value === undefined || value === '') continue;
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
    }
    return null;
  };

  const resolveAssignedTaskProfessionalScore = (task: any) => {
    const taskData = getAssignedTaskData(task);
    return resolveAssignedTaskNumber(
      task?.pro_score,
      task?.professionalScore,
      taskData?.pro_score,
      taskData?.proScore
    );
  };

  const resolveAssignedTaskReviewNote = (task: any) => {
    const taskData = getAssignedTaskData(task);
    return String(
      task?.pro_review_note ??
      task?.proReviewNote ??
      taskData?.pro_review_note ??
      taskData?.proReviewNote ??
      taskData?.reviewNote ??
      task?.evolutionNote ??
      ''
    );
  };

  const normalizeReviewedAssignedTask = (incomingTask: any, fallbackTask: any = {}) => {
    const fallbackTaskData = getAssignedTaskData(fallbackTask);
    const incomingTaskData = getAssignedTaskData(incomingTask);
    const taskData = {
      ...fallbackTaskData,
      ...incomingTaskData
    };
    const mergedTask = {
      ...fallbackTask,
      ...incomingTask,
      task_data: taskData,
      taskData
    };
    const score = resolveAssignedTaskProfessionalScore(mergedTask);
    const maxScore =
      resolveAssignedTaskNumber(mergedTask?.max_score, mergedTask?.maxScore, taskData?.max_score, taskData?.maxScore) ??
      resolveAssignedTaskMaxScore(mergedTask);
    const note = resolveAssignedTaskReviewNote(mergedTask);
    const reviewedAt = mergedTask?.reviewed_at || taskData?.reviewed_at || taskData?.reviewedAt || new Date().toISOString();
    return {
      ...mergedTask,
      pro_score: score,
      professionalScore: score,
      max_score: maxScore,
      maxScore,
      pro_review_note: note,
      proReviewNote: note,
      reviewed_at: reviewedAt,
      status: mergedTask?.status || 'completed',
      task_data: {
        ...taskData,
        pro_score: score,
        proScore: score,
        max_score: maxScore,
        maxScore,
        pro_review_note: note,
        proReviewNote: note,
        reviewed_at: reviewedAt,
        reviewedAt
      },
      taskData: {
        ...taskData,
        pro_score: score,
        proScore: score,
        max_score: maxScore,
        maxScore,
        pro_review_note: note,
        proReviewNote: note,
        reviewed_at: reviewedAt,
        reviewedAt
      }
    };
  };

  const adultCompletedTasks = useMemo(() => {
    const deduped = new Map<string, any>();
    const isLegacyCompletedTask = (task: any) => {
      const status = String(task?.status || '').toLowerCase();
      if (status) return status === 'completed' || status === 'done';
      if (typeof task?.is_completed === 'boolean') return task.is_completed;
      if (typeof task?.done === 'boolean') return task.done;
      if (typeof task?.completed === 'boolean') return task.completed;
      return false;
    };

    const completedAssigned = (assignedTasks || [])
      .filter((task: any) => String(task?.status || '').toLowerCase() === 'completed')
      .map((task: any) => {
        const taskData = getAssignedTaskData(task);
        const professionalScore = resolveAssignedTaskProfessionalScore(task);
        const executionDateRaw = task?.completed_at || task?.scheduled_at || task?.created_at;
        const reviewDateRaw = task?.reviewed_at || task?.updated_at || executionDateRaw;
        const eventDateRaw = professionalScore === null ? executionDateRaw : reviewDateRaw;
        const eventDate = eventDateRaw ? new Date(eventDateRaw) : new Date();
        const executionDate = executionDateRaw ? new Date(executionDateRaw) : eventDate;
        const reviewDate = reviewDateRaw ? new Date(reviewDateRaw) : null;
        const safeMaxScore = Math.max(
          1,
          Number(taskData?.maxScore ?? taskData?.max_score ?? task?.max_score ?? 4) || 4
        );
        return {
          ...task,
          taskData,
          eventDate,
          eventDateRaw,
          executionDate,
          executionDateRaw,
          reviewDate,
          reviewDateRaw,
          taskTitle: String(taskData?.title || task?.title || 'Tarefa'),
          taskType: String(task?.task_type || task?.type || 'task'),
          maxScore: safeMaxScore,
          patientEffort: normalizeEffortPercent(task?.patient_effort ?? taskData?.patientEffort ?? taskData?.patient_effort ?? task?.energy ?? 0),
          patientEffortEmoji: String(task?.patient_effort_emoji || taskData?.patientEffortEmoji || taskData?.patient_effort_emoji || getEffortEmoji(task?.patient_effort ?? taskData?.patientEffort ?? taskData?.patient_effort ?? task?.energy ?? 0)),
          patientEffortLabel: String(task?.patient_effort_label || taskData?.patientEffortLabel || taskData?.patient_effort_label || ''),
          patientComment: String(task?.patient_comment || ''),
          professionalScore,
          evolutionNote: resolveAssignedTaskReviewNote(task)
        };
      });

    const completedLegacy = (patientTasks || [])
      .filter((task: any) => isLegacyCompletedTask(task))
      .map((task: any) => {
        const professionalScore = resolveAssignedTaskProfessionalScore(task);
        const executionDateRaw = task?.completed_at || task?.scheduled_at || task?.created_at;
        const reviewDateRaw = task?.reviewed_at || task?.updated_at || executionDateRaw;
        const eventDateRaw = professionalScore === null ? executionDateRaw : reviewDateRaw;
        const eventDate = eventDateRaw ? new Date(eventDateRaw) : new Date();
        const executionDate = executionDateRaw ? new Date(executionDateRaw) : eventDate;
        const reviewDate = reviewDateRaw ? new Date(reviewDateRaw) : null;
        const safeMaxScore = Math.max(1, Number(task?.maxScore ?? task?.max_score ?? 4) || 4);
        const taskData = task?.taskData && typeof task.taskData === 'object'
          ? task.taskData
          : task?.task_data && typeof task.task_data === 'object'
            ? task.task_data
            : {};
        return {
          ...task,
          taskData,
          eventDate,
          eventDateRaw,
          executionDate,
          executionDateRaw,
          reviewDate,
          reviewDateRaw,
          taskTitle: String(task?.title || 'Tarefa'),
          taskType: String(task?.type || task?.task_type || 'task'),
          maxScore: safeMaxScore,
          patientEffort: normalizeEffortPercent(task?.patient_effort ?? taskData?.patientEffort ?? taskData?.patient_effort ?? task?.energy ?? 0),
          patientEffortEmoji: String(task?.patient_effort_emoji || taskData?.patientEffortEmoji || taskData?.patient_effort_emoji || getEffortEmoji(task?.patient_effort ?? taskData?.patientEffort ?? taskData?.patient_effort ?? task?.energy ?? 0)),
          patientEffortLabel: String(task?.patient_effort_label || taskData?.patientEffortLabel || taskData?.patient_effort_label || ''),
          patientComment: String(task?.patient_comment || task?.note || ''),
          professionalScore,
          evolutionNote: resolveAssignedTaskReviewNote(task) || String(task?.evolutionNote || task?.evalComment || '')
        };
      });

    [...completedAssigned, ...completedLegacy].forEach((task: any) => {
        const key = String(task?.assignedTaskId || task?.id || '') || [
          String(task?.patient_id || task?.patientId || ''),
          String(task?.taskTitle || ''),
          String(task?.eventDateRaw || ''),
        ].join('|');
        const prev = deduped.get(key);
        if (!prev || task.eventDate.getTime() >= prev.eventDate.getTime()) {
          deduped.set(key, task);
        }
      });

    return Array.from(deduped.values()).sort((a: any, b: any) => b.eventDate.getTime() - a.eventDate.getTime());
  }, [assignedTasks, patientTasks]);

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
    const taskData = task?.taskData && typeof task.taskData === 'object'
      ? task.taskData
      : task?.task_data && typeof task.task_data === 'object'
        ? task.task_data
        : {};
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
      if (!Number.isFinite(Number(task?.professionalScore))) return false;
      const protocol = resolveTaskProtocol(task);
      return protocol && String(protocol.id) === String(selectedChartProtocol.id);
    });
  }, [adultCompletedTasks, selectedChartProtocol, isKidsProfile, protocols]);

  const cumulativeGrowthHistory = useMemo(() => {
    const baseHistory = Array.isArray(history) ? history : [];
    if (isKidsProfile) return baseHistory;
    const adultRows = adultCompletedTasks
      .filter((task: any) => Number.isFinite(Number(task?.professionalScore)))
      .map((task: any) => {
        const taskData = getAssignedTaskData(task);
        return {
          id: `adult-cumulative-${task?.id}`,
          patientId: task?.patientId || task?.patient_id || patient?.id,
          patient_id: task?.patient_id || task?.patientId || patient?.id,
          title: task?.taskTitle || taskData?.title || task?.title || 'Tarefa',
          taskTitle: task?.taskTitle || taskData?.title || task?.title || 'Tarefa',
          professionalScore: task?.professionalScore,
          pro_score: task?.professionalScore,
          maxScore: task?.maxScore,
          max_score: task?.maxScore,
          created_at: task?.reviewed_at || task?.reviewDateRaw || task?.eventDateRaw || task?.completed_at || task?.created_at,
          reviewed_at: task?.reviewed_at || task?.reviewDateRaw || task?.eventDateRaw,
          protocol_id: taskData?.protocolId || taskData?.protocol_id || task?.protocol_id,
          protocol_title: taskData?.protocolTitle || taskData?.protocol_name || task?.protocol_title,
          task_data: taskData
        };
      });
    return [...baseHistory, ...adultRows];
  }, [adultCompletedTasks, history, isKidsProfile, patient?.id]);

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

  const formatReportDateLabel = (value: string) => {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split('-');
      return `${day}/${month}/${year}`;
    }
    return value;
  };

  const progressReportChartData = isKidsProfile ? comparisonChartData : adultReportDomainComparisonData;
  const progressReportComparisonKeys = useMemo(() => {
    const firstRow = progressReportChartData?.[0] || {};
    return Object.keys(firstRow).filter((key) => key !== 'name');
  }, [progressReportChartData]);

  const progressReportObservations = useMemo(() => {
    if (isKidsProfile) {
      return kidsReportSelectableNotes
        .filter((note: any) => selectedReportNotes.map(String).includes(String(note.id)))
        .map((note: any) => ({
          id: note.id,
          date: String(note?.date || '-'),
          type: 'NOVO REGISTRO',
          activity: String(note?.subject || 'Observação clínica'),
          score: '-',
          notes: normalizeNoteText(note?.text || '')
        }));
    }

    return adultEvolutionSelectedTasks.map((task: any) => ({
      id: task.id,
      date: task.eventDate?.toLocaleString?.('pt-BR') || '-',
      type: 'NOVO REGISTRO',
      activity: task.taskTitle || 'Atividade clínica',
      score: `${task.professionalScore ?? '-'} de ${task.maxScore ?? '-'} PTS`,
      notes: task.evolutionNote || 'Sem anotação técnica registrada.'
    }));
  }, [isKidsProfile, kidsReportSelectableNotes, selectedReportNotes, adultEvolutionSelectedTasks]);

  const progressReportPeriodLabel = isKidsProfile
    ? `${formatReportDateLabel(progressReportComparisonKeys[0] || comparisonDate1 || '') || 'Base'} VS ${formatReportDateLabel(progressReportComparisonKeys[1] || comparisonDate2 || '') || 'Final'}`
    : `${formatReportDateLabel(adultReportDate1)} VS ${formatReportDateLabel(adultReportDate2)} - ${periodLabelByValue[reportPeriod as keyof typeof periodLabelByValue] || 'Período'}`;

  const formatCnpj = (value: any) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length !== 14) return String(value || '').trim();
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  };

  const progressClinicContext = resolvedClinicContext || clinicContext || {};
  const progressReportClinic = {
    name: progressClinicContext?.clinicName || progressClinicContext?.clinicLegalName || progressClinicContext?.name || 'Clínica Verto',
    cnpj: formatCnpj(progressClinicContext?.cnpj || progressClinicContext?.clinicCnpj || progressClinicContext?.document || ''),
    address:
      progressClinicContext?.address ||
      [progressClinicContext?.street, progressClinicContext?.number, progressClinicContext?.complement, progressClinicContext?.neighborhood, progressClinicContext?.city]
        .filter(Boolean)
        .join(', '),
    phone: progressClinicContext?.phone || progressClinicContext?.telephone || '-',
    email: progressClinicContext?.email || progressClinicContext?.clinicEmail || '-',
    logoUrl: progressClinicContext?.clinicLogoUrl || progressClinicContext?.logoUrl || null
  };

  const progressReportProfessional = {
    name: clinicContext?.professionalName || clinicContext?.userName || patient?.therapistName || 'Profissional responsável',
    registry: clinicContext?.crp || clinicContext?.professionalCrp || clinicContext?.registry || '-',
    signatureUrl: clinicContext?.signatureUrl || clinicContext?.signatureDataUrl || clinicContext?.professionalSignatureUrl || null
  };

  const sanitizePdfFileName = (value: string) =>
    String(value || 'Paciente')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

  const handlePDFAction = async (action: 'view' | 'download') => {
    if (!progressReportChartData.length) {
      alert('Selecione períodos com dados suficientes para gerar o PDF.');
      return;
    }
    if (!progressReportPdfRef.current) {
      alert('Não foi possível preparar o layout do PDF. Tente novamente.');
      return;
    }

    setIsGeneratingProgressPdf(true);
    try {
      await refreshClinicDocumentMedia();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const pages = Array.from(progressReportPdfRef.current.querySelectorAll('.progress-report-pdf-page')) as HTMLElement[];
      const captureTargets = pages.length ? pages : [progressReportPdfRef.current];

      for (let index = 0; index < captureTargets.length; index += 1) {
        const page = captureTargets[index];
        const captureNode = await prepareElementForPdfCapture(page);
        try {
          const canvas = await html2canvas(captureNode, {
            backgroundColor: '#ffffff',
            scale: 2,
            useCORS: true,
            allowTaint: true,
            logging: false,
            windowWidth: captureNode.scrollWidth || 794,
            windowHeight: captureNode.scrollHeight || 1123
          });
          const imgData = canvas.toDataURL('image/png', 1.0);
          if (index > 0) pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, pageHeight);
        } finally {
          if (captureNode.parentNode) {
            captureNode.parentNode.removeChild(captureNode);
          }
        }
      }

      if (action === 'view') {
        window.open(pdf.output('bloburl'), '_blank', 'noopener,noreferrer');
        return;
      }

      const generatedAt = new Date().toISOString().slice(0, 10);
      pdf.save(`Relatorio_Progresso_Verto_${sanitizePdfFileName(patient?.name)}_${generatedAt}.pdf`);
    } catch (error) {
      console.error('Falha ao gerar PDF do relatório de progresso:', error);
      alert('Não foi possível gerar o PDF agora. Verifique os dados do relatório e tente novamente.');
    } finally {
      setIsGeneratingProgressPdf(false);
    }
  };
  
  const handleSchedule = async () => { 
    if (!scheduleDate || !scheduleTime) { alert("Selecione data e hora."); return; } 
    let scheduledAt; try { scheduledAt = new Date(`${scheduleDate}T${scheduleTime}`).toISOString(); } catch (e) { alert("Data inválida"); return; } 
    if (planType === 'task' || planType === 'intervention') { 
      const selectedSkillMaxScore = Number(
        selectedDomain?.skills?.find((s: any) => String(s.id) === String(selectedSkillId))?.maxScore ?? 4
      );
      const selectedSkill = selectedDomain?.skills?.find((s: any) => String(s.id) === String(selectedSkillId));
      const selectedSkillMasteryTarget = Number(
        selectedSkill?.meta_sucessos ?? selectedSkill?.metaSucessos ?? selectedSkill?.masteryTarget ?? selectedSkill?.mastery_target
      );
      const resolvedTaskMaxScore = isCreatingNewTask
        ? Math.max(1, Number(newTaskMaxScore || 4) || 4)
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
        objective: selectedSkill?.objective || newTaskObjective || finalTaskSubtitle || '',
        question: selectedSkill?.question || '',
        example: selectedSkill?.example || newTaskExample || '',
        criteria: selectedSkill?.criteria || newTaskCriteria || '',
        comment: selectedSkill?.comment || newTaskComment || '',
        code: selectedSkill?.code || newTaskCode || '',
        sourcePage: selectedSkill?.sourcePage || selectedSkill?.source_page || null,
        sourceDomain: selectedSkill?.sourceDomain || selectedSkill?.source_domain || selectedDomain?.name || null,
        maxScore: resolvedTaskMaxScore,
        meta_sucessos: Number.isFinite(selectedSkillMasteryTarget) && selectedSkillMasteryTarget > 0 ? Math.floor(selectedSkillMasteryTarget) : undefined,
        protocolId: selectedProtocol?.id || null,
        protocol_id: selectedProtocol?.id || null,
        protocolTitle: selectedProtocol?.title || selectedProtocol?.name || null,
        protocol_name: selectedProtocol?.title || selectedProtocol?.name || null,
        domainId: selectedDomain?.id || null,
        domainName: selectedDomain?.name || null,
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
          maxScore: resolvedTaskMaxScore,
          objective: newTaskObjective,
          example: newTaskExample,
          criteria: newTaskCriteria,
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
          safeSetProtocols?.(updatedProtocols); 
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
          safeSetProtocols?.([...protocols, newProtocol]); 
        } 
      } else { if (!selectedSkillId) { alert("Selecione uma tarefa."); return; } } 
      if (isKidsProfile) {
        const saved = (await onAddTask(taskPayload)) !== false;
        if (!saved) return;
      } else {
        const selectedProtocolCategory = String(selectedProtocol?.category || (planType === 'task' ? 'evaluation' : 'intervention')).toLowerCase();
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
            protocolId: taskPayload.protocolId || undefined,
            protocolTitle: taskPayload.protocolTitle || undefined,
            protocolCategory: selectedProtocolCategory,
            domainId: taskPayload.domainId || undefined,
            domainName: taskPayload.domainName || undefined,
            skillId: selectedSkill?.id || undefined,
            skillName: selectedSkill?.name || taskPayload.title || undefined,
            skillCode: taskPayload.code || undefined,
            objective: taskPayload.objective || undefined,
            question: taskPayload.question || undefined,
            example: taskPayload.example || undefined,
            criteria: taskPayload.criteria || undefined,
            comment: taskPayload.comment || undefined,
            sourcePage: taskPayload.sourcePage || undefined,
            sourceDomain: taskPayload.sourceDomain || undefined,
            maxScore: resolvedTaskMaxScore,
            max_score: resolvedTaskMaxScore,
            meta_sucessos: taskPayload.meta_sucessos,
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

  const resolveAssignedTaskEvaluationContext = (task: any) => {
    const taskData = getAssignedTaskData(task);
    const taskType = String(task?.task_type || task?.type || '').toLowerCase();
    if (taskType !== 'task') return null;

    const explicitCategory = String(taskData?.protocolCategory || '').toLowerCase();
    if (explicitCategory && explicitCategory !== 'evaluation') return null;

    const evaluationProtocols = (protocols || []).filter((p: any) => p?.category === 'evaluation' || !p?.category);
    const explicitProtocolId = String(taskData?.protocolId || taskData?.protocol_id || '').trim();
    const explicitProtocolTitle = String(taskData?.protocolTitle || taskData?.protocol_name || '').trim();
    const explicitSkillId = String(taskData?.skillId || taskData?.skill_id || '').trim();
    const explicitSkillName = String(taskData?.skillName || taskData?.skill_name || taskData?.title || task?.title || '').trim();

    const matchedProtocol =
      evaluationProtocols.find((protocol: any) => {
        if (explicitProtocolId && String(protocol?.id || '').trim() === explicitProtocolId) return true;
        if (explicitProtocolTitle && isSameClinicalTask(protocol?.title || protocol?.name || '', explicitProtocolTitle)) return true;
        if (!explicitSkillName) return false;
        return (protocol?.data || []).some((domain: any) =>
          (domain?.skills || []).some((skill: any) => isSameClinicalTask(skill?.name || '', explicitSkillName))
        );
      }) || null;

    if (!matchedProtocol) return null;

    let matchedDomain: any = null;
    let matchedSkill: any = null;
    for (const domain of matchedProtocol?.data || []) {
      const foundSkill = (domain?.skills || []).find((skill: any) => {
        if (explicitSkillId && String(skill?.id || '').trim() === explicitSkillId) return true;
        return isSameClinicalTask(skill?.name || '', explicitSkillName);
      });
      if (foundSkill) {
        matchedDomain = domain;
        matchedSkill = foundSkill;
        break;
      }
    }

    if (!matchedSkill) return null;
    return { protocol: matchedProtocol, domain: matchedDomain, skill: matchedSkill };
  };

  const isAssignedTaskReviewable = (task: any) => Boolean(resolveAssignedTaskEvaluationContext(task));

  const resolveAssignedTaskMaxScore = (task: any) => {
    const taskData = getAssignedTaskData(task);
    const context = resolveAssignedTaskEvaluationContext(task);
    if (context?.skill) {
      return Math.max(1, Number(context.skill?.maxScore ?? context.skill?.max_score ?? 1) || 1);
    }
    return Math.max(1, Number(taskData?.maxScore ?? taskData?.max_score ?? task?.max_score ?? 4) || 4);
  };

  const resolveAssignedReviewDetails = (task: any, context?: any) => {
    const taskData =
      task?.task_data && typeof task.task_data === 'object'
        ? task.task_data
        : task?.taskData && typeof task.taskData === 'object'
          ? task.taskData
          : {};
    const skill = context?.skill || {};
    const domain = context?.domain || {};
    const protocol = context?.protocol || {};
    const clean = (value: any) => normalizeNoteText(String(value || ''));
    return {
      protocolTitle: clean(taskData?.protocolTitle || taskData?.protocol_name || protocol?.title || protocol?.name),
      domainName: clean(taskData?.domainName || taskData?.domain_name || domain?.name || skill?.sourceDomain || skill?.source_domain),
      code: clean(taskData?.skillCode || taskData?.code || skill?.code),
      objective: clean(taskData?.objective || skill?.objective || taskData?.description),
      question: clean(taskData?.question || skill?.question),
      example: clean(taskData?.example || skill?.example),
      criteria: clean(taskData?.criteria || skill?.criteria),
      comment: clean(taskData?.comment || skill?.comment),
      sourcePage: taskData?.sourcePage || taskData?.source_page || skill?.sourcePage || skill?.source_page || null
    };
  };

  const renderAssignedReviewCriteriaPanel = (task: any, context?: any) => {
    const details = resolveAssignedReviewDetails(task, context);
    const meta = [
      details.protocolTitle,
      details.domainName,
      details.code ? `Código ${details.code}` : '',
      details.sourcePage ? `p. ${details.sourcePage}` : ''
    ].filter(Boolean).join(' • ');
    const hasDetails = Boolean(
      details.objective ||
      details.question ||
      details.criteria ||
      details.example ||
      details.comment ||
      meta
    );
    if (!hasDetails) return null;

    return (
      <div className={`border rounded-xl p-3 space-y-2 ${isPanelDark ? 'bg-slate-900/50 border-slate-700' : 'bg-indigo-50/40 border-indigo-100'}`}>
        <div>
          <p className={`text-[10px] font-semibold uppercase tracking-widest ${isPanelDark ? 'text-violet-200' : 'text-[#7a32fc]'}`}>
            Critérios para pontuação
          </p>
          {meta && (
            <p className={`text-[11px] font-semibold mt-1 ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
              {meta}
            </p>
          )}
        </div>
        {details.objective && (
          <p className={`text-xs leading-relaxed ${isPanelDark ? 'text-slate-200' : 'text-slate-700'}`}>
            <span className="font-semibold">Objetivo:</span> {details.objective}
          </p>
        )}
        {details.question && (
          <p className={`text-xs leading-relaxed ${isPanelDark ? 'text-slate-200' : 'text-slate-700'}`}>
            <span className="font-semibold">Pergunta:</span> {details.question}
          </p>
        )}
        {details.criteria && (
          <p className={`text-xs leading-relaxed whitespace-pre-wrap ${isPanelDark ? 'text-slate-100' : 'text-slate-800'}`}>
            <span className="font-semibold">Escala:</span> {details.criteria}
          </p>
        )}
        {details.example && (
          <p className={`text-xs leading-relaxed ${isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}>
            <span className="font-semibold">Exemplo:</span> {details.example}
          </p>
        )}
        {details.comment && (
          <p className={`text-xs leading-relaxed ${isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}>
            <span className="font-semibold">Observação:</span> {details.comment}
          </p>
        )}
      </div>
    );
  };

  const pendingAssignedReviews = useMemo(
    () =>
      (assignedTasks || []).filter(
        (task: any) =>
          isAssignedTaskReviewable(task) &&
          String(task?.status || '').toLowerCase() === 'completed' &&
          resolveAssignedTaskProfessionalScore(task) === null
      ),
    [assignedTasks, protocols]
  );

  const reviewedAssignedTasks = useMemo(
    () =>
      (assignedTasks || []).filter(
        (task: any) =>
          isAssignedTaskReviewable(task) &&
          String(task?.status || '').toLowerCase() === 'completed' &&
          resolveAssignedTaskProfessionalScore(task) !== null
      ),
    [assignedTasks, protocols]
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
    const dynamicMaxScore = resolveAssignedTaskMaxScore(task);
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

    const reviewedTask = normalizeReviewedAssignedTask(result.data, task);
    setAssignedTasks((prev) => prev.map((item: any) => (String(item.id) === taskId ? reviewedTask : item)));
    setAssignedReviewDrafts((prev) => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });

    const returnedNote = result?.privateNote || {
      id: `assigned-review-note-${taskId}`,
      patient_id: reviewedTask?.patient_id || patient?.id,
      text: [
        'REVISÃO PROFISSIONAL DE TAREFA ADULTA',
        `Tarefa: ${String(reviewedTask?.task_data?.title || reviewedTask?.title || 'Tarefa adulta')}`,
        `Pontuação profissional: ${numericScore} / ${dynamicMaxScore}`,
        `Energia após a atividade: ${normalizeEffortPercent(reviewedTask?.patient_effort ?? reviewedTask?.task_data?.patientEffort ?? reviewedTask?.task_data?.patient_effort ?? 0)}%`,
        draft.note ? `Anotação técnica: ${draft.note}` : 'Anotação técnica: Sem anotação técnica registrada.'
      ].join('\n'),
      content: '',
      created_at: reviewedTask?.reviewed_at || new Date().toISOString(),
      visibility: 'private',
      type: 'private',
      subject: 'Revisão profissional - tarefa adulta'
    };
    if (returnedNote) {
      const noteCreatedAt = returnedNote?.created_at || reviewedTask?.reviewed_at || new Date().toISOString();
      setGeneratedReviewNotes((prev) => {
        const noteId = String(returnedNote?.id || `assigned-review-note-${taskId}`);
        const nextNote = {
          ...returnedNote,
          id: noteId,
          patientId: returnedNote?.patient_id || reviewedTask?.patient_id || patient?.id,
          patient_id: returnedNote?.patient_id || reviewedTask?.patient_id || patient?.id,
          text: normalizeNoteText(returnedNote?.text || returnedNote?.content || ''),
          content: normalizeNoteText(returnedNote?.content || returnedNote?.text || ''),
          date: new Date(noteCreatedAt).toLocaleString(),
          created_at: noteCreatedAt,
          visibility: returnedNote?.visibility || returnedNote?.type || 'private',
          type: returnedNote?.type || returnedNote?.visibility || 'private',
          subject: returnedNote?.subject || 'Revisão profissional - tarefa adulta'
        };
        return [nextNote, ...prev.filter((note: any) => String(note?.id) !== noteId)];
      });
    }

    const suggestedTask = result?.suggestedTask;
    if (suggestedTask) {
      const taskData = suggestedTask?.task_data && typeof suggestedTask.task_data === 'object' ? suggestedTask.task_data : {};
      const suggestion = {
        ...suggestedTask,
        id: String(suggestedTask?.id || `suggestion-${taskId}`),
        sourceAssignedTaskId: taskId,
        createdAt: new Date().toISOString(),
        title: String(taskData?.title || suggestedTask?.title || 'Intervenção sugerida'),
        description: String(taskData?.description || suggestedTask?.description || ''),
        task_data: taskData
      };
      setSuggestedInterventionTasks((prev) => [
        suggestion,
        ...prev.filter((item: any) => String(item?.sourceAssignedTaskId || item?.id) !== String(taskId))
      ].slice(0, 12));
    }

    alert('Nota profissional salva com sucesso.');
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
    void dataService.submitPatientAnamnesis(String(patient.id), updatedData, anamnesisFlow?.request?.id || null)
      .then((result) => {
        if (result?.success) {
          void loadAnamnesisFlow();
        }
      })
      .catch((error) => console.warn('Falha ao sincronizar resposta da anamnese:', error));
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
    e.target.value = '';
    const fileSizeBytes = Math.max(0, Number(file.size || 0) || 0);
    if (fileSizeBytes <= 0 || fileSizeBytes > PATIENT_FILE_MAX_SIZE_BYTES) {
      alert('O arquivo deve ter no máximo 10 MB.');
      return;
    }
    const imageWillBeCompressed =
      String(file.type || '').toLowerCase().startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(String(file.name || ''));
    if (!imageWillBeCompressed && patientFileStorageUsage.usedBytes + fileSizeBytes > patientFileStorageUsage.limitBytes) {
      alert('Este arquivo ultrapassaria o limite total de 1 GB do Drive deste paciente. Remova arquivos antes de continuar.');
      return;
    }
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
      const fileBlob: Blob = file;

      const uploadResult = await dataService.uploadPatientFile(String(patient.id), {
        fileName: normalizedName,
        contentType: mimeType,
        fileBlob,
        source: 'upload',
        metadata: {
          patientName: patient?.name || null
        },
        onProgress: (percent: number) => {
          setUploadProgress(Math.max(25, Math.min(95, percent)));
        }
      });
      if (!uploadResult?.success || !uploadResult?.data) {
        throw new Error(uploadResult?.warning || uploadResult?.error || 'Falha no upload');
      }
      const newFile = normalizeFileRecord(uploadResult.data);

      setPatientFiles((prev) => [newFile, ...prev]);
      syncPatientFileStorageUsage(uploadResult?.storageUsage, newFile.sizeBytes || fileSizeBytes);
      setUploadProgress(100);
    } catch (error: any) {
      console.error('Falha ao salvar arquivo do paciente:', error);
      const uploadMessage = String(error?.message || error || '').trim();
      alert(uploadMessage ? `Não foi possível salvar o arquivo. ${uploadMessage}` : 'Não foi possível salvar o arquivo. Tente novamente.');
    } finally {
      setTimeout(() => {
        setIsUploadingFile(false);
        setUploadProgress(0);
      }, 250);
    }
  };

  const handleRecordTrialWithConfirmation = (pid: any, goalId: any, title: string, score: number) => {
    if (!activeSession) {
      requestSessionStart('fullscreen');
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
      const pendingGoal = Array.isArray(patient?.pei)
        ? patient.pei.find((goal: any) => String(goal?.id) === String(pendingTrial.goalId) || goal?.name === pendingTrial.title)
        : null;
      const sessionMeta = activeSession
        ? {
            sessionId: activeSession.id,
            sessionStartedAt: activeSession.startedAt,
            sessionReferenceDate: activeSession.referenceDate,
            targetId: pendingTrial.goalId,
            targetMaxScore: pendingGoal?.maxScore || 1,
            protocolId: pendingGoal?.protocolId || null,
            protocolTitle: pendingGoal?.protocolTitle || null,
            domainId: pendingGoal?.domainId || null,
            domainName: pendingGoal?.domainName || null,
            collectionType: 'dtt',
            promptLevelKey: pendingTrial.score === 1 ? 'independent' : 'prompted',
            promptLevelName: pendingTrial.score === 1 ? 'Independente' : 'Com ajuda',
            independent: pendingTrial.score === 1
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
          const existingFile = patientFiles.find((file: any) => String(file.id) === String(id));
          const removeResult = await dataService.deletePatientFile(String(patient.id), String(id));
          if (!removeResult?.success) {
            alert(removeResult?.warning || removeResult?.error || 'Não foi possível excluir o arquivo.');
            return;
          }
          const nextFiles = patientFiles.filter((f: any) => String(f.id) !== String(id));
          setPatientFiles(nextFiles);
          syncPatientFileStorageUsage(
            removeResult?.storageUsage,
            -Math.max(0, Number(existingFile?.sizeBytes || 0) || 0)
          );
      }
  };

  const handleConfirmAnamnesisFile = () => {
    if (!pendingAnamnesisPayload || isSavingAnamnesisFile) return;
    const fileName = (anamnesisFileName || `Ficha_Anamnese_${patient.name}`).trim();
    const normalizedName = fileName.toLowerCase().endsWith(".pdf")
      ? fileName
      : `${fileName.replace(/\.html?$/i, "")}.pdf`;
    const sizeKb = Math.max(1, Math.round(pendingAnamnesisPayload.length / 1024));
    const payloadDate = anamnesisFileDate
      ? new Date(`${anamnesisFileDate}T00:00:00`).toLocaleDateString("pt-BR")
      : new Date().toLocaleDateString("pt-BR");

    const persist = async () => {
      setIsSavingAnamnesisFile(true);
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
          id: crypto.randomUUID(),
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
          if (uploadResult?.code === 'PATIENT_FILE_STORAGE_QUOTA_EXCEEDED') {
            uploadResult = {
              success: false,
              code: uploadResult.code,
              error: uploadErrorMessage,
              storageUsage: uploadResult?.storageUsage
            };
          } else {
            uploadResult = {
              success: true,
              data: await buildInlineFallbackFile(pdfBlob, documentHtml),
              warning: uploadErrorMessage
            };
          }
        }
      } catch (uploadError: any) {
        uploadErrorMessage = uploadError?.message || String(uploadError);
        if (uploadError?.code === 'PATIENT_FILE_STORAGE_QUOTA_EXCEEDED') {
          uploadResult = {
            success: false,
            code: uploadError.code,
            error: uploadErrorMessage,
            storageUsage: uploadError?.storageUsage
          };
        } else if (generatedPdfBlob) {
          uploadResult = {
            success: true,
            data: await buildInlineFallbackFile(generatedPdfBlob, pendingAnamnesisPayload),
            warning: uploadErrorMessage
          };
        }
      }

      try {
        const submissionResult = await dataService.savePatientAnamnesisSubmission(String(patient.id), {
          title: normalizedName,
          referenceDate: anamnesisFileDate,
          anamnesisData: pendingAnamnesisData || patient?.anamnesisData || {},
          templateVersion: Number(anamnesisTemplate?.version || 1),
          profileType: (pendingAnamnesisData?.formType || patient?.anamnesisData?.formType) === 'child' ? 'child' : 'adult',
          patientFileId: String(uploadResult?.data?.id || '')
        });
        if (submissionResult?.success === false && !submissionResult?.warning) {
          throw new Error(submissionResult?.error || 'Falha ao registrar a submissão da anamnese.');
        }
        if (uploadResult?.success && uploadResult?.data) {
          const savedFile = normalizeFileRecord(uploadResult.data);
          setPatientFiles((prev) => [savedFile, ...prev]);
          syncPatientFileStorageUsage(uploadResult?.storageUsage, savedFile.sizeBytes || 0);
        } else if (uploadResult?.storageUsage) {
          syncPatientFileStorageUsage(uploadResult.storageUsage);
        }
        const anamnesisFileSaved = Boolean(uploadResult?.success && uploadResult?.data);
        const anamnesisFileBlockedByQuota = uploadResult?.code === 'PATIENT_FILE_STORAGE_QUOTA_EXCEEDED';
        await onAddActivityLog(
          'Ficha de Anamnese Salva',
          anamnesisFileSaved
            ? `Ficha de anamnese de ${patient?.name || 'paciente'} salva em Arquivos${anamnesisFileDate ? ` com referência em ${new Date(`${anamnesisFileDate}T00:00:00`).toLocaleDateString('pt-BR')}` : ''}.`
            : anamnesisFileBlockedByQuota
              ? `Ficha de anamnese de ${patient?.name || 'paciente'} salva no prontuário; o arquivo não foi anexado ao Drive por limite de armazenamento.`
              : `Ficha de anamnese de ${patient?.name || 'paciente'} salva no prontuário; o arquivo não pôde ser anexado ao Drive.`,
          'clinical'
        );
        setShowAnamnesisFileModal(false);
        setPendingAnamnesisPayload("");
        setPendingAnamnesisData(null);
        setIsPreparingAnamnesisSave(false);
        setActiveTab(uploadResult?.success ? "files" : "history");
        if (uploadErrorMessage && !uploadResult?.success) {
          alert(
            uploadResult?.code === 'PATIENT_FILE_STORAGE_QUOTA_EXCEEDED'
              ? `${uploadErrorMessage} A anamnese foi salva no prontuário, mas o arquivo não foi anexado ao Drive.`
              : 'Anamnese salva no banco de dados. Falha apenas no arquivo em Arquivos; você pode tentar novamente depois.'
          );
        }
      } catch (error) {
        console.error('Falha ao persistir ficha de anamnese em arquivos:', error);
        alert('A ficha não foi perdida: os dados principais da anamnese foram mantidos. Tente salvar o arquivo novamente.');
      } finally {
        setIsSavingAnamnesisFile(false);
      }
    };

    void persist();
  };

  const handleDownloadPatientFile = async (file: any) => {
    const patientId = String(patient?.id || '').trim();
    const fileId = String(file?.id || '').trim();
    let resolvedFile = file;
    if (patientId && fileId) {
      const accessResult = await dataService.accessPatientFile(patientId, fileId, 'download');
      if (!accessResult?.success || !accessResult?.data) {
        alert(accessResult?.error || 'Não foi possível baixar este arquivo com auditoria.');
        return;
      }
      resolvedFile = normalizeFileRecord(accessResult.data);
    }

    const content = typeof resolvedFile?.content === 'string' ? resolvedFile.content : '';
    if (content.startsWith('data:application/pdf')) {
      const href = createObjectUrlFromDataUrl(content, 'application/pdf');
      const a = document.createElement("a");
      a.href = href;
      a.download = resolvedFile.name || "arquivo.pdf";
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

    if (resolvedFile?.source === "anamnesis" && resolvedFile?.content) {
      openPrintWindowForPdf(resolvedFile.content);
      return;
    }

    const href = resolvedFile.objectUrl || resolvedFile.url;
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      a.download = resolvedFile.name || "arquivo";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    if (content) {
      const blob = new Blob([content], { type: resolvedFile.type || "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = resolvedFile.name || "arquivo.json";
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
              `- ${task.taskTitle} | ${task.eventDate.toLocaleDateString('pt-BR')} | energia ${task.patientEffort}% | nota ${task.professionalScore ?? '-'} / ${task.maxScore} (${normalizeScoreToPercent(task.professionalScore ?? 0, task.maxScore).toFixed(1)}%) | ${task.evolutionNote || 'Sem anotação'}`
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

      const savedReportFile = normalizeFileRecord(uploadResult.data);
      setPatientFiles((prev) => [savedReportFile, ...prev]);
      syncPatientFileStorageUsage(uploadResult?.storageUsage, savedReportFile.sizeBytes || pdfBlob.size || 0);
      onAddActivityLog?.(
        'Relatório adulto gerado',
        `Relatório de evolução adulto de ${patient?.name || 'paciente'} gerado e salvo em Arquivos.`,
        'clinical'
      );
      alert('Relatório de evolução adulto gerado e salvo em Arquivos.');
    } catch (error: any) {
      console.error('Falha ao gerar relatório adulto:', error);
      const message = String(error?.message || error || '').trim();
      alert(message.includes('1 GB') ? message : 'Não foi possível gerar o relatório adulto agora.');
    } finally {
      setIsGeneratingAdultReport(false);
    }
  };

  const readPeiMasteryValue = (row: any, ...keys: string[]) => {
    for (const key of keys) {
      if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') return row[key];
    }
    return undefined;
  };

  const buildProtocolSkillMasteryCriteria = (skill: any, source = 'protocol') => {
    const embedded = skill?.mastery_criteria && typeof skill.mastery_criteria === 'object'
      ? skill.mastery_criteria
      : skill?.masteryCriteria && typeof skill.masteryCriteria === 'object'
        ? skill.masteryCriteria
        : {};
    const directTarget = readPeiMasteryValue(
      skill,
      'meta_sucessos',
      'metaSucessos',
      'masteryTarget',
      'mastery_target'
    );
    const explicitIndependentTarget = readPeiMasteryValue(
      embedded,
      'required_independent_correct_trials',
      'requiredIndependentCorrectTrials',
      'min_independent_correct_trials',
      'minIndependentCorrectTrials'
    );
    const explicitConsecutiveTarget = readPeiMasteryValue(
      embedded,
      'required_consecutive_independent_correct_trials',
      'requiredConsecutiveIndependentCorrectTrials',
      'min_consecutive_independent_correct_trials',
      'minConsecutiveIndependentCorrectTrials',
      'min_consecutive_successes',
      'minConsecutiveSuccesses'
    );
    const consecutiveTarget = explicitConsecutiveTarget ?? (explicitIndependentTarget === undefined ? directTarget : undefined);
    const raw = {
      ...embedded,
      required_independent_correct_trials: explicitIndependentTarget,
      required_consecutive_independent_correct_trials: consecutiveTarget,
      mastery_criterion_mode: consecutiveTarget !== undefined ? 'consecutive_independent' : embedded.mastery_criterion_mode ?? embedded.masteryCriterionMode,
      requires_consecutive_successes: consecutiveTarget !== undefined ? true : embedded.requires_consecutive_successes ?? embedded.requiresConsecutiveSuccesses,
      source,
      sourceLabel: source === 'protocol' ? 'Criterio herdado do protocolo' : 'Criterio da habilidade',
      is_active: true
    };
    const normalized = normalizeAbaMasteryCriterion(raw);
    return normalized ? raw : null;
  };

  const resolvePeiGoalMasteryCriterion = (goal: any) => {
    const embedded = goal?.mastery_criteria && typeof goal.mastery_criteria === 'object'
      ? goal.mastery_criteria
      : goal?.masteryCriteria && typeof goal.masteryCriteria === 'object'
        ? goal.masteryCriteria
        : null;
    const embeddedCriterion = normalizeAbaMasteryCriterion(embedded);
    if (embeddedCriterion) return embeddedCriterion;

    const directTarget = readPeiMasteryValue(goal, 'meta_sucessos', 'metaSucessos', 'masteryTarget', 'mastery_target');
    if (directTarget !== undefined) {
      const criterion = normalizeAbaMasteryCriterion({
        type: 'consecutive_independent_correct_count',
        mastery_criterion_mode: 'consecutive_independent',
        required_consecutive_independent_correct_trials: directTarget,
        requires_consecutive_successes: true,
        source: 'skill',
        sourceLabel: 'Criterio da habilidade',
        is_active: true
      });
      if (criterion) return criterion;
    }

    const catalogs = [planProtocolCatalog, protocols].filter(Array.isArray);
    for (const catalog of catalogs) {
      for (const protocol of catalog as any[]) {
        for (const domain of protocol?.data || []) {
          const skill = (domain?.skills || []).find((s: any) =>
            String(s?.id) === String(goal?.skillId) ||
            String(s?.name || '').trim().toLowerCase() === String(goal?.name || '').trim().toLowerCase()
          );
          const protocolCriterion = normalizeAbaMasteryCriterion(buildProtocolSkillMasteryCriteria(skill, 'protocol'));
          if (protocolCriterion) return protocolCriterion;
        }
      }
    }

    return null;
  };

  const getGoalMasteryTarget = (goal: any) => {
    const criterion = resolvePeiGoalMasteryCriterion(goal);
    return criterion?.requiredConsecutiveIndependentCorrectTrials || criterion?.requiredIndependentCorrectTrials || criterion?.requiredCorrectTrials || null;
  };

  const getGoalProgressResetMarker = (goal: any) => {
    return getPeiProgressResetMarker(goal);
  };

  const getHistoryProgressMarker = (entry: any) => {
    return getPeiHistoryProgressMarker(entry);
  };

  const normalizePeiEvidenceKey = (value: any) => String(value ?? '').trim();
  const normalizePeiEvidenceName = (value: any) =>
    String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const uniquePeiEvidenceValues = (values: any[]) =>
    values
      .map(normalizePeiEvidenceKey)
      .filter((value: string, index: number, list: string[]) => Boolean(value) && list.indexOf(value) === index);
  const readTeachingEvidencePayload = (...values: any[]) => {
    const merged: Record<string, any> = {};
    values.forEach((value: any) => {
      if (!value) return;
      if (typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(merged, value);
        return;
      }
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(merged, parsed);
        } catch {
          // Payloads antigos podem vir como texto livre; nesse caso não participam do casamento por ID.
        }
      }
    });
    return merged;
  };
  const getGoalTargetEvidenceIds = (goal: any) => uniquePeiEvidenceValues([
    goal?.target_id,
    goal?.targetId,
    goal?.aba_target_id,
    goal?.abaTargetId,
    goal?.target?.id,
    goal?.target?.target_id,
    goal?.target?.targetId
  ]);
  const getGoalClinicalEvidenceIds = (goal: any) => uniquePeiEvidenceValues([
    goal?.peiGoalId,
    goal?.pei_goal_id,
    goal?.goalId,
    goal?.goal_id,
    goal?.id,
    goal?.skillId,
    goal?.skill_id,
    goal?.localTargetRef,
    goal?.local_target_ref,
    goal?.target?.peiGoalId,
    goal?.target?.goalId,
    goal?.target?.goal_id,
    goal?.target?.skillId,
    goal?.target?.skill_id,
    goal?.target?.localTargetRef
  ]);
  const rowClinicalEvidenceIds = (row: any) => {
    const raw = readTeachingEvidencePayload(row?.raw_payload, row?.rawPayload, row?.criteria, row?.mastery_criteria, row?.masteryCriteria);
    return uniquePeiEvidenceValues([
      row?.peiGoalId,
      row?.pei_goal_id,
      row?.goalId,
      row?.goal_id,
      row?.skillId,
      row?.skill_id,
      row?.localTargetRef,
      row?.local_target_ref,
      raw?.peiGoalId,
      raw?.pei_goal_id,
      raw?.goalId,
      raw?.goal_id,
      raw?.skillId,
      raw?.skill_id,
      raw?.localTargetRef,
      raw?.local_target_ref
    ]);
  };
  const scheduleClinicalEvidenceIds = (schedule: any) => {
    const raw = readTeachingEvidencePayload(schedule?.raw_payload, schedule?.rawPayload, schedule?.mastery_criteria, schedule?.masteryCriteria);
    return uniquePeiEvidenceValues([
      schedule?.peiGoalId,
      schedule?.pei_goal_id,
      schedule?.goalId,
      schedule?.goal_id,
      schedule?.skillId,
      schedule?.skill_id,
      schedule?.localTargetRef,
      schedule?.local_target_ref,
      raw?.peiGoalId,
      raw?.pei_goal_id,
      raw?.goalId,
      raw?.goal_id,
      raw?.skillId,
      raw?.skill_id,
      raw?.localTargetRef,
      raw?.local_target_ref
    ]);
  };
  const rowMatchesGoalEvidence = (row: any, goal: any, options: { allowNameFallback?: boolean } = {}) => {
    const goalTargetIds = getGoalTargetEvidenceIds(goal);
    const rowTargetIds = uniquePeiEvidenceValues([
      row?.target_id,
      row?.targetId,
      row?.aba_target_id,
      row?.abaTargetId
    ]);
    if (goalTargetIds.length > 0 && rowTargetIds.some((id: string) => goalTargetIds.includes(id))) return true;

    const goalClinicalIds = getGoalClinicalEvidenceIds(goal);
    const clinicalIds = rowClinicalEvidenceIds(row);
    if (goalClinicalIds.length > 0 && clinicalIds.some((id: string) => goalClinicalIds.includes(id))) return true;

    if (!options.allowNameFallback) return false;
    const goalName = normalizePeiEvidenceName(goal?.name || goal?.targetName || goal?.target_name);
    const rowName = normalizePeiEvidenceName(row?.target_name || row?.targetName || row?.title || row?.name);
    return Boolean(goalName && rowName && goalName === rowName);
  };
  const scheduleMatchesGoalEvidence = (schedule: any, goal: any) => {
    const goalTargetIds = getGoalTargetEvidenceIds(goal);
    const scheduleTargetId = normalizePeiEvidenceKey(schedule?.target_id || schedule?.targetId || schedule?.target?.id);
    if (scheduleTargetId && goalTargetIds.includes(scheduleTargetId)) return true;

    const goalClinicalIds = getGoalClinicalEvidenceIds(goal);
    const clinicalIds = scheduleClinicalEvidenceIds(schedule);
    return goalClinicalIds.length > 0 && clinicalIds.some((id: string) => goalClinicalIds.includes(id));
  };
  const isStructuredTrialIndependentCorrect = (trial: any) => {
    const correct = typeof trial?.correct === 'boolean'
      ? trial.correct
      : Number(trial?.response_score ?? trial?.score ?? 0) >= Number(trial?.max_score ?? trial?.maxScore ?? 1);
    const promptKey = String(trial?.prompt_level_key || trial?.promptLevelKey || trial?.promptLevel || '').trim().toLowerCase();
    const independent = typeof trial?.independent === 'boolean'
      ? trial.independent
      : ['independent', 'independente', 'no_prompt', 'sem_ajuda', 'none'].includes(promptKey) || !promptKey;
    return Boolean(correct && independent);
  };
  const getStructuredTrialProgressMarker = (trial: any) => {
    const value = trial?.occurred_at || trial?.occurredAt || trial?.timestamp || trial?.created_at || trial?.createdAt;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const getStructuredAbaTrialProgress = (goal: any, mode: 'consecutive' | 'total', target: number, resetMarker: number) => {
    const trials = (Array.isArray(abaTrials) ? abaTrials : [])
      .filter((trial: any) =>
        String(trial?.patient_id || trial?.patientId || '') === String(patient?.id || '') &&
        !isTherapeuticProgramMeasurementTrial(trial) &&
        String(trial?.collection_type || trial?.collectionType || trial?.trialType || '').toLowerCase() !== 'maintenance_probe' &&
        rowMatchesGoalEvidence(trial, goal, { allowNameFallback: true }) &&
        (!goal || getStructuredTrialProgressMarker(trial) > resetMarker || !resetMarker)
      )
      .sort((a: any, b: any) => getStructuredTrialProgressMarker(b) - getStructuredTrialProgressMarker(a));

    if (mode === 'total') {
      return Math.min(trials.filter(isStructuredTrialIndependentCorrect).length, target);
    }

    let count = 0;
    for (const trial of trials) {
      if (isStructuredTrialIndependentCorrect(trial)) count += 1;
      else break;
    }
    return Math.min(count, target);
  };
  const getPersistedAbaMasteryProgress = (goal: any, target: number) => {
    const evaluations = (Array.isArray(abaMasteryEvaluations) ? abaMasteryEvaluations : [])
      .filter((evaluation: any) =>
        rowMatchesGoalEvidence(evaluation, goal, { allowNameFallback: true }) &&
        isPeiClinicalRowAfterProgressReset(goal, evaluation)
      )
      .sort((a: any, b: any) => {
        const aTime = new Date(a?.evaluated_at || a?.evaluatedAt || a?.created_at || a?.createdAt || 0).getTime();
        const bTime = new Date(b?.evaluated_at || b?.evaluatedAt || b?.created_at || b?.createdAt || 0).getTime();
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      });
    const latest = evaluations[0];
    if (!latest) return 0;
    const status = String(latest?.status || latest?.statusCode || latest?.evaluation_status || latest?.evaluationStatus || '').trim().toUpperCase();
    const progressCount = Number(latest?.criterionProgressCount ?? latest?.criterion_progress_count ?? latest?.consecutive_successes ?? latest?.consecutiveSuccesses ?? 0);
    const requiredCount = Number(latest?.criterionRequiredCount ?? latest?.criterion_required_count ?? latest?.min_consecutive_successes ?? latest?.minConsecutiveSuccesses ?? target);
    if (['MET_TODAY', 'READY_FOR_REVIEW', 'MASTERED', 'MASTERED_APPROVED', 'ADQUIRIDO', 'ACQUIRED'].includes(status)) return target;
    if (Number.isFinite(progressCount) && progressCount >= Math.min(target, Number.isFinite(requiredCount) && requiredCount > 0 ? requiredCount : target)) return target;
    return Number.isFinite(progressCount) ? Math.min(progressCount, target) : 0;
  };
  const hasPersistedGoalMasteryEvidence = (goal: any) => {
    const matchingSchedule = (Array.isArray(abaMaintenanceOverview?.schedules) ? abaMaintenanceOverview.schedules : []).find((schedule: any) =>
      isActivePeiMaintenanceScheduleRow({
        ...schedule,
        schedule,
        scheduleId: schedule?.id || schedule?.schedule_id || schedule?.scheduleId,
        targetId: schedule?.target_id || schedule?.targetId
      }) &&
      scheduleMatchesGoalEvidence(schedule, goal) &&
      isPeiClinicalRowAfterProgressReset(goal, schedule)
    );
    if (matchingSchedule) return true;

    const criterion = resolvePeiGoalMasteryCriterion(goal);
    const target = criterion?.requiredConsecutiveIndependentCorrectTrials || criterion?.requiredIndependentCorrectTrials || criterion?.requiredCorrectTrials || null;
    if (!target) return false;
    return getPersistedAbaMasteryProgress(goal, target) >= target;
  };

  const getMasteryProgress = (goalOrName: any, mode: 'consecutive' | 'total' = 'consecutive') => {
    if (patientCategory !== 'Criança') return null;
    const goal = typeof goalOrName === 'string'
      ? sessionModePatient?.pei?.find((g: any) => g.name === goalOrName)
      : goalOrName;
    const skillName = typeof goalOrName === 'string' ? goalOrName : goalOrName?.name;
    const target = getGoalMasteryTarget(goal);
    if (!target) return 0;
    if (goal && hasPersistedGoalMasteryEvidence(goal)) return target;
    const resetMarker = getGoalProgressResetMarker(goal);
    const skillHistory = history
      .filter((h: any) =>
        String(h.patientId ?? h.patient_id ?? '') === String(patient.id) &&
        h.title === skillName &&
        h.type === 'task' &&
        String(h.collection_type || h.collectionType || h.trialType || '').toLowerCase() !== 'maintenance_probe' &&
        (!goal || getHistoryProgressMarker(h) > resetMarker)
      )
      .sort((a: any, b: any) => getHistoryProgressMarker(b) - getHistoryProgressMarker(a));

    if (mode === 'total') {
      const legacyTotal = Math.min(skillHistory.filter((h: any) => h.score === 1).length, target);
      const structuredTotal = goal ? getStructuredAbaTrialProgress(goal, mode, target, resetMarker) : 0;
      const persistedTotal = goal ? getPersistedAbaMasteryProgress(goal, target) : 0;
      return Math.min(Math.max(legacyTotal, structuredTotal, persistedTotal), target);
    }
    
    let count = 0;
    for (const h of skillHistory) {
      if (h.score === 1) count++;
      else break;
    }
    const legacyProgress = Math.min(count, target);
    const structuredProgress = goal ? getStructuredAbaTrialProgress(goal, mode, target, resetMarker) : 0;
    const persistedProgress = goal ? getPersistedAbaMasteryProgress(goal, target) : 0;
    return Math.min(Math.max(legacyProgress, structuredProgress, persistedProgress), target);
  };

  const getGoalComputedProgressPercent = (goal: any) => {
    const storedProgress = Number(
      goal?.progress ??
        goal?.progressPercent ??
        goal?.progress_percent ??
        goal?.masteryProgressPercent ??
        goal?.mastery_progress_percent
    );
    const normalizedStoredProgress = Number.isFinite(storedProgress)
      ? Math.min(Math.max(Math.round(storedProgress), 0), 100)
      : 0;
    if (patientCategory !== 'Criança') {
      return normalizedStoredProgress;
    }
    if (hasPersistedGoalMasteryEvidence(goal)) return 100;

    const criterion = resolvePeiGoalMasteryCriterion(goal);
    const target = criterion?.requiredConsecutiveIndependentCorrectTrials || criterion?.requiredIndependentCorrectTrials || criterion?.requiredCorrectTrials || null;
    if (!target) return normalizedStoredProgress;
    const progressCount = getMasteryProgress(goal, criterion?.requiredIndependentCorrectTrials && !criterion?.requiredConsecutiveIndependentCorrectTrials ? 'total' : 'consecutive') || 0;
    const masteryProgress = Math.min(Math.round((progressCount / target) * 100), 100);
    return Math.max(normalizedStoredProgress, masteryProgress);
  };

  const isGoalAcquired = (goal: any) =>
    isPeiMaintenanceEligibleSkill({
      ...goal,
      progressPercent: getGoalComputedProgressPercent(goal)
    });

  const getGoalProgressPercent = (goal: any) => {
    if (isGoalAcquired(goal)) return 100;
    return getGoalComputedProgressPercent(goal);
  };

  const MasteryDots = ({ count, status, target }: { count: number, status?: string, target?: number | null }) => {
    const safeTarget = Math.floor(Number(target) || 0);
    if (safeTarget <= 0) return null;
    const dots = Array.from({ length: safeTarget }, (_, index) => index + 1);
    const dotSize = safeTarget > 30 ? 'w-1 h-1' : safeTarget > 12 ? 'w-1.5 h-1.5' : 'w-2 h-2';
    if (status === 'completed') {
      return (
        <div className="flex flex-wrap gap-1 items-center max-w-[220px]">
          {dots.map((i) => (
            <div key={i} className={`${dotSize} rounded-full bg-green-500 shadow-sm shadow-green-200`}></div>
          ))}
          <CheckCircle2 size={12} className="text-green-500 ml-1" />
        </div>
      );
    }
    return (
        <div className="flex flex-wrap gap-1 items-center max-w-[220px]">
          {dots.map((i) => (
            <div key={i} className={`${dotSize} rounded-full transition-all ${i <= count ? 'bg-[#7a32fc] scale-110 shadow-sm shadow-blue-200' : 'bg-gray-200 dark:bg-slate-600'}`}></div>
          ))}
        <span className="text-[9px] font-semibold text-gray-400 dark:text-slate-300 ml-1 uppercase">{count}/{safeTarget}</span>
      </div>
    );
  };

  const resolvePeiGoalMasteryDisplay = (goal: any) => {
    const criterion = resolvePeiGoalMasteryCriterion(goal);
    if (!criterion) {
      return {
        criterion: null,
        label: 'Criterio de maestria nao configurado',
        sourceLabel: 'Criterio de maestria nao configurado',
        progressLabel: 'Critério não configurado',
        requiredCount: 0
      };
    }
    const requiredConsecutive = criterion.requiredConsecutiveIndependentCorrectTrials || null;
    const requiredIndependent = criterion.requiredIndependentCorrectTrials || null;
    const requiredCorrect = criterion.requiredCorrectTrials || null;
    const progress = getMasteryProgress(goal, requiredIndependent && !requiredConsecutive ? 'total' : 'consecutive') || 0;
    const requiredCount = requiredConsecutive || requiredIndependent || requiredCorrect || criterion.minConsecutiveDays || 0;
    const progressLabel = requiredConsecutive
      ? `Sequencia: ${progress}/${requiredConsecutive} acertos independentes consecutivos`
      : requiredIndependent
      ? `${progress}/${requiredIndependent} acertos independentes`
      : requiredCorrect
        ? `${progress}/${requiredCorrect} acertos`
        : `${progress}/${criterion.minConsecutiveDays} dias consecutivos`;
    return {
      criterion,
      label: formatAbaMasteryCriterion(criterion),
      sourceLabel: abaMasteryCriterionSourceLabel(criterion),
      progressLabel,
      requiredCount
    };
  };

  const peiGoals = useMemo(() => (Array.isArray(sessionModePatient?.pei) ? sessionModePatient.pei : []), [sessionModePatient?.pei]);
  const peiAcquiredTeachingGoals = useMemo(
    () => buildPeiMaintenanceEligibleSkills(
      peiGoals.map((goal: any) => ({
        ...goal,
        progressPercent: getGoalProgressPercent(goal),
        statusLabel: isGoalAcquired(goal) ? 'Adquirido' : goal?.status
      }))
    ),
    [abaMaintenanceOverview, abaMasteryEvaluations, abaTrials, history, patient?.id, patientCategory, peiGoals, planProtocolCatalog, protocols]
  );
  const peiMaintenanceLinkableTargets = useMemo(
    () => (Array.isArray(peiMaintenanceLinkableTargetsState.items) ? peiMaintenanceLinkableTargetsState.items : []),
    [peiMaintenanceLinkableTargetsState.items]
  );
  const normalizePeiMaintenanceMatchKey = (value: any) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .toLowerCase();
  const getPeiMaintenancePersistedId = (value: any) => {
    const id = String(value || '').trim();
    return isUuidLike(id) ? id : '';
  };
  const getPeiMaintenanceMatchName = (target: any) =>
    safeDisplayValue(
      target?.name ||
        target?.target_name ||
        target?.targetName ||
        target?.title ||
        target?.skill_name ||
        target?.skillName ||
        target?.objective ||
        target?.description ||
        target?.source?.name ||
        target?.source?.target_name ||
        target?.source?.targetName ||
        target?.source?.title ||
        target?.source?.skill_name ||
        target?.source?.skillName ||
        target?.source?.objective ||
        target?.source?.description ||
        target?.goal?.name ||
        target?.goal?.target_name ||
        target?.goal?.targetName ||
        target?.goal?.title ||
        target?.goal?.skill_name ||
        target?.goal?.skillName ||
        target?.goal?.objective ||
        target?.goal?.description ||
        target?.target?.name ||
        target?.target?.target_name ||
        target?.target?.targetName ||
        target?.target?.title ||
        target?.target?.skill_name ||
        target?.target?.skillName ||
        target?.target?.objective ||
        target?.target?.description ||
        target?.nextSchedule?.target_name ||
        target?.nextSchedule?.targetName ||
        target?.nextSchedule?.name ||
        target?.activeSchedule?.target_name ||
        target?.activeSchedule?.targetName ||
        target?.activeSchedule?.name ||
        target?.schedule?.target_name ||
        target?.schedule?.targetName ||
        target?.schedule?.name,
      ''
    );
  const getPeiMaintenanceProtocolName = (target: any) =>
    safeDisplayValue(
      target?.protocol_title ||
        target?.protocolTitle ||
        target?.protocolName ||
        target?.protocol_name ||
        target?.protocol?.name ||
        (typeof target?.protocol === 'string' ? target.protocol : '') ||
        target?.source?.protocol_title ||
        target?.source?.protocolTitle ||
        target?.source?.protocolName ||
        target?.source?.protocol_name ||
        target?.source?.protocol?.name ||
        (typeof target?.source?.protocol === 'string' ? target.source.protocol : '') ||
        target?.goal?.protocol_title ||
        target?.goal?.protocolTitle ||
        target?.goal?.protocolName ||
        target?.goal?.protocol_name ||
        target?.goal?.protocol?.name ||
        (typeof target?.goal?.protocol === 'string' ? target.goal.protocol : '') ||
        target?.target?.protocol_title ||
        target?.target?.protocolTitle ||
        target?.target?.protocolName ||
        target?.target?.protocol_name ||
        target?.target?.protocol?.name ||
        (typeof target?.target?.protocol === 'string' ? target.target.protocol : '') ||
        target?.nextSchedule?.protocol_title ||
        target?.nextSchedule?.protocolTitle ||
        target?.nextSchedule?.protocolName ||
        target?.nextSchedule?.protocol_name ||
        target?.activeSchedule?.protocol_title ||
        target?.activeSchedule?.protocolTitle ||
        target?.activeSchedule?.protocolName ||
        target?.activeSchedule?.protocol_name ||
        target?.schedule?.protocol_title ||
        target?.schedule?.protocolTitle ||
        target?.schedule?.protocolName ||
        target?.schedule?.protocol_name,
      ''
    );
  const getPeiMaintenanceDomainName = (target: any) =>
    safeDisplayValue(
      target?.domain_name ||
        target?.domainName ||
        target?.program_name ||
        target?.programName ||
        target?.domain?.name ||
        (typeof target?.domain === 'string' ? target.domain : '') ||
        target?.source?.domain_name ||
        target?.source?.domainName ||
        target?.source?.program_name ||
        target?.source?.programName ||
        target?.source?.domain?.name ||
        (typeof target?.source?.domain === 'string' ? target.source.domain : '') ||
        target?.goal?.domain_name ||
        target?.goal?.domainName ||
        target?.goal?.program_name ||
        target?.goal?.programName ||
        target?.goal?.domain?.name ||
        (typeof target?.goal?.domain === 'string' ? target.goal.domain : '') ||
        target?.target?.domain_name ||
        target?.target?.domainName ||
        target?.target?.program_name ||
        target?.target?.programName ||
        target?.target?.domain?.name ||
        target?.target?.program?.name ||
        (typeof target?.target?.domain === 'string' ? target.target.domain : '') ||
        target?.nextSchedule?.domain_name ||
        target?.nextSchedule?.domainName ||
        target?.nextSchedule?.program_name ||
        target?.nextSchedule?.programName ||
        target?.activeSchedule?.domain_name ||
        target?.activeSchedule?.domainName ||
        target?.activeSchedule?.program_name ||
        target?.activeSchedule?.programName ||
        target?.schedule?.domain_name ||
        target?.schedule?.domainName ||
        target?.schedule?.program_name ||
        target?.schedule?.programName,
      ''
    );
  const getPeiMaintenanceRowTargetId = (row: any) =>
    getPeiMaintenancePersistedId(row?.targetId || row?.target_id || row?.aba_target_id || row?.abaTargetId);
  const getPeiMaintenanceRowScheduleId = (row: any) => getPersistedMaintenanceScheduleId(
    row?.scheduleId ||
      row?.schedule_id ||
      row?.nextSchedule?.id ||
      row?.nextSchedule?.schedule_id ||
      row?.nextSchedule?.scheduleId ||
      row?.activeSchedule?.id ||
      row?.activeSchedule?.schedule_id ||
      row?.activeSchedule?.scheduleId ||
      row?.schedule?.id ||
      row?.schedule?.schedule_id ||
      row?.schedule?.scheduleId,
    row?.nextSchedule || row?.activeSchedule || row?.schedule || row
  );
  const getPeiMaintenanceDedupKey = (row: any) => {
    const scheduleId = getPeiMaintenanceRowScheduleId(row);
    if (scheduleId) return `schedule:${scheduleId}`;
    const targetId = getPeiMaintenanceRowTargetId(row);
    if (targetId) return `target:${targetId}`;
    return getPeiMaintenanceDisplayKey(row) || '';
  };
  const dedupePeiMaintenanceRows = (rows: any[]) => {
    const byKey = new Map<string, any>();
    (Array.isArray(rows) ? rows : []).filter(Boolean).forEach((row: any, index: number) => {
      const key = getPeiMaintenanceDedupKey(row) || `row:${index}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, row);
        return;
      }
      const existingHasSchedule = Boolean(getPeiMaintenanceRowScheduleId(existing) || existing?.hasRealSchedule);
      const rowHasSchedule = Boolean(getPeiMaintenanceRowScheduleId(row) || row?.hasRealSchedule);
      const existingHasTarget = Boolean(getPeiMaintenanceRowTargetId(existing));
      const rowHasTarget = Boolean(getPeiMaintenanceRowTargetId(row));
      if ((!existingHasSchedule && rowHasSchedule) || (!existingHasTarget && rowHasTarget)) {
        byKey.set(key, row);
      }
    });
    return Array.from(byKey.values());
  };
  const getPeiMaintenanceScheduleStatusKey = (row: any) =>
    String(getPeiMaintenanceScheduleObject(row)?.status || row?.nextProbe?.status || row?.status || '').trim().toUpperCase();
  const isPeiMaintenanceLinklessScheduleRow = (row: any) => {
    if (!isActivePeiMaintenanceScheduleRow(row)) return false;
    const status = getPeiMaintenanceScheduleStatusKey(row);
    return ['PENDING_NEXT_SESSION', 'PENDING_LINK', 'PENDING_SCHEDULING', 'UNSCHEDULED', 'PENDING'].includes(status) || row?.group === 'unlinked';
  };
  const isPeiMaintenanceScheduledScheduleRow = (row: any) => {
    if (!isActivePeiMaintenanceScheduleRow(row)) return false;
    if (row?.needsTargetReview || row?.isRegressionRisk || row?.group === 'completed') return false;
    return !isPeiMaintenanceLinklessScheduleRow(row);
  };

  const peiMaintenanceHydratedGoals = useMemo(() => (
    peiGoals.map((goal: any) => {
      const currentId = getPeiMaintenancePersistedId(goal?.target_id || goal?.targetId || goal?.aba_target_id || goal?.abaTargetId);
      return currentId ? { ...goal, target_id: currentId, targetId: currentId } : goal;
    })
  ), [peiGoals]);

  const canManagePeiMaintenance = useMemo(() => {
    const role = String(userRole || resolvedClinicContext?.role || clinicContext?.role || '').toLowerCase();
    return isKidsProfile && abaV2Enabled && !['patient', 'paciente', 'responsavel', 'responsável', 'guardian', 'family'].includes(role);
  }, [abaV2Enabled, clinicContext?.role, isKidsProfile, resolvedClinicContext?.role, userRole]);

  const peiMaintenanceRows = useMemo(() => buildPeiMaintenanceRows({
    goals: [...peiMaintenanceHydratedGoals, ...peiMaintenanceLinkableTargets],
    schedules: abaMaintenanceOverview?.schedules || [],
    probeResults: abaMaintenanceOverview?.probeResults || [],
    alerts: abaMaintenanceOverview?.alerts || []
  }), [peiMaintenanceHydratedGoals, peiMaintenanceLinkableTargets, abaMaintenanceOverview]);

  const hasPeiMaintenancePanelForCurrentPatient = useMemo(() => (
    Boolean(
      abaMaintenancePanel?.source === 'maintenance-panel-target-first' &&
      String(abaMaintenancePanel?.loadedFor || '') === String(patient?.id || '') &&
      abaMaintenancePanel?.sections
    )
  ), [abaMaintenancePanel, patient?.id]);

  const peiMaintenanceTargetFirstGroups = useMemo(
    () => {
      if (!hasPeiMaintenancePanelForCurrentPatient) return createEmptyPeiMaintenanceTargetFirstSections();
      return {
        ...createEmptyPeiMaintenanceTargetFirstSections(),
        ...(abaMaintenancePanel.sections || {})
      };
    },
    [abaMaintenancePanel, hasPeiMaintenancePanelForCurrentPatient]
  );

  const peiMaintenanceTargetFirstSummary = useMemo(() => ({
    maintenanceSkills: peiMaintenanceTargetFirstGroups.maintenanceSkills.length,
    eligibleSkills: peiMaintenanceTargetFirstGroups.eligibleSkills.length,
    scheduled: peiMaintenanceTargetFirstGroups.scheduled.length,
    waitingNextSession: peiMaintenanceTargetFirstGroups.waitingNextSession.length,
    overdue: peiMaintenanceTargetFirstGroups.overdue.length,
    regressionRisk: peiMaintenanceTargetFirstGroups.regressionRisk.length,
    technical: peiMaintenanceTargetFirstGroups.technical.length
  }), [peiMaintenanceTargetFirstGroups]);

  const peiMaintenanceClinicalBadgeCount = useMemo(() => (
    peiMaintenanceTargetFirstSummary.maintenanceSkills +
    peiMaintenanceTargetFirstSummary.eligibleSkills +
    peiMaintenanceTargetFirstSummary.scheduled +
    peiMaintenanceTargetFirstSummary.waitingNextSession +
    peiMaintenanceTargetFirstSummary.overdue +
    peiMaintenanceTargetFirstSummary.regressionRisk
  ), [peiMaintenanceTargetFirstSummary]);

  const shouldShowPeiMaintenancePanelLoading = isLoadingPeiMaintenancePanel && !hasPeiMaintenancePanelForCurrentPatient;

  const getPeiMaintenanceDisplayKey = (row: any) => {
    const persistedId = getPeiMaintenancePersistedId(row?.targetId || row?.target_id || row?.aba_target_id || row?.abaTargetId);
    if (persistedId) return `target:${persistedId}`;
    const scheduleId = getPersistedMaintenanceScheduleId(
      row?.scheduleId ||
      row?.schedule_id ||
      row?.nextSchedule?.id ||
      row?.nextSchedule?.schedule_id ||
      row?.activeSchedule?.id ||
      row?.activeSchedule?.schedule_id ||
      row?.schedule?.id ||
      row?.schedule?.schedule_id,
      row?.nextSchedule || row?.activeSchedule || row?.schedule || row
    );
    if (scheduleId) return `schedule:${scheduleId}`;
    const clinicalSourceId = String(
      row?.peiGoalId ||
      row?.goalId ||
      row?.goal_id ||
      row?.source?.peiGoalId ||
      row?.source?.goalId ||
      row?.source?.goal_id ||
      row?.source?.id ||
      row?.key ||
      ''
    ).trim();
    return clinicalSourceId ? `clinical:${clinicalSourceId}` : '';
  };
  const readPeiMaintenanceObjectPayload = (...values: any[]) => {
    const merged: Record<string, any> = {};
    values.forEach((value: any) => {
      if (!value) return;
      if (typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(merged, value);
        return;
      }
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(merged, parsed);
        } catch {
          // Ignore legacy malformed payloads.
        }
      }
    });
    return merged;
  };
  const getPeiMaintenanceExplicitSourceIds = (row: any) => {
    const schedule = row?.nextSchedule || row?.activeSchedule || row?.schedule || null;
    const raw = readPeiMaintenanceObjectPayload(schedule?.raw_payload, schedule?.rawPayload, row?.raw_payload, row?.rawPayload);
    return [
      row?.peiGoalId,
      row?.goalId,
      row?.goal_id,
      row?.skillId,
      row?.skill_id,
      row?.localTargetRef,
      row?.local_target_ref,
      row?.source?.peiGoalId,
      row?.source?.goalId,
      row?.source?.goal_id,
      row?.source?.skillId,
      row?.source?.skill_id,
      row?.source?.localTargetRef,
      schedule?.peiGoalId,
      schedule?.goalId,
      schedule?.goal_id,
      schedule?.skillId,
      schedule?.skill_id,
      schedule?.localTargetRef,
      schedule?.local_target_ref,
      raw?.peiGoalId,
      raw?.pei_goal_id,
      raw?.goalId,
      raw?.goal_id,
      raw?.skillId,
      raw?.skill_id,
      raw?.localTargetRef,
      raw?.local_target_ref
    ]
      .map((value: any) => String(value ?? '').trim())
      .filter((value: string, index: number, list: string[]) => Boolean(value) && list.indexOf(value) === index);
  };
  const isPeiMaintenanceMaterializedSourceRow = (row: any) => {
    const schedule = row?.nextSchedule || row?.activeSchedule || row?.schedule || null;
    const raw = readPeiMaintenanceObjectPayload(schedule?.raw_payload, schedule?.rawPayload, row?.raw_payload, row?.rawPayload);
    const sourceLabel = String(row?.clinicalIdentitySource || schedule?.clinicalIdentitySource || raw?.clinicalIdentitySource || raw?.source || '').trim();
    return ['patient_pei_materialized', 'patient_pei_request', 'patient_pei'].includes(sourceLabel) || raw?.materializedForMaintenance === true;
  };
  const peiMaintenanceScheduledRows = useMemo(() => {
    const panelRows = [
      ...(peiMaintenanceTargetFirstGroups.scheduled || []),
      ...(peiMaintenanceTargetFirstGroups.overdue || [])
    ].filter(isPeiMaintenanceScheduledScheduleRow);
    return dedupePeiMaintenanceRows(panelRows);
  }, [peiMaintenanceTargetFirstGroups]);

  const peiMaintenanceWaitingRows = useMemo(() => {
    const panelRows = [
      ...(peiMaintenanceTargetFirstGroups.waitingNextSession || []),
      ...(peiMaintenanceTargetFirstGroups.scheduled || []),
      ...(peiMaintenanceTargetFirstGroups.overdue || [])
    ].filter((row: any) => Boolean(getPeiMaintenanceRowScheduleId(row) || row?.hasRealSchedule) && isPeiMaintenanceLinklessScheduleRow(row));
    return dedupePeiMaintenanceRows(panelRows);
  }, [peiMaintenanceTargetFirstGroups]);

  const peiMaintenanceUnavailableKeys = useMemo(() => {
    const keys = new Set<string>();
    [
      ...peiMaintenanceScheduledRows,
      ...peiMaintenanceWaitingRows,
      ...(peiMaintenanceTargetFirstGroups.regressionRisk || []),
      ...(peiMaintenanceTargetFirstGroups.maintenanceSkills || [])
    ].filter((row: any) => isActivePeiMaintenanceScheduleRow(row)).forEach((row: any) => {
      const key = getPeiMaintenanceDisplayKey(row);
      if (key) keys.add(key);
    });
    return keys;
  }, [peiMaintenanceScheduledRows, peiMaintenanceTargetFirstGroups, peiMaintenanceWaitingRows]);

  const peiMaintenanceUnavailableTargetIds = useMemo(() => {
    const targetIds = new Set<string>();
    [
      ...peiMaintenanceScheduledRows,
      ...peiMaintenanceWaitingRows,
      ...(peiMaintenanceTargetFirstGroups.regressionRisk || []),
      ...(peiMaintenanceTargetFirstGroups.maintenanceSkills || [])
    ].filter((row: any) => isActivePeiMaintenanceScheduleRow(row)).forEach((row: any) => {
      const targetId = getPeiMaintenancePersistedId(row?.targetId || row?.target_id || row?.aba_target_id || row?.abaTargetId);
      if (targetId) targetIds.add(targetId);
    });
    return targetIds;
  }, [peiMaintenanceScheduledRows, peiMaintenanceTargetFirstGroups, peiMaintenanceWaitingRows]);

  const peiMaintenanceUnavailableSourceIds = useMemo(() => {
    const sourceIds = new Set<string>();
    [
      ...peiMaintenanceScheduledRows,
      ...peiMaintenanceWaitingRows,
      ...(peiMaintenanceTargetFirstGroups.regressionRisk || []),
      ...(peiMaintenanceTargetFirstGroups.maintenanceSkills || [])
    ].filter((row: any) => isActivePeiMaintenanceScheduleRow(row) && isPeiMaintenanceMaterializedSourceRow(row)).forEach((row: any) => {
      getPeiMaintenanceExplicitSourceIds(row).forEach((sourceId: string) => sourceIds.add(sourceId));
    });
    return sourceIds;
  }, [peiMaintenanceScheduledRows, peiMaintenanceTargetFirstGroups, peiMaintenanceWaitingRows]);

  const peiMaintenanceEligibleRows = useMemo(() => {
    const filterEligibleRows = (rows: any[]) => dedupePeiMaintenanceRows(rows.filter((row: any) => {
      const key = getPeiMaintenanceDisplayKey(row);
      const targetId = getPeiMaintenancePersistedId(row?.targetId || row?.target_id || row?.aba_target_id || row?.abaTargetId);
      if (getPeiMaintenanceRowScheduleId(row) || row?.hasRealSchedule) return false;
      if (targetId && peiMaintenanceUnavailableTargetIds.has(targetId)) return false;
      if (getPeiMaintenanceExplicitSourceIds(row).some((sourceId: string) => peiMaintenanceUnavailableSourceIds.has(sourceId))) return false;
      return !key || !peiMaintenanceUnavailableKeys.has(key);
    }));

    const panelEligibleRows = Array.isArray(peiMaintenanceTargetFirstGroups.eligibleSkills)
      ? dedupePeiMaintenanceRows(peiMaintenanceTargetFirstGroups.eligibleSkills)
      : [];
    const panelHasAnyMaintenanceRows = [
      peiMaintenanceTargetFirstGroups.eligibleSkills,
      peiMaintenanceTargetFirstGroups.maintenanceSkills,
      peiMaintenanceTargetFirstGroups.scheduled,
      peiMaintenanceTargetFirstGroups.waitingNextSession,
      peiMaintenanceTargetFirstGroups.overdue,
      peiMaintenanceTargetFirstGroups.regressionRisk,
      peiMaintenanceTargetFirstGroups.technical
    ].some((rows: any) => Array.isArray(rows) && rows.length > 0);

    // Painel target-first com conteudo persistido vira a fonte de verdade.
    // Painel carregado e vazio nao pode apagar metas adquiridas que ja aparecem
    // no Ensino; nesse caso mantemos o fallback local abaixo.
    if (hasPeiMaintenancePanelForCurrentPatient && panelHasAnyMaintenanceRows) {
      debugEligibleRowsRender('panel_persistent', panelEligibleRows.length, {
        panelScheduledCount: peiMaintenanceTargetFirstGroups.scheduled?.length || 0,
        panelHasAnyRows: panelHasAnyMaintenanceRows,
        availableSections: {
          eligibleSkills: peiMaintenanceTargetFirstGroups.eligibleSkills?.length || 0,
          maintenanceSkills: peiMaintenanceTargetFirstGroups.maintenanceSkills?.length || 0,
          scheduled: peiMaintenanceTargetFirstGroups.scheduled?.length || 0,
          waitingNextSession: peiMaintenanceTargetFirstGroups.waitingNextSession?.length || 0,
          overdue: peiMaintenanceTargetFirstGroups.overdue?.length || 0,
          regressionRisk: peiMaintenanceTargetFirstGroups.regressionRisk?.length || 0,
          technical: peiMaintenanceTargetFirstGroups.technical?.length || 0
        }
      });
      return filterEligibleRows(panelEligibleRows);
    }

    // Enquanto a aba de manutenção carrega o painel real, não renderize fallback local.
    // Isso evita mostrar habilidades por 1s e removê-las quando o payload persistido chega.
    if (activeTab === 'plan' && activePeiPlanSubtab === 'maintenance' && isLoadingPeiMaintenancePanel) {
      debugFallbackTriggered('Panel loading', { isLoadingPeiMaintenancePanel });
      return [];
    }

    // Fallback local - só usado quando painel não tem dados persistidos
    debugFallbackTriggered('No panel data available', {
      hasPeiMaintenancePanelForCurrentPatient,
      panelHasAnyMaintenanceRows,
      isLoadingPeiMaintenancePanel,
      peiMaintenanceHydratedGoalsCount: peiMaintenanceHydratedGoals?.length || 0
    });

    const linkableTargetByClinicalId = new Map<string, any>();
    peiMaintenanceLinkableTargets.forEach((target: any) => {
      [
        target?.peiGoalId,
        target?.goalId,
        target?.goal_id,
        target?.skillId,
        target?.skill_id,
        target?.localTargetRef,
        target?.source?.peiGoalId,
        target?.source?.goalId,
        target?.source?.goal_id,
        target?.source?.skillId,
        target?.source?.skill_id,
        target?.source?.localTargetRef,
        target?.mastery_criteria?.peiGoalId,
        target?.mastery_criteria?.skillId,
        target?.mastery_criteria?.localTargetRef
      ].forEach((value: any) => {
        const key = String(value || '').trim();
        if (key && !linkableTargetByClinicalId.has(key)) linkableTargetByClinicalId.set(key, target);
      });
    });
    const localEligibleRows = dedupePeiMaintenanceRows(peiMaintenanceHydratedGoals
      .map((goal: any, index: number) => {
        if (!isGoalAcquired(goal)) return null;
        const goalId = String(goal?.goal_id || goal?.goalId || goal?.id || index).trim();
        const skillId = String(goal?.skillId || goal?.skill_id || '').trim();
        const matchedTarget = [goalId, skillId]
          .map((key) => linkableTargetByClinicalId.get(key))
          .find(Boolean);
        const targetId = getPeiMaintenancePersistedId(
          goal?.target_id ||
            goal?.targetId ||
            goal?.aba_target_id ||
            goal?.abaTargetId ||
            matchedTarget?.target_id ||
            matchedTarget?.targetId ||
            matchedTarget?.id
        );
        const name = safeDisplayValue(getPeiMaintenanceMatchName(goal), 'Habilidade sem nome');
        const protocol = safeDisplayValue(getPeiMaintenanceProtocolName(goal), 'Sem protocolo informado');
        const domain = safeDisplayValue(getPeiMaintenanceDomainName(goal), 'Sem domínio informado');
        return {
          key: `goal:${goalId || index}:${targetId || index}`,
          targetId,
          target_id: targetId || null,
          goalId,
          peiGoalId: goalId || null,
          skillId: skillId || null,
          localTargetRef: goalId || null,
          name,
          targetName: name,
          protocol,
          domain,
          protocolName: protocol,
          domainName: domain,
          description: safeDisplayValue(goal?.description || goal?.objective, ''),
          statusLabel: 'Adquirido',
          clinicalStatus: goal?.clinicalStatus || goal?.clinical_status || null,
          masteryStatus: goal?.masteryStatus || goal?.mastery_status || null,
          progressPercent: 100,
          hasRealTarget: Boolean(targetId),
          canScheduleMaintenance: Boolean(targetId),
          canWaitNextSession: Boolean(targetId),
          canAssignAppointment: false,
          canReviewLink: false,
          needsTargetReview: false,
          availableActions: targetId ? ['SCHEDULE_MAINTENANCE'] : [],
          source: goal
        };
      })
      .filter(Boolean));
    const fallbackRows = localEligibleRows.length > 0 ? localEligibleRows : buildPeiMaintenanceEligibleSkills(
      peiMaintenanceHydratedGoals.map((goal: any) => ({
        ...goal,
        progressPercent: getGoalProgressPercent(goal),
        statusLabel: isGoalAcquired(goal) ? 'Adquirido' : goal?.status
      }))
    );
    return filterEligibleRows(dedupePeiMaintenanceRows(fallbackRows));
  }, [abaMaintenanceOverview, abaMasteryEvaluations, abaTrials, activePeiPlanSubtab, activeTab, hasPeiMaintenancePanelForCurrentPatient, history, isLoadingPeiMaintenancePanel, peiMaintenanceHydratedGoals, peiMaintenanceLinkableTargets, peiMaintenanceTargetFirstGroups, peiMaintenanceUnavailableKeys, peiMaintenanceUnavailableSourceIds, peiMaintenanceUnavailableTargetIds]);

  const peiGeneralizationRows = useMemo(() => {
    const maintainedRows = peiMaintenanceRows.filter((row: any) => row.isMaintained);
    const maintainedKeys = new Set(maintainedRows.map((row: any) => String(row.key)));
    const acquiredWithoutRow = peiGoals
      .filter((goal: any) => isGoalAcquired(goal))
      .filter((goal: any) => !maintainedKeys.has(String(goal?.id || goal?.skillId || goal?.name).toLowerCase()))
      .map((goal: any) => {
        const display = resolveMaintenanceTargetDisplay({ target: goal, schedule: goal });
        return {
          key: `goal-${String(goal?.id || goal?.name)}`,
          targetName: display.targetDisplayName || 'Habilidade adquirida',
          protocol: display.protocolDisplayName,
          domain: display.domainDisplayName,
          statusLabel: 'Habilidade adquirida'
        };
      });
    return [...maintainedRows, ...acquiredWithoutRow];
  }, [abaMaintenanceOverview, abaMasteryEvaluations, abaTrials, history, peiGoals, peiMaintenanceRows]);

  const peiHistoryEvents = useMemo(() => buildPeiPlanHistoryEvents({
    goals: peiGoals,
    masteryEvaluations: abaMasteryEvaluations,
    schedules: abaMaintenanceOverview?.schedules || [],
    probeResults: abaMaintenanceOverview?.probeResults || [],
    alerts: abaMaintenanceOverview?.alerts || [],
    history
  }), [peiGoals, abaMasteryEvaluations, abaMaintenanceOverview, history]);

  const loadPeiMaintenanceLinkableTargets = React.useCallback((requestPatientId: string, force = false) => {
    if (!requestPatientId || !abaV2Enabled) {
      return Promise.resolve({ success: false, data: [] });
    }
    if (!force && peiMaintenanceLinkableTargetsState.loadedFor === requestPatientId) {
      return Promise.resolve({ success: true, data: peiMaintenanceLinkableTargetsState.items || [] });
    }
    if (!force && peiMaintenanceLinkableTargetsRequestRef.current?.patientId === requestPatientId) {
      return peiMaintenanceLinkableTargetsRequestRef.current.promise;
    }

    setPeiMaintenanceLinkableTargetsState((previous: any) => ({ ...previous, loading: true, error: '' }));
    const promise = dataService.getAbaLinkableTargetsForMaintenance(requestPatientId, { limit: 200 })
      .then((result: any) => {
        if (
          peiMaintenancePanelPatientIdRef.current !== requestPatientId ||
          peiMaintenanceLinkableTargetsRequestRef.current?.promise !== promise
        ) return result;
        const successful = result?.success !== false && Array.isArray(result?.data);
        setPeiMaintenanceLinkableTargetsState((previous: any) => ({
          loading: false,
          error: successful ? '' : result?.message || result?.error || 'Nao foi possivel carregar habilidades do PEI.',
          items: successful
            ? result.data
            : Array.isArray(previous?.items) ? previous.items : [],
          loadedFor: successful ? requestPatientId : previous?.loadedFor || ''
        }));
        return result;
      })
      .catch((error: any) => {
        if (
          peiMaintenancePanelPatientIdRef.current === requestPatientId &&
          peiMaintenanceLinkableTargetsRequestRef.current?.promise === promise
        ) {
          setPeiMaintenanceLinkableTargetsState((previous: any) => ({
            ...previous,
            loading: false,
            error: previous?.items?.length ? '' : 'Nao foi possivel carregar habilidades do PEI.',
            items: Array.isArray(previous?.items) ? previous.items : [],
            loadedFor: previous?.loadedFor || ''
          }));
        }
        return { success: false, error: error?.message || 'Nao foi possivel carregar habilidades do PEI.', data: [] };
      })
      .finally(() => {
        if (peiMaintenanceLinkableTargetsRequestRef.current?.promise === promise) {
          peiMaintenanceLinkableTargetsRequestRef.current = null;
        }
      });
    peiMaintenanceLinkableTargetsRequestRef.current = { patientId: requestPatientId, promise };
    return promise;
  }, [abaV2Enabled, peiMaintenanceLinkableTargetsState.items, peiMaintenanceLinkableTargetsState.loadedFor]);

  const refreshPeiMaintenancePanel = React.useCallback(async (options: { refreshLinkableTargets?: boolean } = {}) => {
    if (!patient?.id || !isKidsProfile || !abaV2Enabled) return;
    const requestPatientId = String(patient.id);
    const requestId = peiMaintenancePanelRequestSeqRef.current + 1;
    peiMaintenancePanelRequestSeqRef.current = requestId;
    setIsLoadingPeiMaintenancePanel(true);
    setPeiMaintenancePanelMessage('');
    try {
      const [panelResult] = await Promise.all([
        dataService.getAbaMaintenancePanel(requestPatientId, { page: 1, pageSize: 200 }),
        loadPeiMaintenanceLinkableTargets(requestPatientId, Boolean(options.refreshLinkableTargets))
      ]);

      const ignoredAsStale =
        !peiMaintenancePanelMountedRef.current ||
        requestId !== peiMaintenancePanelRequestSeqRef.current ||
        peiMaintenancePanelPatientIdRef.current !== requestPatientId;
      if (ignoredAsStale) {
        debugPeiMaintenancePanelLoad({
          source: 'maintenance-panel-target-first',
          requestId,
          patientIdPresent: Boolean(requestPatientId),
          eligibleSkillsCount: 0,
          technicalIssuesCount: 0,
          appliedToState: false,
          ignoredAsStale: true,
        });
        return null;
      }
      if (panelResult?.success === false) {
        setPeiMaintenancePanelMessage(panelResult?.message || panelResult?.error || 'Nao foi possivel carregar manutencao agora.');
        debugPeiMaintenancePanelLoad({
          source: 'maintenance-panel-target-first',
          requestId,
          patientIdPresent: Boolean(requestPatientId),
          eligibleSkillsCount: 0,
          technicalIssuesCount: 0,
          appliedToState: false,
          ignoredAsStale: false,
        });
        return null;
      }
      const panelData = panelResult?.data || null;
      const mappedPanel = mapMaintenancePanelResponse(panelData, {
        patientId: requestPatientId,
        requestId,
        loadedAt: Date.now()
      });
      setAbaMaintenancePanel(mappedPanel);
      setAbaMaintenanceOverview({
        schedules: Array.isArray(mappedPanel.raw?.schedules) ? mappedPanel.raw.schedules : [],
        probeResults: Array.isArray(mappedPanel.raw?.probeResults) ? mappedPanel.raw.probeResults : [],
        alerts: Array.isArray(mappedPanel.raw?.alerts) ? mappedPanel.raw.alerts : [],
        summary: mappedPanel.raw?.summary || null
      });
      setHasLoadedPeiMaintenancePanel(true);
      debugPeiMaintenancePanelLoad({
        source: mappedPanel.source,
        requestId,
        patientIdPresent: Boolean(requestPatientId),
        eligibleSkillsCount: mappedPanel.summary.eligibleSkills,
        technicalIssuesCount: mappedPanel.summary.technical,
        appliedToState: true,
        ignoredAsStale: false,
      });
      return mappedPanel;
    } catch {
      const ignoredAsStale =
        !peiMaintenancePanelMountedRef.current ||
        requestId !== peiMaintenancePanelRequestSeqRef.current ||
        peiMaintenancePanelPatientIdRef.current !== requestPatientId;
      if (!ignoredAsStale) {
        setPeiMaintenancePanelMessage('Nao foi possivel carregar manutencao agora.');
      }
      debugPeiMaintenancePanelLoad({
        source: 'maintenance-panel-target-first',
        requestId,
        patientIdPresent: Boolean(requestPatientId),
        eligibleSkillsCount: 0,
        technicalIssuesCount: 0,
        appliedToState: false,
        ignoredAsStale,
      });
      return null;
    } finally {
      if (
        peiMaintenancePanelMountedRef.current &&
        requestId === peiMaintenancePanelRequestSeqRef.current &&
        peiMaintenancePanelPatientIdRef.current === requestPatientId
      ) {
        setIsLoadingPeiMaintenancePanel(false);
      }
    }
  }, [abaV2Enabled, debugPeiMaintenancePanelLoad, isKidsProfile, loadPeiMaintenanceLinkableTargets, patient?.id]);

  const applyPeiMaintenanceScheduleResult = React.useCallback((result: any, fallbackRow: any = null) => {
    if (!patient?.id || result?.success === false) return;
    const rawSchedules = [
      result?.schedule,
      ...(Array.isArray(result?.data) ? result.data : result?.data ? [result.data] : []),
      ...(Array.isArray(result?.schedules) ? result.schedules : []),
    ].filter(Boolean);
    if (rawSchedules.length === 0) return;
    const optimisticRows = rawSchedules
      .map((schedule: any) => {
        const targetId = getPeiMaintenancePersistedId(
          schedule?.targetId ||
            schedule?.target_id ||
            result?.targetId ||
            fallbackRow?.targetId ||
            fallbackRow?.target_id
        );
        const scheduleId = getPersistedMaintenanceScheduleId(
          schedule?.scheduleId ||
            schedule?.schedule_id ||
            schedule?.id,
          schedule
        );
        if (!targetId || !scheduleId) return null;
        const nextSchedule = {
          ...(schedule || {}),
          id: scheduleId,
          scheduleId,
          schedule_id: scheduleId,
          targetId,
          target_id: targetId,
          peiGoalId: schedule?.peiGoalId || schedule?.goalId || schedule?.goal_id || fallbackRow?.peiGoalId || fallbackRow?.goalId || fallbackRow?.goal_id || null,
          goalId: schedule?.goalId || schedule?.goal_id || schedule?.peiGoalId || fallbackRow?.goalId || fallbackRow?.goal_id || fallbackRow?.peiGoalId || null,
          goal_id: schedule?.goal_id || schedule?.goalId || schedule?.peiGoalId || fallbackRow?.goal_id || fallbackRow?.goalId || fallbackRow?.peiGoalId || null,
          skillId: schedule?.skillId || schedule?.skill_id || fallbackRow?.skillId || fallbackRow?.skill_id || null,
          skill_id: schedule?.skill_id || schedule?.skillId || fallbackRow?.skill_id || fallbackRow?.skillId || null,
          localTargetRef: schedule?.localTargetRef || schedule?.local_target_ref || fallbackRow?.localTargetRef || fallbackRow?.local_target_ref || null,
          status: schedule?.status || (schedule?.appointmentId || schedule?.appointment_id ? 'SCHEDULED' : 'SCHEDULED'),
        };
        return {
          ...(fallbackRow || {}),
          ...(schedule || {}),
          key: `schedule:${scheduleId}`,
          scheduleId,
          schedule_id: scheduleId,
          targetId,
          target_id: targetId,
          hasRealTarget: true,
          hasRealSchedule: true,
          targetName: schedule?.targetName || schedule?.target_name || fallbackRow?.targetName || fallbackRow?.name,
          name: schedule?.targetName || schedule?.target_name || fallbackRow?.targetName || fallbackRow?.name,
          protocolName: schedule?.protocolName || schedule?.protocol || fallbackRow?.protocolName || fallbackRow?.protocol,
          protocol: schedule?.protocolName || schedule?.protocol || fallbackRow?.protocolName || fallbackRow?.protocol,
          domainName: schedule?.domainName || schedule?.domain || fallbackRow?.domainName || fallbackRow?.domain,
          domain: schedule?.domainName || schedule?.domain || fallbackRow?.domainName || fallbackRow?.domain,
          nextSchedule,
          activeSchedule: nextSchedule,
          schedule: nextSchedule,
          schedules: [nextSchedule],
          canScheduleMaintenance: true,
          canWaitNextSession: true,
          canAssignAppointment: true,
          availableActions: ['EDIT_SCHEDULE', 'CANCEL_SCHEDULE', 'MOVE_NEXT_SESSION', 'ASSIGN_APPOINTMENT'],
        };
      })
      .filter((row: any) => row && isActivePeiMaintenanceScheduleRow(row));
    if (optimisticRows.length === 0) return;

    setAbaMaintenancePanel((previous: any) => {
      const sections = {
        ...createEmptyPeiMaintenanceTargetFirstSections(),
        ...(previous?.sections || {}),
      };
      const scheduledTargetIds = new Set(optimisticRows.map((row: any) => row.targetId).filter(Boolean));
      const scheduledScheduleIds = new Set(optimisticRows.map((row: any) => row.scheduleId).filter(Boolean));
      const keepUnrelated = (row: any) => {
        const rowTargetId = getPeiMaintenancePersistedId(row?.targetId || row?.target_id);
        const rowScheduleId = getPersistedMaintenanceScheduleId(row?.scheduleId || row?.schedule_id || row?.nextSchedule?.id || row?.activeSchedule?.id || row?.schedule?.id, row?.nextSchedule || row?.activeSchedule || row?.schedule || row);
        return (
          !(rowTargetId && scheduledTargetIds.has(rowTargetId)) &&
          !(rowScheduleId && scheduledScheduleIds.has(rowScheduleId))
        );
      };
      if (import.meta.env.DEV) {
        const removedEligibleTargetIds = (sections.eligibleSkills || [])
          .map((row: any) => getPeiMaintenancePersistedId(row?.targetId || row?.target_id))
          .filter((targetId: string) => targetId && scheduledTargetIds.has(targetId));
        console.debug('[pei-maintenance-panel]', {
          panelEligibleTargetIds: (sections.eligibleSkills || []).map((row: any) => getPeiMaintenancePersistedId(row?.targetId || row?.target_id)).filter(Boolean),
          panelScheduledTargetIds: Array.from(scheduledTargetIds),
          removedEligibleTargetIds,
          reasonForRemoval: 'optimistic_schedule_target_id_match'
        });
      }
      const waitingRows: any[] = [];
      const scheduledRows: any[] = [];
      optimisticRows.forEach((row: any) => {
        const status = String(row?.nextSchedule?.status || row?.status || '').toUpperCase();
        if (['PENDING_NEXT_SESSION', 'PENDING_LINK', 'PENDING_SCHEDULING', 'UNSCHEDULED', 'PENDING'].includes(status)) {
          waitingRows.push(row);
        } else {
          scheduledRows.push(row);
        }
      });
      return mapMaintenancePanelResponse({
        ...(previous?.raw || {}),
        eligibleSkills: (sections.eligibleSkills || []).filter(keepUnrelated),
        maintenanceSkills: (sections.maintenanceSkills || []).filter(keepUnrelated),
        scheduledProbes: [...scheduledRows, ...(sections.scheduled || []).filter(keepUnrelated)],
        waitingNextSession: [...waitingRows, ...(sections.waitingNextSession || []).filter(keepUnrelated)],
        overdueProbes: (sections.overdue || []).filter(keepUnrelated),
        regressionRisk: (sections.regressionRisk || []).filter(keepUnrelated),
        technicalIssues: sections.technical || [],
        schedules: [
          ...optimisticRows.map((row: any) => row.nextSchedule),
          ...(Array.isArray(previous?.raw?.schedules) ? previous.raw.schedules.filter(keepUnrelated) : []),
        ],
      }, {
        patientId: patient.id,
        requestId: peiMaintenancePanelRequestSeqRef.current,
        loadedAt: Date.now(),
      });
    });
    setAbaMaintenanceOverview((previous: any) => ({
        ...(previous || {}),
        schedules: [
          ...optimisticRows.map((row: any) => row.nextSchedule),
          ...(Array.isArray(previous?.schedules) ? previous.schedules : []).filter((row: any) => {
            const rowTargetId = getPeiMaintenancePersistedId(row?.targetId || row?.target_id);
            const rowScheduleId = getPersistedMaintenanceScheduleId(row?.scheduleId || row?.schedule_id || row?.id, row);
            return !optimisticRows.some((scheduledRow: any) => (
              scheduledRow.targetId === rowTargetId ||
              scheduledRow.scheduleId === rowScheduleId
            ));
          }),
        ],
    }));
    setHasLoadedPeiMaintenancePanel(true);
  }, [patient?.id]);

  useEffect(() => {
    if (activeTab !== 'plan' || activePeiPlanSubtab !== 'maintenance') return;
    if (hasLoadedPeiMaintenancePanel || isLoadingPeiMaintenancePanel) return;
    void refreshPeiMaintenancePanel();
  }, [activePeiPlanSubtab, activeTab, hasLoadedPeiMaintenancePanel, isLoadingPeiMaintenancePanel, refreshPeiMaintenancePanel]);

  useEffect(() => {
    let cancelled = false;
    const shouldLoadAppointments = Boolean(
      peiMaintenanceAssignSchedule ||
        (peiMaintenanceScheduleRow && ['CUSTOM_DATE', 'EXISTING_APPOINTMENT'].includes(peiMaintenanceScheduleMode))
    );
    if (!shouldLoadAppointments || !patient?.id) return;
    setPeiMaintenanceAppointmentsState({ loading: true, error: '', items: [] });
    dataService.getAbaFutureAppointmentsForMaintenance(String(patient.id), { limit: 20 })
      .then((result: any) => {
        if (cancelled) return;
        setPeiMaintenanceAppointmentsState({
          loading: false,
          error: result?.success === false ? result?.error || 'Nao foi possivel carregar proximas sessões.' : '',
          items: Array.isArray(result?.data) ? result.data : []
        });
      })
      .catch(() => {
        if (!cancelled) {
          setPeiMaintenanceAppointmentsState({ loading: false, error: 'Nao foi possivel carregar proximas sessões.', items: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [patient?.id, peiMaintenanceAssignSchedule, peiMaintenanceScheduleMode, peiMaintenanceScheduleRow]);

  useEffect(() => {
    const shouldLoadLinkableTargets = Boolean(
      peiMaintenanceReviewRow ||
      peiMaintenanceScheduleRow ||
      (activeTab === 'plan' && activePeiPlanSubtab === 'maintenance')
    );
    if (!shouldLoadLinkableTargets || !patient?.id || !abaV2Enabled) return;
    void loadPeiMaintenanceLinkableTargets(String(patient.id));
  }, [abaV2Enabled, activePeiPlanSubtab, activeTab, loadPeiMaintenanceLinkableTargets, patient?.id, peiMaintenanceReviewRow, peiMaintenanceScheduleRow]);

  const getPersistedUuid = (value: any) => {
    const id = String(value || '').trim();
    return isUuidLike(id) ? id : '';
  };

  function getPersistedMaintenanceScheduleId(value: any, source?: any) {
    const id = String(value || '').trim();
    if (isUuidLike(id)) return id;
    const schedule = source && typeof source === 'object' ? source : {};
    if (
      id &&
      /^maintenance-[a-z0-9][a-z0-9-]{7,}$/i.test(id) &&
      !/(^|-)local-|(^|-)temp-|(^|-)tmp-|(^|-)offline-/i.test(id) &&
      (schedule.persisted || schedule.hasRealSchedule || schedule.schedulePersisted)
    ) {
      return id;
    }
    return '';
  }

  const getPeiMaintenanceExplicitTargetId = (row: any) => {
    const rowIdCanBeTarget = Boolean(
      row?.hasRealTarget === true &&
      !row?.scheduleId &&
      !row?.schedule_id &&
      !row?.nextSchedule &&
      !row?.activeSchedule &&
      !row?.schedule
    );
    return getPersistedUuid(
      row?.targetId ||
      row?.target_id ||
      row?.aba_target_id ||
      row?.abaTargetId ||
      row?.target?.id ||
      row?.target?.target_id ||
      row?.target?.targetId ||
      row?.goal?.aba_target_id ||
      row?.goal?.abaTargetId ||
      row?.goal?.target_id ||
      row?.goal?.targetId ||
      row?.source?.target_id ||
      row?.source?.targetId ||
      row?.source?.aba_target_id ||
      row?.source?.abaTargetId ||
      row?.nextSchedule?.target_id ||
      row?.nextSchedule?.targetId ||
      row?.activeSchedule?.target_id ||
      row?.activeSchedule?.targetId ||
      row?.schedule?.target_id ||
      row?.schedule?.targetId ||
      (rowIdCanBeTarget ? row?.id : '')
    );
  };

  const getPeiMaintenanceTargetId = (row: any, _extraTargets: any[] = []) => getPeiMaintenanceExplicitTargetId(row);

  const buildPeiMaintenanceScheduleSelection = (row: any, _extraTargets: any[] = []) => {
    const targetId = getPeiMaintenanceExplicitTargetId(row);
    if (!targetId) return null;
    const targetName = safeDisplayValue(getPeiMaintenanceMatchName(row), 'Habilidade em manutenção');
    const protocolName = safeDisplayValue(getPeiMaintenanceProtocolName(row), '');
    const domainName = safeDisplayValue(getPeiMaintenanceDomainName(row), '');
    return {
      ...(row || {}),
      targetId,
      target_id: targetId,
      targetName,
      target_name: targetName,
      name: targetName,
      protocol: protocolName,
      protocolName,
      domain: domainName,
      domainName,
      status: row?.status || row?.clinicalStatus || row?.clinical_status || 'ACQUIRED',
      progressPercent: Number.isFinite(Number(row?.progressPercent)) ? row.progressPercent : 100,
      hasRealTarget: true,
      canScheduleMaintenance: true,
      availableActions: Array.isArray(row?.availableActions) && row.availableActions.length > 0 ? row.availableActions : ['SCHEDULE_MAINTENANCE']
    };
  };

  const buildPeiMaintenanceTargetEnsurePayload = (row: any) => {
    const source = row?.source && typeof row.source === 'object' ? row.source : {};
    const goal = row?.goal && typeof row.goal === 'object' ? row.goal : {};
    const target = row?.target && typeof row.target === 'object' ? row.target : {};
    const targetName = safeDisplayValue(getPeiMaintenanceMatchName(row), '');
    const protocolName = safeDisplayValue(getPeiMaintenanceProtocolName(row), '');
    const domainName = safeDisplayValue(getPeiMaintenanceDomainName(row), '');
    const progressPercent = Number(
      row?.progressPercent ??
        row?.progress_percent ??
        row?.progress ??
        source?.progressPercent ??
        source?.progress_percent ??
        source?.progress ??
        goal?.progressPercent ??
        goal?.progress_percent ??
        goal?.progress
    );
    return {
      targetId: row?.targetId || row?.target_id || row?.abaTargetId || row?.aba_target_id || target?.id || source?.targetId || source?.target_id || '',
      target_id: row?.target_id || row?.targetId || row?.aba_target_id || row?.abaTargetId || target?.id || source?.target_id || source?.targetId || '',
      peiGoalId: row?.peiGoalId || row?.goalId || row?.goal_id || source?.peiGoalId || source?.goalId || source?.goal_id || source?.id || goal?.id || '',
      goalId: row?.goalId || row?.goal_id || row?.peiGoalId || source?.goalId || source?.goal_id || source?.peiGoalId || source?.id || goal?.id || '',
      skillId: row?.skillId || row?.skill_id || source?.skillId || source?.skill_id || goal?.skillId || goal?.skill_id || '',
      localTargetRef: row?.localTargetRef || source?.localTargetRef || source?.id || goal?.id || '',
      targetName,
      target_name: targetName,
      name: targetName,
      protocolName,
      protocol_name: protocolName,
      protocol: protocolName,
      domainName,
      domain_name: domainName,
      domain: domainName,
      description: safeDisplayValue(row?.description || row?.objective || source?.description || source?.objective || goal?.description || goal?.objective || target?.description, ''),
      status: row?.status || row?.clinicalStatus || row?.clinical_status || source?.status || source?.clinicalStatus || source?.clinical_status || goal?.status || goal?.clinicalStatus || goal?.clinical_status || '',
      clinicalStatus: row?.clinicalStatus || row?.clinical_status || source?.clinicalStatus || source?.clinical_status || goal?.clinicalStatus || goal?.clinical_status || '',
      masteryStatus: row?.masteryStatus || row?.mastery_status || source?.masteryStatus || source?.mastery_status || goal?.masteryStatus || goal?.mastery_status || '',
      progressPercent: Number.isFinite(progressPercent) ? progressPercent : (isGoalAcquired(row) ? 100 : null),
      acquiredAt: row?.acquiredAt || row?.completedAt || row?.updatedAt || source?.acquiredAt || source?.completedAt || source?.updatedAt || null
    };
  };

  const ensurePeiMaintenanceScheduleSelection = async (row: any) => {
    if (!patient?.id || !abaV2Enabled || !row) return null;
    const result = await dataService.ensurePeiMaintenanceTarget(String(patient.id), buildPeiMaintenanceTargetEnsurePayload(row));
    const ensuredTarget = result?.target || result?.data || null;
    const ensuredTargetId = getPersistedUuid(
      result?.targetId ||
      ensuredTarget?.targetId ||
      ensuredTarget?.target_id ||
      ensuredTarget?.id ||
      result?.data?.targetId ||
      result?.data?.id
    );
    if (!result || result.success === false || !ensuredTargetId) return null;
    const nextTarget = {
      ...(ensuredTarget || {}),
      id: ensuredTargetId,
      targetId: ensuredTargetId,
      target_id: ensuredTargetId,
      name: ensuredTarget?.name || ensuredTarget?.targetName || getPeiMaintenanceMatchName(row),
      targetName: ensuredTarget?.targetName || ensuredTarget?.name || getPeiMaintenanceMatchName(row),
      target_name: ensuredTarget?.target_name || ensuredTarget?.targetName || ensuredTarget?.name || getPeiMaintenanceMatchName(row),
      protocolName: ensuredTarget?.protocolName || ensuredTarget?.protocol_title || getPeiMaintenanceProtocolName(row),
      protocol_title: ensuredTarget?.protocol_title || ensuredTarget?.protocolName || getPeiMaintenanceProtocolName(row),
      domainName: ensuredTarget?.domainName || ensuredTarget?.domain_name || getPeiMaintenanceDomainName(row),
      domain_name: ensuredTarget?.domain_name || ensuredTarget?.domainName || getPeiMaintenanceDomainName(row)
    };
    setPeiMaintenanceLinkableTargetsState((prev: any) => {
      const items = Array.isArray(prev.items) ? prev.items : [];
      const exists = items.some((item: any) => getPersistedUuid(item?.id || item?.targetId || item?.target_id) === ensuredTargetId);
      return {
        ...prev,
        loading: false,
        error: '',
        loadedFor: String(patient.id),
        items: exists ? items.map((item: any) => getPersistedUuid(item?.id || item?.targetId || item?.target_id) === ensuredTargetId ? { ...item, ...nextTarget } : item) : [nextTarget, ...items]
      };
    });
    return buildPeiMaintenanceScheduleSelection({ ...(row || {}), targetId: ensuredTargetId, target_id: ensuredTargetId, target: nextTarget });
  };

  const logPeiMaintenanceScheduleDebug = (reasonCode: string, details: Record<string, any> = {}) => {
    if (!import.meta.env.DEV) return;
    console.debug('[pei-maintenance-schedule]', {
      action: 'schedule_maintenance',
      reasonCode,
      hasTargetId: Boolean(details.hasTargetId),
      targetIdType: details.hasTargetId ? typeof details.targetId : 'missing',
      mode: details.mode || peiMaintenanceScheduleMode,
      hasAppointmentId: Boolean(details.hasAppointmentId),
      hasDueDate: Boolean(details.hasDueDate)
    });
  };

  const getPeiMaintenanceScheduleId = (schedule: any) =>
    getPersistedMaintenanceScheduleId(schedule?.id || schedule?.schedule_id || schedule?.scheduleId, schedule);

  const peiMaintenanceDuplicateScheduleRows = useMemo(() => {
    const duplicates = Array.isArray(abaMaintenancePanel?.raw?.duplicateSchedulesForReview)
      ? abaMaintenancePanel.raw.duplicateSchedulesForReview
      : [];
    return duplicates.map((schedule: any, index: number) => ({
      key: `duplicate-${schedule?.id || schedule?.scheduleId || index}`,
      targetId: schedule?.targetId || schedule?.target_id || null,
      targetName: schedule?.targetName || schedule?.target_name || 'Habilidade em manutenção',
      protocol: schedule?.protocolName || schedule?.protocolTitle || schedule?.protocol_title || '',
      protocolName: schedule?.protocolName || schedule?.protocolTitle || schedule?.protocol_title || '',
      domain: schedule?.domainName || schedule?.domain_name || '',
      domainName: schedule?.domainName || schedule?.domain_name || '',
      statusLabel: 'Duplicado para revisão',
      nextSchedule: schedule,
      schedule,
      duplicateSchedule: true,
      hasRealSchedule: Boolean(getPeiMaintenanceScheduleId(schedule)),
      hasRealTarget: Boolean(getPersistedUuid(schedule?.targetId || schedule?.target_id))
    }));
  }, [abaMaintenancePanel?.raw?.duplicateSchedulesForReview]);

  const getPeiMaintenanceCandidateAppointmentId = (schedule: any) =>
    getPersistedUuid(
      schedule?.candidate_appointment_id ||
      schedule?.candidateAppointmentId ||
      schedule?.raw_payload?.candidateAppointmentId ||
      schedule?.rawPayload?.candidateAppointmentId ||
      ''
    ).trim();

  const getPeiMaintenanceAppointmentDateValue = (appointment: any) => {
    const value =
      appointment?.scheduled_at ||
      appointment?.scheduledAt ||
      appointment?.scheduled_start_at ||
      appointment?.scheduledStartAt ||
      appointment?.start_at ||
      appointment?.startAt ||
      appointment?.date ||
      '';
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    const raw = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '';
  };

  const parsePeiMaintenanceDateValue = (dateValue: string) => {
    const match = String(dateValue || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const formatPeiMaintenanceDateValue = (dateValue: string) => {
    const date = parsePeiMaintenanceDateValue(dateValue);
    return date ? date.toLocaleDateString('pt-BR') : 'dd/mm/aaaa';
  };

  const formatPeiMaintenanceAppointmentDateTimeLabel = (appointment: any) => {
    const value =
      appointment?.scheduled_at ||
      appointment?.scheduledAt ||
      appointment?.scheduled_start_at ||
      appointment?.scheduledStartAt ||
      appointment?.start_at ||
      appointment?.startAt ||
      appointment?.date ||
      '';
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return formatPeiMaintenanceDateValue(raw);
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return formatAbaDateTime(value);
    const dateValue = getPeiMaintenanceAppointmentDateValue(appointment);
    return dateValue ? formatPeiMaintenanceDateValue(dateValue) : 'Data indisponível';
  };

  function getPeiMaintenanceScheduleObject(row: any) {
    return row?.nextSchedule || row?.activeSchedule || row?.schedule || (row?.scheduleId || row?.schedule_id ? row : null);
  }

  const getPeiMaintenanceScheduleClinicalDateValue = (schedule: any) => {
    const rawPayload = schedule?.raw_payload || schedule?.rawPayload || {};
    const rawClinicalDate = String(rawPayload?.clinicalDate || rawPayload?.clinical_date || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawClinicalDate)) return rawClinicalDate;
    const value =
      schedule?.target_due_date ||
      schedule?.targetDueDate ||
      schedule?.due_date ||
      schedule?.dueDate ||
      '';
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  };

  const formatPeiMaintenanceAppointmentScheduleLine = (schedule: any) => {
    const appointment = schedule?.appointment || {};
    const value =
      appointment?.scheduled_at ||
      appointment?.scheduledAt ||
      appointment?.scheduled_start_at ||
      appointment?.scheduledStartAt ||
      schedule?.scheduled_for ||
      schedule?.scheduledFor ||
      schedule?.due_date ||
      schedule?.dueDate ||
      '';
    const date = new Date(value);
    const when = Number.isNaN(date.getTime())
      ? 'Data da sessão indisponível'
      : `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })} às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const durationMinutes = Number(
      appointment?.durationMinutes ||
      appointment?.duration_minutes ||
      appointment?.scheduledDurationMinutes ||
      appointment?.scheduled_duration_minutes ||
      0
    );
    const duration = Number.isFinite(durationMinutes) && durationMinutes > 0 ? `${Math.round(durationMinutes)} min` : '';
    const type = safeDisplayValue(appointment?.service_type || appointment?.serviceType || appointment?.approach || appointment?.type, '');
    const professional = safeDisplayValue(appointment?.therapistName || appointment?.therapist_name || appointment?.professionalName || appointment?.professional_name, '');
    const location = safeDisplayValue(appointment?.roomName || appointment?.room_name || appointment?.location || appointment?.location_type || appointment?.local, '');
    return [when, duration, type, professional, location].filter(Boolean).join(' · ');
  };

  const getPeiMaintenanceScheduleDisplay = (row: any, fallbackStatus = 'Sondagem agendada') => {
    const schedule = getPeiMaintenanceScheduleObject(row);
    const status = String(schedule?.status || row?.status || '').toUpperCase();
    const appointmentId = getPersistedUuid(schedule?.appointment_id || schedule?.appointmentId);
    if (['PENDING_NEXT_SESSION', 'PENDING_LINK', 'PENDING_SCHEDULING', 'UNSCHEDULED', 'PENDING'].includes(status)) {
      return {
        badge: appointmentId ? 'Vínculo pendente' : 'Sem sessão vinculada',
        line: 'A sondagem voltará a ser sugerida quando houver uma sessão real disponível.',
        tone: 'amber'
      };
    }
    if (appointmentId) {
      return {
        badge: 'Sondagem vinculada à sessão',
        line: `Sessão: ${formatPeiMaintenanceAppointmentScheduleLine(schedule)}`,
        tone: 'violet'
      };
    }
    const clinicalDate = getPeiMaintenanceScheduleClinicalDateValue(schedule);
    return {
      badge: 'Sondagem por data',
      line: clinicalDate ? `Data: ${formatPeiMaintenanceDateValue(clinicalDate)}` : fallbackStatus,
      tone: 'emerald'
    };
  };

  const formatPeiMaintenanceMonthLabel = (monthValue: string) => {
    const [year, month] = String(monthValue || '').split('-').map(Number);
    const date = new Date(year || new Date().getFullYear(), (month || new Date().getMonth() + 1) - 1, 1);
    return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  };

  const addMonthsToPeiMaintenanceCalendar = (delta: number) => {
    const [year, month] = String(peiMaintenanceCalendarMonth || '').split('-').map(Number);
    const date = new Date(year || new Date().getFullYear(), (month || new Date().getMonth() + 1) - 1 + delta, 1);
    setPeiMaintenanceCalendarMonth(date.toISOString().slice(0, 7));
  };

  const getPeiMaintenanceAppointmentStatusInfo = (appointment: any) => {
    const rawStatus = String(
      appointment?.recurrence_instance_status ||
        appointment?.recurrenceInstanceStatus ||
        appointment?.status ||
        appointment?.appointment_status ||
        appointment?.appointmentStatus ||
        ''
    ).trim();
    const normalizedStatus = rawStatus
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!normalizedStatus || normalizedStatus === 'SCHEDULED' || normalizedStatus === 'AGENDADA' || normalizedStatus === 'AGENDADO') {
      return {
        label: 'Agendada',
        badgeClass: isPanelDark ? 'bg-sky-500/15 text-sky-100 border-sky-300/30' : 'bg-sky-50 text-sky-700 border-sky-200',
        dotClass: 'bg-sky-500'
      };
    }
    if (normalizedStatus.includes('CONFIRM')) {
      return {
        label: 'Confirmada',
        badgeClass: isPanelDark ? 'bg-emerald-500/15 text-emerald-100 border-emerald-300/30' : 'bg-emerald-50 text-emerald-700 border-emerald-200',
        dotClass: 'bg-emerald-500'
      };
    }
    if (normalizedStatus.includes('RESCHEDULE') || normalizedStatus.includes('REMARC')) {
      return {
        label: 'Remarcada',
        badgeClass: isPanelDark ? 'bg-amber-500/15 text-amber-100 border-amber-300/30' : 'bg-amber-50 text-amber-700 border-amber-200',
        dotClass: 'bg-amber-500'
      };
    }
    if (normalizedStatus.includes('CANCEL')) {
      return {
        label: 'Cancelada',
        badgeClass: isPanelDark ? 'bg-rose-500/15 text-rose-100 border-rose-300/30' : 'bg-rose-50 text-rose-700 border-rose-200',
        dotClass: 'bg-rose-500'
      };
    }
    if (normalizedStatus.includes('PENDING') || normalizedStatus === 'PENDENTE' || normalizedStatus.includes('AGUARD')) {
      return {
        label: 'Pendente',
        badgeClass: isPanelDark ? 'bg-amber-500/15 text-amber-100 border-amber-300/30' : 'bg-amber-50 text-amber-700 border-amber-200',
        dotClass: 'bg-amber-500'
      };
    }
    if (normalizedStatus.includes('PROGRESS') || normalizedStatus.includes('ANDAMENTO')) {
      return {
        label: 'Em andamento',
        badgeClass: isPanelDark ? 'bg-indigo-500/15 text-indigo-100 border-indigo-300/30' : 'bg-indigo-50 text-indigo-700 border-indigo-200',
        dotClass: 'bg-indigo-500'
      };
    }
    if (normalizedStatus.includes('COMPLET') || normalizedStatus.includes('CONCLUID') || normalizedStatus.includes('REALIZ')) {
      return {
        label: 'Realizada',
        badgeClass: isPanelDark ? 'bg-slate-500/15 text-slate-100 border-slate-300/30' : 'bg-slate-50 text-slate-700 border-slate-200',
        dotClass: 'bg-slate-500'
      };
    }
    return {
      label: 'Status não informado',
      badgeClass: isPanelDark ? 'bg-slate-500/15 text-slate-100 border-slate-300/30' : 'bg-slate-50 text-slate-700 border-slate-200',
      dotClass: 'bg-slate-400'
    };
  };

  const getPeiMaintenanceAppointmentsByDate = () => {
    const byDate = new Map<string, any[]>();
    peiMaintenanceAppointmentsState.items.forEach((appointment: any) => {
      const dateValue = getPeiMaintenanceAppointmentDateValue(appointment);
      if (!dateValue) return;
      const current = byDate.get(dateValue) || [];
      current.push(appointment);
      byDate.set(dateValue, current);
    });
    return byDate;
  };

  const openPeiMaintenanceCalendar = () => {
    const firstAppointmentDate = peiMaintenanceAppointmentsState.items
      .map((appointment: any) => getPeiMaintenanceAppointmentDateValue(appointment))
      .find(Boolean);
    const basis = peiMaintenanceScheduleDate || firstAppointmentDate || new Date().toISOString().slice(0, 10);
    setPeiMaintenanceCalendarMonth(basis.slice(0, 7));
    setIsPeiMaintenanceCalendarOpen((open) => !open);
  };

  const runPeiMaintenanceAction = async (key: string, action: () => Promise<any>, successMessage: string, optimisticRow: any = null) => {
    setPeiMaintenanceActionKey(key);
    setPeiMaintenancePanelMessage('');
    try {
      const result = await action();
      if (result?.success === false) {
        setPeiMaintenancePanelMessage(result?.message || result?.error || 'Não foi possível atualizar a manutenção.');
        return false;
      }
      // Aplica otimisticamente ANTES do refresh para que a UI seja imediata e
      // não seja sobrescrita por dados desatualizados do banco enquanto o refresh corre.
      applyPeiMaintenanceScheduleResult(result, optimisticRow);
      setPeiMaintenancePanelMessage(result?.message || successMessage);
      const expectedTargetIds = new Set(
        [
          result?.schedule,
          ...(Array.isArray(result?.data) ? result.data : result?.data ? [result.data] : []),
          ...(Array.isArray(result?.schedules) ? result.schedules : [])
        ]
          .map((row: any) => getPeiMaintenancePersistedId(row?.targetId || row?.target_id))
          .filter(Boolean)
      );
      // O refresh target-first vira a fonte final; se contradisser o optimistic,
      // mostramos o erro em vez de reaplicar estado local por cima do banco.
      void refreshPeiMaintenancePanel({ refreshLinkableTargets: true }).then((mappedPanel: any) => {
        if (!mappedPanel || expectedTargetIds.size === 0) return;
        const confirmedTargetIds = new Set(
          [
            ...(mappedPanel.sections?.maintenanceSkills || []),
            ...(mappedPanel.sections?.scheduled || []),
            ...(mappedPanel.sections?.waitingNextSession || []),
            ...(mappedPanel.sections?.overdue || []),
            ...(mappedPanel.sections?.regressionRisk || [])
          ]
            .filter((row: any) => isActivePeiMaintenanceScheduleRow(row))
            .map((row: any) => getPeiMaintenancePersistedId(row?.targetId || row?.target_id))
            .filter(Boolean)
        );
        const missingTarget = Array.from(expectedTargetIds).some((targetId) => !confirmedTargetIds.has(String(targetId)));
        if (missingTarget) {
          setPeiMaintenancePanelMessage('Agendamento salvo localmente, mas não confirmado no banco. Recarregue e tente novamente.');
        }
      });
      return true;
    } catch {
      setPeiMaintenancePanelMessage('Não foi possível atualizar a manutenção.');
      return false;
    } finally {
      setPeiMaintenanceActionKey('');
    }
  };

  const handlePeiCreateMaintenancePlan = (row: any) => {
    openPeiMaintenanceScheduleModal(row, 'CUSTOM_DATE');
  };

  const openPeiMaintenanceScheduleModal = async (row: any, mode = 'CUSTOM_DATE') => {
    let selectedSkill = buildPeiMaintenanceScheduleSelection(row);
    if (!selectedSkill && patient?.id && abaV2Enabled) {
      const actionKey = `schedule-${row?.key || normalizePeiMaintenanceMatchKey(row?.targetName || row?.name || 'skill')}`;
      setPeiMaintenanceActionKey(actionKey);
      setPeiMaintenancePanelMessage('');
      try {
        selectedSkill = await ensurePeiMaintenanceScheduleSelection(row);
        if (selectedSkill) {
          await loadPeiMaintenanceLinkableTargets(String(patient.id), true);
        }
      } catch {
        selectedSkill = null;
      } finally {
        setPeiMaintenanceActionKey('');
      }
    }
    if (!selectedSkill) {
      logPeiMaintenanceScheduleDebug('missing_target_on_open', { hasTargetId: false, targetId: row?.targetId || row?.target_id, mode });
      setPeiMaintenancePanelMessage('Não foi possível preparar esta habilidade para manutenção agora.');
      return;
    }
    const schedule = getPeiMaintenanceScheduleObject(row);
    const scheduleAppointmentId = getPersistedUuid(schedule?.appointment_id || schedule?.appointmentId);
    const scheduleDate = scheduleAppointmentId
      ? getPeiMaintenanceAppointmentDateValue(schedule?.appointment || schedule)
      : getPeiMaintenanceScheduleClinicalDateValue(schedule);
    const scheduleStatus = String(schedule?.status || '').toUpperCase();
    const initialMode = scheduleStatus === 'PENDING_NEXT_SESSION'
      ? 'NEXT_PATIENT_SESSION'
      : (mode === 'EXISTING_APPOINTMENT' ? 'CUSTOM_DATE' : mode);
    setPeiMaintenanceScheduleRow(selectedSkill);
    setPeiMaintenanceScheduleMode(initialMode);
    setPeiMaintenanceScheduleDate(scheduleDate || '');
    setIsPeiMaintenanceCalendarOpen(false);
    setPeiMaintenanceCalendarMonth((scheduleDate || new Date().toISOString().slice(0, 10)).slice(0, 7));
    setSelectedPeiMaintenanceAppointmentId(scheduleAppointmentId || '');
    setPeiMaintenancePanelMessage('');
  };

  const handlePeiScheduleModalSave = async () => {
    let row = peiMaintenanceScheduleRow;
    let targetId = getPeiMaintenanceExplicitTargetId(row);
    if (!targetId && row) {
      const ensuredSelection = await ensurePeiMaintenanceScheduleSelection(row);
      if (ensuredSelection) {
        row = ensuredSelection;
        setPeiMaintenanceScheduleRow(ensuredSelection);
        targetId = getPeiMaintenanceExplicitTargetId(ensuredSelection);
      }
    }
    if (!targetId || !patient?.id) {
      logPeiMaintenanceScheduleDebug('missing_target_on_save', { hasTargetId: false, targetId: row?.targetId || row?.target_id, mode: peiMaintenanceScheduleMode });
      setPeiMaintenancePanelMessage('Não foi possível preparar esta habilidade para manutenção agora.');
      return;
    }
    const isDateMode = peiMaintenanceScheduleMode === 'CUSTOM_DATE';
    const existingSchedule = getPeiMaintenanceScheduleObject(row);
    const existingScheduleId = getPeiMaintenanceScheduleId(existingSchedule) || getPersistedMaintenanceScheduleId(row?.scheduleId || row?.schedule_id, row);
    const selectedAppointmentId = getPersistedUuid(selectedPeiMaintenanceAppointmentId);
    const selectedAppointment = selectedAppointmentId
      ? peiMaintenanceAppointmentsState.items.find((appointment: any) => getPersistedUuid(appointment?.id) === selectedAppointmentId) || existingSchedule?.appointment || null
      : null;
    const appointmentId = isDateMode ? selectedAppointmentId : '';
    const appointmentDueDate = selectedAppointment
      ? selectedAppointment?.scheduled_at || selectedAppointment?.scheduledAt || selectedAppointment?.scheduled_start_at || selectedAppointment?.scheduledStartAt || selectedAppointment?.start_at || selectedAppointment?.startAt || null
      : null;
    if (isDateMode && !peiMaintenanceScheduleDate && !appointmentId) {
      logPeiMaintenanceScheduleDebug('missing_due_date', { hasTargetId: true, targetId, mode: peiMaintenanceScheduleMode, hasDueDate: false, hasAppointmentId: Boolean(appointmentId) });
      setPeiMaintenancePanelMessage('Escolha uma data para agendar a sondagem.');
      return;
    }
    if (appointmentId && !selectedAppointment) {
      logPeiMaintenanceScheduleDebug('missing_appointment_id', { hasTargetId: true, targetId, mode: peiMaintenanceScheduleMode, hasDueDate: Boolean(appointmentDueDate), hasAppointmentId: false });
      setPeiMaintenancePanelMessage('Escolha uma sessão para vincular a sondagem.');
      return;
    }
    const scheduleMode = appointmentId ? 'APPOINTMENT' : isDateMode ? 'DATE' : 'NEXT_SESSION';
    const payload = {
      targetId,
      target_id: targetId,
      patient_id: patient?.id,
      patientId: patient?.id,
      mode: scheduleMode,
      dueDate: appointmentId ? appointmentDueDate : isDateMode ? peiMaintenanceScheduleDate : null,
      appointmentId: appointmentId || null,
      appointment_id: appointmentId || null,
      peiGoalId: row?.peiGoalId || row?.goalId || row?.goal_id || row?.source?.peiGoalId || row?.source?.goalId || row?.source?.goal_id || null,
      goalId: row?.goalId || row?.goal_id || row?.peiGoalId || row?.source?.goalId || row?.source?.goal_id || row?.source?.peiGoalId || null,
      goal_id: row?.goal_id || row?.goalId || row?.peiGoalId || row?.source?.goal_id || row?.source?.goalId || row?.source?.peiGoalId || null,
      skillId: row?.skillId || row?.skill_id || row?.source?.skillId || row?.source?.skill_id || null,
      skill_id: row?.skill_id || row?.skillId || row?.source?.skill_id || row?.source?.skillId || null,
      localTargetRef: row?.localTargetRef || row?.source?.localTargetRef || row?.source?.id || row?.goal?.id || null,
      target_name: row?.targetName || row?.name,
      protocolName: row?.protocol || row?.protocolName || null,
      domainName: row?.domain || row?.domainName || null
    };
    logPeiMaintenanceScheduleDebug('submit', { hasTargetId: true, targetId, mode: scheduleMode, hasDueDate: Boolean(payload.dueDate), hasAppointmentId: Boolean(appointmentId) });
    const successMessage = existingScheduleId
      ? 'Agendamento de manutenção atualizado.'
      : appointmentId
        ? 'Sondagem atribuída à sessão.'
        : isDateMode
          ? 'Sondagem de manutenção agendada para a data escolhida.'
          : 'Sondagem aguardando futura sessão.';
    void runPeiMaintenanceAction(
      `schedule-${row?.key || targetId}`,
      async () => {
        const result = existingScheduleId
          ? await dataService.updateMaintenanceSchedule(existingScheduleId, payload)
          : await dataService.createMaintenanceScheduleForTarget(targetId, payload);
        return result?.success === false ? result : { ...result, message: successMessage };
      },
      successMessage,
      row
    ).then((ok) => {
      if (ok) {
        setPeiMaintenanceScheduleRow(null);
        setIsPeiMaintenanceCalendarOpen(false);
        setSelectedPeiMaintenanceAppointmentId('');
        setPeiMaintenanceScheduleDate('');
      }
    });
  };

  const handlePeiScheduleNextSession = async (row: any) => {
    let targetId = getPeiMaintenanceExplicitTargetId(row);
    let selectedRow = row;
    if (!targetId) {
      const ensuredSelection = await ensurePeiMaintenanceScheduleSelection(row);
      if (ensuredSelection) {
        selectedRow = ensuredSelection;
        targetId = getPeiMaintenanceExplicitTargetId(ensuredSelection);
      }
    }
    if (!targetId) {
      setPeiMaintenancePanelMessage('Não foi possível preparar esta habilidade para manutenção agora.');
      return;
    }
    void runPeiMaintenanceAction(
      `next-${selectedRow.key || targetId}`,
      () => dataService.scheduleMaintenanceForNextSession(targetId, {
        patient_id: patient?.id,
        patientId: patient?.id,
        scheduleMode: 'NEXT_PATIENT_SESSION',
        peiGoalId: selectedRow?.peiGoalId || selectedRow?.goalId || selectedRow?.goal_id || selectedRow?.source?.peiGoalId || selectedRow?.source?.goalId || selectedRow?.source?.goal_id || null,
        goalId: selectedRow?.goalId || selectedRow?.goal_id || selectedRow?.peiGoalId || selectedRow?.source?.goalId || selectedRow?.source?.goal_id || selectedRow?.source?.peiGoalId || null,
        goal_id: selectedRow?.goal_id || selectedRow?.goalId || selectedRow?.peiGoalId || selectedRow?.source?.goal_id || selectedRow?.source?.goalId || selectedRow?.source?.peiGoalId || null,
        skillId: selectedRow?.skillId || selectedRow?.skill_id || selectedRow?.source?.skillId || selectedRow?.source?.skill_id || null,
        skill_id: selectedRow?.skill_id || selectedRow?.skillId || selectedRow?.source?.skill_id || selectedRow?.source?.skillId || null,
        localTargetRef: selectedRow?.localTargetRef || selectedRow?.source?.localTargetRef || selectedRow?.source?.id || selectedRow?.goal?.id || null,
        target_name: selectedRow?.targetName || selectedRow?.name
      }),
      'Sondagem aguardando futura sessão.'
    );
  };

  const handlePeiEditScheduledMaintenance = (row: any) => {
    openPeiMaintenanceScheduleModal(row, 'CUSTOM_DATE');
  };

  const handlePeiCancelScheduledMaintenance = (row: any) => {
    const schedule = getPeiMaintenanceScheduleObject(row);
    const scheduleId = getPeiMaintenanceScheduleId(schedule) || getPersistedMaintenanceScheduleId(row?.scheduleId || row?.schedule_id, row);
    if (!scheduleId) {
      setPeiMaintenancePanelMessage('Sondagem de manutenção inválida para cancelamento.');
      return;
    }
    if (!window.confirm('Cancelar esta sondagem de manutenção?')) return;
    void runPeiMaintenanceAction(
      `cancel-${scheduleId}`,
      () => dataService.cancelMaintenanceSchedule(scheduleId),
      'Sondagem de manutenção cancelada.'
    );
  };

  const handlePeiMoveScheduledMaintenanceToNextSession = (row: any) => {
    const schedule = getPeiMaintenanceScheduleObject(row);
    const scheduleId = getPeiMaintenanceScheduleId(schedule) || getPersistedMaintenanceScheduleId(row?.scheduleId || row?.schedule_id, row);
    if (!scheduleId) {
      setPeiMaintenancePanelMessage('Sondagem de manutenção inválida para edição.');
      return;
    }
    void runPeiMaintenanceAction(
      `move-next-${scheduleId}`,
      () => dataService.updateMaintenanceSchedule(scheduleId, { mode: 'NEXT_SESSION' }),
      'Sondagem aguardando futura sessão.'
    );
  };

  const handlePeiRemoveScheduledMaintenanceAppointmentLink = (row: any) => {
    const schedule = getPeiMaintenanceScheduleObject(row);
    const scheduleId = getPeiMaintenanceScheduleId(schedule) || getPersistedMaintenanceScheduleId(row?.scheduleId || row?.schedule_id, row);
    const appointmentId = getPersistedUuid(schedule?.appointment_id || schedule?.appointmentId);
    if (!scheduleId) {
      setPeiMaintenancePanelMessage('Não foi possível remover o vínculo desta sondagem.');
      return;
    }
    void runPeiMaintenanceAction(
      `unlink-${scheduleId}`,
      () => dataService.skipMaintenanceScheduleLink(scheduleId, appointmentId ? { appointmentId } : {}),
      'Sondagem sem sessão vinculada.'
    );
  };

  const handlePeiViewScheduledMaintenanceAppointment = (row: any) => {
    const schedule = getPeiMaintenanceScheduleObject(row);
    setPeiMaintenancePanelMessage(formatPeiMaintenanceAppointmentScheduleLine(schedule));
  };

  const handlePeiConfirmCandidateLink = (row: any) => {
    const schedule = row?.nextSchedule;
    const scheduleId = getPeiMaintenanceScheduleId(schedule) || getPersistedMaintenanceScheduleId(row?.scheduleId || row?.schedule_id, row);
    const appointmentId = getPeiMaintenanceCandidateAppointmentId(schedule);
    if (!scheduleId) {
      setPeiMaintenancePanelMessage('Sondagem de manutenção inválida. Revise o vínculo antes de confirmar.');
      return;
    }
    if (!appointmentId) {
      setPeiMaintenanceAssignSchedule(schedule || null);
    setPeiMaintenancePanelMessage('Escolha uma sessão antes de confirmar o vínculo.');
      return;
    }
    void runPeiMaintenanceAction(
      `confirm-${row.key}`,
      () => dataService.confirmMaintenanceScheduleLink(scheduleId, { appointmentId, appointment_id: appointmentId }),
      'Vinculo confirmado.'
    );
  };

  const handlePeiSkipCandidateLink = (row: any) => {
    const schedule = row?.nextSchedule;
    const scheduleId = getPeiMaintenanceScheduleId(schedule);
    if (!scheduleId) {
      setPeiMaintenancePanelMessage('Sondagem de manutenção inválida. Revise o vínculo antes de fazer depois.');
      return;
    }
    void runPeiMaintenanceAction(
      `skip-${row.key}`,
      () => dataService.skipMaintenanceScheduleLink(scheduleId, {
        appointmentId: getPeiMaintenanceCandidateAppointmentId(schedule) || undefined
      }),
      'Sondagem mantida para depois.'
    );
  };

  const openPeiMaintenanceAssignModal = (row: any) => {
    const schedule = row?.nextSchedule || row?.schedules?.find?.((item: any) => getPeiMaintenanceScheduleId(item)) || null;
    const targetId = getPeiMaintenanceTargetId(row);
    if (!targetId) {
      setPeiMaintenancePanelMessage('Vincule esta sondagem a uma habilidade antes de atribuir a uma sessão.');
      return;
    }
    setPeiMaintenanceAssignSchedule({
      ...(schedule || {}),
      key: row?.key,
      target_id: schedule?.target_id || schedule?.targetId || targetId,
      targetId,
      targetName: row?.targetName
    });
    setSelectedPeiMaintenanceAppointmentId('');
    setPeiMaintenancePanelMessage('');
  };

  const handlePeiAssignToAppointment = () => {
    const scheduleId = getPeiMaintenanceScheduleId(peiMaintenanceAssignSchedule);
    const targetId = getPersistedUuid(peiMaintenanceAssignSchedule?.target_id || peiMaintenanceAssignSchedule?.targetId);
    const appointmentId = getPersistedUuid(selectedPeiMaintenanceAppointmentId);
    if (!scheduleId && !targetId) {
      setPeiMaintenancePanelMessage('Vincule esta sondagem a uma habilidade antes de atribuir a uma sessão.');
      return;
    }
    if (!appointmentId) {
      setPeiMaintenancePanelMessage('Escolha uma sessão antes de confirmar o vínculo.');
      return;
    }
    const actionKey = peiMaintenanceAssignSchedule?.key || scheduleId || targetId;
    void runPeiMaintenanceAction(
      `assign-${actionKey}`,
      async () => {
        if (scheduleId) {
          return dataService.assignMaintenanceScheduleToAppointment(scheduleId, { appointmentId, appointment_id: appointmentId });
        }
        const result = await dataService.createMaintenanceScheduleForTarget(targetId, {
          patient_id: patient?.id,
          patientId: patient?.id,
          scheduleMode: 'CUSTOM_DATE',
          appointmentId,
          appointment_id: appointmentId,
          target_name: peiMaintenanceAssignSchedule?.targetName || peiMaintenanceAssignSchedule?.target_name
        });
        return result?.success === false ? result : { ...result, message: 'Sondagem atribuída à sessão.' };
      },
      'Sondagem atribuída à sessão.'
    ).then((ok) => {
      if (ok) {
        setPeiMaintenanceAssignSchedule(null);
        setSelectedPeiMaintenanceAppointmentId('');
      }
    });
  };

  const handlePeiWaitNextSessionFromModal = () => {
    const scheduleId = getPeiMaintenanceScheduleId(peiMaintenanceAssignSchedule);
    const targetId = getPersistedUuid(peiMaintenanceAssignSchedule?.target_id || peiMaintenanceAssignSchedule?.targetId);
    if (targetId) {
      void runPeiMaintenanceAction(
        `wait-${scheduleId || targetId}`,
        () => dataService.scheduleMaintenanceForNextSession(targetId, {
          patient_id: patient?.id,
          patientId: patient?.id,
          scheduleMode: 'NEXT_PATIENT_SESSION',
          target_name: peiMaintenanceAssignSchedule?.targetName || peiMaintenanceAssignSchedule?.target_name
        }),
        'Sondagem aguardando futura sessão.'
      ).then((ok) => {
        if (ok) setPeiMaintenanceAssignSchedule(null);
      });
    } else if (scheduleId) {
      void runPeiMaintenanceAction(
        `wait-${scheduleId}`,
        () => dataService.skipMaintenanceScheduleLink(scheduleId, {}),
        'Sondagem mantida para depois.'
      ).then((ok) => {
        if (ok) setPeiMaintenanceAssignSchedule(null);
      });
    } else {
      setPeiMaintenancePanelMessage('Sondagem de manutenção inválida. Revise o vínculo antes de adiar.');
      setPeiMaintenanceAssignSchedule(null);
    }
  };

  const openPeiMaintenanceReviewModal = (row: any) => {
    setPeiMaintenanceReviewRow(row);
    setPeiMaintenanceReviewTargetId(getPeiMaintenanceTargetId(row));
    setPeiMaintenancePanelMessage('');
  };

  const handlePeiReviewTargetSave = () => {
    const row = peiMaintenanceReviewRow;
    const schedule = row?.nextSchedule || row?.schedules?.find?.((item: any) => getPeiMaintenanceScheduleId(item)) || null;
    const scheduleId = getPeiMaintenanceScheduleId(schedule);
    const targetId = getPersistedUuid(peiMaintenanceReviewTargetId);
    if (!scheduleId) {
      setPeiMaintenancePanelMessage('Esta sondagem precisa ser vinculada a uma habilidade real antes de ser agendada.');
      return;
    }
    if (!targetId) {
      setPeiMaintenancePanelMessage('Escolha uma habilidade real do PEI antes de salvar o vínculo.');
      return;
    }
    void runPeiMaintenanceAction(
      `review-${row?.key || scheduleId}`,
      () => dataService.relinkMaintenanceScheduleTarget(scheduleId, { targetId, target_id: targetId }),
      'Vínculo da habilidade atualizado.'
    ).then((ok) => {
      if (ok) {
        setPeiMaintenanceReviewRow(null);
        setPeiMaintenanceReviewTargetId('');
      }
    });
  };

  const getPeiMaintenanceTargetOptions = () => {
    const byId = new Map<string, { id: string; label: string; detail: string; status: string }>();
    const addTargetOption = (target: any) => {
      const id = getPersistedUuid(target?.id || target?.target_id || target?.targetId || target?.aba_target_id || target?.abaTargetId);
      if (!id || byId.has(id)) return;
      const display = resolveMaintenanceTargetDisplay({ target, schedule: target });
      const label = safeDisplayValue(
        display.targetDisplayName || target?.name || target?.target_name || target?.targetName || target?.title,
        'Habilidade sem nome'
      );
      const detail = [display.protocolDisplayName, display.domainDisplayName]
        .filter((value) => value && !String(value).startsWith('Sem '))
        .join(' - ');
      byId.set(id, {
        id,
        label,
        detail: detail || 'PEI do paciente',
        status: safeDisplayValue(target?.clinical_status || target?.clinicalStatus || target?.status || target?.phase, 'Status nao informado')
      });
    };
    peiMaintenanceHydratedGoals.forEach(addTargetOption);
    peiMaintenanceLinkableTargets.forEach(addTargetOption);
    const currentTargetId = getPeiMaintenanceTargetId(peiMaintenanceReviewRow);
    if (currentTargetId) {
      addTargetOption({
        id: currentTargetId,
        name: peiMaintenanceReviewRow?.targetName,
        protocol_title: peiMaintenanceReviewRow?.protocol,
        domain_name: peiMaintenanceReviewRow?.domain,
        status: peiMaintenanceReviewRow?.statusLabel
      });
    }
    return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  };

  const renderPeiMaintenanceMetric = (label: string, value: number) => (
    <div className={`rounded-2xl border p-4 ${isPanelDark ? 'bg-slate-900/50 border-slate-700' : 'bg-white border-slate-100'}`}>
      <p className={`text-xs font-medium ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>{value}</p>
    </div>
  );

  const renderPeiMaintenanceActions = (row: any, options: { technical?: boolean } = {}) => {
    if (!canManagePeiMaintenance) return null;
    const group = row?.group as PeiMaintenanceGroupKey;
    const targetId = getPeiMaintenanceTargetId(row);
    const scheduleId = getPeiMaintenanceScheduleId(row?.nextSchedule) || getPersistedMaintenanceScheduleId(row?.scheduleId || row?.schedule_id, row);
    const hasRealTarget = Boolean(row?.hasRealTarget ?? targetId);
    const hasRealSchedule = Boolean(scheduleId);
    const hasMissingTargetLabel = /habilidade\s+(nao|não)\s+(vinculada|encontrada)/i.test(String(row?.targetName || ''));
    const needsTargetReview = Boolean(row?.needsTargetReview ?? (!hasRealTarget || row?.targetMissing || row?.nextSchedule?.target_missing || hasMissingTargetLabel));
    const canReviewLink = Boolean(row?.canReviewLink ?? needsTargetReview);
    const canScheduleMaintenance = Boolean(row?.canScheduleMaintenance ?? (hasRealTarget && !needsTargetReview));
    const canWaitNextSession = Boolean(row?.canWaitNextSession ?? (hasRealTarget && !needsTargetReview));
    const canAssignAppointment = Boolean(row?.canAssignAppointment ?? (hasRealTarget && !needsTargetReview && (hasRealSchedule || row?.nextProbe?.status === 'NO_SCHEDULE')));
    const needsReview = canReviewLink || (group !== 'completed' && !hasRealSchedule && !hasRealTarget);
    const actionLoading = (actionName: string) =>
      peiMaintenanceActionKey === `${actionName}-${row.key}` ||
      (scheduleId && peiMaintenanceActionKey === `${actionName}-${scheduleId}`) ||
      Boolean(peiMaintenanceActionKey && peiMaintenanceActionKey.endsWith(String(row.key)));
    const buttonClass = `min-h-[40px] rounded-xl px-3 py-2 text-xs font-semibold transition-all disabled:opacity-60 ${isPanelDark ? 'bg-slate-800 text-slate-100 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`;
    const primaryClass = 'min-h-[40px] rounded-xl bg-[#7a32fc] px-3 py-2 text-xs font-semibold text-white transition-all hover:opacity-90 disabled:opacity-60';

    if (options.technical) {
      return (
        <div className="mt-4 flex flex-wrap gap-2">
          {needsReview && (
            <button type="button" onClick={() => openPeiMaintenanceReviewModal(row)} className={`inline-flex min-h-[40px] items-center rounded-xl px-3 py-2 text-xs font-semibold ${isPanelDark ? 'bg-amber-500/10 text-amber-100 hover:bg-amber-500/20' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>
              Revisar vínculo
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="mt-4 flex flex-wrap gap-2">
        {needsReview && (
          <button type="button" onClick={() => openPeiMaintenanceReviewModal(row)} className={`inline-flex min-h-[40px] items-center rounded-xl px-3 py-2 text-xs font-semibold ${isPanelDark ? 'bg-amber-500/10 text-amber-100 hover:bg-amber-500/20' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>
            Revisar vínculo
          </button>
        )}
        {!needsReview && group !== 'completed' && (
          <button type="button" disabled={actionLoading('schedule') || !canScheduleMaintenance} title={!canScheduleMaintenance ? 'Vincule esta sondagem a uma habilidade real antes de agendar.' : undefined} onClick={() => handlePeiCreateMaintenancePlan(row)} className={primaryClass}>
            {actionLoading('schedule') ? 'Agendando...' : 'Agendar manutenção'}
          </button>
        )}
        {!needsReview && group !== 'completed' && group !== 'confirmation' && (
          <button type="button" disabled={actionLoading('next') || !canWaitNextSession} title={!canWaitNextSession ? 'Vincule esta sondagem a uma habilidade real antes de agendar.' : undefined} onClick={() => handlePeiScheduleNextSession(row)} className={buttonClass}>
            {actionLoading('next') ? 'Atualizando...' : 'Aguardar futura sessão'}
          </button>
        )}
        {group === 'confirmation' && (
          <>
            <button type="button" disabled={actionLoading('confirm') || !hasRealSchedule || needsTargetReview} title={needsTargetReview || !hasRealSchedule ? 'Revise o vínculo antes de confirmar.' : undefined} onClick={() => handlePeiConfirmCandidateLink(row)} className={primaryClass}>
              {actionLoading('confirm') ? 'Confirmando...' : 'Confirmar vinculo'}
            </button>
            <button type="button" disabled={actionLoading('skip') || !hasRealSchedule} title={!hasRealSchedule ? 'Revise o vínculo antes de fazer depois.' : undefined} onClick={() => handlePeiSkipCandidateLink(row)} className={buttonClass}>
              {actionLoading('skip') ? 'Atualizando...' : 'Fazer depois'}
            </button>
          </>
        )}
        {!needsReview && group !== 'completed' && group !== 'confirmation' && (
          <button type="button" disabled={actionLoading('assign') || !canAssignAppointment} title={!canAssignAppointment ? 'Vincule esta sondagem a uma habilidade real antes de atribuir.' : undefined} onClick={() => openPeiMaintenanceAssignModal(row)} className={buttonClass}>
            Atribuir a uma sessão
          </button>
        )}
        {!needsReview && group !== 'completed' && group !== 'confirmation' && (
          <button type="button" disabled={actionLoading('date') || !canScheduleMaintenance} title={!canScheduleMaintenance ? 'Vincule esta sondagem a uma habilidade real antes de escolher data.' : undefined} onClick={() => openPeiMaintenanceScheduleModal(row, 'CUSTOM_DATE')} className={buttonClass}>
            Escolher data
          </button>
        )}
        {!needsReview && group !== 'completed' && group !== 'confirmation' && (
          <button type="button" disabled={actionLoading('plan') || !canScheduleMaintenance} title={!canScheduleMaintenance ? 'Vincule esta sondagem a uma habilidade real antes de criar plano.' : undefined} onClick={() => openPeiMaintenanceScheduleModal(row, 'DEFAULT_SEQUENCE')} className={buttonClass}>
            Plano de manutenção
          </button>
        )}
      </div>
    );
  };

  const renderPeiMaintenanceRow = (row: any, options: { technical?: boolean } = {}) => {
    const lastResult = row?.lastResult || null;
    const accuracy = lastResult?.accuracy_percent ?? lastResult?.accuracyPercent;
    const independence = lastResult?.independence_percent ?? lastResult?.independencePercent;
    const rowNeedsTargetReview = Boolean(row?.needsTargetReview ?? (!getPeiMaintenanceTargetId(row) || row?.targetMissing || row?.nextSchedule?.target_missing));
    const displayTargetName = options.technical
      ? 'Sondagem sem habilidade vinculada'
      : rowNeedsTargetReview
        ? 'Habilidade não vinculada'
        : row.targetName;
    const rowClinicalContext = options.technical
      ? 'Resultado e ciclo preservados; revise o vínculo para associar a uma habilidade real do PEI.'
      : rowNeedsTargetReview
        ? 'Esta sondagem antiga precisa ser associada a uma habilidade real.'
      : row.group === 'completed'
        ? 'Habilidade mantida.'
        : row.group === 'overdue'
          ? 'Sondagem atrasada.'
          : row.cardKind === 'TARGET_REAL_SEM_SCHEDULE' || row?.nextProbe?.status === 'NO_SCHEDULE'
            ? 'Sem sondagem de manutencao agendada.'
            : row.group === 'unlinked'
              ? 'Sondagem aguardando futura sessão.'
                : row.group === 'activeCycle'
                  ? 'Plano de manutencao em andamento.'
                  : `${row.protocol} - ${row.domain}`;
    const cycleLabel = row?.hasCycle
      ? `Plano de manutencao: ${row.completedCount}/${row.totalCycleCount || 4} concluido`
      : 'Sem ciclo completo registrado';
    return (
      <div key={row.key} className={`rounded-2xl border ${options.technical ? 'p-3 shadow-none' : 'p-4 shadow-sm'} ${isPanelDark ? 'bg-[#101b2e] border-slate-700' : 'bg-white border-slate-100'}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${row.isRegressionRisk ? 'bg-red-50 text-red-700' : row.isMaintained ? 'bg-emerald-50 text-emerald-700' : 'bg-violet-50 text-[#7a32fc]'}`}>
                {row.statusLabel}
              </span>
              {row.group === 'confirmation' && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">Pendente de confirmacao</span>}
            </div>
            <h4 className={`mt-2 text-base font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>{displayTargetName}</h4>
            {!options.technical && (
              <p className={`mt-1 text-xs font-semibold ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
                {[row.protocol, row.domain].filter(Boolean).join(' · ') || 'PEI do paciente'}
              </p>
            )}
            <p className={`mt-1 text-xs ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
              {rowClinicalContext}
            </p>
          </div>
          <div className={`rounded-2xl px-3 py-2 text-xs font-semibold ${isPanelDark ? 'bg-slate-900/70 text-slate-200' : 'bg-slate-50 text-slate-600'}`}>
            {formatPeiMaintenanceScheduleLabel(row.nextSchedule)}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className={`rounded-xl p-3 text-xs ${isPanelDark ? 'bg-slate-900/60 text-slate-300' : 'bg-slate-50 text-slate-600'}`}>
            <span className="font-semibold">Proximo probe</span>
            <p className="mt-1">{formatPeiMaintenanceScheduleLabel(row.nextSchedule)}</p>
          </div>
          <div className={`rounded-xl p-3 text-xs ${isPanelDark ? 'bg-slate-900/60 text-slate-300' : 'bg-slate-50 text-slate-600'}`}>
            <span className="font-semibold">Ciclo atual</span>
            <p className="mt-1">{cycleLabel}</p>
          </div>
          <div className={`rounded-xl p-3 text-xs ${isPanelDark ? 'bg-slate-900/60 text-slate-300' : 'bg-slate-50 text-slate-600'}`}>
            <span className="font-semibold">Resultado recente</span>
            <p className="mt-1">
              {lastResult ? `${accuracy ?? 0}% acuracia - ${independence ?? 0}% independencia` : 'Sem probe concluido'}
            </p>
          </div>
        </div>
        {row.activeAlert && (
          <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
            {row.isRegressionRisk ? 'Risco de regressao' : 'Atencao'}: {safeDisplayValue(row.activeAlert?.message, 'Acompanhar proximos probes.')}
          </div>
        )}
        {renderPeiMaintenanceActions(row, options)}
      </div>
    );
  };

  const renderPeiMaintenanceGroup = (key: PeiMaintenanceTargetFirstGroupKey, title: string, empty: string, description = '') => {
    const rows = peiMaintenanceTargetFirstGroups[key] || [];
    const technical = key === 'technical';
    const shouldCollapseTechnical = technical && rows.length > 3 && !isPeiMaintenanceTechnicalExpanded;
    const visibleRows = shouldCollapseTechnical ? rows.slice(0, 3) : rows;
    return (
      <section className={`space-y-3 ${technical ? 'pt-2' : ''}`}>
        <div className="flex items-center justify-between">
          <h4 className={`text-sm font-semibold ${isPanelDark ? 'text-slate-100' : 'text-slate-800'}`}>{title}</h4>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isPanelDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>{rows.length}</span>
        </div>
        {description && (
          <p className={`text-xs ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>{description}</p>
        )}
        {rows.length > 0 ? visibleRows.map((row: any) => renderPeiMaintenanceRow(row, { technical })) : (
          <p className={`rounded-2xl border p-4 text-sm ${isPanelDark ? 'border-slate-700 bg-slate-900/40 text-slate-400' : 'border-slate-100 bg-slate-50 text-slate-500'}`}>{empty}</p>
        )}
        {technical && rows.length > 3 && (
          <button
            type="button"
            onClick={() => setIsPeiMaintenanceTechnicalExpanded((value) => !value)}
            className={`min-h-[40px] rounded-xl px-3 py-2 text-xs font-semibold ${isPanelDark ? 'bg-slate-800 text-slate-100 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
          >
            {isPeiMaintenanceTechnicalExpanded ? 'Recolher pendências técnicas' : `Mostrar ${rows.length - visibleRows.length} pendência(s) técnica(s)`}
          </button>
        )}
      </section>
    );
  };

  const renderPeiMaintenancePanel = () => {
    const renderScheduledRow = (row: any, fallbackStatus: string) => {
      const title = safeDisplayValue(row?.targetName || row?.name, 'Habilidade sem nome');
      const protocol = safeDisplayValue(row?.protocol || row?.protocolName, '');
      const domain = safeDisplayValue(row?.domain || row?.domainName, '');
      const schedule = getPeiMaintenanceScheduleObject(row);
      const scheduleId = getPeiMaintenanceScheduleId(schedule) || getPersistedMaintenanceScheduleId(row?.scheduleId || row?.schedule_id, row);
      const appointmentId = getPersistedUuid(schedule?.appointment_id || schedule?.appointmentId);
      const display = getPeiMaintenanceScheduleDisplay(row, fallbackStatus);
      const isWaiting = display.tone === 'amber' && !appointmentId;
      const isLinkedToAppointment = Boolean(appointmentId);
      const actionLoading = (actionName: string) => Boolean(scheduleId && peiMaintenanceActionKey === `${actionName}-${scheduleId}`);
      const badgeClass = display.tone === 'amber'
        ? isPanelDark ? 'bg-amber-500/15 text-amber-100 border-amber-300/30' : 'bg-amber-50 text-amber-700 border-amber-200'
        : display.tone === 'violet'
          ? isPanelDark ? 'bg-violet-500/15 text-violet-100 border-violet-300/30' : 'bg-violet-50 text-violet-700 border-violet-200'
          : isPanelDark ? 'bg-emerald-500/15 text-emerald-100 border-emerald-300/30' : 'bg-emerald-50 text-emerald-700 border-emerald-200';
      const buttonClass = `inline-flex min-h-[36px] items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all disabled:opacity-60 ${isPanelDark ? 'bg-slate-800 text-slate-100 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`;
      const dangerClass = `inline-flex min-h-[36px] items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all disabled:opacity-60 ${isPanelDark ? 'bg-rose-500/10 text-rose-100 hover:bg-rose-500/20' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'}`;
      return (
        <div key={row?.key || scheduleId || title} className={`rounded-2xl border p-4 ${row?.duplicateSchedule ? isPanelDark ? 'border-amber-400/30 bg-[#101b2e]' : 'border-amber-200 bg-white' : isPanelDark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-100 bg-white'}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h5 className={`text-sm font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>{title}</h5>
              <p className={`mt-1 text-xs ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>{[protocol, domain].filter(Boolean).join(' · ') || 'PEI do paciente'}</p>
              <p className={`mt-2 text-xs font-semibold ${isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}>{display.line}</p>
              {row?.duplicateSchedule && (
                <p className={`mt-2 rounded-xl border px-3 py-2 text-xs font-semibold ${isPanelDark ? 'border-amber-300/20 bg-amber-500/10 text-amber-100' : 'border-amber-100 bg-amber-50 text-amber-700'}`}>
                  Há múltiplas sondagens ativas para esta habilidade.
                </p>
              )}
            </div>
            <span className={`inline-flex min-h-[32px] items-center rounded-xl border px-3 py-1.5 text-xs font-semibold ${badgeClass}`}>
              {display.badge}
            </span>
          </div>
          {canManagePeiMaintenance && (
            <div className="mt-4 flex flex-wrap gap-2">
              {row?.duplicateSchedule ? (
                <>
                  <button type="button" disabled={!scheduleId || actionLoading('cancel')} onClick={() => handlePeiCancelScheduledMaintenance(row)} className={dangerClass}>
                    <CheckCircle2 size={14} /> {actionLoading('cancel') ? 'Atualizando...' : 'Manter mais recente'}
                  </button>
                  <button type="button" disabled={!scheduleId || actionLoading('schedule')} onClick={() => handlePeiEditScheduledMaintenance(row)} className={buttonClass}>
                    <Edit size={14} /> Revisar agendamentos
                  </button>
                </>
              ) : (
                <>
                  <button type="button" disabled={!scheduleId || actionLoading('schedule')} onClick={() => handlePeiEditScheduledMaintenance(row)} className={buttonClass}>
                    <Edit size={14} /> {actionLoading('schedule') ? 'Abrindo...' : 'Editar agendamento'}
                  </button>
                  <button type="button" disabled={!scheduleId || actionLoading('cancel')} onClick={() => handlePeiCancelScheduledMaintenance(row)} className={dangerClass}>
                    <X size={14} /> {actionLoading('cancel') ? 'Cancelando...' : 'Cancelar sondagem'}
                  </button>
                  {!isWaiting && (
                    <button type="button" disabled={!scheduleId || actionLoading('move-next')} onClick={() => handlePeiMoveScheduledMaintenanceToNextSession(row)} className={buttonClass}>
                      <Clock size={14} /> {actionLoading('move-next') ? 'Atualizando...' : 'Mover para futura sessão'}
                    </button>
                  )}
                  {isLinkedToAppointment ? (
                    <>
                      <button type="button" onClick={() => handlePeiViewScheduledMaintenanceAppointment(row)} className={buttonClass}>
                        <Eye size={14} /> Ver sessão
                      </button>
                      <button type="button" disabled={!scheduleId || actionLoading('unlink')} onClick={() => handlePeiRemoveScheduledMaintenanceAppointmentLink(row)} className={buttonClass}>
                        <Calendar size={14} /> {actionLoading('unlink') ? 'Atualizando...' : 'Remover vínculo'}
                      </button>
                    </>
                  ) : !isWaiting && (
                    <>
                      <button type="button" disabled={!scheduleId || actionLoading('schedule')} onClick={() => handlePeiEditScheduledMaintenance(row)} className={buttonClass}>
                        <Calendar size={14} /> Editar data
                      </button>
                      <button type="button" disabled={!scheduleId || actionLoading('assign')} onClick={() => openPeiMaintenanceAssignModal(row)} className={buttonClass}>
                        <Calendar size={14} /> Vincular a uma sessão
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="space-y-4">
        <div>
          <h3 className={`text-lg font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>Manutenção</h3>
          <p className={`mt-1 text-sm ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>Habilidades adquiridas no Ensino, prontas para sondagem de manutenção.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {[
            ['Elegíveis', peiMaintenanceEligibleRows.length],
            ['Em manutenção', 0],
            ['Agendadas', peiMaintenanceScheduledRows.length],
            ['Aguardando sessão', peiMaintenanceWaitingRows.length],
          ].map(([label, value]) => (
            <div key={String(label)} className={`rounded-2xl border p-4 ${isPanelDark ? 'border-slate-700 bg-slate-900/50' : 'border-slate-100 bg-white'}`}>
              <p className={`text-xs font-medium ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>{label}</p>
              <p className={`mt-1 text-2xl font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>{value}</p>
            </div>
          ))}
        </div>
        {peiMaintenancePanelMessage && (
          <div className={`rounded-2xl border p-4 text-sm font-semibold ${isPanelDark ? 'border-violet-400/30 bg-violet-500/10 text-violet-100' : 'border-violet-100 bg-violet-50 text-violet-700'}`}>
            {peiMaintenancePanelMessage}
          </div>
        )}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className={`text-sm font-semibold ${isPanelDark ? 'text-slate-100' : 'text-slate-800'}`}>Habilidades elegíveis para manutenção</h4>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isPanelDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>{peiMaintenanceEligibleRows.length}</span>
          </div>
          {shouldShowPeiMaintenancePanelLoading ? (
            <p className={`rounded-2xl border p-5 text-sm ${isPanelDark ? 'border-slate-700 bg-slate-900/40 text-slate-400' : 'border-slate-100 bg-slate-50 text-slate-500'}`}>
              Carregando manutenção persistida...
            </p>
          ) : peiMaintenanceEligibleRows.length === 0 ? (
            <p className={`rounded-2xl border p-5 text-sm ${isPanelDark ? 'border-slate-700 bg-slate-900/40 text-slate-400' : 'border-slate-100 bg-slate-50 text-slate-500'}`}>
              Nenhuma habilidade adquirida no Ensino no momento.
            </p>
          ) : (
            <div className="space-y-3">
              {peiMaintenanceEligibleRows.map((goal: any) => {
                const scheduleActionKey = `schedule-${goal?.key || getPeiMaintenanceTargetId(goal)}`;
                const cannotScheduleTooltip = !canManagePeiMaintenance
                  ? 'Você não tem permissão para agendar manutenção.'
                  : undefined;
                const goalName = safeDisplayValue(goal?.name || goal?.targetName, 'Habilidade sem nome');
                const goalProtocol = safeDisplayValue(goal?.protocol || goal?.protocolName, '');
                const goalDomain = safeDisplayValue(goal?.domain || goal?.domainName, '');
                const goalProgressPercent = Number.isFinite(Number(goal?.progressPercent)) ? Math.max(0, Math.min(100, Math.round(Number(goal.progressPercent)))) : 100;
                return (
                  <div key={goal.key} className={`rounded-2xl border p-5 shadow-sm ${isPanelDark ? 'border-emerald-400/40 bg-[#101b2e]' : 'border-emerald-200 bg-white'}`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <h4 className={`text-base font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>{goalName}</h4>
                        <p className={`mt-1 text-xs font-semibold ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
                          {[goalProtocol, goalDomain].filter(Boolean).join(' · ') || 'PEI do paciente'}
                        </p>
                        {goal.description && (
                          <p className={`mt-2 text-xs ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>{sanitizeDescriptionForDisplay(goal.description)}</p>
                        )}
                      </div>
                      <span className="inline-flex min-h-[34px] items-center justify-center rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-md shadow-emerald-200">
                        {goal.statusLabel}
                      </span>
                    </div>
                    {goalProgressPercent !== null && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-emerald-700">
                          <span>Progresso da meta</span>
                          <span>{goalProgressPercent}%</span>
                        </div>
                        <div className={`mt-2 h-3 overflow-hidden rounded-full ${isPanelDark ? 'bg-slate-800' : 'bg-emerald-100'}`}>
                          <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-green-500 to-teal-500" style={{ width: `${goalProgressPercent}%` }}></div>
                        </div>
                        <div className={`mt-3 inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-bold ${isPanelDark ? 'bg-emerald-500/10 text-emerald-100 border border-emerald-300/20' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                          <CheckCircle2 size={15} />
                          Status: Adquirido. Progresso: {goalProgressPercent}%.
                        </div>
                      </div>
                    )}
                    <div className="mt-4 flex justify-end">
                      <span className="w-full sm:w-auto" title={cannotScheduleTooltip}>
                        <button
                          type="button"
                          onClick={() => openPeiMaintenanceScheduleModal(goal, 'CUSTOM_DATE')}
                          disabled={Boolean(peiMaintenanceActionKey) || !canManagePeiMaintenance}
                          title={cannotScheduleTooltip}
                          aria-label={cannotScheduleTooltip || 'Agendar manutenção'}
                          className="min-h-[44px] w-full rounded-xl bg-[#7a32fc] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                        >
                          {peiMaintenanceActionKey === scheduleActionKey ? 'Agendando...' : 'Agendar manutenção'}
                        </button>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        {peiMaintenanceScheduledRows.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className={`text-sm font-semibold ${isPanelDark ? 'text-slate-100' : 'text-slate-800'}`}>Agendadas</h4>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isPanelDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>{peiMaintenanceScheduledRows.length}</span>
            </div>
            <div className="space-y-3">
              {peiMaintenanceScheduledRows.map((row: any) => renderScheduledRow(row, 'Sondagem agendada'))}
            </div>
          </section>
        )}
        {peiMaintenanceDuplicateScheduleRows.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className={`text-sm font-semibold ${isPanelDark ? 'text-slate-100' : 'text-slate-800'}`}>Agendamentos duplicados para revisão</h4>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isPanelDark ? 'bg-amber-500/10 text-amber-100' : 'bg-amber-50 text-amber-700'}`}>{peiMaintenanceDuplicateScheduleRows.length}</span>
            </div>
            <p className={`text-xs ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>O fluxo principal mostra somente o agendamento ativo mais recente por habilidade.</p>
            <div className="space-y-3">
              {peiMaintenanceDuplicateScheduleRows.map((row: any) => renderScheduledRow(row, 'Duplicado para revisão'))}
            </div>
          </section>
        )}
        {peiMaintenanceWaitingRows.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className={`text-sm font-semibold ${isPanelDark ? 'text-slate-100' : 'text-slate-800'}`}>Aguardando sessão</h4>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isPanelDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>{peiMaintenanceWaitingRows.length}</span>
            </div>
            <div className="space-y-3">
              {peiMaintenanceWaitingRows.map((row: any) => renderScheduledRow(row, 'Aguardando futura sessão'))}
            </div>
          </section>
        )}
      </div>
    );
  };

  const renderPeiGeneralizationPanel = () => (
    <div className="space-y-4">
      <div>
        <h3 className={`text-lg font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>Generalizacao</h3>
        <p className={`mt-1 text-sm ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>Habilidades mantidas que podem evoluir para outro ambiente, terapeuta, material ou familiar.</p>
      </div>
      {peiGeneralizationRows.length === 0 ? (
        <p className={`rounded-2xl border p-5 text-sm ${isPanelDark ? 'border-slate-700 bg-slate-900/40 text-slate-400' : 'border-slate-100 bg-slate-50 text-slate-500'}`}>Nenhuma habilidade pronta para generalização no momento.</p>
      ) : (
        <div className="space-y-3">
          {peiGeneralizationRows.map((row: any) => (
            <div key={row.key} className={`rounded-2xl border p-4 ${isPanelDark ? 'bg-[#101b2e] border-slate-700' : 'bg-white border-slate-100'}`}>
              <p className={`text-sm font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>{row.targetName}</p>
              <p className={`mt-1 text-xs ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>{row.protocol} - {row.domain}</p>
              <span className="mt-3 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">{row.statusLabel || 'Habilidade mantida'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderPeiHistoryPanel = () => (
    <div className="space-y-4">
      <div>
        <h3 className={`text-lg font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>Historico do PEI</h3>
        <p className={`mt-1 text-sm ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>Linha do tempo com eventos clinicos ja registrados.</p>
      </div>
      {peiHistoryEvents.length === 0 ? (
        <p className={`rounded-2xl border p-5 text-sm ${isPanelDark ? 'border-slate-700 bg-slate-900/40 text-slate-400' : 'border-slate-100 bg-slate-50 text-slate-500'}`}>Ainda nao ha historico estruturado do PEI para este paciente.</p>
      ) : (
        <div className="space-y-3">
          {peiHistoryEvents.map((event: any) => (
            <div key={event.id} className={`rounded-2xl border p-4 ${isPanelDark ? 'bg-[#101b2e] border-slate-700' : 'bg-white border-slate-100'}`}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className={`text-sm font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>{event.title}</p>
                  <p className={`mt-1 text-xs ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>{event.detail}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${isPanelDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
                  {event.date ? formatAbaDateTime(event.date) : event.source}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  useEffect(() => {
    if (isTutorialActive) {
      if (tutorialStep >= 6 && isKidsProfile && canAccessTab('plan')) setActiveTab('plan');
      else if (tutorialStep >= 0) setActiveTab('history');
    }
  }, [isTutorialActive, tutorialStep, isKidsProfile, allowedTabsSet]);

  useEffect(() => {
    if (isTutorialActive) {
      if (tutorialStep >= 19) setActiveTab('files');
      else if (tutorialStep >= 17 && isKidsProfile && canAccessTab('session')) setActiveTab(getSessionFallbackTab());
      else if (tutorialStep >= 14 && isKidsProfile && canAccessTab('plan')) setActiveTab('plan');
      else if (tutorialStep >= 11) setActiveTab('report');
      else if (tutorialStep >= 7) setActiveTab('notes');
      else if (tutorialStep >= 0) setActiveTab('history');
    }
  }, [isTutorialActive, tutorialStep, isKidsProfile, allowedTabsSet]);

  const renderHistoryTimelineControls = () => (
    <section
      className={`rounded-2xl border p-4 ${isPanelDark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-200 bg-white'}`}
      aria-label="Filtros da linha do tempo"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className={`mb-1.5 block text-xs font-medium ${isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}>Período da linha do tempo</span>
            <select
              value={historyPeriod}
              onChange={(event) => setHistoryPeriod(event.target.value as PatientHistoryPeriod)}
              className={`h-11 w-full rounded-xl border px-3 text-sm outline-none transition focus:border-[#7a32fc] focus:ring-2 focus:ring-[#7a32fc]/15 ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-700'}`}
            >
              <option value="all">Todo o histórico</option>
              <option value="30d">Últimos 30 dias</option>
              <option value="90d">Últimos 90 dias</option>
              <option value="180d">Últimos 6 meses</option>
              <option value="365d">Último ano</option>
              <option value="custom">Período personalizado</option>
            </select>
          </label>
          {historyPeriod === 'custom' && (
            <React.Fragment>
              <label className="block">
                <span className={`mb-1.5 block text-xs font-medium ${isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}>De</span>
                <input
                  type="date"
                  value={historyCustomFrom}
                  onChange={(event) => setHistoryCustomFrom(event.target.value)}
                  className={`h-11 w-full rounded-xl border px-3 text-sm outline-none transition focus:border-[#7a32fc] focus:ring-2 focus:ring-[#7a32fc]/15 ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-700'}`}
                />
              </label>
              <label className="block">
                <span className={`mb-1.5 block text-xs font-medium ${isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}>Até</span>
                <input
                  type="date"
                  value={historyCustomTo}
                  onChange={(event) => setHistoryCustomTo(event.target.value)}
                  className={`h-11 w-full rounded-xl border px-3 text-sm outline-none transition focus:border-[#7a32fc] focus:ring-2 focus:ring-[#7a32fc]/15 ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-700'}`}
                />
              </label>
            </React.Fragment>
          )}
        </div>
        <p className={`text-xs ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`} aria-live="polite">
          {historyPagination.loading
            ? 'Carregando registros...'
            : `${visibleHistoryWithFamilyNotes.length} registro${visibleHistoryWithFamilyNotes.length === 1 ? '' : 's'} carregado${visibleHistoryWithFamilyNotes.length === 1 ? '' : 's'}`}
        </p>
      </div>
      {!historyRange.ready && historyPeriod === 'custom' && (
        <p className="mt-3 text-sm text-amber-700">Informe uma data inicial e final válidas para consultar o período.</p>
      )}
      {historyPagination.error && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span>{historyPagination.error}</span>
          <button type="button" onClick={() => void requestPatientHistoryPage()} className="min-h-10 rounded-lg border border-rose-300 px-3 font-medium hover:bg-rose-100">
            Tentar novamente
          </button>
        </div>
      )}
      {historyPagination.offline && (
        <p className="mt-3 text-xs text-amber-700">Exibindo os registros disponíveis neste dispositivo. A paginação será retomada quando houver conexão.</p>
      )}
    </section>
  );

  return ( 
    <div className={`relative flex min-h-screen flex-col overflow-x-hidden transition-colors animate-slide-up ${isPanelDark ? 'bg-[#081324]' : 'bg-gray-50'}`}>
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: '-10000px',
          top: 0,
          width: '794px',
          background: '#ffffff',
          pointerEvents: 'none',
          zIndex: -1
        }}
      >
        <div ref={progressReportPdfRef}>
          <ProgressReportPDFLayout
            clinic={progressReportClinic}
            patient={{ name: patient?.name }}
            professional={progressReportProfessional}
            report={{
              type: 'Relatório de Progresso (comparativo)',
              periodLabel: progressReportPeriodLabel,
              generatedAt: new Date().toLocaleString('pt-BR'),
              comparisonKeys: progressReportComparisonKeys
            }}
            chartData={progressReportChartData}
            observations={progressReportObservations}
            additionalNote={reportAdditionalNote}
          />
        </div>
      </div>
      {(abaV2Enabled || abaV3UiEnabled) && isSessionModeOpen && (
        <SessionMode 
          patient={{ ...sessionModePatient, history: history.filter((h: any) => h.patientId === patient.id) }} 
          onClose={closeSessionMode} 
          onRecordTrial={onRecordTrial} 
          onDeleteHistoryItem={onDeleteHistoryItem}
          onUpdateHistoryItem={onEvaluateHistoryItem}
          activeSession={requestedSessionReportId
            ? {
                id: requestedSessionReportId,
                status: 'completed',
                patientId: patient?.id || null,
                patient_id: patient?.id || null,
                clinicId: resolvedClinicContext?.clinicId || clinicContext?.clinicId || patient?.clinicId || patient?.clinic_id || null,
                clinic_id: resolvedClinicContext?.clinicId || clinicContext?.clinicId || patient?.clinicId || patient?.clinic_id || null
              }
            : activeSession}
          reviewSessionId={requestedSessionReportId}
          openCompletedReport={Boolean(requestedSessionReportId)}
          remainingSeconds={requestedSessionReportId ? 0 : remainingSessionSeconds}
          formatCountdown={formatSessionCountdown}
          onConfirmEndSession={handleConfirmSessionEnd}
          onSessionSummaryPersisted={applySessionMasterySummaryToPei}
          onMasteryPreviewChanged={setAbaMasteryPreviewEvaluations}
          onSessionRecordSaved={incrementActiveSessionRecordCount}
          therapistId={resolvedClinicContext?.userId || clinicContext?.userId || null}
          therapistName={resolvedClinicContext?.professionalName || resolvedClinicContext?.userName || clinicContext?.professionalName || clinicContext?.userName || patient?.therapistName || patient?.therapist_name || null}
          clinicId={resolvedClinicContext?.clinicId || clinicContext?.clinicId || patient?.clinicId || patient?.clinic_id || null}
        />
      )}
      {isTutorialActive && ( 
        <TutorialOverlay 
          steps={[
            { targetId: 'back-btn', title: 'Voltar', content: 'Clique aqui para retornar à página anterior.', placement: 'bottom' },
            { targetId: 'patient-header-info', title: 'Informações do Paciente', content: 'Aqui você vê o nome, categoria (Criança/Adulto) e acessa o WhatsApp ou Ficha de Anamnese.', placement: 'bottom' },
            { targetId: 'tab-nav', title: 'Navegação por Abas', content: 'O prontuário é organizado em abas para facilitar o acesso a diferentes tipos de informação.', placement: 'bottom' },
            { targetId: 'tab-history', title: 'Aba Histórico', content: 'Veja a evolução clínica e o histórico de todas as atividades realizadas pelo paciente.', placement: 'bottom' },
            { targetId: 'history-filters', title: 'Evolução clínica', content: 'Escolha o protocolo para acompanhar a evolução e comparar os domínios avaliados.', placement: 'bottom' },
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
            <button
              onClick={() => setShowConfirmation(false)}
              className="w-full py-3 bg-slate-900 rounded-xl font-semibold text-white hover:bg-slate-800 transition-colors shadow-sm"
            >
              Fechar
            </button> 
          </div> 
        </div> 
      )} 
      {showSessionStartConfirm && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[120] flex items-start justify-center p-4 pt-6 sm:pt-10 bg-black/30 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-[#101b2e] rounded-[32px] p-7 shadow-2xl max-h-[calc(100vh-2rem)] max-w-md w-full overflow-y-auto animate-pop border border-violet-100 dark:border-violet-500/30">
            <div className="w-14 h-14 bg-[#7a32fc]/10 rounded-2xl flex items-center justify-center mb-5 text-[#7a32fc]">
              <Clock size={28} />
            </div>
            <h3 className="text-2xl font-semibold text-gray-900 dark:text-slate-50 mb-2">Iniciar sessão?</h3>
            <p className="text-sm text-gray-500 dark:text-slate-300 leading-relaxed mb-5">
              A contagem regressiva começa agora e continuará ativa mesmo se você abrir outras abas deste paciente.
            </p>
            <label className="block text-[10px] font-semibold text-gray-400 dark:text-slate-400 uppercase tracking-widest mb-2">
              Tempo da sessão em minutos
            </label>
            <input
              type="number"
              min={5}
              max={240}
              value={sessionDurationInput}
              onChange={(event) => setSessionDurationInput(event.target.value)}
              className="w-full bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl px-4 py-3 text-lg font-semibold text-gray-800 dark:text-slate-50 outline-none focus:border-[#7a32fc]"
            />
            {isKidsProfile && (
              <div className="my-5 space-y-3">
                <label className="flex items-start gap-3 rounded-2xl border border-violet-100 bg-violet-50/70 p-4 dark:border-violet-500/30 dark:bg-violet-500/10">
                  <input
                    type="checkbox"
                    checked={restoreSessionData}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setRestoreSessionData(checked);
                      if (!checked) setClearMaintenanceOnSessionRestore(false);
                    }}
                    className="mt-1 h-4 w-4 rounded border-violet-200 text-[#7a32fc]"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-gray-900 dark:text-slate-50">
                      Restaurar dados de sessão
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-gray-500 dark:text-slate-300">
                      Mantém o PEI estruturado ativo, zera o preenchimento atual das metas e passa a contar novos registros a partir desta sessão.
                    </span>
                  </span>
                </label>
                {restoreSessionData && (
                  <label className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/80 p-4 dark:border-red-500/30 dark:bg-red-500/10">
                    <input
                      type="checkbox"
                      checked={clearMaintenanceOnSessionRestore}
                      onChange={(event) => setClearMaintenanceOnSessionRestore(event.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-red-200 text-red-500"
                    />
                    <span>
                      <span className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-100">
                        <Trash2 size={14} />
                        Apagar manutenções
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-red-600/80 dark:text-red-100/80">
                        Remove sondagens de manutenção ativas e faz essas habilidades voltarem para treino nesta nova sessão.
                      </span>
                    </span>
                  </label>
                )}
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setRestoreSessionData(false);
                  setClearMaintenanceOnSessionRestore(false);
                  setShowSessionStartConfirm(false);
                }}
                className="flex-1 py-3 rounded-2xl bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-200 font-semibold hover:bg-gray-200 dark:hover:bg-slate-700 transition-all"
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
        </div>,
        document.body
      )}
      {noShowReopenPrompt && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[130] flex items-start justify-center bg-black/40 p-4 pt-6 backdrop-blur-sm sm:pt-10" role="dialog" aria-modal="true" aria-labelledby="no-show-reopen-title">
          <div className="w-full max-w-md overflow-y-auto rounded-[28px] border border-amber-200 bg-white p-6 shadow-2xl dark:border-amber-500/30 dark:bg-[#101b2e] sm:p-7">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
              <RotateCcw size={26} />
            </div>
            <h3 id="no-show-reopen-title" className="text-xl font-semibold text-gray-900 dark:text-slate-50">
              Atendimento classificado como falta
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-slate-300">
              A falta permanece no histórico de auditoria. Para iniciar o atendimento agora, uma pessoa autorizada precisa reabri-la com justificativa.
            </p>

            <label htmlFor="no-show-reopen-reason" className="mt-5 block text-xs font-semibold text-gray-600 dark:text-slate-300">
              Justificativa da reabertura
            </label>
            <textarea
              id="no-show-reopen-reason"
              value={noShowReopenReason}
              maxLength={1000}
              rows={4}
              disabled={!canReopenAutomaticNoShow || isReopeningNoShow}
              onChange={(event) => {
                setNoShowReopenReason(event.target.value);
                if (noShowReopenError) setNoShowReopenError('');
              }}
              placeholder="Ex.: paciente chegou após o limite de tolerância e será atendido."
              className="mt-2 w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
            />
            <div className="mt-1 flex items-center justify-between text-xs text-gray-400 dark:text-slate-400">
              <span>Mínimo de 5 caracteres</span>
              <span>{noShowReopenReason.length}/1000</span>
            </div>

            {!canReopenAutomaticNoShow && (
              <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                Solicite a reabertura à coordenação ou administração da clínica.
              </p>
            )}
            {noShowReopenError && (
              <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100" role="alert">
                {noShowReopenError}
              </p>
            )}

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
              <button
                type="button"
                disabled={isReopeningNoShow}
                onClick={() => {
                  setNoShowReopenPrompt(null);
                  setNoShowReopenReason('');
                  setNoShowReopenError('');
                  noShowReopenIdempotencyKeyRef.current = '';
                }}
                className="min-h-12 flex-1 rounded-2xl bg-gray-100 px-4 font-semibold text-gray-700 transition hover:bg-gray-200 disabled:opacity-60 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!canReopenAutomaticNoShow || isReopeningNoShow || noShowReopenReason.trim().length < 5}
                onClick={() => void handleReopenNoShowAndStart()}
                className="min-h-12 flex-1 rounded-2xl bg-amber-500 px-4 font-semibold text-white shadow-lg shadow-amber-500/20 transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isReopeningNoShow ? 'Reabrindo…' : 'Reabrir e iniciar'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {peiMaintenanceScheduleRow && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in">
          <div className={`w-full max-w-2xl rounded-[28px] border p-5 shadow-2xl ${isPanelDark ? 'bg-[#101b2e] border-slate-700' : 'bg-white border-slate-100'}`}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className={`text-lg font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>Agendar sondagem de manutenção</h3>
                <p className={`mt-1 text-sm ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>Defina quando esta habilidade será sondada.</p>
                <h4 className={`mt-4 text-base font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>
                  {peiMaintenanceScheduleRow?.targetName || peiMaintenanceScheduleRow?.name || 'Habilidade em manutenção'}
                </h4>
                <p className={`mt-1 text-xs ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
                  {[peiMaintenanceScheduleRow?.protocol, peiMaintenanceScheduleRow?.domain].filter(Boolean).join(' · ') || 'PEI do paciente'}
                </p>
                <p className={`mt-1 text-xs ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Status: {safeDisplayValue(peiMaintenanceScheduleRow?.statusLabel || peiMaintenanceScheduleRow?.clinicalStatus, 'Adquirido')} · Progresso: {peiMaintenanceScheduleRow?.progressPercent ?? 100}%
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPeiMaintenanceScheduleRow(null);
                  setIsPeiMaintenanceCalendarOpen(false);
                }}
                className={`rounded-xl p-2 ${isPanelDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-400 hover:bg-slate-100'}`}
                title="Fechar"
              >
                <X size={18} />
              </button>
            </div>
            {peiMaintenancePanelMessage && (
              <div className={`mb-4 rounded-2xl border p-3 text-sm font-semibold ${isPanelDark ? 'border-violet-400/30 bg-violet-500/10 text-violet-100' : 'border-violet-100 bg-violet-50 text-violet-700'}`}>
                {peiMaintenancePanelMessage}
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ['CUSTOM_DATE', 'Escolher data'],
                ['NEXT_PATIENT_SESSION', 'Aguardar futura sessão']
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setPeiMaintenanceScheduleMode(mode);
                    if (mode !== 'CUSTOM_DATE') setPeiMaintenanceScheduleDate('');
                    if (mode !== 'CUSTOM_DATE') setIsPeiMaintenanceCalendarOpen(false);
                    setSelectedPeiMaintenanceAppointmentId('');
                  }}
                  className={`min-h-[44px] rounded-xl border px-3 py-2 text-left text-sm font-semibold transition-all ${
                    peiMaintenanceScheduleMode === mode
                      ? 'border-[#7a32fc] bg-[#7a32fc]/10 text-[#7a32fc]'
                      : isPanelDark
                        ? 'border-slate-700 bg-slate-900/50 text-slate-200 hover:bg-slate-800'
                        : 'border-slate-100 bg-slate-50 text-slate-700 hover:bg-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {peiMaintenanceScheduleMode === 'CUSTOM_DATE' && (
              <div className="mt-4">
                <div className={`block text-sm font-semibold ${isPanelDark ? 'text-slate-200' : 'text-slate-700'}`}>
                  Data da sondagem
                  <div className="relative mt-2">
                    <button
                      type="button"
                      onClick={openPeiMaintenanceCalendar}
                      className={`flex min-h-[46px] w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-sm outline-none ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-100 bg-slate-50 text-slate-700'}`}
                    >
                      <span>{peiMaintenanceScheduleDate ? formatPeiMaintenanceDateValue(peiMaintenanceScheduleDate) : 'dd/mm/aaaa'}</span>
                      <Calendar size={17} />
                    </button>
                    {isPeiMaintenanceCalendarOpen && (() => {
                      const appointmentsByDate = getPeiMaintenanceAppointmentsByDate();
                      const [yearValue, monthValue] = String(peiMaintenanceCalendarMonth || '').split('-').map(Number);
                      const year = yearValue || new Date().getFullYear();
                      const month = (monthValue || new Date().getMonth() + 1) - 1;
                      const firstDay = new Date(year, month, 1);
                      const startOffset = firstDay.getDay();
                      const daysInMonth = new Date(year, month + 1, 0).getDate();
                      const cells = Array.from({ length: 42 }, (_, index) => {
                        const day = index - startOffset + 1;
                        const date = new Date(year, month, day);
                        const inMonth = day >= 1 && day <= daysInMonth;
                        const dateValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                        return { date, dateValue, day: date.getDate(), inMonth, appointments: appointmentsByDate.get(dateValue) || [] };
                      });
                      return (
                        <div className={`absolute left-0 top-full z-[70] mt-2 w-[286px] rounded-2xl border p-3 shadow-2xl ${isPanelDark ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-slate-200 bg-white text-slate-900'}`}>
                          <div className="mb-3 flex items-center justify-between">
                            <button type="button" onClick={() => addMonthsToPeiMaintenanceCalendar(-1)} className={`rounded-lg p-2 ${isPanelDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`} title="Mês anterior">
                              <ChevronLeft size={17} />
                            </button>
                            <span className="text-sm font-bold capitalize">{formatPeiMaintenanceMonthLabel(peiMaintenanceCalendarMonth)}</span>
                            <button type="button" onClick={() => addMonthsToPeiMaintenanceCalendar(1)} className={`rounded-lg p-2 ${isPanelDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`} title="Próximo mês">
                              <ChevronRight size={17} />
                            </button>
                          </div>
                          <div className={`grid grid-cols-7 text-center text-[11px] font-bold ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>
                            {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((dayLabel, index) => <span key={`${dayLabel}-${index}`}>{dayLabel}</span>)}
                          </div>
                          <div className="mt-2 grid grid-cols-7 gap-1">
                            {cells.map((cell) => {
                              const selected = peiMaintenanceScheduleDate === cell.dateValue;
                              const hasAppointments = cell.appointments.length > 0;
                              return (
                                <button
                                  key={cell.dateValue}
                                  type="button"
                                  onClick={() => {
                                    setPeiMaintenanceScheduleDate(cell.dateValue);
                                    setSelectedPeiMaintenanceAppointmentId('');
                                    setIsPeiMaintenanceCalendarOpen(false);
                                  }}
                                  className={`relative flex h-9 items-center justify-center rounded-lg text-xs font-semibold transition-all ${
                                    selected
                                      ? 'bg-[#7a32fc] text-white shadow-sm shadow-violet-500/20'
                                      : cell.inMonth
                                        ? isPanelDark
                                          ? 'text-slate-100 hover:bg-slate-800'
                                          : 'text-slate-800 hover:bg-slate-100'
                                        : isPanelDark
                                          ? 'text-slate-600 hover:bg-slate-900'
                                          : 'text-slate-400 hover:bg-slate-50'
                                  }`}
                                >
                                  {cell.day}
                                  {hasAppointments && (
                                    <span className="absolute bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5">
                                      {cell.appointments.slice(0, 3).map((appointment: any, index: number) => (
                                        <span key={`${cell.dateValue}-dot-${index}`} className={`h-1.5 w-1.5 rounded-full ${getPeiMaintenanceAppointmentStatusInfo(appointment).dotClass}`}></span>
                                      ))}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
                {peiMaintenanceAppointmentsState.loading ? (
                  <p className={`mt-3 rounded-2xl border p-3 text-sm ${isPanelDark ? 'border-slate-700 bg-slate-900/40 text-slate-300' : 'border-slate-100 bg-slate-50 text-slate-500'}`}>
                    Carregando próximas sessões...
                  </p>
                ) : peiMaintenanceAppointmentsState.items.length > 0 ? (
                  <div className="mt-3">
                    <p className={`text-xs font-bold uppercase tracking-widest ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>Dias com sessão</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {peiMaintenanceAppointmentsState.items.map((appointment: any) => {
                        const appointmentDate = getPeiMaintenanceAppointmentDateValue(appointment);
                        const appointmentId = getPersistedUuid(appointment?.id);
                        const selected = Boolean(
                          appointmentId
                            ? selectedPeiMaintenanceAppointmentId === appointmentId
                            : appointmentDate && peiMaintenanceScheduleDate === appointmentDate
                        );
                        const statusInfo = getPeiMaintenanceAppointmentStatusInfo(appointment);
                        return (
                          <button
                            key={`${appointment?.id || appointmentDate || formatPeiMaintenanceAppointmentLabel(appointment)}-date`}
                            type="button"
                            disabled={!appointmentDate}
                            onClick={() => {
                              setPeiMaintenanceScheduleDate(appointmentDate);
                              setSelectedPeiMaintenanceAppointmentId(appointmentId || '');
                            }}
                            className={`rounded-2xl border p-3 text-left text-sm transition-all ${
                              selected
                                ? 'border-[#7a32fc] bg-[#7a32fc]/10 text-[#7a32fc]'
                                : isPanelDark
                                  ? 'border-slate-700 bg-slate-900/50 text-slate-200 hover:bg-slate-800'
                                  : 'border-slate-100 bg-slate-50 text-slate-700 hover:bg-white'
                            } disabled:opacity-60`}
                          >
                            <span className="flex items-start justify-between gap-3">
                              <span className="font-semibold">{formatPeiMaintenanceAppointmentDateTimeLabel(appointment)}</span>
                              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusInfo.badgeClass}`}>{statusInfo.label}</span>
                            </span>
                            <span className="mt-1 block text-xs opacity-80">{formatPeiMaintenanceAppointmentLabel(appointment)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className={`mt-3 rounded-2xl border p-3 text-sm ${isPanelDark ? 'border-amber-400/20 bg-amber-500/10 text-amber-100' : 'border-amber-100 bg-amber-50 text-amber-800'}`}>
                    Este paciente não possui próximas sessões agendadas.
                  </p>
                )}
                {peiMaintenanceAppointmentsState.error && (
                  <p className="mt-3 text-sm font-semibold text-amber-700">{peiMaintenanceAppointmentsState.error}</p>
                )}
              </div>
            )}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setPeiMaintenanceScheduleRow(null);
                  setIsPeiMaintenanceCalendarOpen(false);
                }}
                className={`min-h-[44px] rounded-xl px-4 py-2 text-sm font-semibold ${isPanelDark ? 'bg-slate-800 text-slate-100 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handlePeiScheduleModalSave}
                disabled={Boolean(peiMaintenanceActionKey) || (peiMaintenanceScheduleMode === 'EXISTING_APPOINTMENT' && !selectedPeiMaintenanceAppointmentId)}
                className="min-h-[44px] rounded-xl bg-[#7a32fc] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-all hover:opacity-90 disabled:opacity-60"
              >
                {peiMaintenanceActionKey ? 'Salvando...' : 'Salvar agendamento'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {peiMaintenanceReviewRow && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in">
          <div className={`w-full max-w-lg rounded-[28px] border p-5 shadow-2xl ${isPanelDark ? 'bg-[#101b2e] border-slate-700' : 'bg-white border-slate-100'}`}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className={`text-lg font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>Revisar vínculo</h3>
                <p className={`mt-1 text-sm ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
                  Associe esta sondagem antiga a uma habilidade real do PEI.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPeiMaintenanceReviewRow(null)}
                className={`rounded-xl p-2 ${isPanelDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-400 hover:bg-slate-100'}`}
                title="Fechar"
              >
                <X size={18} />
              </button>
            </div>
            {peiMaintenanceLinkableTargetsState.loading ? (
              <div className={`rounded-2xl border p-4 text-sm ${isPanelDark ? 'border-slate-700 bg-slate-900/40 text-slate-300' : 'border-slate-100 bg-slate-50 text-slate-500'}`}>
                Carregando habilidades do PEI...
              </div>
            ) : getPeiMaintenanceTargetOptions().length > 0 ? (
              (() => {
                const options = getPeiMaintenanceTargetOptions();
                return (
                  <label className={`block text-sm font-semibold ${isPanelDark ? 'text-slate-200' : 'text-slate-700'}`}>
                    Habilidade do PEI
                    <select
                      value={peiMaintenanceReviewTargetId}
                      onChange={(event) => setPeiMaintenanceReviewTargetId(event.target.value)}
                      className={`mt-2 w-full rounded-xl border px-3 py-3 text-sm outline-none ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-100 bg-slate-50 text-slate-700'}`}
                    >
                      <option value="">Selecione uma habilidade</option>
                      {options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {[option.label, option.detail, option.status].filter(Boolean).join(' - ')}
                        </option>
                      ))}
                    </select>
                    {peiMaintenanceReviewTargetId && (
                      <p className={`mt-2 text-xs ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
                        {options.find((option) => option.id === peiMaintenanceReviewTargetId)?.detail || 'PEI do paciente'}
                      </p>
                    )}
                  </label>
                );
              })()
            ) : (
              <div className={`rounded-2xl border p-4 text-sm ${isPanelDark ? 'border-amber-400/20 bg-amber-500/10 text-amber-100' : 'border-amber-100 bg-amber-50 text-amber-800'}`}>
                {peiMaintenanceLinkableTargetsState.error || 'Este paciente ainda não possui habilidades no PEI. Adicione uma meta antes de vincular a manutenção.'}
              </div>
            )}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPeiMaintenanceReviewRow(null)}
                className={`min-h-[44px] rounded-xl px-4 py-2 text-sm font-semibold ${isPanelDark ? 'bg-slate-800 text-slate-100 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                Fazer depois
              </button>
              <button
                type="button"
                onClick={handlePeiReviewTargetSave}
                disabled={!peiMaintenanceReviewTargetId || Boolean(peiMaintenanceActionKey)}
                className="min-h-[44px] rounded-xl bg-[#7a32fc] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-all hover:opacity-90 disabled:opacity-60"
              >
                {peiMaintenanceActionKey ? 'Salvando...' : 'Salvar vínculo'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {peiMaintenanceAssignSchedule && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in">
          <div className={`w-full max-w-2xl rounded-[28px] border p-5 shadow-2xl ${isPanelDark ? 'bg-[#101b2e] border-slate-700' : 'bg-white border-slate-100'}`}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className={`text-lg font-semibold ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>Escolha uma sessão para esta sondagem</h3>
                <p className={`mt-1 text-sm ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
                  {peiMaintenanceAssignSchedule?.targetName || 'Sondagem de manutencao'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPeiMaintenanceAssignSchedule(null)}
                className={`rounded-xl p-2 ${isPanelDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-400 hover:bg-slate-100'}`}
                title="Fechar"
              >
                <X size={18} />
              </button>
            </div>
            {peiMaintenanceAppointmentsState.loading ? (
              <p className={`rounded-2xl border p-4 text-sm ${isPanelDark ? 'border-slate-700 bg-slate-900/40 text-slate-300' : 'border-slate-100 bg-slate-50 text-slate-500'}`}>Carregando próximas sessões...</p>
            ) : peiMaintenanceAppointmentsState.items.length > 0 ? (
              <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
                {peiMaintenanceAppointmentsState.items.map((appointment: any) => {
                  const appointmentId = getPersistedUuid(appointment?.id);
                  const selected = selectedPeiMaintenanceAppointmentId === appointmentId;
                  const statusInfo = getPeiMaintenanceAppointmentStatusInfo(appointment);
                  return (
                    <button
                      key={appointmentId || formatPeiMaintenanceAppointmentLabel(appointment)}
                      type="button"
                      disabled={!appointmentId}
                      title={!appointmentId ? appointment?.unavailableReason || 'Esta recorrência ainda não foi salva como agendamento real. Salve o agendamento antes de vincular manutenção.' : undefined}
                      onClick={() => setSelectedPeiMaintenanceAppointmentId(appointmentId)}
                      className={`w-full rounded-2xl border p-4 text-left transition-all ${
                        selected
                          ? 'border-[#7a32fc] bg-[#7a32fc]/10 text-[#7a32fc]'
                          : isPanelDark
                            ? 'border-slate-700 bg-slate-900/50 text-slate-200 hover:bg-slate-800'
                            : 'border-slate-100 bg-slate-50 text-slate-700 hover:bg-white'
                      } disabled:opacity-60`}
                    >
                      <p className="text-sm font-semibold">{formatPeiMaintenanceAppointmentLabel(appointment)}</p>
                      <p className="mt-1 text-xs opacity-80">{statusInfo.label}</p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className={`rounded-2xl border p-4 text-sm ${isPanelDark ? 'border-amber-400/20 bg-amber-500/10 text-amber-100' : 'border-amber-100 bg-amber-50 text-amber-800'}`}>
                Este paciente não possui próximas sessões agendadas.
              </div>
            )}
            {peiMaintenanceAppointmentsState.error && (
              <p className="mt-3 text-sm font-semibold text-amber-700">{peiMaintenanceAppointmentsState.error}</p>
            )}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={handlePeiWaitNextSessionFromModal}
                disabled={Boolean(peiMaintenanceActionKey)}
                className={`min-h-[44px] rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60 ${isPanelDark ? 'bg-slate-800 text-slate-100 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                Aguardar futura sessão
              </button>
              <button
                type="button"
                onClick={handlePeiAssignToAppointment}
                disabled={!selectedPeiMaintenanceAppointmentId || Boolean(peiMaintenanceActionKey)}
                className="min-h-[44px] rounded-xl bg-[#7a32fc] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-all hover:opacity-90 disabled:opacity-60"
              >
                {peiMaintenanceActionKey ? 'Vinculando...' : 'Vincular a esta sessão'}
              </button>
            </div>
          </div>
        </div>,
        document.body
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

      {showAnamnesisSendModal && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in">
          <div className={`flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border shadow-2xl ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-100 bg-white text-slate-900'}`}>
            <div className={`flex items-start justify-between gap-4 border-b px-5 py-4 ${isPanelDark ? 'border-slate-800' : 'border-slate-100'}`}>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold leading-snug">Enviar ficha de anamnese</h3>
                <p className={`mt-1 text-sm ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
                  {patient?.name || 'Paciente'}
                </p>
              </div>
              <button
                onClick={() => setShowAnamnesisSendModal(false)}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${isPanelDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}
                aria-label="Fechar"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 lg:grid-cols-[0.95fr_1.05fr]">
              <section className={`rounded-xl border p-4 ${isPanelDark ? 'border-slate-700 bg-slate-800/50' : 'border-slate-100 bg-slate-50'}`}>
                <h4 className={`text-xs font-semibold uppercase tracking-wide ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
                  Ficha para envio
                </h4>
                <div className="mt-3 space-y-2">
                  {availableAnamnesisTemplates.map((template: any, index: number) => {
                    const optionId = template.id || "";
                    const checked = optionId
                      ? selectedAnamnesisTemplateId === optionId
                      : !selectedAnamnesisTemplateId && index === 0;
                    return (
                      <label
                        key={template.id || `${template.name}-${index}`}
                        className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${checked ? (isPanelDark ? 'border-violet-400 bg-violet-500/10' : 'border-[#7a32fc] bg-violet-50') : (isPanelDark ? 'border-slate-700 bg-slate-900/70 hover:border-slate-500' : 'border-slate-200 bg-white hover:border-violet-200')}`}
                      >
                        <input
                          type="radio"
                          name="anamnesis-template"
                          className="mt-1 h-4 w-4 accent-[#7a32fc]"
                          checked={checked}
                          onChange={() => setSelectedAnamnesisTemplateId(optionId)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="break-words text-sm font-semibold">{template.name}</span>
                            {template.templateScope === 'personal' && (
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${isPanelDark ? 'bg-violet-500/10 text-violet-200' : 'bg-violet-50 text-violet-700'}`}>
                                Minha ficha
                              </span>
                            )}
                            {template.templateScope === 'clinic' && (
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${isPanelDark ? 'bg-sky-500/10 text-sky-200' : 'bg-sky-50 text-sky-700'}`}>
                                Clínica
                              </span>
                            )}
                            {template.recommended && (
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${isPanelDark ? 'bg-emerald-500/10 text-emerald-200' : 'bg-emerald-50 text-emerald-700'}`}>
                                Recomendada
                              </span>
                            )}
                          </span>
                          {template.description && (
                            <span className={`mt-1 block text-xs leading-relaxed ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
                              {template.description}
                            </span>
                          )}
                          <span className={`mt-2 flex flex-wrap gap-1.5 text-[11px] ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
                            <span className={`rounded-full px-2 py-1 ${isPanelDark ? 'bg-slate-800' : 'bg-slate-100'}`}>
                              {formatAnamnesisTemplateAgeRange(template)}
                            </span>
                            <span className={`rounded-full px-2 py-1 ${isPanelDark ? 'bg-slate-800' : 'bg-slate-100'}`}>
                              {formatAnamnesisTemplateProfile(template.patientProfileType)}
                            </span>
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>

              <section className={`rounded-xl border p-4 ${isPanelDark ? 'border-slate-700 bg-slate-800/50' : 'border-slate-100 bg-white'}`}>
                <h4 className={`text-xs font-semibold uppercase tracking-wide ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
                  Dados cadastrais do paciente
                </h4>
                <div className="mt-3 space-y-4">
                  {patientRegistrationContextSections.map((section) => (
                    <div key={section.title}>
                      <p className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${isPanelDark ? 'text-slate-400' : 'text-slate-400'}`}>
                        {section.title}
                      </p>
                      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {section.items.map((item) => (
                          <div key={`${section.title}-${item.label}`} className={`rounded-lg border px-3 py-2 ${isPanelDark ? 'border-slate-700 bg-slate-900/70' : 'border-slate-100 bg-slate-50'}`}>
                            <dt className={`text-[10px] font-semibold uppercase tracking-wide ${isPanelDark ? 'text-slate-400' : 'text-slate-400'}`}>
                              {item.label}
                            </dt>
                            <dd className={`mt-1 break-words text-sm font-medium ${isPanelDark ? 'text-slate-100' : 'text-slate-700'}`}>
                              {formatPatientContextValue(item.value)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className={`flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end ${isPanelDark ? 'border-slate-800' : 'border-slate-100'}`}>
              <button
                onClick={() => setShowAnamnesisSendModal(false)}
                className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${isPanelDark ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleConfirmSendAnamnesisRequest()}
                disabled={isSendingAnamnesisRequest}
                className="flex items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#6424d6] disabled:opacity-60"
              >
                <Share2 size={16} />
                {isSendingAnamnesisRequest ? 'Enviando...' : 'Enviar para família'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      
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

      <div
        className={`z-20 transition-colors sm:rounded-[28px] sm:border sm:shadow-sm ${
          isPanelDark
            ? 'border-slate-800 bg-[#0f1b2f]'
            : 'border-slate-200/80 bg-white'
        }`}
      >
        <div className="mx-auto w-full max-w-[1480px] px-4 pt-4 sm:px-6 sm:pt-5">
          <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
              {!hideBackButton && (
                <button
                  id="back-btn"
                  onClick={onBack}
                  className={`group flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all hover:text-[#7a32fc] ${
                    isPanelDark
                      ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      : 'bg-slate-100 text-slate-500 hover:bg-violet-50'
                  }`}
                  aria-label="Voltar à página anterior"
                >
                  <ChevronLeft size={20} className="transition-transform group-hover:-translate-x-0.5" />
                </button>
              )}

              <div id="patient-header-info" className="flex min-w-0 flex-1 items-center gap-3">
                <div className="relative h-12 w-12 shrink-0 sm:h-14 sm:w-14">
                  {resolvedPatientPhotoSource ? (
                    <SecureImage
                      src={resolvedPatientPhotoSource}
                      alt={`Foto de ${patient?.name || 'paciente'}`}
                      className="h-12 w-12 rounded-full object-cover ring-1 ring-slate-200 sm:h-14 sm:w-14"
                    />
                  ) : (
                    <span
                      className={`flex h-12 w-12 items-center justify-center rounded-full text-sm sm:h-14 sm:w-14 ${
                        isPanelDark ? 'bg-slate-800 text-slate-200' : 'bg-violet-50 text-violet-700'
                      }`}
                    >
                      {patientInitials(patient?.name)}
                    </span>
                  )}
                  {canManagePatientPhoto && (
                    <>
                      <input
                        ref={patientPhotoInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        onChange={handleClinicalPatientPhotoChange}
                        aria-label="Selecionar foto do paciente"
                      />
                      <button
                        type="button"
                        onClick={() => patientPhotoInputRef.current?.click()}
                        disabled={isSavingPatientPhoto}
                        className={`absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border shadow-sm transition disabled:cursor-wait disabled:opacity-60 ${
                          isPanelDark
                            ? 'border-slate-700 bg-slate-800 text-violet-300 hover:bg-slate-700'
                            : 'border-white bg-violet-600 text-white hover:bg-violet-700'
                        }`}
                        aria-label={resolvedPatientPhotoSource ? 'Trocar foto do paciente' : 'Adicionar foto do paciente'}
                        title={resolvedPatientPhotoSource ? 'Trocar foto do paciente' : 'Adicionar foto do paciente'}
                      >
                        <Camera size={13} aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>

                <div className="min-w-0">
                  <h1
                    className={`break-words text-lg font-semibold leading-snug sm:text-xl ${
                      isPanelDark ? 'text-slate-50' : 'text-[#6542a8]'
                    }`}
                  >
                    {patient.name}
                  </h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className={`text-xs ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>Paciente</span>
                    {canOpenAnamnesis && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
                          getAnamnesisStatusLabel().includes('revisada')
                            ? 'bg-emerald-100 text-emerald-700'
                            : isPanelDark
                              ? 'bg-amber-500/10 text-amber-200'
                              : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {getAnamnesisStatusLabel()}
                      </span>
                    )}
                    {canOpenAnamnesis && anamnesisFlowMessage && (
                      <span className={`text-[11px] font-medium ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
                        {anamnesisFlowMessage}
                      </span>
                    )}
                  </div>
                  {activeTab === 'aba-charts' && patient?.id && (
                    <button
                      type="button"
                      aria-expanded={showChartsCaseTeam}
                      aria-controls="patient-care-context"
                      onClick={() => setShowChartsCaseTeam((current) => !current)}
                      className={`mt-1.5 inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${isPanelDark
                        ? 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-violet-500/50'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-violet-200 hover:bg-violet-50'}`}
                    >
                      <span>Equipe · {activeCaseTeamLinks.length}</span>
                      {caseTeamIntegrityPendingCount > 0 && (
                        <span className={isPanelDark ? 'text-amber-300' : 'text-amber-700'}>· ⚠ {caseTeamIntegrityPendingCount}</span>
                      )}
                      <ChevronDown size={13} className={`transition-transform ${showChartsCaseTeam ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                  )}
                  {patientPhotoError && (
                    <p role="alert" className="mt-1 text-[11px] font-medium text-rose-600">{patientPhotoError}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
              {isKidsProfile && (
                <button
                  type="button"
                  onClick={() => document.getElementById('patient-timeline-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className={`flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-center text-[11px] font-medium leading-tight transition-colors sm:flex-none ${
                    isPanelDark
                      ? 'border-amber-400/20 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                      : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                  }`}
                  aria-label={`${kidsMilestoneStars} marcos validados. Ir para a linha do tempo.`}
                >
                  <span>Marcos validados</span>
                  <strong className="text-xs font-semibold">{kidsMilestoneStars} ⭐</strong>
                </button>
              )}

              <a
                id="whatsapp-btn"
                href={`https://wa.me/${(patient.phone || '').replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-9 min-w-0 items-center justify-center gap-2 rounded-lg bg-[#7046b8] px-3 py-2 text-center text-[11px] font-medium leading-tight text-white transition-all hover:bg-[#6037a7] sm:flex-none"
              >
                <MessageCircle size={15} /> WhatsApp
              </a>

              {canOpenAnamnesis && (
                <button
                  id="anamnesis-btn"
                  onClick={() => setShowAnamnesis(true)}
                  className={`flex min-h-9 min-w-0 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-center text-[11px] font-medium leading-tight transition-colors sm:flex-none ${
                    isPanelDark
                      ? 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                      : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <FileText size={15} /> Ficha Anamnese
                </button>
              )}

              {canOpenAnamnesis && (
                <button
                  onClick={() => void handleSendAnamnesisRequest()}
                  disabled={isSendingAnamnesisRequest}
                  className={`flex min-h-9 min-w-0 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-center text-[11px] font-medium leading-tight transition-colors disabled:opacity-60 sm:flex-none ${
                    isPanelDark
                      ? 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                      : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <Share2 size={15} /> {isSendingAnamnesisRequest ? 'Enviando...' : 'Enviar anamnese'}
                </button>
              )}

              {canOpenAnamnesis && hasSubmittedAnamnesisFlow && (
                <button
                  onClick={openSubmittedAnamnesisForFiles}
                  className="flex min-h-9 min-w-0 items-center justify-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-center text-[11px] font-medium leading-tight text-indigo-700 transition-colors hover:bg-indigo-100 sm:flex-none"
                >
                  <Eye size={15} /> Ver ficha enviada
                </button>
              )}

              {canOpenAnamnesis && String(anamnesisFlow?.response?.status || '').toUpperCase() === 'SUBMITTED' && (
                <button
                  onClick={() => void handleReviewAnamnesisFlow()}
                  disabled={isReviewingAnamnesis}
                  className="flex min-h-9 min-w-0 items-center justify-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-center text-[11px] font-medium leading-tight text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-60 sm:flex-none"
                >
                  <CheckCircle2 size={15} /> {isReviewingAnamnesis ? 'Revisando...' : 'Marcar revisada'}
                </button>
              )}

              <button
                onClick={() => setIsUnlinkingModalOpen(true)}
                className="flex h-9 w-9 items-center justify-center justify-self-end rounded-lg text-slate-400 transition-all hover:bg-red-50 hover:text-red-500"
                title="Desvincular Paciente"
                aria-label="Desvincular paciente"
              >
                <EyeOff size={18} />
              </button>
            </div>
          </div>

          <div
            id="patient-care-context"
            className={`${activeTab === 'aba-charts' && !showChartsCaseTeam ? 'hidden' : 'mt-6 grid'} min-w-0 items-start gap-5 ${
              canManagePrimaryProfessionalForPatient
                ? 'lg:grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)]'
                : ''
            }`}
          >
            {canManagePrimaryProfessionalForPatient && (
              <section aria-labelledby="patient-primary-professional-heading" className="min-w-0">
                <h2
                  id="patient-primary-professional-heading"
                  className={`text-sm font-semibold ${isPanelDark ? 'text-slate-100' : 'text-slate-800'}`}
                >
                  Responsável principal
                </h2>
                <label className="mt-2 block">
                  <span className="sr-only">Profissional responsável</span>
                  <select
                    className={`h-10 w-full min-w-0 rounded-lg border px-3 text-xs outline-none transition focus:border-[#7551FF] focus:ring-2 focus:ring-[#7551FF]/15 ${
                      isPanelDark
                        ? 'border-slate-700 bg-slate-900 text-slate-100'
                        : 'border-slate-200 bg-white text-slate-800 shadow-sm'
                    }`}
                    value={selectedTherapistId}
                    onChange={(e) => handleTherapistAssignmentChange(e.target.value)}
                    disabled={isLoadingTherapists || isSavingPrimaryProfessional}
                  >
                    <option value="">{isLoadingTherapists ? 'Carregando profissionais...' : 'Sem profissional responsável'}</option>
                    {clinicTherapists.map((therapist: any) => (
                      <option key={String(therapist.id)} value={String(therapist.id)}>
                        {formatPatientProfessionalOptionLabel(therapist)}
                      </option>
                    ))}
                  </select>
                  {isSavingPrimaryProfessional ? (
                    <span className={`mt-1.5 block text-[11px] ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      Salvando vínculo...
                    </span>
                  ) : primaryProfessionalError ? (
                    <span role="alert" className="mt-1.5 block text-[11px] leading-4 text-rose-600">
                      {primaryProfessionalError}
                    </span>
                  ) : null}
                </label>
              </section>
            )}

            {patient?.id ? (
              <PatientProfessionalLinksPanel
                patientId={String(patient.id)}
                professionals={clinicTherapists}
                canManage={canManageCaseTeam && (isUnitCaseTeamManager || caseTeamManagementAllowed)}
                dark={isPanelDark}
                refreshKey={caseTeamRefreshKey}
                onLinksChanged={handleCaseTeamLinksChanged}
                onManagementAuthorityChanged={setCaseTeamManagementAllowed}
              />
            ) : null}
          </div>
        </div>

        <nav
          id="tab-nav"
          aria-label="Áreas do prontuário"
          className={`mt-5 flex w-full gap-1 overflow-x-auto border-t px-4 scrollbar-hide no-scrollbar sm:px-6 ${
            isPanelDark ? 'border-slate-800' : 'border-slate-200/80'
          }`}
        >
          {canAccessTab('history') && (
            <button id="tab-history" aria-current={activeTab === 'history' ? 'page' : undefined} onClick={() => setActiveTab('history')} className={`min-h-12 min-w-[7.5rem] shrink-0 border-b-2 px-4 py-3 text-sm sm:min-w-0 sm:flex-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7551FF]/40 ${activeTab === 'history' ? (isPanelDark ? 'border-violet-400 text-violet-300' : 'border-[#7551FF] text-[#6542a8]') : (isPanelDark ? 'border-transparent text-slate-300 hover:text-white' : 'border-transparent text-slate-600 hover:text-slate-900')}`}>Histórico</button>
          )}
          {canAccessTab('notes') && (
            <button id="tab-notes" aria-current={activeTab === 'notes' ? 'page' : undefined} onClick={() => setActiveTab('notes')} className={`min-h-12 min-w-[7.5rem] shrink-0 border-b-2 px-4 py-3 text-sm sm:min-w-0 sm:flex-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7551FF]/40 ${activeTab === 'notes' ? (isPanelDark ? 'border-violet-400 text-violet-300' : 'border-[#7551FF] text-[#6542a8]') : (isPanelDark ? 'border-transparent text-slate-300 hover:text-white' : 'border-transparent text-slate-600 hover:text-slate-900')}`}>Anotações</button>
          )}
          {canAccessTab('report') && (
            <button id="tab-report" aria-current={activeTab === 'report' ? 'page' : undefined} onClick={() => setActiveTab('report')} className={`min-h-12 min-w-[7.5rem] shrink-0 border-b-2 px-4 py-3 text-sm sm:min-w-0 sm:flex-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7551FF]/40 ${activeTab === 'report' ? (isPanelDark ? 'border-violet-400 text-violet-300' : 'border-[#7551FF] text-[#6542a8]') : (isPanelDark ? 'border-transparent text-slate-300 hover:text-white' : 'border-transparent text-slate-600 hover:text-slate-900')}`}>Relatório</button>
          )}
          {canAccessTab('plan') && (
            <button id="tab-plan" aria-current={activeTab === 'plan' ? 'page' : undefined} onClick={() => setActiveTab('plan')} className={`min-h-12 min-w-[7.5rem] shrink-0 border-b-2 px-4 py-3 text-sm sm:min-w-0 sm:flex-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7551FF]/40 ${activeTab === 'plan' ? (isPanelDark ? 'border-violet-400 text-violet-300' : 'border-[#7551FF] text-[#6542a8]') : (isPanelDark ? 'border-transparent text-slate-300 hover:text-white' : 'border-transparent text-slate-600 hover:text-slate-900')}`}>
              {isKidsProfile ? 'Plano' : 'Plano Adulto'}
            </button>
          )}
          {canAccessTab('session') && isKidsProfile && (
            <button id="tab-session" aria-current={activeTab === 'session' ? 'page' : undefined} onClick={() => requestSessionStart('fullscreen')} className={`min-h-12 min-w-[7.5rem] shrink-0 border-b-2 px-4 py-3 text-sm sm:min-w-0 sm:flex-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7551FF]/40 ${activeTab === 'session' ? (isPanelDark ? 'border-violet-400 text-violet-300' : 'border-[#7551FF] text-[#6542a8]') : (isPanelDark ? 'border-transparent text-slate-300 hover:text-white' : 'border-transparent text-slate-600 hover:text-slate-900')}`}>Sessão</button>
          )}
          {canAccessTab('aba-charts') && (
            <button id="tab-aba-charts" aria-current={activeTab === 'aba-charts' ? 'page' : undefined} onClick={() => setActiveTab('aba-charts')} className={`min-h-12 min-w-[7.5rem] shrink-0 border-b-2 px-4 py-3 text-sm sm:min-w-0 sm:flex-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7551FF]/40 ${activeTab === 'aba-charts' ? (isPanelDark ? 'border-violet-400 text-violet-300' : 'border-[#7551FF] text-[#6542a8]') : (isPanelDark ? 'border-transparent text-slate-300 hover:text-white' : 'border-transparent text-slate-600 hover:text-slate-900')}`}>Gráficos</button>
          )}
          {canAccessTab('school') && (
            <button id="tab-school" aria-current={activeTab === 'school' ? 'page' : undefined} onClick={() => setActiveTab('school')} className={`min-h-12 min-w-[7.5rem] shrink-0 border-b-2 px-4 py-3 text-sm sm:min-w-0 sm:flex-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7551FF]/40 ${activeTab === 'school' ? (isPanelDark ? 'border-violet-400 text-violet-300' : 'border-[#7551FF] text-[#6542a8]') : (isPanelDark ? 'border-transparent text-slate-300 hover:text-white' : 'border-transparent text-slate-600 hover:text-slate-900')}`}>Escola</button>
          )}
          {canAccessTab('files') && (
            <button id="tab-files" aria-current={activeTab === 'files' ? 'page' : undefined} onClick={() => setActiveTab('files')} className={`min-h-12 min-w-[7.5rem] shrink-0 border-b-2 px-4 py-3 text-sm sm:min-w-0 sm:flex-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7551FF]/40 ${activeTab === 'files' ? (isPanelDark ? 'border-violet-400 text-violet-300' : 'border-[#7551FF] text-[#6542a8]') : (isPanelDark ? 'border-transparent text-slate-300 hover:text-white' : 'border-transparent text-slate-600 hover:text-slate-900')}`}>Arquivos</button>
          )}
        </nav>
      </div>
      <div className={`min-w-0 p-4 transition-colors sm:p-6 ${isPanelDark ? 'bg-[#081324]' : 'bg-gray-50'}`}>
        <div className="mx-auto w-full max-w-[1480px]">
        {activeTab === 'history' ? ( 
          <div className="space-y-6"> 
            {!isKidsProfile && (
              <div className="space-y-4 mb-6">
                <div className={`border rounded-3xl p-5 shadow-sm transition-colors ${isPanelDark ? 'bg-[#101b2e] border-slate-700' : 'bg-white border-slate-200'}`}>
                  <p className={`text-sm font-semibold ${isPanelDark ? 'text-slate-100' : 'text-slate-800'}`}>Histórico Adulto</p>
                  <p className={`text-xs mt-1 ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
                    Comparativo por domínio do protocolo, entre duas datas selecionadas.
                  </p>
                </div>
                <div className={`border rounded-3xl p-4 sm:p-5 shadow-sm space-y-4 transition-colors ${isPanelDark ? 'bg-[#101b2e] border-slate-700' : 'bg-white border-slate-200'}`}>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className={`block text-[10px] font-semibold uppercase mb-1.5 ml-1 ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Protocolo</label>
                      <select
                        className={`w-full border rounded-xl p-3 text-sm font-semibold outline-none focus:border-[#4318FF] ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`}
                        value={selectedChartProtocolId}
                        onChange={(e) => { setHasUserChangedChartProtocol(true); setSelectedChartProtocolId(e.target.value); }}
                      >
                        {planProtocolCatalog.map((protocol: any) => (
                          <option key={protocol.id} value={protocol.id}>{protocol.title}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={`block text-[10px] font-semibold uppercase mb-1.5 ml-1 ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Data Base</label>
                      <select
                        className={`w-full border rounded-xl p-3 text-sm font-semibold outline-none focus:border-[#4318FF] ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`}
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
                      <label className={`block text-[10px] font-semibold uppercase mb-1.5 ml-1 ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Data Comparação</label>
                      <select
                        className={`w-full border rounded-xl p-3 text-sm font-semibold outline-none focus:border-[#4318FF] ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`}
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
                  <div className={`min-h-0 min-w-0 rounded-3xl ${isPanelDark ? 'bg-slate-900/30' : 'bg-white'}`}>
                    <ComparisonBarChart
                      data={adultDomainComparisonData}
                      title={`Comparativo por Domínio (${selectedChartProtocol?.title || 'Protocolo'})`}
                      maxScore={100}
                    />
                  </div>
                </div>
              </div>
            )}

            {!isKidsProfile && showCoordinatorPatientRadar && (
              <section
                className={`space-y-4 rounded-2xl border p-4 sm:p-5 ${isPanelDark ? 'border-slate-700 bg-[#0d192b]' : 'border-slate-200 bg-slate-50/70'}`}
                aria-labelledby="adult-development-overview-heading"
              >
                <div>
                  <h2 id="adult-development-overview-heading" className={`text-lg font-semibold ${isPanelDark ? 'text-slate-100' : 'text-slate-900'}`}>
                    Panorama do desenvolvimento
                  </h2>
                  <p className={`mt-1 text-sm leading-6 ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Desempenho por domínio e habilidades dominadas no protocolo selecionado.
                  </p>
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
                  <RadarDomainAssessmentChart
                    patientId={patient.id}
                    protocols={planProtocolCatalog}
                    history={cumulativeGrowthHistory}
                    protocolId={selectedChartProtocolId}
                    compact
                    dark={isPanelDark}
                  />
                  <CumulativeGrowthChart
                    patientId={patient.id}
                    history={cumulativeGrowthHistory}
                    protocols={planProtocolCatalog}
                    protocolId={selectedChartProtocolId}
                    compact
                    dark={isPanelDark}
                    useCanonicalMastery={useCanonicalMasteryGrowth}
                  />
                </div>
              </section>
            )}

            {!isKidsProfile && (
              <section className="space-y-4" aria-labelledby="adult-timeline-heading">
                <div>
                  <h2 id="adult-timeline-heading" className={`text-lg font-semibold ${isPanelDark ? 'text-slate-100' : 'text-slate-900'}`}>
                    Linha do tempo clínica
                  </h2>
                  <p className={`mt-1 text-sm ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Registros concluídos, avaliações e anotações em ordem cronológica.
                  </p>
                </div>
                {renderHistoryTimelineControls()}
              </section>
            )}

            {!isKidsProfile && (
              <div className={`border p-5 rounded-3xl shadow-sm transition-colors ${isPanelDark ? 'bg-[#101b2e] border-slate-700' : 'bg-white border-slate-200'}`}>
                <h3 className={`text-sm font-semibold tracking-tight mb-4 ${isPanelDark ? 'text-slate-100' : 'text-slate-800'}`}>Histórico Adulto (Auditoria Clínica)</h3>
                {adultCompletedTasks.length === 0 ? (
                  <p className={`text-sm italic ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Sem eventos concluídos para exibir no histórico adulto.</p>
                ) : (
                  <div className={`relative pl-8 border-l-2 ml-2 space-y-4 ${isPanelDark ? 'border-indigo-400/30' : 'border-indigo-100'}`}>
                    {adultCompletedTasks.map((event: any) => {
                      const reviewKey = String(event.id);
                      const draft = assignedReviewDrafts[reviewKey] || { score: '', note: '' };
                      const isReviewable = isAssignedTaskReviewable(event);
                      const dynamicMaxScore = resolveAssignedTaskMaxScore(event);
                      const reviewContext = resolveAssignedTaskEvaluationContext(event);
                      return (
                        <div key={`adult-history-${event.id}`} className="relative">
                          <div className={`absolute -left-[39px] top-5 w-5 h-5 rounded-full bg-[#7551FF] border-4 ring-2 ${isPanelDark ? 'border-[#101b2e] ring-indigo-400/30' : 'border-white ring-indigo-100'}`}></div>
                          <div className={`border rounded-2xl p-5 space-y-2 shadow-sm transition-colors ${isPanelDark ? 'bg-[#14233a] border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className={`text-lg font-semibold tracking-tight ${isPanelDark ? 'text-slate-100' : 'text-slate-800'}`}>{event.taskTitle}</p>
                              <span className="text-[10px] font-semibold bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full uppercase tracking-wide">
                                {event.taskType === 'intervention' ? 'Intervenção' : event.taskType === 'reinforcement' ? 'Reforço' : 'Avaliação'}
                              </span>
                            </div>
                            <p className={`text-sm ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
                              Execução: {(event.executionDate || event.eventDate).toLocaleDateString('pt-BR')} às {(event.executionDate || event.eventDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                            {event.professionalScore !== null && event.reviewDate && (
                              <p className={`text-sm ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
                                Pontuação em sessão: {event.reviewDate.toLocaleDateString('pt-BR')} às {event.reviewDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            )}
                            <div className={`rounded-2xl border p-3 ${isPanelDark ? 'bg-slate-900/60 border-slate-700' : 'bg-white border-slate-200'}`}>
                              <div className="flex items-center justify-between gap-3 mb-2">
                                <span className={`text-[10px] font-semibold uppercase tracking-widest ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                  Energia após a atividade
                                </span>
                                <span className={`text-sm font-semibold flex items-center gap-2 ${isPanelDark ? 'text-slate-100' : 'text-slate-800'}`}>
                                  <span className="text-lg">{event.patientEffortEmoji || getEffortEmoji(event.patientEffort)}</span>
                                  {event.patientEffort}%
                                </span>
                              </div>
                              <div className={`h-2 rounded-full overflow-hidden ${isPanelDark ? 'bg-slate-800' : 'bg-slate-100'}`}>
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-[#fb5a4d] via-[#f6c04d] to-[#05CD99]"
                                  style={{ width: `${normalizeEffortPercent(event.patientEffort)}%` }}
                                />
                              </div>
                              <div className={`mt-2 flex justify-between text-[10px] font-semibold ${isPanelDark ? 'text-slate-500' : 'text-slate-400'}`}>
                                <span>Baixa</span>
                                <span>Média</span>
                                <span>Alta</span>
                              </div>
                            </div>
                            <p className={`text-sm ${isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}>
                              Comentário do paciente: {normalizeNoteText(event.patientComment) || 'Sem comentário.'}
                            </p>
                            {renderAssignedReviewCriteriaPanel(event, reviewContext)}
                            <p className={`text-sm ${isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}>
                              Nota final do profissional: <span className={`font-semibold ${isPanelDark ? 'text-slate-100' : 'text-slate-800'}`}>{event.professionalScore ?? '-'} / {event.maxScore}</span>
                            </p>
                            <div className={`border rounded-xl p-3 mt-3 transition-colors ${isPanelDark ? 'bg-slate-800/80 border-slate-700' : 'bg-white border-slate-200'}`}>
                              <p className={`text-[10px] font-semibold uppercase mb-1 ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Anotação de Evolução</p>
                              <p className={`text-sm whitespace-pre-wrap ${isPanelDark ? 'text-slate-100' : 'text-slate-700'}`}>{normalizeNoteText(event.evolutionNote) || 'Sem anotação técnica registrada.'}</p>
                            </div>
                            {isReviewable && event.professionalScore === null && (
                              <div className="bg-white dark:bg-slate-800/80 border border-orange-100 dark:border-orange-400/20 rounded-xl p-3 mt-3 space-y-3 transition-colors">
                                <div>
                                  <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-widest">Pontuação profissional pendente</p>
                                  <p className="text-xs text-gray-500 dark:text-slate-300 mt-1">
                                    {String(reviewContext?.protocol?.title || reviewContext?.protocol?.name || 'Protocolo de avaliação')} • faixa 0-{dynamicMaxScore}
                                  </p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-2">
                                  <select
                                    value={draft.score}
                                    onChange={(e) => handleAssignedReviewChange(reviewKey, { score: e.target.value })}
                                    className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-3 text-sm text-slate-800 dark:text-slate-100 outline-none"
                                  >
                                    <option value="">Nota 0-{dynamicMaxScore}</option>
                                    {Array.from({ length: dynamicMaxScore + 1 }, (_, i) => i).map((score) => (
                                      <option key={`history-score-${reviewKey}-${score}`} value={String(score)}>
                                        {score}
                                      </option>
                                    ))}
                                  </select>
                                  <textarea
                                    value={draft.note}
                                    onChange={(e) => handleAssignedReviewChange(reviewKey, { note: e.target.value })}
                                    className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-3 text-sm text-slate-800 dark:text-slate-100 outline-none resize-none"
                                    rows={2}
                                    placeholder="Anotação técnica opcional"
                                  />
                                </div>
                                <button
                                  onClick={() => void handleSubmitAssignedReview(event)}
                                  className="w-full font-semibold py-2.5 rounded-xl shadow-sm transition-opacity bg-[#7551FF] text-white hover:opacity-90"
                                >
                                  Salvar Nota Profissional
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {isKidsProfile ? (
              <React.Fragment>
                <section
                  id="patient-history-insights"
                  className={`space-y-4 rounded-2xl border p-4 sm:p-5 ${isPanelDark ? 'border-slate-700 bg-[#0d192b]' : 'border-slate-200 bg-slate-50/70'}`}
                  aria-labelledby="patient-history-insights-heading"
                >
                  <div id="history-filters" className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="min-w-0">
                      <h2 id="patient-history-insights-heading" className={`text-lg font-semibold ${isPanelDark ? 'text-slate-100' : 'text-slate-900'}`}>
                        Evolução clínica
                      </h2>
                      <p className={`mt-1 max-w-2xl text-sm leading-6 ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        Uma leitura consolidada do protocolo selecionado. Para análises ABA detalhadas, use a aba Gráficos ABA.
                      </p>
                    </div>
                    <label className={`block w-full lg:max-w-sm ${isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}>
                      <span className="mb-1.5 flex items-center gap-2 text-xs font-medium">
                        <SlidersHorizontal size={14} className="text-[#7a32fc]" /> Protocolo
                      </span>
                      <div className="relative">
                        <select
                          id="protocol-selector"
                          className={`h-11 w-full appearance-none rounded-xl border px-3 pr-10 text-sm font-medium outline-none transition focus:border-[#7a32fc] focus:ring-2 focus:ring-[#7a32fc]/15 ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-700'}`}
                          value={selectedChartProtocolId}
                          onChange={(e) => { setHasUserChangedChartProtocol(true); setSelectedChartProtocolId(e.target.value); }}
                        >
                          {planProtocolCatalog.map((protocol: any) => (
                            <option key={protocol.id} value={protocol.id}>{protocol.title}</option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      </div>
                    </label>
                  </div>
                  <div id="evolution-chart-container" className="min-w-0">
                  <EvolutionBarChart
                    chartData={radarChartData}
                    maxScore={100}
                    title="Evolução por domínio"
                    description="Compare a primeira avaliação registrada com o registro mais recente do protocolo selecionado."
                    variant="patient-history"
                    dark={isPanelDark}
                  />
                  </div>
                  {showCoordinatorPatientRadar && (
                    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
                      <RadarDomainAssessmentChart
                        patientId={patient.id}
                        protocols={planProtocolCatalog}
                        history={cumulativeGrowthHistory}
                        protocolId={selectedChartProtocolId}
                        compact
                        dark={isPanelDark}
                      />
                      <CumulativeGrowthChart
                        patientId={patient.id}
                        history={cumulativeGrowthHistory}
                        protocols={planProtocolCatalog}
                        protocolId={selectedChartProtocolId}
                        compact
                        dark={isPanelDark}
                        useCanonicalMastery={useCanonicalMasteryGrowth}
                      />
                    </div>
                  )}
                </section>
                <section className={`space-y-3 rounded-2xl border p-4 sm:p-5 ${isPanelDark ? 'border-slate-700 bg-[#0d192b]' : 'border-slate-200 bg-white'}`} aria-labelledby="patient-session-reports-heading">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 id="patient-session-reports-heading" className={`text-lg font-semibold ${isPanelDark ? 'text-slate-100' : 'text-slate-900'}`}>Relatórios de sessão</h2>
                      <p className={`mt-1 text-sm ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Abra sessões finalizadas para revisar tentativas, retificações e complementos clínicos.</p>
                    </div>
                    {completedSessionReports.length > 0 && (
                      <span className={`text-xs font-medium ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Últimas {completedSessionReports.length}</span>
                    )}
                  </div>
                  {completedSessionReportsLoading ? (
                    <div className={`rounded-xl border px-4 py-3 text-sm ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-slate-100 bg-slate-50 text-slate-600'}`}>Carregando sessões finalizadas...</div>
                  ) : completedSessionReportsError ? (
                    <div className={`rounded-xl border px-4 py-3 text-sm ${isPanelDark ? 'border-amber-400/30 bg-amber-500/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{completedSessionReportsError}</div>
                  ) : completedSessionReports.length > 0 ? (
                    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                      {completedSessionReports.slice(0, 6).map((session: any) => {
                        const endedAt = session?.ended_at || session?.actual_end_at || session?.updated_at || session?.started_at || session?.created_at;
                        const endedDate = endedAt ? new Date(endedAt) : null;
                        const dateLabel = endedDate && !Number.isNaN(endedDate.getTime())
                          ? endedDate.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                          : 'Data não informada';
                        const duration = Number(session?.duration_minutes ?? session?.actual_duration_minutes ?? (Number(session?.duration_seconds || 0) / 60));
                        return (
                          <div key={`session-report-${session.id}`} className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${isPanelDark ? 'border-slate-700 bg-slate-900/70' : 'border-slate-100 bg-slate-50/70'}`}>
                            <div className="min-w-0">
                              <p className={`text-sm font-semibold ${isPanelDark ? 'text-slate-100' : 'text-slate-800'}`}>{dateLabel}</p>
                              <p className={`mt-1 text-xs ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>{Number.isFinite(duration) && duration > 0 ? `${Math.round(duration)} min` : 'Sessão finalizada'}{session?.room_name ? ` · ${session.room_name}` : ''}</p>
                            </div>
                            <button type="button" onClick={() => openCompletedSessionReport(session.id)} className="min-h-10 shrink-0 rounded-xl bg-[#7a32fc] px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Abrir relatório</button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className={`rounded-xl border border-dashed px-4 py-4 text-sm ${isPanelDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Nenhuma sessão finalizada encontrada para este paciente.</div>
                  )}
                </section>
                <section className="space-y-4" aria-labelledby="patient-timeline-heading">
                  <div>
                    <h2 id="patient-timeline-heading" className={`text-lg font-semibold ${isPanelDark ? 'text-slate-100' : 'text-slate-900'}`}>
                      Linha do tempo
                    </h2>
                    <p className={`mt-1 text-sm ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      Registros da família e das sessões, organizados por data.
                    </p>
                  </div>
                  {renderHistoryTimelineControls()}
                </section>
              </React.Fragment>
            ) : null}
            {isKidsProfile && historyPagination.loading && (sortedDateKeys?.length || 0) === 0 ? (
              <div className="space-y-3" aria-label="Carregando histórico">
                {[0, 1, 2].map((item) => <div key={item} className={`h-24 animate-pulse rounded-2xl ${isPanelDark ? 'bg-slate-800' : 'bg-slate-200/70'}`} />)}
              </div>
            ) : null}
            {isKidsProfile && !historyPagination.loading && ((sortedDateKeys?.length || 0) > 0 ? sortedDateKeys.map((dateKey, gIdx) => {
              const dateItems = groupedHistory[dateKey] || [];
              const familyItems = dateItems.filter((item: any) => item.type === 'family_note' || item.type === 'photo');
              const sessionItems = dateItems.filter((item: any) => item.type !== 'family_note' && item.type !== 'photo');
              const isSessionHistoryExpanded = expandedSessionHistoryDates[dateKey] === true;
              const firstVisibleItemId = gIdx === 0 ? 'history-item-0' : '';

              return (
              <div key={dateKey} className="relative pl-6 border-l-2 border-gray-200 ml-2"> 
                <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-[#7551FF] border-4 border-white ring-1 ring-gray-100"></div> 
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">{formatPatientTimelineDateLabel(dateKey)}</h3> 
                <div className="space-y-4">
                  {familyItems.map((item: any, idx: number) => (
                    <HistoryCard 
                      id={firstVisibleItemId && idx === 0 ? firstVisibleItemId : ''} 
                      key={item.id} 
                      item={item} 
                      energyTags={ENERGY_TAGS} 
                      isTherapist={true} 
                      onEvaluate={onEvaluateHistoryItem} 
                      protocols={protocols} 
                      isKid={patientCategory === 'Criança'}
                      fullHistory={(history || []).filter((h: any) => h.patientId === patient.id)}
                      peiGoals={peiGoals || []}
                    />
                  ))}

                  {sessionItems.length > 0 && (
                    <div className="bg-white/90 border border-indigo-100 rounded-3xl shadow-sm overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleSessionHistoryDate(dateKey)}
                        className="w-full px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left hover:bg-indigo-50/50 transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-10 h-10 rounded-2xl bg-[#7a32fc]/10 text-[#7a32fc] flex items-center justify-center">
                            <Clock size={18} />
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-gray-800">Registros de sessão</p>
                            <p className="text-xs text-gray-500">
                              {sessionItems.length} registro{sessionItems.length === 1 ? '' : 's'} técnico{sessionItems.length === 1 ? '' : 's'} recolhido{sessionItems.length === 1 ? '' : 's'} para priorizar o diário da família.
                            </p>
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-[#7a32fc] bg-[#7a32fc]/10 px-3 py-2 rounded-full">
                          {isSessionHistoryExpanded ? 'Recolher' : 'Ver registros'}
                          <ChevronDown size={14} className={`transition-transform ${isSessionHistoryExpanded ? 'rotate-180' : ''}`} />
                        </span>
                      </button>

                      {isSessionHistoryExpanded && (
                        <div className="border-t border-indigo-50 p-4 space-y-4 bg-slate-50/50 animate-fade-in">
                          {sessionItems.map((item: any, idx: number) => (
                            <HistoryCard 
                              id={!familyItems.length && firstVisibleItemId && idx === 0 ? firstVisibleItemId : ''} 
                              key={item.id} 
                              item={item} 
                              energyTags={ENERGY_TAGS} 
                              isTherapist={true} 
                              onEvaluate={onEvaluateHistoryItem} 
                              protocols={protocols} 
                              isKid={patientCategory === 'Criança'}
                              fullHistory={(history || []).filter((h: any) => h.patientId === patient.id)}
                              peiGoals={peiGoals || []}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {familyItems.length === 0 && sessionItems.length === 0 && (
                    <p className="text-sm text-gray-400 italic">Nenhum registro neste dia.</p>
                  )}
                </div> 
              </div>
              );
            }) : <p className="text-center text-gray-400 mt-10">Nenhum histórico disponível para este período.</p>)}
            {historyPagination.hasMore && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  disabled={historyPagination.loadingMore || !historyPagination.nextCursor}
                  onClick={() => void requestPatientHistoryPage(historyPagination.nextCursor)}
                  className={`min-h-11 rounded-xl border px-5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${isPanelDark ? 'border-slate-600 text-slate-100 hover:bg-slate-800' : 'border-slate-200 bg-white text-slate-700 hover:border-[#7a32fc]/40 hover:text-[#7a32fc]'}`}
                >
                  {historyPagination.loadingMore ? 'Carregando registros...' : 'Carregar registros anteriores'}
                </button>
              </div>
            )}
          </div> 
        ) : activeTab === 'notes' ? ( 
          <div className="space-y-4 animate-fade-in"> 
            <div id="note-export-card" className={`border p-5 rounded-[24px] shadow-sm mb-6 animate-fade-in transition-colors ${isPanelDark ? 'bg-[#101b2e] border-slate-700' : 'bg-white border-slate-200'}`}>
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="flex-1">
                  <h4 className={`text-xs font-semibold uppercase tracking-tight mb-3 flex items-center gap-2 ${isPanelDark ? 'text-slate-100' : 'text-gray-700'}`}>
                    <FileOutput size={14} className="text-[#7a32fc]" /> Exportar Relatório de Evolução
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={`block text-[9px] font-semibold uppercase mb-1 ml-1 ${isPanelDark ? 'text-slate-400' : 'text-gray-500'}`}>Início</label>
                      <input type="date" className={`w-full border rounded-xl p-2 text-xs outline-none focus:border-[#7a32fc] transition-all ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-gray-50 border-gray-100 text-gray-700'}`} value={reportStartDate} onChange={e => setReportStartDate(e.target.value)} />
                    </div>
                    <div>
                      <label className={`block text-[9px] font-semibold uppercase mb-1 ml-1 ${isPanelDark ? 'text-slate-400' : 'text-gray-500'}`}>Fim</label>
                      <input type="date" className={`w-full border rounded-xl p-2 text-xs outline-none focus:border-[#7a32fc] transition-all ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-gray-50 border-gray-100 text-gray-700'}`} value={reportEndDate} onChange={e => setReportEndDate(e.target.value)} />
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

            <div id="note-type-toggles" className={`flex p-1 rounded-xl mb-4 border transition-colors ${isPanelDark ? 'bg-slate-900/70 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
              <button onClick={() => setNoteMode('private')} className={`flex-1 py-2 text-[10px] font-semibold rounded-lg transition-all flex items-center justify-center gap-2 ${noteMode === 'private' ? (isPanelDark ? 'bg-slate-800 text-white shadow-sm' : 'bg-slate-100 text-slate-800 shadow-sm') : (isPanelDark ? 'text-slate-300' : 'text-slate-500')}`}><EyeOff size={12} /> Privadas</button> 
              <button onClick={() => setNoteMode('patient')} className={`flex-1 py-2 text-[10px] font-semibold rounded-lg transition-all flex items-center justify-center gap-2 ${noteMode === 'patient' ? (isPanelDark ? 'bg-slate-800 text-violet-200 shadow-sm' : 'bg-violet-50 text-[#7a32fc] shadow-sm') : (isPanelDark ? 'text-slate-300' : 'text-slate-500')}`}><Share2 size={12} /> Paciente</button> 
              <button onClick={() => setNoteMode('professional')} className={`flex-1 py-2 text-[10px] font-semibold rounded-lg transition-all flex items-center justify-center gap-2 ${noteMode === 'professional' ? (isPanelDark ? 'bg-slate-800 text-indigo-200 shadow-sm' : 'bg-indigo-50 text-indigo-600 shadow-sm') : (isPanelDark ? 'text-slate-300' : 'text-slate-500')}`}><SlidersHorizontal size={12} /> Profissionais</button> 
            </div> 

            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className={`text-sm font-semibold flex items-center gap-2 ${isPanelDark ? 'text-slate-100' : 'text-gray-700'}`}>
                {noteMode === 'private' ? <FileText size={16} className={isPanelDark ? 'text-slate-400' : 'text-gray-500'}/> : noteMode === 'patient' ? <Share2 size={16} className="text-[#7a32fc]"/> : <SlidersHorizontal size={16} className="text-indigo-600"/>}
                {noteMode === 'private' ? "Nova Anotação Privada" : noteMode === 'patient' ? "Enviar para Paciente (Portátil)" : "Compartilhar com Profissionais (Portátil)"}
              </h3>
              <button id="note-filters-btn" onClick={() => setShowNoteFilters(!showNoteFilters)} className={`text-[10px] font-semibold px-3 py-1 rounded-full transition-all flex items-center gap-1 border ${showNoteFilters ? (isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-100 border-slate-200 text-slate-700') : (isPanelDark ? 'bg-slate-900 border-slate-800 text-slate-300' : 'bg-white border-slate-200 text-slate-500')}`}>
                <Filter size={10} /> {showNoteFilters ? "Fechar Filtros" : "Filtrar Notas"}
              </button>
            </div>

            {showNoteFilters && (
              <div className={`p-4 rounded-2xl shadow-sm mb-4 animate-slide-up space-y-3 border transition-colors ${isPanelDark ? 'bg-[#101b2e] border-slate-700' : 'bg-white border-slate-200'}`}>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-semibold text-gray-400 uppercase mb-1 ml-1">Data</label>
                    <input type="date" className={`w-full rounded-xl p-2 text-xs outline-none border transition-colors ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-700'} focus:border-[#7a32fc]`} value={noteDateFilter} onChange={e => setNoteDateFilter(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[9px] font-semibold text-gray-400 uppercase mb-1 ml-1">Assunto/Tema</label>
                    <input type="text" className={`w-full rounded-xl p-2 text-xs outline-none border transition-colors ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-700'} focus:border-[#7a32fc]`} placeholder="Ex: Evolução..." value={noteSubjectFilter} onChange={e => setNoteSubjectFilter(e.target.value)} />
                  </div>
                </div>
                <div className="relative">
                  <Search className={`absolute left-3 top-1/2 -translate-y-1/2 ${isPanelDark ? 'text-slate-400' : 'text-slate-400'}`} size={14} />
                  <input type="text" className={`w-full rounded-xl p-2 pl-9 text-xs outline-none border transition-colors ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-700'} focus:border-[#7a32fc]`} placeholder="Palavra-chave no conteúdo..." value={noteSearchQuery} onChange={e => setNoteSearchQuery(e.target.value)} />
                </div>
                <button onClick={() => { setNoteSearchQuery(""); setNoteSubjectFilter(""); setNoteDateFilter(""); }} className="text-[9px] font-semibold text-[#7a32fc] uppercase tracking-wider hover:underline">Limpar Filtros</button>
              </div>
            )}

            <div id="note-input-area" className={`p-4 rounded-2xl shadow-sm border transition-colors ${noteMode === 'patient' ? (isPanelDark ? 'bg-violet-500/10 border-violet-400/20' : 'bg-violet-50/70 border-violet-200') : noteMode === 'professional' ? (isPanelDark ? 'bg-indigo-500/10 border-indigo-400/20' : 'bg-indigo-50/70 border-indigo-200') : (isPanelDark ? 'bg-[#101b2e] border-slate-700' : 'bg-white border-slate-200')}`}>
              <div className="mb-3">
                <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1 ml-1">Assunto / Tema</label>
                <input type="text" className={`w-full rounded-xl p-2 text-xs outline-none border transition-all ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100 focus:bg-slate-800' : 'bg-slate-50 border-slate-200 text-slate-800 focus:bg-white'} focus:border-[#7551FF]`} placeholder="Ex: Comportamento, Evolução, Social..." value={newNoteSubject} onChange={e => setNewNoteSubject(e.target.value)} />
              </div>
              <textarea className={`w-full h-24 rounded-xl p-3 text-sm outline-none border transition-all resize-none ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100 focus:bg-slate-800' : 'bg-slate-50 border-slate-200 text-slate-800 focus:bg-white'} focus:border-[#7551FF]`} placeholder={noteMode === 'private' ? "Digite observações clínicas..." : noteMode === 'patient' ? "Escreva uma orientação ou feedback (Portátil)..." : "Informações para a equipe. Use @ para mencionar alguém..."} value={newNote} onChange={(e) => {
                const nextValue = e.target.value;
                setNewNote(nextValue);
                setSelectedMentionUserIds((current) => current.filter((id) => {
                  const candidate = mentionCandidates.find((item: any) => item.id === id);
                  return candidate ? nextValue.includes(`@${candidate.name}`) : false;
                }));
              }}></textarea>
              {noteMode === 'professional' && visibleMentionCandidates.length > 0 && (
                <div className={`mt-2 overflow-hidden rounded-xl border shadow-sm ${isPanelDark ? 'border-slate-700 bg-slate-900' : 'border-indigo-100 bg-white'}`}>
                  {visibleMentionCandidates.map((candidate: any) => (
                    <button key={candidate.id} type="button" onClick={() => insertMention(candidate)} className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${isPanelDark ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-700 hover:bg-indigo-50'}`}>
                      <span className="font-semibold">@{candidate.name}</span>
                      <span className="text-[10px] text-slate-400">{candidate.specialty || 'Equipe do caso'}</span>
                    </button>
                  ))}
                </div>
              )}
              {noteMode === 'professional' && selectedMentionUserIds.length > 0 && (
                <p className="mt-2 text-[10px] font-medium text-indigo-500">{selectedMentionUserIds.length} membro(s) serão notificados.</p>
              )}
              <button onClick={handleAddNoteWithSubject} className={`w-full mt-3 text-white font-semibold py-3 rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2 ${noteMode === 'private' ? 'bg-[#7551FF]' : noteMode === 'patient' ? 'bg-[#7a32fc]' : 'bg-indigo-600'}`}>{noteMode === 'private' ? "Salvar Nota" : noteMode === 'patient' ? "Enviar Mensagem" : "Compartilhar com Equipe"}</button> 
            </div> 

            <div className="space-y-3"> 
              {filteredNotes.length > 0 ? (filteredNotes.map((note: any) => ( 
                <div id={`patient-note-${note.id}`} key={note.id} className={`p-4 rounded-2xl border shadow-sm relative group transition-all ${focusedNoteId === String(note.id) ? 'ring-2 ring-[#7551FF] ring-offset-2' : ''} ${(note.visibility === 'patient' || note.type === 'shared') ? (isPanelDark ? 'bg-violet-500/10 border-violet-400/20' : 'bg-violet-50/70 border-violet-200') : (note.visibility === 'professional' || note.type === 'professional') ? (isPanelDark ? 'bg-indigo-500/10 border-indigo-400/20' : 'bg-indigo-50/70 border-indigo-200') : (isPanelDark ? 'bg-[#101b2e] border-slate-700' : 'bg-white border-slate-200')}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase block">{note.date}</span>
                      {note.subject && <span className={`text-[11px] font-semibold mt-0.5 uppercase tracking-tight ${isPanelDark ? 'text-slate-200' : 'text-gray-700'}`}>#{normalizeNoteText(note.subject)}</span>}
                    </div>
                    <div className="flex gap-1">
                      {(note.visibility === 'private' || note.type === 'private' || !note.visibility) && (
                        <React.Fragment>
                          <button onClick={() => (window as any).handleToggleNoteTypeApp(note.id, 'patient')} className={`p-1.5 rounded-lg transition-all ${note.hasSharedCopy ? 'bg-[#7a32fc] text-white' : (isPanelDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-violet-200' : 'bg-slate-100 text-slate-400 hover:bg-blue-100 hover:text-[#7a32fc]')}`} title="Compartilhar com Paciente">
                            <Share2 size={14} />
                          </button>
                          <button onClick={() => (window as any).handleToggleNoteTypeApp(note.id, 'professional')} className={`p-1.5 rounded-lg transition-all ${note.hasProfessionalCopy ? 'bg-indigo-600 text-white' : (isPanelDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-indigo-200' : 'bg-slate-100 text-slate-400 hover:bg-indigo-100 hover:text-indigo-600')}`} title="Compartilhar com Profissionais">
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
                  <p className={`text-sm whitespace-pre-wrap mb-1 ${isPanelDark ? 'text-slate-200' : 'text-gray-700'}`}>{normalizeNoteText(note.text)}</p> 
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
            <div id="report-config-card" className={`border p-6 rounded-[32px] shadow-sm transition-colors ${isPanelDark ? 'bg-[#101b2e] border-slate-700' : 'bg-white border-gray-100'}`}>
              <div className="flex items-center gap-3 mb-6">
                <div className={`p-3 rounded-2xl text-[#7a32fc] ${isPanelDark ? 'bg-violet-500/10' : 'bg-indigo-50'}`}>
                  <BarChart2 size={24} />
                </div>
                <div>
                  <h3 className={`text-lg font-semibold tracking-tight ${isPanelDark ? 'text-slate-100' : 'text-gray-800'}`}>Relatório de Progresso</h3>
                  <p className={`text-xs font-semibold uppercase tracking-widest ${isPanelDark ? 'text-slate-400' : 'text-gray-400'}`}>Análise Comparativa para Clínicas e Operadores</p>
                </div>
              </div>

              <div className={`grid grid-cols-1 ${isKidsProfile ? 'md:grid-cols-3' : 'md:grid-cols-4'} gap-4 mb-6`}>
                <div>
                  <label className={`block text-[10px] font-semibold uppercase mb-1.5 ml-1 ${isPanelDark ? 'text-slate-400' : 'text-gray-400'}`}>Período de Análise</label>
                  <select 
                    id="report-period-selector"
                    className={`w-full border rounded-xl p-3 text-sm font-semibold outline-none focus:border-[#4318FF] ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-gray-50 border-gray-100 text-gray-700'}`}
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
                      <label className={`block text-[10px] font-semibold uppercase mb-1.5 ml-1 ${isPanelDark ? 'text-slate-400' : 'text-gray-400'}`}>Protocolo</label>
                      <select
                        className={`w-full border rounded-xl p-3 text-sm font-semibold outline-none focus:border-[#4318FF] ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-gray-50 border-gray-100 text-gray-700'}`}
                        value={selectedChartProtocolId}
                        onChange={(e) => { setHasUserChangedChartProtocol(true); setSelectedChartProtocolId(e.target.value); }}
                      >
                        {planProtocolCatalog.map((protocol: any) => (
                          <option key={protocol.id} value={protocol.id}>{protocol.title}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={`block text-[10px] font-semibold uppercase mb-1.5 ml-1 ${isPanelDark ? 'text-slate-400' : 'text-gray-400'}`}>Data Base</label>
                      <select
                        className={`w-full border rounded-xl p-3 text-sm font-semibold outline-none focus:border-[#4318FF] ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-gray-50 border-gray-100 text-gray-700'}`}
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
                      <label className={`block text-[10px] font-semibold uppercase mb-1.5 ml-1 ${isPanelDark ? 'text-slate-400' : 'text-gray-400'}`}>Data Comparação</label>
                      <select
                        className={`w-full border rounded-xl p-3 text-sm font-semibold outline-none focus:border-[#4318FF] ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-gray-50 border-gray-100 text-gray-700'}`}
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


              <div className="mt-8">
                <div className="flex items-center justify-between mb-4">
                  <h4 className={`text-xs font-semibold uppercase tracking-tight flex items-center gap-2 ${isPanelDark ? 'text-slate-100' : 'text-gray-700'}`}>
                    <FileText size={16} className="text-[#7a32fc]" /> {isKidsProfile ? 'Incluir Observações Clínicas' : 'Incluir Anotações de Evolução'}
                  </h4>
                  <span className={`text-[10px] font-semibold uppercase ${isPanelDark ? 'text-slate-400' : 'text-gray-400'}`}>
                    {isKidsProfile ? `${selectedReportNotes.length} selecionadas` : `${selectedAdultEvolutionIds.length} selecionadas`}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {isKidsProfile
                    ? kidsReportSelectableNotes.map((note: any) => (
                        <div
                          key={note.id}
                          onClick={() => toggleReportNote(note.id)}
                          className={`p-4 rounded-2xl border cursor-pointer transition-all ${selectedReportNotes.includes(note.id) ? (isPanelDark ? 'border-[#7a32fc] bg-violet-500/15 shadow-sm' : 'border-[#7a32fc] bg-blue-50/50 shadow-sm') : (isPanelDark ? 'border-slate-700 bg-slate-800 hover:bg-slate-700' : 'border-gray-100 bg-gray-50 hover:bg-white hover:border-gray-200')}`}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <span className="text-[9px] font-semibold text-gray-400 uppercase">{note.date}</span>
                            {selectedReportNotes.includes(note.id) && <div className="w-2 h-2 rounded-full bg-[#7a32fc]"></div>}
                          </div>
                          <p className={`text-xs line-clamp-3 ${isPanelDark ? 'text-slate-200' : 'text-gray-600'}`}>{normalizeNoteText(note.text)}</p>
                        </div>
                      ))
                    : adultTasksInPeriod.map((task: any) => {
                        const selected = selectedAdultEvolutionIds.includes(String(task.id));
                        return (
                          <div
                            key={`adult-evo-select-${task.id}`}
                            onClick={() => toggleAdultEvolutionSelection(String(task.id))}
                            className={`p-4 rounded-2xl border cursor-pointer transition-all ${selected ? (isPanelDark ? 'border-[#7a32fc] bg-violet-500/15 shadow-sm' : 'border-[#7a32fc] bg-blue-50/50 shadow-sm') : (isPanelDark ? 'border-slate-700 bg-slate-800 hover:bg-slate-700' : 'border-gray-100 bg-gray-50 hover:bg-white hover:border-gray-200')}`}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <span className="text-[9px] font-semibold text-gray-400 uppercase">
                                {task.eventDate.toLocaleDateString('pt-BR')}
                              </span>
                              {selected && <div className="w-2 h-2 rounded-full bg-[#7a32fc]"></div>}
                            </div>
                            <p className={`text-xs font-semibold ${isPanelDark ? 'text-slate-100' : 'text-gray-700'}`}>{task.taskTitle}</p>
                            <p className={`text-[11px] mt-1 ${isPanelDark ? 'text-slate-300' : 'text-gray-500'}`}>
                              Energia {task.patientEffortEmoji || getEffortEmoji(task.patientEffort)} {task.patientEffort}% • Nota {task.professionalScore ?? '-'} / {task.maxScore}
                            </p>
                            <p className={`text-xs line-clamp-2 mt-1 ${isPanelDark ? 'text-slate-200' : 'text-gray-600'}`}>{normalizeNoteText(task.evolutionNote) || 'Sem anotação técnica.'}</p>
                          </div>
                        );
                      })}
                </div>
              </div>
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
                        <p className="text-xs text-gray-600 mt-1">
                          Energia após a atividade: <span className="font-semibold">{task.patientEffortEmoji || getEffortEmoji(task.patientEffort)} {task.patientEffort}%</span>
                        </p>
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap mt-2">
                          {normalizeNoteText(task.evolutionNote) || 'Sem anotação técnica registrada.'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!isKidsProfile && (
                <div className="mt-6">
                  <label className={`block text-[10px] font-semibold uppercase mb-1.5 ml-1 ${isPanelDark ? 'text-slate-400' : 'text-gray-400'}`}>
                    Anotação adicional do relatório
                  </label>
                  <textarea
                    className={`w-full border rounded-xl p-3 text-sm outline-none resize-none ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-gray-50 border-gray-100 text-slate-800'}`}
                    rows={3}
                    placeholder="Resumo clínico adicional para o PDF final."
                    value={reportAdditionalNote}
                    onChange={(e) => setReportAdditionalNote(e.target.value)}
                  />
                </div>
              )}

              <div className="mt-8 flex justify-end gap-3">
                <button
                  className={`px-6 py-3 font-semibold rounded-xl text-xs transition-all ${isPanelDark ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  onClick={isKidsProfile ? () => void handlePDFAction('view') : () => setActiveTab('history')}
                  disabled={isKidsProfile && isGeneratingProgressPdf}
                >
                  {isKidsProfile ? 'Visualizar PDF' : 'Ver Histórico'}
                </button>
                <button
                  id="report-download-btn"
                  onClick={isKidsProfile ? () => void handlePDFAction('download') : () => void handleGenerateAdultEvolutionReport()}
                  disabled={isKidsProfile ? isGeneratingProgressPdf : isGeneratingAdultReport}
                  className="px-6 py-3 bg-[#7a32fc] text-white font-semibold rounded-xl text-xs shadow-lg shadow-[#7a32fc]/20 hover:opacity-90 transition-all flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Download size={16} /> {isKidsProfile ? (isGeneratingProgressPdf ? 'Gerando PDF...' : 'Gerar Relatório Final') : (isGeneratingAdultReport ? 'Gerando...' : 'Gerar PDF Adulto')}
                </button>
              </div>
            </div>
          </div>
        ) : activeTab === 'plan' ? ( 
          <div className="space-y-6 animate-fade-in"> 
            {isKidsProfile && (
              <div className={`p-6 rounded-[32px] shadow-sm border mb-6 relative overflow-hidden transition-colors ${isPanelDark ? 'bg-[#101b2e] border-slate-700' : 'bg-white border-slate-200'}`}>
                <div className="absolute top-0 right-0 w-32 h-32 bg-[#05CD99]/5 rounded-bl-full -z-0"></div>
                <div className="flex items-center justify-between mb-6 relative z-10">
                  <div>
                    <h3 className={`text-xl font-semibold tracking-tight ${isPanelDark ? 'text-slate-50' : 'text-gray-800'}`}>Plano terapêutico</h3>
                    <p className={`mt-1 text-xs ${isPanelDark ? 'text-slate-300' : 'text-gray-500'}`}>Objetivos, programas de ensino, alvos e progresso do paciente.</p>
                  </div>
                  <div className="flex gap-2">
                    <div className="p-3 bg-[#05CD99]/10 rounded-2xl text-[#05CD99]">
                      <Target size={24} />
                    </div>
                  </div>
                </div>

                <div className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-2 ${isPanelDark ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-slate-50'}`} data-testid="therapeutic-plan-mode-switch">
                  <div className="flex gap-1" role="tablist" aria-label="Tipo de plano terapêutico">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={therapeuticPlanMode === 'pts'}
                      onClick={() => { setTherapeuticPlanMode('pts'); setActivePeiPlanSubtab('teaching'); }}
                      className={`min-h-10 rounded-xl px-4 text-sm transition-colors ${therapeuticPlanMode === 'pts' ? 'bg-violet-600 text-white shadow-sm' : isPanelDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-white'}`}
                    >
                      PTS
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={therapeuticPlanMode === 'pei'}
                      onClick={() => setTherapeuticPlanMode('pei')}
                      className={`min-h-10 rounded-xl px-4 text-sm transition-colors ${therapeuticPlanMode === 'pei' ? 'bg-violet-600 text-white shadow-sm' : isPanelDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-white'}`}
                    >
                      PEI
                    </button>
                  </div>
                  <p className={`text-xs ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {therapeuticPlanMode === 'pts' ? 'Coordenação clínica compartilhada da equipe.' : 'Metas educacionais e estruturas legadas do paciente.'}
                  </p>
                </div>

                {therapeuticPlanMode === 'pei' && (
                <nav aria-label="Áreas do Plano terapêutico" className={`mb-7 flex gap-2 overflow-x-auto rounded-2xl border p-1.5 shadow-sm ${isPanelDark ? 'bg-slate-900/70 border-slate-700' : 'bg-slate-100/80 border-slate-200'}`} data-therapeutic-plan-navigation>
                  {PEI_PLAN_SUBTABS.map((tab) => {
                    const active = activePeiPlanSubtab === tab.id;
                    const label =
                      tab.id === 'teaching'
                        ? 'Programas'
                        : tab.id === 'maintenance'
                          ? 'Manutenção'
                          : tab.id === 'generalization'
                            ? 'Generalização'
                            : 'Histórico';
                    const badge = tab.id === 'maintenance'
                      ? peiMaintenanceEligibleRows.length + peiMaintenanceScheduledRows.length + peiMaintenanceWaitingRows.length
                      : 0;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActivePeiPlanSubtab(tab.id)}
                        className={`min-h-[44px] shrink-0 rounded-xl border px-5 py-2.5 text-sm font-medium transition-all ${
                          active
                            ? isPanelDark
                              ? 'border-slate-600 bg-slate-800 text-white shadow-sm'
                              : 'border-violet-100 bg-white text-[#7a32fc] shadow-sm'
                            : isPanelDark
                              ? 'border-transparent text-slate-300 hover:bg-slate-800/60'
                              : 'border-transparent text-slate-600 hover:bg-white/70'
                        }`}
                      >
                        {label}
                        {badge > 0 && (
                          <span className="ml-2 rounded-full bg-[#7a32fc]/10 px-2 py-0.5 text-xs text-[#7a32fc]">{badge}</span>
                        )}
                      </button>
                    );
                  })}
                </nav>
                )}

                {(therapeuticPlanMode === 'pts' || activePeiPlanSubtab === 'teaching') && (
                <div className="space-y-4 mb-8">
                  {therapeuticPlanMode === 'pts' && (
                    <TherapeuticPlanPanel
                      patient={patient}
                      protocols={planProtocolCatalog}
                      professionals={clinicTherapists}
                      masteryEvaluations={abaMasteryEvaluationsForPlan}
                      userRole={userRole || resolvedClinicContext?.role || clinicContext?.role}
                      currentUserId={resolvedClinicContext?.userId || clinicContext?.userId || null}
                      isDark={isPanelDark}
                      onStartSession={() => requestSessionStart('fullscreen')}
                    />
                  )}
                  {therapeuticPlanMode === 'pei' && (
                  <details open className={`rounded-2xl border ${isPanelDark ? 'border-slate-700 bg-slate-900/35' : 'border-slate-200 bg-slate-50/70'}`}>
                    <summary className={`cursor-pointer list-none px-4 py-3 text-sm ${isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}>
                      PEI - Plano Educacional Individualizado
                      <span className={`ml-2 text-xs ${isPanelDark ? 'text-slate-500' : 'text-slate-400'}`}>Metas educacionais, protocolos e registros anteriores</span>
                    </summary>
                    <div className="space-y-4 border-t p-4 pt-5 dark:border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className={`text-xs font-semibold uppercase tracking-widest ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>Metas Ativas</h4>
                    <button 
                      onClick={() => setIsAddingPEIGoal(!isAddingPEIGoal)}
                      className={`text-xs font-bold px-4 py-2 rounded-xl transition-all flex items-center gap-2 shadow-sm ${
                        isPanelDark
                          ? 'text-emerald-200 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/20'
                          : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200'
                      }`}
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
                            {planProtocolCatalog.map((p: any) => (
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
                            {(selectedPEIProtocol?.data || []).map((d: any) => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      
                      {selectedPEIDomainId && (
                        <div className="space-y-3 animate-fade-in">
                          <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Habilidade / Meta</label>
                          <div className="grid grid-cols-1 gap-2">
                            {(selectedPEIDomain?.skills || []).map((s: any) => (
                              <button 
                                key={s.id}
                                onClick={() => {
                                  const peiGoalId = Date.now();
                                  const protocolMasteryCriteria = buildProtocolSkillMasteryCriteria(s, 'protocol');
                                  const peiGoal = {
                                    id: peiGoalId,
                                    protocolId: selectedPEIProtocol?.id,
                                    domainId: selectedPEIDomain?.id,
                                    skillId: s.id,
                                    name: s.name,
                                    objective: s.objective,
                                    criteria: s.criteria,
                                    maxScore: s.maxScore || 1,
                                    meta_sucessos: s.meta_sucessos ?? s.metaSucessos ?? s.masteryTarget ?? s.mastery_target,
                                    masteryCriteria: protocolMasteryCriteria || undefined,
                                    mastery_criteria: protocolMasteryCriteria || undefined,
                                    status: 'not_started',
                                    progress: 0,
                                    term: 'short',
                                    isPriority: false,
                                    protocolTitle: selectedPEIProtocol?.title,
                                    domainName: selectedPEIDomain?.name
                                  };
                                  const updatedPatient = {
                                    ...patient,
                                    pei: [...(peiGoals || []), peiGoal]
                                  };
                                  onUpdatePatient(updatedPatient);
                                  setSelectedPEISkillId(String(s.id));
                                  flashPEIConfirmation(peiGoalId, s.id);
                                }}
                                className="relative overflow-hidden text-left p-4 bg-white border border-gray-100 rounded-2xl hover:border-[#05CD99] hover:bg-[#05CD99]/5 transition-all group"
                              >
                                {String(confirmedPEISkillId) === String(s.id) && (
                                  <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[#05CD99]/10 backdrop-blur-[1px] animate-pop">
                                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#05CD99] text-white shadow-xl shadow-emerald-500/30">
                                      <CheckCircle2 size={24} />
                                    </span>
                                  </span>
                                )}
                                <div className="flex justify-between items-center">
                                  <div>
                                    <p className="text-sm font-semibold text-gray-800">{s.name}</p>
                                    <p className="text-[10px] text-gray-500 mt-1">{sanitizeDescriptionForDisplay(s.objective)}</p>
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
                    {peiGoals && peiGoals.length > 0 ? (
                      ['short', 'medium', 'long'].map(term => {
                        const termGoals = peiGoals.filter((g: any) => g.term === term);
                        if (termGoals.length === 0) return null;
                        
                        return (
                          <div key={term} className="space-y-3">
                            <h5 className="text-[10px] font-semibold text-gray-400 uppercase tracking-[0.2em] ml-2">
                              {term === 'short' ? 'Curto Prazo' : term === 'medium' ? 'Médio Prazo' : 'Longo Prazo'}
                            </h5>
                            {termGoals.sort((a: any, b: any) => (b.isPriority ? 1 : 0) - (a.isPriority ? 1 : 0)).map((goal: any) => {
                              const masteryDisplay = resolvePeiGoalMasteryDisplay(goal);
                              const goalMasteryTarget = getGoalMasteryTarget(goal);
                              return (
                              <div key={goal.id} className={`p-5 rounded-2xl border shadow-sm group hover:shadow-md transition-all relative overflow-hidden ${
                                isGoalAcquired(goal)
                                  ? isPanelDark
                                    ? 'bg-gradient-to-br from-emerald-950/70 via-[#101b2e] to-teal-950/50 border-emerald-400/50 ring-1 ring-emerald-400/20 shadow-emerald-950/20'
                                    : 'bg-gradient-to-br from-emerald-50 via-white to-teal-50 border-emerald-300 ring-2 ring-emerald-100 shadow-emerald-100'
                                  : isPanelDark
                                    ? 'bg-[#101b2e] border-slate-700'
                                    : 'bg-white border-slate-200'
                              }`}>
                                {String(confirmedPEIGoalId) === String(goal.id) && (
                                  <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[#05CD99]/10 backdrop-blur-[1px] animate-pop">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#05CD99] text-white shadow-xl shadow-emerald-500/30">
                                      <CheckCircle2 size={26} />
                                    </div>
                                  </div>
                                )}
                                {isGoalAcquired(goal) && (
                                  <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-emerald-400 via-green-500 to-teal-400 pointer-events-none" />
                                )}
                                <div className="flex justify-between items-start mb-3">
                                  <div>
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-[9px] font-semibold text-[#05CD99] bg-[#05CD99]/10 px-2 py-0.5 rounded-full uppercase">{goal.protocolTitle}</span>
                                      <span className={`text-[9px] font-semibold uppercase ${isPanelDark ? 'text-slate-300' : 'text-gray-400'}`}>{goal.domainName}</span>
                                      <select 
                                        className={`text-[9px] font-semibold px-2 py-0.5 rounded-full uppercase outline-none transition-colors ${isPanelDark ? 'bg-slate-800 text-slate-200' : 'bg-gray-100 text-gray-500'}`}
                                        value={goal.term}
                                        onChange={(e) => {
                                          const updatedPEI = peiGoals.map((g: any) => g.id === goal.id ? { ...g, term: e.target.value } : g);
                                          onUpdatePatient({ ...patient, pei: updatedPEI });
                                        }}
                                      >
                                        <option value="short">Curto Prazo</option>
                                        <option value="medium">Médio Prazo</option>
                                        <option value="long">Longo Prazo</option>
                                      </select>
                                    </div>
                                    <h4 className={`font-semibold text-base flex items-center gap-2 ${isPanelDark ? 'text-slate-50' : 'text-gray-800'}`}>
                                      {goal.name}
                                      <button 
                                        onClick={() => {
                                          const updatedPEI = peiGoals.map((g: any) => g.id === goal.id ? { ...g, isPriority: !g.isPriority } : g);
                                          onUpdatePatient({ ...patient, pei: updatedPEI });
                                        }}
                                        className={`p-1 rounded-md transition-all ${goal.isPriority ? 'text-orange-500 bg-orange-50' : isPanelDark ? 'text-slate-400 hover:text-orange-300 hover:bg-slate-800' : 'text-slate-400 hover:text-orange-500 hover:bg-orange-50'}`}
                                        title={goal.isPriority ? "Remover Prioridade" : "Marcar como Prioridade para Sessão"}
                                      >
                                        <Zap size={14} fill={goal.isPriority ? "currentColor" : "none"} />
                                      </button>
                                    </h4>
                                    {patientCategory === 'Criança' && (
                                      <div className="mt-1 mb-2">
                                        <MasteryDots count={getMasteryProgress(goal) || 0} status={isGoalAcquired(goal) ? 'completed' : goal.status} target={goalMasteryTarget} />
                                      </div>
                                    )}
                                    <p className={`text-xs mt-1 ${isPanelDark ? 'text-slate-300' : 'text-gray-500'}`}>{sanitizeDescriptionForDisplay(goal.objective)}</p>
                                    <div className={`mt-3 border-t pt-3 ${isPanelDark ? 'border-slate-700' : 'border-slate-100'}`}>
                                      <p className={`text-[10px] font-semibold uppercase tracking-widest ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>Criterio de maestria</p>
                                      <p className={`mt-1 text-xs font-bold ${masteryDisplay.criterion ? (isPanelDark ? 'text-violet-100' : 'text-[#7a32fc]') : 'text-amber-600'}`}>{masteryDisplay.label}</p>
                                      <p className={`mt-1 text-[11px] font-semibold ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>Origem: {masteryDisplay.sourceLabel}</p>
                                      <p className={`text-[11px] font-semibold ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>Hoje: {masteryDisplay.progressLabel}</p>
                                    </div>
                                  </div>
                                    <div className="flex items-center gap-2">
                                      <select 
                                        className={`text-[10px] font-semibold px-3 py-1.5 rounded-xl outline-none appearance-none uppercase tracking-wider border-2 transition-all ${
                                          isGoalAcquired(goal) ? isPanelDark ? 'bg-emerald-500/20 text-emerald-100 border-emerald-300/40 shadow-sm shadow-emerald-950/20' : 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-200' :
                                          goal.status === 'in_progress' ? isPanelDark ? 'bg-blue-500/15 text-blue-200 border-blue-400/30' : 'bg-blue-50 text-blue-700 border-blue-200' : 
                                          isPanelDark ? 'bg-slate-800 text-slate-300 border-slate-700' : 'bg-slate-100 text-slate-600 border-slate-200'
                                        }`}
                                        value={isGoalAcquired(goal) ? 'completed' : goal.status}
                                        onChange={(e) => {
                                          const nextStatus = e.target.value;
                                          const resetAt = Date.now();
                                          const nextGoal = nextStatus === 'completed'
                                            ? { ...goal, status: nextStatus }
                                            : { ...buildPeiSessionProgressReset([{ ...goal, status: nextStatus }], resetAt)[0], status: nextStatus };
                                          const updatedPEI = peiGoals.map((g: any) => g.id === goal.id ? nextGoal : g);
                                          onUpdatePatient({ ...patient, pei: updatedPEI });
                                          if (nextStatus === 'completed' && patient?.id && abaV2Enabled) {
                                            void ensurePeiMaintenanceScheduleSelection({ ...nextGoal, progressPercent: 100 });
                                          }
                                        }}
                                      >
                                        <option value="not_started">Não Iniciado</option>
                                        <option value="in_progress">Em Treino</option>
                                        <option value="completed">Adquirido</option>
                                      </select>
                                      {patientCategory === 'Criança' && (
                                        <button 
                                          onClick={() => {
                                            if (confirm("Deseja zerar o progresso de maestria desta meta? Isso reiniciará a contagem de acertos consecutivos.")) {
                                              const resetAt = Date.now();
                                              const updatedPEI = peiGoals.map((g: any) => g.id === goal.id ? buildPeiSessionProgressReset([g], resetAt)[0] : g);
                                              onUpdatePatient({ ...patient, pei: updatedPEI });
                                            }
                                          }}
                                          className={`p-2 rounded-xl transition-all ${isPanelDark ? 'text-slate-400 hover:text-orange-300 hover:bg-slate-800' : 'text-slate-400 hover:text-orange-500 hover:bg-orange-50'}`}
                                          title="Zerar Progresso de Maestria"
                                        >
                                          <RotateCcw size={16} />
                                        </button>
                                      )}
                                      <button 
                                        onClick={() => {
                                          const updatedPEI = peiGoals.filter((g: any) => g.id !== goal.id);
                                          onUpdatePatient({ ...patient, pei: updatedPEI });
                                        }}
                                        className={`p-2 rounded-xl transition-all ${isPanelDark ? 'text-slate-400 hover:text-red-300 hover:bg-red-500/10' : 'text-slate-400 hover:text-red-500 hover:bg-red-50'}`}
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                  <div className="flex justify-between items-center">
                                    <span className={`text-[10px] font-semibold uppercase tracking-widest ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>Progresso da Meta</span>
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${
                                      isGoalAcquired(goal) ? isPanelDark ? 'bg-emerald-500/20 text-emerald-100 border border-emerald-300/40' : 'bg-emerald-500 text-white border border-emerald-500 shadow-sm shadow-emerald-200' :
                                      getGoalProgressPercent(goal) >= 60 ? isPanelDark ? 'bg-blue-500/15 text-blue-200 border border-blue-400/30' : 'bg-blue-50 text-blue-700 border border-blue-200' : 
                                      isPanelDark ? 'bg-violet-500/15 text-violet-100 border border-violet-400/30' : 'bg-slate-100 text-slate-700 border border-slate-200'
                                    }`}>{getGoalProgressPercent(goal)}%</span>
                                  </div>
                                  <div className={`relative w-full h-5 rounded-full overflow-hidden shadow-inner border ${
                                    isGoalAcquired(goal)
                                      ? isPanelDark
                                        ? 'bg-emerald-950/60 border-emerald-400/30'
                                        : 'bg-emerald-100 border-emerald-200'
                                      : isPanelDark
                                        ? 'bg-slate-800 border-slate-700'
                                        : 'bg-slate-100 border-slate-200'
                                  }`}>
                                    {/* Progress Fill with Gradient */}
                                    <div 
                                      className={`absolute top-0 left-0 h-full transition-all duration-1000 ease-out ${
                                        isGoalAcquired(goal) ? 'bg-gradient-to-r from-emerald-400 via-green-500 to-teal-500 shadow-lg shadow-emerald-300/40' :
                                        getGoalProgressPercent(goal) >= 100 ? 'bg-gradient-to-r from-green-400 to-emerald-600' :
                                        getGoalProgressPercent(goal) >= 80 ? 'bg-gradient-to-r from-blue-400 to-indigo-500' :
                                        getGoalProgressPercent(goal) >= 60 ? 'bg-gradient-to-r from-cyan-400 to-blue-500' :
                                        getGoalProgressPercent(goal) >= 40 ? 'bg-gradient-to-r from-yellow-400 to-orange-500' :
                                        getGoalProgressPercent(goal) >= 20 ? 'bg-gradient-to-r from-orange-400 to-red-500' :
                                        'bg-gradient-to-r from-red-500 to-rose-600'
                                      }`}
                                      style={{ width: `${getGoalProgressPercent(goal)}%` }}
                                    >
                                      {/* Animated Shine Effect */}
                                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/35 to-transparent -skew-x-12 animate-pulse"></div>
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
                                      disabled={isGoalAcquired(goal)}
                                      value={getGoalProgressPercent(goal)}
                                      onChange={(e) => {
                                        const updatedPEI = peiGoals.map((g: any) => g.id === goal.id ? { ...g, progress: parseInt(e.target.value) } : g);
                                        onUpdatePatient({ ...patient, pei: updatedPEI });
                                      }}
                                    />
                                  </div>
                                  {isGoalAcquired(goal) && (
                                    <div className={`flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-bold ${
                                      isPanelDark
                                        ? 'bg-emerald-500/10 text-emerald-100 border border-emerald-300/20'
                                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    }`}>
                                      <CheckCircle2 size={15} />
                                      Habilidade adquirida. Progresso concluído com 100%.
                                    </div>
                                  )}
                                  {patientCategory === 'Criança' && (
                                    <div className="flex justify-between px-1">
                                      <span className="text-[8px] font-semibold text-gray-300 dark:text-slate-400 uppercase">Início</span>
                                      <span className="text-[8px] font-semibold text-gray-300 dark:text-slate-400 uppercase">Maestria</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                              );
                            })}
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
                  </details>
                  )}
                </div>
                )}
                {therapeuticPlanMode === 'pei' && activePeiPlanSubtab === 'maintenance' && renderPeiMaintenancePanel()}
                {therapeuticPlanMode === 'pei' && activePeiPlanSubtab === 'generalization' && renderPeiGeneralizationPanel()}
                {therapeuticPlanMode === 'pei' && activePeiPlanSubtab === 'history' && renderPeiHistoryPanel()}
              </div>
            )}

            {!isKidsProfile && (
              <React.Fragment>
                <div className={`rounded-3xl border p-5 shadow-sm sm:p-6 ${isPanelDark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-200 bg-white'}`}>
                  <TherapeuticPlanPanel
                    patient={patient}
                    protocols={planProtocolCatalog}
                    professionals={clinicTherapists}
                    masteryEvaluations={abaMasteryEvaluationsForPlan}
                    userRole={userRole || resolvedClinicContext?.role || clinicContext?.role}
                    currentUserId={resolvedClinicContext?.userId || clinicContext?.userId || null}
                    isDark={isPanelDark}
                  />
                </div>
                <div id="new-schedule-card" className={`p-6 rounded-3xl shadow-sm border transition-colors ${isPanelDark ? 'bg-[#101b2e] border-slate-700' : 'bg-white border-slate-200'}`}>
                  <h3 className={`font-semibold text-lg mb-2 tracking-tight ${isPanelDark ? 'text-slate-100' : 'text-slate-800'}`}>Plano Semanal Adulto</h3> 
                  <p className={`text-xs font-medium mb-4 ${isPanelDark ? 'text-slate-300' : 'text-slate-500'}`}>
                    Tarefas para execução fora do consultório, sem pontuação em tempo real.
                  </p>
                  <div className={`flex p-1 rounded-xl mb-6 transition-colors ${isPanelDark ? 'bg-slate-900/70' : 'bg-slate-100'}`}>
                    <button onClick={() => { setPlanType('task'); setFinalTaskTitle(""); setFinalTaskSubtitle(""); setSelectedSkillId(""); }} className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${planType === 'task' ? (isPanelDark ? 'bg-slate-800 text-violet-200 shadow-sm' : 'bg-white text-[#7551FF] shadow-sm') : (isPanelDark ? 'text-slate-300' : 'text-slate-500')}`}>{!isKidsProfile ? 'Avaliação' : 'Tarefa'}</button> 
                    <button onClick={() => { setPlanType('intervention'); setFinalTaskTitle(""); setFinalTaskSubtitle(""); setSelectedSkillId(""); }} className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${planType === 'intervention' ? (isPanelDark ? 'bg-slate-800 text-violet-200 shadow-sm' : 'bg-white text-[#7551FF] shadow-sm') : (isPanelDark ? 'text-slate-300' : 'text-slate-500')}`}>Intervenção</button> 
                    <button onClick={() => { setPlanType('reinforcement'); setFinalTaskTitle(""); setFinalTaskSubtitle(""); setSelectedSkillId(""); }} className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${planType === 'reinforcement' ? (isPanelDark ? 'bg-slate-800 text-violet-200 shadow-sm' : 'bg-white text-[#7551FF] shadow-sm') : (isPanelDark ? 'text-slate-300' : 'text-slate-500')}`}>Reforço</button> 
                  </div> 
                  <div className="space-y-4"> 
                    {(planType === 'task' || planType === 'intervention') ? ( 
                      <React.Fragment> 
                        <div className="flex items-center justify-between mb-2"> 
                          <span className={`text-xs font-semibold uppercase tracking-wider ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Modo</span> 
                          <button onClick={() => setIsCreatingNewTask(!isCreatingNewTask)} className="text-xs font-semibold text-[#7551FF] bg-[#7551FF]/10 px-3 py-1 rounded-full transition-colors hover:bg-[#7551FF]/20">{isCreatingNewTask ? "Selecionar Existente" : "Criar Nova"}</button> 
                        </div> 
                        {isCreatingNewTask ? ( 
                          <div className={`animate-fade-in space-y-4 p-4 rounded-2xl border transition-colors ${planType === 'intervention' ? 'bg-green-50/30 dark:bg-green-500/10 border-green-100 dark:border-green-400/20' : 'bg-[#F4F7FE] dark:bg-slate-900/70 border-blue-100 dark:border-slate-700'}`}>
                            <div><label className="block text-[10px] font-semibold text-gray-400 dark:text-slate-400 uppercase mb-1">Nome da Nova {planType === 'intervention' ? 'Intervenção' : (!isKidsProfile ? 'Avaliação' : 'Tarefa')}</label><input type="text" className="w-full bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-xl p-3 text-sm outline-none border border-transparent dark:border-slate-700 focus:border-[#7551FF]" placeholder={planType === 'intervention' ? "Ex: Autoestima" : (!isKidsProfile ? "Ex: Avaliação de Autonomia" : "Ex: Arrumar a cama")} value={newTaskName} onChange={e => setNewTaskName(e.target.value)} /></div> 
                            {planType === 'task' && (
                              <div className="grid grid-cols-1 gap-3 opacity-80 hover:opacity-100 transition-opacity"> 
                                <div><label className="block text-[10px] font-semibold text-gray-400 dark:text-slate-400 uppercase mb-1">Código/Tag da atividade (opcional)</label><input type="text" className="w-full bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-xl p-2 text-xs outline-none border border-transparent dark:border-slate-700 focus:border-[#7551FF]" placeholder="Ex: ADL-SEMANA-01" value={newTaskCode} onChange={e => setNewTaskCode(e.target.value)} /></div> 
                              </div> 
                            )}
                            <div><label className="block text-[10px] font-semibold text-gray-400 dark:text-slate-400 uppercase mb-1">{planType === 'intervention' ? 'Objetivo / Instruções de Escrita' : 'Objetivo (Base para descrição)'}</label><textarea className="w-full bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-xl p-2 text-xs outline-none border border-transparent dark:border-slate-700 resize-none" rows={planType === 'intervention' ? 4 : 2} placeholder={planType === 'intervention' ? "Ex: Liste 20 qualidades que você tem..." : "Objetivo da tarefa..."} value={newTaskObjective} onChange={e => setNewTaskObjective(e.target.value)}></textarea></div> 
                            {planType === 'task' && (
                              <>
                                <div><label className="block text-[10px] font-semibold text-gray-400 dark:text-slate-400 uppercase mb-1">Exemplos</label><textarea className="w-full bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-xl p-2 text-xs outline-none border border-transparent dark:border-slate-700 resize-none" rows={2} placeholder="Ex: Passo a passo..." value={newTaskExample} onChange={e => setNewTaskExample(e.target.value)}></textarea></div> 
                                <div><label className="block text-[10px] font-semibold text-gray-400 dark:text-slate-400 uppercase mb-1">Orientação de execução</label><textarea className="w-full bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-xl p-2 text-xs outline-none border border-transparent dark:border-slate-700 resize-none" rows={2} placeholder="Como o paciente/família deve executar durante a semana..." value={newTaskCriteria} onChange={e => setNewTaskCriteria(e.target.value)}></textarea></div> 
                              </>
                            )}
                            <div><label className="block text-[10px] font-semibold text-gray-400 dark:text-slate-400 uppercase mb-1">Anotações do Profissional</label><textarea className="w-full bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-xl p-2 text-xs outline-none border border-transparent dark:border-slate-700 resize-none" rows={2} value={newTaskComment || ''} onChange={(e) => setNewTaskComment(e.target.value)} placeholder="Anotações do profissional..."></textarea></div> 
                            <div className={`pt-2 border-t mt-2 ${planType === 'intervention' ? 'border-green-100 dark:border-green-400/20' : 'border-blue-100 dark:border-slate-700'}`}>
                              <label className="block text-[10px] font-semibold text-gray-400 dark:text-slate-400 uppercase mb-2">Salvar no Protocolo:</label> 
                              <div className="flex gap-2 mb-3"> 
                                <button onClick={() => setAddToProtocolMode('existing')} className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${addToProtocolMode === 'existing' ? 'bg-white dark:bg-slate-800 border-[#7551FF] text-[#7551FF] dark:text-violet-200' : 'border-transparent bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-300'}`}>Existente</button> 
                                <button onClick={() => setAddToProtocolMode('new')} className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${addToProtocolMode === 'new' ? 'bg-white dark:bg-slate-800 border-[#7551FF] text-[#7551FF] dark:text-violet-200' : 'border-transparent bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-300'}`}>Novo</button> 
                              </div> 
                              {addToProtocolMode === 'existing' ? ( 
                                <div className="space-y-2"> 
                                  <select className="w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-2 text-xs text-slate-800 dark:text-slate-100 outline-none" value={targetProtocolId} onChange={e => setTargetProtocolId(e.target.value)}><option value="">Selecione Protocolo...</option>{planProtocolCatalog.filter((p: any) => planType === 'intervention' ? p.category === 'intervention' : (p.category === 'evaluation' || !p.category)).map((p: any) => <option key={p.id} value={p.id}>{p.title}</option>)}</select> 
                                  {targetProtocol && (<select className="w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-2 text-xs text-slate-800 dark:text-slate-100 outline-none" value={targetDomainId} onChange={e => setTargetDomainId(e.target.value)}><option value="">Selecione Domínio...</option>{targetProtocol.data.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>)} 
                                </div> 
                              ) : ( 
                                <div className="space-y-2"> 
                                  <input type="text" className="w-full bg-white dark:bg-slate-800 rounded-xl p-2 text-xs text-slate-800 dark:text-slate-100 outline-none border border-gray-200 dark:border-slate-700" placeholder="Nome do Novo Protocolo" value={newProtocolName} onChange={e => setNewProtocolName(e.target.value)} /> 
                                  <input type="text" className="w-full bg-white dark:bg-slate-800 rounded-xl p-2 text-xs text-slate-800 dark:text-slate-100 outline-none border border-gray-200 dark:border-slate-700" placeholder="Nome do Domínio (Categoria)" value={newDomainName} onChange={e => setNewDomainName(e.target.value)} /> 
                                </div> 
                              )} 
                            </div> 
                          </div> 
                        ) : ( 
                          <div className="animate-fade-in space-y-4"> 
                            <div className={`p-3 rounded-xl border mb-2 transition-colors ${isPanelDark ? 'bg-slate-900/60 border-slate-700' : 'bg-blue-50/50 border-blue-100'}`}>
                              <button onClick={() => setIsPlanFilterOpen(!isPlanFilterOpen)} className="w-full flex items-center justify-between text-[#7a32fc] mb-2">
                                <div className="flex items-center gap-2"><Filter size={14}/><span className="text-[10px] font-semibold uppercase tracking-widest">Filtrar Protocolos</span></div> 
                                <ChevronDown size={14} className={`transition-transform ${isPlanFilterOpen ? 'rotate-180' : ''}`} />
                              </button>

                              {isPlanFilterOpen && (
                                <div className="space-y-2 animate-fade-in">
                                  <div className="grid grid-cols-2 gap-2 mb-2"> 
                                    <select className={`border rounded-lg p-1.5 text-xs outline-none font-semibold ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-blue-100 text-slate-700'}`} value={filterAge} onChange={(e) => setFilterAge(e.target.value)}> 
                                      <option value="">Faixa Etária (Todas)</option> <option value="child">0 a 12 anos</option> <option value="teen">13 a 18 anos</option> <option value="adult">19 a 59 anos</option> <option value="senior">60 anos ou mais</option> 
                                    </select> 
                                    <select className={`border rounded-lg p-1.5 text-xs outline-none font-semibold ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-blue-100 text-slate-700'}`} value={filterType} onChange={(e) => setFilterType(e.target.value)}> 
                                      <option value="">Tipo (Todos)</option> <option value="conventional">Convencional</option> <option value="neurodevelopment">Neurodesenvolvimento</option> <option value="occupational">T. Ocupacional</option> 
                                    </select> 
                                  </div> 
                                  <div className="relative"> 
                                    <Search className={`absolute left-2 top-1/2 -translate-y-1/2 ${isPanelDark ? 'text-slate-400' : 'text-gray-400'}`} size={12} /> <input type="text" className={`w-full border rounded-lg p-1.5 pl-7 text-xs outline-none font-semibold ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-blue-100 text-slate-700'}`} placeholder="Buscar por tema..." value={filterDomain} onChange={(e) => setFilterDomain(e.target.value)} /> 
                                  </div> 
                                </div>
                              )}
                            </div> 
                            <div><label className={`block text-xs font-semibold uppercase tracking-wider mb-1 ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Protocolo ({filteredProtocols.filter((p: any) => planType === 'intervention' ? p.category === 'intervention' : (p.category === 'evaluation' || !p.category)).length})</label>
                              <select 
                                className={`w-full border rounded-xl p-3 text-sm outline-none font-semibold ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`} 
                                value={selectedProtocolId} 
                                onChange={e => { setSelectedProtocolId(e.target.value); setSelectedDomainId(''); setSelectedSkillId(''); }}
                              >
                                <option value="">Selecione...</option>
                                {planType === 'task' && peiGoals && peiGoals.length > 0 && (
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
                                <label className={`block text-xs font-semibold uppercase tracking-wider mb-1 ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Meta do PEI</label>
                                <select 
                                  className={`w-full border rounded-xl p-3 text-sm outline-none font-semibold ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`} 
                                  value={selectedSkillId} 
                                  onChange={e => {
                                    const goal = peiGoals.find((g: any) => String(g.id) === e.target.value);
                                    setSelectedSkillId(e.target.value);
                                    if (goal) {
                                      setFinalTaskTitle(goal.name);
                                      setFinalTaskSubtitle(goal.objective);
                                    }
                                  }}
                                >
                                  <option value="">Selecione uma meta...</option>
                                  {peiGoals.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                                </select>
                              </div>
                            ) : (
                              <React.Fragment>
                                {selectedProtocol && (<div><label className={`block text-xs font-semibold uppercase tracking-wider mb-1 ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Domínio</label><select className={`w-full border rounded-xl p-3 text-sm outline-none font-semibold ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`} value={selectedDomainId} onChange={e => { setSelectedDomainId(e.target.value); setSelectedSkillId(''); }}><option value="">Selecione...</option>{selectedProtocol.data.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>)} 
                                {selectedDomain && (<div><label className={`block text-xs font-semibold uppercase tracking-wider mb-1 ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>{planType === 'intervention' ? 'Tarefa de Intervenção' : 'Habilidade / Tarefa'}</label><select className={`w-full border rounded-xl p-3 text-sm outline-none font-semibold ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`} value={selectedSkillId} onChange={e => {
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
                              <label className={`block text-[10px] font-semibold uppercase mb-1 ${isPanelDark ? 'text-slate-400' : 'text-gray-500'}`}>Vincular Protocolo de Intervenção</label>
                              <select 
                                className={`w-full border rounded-xl p-3 text-xs font-semibold outline-none focus:border-[#7551FF] transition-all ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-gray-200 text-gray-700'}`} 
                                value={linkedInterventionProtocolId} 
                                onChange={(e) => setLinkedInterventionProtocolId(e.target.value)}
                              >
                                <option value="">Nenhum protocolo vinculado</option>
                                {planProtocolCatalog.filter((p: any) => p.category === 'intervention').map((p: any) => (
                                  <option key={p.id} value={p.id}>{p.title}</option>
                                ))}
                              </select>
                              <p className={`text-[9px] mt-1 font-medium italic ${isPanelDark ? 'text-slate-400' : 'text-gray-500'}`}>* Define qual protocolo será sugerido para intervenção após esta avaliação.</p>
                            </div>
                          </div>
                        )}
                        {planType === 'intervention' && (
                          <div className="space-y-4">
                            <div>
                              <label className={`block text-[10px] font-semibold uppercase mb-1 ${isPanelDark ? 'text-slate-400' : 'text-gray-500'}`}>Vincular a Habilidade de Avaliação</label>
                              <select 
                                className={`w-full border rounded-xl p-3 text-xs font-semibold outline-none focus:border-[#7551FF] transition-all ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-gray-200 text-gray-700'}`} 
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
                            <div className={`p-4 rounded-2xl border flex items-center justify-between ${isPanelDark ? 'bg-green-500/10 border-green-400/20' : 'bg-green-50/50 border-green-100'}`}>
                              <div>
                                <p className={`text-xs font-semibold ${isPanelDark ? 'text-slate-100' : 'text-gray-700'}`}>Lembrete Diário</p>
                                <p className={`text-[10px] ${isPanelDark ? 'text-slate-300' : 'text-gray-500'}`}>Notificar o paciente para ler esta tarefa todos os dias.</p>
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
                          <div><label className={`block text-xs font-semibold uppercase tracking-wider mb-1 ${isPanelDark ? 'text-slate-400' : 'text-gray-500'}`}>Data</label><input type="date" className={`w-full border rounded-xl p-3 text-sm outline-none ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-gray-200 text-slate-800'}`} value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} /></div> 
                          <div><label className={`block text-xs font-semibold uppercase tracking-wider mb-1 ${isPanelDark ? 'text-slate-400' : 'text-gray-500'}`}>Hora</label><input type="time" className={`w-full border rounded-xl p-3 text-sm outline-none ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-gray-200 text-slate-800'}`} value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} /></div> 
                        </div> 
                        <button onClick={handleSchedule} disabled={!isFormValid()} className={`w-full font-semibold py-3 rounded-xl shadow-lg transition-opacity mt-4 ${isFormValid() ? 'bg-[#7551FF] text-white hover:opacity-90' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>Confirmar Agendamento</button> 
                      </React.Fragment> 
                    ) : ( 
                      <div> 
                        <label className={`block text-xs font-semibold uppercase tracking-wider mb-1 ${isPanelDark ? 'text-slate-400' : 'text-gray-500'}`}>Mensagem de Reforço</label> 
                        <textarea className={`w-full h-24 border rounded-xl p-3 text-sm outline-none resize-none ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-gray-50 border-gray-200 text-slate-800'}`} placeholder="Ex: Parabéns pela dedicação hoje!" value={message} onChange={e => setMessage(e.target.value)}></textarea> 
                        <div className="grid grid-cols-2 gap-4 mt-2"> 
                          <div><label className={`block text-xs font-semibold uppercase tracking-wider mb-1 ${isPanelDark ? 'text-slate-400' : 'text-gray-500'}`}>Data</label><input type="date" className={`w-full border rounded-xl p-3 text-sm outline-none ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-gray-50 border-gray-200 text-slate-800'}`} value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} /></div> 
                          <div><label className={`block text-xs font-semibold uppercase tracking-wider mb-1 ${isPanelDark ? 'text-slate-400' : 'text-gray-500'}`}>Hora</label><input type="time" className={`w-full border rounded-xl p-3 text-sm outline-none ${isPanelDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-gray-50 border-gray-200 text-slate-800'}`} value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} /></div> 
                        </div> 
                        <button onClick={handleSchedule} disabled={!isFormValid()} className={`w-full font-semibold py-3 rounded-xl shadow-lg transition-opacity mt-4 ${isFormValid() ? 'bg-[#7551FF] text-white hover:opacity-90' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>Confirmar Agendamento</button> 
                      </div> 
                    )} 
                  </div> 
                </div> 
                {!isKidsProfile && suggestedInterventionTasks.length > 0 && (
                  <div className={`rounded-3xl border p-4 shadow-sm ${isPanelDark ? 'bg-emerald-500/5 border-emerald-400/15' : 'bg-emerald-50/60 border-emerald-100'}`}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className={`text-[10px] font-semibold uppercase tracking-widest ${isPanelDark ? 'text-emerald-200' : 'text-emerald-700'}`}>Sugestões discretas de intervenção</p>
                        <p className={`text-xs ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Geradas após pontuações baixas. Use apenas quando fizer sentido para o plano do paciente.</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {suggestedInterventionTasks.map((suggestion: any) => {
                        const title = String(suggestion?.title || suggestion?.task_data?.title || 'Intervenção sugerida');
                        const description = normalizeNoteText(String(suggestion?.description || suggestion?.task_data?.description || ''));
                        return (
                          <div key={String(suggestion?.id || suggestion?.sourceAssignedTaskId || title)} className={`rounded-2xl border p-3 ${isPanelDark ? 'bg-slate-900/50 border-slate-700' : 'bg-white/80 border-emerald-100'}`}>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <p className={`text-sm font-semibold ${isPanelDark ? 'text-slate-100' : 'text-slate-800'}`}>{title}</p>
                                {description && <p className={`mt-1 text-xs leading-relaxed ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>{description}</p>}
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPlanType('intervention');
                                    setIsCreatingNewTask(true);
                                    setNewTaskName(title.replace(/^Intervenção sugerida:\s*/i, ''));
                                    setNewTaskObjective(description);
                                    setFinalTaskTitle(title.replace(/^Intervenção sugerida:\s*/i, ''));
                                    setFinalTaskSubtitle(description);
                                  }}
                                  className={`rounded-xl px-3 py-2 text-[10px] font-semibold uppercase tracking-widest transition-colors ${isPanelDark ? 'bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}
                                >
                                  Usar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSuggestedInterventionTasks((prev) => prev.filter((item: any) => String(item?.id || item?.sourceAssignedTaskId) !== String(suggestion?.id || suggestion?.sourceAssignedTaskId)))}
                                  className={`rounded-xl p-2 transition-colors ${isPanelDark ? 'text-slate-500 hover:bg-slate-800 hover:text-slate-200' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'}`}
                                  title="Ocultar sugestão"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="space-y-3"> 
                  <h3 className={`text-sm font-semibold uppercase tracking-wider ml-2 tracking-widest ${isPanelDark ? 'text-slate-400' : 'text-gray-500'}`}>Agendados</h3> 
                  {((isKidsProfile ? (patientTasks || []) : adultScheduledTasks).length || 0) > 0 ? ((isKidsProfile ? (patientTasks || []) : adultScheduledTasks).map((task: any) => ( 
                    <div key={task.id} className={`p-4 rounded-2xl border shadow-sm flex items-center justify-between ${isPanelDark ? 'bg-[#14233a] border-slate-700' : 'bg-white border-gray-100'}`}>
                      <div className="flex items-center gap-3"> 
                        <span className="text-xl">{task.type === 'reinforcement' ? '🌟' : task.type === 'intervention' ? '✍️' : '📋'}</span> 
                        <div><p className={`font-semibold text-sm tracking-tight ${isPanelDark ? 'text-slate-100' : 'text-gray-800'}`}>{task.title}</p><p className={`text-xs ${isPanelDark ? 'text-slate-300' : 'text-gray-500'}`}>{new Date(task.scheduledAt).toLocaleDateString('pt-BR')} • {new Date(task.scheduledAt).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}</p></div> 
                      </div> 
                      <div className="flex items-center gap-2"> 
                        <span className={`text-[10px] font-semibold px-2 py-1 rounded-full uppercase ${task.type === 'reinforcement' ? 'bg-yellow-100 text-yellow-600' : task.type === 'intervention' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}`}>{task.type === 'reinforcement' ? 'Reforço' : task.type === 'intervention' ? 'Intervenção' : (!isKidsProfile ? 'Avaliação' : 'Tarefa')}</span> 
                        {task.source !== 'server' && (
                          <button onClick={() => setEditingTask(task)} className={`p-2 rounded-lg transition-colors hover:text-[#7551FF] ${isPanelDark ? 'text-slate-400 hover:bg-slate-800' : 'text-gray-400 hover:bg-gray-100'}`}> <Edit size={16} /> </button>
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
                    ) : assignedTasksLoadError ? (
                      <div className="rounded-2xl border border-red-100 bg-red-50/60 p-4" role="alert">
                        <p className="text-sm text-red-700">{assignedTasksLoadError}</p>
                        <button
                          type="button"
                          onClick={() => {
                            assignedTasksLoadedForRef.current = '';
                            setAssignedTasksReloadKey((value) => value + 1);
                          }}
                          className="mt-3 min-h-11 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-100"
                        >
                          Tentar novamente
                        </button>
                      </div>
                    ) : pendingAssignedReviews.length === 0 ? (
                      <p className="text-sm text-gray-400 italic py-3">Sem tarefas pendentes de pontuação profissional.</p>
                    ) : (
                      pendingAssignedReviews.map((task: any) => {
                        const reviewKey = String(task.id);
                        const draft = assignedReviewDrafts[reviewKey] || { score: '', note: '' };
                        const taskData = task?.task_data && typeof task.task_data === 'object' ? task.task_data : {};
                        const reviewContext = resolveAssignedTaskEvaluationContext(task);
                        const dynamicMaxScore = resolveAssignedTaskMaxScore(task);
                        const displayedTitle = taskData?.title || task?.title || 'Tarefa';
                        return (
                          <div key={reviewKey} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold text-gray-800 text-sm tracking-tight">{displayedTitle}</p>
                                <div className="mt-2 w-full max-w-xs rounded-xl border border-slate-100 bg-slate-50 p-2">
                                  <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                                    <span>Energia após a atividade</span>
                                    <span className="font-semibold text-slate-800 flex items-center gap-1">
                                      <span>{String(task?.patient_effort_emoji || taskData?.patientEffortEmoji || taskData?.patient_effort_emoji || getEffortEmoji(task?.patient_effort ?? taskData?.patientEffort ?? taskData?.patient_effort ?? 0))}</span>
                                      {normalizeEffortPercent(task?.patient_effort ?? taskData?.patientEffort ?? taskData?.patient_effort ?? 0)}%
                                    </span>
                                  </div>
                                  <div className="h-1.5 bg-white rounded-full overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-gradient-to-r from-[#fb5a4d] via-[#f6c04d] to-[#05CD99]"
                                      style={{ width: `${normalizeEffortPercent(task?.patient_effort ?? taskData?.patientEffort ?? taskData?.patient_effort ?? 0)}%` }}
                                    />
                                  </div>
                                  <div className="mt-1 flex justify-between text-[9px] font-semibold text-gray-400">
                                    <span>Baixa</span>
                                    <span>Média</span>
                                    <span>Alta</span>
                                  </div>
                                </div>
                                {reviewContext?.protocol && (
                                  <p className="text-[11px] text-[#7a32fc] font-semibold mt-1">
                                    {String(reviewContext.protocol?.title || reviewContext.protocol?.name || 'Protocolo')} • 0-{dynamicMaxScore}
                                  </p>
                                )}
                              </div>
                              <span className="text-[10px] font-semibold px-2 py-1 rounded-full uppercase bg-orange-100 text-orange-600">
                                Aguardando nota
                              </span>
                            </div>
                            {task?.patient_comment && (
                              <p className="text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-xl p-3 whitespace-pre-wrap">
                                {normalizeNoteText(task.patient_comment)}
                              </p>
                            )}
                            {renderAssignedReviewCriteriaPanel(task, reviewContext)}
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
        ) : activeTab === 'aba-charts' ? (
          <ClinicalChartsWorkspace patientId={String(patient.id)} organizationId={String(resolvedClinicContext?.clinicId || clinicContext?.clinicId || patient?.clinicId || patient?.clinic_id || '')} isPanelDark={isPanelDark} showAbaDetails={isKidsProfile && abaV2Enabled} showAbaV3Details={isKidsProfile && abaV3UiEnabled} showClinicalMeasurementV3Details={abaV3UiEnabled} />
        ) : activeTab === 'session' && isKidsProfile ? (
          null
        ) : activeTab === 'school' ? (
          <PatientSchoolInformation patientId={String(patient.id)} canManage={canManageSchool} isPanelDark={isPanelDark} />
        ) : (
          <div className="space-y-6 animate-fade-in">
            <div className={`p-6 rounded-3xl shadow-sm border transition-colors ${isPanelDark ? 'bg-[#101b2e] border-slate-700' : 'bg-white border-gray-100'}`}>
              <h3 className={`font-semibold text-lg mb-4 flex items-center gap-2 tracking-tight ${isPanelDark ? 'text-slate-100' : 'text-gray-800'}`}>
                <UploadCloud className="text-[#7a32fc]" size={20} /> Upload de Documentos
              </h3>
              <div id="file-upload-btn" className="relative group">
                <input 
                  type="file" 
                  id="patient-file-upload" 
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden" 
                  onChange={handleFileUpload}
                  disabled={isUploadingFile || patientFileStorageIsFull}
                />
                <label 
                  htmlFor="patient-file-upload" 
                  className={`w-full py-10 border-2 border-dashed rounded-[24px] flex flex-col items-center justify-center transition-all duration-300 ${patientFileStorageIsFull ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'} ${isUploadingFile || patientFileStorageIsFull ? (isPanelDark ? 'bg-slate-900/60 border-slate-700' : 'bg-gray-50 border-gray-200') : (isPanelDark ? 'bg-slate-900/60 border-slate-700 hover:border-[#7a32fc] hover:bg-slate-900' : 'bg-blue-50/30 border-blue-200 hover:border-[#7a32fc] hover:bg-blue-50')}`}
                >
                  {isUploadingFile ? (
                    <div className="w-full max-w-[240px] text-center">
                      <div className={`h-2 w-full rounded-full mb-3 overflow-hidden ${isPanelDark ? 'bg-slate-800' : 'bg-gray-100'}`}>
                        <div className="h-full bg-[#7a32fc] transition-all duration-200" style={{ width: `${uploadProgress}%` }}></div>
                      </div>
                      <span className={`text-sm font-semibold animate-pulse ${isPanelDark ? 'text-slate-300' : 'text-gray-500'}`}>Enviando arquivo... {uploadProgress}%</span>
                    </div>
                  ) : (
                    <React.Fragment>
                      <div className={`p-4 rounded-full mb-3 shadow-sm group-hover:rotate-6 transition-transform ${isPanelDark ? 'bg-violet-500/10 text-violet-200' : 'bg-blue-100 text-[#7a32fc]'}`}>
                        <FileUp size={32} />
                      </div>
                      <p className={`text-base font-semibold ${isPanelDark ? 'text-slate-100' : 'text-gray-700'}`}>
                        {patientFileStorageIsFull ? 'Limite de armazenamento atingido' : 'Clique para selecionar ou arraste arquivos'}
                      </p>
                      <p className={`text-xs mt-1 uppercase font-medium ${isPanelDark ? 'text-slate-400' : 'text-gray-400'}`}>PDF, JPG, PNG, DOCX (Máx. 10MB)</p>
                      <p className={`text-xs mt-2 ${patientFileStorageIsFull ? (isPanelDark ? 'text-red-300' : 'text-red-600') : (isPanelDark ? 'text-slate-400' : 'text-gray-500')}`}>
                        {formatPatientFileStorageBytes(patientFileStorageUsage.usedBytes)} de 1 GB usados
                        {patientFileStorageIsFull ? ' · remova arquivos para liberar espaço' : ''}
                      </p>
                    </React.Fragment>
                  )}
                </label>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className={`text-sm font-semibold uppercase tracking-wider ml-2 flex items-center gap-2 tracking-widest ${isPanelDark ? 'text-slate-400' : 'text-gray-400'}`}>
                <File size={16} /> Arquivos Salvos ({patientFiles.length})
              </h3>
              {isLoadingFiles ? (
                <div className={`text-center py-10 rounded-3xl border border-dashed transition-colors ${isPanelDark ? 'bg-slate-900/60 border-slate-700' : 'bg-white/50 border-gray-200'}`}>
                  <p className={`text-sm font-medium ${isPanelDark ? 'text-slate-300' : 'text-gray-500'}`}>Carregando arquivos do prontuário...</p>
                </div>
              ) : patientFilesLoadError ? (
                <div className={`rounded-3xl border border-dashed px-5 py-8 text-center ${isPanelDark ? 'border-red-400/30 bg-red-500/5' : 'border-red-200 bg-red-50/60'}`} role="alert">
                  <p className={`text-sm font-medium ${isPanelDark ? 'text-red-200' : 'text-red-700'}`}>{patientFilesLoadError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      patientFilesLoadedForRef.current = '';
                      setPatientFilesReloadKey((value) => value + 1);
                    }}
                    className={`mt-4 min-h-11 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${isPanelDark ? 'border-red-300/30 text-red-100 hover:bg-red-400/10' : 'border-red-200 bg-white text-red-700 hover:bg-red-100'}`}
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : patientFiles.length > 0 ? patientFiles.map((file: any) => (
                <div key={file.id} className={`p-4 rounded-2xl border shadow-sm flex items-center justify-between group transition-all animate-slide-up ${isPanelDark ? 'bg-[#101b2e] border-slate-700 hover:border-violet-400/30' : 'bg-white border-gray-100 hover:border-blue-100'}`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isPanelDark ? 'bg-slate-800 text-violet-200' : 'bg-gray-50 text-[#7a32fc]'}`}>
                      {file.type.includes('pdf') ? <FileText size={24} /> : file.type.includes('image') ? <Activity size={24} /> : <File size={24} />}
                    </div>
                    <div>
                      <p className={`font-semibold text-sm truncate max-w-[200px] tracking-tight ${isPanelDark ? 'text-slate-100' : 'text-gray-800'}`}>{file.name}</p>
                      <p className={`text-[10px] font-semibold uppercase ${isPanelDark ? 'text-slate-400' : 'text-gray-400'}`}>{file.size} • {file.date}</p>
                      <p className={`mt-1 text-[10px] font-medium ${isPanelDark ? 'text-violet-300' : 'text-violet-600'}`}>
                        {patientFileAccessLabels[String(file.accessScope || 'PATIENT_ACCESS').toUpperCase()] || 'Acesso do paciente'}
                        {file.patientPortalVisible ? ' · Paciente/responsável' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {file.canManageAccess && (
                      <button
                        type="button"
                        title="Gerenciar quem pode ver"
                        onClick={() => void openPatientFileAccessEditor(file)}
                        className={`p-2.5 rounded-xl transition-all ${isPanelDark ? 'text-violet-300 hover:text-white hover:bg-violet-500/10' : 'text-violet-500 hover:text-violet-700 hover:bg-violet-50'}`}
                      >
                        <SlidersHorizontal size={18} />
                      </button>
                    )}
                    <button
                      title="Visualizar"
                      onClick={() => void openPatientFilePreview(file)}
                      className={`p-2.5 rounded-xl transition-all ${isPanelDark ? 'text-slate-400 hover:text-violet-200 hover:bg-slate-800' : 'text-gray-400 hover:text-[#7a32fc] hover:bg-blue-50'}`}
                    >
                      <Eye size={18} />
                    </button>
                    <button
                      title="Download"
                      onClick={() => void handleDownloadPatientFile(file)}
                      className={`p-2.5 rounded-xl transition-all ${isPanelDark ? 'text-slate-400 hover:text-violet-200 hover:bg-slate-800' : 'text-gray-400 hover:text-[#7a32fc] hover:bg-blue-50'}`}
                    >
                      <Download size={18} />
                    </button>
                    <button onClick={() => removeFile(file.id)} title="Excluir" className={`p-2.5 rounded-xl transition-all ${isPanelDark ? 'text-slate-400 hover:text-red-300 hover:bg-red-500/10' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'}`}>
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              )) : (
                <div className={`text-center py-10 rounded-3xl border border-dashed transition-colors ${isPanelDark ? 'bg-slate-900/60 border-slate-700' : 'bg-white/50 border-gray-200'}`}>
                  <FileText size={40} className={`mx-auto mb-2 opacity-50 ${isPanelDark ? 'text-slate-600' : 'text-gray-300'}`} />
                  <p className={`text-sm font-medium italic ${isPanelDark ? 'text-slate-400' : 'text-gray-400'}`}>Nenhum arquivo anexado a este prontuário.</p>
                </div>
              )}
            </div>
          </div>
        )}
        </div>
      </div> 

      {fileAccessEditor && (
        <div className="fixed inset-0 z-[205] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className={`w-full max-w-xl rounded-3xl border p-6 shadow-2xl ${isPanelDark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-100 bg-white'}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${isPanelDark ? 'text-violet-300' : 'text-violet-500'}`}>Nível de acesso</p>
                <h3 className={`mt-1 truncate text-lg font-semibold ${isPanelDark ? 'text-white' : 'text-slate-900'}`}>{fileAccessEditor.file?.name || 'Arquivo'}</h3>
                <p className={`mt-1 text-xs ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Somente quem enviou este arquivo pode alterar estas permissões.</p>
              </div>
              <button type="button" onClick={() => { setFileAccessEditor(null); setFileAccessCandidates([]); setFileAccessError(''); }} className={`rounded-xl p-2 ${isPanelDark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-400 hover:bg-slate-100'}`} aria-label="Fechar">
                <X size={18} />
              </button>
            </div>

            {fileAccessLoading ? (
              <div className={`mt-5 rounded-2xl border border-dashed px-4 py-8 text-center text-sm ${isPanelDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-500'}`}>Carregando permissões...</div>
            ) : (
              <div className="mt-5 space-y-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    ['OWNER', 'Somente eu', 'Apenas você entre os profissionais; o portal é controlado separadamente abaixo.'],
                    ['CASE_TEAM', 'Equipe do caso', 'Profissionais ativos vinculados a este paciente.'],
                    ['PATIENT_ACCESS', 'Acesso ao paciente', 'Mantém a visibilidade para quem já pode acessar este paciente.'],
                    ['SELECTED', 'Pessoas selecionadas', 'Escolha profissionais específicos da equipe do caso.']
                  ].map(([value, label, description]) => {
                    const selected = fileAccessEditor.accessScope === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setFileAccessEditor((current: any) => ({ ...current, accessScope: value }))}
                        className={`rounded-2xl border p-3 text-left transition ${selected ? (isPanelDark ? 'border-violet-400 bg-violet-500/10' : 'border-violet-300 bg-violet-50') : (isPanelDark ? 'border-slate-700 bg-slate-900/50 hover:border-slate-600' : 'border-slate-200 bg-white hover:border-violet-200')}`}
                      >
                        <span className={`block text-sm font-medium ${selected ? (isPanelDark ? 'text-violet-200' : 'text-violet-700') : (isPanelDark ? 'text-slate-100' : 'text-slate-800')}`}>{label}</span>
                        <span className={`mt-1 block text-[11px] leading-relaxed ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>{description}</span>
                      </button>
                    );
                  })}
                </div>

                {fileAccessEditor.accessScope === 'SELECTED' && (
                  <div className={`max-h-52 overflow-y-auto rounded-2xl border p-3 ${isPanelDark ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-slate-50/70'}`}>
                    <p className={`mb-2 text-xs font-medium ${isPanelDark ? 'text-slate-200' : 'text-slate-700'}`}>Profissionais da equipe do caso</p>
                    {fileAccessCandidates.length ? fileAccessCandidates.map((candidate: any) => {
                      const checked = Array.isArray(fileAccessEditor.selectedUserIds) && fileAccessEditor.selectedUserIds.includes(candidate.id);
                      return (
                        <label key={candidate.id} className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl px-2 py-2 ${isPanelDark ? 'hover:bg-slate-800' : 'hover:bg-white'}`}>
                          <span className="min-w-0">
                            <span className={`block truncate text-sm font-medium ${isPanelDark ? 'text-slate-100' : 'text-slate-800'}`}>{candidate.name}</span>
                            <span className={`block truncate text-[10px] ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>{candidate.specialty || 'Equipe do caso'}</span>
                          </span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setFileAccessEditor((current: any) => ({
                              ...current,
                              selectedUserIds: checked
                                ? current.selectedUserIds.filter((id: string) => id !== candidate.id)
                                : [...current.selectedUserIds, candidate.id]
                            }))}
                            className="h-4 w-4 accent-[#7a32fc]"
                          />
                        </label>
                      );
                    }) : (
                      <p className={`py-3 text-xs ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Nenhum outro profissional ativo na equipe do caso.</p>
                    )}
                  </div>
                )}

                <label className={`flex items-center justify-between gap-4 rounded-2xl border p-4 ${isPanelDark ? 'border-slate-700 bg-slate-900/60' : 'border-emerald-100 bg-emerald-50/50'}`}>
                  <span>
                    <span className={`block text-sm font-medium ${isPanelDark ? 'text-slate-100' : 'text-slate-800'}`}>Paciente/responsável pode ver</span>
                    <span className={`mt-1 block text-[11px] ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Libera este arquivo também no portal do paciente.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={fileAccessEditor.patientPortalVisible === true}
                    onChange={(event) => setFileAccessEditor((current: any) => ({ ...current, patientPortalVisible: event.target.checked }))}
                    className="h-5 w-5 accent-[#7a32fc]"
                  />
                </label>

                {fileAccessError && <p className={`rounded-xl px-3 py-2 text-xs font-medium ${isPanelDark ? 'bg-red-500/10 text-red-200' : 'bg-red-50 text-red-700'}`} role="alert">{fileAccessError}</p>}

                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => { setFileAccessEditor(null); setFileAccessCandidates([]); setFileAccessError(''); }} className={`rounded-xl px-4 py-2.5 text-sm font-medium ${isPanelDark ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700'}`}>Cancelar</button>
                  <button type="button" disabled={fileAccessSaving || (fileAccessEditor.accessScope === 'SELECTED' && fileAccessEditor.selectedUserIds.length === 0)} onClick={() => void savePatientFileAccess()} className="rounded-xl bg-[#7a32fc] px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
                    {fileAccessSaving ? 'Salvando...' : 'Salvar acesso'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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
                disabled={isSavingAnamnesisFile}
                className="px-4 py-2.5 rounded-xl bg-[#7a32fc] text-white font-semibold text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingAnamnesisFile ? 'Salvando...' : 'Salvar em Arquivos'}
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
