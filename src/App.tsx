import React, { Suspense, useState, useEffect, useMemo, useRef } from 'react';
import { GlobalStyles, ENERGY_TAGS, ADULT_CONVENTIONAL_TAGS } from './components/Common';
import { testSupabaseConnection, getSupabase, ensureFreshSession } from './lib/supabase';
import { Database, CheckCircle2, AlertCircle, Lock, WifiOff, LayoutDashboard, RefreshCw } from 'lucide-react';
import { clearSensitiveOfflineCacheForUser, getFailedSyncRecords, resetFailedSyncRecord, syncOfflineData } from './services/localDb';
import { dataService } from './services/dataService';
import { formatProfessionalRegistry } from './utils/professionalRegistry';
import { buildAbaPromptSnapshot, resolveAbaPromptLevel, resolveTrialPromptInfo } from './utils/abaPromptLevels';
import { isAbaV2Enabled } from './utils/featureFlags';
import { formatPatientLabel, safeDisplayValue, sanitizeTechnicalErrorMessage } from './utils/displayLabels';
import {
  isRecoverableFailedOfflineSyncRecord,
} from './utils/offlineSyncResilience';
import {
  addMinutesToTime,
  appointmentBlocksConflict,
  appointmentTimesOverlap as scheduleTimesOverlap,
  buildAppointmentDateTime,
  buildRecurrenceDateKeys,
  calculateAppointmentEnd,
  findScheduleRoomConfig,
  getAppointmentDurationMinutes,
  normalizeAppointmentTime,
  normalizeDurationMinutes,
  normalizeScheduleLocationType,
  resolveRecurringAppointmentBillingFields,
  roomPreventsOverlappingAppointments,
} from './utils/scheduling';
import {
  mapPatientProfileTypeToLegacyPortalType,
  normalizePatientProfileType,
} from './utils/patientProfileType';
import { normalizePatientInsuranceEligibility } from './utils/patientInsuranceEligibility';
import {
  getPeiHistoryProgressMarker,
  getPeiProgressResetMarker,
} from './utils/peiSessionReset';
import { normalizeAbaMasteryCriterion } from './utils/abaMasteryEngine';
import {
  applyAppointmentActionResult,
  emitAppointmentDomainEvents,
  mergeAppointmentIdentityFallbacks,
  mergePersistedAppointments,
  removePersistedAppointments,
} from './utils/appointmentActionUpdates';
import { normalizeAppointmentFinancialContextType } from './utils/appointmentFinancialContext';
import {
  buildBrandingInitials,
  buildPatientReminderModalViewModel,
  friendlyPatientNotificationError,
  resolveBrandingContext,
} from './services/notificationBranding';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const LandingPage = React.lazy(() =>
  import('./components/LandingPage').then((m) => ({ default: m.LandingPage }))
);
const ActivationAccess = React.lazy(() =>
  import('./components/ActivationAccess').then((m) => ({ default: m.ActivationAccess }))
);
const PortalRelationshipConfirmation = React.lazy(() =>
  import('./components/PortalRelationshipConfirmation').then((m) => ({ default: m.PortalRelationshipConfirmation }))
);
const PatientDashboard = React.lazy(() =>
  import('./components/PatientDashboard').then((m) => ({ default: m.PatientDashboard }))
);
const CoordinatorDashboard = React.lazy(() =>
  import('./components/CoordinatorDashboard').then((m) => ({ default: m.CoordinatorDashboard }))
);
const AdminDashboard = React.lazy(() =>
  import('./components/AdminDashboard').then((m) => ({ default: m.AdminDashboard }))
);
const SuperAdminDashboard = React.lazy(() =>
  import('./components/SuperAdminDashboard').then((m) => ({ default: m.SuperAdminDashboard }))
);
const ProfessionalOnboarding = React.lazy(() =>
  import('./components/ProfessionalOnboarding').then((m) => ({ default: m.ProfessionalOnboarding }))
);

const STALE_DYNAMIC_IMPORT_RELOAD_KEY = 'verto.staleDynamicImportReload.v1';
let staleDynamicImportReloadScheduled = false;

const getErrorMessage = (error: unknown): string => {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
  }
  return '';
};

const isStaleDynamicImportError = (error: unknown): boolean => {
  const message = getErrorMessage(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(message);
};

const scheduleStaleDynamicImportReload = (error: unknown): boolean => {
  if (typeof window === 'undefined' || !isStaleDynamicImportError(error)) return false;
  if (staleDynamicImportReloadScheduled) return true;

  const message = getErrorMessage(error).slice(0, 220);
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.delete('verto_refresh');
  const reloadToken = `${currentUrl.pathname}${currentUrl.search}:${message}`;

  try {
    if (window.sessionStorage.getItem(STALE_DYNAMIC_IMPORT_RELOAD_KEY) === reloadToken) {
      return false;
    }
    window.sessionStorage.setItem(STALE_DYNAMIC_IMPORT_RELOAD_KEY, reloadToken);
  } catch {
    // Session storage may be blocked; a single in-memory guard still prevents loops.
  }

  staleDynamicImportReloadScheduled = true;
  window.setTimeout(() => {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('verto_refresh', String(Date.now()));
    window.location.replace(nextUrl.href);
  }, 80);
  return true;
};

const CLINIC_ACCESS_ACTIVE_STATUSES = new Set([
  'active',
  'trial_active',
  'trialing',
  'demo',
  'demo_sandbox',
]);

const CLINIC_ACCESS_BLOCKED_STATUSES = new Set([
  '',
  'pending',
  'plan_required',
  'payment_required',
  'subscription_pending',
  'incomplete',
  'incomplete_expired',
  'past_due',
  'unpaid',
  'delinquent',
  'blocked',
  'canceled',
  'cancelled',
  'checkout_abandoned',
]);

const normalizeSubscriptionStatusForAccess = (value: unknown): string =>
  String(value || '').trim().toLowerCase();

const isProfessionalClinicRole = (role: unknown): boolean =>
  ['therapist', 'coordinator', 'receptionist', 'admin'].includes(
    String(role || '').trim().toLowerCase(),
  );

const hasDashboardBillingAccess = (candidateUser: any): boolean => {
  const role = String(candidateUser?.role || '').trim().toLowerCase();
  if (!isProfessionalClinicRole(role)) return true;
  if (role === 'admin' && candidateUser?.isInternalAdmin === true) return true;
  if (candidateUser?.isDemoUser === true || candidateUser?.is_demo_user === true) return true;
  const billingModel = String(candidateUser?.billingModel || candidateUser?.billing_model || '').trim().toLowerCase();
  if (billingModel === 'demo' || billingModel === 'demo_sandbox') return true;
  const status = normalizeSubscriptionStatusForAccess(candidateUser?.subscriptionStatus || candidateUser?.subscription_status);
  if (CLINIC_ACCESS_ACTIVE_STATUSES.has(status)) return true;
  if (CLINIC_ACCESS_BLOCKED_STATUSES.has(status)) return false;
  return false;
};

type LazyImportBoundaryProps = {
  children: React.ReactNode;
  fallback: React.ReactNode;
};

type LazyImportBoundaryState = {
  hasError: boolean;
};

class LazyImportBoundary extends React.Component<LazyImportBoundaryProps, LazyImportBoundaryState> {
  state: LazyImportBoundaryState = { hasError: false };

  static getDerivedStateFromError(): LazyImportBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    if (!scheduleStaleDynamicImportReload(error)) {
      console.warn('Application chunk failed to load:', error);
    }
  }

  render() {
    const { fallback, children } = (this as unknown as { props: LazyImportBoundaryProps }).props;
    return this.state.hasError ? fallback : children;
  }
}

const AUTO_RETRIED_FAILED_SYNC_KEY = 'verto.failedSyncAutoRetried.v1';

const readAutoRetriedFailedSyncIds = () => {
  try {
    const value = window.sessionStorage.getItem(AUTO_RETRIED_FAILED_SYNC_KEY);
    const parsed = value ? JSON.parse(value) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set<string>();
  }
};

const rememberAutoRetriedFailedSyncIds = (ids: string[]) => {
  if (ids.length === 0) return;
  try {
    const merged = Array.from(new Set([...readAutoRetriedFailedSyncIds(), ...ids])).slice(-250);
    window.sessionStorage.setItem(AUTO_RETRIED_FAILED_SYNC_KEY, JSON.stringify(merged));
  } catch {
    // Session storage is optional; the retry itself is still safe.
  }
};

export default function App() {
  const isActivationRoute =
    typeof window !== 'undefined' &&
    /^\/ativar\/?$/.test(window.location.pathname);
  const isResetPasswordRoute =
    typeof window !== 'undefined' &&
    /^\/reset-password\/?$/.test(window.location.pathname);
  const isPortalRelationshipRoute =
    typeof window !== 'undefined' &&
    /^\/portal\/confirmar-vinculo\/?$/i.test(window.location.pathname);
  const isAuthActionRoute = isActivationRoute || isResetPasswordRoute;
  const [user, setUser] = useState<any>(null); 
  const userResolutionRef = useRef<{ key: string; promise: Promise<any>; settledAt: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [installPromptUnavailable, setInstallPromptUnavailable] = useState(false);
  const LAST_ACTIVE_WORKSPACE_KEY = 'last_active_workspace_id';
  const INSTALL_PROMPT_DISMISSED_KEY = 'verto_pwa_install_prompt_dismissed_at';

  const getLastActiveWorkspaceId = () =>
    String(localStorage.getItem(LAST_ACTIVE_WORKSPACE_KEY) || '').trim();

  const setLastActiveWorkspaceId = (workspaceId?: string | null) => {
    const safeId = String(workspaceId || '').trim();
    if (!safeId) {
      localStorage.removeItem(LAST_ACTIVE_WORKSPACE_KEY);
      return;
    }
    localStorage.setItem(LAST_ACTIVE_WORKSPACE_KEY, safeId);
  };

  const shouldPromptWorkspaceSelection = (candidateUser: any) => {
    const workspaces = Array.isArray(candidateUser?.workspaces) ? candidateUser.workspaces : [];
    if (workspaces.length <= 1) return false;
    if (typeof candidateUser?.mustSelectWorkspace === 'boolean') {
      return candidateUser.mustSelectWorkspace;
    }
    const activeWorkspaceId = String(
      candidateUser?.activeWorkspaceId || candidateUser?.clinicId || ''
    ).trim();
    if (!activeWorkspaceId) return true;
    return !workspaces.some((workspace: any) => workspace?.clinicId === activeWorkspaceId);
  };

  const hasValidWorkspaceContext = (candidateUser: any) => {
    const workspaces = Array.isArray(candidateUser?.workspaces) ? candidateUser.workspaces : [];
    if (workspaces.length <= 1) return true;
    const activeWorkspaceId = String(
      candidateUser?.activeWorkspaceId || candidateUser?.clinicId || ''
    ).trim();
    if (!activeWorkspaceId) return false;
    return workspaces.some((workspace: any) => workspace?.clinicId === activeWorkspaceId);
  };

  const alignWorkspaceFromStorage = (candidateUser: any) => {
    if (!candidateUser) return candidateUser;
    const workspaces = Array.isArray(candidateUser?.workspaces) ? candidateUser.workspaces : [];
    const currentActiveWorkspaceId = String(
      candidateUser?.activeWorkspaceId || candidateUser?.clinicId || ''
    ).trim();
    const storedWorkspaceId = getLastActiveWorkspaceId();
    const preferredWorkspaceId = currentActiveWorkspaceId || storedWorkspaceId;
    const preferredWorkspace = workspaces.find((workspace: any) => workspace?.clinicId === preferredWorkspaceId);

    if (!preferredWorkspace) return candidateUser;
    return {
      ...candidateUser,
      activeWorkspaceId: preferredWorkspace.clinicId,
      clinicId: preferredWorkspace.clinicId,
      role: preferredWorkspace.role || candidateUser?.role,
    };
  };

  const computeWorkspacePickerVisibility = (candidateUser: any) => {
    if (!candidateUser) return false;
    const inWorkspaceRoute = window.location.pathname.startsWith('/workspaces');
    const hasContext = hasValidWorkspaceContext(candidateUser);

    if (hasContext && inWorkspaceRoute) {
      window.history.replaceState({}, document.title, '/');
    }

    if (hasContext) return false;
    return shouldPromptWorkspaceSelection(candidateUser);
  };

  const isRunningStandalone = () => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      (window.navigator as any)?.standalone === true
    );
  };

  const wasInstallPromptDismissedRecently = () => {
    if (typeof window === 'undefined') return true;
    const dismissedAt = Number(localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY) || 0);
    if (!dismissedAt) return false;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    return Date.now() - dismissedAt < sevenDaysMs;
  };

  const dismissInstallPrompt = () => {
    localStorage.setItem(INSTALL_PROMPT_DISMISSED_KEY, String(Date.now()));
    setShowInstallPrompt(false);
    setInstallPromptUnavailable(false);
  };

  const handleInstallPwa = async () => {
    if (!deferredInstallPrompt) {
      setInstallPromptUnavailable(true);
      return;
    }

    try {
      await deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      setDeferredInstallPrompt(null);
      setShowInstallPrompt(false);
      if (choice.outcome === 'dismissed') {
        localStorage.setItem(INSTALL_PROMPT_DISMISSED_KEY, String(Date.now()));
      } else {
        localStorage.removeItem(INSTALL_PROMPT_DISMISSED_KEY);
      }
    } catch (error) {
      console.warn('PWA install prompt failed:', error);
      setInstallPromptUnavailable(true);
    }
  };

  const restoreWorkspaceContextIfNeeded = async (candidateUser: any) => {
    if (!candidateUser) return candidateUser;
    if (hasValidWorkspaceContext(candidateUser)) return candidateUser;

    const storedWorkspaceId = getLastActiveWorkspaceId();
    if (!storedWorkspaceId) return candidateUser;

    const available = Array.isArray(candidateUser?.workspaces) ? candidateUser.workspaces : [];
    const hasStoredWorkspace = available.some((workspace: any) => workspace?.clinicId === storedWorkspaceId);
    if (!hasStoredWorkspace) return candidateUser;

    try {
      const result = await dataService.selectWorkspace(storedWorkspaceId);
      if (result?.success && result?.user) {
        return result.user;
      }
    } catch (error) {
      console.warn('Workspace restore from localStorage failed:', error);
    }

    return candidateUser;
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleChunkError = (event: ErrorEvent) => {
      if (scheduleStaleDynamicImportReload(event.error || event.message)) {
        event.preventDefault();
      }
    };
    const handleChunkRejection = (event: PromiseRejectionEvent) => {
      if (scheduleStaleDynamicImportReload(event.reason)) {
        event.preventDefault();
      }
    };

    window.addEventListener('error', handleChunkError);
    window.addEventListener('unhandledrejection', handleChunkRejection);
    return () => {
      window.removeEventListener('error', handleChunkError);
      window.removeEventListener('unhandledrejection', handleChunkRejection);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => registration.update().catch(() => undefined))
      .catch((error) => {
        console.warn('Service worker registration for PWA failed:', error);
      });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event as BeforeInstallPromptEvent);
      if (user && !isRunningStandalone() && !wasInstallPromptDismissedRecently()) {
        setShowInstallPrompt(true);
      }
    };

    const handleAppInstalled = () => {
      setDeferredInstallPrompt(null);
      setShowInstallPrompt(false);
      localStorage.removeItem(INSTALL_PROMPT_DISMISSED_KEY);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [user]);

  useEffect(() => {
    if (!user || isRunningStandalone() || wasInstallPromptDismissedRecently()) {
      setShowInstallPrompt(false);
      return;
    }
    if (deferredInstallPrompt) {
      const timer = window.setTimeout(() => setShowInstallPrompt(true), 900);
      return () => window.clearTimeout(timer);
    }

    const isMobileSafari =
      /iphone|ipad|ipod/i.test(window.navigator.userAgent) &&
      /safari/i.test(window.navigator.userAgent) &&
      !/crios|fxios|edgios/i.test(window.navigator.userAgent);
    if (isMobileSafari) {
      const timer = window.setTimeout(() => {
        setInstallPromptUnavailable(true);
        setShowInstallPrompt(true);
      }, 1200);
      return () => window.clearTimeout(timer);
    }
  }, [user, deferredInstallPrompt]);

  const isUuidLike = (value: unknown) =>
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

  const stableUuidFromString = (value: unknown) => {
    const text = String(value || 'verto');
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    let h3 = 0x85ebca6b;
    let h4 = 0xc2b2ae35;

    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      h1 = Math.imul(h1 ^ code, 16777619);
      h2 = Math.imul(h2 ^ code, 2246822519);
      h3 = Math.imul(h3 ^ code, 3266489917);
      h4 = Math.imul(h4 ^ code, 668265263);
    }

    const hex = [h1, h2, h3, h4]
      .map((part) => (part >>> 0).toString(16).padStart(8, '0'))
      .join('');
    const variant = (8 + (parseInt(hex.slice(16, 17), 16) % 4)).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };

  const normalizeTextKey = (value: unknown) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  const getPatientIdentityKey = (patient: any) => {
    const rawId = String(patient?.id || '').trim();
    if (rawId && isUuidLike(rawId)) return `id:${rawId.toLowerCase()}`;

    const email = String(patient?.email || '').trim().toLowerCase();
    if (email) return `email:${email}`;

    const normalizedName = normalizeTextKey(patient?.name);
    if (normalizedName) return `name:${normalizedName}`;

    return `id:${String(patient?.id || '')}`;
  };

  const mergePatients = (current: any[], incoming: any[]) => {
    const merged = new Map<string, any>();
    const all = [...(current || []), ...(incoming || [])];

    for (const patient of all) {
      const key = getPatientIdentityKey(patient);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, patient);
        continue;
      }

      const existingIsUuid = isUuidLike(existing?.id);
      const nextIsUuid = isUuidLike(patient?.id);

      if (!existingIsUuid && nextIsUuid) {
        merged.set(key, { ...existing, ...patient });
        continue;
      }

      if (existingIsUuid && !nextIsUuid) {
        merged.set(key, { ...patient, ...existing });
        continue;
      }

      merged.set(key, { ...existing, ...patient });
    }

    return Array.from(merged.values());
  };

  const normalizeActivityLog = (raw: any) => {
    const title = raw?.title || raw?.action || 'Atividade registrada';
    const content =
      raw?.content ||
      raw?.details ||
      raw?.description ||
      raw?.message ||
      'AÃ§Ã£o registrada no sistema.';
    const type = raw?.type || raw?.category || 'system';
    const isoDate = raw?.timestamp || raw?.created_at || raw?.date || null;
    const parsedDate = isoDate ? new Date(isoDate) : null;
    const hasValidDate = !!(parsedDate && !Number.isNaN(parsedDate.getTime()));

    return {
      ...raw,
      title,
      content,
      type,
      actor_name:
        raw?.actor_name ||
        raw?.professional ||
        raw?.user_name ||
        user?.name ||
        'Profissional',
      timestamp: hasValidDate ? parsedDate.toISOString() : new Date().toISOString(),
      time: raw?.time || (hasValidDate ? parsedDate.toLocaleString('pt-BR') : 'Agora')
    };
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

  const canAccessClinicFinance = (role: any) =>
    ['coordinator', 'admin', 'owner'].includes(String(role || '').toLowerCase());

  const stripPatientFinancialFields = (patient: any) => {
    if (!patient || typeof patient !== 'object') return patient;
    const safePatient = { ...patient };
    delete safePatient.financialPlans;
    delete safePatient.monthlyTreatmentValue;
    delete safePatient.monthlyFee;
    delete safePatient.billingDueDay;
    delete safePatient.billingMethod;
    delete safePatient.paymentMethod;
    delete safePatient.specialtyValues;
    delete safePatient.dreMetrics;
    return safePatient;
  };

  const calculateAgeFromBirthDate = (birthDate: string) => {
    const normalized = String(birthDate || '').trim();
    if (!normalized) return null;
    const dateOnly = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const birth = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : new Date(normalized);
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

  const buildPatientAnamnesisSnapshot = (patientLike: any, baseAnamnesisData?: any) => {
    const source = patientLike || {};
    const existing = baseAnamnesisData && typeof baseAnamnesisData === 'object' ? baseAnamnesisData : {};
    const asObject = (value: any) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const metadata = asObject(source?.metadata);
    const address = {
      ...asObject(metadata?.address),
      ...asObject(source?.address),
    };
    const guardian = {
      ...asObject(metadata?.guardian),
      ...asObject(metadata?.responsible),
      ...asObject(source?.guardian),
      ...asObject(source?.responsible),
    };
    const resolvedBirthDate = coalescePatientText(
      source?.dataNascimento,
      source?.birthDate,
      source?.birth_date,
      existing?.dataNascimento,
    );
    const derivedAgeFromBirthDate = calculateAgeFromBirthDate(resolvedBirthDate);
    const resolvedPhone = coalescePatientText(source?.phone, existing?.telefone);
    const resolvedEmail = coalescePatientText(source?.email, existing?.email);
    const resolvedCpf = coalescePatientText(source?.cpf, existing?.cpf);
    const resolvedStreet = coalescePatientText(source?.logradouro, address?.logradouro, existing?.logradouro);
    const resolvedNumber = coalescePatientText(source?.numero, address?.numero, existing?.numero);
    const resolvedComplement = coalescePatientText(source?.complemento, address?.complemento, existing?.complemento);
    const resolvedDistrict = coalescePatientText(source?.bairro, address?.bairro, existing?.bairro);
    const resolvedCity = coalescePatientText(source?.cidade, address?.cidade, existing?.cidade);
    const responsavelNome = coalescePatientText(source?.responsavelNome, source?.responsibleName, source?.responsible_name, guardian?.nome, guardian?.name, existing?.responsavelNome);
    const responsavelDataNascimento = coalescePatientText(source?.responsavelDataNascimento, source?.responsibleBirthDate, source?.responsible_birth_date, guardian?.dataNascimento, guardian?.birthDate, guardian?.birth_date, existing?.responsavelDataNascimento);
    const responsavelCpf = coalescePatientText(source?.responsavelCpf, source?.responsibleCpf, source?.responsible_cpf, guardian?.cpf, existing?.responsavelCpf);
    const responsavelTelefone = coalescePatientText(source?.responsavelTelefone, source?.responsiblePhone, source?.responsible_phone, guardian?.telefone, guardian?.phone, existing?.responsavelTelefone);
    const responsavelEmail = coalescePatientText(source?.responsavelEmail, source?.responsibleEmail, source?.responsible_email, guardian?.email, existing?.responsavelEmail);
    const responsavelRelacao = coalescePatientText(source?.responsavelRelacao, source?.responsibleRelationship, source?.responsible_relationship, guardian?.relacao, guardian?.relationship, metadata?.responsibleRelationship, existing?.responsavelRelacao);
    const explicitMinor =
      typeof source?.menorDeIdade === 'boolean'
        ? source.menorDeIdade
        : typeof source?.isMinor === 'boolean'
          ? source.isMinor
          : typeof source?.is_minor === 'boolean'
            ? source.is_minor
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
    const insuranceEligibility = normalizePatientInsuranceEligibility({
      ...source,
      payload: existing,
      anamnese: existing,
      anamnesisData: existing,
    });

    return {
      ...existing,
      nome: coalescePatientText(source?.nome, source?.name, existing?.nome),
      nomeSocial: coalescePatientText(source?.socialName, source?.nomeSocial, existing?.nomeSocial),
      telefone: coalescePatientText(source?.telefone, resolvedPhone),
      email: resolvedEmail,
      cpf: resolvedCpf,
      dataNascimento: resolvedBirthDate,
      genero: coalescePatientText(source?.gender, source?.genero, existing?.genero),
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
      financialPlans: Array.isArray(source?.financialPlans)
        ? source.financialPlans
        : Array.isArray(existing?.financialPlans)
          ? existing.financialPlans
          : [],
      monthlyTreatmentValue:
        typeof source?.monthlyTreatmentValue !== 'undefined'
          ? source.monthlyTreatmentValue
          : existing?.monthlyTreatmentValue || 0,
      billingDueDay: coalescePatientText(source?.billingDueDay, existing?.billingDueDay),
      billingMethod: coalescePatientText(source?.billingMethod, existing?.billingMethod),
      grupo: coalescePatientText(source?.grupo, source?.group, existing?.grupo),
      comoConheceu: coalescePatientText(source?.comoConheceu, source?.source, existing?.comoConheceu),
      rg: coalescePatientText(source?.rg, existing?.rg),
      cep: coalescePatientText(source?.cep, existing?.cep),
      logradouro: resolvedStreet,
      numero: resolvedNumber,
      complemento: resolvedComplement,
      bairro: resolvedDistrict,
      cidade: resolvedCity,
      endereco:
        [resolvedStreet, resolvedNumber, resolvedDistrict, resolvedCity]
          .filter(Boolean)
          .join(', ') || coalescePatientText(source?.addressText, existing?.endereco),
      outrasInformacoes: coalescePatientText(source?.notes, existing?.outrasInformacoes),
      menorDeIdade:
        explicitMinor === true || hasResponsibleData || (typeof derivedAgeFromBirthDate === 'number' && derivedAgeFromBirthDate < 18)
          ? true
          : explicitMinor === false
            ? false
            : false,
      responsavelNome,
      responsavelDataNascimento,
      responsavelCpf,
      responsavelTelefone,
      responsavelEmail,
      responsavelRelacao,
      patientProfileType: normalizePatientProfileType(
        source?.patientProfileType || source?.panelType || source?.profileType || source?.profile_type || source?.type || existing?.patientProfileType,
      ),
      panelType: normalizePatientProfileType(
        source?.panelType || source?.patientProfileType || source?.profileType || source?.profile_type || source?.type || existing?.panelType,
      ),
      idade:
        typeof derivedAgeFromBirthDate === 'number'
          ? derivedAgeFromBirthDate
          : typeof source?.age === 'number'
            ? source.age
          : typeof existing?.idade === 'number'
            ? existing.idade
            : existing?.idade || '',
    };
  };

  const enrichUserFromSessionMetadata = (candidateUser: any, supabaseSession?: any) => {
    const metadata = supabaseSession?.user?.user_metadata || {};
    const fullName = String(metadata?.full_name || '').trim();
    const oauthAvatarUrl = String(metadata?.avatar_url || metadata?.picture || '').trim();
    const internalProfilePicture =
      candidateUser?.profilePicture ||
      candidateUser?.profile_picture ||
      candidateUser?.profilePhotoUrl ||
      candidateUser?.profile_photo_url ||
      candidateUser?.professionalProfile?.profile_photo_url ||
      candidateUser?.professional_profile?.profile_photo_url ||
      null;

    return {
      ...candidateUser,
      name: candidateUser?.name || fullName || candidateUser?.email?.split('@')?.[0] || candidateUser?.name,
      profilePicture: internalProfilePicture || oauthAvatarUrl || null,
      profile_picture: internalProfilePicture || oauthAvatarUrl || null,
      oauthPicture: candidateUser?.oauthPicture || candidateUser?.googlePicture || oauthAvatarUrl || null,
      googlePicture: candidateUser?.googlePicture || oauthAvatarUrl || null,
      oauthProvider:
        candidateUser?.oauthProvider ||
        supabaseSession?.user?.app_metadata?.provider ||
        null,
    };
  };

  const applyResolvedUserState = async (candidateUser: any, supabaseSession?: any) => {
    const resolutionKey = [
      String(candidateUser?.id || supabaseSession?.user?.id || '').trim(),
      String(candidateUser?.activeWorkspaceId || candidateUser?.clinicId || '').trim(),
      String(candidateUser?.role || '').trim().toLowerCase()
    ].join('|');
    const existingResolution = userResolutionRef.current;
    if (
      resolutionKey &&
      existingResolution?.key === resolutionKey &&
      (existingResolution.settledAt === 0 || Date.now() - existingResolution.settledAt < 1500)
    ) {
      return await existingResolution.promise;
    }

    const resolutionPromise = (async () => {
    const enrichedUser = enrichUserFromSessionMetadata(candidateUser, supabaseSession);
    const alignedUser = alignWorkspaceFromStorage(enrichedUser);
    const restoredUser = await restoreWorkspaceContextIfNeeded(alignedUser);
    let resolvedUser = restoredUser;

    const commitUserState = (nextUser: any) => {
      setUser(nextUser);
      setProfilePicture(nextUser?.profilePicture || nextUser?.profile_picture || null);
      setCrp(formatProfessionalRegistry(nextUser?.crp || ''));
      if (hasValidWorkspaceContext(nextUser)) {
        setLastActiveWorkspaceId(nextUser?.activeWorkspaceId || nextUser?.clinicId);
      }
      setShowWorkspacePicker(computeWorkspacePickerVisibility(nextUser));
    };

    // Libera a primeira tela antes de buscar dados profissionais secundários.
    commitUserState(restoredUser);
    const role = String(restoredUser?.role || '').trim().toLowerCase();
    if (['patient', 'responsible', 'responsavel', 'guardian'].includes(role)) {
      return restoredUser;
    }

    try {
      const profileResult = await dataService.getUserProfile(String(restoredUser?.id || ''));
      const professionalProfile = profileResult?.data?.professional_profile;
      if (professionalProfile) {
        const professionalMetadata =
          professionalProfile?.metadata && typeof professionalProfile.metadata === 'object'
            ? professionalProfile.metadata
            : {};
        const professionalProfileCompleted =
          professionalProfile?.requires_onboarding === false ||
          Boolean(professionalProfile?.onboarding_completed_at);
        resolvedUser = {
          ...restoredUser,
          firstLoginCompleted: professionalProfileCompleted ? true : restoredUser?.firstLoginCompleted,
          profilePicture:
            professionalProfile?.profile_photo_url ||
            restoredUser?.profilePicture ||
            restoredUser?.profile_picture ||
            null,
          profile_picture:
            professionalProfile?.profile_photo_url ||
            restoredUser?.profile_picture ||
            restoredUser?.profilePicture ||
            null,
          signatureDataUrl:
            professionalProfile?.signature_data_url ||
            restoredUser?.signatureDataUrl ||
            null,
          crp:
            professionalProfile?.crp ||
            professionalProfile?.council_number ||
            restoredUser?.crp ||
            null,
          cpf:
            professionalMetadata?.cpf ||
            professionalMetadata?.professionalCpf ||
            restoredUser?.cpf ||
            null,
          phone:
            professionalProfile?.phone ||
            professionalMetadata?.phone ||
            professionalMetadata?.professionalPhone ||
            restoredUser?.phone ||
            null,
          professionalRoleTitle:
            professionalMetadata?.roleTitle ||
            professionalMetadata?.professionalRoleTitle ||
            restoredUser?.professionalRoleTitle ||
            null,
          professionalProfile: {
            ...professionalProfile,
            fullName:
              professionalProfile?.full_name ||
              professionalProfile?.fullName ||
              restoredUser?.name ||
              null,
            cpf:
              professionalMetadata?.cpf ||
              professionalMetadata?.professionalCpf ||
              restoredUser?.cpf ||
              null,
            phone:
              professionalProfile?.phone ||
              professionalMetadata?.phone ||
              professionalMetadata?.professionalPhone ||
              restoredUser?.phone ||
              null,
            roleTitle:
              professionalMetadata?.roleTitle ||
              professionalMetadata?.professionalRoleTitle ||
              restoredUser?.professionalRoleTitle ||
              null,
          },
          clinicSettings: {
            ...(restoredUser?.clinicSettings || {}),
            ...(professionalProfile?.clinic_name
              ? { clinicName: professionalProfile.clinic_name }
              : {}),
            ...(professionalProfile?.clinic_phone
              ? { clinicPhone: professionalProfile.clinic_phone }
              : {}),
            ...(professionalMetadata?.clinicEmail
              ? { clinicEmail: professionalMetadata.clinicEmail }
              : {}),
            ...(professionalMetadata?.clinicAddress
              ? { clinicAddress: professionalMetadata.clinicAddress }
              : {}),
            ...(professionalProfile?.clinic_logo_url
              ? { clinicLogoUrl: professionalProfile.clinic_logo_url }
              : {}),
            ...(professionalProfile?.signature_data_url
              ? { signatureDataUrl: professionalProfile.signature_data_url }
              : {}),
            ...(professionalProfile?.council
              ? { council: professionalProfile.council }
              : {}),
            ...(professionalProfile?.council_number
              ? { councilNumber: professionalProfile.council_number }
              : {}),
          },
        };
      }
    } catch (error) {
      console.warn('Profile refresh after session failed:', error);
    }

    commitUserState(resolvedUser);

    return resolvedUser;
    })();
    userResolutionRef.current = { key: resolutionKey, promise: resolutionPromise, settledAt: 0 };
    try {
      const result = await resolutionPromise;
      if (userResolutionRef.current?.promise === resolutionPromise) {
        userResolutionRef.current.settledAt = Date.now();
      }
      return result;
    } catch (error) {
      if (userResolutionRef.current?.promise === resolutionPromise) {
        userResolutionRef.current = null;
      }
      throw error;
    }
  };

  const isDataUrl = (value: unknown) =>
    typeof value === 'string' && /^data:/i.test(value.trim());

  const buildAuthHeader = (token?: string | null): Record<string, string> =>
    token ? { Authorization: `Bearer ${token}` } : {};

  const buildJsonAuthHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const session = await ensureFreshSession();
      Object.assign(headers, buildAuthHeader(session?.access_token || null));
    } catch (error) {
      console.warn('[push] Não foi possível anexar cabeçalho de sessão; tentando sessão HTTP existente.');
    }
    return headers;
  };

  const uploadProfileAssetIfNeeded = async (
    maybeDataUrl: unknown,
    kind: 'profile' | 'signature' | 'logo',
    currentUserId: string,
  ): Promise<{ url: string | null; path: string | null }> => {
    const value = typeof maybeDataUrl === 'string' ? maybeDataUrl.trim() : '';
    if (!value) return { url: null, path: null };
    if (!isDataUrl(value)) return { url: value, path: null };

    const extensionByMime: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    const mimeMatch = value.match(/^data:([^;]+);base64,/i);
    const mime = String(mimeMatch?.[1] || 'image/png').toLowerCase();
    const ext = extensionByMime[mime] || 'png';
    const objectPath = `onboarding/${currentUserId}/${kind}-${Date.now()}.${ext}`;
    const uploaded = await dataService.uploadDataUrl('patient-photos', objectPath, value, mime);
    if (!uploaded?.success) {
      throw new Error(uploaded?.error || `Falha ao enviar ${kind}.`);
    }
    return {
      url: String(uploaded?.url || '').trim() || null,
      path: uploaded?.path ? `patient-photos/${uploaded.path}` : null,
    };
  };

  useEffect(() => {
    const currentUserId = String(user?.id || '').trim();
    if (!currentUserId) return;

    let cancelled = false;
    let inFlight = false;

    const refreshSignedProfileMedia = async () => {
      if (cancelled || inFlight) return;
      const previous = profileMediaFetchRef.current;
      if (
        previous?.userId === currentUserId &&
        !previous.inFlight &&
        Date.now() - previous.fetchedAt < PROFILE_MEDIA_REFRESH_TTL_MS
      ) {
        return;
      }
      inFlight = true;
      profileMediaFetchRef.current = { userId: currentUserId, fetchedAt: previous?.fetchedAt || 0, inFlight: true };
      try {
        const result = await dataService.getUserProfileMedia(currentUserId);
        if (cancelled || !result?.success) return;

        const media = result?.data || {};
        const signedProfilePicture = String(media?.profilePictureUrl || '').trim() || null;
        const signedClinicLogo = String(media?.clinicLogoUrl || '').trim() || null;
        const signedSignature = String(media?.signatureUrl || '').trim() || null;

        if (signedProfilePicture) setProfilePicture(signedProfilePicture);
        setUser((prev: any) => {
          if (!prev || String(prev?.id || '').trim() !== currentUserId) return prev;
          const nextProfilePicture = signedProfilePicture || prev.profilePicture || prev.profile_picture || null;
          const nextSignature = signedSignature || prev.signatureDataUrl || prev?.clinicSettings?.signatureDataUrl || null;
          const nextClinicLogo = signedClinicLogo || prev?.clinicSettings?.clinicLogoUrl || null;
          return {
            ...prev,
            profilePicture: nextProfilePicture,
            profile_picture: nextProfilePicture,
            signatureDataUrl: nextSignature,
            clinicSettings: {
              ...(prev?.clinicSettings || {}),
              ...(nextSignature ? { signatureDataUrl: nextSignature } : {}),
              ...(nextClinicLogo ? { clinicLogoUrl: nextClinicLogo } : {}),
            },
          };
        });
      } catch (error) {
        console.warn('Profile media refresh failed:', error);
      } finally {
        inFlight = false;
        profileMediaFetchRef.current = { userId: currentUserId, fetchedAt: Date.now(), inFlight: false };
      }
    };

    void refreshSignedProfileMedia();

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === 'visible') {
        void refreshSignedProfileMedia();
      }
    };

    window.addEventListener('focus', handleVisibilityRefresh);
    document.addEventListener('visibilitychange', handleVisibilityRefresh);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', handleVisibilityRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
    };
  }, [user?.id]);
  
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncOfflineData();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Initial sync - moved to run only when user is ready
    // if (navigator.onLine) syncOfflineData();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Sync when user is ready
  useEffect(() => {
    if (user && navigator.onLine) {
      syncOfflineData();
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    let cancelled = false;
    let retryTimers: number[] = [];
    const scheduleRecoveredSync = () => {
      retryTimers.forEach((timer) => window.clearTimeout(timer));
      retryTimers = [250, 5_500].map((delay) =>
        window.setTimeout(() => {
          if (!cancelled) void syncOfflineData();
        }, delay)
      );
    };
    const refreshFailedSyncCount = async () => {
      try {
        const failed = await getFailedSyncRecords();
        const autoRetriedIds = readAutoRetriedFailedSyncIds();
        const recoverable = failed.filter(
          (record) => isRecoverableFailedOfflineSyncRecord(record) && !autoRetriedIds.has(record.id)
        );

        if (recoverable.length > 0 && navigator.onLine) {
          rememberAutoRetriedFailedSyncIds(recoverable.map((record) => record.id));
          await Promise.all(recoverable.map((record) => resetFailedSyncRecord(record.id)));
          scheduleRecoveredSync();
        }

      } catch {
        // Falhas ao ler o IndexedDB nao devem gerar faixa visual no app.
      }
    };
    void refreshFailedSyncCount();
    const interval = window.setInterval(refreshFailedSyncCount, 60_000);
    const handleFocus = () => void refreshFailedSyncCount();
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleFocus);
    return () => {
      cancelled = true;
      retryTimers.forEach((timer) => window.clearTimeout(timer));
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleFocus);
    };
  }, [user]);

  useEffect(() => {
    const LOADING_WATCHDOG_MS = 12000;
    const watchdog = window.setTimeout(() => {
      setLoading((current) => (current ? false : current));
    }, LOADING_WATCHDOG_MS);

    return () => window.clearTimeout(watchdog);
  }, []);

  useEffect(() => {
    const initSupabase = async () => {
      try {
        const supabase = await withTimeout(getSupabase(), 8000, null as any);
        if (!supabase) {
          setLoading(false);
          return;
        }

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange(async (event, session) => {
          try {
            if (event === 'SIGNED_IN' && session) {
              const intendedRole = localStorage.getItem('verto_intended_role') || 'therapist';
              localStorage.removeItem('verto_intended_role');
              const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
              const isActivationFlow = /^\/(ativar|reset-password)\/?$/i.test(currentPath);
              const authProvider = String(session?.user?.app_metadata?.provider || '').toLowerCase();
              const isPasswordSignIn = authProvider === 'email' || authProvider === '';
              const activationEmail = String(localStorage.getItem('verto_activation_email') || '').trim().toLowerCase();
              if (isActivationFlow && authProvider !== 'google') {
                // Em ativação por e-mail, o acesso só pode seguir após definir senha explicitamente.
                setLoading(false);
                return;
              }
              if (!isActivationFlow && isPasswordSignIn) {
                // Login por senha é finalizado pelo formulário; evita emissão duplicada de sessão.
                setLoading(false);
                return;
              }
              await handleLoginSuccess(session, intendedRole, undefined, {
                provider: session?.user?.app_metadata?.provider || null,
                activationFlow: isActivationFlow,
                activationEmail: activationEmail || null,
              });
            } else if (event === 'SIGNED_OUT') {
              if (import.meta.env.DEV) console.log('Sessao encerrada pelo provedor de autenticacao.');
              if (manualLogoutInProgressRef.current) {
                setUser(null);
                setProfilePicture(null);
                setShowWorkspacePicker(false);
                return;
              }
              try {
                const response = await fetch('/api/auth/me', { credentials: 'include' });
                if (response.ok) {
                  const data = await response.json();
                  if (data?.user) {
                    await applyResolvedUserState(data.user);
                    return;
                  }
                }
              } catch (error) {
                if (import.meta.env.DEV) console.warn('Recuperacao de sessao via /api/auth/me falhou:', sanitizeTechnicalErrorMessage(error));
              }
            }
          } catch (authChangeError) {
            if (import.meta.env.DEV) console.error('Falha no handler de autenticacao:', sanitizeTechnicalErrorMessage(authChangeError));
          } finally {
            setLoading(false);
          }
        });

        return () => subscription.unsubscribe();
      } catch (error) {
        if (import.meta.env.DEV) console.error('Falha ao iniciar autenticacao:', sanitizeTechnicalErrorMessage(error));
        setLoading(false);
      }
    };
    initSupabase();
  }, []);

  useEffect(() => {
    const checkSession = async () => {
      const sessionTimeoutMs = 12000;
      const timeoutController = new AbortController();
      const timeoutId = window.setTimeout(() => timeoutController.abort(), sessionTimeoutMs);

      try {
        let session = await withTimeout(ensureFreshSession(), 8000, null as any);
        let token = session?.access_token;
        let authData: any = null;
        let lastError: any = null;

        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const response = await fetch('/api/auth/me', {
              credentials: 'include',
              signal: timeoutController.signal,
              headers: buildAuthHeader(token || null)
            });

            if (!response.ok) {
              const text = await response.text();
              throw new Error(`Initial auth check failed: HTTP ${response.status} ${text}`);
            }

            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
              throw new Error(`Initial auth check returned non-JSON: ${contentType}`);
            }

            authData = await response.json();
            break;
          } catch (error) {
            lastError = error;
            // Pequeno backoff para falhas transitórias de rede/proxy no boot.
            await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
          }
        }

        if (authData?.user) {
          await applyResolvedUserState(authData.user, session);
        } else if (session?.access_token) {
          // Fallback de recuperação em refresh: refaz o vínculo da sessão server-side.
          const intendedRole =
            String(session?.user?.user_metadata?.role || localStorage.getItem('verto_intended_role') || 'therapist')
              .trim()
              .toLowerCase();
          const loginRes = await handleLoginSuccess(session, intendedRole, undefined, {
            provider: session?.user?.app_metadata?.provider || null,
            activationFlow: false,
          });
          if (!loginRes?.success) {
            setUser(null);
            setProfilePicture(null);
            setShowWorkspacePicker(false);
          }
        } else if (authData && !authData?.user) {
          for (let attempt = 0; attempt < 3 && !session?.access_token; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
            session = await withTimeout(ensureFreshSession(), 5000, null as any);
            token = session?.access_token;
          }

          if (session?.access_token) {
            const intendedRole =
              String(session?.user?.user_metadata?.role || localStorage.getItem('verto_intended_role') || 'therapist')
                .trim()
                .toLowerCase();
            const loginRes = await handleLoginSuccess(session, intendedRole, undefined, {
              provider: session?.user?.app_metadata?.provider || null,
              activationFlow: false,
            });
            if (!loginRes?.success) {
              setUser(null);
              setProfilePicture(null);
              setShowWorkspacePicker(false);
            }
          } else {
            setUser(null);
            setProfilePicture(null);
            setShowWorkspacePicker(false);
          }
        } else if (!authData) {
          if (import.meta.env.DEV) console.error('Falha na checagem inicial de autenticacao apos retentativas:', sanitizeTechnicalErrorMessage(lastError));
          // Mantém estado atual para evitar queda falsa para LP em falha transitória.
        } else {
          setUser(null);
          setProfilePicture(null);
          setShowWorkspacePicker(false);
        }
      } catch (error) {
        if (import.meta.env.DEV) console.error('Falha na checagem de sessao:', sanitizeTechnicalErrorMessage(error));
        // Evita logout visual por erro temporário de rede no refresh.
      } finally {
        window.clearTimeout(timeoutId);
        setLoading(false);
      }
    };
    checkSession();
  }, []);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('payment') === 'success') {
      const paymentMode = String(urlParams.get('mode') || '').toLowerCase();
      if (paymentMode === 'professional-signup') {
        const handleProfessionalSignupSuccess = async () => {
          const pendingSignupEmail = (() => {
            try {
              return String(sessionStorage.getItem('verto_pending_professional_signup_email') || '')
                .trim()
                .toLowerCase();
            } catch {
              return '';
            }
          })();

          if (pendingSignupEmail) {
            try {
              await fetch('/api/auth/resend-confirmation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email: pendingSignupEmail })
              });
            } catch (error) {
              console.warn('Falha no fallback de reenvio de confirmação pós-pagamento:', error);
            }
          }

          try {
            const supabase = await getSupabase();
            await supabase.auth.signOut({ scope: 'local' } as any);
          } catch {
            // no-op
          }
          try {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
          } catch {
            // no-op
          }
          setUser(null);
          setProfilePicture(null);
          setShowWorkspacePicker(false);
          try {
            sessionStorage.removeItem('verto_pending_professional_signup_email');
          } catch {
            // no-op
          }
          sessionStorage.setItem(
            'verto_professional_signup_success',
            'Pagamento confirmado. Agora confirme seu e-mail para ativar sua conta e concluir o acesso.'
          );
          window.history.replaceState({}, document.title, "/?signup=check-email");
        };
        void handleProfessionalSignupSuccess();
        return;
      }
      // Refresh session to get active status
      // We might need to wait a bit for the webhook to complete
      let attempts = 0;
      const maxAttempts = 5;
      
      const checkSession = async () => {
        try {
          const session = await ensureFreshSession();
          const token = session?.access_token;

          const response = await fetch('/api/auth/me', { 
            credentials: 'include',
            headers: {
              'Authorization': token ? `Bearer ${token}` : ''
            }
          });
          
          if (!response.ok) {
            const text = await response.text();
            console.error('Interval auth check failed:', response.status, text);
            return;
          }
          
          const contentType = response.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            console.error('Interval auth check returned non-JSON:', contentType);
            return;
          }

          const data = await response.json();
          if (data.user) {
            if (data.user.subscriptionStatus === 'active' || attempts >= maxAttempts) {
              await applyResolvedUserState(data.user, session);
              // Clear URL params
              window.history.replaceState({}, document.title, "/");
            } else {
              attempts++;
              setTimeout(checkSession, 2000); // Wait 2 seconds and try again
            }
          }
        } catch (error) {
          console.error('Session refresh error:', error);
        }
      };
      checkSession();
    } else if (urlParams.get('payment') === 'cancel') {
      alert('O pagamento foi cancelado. Você pode tentar novamente quando quiser.');
      window.history.replaceState({}, document.title, "/");
    }
  }, []);

  const handleLoginSuccess = async (
    supabaseSession: any,
    intendedRole?: string,
    credentials?: { email?: string; password?: string },
    authContext?: { provider?: string | null; activationFlow?: boolean; passwordSetupCompleted?: boolean; activationEmail?: string | null },
  ) => {
    try {
      if (!supabaseSession) {
        if (credentials?.email && credentials?.password) {
          const response = await withTimeout(fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              accessToken: null,
              intendedRole,
              provider: authContext?.provider || 'email',
              activationFlow: Boolean(authContext?.activationFlow),
              passwordSetupCompleted: Boolean(authContext?.passwordSetupCompleted),
              activationEmail: authContext?.activationEmail || null,
              email: credentials.email,
              password: credentials.password,
            })
          }), 12000, null as any);
          if (!response) {
            return { success: false, error: 'Tempo esgotado ao entrar. Tente novamente.' };
          }
          const result = await response.json().catch(() => ({}));
          if (!response.ok || !result?.success) {
            return { success: false, error: result?.error || 'Erro no login' };
          }
          const resolvedUser = await applyResolvedUserState(result.user, null);
          return { success: true, user: resolvedUser };
        }

        // If no session provided, we might already have the user from signup-direct
        // or we just need to refresh the session from the server
        const supabase = await getSupabase();
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        const response = await withTimeout(fetch('/api/auth/me', { 
          credentials: 'include',
          headers: {
            'Authorization': token ? `Bearer ${token}` : ''
          }
        }), 12000, null as any);
        if (!response) {
          return { success: false, error: 'Tempo esgotado ao restaurar sessão.' };
        }
        
        if (!response.ok) {
          const text = await response.text();
          console.error('Login auth check failed:', response.status, text);
          return { success: false, error: 'Erro na comunicaÃ§Ã£o com o servidor' };
        }
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          console.error('Login auth check returned non-JSON:', contentType);
          return { success: false, error: 'Resposta invÃ¡lida do servidor' };
        }

        const data = await response.json();
        if (data.user) {
          const resolvedUser = await applyResolvedUserState(data.user, session);
          return { success: true, user: resolvedUser };
        }
        return { success: false, error: 'No session' };
      }

      const provider = authContext?.provider || supabaseSession?.user?.app_metadata?.provider || null;
      const activationFlow = Boolean(authContext?.activationFlow);
      const accessToken = supabaseSession.access_token;
      const response = await withTimeout(fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          accessToken,
          intendedRole,
          provider,
          activationFlow,
          passwordSetupCompleted: Boolean(authContext?.passwordSetupCompleted),
          activationEmail: authContext?.activationEmail || null,
          email: credentials?.email || null,
          password: credentials?.password || null,
        })
      }), 12000, null as any);
      if (!response) {
        return { success: false, error: 'Tempo esgotado ao entrar. Tente novamente.' };
      }

      if (!response.ok) {
        const text = await response.text();
        console.error('Login request failed:', response.status, text);
        try {
          const errData = JSON.parse(text);
          return { success: false, error: errData.error || 'Erro no login' };
        } catch (e) {
          return { success: false, error: 'Erro na comunicaÃ§Ã£o com o servidor' };
        }
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error('Login returned non-JSON:', contentType);
        return { success: false, error: 'Resposta invÃ¡lida do servidor' };
      }

      const data = await response.json();
      if (data.success) {
        if (data.twoFactorRequired) {
          return { success: true, twoFactorRequired: true, email: data.email };
        }
        const resolvedUser = await applyResolvedUserState(data.user, supabaseSession);
        return { success: true, user: resolvedUser };
      } else {
        console.error('Login failed on server:', data.error);
        // If server-side login fails, sign out of Supabase to clear local state
        const supabase = await getSupabase();
        await supabase.auth.signOut();
        return { success: false, error: data.error || 'Erro ao sincronizar sessÃ£o com o servidor' };
      }
    } catch (error: any) {
      console.error('Login error:', error);
      return { success: false, error: error.message || 'Erro de conexÃ£o' };
    }
  };

  const [therapistNotes, setTherapistNotes] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const historyRef = useRef<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [patientAssignedTaskCount, setPatientAssignedTaskCount] = useState(0);
  const [patientAssignedTasksLoadError, setPatientAssignedTasksLoadError] = useState(false);
  const [patientContextLoaded, setPatientContextLoaded] = useState(false);
  const [resolvedPatientPortalId, setResolvedPatientPortalId] = useState<string>('');
  const [clinicalRecords, setClinicalRecords] = useState<any[]>([]);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const todayStr = new Date().toISOString().split('T')[0];
  const normalizeCanonicalPatientName = (value: any) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const patientNameWordCount = (value: any) =>
    normalizeCanonicalPatientName(value).split(/\s+/).filter(Boolean).length;
  const shouldPreservePatientFullName = (currentName: any, incomingName: any) => {
    const current = normalizeCanonicalPatientName(currentName);
    const incoming = normalizeCanonicalPatientName(incomingName);
    if (!incoming) return Boolean(current);
    if (!current) return false;
    if (current.toLocaleLowerCase('pt-BR') === incoming.toLocaleLowerCase('pt-BR')) return false;
    return patientNameWordCount(current) >= 2 && patientNameWordCount(incoming) <= 1;
  };

  const [rooms, setRooms] = useState<any[]>([]);
  const [therapistAgenda, setTherapistAgenda] = useState<any[]>([]);
  const therapistAgendaRef = useRef<any[]>([]);
  const appointmentActionSequenceRef = useRef(0);
  const [appointmentConfirmation, setAppointmentConfirmation] = useState<{
    appointmentId: string;
    scheduledAt: string;
    dateLabel: string;
    timeLabel: string;
    clinicId: string;
    clinicName: string;
    clinicLogoUrl: string;
    clinicPrimaryColor: string;
    patientName: string;
    professionalId: string;
    professionalName: string;
    professionalLogoUrl: string;
    professionalRole: string;
    status: string;
    isLoading: boolean;
    isUpdating: boolean;
    hasError: boolean;
    message: string;
  } | null>(null);
  const [appointmentConfirmationRetry, setAppointmentConfirmationRetry] = useState(0);

  const [specialtySettings, setSpecialtySettings] = useState<any>({});

  useEffect(() => {
    therapistAgendaRef.current = therapistAgenda;
  }, [therapistAgenda]);

  const nextAppointmentActionSequence = () => {
    appointmentActionSequenceRef.current += 1;
    return appointmentActionSequenceRef.current;
  };

  const applyAppointmentResultToAgenda = (
    rawResult: any,
    fallback: { action: string; items?: any[]; removedIds?: string[] } = { action: 'updated' },
    sequence = appointmentActionSequenceRef.current,
  ) => {
    if (sequence < appointmentActionSequenceRef.current) {
      return { ok: false, reason: 'STALE_RESPONSE', items: therapistAgendaRef.current };
    }
    const rawItems = Array.isArray(rawResult?.items)
      ? rawResult.items
      : Array.isArray(rawResult?.appointments)
        ? rawResult.appointments
        : Array.isArray(rawResult?.affectedAppointments)
          ? rawResult.affectedAppointments
          : rawResult?.item || rawResult?.appointment
            ? [rawResult.item || rawResult.appointment]
            : fallback.items || [];
    const items = mergeAppointmentIdentityFallbacks(rawItems, fallback.items || []);
    const removedIds = Array.isArray(rawResult?.removedIds)
      ? rawResult.removedIds
      : Array.isArray(rawResult?.deletedAppointmentIds)
        ? rawResult.deletedAppointmentIds
        : fallback.removedIds || [];
    const actionResult = {
      ...rawResult,
      success: rawResult?.success !== false,
      entity: rawResult?.entity || 'appointment',
      action: rawResult?.action || fallback.action,
      item: rawResult?.item || rawResult?.appointment || items[0] || null,
      items,
      removedIds,
    };
    const applied = applyAppointmentActionResult(therapistAgendaRef.current, actionResult);
    if (!applied.ok) return applied;
    therapistAgendaRef.current = applied.items;
    setTherapistAgenda(applied.items);
    emitAppointmentDomainEvents(actionResult.events);
    return applied;
  };

  const calculateEndTime = (startTime: string, approach: string, durationMinutes?: any) => {
    const configuredDuration = specialtySettings[approach] || 60;
    const duration = normalizeDurationMinutes(durationMinutes || configuredDuration, 60);
    return addMinutesToTime(normalizeAppointmentTime(startTime) || '08:00', duration);
  };

  const appointmentTimesOverlap = (startA: string, endA: string, startB: string, endB: string) => {
    return scheduleTimesOverlap(startA, endA, startB, endB);
  };

  const parseBrazilianDate = (value: string, timeValue = '00:00') => {
    const safeDate = String(value || '').trim();
    const safeTime = String(timeValue || '00:00').slice(0, 5);
    const match = safeDate.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const rawYear = match[3] ? Number(match[3]) : new Date().getFullYear();
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const [hours, minutes] = safeTime.split(':').map((part) => Number(part) || 0);
    const date = new Date(year, month - 1, day, hours, minutes);
    if (
      Number.isNaN(date.getTime()) ||
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date;
  };

  const formatAppointmentConfirmationDateTime = (appointment: any) => {
    const scheduledAt = appointment?.scheduledAt || appointment?.scheduled_at;
    const explicitDate = String(appointment?.date || '').trim();
    const explicitTime = String(appointment?.time || '').trim();

    if (scheduledAt) {
      const scheduled = new Date(scheduledAt);
      if (!Number.isNaN(scheduled.getTime())) {
        return {
          dateLabel: scheduled.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            timeZone: 'America/Sao_Paulo'
          }),
          timeLabel: scheduled.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Sao_Paulo',
          }),
        };
      }
    }

    if (explicitDate) {
      const localDate = parseBrazilianDate(explicitDate, explicitTime) || new Date(`${explicitDate}T${explicitTime || '00:00'}:00`);
      if (!Number.isNaN(localDate.getTime())) {
        return {
          dateLabel: localDate.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }),
          timeLabel: (explicitTime || localDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })).slice(0, 5),
        };
      }
    }

    return { dateLabel: '', timeLabel: '' };
  };

  const buildAppointmentFallbackFromUrl = (params: URLSearchParams) => {
    const scheduledAt = params.get('scheduled_at') || params.get('scheduledAt') || '';
    const appointmentDate = params.get('appointment_date') || params.get('date') || params.get('dateLabel') || '';
    const appointmentTime = params.get('appointment_time') || params.get('time') || params.get('timeLabel') || '';
    return {
      ...formatAppointmentConfirmationDateTime({
        scheduledAt,
        date: appointmentDate,
        time: appointmentTime
      }),
      scheduledAt,
    };
  };

  const getClinicInitials = (value: string) => buildBrandingInitials(value || 'Clínica');

  const getAppointmentConfirmationStatusLabel = (value: string) => {
    const normalized = String(value || '').toLowerCase();
    if (normalized.includes('confirm')) return 'Confirmada';
    if (normalized.includes('reschedule') || normalized.includes('remarc')) return 'Remarcação solicitada';
    if (normalized.includes('cancel')) return 'Cancelamento solicitado';
    if (normalized.includes('pend')) return 'Pendente';
    if (normalized.includes('sched') || normalized.includes('agend')) return 'Agendada';
    return normalized ? 'Atualizada' : '';
  };

  const buildAppointmentConfirmationViewModel = () => {
    if (!appointmentConfirmation) {
      const branding = resolveBrandingContext({ fallbackName: 'Clínica' });
      return buildPatientReminderModalViewModel({
        appointmentId: '',
        branding,
      });
    }
    const branding = resolveBrandingContext({
      clinic: {
        id: appointmentConfirmation.clinicId,
        displayName: appointmentConfirmation.clinicName,
        logoUrl: appointmentConfirmation.clinicLogoUrl,
        primaryColor: appointmentConfirmation.clinicPrimaryColor,
      },
      professional: {
        id: appointmentConfirmation.professionalId,
        displayName: appointmentConfirmation.professionalName,
        logoUrl: appointmentConfirmation.professionalLogoUrl,
      },
      allowProfessionalFallback: false,
      fallbackName: 'Clínica',
    });
    return buildPatientReminderModalViewModel({
      appointmentId: appointmentConfirmation.appointmentId,
      scheduledAt: appointmentConfirmation.scheduledAt,
      dateLabel: appointmentConfirmation.dateLabel,
      timeLabel: appointmentConfirmation.timeLabel,
      patientName: appointmentConfirmation.patientName,
      status: appointmentConfirmation.status,
      branding,
    });
  };

  const getFriendlyAppointmentLoadMessage = (raw: any) => {
    const text = String(raw || '').trim();
    if (!text) return '';
    return friendlyPatientNotificationError(text);
  };

  const roomReservations = useMemo(() => {
    return therapistAgenda
      .filter(item => item.room && item.status !== 'canceled' && normalizeScheduleLocationType(item.location_type || item.locationType || item.location || 'clinica') === 'clinica')
      .map(item => ({
        id: 'res-' + item.id,
        roomId: item.room,
        roomName: rooms.find(r => String(r.id) === String(item.room))?.name || item.roomName || item.room_name || item.room,
        professionalId: item.professionalId || 'prof1',
        professionalName: item.professional || 'Terapeuta Teste',
        patientName: item.name,
        date: item.date,
        startTime: item.time,
        endTime: calculateEndTime(item.time, item.type, item.duration_minutes || item.durationMinutes),
        status: item.status
      }));
  }, [therapistAgenda, rooms, specialtySettings]);

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

  const createAppointmentId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
      const random = Math.floor(Math.random() * 16);
      const value = token === 'x' ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  };

  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    if (String(user.role || '').toLowerCase() !== 'patient') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;

    let cancelled = false;

    const registerPush = async () => {
      try {
        const keyResponse = await fetch('/api/push/vapid-public-key', { credentials: 'include' });
        const keyPayload = await keyResponse.json().catch(() => ({}));
        if (!keyResponse.ok || !keyPayload?.publicKey) return;
        const applicationServerKey = urlBase64ToUint8Array(String(keyPayload.publicKey));

        // A permissão deve ser solicitada somente por ação explícita em Configurações.
        if (cancelled || Notification.permission !== 'granted') return;

        const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
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

        const patientIdForPush = String(
          resolvedPatientPortalId ||
            (user as any)?.patientId ||
            (user as any)?.patient_id ||
            ''
        ).trim();
        const safePatientIdForPush =
          patientIdForPush && patientIdForPush !== String(user?.id || '').trim()
            ? patientIdForPush
            : '';
        const patientEmailForPush = String(user?.email || '').trim().toLowerCase();
        console.log('[push] registrando subscription do paciente.', {
          patientId: safePatientIdForPush || null,
          patientEmail: patientEmailForPush || null,
          endpointPrefix: String(subscription.endpoint || '').slice(0, 80)
        });
        const response = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: await buildJsonAuthHeaders(),
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
          console.warn('[push] Falha ao persistir subscription do paciente:', {
            status: response.status,
            result
          });
        } else {
          console.log('[push] subscription persistida.', {
            patientId: result?.patientId || safePatientIdForPush || null
          });
        }
      } catch (error) {
        console.warn('Push registration failed:', error);
      }
    };

    void registerPush();

    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.role, user?.email, resolvedPatientPortalId]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data || {};
      if (data?.type !== 'APPOINTMENT_STATUS_UPDATED') return;
      const appointmentId = String(data.appointmentId || '');
      const rawStatus = String(data.status || '').toLowerCase();
      const status = rawStatus === 'cancelled' ? 'canceled' : rawStatus;
      if (!appointmentId || !status) return;
      setTherapistAgenda(prev =>
        prev.map(item =>
          String(item.id) === appointmentId
            ? {
                ...item,
                status,
                patientConfirmationStatus: status,
                patientConfirmationAt: new Date().toISOString(),
              }
            : item
        )
      );
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const appointmentId = params.get('appointment_id');
    if (!appointmentId) return;
    const fallbackLabels = buildAppointmentFallbackFromUrl(params);
    const hasFallbackDateTime = Boolean(fallbackLabels.dateLabel && fallbackLabels.timeLabel);
    setAppointmentConfirmation({
      appointmentId,
      ...fallbackLabels,
      clinicId: '',
      clinicName: '',
      clinicLogoUrl: '',
      clinicPrimaryColor: '',
      patientName: '',
      professionalId: '',
      professionalName: '',
      professionalLogoUrl: '',
      professionalRole: '',
      status: '',
      isLoading: !hasFallbackDateTime,
      isUpdating: false,
      hasError: false,
      message: '',
    });

    let cancelled = false;
    const loadAppointmentConfirmation = async () => {
      try {
        const response = await fetch(`/api/appointments/${encodeURIComponent(appointmentId)}/confirmation`, {
          credentials: 'include',
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result?.success) {
          throw new Error(result?.error || 'Não foi possível carregar os dados da consulta.');
        }
        const labels = formatAppointmentConfirmationDateTime(result.appointment || {});
        if (!cancelled) {
          setAppointmentConfirmation((prev) =>
            prev && prev.appointmentId === appointmentId
              ? {
                  ...prev,
                  ...labels,
                  scheduledAt: String(result.appointment?.scheduledAt || result.appointment?.scheduled_at || prev.scheduledAt || '').trim(),
                  clinicId: String(result.appointment?.clinic?.id || result.appointment?.clinicId || result.appointment?.clinic_id || '').trim(),
                  clinicName: String(result.appointment?.clinic?.displayName || result.appointment?.clinicName || result.appointment?.clinic_name || '').trim(),
                  clinicLogoUrl: String(result.appointment?.clinic?.logoUrl || result.appointment?.clinicLogoUrl || result.appointment?.clinic_logo_url || '').trim(),
                  clinicPrimaryColor: String(result.appointment?.clinic?.primaryColor || result.appointment?.clinicPrimaryColor || result.appointment?.clinic_primary_color || '').trim(),
                  patientName: String(result.appointment?.patient?.name || result.appointment?.patientName || result.appointment?.patient_name || '').trim(),
                  professionalId: String(result.appointment?.professionalId || result.appointment?.professional_id || '').trim(),
                  professionalName: String(result.appointment?.professionalName || result.appointment?.professional_name || '').trim(),
                  professionalLogoUrl: String(result.appointment?.professionalLogoUrl || result.appointment?.professional_logo_url || result.appointment?.professionalAvatarUrl || result.appointment?.professional_avatar_url || '').trim(),
                  professionalRole: String(result.appointment?.professionalRole || result.appointment?.professional_role || '').trim(),
                  status: String(result.appointment?.patientConfirmationStatus || result.appointment?.status || '').trim(),
                  isLoading: false,
                  hasError: false,
                  message: '',
                }
              : prev,
          );
        }
      } catch (error: any) {
        const friendlyMessage = getFriendlyAppointmentLoadMessage(error?.message);
        if (!cancelled) {
          setAppointmentConfirmation((prev) =>
            prev && prev.appointmentId === appointmentId
              ? {
                  ...prev,
                  isLoading: false,
                  hasError: true,
                  message: friendlyMessage,
                }
              : prev,
          );
        }
      }
    };

    void loadAppointmentConfirmation();
    return () => {
      cancelled = true;
    };
  }, [appointmentConfirmationRetry]);

  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [crp, setCrp] = useState<string>('');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);

  const decodeStoredText = (value: any) =>
    String(value ?? '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();

  const normalizeHistoryRecordForState = (record: any, fallbackPatientId?: string) => {
    const createdAt = record?.created_at || record?.createdAt || record?.date || null;
    const parsedCreatedAt = createdAt ? new Date(createdAt) : null;
    const hasValidCreatedAt = Boolean(parsedCreatedAt && !Number.isNaN(parsedCreatedAt.getTime()));
    return {
      ...record,
      patientId: record?.patientId || record?.patient_id || fallbackPatientId,
      patient_id: record?.patient_id || record?.patientId || fallbackPatientId,
      date: record?.date || record?.created_at || record?.createdAt || new Date().toISOString(),
      time:
        record?.time ||
        (hasValidCreatedAt
          ? parsedCreatedAt!.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : ''),
      dateGroup:
        record?.dateGroup ||
        record?.date_group ||
        (hasValidCreatedAt && parsedCreatedAt!.toDateString() === new Date().toDateString()
          ? 'Hoje'
          : hasValidCreatedAt
            ? parsedCreatedAt!.toLocaleDateString()
            : ''),
      image: record?.image || record?.image_url || record?.imageUrl || null,
      image_path: record?.image_path || record?.imagePath || null
    };
  };

  const mergeHistoryRecords = (current: any[], incoming: any[], fallbackPatientId?: string) => {
    const byId = new Map<string, any>();
    const addRecord = (record: any) => {
      const normalized = normalizeHistoryRecordForState(record, fallbackPatientId);
      const key = String(normalized?.id || [
        normalized?.patient_id || normalized?.patientId || '',
        normalized?.type || '',
        normalized?.title || '',
        normalized?.created_at || normalized?.date || '',
        normalized?.note || ''
      ].join('|'));
      if (!key.trim()) return;
      const existing = byId.get(key);
      byId.set(key, existing ? { ...existing, ...normalized } : normalized);
    };
    (Array.isArray(current) ? current : []).forEach(addRecord);
    (Array.isArray(incoming) ? incoming : []).forEach(addRecord);
    return Array.from(byId.values()).sort((a: any, b: any) => {
      const aTime = new Date(a?.created_at || a?.date || 0).getTime();
      const bTime = new Date(b?.created_at || b?.date || 0).getTime();
      return bTime - aTime;
    });
  };

  const normalizeAndDecorateNotes = (rawNotes: any[]) => {
    const normalized = (Array.isArray(rawNotes) ? rawNotes : []).map((n: any) => {
      const rawVisibility = String(n?.visibility || '').toLowerCase();
      const rawType = String(n?.type || '').toLowerCase();
      const visibility =
        rawVisibility ||
        (rawType === 'professional'
          ? 'professional'
          : rawType === 'shared'
            ? 'patient'
            : rawType === 'family'
              ? 'family'
              : 'private');
      const fallbackType =
        rawType ||
        (visibility === 'professional'
          ? 'professional'
          : visibility === 'patient' || visibility === 'shared' || visibility === 'family'
            ? 'shared'
            : 'private');
      return {
        ...n,
        id: n?.id,
        patientId: n?.patientId || n?.patient_id,
        text: decodeStoredText(n?.text ?? n?.content ?? ''),
        content: decodeStoredText(n?.content ?? n?.text ?? ''),
        subject: decodeStoredText(n?.subject ?? ''),
        originalId: n?.originalId || n?.original_id || null,
        visibility,
        type: n?.type || fallbackType,
        hasSharedCopy: Boolean(n?.hasSharedCopy),
        hasProfessionalCopy: Boolean(n?.hasProfessionalCopy),
        date: n?.date || (n?.created_at ? new Date(n.created_at).toLocaleString() : new Date().toLocaleString())
      };
    });

    const copiesByOriginal = new Map<string, { patient: boolean; professional: boolean }>();
    for (const note of normalized) {
      const originalId = String(note?.originalId || '').trim();
      if (!originalId) continue;
      const visibility = String(note?.visibility || '').toLowerCase();
      const type = String(note?.type || '').toLowerCase();
      const marker = copiesByOriginal.get(originalId) || { patient: false, professional: false };
      if (visibility === 'patient' || visibility === 'shared' || visibility === 'family' || type === 'shared') {
        marker.patient = true;
      }
      if (visibility === 'professional' || type === 'professional') {
        marker.professional = true;
      }
      copiesByOriginal.set(originalId, marker);
    }

    return normalized.map((note: any) => {
      const originalId = String(note?.originalId || '').trim();
      if (originalId) return note;
      const marker = copiesByOriginal.get(String(note?.id || ''));
      return {
        ...note,
        hasSharedCopy: Boolean(marker?.patient || note?.hasSharedCopy),
        hasProfessionalCopy: Boolean(marker?.professional || note?.hasProfessionalCopy)
      };
    });
  };
  const [clinicStateHydrated, setClinicStateHydrated] = useState(false);
  const [clinicStateSyncReady, setClinicStateSyncReady] = useState(false);
  const clinicStateSyncTimerRef = useRef<any>(null);
  const profileMediaFetchRef = useRef<{ userId: string; fetchedAt: number; inFlight: boolean } | null>(null);
  const activityLogsFetchRef = useRef<{ key: string; fetchedAt: number; inFlight: boolean } | null>(null);
  const inactivityTimerRef = useRef<any>(null);
  const autoLogoutInProgressRef = useRef(false);
  const manualLogoutInProgressRef = useRef(false);
  const AUTO_LOGOUT_IDLE_MS = 15 * 60 * 1000;
  const PROFILE_MEDIA_REFRESH_TTL_MS = 5 * 60 * 1000;
  const ACTIVITY_LOGS_REFRESH_TTL_MS = 5 * 60 * 1000;

  const isAgendaStatusInteractionLog = (action: string, details: string) => {
    const normalized = `${action || ""} ${details || ""}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const mentionsAgenda =
      normalized.includes("consulta") ||
      normalized.includes("agendamento") ||
      normalized.includes("agenda");
    const mentionsStatus =
      normalized.includes("confirm") ||
      normalized.includes("remarc") ||
      normalized.includes("cancel");
    return mentionsAgenda && mentionsStatus;
  };

  const onAddActivityLog = async (action: string, details: string, category: 'clinical' | 'management' | 'system' = 'clinical') => {
    if (String(user?.role || "").toLowerCase() === "patient" && !isAgendaStatusInteractionLog(action, details)) {
      return;
    }

    const newLog = normalizeActivityLog({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      professional: user?.name || "Profissional",
      actor_name: user?.name || "Profissional",
      title: action,
      content: details,
      type: category,
      action,
      details,
      category,
      source: 'client'
    });
    
    setActivityLogs(prev => [newLog, ...prev]);

    // Sync to Backend
    const { dataService } = await import('./services/dataService');
    await dataService.saveActivityLog(newLog);
  };
  
  
  type BillingTierOption = {
    from?: number | null;
    to?: number | null;
    upTo: number | null;
    unitAmountCents: number | null;
    flatAmountCents: number | null;
    unitAmountDecimal?: string | null;
    flatAmountDecimal?: string | null;
    displayLabel?: string | null;
    displayPrice?: string | null;
  };

  type BillingPlanOption = {
    productId: string;
    priceId: string;
    name: string;
    description?: string | null;
    currency: string;
    interval?: string | null;
    intervalCount?: number | null;
    billingScheme?: string | null;
    tiersMode?: string | null;
    unitAmountCents?: number | null;
    unitAmountDecimal?: string | null;
    tiers?: BillingTierOption[];
    patientLimit?: number | null;
    minPatients?: number | null;
    maxPatients?: number | null;
    pricingModel?: string;
    usesActivePatientQuantity?: boolean;
    isCustom?: boolean;
    enterpriseThreshold?: number | null;
  };

  type BillingEstimateOption = {
    priceId: string;
    activePatients: number;
    matchedTier: BillingTierOption | null;
    estimatedAmountCents: number | null;
    stripeEstimatedAmountCents?: number | null;
    currency: string;
    isEnterprise: boolean;
    enterpriseThreshold?: number | null;
    patientBasedBillingEnabled?: boolean;
    patientBasedBillingPreview?: {
      activePatientCount: number;
      unitPriceCents: number;
      totalAmountCents: number;
      nextMilestone: number | null;
      patientsUntilMilestone: number | null;
      milestonePriceCents: number | null;
    } | null;
  };

  type BillingPatientPricingTierOption = {
    patientLimit: number;
    fixedMonthlyPriceCents: number;
  };

  type BillingRangeCard = {
    key: string;
    kind: 'self_service' | 'enterprise';
    priceId?: string;
    label: string;
    description: string;
    fromPatients?: number;
    activePatients: number | null;
    estimatedAmountCents: number | null;
    unitPriceCents?: number | null;
    milestonePriceCents?: number | null;
    milestoneSavingsCents?: number | null;
    currency: string;
  };

  const centsFromDecimal = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  };

  const formatBillingCurrency = (amountCents: number | null | undefined, currency = 'brl') => {
    if (typeof amountCents !== 'number' || !Number.isFinite(amountCents)) return 'Aguardando estimativa';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: String(currency || 'brl').toUpperCase()
    }).format(amountCents / 100);
  };

  const roundUpBillingUnitToRealCents = (amountCents: number) => {
    if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
    return Math.ceil(amountCents / 100) * 100;
  };

  const estimatePatientPackageAmountCents = (quantity: number, patientLimit: number, fixedMonthlyPriceCents: number) => {
    const safeQuantity = Math.max(1, Math.floor(Number(quantity || 1)));
    const safeLimit = Math.max(1, Math.floor(Number(patientLimit || 1)));
    const safeFixed = Math.max(0, Math.round(Number(fixedMonthlyPriceCents || 0)));
    const unitPriceCents = roundUpBillingUnitToRealCents(safeFixed / safeLimit);
    return safeQuantity === safeLimit ? safeFixed : safeQuantity * unitPriceCents;
  };

  const normalizePatientPricingTiers = (tiers: BillingPatientPricingTierOption[] = []) =>
    (Array.isArray(tiers) ? tiers : [])
      .map((tier) => ({
        patientLimit: Math.max(1, Math.floor(Number(tier?.patientLimit || 0))),
        fixedMonthlyPriceCents: Math.max(0, Math.round(Number(tier?.fixedMonthlyPriceCents || 0)))
      }))
      .filter((tier) => tier.patientLimit > 0 && tier.fixedMonthlyPriceCents > 0)
      .sort((a, b) => a.patientLimit - b.patientLimit);

  const describeBillingTierRange = (tier: BillingTierOption | null | undefined, fallbackIndex = 0, tiers: BillingTierOption[] = []) => {
    if (!tier) return '';
    const previousTier = fallbackIndex > 0 ? tiers[fallbackIndex - 1] : null;
    const from = Number(tier.from || (previousTier?.upTo ? Number(previousTier.upTo) + 1 : 1));
    const to = tier.to === null || tier.upTo === null ? null : Number(tier.to || tier.upTo || 0);
    if (to === null) return `Acima de ${Math.max(0, from - 1)} pacientes ativos`;
    return `${from} a ${to} pacientes ativos`;
  };

  const findMatchedBillingTier = (plan: BillingPlanOption | null, quantity: number) => {
    const tiers = Array.isArray(plan?.tiers) ? plan!.tiers! : [];
    const safeQuantity = Math.max(1, Math.floor(Number(quantity || 1)));
    return tiers.find((tier, index) => {
      const previousTier = index > 0 ? tiers[index - 1] : null;
      const from = Number(tier.from || (previousTier?.upTo ? Number(previousTier.upTo) + 1 : 1));
      const to = tier.to === null || tier.upTo === null ? Number.MAX_SAFE_INTEGER : Number(tier.to || tier.upTo || 0);
      return safeQuantity >= from && safeQuantity <= to;
    }) || null;
  };

  const describeBillingRange = (plan: BillingPlanOption, index = 0) => {
    if (plan.isCustom) return 'Plano personalizado';
    const min = Number(plan.minPatients || (index === 0 ? 1 : 0));
    const max = Number(plan.maxPatients || plan.patientLimit || 0);
    if (min > 0 && max > 0 && min !== max) return `${min} a ${max} pacientes ativos`;
    if (max > 0) return `Até ${max} pacientes ativos`;
    return 'Pacientes ativos';
  };

  const describeBillingRangeAudience = (maxPatients: number | null) => {
    if (!maxPatients || maxPatients <= 5) return 'Para início ou consultório pequeno.';
    if (maxPatients <= 10) return 'Para clínicas em crescimento.';
    if (maxPatients <= 20) return 'Para equipes com agenda mais ativa.';
    if (maxPatients <= 30) return 'Para clínicas em expansão.';
    if (maxPatients <= 50) return 'Para clínicas com operação consolidada.';
    return 'Para clínicas com maior volume de pacientes ativos.';
  };

  const estimateStripePlanAmountCents = (plan: BillingPlanOption | null, quantity: number) => {
    if (!plan) return null;
    const safeQuantity = Math.max(1, Math.floor(Number(quantity || 1)));
    const unitAmount = typeof plan.unitAmountCents === 'number' ? plan.unitAmountCents : centsFromDecimal(plan.unitAmountDecimal);
    const tiers = Array.isArray(plan.tiers) ? plan.tiers : [];
    if (tiers.length > 0) {
      const tiersMode = String(plan.tiersMode || 'graduated').toLowerCase();
      if (tiersMode === 'volume') {
        const tier = tiers.find((item) => item.upTo === null || safeQuantity <= Number(item.upTo || 0)) || tiers[tiers.length - 1];
        const tierUnit = typeof tier?.unitAmountCents === 'number' ? tier.unitAmountCents : centsFromDecimal(tier?.unitAmountDecimal);
        const tierFlat = typeof tier?.flatAmountCents === 'number' ? tier.flatAmountCents : centsFromDecimal(tier?.flatAmountDecimal) || 0;
        return typeof tierUnit === 'number' ? tierUnit * safeQuantity + tierFlat : tierFlat || null;
      }

      let remaining = safeQuantity;
      let previousLimit = 0;
      let total = 0;
      for (const tier of tiers) {
        if (remaining <= 0) break;
        const limit = tier.upTo === null ? safeQuantity : Number(tier.upTo || 0);
        const unitsInTier = Math.max(0, Math.min(remaining, limit - previousLimit));
        const tierUnit = typeof tier.unitAmountCents === 'number' ? tier.unitAmountCents : centsFromDecimal(tier.unitAmountDecimal) || 0;
        const tierFlat = typeof tier.flatAmountCents === 'number' ? tier.flatAmountCents : centsFromDecimal(tier.flatAmountDecimal) || 0;
        if (unitsInTier > 0) total += unitsInTier * tierUnit + tierFlat;
        remaining -= unitsInTier;
        previousLimit = limit;
      }
      return total || null;
    }
    if (plan.usesActivePatientQuantity && typeof unitAmount === 'number') return unitAmount * safeQuantity;
    return unitAmount;
  };

  const handleCheckout = async (options?: { selectedPriceId?: string; activePatients?: number }) => {
    const friendlyCheckoutMessage = (code: string, rawError?: string) => {
      switch (code) {
        case 'PRICE_NOT_AVAILABLE':
          return 'Este plano não está disponível no momento.';
        case 'INVALID_ACTIVE_PATIENTS':
          return 'Selecione uma faixa válida de pacientes.';
        case 'ENTERPRISE_REQUIRED':
          return 'Para esse volume, solicite uma proposta personalizada.';
        case 'MISSING_STRIPE_CONFIG':
          return 'Pagamento indisponível no momento. Fale com o suporte.';
        case 'MISSING_ORGANIZATION':
          return 'Não foi possível identificar a clínica para iniciar o pagamento.';
        case 'STRIPE_CUSTOMER_FAILED':
          return 'Não foi possível preparar o cliente de pagamento agora. Tente novamente.';
        case 'PRICE_USAGE_TYPE_NOT_SUPPORTED_FOR_CHECKOUT':
          return 'Este plano ainda não está configurado para checkout automático. Fale com o suporte para ajustar a contratação.';
        case 'CHECKOUT_SESSION_FAILED':
          return 'Não foi possível iniciar o pagamento agora. Tente novamente em instantes.';
        default:
          return /erro interno do servidor/i.test(String(rawError || ''))
            ? 'Não foi possível iniciar o pagamento agora. Tente novamente em instantes.'
            : rawError || 'Não foi possível iniciar o pagamento agora. Confira os dados ou tente novamente em instantes.';
      }
    };
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options || {})
      });
      const data = await response.json().catch(() => ({}));
      if (data.url) {
        window.location.href = data.url;
        return { success: true };
      }
      const code = String(data?.code || '');
      return {
        success: false,
        code,
        error: friendlyCheckoutMessage(code, data?.error)
      };
    } catch (error: any) {
      console.error('Checkout error:', error);
      return {
        success: false,
        code: 'NETWORK_ERROR',
        error: 'Não foi possível conectar ao checkout agora. Tente novamente em instantes.'
      };
    }
  };

  const handleEnterpriseContact = (currentUser: any, contactUrl?: string | null) => {
    const message = `Olá! Tenho interesse em uma proposta personalizada da Verto.\n\nNome: ${currentUser?.name || ''}\nEmail: ${currentUser?.email || ''}`;
    const safeContactUrl = String(contactUrl || '').trim();
    const target = safeContactUrl
      ? safeContactUrl.startsWith('mailto:')
        ? `${safeContactUrl}${safeContactUrl.includes('?') ? '&' : '?'}subject=${encodeURIComponent('Proposta personalizada Verto')}&body=${encodeURIComponent(message)}`
        : `${safeContactUrl}${safeContactUrl.includes('?') ? '&' : '?'}text=${encodeURIComponent(message)}`
      : `mailto:comercial@appverto.com.br?subject=${encodeURIComponent('Proposta personalizada Verto')}&body=${encodeURIComponent(message)}`;
    window.open(target, '_blank', 'noopener,noreferrer');
  };

  const confirmActivePatientBillingUpgrade = async (result: any) => {
    const details = result?.details || result?.data?.details || result?.data || {};
    const message =
      String(result?.message || result?.error || '').trim() ||
      `Seu plano atual cobre até ${details.currentLimit || 0} pacientes ativos. Para ativar este paciente, atualize a faixa.`;
    if (details.enterpriseRequired) {
      window.alert(`${message}\n\nPara volumes acima do limite self-service, solicite uma proposta personalizada.`);
      handleEnterpriseContact(user, details.salesContactUrl);
      return false;
    }

    const requiredLimit = Number(details.requiredLimit || details.pendingBillingQuantity || 0);
    if (!Number.isFinite(requiredLimit) || requiredLimit < 1) {
      window.alert('Não foi possível identificar a nova faixa de pacientes ativos. Tente novamente ou fale com o suporte.');
      return false;
    }

    const confirmed = window.confirm(
      `${message}\n\nA atualização será confirmada agora, entra no próximo ciclo de faturamento e não gera cobrança proporcional imediata. Deseja confirmar o upgrade?`
    );
    if (!confirmed) return false;

    const response = await fetch('/api/billing/active-patient-limit/confirm-upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestedLimit: requiredLimit,
        activePatients: Number(details.requiredActivePatients || requiredLimit)
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) {
      window.alert(payload?.error || 'Não foi possível confirmar o upgrade agora. Tente novamente em instantes.');
      return false;
    }
    window.alert(payload?.message || 'Upgrade confirmado. Você pode ativar o paciente agora.');
    return true;
  };

  const SubscriptionRequired = ({ user, onLogout }: { user: any, onLogout: () => void }) => {
    const isPatientCheckout = String(user?.role || '').toLowerCase() === 'patient';
    const [plansState, setPlansState] = useState<{
      loading: boolean;
      error: string;
      plans: BillingPlanOption[];
      salesContactUrl: string;
      pricingModel: string;
      patientBasedBillingEnabled: boolean;
      patientPricingTiers: BillingPatientPricingTierOption[];
      enterpriseThreshold: number;
    }>({
      loading: !isPatientCheckout,
      error: '',
      plans: [],
      salesContactUrl: '',
      pricingModel: '',
      patientBasedBillingEnabled: false,
      patientPricingTiers: [],
      enterpriseThreshold: 50
    });
    const [plansReloadToken, setPlansReloadToken] = useState(0);
    const [selectedPriceId, setSelectedPriceId] = useState('');
    const [selectedBillingRangeKey, setSelectedBillingRangeKey] = useState('');
    const [selectedActivePatientQuantity, setSelectedActivePatientQuantity] = useState<number | null>(null);
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [checkoutError, setCheckoutError] = useState('');
    const [estimateState, setEstimateState] = useState<{
      loading: boolean;
      error: string;
      data: BillingEstimateOption | null;
    }>({ loading: false, error: '', data: null });

    useEffect(() => {
      if (isPatientCheckout) return;
      let cancelled = false;
      const loadPlans = async () => {
        setPlansState((current) => ({ ...current, loading: true, error: '' }));
        try {
          const response = await fetch('/api/billing/plans');
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || payload?.success === false) {
            throw new Error(payload?.error || 'Não foi possível carregar os planos agora.');
          }
          if (cancelled) return;
          const data = payload?.data || {};
          const loadedPlans = Array.isArray(data.plans) ? data.plans : [];
          setPlansState({
            loading: false,
            error: '',
            plans: loadedPlans,
            salesContactUrl: String(data.salesContactUrl || ''),
            pricingModel: String(data.pricingModel || ''),
            patientBasedBillingEnabled: data.patientBasedBillingEnabled === true,
            patientPricingTiers: normalizePatientPricingTiers(data.patientPricingTiers || []),
            enterpriseThreshold: Number(data.enterpriseThreshold || 50)
          });
          const defaultPriceId =
            String(data.defaultPriceId || '') ||
            String(loadedPlans.find((plan: BillingPlanOption) => !plan.isCustom)?.priceId || '');
          setSelectedPriceId((current) => current || defaultPriceId);
        } catch (error: any) {
          if (cancelled) return;
          setPlansState((current) => ({
            ...current,
            loading: false,
            error: error?.message || 'Não foi possível carregar os planos agora. Tente novamente em alguns instantes.'
          }));
        }
      };
      void loadPlans();
      return () => {
        cancelled = true;
      };
    }, [isPatientCheckout, plansReloadToken]);

    const nonCustomPlans = plansState.plans.filter((plan) => !plan.isCustom);
    const selectedPlan =
      nonCustomPlans.find((plan) => plan.priceId === selectedPriceId) ||
      nonCustomPlans[0] ||
      null;
    const tieredPlan = selectedPlan?.tiers?.length ? selectedPlan : nonCustomPlans.find((plan) => (plan.tiers || []).length > 0) || null;
    const enterpriseThreshold = Number(selectedPlan?.enterpriseThreshold || plansState.enterpriseThreshold || 50);
    const billingRangeCards: BillingRangeCard[] = [];
    const rangePlan = tieredPlan || selectedPlan;
    const patientPricingTiers = normalizePatientPricingTiers(plansState.patientPricingTiers);
    const usePatientPackagePricing = plansState.patientBasedBillingEnabled && patientPricingTiers.length > 0 && Boolean(rangePlan?.priceId);
    if (usePatientPackagePricing && rangePlan) {
      patientPricingTiers.forEach((tier, index) => {
        const previousLimit = index > 0 ? patientPricingTiers[index - 1].patientLimit : 0;
        const from = previousLimit + 1;
        const to = tier.patientLimit;
        if (!to || to > enterpriseThreshold) return;
        const unitPriceCents = roundUpBillingUnitToRealCents(tier.fixedMonthlyPriceCents / tier.patientLimit);
        const milestoneSavingsCents = Math.max(0, unitPriceCents * tier.patientLimit - tier.fixedMonthlyPriceCents);
        billingRangeCards.push({
          key: `patient-package-${from}-${to}`,
          kind: 'self_service',
          priceId: rangePlan.priceId,
          label: from === to ? `${to} paciente ativo` : `${from} a ${to} pacientes ativos`,
          description: `R$ ${(unitPriceCents / 100).toFixed(0)} por paciente antes do marco. No paciente ${to}, fecha em ${formatBillingCurrency(tier.fixedMonthlyPriceCents, rangePlan.currency)}.`,
          fromPatients: from,
          activePatients: to,
          estimatedAmountCents: tier.fixedMonthlyPriceCents,
          unitPriceCents,
          milestonePriceCents: tier.fixedMonthlyPriceCents,
          milestoneSavingsCents,
          currency: rangePlan.currency
        });
      });
    } else if (rangePlan?.tiers?.length) {
      (rangePlan.tiers || []).forEach((tier, index) => {
        const previousTier = index > 0 ? (rangePlan.tiers || [])[index - 1] : null;
        const from = Number(tier.from || (previousTier?.upTo ? Number(previousTier.upTo) + 1 : 1));
        const to = tier.to === null || tier.upTo === null ? null : Number(tier.to || tier.upTo || 0);
        if (!to || to > enterpriseThreshold) return;
        const label = String(tier.displayLabel || '') || describeBillingTierRange(tier, index, rangePlan.tiers || []);
        billingRangeCards.push({
          key: `tier-${from}-${to}`,
          kind: 'self_service',
          priceId: rangePlan.priceId,
          label,
          description: describeBillingRangeAudience(to),
          fromPatients: from,
          activePatients: to,
          estimatedAmountCents: estimateStripePlanAmountCents(rangePlan, to),
          currency: rangePlan.currency
        });
      });
    } else {
      nonCustomPlans.forEach((plan, index) => {
        const hasExplicitLimit = Boolean(plan.maxPatients || plan.patientLimit);
        if (!hasExplicitLimit) return;
        const activePatients = Number(plan.maxPatients || plan.patientLimit || plan.minPatients || 1);
        if (!activePatients || activePatients > enterpriseThreshold) return;
        const label = describeBillingRange(plan, index);
        if (label === 'Pacientes ativos') return;
        billingRangeCards.push({
          key: `plan-${plan.priceId}-${activePatients}`,
          kind: 'self_service',
          priceId: plan.priceId,
          label,
          description: describeBillingRangeAudience(activePatients),
          fromPatients: Number(plan.minPatients || (index === 0 ? 1 : activePatients)),
          activePatients,
          estimatedAmountCents: estimateStripePlanAmountCents(plan, activePatients),
          currency: plan.currency
        });
      });
    }
    billingRangeCards.push({
      key: 'enterprise-over-threshold',
      kind: 'enterprise',
      label: `Mais de ${enterpriseThreshold} pacientes ativos`,
      description: 'Plano personalizado com proposta sob medida.',
      activePatients: null,
      estimatedAmountCents: null,
      currency: selectedPlan?.currency || 'brl'
    });
    const selectedBillingRange = billingRangeCards.find((card) => card.key === selectedBillingRangeKey) || null;
    const selectedRangeFrom = selectedBillingRange?.kind === 'self_service'
      ? Math.max(1, Number(selectedBillingRange.fromPatients || 1))
      : 1;
    const selectedRangeTo = selectedBillingRange?.kind === 'self_service'
      ? Math.max(selectedRangeFrom, Number(selectedBillingRange.activePatients || selectedRangeFrom))
      : null;
    const selectedActivePatients = selectedBillingRange?.kind === 'self_service'
      ? Math.min(
          selectedRangeTo || selectedRangeFrom,
          Math.max(selectedRangeFrom, Number(selectedActivePatientQuantity || selectedRangeTo || selectedRangeFrom))
        )
      : null;
    const selectedBillingPriceId = selectedBillingRange?.kind === 'self_service' ? String(selectedBillingRange.priceId || '') : '';
    const isEnterpriseSelected = !isPatientCheckout && selectedBillingRange?.kind === 'enterprise';
    const selectedQuantityOptions =
      selectedBillingRange?.kind === 'self_service' && selectedRangeTo
        ? Array.from({ length: selectedRangeTo - selectedRangeFrom + 1 }, (_, index) => selectedRangeFrom + index)
        : [];
    const fallbackEstimatedAmountCents =
      selectedBillingRange?.kind === 'self_service' &&
      selectedActivePatients &&
      selectedBillingRange.milestonePriceCents &&
      selectedBillingRange.activePatients
        ? estimatePatientPackageAmountCents(selectedActivePatients, selectedBillingRange.activePatients, selectedBillingRange.milestonePriceCents)
        : selectedBillingRange?.estimatedAmountCents ?? null;
    const estimatedAmountCents =
      selectedActivePatients &&
      estimateState.data?.priceId === selectedBillingPriceId &&
      estimateState.data?.activePatients === selectedActivePatients
        ? estimateState.data.estimatedAmountCents
        : fallbackEstimatedAmountCents;
    const matchedTier =
      selectedActivePatients &&
      estimateState.data?.priceId === selectedBillingPriceId &&
      estimateState.data?.activePatients === selectedActivePatients
        ? estimateState.data.matchedTier
        : selectedActivePatients
          ? findMatchedBillingTier(tieredPlan, selectedActivePatients)
          : null;
    const selectedUnitPriceCents =
      estimateState.data?.patientBasedBillingPreview?.unitPriceCents ||
      selectedBillingRange?.unitPriceCents ||
      null;
    const selectedMilestonePriceCents =
      estimateState.data?.patientBasedBillingPreview?.milestonePriceCents ||
      selectedBillingRange?.milestonePriceCents ||
      null;
    const selectedPatientsUntilMilestone =
      estimateState.data?.patientBasedBillingPreview?.patientsUntilMilestone ??
      (selectedBillingRange?.kind === 'self_service' && selectedActivePatients && selectedRangeTo
        ? Math.max(0, selectedRangeTo - selectedActivePatients)
        : null);
    const selectedMilestoneSavingsCents =
      selectedUnitPriceCents && selectedMilestonePriceCents && selectedRangeTo
        ? Math.max(0, selectedUnitPriceCents * selectedRangeTo - selectedMilestonePriceCents)
        : selectedBillingRange?.milestoneSavingsCents || 0;
    const clinicOperationType = String(
      user?.clinicOperationType ||
        user?.clinic_operation_type ||
        user?.clinicSettings?.clinicOperationType ||
        user?.metadata?.clinicOperationType ||
        ''
    ).toLowerCase();
    const operationCopy =
      clinicOperationType === 'private'
        ? 'Você poderá começar sem configurar convênios, TISS ou TUSS.'
        : clinicOperationType === 'insurance' || clinicOperationType === 'mixed'
          ? 'Depois da ativação, você poderá configurar pagadores, regras TUSS e pré-faturamento.'
        : 'As configurações de convênio e TISS podem ser feitas depois, dentro da Verto.';

    useEffect(() => {
      if (!selectedBillingRange || selectedBillingRange.kind !== 'self_service') {
        setSelectedActivePatientQuantity(null);
        return;
      }
      const from = Math.max(1, Number(selectedBillingRange.fromPatients || 1));
      const to = Math.max(from, Number(selectedBillingRange.activePatients || from));
      setSelectedActivePatientQuantity((current) => {
        const safeCurrent = Number(current || 0);
        if (Number.isFinite(safeCurrent) && safeCurrent >= from && safeCurrent <= to) return Math.floor(safeCurrent);
        return to;
      });
    }, [selectedBillingRangeKey, selectedBillingRange?.fromPatients, selectedBillingRange?.activePatients]);

    useEffect(() => {
      if (isPatientCheckout || !selectedBillingPriceId || !selectedBillingRange || selectedBillingRange.kind !== 'self_service' || !selectedActivePatients) {
        setEstimateState({ loading: false, error: '', data: null });
        return;
      }
      let cancelled = false;
      const loadEstimate = async () => {
        setEstimateState({ loading: true, error: '', data: null });
        try {
          const response = await fetch('/api/billing/estimate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              selectedPriceId: selectedBillingPriceId,
              priceId: selectedBillingPriceId,
              activePatients: selectedActivePatients
            })
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || payload?.success === false) {
            throw new Error(payload?.error || 'Não foi possível calcular a estimativa agora.');
          }
          if (!cancelled) {
            setEstimateState({
              loading: false,
              error: '',
              data: payload?.data || null
            });
          }
        } catch (error: any) {
          if (!cancelled) {
            setEstimateState({
              loading: false,
              error: error?.message || 'Não foi possível calcular a estimativa agora.',
              data: null
            });
          }
        }
      };
      void loadEstimate();
      return () => {
        cancelled = true;
      };
    }, [isPatientCheckout, selectedBillingPriceId, selectedBillingRangeKey, selectedActivePatients]);

    const submitCheckout = async () => {
      if (checkoutLoading) return;
      if (!isPatientCheckout && isEnterpriseSelected) {
        handleEnterpriseContact(user, plansState.salesContactUrl);
        return;
      }
      if (!isPatientCheckout && (!selectedBillingRange || selectedBillingRange.kind !== 'self_service' || !selectedActivePatients || !selectedBillingPriceId)) {
        setCheckoutError('Selecione uma faixa válida de pacientes antes de continuar.');
        return;
      }
      setCheckoutError('');
      setCheckoutLoading(true);
      try {
        const result = await handleCheckout(
          isPatientCheckout
            ? undefined
            : {
                selectedPriceId: selectedBillingPriceId,
                activePatients: selectedActivePatients || undefined
              }
        );
        if (!result?.success) {
          if (result?.code === 'ENTERPRISE_REQUIRED') {
            setCheckoutError('Para essa quantidade de pacientes ativos, solicite uma proposta personalizada com o comercial.');
          } else {
            setCheckoutError(result?.error || 'Não foi possível iniciar o pagamento agora. Confira os dados ou tente novamente em instantes.');
          }
        }
      } finally {
        setCheckoutLoading(false);
      }
    };

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
        <div className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl shadow-blue-500/5 p-8 sm:p-10 border border-slate-100 animate-pop">
          <div className="text-center">
            <div className="w-20 h-20 bg-blue-50 text-[#7a32fc] rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-inner">
              <Lock size={40} />
            </div>
            <h2 className="text-3xl font-bold text-slate-900 mb-4 tracking-tight">Escolha seu plano</h2>
            <p className="text-slate-500 font-normal mb-8 leading-relaxed">
              Para acessar o painel completo da Verto, é necessário ativar uma assinatura ou um trial autorizado.
              {isPatientCheckout ? (
                <span> O valor para pacientes é de apenas <strong>R$ 4,90/mês</strong>.</span>
              ) : (
                <span> A cobrança da Verto é modular, de acordo com a quantidade de pacientes ativos da sua clínica.</span>
              )}
            </p>
          </div>

          {!isPatientCheckout && (
            <div className="mb-8 space-y-5 text-left">
              <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm font-semibold text-violet-800">
                {operationCopy}
              </div>

              {plansState.loading && (
                <div className="grid gap-3">
                  {[1, 2, 3].map((item) => (
                    <div key={item} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
                  ))}
                </div>
              )}

              {!plansState.loading && plansState.error && (
                <div className="rounded-3xl border border-rose-100 bg-rose-50 p-5">
                  <p className="text-sm font-bold text-rose-700">Não foi possível carregar os planos agora.</p>
                  <p className="mt-1 text-xs font-semibold text-rose-600">{plansState.error}</p>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => setPlansReloadToken((current) => current + 1)}
                      className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-rose-700 shadow-sm"
                    >
                      Tentar novamente
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEnterpriseContact(user, plansState.salesContactUrl)}
                      className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white shadow-sm"
                    >
                      Falar com o comercial
                    </button>
                  </div>
                </div>
              )}

              {!plansState.loading && !plansState.error && nonCustomPlans.length === 0 && (
                <div className="rounded-3xl border border-amber-100 bg-amber-50 p-5">
                  <p className="text-sm font-bold text-amber-800">Nenhum plano automático disponível no momento.</p>
                  <p className="mt-1 text-xs font-semibold text-amber-700">
                    Solicite uma proposta personalizada ou tente carregar os planos novamente.
                  </p>
                </div>
              )}

              {!plansState.loading && !plansState.error && billingRangeCards.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {billingRangeCards.map((card) => {
                    const selected = selectedBillingRangeKey === card.key;
                    const isEnterprise = card.kind === 'enterprise';
                    return (
                      <button
                        type="button"
                        key={card.key}
                        aria-pressed={selected}
                        onClick={() => {
                          setCheckoutError('');
                          setSelectedBillingRangeKey(card.key);
                          setSelectedActivePatientQuantity(card.kind === 'self_service' ? card.activePatients : null);
                          if (card.kind === 'self_service' && card.priceId) {
                            setSelectedPriceId(card.priceId);
                          }
                        }}
                        className={`rounded-3xl border p-5 text-left transition-all ${
                          selected
                            ? isEnterprise
                              ? 'border-slate-950 bg-slate-950 text-white shadow-xl shadow-slate-500/20'
                              : 'border-[#7a32fc] bg-violet-50 shadow-xl shadow-violet-500/10'
                            : 'border-slate-200 bg-white hover:border-violet-200 hover:shadow-lg hover:shadow-slate-200/70'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className={`text-sm font-black ${selected && isEnterprise ? 'text-white' : 'text-slate-900'}`}>
                              {card.label}
                            </p>
                            <p className={`mt-2 text-xs font-semibold leading-relaxed ${selected && isEnterprise ? 'text-slate-300' : 'text-slate-500'}`}>
                              {card.description}
                            </p>
                          </div>
                          {selected && (
                            <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
                              isEnterprise ? 'bg-white/15 text-white' : 'bg-violet-100 text-violet-700'
                            }`}>
                              Escolhido
                            </span>
                          )}
                        </div>
                        <div className={`mt-5 rounded-2xl px-4 py-3 ${selected && isEnterprise ? 'bg-white/10' : 'bg-slate-50'}`}>
                          <p className={`text-[10px] font-black uppercase tracking-widest ${selected && isEnterprise ? 'text-slate-300' : 'text-slate-400'}`}>
                            {isEnterprise ? 'Atendimento comercial' : `Marco de desconto em ${card.activePatients} pacientes`}
                          </p>
                          <p className={`mt-1 text-base font-black ${selected && isEnterprise ? 'text-white' : 'text-slate-950'}`}>
                            {isEnterprise ? 'Plano personalizado' : `${formatBillingCurrency(card.estimatedAmountCents, card.currency)}/mês`}
                          </p>
                          {!isEnterprise && card.unitPriceCents && (
                            <p className="mt-1 text-[11px] font-bold text-slate-500">
                              {formatBillingCurrency(card.unitPriceCents, card.currency)} por paciente antes do marco
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {!plansState.loading && !plansState.error && (
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  {!selectedBillingRange ? (
                    <div>
                      <p className="text-sm font-black text-slate-900">Selecione uma faixa para ver a estimativa.</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        Os valores são carregados diretamente da configuração de planos da Verto.
                      </p>
                    </div>
                  ) : isEnterpriseSelected ? (
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-black text-slate-900">Plano personalizado</p>
                        <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-500">
                          Para clínicas com mais de {enterpriseThreshold} pacientes ativos, nossa equipe prepara uma proposta sob medida.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleEnterpriseContact(user, plansState.salesContactUrl)}
                        className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-sm"
                      >
                        Solicitar proposta personalizada
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Faixa selecionada</p>
                          <p className="mt-1 text-sm font-black text-slate-900">{selectedBillingRange.label}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">
                            Escolha a quantidade exata dentro deste marco. O checkout será criado com {selectedActivePatients} pacientes ativos.
                          </p>
                        </div>
                        <div className="rounded-2xl bg-white px-4 py-3 text-left shadow-sm sm:text-right">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Estimativa mensal</p>
                          <p className="mt-1 text-lg font-black text-slate-950">
                            {estimateState.loading
                              ? 'Calculando...'
                              : formatBillingCurrency(estimatedAmountCents, selectedBillingRange.currency || selectedPlan?.currency || 'brl')}
                          </p>
                        </div>
                      </div>
                      {selectedQuantityOptions.length > 0 && (
                        <div className="mt-4">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            Quantidade de pacientes ativos
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {selectedQuantityOptions.map((quantity) => {
                              const selectedQuantity = quantity === selectedActivePatients;
                              const quantityAmount = selectedBillingRange.milestonePriceCents && selectedBillingRange.activePatients
                                ? estimatePatientPackageAmountCents(quantity, selectedBillingRange.activePatients, selectedBillingRange.milestonePriceCents)
                                : null;
                              return (
                                <button
                                  key={quantity}
                                  type="button"
                                  aria-pressed={selectedQuantity}
                                  onClick={() => setSelectedActivePatientQuantity(quantity)}
                                  className={`rounded-2xl border px-3 py-2 text-left transition-all ${
                                    selectedQuantity
                                      ? 'border-[#7a32fc] bg-violet-50 text-violet-800 shadow-sm'
                                      : 'border-slate-200 bg-white text-slate-600 hover:border-violet-200'
                                  }`}
                                >
                                  <span className="block text-xs font-black">{quantity}</span>
                                  {quantityAmount !== null && (
                                    <span className="block text-[10px] font-bold text-slate-500">
                                      {formatBillingCurrency(quantityAmount, selectedBillingRange.currency)}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {matchedTier && (
                        <p className="mt-3 rounded-2xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-800">
                          Faixa usada no cálculo: {describeBillingTierRange(matchedTier, 0, tieredPlan?.tiers || [])}.
                        </p>
                      )}
                      {(estimateState.data?.patientBasedBillingPreview || selectedUnitPriceCents || selectedMilestonePriceCents) && (
                        <div className="mt-3 rounded-2xl border border-violet-100 bg-white px-3 py-3 text-xs font-bold text-slate-700">
                          <p className="text-[10px] uppercase tracking-widest text-violet-600">Prévia por paciente ativo</p>
                          <p className="mt-1">
                            Pacientes ativos: {selectedActivePatients} · Preço por paciente neste marco: {formatBillingCurrency(selectedUnitPriceCents, selectedBillingRange.currency || selectedPlan?.currency || 'brl')} · Mensalidade prevista: {formatBillingCurrency(estimatedAmountCents, selectedBillingRange.currency || selectedPlan?.currency || 'brl')}
                          </p>
                          {selectedBillingRange.activePatients && selectedMilestonePriceCents && (
                            <p className="mt-1 text-slate-500">
                              Próximo marco: {selectedBillingRange.activePatients} pacientes. Ao atingir o marco: {formatBillingCurrency(selectedMilestonePriceCents, selectedBillingRange.currency || selectedPlan?.currency || 'brl')}.
                              {selectedPatientsUntilMilestone ? ` Faltam ${selectedPatientsUntilMilestone} paciente(s).` : ''}
                              {selectedMilestoneSavingsCents ? ` Economia no marco: ${formatBillingCurrency(selectedMilestoneSavingsCents, selectedBillingRange.currency || selectedPlan?.currency || 'brl')}.` : ''}
                            </p>
                          )}
                        </div>
                      )}
                      {estimateState.error && (
                        <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                          Não foi possível calcular a estimativa agora. Tente novamente.
                        </p>
                      )}
                    </div>
                  )}
                  <p className="mt-4 text-[11px] font-semibold leading-relaxed text-slate-500">
                    Paciente ativo é aquele em atendimento, com agenda/prontuário ativo na clínica. A Verto não armazena o número completo do cartão.
                  </p>
                </div>
              )}
            </div>
          )}
          
          <div className="space-y-4">
            {checkoutError && (
              <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-left">
                <p className="text-sm font-black text-rose-700">Não foi possível iniciar o pagamento agora.</p>
                <p className="mt-1 text-xs font-semibold text-rose-600">{checkoutError}</p>
              </div>
            )}
            {isPatientCheckout ? (
              <button 
                onClick={submitCheckout}
                disabled={checkoutLoading}
                className="w-full bg-[#7a32fc] text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 hover:scale-[1.02] transition-all active:scale-[0.98] disabled:opacity-60"
              >
                {checkoutLoading ? 'Abrindo pagamento...' : 'Pagar Agora (R$ 4,90)'}
              </button>
            ) : isEnterpriseSelected ? (
              <button
                onClick={() => handleEnterpriseContact(user, plansState.salesContactUrl)}
                className="w-full bg-slate-950 text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-slate-500/20 hover:scale-[1.02] transition-all active:scale-[0.98]"
              >
                Solicitar proposta personalizada
              </button>
            ) : (
              <button 
                onClick={submitCheckout}
                disabled={
                  checkoutLoading ||
                  plansState.loading ||
                  Boolean(plansState.error) ||
                  !selectedPlan ||
                  !selectedBillingPriceId ||
                  !selectedBillingRange ||
                  selectedBillingRange.kind !== 'self_service'
                }
                className="w-full bg-[#7a32fc] text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 hover:scale-[1.02] transition-all active:scale-[0.98] disabled:opacity-60"
              >
                {checkoutLoading ? 'Abrindo Stripe Checkout...' : 'Continuar para pagamento'}
              </button>
            )}
            
            <button 
              onClick={onLogout}
              className="w-full bg-white text-slate-400 py-4 rounded-2xl font-semibold text-xs hover:text-slate-600 transition-all"
            >
              Sair da conta
            </button>
          </div>
          
          <p className="mt-8 text-center text-[10px] text-slate-400 font-medium uppercase tracking-widest">
            Pagamento processado com segurança pelo Stripe.
          </p>
        </div>
      </div>
    );
  };

  const [protocols, setProtocols] = useState<any[]>([]);
  const [allPatients, setAllPatients] = useState<any[]>([]);

  useEffect(() => {
    historyRef.current = Array.isArray(history) ? history : [];
  }, [history]);
  
  const resetWorkspaceScopedState = () => {
    historyRef.current = [];
    setTherapistNotes([]);
    setHistory([]);
    setTasks([]);
    setClinicalRecords([]);
    setRooms([]);
    setTherapistAgenda([]);
    setProtocols([]);
    setAllPatients([]);
    setSpecialtySettings({});
  };

  const hydrateState = async (nextUser: any) => {
    if (!nextUser) return;

    if (
      nextUser.role !== 'therapist' &&
      nextUser.role !== 'coordinator' &&
      nextUser.role !== 'receptionist'
    ) {
      setClinicStateHydrated(true);
      setClinicStateSyncReady(false);
      return;
    }

    const workspaceId = String(nextUser?.activeWorkspaceId || nextUser?.clinicId || '').trim();
    if (!workspaceId) {
      // Fail-safe: sem workspace não pode travar a interface em loading infinito.
      setClinicStateHydrated(true);
      setClinicStateSyncReady(false);
      return;
    }

    setClinicStateHydrated(false);
    setClinicStateSyncReady(false);
    resetWorkspaceScopedState();
    let hydratedSuccessfully = false;
    try {
      const result = await withTimeout(
        dataService.hydrateWorkspaceState(workspaceId),
        12000,
        { success: false } as any,
      );

      if (!result?.success || !result?.data) {
        return;
      }

      const hydrated = result.data;
      const remoteAppointments = Array.isArray(hydrated.clinicState?.appointments) ? hydrated.clinicState.appointments : [];
      const offlineAppointmentResult = await dataService.getOfflineAppointmentDrafts?.();
      const offlineAppointments = Array.isArray(offlineAppointmentResult?.data) ? offlineAppointmentResult.data : [];
      const appointmentsById = new Map<string, any>();
      for (const appointment of remoteAppointments) {
        const id = String(appointment?.id || appointment?.appointment_id || '').trim();
        if (id) appointmentsById.set(id, appointment);
      }
      for (const appointment of offlineAppointments) {
        const id = String(appointment?.id || appointment?.appointment_id || appointment?.clientAppointmentId || '').trim();
        if (id && !appointmentsById.has(id)) appointmentsById.set(id, appointment);
      }
      setRooms(Array.isArray(hydrated.clinicState?.rooms) ? hydrated.clinicState.rooms : []);
      setTherapistAgenda(Array.from(appointmentsById.values()));
      setProtocols(Array.isArray(hydrated.clinicState?.protocols) ? hydrated.clinicState.protocols : []);
      setSpecialtySettings(
        hydrated.clinicState?.specialtySettings &&
          typeof hydrated.clinicState.specialtySettings === 'object'
          ? hydrated.clinicState.specialtySettings
          : {},
      );
      const hydratedPatients = Array.isArray(hydrated.patients) ? hydrated.patients : [];
      const visiblePatients = canAccessClinicFinance(nextUser?.role)
        ? hydratedPatients
        : hydratedPatients.map(stripPatientFinancialFields);
      const scopedPatients = nextUser?.role === 'therapist'
        ? visiblePatients.filter((p: any) => String(p?.therapist_id || p?.professional_id || '').trim() === String(nextUser?.id || '').trim())
        : visiblePatients;
      setAllPatients(scopedPatients);
      setTherapistNotes(normalizeAndDecorateNotes(Array.isArray(hydrated.notes) ? hydrated.notes : []));
      const hydratedHistory = Array.isArray(hydrated.history) ? hydrated.history : [];
      historyRef.current = hydratedHistory;
      setHistory(hydratedHistory);
      setTasks(Array.isArray(hydrated.tasks) ? hydrated.tasks : []);
      setClinicalRecords(Array.isArray(hydrated.clinicalRecords) ? hydrated.clinicalRecords : []);
      hydratedSuccessfully = true;
    } catch (error) {
      console.error('hydrateState failed:', error);
    } finally {
      setClinicStateHydrated(true);
      setClinicStateSyncReady(hydratedSuccessfully);
    }
  };

  useEffect(() => {
    if (!user) {
      setClinicStateHydrated(false);
      setClinicStateSyncReady(false);
      return;
    }

    // Paciente tem hidratação própria (histórico/tarefas/notas) e não deve
    // receber sobreposição do estado clínico global após F5.
    if (user.role === 'patient') {
      setClinicStateHydrated(false);
      setClinicStateSyncReady(false);
      return;
    }

    void hydrateState(user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role, user?.activeWorkspaceId, user?.clinicId]);

  const resolvePatientIdentityForPortal = (candidate?: any) => {
    const candidateId = String(candidate?.patientId ?? candidate?.patient_id ?? candidate?.id ?? '').trim();
    const candidateEmail = String(candidate?.patient_email || candidate?.email || '').trim().toLowerCase();

    const byId = candidateId ? allPatients.find((p: any) => String(p?.id) === candidateId) : null;
    const byEmail = candidateEmail
      ? allPatients.find((p: any) => String(p?.email || '').trim().toLowerCase() === candidateEmail)
      : null;
    const byUserEmail =
      user?.email
        ? allPatients.find(
            (p: any) => String(p?.email || '').trim().toLowerCase() === String(user.email).trim().toLowerCase(),
          )
        : null;

    return {
      patientId: String(byId?.id || byEmail?.id || byUserEmail?.id || resolvedPatientPortalId || candidateId || '').trim(),
      patientEmail: String(
        byId?.email ||
          byEmail?.email ||
          byUserEmail?.email ||
          candidateEmail ||
          user?.email ||
          '',
      )
        .trim()
        .toLowerCase() || null,
      patientName: String(
        byId?.name ||
          byEmail?.name ||
          byUserEmail?.name ||
          candidate?.patient_name ||
          candidate?.name ||
          user?.name ||
          'Paciente',
      ).trim(),
      professionalId: String(
        byId?.therapist_id ||
          byId?.professional_id ||
          byEmail?.therapist_id ||
          byEmail?.professional_id ||
          byUserEmail?.therapist_id ||
          byUserEmail?.professional_id ||
          candidate?.professional_id ||
          candidate?.professionalId ||
          ''
      ).trim() || null,
    };
  };

  useEffect(() => {
    let mounted = true;
    let running = false;
    let loadedOnce = false;
    let lastRefreshAt = 0;
    let requestGeneration = 0;
    const minimumRefreshIntervalMs = 5 * 60 * 1000;

    const fetchPatientScopedData = async (force = false) => {
      if (!mounted || running) return;
      if (!user || user.role !== 'patient' || !user.email) return;
      const now = Date.now();
      if (!force && now - lastRefreshAt < minimumRefreshIntervalMs) return;
      lastRefreshAt = now;
      running = true;
      const requestId = ++requestGeneration;
      try {
        if (mounted && !loadedOnce) setPatientContextLoaded(false);
        const portalContextResult = await dataService.getPortalContext();
        if (!mounted || requestId !== requestGeneration) return;
        const portalContext = portalContextResult?.success && portalContextResult?.data ? portalContextResult.data : null;
        const resolvedContextPatientId = String(portalContext?.resolvedPatientId || '').trim();
        if (!resolvedContextPatientId) {
          console.warn('[PatientPortal] skipped patient-scoped fetch: missing resolvedPatientId');
          if (mounted) {
            setResolvedPatientPortalId('');
            setHistory([]);
            setTherapistNotes([]);
            setTasks([]);
            setProtocols([]);
            setPatientContextLoaded(true);
          }
          loadedOnce = true;
          return;
        }
        setResolvedPatientPortalId(resolvedContextPatientId);
        setUser((prev: any) => {
          if (!prev || prev.id !== user.id) return prev;
          const previousContext = prev.portalContext || {};
          if (
            String(previousContext.resolvedPatientId || '') === resolvedContextPatientId &&
            String(previousContext.clinicName || '') === String(portalContext?.clinicName || '') &&
            String(previousContext.clinicLogoUrl || '') === String(portalContext?.clinicLogoUrl || '') &&
            String(previousContext.patientName || '') === String(portalContext?.patientName || '') &&
            String(previousContext.portalDisplayName || '') === String(portalContext?.portalDisplayName || '')
          ) {
            return prev;
          }
          return {
            ...prev,
            patientId: resolvedContextPatientId,
            patient_id: resolvedContextPatientId,
            portalContext,
            clinicSettings: {
              ...(prev?.clinicSettings || {}),
              ...(portalContext?.clinicName ? { clinicName: portalContext.clinicName } : {}),
              ...(portalContext?.clinicLogoUrl ? { clinicLogoUrl: portalContext.clinicLogoUrl } : {})
            }
          };
        });
        const identity = resolvePatientIdentityForPortal({
          ...user,
          patientId: resolvedContextPatientId,
          patient_id: resolvedContextPatientId,
          patient_email: portalContext?.resolvedPatientEmail || user.email,
          email: portalContext?.resolvedPatientEmail || user.email
        });
        const [historyRes, notesRes] = await Promise.allSettled([
          dataService.getPatientSelfHistory(),
          dataService.getNotesByEmail(portalContext?.resolvedPatientEmail || user.email)
        ]);
        if (!mounted || requestId !== requestGeneration) return;

      const safeHistoryRes = historyRes.status === 'fulfilled' ? historyRes.value : null;
      const safeNotesRes = notesRes.status === 'fulfilled' ? notesRes.value : null;

      const mergedHistoryRaw = [
        ...(Array.isArray(safeHistoryRes?.data) ? safeHistoryRes.data : [])
      ];

      const historySeen = new Set<string>();
      const mergedHistory = mergedHistoryRaw.filter((h: any) => {
        const key = String(h?.id || '') || [
          String(h?.patient_id || h?.patientId || user.id || ''),
          String(h?.type || ''),
          String(h?.title || ''),
          String(h?.created_at || h?.date || ''),
          String(h?.score ?? '')
        ].join('|');
        if (!key || historySeen.has(key)) return false;
        historySeen.add(key);
        return true;
      });

      const candidateResolvedIds = [
        ...(Array.isArray(mergedHistory) ? mergedHistory : []),
        ...(identity?.patientId ? [{ patient_id: identity.patientId }] : [])
      ]
        .map((row: any) => String(row?.patient_id || row?.patientId || '').trim())
        .filter((id: string) => id.length > 0 && id !== String(user.id || '').trim());
      if (mounted && candidateResolvedIds.length > 0) {
        setResolvedPatientPortalId(candidateResolvedIds[0]);
      }

      if (mounted) {
        const normalizedHistory = Array.isArray(mergedHistory)
          ? mergedHistory.map((h: any) => normalizeHistoryRecordForState(h, user.id))
          : [];
        historyRef.current = normalizedHistory;
        setHistory(normalizedHistory);
      }
      if (mounted) setTherapistNotes(
        normalizeAndDecorateNotes(Array.isArray(safeNotesRes?.data) ? safeNotesRes.data : [])
      );

      const fetchedTreatmentStatus = String(safeHistoryRes?.treatmentStatus || '').trim().toLowerCase();
      if (mounted && fetchedTreatmentStatus && fetchedTreatmentStatus !== String(user?.treatmentStatus || '').trim().toLowerCase()) {
        setUser((prev: any) => {
          if (!prev || prev.id !== user.id) return prev;
          return { ...prev, treatmentStatus: fetchedTreatmentStatus };
        });
      }
      if (mounted) {
        loadedOnce = true;
        setPatientContextLoaded(true);
      }

      const [tasksRes, assignedTasksRes, protocolsRes] = await Promise.allSettled([
        dataService.getPatientSelfTasks(),
        dataService.getPatientSelfAssignedTasks(),
        dataService.getPatientSelfProtocols()
      ]);
      if (!mounted || requestId !== requestGeneration) return;
      const safeTasksRes = tasksRes.status === 'fulfilled' ? tasksRes.value : null;
      const safeAssignedTasksRes = assignedTasksRes.status === 'fulfilled' ? assignedTasksRes.value : null;
      const safeProtocolsRes = protocolsRes.status === 'fulfilled' ? protocolsRes.value : null;

      const secondaryResolvedId = [
        ...(Array.isArray(safeTasksRes?.data) ? safeTasksRes.data : []),
        ...(Array.isArray(safeAssignedTasksRes?.data) ? safeAssignedTasksRes.data : [])
      ]
        .map((row: any) => String(row?.patient_id || row?.patientId || '').trim())
        .find((id: string) => id.length > 0 && id !== String(user.id || '').trim());
      if (secondaryResolvedId) setResolvedPatientPortalId(secondaryResolvedId);

      if (mounted) setTasks((() => {
        const baseTasks = Array.isArray(safeTasksRes?.data)
          ? safeTasksRes.data.map((t: any) => ({
              ...t,
              patientId: t?.patient_id || t?.patientId || user.id
            }))
          : [];
        const assignedPending = Array.isArray(safeAssignedTasksRes?.data)
          ? safeAssignedTasksRes.data
              .map((t: any) => {
                const taskData = t?.task_data && typeof t.task_data === 'object' ? t.task_data : {};
                const status = String(t?.status || 'pending').toLowerCase();
                return {
                  id: `assigned-${t.id}`,
                  assignedTaskId: t.id,
                  patientId: t?.patient_id || user.id,
                  title: taskData.title || 'Tarefa agendada',
                  description: taskData.description || '',
                  icon: taskData.icon || 'ðŸŽ¯',
                  color: taskData.color || 'bg-blue-100 text-blue-600',
                  type: t?.task_type || 'task',
                  maxScore: Number(taskData?.maxScore || taskData?.max_score || 4),
                  scheduledAt: t?.scheduled_at || null,
                  scheduled_at: t?.scheduled_at || null,
                  status: t?.status || 'pending',
                  completed: status === 'completed',
                  completed_at: t?.completed_at || null,
                  reviewed_at: t?.reviewed_at || null,
                  patient_effort: t?.patient_effort ?? taskData?.patientEffort ?? taskData?.patient_effort ?? null,
                  patientEffort: t?.patient_effort ?? taskData?.patientEffort ?? taskData?.patient_effort ?? null,
                  energy: t?.patient_effort ?? taskData?.patientEffort ?? taskData?.patient_effort ?? null,
                  patient_effort_emoji: t?.patient_effort_emoji ?? taskData?.patientEffortEmoji ?? taskData?.patient_effort_emoji ?? null,
                  patientEffortEmoji: t?.patient_effort_emoji ?? taskData?.patientEffortEmoji ?? taskData?.patient_effort_emoji ?? null,
                  patient_effort_label: t?.patient_effort_label ?? taskData?.patientEffortLabel ?? taskData?.patient_effort_label ?? null,
                  patientEffortLabel: t?.patient_effort_label ?? taskData?.patientEffortLabel ?? taskData?.patient_effort_label ?? null,
                  patient_comment: t?.patient_comment ?? '',
                  pro_score: t?.pro_score ?? taskData?.pro_score ?? taskData?.proScore ?? null,
                  professionalScore: t?.pro_score ?? taskData?.pro_score ?? taskData?.proScore ?? null,
                  max_score: t?.max_score ?? taskData?.max_score ?? taskData?.maxScore ?? null,
                  pro_review_note: t?.pro_review_note ?? taskData?.pro_review_note ?? taskData?.proReviewNote ?? '',
                  consecutive_successes: t?.consecutive_successes ?? taskData?.consecutive_successes ?? null,
                  task_data: taskData,
                  taskData,
                  professional_id: t?.professional_id || null,
                  professionalId: t?.professional_id || null
                };
              })
          : [];
        return [...baseTasks, ...assignedPending];
      })());

      if (mounted) setProtocols(Array.isArray(safeProtocolsRes?.data) ? safeProtocolsRes.data : []);

      const assignedCount = Array.isArray(safeAssignedTasksRes?.data) ? safeAssignedTasksRes.data.length : 0;
      if (mounted) setPatientAssignedTaskCount(assignedCount);
      if (mounted) setPatientAssignedTasksLoadError(
        assignedTasksRes.status === 'rejected' ||
          (safeAssignedTasksRes?.success === false && assignedCount === 0)
      );

      } finally {
        running = false;
      }
    };

    const refreshWhenVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void fetchPatientScopedData(false);
    };

    void fetchPatientScopedData(true);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      mounted = false;
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [user]);

  const patientIsReadOnlyMode = useMemo(() => {
    if (!user || user.role !== 'patient') return false;
    if (!patientContextLoaded) return false;
    const normalizedStatus = String(user?.treatmentStatus || '').trim().toLowerCase();
    const hasActiveStatus = normalizedStatus === 'active';
    const hasAssignedTasks = patientAssignedTaskCount > 0;
    const hasRenderableTasks = Array.isArray(tasks) && tasks.some((t: any) => {
      const taskType = String(t?.type || t?.task_type || '').toLowerCase();
      return taskType === 'task' || taskType === 'reinforcement' || taskType === 'intervention';
    });

    if (hasActiveStatus || hasAssignedTasks || hasRenderableTasks) return false;
    if (patientAssignedTasksLoadError) return false;
    if (!normalizedStatus) return false;
    return true;
  }, [user, patientAssignedTaskCount, patientAssignedTasksLoadError, patientContextLoaded, tasks]);

  const refreshPatientHistoryForProfessional = async (patientId: any) => {
    const normalizedPatientId = String(patientId || '').trim();
    if (!normalizedPatientId || !user || !['therapist', 'coordinator', 'receptionist', 'admin', 'owner'].includes(String(user.role || '').toLowerCase())) {
      return { success: false, error: 'Paciente inválido.' };
    }
    try {
      const result = await dataService.getHistory(normalizedPatientId);
      if (!result?.success || !Array.isArray(result?.data)) {
        return { success: false, error: result?.error || 'Não foi possível atualizar o histórico.' };
      }
      setHistory(prev => {
        const next = mergeHistoryRecords(prev, result.data, normalizedPatientId);
        historyRef.current = next;
        return next;
      });
      return { success: true, data: result.data };
    } catch (error: any) {
      console.error('Falha ao atualizar histórico persistido do paciente:', error);
      return { success: false, error: error?.message || 'Não foi possível atualizar o histórico.' };
    }
  };

  useEffect(() => {
    if (!user) return;
    if (!(user.role === 'therapist' || user.role === 'coordinator' || user.role === 'receptionist')) return;
    if (!clinicStateHydrated) return;
    if (!clinicStateSyncReady) return;

    if (clinicStateSyncTimerRef.current) {
      clearTimeout(clinicStateSyncTimerRef.current);
    }

    clinicStateSyncTimerRef.current = setTimeout(async () => {
      try {
        const workspaceId = String(user?.activeWorkspaceId || user?.clinicId || '').trim();
        const role = String(user?.role || '').toLowerCase();
        const payload: any = {
          workspace_id: workspaceId || undefined
        };
        if (role === 'coordinator' || role === 'admin' || role === 'owner') {
          payload.rooms = rooms;
          payload.protocols = protocols;
          payload.specialtySettings = specialtySettings;
        } else if (role === 'receptionist') {
          payload.rooms = rooms;
        }
        await dataService.saveClinicState(payload);
      } catch (error) {
        if (import.meta.env.DEV) console.error('Erro ao sincronizar estado clinico:', sanitizeTechnicalErrorMessage(error));
      }
    }, 800);

    return () => {
      if (clinicStateSyncTimerRef.current) {
        clearTimeout(clinicStateSyncTimerRef.current);
      }
    };
  }, [user, clinicStateHydrated, clinicStateSyncReady, rooms, protocols, specialtySettings]);

  // Fetch activity logs from Backend on load
  useEffect(() => {
    const fetchLogs = async () => {
      if (user && (user.role === 'therapist' || user.role === 'coordinator' || user.role === 'receptionist' || user.role === 'admin' || user.role === 'owner')) {
        const key = `${String(user?.id || '').trim()}:${String(user?.role || '').trim()}`;
        const previous = activityLogsFetchRef.current;
        if (previous?.key === key && (previous.inFlight || Date.now() - previous.fetchedAt < ACTIVITY_LOGS_REFRESH_TTL_MS)) {
          return;
        }
        activityLogsFetchRef.current = { key, fetchedAt: previous?.key === key ? previous.fetchedAt : 0, inFlight: true };
        try {
          const { dataService } = await import('./services/dataService');
          const { success, data } = await dataService.getActivityLogs();
          if (success && data) {
            setActivityLogs((data || []).map(normalizeActivityLog));
          }
        } finally {
          activityLogsFetchRef.current = { key, fetchedAt: Date.now(), inFlight: false };
        }
      }
    };
    fetchLogs();
  }, [user?.id, user?.role]);

  const handleAddTask = async (t: any) => {
    const patient = allPatients.find(p => p.id === t.patientId);
    const isAdultTask = Number(patient?.age || 0) > 12;
    let taskToPersist = { ...t, id: (isUuidLike(String(t?.id || '')) ? String(t.id) : crypto.randomUUID()) };
    let persistedRemotely = false;

    if (isAdultTask) {
      try {
        const assignedResult = await dataService.addAssignedTask({
          patient_id: String(t.patientId),
          patient_email: patient?.email || null,
          task_type: String(t.type || 'task'),
          task_data: {
            title: t.title,
            description: t.description || '',
            icon: t.icon || '',
            color: t.color || '',
            linkedTask: t.linkedTask || '',
            linkedProtocolId: t.linkedProtocolId || '',
            protocolId: t.protocolId || t.protocol_id || '',
            protocolTitle: t.protocolTitle || t.protocol_name || '',
            protocolCategory: t.protocolCategory || (String(t.type || 'task') === 'task' ? 'evaluation' : String(t.type || 'task')),
            domainId: t.domainId || '',
            domainName: t.domainName || '',
            skillId: t.skillId || '',
            skillName: t.skillName || t.title || '',
            maxScore: Number.isFinite(Number(t.maxScore)) ? Number(t.maxScore) : 4
          },
          scheduled_at: t.scheduledAt || new Date().toISOString(),
          status: 'pending'
        });

        if (assignedResult?.success && assignedResult?.data?.id) {
          taskToPersist = {
            ...taskToPersist,
            id: assignedResult.data.id,
            assignedTaskId: assignedResult.data.id
          };
          persistedRemotely = true;
        } else {
          console.warn('assigned_tasks não confirmou persistência, tentando fallback em tasks:', assignedResult);
        }
      } catch (error) {
        console.error('Falha ao criar assigned task, tentando fallback em tasks:', error);
      }

      if (!persistedRemotely) {
        try {
          const fallbackPersisted = await dataService.addTask({
            ...taskToPersist,
            id: String(taskToPersist.id),
            patient_id: String(taskToPersist.patientId),
            patient_email: patient?.email || null,
            title: taskToPersist.title,
            description: taskToPersist.description || '',
            type: taskToPersist.type || 'task',
            max_score:
              Number.isFinite(Number(taskToPersist.maxScore))
                ? Math.max(1, Math.min(100, Number(taskToPersist.maxScore)))
                : 4,
            icon: taskToPersist.icon || '🎯',
            color: taskToPersist.color || 'bg-blue-100 text-blue-600',
            completed: false,
            is_daily_reminder: false,
            linked_task: taskToPersist.linkedTask || null,
            scheduled_at: taskToPersist.scheduledAt || new Date().toISOString()
          });
          if (fallbackPersisted?.success) {
            persistedRemotely = true;
            if (fallbackPersisted?.data?.id) {
              taskToPersist = { ...taskToPersist, id: fallbackPersisted.data.id };
            }
          } else {
            console.error('Fallback em tasks falhou:', fallbackPersisted);
          }
        } catch (fallbackError) {
          console.error('Erro no fallback de persistência em tasks:', fallbackError);
        }
      }
    }

    if (isAdultTask && !persistedRemotely) {
      alert('Não foi possível salvar o agendamento no servidor. Tente novamente.');
      return false;
    }

    setTasks(prev => [...prev, taskToPersist]);
    onAddActivityLog('Criação de Tarefa', `Tarefa "${taskToPersist.title}" criada para ${formatPatientLabel(patient || { id: taskToPersist.patientId })}.`);

    if (!isAdultTask) {
      // Sync to Backend (fluxo legado/kids)
      const persisted = await dataService.addTask({
        ...taskToPersist,
        patient_id: String(taskToPersist.patientId),
        patient_email: patient?.email || null,
        protocol_id: taskToPersist.protocol_id || taskToPersist.protocolId || null,
        protocol_name: taskToPersist.protocol_name || taskToPersist.protocolTitle || null,
        domain_name: taskToPersist.domainName || null
      });
      if (persisted?.success && persisted?.data?.id) {
        setTasks(prev => prev.map(task => (task.id === taskToPersist.id ? { ...task, id: persisted.data.id } : task)));
        return true;
      }
      setTasks(prev => prev.filter(task => task.id !== taskToPersist.id));
      alert(persisted?.error || 'Não foi possível salvar o agendamento no servidor. Tente novamente.');
      return false;
    }
    return true;
  };
  const handleUpdateTask = async (id: any, fields: any) => {
    let mergedTask: any = null;
    setTasks(prev => prev.map(t => {
      if (t.id !== id) return t;
      mergedTask = { ...t, ...fields };
      return mergedTask;
    }));
    onAddActivityLog("AtualizaÃ§Ã£o de Tarefa", `Tarefa "${safeDisplayValue(mergedTask?.title, 'selecionada')}" atualizada.`);

    // Sync to Backend
    if (mergedTask) {
      const patient = allPatients.find(p => p.id === mergedTask.patientId);
      const isAdultTask = Number(patient?.age || 0) > 12;
      if (isAdultTask) {
        const assignedId = String(mergedTask.assignedTaskId || mergedTask.id || '').trim();
        if (assignedId) {
          await dataService.updateAssignedTask(assignedId, {
            task_type: mergedTask.type || 'task',
            task_data: {
              title: mergedTask.title,
              description: mergedTask.description || '',
              icon: mergedTask.icon || '',
              color: mergedTask.color || '',
              linkedTask: mergedTask.linkedTask || mergedTask.linked_task || '',
              linkedProtocolId: mergedTask.linkedProtocolId || '',
              maxScore:
                Number.isFinite(Number(mergedTask.maxScore))
                  ? Math.max(1, Math.min(10, Number(mergedTask.maxScore)))
                  : undefined
            },
            scheduled_at: mergedTask.scheduledAt || mergedTask.scheduled_at || undefined,
            status: mergedTask.completed ? 'completed' : 'pending'
          });
        }
      } else {
        await dataService.updateTask(String(id), {
          id: String(id),
          patient_id: String(mergedTask.patientId),
          patient_email: patient?.email || mergedTask.patient_email || null,
          title: mergedTask.title,
          description: mergedTask.description || '',
          type: mergedTask.type || 'task',
          max_score:
            Number.isFinite(Number(mergedTask.maxScore))
              ? Math.max(1, Math.min(100, Number(mergedTask.maxScore)))
              : undefined,
          icon: mergedTask.icon || '',
          color: mergedTask.color || '',
          completed: Boolean(mergedTask.completed),
          is_daily_reminder: Boolean(mergedTask.isDailyReminder || mergedTask.is_daily_reminder),
          linked_task: mergedTask.linkedTask || mergedTask.linked_task || null
        });
      }
    }
  };
  const handleAddNote = async (pid: any, txt: string, visibility: string, subject?: string) => {
    const normalizeNoteVisibility = (raw: string) => {
      const safe = String(raw || '').toLowerCase();
      if (safe === 'professional' || safe === 'shared_clinic') return 'shared_clinic';
      if (safe === 'patient' || safe === 'shared' || safe === 'family' || safe === 'shared_patient') return 'shared_patient';
      return 'private';
    };
    const normalizedVisibility = normalizeNoteVisibility(visibility);
    const patient = allPatients.find(p => p.id === pid);
    const patientIdentity = resolvePatientIdentityForPortal({
      patientId: pid,
      patient_email: patient?.email || null,
      patient_name: patient?.name || null
    });
    const tempId = crypto.randomUUID();
    const newNote = { 
      id: tempId, 
      patientId: pid, 
      text: txt, 
      date: new Date().toLocaleString(), 
      visibility: normalizedVisibility, 
      subject: subject || "Geral" 
    };
    setTherapistNotes(prev => [newNote, ...prev]);
    onAddActivityLog("Registro de EvoluÃ§Ã£o", `Nova nota (${normalizedVisibility}) adicionada ao prontuario de ${formatPatientLabel({ name: patientIdentity.patientName, id: patientIdentity.patientId || pid })}.`);

    // Sync to Backend
    const { dataService } = await import('./services/dataService');
    try {
      const result = await dataService.addNote({
        id: tempId,
        patient_id: String(patientIdentity.patientId || pid),
        patient_name: patientIdentity.patientName || null,
        patient_email: patientIdentity.patientEmail,
        text: txt,
        visibility: normalizedVisibility,
        subject: subject || "Geral"
      });
      if (result?.success && result?.data?.id) {
        setTherapistNotes(prev => prev.map((n: any) => (n.id === tempId ? { ...n, id: result.data.id } : n)));
      } else if (result?.success === false && !(result?.offline && result?.pending)) {
        setTherapistNotes(prev => prev.filter((n: any) => n.id !== tempId));
        const errMsg = String(result?.error || 'Não foi possível persistir a anotação no servidor.');
        alert(errMsg);
      }
    } catch (error) {
      console.error("Falha ao sincronizar nota no servidor:", error);
      setTherapistNotes(prev => prev.filter((n: any) => n.id !== tempId));
      alert('Falha ao salvar anotação. Tente novamente.');
    }
  };
  const handleUpdateHistoryItem = async (id: any, score: number, evalComment: string) => { 
    const STAR_MARKER = '[STAR]';
    const applyStarMarker = (text: string, starred: boolean) => {
      const cleaned = String(text || '')
        .replace(/\[STAR\]/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      return starred ? `${STAR_MARKER} ${cleaned}`.trim() : cleaned;
    };
    const rawId = String(id || '');
    const resolvePatientEmailForMilestone = (patientId?: string | null, explicitEmail?: string | null) => {
      const safeEmail = String(explicitEmail || '').trim().toLowerCase();
      if (safeEmail) return safeEmail;
      const safePatientId = String(patientId || '').trim();
      return String(
        allPatients.find((p: any) => String(p?.id || '').trim() === safePatientId)?.email || ''
      ).trim().toLowerCase() || null;
    };
    const persistMilestoneEvent = async (payload: { patientId?: string; patientEmail?: string | null; sourceRef: string; awarded: boolean }) => {
      try {
        const patientId = String(payload.patientId || '').trim();
        const patientEmail = resolvePatientEmailForMilestone(patientId, payload.patientEmail);
        const sourceRef = String(payload.sourceRef || '').trim();
        if (!sourceRef || (!patientId && !patientEmail)) return false;
        const result = await dataService.addNote({
          id: stableUuidFromString(`family-milestone:${sourceRef}`),
          patient_id: patientId,
          patient_email: patientEmail,
          text: `MILESTONE_EVENT|source=${payload.sourceRef}|awarded=${payload.awarded ? 1 : 0}`,
          visibility: 'family',
          subject: 'milestone_event',
          type: 'family_note',
          score: payload.awarded ? 1 : 0,
          source: 'family_milestone_event'
        });
        if (result?.success === false && !(result?.offline && result?.pending)) {
          console.warn('Falha ao persistir evento de marco:', result?.error || result);
          return false;
        }
        return true;
      } catch (error) {
        console.error('Falha ao persistir evento de marco:', error);
        return false;
      }
    };
    if (rawId.startsWith('note-family-')) {
      const noteId = rawId.replace('note-family-', '');
      const starred = Number(score || 0) >= 1;
      const matchingNote = (Array.isArray(therapistNotes) ? therapistNotes : []).find((n: any) => String(n.id) === String(noteId));
      const notePatientId = String(matchingNote?.patientId || matchingNote?.patient_id || '').trim();
      const notePatientEmail = resolvePatientEmailForMilestone(notePatientId, matchingNote?.patient_email);
      const updatedNoteText = applyStarMarker(String(matchingNote?.text || matchingNote?.note || ''), starred);
      const updatedNoteSubject = String(matchingNote?.subject || 'Geral').replace(/\u2b50|â­/g, '').trim() || 'Geral';
      const previousTherapistNotes = therapistNotes;
      setTherapistNotes(prev =>
        prev.map((n: any) =>
          String(n.id) === String(noteId)
            ? {
                ...n,
                score,
                visibility: n?.visibility || 'family',
                type: n?.type || 'family_note',
                subject: updatedNoteSubject,
                text: applyStarMarker(String(n?.text || n?.note || ''), starred),
                note: applyStarMarker(String(n?.note || n?.text || ''), starred)
              }
            : n
        )
      );
      try {
        if (matchingNote) {
          const noteUpdateResult = await dataService.updateNote(String(noteId), {
            score,
            patient_id: notePatientId,
            patient_email: notePatientEmail,
            visibility: matchingNote?.visibility || 'family',
            subject: updatedNoteSubject,
            text: updatedNoteText
          });
          if (noteUpdateResult?.success === false) {
            throw new Error(noteUpdateResult?.error || 'Falha ao atualizar anotação familiar original.');
          }
        }
        const milestonePersisted = await persistMilestoneEvent({
          patientId: notePatientId,
          patientEmail: notePatientEmail,
          sourceRef: rawId,
          awarded: starred
        });
        if (!milestonePersisted) {
          throw new Error('Falha ao confirmar a estrelinha no portal da família.');
        }
      } catch (error) {
        console.error('Falha ao persistir estrela em anotaÃ§Ã£o de famÃ­lia:', error);
        setTherapistNotes(previousTherapistNotes);
        alert('Não foi possível salvar a estrelinha agora. Tente novamente.');
      }
      return;
    }

    const item = history.find(i => String(i.id) === rawId);
    const isFamilyHistory = item && (item.type === 'family_note' || item.type === 'photo');
    if (isFamilyHistory) {
      const patientId = String(item?.patientId || item?.patient_id || '').trim();
      const normalizedItemText = String(item?.note || item?.text || '').trim().toLowerCase();
      const starred = Number(score || 0) >= 1;
      const previousHistory = history;
      const previousTherapistNotes = therapistNotes;
      const matchingNote = (Array.isArray(therapistNotes) ? therapistNotes : []).find((n: any) => {
        const samePatient = String(n?.patientId || n?.patient_id || '').trim() === patientId;
        const sameFamilyType = ['family', 'patient', 'shared'].includes(String(n?.visibility || '').toLowerCase()) ||
          ['family_note', 'photo', 'shared'].includes(String(n?.type || '').toLowerCase());
        const normalizedNoteText = String(n?.text || n?.note || '').trim().toLowerCase();
        return samePatient && sameFamilyType && normalizedItemText && normalizedNoteText === normalizedItemText;
      });

      // Immediate UI update
      setHistory(prev => prev.map((h: any) => (String(h.id) === rawId ? { ...h, score } : h)));
      if (matchingNote) {
        setTherapistNotes(prev =>
          prev.map((n: any) =>
            String(n.id) === String(matchingNote.id)
              ? {
                  ...n,
                  score,
                  subject: starred ? `â­ ${String(n?.subject || 'FamÃ­lia').replace(/\u2b50|â­/g, '').trim()}` : String(n?.subject || 'FamÃ­lia').replace(/\u2b50|â­/g, '').trim()
                  ,text: applyStarMarker(String(n?.text || n?.note || ''), starred)
                  ,note: applyStarMarker(String(n?.note || n?.text || ''), starred)
                }
              : n
          )
        );
      }

      try {
        const patientEmail =
          String(item?.patient_email || '').trim().toLowerCase() ||
          resolvePatientEmailForMilestone(String(item?.patientId || item?.patient_id || ''), matchingNote?.patient_email);
        const historyUpdateResult = await dataService.updateHistoryItem(String(rawId), {
          score,
          note: String(item?.note || item?.text || ''),
          title: String(item?.title || ''),
          icon: String(item?.icon || ''),
          patient_id: String(item?.patientId || item?.patient_id || ''),
          patient_email: patientEmail
        });
        if (historyUpdateResult?.success === false) {
          throw new Error(historyUpdateResult?.error || 'Falha ao salvar estrela no histórico.');
        }
        if (historyUpdateResult?.data) {
          setHistory(prev =>
            prev.map((h: any) =>
              String(h.id) === rawId
                ? { ...h, ...historyUpdateResult.data, patientId: historyUpdateResult.data.patient_id || h.patientId }
                : h
            )
          );
        }

        const milestonePersisted = await persistMilestoneEvent({
          patientId: String(item?.patientId || item?.patient_id || ''),
          patientEmail,
          sourceRef: rawId,
          awarded: starred
        });
        if (!milestonePersisted) {
          throw new Error('Falha ao confirmar a estrelinha no portal da família.');
        }
      } catch (error) {
        console.error('Falha ao persistir estrelinha de registro da família:', error);
        setHistory(previousHistory);
        setTherapistNotes(previousTherapistNotes);
        alert('Não foi possível salvar a estrelinha agora. Tente novamente.');
      }
      return;
    }

    if (item) {
      const updatedItem = { ...item, score, evalComment: evalComment || '' };
      const noteText = `📝 ATUALIZAÇÃO DE REGISTRO\nAtividade: ${updatedItem.title}\nPontuação: ${updatedItem.score}\nObs: ${updatedItem.evalComment || "Nenhuma observação."}`;
      handleAddNote(item.patientId, noteText, 'private', 'Sessão');
      setHistory(prev => prev.map(i => (String(i.id) === rawId ? updatedItem : i)));
      onAddActivityLog("Edição de Histórico", `Registro de atividade "${safeDisplayValue(item.title, 'selecionado')}" editado.`);
      try {
        await dataService.updateHistoryItem(String(id), {
          score,
          note: evalComment || '',
          title: updatedItem.title,
          patient_id: String(item.patientId),
          patient_email: allPatients.find(p => p.id === item.patientId)?.email || null
        });
      } catch (error) {
        console.error('Falha ao persistir edição de histórico:', error);
      }
    }
  };
  const readAppointmentSourcePayload = (appointment: any) => {
    const payload = appointment?.source_payload || appointment?.sourcePayload;
    if (!payload) return {};
    if (typeof payload === 'object' && !Array.isArray(payload)) return payload;
    if (typeof payload !== 'string') return {};
    try {
      const parsed = JSON.parse(payload);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };

  const getAppointmentRecurrenceGroupId = (appointment: any) => {
    const source = readAppointmentSourcePayload(appointment);
    return String(
      appointment?.recurrenceGroupId ||
        appointment?.recurrence_group_id ||
        source?.recurrenceGroupId ||
        source?.recurrence_group_id ||
        '',
    ).trim();
  };

  const handleUpdateAgendaStatus = async (id: any, status: string, details: any = {}) => {
    const normalizedStatus = status === 'cancelled' ? 'canceled' : status;
    const note = String(details?.note ?? details?.notes ?? details?.observation ?? '').trim();
    const recurrenceScope = String(details?.recurrenceScope || 'single').toLowerCase() === 'future' ? 'future' : 'single';
    const currentAppointment = therapistAgenda.find(item => String(item.id) === String(id));
    if (!currentAppointment) {
      return { success: false, error: 'Agendamento não encontrado.' };
    }
    const actionSequence = nextAppointmentActionSequence();
    try {
      const response = await fetch(`/api/appointments/${encodeURIComponent(String(id))}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          status: normalizedStatus,
          note,
          source: details?.source || 'agenda_management',
          recurrenceScope,
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success === false) {
        throw new Error(result?.error || 'Não foi possível confirmar o novo status.');
      }
      const persistedAppointments = Array.isArray(result?.affectedAppointments)
        ? result.affectedAppointments
        : result?.appointment
          ? [result.appointment]
          : [];
      if (persistedAppointments.length === 0) {
        throw new Error('O servidor não devolveu a consulta confirmada.');
      }
      const applied = applyAppointmentResultToAgenda(result, { action: normalizedStatus, items: persistedAppointments }, actionSequence);
      if (!applied.ok) {
        throw new Error('Registro salvo, mas a tela não atualizou automaticamente. Recarregue ou tente novamente.');
      }
      return { success: true, appointments: persistedAppointments };
    } catch (error: any) {
      console.warn('Falha ao persistir status da consulta imediatamente:', error);
      return { success: false, error: error?.message || 'Não foi possível atualizar o status.' };
    }
  };

  const handleDeleteAppointment = async (id: any, details: any = {}) => {
    const note = String(details?.note ?? details?.notes ?? details?.observation ?? '').trim();
    const recurrenceScope = String(details?.recurrenceScope || 'single').toLowerCase() === 'future' ? 'future' : 'single';
    const currentAppointment = therapistAgenda.find((item) => String(item.id) === String(id));
    if (!currentAppointment) {
      return { success: false, error: 'Agendamento não encontrado.' };
    }

    const recurrenceGroupId = getAppointmentRecurrenceGroupId(currentAppointment);
    const getRecurrenceIndex = (appointment: any) =>
      Number(appointment?.recurrenceIndex ?? appointment?.recurrence_index ?? 0) || 0;
    const currentRecurrenceIndex = getRecurrenceIndex(currentAppointment);
    const getOccurrenceTimestamp = (appointment: any) => {
      const source = readAppointmentSourcePayload(appointment);
      const scheduledAt = appointment?.scheduledAt || appointment?.scheduled_at || source?.scheduledAt || source?.scheduled_at;
      const parsedScheduledAt = scheduledAt ? new Date(scheduledAt).getTime() : Number.NaN;
      if (!Number.isNaN(parsedScheduledAt)) return parsedScheduledAt;
      const date = String(appointment?.date || source?.date || '').trim();
      const time = String(appointment?.time || source?.time || '').trim();
      const parsedDateTime = date && time ? new Date(`${date}T${time}:00`).getTime() : Number.NaN;
      return Number.isNaN(parsedDateTime) ? Number.POSITIVE_INFINITY : parsedDateTime;
    };
    const normalizeSeriesText = (value: any) =>
      String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
    const getPatientSeriesKey = (appointment: any) => {
      const source = readAppointmentSourcePayload(appointment);
      const patientId = String(appointment?.patientId || appointment?.patient_id || source?.patientId || source?.patient_id || '').trim();
      if (patientId) return `id:${patientId}`;
      const patientName = normalizeSeriesText(
        appointment?.patientName || appointment?.patient_name || appointment?.name || source?.patientName || source?.patient_name || source?.name,
      );
      return patientName ? `name:${patientName}` : '';
    };
    const getProfessionalSeriesKey = (appointment: any) => {
      const source = readAppointmentSourcePayload(appointment);
      const professionalId = String(
        appointment?.therapistId ||
          appointment?.therapist_id ||
          appointment?.professionalId ||
          appointment?.professional_id ||
          source?.therapistId ||
          source?.therapist_id ||
          source?.professionalId ||
          source?.professional_id ||
          '',
      ).trim();
      if (professionalId) return `id:${professionalId}`;
      const professionalName = normalizeSeriesText(
        appointment?.therapistName || appointment?.therapist_name || appointment?.professional || source?.therapistName || source?.therapist_name || source?.professional,
      );
      return professionalName ? `name:${professionalName}` : '';
    };
    const getSeriesClockTime = (appointment: any) => {
      const source = readAppointmentSourcePayload(appointment);
      const explicitTime = String(appointment?.time || source?.time || '').trim().slice(0, 5);
      if (/^\d{2}:\d{2}$/.test(explicitTime)) return explicitTime;
      const timestamp = getOccurrenceTimestamp(appointment);
      if (!Number.isFinite(timestamp)) return '';
      const parsed = new Date(timestamp);
      return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
    };
    const currentPatientSeriesKey = getPatientSeriesKey(currentAppointment);
    const currentProfessionalSeriesKey = getProfessionalSeriesKey(currentAppointment);
    const currentSeriesClockTime = getSeriesClockTime(currentAppointment);
    const currentOccurrenceTimestamp = getOccurrenceTimestamp(currentAppointment);
    const shouldDeleteItem = (appointment: any) => {
      if (String(appointment?.id) === String(id)) return true;
      if (recurrenceScope !== 'future') return false;
      const appointmentRecurrenceGroupId = getAppointmentRecurrenceGroupId(appointment);
      if (recurrenceGroupId) {
        if (!appointmentRecurrenceGroupId || appointmentRecurrenceGroupId !== recurrenceGroupId) return false;
        const appointmentRecurrenceIndex = getRecurrenceIndex(appointment);
        if (currentRecurrenceIndex > 0 && appointmentRecurrenceIndex > 0) {
          return appointmentRecurrenceIndex >= currentRecurrenceIndex;
        }
        return getOccurrenceTimestamp(appointment) >= currentOccurrenceTimestamp;
      }
      const appointmentPatientSeriesKey = getPatientSeriesKey(appointment);
      if (!currentPatientSeriesKey || appointmentPatientSeriesKey !== currentPatientSeriesKey) return false;
      const appointmentProfessionalSeriesKey = getProfessionalSeriesKey(appointment);
      if (
        currentProfessionalSeriesKey &&
        appointmentProfessionalSeriesKey &&
        appointmentProfessionalSeriesKey !== currentProfessionalSeriesKey
      ) {
        return false;
      }
      const appointmentSeriesClockTime = getSeriesClockTime(appointment);
      if (currentSeriesClockTime && appointmentSeriesClockTime && appointmentSeriesClockTime !== currentSeriesClockTime) return false;
      return getOccurrenceTimestamp(appointment) >= currentOccurrenceTimestamp;
    };

    const deletedAppointmentIds = therapistAgenda
      .filter(shouldDeleteItem)
      .map((appointment) => String(appointment.id));
    const deletedAppointmentIdSet = new Set(deletedAppointmentIds);
    if (deletedAppointmentIdSet.size === 0) {
      return { success: false, error: 'Nenhum agendamento encontrado para excluir.' };
    }

    const actionSequence = nextAppointmentActionSequence();
    try {
      const response = await fetch(`/api/appointments/${encodeURIComponent(String(id))}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          note,
          source: details?.source || 'agenda_management',
          recurrenceScope,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success === false) {
        throw new Error(result?.error || 'Erro ao excluir agendamento.');
      }
      const confirmedDeletedIds = Array.isArray(result?.deletedAppointmentIds)
        ? result.deletedAppointmentIds
        : deletedAppointmentIds;
      const applied = applyAppointmentResultToAgenda(result, { action: 'deleted', removedIds: confirmedDeletedIds }, actionSequence);
      if (!applied.ok) {
        throw new Error('Registro salvo, mas a tela não atualizou automaticamente. Recarregue ou tente novamente.');
      }
      const appointmentLabel = formatPatientLabel({
        name: currentAppointment?.patientName || currentAppointment?.name,
        id: currentAppointment?.patientId
      }, 'consulta selecionada');
      onAddActivityLog(
        "Exclusão de Agendamento",
        recurrenceScope === 'future'
          ? `${deletedAppointmentIdSet.size} agendamentos recorrentes de ${appointmentLabel} foram excluídos da agenda.`
          : `Agendamento de ${appointmentLabel} foi excluído da agenda.`,
        'management',
      );
      return {
        success: true,
        deletedAppointmentIds: Array.isArray(result?.deletedAppointmentIds)
          ? result.deletedAppointmentIds
          : deletedAppointmentIds,
      };
    } catch (error: any) {
      console.warn('Falha ao excluir agendamento:', error?.message || String(error));
      return { success: false, error: error?.message || 'Não foi possível excluir o agendamento.' };
    }
  };

  const handleUpdateAppointment = async (id: any, updates: any) => {
    const currentAppointment = therapistAgenda.find((item) => String(item.id) === String(id));
    if (!currentAppointment) {
      return { success: false, errors: ['Agendamento não encontrado.'] };
    }

    const { recurrenceScope = 'single', ...appointmentUpdates } = updates || {};
    const nextDate = appointmentUpdates.date || currentAppointment.date;
    const nextTime = appointmentUpdates.time || currentAppointment.time;
    const recurrenceGroupId = String(
      currentAppointment.recurrenceGroupId || currentAppointment.recurrence_group_id || '',
    ).trim();
    const shouldUpdateFutureRecurrence =
      recurrenceScope === 'future' && Boolean(recurrenceGroupId);
    const getRecurrenceIndex = (appointment: any) =>
      Number(appointment?.recurrenceIndex ?? appointment?.recurrence_index ?? 0) || 0;
    const currentRecurrenceIndex = getRecurrenceIndex(currentAppointment);
    const parseDateKey = (value: any) => {
      const [year, month, day] = String(value || '').split('-').map(Number);
      if (!year || !month || !day) return null;
      return new Date(year, month - 1, day);
    };
    const formatDateKey = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const addDaysToDateKey = (value: any, days: number) => {
      const date = parseDateKey(value);
      if (!date) return String(value || '');
      date.setDate(date.getDate() + days);
      return formatDateKey(date);
    };
    const daysBetween = (from: any, to: any) => {
      const start = parseDateKey(from);
      const end = parseDateKey(to);
      if (!start || !end) return 0;
      return Math.round((end.getTime() - start.getTime()) / 86400000);
    };
    const isNonBlockingAppointment = (appointment: any) => !appointmentBlocksConflict(appointment);
    const isSameRecurrenceGroup = (appointment: any) =>
      recurrenceGroupId &&
      String(appointment?.recurrenceGroupId || appointment?.recurrence_group_id || '').trim() === recurrenceGroupId;
    const isFutureOccurrence = (appointment: any) => {
      if (String(appointment?.id) === String(id)) return true;
      const appointmentIndex = getRecurrenceIndex(appointment);
      if (currentRecurrenceIndex > 0 && appointmentIndex > 0) {
        return appointmentIndex >= currentRecurrenceIndex;
      }
      return daysBetween(currentAppointment.date, appointment?.date) >= 0;
    };
    const appointmentsToUpdate = shouldUpdateFutureRecurrence
      ? therapistAgenda.filter(
          (appointment) =>
            isSameRecurrenceGroup(appointment) &&
            isFutureOccurrence(appointment) &&
            (String(appointment?.id) === String(id) || !isNonBlockingAppointment(appointment)),
        )
      : [currentAppointment];
    const targetIds = new Set(appointmentsToUpdate.map((appointment) => String(appointment.id)));
    const resolveDateForOccurrence = (appointment: any) => {
      if (!shouldUpdateFutureRecurrence || String(appointment?.id) === String(id)) {
        return nextDate;
      }
      const appointmentIndex = getRecurrenceIndex(appointment);
      if (currentRecurrenceIndex > 0 && appointmentIndex > 0) {
        return addDaysToDateKey(nextDate, (appointmentIndex - currentRecurrenceIndex) * 7);
      }
      return addDaysToDateKey(nextDate, daysBetween(currentAppointment.date, appointment?.date));
    };
    const buildReminderReset = (scheduleChanged: boolean) =>
      scheduleChanged
        ? {
            status: 'pending',
            patientResponse: null,
            patient_response: null,
            patientRespondedAt: null,
            patient_responded_at: null,
            patientConfirmationStatus: null,
            patient_confirmation_status: null,
            patientConfirmationAt: null,
            patient_confirmation_at: null,
            patientConfirmationBy: null,
            patient_confirmation_by: null,
            patientConfirmationSource: null,
            patient_confirmation_source: null,
            notification_24h_sent_at: null,
            notification24hSentAt: null,
            notification_sent_at: null,
            notification_sent: false,
            notification_12h_sent_at: null,
            notification12hSentAt: null,
            notification_12h_sent: false,
          }
        : {};
    const addConflict = (errors: string[], message: string) => {
      if (!errors.includes(message)) errors.push(message);
    };
    const conflicts: string[] = [];
    const patchesById = new Map<string, any>();
    let scheduleChangedCount = 0;

    appointmentsToUpdate.forEach((appointment) => {
      const targetDate = resolveDateForOccurrence(appointment);
      const targetTime = nextTime;
      const targetApproach =
        appointmentUpdates.type ||
        appointmentUpdates.approach ||
        appointment.type ||
        appointment.approach ||
        'Consulta Padrão';
      const targetDuration = normalizeDurationMinutes(
        appointmentUpdates.duration_minutes ||
          appointmentUpdates.durationMinutes ||
          appointmentUpdates.scheduled_duration_minutes ||
          appointmentUpdates.scheduledDurationMinutes ||
          getAppointmentDurationMinutes(appointment, specialtySettings[targetApproach] || 60),
        specialtySettings[targetApproach] || 60,
      );
      const targetLocationType = normalizeScheduleLocationType(
        appointmentUpdates.location_type ||
          appointmentUpdates.locationType ||
          appointmentUpdates.location ||
          appointment.location_type ||
          appointment.locationType ||
          appointment.location ||
          (appointmentUpdates.room ?? appointment.room ? 'clinica' : 'outro'),
      );
      const targetRoom = targetLocationType === 'clinica'
        ? (appointmentUpdates.room_id ?? appointmentUpdates.roomId ?? appointmentUpdates.room ?? appointment.room_id ?? appointment.roomId ?? appointment.room)
        : '';
      const targetRoomName =
        appointmentUpdates.roomName ||
        appointmentUpdates.room_name ||
        rooms.find((room: any) => String(room?.id || '') === String(targetRoom || ''))?.name ||
        appointment.roomName ||
        appointment.room_name ||
        appointment.roomDisplayName ||
        targetRoom;
      const targetRoomConfig = findScheduleRoomConfig(rooms, targetRoom, targetRoomName);
      const targetRoomPreventsOverlap = roomPreventsOverlappingAppointments(
        targetRoomConfig || {
          name: targetRoomName,
          prevent_overlapping_appointments:
            appointmentUpdates.room_prevent_overlapping_appointments ??
            appointmentUpdates.roomPreventOverlappingAppointments ??
            appointment.room_prevent_overlapping_appointments ??
            appointment.roomPreventOverlappingAppointments,
        },
        true,
      );
      const targetProfessional =
        appointmentUpdates.professional ??
        appointment.professional ??
        appointment.therapistName ??
        appointment.therapist_name ??
        '';
      const targetPatientId = appointment.patientId || appointment.patient_id || currentAppointment.patientId;
      const targetPatientName = String(
        appointment.name || appointment.patientName || currentAppointment.name || currentAppointment.patientName || '',
      ).trim();
      const targetEndTime = calculateEndTime(targetTime, targetApproach, targetDuration);

      if (targetLocationType === 'clinica' && !String(targetRoom || '').trim()) {
        addConflict(conflicts, 'Selecione uma sala da clínica para este atendimento.');
        return;
      }

      therapistAgenda.forEach((item) => {
        if (targetIds.has(String(item.id))) return false;
        if (isNonBlockingAppointment(item)) return false;
        if (item.date !== targetDate) return false;
        const itemEndTime = calculateEndTime(
          item.time,
          item.type || item.approach || 'Consulta Padrão',
          item.duration_minutes || item.durationMinutes,
        );
        if (!appointmentTimesOverlap(targetTime, targetEndTime, item.time, itemEndTime)) return false;
        const itemLocationType = normalizeScheduleLocationType(item.location_type || item.locationType || item.location || (item.room ? 'clinica' : 'outro'));

        const samePatient =
          targetPatientId &&
          String(item.patientId || item.patient_id || '') === String(targetPatientId);
        const samePatientByName =
          !targetPatientId &&
          targetPatientName &&
          String(item.name || item.patientName || '').trim() === targetPatientName;
        const sameRoom =
          targetLocationType === 'clinica' &&
          itemLocationType === 'clinica' &&
          targetRoom &&
          String(item.room || item.roomId || item.room_id || '') === String(targetRoom);
        const sameProfessional =
          targetProfessional &&
          String(item.professional || item.therapistName || '').trim() ===
            String(targetProfessional).trim();

        if (samePatient || samePatientByName) {
          addConflict(
            conflicts,
            `Conflito de Paciente: ${targetPatientName || 'Paciente'} já possui sessão em ${targetDate} às ${item.time}.`,
          );
        }
        if (sameRoom && targetRoomPreventsOverlap) {
          addConflict(
            conflicts,
            `Conflito de Sala: ${targetRoomName || targetRoom} já está ocupada em ${targetDate} às ${item.time}.`,
          );
        }
        if (sameProfessional) {
          addConflict(
            conflicts,
            `Conflito de Profissional: ${targetProfessional} já possui sessão em ${targetDate} às ${item.time}.`,
          );
        }
        return false;
      });

      const scheduleChanged =
        String(appointment.date || '') !== String(targetDate || '') ||
        String(appointment.time || '') !== String(targetTime || '');
      if (scheduleChanged) scheduleChangedCount += 1;
      const targetStartAt = buildAppointmentDateTime(targetDate, targetTime);
      const targetEndAt = calculateAppointmentEnd(targetStartAt, targetDuration);
      if (!targetStartAt || !targetEndAt) {
        addConflict(conflicts, 'Informe data e horario validos para este atendimento.');
        return;
      }
      const targetScheduledAt = targetStartAt.toISOString();
      const targetScheduledEndAt = targetEndAt.toISOString();
      patchesById.set(String(appointment.id), {
        ...appointmentUpdates,
        date: targetDate,
        time: targetTime,
        scheduledAt: targetScheduledAt,
        scheduled_at: targetScheduledAt,
        scheduledStartAt: targetScheduledAt,
        scheduled_start_at: targetScheduledAt,
        scheduledEndAt: targetScheduledEndAt,
        scheduled_end_at: targetScheduledEndAt,
        startTime: targetScheduledAt,
        start_time: targetScheduledAt,
        start: targetScheduledAt,
        endTime: targetScheduledEndAt,
        end_time: targetScheduledEndAt,
        end: targetScheduledEndAt,
        durationMinutes: targetDuration,
        duration_minutes: targetDuration,
        scheduledDurationMinutes: targetDuration,
        scheduled_duration_minutes: targetDuration,
        locationType: targetLocationType,
        location_type: targetLocationType,
        room: targetLocationType === 'clinica' ? targetRoom : '',
        roomId: targetLocationType === 'clinica' ? targetRoom : '',
        room_id: targetLocationType === 'clinica' ? targetRoom : '',
        roomName: targetLocationType === 'clinica' ? targetRoomName : '',
        room_name: targetLocationType === 'clinica' ? targetRoomName : '',
        ...buildReminderReset(scheduleChanged),
      });
    });

    if (conflicts.length > 0) {
      return { success: false, errors: conflicts };
    }

    const appointmentsToPersist = appointmentsToUpdate.map((appointment) => ({
      ...appointment,
      ...(patchesById.get(String(appointment.id)) || {}),
    }));
    const actionSequence = nextAppointmentActionSequence();
    const persistenceResult = await dataService.updateAppointment(
      String(id),
      appointmentsToPersist,
    );
    if (!persistenceResult?.success || !Array.isArray(persistenceResult?.appointments)) {
      return {
        success: false,
        errors: [persistenceResult?.error || 'Não foi possível confirmar a alteração do agendamento.'],
      };
    }
    const confirmedAppointments = mergeAppointmentIdentityFallbacks(
      persistenceResult.appointments,
      appointmentsToPersist,
    );
    const confirmedPrimaryAppointment = confirmedAppointments.find((appointment: any) =>
      String(appointment?.id || '') === String(
        persistenceResult?.item?.id || persistenceResult?.appointment?.id || id,
      ),
    ) || confirmedAppointments[0] || null;
    const confirmedResult = {
      ...persistenceResult,
      item: confirmedPrimaryAppointment,
      items: confirmedAppointments,
      appointments: confirmedAppointments,
    };
    const applied = applyAppointmentResultToAgenda(
      confirmedResult,
      { action: 'updated', items: appointmentsToPersist },
      actionSequence,
    );
    if (!applied.ok) {
      return {
        success: false,
        errors: ['Registro salvo, mas a tela não atualizou automaticamente. Recarregue ou tente novamente.'],
      };
    }
    const appointmentLabel = formatPatientLabel({
      name: appointmentsToUpdate[0]?.patientName || appointmentsToUpdate[0]?.name,
      id: appointmentsToUpdate[0]?.patientId
    }, 'consulta selecionada');
    onAddActivityLog(
      "Edição de Agendamento",
      shouldUpdateFutureRecurrence
        ? `${appointmentsToUpdate.length} agendamentos recorrentes atualizados a partir de ${nextDate} às ${nextTime}.`
        : `Agendamento de ${appointmentLabel} atualizado para ${nextDate} às ${nextTime}.`,
      'management',
    );
    return {
      success: true,
      updatedCount: confirmedAppointments.length,
      appointments: confirmedAppointments,
      scheduleChanged: scheduleChangedCount > 0,
      scheduleChangedCount,
    };
  };

  const handleAddPatient = async (data: any) => { 
    try {
    const newId = data.id || Date.now(); 
    let activationEmailSent: boolean | null = null;
    let activationEmailWarning: string | null = null;
    let activationMessage: string | null = null;
    let portabilityAvailable = false;
    
    // Identity Data (Pseudonymized)
    const fallbackProfileType =
      data.approach === 'ABA'
        ? 'ABA'
        : data.approach === 'TO'
          ? 'ADULT'
          : 'ADULT';
    const resolvedProfileType = normalizePatientProfileType(
      data.patientProfileType || data.panelType || data.profileType || data.profile_type || data.type,
      fallbackProfileType as any,
    );
    const resolvedPortalType = mapPatientProfileTypeToLegacyPortalType(resolvedProfileType);
    const resolvedBirthDate = data.birthDate || data.dataNascimento || data.anamnesisData?.dataNascimento || null;
    const resolvedGuardian =
      data.guardian && typeof data.guardian === 'object'
        ? data.guardian
        : data.responsavelNome || data.responsavelTelefone || data.responsavelCpf || data.responsavelEmail || data.responsavelRelacao
          ? {
              nome: data.responsavelNome || null,
              dataNascimento: data.responsavelDataNascimento || null,
              cpf: data.responsavelCpf || null,
              telefone: data.responsavelTelefone || null,
              email: data.responsavelEmail || data.responsibleEmail || null,
              relacao: data.responsavelRelacao || data.responsibleRelationship || null,
            }
          : null;

    const newPatient = { 
      id: newId, 
      name: data.name, 
      socialName: data.socialName || data.nomeSocial || null,
      email: data.email,
      phone: data.phone, 
      birthDate: resolvedBirthDate,
      age: data.anamnesisData?.idade || data.age || calculateAgeFromBirthDate(resolvedBirthDate) || 0,
      gender: data.gender || data.genero || null,
      insuranceType: data.insuranceType || data.convenioTipo || 'particular',
      insuranceName: data.insuranceName || data.convenioNome || null,
      cardNumber: data.cardNumber || data.convenioCarteirinha || null,
      insuranceCardValidUntil: data.insuranceCardValidUntil || data.insurance_card_valid_until || data.convenioCarteirinhaValidade || null,
      insurancePlanCategory: data.insurancePlanCategory || data.insurance_plan_category || data.convenioPlanoCategoria || null,
      insuranceHolderName: data.insuranceHolderName || data.insurance_holder_name || data.convenioTitularNome || null,
      insuranceHolderCpf: data.insuranceHolderCpf || data.insurance_holder_cpf || data.convenioTitularCpf || null,
      insuranceHolderRelationship: data.insuranceHolderRelationship || data.insurance_holder_relationship || data.convenioTitularRelacao || null,
      eligibilityNotes: data.eligibilityNotes || data.eligibility_notes || data.convenioElegibilidadeObs || null,
      group: data.group || data.grupo || null,
      source: data.source || data.comoConheceu || null,
      rg: data.rg || null,
      cpf: data.cpf || data.anamnesisData?.cpf || null,
      cep: data.cep || data.address?.cep || null,
      address: data.address || null,
      notes: data.notes || data.outrasInformacoes || null,
      isMinor: Boolean(data.isMinor || data.menorDeIdade),
      guardian: resolvedGuardian,
      approach: data.approach, 
      status: "PENDING_ANAMNESIS",
      onboardingStatus: "NOT_STARTED",
      onboarding_status: "NOT_STARTED",
      anamnesisRequired: true,
      anamnesis_required: true,
      type: resolvedPortalType,
      patientProfileType: resolvedProfileType,
      panelType: resolvedProfileType,
      anamnesisData: buildPatientAnamnesisSnapshot(data, data.anamnesisData),
      financialPlans: Array.isArray(data.financialPlans) ? data.financialPlans : [],
      monthlyTreatmentValue: Number(data.monthlyTreatmentValue || 0) || 0,
      billingDueDay: data.billingDueDay || null,
      billingMethod: data.billingMethod || null,
      lastAnamnesisAt: data.lastAnamnesisAt || null,
    };

    // Clinical Data (Sensitive - linked by ID only)
    const newClinicalRecord = {
      patientId: newId,
      diagnosis: data.diagnosis,
      anamnesisData: data.anamnesisData,
      pei: data.pei || [],
      evaluationLinks: data.evaluationLinks || {},
      interventionTaskLinks: data.interventionTaskLinks || {}
    };

    setAllPatients(prev => mergePatients(prev, [newPatient])); 
    setClinicalRecords(prev => [...prev, newClinicalRecord]);

    if(data.scheduleImmediate) {
      const immediateDate = data.date || todayStr;
      const immediateTime = data.time || '08:00';
      const immediateStartAt = buildAppointmentDateTime(immediateDate, immediateTime);
      setTherapistAgenda(prev => [...prev, {
        id: createAppointmentId(),
        patientId: newId,
        patientEmail: data.email || null,
        patient_email: data.email || null,
        name: data.name,
        date: immediateDate,
        time: immediateTime,
        scheduledAt: immediateStartAt?.toISOString() || null,
        scheduled_at: immediateStartAt?.toISOString() || null,
        status: 'pending',
        type: 'Primeira',
        color: 'bg-blue-100 text-blue-600'
      }].sort((a,b) => a.time.localeCompare(b.time)));
    } 
    onAddActivityLog("Cadastro de Paciente", `${formatPatientLabel(newPatient)} cadastrado no sistema.`, 'management');
    const rollbackOptimisticPatient = () => {
      setAllPatients(prev => prev.filter((p: any) => String(p.id) !== String(newId)));
      setClinicalRecords(prev => prev.filter((r: any) => String(r.patientId) !== String(newId)));
      setTherapistAgenda(prev => prev.filter((a: any) => String(a.id) !== String(newId) && String(a.patientId) !== String(newId)));
    };

    // Sync to Backend
    const { dataService } = await import('./services/dataService');
    
    // 1. Create patient user account if email provided
    if (data.email) {
      const userResult = await dataService.createPatientUser(
        data.email,
        data.name,
        resolvedPortalType,
        data.cpf || data.anamnesisData?.cpf || null,
        {
          phone: data.phone,
          birthDate: resolvedBirthDate,
          birth_date: resolvedBirthDate,
          gender: data.gender || data.genero || '',
          insuranceType: data.insuranceType || data.convenioTipo || 'particular',
          insuranceName: data.insuranceName || data.convenioNome || '',
          insuranceCardNumber: data.cardNumber || data.convenioCarteirinha || '',
          group: data.group || data.grupo || '',
          source: data.source || data.comoConheceu || '',
          rg: data.rg || '',
          cep: data.cep || data.address?.cep || '',
          address: data.address || {},
          notes: data.notes || data.outrasInformacoes || '',
          isMinor: Boolean(data.isMinor || data.menorDeIdade),
          guardian: resolvedGuardian,
          responsibleName: resolvedGuardian?.nome || '',
          responsibleBirthDate: resolvedGuardian?.dataNascimento || '',
          responsibleCpf: resolvedGuardian?.cpf || '',
          responsiblePhone: resolvedGuardian?.telefone || '',
          responsibleEmail: resolvedGuardian?.email || '',
          responsibleRelationship: resolvedGuardian?.relacao || '',
          clientRecordId: String(newId),
          patientProfileType: resolvedProfileType,
          panelType: resolvedProfileType,
          financialPlans: Array.isArray(data.financialPlans) ? data.financialPlans : [],
        },
      );
      if (userResult.success) {
        activationEmailSent = userResult.activationEmailSent === false ? false : userResult.activationEmailSent === null ? null : true;
        activationEmailWarning = String(userResult.warning || userResult.error || '').trim() || null;
        portabilityAvailable = Boolean(userResult.portabilityAvailable);
        if (userResult.idempotent) {
          activationMessage = userResult.message || 'Cadastro confirmado.';
        } else if (userResult.relationshipConfirmationSent || userResult.code === 'RELATIONSHIP_CONFIRMATION_SENT') {
          activationMessage = userResult.message || 'Confirmação de vínculo enviada para o responsável.';
        } else if (userResult.userAlreadyExisted || userResult.code === 'RESPONSIBLE_LINKED_TO_NEW_PATIENT' || userResult.code === 'EXISTING_EMAIL_LINKED') {
          activationMessage = portabilityAvailable
            ? 'Responsável vinculado com sucesso. O compartilhamento de histórico pode ser solicitado com autorização.'
            : (userResult.message || 'Responsável vinculado com sucesso.');
        } else if (userResult.activationEmailSent === false) {
          activationMessage = 'Cadastro confirmado. O e-mail de ativação não foi enviado agora; use reenviar ativação depois.';
        } else {
          activationMessage = userResult.message || 'Ativação enviada com sucesso.';
        }
      } else if (userResult?.error) {
        const inviteErrorMessage = toReadableError(userResult.error);
        const invitePrepareUnavailable =
          userResult?.code === 'INVITE_PREPARE_UNAVAILABLE' ||
          Number(userResult?.status) === 502 ||
          Number(userResult?.status) === 504 ||
          /preparar o convite agora/i.test(inviteErrorMessage);

        if (!invitePrepareUnavailable) {
          alert(`Não foi possível enviar o convite do paciente: ${inviteErrorMessage}`);
          rollbackOptimisticPatient();
          return { success: false, error: userResult.error };
        }

        activationEmailSent = false;
        activationEmailWarning = inviteErrorMessage;
        activationMessage = 'Paciente cadastrado. O convite não foi preparado agora; use reenviar ativação depois.';
      }
    }

    // 2. Save patient record
    const fbResult = await dataService.savePatient({
      name: data.name,
      socialName: data.socialName || data.nomeSocial || '',
      email: data.email || '',
      cpf: data.cpf || data.anamnesisData?.cpf || '',
      phone: data.phone,
      birthDate: resolvedBirthDate,
      birth_date: resolvedBirthDate,
      age: data.anamnesisData?.idade || data.age || calculateAgeFromBirthDate(resolvedBirthDate) || 0,
      gender: data.gender || data.genero || '',
      diagnosis: data.diagnosis,
      status: "PENDING_ANAMNESIS",
      onboardingStatus: "NOT_STARTED",
      onboarding_status: "NOT_STARTED",
      anamnesisRequired: true,
      anamnesis_required: true,
      type: resolvedPortalType,
      patientProfileType: resolvedProfileType,
      panelType: resolvedProfileType,
      profileType: resolvedProfileType,
      insuranceType: data.insuranceType || data.convenioTipo || 'particular',
      insuranceName: data.insuranceName || data.convenioNome || '',
      insuranceCardNumber: data.cardNumber || data.convenioCarteirinha || '',
      group: data.group || data.grupo || '',
      source: data.source || data.comoConheceu || '',
      rg: data.rg || '',
      cep: data.cep || data.address?.cep || '',
      address: data.address || {},
      notes: data.notes || data.outrasInformacoes || '',
      isMinor: Boolean(data.isMinor || data.menorDeIdade),
      guardian: resolvedGuardian,
      responsibleName: resolvedGuardian?.nome || '',
      responsibleBirthDate: resolvedGuardian?.dataNascimento || '',
      responsibleCpf: resolvedGuardian?.cpf || '',
      responsiblePhone: resolvedGuardian?.telefone || '',
      responsibleEmail: resolvedGuardian?.email || '',
      responsibleRelationship: resolvedGuardian?.relacao || '',
      clientRecordId: String(newId)
    });

    let persistedPatientId: string | number = newId;
    let resolvedPersistedPatientId = false;
    const duplicateConflict =
      !fbResult?.success &&
      Number(fbResult?.status) === 409 &&
      (
        String(fbResult?.code || "").trim() === "PATIENT_DUPLICATE_IN_CLINIC" ||
        /já existe um paciente|mesmo e-mail|mesmo cpf|duplicate/i.test(
          String(fbResult?.error || ""),
        )
      );

    if (duplicateConflict) {
      const existingIdFromApi = String(
        fbResult?.details?.patientId ||
        fbResult?.details?.details?.patientId ||
        "",
      ).trim();

      let matchedPatient: any = null;
      if (existingIdFromApi) {
        const patientsRes = await dataService.getPatients();
        if (patientsRes?.success && Array.isArray(patientsRes?.data)) {
          matchedPatient = patientsRes.data.find(
            (p: any) => String(p?.id) === existingIdFromApi,
          );
        }
      }

      if (!matchedPatient) {
        const patientsRes = await dataService.getPatients();
        if (patientsRes?.success && Array.isArray(patientsRes?.data)) {
          const targetEmail = String(data.email || "")
            .trim()
            .toLowerCase();
          const targetCpf = String(data.cpf || data.anamnesisData?.cpf || "")
            .replace(/\D/g, "")
            .trim();
          matchedPatient = patientsRes.data.find((p: any) => {
            const emailMatch =
              targetEmail &&
              String(p?.email || "")
                .trim()
                .toLowerCase() === targetEmail;
            const cpfMatch =
              targetCpf &&
              String(p?.cpf || "")
                .replace(/\D/g, "")
                .trim() === targetCpf;
            return Boolean(emailMatch || cpfMatch);
          });
        }
      }

      if (matchedPatient?.id) {
        persistedPatientId = matchedPatient.id;
        resolvedPersistedPatientId = true;
        setAllPatients((prev) =>
          mergePatients(
            prev.map((p) =>
              String(p.id) === String(newId) ? { ...p, id: matchedPatient.id } : p,
            ),
            [{ ...newPatient, ...matchedPatient, id: matchedPatient.id }],
          ),
        );
        setClinicalRecords((prev) =>
          prev.map((r) =>
            String(r.patientId) === String(newId)
              ? { ...r, patientId: matchedPatient.id }
              : r,
          ),
        );
        setTherapistAgenda((prev) =>
          prev.map((a: any) =>
            String(a.patientId) === String(newId)
              ? {
                  ...a,
                  patientId: matchedPatient.id,
                  patientEmail: matchedPatient.email || data.email || a.patientEmail || null,
                  patient_email: matchedPatient.email || data.email || a.patient_email || null,
                }
              : a,
          ),
        );
      } else {
        alert(
          "Paciente já existe na clínica, mas não foi possível reconciliar o ID para concluir o prontuário agora. Atualize a página para sincronizar.",
        );
        rollbackOptimisticPatient();
        return {
          success: false,
          error: "Paciente já existe na clínica (conflito de e-mail/CPF).",
        };
      }
    }

    if (!fbResult?.success) {
      const deferredPatientSync =
        Boolean(fbResult?.offline || fbResult?.pending) &&
        (Number(fbResult?.status) >= 500 || Number(fbResult?.status) === 408 || Number(fbResult?.status) === 429);
      if (deferredPatientSync) {
        activationEmailSent = activationEmailSent === null ? false : activationEmailSent;
        const pendingSyncMessage = "Cadastro salvo localmente. A sincronização com o servidor será retomada automaticamente.";
        activationMessage = activationEmailSent === false
          ? `${pendingSyncMessage} O convite poderá ser reenviado depois que o cadastro for confirmado no servidor.`
          : pendingSyncMessage;
        return {
          success: true,
          data: {
            patientId: persistedPatientId,
            patientEmail: data.email || null,
            activationEmailSent,
            activationEmailWarning: activationEmailWarning || toReadableError(fbResult?.error || fbResult?.warning || 'Sincronização pendente.'),
            activationMessage,
            portabilityAvailable,
            patientSyncPending: true
          }
        };
      }
      if (!duplicateConflict) {
        alert(`Não foi possível cadastrar paciente: ${toReadableError(fbResult?.error || 'Erro desconhecido')}`);
        rollbackOptimisticPatient();
        return { success: false, error: fbResult?.error || 'Erro ao cadastrar paciente' };
      }
    } else if (fbResult.success && fbResult.data) {
      const realId = fbResult.data.id;
      setAllPatients(prev => mergePatients(
        prev.map(p => p.id === newId ? { ...p, id: realId } : p),
        [{ ...newPatient, id: realId }]
      ));
      setClinicalRecords(prev => prev.map(r => r.patientId === newId ? { ...r, patientId: realId } : r));
      setTherapistAgenda(prev => prev.map((a: any) => String(a.patientId) === String(newId) ? {
        ...a,
        patientId: realId,
        patientEmail: data.email || a.patientEmail || null,
        patient_email: data.email || a.patient_email || null
      } : a));
      persistedPatientId = realId;
      resolvedPersistedPatientId = true;
    }

    const canPersistPatientRecord =
      resolvedPersistedPatientId &&
      Boolean(String(persistedPatientId || "").trim()) &&
      !String(persistedPatientId).startsWith("temp_");

    if (canPersistPatientRecord) {
      const patientRecordResult = await dataService.savePatientRecord(String(persistedPatientId), {
        workspace_id: String(user?.activeWorkspaceId || user?.clinicId || '').trim() || null,
        ...buildPatientAnamnesisSnapshot(data, data.anamnesisData),
        lastAnamnesisAt: data.lastAnamnesisAt || null,
        financialPlans: Array.isArray(data.financialPlans) ? data.financialPlans : [],
        monthlyTreatmentValue: Number(data.monthlyTreatmentValue || 0) || 0,
        billingDueDay: data.billingDueDay || null,
        billingMethod: data.billingMethod || null,
        patientProfileType: resolvedProfileType,
        panelType: resolvedProfileType,
        portalType: resolvedPortalType,
        diagnosis: data.diagnosis || "",
        pei: Array.isArray(data.pei) ? data.pei : [],
        evaluationLinks:
          data.evaluationLinks && typeof data.evaluationLinks === 'object' ? data.evaluationLinks : {},
        interventionTaskLinks:
          data.interventionTaskLinks && typeof data.interventionTaskLinks === 'object' ? data.interventionTaskLinks : {},
        anamnese: buildPatientAnamnesisSnapshot(data, data.anamnesisData)
      });
      if (!patientRecordResult?.success) {
        const errorMessage = toReadableError(patientRecordResult?.error || patientRecordResult?.warning || 'Falha ao persistir prontuário financeiro.');
        alert(`Paciente criado, mas os dados financeiros do prontuário não foram confirmados no banco: ${errorMessage}`);
        return { success: false, error: errorMessage };
      }
    }
    return {
      success: true,
      data: {
        patientId: persistedPatientId,
        patientEmail: data.email || null,
        activationEmailSent,
        activationEmailWarning,
        activationMessage: activationMessage || "Paciente cadastrado. Envie a ficha de anamnese para concluir a ativação clínica.",
        portabilityAvailable,
        onboardingStatus: "NOT_STARTED",
        anamnesisRequired: true
      }
    };
    } catch (error: any) {
      console.error("Falha ao cadastrar paciente:", error);
      return {
        success: false,
        error: toReadableError(error?.message || "Erro inesperado ao cadastrar paciente."),
      };
    }
  };
  const handleUpdatePatient = async (updatedData: any) => { 
    // Split updates
    const { diagnosis, anamnesisData, pei, evaluationLinks, interventionTaskLinks, ...identityData } = updatedData;
    const currentPatient = allPatients.find((p) => String(p?.id) === String(updatedData?.id));
    const hasNamePatch = Object.prototype.hasOwnProperty.call(updatedData || {}, 'name');
    const preserveCurrentFullName = hasNamePatch && shouldPreservePatientFullName(currentPatient?.name, updatedData?.name);
    const safeIdentityData = preserveCurrentFullName
      ? { ...identityData, name: currentPatient?.name }
      : identityData;
    const mergedIdentityPatient = {
      ...(currentPatient || {}),
      ...updatedData,
      ...(preserveCurrentFullName ? { name: currentPatient?.name } : {})
    };
    const updatedInsuranceEligibility = normalizePatientInsuranceEligibility(mergedIdentityPatient, { useResponsibleFallback: true });
    const hasInsuranceEligibilityPatch = [
      'insuranceType',
      'insuranceName',
      'insuranceCardNumber',
      'insuranceCardValidUntil',
      'insurancePlanCategory',
      'insuranceHolderName',
      'insuranceHolderCpf',
      'insuranceHolderRelationship',
      'insuranceEligibilityNotes',
      'eligibilityNotes',
      'convenioTipo',
      'convenioNome',
      'convenioCarteirinha',
      'convenioCarteirinhaValidade',
      'convenioPlanoCategoria',
      'convenioTitularNome',
      'convenioTitularCpf',
      'convenioTitularRelacao',
      'convenioElegibilidadeObs',
    ].some((key) => Object.prototype.hasOwnProperty.call(updatedData || {}, key));
    const updatedProfileType = normalizePatientProfileType(
      updatedData?.patientProfileType ||
        updatedData?.panelType ||
        updatedData?.profileType ||
        updatedData?.profile_type ||
        updatedData?.type ||
        currentPatient?.patientProfileType ||
        currentPatient?.panelType ||
        currentPatient?.type,
    );
    const updatedPortalType = mapPatientProfileTypeToLegacyPortalType(updatedProfileType);
    const syncedAnamnesisData =
      anamnesisData !== undefined
        ? buildPatientAnamnesisSnapshot(mergedIdentityPatient, anamnesisData)
        : currentPatient?.anamnesisData
          ? buildPatientAnamnesisSnapshot(mergedIdentityPatient, currentPatient.anamnesisData)
          : undefined;
    const normalizedPatientStatus = String(updatedData?.status || '').toLowerCase();
    const isArchivePatient = normalizedPatientStatus === 'archived';
    const isDeleteOrUnlink = updatedData?.clinic_id === null || normalizedPatientStatus === 'deleted' || isArchivePatient;

    // If unlinking or archiving, remove from the active patient list while the backend preserves history.
    if (isDeleteOrUnlink) {
      setAllPatients(prev => prev.filter(p => p.id !== updatedData.id));
      onAddActivityLog(
        isArchivePatient ? "Arquivamento de Paciente" : "Desvinculação de Paciente",
        isArchivePatient
          ? `${formatPatientLabel(mergedIdentityPatient)} foi arquivado com histórico preservado.`
          : `${formatPatientLabel(mergedIdentityPatient)} foi desvinculado.`,
        'management',
      );
    } else {
      if (Object.keys(identityData).length > 1) { // More than just 'id'
        setAllPatients(prev => prev.map(p => p.id === updatedData.id ? {
          ...p,
          ...safeIdentityData,
          ...(hasInsuranceEligibilityPatch
            ? {
                insuranceType: updatedInsuranceEligibility.insuranceType,
                insuranceName: updatedInsuranceEligibility.insuranceName,
                cardNumber: updatedInsuranceEligibility.insuranceCardNumber,
                insuranceCardNumber: updatedInsuranceEligibility.insuranceCardNumber,
                insuranceCardValidUntil: updatedInsuranceEligibility.insuranceCardValidUntil,
                insurancePlanCategory: updatedInsuranceEligibility.insurancePlanCategory,
                insuranceHolderName: updatedInsuranceEligibility.insuranceHolderName,
                insuranceHolderCpf: updatedInsuranceEligibility.insuranceHolderCpf,
                insuranceHolderRelationship: updatedInsuranceEligibility.insuranceHolderRelationship,
                eligibilityNotes: updatedInsuranceEligibility.insuranceEligibilityNotes,
                convenioTipo: updatedInsuranceEligibility.convenioTipo,
                convenioNome: updatedInsuranceEligibility.convenioNome,
                convenioCarteirinha: updatedInsuranceEligibility.convenioCarteirinha,
                convenioCarteirinhaValidade: updatedInsuranceEligibility.convenioCarteirinhaValidade,
                convenioPlanoCategoria: updatedInsuranceEligibility.convenioPlanoCategoria,
                convenioTitularNome: updatedInsuranceEligibility.convenioTitularNome,
                convenioTitularCpf: updatedInsuranceEligibility.convenioTitularCpf,
                convenioTitularRelacao: updatedInsuranceEligibility.convenioTitularRelacao,
                convenioElegibilidadeObs: updatedInsuranceEligibility.convenioElegibilidadeObs,
              }
            : {}),
          ...(syncedAnamnesisData !== undefined ? { anamnesisData: syncedAnamnesisData } : {})
        } : p)); 
      }

      if (diagnosis !== undefined || anamnesisData !== undefined || pei !== undefined || evaluationLinks !== undefined || interventionTaskLinks !== undefined || syncedAnamnesisData !== undefined) {
        const clinicalPatch: any = {
          ...(diagnosis !== undefined && { diagnosis }),
          ...(syncedAnamnesisData !== undefined && { anamnesisData: syncedAnamnesisData }),
          ...(pei !== undefined && { pei }),
          ...(evaluationLinks !== undefined && { evaluationLinks }),
          ...(interventionTaskLinks !== undefined && { interventionTaskLinks })
        };
        setAllPatients(prev =>
          prev.map(p => p.id === updatedData.id ? { ...p, ...clinicalPatch } : p)
        );
        setClinicalRecords(prev => prev.map(r => r.patientId === updatedData.id ? { 
          ...r, 
          ...(diagnosis !== undefined && { diagnosis }),
          ...(syncedAnamnesisData !== undefined && { anamnesisData: syncedAnamnesisData }),
          ...(pei !== undefined && { pei }),
          ...(evaluationLinks !== undefined && { evaluationLinks }),
          ...(interventionTaskLinks !== undefined && { interventionTaskLinks })
        } : r));
      }

      setTherapistAgenda(prev => prev.map(a => a.id === updatedData.id ? { ...a, name: updatedData.name || a.name } : a)); 
      onAddActivityLog("Atualização de Cadastro", `Dados de ${formatPatientLabel(mergedIdentityPatient)} atualizados.`, 'management');
    }

    // Sync to Backend
    if (typeof updatedData.id === 'string' || typeof updatedData.id === 'number') {
      const { dataService } = await import('./services/dataService');
      if (isDeleteOrUnlink) {
        const deleteResult = await dataService.deletePatient(String(updatedData.id));
        if (!deleteResult?.success) {
          const errorMessage = toReadableError(deleteResult?.error || 'Erro desconhecido');
          alert(`Não foi possível arquivar/desvincular paciente: ${errorMessage}`);
          return { success: false, error: errorMessage };
        }
      } else {
        const patientUpdatePayload = {
          name: preserveCurrentFullName ? undefined : updatedData.name,
          socialName: updatedData.socialName || updatedData.nomeSocial,
          email: updatedData.email,
          phone: updatedData.phone,
          birthDate: updatedData.birthDate || updatedData.dataNascimento,
          birth_date: updatedData.birthDate || updatedData.dataNascimento,
          age: updatedData.age,
          gender: updatedData.gender || updatedData.genero,
          diagnosis: updatedData.diagnosis,
          type: updatedPortalType,
          patientProfileType: updatedProfileType,
          panelType: updatedProfileType,
          profileType: updatedProfileType,
          insuranceType: updatedData.insuranceType || updatedData.convenioTipo,
          insuranceName: updatedData.insuranceName || updatedData.convenioNome,
          insuranceCardNumber: updatedData.cardNumber || updatedData.convenioCarteirinha,
          insuranceCardValidUntil: updatedData.insuranceCardValidUntil || updatedData.insurance_card_valid_until || updatedData.convenioCarteirinhaValidade,
          insurancePlanCategory: updatedData.insurancePlanCategory || updatedData.insurance_plan_category || updatedData.convenioPlanoCategoria,
          insuranceHolderName: updatedData.insuranceHolderName || updatedData.insurance_holder_name || updatedData.convenioTitularNome,
          insuranceHolderCpf: updatedData.insuranceHolderCpf || updatedData.insurance_holder_cpf || updatedData.convenioTitularCpf,
          insuranceHolderRelationship: updatedData.insuranceHolderRelationship || updatedData.insurance_holder_relationship || updatedData.convenioTitularRelacao,
          eligibilityNotes: updatedData.eligibilityNotes || updatedData.eligibility_notes || updatedData.convenioElegibilidadeObs,
          group: updatedData.group || updatedData.grupo,
          source: updatedData.source || updatedData.comoConheceu,
          rg: updatedData.rg,
          cpf: updatedData.cpf,
          cep: updatedData.cep || updatedData.address?.cep,
          address: updatedData.address,
          notes: updatedData.notes || updatedData.outrasInformacoes,
          isMinor: updatedData.isMinor || updatedData.menorDeIdade,
          guardian: updatedData.guardian,
          responsibleName: updatedData.guardian?.nome || updatedData.responsavelNome,
          responsibleBirthDate: updatedData.guardian?.dataNascimento || updatedData.responsavelDataNascimento,
          responsibleCpf: updatedData.guardian?.cpf || updatedData.responsavelCpf,
          responsiblePhone: updatedData.guardian?.telefone || updatedData.responsavelTelefone,
          responsibleEmail: updatedData.guardian?.email || updatedData.responsavelEmail,
          responsibleRelationship: updatedData.guardian?.relacao || updatedData.responsavelRelacao,
          therapist_id:
            typeof updatedData?.therapist_id !== 'undefined'
              ? updatedData.therapist_id
              : updatedData?.professional_id,
          professional_id:
            typeof updatedData?.professional_id !== 'undefined'
              ? updatedData.professional_id
              : updatedData?.therapist_id,
          responsible_professional_id:
            typeof updatedData?.responsible_professional_id !== 'undefined'
              ? updatedData.responsible_professional_id
              : (typeof updatedData?.responsibleProfessionalId !== 'undefined'
                ? updatedData.responsibleProfessionalId
                : (typeof updatedData?.therapist_id !== 'undefined' ? updatedData.therapist_id : updatedData?.professional_id)),
          clinic_id: updatedData.clinic_id,
          status: updatedData.status
        };
        let updateResult = await dataService.updatePatient(String(updatedData.id), patientUpdatePayload);
        if (!updateResult?.success && updateResult?.code === 'BILLING_UPGRADE_REQUIRED') {
          const upgradeConfirmed = await confirmActivePatientBillingUpgrade(updateResult);
          if (upgradeConfirmed) {
            updateResult = await dataService.updatePatient(String(updatedData.id), patientUpdatePayload);
          }
        }
        if (!updateResult?.success) {
          const errorMessage = toReadableError(updateResult?.error || updateResult?.warning || 'Erro desconhecido');
          alert(`Não foi possível confirmar a persistência do cadastro: ${errorMessage}`);
          return { success: false, error: errorMessage };
        }
      }

      if (
        !isDeleteOrUnlink &&
        (
          syncedAnamnesisData !== undefined ||
          anamnesisData !== undefined ||
          diagnosis !== undefined ||
          updatedData?.type !== undefined ||
          updatedData?.patientProfileType !== undefined ||
          updatedData?.panelType !== undefined ||
          pei !== undefined ||
          evaluationLinks !== undefined ||
          interventionTaskLinks !== undefined ||
          updatedData?.lastAnamnesisAt !== undefined
          || updatedData?.financialPlans !== undefined
          || updatedData?.monthlyTreatmentValue !== undefined
          || updatedData?.billingDueDay !== undefined
          || updatedData?.billingMethod !== undefined
          || hasInsuranceEligibilityPatch
        )
      ) {
        const recordPayload: any = {
          workspace_id: String(user?.activeWorkspaceId || user?.clinicId || '').trim() || null,
          lastAnamnesisAt: updatedData?.lastAnamnesisAt || null,
          ...(diagnosis !== undefined && { diagnosis: diagnosis || "" }),
          ...(updatedData?.type !== undefined || updatedData?.patientProfileType !== undefined || updatedData?.panelType !== undefined
            ? { patientProfileType: updatedProfileType, panelType: updatedProfileType, portalType: updatedPortalType }
            : {}),
          ...(updatedData?.financialPlans !== undefined && {
            financialPlans: Array.isArray(updatedData.financialPlans) ? updatedData.financialPlans : [],
          }),
          ...(updatedData?.monthlyTreatmentValue !== undefined && {
            monthlyTreatmentValue: Number(updatedData.monthlyTreatmentValue || 0) || 0,
          }),
          ...(updatedData?.billingDueDay !== undefined && { billingDueDay: updatedData.billingDueDay || null }),
          ...(updatedData?.billingMethod !== undefined && { billingMethod: updatedData.billingMethod || null }),
          ...(hasInsuranceEligibilityPatch && {
            insuranceType: updatedInsuranceEligibility.insuranceType,
            insuranceName: updatedInsuranceEligibility.insuranceName,
            insuranceCardNumber: updatedInsuranceEligibility.insuranceCardNumber,
            cardNumber: updatedInsuranceEligibility.insuranceCardNumber,
            insuranceCardValidUntil: updatedInsuranceEligibility.insuranceCardValidUntil,
            insurancePlanCategory: updatedInsuranceEligibility.insurancePlanCategory,
            insuranceHolderName: updatedInsuranceEligibility.insuranceHolderName,
            insuranceHolderCpf: updatedInsuranceEligibility.insuranceHolderCpf,
            insuranceHolderRelationship: updatedInsuranceEligibility.insuranceHolderRelationship,
            insuranceEligibilityNotes: updatedInsuranceEligibility.insuranceEligibilityNotes,
            eligibilityNotes: updatedInsuranceEligibility.insuranceEligibilityNotes,
            convenioTipo: updatedInsuranceEligibility.convenioTipo,
            convenioNome: updatedInsuranceEligibility.convenioNome,
            convenioCarteirinha: updatedInsuranceEligibility.convenioCarteirinha,
            convenioCarteirinhaValidade: updatedInsuranceEligibility.convenioCarteirinhaValidade,
            convenioPlanoCategoria: updatedInsuranceEligibility.convenioPlanoCategoria,
            convenioTitularNome: updatedInsuranceEligibility.convenioTitularNome,
            convenioTitularCpf: updatedInsuranceEligibility.convenioTitularCpf,
            convenioTitularRelacao: updatedInsuranceEligibility.convenioTitularRelacao,
            convenioElegibilidadeObs: updatedInsuranceEligibility.convenioElegibilidadeObs,
          }),
          ...(pei !== undefined && { pei }),
          ...(evaluationLinks !== undefined && { evaluationLinks }),
          ...(interventionTaskLinks !== undefined && { interventionTaskLinks }),
        };

        if (syncedAnamnesisData !== undefined) {
          Object.assign(recordPayload, {
            ...buildPatientAnamnesisSnapshot(mergedIdentityPatient, syncedAnamnesisData),
            anamnese: syncedAnamnesisData || {},
          });
        }

        const patientRecordResult = await dataService.savePatientRecord(String(updatedData.id), recordPayload);
        if (!patientRecordResult?.success) {
          const errorMessage = toReadableError(patientRecordResult?.error || patientRecordResult?.warning || 'Erro desconhecido');
          alert(`Não foi possível confirmar a persistência do prontuário financeiro: ${errorMessage}`);
          return { success: false, error: errorMessage };
        }
      }
    }
    return { success: true };
  };
  const handleScheduleSession = async (sess: any) => {
    const requestedPatientId = String(sess.patientId || sess.patient_id || '').trim();
    const patientForSession = allPatients.find((p) =>
      requestedPatientId
        ? String(p?.id || '').trim() === requestedPatientId
        : String(p?.name || '').trim() === String(sess.patientName || '').trim()
    );
    const pid = patientForSession?.id || requestedPatientId;
    if (!pid) {
      return { success: false, errors: ['Selecione um paciente cadastrado para confirmar o agendamento.'] };
    }
    const numSessions = Math.min(52, Math.max(1, Number(sess.numSessions) || 1));
    const recurrenceGroupId = numSessions > 1 ? createAppointmentId() : null;
    const recurrenceDates = buildRecurrenceDateKeys({
      startDate: sess.date,
      count: numSessions,
      pattern: sess.recurrencePattern || 'weekly',
    });
    const requestedRoomId = String(
      sess.roomId || sess.room_id || sess.room || '',
    ).trim();
    const locationType = requestedRoomId
      ? 'clinica'
      : normalizeScheduleLocationType(
          sess.locationType || sess.location_type || 'outro',
        );
    const durationMinutes = normalizeDurationMinutes(sess.durationMinutes || sess.duration_minutes || 50, 50);
    const roomId = locationType === 'clinica' ? requestedRoomId : '';
    const roomName = locationType === 'clinica'
      ? String(sess.roomName || sess.room_name || rooms.find((room: any) => String(room?.id || '') === roomId)?.name || roomId).trim()
      : '';
    const roomConfig = findScheduleRoomConfig(rooms, roomId, roomName);
    const roomBlocksOverlap = roomPreventsOverlappingAppointments(
      roomConfig || {
        name: roomName,
        prevent_overlapping_appointments:
          sess.room_prevent_overlapping_appointments ??
          sess.roomPreventOverlappingAppointments,
      },
      true,
    );
    const professionalName = String(sess.professionalName || sess.professional || '').trim();
    const professionalId = String(sess.professionalId || sess.professional_id || sess.therapistId || sess.therapist_id || '').trim();
    let financialContextType = normalizeAppointmentFinancialContextType(
      sess.financialContextType ||
        sess.financial_context_type ||
        sess.billingContextType ||
        sess.billing_context_type ||
        sess.payerType ||
        sess.payer_type ||
        (sess.payerId || sess.payer_id ? 'INSURANCE' : '')
    );
    let effectivePayerId = String(sess.payerId || sess.payer_id || '').trim();
    let effectivePayerName = String(sess.payerName || sess.payer_name_snapshot || '').trim();
    const patientFinancialPlans = Array.isArray(patientForSession?.financialPlans)
      ? patientForSession.financialPlans
      : Array.isArray((patientForSession as any)?.financial_plans)
        ? (patientForSession as any).financial_plans
        : [];
    const normalizePatientPayerKey = (value: any) =>
      String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    const patientInsurancePlans = patientFinancialPlans.filter((plan: any) => {
      const payerId = String(plan?.payerId || plan?.payer_id || '').trim();
      const payerName = String(plan?.payerNameSnapshot || plan?.payer_name_snapshot || plan?.insuranceName || plan?.insurance_name || '').trim();
      const billingMode = String(plan?.billingMode || plan?.billing_mode || '').toUpperCase();
      const status = String(plan?.status || 'ACTIVE').toUpperCase();
      return (payerId || payerName) && billingMode === 'INSURANCE' && status !== 'INACTIVE' && plan?.active !== false && plan?.isActive !== false;
    });
    if (!financialContextType && !effectivePayerId) {
      const serviceKey = String(sess.approach || sess.serviceType || sess.service_type || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_');
      const matchingPlans = patientInsurancePlans.filter((plan: any) => {
        const planServiceKey = String(
          plan?.serviceType ||
            plan?.service_type ||
            plan?.customServiceName ||
            plan?.custom_service_name ||
            plan?.serviceNameSnapshot ||
            plan?.service_name_snapshot ||
            ''
        )
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '_');
        return !serviceKey || !planServiceKey || planServiceKey === serviceKey;
      });
      const inferredPlan = matchingPlans.length === 1 ? matchingPlans[0] : patientInsurancePlans.length === 1 ? patientInsurancePlans[0] : null;
      if (inferredPlan) {
        effectivePayerId = String(inferredPlan?.payerId || inferredPlan?.payer_id || '').trim();
        effectivePayerName = String(inferredPlan?.payerNameSnapshot || inferredPlan?.payer_name_snapshot || inferredPlan?.insuranceName || inferredPlan?.insurance_name || '').trim();
        financialContextType = effectivePayerId ? 'INSURANCE' : '';
      }
    }
    if (!financialContextType && effectivePayerId) financialContextType = 'INSURANCE';
    const usesInsuranceContext = financialContextType.toUpperCase() === 'INSURANCE';
    const patientInsuranceEligibility = normalizePatientInsuranceEligibility(patientForSession || {});
    const effectiveInsurancePlan = patientInsurancePlans.find((plan: any) => {
      const planPayerId = String(plan?.payerId || plan?.payer_id || '').trim();
      const planPayerName = String(plan?.payerNameSnapshot || plan?.payer_name_snapshot || plan?.insuranceName || plan?.insurance_name || '').trim();
      const payerIdMatches = effectivePayerId && planPayerId && planPayerId === effectivePayerId;
      const payerNameMatches = effectivePayerName && planPayerName && normalizePatientPayerKey(planPayerName) === normalizePatientPayerKey(effectivePayerName);
      return payerIdMatches || payerNameMatches;
    });
    const legacyPayerMatchesSelected =
      !patientInsurancePlans.length ||
      !effectivePayerName ||
      normalizePatientPayerKey(patientInsuranceEligibility.insuranceName) === normalizePatientPayerKey(effectivePayerName);
    const effectiveInsurancePlanName = usesInsuranceContext
      ? String(
          sess.insurancePlanName ||
            sess.insurance_plan_name ||
            effectiveInsurancePlan?.insurancePlanName ||
            effectiveInsurancePlan?.insurance_plan_name ||
            (legacyPayerMatchesSelected ? patientInsuranceEligibility.insurancePlanCategory : '') ||
            ''
        ).trim()
      : '';
    const effectiveInsuranceCardNumber = usesInsuranceContext
      ? String(
            sess.insuranceCardNumber ||
            sess.insurance_card_number ||
            sess.cardNumber ||
            sess.card_number ||
            effectiveInsurancePlan?.insuranceCardNumber ||
            effectiveInsurancePlan?.insurance_card_number ||
            effectiveInsurancePlan?.cardNumber ||
            effectiveInsurancePlan?.card_number ||
            (legacyPayerMatchesSelected ? patientInsuranceEligibility.insuranceCardNumber : '') ||
            ''
        ).trim()
      : '';
    const recurringAuthorizationEnabled =
      numSessions <= 1 ||
      Boolean(
        sess.applyAuthorizationToRecurrence ??
          sess.apply_authorization_to_recurrence ??
          true,
      );
    const recurringGuideReuseEnabled =
      numSessions > 1 &&
      Boolean(
        sess.reuseGuideAcrossRecurrence ??
          sess.reuse_guide_across_recurrence ??
          false,
      );
    const sourceGuideNumber = String(
      sess.guideNumber || sess.guide_number || '',
    ).trim();
    const sourceAuthorizationCode = String(
      sess.authorizationCode || sess.authorization_code || '',
    ).trim();
    const newItems = [];
    const conflicts: string[] = [];

    if (locationType === 'clinica' && !roomId) {
      return { success: false, errors: ['Selecione uma sala da clínica para este atendimento.'] };
    }

    for (let i = 0; i < recurrenceDates.length; i += 1) {
      const dateStr = recurrenceDates[i];
      const startTime = sess.time;
      const endTime = calculateEndTime(sess.time, sess.approach, durationMinutes);

      therapistAgenda.forEach((item) => {
        if (item.date !== dateStr || !appointmentBlocksConflict(item)) return;
        const existingEndTime = calculateEndTime(
          item.time,
          item.type || item.approach || 'Consulta Padrão',
          item.duration_minutes || item.durationMinutes,
        );
        if (!appointmentTimesOverlap(startTime, endTime, item.time, existingEndTime)) return;

        const existingRoomId = String(
          item.roomId || item.room_id || item.room || '',
        ).trim();
        const existingLocationType = existingRoomId
          ? 'clinica'
          : normalizeScheduleLocationType(
              item.location_type || item.locationType || item.location || 'outro',
            );
        const sameRoom =
          locationType === 'clinica' &&
          existingLocationType === 'clinica' &&
          roomId &&
          String(item.room || item.roomId || item.room_id || '') === roomId;
        const sameProfessional =
          (professionalId && String(item.professionalId || item.therapistId || item.professional_id || item.therapist_id || '') === professionalId) ||
          (professionalName && String(item.professional || item.therapistName || '').trim() === professionalName);
        const samePatient =
          String(item.patientId || item.patient_id || '') === String(pid || '') ||
          String(item.name || item.patientName || '').trim() === String(sess.patientName || '').trim();

        if (sameRoom && roomBlocksOverlap) {
          const message = `${roomName || roomId} já está ocupada das ${item.time} às ${existingEndTime} em ${dateStr}.`;
          if (!conflicts.includes(message)) conflicts.push(message);
        }
        if (sameProfessional) {
          const message = `${professionalName || 'Profissional'} já possui atendimento das ${item.time} às ${existingEndTime} em ${dateStr}.`;
          if (!conflicts.includes(message)) conflicts.push(message);
        }
        if (samePatient) {
          const message = `${sess.patientName || 'Paciente'} já possui outra sessão nesse horário em ${dateStr}.`;
          if (!conflicts.includes(message)) conflicts.push(message);
        }
      });

      if (conflicts.length === 0) {
        const appointmentId = createAppointmentId();
        const startAt = buildAppointmentDateTime(dateStr, sess.time);
        const endAt = calculateAppointmentEnd(startAt, durationMinutes);
        if (!startAt || !endAt) {
          const message = 'Informe data e horario validos para este atendimento.';
          if (!conflicts.includes(message)) conflicts.push(message);
          continue;
        }
        const scheduledAt = startAt.toISOString();
        const scheduledEndAt = endAt.toISOString();
        const occurrenceBillingFields = resolveRecurringAppointmentBillingFields({
          occurrenceIndex: i,
          totalOccurrences: numSessions,
          guideNumber: sourceGuideNumber,
          authorizationCode: sourceAuthorizationCode,
          applyAuthorizationToRecurrence: recurringAuthorizationEnabled,
          reuseGuideAcrossRecurrence: recurringGuideReuseEnabled,
        });
        newItems.push({
          id: appointmentId,
          patientId: pid,
          patient_id: pid,
          patientName: sess.patientName,
          patient_name: sess.patientName,
          patientEmail: patientForSession?.email || null,
          patient_email: patientForSession?.email || null,
          name: sess.patientName,
          date: dateStr,
          time: sess.time,
          scheduledAt,
          scheduled_at: scheduledAt,
          scheduledStartAt: scheduledAt,
          scheduled_start_at: scheduledAt,
          scheduledEndAt,
          scheduled_end_at: scheduledEndAt,
          durationMinutes,
          duration_minutes: durationMinutes,
          scheduledDurationMinutes: durationMinutes,
          scheduled_duration_minutes: durationMinutes,
          status: 'pending',
          type: sess.approach,
          approach: sess.approach,
          serviceType: sess.approach,
          service_type: sess.approach,
          color: 'bg-blue-100 text-blue-600',
          professional: professionalName,
          professionalId: professionalId || null,
          professional_id: professionalId || null,
          therapistId: professionalId || null,
          therapist_id: professionalId || null,
          therapistName: professionalName,
          therapist_name: professionalName,
          room: roomId,
          roomId,
          room_id: roomId,
          roomName,
          room_name: roomName,
          location: locationType,
          locationType,
          location_type: locationType,
          locationNotes: sess.locationNotes || '',
          location_notes: sess.locationNotes || '',
          callLink: sess.callLink || '',
          call_link: sess.callLink || '',
          financialContextType,
          financial_context_type: financialContextType,
          billingContextType: financialContextType,
          billing_context_type: financialContextType,
          payerType: financialContextType,
          payer_type: financialContextType,
          payerId: usesInsuranceContext ? effectivePayerId || null : null,
          payer_id: usesInsuranceContext ? effectivePayerId || null : null,
          payerName: usesInsuranceContext ? effectivePayerName || '' : '',
          payer_name_snapshot: usesInsuranceContext ? effectivePayerName || '' : '',
          insurancePlanName: effectiveInsurancePlanName,
          insurance_plan_name: effectiveInsurancePlanName,
          insuranceCardNumber: effectiveInsuranceCardNumber,
          insurance_card_number: effectiveInsuranceCardNumber,
          guideNumber: occurrenceBillingFields.guideNumber,
          guide_number: occurrenceBillingFields.guideNumber,
          authorizationCode: occurrenceBillingFields.authorizationCode,
          authorization_code: occurrenceBillingFields.authorizationCode,
          applyAuthorizationToRecurrence: recurringAuthorizationEnabled,
          apply_authorization_to_recurrence: recurringAuthorizationEnabled,
          reuseGuideAcrossRecurrence: recurringGuideReuseEnabled,
          reuse_guide_across_recurrence: recurringGuideReuseEnabled,
          isRecurring: numSessions > 1,
          is_recurring: numSessions > 1,
          recurrenceGroupId,
          recurrence_group_id: recurrenceGroupId,
          recurrenceIndex: i + 1,
          recurrence_index: i + 1,
          recurrenceTotal: numSessions,
          recurrence_total: numSessions,
          recurrenceFrequency: numSessions > 1 ? String(sess.recurrencePattern || 'weekly') : null,
          recurrence_frequency: numSessions > 1 ? String(sess.recurrencePattern || 'weekly') : null,
          patientResponse: null,
          patient_response: null,
          patientRespondedAt: null,
          patient_responded_at: null,
          patientConfirmationStatus: null,
          patient_confirmation_status: null,
          patientConfirmationAt: null,
          patient_confirmation_at: null,
          patientConfirmationBy: null,
          patient_confirmation_by: null,
          patientConfirmationSource: null,
          patient_confirmation_source: null,
          notification_24h_sent_at: null,
          notification24hSentAt: null,
          notification_sent_at: null,
          notification_sent: false,
          notification_12h_sent_at: null,
          notification12hSentAt: null,
          notification_12h_sent: false
        });
      }
    }

    if (conflicts.length > 0) {
      return { success: false, errors: conflicts };
    }

    const actionSequence = nextAppointmentActionSequence();
    const persistenceResult = await dataService.createAppointments(
      newItems,
      `${pid}:${sess.date}:${sess.time}:${numSessions}`,
    );
    if (!persistenceResult?.success || !Array.isArray(persistenceResult?.appointments)) {
      return {
        success: false,
        errors: [persistenceResult?.error || 'Não foi possível confirmar o agendamento no banco.'],
      };
    }

    const persistedAppointments = mergeAppointmentIdentityFallbacks(persistenceResult.appointments, newItems);
    const enrichedPersistenceResult = {
      ...persistenceResult,
      appointments: persistedAppointments,
      items: persistedAppointments,
    };
    const applied = applyAppointmentResultToAgenda(
      enrichedPersistenceResult,
      { action: 'created', items: newItems },
      actionSequence,
    );
    if (!applied.ok) {
      return {
        success: false,
        errors: ['Registro salvo, mas a tela não atualizou automaticamente. Recarregue ou tente novamente.'],
      };
    }

    onAddActivityLog("Agendamento de Sessão", `${numSessions} sessões agendadas para "${sess.patientName}" começando em ${sess.date}.`, 'management');
    return { success: true, appointments: persistedAppointments };
  };

  const handleMoodCheckin = async (l: number | null, n: string, i: string, t: any) => {
    const identity = resolvePatientIdentityForPortal();
    const userType = String(user?.type || '').toLowerCase();
    const isConventionalAdult = userType === 'conventional' || userType === 'adult_conventional';
    const normalizedEnergy = typeof l === 'number' && Number.isFinite(l) ? l : null;
    const persistedEnergy = isConventionalAdult ? null : normalizedEnergy;
    const item = {
      id: Date.now(),
      patientId: identity.patientId || user.id,
      type: 'checkin',
      title: "Check-in",
      time: new Date().toLocaleTimeString(),
      energy: persistedEnergy,
      note: n,
      icon: i,
      dateGroup: "Hoje",
      tag: t
    };
    setHistory(prev => [item, ...prev]);
    try {
      await dataService.addHistoryItem({
        patient_id: String(identity.patientId || user.id),
        patient_email: identity.patientEmail,
        patient_name: identity.patientName,
        type: 'checkin',
        title: 'Check-in',
        energy: persistedEnergy,
        note: n,
        icon: i
      });
      await dataService.addPatientLog({
        patient_id: String(identity.patientId || user.id),
        professional_id: identity.professionalId || user?.professional_id || user?.therapist_id || null,
        type: 'mood',
        value: {
          score: normalizedEnergy,
          energy: persistedEnergy,
          note: n,
          icon: i,
          tag: t?.label || t?.id || null
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Falha ao persistir check-in do paciente:', error);
    }
  };
  const handleCompleteTask = async (t: any, e: number | null, n: string) => { 
    const identity = resolvePatientIdentityForPortal(t);
    const targetPatientId = String(identity.patientId || t?.patientId || t?.patient_id || user?.id || '').trim();
    const time = new Date().toLocaleTimeString();
    const isKid = user.age <= 12;
    const userType = String(user?.type || '').toLowerCase();
    const isConventionalAdult = (userType === 'conventional' || userType === 'adult_conventional') && !isKid;
    const normalizedEffort = typeof e === 'number' && Number.isFinite(e) ? e : null;
    const energyValue = isKid
      ? ((normalizedEffort ?? 0) / (t.maxScore || 1) * 100)
      : normalizedEffort;
    const newHistoryItem = { 
      id: Date.now(), 
      patientId: targetPatientId, 
      type: t.type || 'task', 
      title: t.title, 
      time, 
      energy: energyValue,
      score: isKid ? normalizedEffort : undefined,
      note: n, 
      icon: t.icon, 
      dateGroup: "Hoje",
      isDailyReminder: t.isDailyReminder,
      linkedTask: t.linkedTask,
      protocol_id: t.protocol_id || t.protocolId || null,
      protocolId: t.protocolId || t.protocol_id || null,
      protocolTitle: t.protocolTitle || t.protocol_name || null,
      protocol_name: t.protocol_name || t.protocolTitle || null,
      domainName: t.domainName || t.domain_name || null
    };
    setTasks(prev => prev.map(x => {
      const matchesAssignedTask =
        String(x?.assignedTaskId || '') === String(t?.assignedTaskId || '') ||
        String(x?.id || '') === String(t?.id || '') ||
        String(x?.id || '') === `assigned-${String(t?.assignedTaskId || '')}`;
      return matchesAssignedTask
        ? {
            ...x,
            completed: true,
            status: 'completed',
            patient_effort: energyValue,
            energy: energyValue,
            patient_comment: n || '',
            completed_at: new Date().toISOString()
          }
        : x;
    })); 
    
    if (isKid) {
      const noteText = `TAREFA CONCLUÍDA PELO PACIENTE\nAtividade: ${t.title}\n${
        typeof normalizedEffort === 'number' && Number.isFinite(normalizedEffort) ? `Pontuação: ${normalizedEffort}\n` : ''
      }Anotações do Paciente: ${n || "Nenhuma observação."}`;
      handleAddNote(targetPatientId, noteText, 'private', 'Evolução');
    }

    // Sync to Backend
    const { dataService } = await import('./services/dataService');
    const assignedTaskId = String(t?.assignedTaskId || '');
    const isTaskIdUuid = isUuidLike(String(t?.id || ''));
    const completionTargetId = assignedTaskId || (isTaskIdUuid ? String(t.id) : '');
    if (completionTargetId) {
      try {
        const completionPayload: any = {
          patient_comment: n || ''
        };
        if (typeof normalizedEffort === 'number' && Number.isFinite(normalizedEffort)) {
          completionPayload.patient_effort = Math.max(0, Math.min(100, normalizedEffort));
        } else {
          completionPayload.patient_effort = null;
        }
        const completionResult = await dataService.completeAssignedTask(completionTargetId, completionPayload);
        const persistedHistory = completionResult?.historyEntry;
        setHistory(prev => {
          const duplicateKey = [
            String(targetPatientId || ''),
            String(t?.type || 'task'),
            String(t?.title || ''),
            String(n || ''),
            String(persistedHistory?.created_at || ''),
          ].join('|');

          const withoutDuplicates = prev.filter((item: any) => {
            const itemKey = [
              String(item?.patient_id || item?.patientId || ''),
              String(item?.type || ''),
              String(item?.title || ''),
              String(item?.note || ''),
              String(item?.created_at || ''),
            ].join('|');
            return itemKey !== duplicateKey;
          });

          if (persistedHistory?.id) {
            return [
              {
                ...persistedHistory,
                patientId: persistedHistory?.patient_id || targetPatientId,
                time: persistedHistory?.created_at
                  ? new Date(persistedHistory.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : time,
                dateGroup:
                  persistedHistory?.date_group ||
                  persistedHistory?.dateGroup ||
                  (persistedHistory?.created_at && new Date(persistedHistory.created_at).toDateString() === new Date().toDateString()
                    ? 'Hoje'
                    : persistedHistory?.created_at
                      ? new Date(persistedHistory.created_at).toLocaleDateString()
                      : 'Hoje')
              },
              ...withoutDuplicates
            ];
          }

          return [newHistoryItem, ...withoutDuplicates];
        });
      } catch (error) {
        console.error('Falha ao concluir assigned task (nÃ£o bloqueante):', error);
        setHistory(prev => [newHistoryItem, ...prev]);
      }
    } else {
      setHistory(prev => [newHistoryItem, ...prev]);
    }
  };
  const handleRecordTrial = async (pid: any, title: string, score: number, evalComment?: string, sessionMeta?: any) => {
    const targetPatient = allPatients.find(p => p.id === pid);
    const clinicalRecord = clinicalRecords.find(r => r.patientId === pid);
    const isKid = (targetPatient?.age !== undefined && targetPatient.age <= 12) || clinicalRecord?.anamnesisData?.formType === 'child';
    const sourcePei = Array.isArray(clinicalRecord?.pei)
      ? clinicalRecord.pei
      : Array.isArray(targetPatient?.pei)
        ? targetPatient.pei
        : [];
    const sessionTargetKey = String(sessionMeta?.targetId || sessionMeta?.target_id || '').trim();
    const sessionGoalKeys = [
      sessionTargetKey,
      sessionMeta?.goalId,
      sessionMeta?.goal_id,
      sessionMeta?.peiGoalId,
      sessionMeta?.pei_goal_id,
      sessionMeta?.skillId,
      sessionMeta?.skill_id,
      sessionMeta?.localTargetRef,
      sessionMeta?.local_target_ref
    ].map((value: any) => String(value ?? '').trim()).filter(Boolean);
    const peiGoalMatchesSession = (goal: any) => {
      const goalKeys = [
        goal?.target_id,
        goal?.targetId,
        goal?.aba_target_id,
        goal?.abaTargetId,
        goal?.id,
        goal?.goalId,
        goal?.goal_id,
        goal?.peiGoalId,
        goal?.pei_goal_id,
        goal?.skillId,
        goal?.skill_id,
        goal?.localTargetRef,
        goal?.local_target_ref
      ].map((value: any) => String(value ?? '').trim()).filter(Boolean);
      if (sessionGoalKeys.length > 0 && goalKeys.length > 0) {
        return goalKeys.some((key: string) => sessionGoalKeys.includes(key));
      }
      return String(goal?.name || '').trim() === String(title || '').trim();
    };
    const peiGoal = sourcePei.find((goal: any) => peiGoalMatchesSession(goal));
    
    // Find the skill to get its maxScore
    let skillMaxScore = Number(sessionMeta?.targetMaxScore || peiGoal?.maxScore || 1);
    let matchedProtocol: any = null;
    let matchedDomain: any = null;
    let matchedSkill: any = null;
    protocols.forEach((p: any) => {
      const domains = Array.isArray(p?.data) ? p.data : [];
      domains.forEach((domain: any) => {
        const skills = Array.isArray(domain?.skills) ? domain.skills : [];
        const skill = skills.find((s: any) =>
          s.name === title || sessionGoalKeys.includes(String(s?.id || '').trim())
        );
        if (skill) {
          matchedProtocol = p;
          matchedDomain = domain;
          matchedSkill = skill;
          skillMaxScore = skill.maxScore || skillMaxScore || 1;
        }
      });
    });

    // Normalize score for crianças if it's not already 0, 0.5 or 1
    let finalScore = score;
    if (isKid && skillMaxScore === 1 && ![0, 0.5, 1].includes(score)) {
      if (score >= 3) finalScore = 1;
      else if (score >= 1.5) finalScore = 0.5;
      else finalScore = 0;
    }

    const newId =
      globalThis.crypto?.randomUUID?.() ||
      `trial-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const recordedAt = new Date().toISOString();
    const sessionStartedAt = sessionMeta?.sessionStartedAt || recordedAt;
    const newHistoryItem = {
      id: newId,
      patientId: pid,
      type: 'task',
      title: title,
      time: new Date(recordedAt).toLocaleTimeString(),
      score: finalScore,
      evalComment: evalComment || "",
      dateGroup: "Hoje",
      icon: "🎯",
      sessionId: sessionMeta?.sessionId || null,
      sessionReferenceDate: sessionMeta?.sessionReferenceDate || sessionStartedAt.slice(0, 10),
      targetId: sessionTargetKey || null,
      target_id: sessionTargetKey || null,
      collection_type: sessionMeta?.collectionType || sessionMeta?.trialType || null,
      collectionType: sessionMeta?.collectionType || sessionMeta?.trialType || null,
      created_at: recordedAt
    };
    const previousHistory = Array.isArray(historyRef.current) ? historyRef.current : history;
    const updatedHistory = [newHistoryItem, ...previousHistory.filter((item: any) => String(item?.id || '') !== String(newId))];
    historyRef.current = updatedHistory;
    setHistory(updatedHistory);
    
    // Add a note about the trial
    const noteText = `🎯 NOVO REGISTRO\nAtividade: ${title}\nPontuação: ${finalScore}${evalComment ? `\nAnotações do Profissional: ${evalComment}` : ""}`;
    handleAddNote(pid, noteText, 'private', 'Sessão');

    onAddActivityLog("Registro de Avaliação", `Avaliação da habilidade "${title}" registrada para ${formatPatientLabel(targetPatient || { id: pid })}. Pontuação: ${score}.`);

    // Sync to Backend
    const { dataService } = await import('./services/dataService');
    let sourceHistoryId: any = newId;
    try {
      const historyResult = await dataService.addHistoryItem({
        patient_id: String(pid),
        patient_email: targetPatient?.email || null,
        type: 'task',
        title: title,
        score: finalScore,
        note: evalComment || "",
        icon: "🎯",
        collection_type: sessionMeta?.collectionType || sessionMeta?.trialType || null,
        collectionType: sessionMeta?.collectionType || sessionMeta?.trialType || null,
        created_at: recordedAt
      });
      sourceHistoryId = historyResult?.data?.id || newId;
    } catch (error) {
      console.error('Falha ao persistir registro de sessão:', error);
    }

    const maxScoreForAba = Number(sessionMeta?.targetMaxScore || peiGoal?.maxScore || matchedSkill?.maxScore || skillMaxScore || 1);
    const abaCorrect = typeof sessionMeta?.correct === 'boolean'
      ? sessionMeta.correct
      : finalScore >= maxScoreForAba;
    const abaPromptLevel = resolveAbaPromptLevel({
      promptLevelKey: sessionMeta?.promptLevelKey,
      promptLevelName: sessionMeta?.promptLevelName,
      score: finalScore,
      maxScore: maxScoreForAba,
      correct: abaCorrect,
      independent: sessionMeta?.independent
    });
    const legacyPromptAudit = {
      prompt_level_key: abaPromptLevel.key,
      prompt_level_name: abaPromptLevel.label
    };
    const abaPromptInfo = resolveTrialPromptInfo({
      promptTypeId: sessionMeta?.promptTypeId || sessionMeta?.prompt_type_id,
      promptTypeNameSnapshot: sessionMeta?.promptTypeNameSnapshot || sessionMeta?.prompt_type_name_snapshot,
      promptCategorySnapshot: sessionMeta?.promptCategorySnapshot || sessionMeta?.prompt_category_snapshot,
      promptIndependenceScoreSnapshot: sessionMeta?.promptIndependenceScoreSnapshot ?? sessionMeta?.prompt_independence_score_snapshot,
      promptIntrusivenessOrderSnapshot: sessionMeta?.promptIntrusivenessOrderSnapshot ?? sessionMeta?.prompt_intrusiveness_order_snapshot,
      promptLevelKey: sessionMeta?.promptLevelKey,
      promptLevelName: sessionMeta?.promptLevelName,
      score: finalScore,
      maxScore: maxScoreForAba,
      correct: abaCorrect,
      independent: sessionMeta?.independent
    });
    const promptSnapshot = buildAbaPromptSnapshot({
      ...sessionMeta,
      promptLevelKey: sessionMeta?.promptLevelKey,
      promptLevelName: sessionMeta?.promptLevelName,
      score: finalScore,
      maxScore: maxScoreForAba,
      correct: abaCorrect,
      independent: sessionMeta?.independent
    });
    const promptLevelKey = abaPromptInfo.key;
    const abaIndependent = typeof sessionMeta?.independent === 'boolean'
      ? abaCorrect && sessionMeta.independent && abaPromptInfo.isIndependent
      : abaCorrect && abaPromptInfo.isIndependent;
    const abaCollectionType = String(sessionMeta?.collectionType || 'dtt').toLowerCase();
    const abaTargetId = String(
      sessionTargetKey ||
        peiGoal?.target_id ||
        peiGoal?.targetId ||
        peiGoal?.aba_target_id ||
        peiGoal?.abaTargetId ||
        peiGoal?.id ||
        matchedSkill?.id ||
        title
    );
    const abaTrialId = String(sessionMeta?.trialId || sessionMeta?.trial_id || `trial-${newId}`);
    const abaMaintenanceScheduleId = String(
      sessionMeta?.maintenanceScheduleId ||
      sessionMeta?.maintenance_schedule_id ||
      sessionMeta?.scheduleId ||
      sessionMeta?.schedule_id ||
      sessionMeta?.activeMaintenanceProbe?.scheduleId ||
      ''
    ).trim();

    if (isAbaV2Enabled()) {
      try {
        await dataService.saveAbaTrial({
          id: abaTrialId,
          clinic_id: String(user?.activeWorkspaceId || user?.clinicId || '').trim() || undefined,
          clinicId: String(user?.activeWorkspaceId || user?.clinicId || '').trim() || undefined,
          patient_id: String(pid),
          patientId: String(pid),
          session_id: sessionMeta?.sessionId || null,
          sessionId: sessionMeta?.sessionId || null,
          target_id: abaTargetId,
          targetId: abaTargetId,
          target_name: title,
          program_id: sessionMeta?.programId || peiGoal?.programId || null,
          protocol_id: sessionMeta?.protocolId || peiGoal?.protocolId || matchedProtocol?.id || null,
          protocol_title: sessionMeta?.protocolTitle || peiGoal?.protocolTitle || matchedProtocol?.title || matchedProtocol?.name || null,
          domain_id: sessionMeta?.domainId || peiGoal?.domainId || matchedDomain?.id || null,
          domain_name: sessionMeta?.domainName || peiGoal?.domainName || matchedDomain?.name || matchedDomain?.title || null,
          collection_type: abaCollectionType,
          trialType: abaCollectionType,
          maintenance_schedule_id: abaMaintenanceScheduleId || undefined,
          maintenanceScheduleId: abaMaintenanceScheduleId || undefined,
          schedule_id: abaMaintenanceScheduleId || undefined,
          scheduleId: abaMaintenanceScheduleId || undefined,
          response_score: finalScore,
          score: finalScore,
          max_score: maxScoreForAba,
          correct: abaCorrect,
          isCorrect: abaCorrect,
          independent: abaIndependent,
          isIndependent: abaIndependent,
          prompt_level_key: promptLevelKey,
          promptLevel: promptLevelKey,
          promptLevelKey,
          prompt_level_name: abaPromptInfo.label,
          promptLevelName: abaPromptInfo.label,
          ...promptSnapshot,
          notes: evalComment || '',
          occurred_at: recordedAt,
          timestamp: recordedAt,
          therapist_id: user?.id || undefined,
          therapistId: user?.id || undefined,
          source: 'verto_web',
          source_history_id: String(sourceHistoryId || newId),
          raw_payload: {
            legacyScore: score,
            normalizedScore: finalScore,
            legacyPromptAudit,
            isKid,
            clinicId: String(user?.activeWorkspaceId || user?.clinicId || '').trim() || null,
            source: 'verto_web',
            sessionReferenceDate: sessionMeta?.sessionReferenceDate || null,
            clientTrialId: sessionMeta?.trialId || sessionMeta?.trial_id || null,
            promptLevelKey: abaPromptInfo.key,
            promptLevelName: abaPromptInfo.label,
            ...promptSnapshot,
            promptLevelSource: sessionMeta?.promptLevelSource || null,
            trialType: abaCollectionType,
            maintenanceScheduleId: abaMaintenanceScheduleId || null,
            maintenance_schedule_id: abaMaintenanceScheduleId || null,
            activeMaintenanceProbe: sessionMeta?.activeMaintenanceProbe || null,
            peiGoalId: peiGoal?.peiGoalId || peiGoal?.pei_goal_id || peiGoal?.goalId || peiGoal?.goal_id || peiGoal?.id || null,
            goalId: peiGoal?.goalId || peiGoal?.goal_id || peiGoal?.peiGoalId || peiGoal?.pei_goal_id || peiGoal?.id || null,
            skillId: peiGoal?.skillId || peiGoal?.skill_id || matchedSkill?.id || null,
            localTargetRef: peiGoal?.localTargetRef || peiGoal?.local_target_ref || peiGoal?.id || null,
            therapistId: user?.id || null
          }
        });
      } catch (error) {
        console.error('Falha ao persistir tentativa ABA estruturada:', error);
      }
    }

    let updatedPei = sourcePei;

    if (isKid && sourcePei.length > 0 && abaCollectionType !== 'maintenance_probe') {
      const progressResetMarker = getPeiProgressResetMarker(peiGoal);
      const historyProgressMarker = getPeiHistoryProgressMarker;
      const skillHistory = updatedHistory
        .filter((h: any) =>
          String(h.patientId ?? h.patient_id ?? '') === String(pid) &&
          h.title === title &&
          h.type === 'task' &&
          String(h.collection_type || h.collectionType || h.trialType || '').toLowerCase() !== 'maintenance_probe' &&
          (!peiGoal || historyProgressMarker(h) > progressResetMarker)
        )
        .sort((a: any, b: any) => historyProgressMarker(b) - historyProgressMarker(a));

      let consecutiveCount = 0;
      for (const h of skillHistory) {
        if (h.score === 1) consecutiveCount += 1;
        else break;
      }

      let appliedMasteryTarget = 0;
      updatedPei = sourcePei.map((goal: any) => {
        if (!peiGoalMatchesSession(goal)) return goal;

        const embeddedCriterion = goal?.mastery_criteria && typeof goal.mastery_criteria === 'object'
          ? goal.mastery_criteria
          : goal?.masteryCriteria && typeof goal.masteryCriteria === 'object'
            ? goal.masteryCriteria
            : null;
        const masteryCriterion = normalizeAbaMasteryCriterion(embeddedCriterion) || normalizeAbaMasteryCriterion({
          type: 'consecutive_independent_correct_count',
          mastery_criterion_mode: 'consecutive_independent',
          required_consecutive_independent_correct_trials: goal?.meta_sucessos ?? goal?.metaSucessos ?? goal?.masteryTarget ?? goal?.mastery_target,
          requires_consecutive_successes: true,
          is_active: true
        });
        const configuredMasteryTarget =
          masteryCriterion?.requiredConsecutiveIndependentCorrectTrials ||
          masteryCriterion?.requiredIndependentCorrectTrials ||
          masteryCriterion?.requiredCorrectTrials ||
          null;
        if (!Number.isFinite(Number(configuredMasteryTarget)) || Number(configuredMasteryTarget) <= 0) {
          return goal.status === 'not_started' ? { ...goal, status: 'in_progress' } : goal;
        }

        const masteryTarget = Math.max(1, Math.floor(Number(configuredMasteryTarget)));
        appliedMasteryTarget = masteryTarget;
        const requiresConsecutive = Boolean(masteryCriterion?.requiredConsecutiveIndependentCorrectTrials || masteryCriterion?.requiresConsecutiveSuccesses);
        const totalIndependentCount = skillHistory.filter((h: any) => h.score === 1).length;
        const progressCount = requiresConsecutive ? consecutiveCount : totalIndependentCount;
        const progress = Math.min(Math.round((progressCount / masteryTarget) * 100), 100);
        const isMastered = progress >= 100;

        return {
          ...goal,
          status: isMastered ? 'completed' : 'in_progress',
          clinicalStatus: isMastered ? 'completed' : goal?.clinicalStatus,
          clinical_status: isMastered ? 'completed' : goal?.clinical_status,
          masteryStatus: isMastered ? 'READY_FOR_MAINTENANCE' : goal?.masteryStatus,
          mastery_status: isMastered ? 'READY_FOR_MAINTENANCE' : goal?.mastery_status,
          progress,
          progressPercent: progress,
          progress_percent: progress,
          masteryProgressPercent: progress,
          mastery_progress_percent: progress,
          criterionProgressCount: progressCount,
          criterion_progress_count: progressCount,
          criterionRequiredCount: masteryTarget,
          criterion_required_count: masteryTarget
        };
      });
      const updatedGoal = updatedPei.find((goal: any) => peiGoalMatchesSession(goal));
      const isMastered = updatedGoal?.status === 'completed';
      const criterionProgressCount = Number(updatedGoal?.criterionProgressCount ?? updatedGoal?.criterion_progress_count ?? consecutiveCount);
      const criterionRequiredCount = Number(updatedGoal?.criterionRequiredCount ?? updatedGoal?.criterion_required_count ?? appliedMasteryTarget);

      if (isAbaV2Enabled() && appliedMasteryTarget > 0) {
        try {
          await dataService.saveAbaMasteryEvaluation({
            id: `mastery-${newId}`,
            patient_id: String(pid),
            session_id: sessionMeta?.sessionId || null,
            target_id: abaTargetId,
            target_name: title,
            evaluation_status: isMastered ? 'mastered' : 'not_met',
            status: isMastered ? 'MASTERED' : 'NOT_MET',
            statusCode: isMastered ? 'MASTERED' : 'NOT_MET',
            suggested_phase: isMastered ? 'mastered' : 'teaching',
            accuracy_percent: abaCorrect ? 100 : 0,
            consecutive_successes: criterionProgressCount,
            min_consecutive_successes: appliedMasteryTarget,
            criterion_progress_count: criterionProgressCount,
            criterionProgressCount: criterionProgressCount,
            criterion_required_count: criterionRequiredCount,
            criterionRequiredCount: criterionRequiredCount,
            criterion_progress_label: `${criterionProgressCount}/${criterionRequiredCount}`,
            criterionProgressLabel: `${criterionProgressCount}/${criterionRequiredCount}`,
            trials_considered: skillHistory.length,
            distinct_therapists_count: 1,
            first_trial_independent: abaIndependent,
            criteria: {
              source: 'skill',
              sourceLabel: 'Criterio da habilidade',
              type: 'consecutive_independent_correct_count',
              masteryCriterionMode: 'consecutive_independent',
              mastery_criterion_mode: 'consecutive_independent',
              requiredConsecutiveIndependentCorrectTrials: appliedMasteryTarget,
              required_consecutive_independent_correct_trials: appliedMasteryTarget,
              requiresConsecutiveSuccesses: true,
              requires_consecutive_successes: true,
              minTrialsPerSession: appliedMasteryTarget,
              min_trials_per_session: appliedMasteryTarget,
              collectionType: abaCollectionType
            },
            reasons: isMastered
              ? ['Criterio de sucessos independentes consecutivos atingido.']
              : [`${consecutiveCount}/${appliedMasteryTarget} sucessos independentes consecutivos.`],
            evaluated_at: recordedAt,
            source_trial_id: abaTrialId,
            raw_payload: {
              legacyHistoryId: String(sourceHistoryId || newId),
              previousStatus: peiGoal?.status || null,
              progress: updatedGoal?.progress ?? null,
              peiGoalId: peiGoal?.peiGoalId || peiGoal?.pei_goal_id || peiGoal?.goalId || peiGoal?.goal_id || peiGoal?.id || null,
              goalId: peiGoal?.goalId || peiGoal?.goal_id || peiGoal?.peiGoalId || peiGoal?.pei_goal_id || peiGoal?.id || null,
              skillId: peiGoal?.skillId || peiGoal?.skill_id || matchedSkill?.id || null,
              localTargetRef: peiGoal?.localTargetRef || peiGoal?.local_target_ref || peiGoal?.id || null
            }
          });
        } catch (error) {
          console.error('Falha ao persistir avaliação de maestria ABA:', error);
        }
      }

      if (isMastered && peiGoal?.status !== 'completed') {
        handleAddNote(
          pid,
          `CRITERIO DE MAESTRIA ATINGIDO!\nA habilidade "${title}" atingiu a meta individual de sucessos independentes consecutivos. Status atualizado para Adquirida.`,
          'private',
          'Maestria'
        );
      }
    } else if (!isKid && sourcePei.length > 0) {
      updatedPei = sourcePei.map((goal: any) =>
        goal.name === title && goal.status === 'not_started' ? { ...goal, status: 'in_progress' } : goal
      );
    }

    if (Array.isArray(updatedPei) && updatedPei !== sourcePei) {
      setAllPatients((allPrev: any[]) =>
        allPrev.map((p: any) => (p.id === pid ? { ...p, pei: updatedPei } : p))
      );
      setClinicalRecords((prev: any[]) =>
        prev.map((r: any) => (r.patientId === pid ? { ...r, pei: updatedPei } : r))
      );

      try {
        await dataService.savePatientRecord(String(pid), {
          workspace_id: String(user?.activeWorkspaceId || user?.clinicId || '').trim() || null,
          diagnosis: clinicalRecord?.diagnosis || targetPatient?.diagnosis || '',
          anamnese: clinicalRecord?.anamnesisData || targetPatient?.anamnesisData || {},
          pei: updatedPei,
          evaluationLinks:
            clinicalRecord?.evaluationLinks && typeof clinicalRecord.evaluationLinks === 'object'
              ? clinicalRecord.evaluationLinks
              : {},
          interventionTaskLinks:
            clinicalRecord?.interventionTaskLinks && typeof clinicalRecord.interventionTaskLinks === 'object'
              ? clinicalRecord.interventionTaskLinks
              : {}
        });
      } catch (error) {
        console.error('Falha ao persistir atualizaÃ§Ã£o de PEI no prontuÃ¡rio:', error);
      }
    }

    return newId;
  };

  const handleDeleteHistoryItem = async (id: any) => {
    const item = history.find(h => h.id === id);
    setHistory(prev => prev.filter(h => h.id !== id));
    onAddActivityLog("ExclusÃ£o de Registro", `Registro de atividade "${safeDisplayValue(item?.title, 'selecionado')}" excluÃ­do do histÃ³rico.`, 'system');
    try {
      await dataService.deleteHistoryItem(String(id));
    } catch (error) {
      console.error('Falha ao excluir histÃ³rico no servidor:', error);
    }
  };
  
  useEffect(() => {
    (window as any).handleToggleNoteTypeApp = async (id: any, targetVisibility: string) => {
      try {
      const isUuid = (value: any) =>
        typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

      const normalizedTarget =
        targetVisibility === 'shared' || targetVisibility === 'patient' || targetVisibility === 'shared_patient'
          ? 'shared_patient'
          : 'shared_clinic';
      const copyKey = normalizedTarget === 'shared_patient' ? 'hasSharedCopy' : 'hasProfessionalCopy';
      const targetLabel = normalizedTarget === 'shared_patient' ? 'paciente' : 'profissionais';
      const notesSnapshot = Array.isArray(therapistNotes) ? [...therapistNotes] : [];
      const note = notesSnapshot.find((n: any) => n.id === id);
      if (!note) return;

      const patientId = String(note?.patientId || note?.patient_id || '').trim();
      if (!patientId) {
        console.warn('[notes-share] patientId ausente para nota', { noteId: id });
        return;
      }

      const patient = allPatients.find((p: any) => String(p.id) === patientId);
      const originalPatientName = formatPatientLabel(patient || { id: patientId });
      const { dataService } = await import('./services/dataService');

      // Removing a copy directly
      const isCopy = Boolean(note?.originalId || note?.original_id);
      const noteVisibility = String(note?.visibility || '').toLowerCase();
      const noteType = String(note?.type || '').toLowerCase();
      if (
        isCopy &&
        (
          noteVisibility === normalizedTarget ||
          noteType === normalizedTarget ||
          (normalizedTarget === 'shared_patient' && (noteVisibility === 'patient' || noteVisibility === 'shared' || noteType === 'shared' || noteType === 'patient')) ||
          (normalizedTarget === 'shared_clinic' && (noteVisibility === 'professional' || noteType === 'professional'))
        )
      ) {
        setTherapistNotes((prev: any[]) =>
          normalizeAndDecorateNotes(
            prev
              .filter((n: any) => n.id !== id)
              .map((n: any) =>
                String(n.id) === String(note.originalId || note.original_id)
                  ? { ...n, [copyKey]: false }
                  : n,
              ),
          ),
        );
        if (isUuid(String(note.id))) {
          const delResult = await dataService.deleteNote(String(note.id));
          if (!delResult?.success) {
            console.warn('[notes-share] falha ao remover cÃ³pia:', delResult);
          }
        }
        onAddActivityLog(
          'RemoÃ§Ã£o de compartilhamento de anotaÃ§Ã£o',
          `CÃ³pia de anotaÃ§Ã£o removida da visibilidade ${targetLabel} no prontuÃ¡rio de ${originalPatientName}.`,
          'clinical',
        );
        return;
      }

      // Toggle off from original note
      const existingCopy = notesSnapshot.find(
        (n: any) =>
          String(n?.originalId || n?.original_id || '') === String(id) &&
          (
            String(n?.visibility || '').toLowerCase() === normalizedTarget ||
            String(n?.type || '').toLowerCase() === normalizedTarget ||
            (normalizedTarget === 'shared_patient' &&
              (
                String(n?.visibility || '').toLowerCase() === 'patient' ||
                String(n?.visibility || '').toLowerCase() === 'shared' ||
                String(n?.type || '').toLowerCase() === 'patient' ||
                String(n?.type || '').toLowerCase() === 'shared'
              )) ||
            (normalizedTarget === 'shared_clinic' &&
              (
                String(n?.visibility || '').toLowerCase() === 'professional' ||
                String(n?.type || '').toLowerCase() === 'professional'
              ))
          ),
      );
      if (existingCopy) {
        setTherapistNotes((prev: any[]) =>
          normalizeAndDecorateNotes(
            prev
              .filter((n: any) => n.id !== existingCopy.id)
              .map((n: any) => (n.id === id ? { ...n, [copyKey]: false } : n)),
          ),
        );
        if (isUuid(String(existingCopy.id))) {
          const delResult = await dataService.deleteNote(String(existingCopy.id));
          if (!delResult?.success) {
            console.warn('[notes-share] falha ao remover compartilhamento:', delResult);
          }
        }
        onAddActivityLog(
          'RemoÃ§Ã£o de compartilhamento de anotaÃ§Ã£o',
          `CÃ³pia de anotaÃ§Ã£o removida da visibilidade ${targetLabel} no prontuÃ¡rio de ${originalPatientName}.`,
          'clinical',
        );
        return;
      }

      // Toggle on: create persisted copy
      const newCopyId = crypto.randomUUID();
      const newCopy = {
        ...note,
        id: newCopyId,
        patientId,
        visibility: normalizedTarget,
        type: normalizedTarget === 'shared_clinic' ? 'professional' : 'shared',
        originalId: String(id),
        hasSharedCopy: false,
        hasProfessionalCopy: false,
      };

      setTherapistNotes((prev: any[]) =>
        normalizeAndDecorateNotes(prev.map((n: any) => (n.id === id ? { ...n, [copyKey]: true } : n)).concat(newCopy)),
      );

      const result = await dataService.addNote({
        id: newCopyId,
        patient_id: patientId,
        patient_name: patient?.name || null,
        patient_email: patient?.email || note?.patient_email || null,
        text: note.text,
        visibility: normalizedTarget,
        type: normalizedTarget === 'shared_clinic' ? 'professional' : 'shared',
        subject: note.subject || 'Geral',
        original_id: String(id),
      });

      if (result?.success && result?.data?.id) {
        setTherapistNotes((current: any[]) =>
          normalizeAndDecorateNotes(current.map((n: any) => (n.id === newCopyId ? { ...n, id: result.data.id } : n))),
        );
      } else if (result?.success === false && !(result?.offline && result?.pending)) {
        console.warn('[notes-share] falha ao salvar compartilhamento:', result);
        setTherapistNotes((prev: any[]) =>
          normalizeAndDecorateNotes(
            prev
              .filter((n: any) => n.id !== newCopyId)
              .map((n: any) => (n.id === id ? { ...n, [copyKey]: false } : n)),
          ),
        );
        alert(String(result?.error || 'Não foi possível persistir o compartilhamento da anotação.'));
        return;
      }

      await dataService.saveActivityLog({
        title: 'Compartilhamento de anotaÃ§Ã£o',
        details: `AnotaÃ§Ã£o compartilhada com ${targetLabel} no prontuÃ¡rio de ${originalPatientName}.`,
        category: 'clinical',
      });
      onAddActivityLog(
        'Compartilhamento de anotaÃ§Ã£o',
        `AnotaÃ§Ã£o compartilhada com ${targetLabel} no prontuÃ¡rio de ${originalPatientName}.`,
        'clinical',
      );
      } catch (error) {
        console.error('[notes-share] erro inesperado ao alternar compartilhamento:', error);
        alert('Falha ao compartilhar anotaÃ§Ã£o. Tente novamente.');
      }
    };
  }, [allPatients, therapistNotes]);

  const handleAddFamilyNote = async (
    pid: any,
    txt: string,
    image?: string,
    imagePath?: string,
    entryKind: 'diary' | 'note' = 'diary'
  ) => {
    const identity = resolvePatientIdentityForPortal({ patientId: pid });
    const targetPatientId = String(identity.patientId || pid || user?.id || '').trim();
    const recordId = createAppointmentId();
    const createdAt = new Date().toISOString();
    const isPhotoRecord = Boolean(image);
    const isSimpleNote = entryKind === 'note';
    // Evita duplicidade: família persiste via histórico clínico (fonte única de verdade).
    
    const newHistoryItem = {
      id: recordId,
      patientId: targetPatientId,
      patient_id: targetPatientId,
      patient_email: identity.patientEmail,
      type: isPhotoRecord ? 'photo' : 'family_note',
      title: isPhotoRecord ? "Foto enviada" : isSimpleNote ? "Anotação da Família" : "Registro da Família",
      score: 0,
      time: new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      note: txt,
      image: image,
      image_path: imagePath || null,
      icon: isPhotoRecord ? "📷" : isSimpleNote ? "📝" : "🏠",
      dateGroup: "Hoje",
      date: createdAt,
      created_at: createdAt,
      source: isSimpleNote ? 'family_portal_note' : 'family_portal'
    };

    // Also add to history timeline
    setHistory(prev => [newHistoryItem, ...prev.filter((item: any) => String(item.id) !== recordId)]);

    onAddActivityLog(
      isSimpleNote ? "Anotação da Família" : "Registro da Família",
      `Nova anotação da família adicionada para ${formatPatientLabel({ name: identity.patientName, id: targetPatientId })}.`
    );

    // Sync to Backend
    const { dataService } = await import('./services/dataService');
    const historySaveResult = await dataService.addHistoryItem({
      id: recordId,
      patient_id: targetPatientId,
      patient_email: identity.patientEmail,
      patient_name: identity.patientName,
      type: isPhotoRecord ? 'photo' : 'family_note',
      title: isPhotoRecord ? "Foto enviada" : isSimpleNote ? "Anotação da Família" : "Registro da Família",
      score: 0,
      note: txt,
      image: image,
      image_path: imagePath || null,
      icon: isPhotoRecord ? "📷" : isSimpleNote ? "📝" : "🏠",
      created_at: createdAt,
      date_group: createdAt.slice(0, 10),
      source: isSimpleNote ? 'family_portal_note' : 'family_portal'
    });

    if (!historySaveResult?.success) {
      console.warn('[family-note] Falha ao persistir histórico da família:', historySaveResult);
      setHistory(prev => prev.filter((item: any) => item.id !== newHistoryItem.id));
      return { success: false, error: historySaveResult?.error || 'Falha ao persistir histórico da família.' };
    } else if (historySaveResult?.data?.id) {
      const persistedPatientId = String(historySaveResult.data.patient_id || historySaveResult.data.patientId || '').trim();
      if (persistedPatientId) {
        setResolvedPatientPortalId(persistedPatientId);
      }
      setHistory(prev =>
        prev.map((item: any) =>
          item.id === newHistoryItem.id
            ? {
                ...item,
                ...historySaveResult.data,
                patientId: historySaveResult.data.patient_id || item.patientId,
                date: historySaveResult.data.created_at || item.date,
                image: historySaveResult.data.image || item.image,
                image_path: historySaveResult.data.image_path || item.image_path || null
              }
            : item
        )
      );
    }
    return { success: true, data: historySaveResult?.data || newHistoryItem };
  };

  const handleLogout = async () => {
    manualLogoutInProgressRef.current = true;
    const signingOutUserId = String(user?.id || '').trim();
    try {
      await onAddActivityLog("Logout do Sistema", "O profissional encerrou a sessÃ£o com seguranÃ§a.", "system");
      await Promise.race([
        syncOfflineData(),
        new Promise((resolve) => setTimeout(resolve, 2500))
      ]);

      const supabase = await getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      await fetch('/api/auth/logout', { 
        method: 'POST', 
        credentials: 'include',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        }
      });
      if (supabase) await supabase.auth.signOut({ scope: 'local' } as any);
    } catch (error) {
      console.error('Logout error:', error);
    }
    try {
      await clearSensitiveOfflineCacheForUser(signingOutUserId);
      Object.keys(window.localStorage)
        .filter((key) =>
          key.startsWith('verto.patient-dashboard-chart-filters:') ||
          key.startsWith('kids_star_seen_total:')
        )
        .forEach((key) => window.localStorage.removeItem(key));
    } catch (error) {
      console.warn('Sensitive patient cache cleanup failed:', error);
    }
    setLastActiveWorkspaceId(null);
    resetWorkspaceScopedState();
    setClinicStateHydrated(false);
    setResolvedPatientPortalId('');
    setPatientContextLoaded(false);
    setHistory([]);
    historyRef.current = [];
    setTasks([]);
    setTherapistNotes([]);
    setProtocols([]);
    setProfilePicture(null);
    setUser(null);
    setShowWorkspacePicker(false);
    window.setTimeout(() => {
      manualLogoutInProgressRef.current = false;
    }, 1200);
  };

  useEffect(() => {
    if (!user) {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      autoLogoutInProgressRef.current = false;
      return;
    }

    const resetInactivityTimer = () => {
      if (autoLogoutInProgressRef.current) return;
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
      inactivityTimerRef.current = setTimeout(async () => {
        if (autoLogoutInProgressRef.current) return;
        autoLogoutInProgressRef.current = true;
        await handleLogout();
        setShowWorkspacePicker(false);
      }, AUTO_LOGOUT_IDLE_MS);
    };

    const interactionEvents: Array<keyof WindowEventMap> = ['mousemove', 'keydown', 'click'];
    interactionEvents.forEach((eventName) => {
      window.addEventListener(eventName, resetInactivityTimer, { passive: true });
    });

    resetInactivityTimer();

    return () => {
      interactionEvents.forEach((eventName) => {
        window.removeEventListener(eventName, resetInactivityTimer);
      });
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleWorkspaceSelect = async (clinicId: string) => {
    const result = await dataService.selectWorkspace(clinicId);
    if (result.success && result.user) {
      const alignedUser = alignWorkspaceFromStorage(result.user);
      setClinicStateHydrated(false);
      resetWorkspaceScopedState();
      setUser(alignedUser);
      setLastActiveWorkspaceId(alignedUser?.activeWorkspaceId || alignedUser?.clinicId || clinicId);
      setShowWorkspacePicker(computeWorkspacePickerVisibility(alignedUser));
      return;
    }
    alert(result.error || 'Nao foi possivel selecionar este workspace.');
  };

  const handleAppointmentConfirmationChoice = async (status: 'confirmed' | 'reschedule' | 'canceled') => {
    if (!appointmentConfirmation?.appointmentId) return;
    const normalizeConfirmationResultStatus = (value: any) => {
      const normalized = String(value || '').toLowerCase();
      if (normalized.includes('confirm')) return 'confirmed';
      if (normalized.includes('reschedule') || normalized.includes('remarc')) return 'reschedule';
      if (normalized.includes('cancel')) return 'canceled';
      return normalized || status;
    };
    const feedback =
      status === 'reschedule'
        ? 'Solicitação de remarcação registrada. A recepção entrará em contato.'
        : status === 'confirmed'
          ? 'Presença confirmada com sucesso.'
          : 'Solicitação de cancelamento registrada. A recepção entrará em contato.';

    setAppointmentConfirmation((prev) => prev ? { ...prev, isUpdating: true, hasError: false, message: '' } : prev);
    try {
      const result =
        status === 'confirmed'
          ? await dataService.confirmPortalAppointment(appointmentConfirmation.appointmentId)
          : status === 'reschedule'
            ? await dataService.requestPortalAppointmentReschedule(appointmentConfirmation.appointmentId, { note: 'Solicitado pelo lembrete dentro do app.' })
            : await dataService.requestPortalAppointmentCancel(appointmentConfirmation.appointmentId, { note: 'Solicitado pelo lembrete dentro do app.' });
      if (!result?.success) {
        throw new Error(result?.error || 'Não foi possível atualizar a consulta.');
      }
      const resultAppointment = result?.item || result?.appointment || null;
      const serverStatus = normalizeConfirmationResultStatus(
        resultAppointment?.patientConfirmationStatus ||
          resultAppointment?.patient_confirmation_status ||
          resultAppointment?.status ||
          status,
      );
      setTherapistAgenda(prev =>
        prev.map(item =>
          String(item.id) === String(appointmentConfirmation.appointmentId)
            ? { ...item, ...(resultAppointment || {}), status: serverStatus }
            : item
        )
      );
      window.dispatchEvent(new CustomEvent('verto:appointment-domain-event', {
        detail: {
          appointmentId: appointmentConfirmation.appointmentId,
          status: serverStatus,
          action: status,
        },
      }));
      const alreadyAnsweredMessage = result?.alreadyAnswered
        ? serverStatus === 'confirmed'
          ? 'Essa presença já estava confirmada.'
          : serverStatus === 'reschedule'
            ? 'Essa consulta já estava marcada para remarcação.'
            : serverStatus === 'canceled'
              ? 'Esse agendamento já estava cancelado.'
              : 'Essa consulta já tinha uma resposta registrada.'
        : feedback;
      setAppointmentConfirmation((prev) => prev ? {
        ...prev,
        scheduledAt: String(resultAppointment?.scheduledAt || resultAppointment?.scheduled_at || prev.scheduledAt || '').trim(),
        clinicName: String(resultAppointment?.clinic?.displayName || resultAppointment?.clinicName || prev.clinicName || '').trim(),
        clinicLogoUrl: String(resultAppointment?.clinic?.logoUrl || resultAppointment?.clinicLogoUrl || prev.clinicLogoUrl || '').trim(),
        clinicPrimaryColor: String(resultAppointment?.clinic?.primaryColor || resultAppointment?.clinicPrimaryColor || prev.clinicPrimaryColor || '').trim(),
        patientName: String(resultAppointment?.patient?.name || resultAppointment?.patientName || prev.patientName || '').trim(),
        professionalName: String(resultAppointment?.professionalName || prev.professionalName || '').trim(),
        professionalLogoUrl: String(resultAppointment?.professionalLogoUrl || resultAppointment?.professionalAvatarUrl || prev.professionalLogoUrl || '').trim(),
        professionalRole: String(resultAppointment?.professionalRole || prev.professionalRole || '').trim(),
        status: serverStatus,
        isUpdating: false,
        hasError: false,
        message: alreadyAnsweredMessage
      } : prev);
      window.history.replaceState({}, document.title, window.location.pathname);
      window.setTimeout(() => setAppointmentConfirmation(null), 1800);
    } catch (error: any) {
      const friendlyMessage =
        getFriendlyAppointmentLoadMessage(error?.message) ||
        'Não foi possível registrar sua resposta agora. Abra o app com o acesso do paciente e tente novamente.';
      setAppointmentConfirmation((prev) =>
        prev
          ? {
              ...prev,
              isUpdating: false,
              hasError: true,
              message: friendlyMessage,
            }
          : prev,
      );
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#7a32fc]"></div>
      </div>
    );
  }

  const lazyFallback = (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#7a32fc]"></div>
    </div>
  );
  const userNeedsPatientActivation =
    user?.role === 'patient' &&
    user?.portalVerified !== true &&
    user?.accountState !== 'PORTAL_VERIFIED' &&
    (user?.activationRequired === true || user?.firstLoginCompleted === false);
  const activeWorkspaceForDemo = Array.isArray(user?.workspaces)
    ? user.workspaces.find((workspace: any) => String(workspace?.clinicId || '') === String(user?.activeWorkspaceId || user?.clinicId || ''))
    : null;
  const isDemoEnvironment = Boolean(
    user?.isDemoUser ||
    user?.billingModel === 'demo' ||
    activeWorkspaceForDemo?.isDemo ||
    activeWorkspaceForDemo?.billingModel === 'demo'
  );
  const rawDemoExpiresAt = String(user?.demoExpiresAt || activeWorkspaceForDemo?.demoExpiresAt || '').trim();
  const activeDemoKind = String(user?.demoKind || activeWorkspaceForDemo?.demoKind || '').trim().toLowerCase();
  const demoExpirationLabel = rawDemoExpiresAt && !Number.isNaN(new Date(rawDemoExpiresAt).getTime())
    ? new Date(rawDemoExpiresAt).toLocaleDateString('pt-BR')
    : '';
  const demoEnvironmentMessage = activeDemoKind === 'playground'
    ? 'Use apenas dados ficticios. Este ambiente pode ser resetado.'
    : activeDemoKind === 'presentation'
      ? 'Demo de apresentacao.'
      : 'Dados ficticios para demonstracao.';
  const appointmentConfirmationViewModel = appointmentConfirmation ? buildAppointmentConfirmationViewModel() : null;

  return (
    <React.Fragment>
      <GlobalStyles />
      {appointmentConfirmation && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.24)]">
            <div className="border-b border-slate-100 bg-slate-50 p-6 text-slate-950">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-500 shadow-sm">
                  {appointmentConfirmationViewModel?.brandLogoUrl ? (
                    <>
                      <img
                        src={appointmentConfirmationViewModel.brandLogoUrl}
                        alt={`Logo de ${appointmentConfirmationViewModel.brandName}`}
                        className="h-full w-full object-contain p-1.5"
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                          const fallback = event.currentTarget.nextElementSibling as HTMLElement | null;
                          if (fallback) fallback.style.display = 'flex';
                        }}
                      />
                      <span className="hidden h-full w-full items-center justify-center bg-slate-100 text-sm font-black text-slate-700">
                        {appointmentConfirmationViewModel.initialsFallback}
                      </span>
                    </>
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-slate-100 text-sm font-black text-slate-700">
                      {appointmentConfirmationViewModel?.initialsFallback || getClinicInitials(appointmentConfirmation.clinicName)}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Lembrete de consulta</p>
                  <h2 className="truncate text-xl font-black tracking-tight">
                    {appointmentConfirmationViewModel?.brandName || 'Clínica'}
                  </h2>
                </div>
              </div>
              <p className="text-sm font-semibold text-slate-600">
                {appointmentConfirmationViewModel?.appointmentSummaryText || 'Como deseja responder à consulta agendada?'}
              </p>
              {appointmentConfirmation.status ? (
                <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                  Status: {getAppointmentConfirmationStatusLabel(appointmentConfirmation.status)}
                </p>
              ) : null}
            </div>
            <div className="space-y-3 p-5">
              {appointmentConfirmation.isLoading && !appointmentConfirmation.dateLabel && (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-500">
                  Carregando dados da consulta...
                </div>
              )}
              {appointmentConfirmation.message && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
                  {appointmentConfirmation.message}
                </div>
              )}
              {appointmentConfirmation.hasError && (
                <button
                  type="button"
                  disabled={appointmentConfirmation.isUpdating || appointmentConfirmation.isLoading}
                  onClick={() => {
                    setAppointmentConfirmation((prev) =>
                      prev ? { ...prev, isLoading: true, hasError: false, message: '' } : prev
                    );
                    setAppointmentConfirmationRetry((current) => current + 1);
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  <RefreshCw size={18} /> Tentar novamente
                </button>
              )}
              <button
                type="button"
                disabled={appointmentConfirmation.isUpdating || appointmentConfirmation.isLoading}
                onClick={() => void handleAppointmentConfirmationChoice('confirmed')}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-white shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-600 disabled:opacity-60"
              >
                <CheckCircle2 size={18} /> {appointmentConfirmationViewModel?.confirmLabel || 'Confirmar presença'}
              </button>
              <button
                type="button"
                disabled={appointmentConfirmation.isUpdating || appointmentConfirmation.isLoading}
                onClick={() => void handleAppointmentConfirmationChoice('reschedule')}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 px-4 py-3 text-sm font-black text-white shadow-lg shadow-amber-500/25 transition hover:bg-amber-600 disabled:opacity-60"
              >
                <AlertCircle size={18} /> {appointmentConfirmationViewModel?.rescheduleLabel || 'Remarcar consulta'}
              </button>
              <button
                type="button"
                disabled={appointmentConfirmation.isUpdating || appointmentConfirmation.isLoading}
                onClick={() => void handleAppointmentConfirmationChoice('canceled')}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-500 px-4 py-3 text-sm font-black text-white shadow-lg shadow-rose-500/25 transition hover:bg-rose-600 disabled:opacity-60"
              >
                {appointmentConfirmationViewModel?.cancelLabel || 'Cancelar agendamento'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showInstallPrompt && user && !isRunningStandalone() && (
        <div className="fixed inset-0 z-[9998] flex items-end justify-center bg-slate-950/45 px-4 pb-4 backdrop-blur-sm sm:items-center sm:pb-0">
          <div className="w-full max-w-md rounded-[28px] border border-white/70 bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#7a32fc]/10 text-[#7a32fc]">
                <LayoutDashboard size={24} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-black text-slate-900">Instalar Verto no celular?</p>
                <p className="mt-1 text-sm font-medium leading-6 text-slate-500">
                  Crie um atalho na tela inicial para abrir a Verto como aplicativo, sem precisar procurar pelo navegador.
                </p>
              </div>
            </div>

            {installPromptUnavailable ? (
              <div className="mt-4 rounded-2xl bg-violet-50 p-4 text-sm font-medium leading-6 text-slate-700">
                No iPhone/Safari, toque no botão de compartilhar do navegador e escolha <strong>Adicionar à Tela de Início</strong>.
              </div>
            ) : null}

            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={dismissInstallPrompt}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-500 transition hover:bg-slate-50"
              >
                Agora não
              </button>
              <button
                type="button"
                onClick={() => void handleInstallPwa()}
                className="rounded-2xl bg-[#7a32fc] px-4 py-3 text-sm font-black text-white shadow-lg shadow-purple-500/20 transition hover:opacity-90"
              >
                {installPromptUnavailable ? 'Entendi' : 'Instalar Verto'}
              </button>
            </div>
          </div>
        </div>
      )}
      {user && isDemoEnvironment && (
        <div className="pointer-events-none fixed bottom-3 left-3 z-[9997] max-w-[calc(100vw-24px)] rounded-lg border border-amber-200 bg-amber-50/95 px-3 py-2 text-left shadow-lg shadow-amber-900/10 backdrop-blur">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-700">Ambiente demo</p>
          <p className="text-xs font-semibold text-slate-700">
            {demoEnvironmentMessage}{demoExpirationLabel ? ` · expira em ${demoExpirationLabel}` : ''}
          </p>
        </div>
      )}
      <LazyImportBoundary fallback={lazyFallback}>
        <Suspense fallback={lazyFallback}>
        {isPortalRelationshipRoute ? (
          <PortalRelationshipConfirmation onLogin={handleLoginSuccess} />
        ) : !user || userNeedsPatientActivation ? (
          isAuthActionRoute || userNeedsPatientActivation ? (
            <ActivationAccess onLogin={handleLoginSuccess} />
          ) : (
            <LandingPage onLogin={handleLoginSuccess} setUser={setUser} />
          )
        ) : showWorkspacePicker && Array.isArray(user.workspaces) && user.workspaces.length > 1 ? (
          <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
            <div className="w-full max-w-2xl bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
              <h2 className="text-xl font-bold text-slate-900">Escolha o Workspace</h2>
              <p className="text-sm text-slate-500 mt-1">
                Seu usuÃ¡rio participa de mais de uma clÃ­nica. Selecione onde deseja trabalhar agora.
              </p>
              <div className="mt-6 space-y-3">
                {user.workspaces.map((workspace: any) => (
                  <button
                    key={workspace.clinicId}
                    onClick={() => handleWorkspaceSelect(workspace.clinicId)}
                    className="w-full text-left px-4 py-4 rounded-2xl border border-slate-200 hover:border-[#7a32fc] hover:bg-violet-50/40 transition"
                  >
                    <p className="text-sm font-bold text-slate-900">{workspace.clinicName}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Papel neste workspace: {workspace.role === 'coordinator' ? 'Coordenador' : workspace.role === 'therapist' ? 'Terapeuta' : 'Recepcionista'}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : ((user.role === 'therapist' || user.role === 'coordinator' || user.role === 'receptionist') && user.firstLoginCompleted === false) || showOnboarding ? (
          <ProfessionalOnboarding 
            user={user} 
            onComplete={(data) => {
              setUser((prev: any) => ({
                ...prev,
                ...data,
                clinicSettings: {
                  ...(prev?.clinicSettings || {}),
                  ...(data?.clinicSettings || {}),
                },
                firstLoginCompleted: true,
              }));
              setShowOnboarding(false);
            }}
            onClose={() => setShowOnboarding(false)}
          />
        ) : isProfessionalClinicRole(user.role) && !hasDashboardBillingAccess(user) ? (
          <SubscriptionRequired user={user} onLogout={handleLogout} />
        ) : (user.role === 'therapist' || user.role === 'coordinator' || user.role === 'receptionist') && !clinicStateHydrated ? (
          <div className="min-h-screen flex items-center justify-center bg-white">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#7a32fc] mx-auto"></div>
              <p className="mt-4 text-sm text-slate-500">Carregando dados da clínica...</p>
            </div>
          </div>
        ) : user.role === 'patient' ? (
          <PatientDashboard 
            user={user} 
            onLogout={handleLogout} 
            onMoodCheckin={handleMoodCheckin} 
            tasks={tasks} 
            onCompleteTask={handleCompleteTask} 
            history={history} 
            energyTags={(user.type === 'conventional' || user.type === 'adult_conventional') ? ADULT_CONVENTIONAL_TAGS : ENERGY_TAGS} 
            sharedNotes={therapistNotes.filter(n => {
              const noteVisibility = String(n?.visibility || n?.type || '').toLowerCase();
              const isPatientNote =
                noteVisibility === 'shared' ||
                noteVisibility === 'patient' ||
                noteVisibility === 'family' ||
                noteVisibility === 'shared_patient';
              if (!isPatientNote) return false;
              const notePatientId = String(n?.patientId ?? n?.patient_id ?? '').trim();
              const currentPatientIds = new Set(
                [resolvedPatientPortalId, user?.patientId, user?.patient_id, user?.id]
                  .map((value) => String(value || '').trim())
                  .filter(Boolean)
              );
              const notePatientEmail = String(n?.patient_email ?? n?.email ?? '').trim().toLowerCase();
              const currentEmail = String(user?.email || '').trim().toLowerCase();
              const belongsById = notePatientId !== '' && currentPatientIds.has(notePatientId);
              const belongsByEmail = notePatientEmail !== '' && currentEmail !== '' && notePatientEmail === currentEmail;
              return belongsById || belongsByEmail;
            })} 
            protocols={protocols} 
            onAddFamilyNote={handleAddFamilyNote}
            isReadOnlyMode={patientIsReadOnlyMode}
            patientPortalId={resolvedPatientPortalId}
            />
        ) : user.role === 'coordinator' || user.role === 'receptionist' || user.role === 'therapist' ? (
          <CoordinatorDashboard 
            user={{ ...user, profilePicture, crp }}
            onLogout={handleLogout}
            allPatients={allPatients} 
            therapistAgenda={therapistAgenda} 
            onOpenOnboarding={() => setShowOnboarding(true)}
            rooms={rooms}
            setRooms={setRooms}
            roomReservations={roomReservations}
            onDeleteRoomReservation={(id) => {
              const agendaId = id.replace('res-', '');
              handleUpdateAgendaStatus(agendaId, 'canceled');
            }}
            protocols={protocols}
            setProtocols={setProtocols}
            activityLogs={activityLogs}
            onAddActivityLog={onAddActivityLog}
            onScheduleSession={handleScheduleSession}
            onUpdateAppointment={handleUpdateAppointment}
            onUpdateAgendaStatus={handleUpdateAgendaStatus}
            onDeleteAppointment={handleDeleteAppointment}
            onAddPatient={handleAddPatient}
            patientsHistory={history}
            therapistNotes={therapistNotes}
            onAddNote={handleAddNote}
            onUpdateProfile={(data: any) => {
              void (async () => {
                const baseUser = { ...user, ...data };
                try {
                  const profileUpload = await uploadProfileAssetIfNeeded(
                    data?.profilePicture ?? data?.profile_picture,
                    'profile',
                    user.id,
                  );
                  const signatureUpload = await uploadProfileAssetIfNeeded(
                    data?.signatureDataUrl ?? data?.signature_url ?? data?.signatureUrl,
                    'signature',
                    user.id,
                  );
                  const clinicLogoUpload = await uploadProfileAssetIfNeeded(
                    data?.clinicSettings?.clinicLogoUrl,
                    'logo',
                    user.id,
                  );

                  const nextUser = {
                    ...baseUser,
                    profilePicture: profileUpload.url || baseUser.profilePicture || baseUser.profile_picture || null,
                    profile_picture: profileUpload.url || baseUser.profile_picture || baseUser.profilePicture || null,
                    cpf:
                      data?.cpf ??
                      data?.professionalProfile?.cpf ??
                      baseUser?.cpf ??
                      null,
                    phone:
                      data?.phone ??
                      data?.professionalProfile?.phone ??
                      baseUser?.phone ??
                      null,
                    professionalRoleTitle:
                      data?.professionalRoleTitle ??
                      data?.professionalProfile?.roleTitle ??
                      baseUser?.professionalRoleTitle ??
                      null,
                    signatureDataUrl: signatureUpload.url || baseUser.signatureDataUrl || null,
                    professionalProfile: {
                      ...(baseUser?.professionalProfile || {}),
                      ...(data?.professionalProfile || {}),
                      fullName:
                        data?.professionalProfile?.fullName ||
                        data?.name ||
                        baseUser?.professionalProfile?.fullName ||
                        baseUser?.name ||
                        null,
                      cpf:
                        data?.professionalProfile?.cpf ||
                        data?.cpf ||
                        baseUser?.professionalProfile?.cpf ||
                        baseUser?.cpf ||
                        null,
                      phone:
                        data?.professionalProfile?.phone ||
                        data?.phone ||
                        baseUser?.professionalProfile?.phone ||
                        baseUser?.phone ||
                        null,
                      roleTitle:
                        data?.professionalProfile?.roleTitle ||
                        data?.professionalRoleTitle ||
                        baseUser?.professionalProfile?.roleTitle ||
                        baseUser?.professionalRoleTitle ||
                        null,
                      profilePicture:
                        profileUpload.url ||
                        data?.professionalProfile?.profilePicture ||
                        baseUser?.professionalProfile?.profilePicture ||
                        null,
                      signatureDataUrl:
                        signatureUpload.url ||
                        data?.professionalProfile?.signatureDataUrl ||
                        baseUser?.professionalProfile?.signatureDataUrl ||
                        null,
                      metadata: {
                        ...(baseUser?.professionalProfile?.metadata || {}),
                        cpf:
                          data?.cpf ||
                          data?.professionalProfile?.cpf ||
                          baseUser?.professionalProfile?.metadata?.cpf ||
                          undefined,
                        professionalCpf:
                          data?.cpf ||
                          data?.professionalProfile?.cpf ||
                          baseUser?.professionalProfile?.metadata?.professionalCpf ||
                          undefined,
                        phone:
                          data?.phone ||
                          data?.professionalProfile?.phone ||
                          baseUser?.professionalProfile?.metadata?.phone ||
                          undefined,
                        professionalPhone:
                          data?.phone ||
                          data?.professionalProfile?.phone ||
                          baseUser?.professionalProfile?.metadata?.professionalPhone ||
                          undefined,
                        roleTitle:
                          data?.professionalRoleTitle ||
                          data?.professionalProfile?.roleTitle ||
                          baseUser?.professionalProfile?.metadata?.roleTitle ||
                          undefined,
                        professionalRoleTitle:
                          data?.professionalRoleTitle ||
                          data?.professionalProfile?.roleTitle ||
                          baseUser?.professionalProfile?.metadata?.professionalRoleTitle ||
                          undefined,
                      },
                    },
                    clinicSettings: {
                      ...(baseUser?.clinicSettings || {}),
                      ...(data?.clinicSettings || {}),
                      ...(clinicLogoUpload.url ? { clinicLogoUrl: clinicLogoUpload.url } : {}),
                      ...(signatureUpload.url ? { signatureDataUrl: signatureUpload.url } : {}),
                    },
                  };

                  if (nextUser.profilePicture !== undefined) setProfilePicture(nextUser.profilePicture);
                  if (nextUser.crp !== undefined) setCrp(formatProfessionalRegistry(nextUser.crp));
                  setUser(nextUser);

                  await dataService.saveUserProfile(user.id, {
                    ...nextUser,
                    profilePicturePath: profileUpload.path,
                    signaturePath: signatureUpload.path,
                    clinicLogoPath: clinicLogoUpload.path,
                    workspace_id: String(user?.activeWorkspaceId || user?.clinicId || '').trim() || null,
                  });
                } catch (error) {
                  console.error('Profile asset upload error:', error);
                  if (baseUser.profilePicture !== undefined) setProfilePicture(baseUser.profilePicture);
                  if (baseUser.crp !== undefined) setCrp(formatProfessionalRegistry(baseUser.crp));
                  setUser(baseUser);
                  await dataService.saveUserProfile(user.id, {
                    ...baseUser,
                    workspace_id: String(user?.activeWorkspaceId || user?.clinicId || '').trim() || null,
                  });
                }
              })();
            }}
            onUpdatePatient={handleUpdatePatient}
            onRecordTrial={handleRecordTrial}
            onDeleteHistoryItem={handleDeleteHistoryItem}
            onEvaluateHistoryItem={handleUpdateHistoryItem}
            onRefreshPatientHistory={refreshPatientHistoryForProfessional}
            onAddTask={handleAddTask}
            onUpdateTask={handleUpdateTask}
            allTasks={tasks}
          />
        ) : user.role === 'owner' ? (
          <SuperAdminDashboard onLogout={handleLogout} />
        ) : user.role === 'admin' ? (
          <AdminDashboard onLogout={handleLogout} />
        ) : (
          <AdminDashboard onLogout={handleLogout} />
        )}
        </Suspense>
      </LazyImportBoundary>

    </React.Fragment>
  );
}

  const toReadableError = (input: any) => {
    if (typeof input === 'string') return input;
    if (input && typeof input === 'object') {
      if (typeof input.error === 'string') return input.error;
      if (typeof input.message === 'string') return input.message;
      try {
        return JSON.stringify(input);
      } catch {
        return 'Erro desconhecido';
      }
    }
    return String(input || 'Erro desconhecido');
  };


  const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, fallbackValue: T): Promise<T> => {
    let timeoutId: number | null = null;
    try {
      return await Promise.race<T>([
        promise,
        new Promise<T>((resolve) => {
          timeoutId = window.setTimeout(() => resolve(fallbackValue), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    }
  };
