import React, { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, LogOut, Mail, ShieldCheck } from 'lucide-react';
import { LogoVerto } from './Common';
import { GoogleIcon } from './GoogleIcon';
import { PartnershipPanel } from './PartnershipPanel';
import { ensureFreshSession, getSupabase } from '../lib/supabase';
import { cleanPartnerAuthReturnUrl, readPartnerEmailCallbackHash } from '../lib/partnerEmailCallback';

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
  const [signupMode, setSignupMode] = useState(false);
  const [entryChoice, setEntryChoice] = useState<'signup' | 'login' | null>(null);
  const [verifiedSignupToken, setVerifiedSignupToken] = useState('');
  const [applicationName, setApplicationName] = useState('');
  const [applicationResult, setApplicationResult] = useState('');
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
        : result?.error === 'PARTNER_APPROVAL_PENDING'
          ? 'Sua inscrição está em análise. O acesso ao portal será liberado após aprovação da Verto.'
          : result?.error === 'PARTNER_NOT_REGISTERED'
            ? 'Este e-mail ainda não está cadastrado. Clique em Quero ser parceiro para se inscrever.'
            : 'Acesso não autorizado. Confira o e-mail cadastrado com a Verto.');
    }
    if (!(await checkPortal())) throw new Error('Não foi possível confirmar a sessão do parceiro.');
  };

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        const callbackUrl = new URL(window.location.href);
        const oauthReturn = callbackUrl.searchParams.get('partner_oauth') === '1';
        const signupReturn = oauthReturn && callbackUrl.searchParams.get('partner_apply') === '1';
        const emailReturn = oauthReturn ? readPartnerEmailCallbackHash(callbackUrl.hash) : null;
        if (signupReturn) {
          setSignupMode(true);
          setEntryChoice('signup');
        } else if (oauthReturn) {
          setEntryChoice('login');
        }
        if (oauthReturn) {
          // Scrub implicit-flow credentials from the address bar before any async work.
          window.history.replaceState(window.history.state, document.title,
            cleanPartnerAuthReturnUrl(callbackUrl.href));
        }
        if (await checkPortal()) return;
        if (oauthReturn) {
          if (emailReturn?.failed) throw new Error('O link de acesso expirou ou é inválido. Solicite um novo e-mail.');
          let session;
          if (emailReturn?.hasAuthResponse) {
            // E-mail confirmation returns tokens in the URL fragment, not a PKCE code.
            if (!emailReturn.accessToken || !emailReturn.refreshToken)
              throw new Error('Link incompleto. Solicite um novo e-mail de acesso.');
            const supabase = await getSupabase();
            const restored = await supabase.auth.setSession({
              access_token: emailReturn.accessToken,
              refresh_token: emailReturn.refreshToken,
            });
            if (restored.error) throw new Error('Não foi possível validar o link. Solicite um novo e-mail.');
            session = restored.data?.session;
          } else {
            // Google OAuth and PKCE email callbacks retain the existing code exchange.
            session = await ensureFreshSession({ sessionTimeoutMs: 5000 });
          }
          if (!session?.access_token) throw new Error('Não foi possível concluir o login. Tente novamente.');
          if (signupReturn) {
            setEmail(String(session.user?.email || '').toLowerCase());
            setVerifiedSignupToken(session.access_token);
          } else {
            await exchangeSession(session.access_token);
          }
        }
      } catch (err: any) {
        if (active) setError(err?.message || 'Falha no acesso do parceiro.');
      } finally {
        if (active) setLoading(false);
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
        options: { shouldCreateUser: true, emailRedirectTo: window.location.origin
          + (signupMode ? '/parcerias?partner_oauth=1&partner_apply=1' : '/parcerias?partner_oauth=1') },
      });
      if (authError) throw authError;
      setCodeSent(true);
      setMessage(signupMode
        ? 'Abra o link recebido para confirmar seu e-mail. Depois, finalize sua inscrição.'
        : 'Abra o link recebido ou digite o código para entrar.');
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
      if (signupMode) {
        setVerifiedSignupToken(result.data.session.access_token);
        setEmail(String(result.data.session.user?.email || '').toLowerCase());
        setCodeSent(false);
      } else {
        await exchangeSession(result.data.session.access_token);
      }
      setOtp('');
    } catch { setError('Não foi possível validar este código ou acessar a parceria.'); }
    finally { setBusy(false); }
  };

  const submitApplication = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !verifiedSignupToken || applicationName.trim().length < 2) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/partnerships/apply', {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: verifiedSignupToken, displayName: applicationName.trim() }),
      });
      const result = await readJson(response);
      if (!response.ok || !result?.success) {
        throw new Error(result?.error === 'CLINICAL_SESSION_ACTIVE'
          ? 'Saia do portal clínico antes de solicitar uma parceria externa.'
          : result?.error === 'EMAIL_VERIFICATION_REQUIRED'
            ? 'Sua confirmação expirou. Solicite um novo e-mail.'
            : 'Não foi possível registrar a inscrição. Tente novamente.');
      }
      setApplicationResult(result.status || 'pending');
      setVerifiedSignupToken('');
      setApplicationName('');
      setMessage('');
    } catch (err: any) {
      setError(err?.message || 'Não foi possível registrar a inscrição.');
    } finally { setBusy(false); }
  };

  const resetApplication = () => {
    setSignupMode(false); setEntryChoice('login'); setApplicationResult(''); setVerifiedSignupToken('');
    setApplicationName(''); setCodeSent(false); setOtp(''); setError(''); setMessage('');
  };

  const logout = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/partnerships/auth/logout', { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('LOGOUT_FAILED');
      const supabase = await getSupabase();
      await supabase.auth.signOut({ scope: 'local' });
      setLoggedIn(false); setEntryChoice(null); setSignupMode(false); setEmail(''); setOtp(''); setCodeSent(false);
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
        <p className="mt-2 text-sm leading-6 text-slate-600">{entryChoice === null
          ? 'Inscreva-se no programa de indicações da Verto. O acesso comercial depende de aprovação.'
          : signupMode
            ? 'Confirme seu e-mail e envie sua inscrição. O acesso comercial exige aprovação da Verto.'
            : 'Entre com o e-mail cadastrado no programa de parcerias comerciais. Este acesso é independente dos portais clínicos.'}</p>
        {!entryChoice && !applicationResult ? <div className="mt-7">
          <button type="button" onClick={() => { setEntryChoice('signup'); setSignupMode(true); setError(''); setMessage(''); }}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2">
            Quero ser parceiro
          </button>
          <p className="mt-6 text-center text-xs text-slate-500">
            Já é parceiro?{' '}
            <button type="button" onClick={() => { setEntryChoice('login'); setSignupMode(false); setError(''); setMessage(''); }}
              className="font-medium text-violet-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:underline">
              Fazer login
            </button>
          </p>
        </div> : applicationResult ? <div className="mt-6 space-y-3">
          <p role="status" className="text-sm font-semibold text-violet-800">{applicationResult === 'approved'
            ? 'Seu cadastro já foi aprovado. Entre com seu e-mail para acessar.'
            : applicationResult === 'suspended'
              ? 'Já existe um cadastro para este e-mail. Entre em contato com a Verto.'
              : 'Inscrição recebida'}</p>
          <p className="text-sm text-slate-600">O link de indicação e as comissões só ficam disponíveis após a aprovação.</p>
          <button type="button" onClick={resetApplication}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700">Voltar para o login</button>
        </div> : signupMode && verifiedSignupToken ? <form onSubmit={submitApplication} className="mt-6 space-y-3">
          <p className="text-sm font-medium text-emerald-700">E-mail confirmado: {email}</p>
          <label htmlFor="partner-application-name" className="block text-sm font-medium text-slate-700">Nome completo</label>
          <input id="partner-application-name" type="text" required minLength={2} maxLength={180}
            autoComplete="name" value={applicationName} onChange={event => setApplicationName(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm" placeholder="Seu nome completo"/>
          <button type="submit" disabled={busy || applicationName.trim().length < 2}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'Enviando inscrição...' : 'Enviar inscrição para análise'}
          </button>
        </form> : <form onSubmit={codeSent ? confirmCode : sendCode} className="mt-6 space-y-3">
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
            {busy ? <Loader2 size={17} className="animate-spin"/> : <Mail size={17}/>} {codeSent ? 'Confirmar código' : signupMode ? 'Confirmar e-mail para inscrição' : 'Enviar código por e-mail'}
          </button>
          {codeSent && <button type="button" disabled={busy} onClick={() => { setCodeSent(false); setOtp(''); }}
            className="w-full text-center text-xs text-slate-500">Solicitar outro código</button>}
        </form>}
        {entryChoice === 'login' && !signupMode && !applicationResult && <>
        <div className="my-5 text-center text-xs text-slate-400">ou</div>
        <button type="button" disabled={busy} onClick={() => void loginGoogle()}
          className="flex min-h-11 w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">
          <GoogleIcon/> Entrar com Google
        </button></>}
        {entryChoice !== null && !applicationResult && !(signupMode && verifiedSignupToken) && (
          <p className="mt-6 text-center text-xs text-slate-500">
            {signupMode ? 'Já é parceiro?' : 'Ainda não participa?'}{' '}
            <button type="button"
              onClick={() => {
                setEntryChoice(signupMode ? 'login' : 'signup');
                setSignupMode(value => !value); setCodeSent(false); setOtp('');
                setVerifiedSignupToken(''); setError(''); setMessage('');
              }}
              className="font-medium text-violet-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:underline">
              {signupMode ? 'Fazer login' : 'Quero ser parceiro'}
            </button>
          </p>
        )}
        {message && <p role="status" className="mt-4 text-sm text-slate-600">{message}</p>}
        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
        <p className="mt-6 text-xs leading-5 text-slate-500">A inscrição é aberta. Aprovação, acesso ao portal, indicação de clínicas e comissões dependem da análise da Verto.</p>
      </section>
    </div>
  </main>;
}
