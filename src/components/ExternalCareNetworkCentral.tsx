import React, { useEffect, useMemo, useState } from 'react';
import { Bell, ChevronRight, FileText, Loader2, LogOut, MessageCircle, ShieldCheck, UserRound } from 'lucide-react';
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
};

type Profile = { email: string; displayName?: string | null };
type Tab = 'shared' | 'notifications' | 'profile';

const safeJson = async (response: Response) => {
  try { return await response.json(); } catch { return { success: false, error: `Falha HTTP ${response.status}` }; }
};

const formatDateTime = (value: unknown) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
};

export const ExternalCareNetworkCentral = () => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<SharedRow[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('shared');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadShared = async (offset = 0, append = false) => {
    const response = await fetch(`/api/external/care-network/shared?limit=40&offset=${Math.max(0, offset)}`, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
    const result = await safeJson(response);
    if (!response.ok || !result?.success) throw new Error(result?.error || 'Não foi possível carregar seus compartilhamentos.');
    const items = Array.isArray(result.data?.items) ? result.data.items : [];
    setRows((current) => append ? [...current, ...items] : items);
    const parsedNext = Number(result.data?.nextOffset);
    setNextOffset(Number.isFinite(parsedNext) && parsedNext >= 0 ? parsedNext : null);
  };

  const bootstrap = async () => {
    setLoading(true); setError('');
    try {
      const meResponse = await fetch('/api/external/auth/me', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
      let me = await safeJson(meResponse);
      let resolvedMeResponse = meResponse;
      if (!meResponse.ok || !me?.success) {
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
        } catch { /* password login remains available */ }
      }
      if (!resolvedMeResponse.ok || !me?.success) { setProfile(null); setRows([]); return; }
      const nextProfile = { email: String(me.data?.email || ''), displayName: String(me.data?.displayName || '') || null };
      setProfile(nextProfile);
      setDisplayName(nextProfile.displayName || '');
      await loadShared();
    } catch (loadError: any) {
      setError(loadError?.message || 'Não foi possível carregar sua Central.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void bootstrap(); }, []);

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
          redirectTo: `${window.location.origin}/rede-de-cuidado`,
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
      setMessage('Se este e-mail estiver cadastrado para acesso por senha, enviaremos instruções.');
    } catch {
      setMessage('Se este e-mail estiver cadastrado para acesso por senha, enviaremos instruções.');
    } finally { setBusy(false); }
  };

  const logout = async () => {
    setBusy(true); setError('');
    try {
      await fetch('/api/external/auth/logout', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
      try { const supabase = await getSupabase(); await supabase.auth.signOut(); } catch { /* external server session is already cleared */ }
      setProfile(null); setRows([]); setNextOffset(null); setTab('shared'); setEmail(''); setPassword(''); setMessage('');
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

  const grouped = useMemo(() => {
    const clinics = new Map<string, { clinicId: string; clinicName: string; patients: Map<string, { patientId: string; patientName: string; items: SharedRow[]; latestAt: string | null }> }>();
    rows.forEach((row) => {
      const clinicKey = `${row.clinicId}:${row.clinicName}`;
      if (!clinics.has(clinicKey)) clinics.set(clinicKey, { clinicId: row.clinicId, clinicName: row.clinicName, patients: new Map() });
      const clinic = clinics.get(clinicKey)!;
      const patientKey = `${row.patientId}:${row.patientName}`;
      if (!clinic.patients.has(patientKey)) clinic.patients.set(patientKey, { patientId: row.patientId, patientName: row.patientName, items: [], latestAt: null });
      const patient = clinic.patients.get(patientKey)!;
      patient.items.push(row);
      const candidate = String(row.itemUpdatedAt || row.sharedAt || '');
      if (candidate && (!patient.latestAt || new Date(candidate).getTime() > new Date(patient.latestAt).getTime())) patient.latestAt = candidate;
    });
    return Array.from(clinics.values()).map((clinic) => ({ ...clinic, patients: Array.from(clinic.patients.values()) }));
  }, [rows]);

  const openPatientTimeline = (clinicId: string, patientId: string) => {
    window.location.href = `/rede-de-cuidado/paciente/${encodeURIComponent(clinicId)}/${encodeURIComponent(patientId)}`;
  };

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50"><div className="flex items-center gap-3 text-sm font-medium text-slate-500"><Loader2 size={20} className="animate-spin text-[#7a32fc]" /> Carregando sua Rede de cuidado...</div></main>;
  }

  if (!profile) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 sm:py-14">
        <section className="mx-auto w-full max-w-md rounded-[30px] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-8">
          <LogoVerto size={36} showText />
          <div className="mt-8 rounded-2xl bg-violet-50 p-4 text-violet-800"><ShieldCheck size={20} /><p className="mt-2 text-sm font-semibold">Verto — Rede de cuidado</p><p className="mt-1 text-xs leading-5 text-violet-700">Entre com a mesma conta usada para acessar conteúdos clínicos compartilhados com seu e-mail.</p></div>
          <div className="mt-6 space-y-4">
            <label className="block"><span className="text-xs font-medium text-slate-600">E-mail</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#7a32fc]" /></label>
            <label className="block"><span className="text-xs font-medium text-slate-600">Senha</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void login(); }} className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#7a32fc]" /></label>
            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>}
            <button type="button" disabled={busy || !email.trim() || !password} onClick={() => void login()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={17} className="animate-spin" /> : null} Entrar</button>
            <div className="flex items-center gap-3 py-1 text-[10px] uppercase tracking-wider text-slate-400"><span className="h-px flex-1 bg-slate-200" /><span>ou</span><span className="h-px flex-1 bg-slate-200" /></div>
            <button type="button" disabled={busy} onClick={() => void loginWithGoogle()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><GoogleIcon className="h-4 w-4" /> Continuar com Google</button>
            <button type="button" disabled={busy || !email.trim()} onClick={() => void requestPasswordRecovery()} className="w-full text-center text-xs font-medium text-[#7a32fc] hover:underline disabled:opacity-50">Definir ou recuperar senha</button>
            {message && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{message}</p>}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6"><div><LogoVerto size={32} showText /><p className="mt-1 text-[11px] font-medium text-slate-400">Rede de cuidado</p></div><button type="button" disabled={busy} onClick={() => void logout()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"><LogOut size={15} /> Sair</button></div></header>
      <div className="mx-auto grid max-w-5xl gap-5 px-4 py-6 sm:px-6 md:grid-cols-[210px_minmax(0,1fr)]">
        <nav className="h-fit rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {([
            ['shared', 'Compartilhados comigo', FileText],
            ['notifications', 'Notificações', Bell],
            ['profile', 'Meu perfil', UserRound],
          ] as const).map(([key, label, Icon]) => <button key={key} type="button" onClick={() => { setTab(key); setError(''); setMessage(''); }} className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-medium ${tab === key ? 'bg-violet-50 text-[#7a32fc]' : 'text-slate-600 hover:bg-slate-50'}`}><Icon size={16} /> {label}</button>)}
        </nav>

        <section className="min-w-0">
          {error && <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">{error}</p>}
          {message && <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-700">{message}</p>}

          {tab === 'shared' && <div>
            <div className="mb-5"><h1 className="text-xl font-semibold text-slate-900">Compartilhados comigo</h1><p className="mt-1 text-sm text-slate-500">Somente conteúdos que foram compartilhados explicitamente com sua conta.</p></div>
            {grouped.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Nenhum compartilhamento ativo no momento.</div> : <div className="space-y-5">{grouped.map((clinic) => <section key={clinic.clinicId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h2 className="text-sm font-semibold text-slate-900">{clinic.clinicName}</h2><div className="mt-3 space-y-2">{clinic.patients.map((patient) => <button key={patient.patientId} type="button" onClick={() => openPatientTimeline(clinic.clinicId, patient.patientId)} className="flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3.5 text-left transition hover:border-violet-200 hover:bg-violet-50"><span className="rounded-lg bg-white p-2 text-[#7a32fc]"><FileText size={16} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800">{patient.patientName}</span><span className="mt-0.5 block text-[11px] text-slate-500">{patient.items.length} {patient.items.length === 1 ? 'registro compartilhado' : 'registros compartilhados'}</span><span className="mt-0.5 block text-[10px] text-slate-400">Última atualização: {formatDateTime(patient.latestAt) || 'data não informada'}</span></span><ChevronRight size={16} className="text-slate-400" /></button>)}</div></section>)}</div>}
            {nextOffset !== null && <div className="mt-5 flex justify-center"><button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await loadShared(nextOffset, true); } catch (loadError: any) { setError(loadError?.message || 'Não foi possível carregar mais compartilhamentos.'); } finally { setBusy(false); } }} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : null} Carregar mais</button></div>}
          </div>}

          {tab === 'notifications' && <div><div className="mb-5"><h1 className="text-xl font-semibold text-slate-900">Notificações</h1><p className="mt-1 text-sm text-slate-500">Compartilhamentos recentes enviados para sua conta.</p></div><div className="space-y-2">{rows.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Nenhuma notificação recente.</div> : rows.map((item) => <button key={item.grantId} type="button" onClick={() => openPatientTimeline(item.clinicId, item.patientId)} className="flex w-full items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-violet-200"><span className="rounded-xl bg-violet-50 p-2 text-[#7a32fc]"><Bell size={15} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-800">Novo conteúdo compartilhado</span><span className="mt-1 block text-xs text-slate-500">{item.clinicName} · {item.patientName}</span><span className="mt-1 block text-[11px] text-slate-400">{item.subject || 'Evolução clínica'} · {formatDateTime(item.sharedAt)}</span></span></button>)}</div></div>}

          {tab === 'profile' && <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h1 className="text-xl font-semibold text-slate-900">Meu perfil</h1><p className="mt-1 text-sm text-slate-500">Sua conta é única para todos os compartilhamentos enviados ao mesmo e-mail.</p><div className="mt-6 max-w-lg space-y-4"><label className="block"><span className="text-xs font-medium text-slate-600">E-mail</span><input value={profile.email} readOnly className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500" /></label><label className="block"><span className="text-xs font-medium text-slate-600">Nome</span><input value={displayName} maxLength={180} onChange={(event) => setDisplayName(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#7a32fc]" /></label><button type="button" disabled={busy || !displayName.trim()} onClick={() => void saveProfile()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : null} Salvar</button></div></div>}
        </section>
      </div>
    </main>
  );
};
