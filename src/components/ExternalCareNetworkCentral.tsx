import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Building2,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  LogOut,
  Menu,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { LogoVerto } from './Common';
import { GoogleIcon } from './GoogleIcon';
import { getSupabase } from '../lib/supabase';

type SharedRow = {
  grantId: string;
  publicId: string;
  clinicId: string;
  clinicName: string;
  patientId: string;
  patientName: string;
  timelineItemId: string;
  monthKey?: string | null;
  subject?: string | null;
  canComment?: boolean;
  firstViewedAt?: string | null;
  lastViewedAt?: string | null;
  viewCount?: number;
  commentCount?: number;
  sharedAt?: string | null;
  itemUpdatedAt?: string | null;
  senderName?: string | null;
};

type Profile = { email: string; displayName?: string | null };
type Tab = 'shared' | 'notifications' | 'profile';
type PatientGroup = {
  patientId: string;
  patientName: string;
  items: SharedRow[];
  latestAt: string | null;
  latestSenderName: string | null;
  senderNames: string[];
  unreadCount: number;
  latestUnreadAt: string | null;
  latestUnreadMonth: string | null;
};
type ClinicGroup = { clinicId: string; clinicName: string; patients: PatientGroup[]; unreadCount: number };

const safeJson = async (response: Response) => {
  try { return await response.json(); } catch { return { success: false, error: `Falha HTTP ${response.status}` }; }
};

const formatDateTime = (value: unknown) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
};

const formatFriendlyUpdate = (value: unknown) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return 'Atualização sem data informada';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return `Atualizado hoje, ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date)}`;
  return `Atualizado em ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date)}`;
};

const normalizeSearch = (value: unknown) => String(value || '').trim().toLocaleLowerCase('pt-BR');

export const ExternalCareNetworkCentral = () => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<SharedRow[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('shared');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHydrated, setSearchHydrated] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedClinics, setExpandedClinics] = useState<Set<string>>(new Set());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const hasNextPage = nextOffset !== null;

  const fetchSharedPage = async (offset = 0) => {
    const response = await fetch(`/api/external/care-network/shared?limit=100&offset=${Math.max(0, offset)}`, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const result = await safeJson(response);
    if (!response.ok || !result?.success) throw new Error(result?.error || 'Não foi possível carregar seus compartilhamentos.');
    const items = Array.isArray(result.data?.items) ? result.data.items as SharedRow[] : [];
    const parsedNext = Number(result.data?.nextOffset);
    return {
      items,
      nextOffset: Number.isFinite(parsedNext) && parsedNext >= 0 ? parsedNext : null,
    };
  };

  const loadShared = async (offset = 0, append = false) => {
    const page = await fetchSharedPage(offset);
    setRows((current) => append ? [...current, ...page.items] : page.items);
    setNextOffset(page.nextOffset);
  };

  const loadAllSharedForSearch = async () => {
    if (searchHydrated || searchLoading || nextOffset === null) return;
    setSearchLoading(true);
    try {
      const merged = new Map<string, SharedRow>(rows.map((row) => [row.grantId, row]));
      let cursor: number | null = nextOffset;
      let pages = 0;
      while (cursor !== null && pages < 100) {
        const page = await fetchSharedPage(cursor);
        page.items.forEach((row) => merged.set(row.grantId, row));
        cursor = page.nextOffset;
        pages += 1;
      }
      setRows(Array.from(merged.values()));
      setNextOffset(cursor);
      setSearchHydrated(cursor === null);
    } catch (loadError: any) {
      setError(loadError?.message || 'Não foi possível completar a busca agora.');
    } finally {
      setSearchLoading(false);
    }
  };

  const bootstrap = async () => {
    setLoading(true); setError('');
    try {
      const meResponse = await fetch('/api/external/auth/me', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
      let me = await safeJson(meResponse);
      let resolvedMeResponse = meResponse;
      const query = new URLSearchParams(window.location.search);
      const isPartnerOauthReturn = query.get('partner_oauth') === '1';

      if ((!meResponse.ok || !me?.success) && isPartnerOauthReturn) {
        try {
          const supabase = await getSupabase();
          const sessionResult = await supabase.auth.getSession();
          const session = sessionResult.data?.session || null;
          if (session?.access_token) {
            const bridgeResponse = await fetch('/api/external/auth/session', {
              method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ accessToken: session.access_token }),
            });
            const bridge = await safeJson(bridgeResponse);
            if (bridgeResponse.ok && bridge?.success) {
              resolvedMeResponse = await fetch('/api/external/auth/me', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
              me = await safeJson(resolvedMeResponse);
            }
          }
        } catch { /* explicit password login remains available */ }
        query.delete('partner_oauth');
        const nextQuery = query.toString();
        window.history.replaceState({}, document.title, `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`);
      }

      if (!resolvedMeResponse.ok || !me?.success) { setProfile(null); setRows([]); setNextOffset(null); return; }
      const nextProfile = { email: String(me.data?.email || ''), displayName: String(me.data?.displayName || '') || null };
      setProfile(nextProfile);
      setDisplayName(nextProfile.displayName || '');
      await loadShared();
    } catch (loadError: any) {
      setError(loadError?.message || 'Não foi possível carregar sua Central.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void bootstrap(); }, []);

  useEffect(() => {
    if (normalizeSearch(searchTerm).length < 2 || nextOffset === null || searchHydrated) return;
    const timer = window.setTimeout(() => { void loadAllSharedForSearch(); }, 280);
    return () => window.clearTimeout(timer);
  }, [searchTerm, nextOffset, searchHydrated, rows.length]);

  const login = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/external/auth/login', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const result = await safeJson(response);
      if (!response.ok || !result?.success) throw new Error(result?.error || 'E-mail ou senha inválidos.');
      setPassword('');
      await bootstrap();
    } catch (loginError: any) { setError(loginError?.message || 'Não foi possível entrar.'); }
    finally { setBusy(false); }
  };

  const loginWithGoogle = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const supabase = await getSupabase();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/rede-de-cuidado?partner_oauth=1`,
          scopes: 'https://www.googleapis.com/auth/userinfo.email',
          queryParams: { prompt: 'select_account', ...(email.trim() ? { login_hint: email.trim().toLowerCase() } : {}) },
        },
      });
      if (oauthError) throw oauthError;
    } catch (oauthError: any) {
      setError(oauthError?.message || 'Não foi possível iniciar o acesso com Google.');
      setBusy(false);
    }
  };

  const requestPasswordRecovery = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      await fetch('/api/auth/password/recovery/email/request', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setMessage('Se este e-mail estiver cadastrado, enviaremos instruções para recuperar o acesso.');
    } catch {
      setMessage('Se este e-mail estiver cadastrado, enviaremos instruções para recuperar o acesso.');
    } finally { setBusy(false); }
  };

  const logout = async () => {
    setBusy(true); setError('');
    try {
      await fetch('/api/external/auth/logout', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
      try { const supabase = await getSupabase(); await supabase.auth.signOut(); } catch { /* external server session is already cleared */ }
      setProfile(null); setRows([]); setNextOffset(null); setTab('shared'); setEmail(''); setPassword(''); setMessage(''); setSearchTerm(''); setSearchHydrated(false);
    } finally { setBusy(false); }
  };

  const saveProfile = async () => {
    const name = displayName.trim();
    if (!name) { setError('Informe seu nome.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/external/auth/me', {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ displayName: name }),
      });
      const result = await safeJson(response);
      if (!response.ok || !result?.success) throw new Error(result?.error || 'Não foi possível atualizar seu perfil.');
      setProfile({ email: String(result.data?.email || profile?.email || ''), displayName: String(result.data?.displayName || name) });
      setMessage('Perfil atualizado.');
    } catch (profileError: any) { setError(profileError?.message || 'Não foi possível atualizar seu perfil.'); }
    finally { setBusy(false); }
  };

  const grouped = useMemo<ClinicGroup[]>(() => {
    const clinics = new Map<string, { clinicId: string; clinicName: string; patients: Map<string, PatientGroup & { senderSet: Set<string> }> }>();
    rows.forEach((row) => {
      const clinicKey = `${row.clinicId}:${row.clinicName}`;
      if (!clinics.has(clinicKey)) clinics.set(clinicKey, { clinicId: row.clinicId, clinicName: row.clinicName, patients: new Map() });
      const clinic = clinics.get(clinicKey)!;
      const patientKey = `${row.patientId}:${row.patientName}`;
      if (!clinic.patients.has(patientKey)) clinic.patients.set(patientKey, { patientId: row.patientId, patientName: row.patientName, items: [], latestAt: null, latestSenderName: null, senderNames: [], senderSet: new Set(), unreadCount: 0, latestUnreadAt: null, latestUnreadMonth: null });
      const patient = clinic.patients.get(patientKey)!;
      patient.items.push(row);
      const sender = String(row.senderName || '').trim();
      if (sender) patient.senderSet.add(sender);
      const candidate = String(row.itemUpdatedAt || row.sharedAt || '');
      if (candidate && (!patient.latestAt || new Date(candidate).getTime() > new Date(patient.latestAt).getTime())) {
        patient.latestAt = candidate;
        patient.latestSenderName = sender || null;
      }
      if (!row.firstViewedAt) {
        patient.unreadCount += 1;
        const unreadCandidate = String(row.sharedAt || row.itemUpdatedAt || '');
        if (unreadCandidate && (!patient.latestUnreadAt || new Date(unreadCandidate).getTime() > new Date(patient.latestUnreadAt).getTime())) {
          patient.latestUnreadAt = unreadCandidate;
          patient.latestUnreadMonth = String(row.monthKey || '').slice(0, 7) || null;
        }
      }
    });
    return Array.from(clinics.values()).map((clinic) => {
      const patients = Array.from(clinic.patients.values())
        .map(({ senderSet, ...patient }) => ({ ...patient, senderNames: Array.from(senderSet) }))
        .sort((left, right) => {
          if ((right.unreadCount > 0 ? 1 : 0) !== (left.unreadCount > 0 ? 1 : 0)) return (right.unreadCount > 0 ? 1 : 0) - (left.unreadCount > 0 ? 1 : 0);
          const rightTime = new Date(right.unreadCount > 0 ? (right.latestUnreadAt || right.latestAt || 0) : (right.latestAt || 0)).getTime();
          const leftTime = new Date(left.unreadCount > 0 ? (left.latestUnreadAt || left.latestAt || 0) : (left.latestAt || 0)).getTime();
          return rightTime - leftTime;
        });
      return { clinicId: clinic.clinicId, clinicName: clinic.clinicName, patients, unreadCount: patients.reduce((total, patient) => total + patient.unreadCount, 0) };
    }).sort((left, right) => (right.unreadCount > 0 ? 1 : 0) - (left.unreadCount > 0 ? 1 : 0));
  }, [rows]);

  const visibleGrouped = useMemo(() => {
    const query = normalizeSearch(searchTerm);
    if (!query) return grouped;
    return grouped.flatMap((clinic) => {
      const clinicMatch = normalizeSearch(clinic.clinicName).includes(query);
      const patients = clinic.patients.filter((patient) => clinicMatch || normalizeSearch(patient.patientName).includes(query) || patient.senderNames.some((name) => normalizeSearch(name).includes(query)));
      return patients.length ? [{ ...clinic, patients }] : [];
    });
  }, [grouped, searchTerm]);

  useEffect(() => {
    if (!visibleGrouped.length) return;
    if (normalizeSearch(searchTerm)) {
      setExpandedClinics(new Set(visibleGrouped.map((clinic) => clinic.clinicId)));
      return;
    }
    setExpandedClinics((current) => current.size ? current : new Set([visibleGrouped[0].clinicId]));
  }, [searchTerm, grouped.length]);

  const openPatientTimeline = (clinicId: string, patientId: string, monthKey?: string | null) => {
    const normalizedMonth = String(monthKey || '').match(/^\d{4}-\d{2}/)?.[0] || '';
    window.location.href = `/rede-de-cuidado/paciente/${encodeURIComponent(clinicId)}/${encodeURIComponent(patientId)}${normalizedMonth ? `?month=${encodeURIComponent(normalizedMonth)}` : ''}`;
  };

  const unreadRows = useMemo(() => rows.filter((row) => !row.firstViewedAt).slice().sort((left, right) => new Date(right.sharedAt || right.itemUpdatedAt || 0).getTime() - new Date(left.sharedAt || left.itemUpdatedAt || 0).getTime()), [rows]);
  const unreadCount = unreadRows.length;

  const toggleClinic = (clinicId: string) => {
    setExpandedClinics((current) => {
      const next = new Set(current);
      if (next.has(clinicId)) next.delete(clinicId); else next.add(clinicId);
      return next;
    });
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#faf9fd] px-4 py-8 sm:py-12">
        <section className="mx-auto max-w-5xl">
          <div className="h-10 w-40 animate-pulse rounded-xl bg-slate-200/70" />
          <div className="mt-10 h-9 w-72 animate-pulse rounded-xl bg-slate-200/70" />
          <div className="mt-3 h-5 w-full max-w-lg animate-pulse rounded-lg bg-slate-200/60" />
          <div className="mt-8 space-y-4">{[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-[24px] bg-white shadow-sm ring-1 ring-slate-100" />)}</div>
        </section>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#faf9fd] px-4 py-8 sm:py-14">
        <section className="w-full max-w-md rounded-[32px] bg-white p-6 shadow-[0_24px_80px_rgba(60,38,115,0.10)] ring-1 ring-violet-100/70 sm:p-8">
          <LogoVerto size={38} showText />
          <div className="mt-8">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#7a32fc]">Rede de cuidado</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Acesso do profissional parceiro</h1>
            <p className="mt-2 text-sm font-normal leading-6 text-slate-500">Entre para acessar, em um só lugar, os conteúdos compartilhados por clínicas que utilizam a Verto.</p>
          </div>
          <div className="mt-7 space-y-4">
            <label className="block"><span className="text-xs font-medium text-slate-600">E-mail</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition focus:border-[#7a32fc]" /></label>
            <label className="block"><span className="text-xs font-medium text-slate-600">Senha</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void login(); }} className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition focus:border-[#7a32fc]" /></label>
            {error && <p className="rounded-xl bg-rose-50 px-3 py-2.5 text-xs font-normal text-rose-700">{error}</p>}
            <button type="button" disabled={busy || !email.trim() || !password} onClick={() => void login()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-sm font-medium text-white shadow-lg shadow-violet-500/15 transition hover:opacity-95 disabled:opacity-50">{busy ? <Loader2 size={17} className="animate-spin" /> : null} Entrar</button>
            <button type="button" disabled={busy || !email.trim()} onClick={() => void requestPasswordRecovery()} className="w-full text-center text-xs font-medium text-[#7a32fc] hover:underline disabled:opacity-50">Esqueci minha senha</button>
            <div className="flex items-center gap-3 py-1 text-[10px] uppercase tracking-wider text-slate-400"><span className="h-px flex-1 bg-slate-200" /><span>ou</span><span className="h-px flex-1 bg-slate-200" /></div>
            <button type="button" disabled={busy} onClick={() => void loginWithGoogle()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"><GoogleIcon className="h-4 w-4" /> Continuar com Google</button>
            {message && <p className="rounded-xl bg-emerald-50 px-3 py-2.5 text-xs font-normal text-emerald-700">{message}</p>}
          </div>
        </section>
      </main>
    );
  }

  const firstName = String(profile.displayName || '').trim().split(/\s+/)[0] || '';

  const notificationList = (
    <div className="space-y-2">
      {unreadRows.length === 0 ? (
        <div className="rounded-2xl bg-slate-50 px-4 py-6 text-center"><Bell size={20} className="mx-auto text-slate-300" /><p className="mt-2 text-sm font-medium text-slate-600">Tudo visto por aqui</p><p className="mt-1 text-xs text-slate-400">Novos compartilhamentos aparecem aqui até a primeira visualização.</p></div>
      ) : unreadRows.slice(0, 12).map((item) => (
        <button key={item.grantId} type="button" onClick={() => openPatientTimeline(item.clinicId, item.patientId, item.monthKey)} className="flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><FileText size={14} /></span>
          <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-slate-800">Novo conteúdo</span><span className="mt-0.5 block truncate text-[11px] text-slate-500">{item.clinicName} · {item.patientName}</span><span className="mt-0.5 block truncate text-[11px] text-slate-400">{item.subject || 'Evolução compartilhada'}{item.sharedAt ? ` · ${formatDateTime(item.sharedAt)}` : ''}</span></span>
        </button>
      ))}
    </div>
  );

  return (
    <main className="min-h-screen bg-[#faf9fd]">
      <header className="sticky top-0 z-30 border-b border-violet-100/70 bg-white/95 backdrop-blur-md">
        <div className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div><LogoVerto size={29} showText /><p className="mt-0.5 text-[10px] text-slate-400">Rede de cuidado</p></div>
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <button type="button" onClick={() => setNotificationsOpen((current) => !current)} aria-label={`Notificações${unreadCount ? `, ${unreadCount} novas` : ''}`} aria-expanded={notificationsOpen} className="relative flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-violet-50 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
                <Bell size={18} />
                {unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-bold text-white ring-2 ring-white">{Math.min(99, unreadCount)}</span>}
              </button>
              {notificationsOpen && <div className="absolute right-0 top-12 z-40 w-[min(360px,calc(100vw-2rem))] rounded-[22px] border border-violet-100 bg-white p-3 shadow-[0_24px_70px_rgba(49,32,92,.16)]"><div className="mb-2 flex items-center justify-between px-2"><div><p className="text-xs font-semibold text-slate-800">Notificações</p><p className="text-[10px] text-slate-400">Conteúdos ainda não visualizados</p></div>{unreadCount > 0 && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">{unreadCount} {unreadCount === 1 ? 'novo' : 'novos'}</span>}</div>{notificationList}</div>}
            </div>
            <button type="button" onClick={() => setMobileMenuOpen((current) => !current)} aria-label="Abrir menu" aria-expanded={mobileMenuOpen} className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 md:hidden"><Menu size={19} /></button>
          </div>
        </div>
        {mobileMenuOpen && <div className="border-t border-slate-100 bg-white px-4 py-3 md:hidden"><div className="mx-auto max-w-6xl space-y-1">
          <button type="button" onClick={() => { setTab('shared'); setMobileMenuOpen(false); }} className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-medium ${tab === 'shared' ? 'bg-violet-50 text-violet-700' : 'text-slate-600'}`}><FileText size={16} /> Compartilhados comigo</button>
          <button type="button" onClick={() => { setTab('notifications'); setMobileMenuOpen(false); }} className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-medium ${tab === 'notifications' ? 'bg-violet-50 text-violet-700' : 'text-slate-600'}`}><Bell size={16} /> Notificações {unreadCount > 0 && <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">{unreadCount}</span>}</button>
          <button type="button" onClick={() => { setTab('profile'); setMobileMenuOpen(false); }} className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-medium ${tab === 'profile' ? 'bg-violet-50 text-violet-700' : 'text-slate-600'}`}><UserRound size={16} /> Meu perfil</button>
          <button type="button" disabled={busy} onClick={() => void logout()} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-medium text-rose-600 hover:bg-rose-50"><LogOut size={16} /> {busy ? 'Saindo...' : 'Sair'}</button>
        </div></div>}
      </header>

      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-7">
        <section className="relative overflow-hidden rounded-[26px] bg-white px-5 py-4 shadow-[0_18px_55px_rgba(67,45,122,0.06)] ring-1 ring-violet-100/60 sm:px-7 sm:py-5">
          <div className="absolute -right-16 -top-24 h-44 w-44 rounded-full bg-violet-100/50 blur-3xl" aria-hidden="true" />
          <div className="relative"><h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{firstName ? `Olá, ${firstName}.` : 'Olá.'}</h1><p className="mt-1 text-sm text-slate-500">Seus compartilhamentos, organizados em um só lugar.</p></div>
        </section>

        <div className="mt-5 grid gap-5 md:grid-cols-[205px_minmax(0,1fr)]">
          <nav className="hidden min-h-[440px] flex-col rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-100 md:flex" aria-label="Navegação da Rede de cuidado">
            <button type="button" onClick={() => { setTab('shared'); setError(''); setMessage(''); }} className={`flex min-h-11 items-center gap-2 rounded-xl px-3 text-left text-sm font-medium transition ${tab === 'shared' ? 'bg-violet-50 text-[#7a32fc]' : 'text-slate-600 hover:bg-slate-50'}`}><FileText size={16} /> Compartilhados comigo</button>
            <button type="button" onClick={() => { setTab('profile'); setError(''); setMessage(''); }} className={`flex min-h-11 items-center gap-2 rounded-xl px-3 text-left text-sm font-medium transition ${tab === 'profile' ? 'bg-violet-50 text-[#7a32fc]' : 'text-slate-600 hover:bg-slate-50'}`}><UserRound size={16} /> Meu perfil</button>
            <div className="flex-1" />
            <button type="button" disabled={busy} onClick={() => void logout()} className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-left text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"><LogOut size={16} /> {busy ? 'Saindo...' : 'Sair'}</button>
          </nav>

          <section className="min-w-0">
            {error && <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</p>}
            {message && <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-xs text-emerald-700">{message}</p>}

            {tab === 'shared' && <div>
              <div className="mb-4"><h2 className="text-xl font-semibold text-slate-900">Compartilhados comigo</h2><p className="mt-1 text-sm text-slate-500">Clínicas, pacientes e timelines disponíveis para a sua conta.</p></div>
              <label className="relative mb-5 block"><Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Buscar clínica, paciente ou profissional..." className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-11 text-sm outline-none transition focus:border-violet-300 focus:ring-4 focus:ring-violet-100/50" />{searchLoading && <Loader2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-[#7a32fc]" />}</label>

              {visibleGrouped.length === 0 ? <div className="rounded-[24px] border border-dashed border-slate-200 bg-white p-10 text-center"><Search size={24} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-medium text-slate-600">Nenhum resultado por aqui.</p><p className="mt-1 text-xs leading-5 text-slate-400">Tente buscar pelo nome da clínica, do paciente ou de quem compartilhou.</p></div> : <div className="space-y-3">{visibleGrouped.map((clinic) => {
                const expanded = expandedClinics.has(clinic.clinicId);
                return <section key={clinic.clinicId} className="overflow-hidden rounded-[24px] bg-white shadow-sm ring-1 ring-slate-100">
                  <button type="button" onClick={() => toggleClinic(clinic.clinicId)} aria-expanded={expanded} className="flex w-full items-center gap-4 px-4 py-4 text-left transition hover:bg-violet-50/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-300 sm:px-5">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-[#7a32fc]"><Building2 size={19} /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-900">{clinic.clinicName}</span><span className="mt-0.5 block text-xs text-slate-500">{clinic.patients.length} {clinic.patients.length === 1 ? 'paciente compartilhado' : 'pacientes compartilhados'}</span></span>
                    {clinic.unreadCount > 0 ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">{clinic.unreadCount} {clinic.unreadCount === 1 ? 'novo' : 'novos'}</span> : <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-slate-50 px-2 text-xs font-medium text-slate-500">{clinic.patients.length}</span>}
                    <ChevronDown size={17} className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                  </button>
                  {expanded && <div className="border-t border-slate-100 px-3 py-3 sm:px-4">{clinic.patients.map((patient) => <button key={patient.patientId} type="button" onClick={() => openPatientTimeline(clinic.clinicId, patient.patientId, patient.latestUnreadMonth)} className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${patient.unreadCount > 0 ? 'border-l-2 border-emerald-400 bg-emerald-50/45 hover:bg-emerald-50/70' : 'hover:bg-violet-50/60'}`}>
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${patient.unreadCount > 0 ? 'bg-white text-emerald-600 shadow-sm' : 'bg-slate-50 text-slate-500 group-hover:bg-white group-hover:text-[#7a32fc]'}`}><FileText size={17} /></span>
                    <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium text-slate-800">{patient.patientName}</span>{patient.unreadCount > 0 && <span className="rounded-full bg-emerald-100/80 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700">Novo · {patient.unreadCount}</span>}</span><span className="mt-0.5 block text-[11px] text-slate-500">{patient.items.length} {patient.items.length === 1 ? 'evolução' : 'evoluções'} · {formatFriendlyUpdate(patient.latestAt)}</span>{patient.latestSenderName && <span className="mt-0.5 block truncate text-[11px] text-slate-400">Compartilhado por {patient.latestSenderName}</span>}</span>
                    <ChevronRight size={16} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#7a32fc]" />
                  </button>)}</div>}
                </section>;
              })}</div>}

              {hasNextPage && !searchTerm.trim() && <div className="mt-5 flex justify-center"><button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await loadShared(nextOffset, true); } catch (loadError: any) { setError(loadError?.message || 'Não foi possível carregar mais compartilhamentos.'); } finally { setBusy(false); } }} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : null} {busy ? 'Carregando...' : 'Carregar mais'}</button></div>}
            </div>}

            {tab === 'notifications' && <div><div className="mb-5"><h2 className="text-xl font-semibold text-slate-900">Notificações</h2><p className="mt-1 text-sm text-slate-500">Conteúdos ativos que você ainda não visualizou.</p></div>{notificationList}</div>}

            {tab === 'profile' && <div className="rounded-[26px] bg-white p-5 shadow-sm ring-1 ring-slate-100 sm:p-6"><h2 className="text-xl font-semibold text-slate-900">Meu perfil</h2><p className="mt-1 text-sm text-slate-500">Sua conta é única para todos os compartilhamentos enviados ao mesmo e-mail.</p><div className="mt-6 max-w-lg space-y-4"><label className="block"><span className="text-xs font-medium text-slate-600">E-mail</span><input value={profile.email} readOnly className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500" /></label><label className="block"><span className="text-xs font-medium text-slate-600">Nome</span><input value={displayName} maxLength={180} onChange={(event) => setDisplayName(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition focus:border-[#7a32fc]" /></label><button type="button" disabled={busy || !displayName.trim()} onClick={() => void saveProfile()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : message === 'Perfil atualizado.' ? <ShieldCheck size={16} /> : null} {busy ? 'Salvando...' : message === 'Perfil atualizado.' ? 'Salvo' : 'Salvar'}</button></div></div>}
          </section>
        </div>
      </div>
    </main>
  );

};
