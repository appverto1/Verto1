import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { countCanonicalFamilyStars } from '../utils/familyDiaryStars';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, LogOut, BookOpen, X, BatteryCharging, BatteryFull, Zap, Check, RefreshCcw, Smile, ChevronDown, ChevronLeft, ChevronRight, CheckCircle, Camera, Trash2, Pencil, Menu, MessageCircle, Settings, User, MapPin, Bell, CalendarDays, Clock, Ban, FileSignature, FileText } from 'lucide-react';
import { PortalSharedClinicalChart } from './PortalSharedClinicalChart';
import { LogoVerto, SuccessOverlay, BigEnergySlider, ENERGY_TAGS, ADULT_CONVENTIONAL_TAGS } from './Common';
import { HistoryCard } from './History';
import { DrawingCanvas } from './DrawingCanvas';
import { dataService } from '../services/dataService';
import { SecureImage } from './SecureMedia';
import { PatientCareNetworkPanel } from './PatientCareNetworkPanel';
import { PortalFirstAccessTutorial } from './PortalFirstAccessTutorial';
import { AdultWellbeingTrendChart, type WellbeingPeriod } from './AdultWellbeingTrendChart';
import { calculateDomainMastery } from '../utils/clinicalMath';
import { ensureFreshSession } from '../lib/supabase';
import { clearPushRenewalContext, persistPushRenewalContext } from '../services/pushSubscriptionRenewal';
import { getDefaultAnamnesisTemplate, getProfileTemplate, normalizeAnamnesisTemplate } from '../lib/anamnesisSchema';
import { VERTO_BRAND_ASSETS, isVertoInstitutionalAsset } from '../constants/vertoBranding';
import { hasOrganizationModule, type OrganizationModuleAccessMode, type OrganizationModuleKey } from '../constants/organizationModules';
import { resolvePatientPortalKind } from '../utils/patientProfileType';
import {
  resolveAppointmentPatientDisplayStatus,
} from '../utils/appointmentConfirmationState';

type PortalSection = 'home' | 'appointments' | 'anamnesis' | 'notes' | 'tasks' | 'reports' | 'documents' | 'care-network' | 'profile';

const parsePortalMetadata = (value: unknown): Record<string, any> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const firstPortalPatientName = (...values: unknown[]) => {
  const candidates = values.map((value) => String(value ?? '').trim()).filter(Boolean);
  const isGeneric = (value: string) => {
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    return ['paciente', 'patient', 'usuario', 'user', 'paciente nao identificado', 'patient not identified'].includes(normalized);
  };
  return candidates.find((value) => !isGeneric(value)) || 'Paciente não identificado';
};

const STAR_CONFETTI_COLORS = ['#7a32fc', '#facc15', '#fb7185', '#22c55e', '#38bdf8', '#f97316'];
const STAR_CONFETTI_PARTICLES = Array.from({ length: 84 }, (_, index) => ({
  id: index,
  left: (index * 37 + 7) % 100,
  drift: ((index * 53) % 180) - 90,
  delay: (index % 14) * 0.045,
  duration: 3.1 + (index % 7) * 0.18,
  rotate: 360 + (index % 5) * 180,
  size: 7 + (index % 5) * 2,
  color: STAR_CONFETTI_COLORS[index % STAR_CONFETTI_COLORS.length],
  shape: index % 4
}));

export const PatientDashboard = ({ user, onLogout, onMoodCheckin, tasks, onCompleteTask, history, energyTags, sharedNotes, protocols, onAddFamilyNote, isReadOnlyMode = false, patientPortalId = '' }: any) => {
  const FAMILY_DAILY_PHOTO_LIMIT = 5;
  const chartFiltersStorageKey = `verto.patient-dashboard-chart-filters:${String(user?.id || patientPortalId || 'unknown')}`;
  const readPersistedChartFilters = () => {
    if (typeof window === 'undefined') return {};
    try {
      return JSON.parse(window.localStorage.getItem(chartFiltersStorageKey) || '{}') || {};
    } catch {
      return {};
    }
  };
  const initialChartFilters = readPersistedChartFilters();
  const [selectedBaseDate, setSelectedBaseDate] = useState(() => String(initialChartFilters.selectedBaseDate || ""));
  const [selectedCompareDate, setSelectedCompareDate] = useState(() => String(initialChartFilters.selectedCompareDate || ""));
  const [selectedSnapshotDate, setSelectedSnapshotDate] = useState(() => String(initialChartFilters.selectedSnapshotDate || "all"));
  const [chartFiltersHydratedKey, setChartFiltersHydratedKey] = useState(chartFiltersStorageKey);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [taskEnergy, setTaskEnergy] = useState<number | null>(null);
  const [taskNote, setTaskNote] = useState("");
  const [interventionResponse, setInterventionResponse] = useState("");
  const [interventionImages, setInterventionImages] = useState<string[]>([]);
  const [isInterventionUploading, setIsInterventionUploading] = useState(false);
  const [taskStep, setTaskStep] = useState(1);
  const [showTaskSuccess, setShowTaskSuccess] = useState(false);
  const [isTaskSaving, setIsTaskSaving] = useState(false);
  const taskSubmitInFlightRef = useRef(false);
  const [selectedMood, setSelectedMood] = useState<any>(null);
  const [hoveredMood, setHoveredMood] = useState<any>(null);
  const [isMoodModalOpen, setIsMoodModalOpen] = useState(false);
  const [moodNote, setMoodNote] = useState("");
  const [showMoodSuccess, setShowMoodSuccess] = useState(false);
  const [isMessagesOpen, setIsMessagesOpen] = useState(false);
  const [selectedTag, setSelectedTag] = useState<any>(null);
  const [wellbeingCheckins, setWellbeingCheckins] = useState<any[]>([]);
  const [wellbeingPeriod, setWellbeingPeriod] = useState<WellbeingPeriod>('month');
  const [readMessageIds, setReadMessageIds] = useState<Set<string>>(() => new Set());
  const [isMoodSaving, setIsMoodSaving] = useState(false);
  const moodSubmitInFlightRef = useRef(false);
  const [moodSaveError, setMoodSaveError] = useState('');
  const [familyNote, setFamilyNote] = useState("");
  const [familyImage, setFamilyImage] = useState<string | null>(null);
  const [familyImagePath, setFamilyImagePath] = useState<string | null>(null);
  const [familyUploadError, setFamilyUploadError] = useState('');
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [showFamilySuccess, setShowFamilySuccess] = useState(false);
  const [isFamilySaving, setIsFamilySaving] = useState(false);
  const familySaveInFlightRef = useRef(false);
  const familyAnnotationInFlightRef = useRef(false);
  const [isFamilyLogOpen, setIsFamilyLogOpen] = useState(false);
  const [familyAnnotation, setFamilyAnnotation] = useState('');
  const [familyAnnotationState, setFamilyAnnotationState] = useState({ saving: false, message: '', error: '' });
  const initialAddress = String(user?.address || user?.endereco || user?.anamnesisData?.endereco || '').trim();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [displayName, setDisplayName] = useState(String(user?.name || 'Paciente'));
  const [profilePicture, setProfilePicture] = useState<string | null>(user?.profilePicture || user?.profile_picture || null);
  const [settingsForm, setSettingsForm] = useState({
    name: String(user?.name || 'Paciente'),
    address: initialAddress,
    profilePicture: user?.profilePicture || user?.profile_picture || '',
    profilePicturePath: user?.profilePicturePath || user?.profile_picture_path || ''
  });
  const [settingsMessage, setSettingsMessage] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isEnablingNotifications, setIsEnablingNotifications] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  });
  const [notificationSubscriptionReady, setNotificationSubscriptionReady] = useState(false);
  const [portalAppointments, setPortalAppointments] = useState<any[]>([]);
  const [portalAppointmentsLoaded, setPortalAppointmentsLoaded] = useState(false);
  const [portalAppointmentsRangeKey, setPortalAppointmentsRangeKey] = useState('');
  const [portalCalendarMonth, setPortalCalendarMonth] = useState(() => new Date());
  const [selectedPortalCalendarDateKey, setSelectedPortalCalendarDateKey] = useState('');
  const [portalAppointmentsState, setPortalAppointmentsState] = useState({ loading: false, error: '', message: '' });
  const [portalNotifications, setPortalNotifications] = useState<any[]>([]);
  const [portalNotificationsLoaded, setPortalNotificationsLoaded] = useState(false);
  const [portalPatientFiles, setPortalPatientFiles] = useState<any[]>([]);
  const [portalPatientFilesLoaded, setPortalPatientFilesLoaded] = useState(false);
  const [portalFileState, setPortalFileState] = useState({ uploading: false, error: '', message: '' });
  const [selectedPortalAppointment, setSelectedPortalAppointment] = useState<any | null>(null);
  const [portalAppointmentDetail, setPortalAppointmentDetail] = useState<any | null>(null);
  const [portalModal, setPortalModal] = useState<'reschedule' | 'cancel' | 'sign' | ''>('');
  const [portalActionForm, setPortalActionForm] = useState({ reason: '', note: '', requestedStart: '', accepted: false });
  const [portalRescheduleAvailability, setPortalRescheduleAvailability] = useState<any>({ loading: false, error: '', days: [], totalSlots: 0, maxSelectable: 3, message: '' });
  const [portalSelectedRescheduleSlots, setPortalSelectedRescheduleSlots] = useState<any[]>([]);
  const [portalActionSaving, setPortalActionSaving] = useState(false);
  const [portalSection, setPortalSection] = useState<PortalSection>('home');
  const portalModuleMode: OrganizationModuleAccessMode = user?.portalContext?.moduleAccessMode === 'legacy_full' ? 'legacy_full' : 'contract';
  const portalModules = useMemo(
    () => new Set<OrganizationModuleKey>(
      Array.isArray(user?.portalContext?.modules)
        ? user.portalContext.modules
            .map((value: any) => String(value || '').trim())
            .filter((value: string): value is OrganizationModuleKey =>
              ['clinical_core', 'appointments_communication', 'financial_management', 'insurance_tiss', 'school_management'].includes(value),
            )
        : []
    ),
    [user?.portalContext?.entitlementVersion, user?.portalContext?.modules],
  );
  const portalHasModule = (moduleKey: OrganizationModuleKey) =>
    hasOrganizationModule(portalModuleMode, portalModules, moduleKey);
  const clinicalPortalEnabled = portalHasModule('clinical_core');
  const appointmentsPortalEnabled = portalHasModule('appointments_communication');
  const [portalAnamnesis, setPortalAnamnesis] = useState<any>(null);
  const [portalAnamnesisChecked, setPortalAnamnesisChecked] = useState(false);
  const [portalAnamnesisDraft, setPortalAnamnesisDraft] = useState<Record<string, any>>({});
  const [portalAnamnesisState, setPortalAnamnesisState] = useState({ loading: false, saving: false, message: '', error: '' });
  const [expandedAnamnesisSections, setExpandedAnamnesisSections] = useState<Record<string, boolean>>({});
  const portalAppointmentsRequestRef = useRef(0);
  const portalAppointmentsLastLoadedAtRef = useRef(0);
  const portalRescheduleAvailabilityRequestRef = useRef(0);
  const portalRescheduleAvailabilityLastRequestedAtRef = useRef(0);
  // Unconfirmed answers must survive focus/refetch until an explicit Save ACK.
  const portalAnamnesisDraftDirtyRef = useRef(false);
  const portalAnamnesisMutationRef = useRef<{ patientId: string; requestId: string } | null>(null);
  const portalAnamnesisRequestRef = useRef(0);
  const portalAnamnesisLastLoadedAtRef = useRef(0);
  const portalNotificationsRequestRef = useRef(0);
  const portalNotificationsLastLoadedAtRef = useRef(0);
  const portalFilesRequestRef = useRef(0);

  useEffect(() => {
    if (portalSection === 'appointments' && !appointmentsPortalEnabled) setPortalSection('home');
    if (['anamnesis', 'notes', 'tasks', 'reports', 'documents'].includes(portalSection) && !clinicalPortalEnabled) {
      setPortalSection('home');
    }
  }, [portalSection, appointmentsPortalEnabled, clinicalPortalEnabled]);

  const [isUploading, setIsUploading] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showStarCelebration, setShowStarCelebration] = useState(false);
  const [celebrationKey, setCelebrationKey] = useState(0);
  const [milestoneCelebrationCount, setMilestoneCelebrationCount] = useState(0);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [latestProtocolReference, setLatestProtocolReference] = useState<any>(null);
  const milestoneCelebrationRequestRef = useRef('');
  const milestoneCelebrationSessionKeyRef = useRef('');
  const patientPortalKind = resolvePatientPortalKind(user);
  const isKidsProfile = patientPortalKind === 'KIDS';
  const isConventionalAdult = patientPortalKind === 'ADULT_CONVENTIONAL';
  const taskReflectionLabel = 'Esforço percebido';
  const taskReflectionPrompt = 'Quanto esforço essa atividade exigiu?';
  const taskReflectionHelp = '0% significa esforço mínimo e 100% esforço máximo.';
  const taskEffortProgressGradient = 'linear-gradient(90deg, #05CD99 0%, #FFB547 50%, #EE5D50 100%)';
  const readOnlyNotice = "Você não possui um tratamento ativo no momento. Entre em contato com sua clínica para retomar o acompanhamento.";
  const portalContext = user?.portalContext && typeof user.portalContext === 'object' ? user.portalContext : {};
  const portalPatientId = String(patientPortalId || portalContext?.resolvedPatientId || user?.patientId || user?.patient_id || '').trim();
  const portalAnamnesisContextKey = [portalPatientId, String(user?.id || ''), String(user?.activeWorkspaceId || user?.clinicId || portalContext?.clinicId || '')].join(':');
  const portalAnamnesisContextRef = useRef(portalAnamnesisContextKey);
  portalAnamnesisContextRef.current = portalAnamnesisContextKey;

  useEffect(() => {
    let active = true;
    if (isKidsProfile || !portalPatientId) {
      setWellbeingCheckins([]);
      return () => { active = false; };
    }
    void dataService.getPatientSelfWellbeingCheckins(wellbeingPeriod).then((result: any) => {
      if (!active) return;
      setWellbeingCheckins(result?.success && Array.isArray(result?.data) ? result.data : []);
    });
    return () => { active = false; };
  }, [isKidsProfile, portalPatientId, wellbeingPeriod]);

  useEffect(() => {
    let active = true;
    if (!portalPatientId || isKidsProfile) {
      setReadMessageIds(new Set());
      return () => { active = false; };
    }
    void dataService.getPatientSelfMessageReads().then((result: any) => {
      if (!active) return;
      const ids = result?.success && Array.isArray(result?.data)
        ? result.data.map((row: any) => String(row?.note_id || '')).filter(Boolean)
        : [];
      setReadMessageIds(new Set(ids));
    });
    return () => { active = false; };
  }, [isKidsProfile, portalPatientId, user?.id]);

  const portalAnamnesisStatusHint = String(user?.onboardingStatus || user?.onboarding_status || user?.status || '').toUpperCase();
  const hasPortalAnamnesisHint = Boolean(
    user?.anamnesisRequired ||
    user?.anamnesis_required ||
    user?.anamnesisRequestedAt ||
    user?.anamnesis_requested_at ||
    user?.anamnesisSubmittedAt ||
    user?.anamnesis_submitted_at ||
    user?.anamnesisReviewedAt ||
    user?.anamnesis_reviewed_at ||
    /ANAMNESIS|ANAMNESE|PENDING_ANAMNESIS/.test(portalAnamnesisStatusHint)
  );
  const hasPendingPortalAnamnesisHint = Boolean(
    hasPortalAnamnesisHint &&
    !user?.anamnesisSubmittedAt &&
    !user?.anamnesis_submitted_at &&
    !user?.anamnesisReviewedAt &&
    !user?.anamnesis_reviewed_at &&
    !/SUBMITTED|REVIEWED|READY_FOR_CARE/.test(portalAnamnesisStatusHint)
  );
  const hasPortalAnamnesis =
    Boolean(portalAnamnesis?.available && (portalAnamnesis?.request?.id || portalAnamnesis?.response?.id));
  const portalAnamnesisRequestStatus = String(portalAnamnesis?.request?.status || '').toUpperCase();
  const portalAnamnesisResponseStatus = String(portalAnamnesis?.response?.status || '').toUpperCase();
  const portalAnamnesisLocked =
    portalAnamnesisRequestStatus === 'SUBMITTED' ||
    portalAnamnesisRequestStatus === 'REVIEWED' ||
    portalAnamnesisResponseStatus === 'SUBMITTED' ||
    portalAnamnesisResponseStatus === 'REVIEWED';
  const portalAnamnesisStatusLabel =
    portalAnamnesisRequestStatus === 'REVIEWED' || portalAnamnesisResponseStatus === 'REVIEWED'
      ? 'Revisada'
      : portalAnamnesisRequestStatus === 'SUBMITTED' || portalAnamnesisResponseStatus === 'SUBMITTED'
        ? 'Enviada para análise'
        : portalAnamnesisResponseStatus === 'DRAFT' || portalAnamnesisRequestStatus === 'IN_PROGRESS'
          ? 'Em preenchimento'
          : 'Enviada';
  const portalAnamnesisNeedsAction = Boolean(
    hasPortalAnamnesis &&
    !portalAnamnesisLocked &&
    (
      ['SENT', 'IN_PROGRESS'].includes(portalAnamnesisRequestStatus) ||
      portalAnamnesisResponseStatus === 'DRAFT' ||
      !portalAnamnesisResponseStatus
    )
  );

  useEffect(() => {
    const persisted = readPersistedChartFilters();
    setSelectedBaseDate(String(persisted.selectedBaseDate || ""));
    setSelectedCompareDate(String(persisted.selectedCompareDate || ""));
    setSelectedSnapshotDate(String(persisted.selectedSnapshotDate || "all"));
    setChartFiltersHydratedKey(chartFiltersStorageKey);
  }, [chartFiltersStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined' || chartFiltersHydratedKey !== chartFiltersStorageKey) return;
    window.localStorage.setItem(
      chartFiltersStorageKey,
      JSON.stringify({
        selectedBaseDate,
        selectedCompareDate,
        selectedSnapshotDate
      })
    );
  }, [chartFiltersHydratedKey, chartFiltersStorageKey, selectedBaseDate, selectedCompareDate, selectedSnapshotDate]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const parseScheduledTaskDate = (value: any) => {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const direct = new Date(raw);
    if (!Number.isNaN(direct.getTime())) return direct;

    const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (brMatch) {
      const [, dd, mm, yyyy, hh = '00', min = '00', ss = '00'] = brMatch;
      const parsed = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    return null;
  };

  useEffect(() => {
    const nextName = String(user?.name || 'Paciente');
    const nextPicture = user?.profilePicture || user?.profile_picture || null;
    const nextAddress = String(user?.address || user?.endereco || user?.anamnesisData?.endereco || '').trim();
    setDisplayName(nextName);
    setProfilePicture(nextPicture);
    setSettingsForm({
      name: nextName,
      address: nextAddress,
      profilePicture: nextPicture || '',
      profilePicturePath: user?.profilePicturePath || user?.profile_picture_path || ''
    });
  }, [user?.name, user?.profilePicture, user?.profile_picture, user?.profilePicturePath, user?.profile_picture_path, user?.address, user?.endereco, user?.anamnesisData?.endereco]);

  const urlBase64ToUint8Array = (base64String: string) => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = `${base64String}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  };

  const bufferSourceToUint8Array = (value: ArrayBuffer | ArrayBufferView) => {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  };

  const applicationServerKeyMatches = (
    existingKey: ArrayBuffer | ArrayBufferView | null | undefined,
    expectedKey: Uint8Array,
  ) => {
    if (!existingKey) return true;
    const current = bufferSourceToUint8Array(existingKey);
    if (current.length !== expectedKey.length) return false;
    return current.every((value, index) => value === expectedKey[index]);
  };

  const buildPushRequestHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const session = await ensureFreshSession();
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
    } catch {
      // A sessão por cookie ainda pode autenticar o request no backend.
    }
    return headers;
  };

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setNotificationSubscriptionReady(false);
      return;
    }

    let cancelled = false;
    const checkSubscription = async () => {
      const permission = Notification.permission;
      if (!cancelled) setNotificationStatus(permission);
      // An installed subscription is NOT usable after a browser-level revoke.
      if (permission !== 'granted') {
        if (!cancelled) setNotificationSubscriptionReady(false);
        return;
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration('/sw.js');
        const subscription = await registration?.pushManager.getSubscription();
        if (!cancelled) setNotificationSubscriptionReady(Boolean(subscription));
      } catch {
        if (!cancelled) setNotificationSubscriptionReady(false);
      }
    };

    const refreshOnFocus = () => { void checkSubscription(); };
    const refreshOnVisibility = () => {
      if (document.visibilityState === 'visible') void checkSubscription();
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnVisibility);
    void checkSubscription();
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnVisibility);
    };
  }, [notificationStatus, isSettingsOpen]);

  // O viewport global do portal é controlado exclusivamente por App.tsx.

  const formatPortalDateTime = (value: any) => {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatPortalDate = (value: any) => {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const formatPortalTime = (value: any) => {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getPortalDefaultAppointmentsRange = () => {
    const now = new Date();
    return {
      from: new Date(now.getTime() - 7 * 86400000).toISOString(),
      to: new Date(now.getTime() + 90 * 86400000).toISOString(),
      limit: 60
    };
  };

  const getPortalCalendarMonthRange = (value: Date) => {
    const base = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
    const from = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
    const to = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59, 999);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      limit: 80
    };
  };

  const getPortalAppointmentsRangeKey = (range: { from: string; to: string; limit?: number }) =>
    `${range.from}|${range.to}|${range.limit || ''}`;
  const portalDefaultAppointmentsRange = useMemo(() => getPortalDefaultAppointmentsRange(), [portalPatientId]);

  const getPortalStatusLabel = (status: any) => {
    const normalized = String(status || '').toUpperCase();
    if (normalized.includes('CONFIRM')) return 'Confirmada';
    if (normalized.includes('RESCHEDULE_REQUEST')) return 'Remarcação solicitada';
    if (normalized.includes('RESCHEDULED')) return 'Remarcada';
    if (normalized.includes('CANCEL_REQUEST')) return 'Cancelamento solicitado';
    if (normalized.includes('CANCEL')) return 'Cancelada';
    if (normalized.includes('REALIZ')) return 'Realizada';
    if (normalized.includes('COMPLET')) return 'Concluída';
    if (normalized.includes('NO_SHOW')) return 'Falta';
    if (normalized.includes('PEND')) return 'Pendente';
    return 'Agendada';
  };

  const toPortalMinutes = (value: any) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
  };

  const getPortalAppointmentDurationMinutes = (appointment: any) => {
    const direct =
      toPortalMinutes(appointment?.actualDurationMinutes) ??
      toPortalMinutes(appointment?.actual_duration_minutes) ??
      toPortalMinutes(appointment?.durationMinutes) ??
      toPortalMinutes(appointment?.duration_minutes) ??
      toPortalMinutes(appointment?.scheduledDurationMinutes) ??
      toPortalMinutes(appointment?.scheduled_duration_minutes);
    if (direct) return direct;
    const start = new Date(appointment?.scheduledAt || appointment?.scheduled_at || appointment?.scheduledStart || '');
    const end = new Date(appointment?.scheduledEnd || appointment?.scheduled_end || '');
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end.getTime() > start.getTime()) {
      return Math.round((end.getTime() - start.getTime()) / 60000);
    }
    return null;
  };

  const formatPortalDuration = (minutes: any) => {
    const total = Number(minutes);
    if (!Number.isFinite(total) || total <= 0) return '0 min';
    const days = Math.floor(total / 1440);
    const hours = Math.floor((total % 1440) / 60);
    const mins = Math.round(total % 60);
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (mins || parts.length === 0) parts.push(`${mins}min`);
    return parts.join(' ');
  };

  const getPortalNotificationEventKey = (item: any) => {
    const metadata = parsePortalMetadata(item?.metadata);
    const appointmentId = String(item?.appointment_id || item?.appointmentId || '').trim();
    const patientId = String(item?.patient_id || item?.patientId || metadata.patientId || metadata.patient_id || '').trim();
    const clinicId = String(item?.clinic_id || item?.clinicId || item?.organization_id || metadata.clinicId || metadata.clinic_id || '').trim();
    const type = String(item?.type || 'appointment_reminder').replace(/_(24h|12h)$/i, '');
    const rawScheduledAt = String(
      metadata.scheduledAt ||
      metadata.scheduled_at ||
      item?.scheduled_for ||
      item?.scheduledFor ||
      ''
    ).trim();
    const parsedScheduledAt = rawScheduledAt ? new Date(rawScheduledAt) : null;
    const scheduledKey = parsedScheduledAt && !Number.isNaN(parsedScheduledAt.getTime())
      ? String(parsedScheduledAt.getTime())
      : rawScheduledAt;
    if (type === 'appointment_reschedule_approved' && patientId && scheduledKey) {
      return [clinicId, patientId, type, scheduledKey].join(':');
    }
    return appointmentId
      ? [clinicId, patientId, appointmentId, type].join(':')
      : String(item?.id || '').trim();
  };

  const dedupePortalNotifications = (items: any[]) => {
    const byAppointment = new Map<string, any>();
    for (const item of Array.isArray(items) ? items : []) {
      const key = getPortalNotificationEventKey(item);
      if (!key || byAppointment.has(key)) continue;
      byAppointment.set(key, item);
    }
    return Array.from(byAppointment.values());
  };

  const loadPortalAppointments = async (range = portalDefaultAppointmentsRange) => {
    if (!portalPatientId) {
      console.warn('[PatientPortal] skipped appointment fetch: missing resolvedPatientId');
      setPortalAppointments([]);
      setPortalAppointmentsLoaded(true);
      setPortalAppointmentsRangeKey(getPortalAppointmentsRangeKey(range));
      setPortalAppointmentsState({ loading: false, error: 'Não encontramos um paciente vinculado a este acesso. Entre em contato com a clínica.', message: '' });
      return;
    }
    const requestId = ++portalAppointmentsRequestRef.current;
    const rangeKey = getPortalAppointmentsRangeKey(range);
    setPortalAppointmentsState((prev) => ({ ...prev, loading: true, error: '' }));
    const result = await dataService.getPortalAppointments({ from: range.from, to: range.to, limit: range.limit });
    if (requestId !== portalAppointmentsRequestRef.current) return;
    portalAppointmentsLastLoadedAtRef.current = Date.now();
    if (result?.success) {
      const nextAppointments = Array.isArray(result.data) ? result.data : [];
      setPortalAppointments(nextAppointments);
      setSelectedPortalAppointment((current: any) => {
        if (!current?.id) return current;
        const refreshed = nextAppointments.find((appointment: any) => String(appointment?.id) === String(current.id));
        return refreshed ? { ...current, ...refreshed } : current;
      });
      setPortalAppointmentsLoaded(true);
      setPortalAppointmentsRangeKey(rangeKey);
      setPortalAppointmentsState({ loading: false, error: '', message: '' });
      return;
    }
    setPortalAppointmentsLoaded(true);
    setPortalAppointmentsRangeKey(rangeKey);
    setPortalAppointmentsState({ loading: false, error: result?.error || 'Não foi possível carregar suas sessões agora.', message: '' });
  };

  useEffect(() => {
    portalAppointmentsRequestRef.current += 1;
    setPortalAppointments([]);
    setPortalAppointmentsLoaded(false);
    setPortalAppointmentsRangeKey('');
    setPortalAppointmentsState({ loading: false, error: '', message: '' });
  }, [user?.id, user?.email, portalPatientId, appointmentsPortalEnabled]);

  useEffect(() => {
    const shouldLoadPortalAppointments =
      portalSection === 'appointments' ||
      portalSection === 'reports';
    if (!shouldLoadPortalAppointments) return;
    const range = portalSection === 'appointments'
      ? getPortalCalendarMonthRange(portalCalendarMonth)
      : portalDefaultAppointmentsRange;
    const rangeKey = getPortalAppointmentsRangeKey(range);
    if ((portalAppointmentsLoaded && portalAppointmentsRangeKey === rangeKey) || portalAppointmentsState.loading) return;
    void loadPortalAppointments(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalSection, portalCalendarMonth, portalAppointmentsLoaded, portalAppointmentsRangeKey, portalAppointmentsState.loading, user?.id, user?.email, portalPatientId, portalDefaultAppointmentsRange]);

  useEffect(() => {
    const refreshAppointments = (force = false) => {
      if (document.visibilityState !== 'visible') return;
      if (portalSection !== 'appointments' && portalSection !== 'reports') return;
      if (portalAppointmentsState.loading && !force) return;
      if (!force && Date.now() - portalAppointmentsLastLoadedAtRef.current < 30_000) return;
      const range = portalSection === 'appointments'
        ? getPortalCalendarMonthRange(portalCalendarMonth)
        : portalDefaultAppointmentsRange;
      void loadPortalAppointments(range);
    };
    const refreshAppointmentsWhenVisible = () => refreshAppointments(false);
    const refreshAppointmentsAfterDomainEvent = () => refreshAppointments(true);
    window.addEventListener('focus', refreshAppointmentsWhenVisible);
    document.addEventListener('visibilitychange', refreshAppointmentsWhenVisible);
    window.addEventListener('verto:appointment-domain-event', refreshAppointmentsAfterDomainEvent as EventListener);
    return () => {
      window.removeEventListener('focus', refreshAppointmentsWhenVisible);
      document.removeEventListener('visibilitychange', refreshAppointmentsWhenVisible);
      window.removeEventListener('verto:appointment-domain-event', refreshAppointmentsAfterDomainEvent as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalSection, portalCalendarMonth, portalAppointmentsState.loading, user?.id, user?.email, portalPatientId, portalDefaultAppointmentsRange]);

  const loadPortalNotifications = async () => {
    const requestId = ++portalNotificationsRequestRef.current;
    const result = await dataService.getPortalNotifications(12);
    if (requestId !== portalNotificationsRequestRef.current) return;
    portalNotificationsLastLoadedAtRef.current = Date.now();
    if (result?.success) {
      setPortalNotifications(dedupePortalNotifications(Array.isArray(result.data) ? result.data : []));
    }
    setPortalNotificationsLoaded(true);
  };

  useEffect(() => {
    portalNotificationsRequestRef.current += 1;
    setPortalNotifications([]);
    setPortalNotificationsLoaded(false);
    if (!appointmentsPortalEnabled) {
      setPortalNotificationsLoaded(true);
      return;
    }
    void loadPortalNotifications();
    const refreshNotifications = (force = false) => {
      if (document.visibilityState !== 'visible') return;
      if (!force && Date.now() - portalNotificationsLastLoadedAtRef.current < 30_000) return;
      void loadPortalNotifications();
    };
    const refreshWhenVisible = () => refreshNotifications(false);
    const refreshFromPush = (event: MessageEvent) => {
      if (event?.data?.type !== 'VERTO_PORTAL_NOTIFICATION') return;
      refreshNotifications(true);
    };
    const interval = window.setInterval(() => refreshNotifications(false), 15 * 60_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    navigator.serviceWorker?.addEventListener?.('message', refreshFromPush as EventListener);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      navigator.serviceWorker?.removeEventListener?.('message', refreshFromPush as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.email, portalPatientId, appointmentsPortalEnabled]);

  const markPortalNotificationRead = async (notification: any, acknowledged = false) => {
    if (!notification?.id || (!acknowledged && notification?.read_at)) return;
    const eventKey = getPortalNotificationEventKey(notification);
    setPortalNotifications((current) => acknowledged
      ? current.filter((item) => getPortalNotificationEventKey(item) !== eventKey)
      : current.map((item) => String(item?.id) === String(notification.id)
          ? { ...item, read_at: new Date().toISOString() }
          : item)
    );
    const result = await dataService.markPortalNotification(String(notification.id), acknowledged);
    if (!result?.success) void loadPortalNotifications();
  };

  const loadPortalAnamnesis = async () => {
    if (!portalPatientId) return;
    const requestId = ++portalAnamnesisRequestRef.current;
    setPortalAnamnesisState((prev) => ({ ...prev, loading: true, error: '' }));
    const result = await dataService.getPortalPatientAnamnesis(portalPatientId);
    if (requestId !== portalAnamnesisRequestRef.current) return;
    portalAnamnesisLastLoadedAtRef.current = Date.now();
    if (result?.success) {
      const data = result.data || {};
      setPortalAnamnesis(data);
      const prefillAnswers = data?.prefillAnswers && typeof data.prefillAnswers === 'object'
        ? data.prefillAnswers
        : {};
      const answers = data?.response?.answers && typeof data.response.answers === 'object'
        ? data.response.answers
        : {};
      // A late GET must never overwrite unsaved child/adult anamnesis answers.
      if (!portalAnamnesisDraftDirtyRef.current) {
        setPortalAnamnesisDraft({ ...prefillAnswers, ...answers });
      }
      const template = normalizeAnamnesisTemplate(data?.template || getDefaultAnamnesisTemplate());
      const profileTemplate = getProfileTemplate(template, data?.profileType === 'child' ? 'child' : isKidsProfile ? 'child' : 'adult');
      setExpandedAnamnesisSections(
        Object.fromEntries(profileTemplate.sections.filter((section: any) => section.active !== false).slice(0, 2).map((section: any) => [section.id, true]))
      );
      setPortalAnamnesisChecked(true);
      setPortalAnamnesisState({ loading: false, saving: false, message: '', error: '' });
      return;
    }
    setPortalAnamnesisChecked(true);
    setPortalAnamnesisState({ loading: false, saving: false, message: '', error: result?.error || 'Não foi possível carregar a ficha agora.' });
  };

  useEffect(() => {
    portalAnamnesisRequestRef.current += 1;
    portalAnamnesisDraftDirtyRef.current = false;
    portalAnamnesisMutationRef.current = null;
    setPortalAnamnesis(null);
    setPortalAnamnesisDraft({});
    setPortalAnamnesisChecked(false);
    setPortalAnamnesisState({ loading: false, saving: false, message: '', error: '' });
  }, [portalPatientId, user?.email, user?.id, user?.activeWorkspaceId, user?.clinicId, user?.portalContext?.clinicId]);

  useEffect(() => {
    const refreshAnamnesisWhenVisible = () => {
      if (document.visibilityState !== 'visible' || !portalPatientId || portalAnamnesisDraftDirtyRef.current || portalAnamnesisMutationRef.current) return;
      if (Date.now() - portalAnamnesisLastLoadedAtRef.current < 15_000) return;
      void loadPortalAnamnesis();
    };
    window.addEventListener('focus', refreshAnamnesisWhenVisible);
    document.addEventListener('visibilitychange', refreshAnamnesisWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshAnamnesisWhenVisible);
      document.removeEventListener('visibilitychange', refreshAnamnesisWhenVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalPatientId]);

  useEffect(() => {
    if (!portalPatientId || portalAnamnesisChecked || portalAnamnesisState.loading) return;
    const shouldLoadHomeNotice = portalSection === 'home' && (isKidsProfile || hasPendingPortalAnamnesisHint);
    if (portalSection !== 'anamnesis' && !isMenuOpen && !shouldLoadHomeNotice) return;
    void loadPortalAnamnesis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalSection, isMenuOpen, portalPatientId, portalAnamnesisChecked, portalAnamnesisState.loading, hasPendingPortalAnamnesisHint, isKidsProfile]);

  const openPortalAppointmentDetail = async (appointment: any) => {
    setSelectedPortalAppointment(appointment);
    setPortalAppointmentDetail(null);
    setPortalAppointmentsState((prev) => ({ ...prev, error: '', message: '' }));
    const result = await dataService.getPortalAppointmentDetail(String(appointment?.id || ''));
    if (result?.success) {
      setPortalAppointmentDetail(result.data || null);
      return;
    }
    setPortalAppointmentsState((prev) => ({ ...prev, error: result?.error || 'Não foi possível carregar a sessão agora.' }));
  };

  const openPortalNotification = async (notification: any) => {
    const appointmentId = String(notification?.appointment_id || notification?.appointmentId || '').trim();
    const notificationType = String(notification?.type || '').replace(/_(24h|12h)$/i, '');
    void markPortalNotificationRead(notification, notificationType !== 'appointment_reminder');
    if (!appointmentId) return;
    const metadata = parsePortalMetadata(notification?.metadata);
    const professionalName = firstPortalText(
      metadata.professionalName,
      metadata.therapistName,
      metadata.professional,
      notification?.professionalName,
      notification?.professional_name,
      notification?.therapistName,
      notification?.therapist_name
    );
    await openPortalAppointmentDetail({
      id: appointmentId,
      // The backend verifies this persisted notification against a SENT job;
      // reminderKind from browser metadata is never an authorization source.
      reminderNotificationId: String(notification?.id || ''),
      patientName: firstPortalPatientName(
        notification?.patientName,
        notification?.patient_name,
        metadata.patientName,
        metadata.patient_name,
        portalContext?.portalDisplayName,
        portalContext?.patientName,
        displayName,
        user?.name
      ),
      clinicName: firstPortalClinicText(
        getPortalClinicNameExclusions(professionalName),
        metadata.clinicName,
        metadata.clinicLegalName,
        notification?.clinicName,
        notification?.clinic_name,
        portalContext?.clinicName,
        portalContext?.clinicLegalName,
        user?.clinicSettings?.clinicName,
        user?.workspaceName,
        user?.clinicName,
        'Clínica'
      ),
      clinicLogoUrl: firstPortalLogoUrl(
        metadata.clinicLogoUrl,
        notification?.clinicLogoUrl,
        notification?.clinic_logo_url,
        portalContext?.clinicLogoUrl,
        user?.clinicSettings?.clinicLogoUrl
      ),
      scheduledAt: metadata.scheduledAt || notification?.scheduled_for || notification?.scheduledFor || notification?.created_at
    });
  };

  const updatePortalAppointmentInList = (appointment: any) => {
    if (!appointment?.id) return;
    setPortalAppointments((prev) => prev.map((item) => String(item.id) === String(appointment.id) ? { ...item, ...appointment } : item));
    setSelectedPortalAppointment((prev: any) => prev && String(prev.id) === String(appointment.id) ? { ...prev, ...appointment } : prev);
    setPortalAppointmentDetail((prev: any) => prev ? { ...prev, appointment: { ...(prev.appointment || {}), ...appointment } } : prev);
  };

  const confirmPortalAppointment = async (appointment: any) => {
    setPortalActionSaving(true);
    const result = await dataService.confirmPortalAppointment(String(appointment?.id || ''));
    setPortalActionSaving(false);
    if (!result?.success) {
      setPortalAppointmentsState((prev) => ({ ...prev, error: result?.error || 'Não foi possível confirmar a sessão agora.' }));
      return;
    }
    const confirmedAppointment = result?.item || result?.appointment;
    if (confirmedAppointment) updatePortalAppointmentInList(confirmedAppointment);
    setPortalAppointmentsState((prev) => ({ ...prev, error: '', message: result?.message || 'Sessão confirmada com sucesso.' }));
  };

  const loadPortalRescheduleSlots = async (appointmentId: string, dateFrom?: string) => {
    if (!appointmentId) {
      setPortalRescheduleAvailability({ loading: false, error: 'Sessão não encontrada.', days: [], totalSlots: 0, maxSelectable: 3, message: '' });
      return;
    }
    const requestId = ++portalRescheduleAvailabilityRequestRef.current;
    portalRescheduleAvailabilityLastRequestedAtRef.current = Date.now();
    setPortalRescheduleAvailability((prev: any) => ({ ...prev, loading: true, error: '', days: [], totalSlots: 0, maxSelectable: 3, message: '' }));
    const result = await dataService.getPortalAppointmentRescheduleSlots(appointmentId, { maxDays: 5, dateFrom });
    if (requestId !== portalRescheduleAvailabilityRequestRef.current) return;
    if (!result?.success) {
      setPortalRescheduleAvailability({ loading: false, error: result?.error || 'Não foi possível carregar horários disponíveis.', days: [], totalSlots: 0, maxSelectable: 3, message: '' });
      return;
    }
    const data = result.data || {};
    const days = Array.isArray(data.days) ? data.days : [];
    const availableSlotIds = new Set(
      days.flatMap((day: any) => (Array.isArray(day?.slots) ? day.slots : []))
        .map((slot: any) => String(slot?.id || slot?.scheduledStart || '').trim())
        .filter(Boolean)
    );
    setPortalSelectedRescheduleSlots((prev) => prev.filter((slot) =>
      availableSlotIds.has(String(slot?.id || slot?.scheduledStart || '').trim())
    ));
    setPortalRescheduleAvailability({
      loading: false,
      error: '',
      days,
      totalSlots: Number(data.totalSlots || 0),
      maxSelectable: Number(data.maxSelectable || 3) || 3,
      message: data.message || '',
      rangeLabel: data.rangeLabel || '',
      weekStart: data.weekStart || '',
      weekEnd: data.weekEnd || '',
      nextDateFrom: data.nextDateFrom || ''
    });
  };

  const openPortalRescheduleModal = () => {
    const appointment = portalAppointmentDetail?.appointment || selectedPortalAppointment;
    if (appointment?.allowedActions?.canRequestReschedule === false || appointment?.allowPatientReschedule === false) {
      setPortalAppointmentsState((prev) => ({
        ...prev,
        error: '',
        message: 'Esta clínica não aceita novas solicitações de reagendamento. Você ainda pode confirmar ou cancelar.'
      }));
      return;
    }
    const appointmentId = String((portalAppointmentDetail?.appointment || selectedPortalAppointment)?.id || '').trim();
    setPortalSelectedRescheduleSlots([]);
    setPortalActionForm((prev) => ({ ...prev, requestedStart: '' }));
    setPortalModal('reschedule');
    void loadPortalRescheduleSlots(appointmentId);
  };

  const closePortalActionModal = () => {
    portalRescheduleAvailabilityRequestRef.current += 1;
    setPortalModal('');
    setPortalSelectedRescheduleSlots([]);
    setPortalRescheduleAvailability((prev: any) => ({ ...prev, loading: false, error: '' }));
  };

  useEffect(() => {
    if (portalModal !== 'reschedule') return;
    const refreshAvailableSlots = (force = false) => {
      if (document.visibilityState !== 'visible' || portalActionSaving) return;
      if (portalRescheduleAvailability.loading && !force) return;
      if (!force && Date.now() - portalRescheduleAvailabilityLastRequestedAtRef.current < 1_500) return;
      const appointmentId = String((portalAppointmentDetail?.appointment || selectedPortalAppointment)?.id || '').trim();
      if (!appointmentId) return;
      void loadPortalRescheduleSlots(appointmentId, portalRescheduleAvailability.weekStart || undefined);
    };
    const refreshAvailableSlotsWhenVisible = () => refreshAvailableSlots(false);
    const refreshAvailableSlotsAfterDomainEvent = () => refreshAvailableSlots(true);
    window.addEventListener('focus', refreshAvailableSlotsWhenVisible);
    document.addEventListener('visibilitychange', refreshAvailableSlotsWhenVisible);
    window.addEventListener('verto:appointment-domain-event', refreshAvailableSlotsAfterDomainEvent as EventListener);
    return () => {
      window.removeEventListener('focus', refreshAvailableSlotsWhenVisible);
      document.removeEventListener('visibilitychange', refreshAvailableSlotsWhenVisible);
      window.removeEventListener('verto:appointment-domain-event', refreshAvailableSlotsAfterDomainEvent as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalModal, portalActionSaving, portalRescheduleAvailability.loading, portalRescheduleAvailability.weekStart, portalAppointmentDetail?.appointment?.id, selectedPortalAppointment?.id]);

  const togglePortalRescheduleSlot = (slot: any) => {
    const slotId = String(slot?.id || slot?.scheduledStart || '').trim();
    if (!slotId) return;
    setPortalSelectedRescheduleSlots((prev) => {
      if (prev.some((item) => String(item?.id || item?.scheduledStart || '') === slotId)) {
        return prev.filter((item) => String(item?.id || item?.scheduledStart || '') !== slotId);
      }
      const maxSelectable = Math.max(1, Math.min(3, Number(portalRescheduleAvailability.maxSelectable || 3) || 3));
      if (prev.length >= maxSelectable) return prev;
      return [...prev, slot];
    });
  };

  const submitPortalAction = async () => {
    const appointmentId = String((portalAppointmentDetail?.appointment || selectedPortalAppointment)?.id || '').trim();
    if (!appointmentId || !portalModal) return;
    const appointment = portalAppointmentDetail?.appointment || selectedPortalAppointment;
    if (portalModal === 'reschedule' && (appointment?.allowedActions?.canRequestReschedule === false || appointment?.allowPatientReschedule === false)) {
      closePortalActionModal();
      setPortalAppointmentsState((prev) => ({
        ...prev,
        error: '',
        message: 'Esta clínica não aceita novas solicitações de reagendamento. Você ainda pode confirmar ou cancelar.'
      }));
      return;
    }
    if (portalModal === 'reschedule' && portalSelectedRescheduleSlots.length === 0) {
      setPortalAppointmentsState((prev) => ({ ...prev, error: 'Escolha pelo menos um horário disponível.' }));
      return;
    }
    setPortalActionSaving(true);
    const selectedRescheduleOptions = portalSelectedRescheduleSlots.map((slot) => ({
      scheduledStart: slot.scheduledStart,
      scheduledEnd: slot.scheduledEnd,
      date: slot.date,
      dateLabel: slot.dateLabel,
      start: slot.start,
      end: slot.end,
      label: slot.label
    }));
    const primaryRescheduleOption = selectedRescheduleOptions[0] || null;
    const payload = {
      reason: portalActionForm.reason,
      note: portalActionForm.note,
      ...(portalModal === 'cancel' && selectedPortalAppointment?.reminderNotificationId
        ? { notificationId: String(selectedPortalAppointment.reminderNotificationId) }
        : {}),
      rescheduleOptions: selectedRescheduleOptions,
      requestedStart: primaryRescheduleOption?.scheduledStart,
      requestedEnd: primaryRescheduleOption?.scheduledEnd,
      accepted: portalActionForm.accepted,
      signedByName: displayName
    };
    const result =
      portalModal === 'reschedule'
        ? await dataService.requestPortalAppointmentReschedule(appointmentId, payload)
        : portalModal === 'cancel'
          ? await dataService.requestPortalAppointmentCancel(appointmentId, payload)
          : await dataService.signPortalSession(String(portalAppointmentDetail?.session?.id || ''), payload);
    setPortalActionSaving(false);
    if (!result?.success) {
      setPortalAppointmentsState((prev) => ({ ...prev, error: result?.error || 'Não foi possível concluir a ação agora.' }));
      return;
    }
    const resultAppointment = result?.item || result?.appointment;
    if (resultAppointment) {
      updatePortalAppointmentInList(resultAppointment);
      // A confirmed automatic cancellation must immediately replace the old
      // open detail; otherwise the modal could still offer cancel/confirm.
      if (portalModal === 'cancel' && result?.action === 'cancelled_by_family_from_24h_reminder') {
        setSelectedPortalAppointment((current: any) => current?.id === resultAppointment.id
          ? { ...current, ...resultAppointment } : current);
        setPortalAppointmentDetail((current: any) => current?.appointment?.id === resultAppointment.id
          ? { ...current, appointment: { ...current.appointment, ...resultAppointment } } : current);
      }
    }
    setPortalModal('');
    setPortalSelectedRescheduleSlots([]);
    setPortalActionForm({ reason: '', note: '', requestedStart: '', accepted: false });
    setPortalAppointmentsState((prev) => ({
      ...prev,
      error: '',
      message: portalModal === 'sign' ? 'Assinatura registrada.' : result.message || 'Solicitação registrada.'
    }));
    if (portalModal === 'sign') {
      await openPortalAppointmentDetail(portalAppointmentDetail?.appointment || selectedPortalAppointment);
    }
  };

  const enablePatientNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setNotificationStatus('unsupported');
      setSettingsMessage('Este dispositivo ou navegador não suporta notificações push.');
      return false;
    }

    if (Notification.permission === 'denied') {
      setNotificationStatus('denied');
      setNotificationSubscriptionReady(false);
      setSettingsMessage('O navegador bloqueou as notificações. Clique no ícone de cadeado ao lado do endereço, abra as permissões do site, permita Notificações e volte à Verto.');
      return false;
    }
    setIsEnablingNotifications(true);
    setSettingsMessage('');
    try {
      const keyResponse = await fetch('/api/push/vapid-public-key', { credentials: 'include' });
      const keyPayload = await keyResponse.json().catch(() => ({}));
      if (!keyResponse.ok || !keyPayload?.publicKey) {
        setNotificationSubscriptionReady(false);
        setSettingsMessage('As notificações ainda não estão configuradas no servidor.');
        return false;
      }
      const applicationServerKey = urlBase64ToUint8Array(String(keyPayload.publicKey));

      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      setNotificationStatus(permission);
      if (permission !== 'granted') {
        setNotificationSubscriptionReady(false);
        setSettingsMessage(permission === 'denied'
          ? 'Notificações bloqueadas no navegador. Nas configurações do site (ícone de cadeado), permita Notificações e volte para ativá-las.'
          : 'Permissão não concedida. As notificações não foram ativadas neste dispositivo.');
        return false;
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      await registration.update().catch(() => undefined);
      await navigator.serviceWorker.ready;
      let existingSubscription = await registration.pushManager.getSubscription();
      if (
        existingSubscription &&
        !applicationServerKeyMatches((existingSubscription as any)?.options?.applicationServerKey, applicationServerKey)
      ) {
        await existingSubscription.unsubscribe();
        existingSubscription = null;
      }
      const subscription =
        existingSubscription ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        }));

      const patientIdForPush = String(portalPatientId || '').trim();
      const safePatientIdForPush =
        patientIdForPush && patientIdForPush !== String(user?.id || '').trim()
          ? patientIdForPush
          : '';
      const patientEmailForPush = String(user?.email || '').trim().toLowerCase();
      console.log('[push] ativando subscription pelo painel do paciente.', {
        patientId: safePatientIdForPush || null,
        patientEmail: patientEmailForPush || null,
        endpointPrefix: String(subscription.endpoint || '').slice(0, 80)
      });
      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: await buildPushRequestHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          patientId: safePatientIdForPush || undefined,
          patient_id: safePatientIdForPush || undefined,
          patientEmail: patientEmailForPush || undefined,
          patient_email: patientEmailForPush || undefined,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success === false) {
        console.warn('[push] falha ao salvar subscription pelo painel do paciente.', {
          status: response.status,
          result
        });
        setNotificationSubscriptionReady(false);
        setSettingsMessage(result?.error || result?.warning || 'Não foi possível ativar as notificações agora.');
        return false;
      }

      await persistPushRenewalContext(registration, result?.renewalToken, keyPayload.publicKey);
      console.log('[push] subscription do painel persistida.', {
        patientId: result?.patientId || safePatientIdForPush || null
      });
      setNotificationSubscriptionReady(true);
      setSettingsMessage('Notificações ativadas neste dispositivo.');
      return true;
    } catch (error: any) {
      console.warn('Patient notification permission failed:', error);
      setNotificationSubscriptionReady(false);
      setSettingsMessage(error?.message || 'Não foi possível ativar as notificações.');
      return false;
    } finally {
      setIsEnablingNotifications(false);
    }
  };

  const disablePatientNotifications = async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      setSettingsMessage('Não foi possível localizar as notificações neste dispositivo.');
      return false;
    }
    setIsEnablingNotifications(true);
    setSettingsMessage('');
    try {
      const registration = await navigator.serviceWorker.getRegistration('/sw.js');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: await buildPushRequestHeaders(),
          credentials: 'include',
          body: JSON.stringify({ subscription: { endpoint: subscription.endpoint } }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success !== true) {
          setSettingsMessage(result?.error || 'Não foi possível desativar as notificações no servidor.');
          return false;
        }
      }
      await clearPushRenewalContext();
      if (subscription && !(await subscription.unsubscribe())) {
        setSettingsMessage('Servidor desativado. Verifique a inscrição local do navegador e tente novamente.');
        return false;
      }
      setNotificationSubscriptionReady(false);
      setSettingsMessage('Notificações desativadas neste dispositivo.');
      return true;
    } catch {
      setSettingsMessage('Não foi possível desativar as notificações. Tente novamente.');
      return false;
    } finally {
      setIsEnablingNotifications(false);
    }
  };

  const handleProfilePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setSettingsMessage('Envie uma imagem válida para a foto do perfil.');
      event.target.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setSettingsMessage('Escolha uma imagem de até 2MB para manter o painel leve.');
      event.target.value = '';
      return;
    }

    setIsSavingSettings(true);
    setSettingsMessage('Enviando foto...');
    try {
      const extension = file.type.includes('jpeg') || file.type.includes('jpg') ? 'jpg' : file.type.includes('webp') ? 'webp' : 'png';
      const fileName = `${portalPatientId || user.id}/profile-${Date.now()}.${extension}`;
      const upload = await dataService.uploadFile('patient-photos', fileName, file);
      if (!upload?.success || !upload.url) {
        setSettingsMessage(upload?.error || 'Não foi possível enviar a foto.');
        return;
      }
      const nextForm = {
        ...settingsForm,
        profilePicture: upload.url,
        profilePicturePath: upload.path
      } as any;
      setSettingsForm(nextForm);
      setProfilePicture(upload.url);
      const persistResult = await dataService.updatePatientSelfProfile({
        patientId: portalPatientId || undefined,
        address: String(nextForm.address || '').trim(),
        profilePicture: upload.url,
        profilePicturePath: upload.path
      });
      if (persistResult?.success) {
        const persistedPicture = persistResult?.data?.profilePicture || upload.url;
        const persistedPath = persistResult?.data?.profilePicturePath || upload.path;
        setProfilePicture(persistedPicture);
        setSettingsForm((prev: any) => ({
          ...prev,
          profilePicture: persistedPicture,
          profilePicturePath: persistedPath
        }));
        if (persistResult?.data?.name) setDisplayName(String(persistResult.data.name));
        setSettingsMessage('Foto salva com segurança.');
      } else if (persistResult?.queued) {
        setSettingsMessage('Foto salva localmente. A sincronização será retomada automaticamente.');
      } else {
        setSettingsMessage(persistResult?.error || 'Foto enviada. Clique em salvar para confirmar os dados.');
      }
    } finally {
      setIsSavingSettings(false);
      event.target.value = '';
    }
  };

  const handleSavePatientSettings = async () => {
    const nextName = settingsForm.name.trim();
    if (!nextName) {
      setSettingsMessage('Informe seu nome para salvar.');
      return;
    }

    setIsSavingSettings(true);
    setSettingsMessage('');
    try {
      const result = await dataService.updatePatientSelfProfile({
        patientId: portalPatientId || undefined,
        name: nextName,
        portalDisplayName: nextName,
        address: settingsForm.address.trim(),
        profilePicture: settingsForm.profilePicture || null,
        profilePicturePath: (settingsForm as any).profilePicturePath || null
      });

      if (!result?.success && !result?.queued) {
        setSettingsMessage(result?.error || 'Não foi possível salvar suas configurações.');
        return;
      }

      const persistedName = String(result?.data?.name || nextName);
      const persistedPicture = result?.data?.profilePicture || settingsForm.profilePicture || null;
      const persistedPath = result?.data?.profilePicturePath || (settingsForm as any).profilePicturePath || null;
      setDisplayName(persistedName);
      setProfilePicture(persistedPicture);
      setSettingsForm((prev: any) => ({
        ...prev,
        name: persistedName,
        profilePicture: persistedPicture || '',
        profilePicturePath: persistedPath || ''
      }));
      setSettingsMessage(result?.queued ? 'Configurações salvas localmente. A sincronização será retomada automaticamente.' : 'Configurações salvas com sucesso.');
      setTimeout(() => setIsSettingsOpen(false), 700);
    } catch (error: any) {
      setSettingsMessage(error?.message || 'Não foi possível salvar suas configurações.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const visiblePatientTasks = useMemo(() => {
    const list = Array.isArray(tasks) ? tasks : [];
    if (isKidsProfile) return list;
    return list.filter((task: any) => {
      if (task?.completed || String(task?.status || '').toLowerCase() === 'completed') return false;
      const scheduledRaw = task?.scheduledAt || task?.scheduled_at;
      if (!scheduledRaw) return false;
      const scheduledAt = parseScheduledTaskDate(scheduledRaw);
      if (!scheduledAt) return false;
      return scheduledAt <= currentTime;
    });
  }, [tasks, isKidsProfile, currentTime]);

  const conventionalMoodTags = ADULT_CONVENTIONAL_TAGS;
  const moodInfluenceTags = isConventionalAdult ? conventionalMoodTags : (energyTags || []);

  const moodOptions = [ { value: 10, emoji: "😫", label: "Esgotado", color: "bg-red-100 border-red-200 hover:bg-red-200" }, { value: 30, emoji: "😕", label: "Baixo", color: "bg-orange-100 border-orange-200 hover:bg-orange-200" }, { value: 50, emoji: "😐", label: "Normal", color: "bg-yellow-100 border-yellow-200 hover:bg-yellow-200" }, { value: 70, emoji: "🙂", label: "Bem", color: "bg-blue-100 border-blue-200 hover:bg-blue-200" }, { value: 90, emoji: "🤩", label: "Ótimo!", color: "bg-green-100 border-green-200 hover:bg-green-200" } ];
  const getTaskEnergyEmoji = (val: number) => {
    if (val < 20) return "😫";
    if (val < 40) return "😕";
    if (val < 60) return "😐";
    if (val < 80) return "🙂";
    return "🤩";
  };
  const getTaskEffortEmoji = (val: number) => {
    if (val < 20) return "🙂";
    if (val < 40) return "😌";
    if (val < 60) return "😐";
    if (val < 80) return "😕";
    return "😫";
  };
  const getTaskReflectionEmoji = (val: number) => getTaskEffortEmoji(val);

  const toLocalDateKey = (value: any) => {
    if (!value) return '';
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return '';
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, '0');
      const d = String(value.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    const raw = String(value || '').trim();
    if (!raw) return '';

    const isoDateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateOnly) return `${isoDateOnly[1]}-${isoDateOnly[2]}-${isoDateOnly[3]}`;

    const brDate = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (brDate) return `${brDate[3]}-${brDate[2]}-${brDate[1]}`;

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    return toLocalDateKey(parsed);
  };

  const getHistoryDateKey = (item: any) => {
    const rawGroup = String(item?.dateGroup || item?.date_group || '').trim();
    if (/^hoje$/i.test(rawGroup)) return toLocalDateKey(new Date());
    if (rawGroup && !/^ontem$/i.test(rawGroup)) {
      const fromGroup = toLocalDateKey(rawGroup);
      if (fromGroup) return fromGroup;
    }
    return toLocalDateKey(item?.created_at || item?.completed_at || item?.date || item?.scheduled_at);
  };

  const getSnapshotKey = (item: any) => getHistoryDateKey(item);

  const formatHistoryDateLabel = (value: string) => {
    const key = toLocalDateKey(value);
    if (!key) return String(value || '').trim();
    if (key === toLocalDateKey(new Date())) return 'Hoje';
    const [year, month, day] = key.split('-');
    return `${day}/${month}/${year}`;
  };

  const getHistoryItemSortTime = (item: any) => {
    const raw = item?.created_at || item?.completed_at || item?.date || item?.scheduled_at || '';
    const parsed = new Date(raw).getTime();
    if (Number.isFinite(parsed)) return parsed;
    const time = String(item?.time || '').trim();
    const match = time.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return 0;
    const dateKey = getHistoryDateKey(item);
    const base = dateKey ? new Date(`${dateKey}T00:00:00`).getTime() : 0;
    return base + Number(match[1]) * 60 * 60 * 1000 + Number(match[2]) * 60 * 1000;
  };

  const formatFilterDate = (value: string) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(raw)) return raw.replace(/-/g, '/');
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [year, month, day] = raw.split('-');
      return `${day}/${month}/${year}`;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    const key = toLocalDateKey(parsed);
    return formatHistoryDateLabel(key);
  };

  const parseScore = (value: any): number | null => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const normalized = String(value).replace(',', '.').trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const getEventScore = (item: any): number | null => {
    const direct = parseScore(item?.score);
    if (direct !== null) return direct;
    const professional = parseScore(item?.pro_score);
    if (professional !== null) return professional;
    const nestedTask = parseScore(item?.task_data?.pro_score ?? item?.task_data?.score);
    if (nestedTask !== null) return nestedTask;
    return null;
  };

  const normalizeClinicalKey = (value: any) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const isSameClinicalSkill = (a: string, b: string) => {
    const left = normalizeClinicalKey(a);
    const right = normalizeClinicalKey(b);
    if (!left || !right) return false;
    return left === right || left.includes(right) || right.includes(left);
  };

  const scoredClinicalEvents = useMemo(() => {
    const fromHistory = (Array.isArray(history) ? history : [])
      .filter((h: any) => {
        const type = String(h?.type || '').toLowerCase();
        if (type === 'family_note' || type === 'photo') return false;
        return getEventScore(h) !== null;
      })
      .map((h: any) => ({
        ...h,
        score: getEventScore(h),
        _source: 'history'
      }));

    const fromTasks = (Array.isArray(tasks) ? tasks : [])
      .filter((t: any) => getEventScore(t) !== null)
      .map((t: any) => ({
        id: t?.id || `task-${t?.task_id || Math.random()}`,
        patientId: portalPatientId || user?.id,
        patient_id: portalPatientId || user?.id,
        type: 'task_scored',
        title: t?.title || t?.task_data?.title || '',
        domain: t?.domain || t?.task_data?.domain || t?.domainName || '',
        dateGroup: t?.dateGroup || '',
        created_at: t?.completed_at || t?.updated_at || t?.scheduled_at || t?.created_at || null,
        date: t?.completed_at || t?.scheduled_at || t?.created_at || null,
        task_data: t?.task_data || null,
        score: getEventScore(t),
        _source: 'task'
      }));

    const merged = [...fromHistory, ...fromTasks];
    const dedup = new Map<string, any>();
    merged.forEach((item: any) => {
      const key = String(item?.id || `${item?._source}-${item?.title || ''}-${item?.created_at || item?.date || ''}-${item?.domain || ''}`);
      const prev = dedup.get(key);
      if (!prev) {
        dedup.set(key, item);
        return;
      }
      const prevTs = new Date(prev?.created_at || prev?.date || 0).getTime() || 0;
      const curTs = new Date(item?.created_at || item?.date || 0).getTime() || 0;
      if (curTs >= prevTs) dedup.set(key, item);
    });
    return Array.from(dedup.values());
  }, [history, tasks, portalPatientId, user?.id]);

  const availableSnapshots = useMemo(() => {
    const dates = scoredClinicalEvents.map((h: any) => getSnapshotKey(h)).filter(Boolean);
    return Array.from(new Set(dates)).sort((a: any, b: any) => new Date(String(b)).getTime() - new Date(String(a)).getTime());
  }, [scoredClinicalEvents]);

  useEffect(() => {
    let cancelled = false;

    const loadLatestProtocolReference = async () => {
      const patientId = String(portalPatientId || user?.patientId || user?.patient_id || user?.id || '').trim();
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
  }, [portalPatientId, user?.patientId, user?.patient_id, user?.id]);

  const activeKidsProtocol = useMemo(() => {
    const list = Array.isArray(protocols) ? protocols : [];
    const resolveProtocolMatch = (rawId: any, rawName: any) => {
      const targetId = String(rawId || '').trim();
      const targetName = normalizeClinicalKey(rawName || '');
      return list.find((protocol: any) => {
        const protocolId = String(protocol?.id || '').trim();
        const protocolTitle = normalizeClinicalKey(protocol?.title || protocol?.name || '');
        return (targetId && protocolId === targetId) || (targetName && protocolTitle === targetName);
      }) || null;
    };

    const peiGoals = Array.isArray(user?.pei) ? user.pei : [];
    const activeGoal = peiGoals.find((goal: any) => {
      const status = String(goal?.status || '').toLowerCase();
      return goal?.protocolTitle && status !== 'completed';
    }) || peiGoals.find((goal: any) => goal?.protocolTitle);

    if (activeGoal) {
      const goalProtocolId = String(activeGoal?.protocolId ?? activeGoal?.protocol_id ?? '').trim();
      const goalProtocolTitle = normalizeClinicalKey(activeGoal?.protocolTitle || '');
      const matched = resolveProtocolMatch(goalProtocolId, goalProtocolTitle);
      if (matched) return matched;
    }

    const latestTaskWithProtocol = (Array.isArray(tasks) ? [...tasks] : [])
      .sort((a: any, b: any) => {
        const left = new Date(a?.updated_at || a?.completed_at || a?.scheduled_at || a?.created_at || 0).getTime() || 0;
        const right = new Date(b?.updated_at || b?.completed_at || b?.scheduled_at || b?.created_at || 0).getTime() || 0;
        return right - left;
      })
      .find((task: any) => {
        const taskData = task?.task_data && typeof task.task_data === 'object' ? task.task_data : {};
        return Boolean(
          task?.protocol_id ||
          task?.protocolId ||
          taskData?.protocol_id ||
          taskData?.protocolId ||
          taskData?.protocolTitle ||
          taskData?.protocol_name
        );
      });

    if (latestTaskWithProtocol) {
      const taskData = latestTaskWithProtocol?.task_data && typeof latestTaskWithProtocol.task_data === 'object' ? latestTaskWithProtocol.task_data : {};
      const matchedFromTask = resolveProtocolMatch(
        latestTaskWithProtocol?.protocol_id ||
          latestTaskWithProtocol?.protocolId ||
          taskData?.protocol_id ||
          taskData?.protocolId ||
          '',
        latestTaskWithProtocol?.protocolTitle ||
          latestTaskWithProtocol?.protocol_name ||
          taskData?.protocolTitle ||
          taskData?.protocol_name ||
          ''
      );
      if (matchedFromTask) return matchedFromTask;
    }

    const discoveredProtocolId = String(
      latestProtocolReference?.protocolId || latestProtocolReference?.levelId || ''
    ).trim();
    const discoveredProtocolName = normalizeClinicalKey(latestProtocolReference?.protocolName || '');

    if (discoveredProtocolId || discoveredProtocolName) {
      const discovered = resolveProtocolMatch(discoveredProtocolId, discoveredProtocolName);
      if (discovered) return discovered;
    }

    const vbmappLevelOne = list.find((p: any) => {
      const title = String(p?.title || p?.name || '').toLowerCase();
      return /vb[\s-]?mapp/i.test(title) && (title.includes('nivel 1') || title.includes('nível 1') || title.includes('level 1'));
    });
    return vbmappLevelOne || list.find((p: any) => /vb[\s-]?mapp/i.test(String(p?.title || p?.name || ''))) || list[0] || { data: [] };
  }, [latestProtocolReference, protocols, tasks, user?.pei]);

  const activeKidsProtocolEvents = useMemo(() => {
    const domainTasks = (Array.isArray(activeKidsProtocol?.data) ? activeKidsProtocol.data : [])
      .flatMap((domain: any) => (Array.isArray(domain?.skills) ? domain.skills : []).map((skill: any) => ({
        domainName: String(domain?.name || '').trim(),
        skillName: String(skill?.name || '').trim()
      })));

    if (!domainTasks.length) return scoredClinicalEvents;

    const activeProtocolId = String(activeKidsProtocol?.id || '').trim();
    const activeProtocolTitle = normalizeClinicalKey(activeKidsProtocol?.title || activeKidsProtocol?.name || '');

    const extractEventProtocolRef = (event: any) => {
      const taskData = event?.task_data && typeof event.task_data === 'object' ? event.task_data : {};
      const metadata = event?.metadata && typeof event.metadata === 'object' ? event.metadata : {};
      return {
        id: String(
          event?.protocol_id ||
            event?.protocolId ||
            taskData?.protocol_id ||
            taskData?.protocolId ||
            metadata?.protocol_id ||
            metadata?.protocolId ||
            ''
        ).trim(),
        title: normalizeClinicalKey(
          event?.protocolTitle ||
            event?.protocol_name ||
            taskData?.protocolTitle ||
            taskData?.protocol_name ||
            metadata?.protocolTitle ||
            metadata?.protocol_name ||
            metadata?.canonicalName ||
            ''
        )
      };
    };

    const eventsWithExplicitProtocol = scoredClinicalEvents.filter((event: any) => {
      const ref = extractEventProtocolRef(event);
      return Boolean(ref.id || ref.title);
    });

    if (eventsWithExplicitProtocol.length) {
      return eventsWithExplicitProtocol.filter((event: any) => {
        const ref = extractEventProtocolRef(event);
        return (activeProtocolId && ref.id === activeProtocolId) || (activeProtocolTitle && ref.title === activeProtocolTitle);
      });
    }

    return scoredClinicalEvents.filter((event: any) => {
      const eventTitle = String(event?.title || event?.taskTitle || event?.task_data?.title || '').trim();
      const eventDomain = String(event?.domain || event?.domainName || event?.task_data?.domain || event?.task_data?.domainName || '').trim();
      return domainTasks.some((task: any) =>
        isSameClinicalSkill(task.skillName, eventTitle) ||
        (task.domainName && normalizeClinicalKey(task.domainName) === normalizeClinicalKey(eventDomain))
      );
    });
  }, [activeKidsProtocol, scoredClinicalEvents]);

  const activeProtocolSnapshots = useMemo(() => {
    const dates = activeKidsProtocolEvents.map((h: any) => getSnapshotKey(h)).filter(Boolean);
    return Array.from(new Set(dates)).sort((a: any, b: any) => new Date(String(b)).getTime() - new Date(String(a)).getTime());
  }, [activeKidsProtocolEvents]);

  useEffect(() => {
    if (!activeProtocolSnapshots.length) {
      setSelectedBaseDate("");
      setSelectedCompareDate("");
      return;
    }
    if (!selectedBaseDate || !activeProtocolSnapshots.includes(selectedBaseDate)) {
      setSelectedBaseDate(activeProtocolSnapshots[0]);
      return;
    }
    if (!selectedCompareDate || selectedCompareDate === selectedBaseDate || !activeProtocolSnapshots.includes(selectedCompareDate)) {
      const firstDifferent = activeProtocolSnapshots.find((d: any) => d !== selectedBaseDate) || "";
      setSelectedCompareDate(firstDifferent);
    }
  }, [activeProtocolSnapshots, selectedBaseDate, selectedCompareDate]);

  const kidChartData = useMemo(() => {
    const defaultKidsDomains = [
      'Mando (Mand)',
      'Tato (Tact)',
      'Ouvinte (Listener)',
      'Percepção Visual (VP-MTS)',
      'Brincar Independente (Play)',
      'Imitação Motora (Imitation)',
      'Ecoico (Echoic)'
    ];

    const inferKidsDomainFromTitle = (title: any): string => {
      const n = normalizeClinicalKey(title);
      if (!n) return '';
      if (n.includes('mando') || n.includes('mand')) return 'Mando (Mand)';
      if (n.includes('tato') || n.includes('tact')) return 'Tato (Tact)';
      if (n.includes('ouvinte') || n.includes('listener')) return 'Ouvinte (Listener)';
      if (n.includes('percepcao visual') || n.includes('visual') || n.includes('vp mts') || n.includes('vpmts')) return 'Percepção Visual (VP-MTS)';
      if (n.includes('brincar') || n.includes('play')) return 'Brincar Independente (Play)';
      if (n.includes('imitacao') || n.includes('imitation') || n.includes('motora')) return 'Imitação Motora (Imitation)';
      if (n.includes('ecoico') || n.includes('echoic')) return 'Ecoico (Echoic)';
      return '';
    };

    const selectedProto = activeKidsProtocol || { data: [] };
    const protocolDomains = Array.isArray(selectedProto?.data)
      ? selectedProto.data
          .map((d: any) => ({
            name: String(d?.name || '').trim(),
            skills: Array.isArray(d?.skills) ? d.skills : []
          }))
          .filter((d: any) => d.name)
      : [];

    const sourceHistory = Array.isArray(activeKidsProtocolEvents) ? activeKidsProtocolEvents : [];
    const isVbMappProtocol = /vb[\s-]?mapp/i.test(String(selectedProto?.title || ''));
    const vbmappCriterion = Number((selectedProto as any)?.masteryCriterion ?? (selectedProto as any)?.vbmapp_mastery_criterion ?? 5) || 5;
    const scoredEvents = sourceHistory
      .map((h: any) => {
        const scoreRaw = getEventScore(h);
        if (scoreRaw === null) return null;
        const rawScore = Number(scoreRaw) || 0;
        const score = isVbMappProtocol
          ? Math.max(0, Math.min(1, rawScore))
          : Math.max(0, rawScore);
        const rawMaxScore = Number(
          h?.maxScore ??
          h?.max_score ??
          h?.task_data?.maxScore ??
          h?.task_data?.max_score
        );
        const eventMaxScore = Number.isFinite(rawMaxScore) && rawMaxScore > 0 ? rawMaxScore : null;
        const ts = new Date(h?.created_at || h?.date || 0).getTime() || 0;
        const title = String(h?.title || h?.taskTitle || h?.task_data?.title || '').trim();
        const domain = String(
          h?.domain ||
            h?.domainName ||
            h?.task_data?.domain ||
            h?.task_data?.domainName ||
            h?.metadata?.domain ||
            inferKidsDomainFromTitle(title) ||
            'Geral'
        ).trim();
        return {
          ...h,
          _score: score,
          _maxScore: eventMaxScore,
          _timestamp: ts,
          _title: title,
          _titleKey: normalizeClinicalKey(title),
          _domain: domain || 'Geral',
          _domainKey: normalizeClinicalKey(domain || 'Geral')
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a._timestamp - b._timestamp);

    const fallbackDomainMap = new Map<string, Set<string>>();
    scoredEvents.forEach((event: any) => {
      const domainName = event._domain || 'Geral';
      if (!fallbackDomainMap.has(domainName)) fallbackDomainMap.set(domainName, new Set<string>());
      if (event._title) fallbackDomainMap.get(domainName)!.add(event._title);
    });

    const fallbackDomains = Array.from(fallbackDomainMap.entries()).map(([name, skillsSet]) => ({
      name,
      skills: Array.from(skillsSet).map((s) => ({ name: s }))
    }));

    const fallbackHasOnlyGeneral =
      fallbackDomains.length === 1 && normalizeClinicalKey(fallbackDomains[0]?.name) === 'geral';
    const effectiveDomains = protocolDomains.length
      ? protocolDomains
      : fallbackDomains.length && !fallbackHasOnlyGeneral
        ? fallbackDomains
        : defaultKidsDomains.map((name) => ({ name, skills: [{ name }] }));

    const labels = effectiveDomains.map((d: any) => d.name);

    const resolveCutoffTimestamp = (dateFilter: string | null) => {
      if (!dateFilter) return Number.POSITIVE_INFINITY;
      const parsed = new Date(`${dateFilter}T23:59:59.999`).getTime();
      return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
    };

    const resolveDomainProgressPercent = (dateFilter: string | null, mode: 'first' | 'latest') => {
      const cutoffTs = resolveCutoffTimestamp(dateFilter);
      const modeNormalized = mode === 'first' ? 'baseline' : 'latest';
      return effectiveDomains.map((domain: any) => {
        const domainName = String(domain?.name || 'Geral').trim() || 'Geral';
        const domainTasks = (Array.isArray(domain?.skills) ? domain.skills : []).map((skill: any) => ({
          name: String(skill?.name || '').trim(),
          maxScore: Math.max(1, Number(skill?.maxScore ?? skill?.max_score ?? 1) || 1)
        }));
        const domainEvents = scoredEvents
          .filter((event: any) => event._timestamp <= cutoffTs)
          .filter((event: any) => {
            const matchesDomain = normalizeClinicalKey(event?._domain || '') === normalizeClinicalKey(domainName);
            const matchesSkill = domainTasks.some((task: any) => isSameClinicalSkill(task.name, event?._title || ''));
            return matchesDomain || matchesSkill;
          })
          .map((event: any) => {
            const matchedTask = domainTasks.find((task: any) =>
              isSameClinicalSkill(task.name, event?._title || '')
            );
            const maxScore = isVbMappProtocol
              ? 1
              : Math.max(1, Number(event?._maxScore ?? matchedTask?.maxScore ?? 1) || 1);
            return {
              title: event?._title || '',
              score: event?._score,
              maxScore,
              consecutive_successes: event?.consecutive_successes,
              created_at: event?.created_at || event?.date || null
            };
          });
        return calculateDomainMastery(domainEvents, domainTasks, {
          mode: modeNormalized as any,
          protocolKind: isVbMappProtocol ? 'vbmapp' : 'other',
          vbmappMasteryCriterion: vbmappCriterion
        });
      });
    };

    const resolvedBaseDate = selectedBaseDate || activeProtocolSnapshots[0] || "";
    const resolvedCurrentDate = selectedCompareDate || activeProtocolSnapshots[0] || "";
    const baselineData = resolveDomainProgressPercent(resolvedBaseDate || null, 'first');
    const currentData = resolveDomainProgressPercent(resolvedCurrentDate || null, 'latest');

    return {
      labels,
      datasets: [
        {
          label: `Avaliação ${formatFilterDate(resolvedBaseDate || selectedBaseDate || '') || 'Inicial'}`,
          data: baselineData,
          backgroundColor: 'rgba(122, 50, 252, 0.9)',
          borderColor: '#7a32fc',
          borderWidth: 2
        },
        {
          label: `Intervenção ${formatFilterDate(resolvedCurrentDate || selectedCompareDate || '') || 'Atual'}`,
          data: currentData,
          backgroundColor: 'rgba(5, 205, 153, 0.9)',
          borderColor: '#05CD99',
          borderWidth: 2
        }
      ]
    };
  }, [activeKidsProtocol, activeKidsProtocolEvents, selectedBaseDate, selectedCompareDate, activeProtocolSnapshots]);

  const portalFamilyHistory = useMemo(() => {
    const patientKeys = new Set(
      [portalPatientId, user?.id, user?.patientId, user?.patient_id]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );
    // A guardian email can belong to multiple children. Never infer the
    // patient for clinical photos or rewards from that shared identifier.
    return (Array.isArray(history) ? history : []).filter((item: any) => {
      const isFamily = ['family_note', 'patient_note', 'photo'].includes(String(item?.type || '').toLowerCase());
      if (!isFamily) return false;
      const itemPatientId = String(item?.patientId || item?.patient_id || '').trim();
      return Boolean(itemPatientId && patientKeys.has(itemPatientId));
    });
  }, [history, portalPatientId, user?.id, user?.patientId, user?.patient_id]);

  const persistedFamilyDiaryHistory = useMemo(() => {
    return [...portalFamilyHistory]
      .sort((a: any, b: any) => {
        const aTime = new Date(a.date || a.created_at || 0).getTime();
        const bTime = new Date(b.date || b.created_at || 0).getTime();
        if (aTime === bTime) return (b.id || 0) - (a.id || 0);
        return bTime - aTime;
      })
      .slice(0, 8);
  }, [portalFamilyHistory]);

  const kidsGamification = useMemo(() => {
    const today = new Date();
    const weekAgo = new Date();
    weekAgo.setDate(today.getDate() - 7);
    const weekLogs = portalFamilyHistory.filter((item: any) => {
      const when = new Date(item.date || item.created_at || 0);
      return when >= weekAgo;
    }).length;
    const weekPhotos = portalFamilyHistory.filter((item: any) => {
      const when = new Date(item.date || item.created_at || 0);
      return item.type === 'photo' && when >= weekAgo;
    }).length;
    const portalStarPatientKeys = new Set(
      [portalPatientId, user?.id, user?.patientId, user?.patient_id]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );
    const sharedNoteBelongsToPortalPatient = (item: any) => {
      const notePatientId = String(item?.patientId ?? item?.patient_id ?? '').trim();
      return Boolean(notePatientId && portalStarPatientKeys.has(notePatientId));
    };
    const scopedSharedNotes = (Array.isArray(sharedNotes) ? sharedNotes : []).filter(sharedNoteBelongsToPortalPatient);
    const milestoneBySource = new Map<string, { awarded: boolean; ts: number }>();
    scopedSharedNotes.forEach((item: any) => {
      const subject = String(item?.subject || '').trim().toLowerCase();
      const text = String(item?.text || item?.note || '').trim();
      const isEvent = subject === 'milestone_event' || text.startsWith('MILESTONE_EVENT|');
      if (!isEvent) return;
      const sourceMatch = text.match(/source=([^|]+)/i);
      const awardedMatch = text.match(/awarded=([01])/i);
      const source = String(sourceMatch?.[1] || '').trim();
      if (!source) return;
      const awarded = String(awardedMatch?.[1] || '0') === '1';
      const ts = new Date(item?.created_at || item?.date || 0).getTime() || 0;
      const prev = milestoneBySource.get(source);
      if (!prev || ts >= prev.ts) {
        milestoneBySource.set(source, { awarded, ts });
      }
    });
    return { weekLogs, weekPhotos, stars: countCanonicalFamilyStars(portalFamilyHistory, scopedSharedNotes, milestoneBySource) };
  }, [portalFamilyHistory, sharedNotes, portalPatientId, user?.id, user?.patientId, user?.patient_id]);
  const kidsCheckpointLevel = useMemo(() => Math.floor((kidsGamification.stars || 0) / 5), [kidsGamification.stars]);

  const normalizePortalText = (value: any) => String(value || '').trim();
  const normalizePortalLower = (value: any) => normalizePortalText(value).toLowerCase();
  const portalPatientKeys = useMemo(() => {
    return new Set(
      [portalPatientId, user?.id, user?.patientId, user?.patient_id]
        .map((value) => normalizePortalText(value))
        .filter(Boolean)
    );
  }, [portalPatientId, user?.id, user?.patientId, user?.patient_id]);
  const portalPatientEmail = normalizePortalLower(user?.email);
  const isTechnicalOrInfrastructureValue = (value: any) => {
    const text = normalizePortalText(value);
    const infrastructureTokens = ['supa' + 'base', 'rail' + 'way', 'post' + 'grest'];
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ||
      infrastructureTokens.some((token) => text.toLowerCase().includes(token));
  };
  const firstPortalText = (...values: any[]) => values.map(normalizePortalText).find(Boolean) || '';
  const portalIdentityKey = (value: any) =>
    normalizePortalText(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const isGenericPortalClinicName = (value: any) => [
    '',
    'clinica',
    'sua clinica',
    'minha clinica',
    'clinica verto',
    'verto'
  ].includes(portalIdentityKey(value));
  const isVertoPortalFallbackAsset = (value: any) => {
    return isVertoInstitutionalAsset(value);
  };
  const firstPortalLogoUrl = (...values: any[]) =>
    values
      .map(normalizePortalText)
      .find((value) => value && !isVertoPortalFallbackAsset(value)) || '';
  const looksLikePortalProfessionalLabel = (candidate: any, professionalName: any) => {
    const candidateKey = portalIdentityKey(candidate);
    const professionalKey = portalIdentityKey(professionalName);
    if (!candidateKey || !professionalKey) return false;
    if (candidateKey === professionalKey) return true;
    const candidateTokens = candidateKey.split(/\s+/).filter(Boolean);
    const professionalTokens = new Set(professionalKey.split(/\s+/).filter(Boolean));
    return candidateTokens.length > 0 && candidateTokens.length <= 2 && candidateTokens.every((token) => professionalTokens.has(token));
  };
  const firstPortalClinicText = (professionalNames: any[], ...values: any[]) => {
    const professionals = professionalNames.map(normalizePortalText).filter(Boolean);
    const candidates = values
      .map(normalizePortalText)
      .filter((value) => value && !professionals.some((professional) => looksLikePortalProfessionalLabel(value, professional)));
    return candidates.find((value) => !isGenericPortalClinicName(value)) || candidates[0] || 'Clínica';
  };
  const renderPortalClinicLogo = (logoUrl: any, clinicName: any, className = 'h-full w-full object-contain p-1') => {
    const fallback = (
      <img src={VERTO_BRAND_ASSETS.symbol} alt="Verto" className={className} />
    );
    const safeLogoUrl = firstPortalLogoUrl(logoUrl);
    return safeLogoUrl ? (
      <SecureImage
        src={safeLogoUrl}
        alt={`Logo ${clinicName || 'da clínica'}`}
        className={className}
        fallback={fallback}
      />
    ) : fallback;
  };
  const getPortalClinicNameExclusions = (...values: any[]) => ([
    ...values,
    user?.professionalName,
    user?.professional_name,
    user?.clinicSettings?.professionalName,
    user?.clinicSettings?.professionalDisplayName,
    user?.clinicSettings?.technicalResponsibleName,
    user?.clinicSettings?.responsibleName,
    user?.clinicSettings?.responsavelTecnicoNome
  ]);
  const hasPortalTrueFlag = (value: any) => value === true || ['true', '1', 'yes', 'sim', 'shared', 'released', 'liberado', 'patient', 'family', 'public'].includes(normalizePortalLower(value));
  const hasPortalPrivateFlag = (item: any) => {
    const visibility = normalizePortalLower(item?.visibility || item?.audience || item?.scope || item?.access);
    return item?.private === true ||
      item?.isPrivate === true ||
      item?.is_private === true ||
      item?.internal === true ||
      item?.isInternal === true ||
      item?.is_internal === true ||
      ['private', 'privado', 'internal', 'interno', 'team', 'staff', 'clinic', 'clinica', 'clínica'].includes(visibility);
  };
  const noteBelongsToPortalPatient = (note: any) => {
    const notePatientId = normalizePortalText(note?.patientId || note?.patient_id);
    const noteEmail = normalizePortalLower(note?.patientEmail || note?.patient_email || note?.email);
    if (notePatientId && portalPatientKeys.size > 0 && !portalPatientKeys.has(notePatientId)) return false;
    if (!notePatientId && noteEmail && portalPatientEmail && noteEmail !== portalPatientEmail) return false;
    return true;
  };
  const isSystemPortalMilestoneEvent = (note: any) => {
    const subject = normalizePortalLower(note?.subject);
    const text = normalizePortalText(note?.text || note?.note);
    return subject === 'milestone_event' || text.startsWith('MILESTONE_EVENT|');
  };
  const isPortalSharedNote = (note: any) => {
    if (!note || isSystemPortalMilestoneEvent(note) || hasPortalPrivateFlag(note) || !noteBelongsToPortalPatient(note)) return false;
    const visibility = normalizePortalLower(note?.visibility || note?.audience || note?.scope || note?.access);
    const type = normalizePortalLower(note?.type || note?.kind);
    return hasPortalTrueFlag(note?.sharedWithPatient) ||
      hasPortalTrueFlag(note?.shared_with_patient) ||
      hasPortalTrueFlag(note?.visibleToPatient) ||
      hasPortalTrueFlag(note?.visible_to_patient) ||
      ['shared', 'patient', 'family', 'shared_patient', 'portal'].includes(visibility) ||
      ['shared_note', 'patient_note', 'family_note', 'photo'].includes(type);
  };
  const portalSharedNotes = useMemo(() => {
    return (Array.isArray(sharedNotes) ? sharedNotes : [])
      .filter(isPortalSharedNote)
      .sort((a: any, b: any) => new Date(b?.created_at || b?.date || 0).getTime() - new Date(a?.created_at || a?.date || 0).getTime())
      .slice(0, 30);
  }, [sharedNotes, portalPatientKeys, portalPatientEmail]);
  const unreadPortalSharedNotes = useMemo(
    () => portalSharedNotes.filter((note: any) => {
      const noteId = String(note?.id || '').trim();
      return noteId && !readMessageIds.has(noteId);
    }),
    [portalSharedNotes, readMessageIds]
  );
  const openMessagesAndPersistRead = () => {
    setIsMessagesOpen(true);
    setIsMenuOpen(false);
    const unreadIds = unreadPortalSharedNotes
      .map((note: any) => String(note?.id || '').trim())
      .filter((noteId: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(noteId));
    if (unreadIds.length === 0) return;
    setReadMessageIds((current) => new Set([...Array.from(current), ...unreadIds]));
    void dataService.markPatientSelfMessagesRead(unreadIds).then(async (result: any) => {
      if (result?.success) return;
      const refreshed = await dataService.getPatientSelfMessageReads();
      const ids = refreshed?.success && Array.isArray(refreshed?.data)
        ? refreshed.data.map((row: any) => String(row?.note_id || '')).filter(Boolean)
        : [];
      setReadMessageIds(new Set(ids));
    });
  };
  const familyDiaryHistory = useMemo(() => {
    const normalizedSharedNotes = portalSharedNotes
      .filter((note: any) => {
        const visibility = normalizePortalLower(note?.visibility || note?.audience || note?.scope || note?.access);
        const type = normalizePortalLower(note?.type || note?.kind);
        return ['family', 'patient', 'shared_patient', 'portal'].includes(visibility) ||
          ['family_note', 'photo', 'shared_note', 'patient_note'].includes(type);
      })
      .map((note: any) => ({
        ...note,
        id: firstPortalText(note?.id, note?.created_at, note?.date, note?.subject) ||
          `shared-${normalizePortalLower(firstPortalText(note?.text, note?.content, note?.note, 'registro'))}`,
        type: normalizePortalLower(note?.type || note?.kind) === 'photo' ? 'photo' : 'family_note',
        note: firstPortalText(note?.note, note?.text, note?.content, note?.subject),
        created_at: firstPortalText(note?.created_at, note?.date),
        // Nao achate os anexos: registros legados podem ter a foto somente em
        // metadata/attachments. O resolvedor abaixo conhece essas variacoes.
        metadata: note?.metadata && typeof note.metadata === 'object' ? note.metadata : undefined,
        attachments: Array.isArray(note?.attachments) ? note.attachments : undefined,
        files: Array.isArray(note?.files) ? note.files : undefined,
        photos: Array.isArray(note?.photos) ? note.photos : undefined,
        image: firstPortalText(note?.image, note?.image_url, note?.photo_url, note?.url),
        image_path: firstPortalText(note?.image_path, note?.imagePath, note?.storage_path, note?.storagePath, note?.photo_path, note?.photoPath, note?.path)
      }));
    const seen = new Set<string>();
    return [...persistedFamilyDiaryHistory, ...normalizedSharedNotes]
      .filter((entry: any) => {
        const key = normalizePortalLower(`${entry?.id || ''}|${entry?.created_at || entry?.date || ''}|${entry?.note || ''}`);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a: any, b: any) => {
        const aTime = new Date(a.date || a.created_at || 0).getTime();
        const bTime = new Date(b.date || b.created_at || 0).getTime();
        if (aTime === bTime) return String(b.id || '').localeCompare(String(a.id || ''));
        return bTime - aTime;
      })
      .slice(0, 8);
  }, [persistedFamilyDiaryHistory, portalSharedNotes]);
  const isPortalReleasedDocument = (document: any) => {
    if (!document || hasPortalPrivateFlag(document) || !noteBelongsToPortalPatient(document)) return false;
    const metadata = document?.metadata && typeof document.metadata === 'object' ? document.metadata : {};
    const visibility = normalizePortalLower(document?.visibility || document?.audience || document?.scope || metadata?.visibility);
    const status = normalizePortalLower(document?.status || metadata?.status);
    return hasPortalTrueFlag(document?.releasedToPatient) ||
      hasPortalTrueFlag(document?.released_to_patient) ||
      hasPortalTrueFlag(document?.visibleToPatient) ||
      hasPortalTrueFlag(document?.visible_to_patient) ||
      hasPortalTrueFlag(document?.sharedWithPatient) ||
      hasPortalTrueFlag(document?.shared_with_patient) ||
      hasPortalTrueFlag(metadata?.releasedToPatient) ||
      hasPortalTrueFlag(metadata?.visibleToPatient) ||
      ['released', 'liberado', 'shared', 'patient', 'family', 'portal', 'public'].includes(visibility) ||
      ['released', 'liberado', 'available_to_patient'].includes(status);
  };
  const portalReleasedDocuments = useMemo(() => {
    const userDocuments = [
      ...(Array.isArray(user?.portalDocuments) ? user.portalDocuments : []),
      ...(Array.isArray(user?.releasedDocuments) ? user.releasedDocuments : []),
      ...(Array.isArray(user?.sharedDocuments) ? user.sharedDocuments : []),
      ...(Array.isArray(user?.documents) ? user.documents : []),
      ...(Array.isArray(user?.files) ? user.files : [])
    ];
    const noteDocuments = (Array.isArray(sharedNotes) ? sharedNotes : [])
      .filter(isPortalSharedNote)
      .flatMap((note: any) => [
        ...(Array.isArray(note?.documents) ? note.documents : []),
        ...(Array.isArray(note?.files) ? note.files : []),
        ...(Array.isArray(note?.attachments) ? note.attachments : []),
        normalizePortalLower(note?.type) === 'document' ? note : null
      ].filter(Boolean));
    const seen = new Set<string>();
    return [...userDocuments, ...noteDocuments]
      .filter(isPortalReleasedDocument)
      .map((document: any) => {
        const rawHref = firstPortalText(document?.downloadUrl, document?.download_url, document?.portalUrl, document?.portal_url, document?.url, document?.signedUrl, document?.signed_url);
        const href = rawHref && !isTechnicalOrInfrastructureValue(rawHref) ? rawHref : '';
        return {
          key: firstPortalText(document?.id, document?.path, document?.fileName, document?.name, document?.title, document?.createdAt, document?.created_at),
          name: firstPortalText(document?.title, document?.name, document?.fileName, document?.file_name, document?.label) || 'Documento liberado',
          category: firstPortalText(document?.category, document?.source, document?.type) || 'Documento',
          createdAt: firstPortalText(document?.createdAt, document?.created_at, document?.date),
          href
        };
      })
      .filter((document: any) => {
        const key = normalizePortalLower(`${document.name}|${document.createdAt}|${document.href || ''}`);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 30);
  }, [user, sharedNotes, portalPatientKeys, portalPatientEmail]);
  const visiblePortalDocuments = useMemo(() => {
    const persisted = portalPatientFiles.map((file: any) => ({
      key: firstPortalText(file?.id, file?.path, file?.fileName),
      patientFileId: firstPortalText(file?.id),
      auditedAccess: true,
      name: firstPortalText(file?.fileName, file?.file_name, file?.name) || 'Documento',
      category: firstPortalText(file?.source, file?.mimeType, file?.mime_type) || 'Documento',
      createdAt: firstPortalText(file?.createdAt, file?.created_at),
      href: '',
      mimeType: firstPortalText(file?.mimeType, file?.mime_type)
    }));
    const seen = new Set<string>();
    return [...persisted, ...portalReleasedDocuments].filter((document: any) => {
      const key = normalizePortalLower(document.key || `${document.name}|${document.createdAt}|${document.href || ''}`);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [portalPatientFiles, portalReleasedDocuments]);
  const portalReportRows = useMemo(() => {
    return portalAppointments
      .map((appointment: any) => {
        const status = normalizePortalLower(appointment?.status);
        const minutes = getPortalAppointmentDurationMinutes(appointment);
        const isCompleted = /complet|realiz|done|finished|conclu/.test(status) || Boolean(appointment?.actualDurationMinutes || appointment?.actual_duration_minutes);
        return {
          appointment,
          minutes: isCompleted ? minutes : null,
          statusLabel: getPortalStatusLabel(appointment?.status)
        };
      })
      .filter((row: any) => Number(row.minutes) > 0)
      .slice(0, 30);
  }, [portalAppointments]);
  const portalReportTotalMinutes = portalReportRows.reduce((sum: number, row: any) => sum + Number(row.minutes || 0), 0);

  const dismissMilestoneCelebration = () => {
    setShowStarCelebration(false);
    const sessionKey = milestoneCelebrationSessionKeyRef.current;
    if (sessionKey) {
      try {
        window.sessionStorage.removeItem(sessionKey);
      } catch {
        // sessionStorage is only a render-resilience fallback; the server owns delivery.
      }
    }
  };

  useEffect(() => {
    const userId = String(user?.id || '').trim();
    const patientId = String(portalPatientId || '').trim();
    if (!userId || !patientId) return;

    const requestKey = `${userId}:${patientId}`;
    if (milestoneCelebrationRequestRef.current === requestKey) return;
    milestoneCelebrationRequestRef.current = requestKey;

    const sessionKey = `verto:milestone-celebration:${requestKey}`;
    milestoneCelebrationSessionKeyRef.current = sessionKey;
    let active = true;

    const showCelebration = (count: number) => {
      if (!active) return;
      const safeCount = Math.max(1, Math.min(99, Number(count) || 1));
      setMilestoneCelebrationCount(safeCount);
      setCelebrationKey((value) => value + 1);
      setShowStarCelebration(true);
    };

    try {
      const cached = JSON.parse(window.sessionStorage.getItem(sessionKey) || 'null');
      if (cached?.celebrate === true) {
        showCelebration(cached?.unseenCount);
        return () => { active = false; };
      }
    } catch {
      // Ignore invalid temporary cache and request the authoritative server state.
    }

    void dataService.consumePortalMilestoneCelebration().then((result: any) => {
      if (!active || result?.success !== true || result?.data?.celebrate !== true) return;
      const payload = {
        celebrate: true,
        unseenCount: Math.max(1, Number(result?.data?.unseenCount || 1) || 1),
        latestAwardId: result?.data?.latestAwardId || null,
        latestAwardAt: result?.data?.latestAwardAt || null
      };
      try {
        window.sessionStorage.setItem(sessionKey, JSON.stringify(payload));
      } catch {
        // The server receipt already guarantees that the same milestone is not delivered twice.
      }
      showCelebration(payload.unseenCount);
    });

    return () => { active = false; };
  }, [portalPatientId, user?.id]);


  const familyPhotoCountToday = useMemo(() => {
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return portalFamilyHistory.filter((item: any) => {
      if (item?.type !== 'photo') return false;
      const raw = item.date || item.created_at;
      if (!raw) return false;
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) return false;
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed) === todayStr;
    }).length;
  }, [portalFamilyHistory]);
  const hasReachedFamilyPhotoLimitToday = familyPhotoCountToday >= FAMILY_DAILY_PHOTO_LIMIT;

  const handleConfirmFamilyNote = async () => {
    if (isReadOnlyMode || familySaveInFlightRef.current) return;
    if ((familyNote.trim() || familyImage) && !isFamilySaving) {
      familySaveInFlightRef.current = true;
      setIsFamilySaving(true);
      setFamilyUploadError('');
      let uploadedPathThisAttempt: string | null = null;
      let historyWriteAttempted = false;
      try {
        let persistedImage = familyImage || undefined;
        let persistedImagePath: string | undefined = familyImagePath || undefined;
        if (persistedImage && persistedImage.startsWith('data:image/')) {
          const extension = persistedImage.includes('image/jpeg') ? 'jpg' : persistedImage.includes('image/webp') ? 'webp' : 'png';
          const ownerPatientId = String(portalPatientId || user?.patientId || user?.patient_id || user?.id || '').trim();
          if (!ownerPatientId) throw new Error('Não encontramos o paciente vinculado para salvar a foto.');
          const fileName = `${ownerPatientId}/family/family-${Date.now()}.${extension}`;
          const uploadResult = await dataService.uploadDataUrl('patient-photos', fileName, persistedImage, `image/${extension === 'jpg' ? 'jpeg' : extension}`);
          if (uploadResult?.success && uploadResult.url) {
            persistedImage = uploadResult.url;
            persistedImagePath = uploadResult.path;
            uploadedPathThisAttempt = String(uploadResult.path || '') || null;
          } else {
            throw new Error(`Não foi possível salvar a foto no armazenamento: ${uploadResult?.error || 'erro desconhecido'}`);
          }
        }

        if (!portalPatientId) throw new Error('Não encontramos um paciente vinculado a este acesso. Entre em contato com a clínica.');
        historyWriteAttempted = true;
        const saveResult = await onAddFamilyNote(portalPatientId, familyNote, persistedImage, persistedImagePath);
        if (saveResult?.success !== true) {
          throw new Error(saveResult?.error || 'Não foi possível confirmar a gravação do registro no histórico.');
        }

        setFamilyNote('');
        setFamilyImage(null);
        setFamilyImagePath(null);
        setIsFamilyLogOpen(false);
        if (saveResult?.pending === true || saveResult?.offline === true) {
          setFamilyUploadError(saveResult?.message || 'Registro salvo neste dispositivo e aguardando sincronização.');
        } else {
          setShowFamilySuccess(true);
          window.setTimeout(() => setShowFamilySuccess(false), 1600);
        }
      } catch (error: any) {
        // A missing ACK may hide a committed history entry: do not delete its uploaded photo.
        if (uploadedPathThisAttempt && !historyWriteAttempted) void dataService.cleanupPatientPhotoUpload(uploadedPathThisAttempt);
        setFamilyUploadError(error?.message || 'Não foi possível salvar o registro. Tente novamente.');
      } finally {
        familySaveInFlightRef.current = false;
        setIsFamilySaving(false);
      }
    }
  };

  const formatDiaryTimestamp = (value: any) => {
    if (!value) return 'Agora';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Agora';
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getFamilyDiaryImageSource = (entry: any) => {
    const metadata = entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : {};
    const attachments = [
      ...(Array.isArray(entry?.attachments) ? entry.attachments : []),
      ...(Array.isArray(entry?.files) ? entry.files : []),
      ...(Array.isArray(entry?.photos) ? entry.photos : []),
      ...(Array.isArray(metadata?.attachments) ? metadata.attachments : []),
      ...(Array.isArray(metadata?.files) ? metadata.files : []),
      ...(Array.isArray(metadata?.photos) ? metadata.photos : [])
    ].filter((item) => item && typeof item === 'object');
    const direct = firstPortalText(
      entry?.image,
      entry?.imageUrl,
      entry?.photoUrl,
      entry?.image_url,
      entry?.photo_url,
      entry?.url,
      metadata?.image,
      metadata?.imageUrl,
      metadata?.photoUrl,
      metadata?.image_url,
      metadata?.photo_url,
      metadata?.url,
      ...attachments.flatMap((item: any) => [
        item?.image,
        item?.imageUrl,
        item?.photoUrl,
        item?.image_url,
        item?.photo_url,
        item?.url
      ])
    );
    if (direct) return direct;
    const path = firstPortalText(
      entry?.image_path,
      entry?.imagePath,
      entry?.storage_path,
      entry?.storagePath,
      entry?.photo_path,
      entry?.photoPath,
      entry?.path,
      metadata?.image_path,
      metadata?.imagePath,
      metadata?.storage_path,
      metadata?.storagePath,
      metadata?.photo_path,
      metadata?.photoPath,
      metadata?.path,
      ...attachments.flatMap((item: any) => [
        item?.image_path,
        item?.imagePath,
        item?.storage_path,
        item?.storagePath,
        item?.photo_path,
        item?.photoPath,
        item?.path
      ])
    );
    if (!path) return '';
    return path.startsWith('patient-photos/') ? path : `patient-photos/${path}`;
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isReadOnlyMode) return;
    if (hasReachedFamilyPhotoLimitToday && !familyImage) {
      alert(`A família já enviou ${FAMILY_DAILY_PHOTO_LIMIT} fotos hoje. Envie novas fotos amanhã.`);
      e.target.value = '';
      return;
    }
    const file = e.target.files?.[0];
    if (file) {
      setFamilyUploadError('');
      setIsUploading(true);
      try {
        const ownerPatientId = String(portalPatientId || user?.patientId || user?.patient_id || user?.id || '').trim();
        if (!ownerPatientId) {
          setFamilyUploadError('Não encontramos o paciente vinculado para salvar a foto.');
          return;
        }
        const fileName = `${ownerPatientId}/family/family-${Date.now()}-${file.name}`;
        const result = await dataService.uploadFile('patient-photos', fileName, file);

        if (result.success && result.url) {
          setFamilyImage(result.url);
          setFamilyImagePath(result.path || null);
          setFamilyUploadError('');
          setIsDrawingMode(true);
        } else {
          setFamilyUploadError(result.error || 'Não foi possível enviar a imagem. Tente novamente.');
        }
      } catch (error: any) {
        console.error('Upload error:', error);
        setFamilyUploadError(error?.message || 'Não foi possível processar a imagem selecionada.');
      } finally {
        setIsUploading(false);
        e.target.value = '';
      }
    }
  };

  const handleInterventionImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isReadOnlyMode) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setIsInterventionUploading(true);
    try {
      const fileName = `${user.id}/interventions/${Date.now()}-${file.name}`;
      const result = await dataService.uploadFile('patient-photos', fileName, file);
      if (result.success && result.url) {
        setInterventionImages((prev) => [...prev, result.url!]);
      } else {
        alert('Erro ao anexar imagem da tarefa. Tente novamente.');
      }
    } catch (error) {
      console.error('Intervention upload error:', error);
    } finally {
      setIsInterventionUploading(false);
      e.target.value = '';
    }
  };

  const filteredHistoryList = useMemo(() => {
    const scopedByDate =
      selectedSnapshotDate === "all"
        ? history
        : history.filter((h: any) => getHistoryDateKey(h) === selectedSnapshotDate);

    const normalizeTextKey = (value: any) =>
      String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    const normalized = (Array.isArray(scopedByDate) ? scopedByDate : []).map((item: any) => {
      const dateKey = getHistoryDateKey(item);
      return {
        ...item,
        _dateKey: dateKey,
        _sortTime: getHistoryItemSortTime(item),
        dateGroup: formatHistoryDateLabel(dateKey)
      };
    });

    const deduped = new Map<string, any>();
    normalized.forEach((item: any) => {
      const taskRef = String(
        item?.assigned_task_id ||
          item?.assignedTaskId ||
          item?.task_id ||
          item?.taskId ||
          item?.sourceRef ||
          item?.source_ref ||
          ''
      ).trim();
      const itemKey = taskRef
        ? `task-ref:${taskRef}`
        : [
            String(item?.patient_id || item?.patientId || user?.id || ''),
            normalizeTextKey(item?.type),
            normalizeTextKey(item?.title),
            normalizeTextKey(item?.note || item?.text),
            item?._dateKey,
            String(item?.time || new Date(item?._sortTime || 0).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })),
            String(item?.energy ?? item?.patientEffort ?? ''),
            String(item?.score ?? ''),
          ].join('|');

      const previous = deduped.get(itemKey);
      if (!previous || Number(item?._sortTime || 0) >= Number(previous?._sortTime || 0)) {
        deduped.set(itemKey, item);
      }
    });

    return Array.from(deduped.values()).sort((a: any, b: any) => Number(b?._sortTime || 0) - Number(a?._sortTime || 0));
  }, [history, selectedSnapshotDate, isConventionalAdult]);

  const groupedHistory = filteredHistoryList.reduce((groups: any, item: any) => {
    const groupKey = item.dateGroup || formatHistoryDateLabel(item?._dateKey || getHistoryDateKey(item));
    const group = groups[groupKey] || [];
    group.push(item);
    group.sort((a: any, b: any) => Number(b?._sortTime || 0) - Number(a?._sortTime || 0));
    groups[groupKey] = group;
    return groups;
  }, {});
  const sortedDateKeys = Object.keys(groupedHistory).sort((a, b) => {
    const aKey = a === 'Hoje' ? toLocalDateKey(new Date()) : toLocalDateKey(a);
    const bKey = b === 'Hoje' ? toLocalDateKey(new Date()) : toLocalDateKey(b);
    return String(bKey || b).localeCompare(String(aKey || a));
  });
  const kidsTimelineHistory = useMemo(() => {
    return filteredHistoryList.filter((item: any) => item.type !== 'family_note' && item.type !== 'photo');
  }, [filteredHistoryList]);
  const groupedKidsTimeline = useMemo(() => {
    return kidsTimelineHistory.reduce((groups: any, item: any) => {
      const group = groups[item.dateGroup] || [];
      group.push(item);
      group.sort((a: any, b: any) => b.id - a.id);
      groups[item.dateGroup] = group;
      return groups;
    }, {});
  }, [kidsTimelineHistory]);
  const sortedKidsDateKeys = useMemo(() => {
    return Object.keys(groupedKidsTimeline).sort((a, b) => {
      if (a === "Hoje") return -1;
      if (b === "Hoje") return 1;
      if (a === "Ontem") return -1;
      if (b === "Ontem") return 1;
      return b.localeCompare(a);
    });
  }, [groupedKidsTimeline]);

  const patientSettingsModal = isSettingsOpen ? (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-slate-950/45 px-4 py-5 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: -18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -18, scale: 0.98 }}
        className="w-full max-w-lg overflow-hidden rounded-[30px] border border-white/70 bg-white shadow-2xl shadow-purple-500/20"
      >
        <div className="relative overflow-hidden bg-gradient-to-br from-[#7a32fc] via-[#8B5CF6] to-[#05CD99] px-6 py-5 text-white">
          <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/20 blur-2xl"></div>
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/75">Configurações</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight">Seu perfil na Verto</h2>
              <p className="mt-1 text-sm font-medium text-white/80">Atualize foto, nome, endereço e notificações do dispositivo.</p>
            </div>
            <button
              type="button"
              aria-label="Fechar configurações"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsSettingsOpen(false);
              }}
              className="relative z-30 inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-2xl bg-white/15 p-2 text-white transition hover:bg-white/25"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="max-h-[72vh] space-y-5 overflow-y-auto p-6">
          <div className="flex items-center gap-4">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[24px] border border-purple-100 bg-purple-50 shadow-inner">
              {profilePicture ? (
                <SecureImage src={profilePicture} alt="Foto do paciente" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[#7a32fc]">
                  <User size={34} />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-[#7a32fc]/10 px-4 py-2 text-sm font-bold text-[#7a32fc] transition hover:bg-[#7a32fc]/15">
                <Camera size={16} />
                Trocar foto
                <input type="file" accept="image/*" className="hidden" onChange={handleProfilePhotoChange} disabled={isSavingSettings} />
              </label>
              <p className="mt-2 text-xs font-medium text-slate-500">Use uma foto nítida, de até 2MB.</p>
            </div>
          </div>

          <div className="grid gap-4">
            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
                <User size={14} /> Nome exibido no portal
              </span>
              <input
                value={settingsForm.name}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#7a32fc] focus:bg-white"
                placeholder="Como deseja aparecer no portal"
              />
              <span className="mt-2 block text-xs font-semibold text-slate-400">
                Este nome aparece apenas no portal e nao altera o nome clinico cadastrado pela clinica.
              </span>
            </label>

            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
                <MapPin size={14} /> Endereço
              </span>
              <input
                value={settingsForm.address}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, address: e.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#7a32fc] focus:bg-white"
                placeholder="Rua, número, bairro e cidade"
              />
            </label>
          </div>

          <div className="rounded-3xl border border-emerald-100 bg-emerald-50/70 p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 rounded border-emerald-300 text-emerald-600 accent-emerald-500"
                checked={notificationStatus === 'granted' && notificationSubscriptionReady}
                disabled={isEnablingNotifications || notificationStatus === 'unsupported' || (notificationStatus === 'denied' && !notificationSubscriptionReady)}
                onChange={(event) => { void (event.currentTarget.checked ? enablePatientNotifications() : disablePatientNotifications()); }}
              />
              <span>
                <span className="flex items-center gap-2 text-sm font-black text-emerald-800">
                  <Bell size={16} /> Permitir notificações neste dispositivo
                </span>
                <span className="mt-1 block text-xs font-medium leading-relaxed text-emerald-700">
                  Use esta opção se você pulou ou não aprovou o aviso inicial. Se o navegador bloqueou, libere nas configurações do site.
                </span>
                {notificationStatus === 'denied' && (
                  <span role="alert" className="mt-2 block text-xs font-semibold text-red-700">
                    Bloqueadas pelo navegador: abra o ícone de cadeado ao lado do endereço, permita Notificações e retorne à Verto. Nenhum aviso push será recebido até essa alteração.
                  </span>
                )}
              </span>
            </label>
          </div>

          {settingsMessage && (
            <div className="rounded-2xl border border-purple-100 bg-purple-50 px-4 py-3 text-sm font-semibold text-purple-700">
              {settingsMessage}
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              onClick={() => setIsSettingsOpen(false)}
              className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-500 transition hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleSavePatientSettings}
              disabled={isSavingSettings}
              className="rounded-2xl bg-[#7a32fc] px-5 py-3 text-sm font-black text-white shadow-lg shadow-purple-500/25 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingSettings ? 'Salvando...' : 'Salvar configurações'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  ) : null;

  const portalMenuItems = [
    { id: 'home', label: 'Início', icon: Smile },
    ...(appointmentsPortalEnabled
      ? [{ id: 'appointments', label: isKidsProfile ? 'Calendário' : 'Sessões', icon: CalendarDays }]
      : []),
    ...(clinicalPortalEnabled
      ? [
          { id: 'anamnesis', label: 'Anamnese', icon: FileSignature },
          { id: 'notes', label: 'Anotações', icon: MessageCircle },
          { id: 'documents', label: 'Documentos', icon: BookOpen },
          { id: 'care-network', label: 'Rede de cuidado', icon: User },
          { id: 'reports', label: 'Relatório', icon: FileText },
        ]
      : []),
    { id: 'profile', label: 'Perfil', icon: Settings }
  ] as Array<{ id: PortalSection; label: string; icon: any }>;

  const portalMenu = null; // Kids e adultos usam o mesmo menu hambúrguer compartilhado.


  const portalAnamnesisTopNotice = (portalAnamnesisNeedsAction || (!portalAnamnesisChecked && hasPendingPortalAnamnesisHint)) ? (
    <button
      type="button"
      onClick={() => setPortalSection('anamnesis')}
      className="mb-4 flex w-full items-center justify-between gap-3 rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3 text-left shadow-sm transition hover:bg-amber-100"
    >
      <span className="min-w-0">
        <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-amber-600">Ficha de anamnese</span>
        <span className="mt-1 block text-sm font-black text-slate-900">
          {portalAnamnesisState.loading || (!portalAnamnesisChecked && hasPendingPortalAnamnesisHint)
            ? 'Carregando ficha solicitada...'
            : 'Preencha a ficha solicitada pela clínica'}
        </span>
      </span>
      <span className="shrink-0 rounded-2xl bg-white px-3 py-2 text-xs font-black text-amber-700">
        Preencher
      </span>
    </button>
  ) : null;

  const getPortalStatusPillClass = (status: any) => {
    const normalized = String(status || '').toUpperCase();
    if (normalized.includes('CONFIRM')) return 'bg-emerald-50 text-emerald-700';
    if (normalized.includes('CANCEL')) return 'bg-rose-50 text-rose-700';
    if (normalized.includes('RESCHEDULE')) return 'bg-amber-50 text-amber-700';
    if (normalized.includes('COMPLET') || normalized.includes('REALIZ')) return 'bg-blue-50 text-blue-700';
    if (normalized.includes('PEND')) return 'bg-slate-100 text-slate-600';
    return 'bg-purple-50 text-[#7a32fc]';
  };
  const getPortalStatusShortLabel = (status: any) => {
    const label = getPortalStatusLabel(status);
    const normalized = String(status || '').toUpperCase();
    if (normalized.includes('CONFIRM')) return 'Conf.';
    if (normalized.includes('RESCHEDULE')) return 'Remarc.';
    if (normalized.includes('CANCEL')) return 'Cancel.';
    if (normalized.includes('COMPLET') || normalized.includes('REALIZ')) return 'Realiz.';
    if (normalized.includes('PEND')) return 'Pend.';
    return label.slice(0, 7);
  };

  const formatPortalReminderDay = (value: any) => {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return '';
    const shortDate = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const diffDays = Math.round((targetStart - todayStart) / 86400000);
    if (diffDays === 0) return `${shortDate} (hoje)`;
    if (diffDays === 1) return `${shortDate} (amanhã)`;
    return shortDate;
  };

  const getPortalNotificationClinicName = (notification: any) => {
    const metadata = parsePortalMetadata(notification?.metadata);
    const professionalName = firstPortalText(
      metadata.professionalName,
      metadata.therapistName,
      metadata.professional,
      notification?.professionalName,
      notification?.professional_name,
      notification?.therapistName,
      notification?.therapist_name
    );
    return firstPortalClinicText(
      getPortalClinicNameExclusions(professionalName),
      metadata.clinicName,
      metadata.clinicLegalName,
      notification?.clinicName,
      notification?.clinic_name,
      portalContext?.clinicName,
      portalContext?.clinicLegalName,
      user?.clinicSettings?.clinicName,
      user?.workspaceName,
      user?.clinicName,
      'Clínica'
    );
  };

  const getPortalNotificationMessage = (notification: any) => {
    const metadata = parsePortalMetadata(notification?.metadata);
    const canRequestReschedule = metadata?.allowedActions?.canRequestReschedule !== false;
    const notificationType = normalizePortalLower(notification?.type).replace(/_(24h|12h)$/i, '');
    if (notificationType && notificationType !== 'appointment_reminder') {
      return firstPortalText(notification?.message) || 'Atualização da sua sessão disponível.';
    }
    const scheduledAt = firstPortalText(
      metadata.scheduledAt,
      notification?.scheduled_for,
      notification?.scheduledFor,
      notification?.scheduledAt,
      notification?.scheduled_at
    );
    const patientName = firstPortalPatientName(
      notification?.patientName,
      notification?.patient_name,
      metadata.patientName,
      metadata.patient_name,
      portalContext?.portalDisplayName,
      portalContext?.patientName,
      displayName,
      user?.name
    );
    const dayText = formatPortalReminderDay(scheduledAt);
    const timeText = formatPortalTime(scheduledAt);
    const whenText = [dayText ? `dia ${dayText}` : '', timeText ? `às ${timeText}` : ''].filter(Boolean).join(' ');
    const actionCopy = canRequestReschedule
      ? 'Toque aqui para confirmar, cancelar ou solicitar reagendamento.'
      : 'Toque aqui para confirmar ou cancelar a sessão.';
    if (whenText) {
      return `Lembrete de sessão de ${patientName} ${whenText}. ${actionCopy}`;
    }
    return firstPortalText(notification?.message) || `Lembrete de sessão de ${patientName}. ${actionCopy}`;
  };

  const portalNotificationsSummary = !portalNotificationsLoaded ? (
    <div className="mb-4 h-20 animate-pulse rounded-[24px] border border-slate-100 bg-white/70" />
  ) : portalNotifications.length > 0 ? (
    <div className="mb-4 space-y-2">
      {portalNotifications.slice(0, 3).map((notification: any) => {
        const metadata = parsePortalMetadata(notification?.metadata);
        const logoUrl = firstPortalLogoUrl(
          metadata.clinicLogoUrl,
          notification?.clinicLogoUrl,
          notification?.clinic_logo_url,
          portalContext?.clinicLogoUrl,
          user?.clinicSettings?.clinicLogoUrl
        );
        const clinicName = getPortalNotificationClinicName(notification);
        const message = getPortalNotificationMessage(notification);
        return (
          <button
            key={notification.id}
            type="button"
            onClick={() => void openPortalNotification(notification)}
            className={`flex w-full items-start gap-3 rounded-[24px] border px-4 py-3 text-left shadow-sm transition ${
              notification.read_at
                ? 'border-slate-100 bg-white/75'
                : 'border-purple-100 bg-purple-50'
            }`}
          >
            <span className="mt-0.5 h-10 w-10 shrink-0 overflow-hidden rounded-2xl border border-white bg-white shadow-sm">
              {renderPortalClinicLogo(logoUrl, clinicName)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-slate-800">{clinicName}</span>
              <span className="block text-sm font-medium leading-relaxed text-slate-700">
                {message}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  ) : null;

  const patientNotificationActivationCard = appointmentsPortalEnabled && notificationStatus !== 'unsupported' && !notificationSubscriptionReady ? (
    <button
      type="button"
      onClick={() => {
        if (notificationStatus === 'denied') {
          setSettingsMessage('As notificações estão bloqueadas neste navegador. Abra as permissões do site pelo ícone de cadeado, permita Notificações e depois retorne à Verto.');
          setIsSettingsOpen(true);
          return;
        }
        void enablePatientNotifications();
      }}
      disabled={isEnablingNotifications}
      className="mb-4 flex w-full items-center gap-3 rounded-[22px] border border-violet-100 bg-violet-50/90 px-4 py-3 text-left shadow-sm disabled:opacity-60"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white text-[#7a32fc] shadow-sm"><Bell size={17}/></span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-black text-slate-800">{notificationStatus === 'denied' ? 'Notificações bloqueadas neste aparelho' : 'Ativar notificações da clínica'}</span>
        <span className="mt-0.5 block text-[11px] font-medium leading-relaxed text-slate-500">{notificationStatus === 'denied' ? 'Abra as configurações para permitir avisos e lembretes.' : 'Receba avisos e lembretes mesmo com a Verto fechada.'}</span>
      </span>
    </button>
  ) : null;

  const portalHomeSummary = (
    <React.Fragment>
      {clinicalPortalEnabled && portalAnamnesisTopNotice}
      {patientNotificationActivationCard}
      {appointmentsPortalEnabled && portalNotificationsSummary}
      {!isKidsProfile && clinicalPortalEnabled && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => setPortalSection('tasks')} className="rounded-[24px] border border-emerald-100 bg-white p-4 text-left shadow-sm transition hover:bg-emerald-50">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-600">Tarefas</p>
            <p className="mt-2 text-sm font-black text-slate-900">{visiblePatientTasks?.length || 0} pendente(s)</p>
          </button>
        </div>
      )}
    </React.Fragment>
  );

  const renderPortalAnamnesisField = (question: any) => {
    const value = portalAnamnesisDraft?.[question.id] ?? '';
    const prefilledKeys = new Set(Array.isArray(portalAnamnesis?.prefilledKeys) ? portalAnamnesis.prefilledKeys : []);
    const prefilledValue = portalAnamnesis?.prefillAnswers?.[question.id];
    const isPrefilledByClinic =
      prefilledKeys.has(question.id) &&
      prefilledValue !== null &&
      prefilledValue !== undefined &&
      String(prefilledValue).trim() !== '';
    const fieldDisabled = portalAnamnesisLocked || isPrefilledByClinic || portalAnamnesisState.saving;
    const fieldClass = "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-[#7a32fc] disabled:bg-slate-50 disabled:text-slate-400";
    const update = (nextValue: any) => {
      portalAnamnesisDraftDirtyRef.current = true;
      setPortalAnamnesisDraft((prev) => ({ ...prev, [question.id]: nextValue }));
    };
    if (question.type === 'data') return <input type="date" disabled={fieldDisabled} className={fieldClass} value={value || ''} onChange={(event) => update(event.target.value)} />;
    if (question.type === 'numero') return <input type="number" disabled={fieldDisabled} className={fieldClass} value={value || ''} onChange={(event) => update(event.target.value)} />;
    if (question.type === 'telefone') return <input type="tel" disabled={fieldDisabled} className={fieldClass} value={value || ''} onChange={(event) => update(event.target.value)} />;
    if (question.type === 'sim_nao') {
      return (
        <select disabled={fieldDisabled} className={fieldClass} value={value === '' ? '' : value ? 'sim' : 'nao'} onChange={(event) => update(event.target.value ? event.target.value === 'sim' : '')}>
          <option value="">Selecione...</option>
          <option value="sim">Sim</option>
          <option value="nao">Não</option>
        </select>
      );
    }
    if (question.type === 'multipla_escolha') {
      return (
        <select disabled={fieldDisabled} className={fieldClass} value={value || ''} onChange={(event) => update(event.target.value)}>
          <option value="">Selecione...</option>
          {(question.options || []).map((option: string) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }
    if (question.type === 'multipla_selecao') {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {(question.options || []).map((option: string) => (
            <label key={option} className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm font-semibold text-slate-600">
              <input type="checkbox" disabled={fieldDisabled} checked={selected.includes(option)} onChange={(event) => update(event.target.checked ? [...selected, option] : selected.filter((item: string) => item !== option))} />
              {option}
            </label>
          ))}
        </div>
      );
    }
    return <textarea disabled={fieldDisabled} rows={3} className={`${fieldClass} resize-none`} value={value || ''} onChange={(event) => update(event.target.value)} />;
  };

  const savePortalAnamnesisDraft = async () => {
    const patientId = String(portalPatientId || '');
    const requestId = String(portalAnamnesis?.request?.id || '');
    if (!patientId || !requestId || portalAnamnesisLocked || portalAnamnesisMutationRef.current) return;
    const contextKey = portalAnamnesisContextKey;
    const ticket = { patientId, requestId };
    portalAnamnesisMutationRef.current = ticket;
    // Invalidate any GET started before this write, so it cannot unlock inputs mid-save.
    portalAnamnesisRequestRef.current += 1;
    setPortalAnamnesisState((prev) => ({ ...prev, saving: true, error: '', message: '' }));
    try {
      const result = await dataService.savePortalAnamnesisDraft(patientId, portalAnamnesisDraft, requestId);
      // An older patient/clinic session cannot clear or overwrite the new portal's draft.
      if (portalAnamnesisMutationRef.current !== ticket || portalAnamnesisContextRef.current !== contextKey) return;
      if (result?.success !== true) {
        setPortalAnamnesisState({ loading: false, saving: false, message: '', error: result?.error || 'Não foi possível salvar o rascunho.' });
        return;
      }
      portalAnamnesisDraftDirtyRef.current = false;
      await loadPortalAnamnesis();
      if (portalAnamnesisMutationRef.current === ticket) {
        setPortalAnamnesisState((prev) => prev.error ? prev : { ...prev, message: 'Rascunho salvo.' });
      }
    } catch {
      if (portalAnamnesisMutationRef.current === ticket) {
        setPortalAnamnesisState({ loading: false, saving: false, message: '', error: 'Não foi possível salvar o rascunho.' });
      }
    } finally {
      if (portalAnamnesisMutationRef.current === ticket) portalAnamnesisMutationRef.current = null;
    }
  };

  const submitPortalAnamnesis = async () => {
    const patientId = String(portalPatientId || '');
    const requestId = String(portalAnamnesis?.request?.id || '');
    if (!patientId || !requestId || portalAnamnesisLocked || portalAnamnesisMutationRef.current) return;
    const confirmed = window.confirm('Enviar a ficha para a clínica? Após o envio, novas edições dependem de uma nova solicitação.');
    if (!confirmed) return;
    const contextKey = portalAnamnesisContextKey;
    const ticket = { patientId, requestId };
    portalAnamnesisMutationRef.current = ticket;
    // Invalidate any GET started before this write, so it cannot unlock inputs mid-save.
    portalAnamnesisRequestRef.current += 1;
    setPortalAnamnesisState((prev) => ({ ...prev, saving: true, error: '', message: '' }));
    try {
      const result = await dataService.submitPortalAnamnesis(patientId, portalAnamnesisDraft, requestId);
      if (portalAnamnesisMutationRef.current !== ticket || portalAnamnesisContextRef.current !== contextKey) return;
      if (result?.success !== true) {
        setPortalAnamnesisState({ loading: false, saving: false, message: '', error: result?.error || 'Não foi possível enviar a ficha.' });
        return;
      }
      portalAnamnesisDraftDirtyRef.current = false;
      await loadPortalAnamnesis();
      if (portalAnamnesisMutationRef.current === ticket) {
        setPortalAnamnesisState((prev) => prev.error ? prev : { ...prev, message: result?.message || 'Ficha enviada para a clínica.' });
      }
    } catch {
      if (portalAnamnesisMutationRef.current === ticket) {
        setPortalAnamnesisState({ loading: false, saving: false, message: '', error: 'Não foi possível enviar a ficha.' });
      }
    } finally {
      if (portalAnamnesisMutationRef.current === ticket) portalAnamnesisMutationRef.current = null;
    }
  };

  const portalPlaceholderPanel = (label: string) => (
    <div className="mb-6 rounded-[28px] border border-dashed border-purple-100 bg-white/70 p-6 text-center text-sm font-semibold text-slate-500">
      {label}
    </div>
  );


  const portalTasksPanel = (
    <div className="mb-6 rounded-[28px] border border-emerald-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-600">Tarefas</p>
          <h2 className="text-lg font-black text-slate-900">Atividades pendentes</h2>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black text-emerald-700">{visiblePatientTasks.length}</span>
      </div>
      {visiblePatientTasks.length === 0 ? (
        <p className="rounded-2xl bg-slate-50 px-4 py-5 text-center text-sm font-semibold text-slate-500">Nenhuma tarefa pendente no momento.</p>
      ) : (
        <div className="space-y-3">
          {visiblePatientTasks.map((task: any) => {
            const scheduledAt = parseScheduledTaskDate(task?.scheduledAt || task?.scheduled_at);
            const taskData = task?.task_data && typeof task.task_data === 'object' ? task.task_data : {};
            const clinicalPath = [
              taskData?.planName || taskData?.therapeuticPlanName,
              taskData?.domainName,
              taskData?.programName,
              taskData?.targetName || taskData?.clinicalTargetName,
            ].map((value: any) => String(value || '').trim()).filter(Boolean);
            return (
              <button
                key={String(task?.id || task?.assignedTaskId || task?.title)}
                type="button"
                disabled={isReadOnlyMode}
                onClick={() => { openTaskModal(task); setPortalSection('home'); }}
                className="w-full rounded-2xl border border-slate-100 bg-slate-50 p-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50 disabled:opacity-60"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-slate-900">{task?.title || task?.task_data?.title || 'Tarefa'}</p>
                    {clinicalPath.length > 0 && <p className="mt-1 line-clamp-2 text-[10px] font-bold text-violet-600">{clinicalPath.join(' → ')}</p>}
                    <p className="mt-1 text-xs font-medium text-slate-500">{scheduledAt ? scheduledAt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Disponível agora'}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const portalAnamnesisPanel = portalAnamnesisState.loading
    ? portalPlaceholderPanel('Carregando ficha de anamnese...')
    : hasPortalAnamnesis ? (() => {
    const template = normalizeAnamnesisTemplate(portalAnamnesis?.template || getDefaultAnamnesisTemplate());
    const profile = getProfileTemplate(template, portalAnamnesis?.profileType === 'child' ? 'child' : isKidsProfile ? 'child' : 'adult');
    return (
      <div className="mb-6 rounded-[28px] border border-purple-100 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#7a32fc]">Ficha de anamnese</p>
            <h2 className="text-lg font-black text-slate-900">{portalAnamnesisStatusLabel}</h2>
          </div>
          <span className="rounded-full bg-purple-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#7a32fc]">
            {portalAnamnesisLocked ? 'Edição bloqueada' : 'Rascunho disponível'}
          </span>
        </div>
        {portalAnamnesisState.error && <div className="mb-3 rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{portalAnamnesisState.error}</div>}
        {portalAnamnesisState.message && <div className="mb-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{portalAnamnesisState.message}</div>}
        <div className="space-y-3">
          {profile.sections.filter((section: any) => section.active !== false).map((section: any) => {
            const questions = profile.questions.filter((question: any) => question.active !== false && question.sectionId === section.id).sort((a: any, b: any) => a.order - b.order);
            if (!questions.length) return null;
            const expanded = expandedAnamnesisSections[section.id] !== false;
            return (
              <div key={section.id} className="rounded-3xl border border-slate-100 bg-slate-50/60 p-3">
                <button type="button" onClick={() => setExpandedAnamnesisSections((prev) => ({ ...prev, [section.id]: !expanded }))} className="flex w-full items-center justify-between gap-3 px-1 py-1 text-left">
                  <span className="text-sm font-black text-slate-800">{section.title}</span>
                  <ChevronDown size={16} className={`text-slate-400 transition ${expanded ? 'rotate-180' : ''}`} />
                </button>
                {expanded && (
                  <div className="mt-3 grid gap-3">
                    {questions.map((question: any) => (
                      <label key={question.id} className="block rounded-2xl bg-white p-3 shadow-sm">
                        <span className="mb-2 flex flex-wrap items-center gap-2 text-xs font-black text-slate-600">
                          <span>{question.label}{question.required ? <span className="text-rose-500"> *</span> : null}</span>
                          {portalAnamnesis?.prefilledKeys?.includes(question.id) && String(portalAnamnesis?.prefillAnswers?.[question.id] ?? '').trim() ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-500">Preenchido pela clínica</span>
                          ) : null}
                        </span>
                        {renderPortalAnamnesisField(question)}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {!portalAnamnesisLocked && (
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button type="button" disabled={portalAnamnesisState.saving} onClick={() => void savePortalAnamnesisDraft()} className="rounded-2xl border border-purple-100 px-4 py-3 text-sm font-black text-[#7a32fc] disabled:opacity-60">Salvar rascunho</button>
            <button type="button" disabled={portalAnamnesisState.saving} onClick={() => void submitPortalAnamnesis()} className="rounded-2xl bg-[#7a32fc] px-4 py-3 text-sm font-black text-white shadow-lg shadow-purple-500/20 disabled:opacity-60">Enviar para a clínica</button>
          </div>
        )}
      </div>
    );
  })() : portalPlaceholderPanel('Nenhuma ficha de anamnese liberada para preenchimento agora.');

  const saveFamilyAnnotation = async () => {
    const text = familyAnnotation.trim();
    if (!text || familyAnnotationInFlightRef.current || isReadOnlyMode) return;
    if (!portalPatientId) {
      setFamilyAnnotationState({ saving: false, message: '', error: 'Não encontramos um paciente vinculado a este acesso. Entre em contato com a clínica.' });
      return;
    }
    familyAnnotationInFlightRef.current = true;
    setFamilyAnnotationState({ saving: true, message: '', error: '' });
    try {
      const result = await onAddFamilyNote(portalPatientId, text, undefined, undefined, 'note');
      if (result?.success !== true) {
        setFamilyAnnotationState({ saving: false, message: '', error: result?.error || 'Não foi possível confirmar a gravação da anotação.' });
        return;
      }
      setFamilyAnnotation('');
      setFamilyAnnotationState({
        saving: false,
        message: result?.pending === true || result?.offline === true
          ? 'Anotação salva neste dispositivo e aguardando sincronização.'
          : 'Anotação enviada para a equipe.',
        error: ''
      });
    } catch (error: any) {
      setFamilyAnnotationState({ saving: false, message: '', error: error?.message || 'Não foi possível salvar a anotação.' });
    } finally {
      familyAnnotationInFlightRef.current = false;
    }
  };

  const openPortalPatientFile = async (document: any) => {
    const fileId = firstPortalText(document?.patientFileId, document?.key);
    if (!portalPatientId || !fileId) return;
    const result = await dataService.accessPatientFile(portalPatientId, fileId, 'view');
    const url = result?.success ? firstPortalText(result?.data?.signedUrl, result?.data?.url, result?.data?.content) : '';
    if (!url) {
      setPortalFileState((current) => ({ ...current, error: result?.error || 'Não foi possível abrir o documento com auditoria.' }));
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const loadPortalPatientFiles = async () => {
    if (!portalPatientId) {
      setPortalPatientFilesLoaded(true);
      return;
    }
    const requestId = ++portalFilesRequestRef.current;
    const result = await dataService.getPatientFiles(portalPatientId);
    if (requestId !== portalFilesRequestRef.current) return;
    if (result?.success) {
      setPortalPatientFiles(Array.isArray(result.data) ? result.data : []);
      setPortalFileState((current) => ({ ...current, error: '' }));
    } else {
      setPortalFileState((current) => ({ ...current, error: result?.error || 'Não foi possível carregar os documentos.' }));
    }
    setPortalPatientFilesLoaded(true);
  };

  useEffect(() => {
    portalFilesRequestRef.current += 1;
    setPortalPatientFiles([]);
    setPortalPatientFilesLoaded(false);
    setPortalFileState({ uploading: false, error: '', message: '' });
  }, [portalPatientId, user?.email]);

  useEffect(() => {
    if (portalSection !== 'documents' || portalPatientFilesLoaded) return;
    void loadPortalPatientFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalSection, portalPatientFilesLoaded, portalPatientId]);

  const uploadPortalPatientFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || portalFileState.uploading || isReadOnlyMode) return;
    if (file.size > 10 * 1024 * 1024) {
      setPortalFileState({ uploading: false, error: 'O arquivo deve ter no máximo 10 MB.', message: '' });
      return;
    }
    setPortalFileState({ uploading: true, error: '', message: '' });
    if (!portalPatientId) {
      setPortalFileState({ uploading: false, error: 'Não encontramos um paciente vinculado a este acesso. Entre em contato com a clínica.', message: '' });
      return;
    }
    const result = await dataService.uploadPatientFile(portalPatientId, {
      fileBlob: file,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      source: 'family_portal_document'
    });
    if (!result?.success) {
      setPortalFileState({ uploading: false, error: result?.error || 'Não foi possível enviar o documento.', message: '' });
      return;
    }
    setPortalFileState({ uploading: false, error: '', message: 'Documento enviado com segurança.' });
    setPortalPatientFilesLoaded(false);
  };

  const portalNotesPanel = (
    <div className="mb-6 rounded-[28px] border border-purple-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#7a32fc]">Anotações</p>
        <h2 className="text-lg font-black text-slate-900">Compartilhadas com a família</h2>
      </div>
      {!isReadOnlyMode && (
        <div className="mb-4 rounded-2xl border border-purple-100 bg-purple-50/50 p-3">
          <label className="text-xs font-black text-slate-700" htmlFor="family-annotation">Enviar observação para a equipe</label>
          <textarea
            id="family-annotation"
            value={familyAnnotation}
            onChange={(event) => setFamilyAnnotation(event.target.value)}
            maxLength={4000}
            className="mt-2 min-h-24 w-full resize-y rounded-2xl border border-white bg-white p-3 text-sm text-slate-700 outline-none focus:border-purple-300"
            placeholder="Escreva uma observação simples sobre o paciente."
          />
          {familyAnnotationState.error && <p className="mt-2 text-xs font-bold text-rose-600">{familyAnnotationState.error}</p>}
          {familyAnnotationState.message && <p className="mt-2 text-xs font-bold text-emerald-700">{familyAnnotationState.message}</p>}
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={!familyAnnotation.trim() || familyAnnotationState.saving}
              onClick={() => void saveFamilyAnnotation()}
              className="rounded-xl bg-[#7a32fc] px-4 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {familyAnnotationState.saving ? 'Enviando...' : 'Enviar anotação'}
            </button>
          </div>
        </div>
      )}
      {portalSharedNotes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-purple-100 bg-purple-50/60 px-4 py-5 text-center text-sm font-semibold text-purple-700">
          Nenhuma anotação compartilhada pela clínica até agora.
        </div>
      ) : (
        <div className="space-y-2">
          {portalSharedNotes.map((note: any, index: number) => (
            <article key={note?.id || `${note?.date || note?.created_at || 'note'}-${index}`} className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                {formatDiaryTimestamp(note?.date || note?.created_at)}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-relaxed text-slate-700">
                {firstPortalText(note?.text, note?.note, note?.content, note?.message) || 'Anotação compartilhada.'}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );

  const portalDocumentsPanel = (
    <div className="mb-6 rounded-[28px] border border-purple-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#7a32fc]">Documentos</p>
          <h2 className="text-lg font-black text-slate-900">Compartilhados com a família</h2>
        </div>
        {!isReadOnlyMode && portalPatientId && (
          <label className="cursor-pointer rounded-xl bg-[#7a32fc] px-4 py-2 text-xs font-black text-white">
            {portalFileState.uploading ? 'Enviando...' : 'Enviar arquivo'}
            {!portalFileState.uploading && (
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={uploadPortalPatientFile} />
            )}
          </label>
        )}
      </div>
      {portalFileState.error && <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{portalFileState.error}</p>}
      {portalFileState.message && <p className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{portalFileState.message}</p>}
      {!portalPatientFilesLoaded ? (
        <div className="h-20 animate-pulse rounded-2xl bg-purple-50" />
      ) : visiblePortalDocuments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-purple-100 bg-purple-50/60 px-4 py-5 text-center text-sm font-semibold text-purple-700">
          Nenhum documento liberado para o portal neste momento.
        </div>
      ) : (
        <div className="space-y-2">
          {visiblePortalDocuments.map((document: any, index: number) => (
            <div key={document.key || `${document.name}-${index}`} className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-900">{document.name}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {document.category}{document.createdAt ? ` · ${formatPortalDate(document.createdAt)}` : ''}
                  </p>
                </div>
                {document.auditedAccess && document.patientFileId ? (
                  <button type="button" onClick={() => void openPortalPatientFile(document)} className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#7a32fc]">
                    Abrir
                  </button>
                ) : document.href ? (
                  <a href={document.href} target="_blank" rel="noreferrer" className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#7a32fc]">
                    Abrir
                  </a>
                ) : (
                  <span className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">
                    Liberado
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const portalCareNetworkPanel = (
    <PatientCareNetworkPanel
      mode="patient"
      patientId={portalPatientId}
      readOnly={isReadOnlyMode}
    />
  );

  const portalReportPanel = (
    <div className="mb-6 rounded-[28px] border border-purple-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#7a32fc]">Relatório</p>
          <h2 className="text-lg font-black text-slate-900">Tempo em sessão</h2>
        </div>
        <span className="rounded-full bg-purple-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#7a32fc]">
          Total {formatPortalDuration(portalReportTotalMinutes)}
        </span>
      </div>
      {portalAppointmentsState.loading || !portalAppointmentsLoaded ? (
        <div className="rounded-2xl bg-purple-50 px-4 py-3 text-sm font-semibold text-purple-700">Carregando relatório...</div>
      ) : portalReportRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-purple-100 bg-purple-50/60 px-4 py-5 text-center text-sm font-semibold text-purple-700">
          Nenhuma sessão realizada com duração registrada no período.
        </div>
      ) : (
        <div className="space-y-2">
          {portalReportRows.map((row: any, index: number) => {
            const appointment = row.appointment;
            return (
              <div key={appointment?.id || `${appointment?.scheduledAt || 'report'}-${index}`} className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900">{formatPortalDate(appointment?.scheduledAt)} · {formatPortalTime(appointment?.scheduledAt)}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      {appointment?.serviceType || 'Sessão'} · {appointment?.professionalName || 'Equipe'}
                    </p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{row.statusLabel}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-black text-slate-700">
                    {formatPortalDuration(row.minutes)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const portalProfilePanel = (
    <div className="mb-6 rounded-[28px] border border-purple-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#7a32fc]">Perfil</p>
          <h2 className="text-lg font-black text-slate-900">{displayName}</h2>
        </div>
        <button
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          className="rounded-xl border border-purple-100 px-3 py-2 text-xs font-black text-[#7a32fc]"
        >
          Editar perfil e notificações
        </button>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <dt className="text-[10px] font-black uppercase tracking-wider text-slate-400">E-mail da conta</dt>
          <dd className="mt-1 break-words font-bold text-slate-700">{user?.email || 'Não informado'}</dd>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <dt className="text-[10px] font-black uppercase tracking-wider text-slate-400">Endereço</dt>
          <dd className="mt-1 font-bold text-slate-700">{settingsForm.address || 'Não informado'}</dd>
        </div>
      </dl>
    </div>
  );

  const portalCalendarMonthLabel = portalCalendarMonth.toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric'
  });
  const portalMiniCalendarWeekdays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const getPortalAppointmentDateKey = (appointment: any) =>
    toLocalDateKey(appointment?.scheduledAt || appointment?.scheduled_at || appointment?.date);
  const portalMonthAppointments = useMemo(() => {
    const monthPrefix = `${portalCalendarMonth.getFullYear()}-${String(portalCalendarMonth.getMonth() + 1).padStart(2, '0')}`;
    return portalAppointments
      .filter((appointment: any) => getPortalAppointmentDateKey(appointment).startsWith(monthPrefix))
      .sort((a: any, b: any) => new Date(a?.scheduledAt || a?.scheduled_at || 0).getTime() - new Date(b?.scheduledAt || b?.scheduled_at || 0).getTime());
  }, [portalAppointments, portalCalendarMonth]);
  const portalCalendarCells = useMemo(() => {
    const year = portalCalendarMonth.getFullYear();
    const month = portalCalendarMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = Array.from({ length: firstDay }, () => ({ day: null as number | null, dateKey: '', appointments: [] as any[] }));
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = toLocalDateKey(new Date(year, month, day));
      cells.push({
        day,
        dateKey,
        appointments: portalMonthAppointments.filter((appointment: any) => getPortalAppointmentDateKey(appointment) === dateKey)
      });
    }
    return cells;
  }, [portalCalendarMonth, portalMonthAppointments]);
  const selectedPortalCalendarAppointments = useMemo(() => {
    if (!selectedPortalCalendarDateKey) return [];
    return portalMonthAppointments.filter((appointment: any) => getPortalAppointmentDateKey(appointment) === selectedPortalCalendarDateKey);
  }, [portalMonthAppointments, selectedPortalCalendarDateKey]);
  const selectedPortalCalendarLabel = selectedPortalCalendarDateKey
    ? (() => {
        const date = new Date(`${selectedPortalCalendarDateKey}T12:00:00`);
        return Number.isNaN(date.getTime())
          ? ''
          : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
      })()
    : '';
  const handlePortalCalendarDayClick = (cell: { day: number | null; dateKey: string; appointments: any[] }) => {
    if (!cell.day || cell.appointments.length === 0) return;
    setSelectedPortalCalendarDateKey(cell.dateKey);
    if (cell.appointments.length === 1) {
      void openPortalAppointmentDetail(cell.appointments[0]);
    }
  };
  const changePortalCalendarMonth = (direction: -1 | 1) => {
    setPortalCalendarMonth((previous) => {
      const next = new Date(previous);
      next.setMonth(next.getMonth() + direction);
      return next;
    });
    setSelectedPortalCalendarDateKey('');
  };
  const detailedPortalAppointment = portalAppointmentDetail?.appointment;
  const activePortalAppointment = detailedPortalAppointment
    ? {
        ...(selectedPortalAppointment || {}),
        ...detailedPortalAppointment,
        clinicName: firstPortalText(detailedPortalAppointment?.clinicName, selectedPortalAppointment?.clinicName),
        clinicLogoUrl: firstPortalLogoUrl(
          detailedPortalAppointment?.clinicLogoUrl,
          detailedPortalAppointment?.clinic_logo_url,
          selectedPortalAppointment?.clinicLogoUrl,
          selectedPortalAppointment?.clinic_logo_url,
        ),
      }
    : selectedPortalAppointment;
  const activePortalStatus = String(activePortalAppointment?.status || '').toUpperCase();
  const activePortalDisplayStatus = String(resolveAppointmentPatientDisplayStatus(activePortalAppointment)).toUpperCase();
  const activePortalConfirmed = activePortalDisplayStatus.includes('CONFIRM');
  const activePortalProfessionalName = firstPortalText(
    activePortalAppointment?.professionalName,
    activePortalAppointment?.professional_name,
    activePortalAppointment?.therapistName,
    activePortalAppointment?.therapist_name
  );
  const activePortalClinicName = firstPortalClinicText(
    getPortalClinicNameExclusions(activePortalProfessionalName),
    activePortalAppointment?.clinicName,
    activePortalAppointment?.clinic?.displayName,
    activePortalAppointment?.clinic?.name,
    activePortalAppointment?.clinic_name,
    portalContext?.clinicName,
    portalContext?.clinicLegalName,
    user?.clinicSettings?.clinicName,
    user?.workspaceName,
    user?.clinicName,
    'Clínica'
  );
  const activePortalClinicLogoUrl = firstPortalLogoUrl(
    activePortalAppointment?.clinicLogoUrl,
    activePortalAppointment?.clinic?.logoUrl,
    activePortalAppointment?.clinic_logo_url,
    portalContext?.clinicLogoUrl,
    user?.clinicSettings?.clinicLogoUrl
  );
  const portalActionBlocked = activePortalStatus.includes('CANCEL') || activePortalStatus.includes('COMPLET') || activePortalStatus.includes('NO_SHOW');
  const activePortalCanRequestReschedule =
    activePortalAppointment?.allowedActions?.canRequestReschedule !== false &&
    activePortalAppointment?.allowPatientReschedule !== false;
  const portalAppointmentsPanel = (
    <div className="mb-6 rounded-[28px] border border-purple-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Mini calendário</p>
          <h2 className="text-lg font-black text-slate-900">Minhas sessões</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">Toque em um dia marcado para abrir a sessão.</p>
        </div>
        <button type="button" onClick={() => void loadPortalAppointments(getPortalCalendarMonthRange(portalCalendarMonth))} className="rounded-2xl border border-purple-100 px-3 py-2 text-xs font-bold text-[#7a32fc]" aria-label="Atualizar sessões">
          Atualizar
        </button>
      </div>
      <div className="mb-4 flex items-center justify-between gap-3 px-1">
        <button type="button" onClick={() => changePortalCalendarMonth(-1)} className="rounded-2xl p-2 text-slate-600 transition hover:bg-purple-50" aria-label="Mês anterior">
          <ChevronLeft size={18} />
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold capitalize text-slate-900">{portalCalendarMonthLabel}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Próximos agendamentos do paciente</p>
        </div>
        <button type="button" onClick={() => changePortalCalendarMonth(1)} className="rounded-2xl p-2 text-slate-600 transition hover:bg-purple-50" aria-label="Próximo mês">
          <ChevronRight size={18} />
        </button>
      </div>
      {portalAppointmentsState.message && (
        <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
          {portalAppointmentsState.message}
        </div>
      )}
      {portalAppointmentsState.loading || !portalAppointmentsLoaded ? (
        <div className="rounded-2xl bg-purple-50 px-4 py-3 text-sm font-semibold text-purple-700">Carregando sessões...</div>
      ) : portalAppointmentsState.error ? (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{portalAppointmentsState.error}</div>
      ) : portalMonthAppointments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-purple-100 bg-purple-50/60 px-4 py-5 text-center text-sm font-semibold text-purple-700">
          Nenhuma sessão encontrada neste mês.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-7 gap-y-3 text-center text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">
            {portalMiniCalendarWeekdays.map((day, index) => <div key={`${day}-${index}`}>{day}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-y-2 text-center">
            {portalCalendarCells.map((cell, index) => (
              <div
                key={cell.dateKey || `empty-${index}`}
                className="flex min-h-[38px] items-center justify-center"
              >
                {cell.day ? (
                  <button
                    type="button"
                    onClick={() => handlePortalCalendarDayClick(cell)}
                    disabled={cell.appointments.length === 0}
                    className={`relative flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#7a32fc]/40 disabled:cursor-default ${
                      selectedPortalCalendarDateKey === cell.dateKey
                        ? 'bg-[#7a32fc] text-white shadow-lg shadow-purple-500/30'
                        : cell.dateKey === toLocalDateKey(new Date())
                          ? 'bg-purple-50 text-[#7a32fc]'
                          : cell.appointments.length > 0
                            ? 'text-slate-800 hover:bg-purple-50'
                            : 'text-slate-600'
                    }`}
                    aria-label={cell.appointments.length > 0 ? `Abrir sessão de ${cell.day}` : `Dia ${cell.day} sem sessão`}
                  >
                    {cell.day}
                    {cell.appointments.length > 0 && (
                      <span className={`absolute bottom-1 h-1.5 w-1.5 rounded-full ${selectedPortalCalendarDateKey === cell.dateKey ? 'bg-white' : 'bg-[#7a32fc]'}`} />
                    )}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {selectedPortalCalendarDateKey && selectedPortalCalendarAppointments.length > 1 && (
            <div className="rounded-3xl border border-purple-100 bg-purple-50/60 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Sessões de {selectedPortalCalendarLabel}</p>
              <div className="space-y-2">
                {selectedPortalCalendarAppointments.map((appointment: any) => (
                  <button
                    type="button"
                    key={appointment.id}
                    onClick={() => void openPortalAppointmentDetail(appointment)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white px-3 py-2 text-left shadow-sm transition hover:bg-purple-50"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900">{formatPortalTime(appointment.scheduledAt)}</span>
                      <span className="block truncate text-xs font-semibold text-slate-500">{appointment.serviceType || 'Sessão'}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${getPortalStatusPillClass(resolveAppointmentPatientDisplayStatus(appointment))}`}>
                      {getPortalStatusShortLabel(resolveAppointmentPatientDisplayStatus(appointment))}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {selectedPortalCalendarDateKey && selectedPortalCalendarAppointments.length === 0 && (
            <div className="rounded-2xl border border-dashed border-purple-100 bg-purple-50/60 px-4 py-4 text-center text-sm font-semibold text-purple-700">
              Nenhuma sessão neste dia.
            </div>
          )}
        </div>
      )}
    </div>
  );

  const portalAppointmentDetailModal = selectedPortalAppointment ? (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => { setSelectedPortalAppointment(null); setPortalAppointmentDetail(null); }}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-2xl border border-purple-100 bg-white shadow-sm">
              {renderPortalClinicLogo(activePortalClinicLogoUrl, activePortalClinicName)}
            </div>
            <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-700">{activePortalClinicName}</p>
            <p className="text-xs font-medium text-[#7a32fc]">Detalhes da sessão</p>
            <h3 className="mt-1 text-xl font-semibold text-slate-900">{firstPortalPatientName(activePortalAppointment?.patientName)}</h3>
            <p className="mt-1 text-sm font-medium text-slate-500">{formatPortalDateTime(activePortalAppointment?.scheduledAt)}</p>
            </div>
          </div>
          <button type="button" onClick={() => { setSelectedPortalAppointment(null); setPortalAppointmentDetail(null); }} className="rounded-2xl border border-slate-100 p-2 text-slate-500">
            <X size={18} />
          </button>
        </div>
        {portalAppointmentDetail?.closure?.signaturePending && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-800">Assinatura pendente</p>
            <p className="mt-1 text-xs font-medium text-amber-700">Confirme a realização da sessão dentro do app.</p>
          </div>
        )}
        {activePortalConfirmed && (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-sm font-semibold text-emerald-800">Presença confirmada</p>
            <p className="mt-1 text-xs font-medium text-emerald-700">A clínica já recebeu sua confirmação desta sessão.</p>
          </div>
        )}
        {portalAppointmentsState.message && (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            {portalAppointmentsState.message}
          </div>
        )}
        <div className="mt-4 grid gap-2">
          <button type="button" disabled={portalActionSaving || portalActionBlocked || activePortalConfirmed} onClick={() => void confirmPortalAppointment(activePortalAppointment)} className="flex items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
            <CheckCircle size={17} /> {activePortalConfirmed ? 'Presença confirmada' : 'Confirmar presença'}
          </button>
          {activePortalCanRequestReschedule && (
            <button type="button" disabled={portalActionBlocked} onClick={() => openPortalRescheduleModal()} className="flex items-center justify-center gap-2 rounded-2xl border border-purple-100 bg-white px-4 py-3 text-sm font-semibold text-[#7a32fc] disabled:opacity-50">
              <RefreshCcw size={17} /> Solicitar reagendamento
            </button>
          )}
          <button type="button" disabled={portalActionBlocked} onClick={() => setPortalModal('cancel')} className="flex items-center justify-center gap-2 rounded-2xl border border-rose-100 bg-white px-4 py-3 text-sm font-semibold text-rose-600 disabled:opacity-50">
            <Ban size={17} /> Solicitar cancelamento
          </button>
          {portalAppointmentDetail?.session?.id && portalAppointmentDetail?.closure?.signaturePending && (
            <button type="button" onClick={() => setPortalModal('sign')} className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
              <FileSignature size={17} /> Assinar sessão
            </button>
          )}
        </div>
        {Array.isArray(portalAppointmentDetail?.history) && portalAppointmentDetail.history.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-medium text-slate-500">Histórico</p>
            <div className="space-y-2">
              {portalAppointmentDetail.history.slice(0, 4).map((entry: any, index: number) => (
                <div key={index} className="rounded-2xl bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
                  {entry.label || 'Ação registrada'} {entry.performedAt ? `em ${formatPortalDateTime(entry.performedAt)}` : ''}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  ) : null;

  const portalActionSubmitDisabled =
    portalActionSaving ||
    (portalModal === 'sign' && !portalActionForm.accepted) ||
    (portalModal === 'reschedule' && portalSelectedRescheduleSlots.length === 0);

  const portalActionModal = portalModal ? (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => closePortalActionModal()}>
      <div className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]" onClick={(event) => event.stopPropagation()}>
        <div className="shrink-0 p-5 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#7a32fc]">
              {portalModal === 'sign' ? 'Assinatura' : portalModal === 'cancel' ? 'Cancelamento' : 'Remarcação'}
            </p>
            <h3 className="mt-1 text-xl font-black text-slate-900">
              {portalModal === 'sign' ? 'Confirmar sessão' : portalModal === 'cancel' ? 'Solicitar cancelamento' : 'Solicitar remarcação'}
            </h3>
          </div>
          <button type="button" onClick={() => closePortalActionModal()} className="rounded-2xl border border-slate-100 p-2 text-slate-500">
            <X size={18} />
          </button>
        </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        {portalModal === 'sign' ? (
          <div className="space-y-3">
            <div className="rounded-2xl bg-purple-50 px-4 py-3 text-sm font-semibold text-purple-800">
              {portalAppointmentDetail?.consentText || 'Confirmo que a sessão descrita foi realizada.'}
            </div>
            <label className="flex items-start gap-3 rounded-2xl border border-slate-100 p-3 text-sm font-semibold text-slate-700">
              <input type="checkbox" className="mt-1 accent-[#7a32fc]" checked={portalActionForm.accepted} onChange={(e) => setPortalActionForm((prev) => ({ ...prev, accepted: e.target.checked }))} />
              Confirmo que li e aceito registrar esta confirmação operacional.
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            {portalModal === 'reschedule' && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-purple-100 bg-purple-50/70 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">Escolha até 3 opções de horário.</p>
                  <p className="mt-1 text-xs font-medium text-slate-600">A clínica confirmará uma delas. Você verá apenas horários disponíveis, sem agenda privada do profissional.</p>
                  {activePortalProfessionalName && (
                    <p className="mt-2 text-xs font-semibold text-slate-700">Profissional responsável: {activePortalProfessionalName}</p>
                  )}
                  {activePortalAppointment?.scheduledAt && (
                    <p className="mt-2 text-xs font-semibold text-purple-700">Sessão atual: {formatPortalDateTime(activePortalAppointment.scheduledAt)}</p>
                  )}
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  <span>Opções selecionadas</span>
                  <span className="text-[#7a32fc]">{portalSelectedRescheduleSlots.length}/{Math.max(1, Math.min(3, Number(portalRescheduleAvailability.maxSelectable || 3) || 3))}</span>
                </div>
                {portalRescheduleAvailability.rangeLabel && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-2 text-xs font-medium text-slate-600">
                    <span>Semana exibida: <span className="font-semibold text-slate-800">{portalRescheduleAvailability.rangeLabel}</span></span>
                    <button
                      type="button"
                      disabled={portalRescheduleAvailability.loading}
                      onClick={() => {
                        const appointmentId = String((portalAppointmentDetail?.appointment || selectedPortalAppointment)?.id || '').trim();
                        void loadPortalRescheduleSlots(appointmentId, portalRescheduleAvailability.weekStart || undefined);
                      }}
                      className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold text-[#7a32fc] transition hover:bg-purple-50 disabled:opacity-50"
                      title="Atualizar horários disponíveis"
                    >
                      <RefreshCcw size={14} className={portalRescheduleAvailability.loading ? 'animate-spin' : ''} />
                      Atualizar
                    </button>
                  </div>
                )}
                {portalRescheduleAvailability.loading && (
                  <div className="rounded-2xl border border-slate-100 bg-white px-4 py-4 text-sm font-semibold text-slate-500">
                    Carregando horários disponíveis...
                  </div>
                )}
                {portalRescheduleAvailability.error && (
                  <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                    {portalRescheduleAvailability.error}
                  </div>
                )}
                {!portalRescheduleAvailability.loading && !portalRescheduleAvailability.error && portalRescheduleAvailability.days.length === 0 && (
                  <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <p className="font-semibold">{portalRescheduleAvailability.message || 'Não encontramos horários disponíveis nesta semana.'}</p>
                    <p className="mt-1 text-xs font-medium">Você pode enviar uma observação para a clínica entrar em contato.</p>
                  </div>
                )}
                {!portalRescheduleAvailability.loading && portalRescheduleAvailability.days.length > 0 && (
                  <div className="space-y-3">
                    {portalRescheduleAvailability.days.map((day: any) => (
                      <div key={day.date || day.label} className="rounded-2xl border border-slate-100 bg-white p-3">
                        <p className="text-sm font-semibold text-slate-800">{day.label}</p>
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {(Array.isArray(day.slots) ? day.slots : []).map((slot: any) => {
                            const slotId = String(slot?.id || slot?.scheduledStart || '');
                            const selected = portalSelectedRescheduleSlots.some((item) => String(item?.id || item?.scheduledStart || '') === slotId);
                            return (
                              <button
                                key={slotId}
                                type="button"
                                onClick={() => togglePortalRescheduleSlot(slot)}
                                className={`rounded-2xl border px-3 py-2.5 text-sm font-semibold transition ${
                                  selected
                                    ? 'border-[#7a32fc] bg-[#7a32fc] text-white shadow-sm shadow-purple-500/20'
                                    : 'border-slate-200 bg-white text-slate-700 hover:border-purple-200 hover:bg-purple-50'
                                }`}
                              >
                                {slot.start}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!portalRescheduleAvailability.loading && portalRescheduleAvailability.nextDateFrom && (
                  <button
                    type="button"
                    onClick={() => {
                      const appointmentId = String((portalAppointmentDetail?.appointment || selectedPortalAppointment)?.id || '').trim();
                      setPortalSelectedRescheduleSlots([]);
                      void loadPortalRescheduleSlots(appointmentId, portalRescheduleAvailability.nextDateFrom);
                    }}
                    className="w-full rounded-2xl border border-purple-100 bg-white px-4 py-3 text-sm font-semibold text-[#7a32fc] transition hover:bg-purple-50"
                  >
                    Ver próxima semana
                  </button>
                )}
                {portalSelectedRescheduleSlots.length > 0 && (
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                    <p className="text-xs font-semibold text-emerald-800">Opções escolhidas</p>
                    <ol className="mt-2 space-y-1 text-xs font-medium text-emerald-900">
                      {portalSelectedRescheduleSlots.map((slot, index) => (
                        <li key={slot.id || slot.scheduledStart}>{index + 1}. {slot.dateLabel} às {slot.start}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-500">Motivo</span>
              <input value={portalActionForm.reason} onChange={(e) => setPortalActionForm((prev) => ({ ...prev, reason: e.target.value }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-[#7a32fc]" placeholder="Opcional" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-500">Observação</span>
              <textarea value={portalActionForm.note} onChange={(e) => setPortalActionForm((prev) => ({ ...prev, note: e.target.value }))} rows={3} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-[#7a32fc]" placeholder="Opcional" />
            </label>
          </div>
        )}
        </div>
        <div className="shrink-0 border-t border-slate-100 bg-white p-5 pt-3">
        <button type="button" disabled={portalActionSubmitDisabled} onClick={() => void submitPortalAction()} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-4 py-3 text-sm font-black text-white shadow-lg shadow-purple-500/20 disabled:opacity-50">
          {portalActionSaving ? 'Salvando...' : portalModal === 'sign' ? 'Confirmar assinatura' : 'Enviar solicitação'}
        </button>
        </div>
      </div>
    </div>
  ) : null;

  const closeMoodModal = () => {
    setIsMoodModalOpen(false);
    setSelectedMood(null);
    setSelectedTag(null);
    setMoodNote("");
  };

  const closeTaskModal = () => {
    setSelectedTask(null);
    setTaskStep(1);
    setTaskNote("");
    setInterventionResponse("");
    setInterventionImages([]);
  };

  if (isKidsProfile) {
    return (
        <div className="min-h-screen bg-gradient-to-b from-[#F2FAFF] via-[#F6F2FF] to-[#FFF8EF] p-4 sm:p-6 flex flex-col items-center relative overflow-y-auto">
            {(showFamilySuccess) && <SuccessOverlay />}
            <AnimatePresence>{patientSettingsModal}</AnimatePresence>
            {portalAppointmentDetailModal}
            {portalActionModal}
            <div className="absolute top-0 left-0 w-full h-64 bg-gradient-to-b from-blue-100 to-transparent -z-0"></div>
            <div className="w-full max-w-md relative z-10 flex flex-col h-full">
                <div className="flex justify-between items-center mb-6 sm:mb-8">
                    <div className="flex items-center gap-3">
                         <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white rounded-full flex items-center justify-center shadow-md text-xl sm:text-2xl overflow-hidden">
                           {profilePicture ? <SecureImage src={profilePicture} alt="Foto do paciente" className="w-full h-full object-cover" /> : '🚀'}
                         </div>
                         <div>
                             <h1 className="text-xl sm:text-2xl font-semibold text-[#7a32fc]">Oi, {displayName}!</h1>
                             <p className="text-[10px] sm:text-sm text-gray-400 font-medium">Vamos ver seus poderes?</p>
                         </div>
                    </div>

                    <div className="relative flex items-center gap-2">
                      <PortalFirstAccessTutorial user={user} portal="patient" targetId="patient-portal-menu" />
                      <button
                        type="button"
                        data-tutorial-anchor="patient-portal-menu"
                        aria-label="Abrir menu do paciente"
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                        className="p-2.5 bg-white/80 backdrop-blur-md rounded-2xl shadow-sm text-gray-500 hover:bg-white transition-all border border-white/50"
                      >
                        <Menu size={20} />
                      </button>

                    <AnimatePresence>
                        {isMenuOpen && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: -10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -10 }}
                            className="absolute right-0 mt-2 w-60 bg-white rounded-[24px] shadow-xl border border-blue-50 z-[60] overflow-hidden p-2"
                          >
                            <div className="mb-2 border-b border-blue-50 pb-2">
                              {portalMenuItems.map((item) => {
                                const Icon = item.icon;
                                const active = portalSection === item.id;
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => { setPortalSection(item.id); setIsMenuOpen(false); }}
                                    className={`w-full flex items-center gap-3 p-3 text-sm font-medium rounded-xl transition-colors ${active ? 'bg-purple-50 text-[#7a32fc]' : 'text-slate-600 hover:bg-slate-50'}`}
                                  >
                                    <Icon size={18} /> {item.label}
                                  </button>
                                );
                              })}
                            </div>
                            {!isReadOnlyMode && clinicalPortalEnabled && (
                              <button
                                onClick={() => { setFamilyUploadError(''); setIsFamilyLogOpen(true); setIsMenuOpen(false); }}
                                className="w-full flex items-center gap-3 p-3 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
                              >
                                <BookOpen size={18} /> Diário da Família
                              </button>
                            )}
                            <button
                              onClick={() => { onLogout(); setIsMenuOpen(false); }}
                              className="w-full flex items-center gap-3 p-3 text-sm font-medium text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                            >
                              <LogOut size={18} /> Sair da Conta
                            </button>
                          </motion.div>
                        )}
                    </AnimatePresence>
                  </div>
                </div>
                {isReadOnlyMode && (
                  <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs sm:text-sm text-amber-800">
                    {readOnlyNotice}
                  </div>
                )}
                {portalMenu}
                {portalSection === 'home' && portalHomeSummary}
                {portalSection === 'appointments' && portalAppointmentsPanel}
                {portalSection === 'anamnesis' && portalAnamnesisPanel}
                {portalSection === 'notes' && portalNotesPanel}
                {portalSection === 'tasks' && portalTasksPanel}
                {portalSection === 'reports' && portalReportPanel}
                {portalSection === 'documents' && portalDocumentsPanel}
                {portalSection === 'care-network' && portalCareNetworkPanel}
                {portalSection === 'profile' && portalProfilePanel}

                {portalSection === 'home' && clinicalPortalEnabled && (
                  <React.Fragment>
                <div className="bg-white p-4 sm:p-6 rounded-[32px] sm:rounded-[40px] shadow-xl border border-blue-50 flex flex-col justify-center mb-6 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 sm:w-32 h-24 sm:h-32 bg-yellow-100 rounded-bl-full opacity-50 -z-0"></div>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 text-center">
                        <p className="text-[10px] uppercase text-blue-600 font-bold tracking-widest">Registros 7d</p>
                        <p className="text-lg font-extrabold text-blue-700">{kidsGamification.weekLogs}</p>
                      </div>
                      <div className="bg-yellow-50 border border-yellow-100 rounded-2xl p-3 text-center relative overflow-hidden">
                        {showStarCelebration && (
                          <div key={celebrationKey} className="pointer-events-none absolute inset-0">
                            <div className="absolute left-3 top-2 animate-bounce text-sm">✨</div>
                            <div className="absolute right-4 top-3 animate-ping text-xs">⭐</div>
                            <div className="absolute left-1/2 -translate-x-1/2 top-1 animate-pulse text-lg">🎉</div>
                            <div className="absolute left-6 bottom-3 animate-bounce text-xs">🌟</div>
                            <div className="absolute right-5 bottom-2 animate-pulse text-sm">💜</div>
                          </div>
                        )}
                        <p className="text-base sm:text-lg font-extrabold text-yellow-700">{kidsGamification.stars} ⭐</p>
                        <p className="text-[10px] text-yellow-700 font-semibold mt-1">{kidsCheckpointLevel > 0 ? '⭐'.repeat(Math.min(5, kidsCheckpointLevel)) : ''}</p>
                      </div>
                      <div className="bg-green-50 border border-green-100 rounded-2xl p-3 text-center">
                        <p className="text-[10px] uppercase text-green-600 font-bold tracking-widest">Fotos 7d</p>
                        <p className="text-lg font-extrabold text-green-700">{kidsGamification.weekPhotos}</p>
                      </div>
                    </div>
                </div>
                <PortalSharedClinicalChart patientId={String(portalPatientId || user?.patientId || user?.id || '')} />

                <div className="bg-white p-4 sm:p-6 rounded-[28px] shadow-lg border border-blue-100 mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm sm:text-base font-semibold text-blue-700 tracking-tight">Últimos Registros do Diário da Família</h2>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-blue-500 bg-blue-50 px-2 py-1 rounded-full">
                      {familyDiaryHistory.length} itens
                    </span>
                  </div>
                  {familyDiaryHistory.length > 0 ? (
                    <div className="space-y-3">
                      {familyDiaryHistory.map((entry: any) => (
                        <div key={`family-${entry.id}`} className="rounded-2xl border border-blue-50 bg-blue-50/30 p-3">
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-blue-500">
                              {entry.type === 'photo' ? 'Foto enviada' : 'Registro da família'}
                            </span>
                            <span className="text-[10px] text-gray-500 font-medium">
                              {formatDiaryTimestamp(entry.date || entry.created_at)}
                            </span>
                          </div>
                          {entry.note && <p className="text-xs sm:text-sm text-gray-700 leading-relaxed mb-2">{entry.note}</p>}
                          {getFamilyDiaryImageSource(entry) && (
                            <SecureImage
                              src={getFamilyDiaryImageSource(entry)}
                              alt="Registro do diário"
                              className="block w-full h-auto max-h-56 object-contain rounded-xl border border-blue-100 bg-white"
                              fallback={
                                <div className="rounded-xl border border-blue-100 bg-white px-3 py-4 text-center text-[11px] font-semibold text-blue-500">
                                  Foto indisponível no momento
                                </div>
                              }
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 p-5 text-center">
                      <p className="text-sm font-semibold text-blue-700 mb-1">Vamos começar o Diário da Família?</p>
                      <p className="text-xs text-blue-500">Registre texto, fotos e rabiscos para acompanhar a evolução da criança dia a dia.</p>
                    </div>
                  )}
                </div>
                  </React.Fragment>
                )}
            </div>

            {isFamilyLogOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
                <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl animate-pop relative">
                  <button type="button" aria-label="Fechar diário da família" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setIsFamilyLogOpen(false); }} className="absolute top-4 right-4 z-30 inline-flex h-11 w-11 touch-manipulation items-center justify-center rounded-xl text-gray-400 hover:bg-gray-50 hover:text-gray-600" > <X size={24} /> </button>
                  <div className="text-center mb-6">
                    <div className="w-16 h-16 mx-auto bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center text-3xl mb-3"> 🏠 </div>
                    <h3 className="text-xl font-bold text-gray-800 tracking-tight">Diário da Família</h3>
                    <p className="text-gray-500 text-sm mt-1">Como foi o dia do pequeno herói?</p>
                  </div>
                  <div className="mb-4">
                    <textarea
                      className="w-full h-32 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:outline-none focus:border-blue-500/50 transition-all resize-none font-medium mb-3"
                      placeholder="Conte-nos como foi o dia, comportamentos, alimentação ou qualquer observação importante..."
                      value={familyNote}
                      onChange={(e) => setFamilyNote(e.target.value)}
                      autoFocus
                    ></textarea>

                    <div className="flex flex-wrap gap-2">
                      {familyImage ? (
                        <div className="relative w-24 h-24 rounded-2xl overflow-hidden border-2 border-blue-100 group">
                          <SecureImage src={familyImage} alt="Preview" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <button onClick={() => setIsDrawingMode(true)} className="p-1.5 bg-white rounded-full text-blue-500 shadow-sm" title="Rabiscar na foto"><Pencil size={14}/></button>
                            <button onClick={() => { setFamilyImage(null); setFamilyImagePath(null); setFamilyUploadError(''); }} className="p-1.5 bg-white rounded-full text-red-500 shadow-sm"><Trash2 size={14}/></button>
                          </div>
                        </div>
                      ) : (
                        <label className={`w-24 h-24 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-1 text-gray-400 transition-all ${isUploading || hasReachedFamilyPhotoLimitToday ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-300 hover:text-blue-400 cursor-pointer'}`}>
                          {isUploading ? (
                            <RefreshCcw size={24} className="animate-spin" />
                          ) : (
                            <Camera size={24} />
                          )}
                          <span className="text-[10px] font-bold uppercase">{isUploading ? 'Enviando' : hasReachedFamilyPhotoLimitToday ? '5 fotos/dia' : 'Foto'}</span>
                          {!isUploading && !hasReachedFamilyPhotoLimitToday && <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />}
                        </label>
                      )}
                    </div>
                    {hasReachedFamilyPhotoLimitToday && !familyImage && (
                      <p className="mt-2 text-[11px] text-amber-600 font-medium">
                        Limite diário: já existem {FAMILY_DAILY_PHOTO_LIMIT} fotos enviadas hoje no Diário da Família.
                      </p>
                    )}
                    {familyUploadError && (
                      <p role="alert" className="mt-2 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700">
                        {familyUploadError}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleConfirmFamilyNote}
                    disabled={isFamilySaving || isUploading || (!familyNote.trim() && !familyImage)}
                    className="w-full font-bold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 bg-blue-600 text-white shadow-blue-600/30 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isFamilySaving ? <React.Fragment><RefreshCcw size={20} className="animate-spin" /> Enviando...</React.Fragment> : <React.Fragment><Check size={20} strokeWidth={3} /> Registrar no Histórico</React.Fragment>}
                  </button>
                </div>
              </div>
            )}
            {isDrawingMode && familyImage && (
              <DrawingCanvas
                image={familyImage}
                onSave={(edited) => { setFamilyImage(edited); setFamilyImagePath(null); setIsDrawingMode(false); }}
                onCancel={() => { setIsDrawingMode(false); }}
              />
            )}
        </div>
    );
  }

  const handleEmojiClick = (mood: any) => {
    if (isReadOnlyMode) return;
    setSelectedMood(mood);
    setSelectedTag(null);
    setMoodNote("");
    setIsMoodModalOpen(true);
  };
  const handleConfirmMood = async () => {
    if (isReadOnlyMode || !selectedMood || isMoodSaving || moodSubmitInFlightRef.current) return;
    moodSubmitInFlightRef.current = true;
    setIsMoodSaving(true);
    setMoodSaveError('');
    try {
      const result = await onMoodCheckin(selectedMood.value, moodNote, selectedMood.emoji, selectedTag);
      if (result?.success !== true) {
        setMoodSaveError(result?.error || 'Não foi possível confirmar a gravação do check-in.');
        return;
      }
      if (result?.data?.id) {
        setWellbeingCheckins((current) => [result.data, ...current.filter((row: any) => String(row?.id || '') !== String(result.data.id))]);
      }
      setShowMoodSuccess(true);
      setIsMoodModalOpen(false);
      setMoodNote("");
      setSelectedMood(null);
      setSelectedTag(null);
      window.setTimeout(() => setShowMoodSuccess(false), 1200);
    } catch {
      setMoodSaveError('Não foi possível salvar seu check-in.');
    } finally {
      moodSubmitInFlightRef.current = false;
      setIsMoodSaving(false);
    }
  };
  const openTaskModal = (task: any) => {
    if (isReadOnlyMode) return;
    setSelectedTask(task);
    setTaskEnergy(isKidsProfile ? 50 : null);
    setTaskNote("");
    setInterventionResponse("");
    setInterventionImages([]);
    if (task.type === 'intervention' && isConventionalAdult) {
      setTaskStep(0);
    } else {
      setTaskStep(1);
    }
  };
  const handleEnergyCommit = (committedValue?: number) => {
    const resolved = Number.isFinite(Number(committedValue)) ? Number(committedValue) : taskEnergy;
    if (resolved === null || !Number.isFinite(Number(resolved))) return;
    setTaskEnergy(Math.max(0, Math.min(100, Number(resolved))));
    setTaskStep(2);
  };
  const handleInterventionResponseContinue = () => {
    if (!selectedTask || selectedTask.type !== 'intervention' || !interventionResponse.trim() || isInterventionUploading) return;
    setTaskEnergy(null);
    setTaskStep(2);
  };
  const handleConfirmTask = async () => {
    if (isReadOnlyMode || !selectedTask || isTaskSaving || taskSubmitInFlightRef.current) return;
    if (!isKidsProfile && (taskEnergy === null || !Number.isFinite(Number(taskEnergy)))) return;
    taskSubmitInFlightRef.current = true;
    setIsTaskSaving(true);
    try {
      const interventionDetails = [
        interventionResponse?.trim() ? `Resposta:
${interventionResponse.trim()}` : '',
        taskNote?.trim() ? `Observação:
${taskNote.trim()}` : '',
        interventionImages.length > 0 ? `Anexos:
${interventionImages.join('\n')}` : ''
      ].filter(Boolean).join('\n\n');
      const finalNote = selectedTask.type === 'intervention' ? interventionDetails : taskNote;
      const result = await onCompleteTask(selectedTask, taskEnergy, finalNote);
      if (result?.success === false) return;
      setShowTaskSuccess(true);
      window.setTimeout(() => setShowTaskSuccess(false), 1200);
      setSelectedTask(null);
      setInterventionResponse("");
      setInterventionImages([]);
      setTaskStep(1);
    } finally {
      taskSubmitInFlightRef.current = false;
      setIsTaskSaving(false);
    }
  };

  const dailyReviewTasks = useMemo(() => {
    const interventions = history.filter((h: any) => h.type === 'intervention' && h.isDailyReminder);
    const latestByTitle: any = {};
    interventions.forEach((h: any) => {
      if (!latestByTitle[h.title] || h.id > latestByTitle[h.title].id) {
        latestByTitle[h.title] = h;
      }
    });
    return Object.values(latestByTitle);
  }, [history]);

  return (
    <div className={`min-h-screen w-full max-w-full p-6 flex flex-col overflow-x-hidden ${isConventionalAdult ? 'bg-gradient-to-b from-[#FFF9F3] to-[#F8F5FF]' : 'bg-[#F4F7FE]'}`}>
      <AnimatePresence>
        {showStarCelebration && (
          <motion.div
            key={`milestone-celebration-${celebrationKey}`}
            className="fixed inset-0 z-[10000] overflow-hidden bg-gradient-to-br from-violet-700 via-[#7a32fc] to-fuchsia-500"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1, 1, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 6.2, times: [0, 0.08, 0.72, 0.92, 1], ease: 'easeInOut' }}
            onAnimationComplete={dismissMilestoneCelebration}
            role="dialog"
            aria-modal="true"
            aria-label="Comemoração por novo marco validado"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.28),transparent_58%)]" />
            {STAR_CONFETTI_PARTICLES.map((particle) => (
              <motion.span
                key={particle.id}
                className="pointer-events-none absolute top-[-8vh] block shadow-sm"
                style={{
                  left: `${particle.left}%`,
                  width: particle.size,
                  height: particle.shape === 0 ? particle.size : Math.max(4, particle.size * 0.45),
                  borderRadius: particle.shape === 0 ? '999px' : particle.shape === 1 ? '2px' : '45%',
                  backgroundColor: particle.color
                }}
                initial={{ x: 0, y: '-8vh', rotate: 0, opacity: 0 }}
                animate={{
                  x: [0, particle.drift, particle.drift * -0.35],
                  y: ['-8vh', '52vh', '112vh'],
                  rotate: [0, particle.rotate * 0.55, particle.rotate],
                  opacity: [0, 1, 1, 0]
                }}
                transition={{ duration: particle.duration, delay: particle.delay, ease: 'easeIn' }}
              />
            ))}
            <button
              type="button"
              onClick={dismissMilestoneCelebration}
              className="absolute right-5 top-5 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white backdrop-blur transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label="Fechar comemoração"
            >
              <X size={22} />
            </button>
            <div className="relative z-10 flex min-h-full items-center justify-center p-5">
              <motion.div
                initial={{ scale: 0.55, y: 50, opacity: 0 }}
                animate={{ scale: [0.55, 1.08, 1], y: [50, -8, 0], opacity: 1 }}
                transition={{ duration: 0.85, delay: 0.2, ease: 'backOut' }}
                className="w-full max-w-xl rounded-[36px] border border-white/55 bg-white/95 p-7 text-center shadow-[0_30px_100px_rgba(41,12,95,0.45)] backdrop-blur sm:p-10"
              >
                <motion.div
                  animate={{ rotate: [-10, 12, -8, 8, 0], scale: [1, 1.3, 1.05, 1.2, 1] }}
                  transition={{ duration: 1.5, delay: 0.55 }}
                  className="mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-amber-200 via-yellow-300 to-amber-400 text-6xl shadow-[0_18px_45px_rgba(245,158,11,0.38)] sm:h-32 sm:w-32 sm:text-7xl"
                  aria-hidden="true"
                >
                  ⭐
                </motion.div>
                <p className="mt-6 text-sm font-semibold uppercase tracking-[0.24em] text-violet-500">Marco conquistado</p>
                <h2 className="mt-2 text-3xl font-semibold leading-tight text-slate-900 sm:text-4xl">
                  Você ganhou {milestoneCelebrationCount > 1 ? `${milestoneCelebrationCount} novas estrelinhas!` : 'uma nova estrelinha!'}
                </h2>
                <p className="mx-auto mt-4 max-w-md text-base leading-7 text-slate-600 sm:text-lg">
                  Seu esforço foi reconhecido pela equipe. Cada avanço merece ser celebrado — continue brilhando!
                </p>
                <div className="mt-6 flex justify-center gap-2 text-2xl" aria-hidden="true">
                  <motion.span animate={{ y: [0, -12, 0] }} transition={{ duration: 0.8, repeat: 3 }}>🎉</motion.span>
                  <motion.span animate={{ y: [0, -16, 0] }} transition={{ duration: 0.9, delay: 0.12, repeat: 3 }}>💜</motion.span>
                  <motion.span animate={{ y: [0, -12, 0] }} transition={{ duration: 0.8, delay: 0.24, repeat: 3 }}>🌟</motion.span>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {(showTaskSuccess || showMoodSuccess) && <SuccessOverlay />}
      <AnimatePresence>{patientSettingsModal}</AnimatePresence>
      {portalAppointmentDetailModal}
      {portalActionModal}
      {isMessagesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-fade-in" onClick={() => setIsMessagesOpen(false)}>
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl animate-pop relative" onClick={e => e.stopPropagation()}>
            <button type="button" aria-label="Fechar mensagens" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setIsMessagesOpen(false); }} className="absolute top-4 right-4 z-30 inline-flex h-11 w-11 touch-manipulation items-center justify-center rounded-xl text-gray-400 hover:bg-gray-50 hover:text-gray-600"><X size={20}/></button>
            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2 tracking-tight"><BookOpen className="text-[#7a32fc]"/> Mensagens do Terapeuta</h2>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
              {portalSharedNotes.length > 0 ? portalSharedNotes.map((note: any) => (
                <div key={note.id} className="bg-blue-50/50 border border-blue-100 p-4 rounded-xl">
                  <span className="text-[10px] font-bold text-blue-400 uppercase block mb-1">{note.date}</span>
                  <p className="text-sm text-gray-700">{firstPortalText(note.text, note.note, note.content, note.message)}</p>
                </div>
              )) : ( <p className="text-center text-gray-400 text-sm py-8 italic">Nenhuma mensagem por enquanto.</p> )}
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-6">
        <div className="flex items-center gap-4">
          {profilePicture ? (
            <div className="h-[50px] w-[50px] shrink-0 overflow-hidden rounded-2xl border border-purple-100 bg-white shadow-sm">
              <SecureImage src={profilePicture} alt="Foto do paciente" className="h-full w-full object-cover" />
            </div>
          ) : (
            <LogoVerto size={50} className="drop-shadow-sm shrink-0" />
          )}
          <div className="w-px h-8 bg-gray-200 mx-2 hidden sm:block"></div>
          <div>
            <h1 className="text-2xl font-semibold text-gray-800 tracking-tight leading-none"> Olá, <span className="text-[#7a32fc]">{displayName}</span>! </h1>
            <p className="text-gray-400 font-medium mt-1 text-xs"> Vamos cuidar de você hoje? </p>
          </div>
        </div>

        <div className="relative flex items-center gap-2 self-end sm:self-auto">
          <PortalFirstAccessTutorial user={user} portal="patient" targetId="patient-portal-menu" />
          <button
            type="button"
            data-tutorial-anchor="patient-portal-menu"
            aria-label="Abrir menu do paciente"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-3 bg-white rounded-2xl shadow-sm text-gray-500 hover:bg-white transition-all border border-white/50 relative"
          >
            <Menu size={20} />
            {unreadPortalSharedNotes.length > 0 && <div className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border border-white"></div>}
          </button>

          <AnimatePresence>
            {isMenuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -10 }}
                className="absolute right-0 mt-2 w-56 bg-white rounded-[24px] shadow-xl border border-blue-50 z-[60] overflow-hidden p-2"
              >
                <div className="mb-2 border-b border-blue-50 pb-2">
                  {portalMenuItems.map((item) => {
                    const Icon = item.icon;
                    const active = portalSection === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => { setPortalSection(item.id); setIsMenuOpen(false); }}
                        className={`w-full flex items-center gap-3 p-3 text-sm font-medium rounded-xl transition-colors ${active ? 'bg-purple-50 text-[#7a32fc]' : 'text-slate-600 hover:bg-slate-50'}`}
                      >
                        <Icon size={18} /> {item.label}
                      </button>
                    );
                  })}
                </div>
                {!isReadOnlyMode && (
                  <button
                    onClick={openMessagesAndPersistRead}
                    className="w-full flex items-center justify-between p-3 text-sm font-medium text-[#7a32fc] hover:bg-blue-50 rounded-xl transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <MessageCircle size={18} /> Mensagens
                    </div>
                    {unreadPortalSharedNotes.length > 0 && (
                      <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                        {unreadPortalSharedNotes.length}
                      </span>
                    )}
                  </button>
                )}
                <button
                  onClick={() => { onLogout(); setIsMenuOpen(false); }}
                  className="w-full flex items-center gap-3 p-3 text-sm font-medium text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                >
                  <LogOut size={18} /> Sair da Conta
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      {isReadOnlyMode && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {readOnlyNotice}
        </div>
      )}
      {portalMenu}
      {portalSection === 'home' && portalHomeSummary}
      {portalSection === 'appointments' && portalAppointmentsPanel}
      {portalSection === 'anamnesis' && portalAnamnesisPanel}
      {portalSection === 'notes' && portalNotesPanel}
      {portalSection === 'tasks' && portalTasksPanel}
      {portalSection === 'reports' && portalReportPanel}
      {portalSection === 'documents' && portalDocumentsPanel}
      {portalSection === 'care-network' && portalCareNetworkPanel}
      {portalSection === 'profile' && portalProfilePanel}
      {portalSection === 'home' && clinicalPortalEnabled && (
        <React.Fragment>
      <div className="mb-8 animate-slide-up">
          <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2 px-1"> {isConventionalAdult ? <Smile size={16} /> : <BatteryCharging size={16} />} {isConventionalAdult ? 'Como está se sentindo?' : 'Como se sente agora?'} </h2>
          <div className="flex overflow-x-auto pb-8 pt-4 -mx-6 px-6 gap-4 snap-x snap-mandatory no-scrollbar items-center">
            {moodOptions.map((mood) => {
              const isHovered = hoveredMood === mood.value;
              const isDimmed = hoveredMood !== null && !isHovered;
              return (
                <button key={mood.value} disabled={isReadOnlyMode} onClick={() => handleEmojiClick(mood)} onMouseEnter={() => setHoveredMood(mood.value)} onMouseLeave={() => setHoveredMood(null)} className={` snap-center shrink-0 w-40 h-56 sm:w-48 sm:h-64 rounded-[32px] flex flex-col items-center p-6 transition-all duration-500 border-4 shadow-lg ${mood.color} ${isHovered ? 'scale-110 -translate-y-4 shadow-2xl z-10 rotate-1' : 'scale-100'} ${isDimmed ? 'opacity-50 scale-95 blur-[1px]' : 'opacity-100'} group relative overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed`} >
                  <div className="absolute top-[-20%] right-[-20%] w-24 h-24 rounded-full bg-white/20 blur-xl"></div>
                  <div className="absolute bottom-[-10%] left-[-10%] w-20 h-20 rounded-full bg-white/30 blur-lg"></div>
                  <div className="w-full flex justify-between items-center opacity-60 group-hover:opacity-100 transition-opacity z-10"> {!isConventionalAdult && <React.Fragment><BatteryFull size={20} className="text-gray-700" /> <span className="text-xs font-semibold text-gray-700">{mood.value}%</span></React.Fragment>} </div>
                  <span className="text-7xl sm:text-8xl filter drop-shadow-md transform transition-transform duration-500 group-hover:scale-125 group-hover:rotate-12 z-10 my-auto"> {mood.emoji} </span>
                </button>
              );
            })}
            <div className="w-2 shrink-0"></div>
          </div>
          <p className="text-center text-[10px] text-gray-400 font-medium animate-pulse mt-[-10px] italic"> Deslize para escolher ou clique </p>
        </div>
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <div className="mb-8">
          <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"> <Zap size={16} /> Suas Atividades </h2>
          {visiblePatientTasks && visiblePatientTasks.length > 0 ? (
            <div className="grid gap-3">
              {visiblePatientTasks.map((task: any) => (
                <div key={task.id} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between group hover:shadow-md transition-all">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl ${task.completed ? 'bg-emerald-100 text-emerald-700' : (task.color || 'bg-[#7a32fc]/10 text-[#7a32fc]')}`}> {task.icon || '📋'} </div>
                    <div>
                      <h3 className="font-semibold text-gray-800 tracking-tight">{task.title}</h3>
                      {task.description && <p className="text-xs text-gray-400 line-clamp-1">{task.description}</p>}
                      {(task.scheduledAt || task.scheduled_at) && (
                        <p className="text-[10px] text-[#7a32fc] font-semibold uppercase tracking-widest mt-1">
                          Hoje às {new Date(task.scheduledAt || task.scheduled_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                  </div>
                  <button disabled={isReadOnlyMode || task.completed || String(task.status || '').toLowerCase() === 'completed'} onClick={() => openTaskModal(task)} className={`p-3 rounded-xl transition-all active:scale-95 disabled:cursor-not-allowed ${task.completed || String(task.status || '').toLowerCase() === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-50 text-gray-400 hover:bg-green-500 hover:text-white disabled:opacity-50'}`} > <Check size={20} /> </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400 bg-white/50 rounded-3xl border-2 border-dashed border-gray-200"> <Smile size={48} className="mb-2 opacity-50"/> <p className="font-medium">Nenhuma tarefa para agora.</p> </div>
          )}
        </div>

        {dailyReviewTasks.length > 0 && (
          <div className="mb-8 animate-fade-in">
            <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"> <BookOpen size={16} /> Revisão Diária </h2>
            <div className="grid gap-3">
              {dailyReviewTasks.map((review: any) => (
                <div key={review.id} className="bg-green-50/50 p-5 rounded-[32px] border border-green-100 shadow-sm">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-2xl">✍️</span>
                    <div>
                      <h3 className="font-semibold text-gray-800 tracking-tight">{review.title}</h3>
                      <p className="text-[10px] text-green-600 font-semibold uppercase">Lembrete de Revisão</p>
                    </div>
                  </div>
                  <div className="bg-white/80 p-4 rounded-2xl border border-green-50 mb-3">
                    <p className="text-[10px] text-gray-400 font-semibold uppercase mb-1">Sua Resposta:</p>
                    <p className="text-sm text-gray-600 leading-relaxed italic">"{review.note}"</p>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-400 font-semibold uppercase">
                    <span>Concluído em {review.dateGroup}</span>
                    <span className="flex items-center gap-1 text-green-600"><CheckCircle size={12}/> Revisado</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {!isKidsProfile ? (
          <div className="mt-8 mb-6">
            <AdultWellbeingTrendChart
              records={wellbeingCheckins}
              metricKind={isConventionalAdult ? 'mood' : 'energy'}
              period={wellbeingPeriod}
              onPeriodChange={setWellbeingPeriod}
            />
          </div>
        ) : (
        <div className="mt-8 mb-6">
          <div className="flex items-center justify-between mb-4">
             <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest flex items-center gap-2"> <Trophy size={16} /> Histórico </h2>
             <div className="relative w-48">
                <select
                  className="w-full bg-white border border-gray-200 text-[10px] font-semibold text-gray-500 px-3 py-2 rounded-xl outline-none focus:border-[#4318FF] transition-all appearance-none uppercase tracking-widest"
                  value={selectedSnapshotDate}
                  onChange={(e) => setSelectedSnapshotDate(e.target.value)}
                >
                  <option value="all">Todos os dias</option>
                  {availableSnapshots.map((date: any) => (
                    <option key={date} value={date}>{formatFilterDate(String(date))}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
             </div>
          </div>
          <div className="border-l-2 border-gray-100 ml-3 pb-4 pl-6 space-y-8">
            {sortedDateKeys.length > 0 ? sortedDateKeys.map(dateKey => (
              <div key={dateKey} className="relative animate-slide-up">
                <div className="absolute -left-[31px] top-0 w-4 h-4 rounded-full bg-[#4318FF] border-2 border-white ring-4 ring-blue-50"></div>
                <h3 className="text-[10px] font-semibold text-gray-400 tracking-widest mb-4 bg-gray-50 px-3 py-1 rounded-full w-fit">{dateKey}</h3>
                <div className="space-y-4">
                  {groupedHistory[dateKey].map((item: any) => (
                    <HistoryCard
                      key={item.id}
                      item={item}
                      energyTags={moodInfluenceTags}
                      isTherapist={false}
                      isKid={isKidsProfile}
                      fullHistory={history}
                      peiGoals={user.pei || []}
                      protocols={protocols}
                    />
                  ))}
                </div>
              </div>
            )) : ( <p className="text-center text-gray-400 text-xs py-4 italic">Nenhuma atividade registrada para esta seleção.</p> )}
          </div>
        </div>
        )}
      </div>
        </React.Fragment>
      )}
      {isMoodModalOpen && selectedMood && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl animate-pop relative">
            <button type="button" aria-label="Fechar registro de humor" onClick={(event) => { event.preventDefault(); event.stopPropagation(); closeMoodModal(); }} className="absolute top-4 right-4 z-30 inline-flex h-11 w-11 touch-manipulation items-center justify-center rounded-xl text-gray-400 hover:bg-gray-50 hover:text-gray-600" > <X size={24} /> </button>
            <div className="text-center mb-4">
              {!isConventionalAdult && (
                <div className="inline-flex items-center gap-2 bg-gray-100 px-4 py-1.5 rounded-full mb-4"> <BatteryFull size={16} className="text-gray-500" /> <span className="text-sm font-semibold text-gray-600">Energia registrada: <span className="text-[#7a32fc]">{selectedMood.value}%</span></span> </div>
              )}
              <div className="text-6xl mb-2 animate-bounce-slight">{selectedMood.emoji}</div>
              <h3 className="text-xl font-semibold text-gray-800 tracking-tight">O que influenciou?</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {moodInfluenceTags.map((tag: any) => (
                <button key={tag.id} onClick={() => setSelectedTag(selectedTag === tag.id ? null : tag.id)} className={`p-3 rounded-2xl flex items-center gap-3 border-2 transition-all ${selectedTag === tag.id ? 'border-[#7a32fc] bg-[#7a32fc]/5 shadow-sm' : 'border-transparent bg-gray-100'}`} >
                  <div className={`p-2 rounded-xl ${tag.color} shrink-0`}>{typeof tag.icon === 'string' ? <span className="text-base">{tag.icon}</span> : tag.icon}</div> <span className={`text-xs font-semibold ${selectedTag === tag.id ? 'text-[#7a32fc]' : 'text-gray-500'}`}>{tag.label}</span>
                </button>
              ))}
            </div>
            <textarea className="w-full h-20 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:outline-none focus:border-[#7a32fc]/50 transition-all resize-none mb-4" placeholder="Quer escrever algo sobre isso?" value={moodNote} onChange={(e) => setMoodNote(e.target.value)} ></textarea>
            {moodSaveError && <p className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{moodSaveError}</p>}
                <button onClick={handleConfirmMood} disabled={showMoodSuccess || isMoodSaving} className={`w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${showMoodSuccess ? 'bg-green-500 text-white' : 'bg-[#7a32fc] text-white shadow-[#7a32fc]/30 hover:opacity-90'}`} > {showMoodSuccess ? <React.Fragment><CheckCircle size={24}/> Sucesso!</React.Fragment> : isMoodSaving ? <React.Fragment><RefreshCcw size={20} className="animate-spin" /> Salvando...</React.Fragment> : <React.Fragment><Check size={20} strokeWidth={3} /> Registrar</React.Fragment>} </button>
          </div>
        </div>
      )}
      {selectedTask && typeof document !== 'undefined' && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Concluir tarefa" className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-[32px] p-6 shadow-2xl animate-pop relative">
            <button type="button" aria-label="Fechar tarefa" onClick={(event) => { event.preventDefault(); event.stopPropagation(); closeTaskModal(); }} className="absolute top-4 right-4 z-30 inline-flex h-11 w-11 touch-manipulation items-center justify-center rounded-xl text-gray-400 hover:bg-gray-50 hover:text-gray-600" > <X size={24} /> </button>
            <div className="text-center mb-6">
              <div className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center text-3xl mb-3 ${selectedTask.color || 'bg-blue-100 text-blue-600'}`}> {selectedTask.icon || '📋'} </div>
              <h3 className="text-xl font-semibold text-gray-800 tracking-tight">{selectedTask.title}</h3>
              <p className="text-gray-500 text-sm mt-1">
                {selectedTask.type === 'intervention'
                  ? 'Instruções da tarefa de intervenção'
                  : taskReflectionPrompt}
              </p>
            </div>
            {selectedTask.type === 'intervention' ? (
              <div className="animate-slide-up space-y-4">
                {isConventionalAdult && taskStep === 0 && (
                  <div className="space-y-4">
                    <div className="bg-green-50 p-4 rounded-2xl border border-green-100">
                      <p className="text-[10px] text-green-700 uppercase tracking-widest font-semibold mb-2">Instruções do profissional</p>
                      <p className="text-sm text-gray-600 font-medium leading-relaxed italic">"{selectedTask.description}"</p>
                    </div>
                    <button
                      onClick={() => setTaskStep(1)}
                      className="w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 bg-[#7a32fc] text-white shadow-[#7a32fc]/30 hover:opacity-90"
                    >
                      Iniciar tarefa
                    </button>
                  </div>
                )}

                {taskStep === 1 && (
                  <React.Fragment>
                    <div className="bg-green-50 p-4 rounded-2xl border border-green-100">
                      <p className="text-sm text-gray-600 font-medium leading-relaxed italic">"{selectedTask.description}"</p>
                    </div>
                    <textarea
                      className="w-full h-40 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:outline-none focus:border-green-500/50 transition-all resize-none font-medium"
                      placeholder="Escreva sua resposta aqui..."
                      value={interventionResponse}
                      onChange={(e) => setInterventionResponse(e.target.value)}
                      autoFocus
                    ></textarea>

                    {isConventionalAdult && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <label className={`px-3 py-2 rounded-xl border border-dashed border-gray-300 text-xs font-semibold text-gray-500 cursor-pointer hover:border-[#7a32fc]/40 hover:text-[#7a32fc] transition-colors ${isInterventionUploading ? 'opacity-50 cursor-wait' : ''}`}>
                            {isInterventionUploading ? 'Enviando...' : 'Anexar/Tirar Foto'}
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="hidden"
                              onChange={handleInterventionImageUpload}
                              disabled={isInterventionUploading}
                            />
                          </label>
                        </div>
                        {interventionImages.length > 0 && (
                          <div className="grid grid-cols-3 gap-2">
                            {interventionImages.map((image, idx) => (
                              <div key={`intervention-img-${idx}`} className="relative rounded-xl overflow-hidden border border-gray-200">
                                <SecureImage src={image} alt={`Anexo ${idx + 1}`} className="w-full h-20 object-cover" />
                                <button
                                  onClick={() => setInterventionImages((prev) => prev.filter((_, i) => i !== idx))}
                                  className="absolute top-1 right-1 p-1 rounded-full bg-white/90 text-red-500"
                                >
                                  <Trash2 size={10} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {!isKidsProfile ? (
                      <button
                        onClick={handleInterventionResponseContinue}
                        disabled={isTaskSaving || showTaskSuccess || !interventionResponse.trim() || isInterventionUploading}
                        className="w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 bg-green-600 text-white shadow-green-600/30 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Check size={20} strokeWidth={3} /> Enviar Resposta
                      </button>
                    ) : (
                      <button
                        onClick={handleConfirmTask}
                        disabled={isTaskSaving || showTaskSuccess || !interventionResponse.trim()}
                        className={`w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${showTaskSuccess ? 'bg-green-500 text-white' : 'bg-green-600 text-white shadow-green-600/30 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                      >
                        {isTaskSaving ? <React.Fragment><RefreshCcw size={20} className="animate-spin"/> Enviando...</React.Fragment> : showTaskSuccess ? <React.Fragment><CheckCircle size={24}/> Sucesso!</React.Fragment> : <React.Fragment><Check size={20} strokeWidth={3} /> Enviar Resposta</React.Fragment>}
                      </button>
                    )}
                  </React.Fragment>
                )}

                {!isKidsProfile && taskStep === 2 && (
                  <div className="animate-slide-up space-y-4">
                    <div className="rounded-2xl border border-violet-100 bg-violet-50/50 p-4">
                      <p className="mb-1 text-sm font-semibold text-slate-700">Como foi fazer essa tarefa?</p>
                      <p className="mb-4 text-xs text-slate-500">
                        Agora informe o esforço percebido após concluir a atividade.
                      </p>
                      <BigEnergySlider
                        value={taskEnergy}
                        onInteract={(value: number) => setTaskEnergy(value)}
                        onChange={(e: any) => setTaskEnergy(Number(e.target.value))}
                        onCommit={(value: number) => setTaskEnergy(value)}
                        label={taskReflectionLabel}
                        labelHelp={taskReflectionHelp}
                        scaleLabels={['Pouco esforço', 'Moderado', 'Muito esforço']}
                        emojiForValue={getTaskEffortEmoji}
                        progressGradient={taskEffortProgressGradient}
                        unselectedLabel="Toque na barra para informar seu esforço"
                      />
                    </div>
                    <button
                      onClick={handleConfirmTask}
                      disabled={isTaskSaving || showTaskSuccess || taskEnergy === null}
                      className={`w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${showTaskSuccess ? 'bg-green-500 text-white' : 'bg-green-600 text-white shadow-green-600/30 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                    >
                      {isTaskSaving ? <React.Fragment><RefreshCcw size={20} className="animate-spin"/> Salvando...</React.Fragment> : showTaskSuccess ? <React.Fragment><CheckCircle size={24}/> Sucesso!</React.Fragment> : <React.Fragment><Check size={20} strokeWidth={3} /> Concluir tarefa</React.Fragment>}
                    </button>
                    <button
                      type="button"
                      onClick={() => setTaskStep(1)}
                      className="w-full rounded-xl py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                    >
                      Voltar à resposta
                    </button>
                  </div>
                )}

              </div>
            ) : taskStep === 1 ? (
              <div className="animate-slide-up">
                {isKidsProfile ? (
                  <div className="space-y-6">
                    <p className="text-center text-sm font-semibold text-gray-600 mb-4">Como você se saiu nessa missão?</p>
                    <div className={`grid gap-4 ${selectedTask.maxScore > 1 ? 'grid-cols-3' : 'grid-cols-3'}`}>
                      {selectedTask.maxScore === 1 ? (
                        <>
                          {[0, 0.5, 1].map((score) => {
                            const colors: any = {
                              0: 'bg-[#EE5D50] shadow-red-500/20',
                              0.5: 'bg-[#FFB547] shadow-orange-500/20',
                              1: 'bg-[#05CD99] shadow-green-500/20'
                            };
                            const labels: any = {
                              0: "Não fiz",
                              0.5: "Quase lá",
                              1: "Consegui!"
                            };
                            return (
                              <button
                                key={score}
                                onClick={() => handleEnergyCommit(score)}
                                className={`${colors[score]} text-white h-20 rounded-2xl flex flex-col items-center justify-center shadow-lg hover:scale-[1.02] active:scale-95 transition-all`}
                              >
                                <span className="text-2xl font-semibold">{score}</span>
                                <span className="text-[8px] font-semibold uppercase">{labels[score]}</span>
                              </button>
                            );
                          })}
                        </>
                      ) : (
                        Array.from({ length: (selectedTask.maxScore || 2) + 1 }, (_, i) => i).map((score) => {
                          const colors = [
                            'bg-[#EE5D50] shadow-red-500/20',     // 0
                            'bg-[#FFB547] shadow-orange-500/20',  // 1
                            'bg-[#05CD99] shadow-green-500/20',   // 2
                            'bg-[#7a32fc] shadow-blue-500/20',    // 3
                            'bg-[#7551FF] shadow-indigo-500/20'   // 4
                          ];
                          const labels = ["Não fiz", "Quase lá", "Consegui!", "Incrível!", "Mestre!"];
                          const colorClass = colors[score] || 'bg-gray-500';

                          return (
                            <button
                              key={score}
                              onClick={() => handleEnergyCommit(score)}
                              className={`${colorClass} text-white h-20 rounded-2xl flex flex-col items-center justify-center shadow-lg hover:scale-[1.02] active:scale-95 transition-all`}
                            >
                              <span className="text-2xl font-semibold">{score}</span>
                              <span className="text-[8px] font-semibold uppercase">{labels[score] || "Pontuação"}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : (
                  <React.Fragment>
                    <React.Fragment>
                      <BigEnergySlider
                        value={taskEnergy}
                        onInteract={(value: number) => setTaskEnergy(value)}
                        onChange={(e: any) => setTaskEnergy(Number(e.target.value))}
                        onCommit={handleEnergyCommit}
                        label={taskReflectionLabel}
                        labelHelp={taskReflectionHelp}
                        scaleLabels={['Pouco esforço', 'Moderado', 'Muito esforço']}
                        emojiForValue={getTaskEffortEmoji}
                        progressGradient={taskEffortProgressGradient}
                        unselectedLabel="Toque na barra para informar seu esforço"
                      />
                      <p className="text-center text-[10px] text-[#7a32fc]/50 mt-4 font-medium animate-pulse italic uppercase tracking-widest">(Solte para continuar)</p>
                    </React.Fragment>
                  </React.Fragment>
                )}
              </div>
            ) : (
              <div className="animate-slide-up">
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">{isKidsProfile ? 'Sua Pontuação' : taskReflectionLabel}</span>
                    <span className="text-sm font-semibold text-[#7a32fc] flex items-center gap-2">{!isKidsProfile ? <span>{getTaskReflectionEmoji(Number(taskEnergy) || 0)}</span> : null}{isKidsProfile ? taskEnergy : `${taskEnergy}%`}</span>
                  </div>
                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    {isKidsProfile ? (
                      <div className="h-2 rounded-full bg-[#7a32fc]" style={{ width: `${Number(taskEnergy || 0) * 100}%` }}></div>
                    ) : (
                      <div
                        className="absolute inset-0 rounded-full"
                        style={{
                          background: taskEffortProgressGradient,
                          clipPath: `inset(0 ${Math.max(0, 100 - Number(taskEnergy || 0))}% 0 0)`,
                        }}
                      ></div>
                    )}
                  </div>
                  {!isKidsProfile && (
                    <div className="flex justify-between text-[10px] text-gray-400 font-semibold mt-1">
                      <span>Pouco esforço 🙂</span>
                      <span>Muito esforço 😫</span>
                    </div>
                  )}
                </div>
                <textarea className="w-full h-24 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:outline-none focus:border-[#7a32fc]/50 transition-all resize-none mb-4 font-medium" placeholder={isKidsProfile ? "Quer contar como foi?" : isConventionalAdult ? "Observação opcional sobre o esforço..." : "Quer adicionar alguma observação?"} value={taskNote} onChange={(e) => setTaskNote(e.target.value)} autoFocus ></textarea>
                <button onClick={handleConfirmTask} disabled={isTaskSaving || showTaskSuccess} className="w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 bg-green-500 text-white shadow-green-500/30 hover:opacity-90" > {isTaskSaving ? <React.Fragment><RefreshCcw size={20} className="animate-spin"/> Salvando...</React.Fragment> : showTaskSuccess ? <React.Fragment><CheckCircle size={24}/> Sucesso!</React.Fragment> : <React.Fragment><Check size={20} strokeWidth={3} /> Concluir</React.Fragment>} </button>
              </div>
            )}
          </div>
        </div>
      , document.body)}
    </div>
  );
};







