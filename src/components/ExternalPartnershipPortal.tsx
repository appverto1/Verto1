import React, { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, LogOut, Mail, ShieldCheck } from 'lucide-react';
import { LogoVerto } from './Common';
import { GoogleIcon } from './GoogleIcon';
import { PartnershipPanel } from './PartnershipPanel';
import { ensureFreshSession, getSupabase } from '../lib/supabase';
import { cleanPartnerAuthReturnUrl, readPartnerEmailCallbackHash } from '../lib/partnerEmailCallback';

const portalUrl = '/api/partnerships/portal';
const readJson = async (response: Response) => response.json().catch(() => ({}));

/** Commercial partners never inherit a clinical workspace role or session. */
export function ExternalPartnershipPortal() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [entryChoice, setEntryChoice] = useState<'signup' | 'login' | 'setup' | null>(null);
  const [applicationName, setApplicationName] = useState('');
  const [applicationResult, setApplicationResult] = useState(false);
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
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: token }),
    });
    const result = await readJson(response);
    if (!response.ok || !result?.success) {
      throw new Error(result?.error === 'CLINICAL_SESSION_ACTIVE'
        ? 'Há um portal clínico aberto nesta sessão. Saia dele antes de entrar como parceiro externo.'
        : result?.error === 'PARTNER_APPROVAL_PENDING'
          ? 'Sua inscrição está em análise. O acesso será liberado após aprovação da Verto.'
          : result?.error === 'PARTNER_NOT_REGISTERED'
            ? 'Este e-mail não possui uma parceria aprovada. Solicite sua inscrição.'
            : 'Acesso não autorizado. Entre com a conta do mesmo e-mail aprovado pela Verto.');
    }
    if (!(await checkPortal())) throw new Error('Não foi possível confirmar a sessão do parceiro.');
  };

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        const callbackUrl = new URL(window.location.href);
        const oauthReturn = callbackUrl.searchParams.get('partner_oauth') === '1';
        const setupReturn = oauthReturn && callbackUrl.searchParams.get('partner_setup') === '1';
        const emailReturn = oauthReturn ? readPartnerEmailCallbackHash(callbackUrl.hash) : null;
        if (oauthReturn) {
          window.history.replaceState(window.history.state, document.title,
            cleanPartnerAuthReturnUrl(callbackUrl.href));
        }
        if (await checkPortal()) return;
        if (!oauthReturn) return;
        if (emailReturn?.failed) throw new Error('O convite expirou ou já foi utilizado. Solicite outro convite à Verto.');
        let session;
        if (emailReturn?.hasAuthResponse) {
          if (!emailReturn.accessToken || !emailReturn.refreshToken) {
            throw new Error('Link de ativação incompleto. Solicite outro convite.');
          }
          const supabase = await getSupabase();
          const restored = await supabase.auth.setSession({
            access_token: emailReturn.accessToken,
            refresh_token: emailReturn.refreshToken,
          });
          if (restored.error) throw new Error('Não foi possível validar seu convite.');
          session = restored.data?.session;
        } else {
          session = await ensureFreshSession({ sessionTimeoutMs: 5000 });
        }
        if (!session?.access_token) throw new Error('Não foi possível confirmar sua identidade. Tente novamente.');
        if (setupReturn) {
          // Proof of email ownership is a Supabase session; the client does not
          // decide which partner ID/role the backend authorizes.
          setEmail(String(session.user?.email || '').toLowerCase());
          setEntryChoice('setup');
          setMessage('Parceria aprovada! Crie sua senha ou entre com Google usando este mesmo e-mail.');
        } else {
          await exchangeSession(session.access_token);
        }
      } catch (err: any) {
        if (active) {
          setEntryChoice('login');
          setError(err?.message || 'Falha no acesso do parceiro.');
        }
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
          queryParams: {
            prompt: 'select_account',
            ...(email.trim() ? { login_hint: email.trim().toLowerCase() } : {}),
          },
        },
      });
      if (authError) throw authError;
    } catch {
      setError('Não foi possível iniciar o login com Google.');
      setBusy(false);
    }
  };

  const loginWithPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !email.trim() || !password) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const supabase = await getSupabase();
      const result = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(), password,
      });
      if (result.error || !result.data?.session?.access_token)
        throw new Error('E-mail ou senha inválidos.');
      await exchangeSession(result.data.session.access_token);
      setPassword('');
    } catch (err: any) {
      setError(err?.message || 'Não foi possível entrar com sua senha.');
    } finally { setBusy(false); }
  };

  const activateWithPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || password.length < 8 || password !== confirmPassword) {
      setError('Use uma senha de pelo menos 8 caracteres e confirme-a corretamente.');
      return;
    }
    setBusy(true); setError('');
    try {
      const supabase = await getSupabase();
      const session = await ensureFreshSession({ sessionTimeoutMs: 5000 });
      if (!session?.access_token || !session.user?.email
          || session.user.email.toLowerCase() !== email.toLowerCase())
        throw new Error('Seu convite expirou. Solicite outro à Verto.');
      const saved = await supabase.auth.updateUser({ password });
      if (saved.error) throw new Error('Não foi possível definir sua senha. Revise os requisitos de segurança.');
      await exchangeSession(session.access_token);
      setPassword(''); setConfirmPassword('');
    } catch (err: any) {
      setError(err?.message || 'Não foi possível ativar sua conta.');
    } finally { setBusy(false); }
  };

  const submitApplication = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || applicationName.trim().length < 2 || !email.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/partnerships/apply', {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: applicationName.trim(), contactEmail: email.trim().toLowerCase(),
        }),
      });
      const result = await readJson(response);
      if (!response.ok || !result?.success) {
        throw new Error(result?.error === 'CLINICAL_SESSION_ACTIVE'
          ? 'Saia do portal clínico antes de solicitar uma parceria externa.'
          : 'Não foi possível registrar sua inscrição. Revise os dados e tente novamente.');
      }
      setApplicationResult(true);
      setApplicationName('');
    } catch (err: any) {
      setError(err?.message || 'Não foi possível registrar a inscrição.');
    } finally { setBusy(false); }
  };

  const logout = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/partnerships/auth/logout', { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('LOGOUT_FAILED');
      const supabase = await getSupabase();
      await supabase.auth.signOut({ scope: 'local' });
      setLoggedIn(false); setEntryChoice(null); setPassword(''); setEmail('');
    } catch { setError('Não foi possível sair. Tente novamente.'); }
    finally { setBusy(false); }
  };

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-50">
    <Loader2 className="animate-spin text-violet-700" size={28} aria-label="Carregando"/>
  </main>;

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
      <a href="/" className="mb-7 inline-flex items-center gap-2 text-sm text-slate-600">
        <ArrowLeft size={16}/> Voltar ao site
      </a>
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="partner-login-title">
        <LogoVerto size={40} showText={true}/>
        <div className="mt-7 flex items-center gap-2 text-violet-700">
          <ShieldCheck size={18}/><span className="text-xs font-semibold">Acesso exclusivo</span>
        </div>
        <h1 id="partner-login-title" className="mt-2 text-2xl font-semibold text-slate-900">Portal do parceiro</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {entryChoice === null ? 'Cadastre seu interesse na parceria. Após aprovação, enviaremos o convite por e-mail.'
            : entryChoice === 'signup' ? 'A inscrição é gratuita. O acesso ao portal depende de aprovação da Verto.'
            : entryChoice === 'setup' ? 'Defina uma senha ou use Google com o mesmo e-mail aprovado.'
            : 'Acesse com sua senha ou conta Google. Não é necessário receber um link a cada login.'}
        </p>
        {entryChoice === null && !applicationResult ? <div className="mt-7">
          <button type="button" onClick={() => { setEntryChoice('signup'); setError(''); setMessage(''); }}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-800">
            Quero ser parceiro
          </button>
          <p className="mt-6 text-center text-xs text-slate-500">Já é parceiro?{' '}
            <button type="button" onClick={() => { setEntryChoice('login'); setError(''); setMessage(''); }}
              className="font-medium text-violet-700 hover:underline">Fazer login</button>
          </p>
        </div> : applicationResult ? <div className="mt-6 space-y-3">
          <p role="status" className="text-sm font-semibold text-violet-800">Inscrição recebida</p>
          <p className="text-sm text-slate-600">
            Se sua parceria for aprovada, enviaremos ao e-mail informado um convite para ativar seu acesso gratuito.
          </p>
          <button type="button" onClick={() => { setApplicationResult(false); setEntryChoice('login'); }}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700">
            Voltar para o login
          </button>
        </div> : entryChoice === 'signup' ? <form onSubmit={submitApplication} className="mt-6 space-y-3">
          <label htmlFor="partner-application-name" className="block text-sm font-medium text-slate-700">Nome completo ou empresa</label>
          <input id="partner-application-name" type="text" required minLength={2} maxLength={180}
            autoComplete="name" value={applicationName} onChange={event => setApplicationName(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm" placeholder="Nome do parceiro"/>
          <label htmlFor="partner-application-email" className="block text-sm font-medium text-slate-700">Seu e-mail</label>
          <input id="partner-application-email" type="email" required maxLength={254} autoComplete="email"
            value={email} onChange={event => setEmail(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm" placeholder="parceiro@empresa.com.br"/>
          <p className="text-xs leading-5 text-slate-500">
            Este e-mail será utilizado para aprovar sua parceria, enviar seu convite de ativação e identificar seu login no painel do parceiro. Use o mesmo e-mail da conta Google, se preferir.
          </p>
          <button type="submit" disabled={busy || applicationName.trim().length < 2 || !email.trim()}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'Enviando inscrição...' : 'Enviar inscrição para análise'}
          </button>
        </form> : entryChoice === 'setup' ? <form onSubmit={activateWithPassword} className="mt-6 space-y-3">
          <p className="text-sm font-medium text-emerald-700">E-mail aprovado: {email}</p>
          <label htmlFor="partner-setup-password" className="block text-sm font-medium text-slate-700">Criar senha (mínimo de 8 caracteres)</label>
          <input id="partner-setup-password" type="password" required minLength={8} autoComplete="new-password"
            value={password} onChange={event => setPassword(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"/>
          <label htmlFor="partner-setup-confirm" className="block text-sm font-medium text-slate-700">Confirmar senha</label>
          <input id="partner-setup-confirm" type="password" required minLength={8} autoComplete="new-password"
            value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"/>
          <button type="submit" disabled={busy || password.length < 8 || password !== confirmPassword}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'Ativando acesso...' : 'Salvar senha e acessar'}
          </button>
          <p className="text-center text-xs text-slate-400">ou</p>
          <button type="button" disabled={busy} onClick={() => void loginGoogle()}
            className="flex min-h-11 w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">
            <GoogleIcon/> Entrar com Google
          </button>
        </form> : <form onSubmit={loginWithPassword} className="mt-6 space-y-3">
          <label htmlFor="partner-email-login" className="block text-sm font-medium text-slate-700">E-mail</label>
          <input id="partner-email-login" type="email" required autoComplete="email" maxLength={254}
            value={email} onChange={event => setEmail(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm" placeholder="parceiro@empresa.com.br"/>
          <label htmlFor="partner-password-login" className="block text-sm font-medium text-slate-700">Senha</label>
          <input id="partner-password-login" type="password" required autoComplete="current-password"
            value={password} onChange={event => setPassword(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"/>
          <button type="submit" disabled={busy}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 size={17} className="animate-spin"/> : <Mail size={17}/>} Entrar com e-mail e senha
          </button>
          <div className="my-5 text-center text-xs text-slate-400">ou</div>
          <button type="button" disabled={busy} onClick={() => void loginGoogle()}
            className="flex min-h-11 w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">
            <GoogleIcon/> Entrar com Google
          </button>
        </form>}
        {(entryChoice === 'login' || entryChoice === 'signup') && !applicationResult && (
          <p className="mt-6 text-center text-xs text-slate-500">
            {entryChoice === 'signup' ? 'Já é parceiro?' : 'Ainda não participa?'}{' '}
            <button type="button"
              onClick={() => { setEntryChoice(entryChoice === 'signup' ? 'login' : 'signup'); setError(''); setMessage(''); setPassword(''); }}
              className="font-medium text-violet-700 hover:underline">
              {entryChoice === 'signup' ? 'Fazer login' : 'Quero ser parceiro'}
            </button>
          </p>
        )}
        {message && <p role="status" className="mt-4 text-sm text-slate-600">{message}</p>}
        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
        <p className="mt-6 text-xs leading-5 text-slate-500">
          A aprovação é realizada pela Verto. O portal de parcerias não possui cobrança e é separado dos portais clínicos.
        </p>
      </section>
    </div>
  </main>;
}
