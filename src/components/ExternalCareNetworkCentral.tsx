import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Building2,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  LogOut,
  Search,
  ShieldCheck,
  Sparkles,
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
};
type ClinicGroup = { clinicId: string; clinicName: string; patients: PatientGroup[] };

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
      if (!clinic.patients.has(patientKey)) clinic.patients.set(patientKey, { patientId: row.patientId, patientName: row.patientName, items: [], latestAt: null, latestSenderName: null, senderNames: [], senderSet: new Set() });
      const patient = clinic.patients.get(patientKey)!;
      patient.items.push(row);
      const sender = String(row.senderName || '').trim();
      if (sender) patient.senderSet.add(sender);
      const candidate = String(row.itemUpdatedAt || row.sharedAt || '');
      if (candidate && (!patient.latestAt || new Date(candidate).getTime() > new Date(patient.latestAt).getTime())) {
        patient.latestAt = candidate;
        patient.latestSenderName = sender || null;
      }
    });
    return Array.from(clinics.values()).map((clinic) => ({
      clinicId: clinic.clinicId,
      clinicName: clinic.clinicName,
      patients: Array.from(clinic.patients.values()).map(({ senderSet, ...patient }) => ({ ...patient, senderNames: Array.from(senderSet) })),
    }));
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

  const openPatientTimeline = (clinicId: string, patientId: string) => {
    window.location.href = `/rede-de-cuidado/paciente/${encodeURIComponent(clinicId)}/${encodeURIComponent(patientId)}`;
  };

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

  return (
    <main className="min-h-screen bg-[#faf9fd]">
      <header className="border-b border-violet-100/70 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div><LogoVerto size={32} showText /><p className="mt-1 text-[11px] font-normal text-slate-400">Rede de cuidado</p></div>
          <button type="button" disabled={busy} onClick={() => void logout()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-600 transition hover:bg-slate-50"><LogOut size={15} /> Sair</button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-10">
        <section className="relative overflow-hidden rounded-[30px] bg-white px-5 py-7 shadow-[0_20px_70px_rgba(67,45,122,0.07)] ring-1 ring-violet-100/60 sm:px-8 sm:py-9">
          <div className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-violet-100/50 blur-3xl" aria-hidden="true" />
          <div className="relative max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1.5 text-[11px] font-medium text-[#7a32fc]"><Sparkles size={13} /> Seu espaço Verto</span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{firstName ? `Olá, ${firstName}.` : 'Olá.'}</h1>
            <p className="mt-2 text-sm font-normal leading-6 text-slate-500 sm:text-base">Tudo o que suas clínicas parceiras compartilharam com você, organizado em um só lugar.</p>
          </div>
        </section>

        <div className="mt-6 grid gap-5 md:grid-cols-[210px_minmax(0,1fr)]">
          <nav className="flex h-fit gap-1 overflow-x-auto rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-100 md:block">
            {([
              ['shared', 'Compartilhados comigo', FileText],
              ['notifications', 'Notificações', Bell],
              ['profile', 'Meu perfil', UserRound],
            ] as const).map(([key, label, Icon]) => <button key={key} type="button" onClick={() => { setTab(key); setError(''); setMessage(''); }} className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-left text-sm font-medium transition md:w-full ${tab === key ? 'bg-violet-50 text-[#7a32fc]' : 'text-slate-600 hover:bg-slate-50'}`}><Icon size={16} /> {label}</button>)}
          </nav>

          <section className="min-w-0">
            {error && <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-xs font-normal text-rose-700">{error}</p>}
            {message && <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-xs font-normal text-emerald-700">{message}</p>}

            {tab === 'shared' && <div>
              <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div><h2 className="text-xl font-semibold text-slate-900">Compartilhados comigo</h2><p className="mt-1 text-sm font-normal text-slate-500">Clínicas, pacientes e timelines disponíveis para a sua conta.</p></div>
              </div>

              <label className="relative mb-5 block">
                <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Buscar clínica, paciente ou profissional..." className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-11 text-sm outline-none transition focus:border-violet-300 focus:ring-4 focus:ring-violet-100/50" />
                {searchLoading && <Loader2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-[#7a32fc]" />}
              </label>

              {visibleGrouped.length === 0 ? <div className="rounded-[24px] border border-dashed border-slate-200 bg-white p-10 text-center"><Search size={24} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-medium text-slate-600">Nenhum resultado por aqui.</p><p className="mt-1 text-xs font-normal leading-5 text-slate-400">Tente buscar pelo nome da clínica, do paciente ou de quem compartilhou.</p></div> : <div className="space-y-3">{visibleGrouped.map((clinic) => {
                const expanded = expandedClinics.has(clinic.clinicId);
                return <section key={clinic.clinicId} className="overflow-hidden rounded-[24px] bg-white shadow-sm ring-1 ring-slate-100">
                  <button type="button" onClick={() => toggleClinic(clinic.clinicId)} className="flex w-full items-center gap-4 px-4 py-4 text-left transition hover:bg-violet-50/35 sm:px-5">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-[#7a32fc]"><Building2 size={19} /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-900">{clinic.clinicName}</span><span className="mt-0.5 block text-xs font-normal text-slate-500">{clinic.patients.length} {clinic.patients.length === 1 ? 'paciente compartilhado' : 'pacientes compartilhados'}</span></span>
                    <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-slate-50 px-2 text-xs font-medium text-slate-500">{clinic.patients.length}</span>
                    <ChevronDown size={17} className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                  </button>
                  {expanded && <div className="border-t border-slate-100 px-3 py-3 sm:px-4">{clinic.patients.map((patient) => <button key={patient.patientId} type="button" onClick={() => openPatientTimeline(clinic.clinicId, patient.patientId)} className="group flex w-full items-center gap-3 rounded-2xl px-3 py-3.5 text-left transition hover:bg-violet-50/60">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-500 transition group-hover:bg-white group-hover:text-[#7a32fc]"><FileText size={17} /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800">{patient.patientName}</span><span className="mt-0.5 block text-[11px] font-normal text-slate-500">{patient.items.length} {patient.items.length === 1 ? 'evolução' : 'evoluções'} · {formatFriendlyUpdate(patient.latestAt)}</span>{patient.latestSenderName && <span className="mt-0.5 block truncate text-[11px] font-normal text-slate-400">Compartilhado por {patient.latestSenderName}</span>}</span>
                    <span className="hidden text-xs font-medium text-[#7a32fc] sm:block">Abrir timeline</span><ChevronRight size={16} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#7a32fc]" />
                  </button>)}</div>}
                </section>;
              })}</div>}

              {nextOffset !== null && !searchTerm.trim() && <div className="mt-5 flex justify-center"><button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await loadShared(nextOffset, true); } catch (loadError: any) { setError(loadError?.message || 'Não foi possível carregar mais compartilhamentos.'); } finally { setBusy(false); } }} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : null} Carregar mais</button></div>}
            </div>}

            {tab === 'notifications' && <div><div className="mb-5"><h2 className="text-xl font-semibold text-slate-900">Notificações</h2><p className="mt-1 text-sm font-normal text-slate-500">Compartilhamentos recentes enviados para sua conta.</p></div><div className="space-y-2">{rows.length === 0 ? <div className="rounded-[24px] border border-dashed border-slate-200 bg-white p-10 text-center text-sm font-normal text-slate-500">Nenhuma notificação recente.</div> : rows.map((item) => <button key={item.grantId} type="button" onClick={() => openPatientTimeline(item.clinicId, item.patientId)} className="flex w-full items-start gap-3 rounded-[22px] bg-white p-4 text-left shadow-sm ring-1 ring-slate-100 transition hover:ring-violet-200"><span className="rounded-xl bg-violet-50 p-2 text-[#7a32fc]"><Bell size={15} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-800">Novo conteúdo compartilhado</span><span className="mt-1 block text-xs font-normal text-slate-500">{item.clinicName} · {item.patientName}</span>{item.senderName && <span className="mt-1 block text-[11px] font-normal text-slate-400">Compartilhado por {item.senderName}</span>}<span className="mt-1 block text-[11px] font-normal text-slate-400">{item.subject || 'Evolução clínica'} · {formatDateTime(item.sharedAt)}</span></span></button>)}</div></div>}

            {tab === 'profile' && <div className="rounded-[26px] bg-white p-5 shadow-sm ring-1 ring-slate-100 sm:p-6"><h2 className="text-xl font-semibold text-slate-900">Meu perfil</h2><p className="mt-1 text-sm font-normal text-slate-500">Sua conta é única para todos os compartilhamentos enviados ao mesmo e-mail.</p><div className="mt-6 max-w-lg space-y-4"><label className="block"><span className="text-xs font-medium text-slate-600">E-mail</span><input value={profile.email} readOnly className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500" /></label><label className="block"><span className="text-xs font-medium text-slate-600">Nome</span><input value={displayName} maxLength={180} onChange={(event) => setDisplayName(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition focus:border-[#7a32fc]" /></label><button type="button" disabled={busy || !displayName.trim()} onClick={() => void saveProfile()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : null} Salvar</button></div></div>}
          </section>
        </div>
      </div>
    </main>
  );
};
