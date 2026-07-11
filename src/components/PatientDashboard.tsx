import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, LogOut, BookOpen, X, BatteryCharging, BatteryFull, Zap, Check, RefreshCcw, Smile, ChevronDown, ChevronLeft, ChevronRight, CheckCircle, Camera, Trash2, Pencil, Menu, MessageCircle, Settings, User, MapPin, Bell, CalendarDays, Clock, Ban, FileSignature, FileText } from 'lucide-react';
import { EvolutionBarChart } from './Charts';
import { CumulativeGrowthChart } from './CumulativeGrowthChart';
import { LogoVerto, SuccessOverlay, BigEnergySlider, ENERGY_TAGS } from './Common';
import { HistoryCard } from './History';
import { DrawingCanvas } from './DrawingCanvas';
import { dataService } from '../services/dataService';
import { SecureImage } from './SecureMedia';
import { calculateDomainMastery } from '../utils/clinicalMath';
import { ensureFreshSession } from '../lib/supabase';
import { getDefaultAnamnesisTemplate, getProfileTemplate, normalizeAnamnesisTemplate } from '../lib/anamnesisSchema';

type PortalSection = 'home' | 'appointments' | 'anamnesis' | 'notes' | 'tasks' | 'reports' | 'documents' | 'profile';

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
  const [taskEnergy, setTaskEnergy] = useState(50); 
  const [taskNote, setTaskNote] = useState(""); 
  const [interventionResponse, setInterventionResponse] = useState("");
  const [interventionImages, setInterventionImages] = useState<string[]>([]);
  const [isInterventionUploading, setIsInterventionUploading] = useState(false);
  const [taskStep, setTaskStep] = useState(1); 
  const [showTaskSuccess, setShowTaskSuccess] = useState(false); 
  const [selectedMood, setSelectedMood] = useState<any>(null); 
  const [hoveredMood, setHoveredMood] = useState<any>(null); 
  const [isMoodModalOpen, setIsMoodModalOpen] = useState(false); 
  const [moodNote, setMoodNote] = useState(""); 
  const [showMoodSuccess, setShowMoodSuccess] = useState(false); 
  const [isMessagesOpen, setIsMessagesOpen] = useState(false); 
  const [selectedTag, setSelectedTag] = useState<any>(null); 
  const [dailyCheckinDone, setDailyCheckinDone] = useState(false);
  const [familyNote, setFamilyNote] = useState("");
  const [familyImage, setFamilyImage] = useState<string | null>(null);
  const [familyImagePath, setFamilyImagePath] = useState<string | null>(null);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [showFamilySuccess, setShowFamilySuccess] = useState(false);
  const [isFamilySaving, setIsFamilySaving] = useState(false);
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
  const [portalAnamnesis, setPortalAnamnesis] = useState<any>(null);
  const [portalAnamnesisChecked, setPortalAnamnesisChecked] = useState(false);
  const [portalAnamnesisDraft, setPortalAnamnesisDraft] = useState<Record<string, any>>({});
  const [portalAnamnesisState, setPortalAnamnesisState] = useState({ loading: false, saving: false, message: '', error: '' });
  const [expandedAnamnesisSections, setExpandedAnamnesisSections] = useState<Record<string, boolean>>({});
  const portalAppointmentsRequestRef = useRef(0);
  const portalAnamnesisRequestRef = useRef(0);
  const portalAnamnesisLastLoadedAtRef = useRef(0);
  const portalNotificationsRequestRef = useRef(0);
  const portalNotificationsLastLoadedAtRef = useRef(0);
  const portalFilesRequestRef = useRef(0);

  const [isUploading, setIsUploading] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showStarCelebration, setShowStarCelebration] = useState(false);
  const [celebrationKey, setCelebrationKey] = useState(0);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [latestProtocolReference, setLatestProtocolReference] = useState<any>(null);
  const previousStarsRef = useRef<number>(0);
  const userType = typeof user.type === 'string' ? user.type.toLowerCase() : '';
  const hasExplicitPatientType = Boolean(userType);
  const userAge =
    typeof user.age === 'number'
      ? user.age
      : (user.age !== null && user.age !== undefined && Number.isFinite(Number(user.age)))
        ? Number(user.age)
        : null;
  const isKidsProfile =
    userType === 'kids_tea' ||
    (!hasExplicitPatientType && ((userAge !== null && userAge <= 12) || user.anamnesisData?.formType === 'child'));
  const isConventionalAdult = (userType === 'conventional' || userType === 'adult_conventional') && !isKidsProfile;
  const taskReflectionLabel = isConventionalAdult ? 'Humor' : 'Energia';
  const taskReflectionPrompt = isConventionalAdult
    ? 'Registre seu humor depois dessa tarefa'
    : 'Registre sua energia depois dessa tarefa';
  const taskReflectionHelp = isConventionalAdult
    ? 'Quanto mais alto o humor, mais fácil foi fazer essa tarefa'
    : 'Quanto mais energia, mais fácil foi fazer essa tarefa';
  const readOnlyNotice = "Você não possui um tratamento ativo no momento. Entre em contato com sua clínica para retomar o acompanhamento.";
  const portalContext = user?.portalContext && typeof user.portalContext === 'object' ? user.portalContext : {};
  const portalPatientId = String(patientPortalId || portalContext?.resolvedPatientId || user?.patientId || user?.patient_id || '').trim();
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
      try {
        const registration = await navigator.serviceWorker.getRegistration('/sw.js');
        const subscription = await registration?.pushManager.getSubscription();
        if (!cancelled) setNotificationSubscriptionReady(Boolean(subscription));
      } catch {
        if (!cancelled) setNotificationSubscriptionReady(false);
      }
    };

    void checkSubscription();
    return () => {
      cancelled = true;
    };
  }, [notificationStatus, isSettingsOpen]);

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
    const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {};
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
    if (result?.success) {
      setPortalAppointments(Array.isArray(result.data) ? result.data : []);
      setPortalAppointmentsLoaded(true);
      setPortalAppointmentsRangeKey(rangeKey);
      setPortalAppointmentsState({ loading: false, error: '', message: '' });
      return;
    }
    setPortalAppointmentsLoaded(true);
    setPortalAppointmentsRangeKey(rangeKey);
    setPortalAppointmentsState({ loading: false, error: result?.error || 'Não foi possível carregar suas consultas agora.', message: '' });
  };

  useEffect(() => {
    portalAppointmentsRequestRef.current += 1;
    setPortalAppointments([]);
    setPortalAppointmentsLoaded(false);
    setPortalAppointmentsRangeKey('');
    setPortalAppointmentsState({ loading: false, error: '', message: '' });
  }, [user?.id, user?.email, portalPatientId]);

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
    void loadPortalNotifications();
    const refreshNotifications = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - portalNotificationsLastLoadedAtRef.current < 30_000) return;
      void loadPortalNotifications();
    };
    window.addEventListener('focus', refreshNotifications);
    document.addEventListener('visibilitychange', refreshNotifications);
    return () => {
      window.removeEventListener('focus', refreshNotifications);
      document.removeEventListener('visibilitychange', refreshNotifications);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.email, portalPatientId]);

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
      setPortalAnamnesisDraft({ ...prefillAnswers, ...answers });
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
    setPortalAnamnesis(null);
    setPortalAnamnesisDraft({});
    setPortalAnamnesisChecked(false);
  }, [portalPatientId, user?.email]);

  useEffect(() => {
    const refreshAnamnesisWhenVisible = () => {
      if (document.visibilityState !== 'visible' || !portalPatientId) return;
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
    setPortalAppointmentsState((prev) => ({ ...prev, error: result?.error || 'Não foi possível carregar a consulta agora.' }));
  };

  const openPortalNotification = async (notification: any) => {
    const appointmentId = String(notification?.appointment_id || notification?.appointmentId || '').trim();
    const notificationType = String(notification?.type || '').replace(/_(24h|12h)$/i, '');
    void markPortalNotificationRead(notification, notificationType !== 'appointment_reminder');
    if (!appointmentId) return;
    const metadata = notification?.metadata && typeof notification.metadata === 'object' ? notification.metadata : {};
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
      patientName: metadata.patientName || notification?.patientName || user?.name || 'Paciente',
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
      setPortalAppointmentsState((prev) => ({ ...prev, error: result?.error || 'Não foi possível confirmar a consulta agora.' }));
      return;
    }
    const confirmedAppointment = result?.item || result?.appointment;
    if (confirmedAppointment) updatePortalAppointmentInList(confirmedAppointment);
    setPortalAppointmentsState((prev) => ({ ...prev, error: '', message: result?.message || 'Consulta confirmada com sucesso.' }));
  };

  const loadPortalRescheduleSlots = async (appointmentId: string, dateFrom?: string) => {
    if (!appointmentId) {
      setPortalRescheduleAvailability({ loading: false, error: 'Consulta não encontrada.', days: [], totalSlots: 0, maxSelectable: 3, message: '' });
      return;
    }
    setPortalRescheduleAvailability((prev: any) => ({ ...prev, loading: true, error: '', days: [], totalSlots: 0, maxSelectable: 3, message: '' }));
    const result = await dataService.getPortalAppointmentRescheduleSlots(appointmentId, { maxDays: 5, dateFrom });
    if (!result?.success) {
      setPortalRescheduleAvailability({ loading: false, error: result?.error || 'Não foi possível carregar horários disponíveis.', days: [], totalSlots: 0, maxSelectable: 3, message: '' });
      return;
    }
    const data = result.data || {};
    setPortalRescheduleAvailability({
      loading: false,
      error: '',
      days: Array.isArray(data.days) ? data.days : [],
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
    const appointmentId = String((portalAppointmentDetail?.appointment || selectedPortalAppointment)?.id || '').trim();
    setPortalSelectedRescheduleSlots([]);
    setPortalActionForm((prev) => ({ ...prev, requestedStart: '' }));
    setPortalModal('reschedule');
    void loadPortalRescheduleSlots(appointmentId);
  };

  const closePortalActionModal = () => {
    setPortalModal('');
    setPortalSelectedRescheduleSlots([]);
    setPortalRescheduleAvailability((prev: any) => ({ ...prev, loading: false, error: '' }));
  };

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
    if (resultAppointment) updatePortalAppointmentInList(resultAppointment);
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
        setSettingsMessage('As notificações não foram liberadas. Se você bloqueou antes, habilite nas configurações do navegador.');
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
    const startOfToday = new Date(currentTime);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    return list.filter((task: any) => {
      if (task?.completed || String(task?.status || '').toLowerCase() === 'completed') return false;
      const scheduledRaw = task?.scheduledAt || task?.scheduled_at;
      if (!scheduledRaw) return false;
      const scheduledAt = parseScheduledTaskDate(scheduledRaw);
      if (!scheduledAt) return false;
      return scheduledAt >= startOfToday && scheduledAt < endOfToday && scheduledAt <= currentTime;
    });
  }, [tasks, isKidsProfile, currentTime]);

  const conventionalMoodTags = [
    { id: 'family', label: 'Família', icon: '👨‍👩‍👧‍👦', color: 'bg-blue-100 text-blue-600' },
    { id: 'work', label: 'Trabalho', icon: '💼', color: 'bg-orange-100 text-orange-600' },
    { id: 'relationships', label: 'Relacionamentos', icon: '❤️', color: 'bg-pink-100 text-pink-600' },
    { id: 'money', label: 'Dinheiro', icon: '💰', color: 'bg-green-100 text-green-600' },
    { id: 'thoughts', label: 'Pensamentos', icon: '🧠', color: 'bg-purple-100 text-purple-600' },
    { id: 'others', label: 'Outros', icon: '🧩', color: 'bg-gray-100 text-gray-600' }
  ];
  const moodInfluenceTags = isConventionalAdult ? conventionalMoodTags : (energyTags || []);

  const moodOptions = [ { value: 10, emoji: "😫", label: "Esgotado", color: "bg-red-100 border-red-200 hover:bg-red-200" }, { value: 30, emoji: "😕", label: "Baixo", color: "bg-orange-100 border-orange-200 hover:bg-orange-200" }, { value: 50, emoji: "😐", label: "Normal", color: "bg-yellow-100 border-yellow-200 hover:bg-yellow-200" }, { value: 70, emoji: "🙂", label: "Bem", color: "bg-blue-100 border-blue-200 hover:bg-blue-200" }, { value: 90, emoji: "🤩", label: "Ótimo!", color: "bg-green-100 border-green-200 hover:bg-green-200" } ];
  const getTaskEnergyEmoji = (val: number) => {
    if (val < 20) return "😫";
    if (val < 40) return "😕";
    if (val < 60) return "😐";
    if (val < 80) return "🙂";
    return "🤩";
  };

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
    const scoredEvents = sourceHistory
      .map((h: any) => {
        const scoreRaw = getEventScore(h);
        if (scoreRaw === null) return null;
        const score = Math.max(0, Math.min(1, Number(scoreRaw) || 0));
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

    const isVbMappProtocol = /vb[\s-]?mapp/i.test(String(selectedProto?.title || ''));
    const vbmappCriterion = Number((selectedProto as any)?.masteryCriterion ?? (selectedProto as any)?.vbmapp_mastery_criterion ?? 5) || 5;

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
          .map((event: any) => ({
            title: event?._title || '',
            score: event?._score,
            maxScore: 1,
            consecutive_successes: event?.consecutive_successes,
            created_at: event?.created_at || event?.date || null
          }));
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
    const patientEmail = String(user?.email || '').trim().toLowerCase();
    return (Array.isArray(history) ? history : []).filter((item: any) => {
      const isFamily = item.type === 'family_note' || item.type === 'photo';
      if (!isFamily) return false;
      const itemPatientId = String(item?.patientId || item?.patient_id || '').trim();
      const itemPatientEmail = String(item?.patient_email || item?.patientEmail || item?.email || '').trim().toLowerCase();
      if (itemPatientId) return patientKeys.has(itemPatientId);
      if (itemPatientEmail) return Boolean(patientEmail && itemPatientEmail === patientEmail);
      return false;
    });
  }, [history, portalPatientId, user?.id, user?.patientId, user?.patient_id, user?.email]);

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
    const stars = portalFamilyHistory.filter((item: any) => {
      const isFamily = item.type === 'family_note' || item.type === 'photo';
      const hasStarMarker = /\u2b50|⭐/.test(String(item?.subject || '')) || /\[STAR\]/i.test(String(item?.note || item?.text || ''));
      return isFamily && (Number(item?.score ?? 0) >= 1 || hasStarMarker);
    }).length;
    const portalStarPatientKeys = new Set(
      [portalPatientId, user?.id, user?.patientId, user?.patient_id]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );
    const portalStarPatientEmail = String(user?.email || '').trim().toLowerCase();
    const sharedNoteBelongsToPortalPatient = (item: any) => {
      const notePatientId = String(item?.patientId ?? item?.patient_id ?? '').trim();
      const notePatientEmail = String(item?.patient_email ?? item?.email ?? '').trim().toLowerCase();
      if (notePatientId) return portalStarPatientKeys.has(notePatientId);
      if (notePatientEmail) return Boolean(portalStarPatientEmail && notePatientEmail === portalStarPatientEmail);
      return false;
    };
    const scopedSharedNotes = (Array.isArray(sharedNotes) ? sharedNotes : []).filter(sharedNoteBelongsToPortalPatient);
    const sharedFamilyStars = scopedSharedNotes.filter((item: any) => {
      const type = String(item?.type || '').toLowerCase();
      const visibility = String(item?.visibility || '').toLowerCase();
      const isFamily = type === 'family_note' || type === 'photo' || visibility === 'family';
      const hasStarMarker = /\u2b50|⭐/.test(String(item?.subject || '')) || /\[STAR\]/i.test(String(item?.text || item?.note || ''));
      return isFamily && (Number(item?.score ?? 0) >= 1 || hasStarMarker);
    }).length;
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
    const milestoneEventStars = Array.from(milestoneBySource.values()).filter((e) => e.awarded).length;
    return { weekLogs, weekPhotos, stars: Math.max(stars, sharedFamilyStars, milestoneEventStars) };
  }, [portalFamilyHistory, sharedNotes, portalPatientId, user?.id, user?.patientId, user?.patient_id, user?.email]);
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
    const normalized = normalizePortalText(value).toLowerCase();
    return /(?:^|\/)(?:verto-3d(?:-transparent)?|logoverto|verto-logo)\.(?:png|webp|jpe?g)(?:$|[?#])/.test(normalized);
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
  const getPortalClinicInitials = (value: any) => {
    const words = normalizePortalText(value || 'Clínica')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    return words.map((word) => word.charAt(0).toUpperCase()).join('') || 'C';
  };
  const renderPortalClinicLogo = (logoUrl: any, clinicName: any, className = 'h-full w-full object-contain p-1') => {
    const fallback = (
      <span className="flex h-full w-full items-center justify-center bg-slate-100 text-xs font-semibold text-slate-700">
        {getPortalClinicInitials(clinicName)}
      </span>
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
  const isPortalSharedNote = (note: any) => {
    if (!note || hasPortalPrivateFlag(note) || !noteBelongsToPortalPatient(note)) return false;
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
      name: firstPortalText(file?.fileName, file?.file_name, file?.name) || 'Documento',
      category: firstPortalText(file?.source, file?.mimeType, file?.mime_type) || 'Documento',
      createdAt: firstPortalText(file?.createdAt, file?.created_at),
      href: firstPortalText(file?.signedUrl, file?.url),
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

  useEffect(() => {
    if (!isKidsProfile) return;
    const patientKey = String(user?.id || user?.email || 'unknown');
    const storageKey = `kids_star_seen_total:${patientKey}`;
    const stored = Number(window.localStorage.getItem(storageKey) || '0');
    const baseline = Number.isFinite(stored) ? stored : 0;
    const previous = Math.max(previousStarsRef.current || 0, baseline);
    const current = Number(kidsGamification.stars || 0);
    if (current > previous) {
      setCelebrationKey((v) => v + 1);
      setShowStarCelebration(true);
      const timer = window.setTimeout(() => setShowStarCelebration(false), 1800);
      previousStarsRef.current = current;
      window.localStorage.setItem(storageKey, String(current));
      return () => window.clearTimeout(timer);
    }
    previousStarsRef.current = current;
    if (current >= baseline) {
      window.localStorage.setItem(storageKey, String(current));
    }
  }, [kidsGamification.stars, isKidsProfile, user?.id, user?.email]);

  const familyPhotoCountToday = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return portalFamilyHistory.filter((item: any) => {
      if (item?.type !== 'photo') return false;
      const raw = item.date || item.created_at;
      if (!raw) return false;
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) return false;
      return parsed.toISOString().slice(0, 10) === todayStr;
    }).length;
  }, [portalFamilyHistory]);
  const hasReachedFamilyPhotoLimitToday = familyPhotoCountToday >= FAMILY_DAILY_PHOTO_LIMIT;

  const handleConfirmFamilyNote = async () => {
    if (isReadOnlyMode) return;
    if ((familyNote.trim() || familyImage) && !isFamilySaving) {
      setIsFamilySaving(true);
      try {
        let persistedImage = familyImage || undefined;
        let persistedImagePath: string | undefined = familyImagePath || undefined;
        if (persistedImage && persistedImage.startsWith('data:image/')) {
          const extension = persistedImage.includes('image/jpeg') ? 'jpg' : persistedImage.includes('image/webp') ? 'webp' : 'png';
          const ownerPatientId = String(portalPatientId || user?.patientId || user?.patient_id || user?.id || '').trim();
          if (!ownerPatientId) {
            throw new Error('Não encontramos o paciente vinculado para salvar a foto.');
          }
          const fileName = `${ownerPatientId}/family-${Date.now()}.${extension}`;
          const uploadResult = await dataService.uploadDataUrl('patient-photos', fileName, persistedImage, `image/${extension === 'jpg' ? 'jpeg' : extension}`);
          if (uploadResult?.success && uploadResult.url) {
            persistedImage = uploadResult.url;
            persistedImagePath = uploadResult.path;
          } else {
            throw new Error(`Não foi possível salvar a foto no armazenamento: ${uploadResult?.error || 'erro desconhecido'}`);
          }
        }

        if (!portalPatientId) {
          throw new Error('Não encontramos um paciente vinculado a este acesso. Entre em contato com a clínica.');
        }
        const saveResult = await onAddFamilyNote(portalPatientId, familyNote, persistedImage, persistedImagePath);
        if (saveResult?.success === false) {
          throw new Error(saveResult?.error || 'Não foi possível persistir o registro no histórico.');
        }
        setFamilyNote("");
        setFamilyImage(null);
        setFamilyImagePath(null);
        setIsFamilyLogOpen(false);
        setShowFamilySuccess(true);
        window.setTimeout(() => setShowFamilySuccess(false), 1600);
      } catch (error: any) {
        alert(error?.message || 'Não foi possível salvar o registro da família. Tente novamente.');
      } finally {
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
      setIsUploading(true);
      try {
        const ownerPatientId = String(portalPatientId || user?.patientId || user?.patient_id || user?.id || '').trim();
        if (!ownerPatientId) {
          alert('Não encontramos o paciente vinculado para salvar a foto.');
          setIsUploading(false);
          e.target.value = '';
          return;
        }
        const fileName = `${ownerPatientId}/${Date.now()}-${file.name}`;
        const result = await dataService.uploadFile('patient-photos', fileName, file);
        
        if (result.success && result.url) {
          setFamilyImage(result.url);
          setFamilyImagePath(result.path || null);
          setIsDrawingMode(true);
        } else {
          alert('Erro ao enviar imagem. Tente novamente em alguns instantes.');
        }
      } catch (error) {
        console.error('Upload error:', error);
      } finally {
        setIsUploading(false);
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
              onClick={() => setIsSettingsOpen(false)}
              className="rounded-2xl bg-white/15 p-2 text-white transition hover:bg-white/25"
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
                disabled={notificationSubscriptionReady || isEnablingNotifications || notificationStatus === 'unsupported'}
                onChange={() => void enablePatientNotifications()}
              />
              <span>
                <span className="flex items-center gap-2 text-sm font-black text-emerald-800">
                  <Bell size={16} /> Permitir notificações neste dispositivo
                </span>
                <span className="mt-1 block text-xs font-medium leading-relaxed text-emerald-700">
                  Use esta opção se você pulou ou não aprovou o aviso inicial. Se o navegador bloqueou, libere nas configurações do site.
                </span>
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
    { id: 'appointments', label: isKidsProfile ? 'Calendário' : 'Consultas', icon: CalendarDays },
    { id: 'anamnesis', label: 'Anamnese', icon: FileSignature },
    { id: 'notes', label: 'Anotações', icon: MessageCircle },
    { id: 'documents', label: 'Documentos', icon: BookOpen },
    { id: 'reports', label: 'Relatório', icon: FileText },
    ...(!isKidsProfile ? [{ id: 'tasks', label: 'Tarefas', icon: Zap }] : []),
    { id: 'profile', label: 'Perfil', icon: Settings }
  ] as Array<{ id: PortalSection; label: string; icon: any }>;

  const portalMenu = isKidsProfile ? null : (
    <div className={`${isKidsProfile ? 'mb-4' : 'mb-6'} overflow-x-auto no-scrollbar`}>
      <div className="flex min-w-max gap-2 rounded-[24px] border border-white/70 bg-white/80 p-2 shadow-sm backdrop-blur">
        {portalMenuItems.map((item) => {
          const Icon = item.icon;
          const active = portalSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setPortalSection(item.id);
                setIsMenuOpen(false);
              }}
              className={`flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-black transition ${active ? 'bg-[#7a32fc] text-white shadow-lg shadow-purple-500/20' : 'text-slate-500 hover:bg-purple-50 hover:text-[#7a32fc]'}`}
            >
              <Icon size={15} />
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );

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
    const metadata = notification?.metadata && typeof notification.metadata === 'object' ? notification.metadata : {};
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
    const metadata = notification?.metadata && typeof notification.metadata === 'object' ? notification.metadata : {};
    const notificationType = normalizePortalLower(notification?.type).replace(/_(24h|12h)$/i, '');
    if (notificationType && notificationType !== 'appointment_reminder') {
      return firstPortalText(notification?.message) || 'Atualização da sua consulta disponível.';
    }
    const scheduledAt = firstPortalText(
      metadata.scheduledAt,
      notification?.scheduled_for,
      notification?.scheduledFor,
      notification?.scheduledAt,
      notification?.scheduled_at
    );
    const patientName = firstPortalText(
      metadata.patientName,
      notification?.patientName,
      notification?.patient_name,
      displayName,
      user?.name,
      'Paciente'
    );
    const dayText = formatPortalReminderDay(scheduledAt);
    const timeText = formatPortalTime(scheduledAt);
    const whenText = [dayText ? `dia ${dayText}` : '', timeText ? `às ${timeText}` : ''].filter(Boolean).join(' ');
    if (whenText) {
      return `Lembrete de consulta de ${patientName} ${whenText}. Toque para confirmar, remarcar ou cancelar.`;
    }
    return firstPortalText(notification?.message) || `Lembrete de consulta de ${patientName}. Toque para confirmar, remarcar ou cancelar.`;
  };

  const portalNotificationsSummary = !portalNotificationsLoaded ? (
    <div className="mb-4 h-20 animate-pulse rounded-[24px] border border-slate-100 bg-white/70" />
  ) : portalNotifications.length > 0 ? (
    <div className="mb-4 space-y-2">
      {portalNotifications.slice(0, 3).map((notification: any) => {
        const metadata = notification?.metadata && typeof notification.metadata === 'object' ? notification.metadata : {};
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

  const portalHomeSummary = (
    <React.Fragment>
      {portalAnamnesisTopNotice}
      {portalNotificationsSummary}
      {!isKidsProfile && (
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
    const fieldDisabled = portalAnamnesisLocked || isPrefilledByClinic;
    const fieldClass = "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-[#7a32fc] disabled:bg-slate-50 disabled:text-slate-400";
    const update = (nextValue: any) => setPortalAnamnesisDraft((prev) => ({ ...prev, [question.id]: nextValue }));
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
    if (!portalPatientId || !portalAnamnesis?.request?.id || portalAnamnesisLocked) return;
    setPortalAnamnesisState((prev) => ({ ...prev, saving: true, error: '', message: '' }));
    const result = await dataService.savePortalAnamnesisDraft(portalPatientId, portalAnamnesisDraft, portalAnamnesis.request.id);
    if (!result?.success) {
      setPortalAnamnesisState({ loading: false, saving: false, message: '', error: result?.error || 'Não foi possível salvar o rascunho.' });
      return;
    }
    setPortalAnamnesisState({ loading: false, saving: false, message: 'Rascunho salvo.', error: '' });
    await loadPortalAnamnesis();
  };

  const submitPortalAnamnesis = async () => {
    if (!portalPatientId || !portalAnamnesis?.request?.id || portalAnamnesisLocked) return;
    const confirmed = window.confirm('Enviar a ficha para a clínica? Após o envio, novas edições dependem de uma nova solicitação.');
    if (!confirmed) return;
    setPortalAnamnesisState((prev) => ({ ...prev, saving: true, error: '', message: '' }));
    const result = await dataService.submitPortalAnamnesis(portalPatientId, portalAnamnesisDraft, portalAnamnesis.request.id);
    if (!result?.success) {
      setPortalAnamnesisState({ loading: false, saving: false, message: '', error: result?.error || 'Não foi possível enviar a ficha.' });
      return;
    }
    setPortalAnamnesisState({ loading: false, saving: false, message: result?.message || 'Ficha enviada para a clínica.', error: '' });
    await loadPortalAnamnesis();
  };

  const portalPlaceholderPanel = (label: string) => (
    <div className="mb-6 rounded-[28px] border border-dashed border-purple-100 bg-white/70 p-6 text-center text-sm font-semibold text-slate-500">
      {label}
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
    if (!text || familyAnnotationState.saving || isReadOnlyMode) return;
    setFamilyAnnotationState({ saving: true, message: '', error: '' });
    if (!portalPatientId) {
      setFamilyAnnotationState({ saving: false, message: '', error: 'Não encontramos um paciente vinculado a este acesso. Entre em contato com a clínica.' });
      return;
    }
    const result = await onAddFamilyNote(portalPatientId, text, undefined, undefined, 'note');
    if (result?.success === false) {
      setFamilyAnnotationState({ saving: false, message: '', error: result?.error || 'Não foi possível enviar a anotação.' });
      return;
    }
    setFamilyAnnotation('');
    setFamilyAnnotationState({ saving: false, message: 'Anotação enviada para a equipe.', error: '' });
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
                {document.href ? (
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

  const portalReportPanel = (
    <div className="mb-6 rounded-[28px] border border-purple-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#7a32fc]">Relatório</p>
          <h2 className="text-lg font-black text-slate-900">Tempo em consulta</h2>
        </div>
        <span className="rounded-full bg-purple-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#7a32fc]">
          Total {formatPortalDuration(portalReportTotalMinutes)}
        </span>
      </div>
      {portalAppointmentsState.loading || !portalAppointmentsLoaded ? (
        <div className="rounded-2xl bg-purple-50 px-4 py-3 text-sm font-semibold text-purple-700">Carregando relatório...</div>
      ) : portalReportRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-purple-100 bg-purple-50/60 px-4 py-5 text-center text-sm font-semibold text-purple-700">
          Nenhuma consulta realizada com duração registrada no período.
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
                      {appointment?.serviceType || 'Consulta'} · {appointment?.professionalName || 'Equipe'}
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
          Editar dados permitidos
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
  const activePortalAppointment = portalAppointmentDetail?.appointment || selectedPortalAppointment;
  const activePortalStatus = String(activePortalAppointment?.status || '').toUpperCase();
  const activePortalConfirmationStatus = String(activePortalAppointment?.patientConfirmationStatus || activePortalAppointment?.patient_confirmation_status || '').toUpperCase();
  const activePortalConfirmed = activePortalStatus.includes('CONFIRM') || activePortalConfirmationStatus.includes('CONFIRM');
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
  const portalAppointmentsPanel = (
    <div className="mb-6 rounded-[28px] border border-purple-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Mini calendário</p>
          <h2 className="text-lg font-black text-slate-900">Minhas consultas</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">Toque em um dia marcado para abrir a consulta.</p>
        </div>
        <button type="button" onClick={() => void loadPortalAppointments(getPortalCalendarMonthRange(portalCalendarMonth))} className="rounded-2xl border border-purple-100 px-3 py-2 text-xs font-bold text-[#7a32fc]" aria-label="Atualizar consultas">
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
        <div className="rounded-2xl bg-purple-50 px-4 py-3 text-sm font-semibold text-purple-700">Carregando consultas...</div>
      ) : portalAppointmentsState.error ? (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{portalAppointmentsState.error}</div>
      ) : portalMonthAppointments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-purple-100 bg-purple-50/60 px-4 py-5 text-center text-sm font-semibold text-purple-700">
          Nenhuma consulta encontrada neste mês.
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
                    aria-label={cell.appointments.length > 0 ? `Abrir consulta de ${cell.day}` : `Dia ${cell.day} sem consulta`}
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
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Consultas de {selectedPortalCalendarLabel}</p>
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
                      <span className="block truncate text-xs font-semibold text-slate-500">{appointment.serviceType || 'Consulta'}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${getPortalStatusPillClass(appointment.status)}`}>
                      {getPortalStatusShortLabel(appointment.status)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {selectedPortalCalendarDateKey && selectedPortalCalendarAppointments.length === 0 && (
            <div className="rounded-2xl border border-dashed border-purple-100 bg-purple-50/60 px-4 py-4 text-center text-sm font-semibold text-purple-700">
              Nenhuma consulta neste dia.
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
            <p className="text-xs font-medium text-[#7a32fc]">Detalhes da consulta</p>
            <h3 className="mt-1 text-xl font-semibold text-slate-900">{activePortalAppointment?.patientName || 'Paciente'}</h3>
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
            <p className="mt-1 text-xs font-medium text-emerald-700">A clínica já recebeu sua confirmação desta consulta.</p>
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
          <button type="button" disabled={portalActionBlocked} onClick={() => openPortalRescheduleModal()} className="flex items-center justify-center gap-2 rounded-2xl border border-purple-100 bg-white px-4 py-3 text-sm font-semibold text-[#7a32fc] disabled:opacity-50">
            <RefreshCcw size={17} /> Solicitar remarcação
          </button>
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
                    <p className="mt-2 text-xs font-semibold text-purple-700">Consulta atual: {formatPortalDateTime(activePortalAppointment.scheduledAt)}</p>
                  )}
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  <span>Opções selecionadas</span>
                  <span className="text-[#7a32fc]">{portalSelectedRescheduleSlots.length}/{Math.max(1, Math.min(3, Number(portalRescheduleAvailability.maxSelectable || 3) || 3))}</span>
                </div>
                {portalRescheduleAvailability.rangeLabel && (
                  <div className="rounded-2xl border border-slate-100 bg-white px-4 py-2 text-xs font-medium text-slate-600">
                    Semana exibida: <span className="font-semibold text-slate-800">{portalRescheduleAvailability.rangeLabel}</span>
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
                    
                    <div className="relative">
                      <button 
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
                            {!isReadOnlyMode && (
                              <button 
                                onClick={() => { setIsFamilyLogOpen(true); setIsMenuOpen(false); }}
                                className="w-full flex items-center gap-3 p-3 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
                              >
                                <BookOpen size={18} /> Diário da Família
                              </button>
                            )}
                            <button
                              onClick={() => { setIsSettingsOpen(true); setIsMenuOpen(false); }}
                              className="w-full flex items-center gap-3 p-3 text-sm font-medium text-[#7a32fc] hover:bg-purple-50 rounded-xl transition-colors"
                            >
                              <Settings size={18} /> Configurações
                            </button>
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
                {portalSection === 'tasks' && portalPlaceholderPanel('Tarefas enviadas pela clínica aparecerão aqui.')}
                {portalSection === 'reports' && portalReportPanel}
                {portalSection === 'documents' && portalDocumentsPanel}
                {portalSection === 'profile' && portalProfilePanel}

                {portalSection === 'home' && (
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
                    <div className="mb-4 sm:mb-5 px-1 sm:px-2">
                      <h2 className="text-2xl sm:text-3xl font-semibold text-[#7a32fc] flex items-center justify-center gap-2 text-center">
                        <span role="img" aria-label="Troféu">🏆</span>
                      </h2>
                      <p className="mt-1 text-center text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        Protocolo ativo atual
                      </p>
                    </div>
                    <div className="mb-4 sm:mb-5 px-1 sm:px-2 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 items-end">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-blue-500 mb-1.5">Data Atual</p>
                        <div className="relative">
                          <select
                            className="w-full bg-blue-50 border border-blue-100 text-[10px] sm:text-[11px] font-semibold text-[#7a32fc] px-3 py-2 rounded-xl outline-none appearance-none uppercase tracking-wider"
                            value={selectedBaseDate}
                            onChange={(e) => setSelectedBaseDate(e.target.value)}
                            disabled={activeProtocolSnapshots.length === 0}
                          >
                            {activeProtocolSnapshots.length === 0 && <option value="">Sem dados avaliados</option>}
                            {activeProtocolSnapshots.map((date: any) => (
                              <option key={date} value={date}>{formatFilterDate(String(date))}</option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-[#7a32fc] pointer-events-none" size={10} />
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-600 mb-1.5">Data Comparação</p>
                        <div className="relative">
                          <select
                            className="w-full bg-emerald-50 border border-emerald-100 text-[10px] sm:text-[11px] font-semibold text-emerald-700 px-3 py-2 rounded-xl outline-none appearance-none uppercase tracking-wider"
                            value={selectedCompareDate}
                            onChange={(e) => setSelectedCompareDate(e.target.value)}
                            disabled={activeProtocolSnapshots.length === 0}
                          >
                            <option value="">Sem comparação</option>
                            {activeProtocolSnapshots
                              .filter((date: any) => date !== selectedBaseDate)
                              .map((date: any) => (
                                <option key={`compare-${date}`} value={date}>{formatFilterDate(String(date))}</option>
                              ))}
                          </select>
                          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-600 pointer-events-none" size={10} />
                        </div>
                      </div>
                    </div>
                    <div className="w-full min-h-[300px] sm:min-h-[350px]">
                      <EvolutionBarChart chartData={kidChartData} maxScore={100} />
                    </div>
                    <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-widest text-center mt-2">Filtro por datas para comparação do progresso</p>
                </div>

                <div className="mb-6">
                  <CumulativeGrowthChart
                    patientId={portalPatientId || user.id}
                    protocols={protocols}
                    protocolId={activeKidsProtocol?.id}
                    history={activeKidsProtocolEvents.map((event: any) => ({
                      ...event,
                      patientId: event?.patientId || event?.patient_id || portalPatientId || user.id,
                      patient_id: event?.patient_id || event?.patientId || portalPatientId || user.id
                    }))}
                  />
                </div>

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
                              className="w-full max-h-40 object-cover rounded-xl border border-blue-100"
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
                  <button onClick={() => setIsFamilyLogOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600" > <X size={24} /> </button> 
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
                            <button onClick={() => { setFamilyImage(null); setFamilyImagePath(null); }} className="p-1.5 bg-white rounded-full text-red-500 shadow-sm"><Trash2 size={14}/></button>
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
                  </div>
                  <button 
                    onClick={handleConfirmFamilyNote} 
                    disabled={isFamilySaving || (!familyNote.trim() && !familyImage)}
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
  const handleConfirmMood = () => { 
    if (isReadOnlyMode) return;
    if (selectedMood) { 
      setShowMoodSuccess(true); 
      const moodValue = selectedMood.value;
      setTimeout(() => { onMoodCheckin(moodValue, moodNote, selectedMood.emoji, selectedTag); setIsMoodModalOpen(false); setShowMoodSuccess(false); setMoodNote(""); setSelectedMood(null); setSelectedTag(null); setDailyCheckinDone(true); }, 2000); 
    } 
  }; 
  const openTaskModal = (task: any) => {
    if (isReadOnlyMode) return;
    setSelectedTask(task);
    setTaskEnergy(50);
    setTaskNote("");
    setInterventionResponse("");
    setInterventionImages([]);
    if (task.type === 'intervention' && isConventionalAdult) {
      setTaskStep(0);
    } else {
      setTaskStep(1);
    }
  };
  const handleEnergyCommit = () => { setTaskStep(2); }; 
  const handleConfirmTask = () => { 
    if (isReadOnlyMode) return;
    if (selectedTask) { 
      setShowTaskSuccess(true); 
      const interventionDetails = [
        interventionResponse?.trim() ? `Resposta:\n${interventionResponse.trim()}` : '',
        taskNote?.trim() ? `Observação:\n${taskNote.trim()}` : '',
        interventionImages.length > 0 ? `Anexos:\n${interventionImages.join('\n')}` : ''
      ].filter(Boolean).join('\n\n');
      const finalNote = selectedTask.type === 'intervention'
        ? interventionDetails
        : taskNote;
      setTimeout(() => { 
        onCompleteTask(selectedTask, taskEnergy, finalNote); 
        setShowTaskSuccess(false); 
        setSelectedTask(null); 
        setInterventionResponse("");
        setInterventionImages([]);
        setTaskStep(1);
      }, 2000); 
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
    <div className={`min-h-screen p-6 flex flex-col overflow-x-hidden ${isConventionalAdult ? 'bg-gradient-to-b from-[#FFF9F3] to-[#F8F5FF]' : 'bg-[#F4F7FE]'}`}> 
      {(showTaskSuccess || showMoodSuccess) && <SuccessOverlay />} 
      <AnimatePresence>{patientSettingsModal}</AnimatePresence>
      {portalAppointmentDetailModal}
      {portalActionModal}
      {isMessagesOpen && ( 
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-fade-in" onClick={() => setIsMessagesOpen(false)}> 
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl animate-pop relative" onClick={e => e.stopPropagation()}> 
            <button onClick={() => setIsMessagesOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20}/></button> 
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
            <LogoVerto size={50} showText={true} className="drop-shadow-sm shrink-0" />
          )}
          <div className="w-px h-8 bg-gray-200 mx-2 hidden sm:block"></div>
          <div>
            <h1 className="text-2xl font-semibold text-gray-800 tracking-tight leading-none"> Olá, <span className="text-[#7a32fc]">{displayName}</span>! </h1> 
            <p className="text-gray-400 font-medium mt-1 text-xs"> Vamos cuidar de você hoje? </p> 
          </div>
        </div> 
        
        <div className="relative self-end sm:self-auto"> 
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-3 bg-white rounded-2xl shadow-sm text-gray-500 hover:bg-white transition-all border border-white/50 relative"
          >
            <Menu size={20} />
            {portalSharedNotes.length > 0 && <div className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border border-white"></div>}
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
                    onClick={() => { setIsMessagesOpen(true); setIsMenuOpen(false); }}
                    className="w-full flex items-center justify-between p-3 text-sm font-medium text-[#7a32fc] hover:bg-blue-50 rounded-xl transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <MessageCircle size={18} /> Mensagens
                    </div>
                    {portalSharedNotes.length > 0 && (
                      <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                        {portalSharedNotes.length}
                      </span>
                    )}
                  </button>
                )}
                <button
                  onClick={() => { setIsSettingsOpen(true); setIsMenuOpen(false); }}
                  className="w-full flex items-center gap-3 p-3 text-sm font-medium text-[#7a32fc] hover:bg-purple-50 rounded-xl transition-colors"
                >
                  <Settings size={18} /> Configurações
                </button>
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
      {portalSection === 'tasks' && portalPlaceholderPanel('Tarefas enviadas pela clínica aparecerão aqui.')}
      {portalSection === 'reports' && portalReportPanel}
      {portalSection === 'documents' && portalDocumentsPanel}
      {portalSection === 'profile' && portalProfilePanel}
      {portalSection === 'home' && (
        <React.Fragment>
      {!dailyCheckinDone ? ( 
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
      ) : ( 
        <div className="bg-white rounded-[32px] p-6 shadow-sm border border-gray-100 mb-6 animate-fade-in flex items-center justify-between"> 
          <div className="flex items-center gap-4"> 
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center text-green-600"> <Check size={24} /> </div> 
            <div> <h3 className="font-semibold text-gray-800 tracking-tight">{isConventionalAdult ? 'Sentimento Registrado!' : 'Energia Registrada!'}</h3> <p className="text-xs text-gray-400">Obrigado por compartilhar.</p> </div> 
          </div> 
          <button disabled={isReadOnlyMode} onClick={() => setDailyCheckinDone(false)} className="text-[10px] font-semibold text-[#7a32fc] bg-[#7a32fc]/10 px-4 py-2 rounded-xl hover:bg-[#7a32fc]/20 transition-colors flex items-center gap-2 uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed" > <RefreshCcw size={14} /> Ajustar </button> 
        </div> 
      )} 
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
      </div> 
        </React.Fragment>
      )}
      {isMoodModalOpen && selectedMood && ( 
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"> 
          <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl animate-pop relative"> 
            <button onClick={closeMoodModal} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600" > <X size={24} /> </button> 
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
            <button onClick={handleConfirmMood} disabled={showMoodSuccess} className={`w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${showMoodSuccess ? 'bg-green-500 text-white' : 'bg-[#7a32fc] text-white shadow-[#7a32fc]/30 hover:opacity-90'}`} > {showMoodSuccess ? <React.Fragment><CheckCircle size={24}/> Sucesso!</React.Fragment> : <React.Fragment><Check size={20} strokeWidth={3} /> Registrar</React.Fragment>} </button> 
          </div> 
        </div> 
      )} 
      {selectedTask && ( 
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"> 
          <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl animate-pop relative"> 
            <button onClick={closeTaskModal} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600" > <X size={24} /> </button> 
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

                {(!isConventionalAdult || taskStep === 1) && (
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

                    {isConventionalAdult ? (
                      <button
                        onClick={handleConfirmTask}
                        disabled={showTaskSuccess || !interventionResponse.trim()}
                        className={`w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${showTaskSuccess ? 'bg-green-500 text-white' : 'bg-green-600 text-white shadow-green-600/30 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                      >
                        {showTaskSuccess ? <React.Fragment><CheckCircle size={24}/> Sucesso!</React.Fragment> : <React.Fragment><Check size={20} strokeWidth={3} /> Enviar Resposta</React.Fragment>}
                      </button>
                    ) : (
                      <button 
                        onClick={handleConfirmTask} 
                        disabled={showTaskSuccess || !interventionResponse.trim()} 
                        className={`w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${showTaskSuccess ? 'bg-green-500 text-white' : 'bg-green-600 text-white shadow-green-600/30 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                      > 
                        {showTaskSuccess ? <React.Fragment><CheckCircle size={24}/> Sucesso!</React.Fragment> : <React.Fragment><Check size={20} strokeWidth={3} /> Enviar Resposta</React.Fragment>} 
                      </button>
                    )}
                  </React.Fragment>
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
                                onClick={() => { setTaskEnergy(score); handleEnergyCommit(); }}
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
                              onClick={() => { setTaskEnergy(score); handleEnergyCommit(); }}
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
                        onChange={(e: any) => setTaskEnergy(Number(e.target.value) || 0)}
                        onCommit={handleEnergyCommit}
                        label={taskReflectionLabel}
                        labelHelp={taskReflectionHelp}
                        scaleLabels={isConventionalAdult ? ['Difícil', 'Moderado', 'Leve'] : ['Baixa', 'Média', 'Alta']}
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
                    <span className="text-sm font-semibold text-[#7a32fc] flex items-center gap-2">{!isKidsProfile ? <span>{getTaskEnergyEmoji(Number(taskEnergy) || 0)}</span> : null}{isKidsProfile ? taskEnergy : `${taskEnergy}%`}</span> 
                  </div> 
                  <div className="w-full bg-gray-100 rounded-full h-2"> 
                    <div className="bg-[#7a32fc] h-2 rounded-full" style={{ width: isKidsProfile ? `${taskEnergy * 100}%` : `${taskEnergy}%` }}></div> 
                  </div> 
                  {isConventionalAdult && (
                    <div className="flex justify-between text-[10px] text-gray-400 font-semibold mt-1">
                      <span>Maior esforço 😟</span>
                      <span>Menor esforço 🙂</span>
                    </div>
                  )}
                </div> 
                <textarea className="w-full h-24 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:outline-none focus:border-[#7a32fc]/50 transition-all resize-none mb-4 font-medium" placeholder={isKidsProfile ? "Quer contar como foi?" : isConventionalAdult ? "Observação opcional sobre o esforço..." : "Quer adicionar alguma observação?"} value={taskNote} onChange={(e) => setTaskNote(e.target.value)} autoFocus ></textarea> 
                <button onClick={handleConfirmTask} disabled={showTaskSuccess} className="w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 bg-green-500 text-white shadow-green-500/30 hover:opacity-90" > {showTaskSuccess ? <React.Fragment><CheckCircle size={24}/> Sucesso!</React.Fragment> : <React.Fragment><Check size={20} strokeWidth={3} /> Concluir</React.Fragment>} </button> 
              </div> 
            )} 
          </div> 
        </div> 
      )} 
    </div> 
  ); 
};







