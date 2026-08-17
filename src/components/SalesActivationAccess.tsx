import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
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

const validateActivationPassword = (value: string): string | null => {
  if (value.length < 12) return 'A senha deve ter no mínimo 12 caracteres.';
  if (value.length > 128) return 'A senha deve ter no máximo 128 caracteres.';
  if (!/[A-Z]/.test(value)) return 'Inclua ao menos uma letra maiúscula.';
  if (!/[a-z]/.test(value)) return 'Inclua ao menos uma letra minúscula.';
  if (!/\d/.test(value)) return 'Inclua ao menos um número.';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Inclua ao menos um símbolo.';
  return null;
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
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
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
      localStorage.setItem('verto_intended_role', 'director');
      localStorage.setItem('verto_activation_email', activation.email.toLowerCase());
      const supabase = await getSupabase();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/ativacao-comercial/${encodeURIComponent(token)}`,
          scopes: 'https://www.googleapis.com/auth/userinfo.email',
        },
      });
      if (oauthError) throw oauthError;
    } catch (oauthError: any) {
      setError(oauthError?.message || 'Não foi possível iniciar o acesso com Google.');
      setSubmitting(false);
    }
  };

  const finishPasswordLogin = async () => {
    if (!activation?.email || !password) {
      throw new Error('Informe a senha criada para entrar.');
    }

    const authContext = {
      provider: 'email',
      activationFlow: true,
      passwordSetupCompleted: true,
      activationEmail: activation.email,
    };

    // Password activation must be provider-agnostic. A Hotmail address or a
    // clinic-owned domain is a normal e-mail identity and must not depend on a
    // Google/browser Auth session. The Verto backend verifies these credentials
    // against the same Supabase project, provisions the paid clinic, and only
    // then consumes the one-time commercial activation.
    const serverLoginResult = await onLogin(
      null,
      'director',
      { email: activation.email, password },
      authContext,
    );
    if (!serverLoginResult?.success) {
      throw new Error(
        serverLoginResult?.error ||
          'Sua senha foi criada, mas não foi possível abrir a clínica agora.',
      );
    }
    return serverLoginResult;
  };

  const handlePasswordActivation = async () => {
    if (!activation?.email) return;
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const passwordValidationError = validateActivationPassword(password);
      if (passwordValidationError) throw new Error(passwordValidationError);
      if (password !== passwordConfirmation) {
        throw new Error('As senhas informadas não coincidem.');
      }

      if (!passwordSaved) {
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

        // Provisioning happens after Auth persistence. If a downstream step is
        // temporarily unavailable, never make the user think the password was
        // rejected and never force a second password creation against a used
        // activation link. The server explicitly tells us when Auth persisted.
        if (payload?.passwordSaved === true) {
          setPasswordSaved(true);
        }
        if (!response.ok || payload?.success === false) {
          if (payload?.passwordSaved !== true) {
            throw new Error(payload?.message || 'Não foi possível definir sua senha.');
          }
          setMessage('Senha registrada. Concluindo a preparação da sua clínica...');
        } else {
          setPasswordSaved(true);
          setMessage('Senha registrada. Concluindo seu acesso...');
        }
      }

      await finishPasswordLogin();
      window.history.replaceState({}, document.title, '/');
      setMessage('Acesso ativado com sucesso. Abrindo sua clínica...');
    } catch (activationError: any) {
      setError(
        passwordSaved
          ? activationError?.message ||
              'Sua senha foi salva. Tente novamente para concluir a entrada.'
          : activationError?.message || 'Não foi possível concluir a ativação.',
      );
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
                  <span className="relative mt-1.5 block">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      aria-invalid={Boolean(password && validateActivationPassword(password))}
                      className="h-12 w-full rounded-2xl border border-slate-200 px-4 pr-12 text-sm font-normal outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                    </button>
                  </span>
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Confirmar senha
                  <span className="relative mt-1.5 block">
                    <input
                      type={showPasswordConfirmation ? 'text' : 'password'}
                      value={passwordConfirmation}
                      onChange={(event) => setPasswordConfirmation(event.target.value)}
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      aria-invalid={Boolean(passwordConfirmation && password !== passwordConfirmation)}
                      className="h-12 w-full rounded-2xl border border-slate-200 px-4 pr-12 text-sm font-normal outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswordConfirmation((current) => !current)}
                      className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"
                      aria-label={showPasswordConfirmation ? 'Ocultar confirmação de senha' : 'Mostrar confirmação de senha'}
                      aria-pressed={showPasswordConfirmation}
                    >
                      {showPasswordConfirmation ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                    </button>
                  </span>
                </label>
                <p className="text-xs leading-5 text-slate-500">
                  Use de 12 a 128 caracteres, com letra maiúscula, minúscula, número e símbolo.
                </p>
                {password ? (
                  <p
                    className={`text-xs leading-5 ${
                      validateActivationPassword(password) ||
                      (passwordConfirmation && password !== passwordConfirmation)
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                    }`}
                    aria-live="polite"
                  >
                    {validateActivationPassword(password) ||
                      (passwordConfirmation && password !== passwordConfirmation
                        ? 'As senhas ainda não coincidem.'
                        : passwordConfirmation
                          ? 'Senha válida e confirmação idêntica.'
                          : 'Senha válida. Confirme-a no campo abaixo.')}
                  </p>
                ) : null}
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
                disabled={
                  submitting ||
                  !password ||
                  !passwordConfirmation ||
                  (!passwordSaved && Boolean(validateActivationPassword(password))) ||
                  (!passwordSaved && password !== passwordConfirmation)
                }
                className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? <Loader2 className="animate-spin" size={17} aria-hidden="true" /> : <LockKeyhole size={17} aria-hidden="true" />}
                {submitting
                  ? 'Concluindo ativação...'
                  : passwordSaved
                    ? 'Entrar com a senha criada'
                    : 'Definir senha e criar minha clínica'}
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
};
