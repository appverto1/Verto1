import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, LockKeyhole, LogIn, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import { LogoVerto } from './Common';
import { GoogleIcon } from './GoogleIcon';
import { getSupabase } from '../lib/supabase';

type Props = { publicId: string };
type Stage = 'loading' | 'activate' | 'login' | 'refresh' | 'mismatch' | 'unavailable';

const safeJson = async (response: Response) => {
  try { return await response.json(); } catch { return { success: false, error: `Falha HTTP ${response.status}` }; }
};

const activationTokenStorageKey = (publicId: string) => `verto_external_activation:${publicId}`;

const readActivationTokenFromFragment = (publicId: string) => {
  if (typeof window === 'undefined') return '';
  const fragment = window.location.hash.replace(/^#/, '');
  const token = new URLSearchParams(fragment).get('activation_token') || '';
  if (token) {
    try { window.sessionStorage.setItem(activationTokenStorageKey(publicId), token); } catch { /* optional browser storage */ }
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    return token;
  }
  try { return window.sessionStorage.getItem(activationTokenStorageKey(publicId)) || ''; } catch { return ''; }
};

const clearStoredActivationToken = (publicId: string) => {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(activationTokenStorageKey(publicId)); } catch { /* optional browser storage */ }
};

export const ExternalEvolutionShare = ({ publicId }: Props) => {
  const [stage, setStage] = useState<Stage>('loading');
  const [activationToken] = useState(() => readActivationTokenFromFragment(publicId));
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const openAuthorizedTimeline = async () => {
    const response = await fetch(`/api/external/evolution/${encodeURIComponent(publicId)}/context`, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
    const result = await safeJson(response);
    if (result?.code === 'EXTERNAL_ACCOUNT_MISMATCH') { setStage('mismatch'); return false; }
    const path = String(result?.data?.timelinePath || '').trim();
    if (!response.ok || !result?.success || !path.startsWith('/rede-de-cuidado/paciente/')) return false;
    clearStoredActivationToken(publicId);
    window.location.replace(path);
    return true;
  };

  const bridgeSupabaseSession = async (expectedEmail?: string) => {
    try {
      const supabase = await getSupabase();
      const sessionResult = await supabase.auth.getSession();
      const session = sessionResult.data?.session || null;
      if (!session?.access_token) return false;
      const sessionEmail = String(session.user?.email || '').trim().toLowerCase();
      const normalizedExpected = String(expectedEmail || '').trim().toLowerCase();
      if (normalizedExpected && sessionEmail && sessionEmail !== normalizedExpected) {
        // Ignore an unrelated browser/Supabase session. The invitation email stays
        // authoritative and the professional can authenticate explicitly below.
        return false;
      }
      const response = await fetch('/api/external/auth/session', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token, publicId, activationToken }),
      });
      const result = await safeJson(response);
      if (result?.code === 'EXTERNAL_ACCOUNT_MISMATCH') { setStage('mismatch'); return false; }
      return response.ok && result?.success;
    } catch {
      return false;
    }
  };

  const resolveAccessState = async () => {
    setError('');
    const metaResponse = await fetch(`/api/external/evolution/${encodeURIComponent(publicId)}`, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
    const meta = await safeJson(metaResponse);
    if (!metaResponse.ok || !meta?.success) { setStage('unavailable'); return; }
    if (meta?.data?.accountMismatch) { setStage('mismatch'); return; }
    if (meta?.data?.authenticated) {
      if (!(await openAuthorizedTimeline())) setStage('unavailable');
      return;
    }

    const stateResponse = await fetch(`/api/external/evolution/${encodeURIComponent(publicId)}/access-state`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ activationToken }),
    });
    const state = await safeJson(stateResponse);
    if (state?.code === 'EXTERNAL_ACCOUNT_MISMATCH') { setStage('mismatch'); return; }
    if (!stateResponse.ok || !state?.success) {
      setStage(state?.code === 'EXTERNAL_ACCESS_LINK_REFRESH_REQUIRED' ? 'refresh' : 'unavailable');
      return;
    }
    const mode = String(state?.data?.mode || '');
    if (mode === 'AUTHENTICATED') {
      if (!(await openAuthorizedTimeline())) setStage('unavailable');
      return;
    }
    const resolvedEmail = String(state?.data?.email || '').trim().toLowerCase();
    const suggestedDisplayName = String(state?.data?.displayName || '').trim().slice(0, 180);
    setEmail(resolvedEmail);
    if (suggestedDisplayName) setDisplayName((current) => current || suggestedDisplayName);
    if (mode === 'LOGIN' && await bridgeSupabaseSession(resolvedEmail)) {
      if (!(await openAuthorizedTimeline())) setStage('unavailable');
      return;
    }
    setStage(mode === 'ACTIVATE' ? 'activate' : 'login');
  };

  useEffect(() => { setStage('loading'); void resolveAccessState().catch(() => setStage('unavailable')); }, [publicId]);

  const activate = async () => {
    const name = displayName.trim();
    if (!name) { setError('Informe seu nome para criar seu acesso.'); return; }
    if (password.length < 8 || password.length > 128) { setError('Use uma senha de 8 a 128 caracteres.'); return; }
    if (password !== confirmPassword) { setError('As senhas não coincidem.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/external/evolution/${encodeURIComponent(publicId)}/activate`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ activationToken, password, displayName: name }),
      });
      const result = await safeJson(response);
      if (result?.code === 'EXTERNAL_ACCOUNT_EXISTS_LOGIN_REQUIRED') { setStage('login'); setError('Esta conta já existe. Entre com sua senha ou use o mesmo provedor de acesso para continuar.'); return; }
      if (!response.ok || !result?.success) throw new Error(result?.error || 'Não foi possível criar seu acesso.');
      setPassword(''); setConfirmPassword('');
      if (!(await openAuthorizedTimeline())) throw new Error('Seu acesso foi criado, mas a timeline não pôde ser aberta.');
    } catch (activationError: any) { setError(activationError?.message || 'Não foi possível criar seu acesso.'); }
    finally { setBusy(false); }
  };

  const login = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/external/auth/login', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, password, publicId, activationToken }),
      });
      const result = await safeJson(response);
      if (!response.ok || !result?.success) throw new Error(result?.error || 'E-mail ou senha inválidos.');
      setPassword('');
      if (!(await openAuthorizedTimeline())) throw new Error('Login realizado, mas a timeline não pôde ser aberta.');
    } catch (loginError: any) { setError(loginError?.message || 'Não foi possível entrar.'); }
    finally { setBusy(false); }
  };

  const loginWithGoogle = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      if (activationToken) {
        try { window.sessionStorage.setItem(activationTokenStorageKey(publicId), activationToken); } catch { /* optional browser storage */ }
      }
      const supabase = await getSupabase();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/evolucao-compartilhada/${encodeURIComponent(publicId)}`,
          scopes: 'https://www.googleapis.com/auth/userinfo.email',
          queryParams: { prompt: 'select_account', ...(email ? { login_hint: email } : {}) },
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
        body: JSON.stringify({ email }),
      });
      setMessage('Se esta conta utilizar senha, enviaremos instruções para definir ou recuperar o acesso.');
    } catch {
      setMessage('Se esta conta utilizar senha, enviaremos instruções para definir ou recuperar o acesso.');
    } finally { setBusy(false); }
  };

  const resendAccess = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/external/evolution/${encodeURIComponent(publicId)}/resend-access`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
      const result = await safeJson(response);
      if (!response.ok || !result?.success) throw new Error('Não foi possível solicitar um novo acesso.');
      setMessage(result?.message || 'Se este compartilhamento estiver ativo, um novo acesso será enviado ao endereço autorizado.');
    } catch (resendError: any) { setError(resendError?.message || 'Não foi possível solicitar um novo acesso.'); }
    finally { setBusy(false); }
  };

  const switchAccount = async () => {
    setBusy(true); setError('');
    try {
      await fetch('/api/external/auth/logout', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } }).catch(() => undefined);
      try { const supabase = await getSupabase(); await supabase.auth.signOut(); } catch { /* server session is already cleared */ }
      window.location.reload();
    } finally { setBusy(false); }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-7 sm:px-6">
      <section className="mx-auto w-full max-w-2xl overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
        <header className="border-b border-slate-100 px-5 py-5 sm:px-7"><LogoVerto size={34} showText /></header>
        <div className="p-5 sm:p-7">
          {stage === 'loading' && <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center"><Loader2 size={30} className="animate-spin text-[#7a32fc]" /><p className="text-sm font-medium text-slate-500">Preparando sua timeline compartilhada...</p></div>}
          {stage === 'unavailable' && <StateCard icon={<LockKeyhole size={30} />} title="Compartilhamento indisponível" text="Este acesso pode ter sido revogado, arquivado ou não estar mais disponível." />}
          {stage === 'refresh' && <StateCard icon={<RefreshCw size={30} />} title="Este acesso precisa ser renovado" text="Por segurança, links antigos não funcionam como credencial permanente."><button type="button" onClick={() => void resendAccess()} disabled={busy} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-5 text-sm font-semibold text-white disabled:opacity-60">{busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Enviar novo acesso</button></StateCard>}
          {stage === 'mismatch' && <StateCard icon={<LockKeyhole size={30} />} title="Este compartilhamento pertence a outra conta" text="Troque de conta para continuar. Nenhum dado clínico foi exibido."><button type="button" onClick={() => void switchAccount()} disabled={busy} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-5 text-sm font-semibold text-white disabled:opacity-60">{busy ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />} Trocar conta</button></StateCard>}

          {(stage === 'activate' || stage === 'login') && <div className="mx-auto max-w-md py-4 sm:py-8">
            <div className="w-fit rounded-2xl bg-violet-50 p-3 text-[#7a32fc]"><ShieldCheck size={24} /></div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">{stage === 'activate' ? 'Bem-vindo à sua Rede de cuidado' : 'Bem-vindo novamente'}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">{stage === 'activate' ? 'Faça seu cadastro gratuito para acessar este conteúdo e tudo o que for compartilhado com este e-mail.' : 'Entre com sua conta de profissional parceiro para abrir a timeline compartilhada.'}</p>
            <div className="mt-6 space-y-4">
              <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">E-mail</span><input value={email} readOnly className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700" /></label>
              {stage === 'activate' && <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Seu nome</span><div className="relative"><UserRound size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300" /><input autoComplete="name" maxLength={180} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Como prefere ser chamado" className="min-h-12 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-sm outline-none transition focus:border-[#7a32fc]" /></div></label>}
              <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">{stage === 'activate' ? 'Crie uma senha' : 'Senha'}</span><div className="relative"><input type={showPassword ? 'text' : 'password'} autoComplete={stage === 'activate' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} className="min-h-12 w-full rounded-xl border border-slate-200 px-3 pr-11 text-sm outline-none transition focus:border-[#7a32fc]" /><button type="button" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShowPassword((value) => !value)} className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
              {stage === 'activate' && <><label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Confirmar senha</span><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="min-h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition focus:border-[#7a32fc]" /></label><p className="text-[11px] leading-5 text-slate-400">Use pelo menos 8 caracteres. Sem regras de composição.</p></>}
              <button type="button" onClick={() => void (stage === 'activate' ? activate() : login())} disabled={busy || !email || !password || (stage === 'activate' && (!displayName.trim() || !confirmPassword))} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-sm font-medium text-white shadow-md shadow-violet-500/20 transition hover:opacity-95 disabled:opacity-50">{busy ? <Loader2 size={17} className="animate-spin" /> : <ShieldCheck size={17} />} {stage === 'activate' ? 'Criar meu acesso gratuito' : 'Entrar e ver timeline'}</button>
              {stage === 'activate' ? <button type="button" disabled={busy} onClick={() => { setStage('login'); setPassword(''); setConfirmPassword(''); setError(''); }} className="w-full text-center text-xs font-medium text-[#7a32fc] hover:underline disabled:opacity-60">Já sou profissional parceiro — Entrar</button> : <><button type="button" onClick={() => void requestPasswordRecovery()} disabled={busy} className="w-full text-center text-xs font-medium text-[#7a32fc] hover:underline disabled:opacity-60">Esqueci minha senha</button><div className="flex items-center gap-3 py-1 text-[10px] uppercase tracking-wider text-slate-400"><span className="h-px flex-1 bg-slate-200" /><span>ou</span><span className="h-px flex-1 bg-slate-200" /></div><button type="button" onClick={() => void loginWithGoogle()} disabled={busy} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"><GoogleIcon className="h-4 w-4" /> Continuar com Google</button></>}
            </div>
          </div>}

          {error && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">{error}</div>}
          {message && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700">{message}</div>}
        </div>
      </section>
    </main>
  );
};

const StateCard = ({ icon, title, text, children }: { icon: React.ReactNode; title: string; text: string; children?: React.ReactNode }) => (
  <div className="flex min-h-[320px] flex-col items-center justify-center text-center text-slate-400">{icon}<h1 className="mt-4 text-xl font-semibold text-slate-900">{title}</h1><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{text}</p>{children}</div>
);
