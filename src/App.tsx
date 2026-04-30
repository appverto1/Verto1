import React, { Suspense, useState, useEffect, useMemo, useRef } from 'react';
import { GlobalStyles, ENERGY_TAGS, ADULT_CONVENTIONAL_TAGS } from './components/Common';
import { testSupabaseConnection, getSupabase, ensureFreshSession } from './lib/supabase';
import { Database, CheckCircle2, AlertCircle, Lock, WifiOff, LayoutDashboard } from 'lucide-react';
import { syncOfflineData } from './services/localDb';
import { dataService } from './services/dataService';

const LandingPage = React.lazy(() =>
  import('./components/LandingPage').then((m) => ({ default: m.LandingPage }))
);
const ActivationAccess = React.lazy(() =>
  import('./components/ActivationAccess').then((m) => ({ default: m.ActivationAccess }))
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

export default function App() {
  const isActivationRoute =
    typeof window !== 'undefined' &&
    /^\/ativar\/?$/.test(window.location.pathname);
  const isResetPasswordRoute =
    typeof window !== 'undefined' &&
    /^\/reset-password\/?$/.test(window.location.pathname);
  const isAuthActionRoute = isActivationRoute || isResetPasswordRoute;
  const [user, setUser] = useState<any>(null); 
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const LAST_ACTIVE_WORKSPACE_KEY = 'last_active_workspace_id';

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

  const isUuidLike = (value: unknown) =>
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

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

  const enrichUserFromSessionMetadata = (candidateUser: any, supabaseSession?: any) => {
    const metadata = supabaseSession?.user?.user_metadata || {};
    const fullName = String(metadata?.full_name || '').trim();
    const avatarUrl = String(metadata?.avatar_url || '').trim();

    return {
      ...candidateUser,
      name: candidateUser?.name || fullName || candidateUser?.email?.split('@')?.[0] || candidateUser?.name,
      profilePicture:
        candidateUser?.profilePicture ||
        candidateUser?.profile_picture ||
        avatarUrl ||
        null,
      profile_picture:
        candidateUser?.profile_picture ||
        candidateUser?.profilePicture ||
        avatarUrl ||
        null,
      oauthProvider:
        candidateUser?.oauthProvider ||
        supabaseSession?.user?.app_metadata?.provider ||
        null,
    };
  };

  const applyResolvedUserState = async (candidateUser: any, supabaseSession?: any) => {
    const enrichedUser = enrichUserFromSessionMetadata(candidateUser, supabaseSession);
    const alignedUser = alignWorkspaceFromStorage(enrichedUser);
    const resolvedUser = await restoreWorkspaceContextIfNeeded(alignedUser);

    setUser(resolvedUser);
    setProfilePicture(resolvedUser?.profilePicture || resolvedUser?.profile_picture || null);
    if (hasValidWorkspaceContext(resolvedUser)) {
      setLastActiveWorkspaceId(resolvedUser?.activeWorkspaceId || resolvedUser?.clinicId);
    }
    setShowWorkspacePicker(computeWorkspacePickerVisibility(resolvedUser));

    return resolvedUser;
  };
  
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
    const initSupabase = async () => {
      const supabase = await getSupabase();
      if (!supabase) return;

      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          const intendedRole = localStorage.getItem('verto_intended_role') || 'therapist';
          localStorage.removeItem('verto_intended_role');
          const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
          const isActivationFlow = /^\/(ativar|reset-password)\/?$/i.test(currentPath);
          await handleLoginSuccess(session, intendedRole, undefined, {
            provider: session?.user?.app_metadata?.provider || null,
            activationFlow: isActivationFlow
          });
        } else if (event === 'SIGNED_OUT') {
          console.log('Supabase SIGNED_OUT event received');
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
            console.warn('SIGNED_OUT recovery via /api/auth/me failed:', error);
          }
        }
      });

      return () => subscription.unsubscribe();
    };
    initSupabase();
  }, []);

  useEffect(() => {
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
          console.error('Initial auth check failed:', response.status, text);
          setLoading(false);
          return;
        }
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          console.error('Initial auth check returned non-JSON:', contentType);
          setLoading(false);
          return;
        }

        const data = await response.json();
        if (data.user) {
          await applyResolvedUserState(data.user, session);
        } else {
          setUser(null);
          setProfilePicture(null);
          setShowWorkspacePicker(false);
        }
      } catch (error) {
        console.error('Session check error:', error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    checkSession();
  }, []);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('payment') === 'success') {
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
      alert('O pagamento foi cancelado. VocÃª pode tentar novamente quando quiser.');
      window.history.replaceState({}, document.title, "/");
    }
  }, []);

  const handleLoginSuccess = async (
    supabaseSession: any,
    intendedRole?: string,
    credentials?: { email?: string; password?: string },
    authContext?: { provider?: string | null; activationFlow?: boolean },
  ) => {
    try {
      if (!supabaseSession) {
        if (credentials?.email && credentials?.password) {
          const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              accessToken: null,
              intendedRole,
              provider: authContext?.provider || 'email',
              activationFlow: Boolean(authContext?.activationFlow),
              email: credentials.email,
              password: credentials.password,
            })
          });
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

        const response = await fetch('/api/auth/me', { 
          credentials: 'include',
          headers: {
            'Authorization': token ? `Bearer ${token}` : ''
          }
        });
        
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
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          accessToken,
          intendedRole,
          provider,
          activationFlow,
          email: credentials?.email || null,
          password: credentials?.password || null,
        })
      });

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
  const [tasks, setTasks] = useState<any[]>([]);
  const [patientAssignedTaskCount, setPatientAssignedTaskCount] = useState(0);
  const [patientAssignedTasksLoadError, setPatientAssignedTasksLoadError] = useState(false);
  const [patientContextLoaded, setPatientContextLoaded] = useState(false);
  const [resolvedPatientPortalId, setResolvedPatientPortalId] = useState<string>('');
  const [clinicalRecords, setClinicalRecords] = useState<any[]>([]);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const todayStr = new Date().toISOString().split('T')[0];

  const [rooms, setRooms] = useState<any[]>([]);
  const [therapistAgenda, setTherapistAgenda] = useState<any[]>([]);

  const [specialtySettings, setSpecialtySettings] = useState<any>({});

  const calculateEndTime = (startTime: string, approach: string) => {
    const duration = specialtySettings[approach] || 60;
    const [hours, minutes] = startTime.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes + duration);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  const roomReservations = useMemo(() => {
    return therapistAgenda
      .filter(item => item.room && item.status !== 'canceled')
      .map(item => ({
        id: 'res-' + item.id,
        roomId: item.room,
        roomName: rooms.find(r => r.id === item.room)?.name || item.room,
        professionalId: item.professionalId || 'prof1',
        professionalName: item.professional || 'Terapeuta Teste',
        patientName: item.name,
        date: item.date,
        startTime: item.time,
        endTime: calculateEndTime(item.time, item.type),
        status: item.status
      }));
  }, [therapistAgenda, rooms, specialtySettings]);

  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [crp, setCrp] = useState<string>('');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);

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
  const clinicStateSyncTimerRef = useRef<any>(null);
  const inactivityTimerRef = useRef<any>(null);
  const autoLogoutInProgressRef = useRef(false);
  const AUTO_LOGOUT_IDLE_MS = 15 * 60 * 1000;

  const onAddActivityLog = async (action: string, details: string, category: 'clinical' | 'management' | 'system' = 'clinical') => {
    const newLog = normalizeActivityLog({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      professional: user?.name || "Profissional",
      actor_name: user?.name || "Profissional",
      action,
      details,
      category
    });
    
    setActivityLogs(prev => [newLog, ...prev]);

    // Sync to Backend
    const { dataService } = await import('./services/dataService');
    await dataService.saveActivityLog(newLog);
  };
  
  
  const handleCheckout = async (planName?: string) => {
    try {
      const response = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(planName ? { planName } : {})
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Erro ao iniciar pagamento: ' + (data.error || 'Tente novamente.'));
      }
    } catch (error: any) {
      console.error('Checkout error:', error);
      alert('Erro de conexÃ£o: ' + error.message);
    }
  };

  const handleEnterpriseContact = (currentUser: any) => {
    const message = `OlÃ¡! Tenho interesse no plano Enterprise da Verto.\n\nNome: ${currentUser?.name || ''}\nEmail: ${currentUser?.email || ''}`;
    window.open(`https://wa.me/5511959348563?text=${encodeURIComponent(message)}`, '_blank');
  };

  const SubscriptionRequired = ({ user, onLogout }: { user: any, onLogout: () => void }) => (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
      <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl shadow-blue-500/5 p-10 text-center border border-slate-100 animate-pop">
        <div className="w-20 h-20 bg-blue-50 text-[#7a32fc] rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-inner">
          <Lock size={40} />
        </div>
        <h2 className="text-3xl font-bold text-slate-900 mb-4 tracking-tight">Ative sua conta</h2>
        <p className="text-slate-500 font-normal mb-8 leading-relaxed">
          Para acessar a plataforma Verto, Ã© necessÃ¡rio ativar sua assinatura. 
          {user.role === 'patient' ? (
            <span> O valor para pacientes Ã© de apenas <strong>R$ 4,90/mÃªs</strong>.</span>
          ) : (
            <span> Escolha um plano para concluir sua assinatura.</span>
          )}
        </p>
        
        <div className="space-y-4">
          {user.role === 'patient' ? (
            <button 
              onClick={() => handleCheckout()}
              className="w-full bg-[#7a32fc] text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 hover:scale-[1.02] transition-all active:scale-[0.98]"
            >
              Pagar Agora (R$ 4,90)
            </button>
          ) : (
            <React.Fragment>
              <button 
                onClick={() => handleCheckout('Essencial')}
                className="w-full bg-[#7a32fc] text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 hover:scale-[1.02] transition-all active:scale-[0.98]"
              >
                Assinar Essencial (R$ 149,90)
              </button>
              <button 
                onClick={() => handleCheckout('Crescimento')}
                className="w-full bg-[#05CD99] text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-emerald-500/20 hover:scale-[1.02] transition-all active:scale-[0.98]"
              >
                Assinar Crescimento (R$ 399,90)
              </button>
              <button 
                onClick={() => handleCheckout('AvanÃ§ado')}
                className="w-full bg-[#FFB547] text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-amber-500/20 hover:scale-[1.02] transition-all active:scale-[0.98]"
              >
                Assinar AvanÃ§ado (R$ 679,90)
              </button>
              <button
                onClick={() => handleEnterpriseContact(user)}
                className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-slate-500/20 hover:scale-[1.02] transition-all active:scale-[0.98]"
              >
                Falar sobre Enterprise (WhatsApp)
              </button>
            </React.Fragment>
          )}
          
          <button 
            onClick={onLogout}
            className="w-full bg-white text-slate-400 py-4 rounded-2xl font-semibold text-xs hover:text-slate-600 transition-all"
          >
            Sair da conta
          </button>
        </div>
        
        <p className="mt-8 text-[10px] text-slate-400 font-medium uppercase tracking-widest">
          Pagamento processado com seguranÃ§a pelo Stripe
        </p>
      </div>
    </div>
  );

  const [protocols, setProtocols] = useState<any[]>([]);
  const [allPatients, setAllPatients] = useState<any[]>([]);
  
  const resetWorkspaceScopedState = () => {
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
      return;
    }

    const workspaceId = String(nextUser?.activeWorkspaceId || nextUser?.clinicId || '').trim();
    if (!workspaceId) {
      setClinicStateHydrated(false);
      return;
    }

    setClinicStateHydrated(false);
    resetWorkspaceScopedState();
    const result = await dataService.hydrateWorkspaceState(workspaceId);

    if (!result?.success || !result?.data) {
      setClinicStateHydrated(true);
      return;
    }

    const hydrated = result.data;
    setRooms(Array.isArray(hydrated.clinicState?.rooms) ? hydrated.clinicState.rooms : []);
    setTherapistAgenda(
      Array.isArray(hydrated.clinicState?.appointments) ? hydrated.clinicState.appointments : [],
    );
    setProtocols(Array.isArray(hydrated.clinicState?.protocols) ? hydrated.clinicState.protocols : []);
    setSpecialtySettings(
      hydrated.clinicState?.specialtySettings &&
        typeof hydrated.clinicState.specialtySettings === 'object'
        ? hydrated.clinicState.specialtySettings
        : {},
    );
    setAllPatients(Array.isArray(hydrated.patients) ? hydrated.patients : []);
    setTherapistNotes(normalizeAndDecorateNotes(Array.isArray(hydrated.notes) ? hydrated.notes : []));
    setHistory(Array.isArray(hydrated.history) ? hydrated.history : []);
    setTasks(Array.isArray(hydrated.tasks) ? hydrated.tasks : []);
    setClinicalRecords(Array.isArray(hydrated.clinicalRecords) ? hydrated.clinicalRecords : []);
    setClinicStateHydrated(true);
  };

  useEffect(() => {
    if (!user) {
      setClinicStateHydrated(false);
      return;
    }

    // Paciente tem hidrataÃ§Ã£o prÃ³pria (histÃ³rico/tarefas/notas) e nÃ£o deve
    // receber sobreposiÃ§Ã£o do estado clÃ­nico global apÃ³s F5.
    if (user.role === 'patient') {
      setClinicStateHydrated(false);
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
      patientId: String(byId?.id || byEmail?.id || byUserEmail?.id || resolvedPatientPortalId || candidateId || user?.id || '').trim(),
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
    };
  };

  useEffect(() => {
    let mounted = true;
    let running = false;

    const fetchPatientScopedData = async () => {
      if (!mounted || running) return;
      if (!user || user.role !== 'patient' || !user.email) return;
      running = true;
      try {
        if (mounted) setPatientContextLoaded(false);
        const identity = resolvePatientIdentityForPortal(user);
        const [historyRes, historyByEmailRes, historyByIdRes, tasksRes, assignedTasksRes, notesRes, protocolsRes] = await Promise.allSettled([
          dataService.getPatientSelfHistory(),
          dataService.getHistoryByEmail(user.email),
          identity?.patientId ? dataService.getHistory(identity.patientId) : Promise.resolve({ success: true, data: [] }),
          dataService.getPatientSelfTasks(),
          dataService.getPatientSelfAssignedTasks(),
          dataService.getNotesByEmail(user.email),
          dataService.getPatientSelfProtocols()
        ]);

      const safeHistoryRes = historyRes.status === 'fulfilled' ? historyRes.value : null;
      const safeHistoryByEmailRes = historyByEmailRes.status === 'fulfilled' ? historyByEmailRes.value : null;
      const safeHistoryByIdRes = historyByIdRes.status === 'fulfilled' ? historyByIdRes.value : null;
      const safeTasksRes = tasksRes.status === 'fulfilled' ? tasksRes.value : null;
      const safeAssignedTasksRes = assignedTasksRes.status === 'fulfilled' ? assignedTasksRes.value : null;
      const safeNotesRes = notesRes.status === 'fulfilled' ? notesRes.value : null;
      const safeProtocolsRes = protocolsRes.status === 'fulfilled' ? protocolsRes.value : null;

      const mergedHistoryRaw = [
        ...(Array.isArray(safeHistoryRes?.data) ? safeHistoryRes.data : []),
        ...(Array.isArray(safeHistoryByEmailRes?.data) ? safeHistoryByEmailRes.data : []),
        ...(Array.isArray(safeHistoryByIdRes?.data) ? safeHistoryByIdRes.data : [])
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
        ...(Array.isArray(safeTasksRes?.data) ? safeTasksRes.data : []),
        ...(Array.isArray(safeAssignedTasksRes?.data) ? safeAssignedTasksRes.data : [])
      ]
        .map((row: any) => String(row?.patient_id || row?.patientId || '').trim())
        .filter((id: string) => id.length > 0 && id !== String(user.id || '').trim());
      if (mounted && candidateResolvedIds.length > 0) {
        setResolvedPatientPortalId(candidateResolvedIds[0]);
      }

      if (mounted) setHistory(
        Array.isArray(mergedHistory)
          ? mergedHistory.map((h: any) => ({
              ...h,
              patientId: h?.patient_id || h?.patientId || user.id,
              time: h?.created_at
                ? new Date(h.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '',
              dateGroup:
                h?.created_at && new Date(h.created_at).toDateString() === new Date().toDateString()
                  ? 'Hoje'
                  : h?.created_at
                    ? new Date(h.created_at).toLocaleDateString()
                    : ''
            }))
          : []
      );
      if (mounted) setTasks((() => {
        const baseTasks = Array.isArray(safeTasksRes?.data)
          ? safeTasksRes.data.map((t: any) => ({
              ...t,
              patientId: t?.patient_id || t?.patientId || user.id
            }))
          : [];
        const assignedPending = Array.isArray(safeAssignedTasksRes?.data)
          ? safeAssignedTasksRes.data
              .filter((t: any) => {
                if (String(t?.status || '').toLowerCase() === 'completed') return false;
                return true;
              })
              .map((t: any) => {
                const taskData = t?.task_data && typeof t.task_data === 'object' ? t.task_data : {};
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
                  scheduledAt: t?.scheduled_at || null
                };
              })
          : [];
        return [...baseTasks, ...assignedPending];
      })());

      if (mounted) setTherapistNotes(
        normalizeAndDecorateNotes(Array.isArray(safeNotesRes?.data) ? safeNotesRes.data : [])
      );
      if (mounted) setProtocols(Array.isArray(safeProtocolsRes?.data) ? safeProtocolsRes.data : []);

      const assignedCount = Array.isArray(safeAssignedTasksRes?.data) ? safeAssignedTasksRes.data.length : 0;
      if (mounted) setPatientAssignedTaskCount(assignedCount);
      if (mounted) setPatientAssignedTasksLoadError(
        assignedTasksRes.status === 'rejected' ||
          (safeAssignedTasksRes?.success === false && assignedCount === 0)
      );

      const fetchedTreatmentStatus = String(safeHistoryRes?.treatmentStatus || '').trim().toLowerCase();
      if (mounted && fetchedTreatmentStatus && fetchedTreatmentStatus !== String(user?.treatmentStatus || '').trim().toLowerCase()) {
        setUser((prev: any) => {
          if (!prev || prev.id !== user.id) return prev;
          return { ...prev, treatmentStatus: fetchedTreatmentStatus };
        });
      }
        if (mounted) setPatientContextLoaded(true);
      } finally {
        running = false;
      }
    };

    void fetchPatientScopedData();
    const interval = window.setInterval(() => {
      void fetchPatientScopedData();
    }, 60_000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
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

  useEffect(() => {
    if (!user) return;
    if (!(user.role === 'therapist' || user.role === 'coordinator' || user.role === 'receptionist')) return;
    if (!clinicStateHydrated) return;

    if (clinicStateSyncTimerRef.current) {
      clearTimeout(clinicStateSyncTimerRef.current);
    }

    clinicStateSyncTimerRef.current = setTimeout(async () => {
      try {
        const workspaceId = String(user?.activeWorkspaceId || user?.clinicId || '').trim();
        await dataService.saveClinicState({
          workspace_id: workspaceId || undefined,
          rooms,
          appointments: therapistAgenda,
          protocols,
          specialtySettings
        });
      } catch (error) {
        console.error('Erro ao sincronizar estado clÃ­nico no Supabase:', error);
      }
    }, 800);

    return () => {
      if (clinicStateSyncTimerRef.current) {
        clearTimeout(clinicStateSyncTimerRef.current);
      }
    };
  }, [user, clinicStateHydrated, rooms, therapistAgenda, protocols, specialtySettings]);

  // Fetch activity logs from Backend on load
  useEffect(() => {
    const fetchLogs = async () => {
      if (user && (user.role === 'therapist' || user.role === 'coordinator')) {
        const { dataService } = await import('./services/dataService');
        const { success, data } = await dataService.getActivityLogs();
        if (success && data) {
          setActivityLogs((data || []).map(normalizeActivityLog));
        }
      }
    };
    fetchLogs();
  }, [user]);

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
    onAddActivityLog('Criação de Tarefa', `Tarefa "${taskToPersist.title}" criada para o paciente ID ${taskToPersist.patientId}.`);

    if (!isAdultTask) {
      // Sync to Backend (fluxo legado/kids)
      const persisted = await dataService.addTask({
        ...taskToPersist,
        patient_id: String(taskToPersist.patientId),
        patient_email: patient?.email || null
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
    onAddActivityLog("AtualizaÃ§Ã£o de Tarefa", `Tarefa ID ${id} atualizada.`);

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
    onAddActivityLog("Registro de EvoluÃ§Ã£o", `Nova nota (${normalizedVisibility}) adicionada ao prontuÃ¡rio do paciente ID ${pid}.`);

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
        const errMsg = String(result?.error || 'NÃ£o foi possÃ­vel persistir a anotaÃ§Ã£o no servidor.');
        alert(errMsg);
      }
    } catch (error) {
      console.error("Falha ao sincronizar nota no servidor:", error);
      setTherapistNotes(prev => prev.filter((n: any) => n.id !== tempId));
      alert('Falha ao salvar anotaÃ§Ã£o. Tente novamente.');
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
    const persistMilestoneEvent = async (payload: { patientId?: string; patientEmail?: string | null; sourceRef: string; awarded: boolean }) => {
      try {
        await dataService.addNote({
          id: crypto.randomUUID(),
          patient_id: String(payload.patientId || '').trim(),
          patient_email: payload.patientEmail || null,
          text: `MILESTONE_EVENT|source=${payload.sourceRef}|awarded=${payload.awarded ? 1 : 0}`,
          visibility: 'family',
          subject: 'milestone_event',
          type: 'family_note'
        });
      } catch (error) {
        console.error('Falha ao persistir evento de marco:', error);
      }
    };
    if (rawId.startsWith('note-family-')) {
      const noteId = rawId.replace('note-family-', '');
      const starred = Number(score || 0) >= 1;
      const matchingNote = (Array.isArray(therapistNotes) ? therapistNotes : []).find((n: any) => String(n.id) === String(noteId));
      setTherapistNotes(prev =>
        prev.map((n: any) =>
          String(n.id) === String(noteId)
            ? {
                ...n,
                score,
                visibility: n?.visibility || 'family',
                type: n?.type || 'family_note',
                subject: starred ? `â­ ${String(n?.subject || 'Geral').replace(/\u2b50|â­/g, '').trim()}` : String(n?.subject || 'Geral').replace(/\u2b50|â­/g, '').trim(),
                text: applyStarMarker(String(n?.text || n?.note || ''), starred),
                note: applyStarMarker(String(n?.note || n?.text || ''), starred)
              }
            : n
        )
      );
      try {
        await persistMilestoneEvent({
          patientId: String(matchingNote?.patientId || matchingNote?.patient_id || ''),
          patientEmail: matchingNote?.patient_email || null,
          sourceRef: rawId,
          awarded: starred
        });
      } catch (error) {
        console.error('Falha ao persistir estrela em anotaÃ§Ã£o de famÃ­lia:', error);
      }
      return;
    }

    const item = history.find(i => String(i.id) === rawId);
    const isFamilyHistory = item && (item.type === 'family_note' || item.type === 'photo');
    if (isFamilyHistory) {
      const patientId = String(item?.patientId || item?.patient_id || '').trim();
      const normalizedItemText = String(item?.note || item?.text || '').trim().toLowerCase();
      const starred = Number(score || 0) >= 1;
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
        await persistMilestoneEvent({
          patientId: String(item?.patientId || item?.patient_id || ''),
          patientEmail: matchingNote?.patient_email || allPatients.find((p: any) => String(p.id) === String(item?.patientId || item?.patient_id || ''))?.email || null,
          sourceRef: rawId,
          awarded: starred
        });
      } catch (error) {
        console.error('Falha ao persistir estrelinha de registro da famÃ­lia:', error);
      }
      return;
    }

    if (item) {
      const updatedItem = { ...item, score, evalComment: evalComment || '' };
      const noteText = `ðŸ“ ATUALIZAÃ‡ÃƒO DE REGISTRO\nAtividade: ${updatedItem.title}\nPontuaÃ§Ã£o: ${updatedItem.score}\nObs: ${updatedItem.evalComment || "Nenhuma observaÃ§Ã£o."}`;
      handleAddNote(item.patientId, noteText, 'private', 'SessÃ£o');
      setHistory(prev => prev.map(i => (String(i.id) === rawId ? updatedItem : i)));
      onAddActivityLog("EdiÃ§Ã£o de HistÃ³rico", `Registro de atividade "${item.title}" (ID ${id}) editado.`);
      try {
        await dataService.updateHistoryItem(String(id), {
          score,
          note: evalComment || '',
          title: updatedItem.title,
          patient_id: String(item.patientId),
          patient_email: allPatients.find(p => p.id === item.patientId)?.email || null
        });
      } catch (error) {
        console.error('Falha ao persistir ediÃ§Ã£o de histÃ³rico:', error);
      }
    }
  };
  const handleUpdateAgendaStatus = (id: any, status: string) => {
    setTherapistAgenda(prev => prev.map(item => item.id === id ? { ...item, status } : item));
  };

  const handleUpdateAppointment = (id: any, updates: any) => {
    setTherapistAgenda(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
    onAddActivityLog("EdiÃ§Ã£o de Agendamento", `Agendamento ID ${id} atualizado: ${JSON.stringify(updates)}`, 'management');
  };

  const handleAddPatient = async (data: any) => { 
    const newId = data.id || Date.now(); 
    
    // Identity Data (Pseudonymized)
    const resolvedPortalType =
      data.type ||
      data.patientProfileType ||
      (data.approach === 'ABA'
        ? 'kids_tea'
        : data.approach === 'TO'
          ? 'adult_tea'
          : 'adult_conventional');

    const newPatient = { 
      id: newId, 
      name: data.name, 
      email: data.email,
      phone: data.phone, 
      age: data.anamnesisData?.idade || data.age || 0, 
      approach: data.approach, 
      type: resolvedPortalType,
      anamnesisData: data.anamnesisData || null,
      anamnesisRenewalMonths: [2, 3, 6, 12].includes(Number(data.anamnesisRenewalMonths))
        ? Number(data.anamnesisRenewalMonths)
        : 6,
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

    if(data.scheduleImmediate) setTherapistAgenda(prev => [...prev, {id: newId, name: data.name, date: data.date || todayStr, time: data.time, status: 'pending', type: 'Primeira', color: 'bg-blue-100 text-blue-600'}].sort((a,b) => a.time.localeCompare(b.time))); 
    onAddActivityLog("Cadastro de Paciente", `Paciente ID ${newId} cadastrado no sistema.`, 'management');
    const rollbackOptimisticPatient = () => {
      setAllPatients(prev => prev.filter((p: any) => String(p.id) !== String(newId)));
      setClinicalRecords(prev => prev.filter((r: any) => String(r.patientId) !== String(newId)));
      setTherapistAgenda(prev => prev.filter((a: any) => String(a.id) !== String(newId)));
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
      );
      if (userResult.success) {
        console.log(`User account created for patient: ${data.email}`);
        const normalizedMessage = String(userResult?.message || '').toLowerCase();
        const alreadyExists = normalizedMessage.includes('already exists');
        if (alreadyExists) {
          // If user already exists, we should inform that history will be linked
          alert(`O paciente com o email ${data.email} jÃ¡ possui uma conta no sistema. Todo o histÃ³rico clÃ­nico anterior serÃ¡ vinculado a este novo prontuÃ¡rio.`);
          
          // Fetch existing history and notes by email
          const historyRes = await dataService.getHistoryByEmail(data.email);
          if (historyRes.success && historyRes.data) {
            const existingHistory = historyRes.data.map((h: any) => ({
              ...h,
              patientId: newId, // Link to the temporary ID, will be updated to realId later
              time: new Date(h.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              dateGroup: new Date(h.created_at).toDateString() === new Date().toDateString() ? "Hoje" : new Date(h.created_at).toLocaleDateString()
            }));
            setHistory(prev => [...prev, ...existingHistory]);
          }

          const notesRes = await dataService.getNotesByEmail(data.email);
          if (notesRes.success && notesRes.data) {
            const existingNotes = notesRes.data.map((n: any) => ({
              ...n,
              patientId: newId,
              date: new Date(n.created_at).toLocaleString()
            }));
            setTherapistNotes(prev => normalizeAndDecorateNotes([...prev, ...existingNotes]));
          }
        } else {
          if (userResult.activationEmailSent === false) {
            alert(
              `Paciente cadastrado e vinculado, mas o e-mail de ativaÃ§Ã£o nÃ£o foi enviado agora.\n` +
              `Motivo: ${toReadableError(userResult.warning || userResult.error || 'falha no provedor de e-mail')}\n` +
              `VocÃª pode usar o recurso de reenviar ativaÃ§Ã£o depois.`
            );
          } else {
            alert(`Paciente cadastrado com sucesso. Enviamos o e-mail de ativaÃ§Ã£o para ${data.email}.`);
          }
        }
      } else if (userResult?.error) {
        alert(`NÃ£o foi possÃ­vel enviar o convite do paciente: ${toReadableError(userResult.error)}`);
        rollbackOptimisticPatient();
        return;
      }
    }

    // 2. Save patient record
    const fbResult = await dataService.savePatient({
      name: data.name,
      email: data.email || '',
      cpf: data.cpf || data.anamnesisData?.cpf || '',
      phone: data.phone,
      age: data.anamnesisData?.idade || data.age || 0,
      diagnosis: data.diagnosis,
      type: resolvedPortalType
    });

    let persistedPatientId: string | number = newId;
    const duplicateConflict =
      !fbResult?.success &&
      Number(fbResult?.status) === 409 &&
      /jÃ¡ existe um paciente|mesmo e-mail|mesmo cpf|duplicate/i.test(
        String(fbResult?.error || ""),
      );

    if (duplicateConflict) {
      const existingIdFromApi = String(
        fbResult?.details?.details?.patientId || "",
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
      } else {
        alert(
          "Paciente jÃ¡ existe na clÃ­nica e foi vinculado, mas nÃ£o foi possÃ­vel reconciliar o registro no painel agora. Atualize a pÃ¡gina para visualizar.",
        );
      }
    }

    if (!fbResult?.success) {
      if (!duplicateConflict) {
        alert(`NÃ£o foi possÃ­vel cadastrar paciente: ${toReadableError(fbResult?.error || 'Erro desconhecido')}`);
        rollbackOptimisticPatient();
        return;
      }
    } else if (fbResult.success && fbResult.data) {
      const realId = fbResult.data.id;
      setAllPatients(prev => mergePatients(
        prev.map(p => p.id === newId ? { ...p, id: realId } : p),
        [{ ...newPatient, id: realId }]
      ));
      setClinicalRecords(prev => prev.map(r => r.patientId === newId ? { ...r, patientId: realId } : r));
      persistedPatientId = realId;
    }

    await dataService.savePatientRecord(String(persistedPatientId), {
      workspace_id: String(user?.activeWorkspaceId || user?.clinicId || '').trim() || null,
      nome: data.name || data.anamnesisData?.nome || "",
      nomeSocial: data.anamnesisData?.nomeSocial || "",
      telefone: data.phone || data.anamnesisData?.telefone || "",
      dataNascimento: data.anamnesisData?.dataNascimento || "",
      genero: data.anamnesisData?.genero || "",
      convenioTipo: data.anamnesisData?.convenioTipo || "particular",
      convenioNome: data.anamnesisData?.convenioNome || "",
      convenioCarteirinha: data.anamnesisData?.convenioCarteirinha || "",
      grupo: data.anamnesisData?.grupo || "",
      comoConheceu: data.anamnesisData?.comoConheceu || "",
      rg: data.anamnesisData?.rg || "",
      cpf: data.cpf || data.anamnesisData?.cpf || "",
      cep: data.anamnesisData?.cep || "",
      email: data.email || data.anamnesisData?.email || "",
      logradouro: data.anamnesisData?.logradouro || "",
      numero: data.anamnesisData?.numero || "",
      complemento: data.anamnesisData?.complemento || "",
      bairro: data.anamnesisData?.bairro || "",
      cidade: data.anamnesisData?.cidade || "",
      outrasInformacoes: data.anamnesisData?.outrasInformacoes || "",
      menorDeIdade: Boolean(data.anamnesisData?.menorDeIdade),
      responsavelNome: data.anamnesisData?.responsavelNome || "",
      responsavelDataNascimento: data.anamnesisData?.responsavelDataNascimento || "",
      responsavelCpf: data.anamnesisData?.responsavelCpf || "",
      responsavelTelefone: data.anamnesisData?.responsavelTelefone || "",
      anamnesisRenewalMonths: [2, 3, 6, 12].includes(Number(data.anamnesisRenewalMonths))
        ? Number(data.anamnesisRenewalMonths)
        : 6,
      lastAnamnesisAt: data.lastAnamnesisAt || null,
      patientProfileType: resolvedPortalType,
      diagnosis: data.diagnosis || "",
      pei: Array.isArray(data.pei) ? data.pei : [],
      evaluationLinks:
        data.evaluationLinks && typeof data.evaluationLinks === 'object' ? data.evaluationLinks : {},
      interventionTaskLinks:
        data.interventionTaskLinks && typeof data.interventionTaskLinks === 'object' ? data.interventionTaskLinks : {},
      anamnese: data.anamnesisData || {}
    });
  };
  const handleUpdatePatient = async (updatedData: any) => { 
    // Split updates
    const { diagnosis, anamnesisData, pei, evaluationLinks, interventionTaskLinks, ...identityData } = updatedData;
    const isDeleteOrUnlink = updatedData?.clinic_id === null || String(updatedData?.status || '').toLowerCase() === 'deleted';

    // If unlinking (clinic_id is null), remove from local state
    if (isDeleteOrUnlink) {
      setAllPatients(prev => prev.filter(p => p.id !== updatedData.id));
      setClinicalRecords(prev => prev.filter(r => r.patientId !== updatedData.id));
      setTherapistAgenda(prev => prev.filter(a => a.id !== updatedData.id));
      onAddActivityLog("DesvinculaÃ§Ã£o de Paciente", `Paciente ID ${updatedData.id} foi desvinculado.`, 'management');
    } else {
      if (Object.keys(identityData).length > 1) { // More than just 'id'
        setAllPatients(prev => prev.map(p => p.id === updatedData.id ? { ...p, ...identityData } : p)); 
      }

      if (diagnosis !== undefined || anamnesisData !== undefined || pei !== undefined || evaluationLinks !== undefined || interventionTaskLinks !== undefined) {
        const clinicalPatch: any = {
          ...(diagnosis !== undefined && { diagnosis }),
          ...(anamnesisData !== undefined && { anamnesisData }),
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
          ...(anamnesisData !== undefined && { anamnesisData }),
          ...(pei !== undefined && { pei }),
          ...(evaluationLinks !== undefined && { evaluationLinks }),
          ...(interventionTaskLinks !== undefined && { interventionTaskLinks })
        } : r));
      }

      setTherapistAgenda(prev => prev.map(a => a.id === updatedData.id ? { ...a, name: updatedData.name || a.name } : a)); 
      onAddActivityLog("AtualizaÃ§Ã£o de Cadastro", `Dados do paciente ID ${updatedData.id} atualizados.`, 'management');
    }

    // Sync to Backend
    if (typeof updatedData.id === 'string' || typeof updatedData.id === 'number') {
      const { dataService } = await import('./services/dataService');
      if (isDeleteOrUnlink) {
        const deleteResult = await dataService.deletePatient(String(updatedData.id));
        if (!deleteResult?.success) {
          alert(`NÃ£o foi possÃ­vel excluir/desvincular paciente: ${toReadableError(deleteResult?.error || 'Erro desconhecido')}`);
        }
      } else {
        await dataService.updatePatient(String(updatedData.id), {
          name: updatedData.name,
          email: updatedData.email,
          phone: updatedData.phone,
          age: updatedData.age,
          diagnosis: updatedData.diagnosis,
          type: updatedData.type,
          clinic_id: updatedData.clinic_id,
          status: updatedData.status
        });
      }

      if (
        !isDeleteOrUnlink &&
        (
          anamnesisData !== undefined ||
          diagnosis !== undefined ||
          updatedData?.type !== undefined ||
          pei !== undefined ||
          evaluationLinks !== undefined ||
          interventionTaskLinks !== undefined ||
          updatedData?.anamnesisRenewalMonths !== undefined ||
          updatedData?.lastAnamnesisAt !== undefined
        )
      ) {
        const recordPayload: any = {
          workspace_id: String(user?.activeWorkspaceId || user?.clinicId || '').trim() || null,
          anamnesisRenewalMonths: [2, 3, 6, 12].includes(
            Number(updatedData?.anamnesisRenewalMonths),
          )
            ? Number(updatedData?.anamnesisRenewalMonths)
            : 6,
          lastAnamnesisAt: updatedData?.lastAnamnesisAt || null,
          ...(diagnosis !== undefined && { diagnosis: diagnosis || "" }),
          ...(updatedData?.type !== undefined && { patientProfileType: updatedData.type }),
          ...(pei !== undefined && { pei }),
          ...(evaluationLinks !== undefined && { evaluationLinks }),
          ...(interventionTaskLinks !== undefined && { interventionTaskLinks }),
        };

        if (anamnesisData !== undefined) {
          Object.assign(recordPayload, {
            nome: updatedData.name || anamnesisData?.nome || "",
            nomeSocial: anamnesisData?.nomeSocial || "",
            telefone: updatedData.phone || anamnesisData?.telefone || "",
            dataNascimento: anamnesisData?.dataNascimento || "",
            genero: anamnesisData?.genero || "",
            convenioTipo: anamnesisData?.convenioTipo || "particular",
            convenioNome: anamnesisData?.convenioNome || "",
            convenioCarteirinha: anamnesisData?.convenioCarteirinha || "",
            grupo: anamnesisData?.grupo || "",
            comoConheceu: anamnesisData?.comoConheceu || "",
            rg: anamnesisData?.rg || "",
            cpf: anamnesisData?.cpf || "",
            cep: anamnesisData?.cep || "",
            email: updatedData.email || anamnesisData?.email || "",
            logradouro: anamnesisData?.logradouro || "",
            numero: anamnesisData?.numero || "",
            complemento: anamnesisData?.complemento || "",
            bairro: anamnesisData?.bairro || "",
            cidade: anamnesisData?.cidade || "",
            outrasInformacoes: anamnesisData?.outrasInformacoes || "",
            menorDeIdade: Boolean(anamnesisData?.menorDeIdade),
            responsavelNome: anamnesisData?.responsavelNome || "",
            responsavelDataNascimento: anamnesisData?.responsavelDataNascimento || "",
            responsavelCpf: anamnesisData?.responsavelCpf || "",
            responsavelTelefone: anamnesisData?.responsavelTelefone || "",
            anamnese: anamnesisData || {},
          });
        }

        await dataService.savePatientRecord(String(updatedData.id), recordPayload);
      }
    }
  };
  const handleScheduleSession = (sess: any) => { 
    const pid = allPatients.find(p => p.name === sess.patientName)?.id || Date.now(); 
    const numSessions = sess.numSessions || 1;
    const newItems = [];
    const conflicts: string[] = [];
    
    for (let i = 0; i < numSessions; i++) {
      const date = new Date(sess.date + 'T00:00:00');
      date.setDate(date.getDate() + (i * 7)); // Weekly recurrence
      const dateStr = date.toISOString().split('T')[0];
      const startTime = sess.time;
      const endTime = calculateEndTime(sess.time, sess.approach);

      // 1. Room Conflict Check
      if (sess.room) {
        const roomConflict = roomReservations.find(r => 
          r.date === dateStr && 
          r.roomId === sess.room && 
          r.status !== 'canceled' &&
          ((startTime >= r.startTime && startTime < r.endTime) || 
           (endTime > r.startTime && endTime <= r.endTime) ||
           (startTime <= r.startTime && endTime >= r.endTime))
        );
        if (roomConflict) {
          conflicts.push(`Conflito de Sala: ${sess.room} jÃ¡ estÃ¡ reservada em ${dateStr} Ã s ${startTime}`);
        }
      }

      // 2. Professional Conflict Check
      const profConflict = therapistAgenda.find(a => 
        a.date === dateStr && 
        a.professional === sess.professional && 
        a.time === sess.time &&
        a.status !== 'canceled'
      );
      if (profConflict) {
        conflicts.push(`Conflito de Profissional: ${sess.professional} jÃ¡ tem agenda em ${dateStr} Ã s ${startTime}`);
      }

      // 3. Patient Conflict Check
      const patientConflict = therapistAgenda.find(a => 
        a.date === dateStr && 
        a.patientId === pid && 
        a.time === sess.time &&
        a.status !== 'canceled'
      );
      if (patientConflict) {
        conflicts.push(`Conflito de Paciente: ${sess.patientName} jÃ¡ tem sessÃ£o em ${dateStr} Ã s ${startTime}`);
      }

      if (conflicts.length === 0) {
        newItems.push({
          id: Date.now() + i, // Unique ID for each session
          patientId: pid,
          name: sess.patientName, 
          date: dateStr, 
          time: sess.time, 
          status: 'pending', 
          type: sess.approach, 
          color: 'bg-blue-100 text-blue-600',
          professional: sess.professional,
          room: sess.room
        });
      }
    }

    if (conflicts.length > 0) {
      return { success: false, errors: conflicts };
    }

    setTherapistAgenda(prev => [...prev, ...newItems].sort((a,b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.time.localeCompare(b.time);
    })); 

    onAddActivityLog("Agendamento de SessÃ£o", `${numSessions} sessÃµes agendadas para "${sess.patientName}" comeÃ§ando em ${sess.date}.`, 'management');
    return { success: true };
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
      : (isConventionalAdult ? null : normalizedEffort);
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
      linkedTask: t.linkedTask
    };
    setHistory(prev => [newHistoryItem, ...prev]); 
    setTasks(prev => prev.filter(x => x.id !== t.id)); 
    
    // Add a note about the patient completing the task
    const noteText = `? TAREFA CONCLUÃDA PELO PACIENTE\nAtividade: ${t.title}\n${isKid ? `PontuaÃ§Ã£o: ${e}\n` : ''}AnotaÃ§Ãµes do Paciente: ${n || "Nenhuma observaÃ§Ã£o."}`;
    handleAddNote(targetPatientId, noteText, 'private', 'EvoluÃ§Ã£o');

    // Sync to Backend
    const { dataService } = await import('./services/dataService');
    await dataService.addHistoryItem({
      patient_id: targetPatientId,
      patient_email: identity.patientEmail,
      patient_name: identity.patientName,
      type: t.type || 'task',
      title: t.title,
      score: isKid ? normalizedEffort : null,
      energy: energyValue,
      note: n,
      icon: t.icon
    });

    const assignedTaskId = String(t?.assignedTaskId || '');
    const isTaskIdUuid = isUuidLike(String(t?.id || ''));
    const completionTargetId = assignedTaskId || (isTaskIdUuid ? String(t.id) : '');
    if (completionTargetId) {
      try {
        const completionPayload: any = {
          patient_comment: n || ''
        };
        if (typeof normalizedEffort === 'number' && Number.isFinite(normalizedEffort) && !isConventionalAdult) {
          completionPayload.patient_effort = Math.max(0, Math.min(100, normalizedEffort));
        } else {
          completionPayload.patient_effort = null;
        }
        await dataService.completeAssignedTask(completionTargetId, completionPayload);
      } catch (error) {
        console.error('Falha ao concluir assigned task (nÃ£o bloqueante):', error);
      }
    }
  };
  const handleRecordTrial = async (pid: any, title: string, score: number, evalComment?: string) => {
    const targetPatient = allPatients.find(p => p.id === pid);
    const clinicalRecord = clinicalRecords.find(r => r.patientId === pid);
    const isKid = (targetPatient?.age !== undefined && targetPatient.age <= 12) || clinicalRecord?.anamnesisData?.formType === 'child';
    
    // Find the skill to get its maxScore
    let skillMaxScore = 1;
    protocols.forEach(p => {
      p.data.forEach((domain: any) => {
        const skill = domain.skills.find((s: any) => s.name === title);
        if (skill) skillMaxScore = skill.maxScore || 1;
      });
    });

    // Normalize score for crianÃ§as if it's not already 0, 0.5 or 1
    let finalScore = score;
    if (isKid && skillMaxScore === 1 && ![0, 0.5, 1].includes(score)) {
      if (score >= 3) finalScore = 1;
      else if (score >= 1.5) finalScore = 0.5;
      else finalScore = 0;
    }

    const newId = Date.now();
    const newHistoryItem = {
      id: newId,
      patientId: pid,
      type: 'task',
      title: title,
      time: new Date().toLocaleTimeString(),
      score: finalScore,
      evalComment: evalComment || "",
      dateGroup: "Hoje",
      icon: "ðŸŽ¯"
    };
    
    // Add a note about the trial
    const noteText = `ðŸŽ¯ NOVO REGISTRO\nAtividade: ${title}\nPontuaÃ§Ã£o: ${finalScore}${evalComment ? `\nAnotaÃ§Ãµes do Profissional: ${evalComment}` : ""}`;
    handleAddNote(pid, noteText, 'private', 'SessÃ£o');

    onAddActivityLog("Registro de AvaliaÃ§Ã£o", `AvaliaÃ§Ã£o da habilidade "${title}" registrada para o paciente ID ${pid}. PontuaÃ§Ã£o: ${score}.`);

    // Sync to Backend
    const { dataService } = await import('./services/dataService');
    try {
      await dataService.addHistoryItem({
        patient_id: String(pid),
        patient_email: targetPatient?.email || null,
        type: 'task',
        title: title,
        score: finalScore,
        note: evalComment || "",
        icon: "ðŸŽ¯"
      });
    } catch (error) {
      console.error('Falha ao persistir registro de sessÃ£o:', error);
    }

    const updatedHistory = [newHistoryItem, ...history];
    setHistory(updatedHistory);

    const sourcePei = Array.isArray(clinicalRecord?.pei)
      ? clinicalRecord.pei
      : Array.isArray(targetPatient?.pei)
        ? targetPatient.pei
        : [];
    let updatedPei = sourcePei;

    if (isKid && sourcePei.length > 0) {
      const peiGoal = sourcePei.find((g: any) => g.name === title);
      const skillHistory = updatedHistory
        .filter((h: any) => h.patientId === pid && h.title === title && h.type === 'task' && (!peiGoal || h.id > peiGoal.id))
        .sort((a: any, b: any) => Number(b.id) - Number(a.id));

      let consecutiveCount = 0;
      for (const h of skillHistory) {
        if (h.score === 1) consecutiveCount += 1;
        else break;
      }

      const progress = Math.min(consecutiveCount * 20, 100);
      const isMastered = progress === 100;
      updatedPei = sourcePei.map((goal: any) =>
        goal.name === title
          ? { ...goal, status: isMastered ? 'completed' : 'in_progress', progress }
          : goal
      );

      if (isMastered && peiGoal?.status !== 'completed') {
        handleAddNote(
          pid,
          `â­ CRITÃ‰RIO DE MAESTRIA ATINGIDO!\nA habilidade "${title}" foi realizada de forma independente por 5 vezes consecutivas. Status atualizado para Adquirida.`,
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
    onAddActivityLog("ExclusÃ£o de Registro", `Registro de atividade "${item?.title}" (ID ${id}) excluÃ­do do histÃ³rico.`, 'system');
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
      const originalPatientName = patient?.name || `ID ${patientId}`;
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
        alert(String(result?.error || 'NÃ£o foi possÃ­vel persistir o compartilhamento da anotaÃ§Ã£o.'));
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

  const handleAddFamilyNote = async (pid: any, txt: string, image?: string, imagePath?: string) => {
    const identity = resolvePatientIdentityForPortal({ patientId: pid });
    const targetPatientId = String(identity.patientId || pid || user?.id || '').trim();
    // Evita duplicidade: família persiste via histórico clínico (fonte única de verdade).
    
    const newHistoryItem = {
      id: Date.now(),
      patientId: targetPatientId,
      type: image ? 'photo' : 'family_note',
      title: image ? "Foto enviada" : "Registro da Família",
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      note: txt,
      image: image,
      icon: image ? "📷" : "🏠",
      dateGroup: "Hoje",
      date: new Date().toISOString()
    };

    // Also add to history timeline
    setHistory(prev => [newHistoryItem, ...prev]);

    onAddActivityLog("Registro da Família", `Nova anotação da família adicionada para o paciente ID ${pid}.`);

    // Sync to Backend
    const { dataService } = await import('./services/dataService');
    const historySaveResult = await dataService.addHistoryItem({
      patient_id: targetPatientId,
      patient_email: identity.patientEmail,
      patient_name: identity.patientName,
      type: image ? 'photo' : 'family_note',
      title: image ? "Foto enviada" : "Registro da Família",
      note: txt,
      image: image,
      image_path: imagePath || null,
      icon: image ? "📷" : "🏠"
    });

    if (!historySaveResult?.success) {
      console.warn('[family-note] Falha ao persistir histórico da família:', historySaveResult);
      alert(`Registro salvo parcialmente. Não foi possível persistir a foto no histórico: ${historySaveResult?.error || 'erro desconhecido'}`);
      setHistory(prev => prev.filter((item: any) => item.id !== newHistoryItem.id));
    } else if (historySaveResult?.data?.id) {
      // Substitui ID temporário pelo ID persistido para não duplicar após rehidratação/sync.
      setHistory(prev =>
        prev.map((item: any) =>
          item.id === newHistoryItem.id ? { ...item, id: historySaveResult.data.id } : item
        )
      );
    }
  };

  const handleLogout = async () => {
    onAddActivityLog("Logout do Sistema", "O profissional encerrou a sessÃ£o com seguranÃ§a.", "system");
    try {
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
      if (supabase) await supabase.auth.signOut();
    } catch (error) {
      console.error('Logout error:', error);
    }
    setLastActiveWorkspaceId(null);
    resetWorkspaceScopedState();
    setClinicStateHydrated(false);
    setUser(null);
    setShowWorkspacePicker(false);
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

  return (
    <React.Fragment>
      <GlobalStyles />
      <Suspense fallback={lazyFallback}>
      
      {!user ? (
        isAuthActionRoute ? (
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
      ) : (user.role === 'therapist' || user.role === 'coordinator' || user.role === 'receptionist') && !clinicStateHydrated ? (
        <div className="min-h-screen flex items-center justify-center bg-white">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#7a32fc] mx-auto"></div>
            <p className="mt-4 text-sm text-slate-500">Carregando dados da clÃ­nica...</p>
          </div>
        </div>
      ) : ((user.role === 'therapist' || user.role === 'coordinator' || user.role === 'receptionist') && !user.firstLoginCompleted) || showOnboarding ? (
        <ProfessionalOnboarding 
          user={user} 
          onComplete={(data) => {
            setUser({ ...user, ...data, firstLoginCompleted: true });
            setShowOnboarding(false);
          }} 
          onClose={() => setShowOnboarding(false)}
        />
      ) : (user.role === 'therapist' || user.role === 'coordinator') && user.subscriptionStatus === 'pending' ? (
        <SubscriptionRequired user={user} onLogout={handleLogout} />
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
            if (user.role === 'patient') {
              return isPatientNote;
            }
            return (n.patientId === user.id || n?.patient_email === user.email) && isPatientNote;
          })} 
          protocols={protocols} 
          onAddFamilyNote={handleAddFamilyNote}
          isReadOnlyMode={patientIsReadOnlyMode}
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
            handleUpdateAgendaStatus(Number(agendaId), 'canceled');
          }}
          protocols={protocols}
          setProtocols={setProtocols}
          activityLogs={activityLogs}
          onAddActivityLog={onAddActivityLog}
          onScheduleSession={handleScheduleSession}
          onUpdateAppointment={handleUpdateAppointment}
          onUpdateAgendaStatus={handleUpdateAgendaStatus}
          onAddPatient={handleAddPatient}
          patientsHistory={history}
          therapistNotes={therapistNotes}
          onAddNote={handleAddNote}
          onUpdateProfile={(data: any) => {
            if (data.profilePicture !== undefined) setProfilePicture(data.profilePicture);
            if (data.crp !== undefined) setCrp(data.crp);
            const nextUser = { ...user, ...data };
            setUser(nextUser);
            dataService.saveUserProfile(user.id, {
              ...nextUser,
              workspace_id: String(user?.activeWorkspaceId || user?.clinicId || '').trim() || null,
            });
          }}
          onUpdatePatient={handleUpdatePatient}
          onRecordTrial={handleRecordTrial}
          onDeleteHistoryItem={handleDeleteHistoryItem}
          onEvaluateHistoryItem={handleUpdateHistoryItem}
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


