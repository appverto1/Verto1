import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { getSupabase } from '../lib/supabase';
import { LogoVerto } from './Common';
import { GoogleIcon } from './GoogleIcon';

type SalesActivationAccessProps = {
  token: string;
  onLogin: (
    session: any,
    intendedRole?: string,
    credentials?: { email?: string; password?: string },
    authContext?: {
      provider?: string | null;
      activationFlow?: boolean;
      passwordSetupCompleted?: boolean;
      activationEmail?: string | null;
    },
  ) => Promise<any>;
};

type ActivationSummary = {
  name: string;
  clinicName: string | null;
  email: string;
  expiresAt: string | null;
};

const formatDate = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

export const SalesActivationAccess = ({ token, onLogin }: SalesActivationAccessProps) => {
  const [activation, setActivation] = useState<ActivationSummary | null>(null);
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const loadActivation = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(
          `/api/public/sales-activations/${encodeURIComponent(token)}`,
          { credentials: 'omit', signal: controller.signal },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
          throw new Error(payload?.message || 'Este link de ativação não está disponível.');
        }
        setActivation(payload.activation);
      } catch (loadError: any) {
        if (loadError?.name !== 'AbortError') {
          setError(loadError?.message || 'Não foi possível validar este link.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void loadActivation();
    return () => controller.abort();
  }, [token]);

  const handleGoogleLogin = async () => {
    if (!activation?.email) return;
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      localStorage.setItem('verto_intended_role', 'coordinator');
      localStorage.setItem('verto_activation_email', activation.email.toLowerCase());
      const supabase = await getSupabase();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/ativacao-comercial/${encodeURIComponent(token)}`,
        },
      });
      if (oauthError) throw oauthError;
    } catch (oauthError: any) {
      setError(oauthError?.message || 'Não foi possível iniciar o acesso com Google.');
      setSubmitting(false);
    }
  };

  const handlePasswordActivation = async () => {
    if (!activation?.email) return;
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      if (password !== passwordConfirmation) {
        throw new Error('As senhas informadas não coincidem.');
      }
      const response = await fetch(
        `/api/public/sales-activations/${encodeURIComponent(token)}/password`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          body: JSON.stringify({ password }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.message || 'Não foi possível definir sua senha.');
      }

      const supabase = await getSupabase();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: activation.email,
        password,
      });
      if (signInError || !data.session) {
        throw signInError || new Error('Senha definida, mas não foi possível concluir o login.');
      }

      const loginResult = await onLogin(
        data.session,
        'coordinator',
        { email: activation.email, password },
        {
          provider: 'email',
          activationFlow: true,
          passwordSetupCompleted: true,
          activationEmail: activation.email,
        },
      );
      if (!loginResult?.success) {
        throw new Error(loginResult?.error || 'Não foi possível concluir a ativação.');
      }

      window.history.replaceState({}, document.title, '/');
      setMessage('Acesso ativado com sucesso. Abrindo sua clínica...');
    } catch (activationError: any) {
      setError(activationError?.message || 'Não foi possível concluir a ativação.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 md:py-14">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex justify-center">
          <LogoVerto />
        </div>
        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm md:p-8" aria-live="polite">
          {loading ? (
            <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-slate-600">
              <Loader2 className="animate-spin" size={20} aria-hidden="true" />
              Validando ativação...
            </div>
          ) : error && !activation ? (
            <div className="rounded-2xl border border-rose-100 bg-rose-50 p-5 text-center">
              <AlertCircle className="mx-auto mb-3 text-rose-600" aria-hidden="true" />
              <h1 className="text-lg font-semibold text-slate-900">Ativação indisponível</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">{error}</p>
            </div>
          ) : activation ? (
            <div>
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-violet-50 p-3 text-violet-700">
                  <ShieldCheck size={22} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-violet-600">Pagamento confirmado</p>
                  <h1 className="mt-1 text-xl font-semibold text-slate-900">Ative seu acesso à Verto</h1>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {activation.name}, escolha como deseja acessar a conta vinculada a <span className="font-medium text-slate-800">{activation.email}</span>.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleGoogleLogin()}
                disabled={submitting}
                className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-800 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <GoogleIcon size={18} />
                Vincular e entrar com Google
              </button>

              <div className="my-5 flex items-center gap-3" aria-hidden="true">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-xs text-slate-400">ou defina uma senha</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-medium text-slate-700">
                  Nova senha
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    maxLength={128}
                    className="mt-1.5 h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm font-normal outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Confirmar senha
                  <input
                    type="password"
                    value={passwordConfirmation}
                    onChange={(event) => setPasswordConfirmation(event.target.value)}
                    autoComplete="new-password"
                    maxLength={128}
                    className="mt-1.5 h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm font-normal outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                  />
                </label>
                <p className="text-xs leading-5 text-slate-500">
                  Use de 12 a 128 caracteres, com letra maiúscula, minúscula, número e símbolo.
                </p>
              </div>

              {activation.expiresAt ? (
                <p className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                  Este link pode ser utilizado até {formatDate(activation.expiresAt)}.
                </p>
              ) : null}

              {error ? (
                <p className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700" role="alert">
                  {error}
                </p>
              ) : null}
              {message ? (
                <p className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
                  <CheckCircle2 size={17} aria-hidden="true" /> {message}
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => void handlePasswordActivation()}
                disabled={submitting || !password || !passwordConfirmation}
                className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? <Loader2 className="animate-spin" size={17} aria-hidden="true" /> : <LockKeyhole size={17} aria-hidden="true" />}
                {submitting ? 'Concluindo ativação...' : 'Definir senha e criar minha clínica'}
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
};
