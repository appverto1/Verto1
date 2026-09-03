import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileText, Loader2, LockKeyhole, LogIn, MessageCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { LogoVerto } from './Common';
import { GoogleIcon } from './GoogleIcon';
import { getSupabase } from '../lib/supabase';

type Props = { publicId: string };

type SharedItem = {
  id: string;
  monthKey?: string;
  slot?: number;
  subject?: string;
  content?: string;
  createdAt?: string;
  attachment?: { id?: string; fileName?: string; mimeType?: string; sizeBytes?: number } | null;
};

type SharedContent = {
  clinicName?: string;
  patientName?: string;
  sharedWith?: string;
  entryItemId?: string;
  item?: SharedItem | null;
  canComment?: boolean;
  comments?: Array<{ id: string; body: string; createdAt?: string | null }>;
};

type Stage = 'loading' | 'activate' | 'login' | 'content' | 'refresh' | 'mismatch' | 'unavailable';

const safeJson = async (response: Response) => {
  try { return await response.json(); } catch { return { success: false, error: `Falha HTTP ${response.status}` }; }
};

const formatBytes = (value: unknown) => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDateTime = (value: unknown) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
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
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [content, setContent] = useState<SharedContent | null>(null);
  const [comment, setComment] = useState('');
  const commentKeyRef = useRef(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const [busy, setBusy] = useState(false);
  const [busyFile, setBusyFile] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadContent = async () => {
    const response = await fetch(`/api/external/evolution/${encodeURIComponent(publicId)}/content`, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
    const result = await safeJson(response);
    if (response.ok && result?.success) {
      setContent(result.data || null);
      clearStoredActivationToken(publicId);
      setStage('content');
      return true;
    }
    if (result?.code === 'EXTERNAL_ACCOUNT_MISMATCH') setStage('mismatch');
    return false;
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
        setStage('mismatch');
        return false;
      }
      const response = await fetch('/api/external/auth/session', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token, publicId, activationToken }),
      });
      const result = await safeJson(response);
      if (result?.code === 'EXTERNAL_ACCOUNT_MISMATCH') { setStage('mismatch'); return false; }
      if (!response.ok || !result?.success) return false;
      return true;
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
      if (!(await loadContent())) setStage('unavailable');
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
    if (mode === 'AUTHENTICATED') { if (!(await loadContent())) setStage('unavailable'); return; }
    const resolvedEmail = String(state?.data?.email || '').trim().toLowerCase();
    setEmail(resolvedEmail);
    if (mode === 'LOGIN' && await bridgeSupabaseSession(resolvedEmail)) {
      if (!(await loadContent())) setStage('unavailable');
      return;
    }
    setStage(mode === 'ACTIVATE' ? 'activate' : 'login');
  };

  useEffect(() => { setStage('loading'); void resolveAccessState().catch(() => setStage('unavailable')); }, [publicId]);

  const activate = async () => {
    if (password !== confirmPassword) { setError('As senhas não coincidem.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/external/evolution/${encodeURIComponent(publicId)}/activate`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ activationToken, password }),
      });
      const result = await safeJson(response);
      if (result?.code === 'EXTERNAL_ACCOUNT_EXISTS_LOGIN_REQUIRED') { setStage('login'); setError('Esta conta já existe. Entre com sua senha para continuar.'); return; }
      if (!response.ok || !result?.success) throw new Error(result?.error || 'Não foi possível criar seu acesso.');
      setPassword(''); setConfirmPassword('');
      if (!(await loadContent())) throw new Error('Seu acesso foi criado, mas o conteúdo não pôde ser carregado.');
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
      if (!(await loadContent())) throw new Error('Login realizado, mas o conteúdo não pôde ser carregado.');
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
      clearStoredActivationToken(publicId);
      window.location.reload();
    } finally { setBusy(false); }
  };

  const openAttachment = async () => {
    const itemId = String(content?.item?.id || '').trim();
    if (!itemId) return;
    setBusyFile(true); setError('');
    try {
      const response = await fetch(`/api/external/evolution/${encodeURIComponent(publicId)}/file/${encodeURIComponent(itemId)}`, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
      const result = await safeJson(response);
      const url = String(result?.data?.url || '').trim();
      if (!response.ok || !result?.success || !url) throw new Error(result?.error || 'Documento indisponível.');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (fileError: any) { setError(fileError?.message || 'Não foi possível abrir o documento.'); }
    finally { setBusyFile(false); }
  };

  const sendComment = async () => {
    const body = comment.trim();
    if (!body) { setError('Escreva seu comentário antes de enviar.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/external/evolution/${encodeURIComponent(publicId)}/comments`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ comment: body, idempotencyKey: commentKeyRef.current }),
      });
      const result = await safeJson(response);
      if (!response.ok || !result?.success) throw new Error(result?.error || 'Não foi possível enviar o comentário.');
      setComment('');
      commentKeyRef.current = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      setMessage('Comentário enviado.');
      await loadContent();
    } catch (commentError: any) { setError(commentError?.message || 'Não foi possível enviar o comentário.'); }
    finally { setBusy(false); }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-7 sm:px-6">
      <section className="mx-auto w-full max-w-3xl overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-5 sm:px-7">
          <LogoVerto size={34} showText={true} />
          {stage === 'content' && <a href="/rede-de-cuidado" className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"><ArrowLeft size={13} /> Compartilhados comigo</a>}
        </header>
        <div className="p-5 sm:p-7">
          {stage === 'loading' && <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center"><Loader2 size={30} className="animate-spin text-[#7a32fc]" /><p className="text-sm font-medium text-slate-500">Validando acesso...</p></div>}

          {stage === 'unavailable' && <StateCard icon={<LockKeyhole size={30} />} title="Compartilhamento indisponível" text="Este acesso pode ter sido revogado, arquivado ou não estar mais disponível." />}

          {stage === 'refresh' && (
            <StateCard icon={<RefreshCw size={30} />} title="Este acesso precisa ser renovado" text="Por segurança, links antigos não funcionam como credencial permanente.">
              <button type="button" onClick={() => void resendAccess()} disabled={busy} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-5 text-sm font-semibold text-white disabled:opacity-60">{busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Enviar novo acesso</button>
            </StateCard>
          )}

          {stage === 'mismatch' && (
            <StateCard icon={<LockKeyhole size={30} />} title="Este compartilhamento pertence a outra conta" text="Troque de conta para continuar. Nenhum dado clínico foi exibido.">
              <button type="button" onClick={() => void switchAccount()} disabled={busy} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-5 text-sm font-semibold text-white disabled:opacity-60">{busy ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />} Trocar conta</button>
            </StateCard>
          )}

          {(stage === 'activate' || stage === 'login') && (
            <div className="mx-auto max-w-md py-4 sm:py-8">
              <div className="rounded-2xl bg-violet-50 p-3 text-[#7a32fc] w-fit"><ShieldCheck size={24} /></div>
              <h1 className="mt-4 text-2xl font-semibold text-slate-900">Você recebeu um compartilhamento clínico</h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">{stage === 'activate' ? 'Crie uma senha para acessar este conteúdo e outros que forem compartilhados com este e-mail.' : 'Entre com sua conta Verto para acessar este compartilhamento.'}</p>
              <div className="mt-6 space-y-3">
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">E-mail</span><input value={email} readOnly className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700" /></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">{stage === 'activate' ? 'Nova senha' : 'Senha'}</span><input type="password" autoComplete={stage === 'activate' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#7a32fc]" /></label>
                {stage === 'activate' && <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Confirmar senha</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#7a32fc]" /></label>}
                {stage === 'activate' && <p className="text-[11px] leading-5 text-slate-400">Use 12 ou mais caracteres, com maiúscula, minúscula, número e símbolo.</p>}
                <button type="button" onClick={() => void (stage === 'activate' ? activate() : login())} disabled={busy} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-sm font-semibold text-white shadow-md shadow-violet-500/20 disabled:opacity-60">{busy ? <Loader2 size={17} className="animate-spin" /> : <ShieldCheck size={17} />} {stage === 'activate' ? 'Criar acesso e continuar' : 'Entrar e continuar'}</button>
                {stage === 'login' && <><div className="flex items-center gap-3 py-1 text-[10px] uppercase tracking-wider text-slate-400"><span className="h-px flex-1 bg-slate-200" /><span>ou</span><span className="h-px flex-1 bg-slate-200" /></div><button type="button" onClick={() => void loginWithGoogle()} disabled={busy} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"><GoogleIcon className="h-4 w-4" /> Continuar com Google</button><button type="button" onClick={() => void requestPasswordRecovery()} disabled={busy} className="w-full text-center text-xs font-medium text-[#7a32fc] hover:underline disabled:opacity-60">Definir ou recuperar senha</button></>}
              </div>
            </div>
          )}

          {stage === 'content' && content?.item && (
            <div data-testid="external-evolution-authenticated-share">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600"><ShieldCheck size={22} /></div>
                <div><p className="text-xs font-semibold uppercase tracking-widest text-emerald-600">Compartilhamento autorizado</p><h1 className="mt-1 text-xl font-semibold text-slate-900">{content.item.subject || 'Evolução compartilhada'}</h1><p className="mt-1 text-sm text-slate-500">{content.patientName || 'Paciente'} · {content.clinicName || 'Clínica'}</p></div>
              </div>
              <article className="mt-6 rounded-2xl border border-slate-200 p-5">
                {content.item.createdAt && <p className="text-[11px] text-slate-400">Compartilhado em {formatDateTime(content.item.createdAt)}</p>}
                {content.item.content && <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">{content.item.content}</p>}
                {content.item.attachment && <button type="button" onClick={() => void openAttachment()} disabled={busyFile} className="mt-4 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left hover:border-violet-200"><span className="flex min-w-0 items-center gap-2"><FileText size={16} className="shrink-0 text-[#7a32fc]" /><span><span className="block truncate text-xs font-medium text-slate-800">{content.item.attachment.fileName || 'Documento'}</span><span className="block text-[10px] text-slate-400">{formatBytes(content.item.attachment.sizeBytes)}</span></span></span>{busyFile ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} className="text-slate-400" />}</button>}
              </article>
              <section className="mt-5 rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center gap-2"><MessageCircle size={16} className="text-[#7a32fc]" /><h2 className="text-sm font-semibold text-slate-900">Comentário / devolutiva</h2></div>
                {(content.comments || []).length > 0 && <div className="mt-3 space-y-2">{(content.comments || []).map((entry) => <div key={entry.id} className="rounded-xl bg-slate-50 px-3 py-2.5"><p className="whitespace-pre-wrap text-xs leading-5 text-slate-700">{entry.body}</p>{entry.createdAt && <p className="mt-1 text-[9px] text-slate-400">{formatDateTime(entry.createdAt)}</p>}</div>)}</div>}
                {content.canComment ? <><textarea value={comment} maxLength={4000} onChange={(event) => setComment(event.target.value)} placeholder="Escreva sua devolutiva" className="mt-3 min-h-28 w-full resize-y rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-[#7a32fc]" /><div className="mt-2 flex items-center justify-between gap-3"><span className="text-[10px] text-slate-400">{comment.length}/4000</span><button type="button" onClick={() => void sendComment()} disabled={busy || !comment.trim()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-xs font-semibold text-white disabled:opacity-60">{busy ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />} Enviar</button></div></> : <p className="mt-3 text-xs text-slate-500">Este compartilhamento está disponível somente para visualização.</p>}
              </section>
            </div>
          )}

          {error && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">{error}</div>}
          {message && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700">{message}</div>}
        </div>
      </section>
    </main>
  );
};

const StateCard = ({ icon, title, text, children }: { icon: React.ReactNode; title: string; text: string; children?: React.ReactNode }) => (
  <div className="flex min-h-[320px] flex-col items-center justify-center text-center text-slate-400">
    {icon}
    <h1 className="mt-4 text-xl font-semibold text-slate-900">{title}</h1>
    <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{text}</p>
    {children}
  </div>
);
