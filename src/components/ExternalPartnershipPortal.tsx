import React, { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, LogOut, Mail, ShieldCheck } from 'lucide-react';
import { LogoVerto } from './Common';
import { GoogleIcon } from './GoogleIcon';
import { PartnershipPanel } from './PartnershipPanel';
import { ensureFreshSession, getSupabase } from '../lib/supabase';

const portalUrl = '/api/partnerships/portal';
const readJson = async (response: Response) => response.json().catch(() => ({}));

/** An isolated commercial-partner surface; never calls the clinical login/role bootstrap. */
export function ExternalPartnershipPortal() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const checkPortal = async () => {
    const response = await fetch(portalUrl, { credentials: 'include', cache: 'no-store' });
    const result = await readJson(response);
    if (!response.ok || !result?.success) return false;
    setLoggedIn(true);
    return true;
  };

  const exchangeSession = async (token: string) => {
    const response = await fetch('/api/partnerships/auth/session', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: token }),
    });
    const result = await readJson(response);
    if (!response.ok || !result?.success) {
      throw new Error(result?.error === 'CLINICAL_SESSION_ACTIVE'
        ? 'Há um portal clínico aberto nesta sessão. Saia dele antes de entrar como parceiro externo.'
        : 'Acesso não autorizado. Confira o e-mail cadastrado com a Verto.');
    }
    if (!(await checkPortal())) throw new Error('Não foi possível confirmar a sessão do parceiro.');
  };

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const oauthReturn = params.get('partner_oauth') === '1';
        if (await checkPortal()) return;
        if (oauthReturn) {
          // Explicitly exchange PKCE after OAuth. This route must not invoke the clinical login handler.
          const session = await ensureFreshSession({ sessionTimeoutMs: 5000 });
          if (!session?.access_token) throw new Error('Não foi possível concluir o login. Tente novamente.');
          await exchangeSession(session.access_token);
        }
      } catch (err: any) {
        if (active) setError(err?.message || 'Falha no acesso do parceiro.');
      } finally {
        if (active) {
          const url = new URL(window.location.href);
          if (url.searchParams.has('partner_oauth')) {
            url.searchParams.delete('partner_oauth');
            window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
          }
          setLoading(false);
        }
      }
    };
    void bootstrap();
    return () => { active = false; };
  }, []);

  const loginGoogle = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const supabase = await getSupabase();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + '/parcerias?partner_oauth=1',
          scopes: 'https://www.googleapis.com/auth/userinfo.email',
          queryParams: { prompt: 'select_account', ...(email.trim() ? { login_hint: email.trim().toLowerCase() } : {}) },
        },
      });
      if (authError) throw authError;
    } catch {
      setError('Não foi possível iniciar o acesso com Google.');
      setBusy(false);
    }
  };

  const sendCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const supabase = await getSupabase();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { shouldCreateUser: true, emailRedirectTo: window.location.origin + '/parcerias?partner_oauth=1' },
      });
      if (authError) throw authError;
      setCodeSent(true);
      setMessage('Confira seu e-mail. Digite o código recebido para entrar.');
    } catch {
      setError('Não foi possível enviar o código agora. Tente novamente.');
    } finally { setBusy(false); }
  };

  const confirmCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !/^\d{6,8}$/.test(otp.trim())) return;
    setBusy(true); setError('');
    try {
      const supabase = await getSupabase();
      const result = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: otp.trim(), type: 'email' });
      if (result.error || !result.data?.session?.access_token) throw new Error('INVALID_OTP');
      await exchangeSession(result.data.session.access_token);
      setOtp('');
    } catch { setError('Não foi possível validar este código ou acessar a parceria.'); }
    finally { setBusy(false); }
  };

  const logout = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/partnerships/auth/logout', { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('LOGOUT_FAILED');
      const supabase = await getSupabase();
      await supabase.auth.signOut({ scope: 'local' });
      setLoggedIn(false); setEmail(''); setOtp(''); setCodeSent(false);
    } catch { setError('Não foi possível sair. Tente novamente.'); }
    finally { setBusy(false); }
  };

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-violet-700" size={28} aria-label="Carregando"/></main>;

  if (loggedIn) return <main className="min-h-screen bg-slate-50 px-4 py-7">
    <div className="mx-auto mb-4 flex max-w-4xl justify-end">
      <button type="button" disabled={busy} onClick={() => void logout()}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 disabled:opacity-50">
        <LogOut size={16}/> Sair da parceria
      </button>
    </div>
    <PartnershipPanel mode="external" onBack={() => window.location.assign('/')} />
    {error && <p role="alert" className="mx-auto max-w-4xl text-sm text-red-700">{error}</p>}
  </main>;

  return <main className="min-h-screen bg-slate-50 px-4 py-8">
    <div className="mx-auto max-w-md">
      <a href="/" className="mb-7 inline-flex items-center gap-2 text-sm text-slate-600"><ArrowLeft size={16}/> Voltar ao site</a>
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="partner-login-title">
        <LogoVerto size={40} showText={true}/>
        <div className="mt-7 flex items-center gap-2 text-violet-700"><ShieldCheck size={18}/><span className="text-xs font-semibold">Acesso exclusivo</span></div>
        <h1 id="partner-login-title" className="mt-2 text-2xl font-semibold text-slate-900">Portal do parceiro</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Entre com o e-mail cadastrado no programa de parcerias comerciais. Este acesso é independente dos portais clínicos.</p>
        <form onSubmit={codeSent ? confirmCode : sendCode} className="mt-6 space-y-3">
          <label htmlFor="partner-email-login" className="block text-sm font-medium text-slate-700">E-mail</label>
          <input id="partner-email-login" type="email" required autoComplete="email" maxLength={254}
            value={email} onChange={event => { setEmail(event.target.value); setCodeSent(false); setOtp(''); }}
            className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm" placeholder="parceiro@empresa.com.br"/>
          {codeSent && <>
            <label htmlFor="partner-email-code" className="block text-sm font-medium text-slate-700">Código recebido</label>
            <input id="partner-email-code" type="text" inputMode="numeric" autoComplete="one-time-code"
              minLength={6} maxLength={8} value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g,''))}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm" required/>
          </>}
          <button type="submit" disabled={busy} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 size={17} className="animate-spin"/> : <Mail size={17}/>} {codeSent ? 'Confirmar código' : 'Enviar código por e-mail'}
          </button>
          {codeSent && <button type="button" disabled={busy} onClick={() => { setCodeSent(false); setOtp(''); }}
            className="w-full text-center text-xs text-slate-500">Solicitar outro código</button>}
        </form>
        <div className="my-5 text-center text-xs text-slate-400">ou</div>
        <button type="button" disabled={busy} onClick={() => void loginGoogle()}
          className="flex min-h-11 w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">
          <GoogleIcon/> Entrar com Google
        </button>
        {message && <p role="status" className="mt-4 text-sm text-slate-600">{message}</p>}
        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
        <p className="mt-6 text-xs leading-5 text-slate-500">Cadastro e aprovação são realizados pela Verto. Apenas o e-mail verificado de um parceiro cadastrado permite acesso.</p>
      </section>
    </div>
  </main>;
}
