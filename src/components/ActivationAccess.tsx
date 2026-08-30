import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { ensureFreshSession, getSupabase } from '../lib/supabase';
import { GoogleIcon } from './GoogleIcon';
import { LogoVerto } from './Common';
import { extractPasswordRecoveryUrlState } from '../utils/passwordRecoveryUrl';
import { Eye, EyeOff } from 'lucide-react';

type ActivationAccessProps = {
  onLogin: (
    session: any,
    intendedRole?: string,
    credentials?: { email?: string; password?: string },
    authContext?: {
      provider?: string | null;
      activationFlow?: boolean;
      passwordSetupCompleted?: boolean;
      activationEmail?: string | null;
      invitationId?: string | null;
      deferInvitationAcceptance?: boolean;
    },
  ) => Promise<any>;
};

export const ActivationAccess = ({ onLogin }: ActivationAccessProps) => {
  const withActivationTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T | null> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race<T | null>([
        promise,
        new Promise<null>((resolve) => {
          timeoutId = setTimeout(() => resolve(null), Math.max(1, timeoutMs));
        }),
      ]);
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  };

  const authAction = typeof window !== 'undefined'
    ? String(new URLSearchParams(window.location.search).get('auth_action') || '').toLowerCase()
    : '';
  const isRecoveryRoute =
    typeof window !== 'undefined' &&
    (/^\/reset-password\/?$/.test(window.location.pathname) || authAction === 'recovery');
  const isInvitationAcceptanceAction =
    authAction === 'accept_invitation' ||
    (authAction === 'activate' &&
      String(new URLSearchParams(window.location.search).get('invite_mode') || '').toLowerCase() === 'existing');
  const [email, setEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryToken, setRecoveryToken] = useState('');
  const [invitationActivationToken, setInvitationActivationToken] = useState('');
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const recoveryUrlState = extractPasswordRecoveryUrlState(window.location.href);
    if (recoveryUrlState.hadRecoveryToken) {
      if (recoveryUrlState.recoveryToken) {
        setRecoveryToken(recoveryUrlState.recoveryToken);
      }
      window.history.replaceState(
        window.history.state,
        document.title,
        recoveryUrlState.sanitizedRelativeUrl,
      );
    }

    const currentUrl = new URL(window.location.href);
    const hashParams = new URLSearchParams(currentUrl.hash.replace(/^#/, ''));
    const inviteToken = String(
      currentUrl.searchParams.get('invite_token') || hashParams.get('invite_token') || '',
    ).trim();
    if (inviteToken && inviteToken.length <= 4096) {
      setInvitationActivationToken(inviteToken);
      currentUrl.searchParams.delete('invite_token');
      hashParams.delete('invite_token');
      currentUrl.hash = hashParams.toString();
      window.history.replaceState(
        window.history.state,
        document.title,
        `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
      );
    }
  }, []);
  const [mfaToken, setMfaToken] = useState('');
  const [requiresMfa, setRequiresMfa] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [identifiedEmail, setIdentifiedEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [intendedRole, setIntendedRole] = useState<'patient' | 'coordinator'>(() =>
    isInvitationAcceptanceAction ? 'coordinator' : 'patient',
  );
  const [isActivationLinkContext, setIsActivationLinkContext] = useState(true);
  const [invitationId, setInvitationId] = useState('');
  const [inviteMode, setInviteMode] = useState<'new' | 'existing'>('new');
  const isExistingAccountInvite =
    !isRecoveryRoute &&
    Boolean(invitationId) &&
    (inviteMode === 'existing' || isInvitationAcceptanceAction);

  useEffect(() => {
    const applyActivationError = (message: unknown) => {
      const safeMessage = String(message || '').trim();
      if (safeMessage) setError(safeMessage);
    };
    try {
      const storedError = window.sessionStorage.getItem('verto_activation_error');
      if (storedError) {
        applyActivationError(storedError);
        window.sessionStorage.removeItem('verto_activation_error');
      }
    } catch {
      // Session storage is optional.
    }
    const handleActivationError = (event: Event) => {
      applyActivationError((event as CustomEvent<{ message?: string }>).detail?.message);
    };
    window.addEventListener('verto:activation-error', handleActivationError);
    return () => window.removeEventListener('verto:activation-error', handleActivationError);
  }, []);

  const parseActivationParams = () => {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));

    const type = String(searchParams.get('type') || hashParams.get('type') || '').toLowerCase();
    const code = String(searchParams.get('code') || '').trim();
    const tokenHash = String(searchParams.get('token_hash') || hashParams.get('token_hash') || '').trim();
    const accessToken = String(searchParams.get('access_token') || hashParams.get('access_token') || '').trim();
    const refreshToken = String(searchParams.get('refresh_token') || hashParams.get('refresh_token') || '').trim();
    const action = String(searchParams.get('auth_action') || '').toLowerCase();
    const parsedInvitationId = String(searchParams.get('invitation_id') || '').trim();
    const parsedInviteMode = String(searchParams.get('invite_mode') || '').toLowerCase();

    const hasActivationParams =
      Boolean(code) ||
      Boolean(tokenHash) ||
      Boolean(accessToken) ||
      Boolean(refreshToken) ||
      Boolean(parsedInvitationId) ||
      action === 'activate' ||
      action === 'accept_invitation' ||
      action === 'recovery' ||
      type === 'signup' ||
      type === 'recovery' ||
      type === 'invite';

    return {
      type,
      action,
      code,
      tokenHash,
      accessToken,
      refreshToken,
      invitationId: parsedInvitationId,
      inviteMode: parsedInviteMode === 'existing' ? 'existing' : 'new',
      hasActivationParams,
    };
  };

  const establishSessionFromUrl = async () => {
    const { type, action, code, tokenHash, accessToken, refreshToken, invitationId: parsedInvitationId, inviteMode: parsedInviteMode, hasActivationParams } =
      parseActivationParams();
    const supabase = await getSupabase();
    let resolvedSession: any = null;

    if (code || tokenHash || accessToken || refreshToken) {
      // A sessão será substituída pela operação canônica abaixo. Não fazemos signOut
      // local antes da troca porque isso disputa o mesmo auth lock do callback OAuth.
      setIsActivationLinkContext(true);
    }

    if (code) {
      // OAuth/PKCE code exchange is centralized in ensureFreshSession. Keeping a
      // single owner avoids the automatic/manual double exchange that could hold
      // the Supabase auth lock and leave the activation screen waiting forever.
      resolvedSession = await ensureFreshSession({ sessionTimeoutMs: 2500, urlExchangeTimeoutMs: 8000 });
      if (!resolvedSession) {
        throw new Error('A autenticação com Google demorou além do esperado. Tente novamente.');
      }
    } else if (tokenHash) {
      const otpType = type || 'signup';
      const verified = await withActivationTimeout(
        supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: otpType as any,
        }),
        8000,
      );
      if (!verified) throw new Error('Tempo esgotado ao validar o link de ativação.');
      if ((verified as any)?.error) throw (verified as any).error;
      resolvedSession = (verified as any)?.data?.session || null;
    } else if (accessToken && refreshToken) {
      const established = await withActivationTimeout(
        supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        }),
        8000,
      );
      if (!established) throw new Error('Tempo esgotado ao concluir a sessão de ativação.');
      if ((established as any)?.error) throw (established as any).error;
      resolvedSession = (established as any)?.data?.session || null;
    }

    const session = resolvedSession || await ensureFreshSession({ sessionTimeoutMs: 2500, urlExchangeTimeoutMs: 8000 });

    const sessionEmail = String(session?.user?.email || '').trim().toLowerCase();
    if (sessionEmail) {
      const userMetadata = session?.user?.user_metadata && typeof session.user.user_metadata === 'object'
        ? session.user.user_metadata
        : {};
      const metadataInvitationId = String(
        userMetadata?.invitation_id || userMetadata?.clinic_invitation_id || '',
      ).trim();
      const resolvedInvitationId = parsedInvitationId ||
        (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(metadataInvitationId)
          ? metadataInvitationId
          : '');
      const resolvedInviteMode = parsedInvitationId ? parsedInviteMode : resolvedInvitationId ? 'new' : parsedInviteMode;
      const metadataInvitedRole = String(userMetadata?.invited_role || '').trim().toLowerCase();

      setIdentifiedEmail(sessionEmail);
      setEmail(sessionEmail);
      setIsActivationLinkContext(true);
      if (resolvedInvitationId || ['director', 'coordinator', 'supervisor', 'admin', 'therapist', 'receptionist', 'biller'].includes(metadataInvitedRole)) {
        setIntendedRole('coordinator');
      }
      if (resolvedInvitationId) {
        setInvitationId(resolvedInvitationId);
        setInviteMode(resolvedInviteMode);
        localStorage.setItem('verto_activation_invitation_id', resolvedInvitationId);
        localStorage.setItem('verto_activation_invite_mode', resolvedInviteMode);
      }
      if (hasActivationParams || resolvedInvitationId) {
        const continuationParams = new URLSearchParams({
          auth_action: action === 'recovery' || type === 'recovery'
            ? 'recovery'
            : action === 'accept_invitation'
              ? 'accept_invitation'
              : 'activate',
        });
        if (resolvedInvitationId) continuationParams.set('invitation_id', resolvedInvitationId);
        if (resolvedInvitationId) continuationParams.set('invite_mode', resolvedInviteMode);
        window.history.replaceState({}, document.title, `/?${continuationParams.toString()}`);
      }
      return session;
    }

    setIsActivationLinkContext(true);
    return null;
  };

  const requestActivationBootstrap = async (targetEmail: string) => {
    const safeEmail = String(targetEmail || '').trim().toLowerCase();
    if (!safeEmail) return false;
    try {
      const response = await fetch('/api/auth/activation/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: safeEmail }),
      });
      const result = await response.json().catch(() => ({}));
      return response.ok && result?.success === true;
    } catch (bootstrapError) {
      console.error('Activation bootstrap error:', bootstrapError);
    }
    return false;
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roleParam = String(params.get('role') || '').toLowerCase();
    const actionParam = String(params.get('auth_action') || '').toLowerCase();
    const emailParam = String(params.get('email') || '').trim().toLowerCase();
    const codeParam = String(params.get('code') || '').trim();
    const invitationParam = String(
      params.get('invitation_id') || localStorage.getItem('verto_activation_invitation_id') || '',
    ).trim();
    const inviteModeParam = String(
      params.get('invite_mode') || localStorage.getItem('verto_activation_invite_mode') || '',
    ).toLowerCase();
    if (emailParam) {
      setEmail(emailParam);
      setIdentifiedEmail(emailParam);
      localStorage.setItem('verto_activation_email', emailParam);
    }
    if (invitationParam) {
      setInvitationId(invitationParam);
      localStorage.setItem('verto_activation_invitation_id', invitationParam);
      if (String(params.get('auth_action') || '').toLowerCase() === 'accept_invitation') {
        localStorage.setItem('verto_pending_invitation_acceptance', 'true');
      }
    }
    const resolvedInviteMode = inviteModeParam === 'existing' ? 'existing' : 'new';
    setInviteMode(resolvedInviteMode);
    localStorage.setItem('verto_activation_invite_mode', resolvedInviteMode);
    if (codeParam) {
      setRecoveryCode(codeParam);
    }
    if (
      roleParam === 'coordinator' ||
      roleParam === 'therapist' ||
      roleParam === 'receptionist' ||
      actionParam === 'accept_invitation' ||
      Boolean(invitationParam)
    ) {
      setIntendedRole('coordinator');
      return;
    }
    setIntendedRole('patient');
  }, []);

  useEffect(() => {
    const hydrateActivationContext = async () => {
      try {
        await establishSessionFromUrl();
      } catch (sessionError) {
        console.error('Activation session detection failed:', sessionError);
        setError('Nao foi possivel validar o link de ativacao. Abra novamente pelo e-mail.');
      }
    };

    void hydrateActivationContext();
  }, []);

  const passwordHint = useMemo(
    () => 'Use no minimo 12 caracteres, com maiuscula, minuscula, numero e simbolo.',
    [],
  );

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      localStorage.setItem('verto_intended_role', intendedRole);
      const expectedEmail = String(identifiedEmail || email || '').trim().toLowerCase();
      if (expectedEmail) {
        localStorage.setItem('verto_activation_email', expectedEmail);
      }
      if (invitationId) {
        localStorage.setItem('verto_activation_invitation_id', invitationId);
        localStorage.setItem('verto_activation_invite_mode', inviteMode);
        if (isInvitationAcceptanceAction) {
          localStorage.setItem('verto_pending_invitation_acceptance', 'true');
        }
      }
      const redirectParams = new URLSearchParams({
        auth_action: isRecoveryRoute
          ? 'recovery'
          : isInvitationAcceptanceAction
            ? 'accept_invitation'
            : 'activate',
        role: intendedRole,
      });
      if (expectedEmail) redirectParams.set('email', expectedEmail);
      if (invitationId) redirectParams.set('invitation_id', invitationId);
      if (!isRecoveryRoute && !isInvitationAcceptanceAction && invitationId) redirectParams.set('invite_mode', inviteMode);
      const supabase = await getSupabase();
      const oauthResult = await withActivationTimeout(
        supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}/?${redirectParams.toString()}`,
            // Some Google Workspace tenants require the e-mail scope explicitly.
            // The server still enforces that the authenticated e-mail matches the invite.
            scopes: 'https://www.googleapis.com/auth/userinfo.email',
          },
        }),
        8000,
      );
      if (!oauthResult) throw new Error('Tempo esgotado ao iniciar o acesso com Google. Tente novamente.');
      if ((oauthResult as any)?.error) throw (oauthResult as any).error;
    } catch (err: any) {
      setError(err?.message || 'Falha ao iniciar login com Google.');
      setLoading(false);
    }
  };

  const validateRecoveryPassword = (value: string): string | null => {
    if (value.length < 12 || value.length > 128) {
      return 'Use uma senha entre 12 e 128 caracteres.';
    }
    if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
      return 'Inclua letra maiúscula, letra minúscula, número e símbolo.';
    }
    return null;
  };

  const handleSetPassword = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      if (!newPassword) {
        throw new Error(isExistingAccountInvite ? 'Informe sua senha atual.' : 'Informe a nova senha.');
      }
      if (isExistingAccountInvite) {
        const existingEmail = String(identifiedEmail || email).trim().toLowerCase();
        if (!existingEmail || !invitationId) {
          throw new Error('Não foi possível identificar o convite. Abra novamente pelo e-mail.');
        }
        const loginRes = await onLogin(
          null,
          intendedRole,
          { email: existingEmail, password: newPassword },
          {
            provider: 'email',
            activationFlow: !isInvitationAcceptanceAction,
            passwordSetupCompleted: false,
            activationEmail: existingEmail,
            invitationId,
            deferInvitationAcceptance: isInvitationAcceptanceAction,
          },
        );
        if (!loginRes?.success) {
          throw new Error(loginRes?.error || 'Não foi possível entrar com este acesso.');
        }
        setMessage('Acesso confirmado. Revise e aceite o novo vínculo.');
        return;
      }
      if (isRecoveryRoute) {
        const passwordValidationError = validateRecoveryPassword(newPassword);
        if (passwordValidationError) {
          throw new Error(passwordValidationError);
        }
        const recoveryEmail = String(identifiedEmail || email).trim().toLowerCase();
        const otpCode = String(recoveryCode || '').trim();
        if (!recoveryToken && (!recoveryEmail || !otpCode)) {
          throw new Error('Informe e-mail e código de recuperação para redefinir a senha.');
        }

        const response = await fetch('/api/auth/password/recovery/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            ...(recoveryToken
              ? { recoveryToken }
              : { email: recoveryEmail, code: otpCode }),
            newPassword,
            ...(mfaToken ? { mfaToken } : {}),
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result?.success) {
          if (String(result?.error || '').toUpperCase() === 'MFA_REQUIRED') {
            setRequiresMfa(true);
          }
          throw new Error(
            result?.message ||
              result?.error ||
              'Link de recuperacao invalido ou expirado. Solicite um novo e-mail de recuperacao.',
          );
        }

        const loginEmail = String(result?.loginEmail || recoveryEmail).trim().toLowerCase();
        const loginRes = await onLogin(
          null,
          intendedRole,
          { email: loginEmail, password: newPassword },
          {
            provider: 'email',
            activationFlow: Boolean(invitationId),
            passwordSetupCompleted: true,
            activationEmail: loginEmail,
            invitationId: invitationId || null,
          },
        );
        if (!loginRes?.success) {
          throw new Error(loginRes?.error || 'Senha redefinida, mas nao foi possivel concluir o login.');
        }
        setMessage('Senha redefinida com sucesso. Redirecionando...');
        return;
      }
      if (invitationActivationToken) {
        const passwordValidationError = validateRecoveryPassword(newPassword);
        if (passwordValidationError) {
          throw new Error(passwordValidationError);
        }
        const invitedEmail = String(identifiedEmail || email).trim().toLowerCase();
        if (!invitedEmail || !invitationId) {
          throw new Error('Não foi possível identificar o convite. Abra novamente pelo e-mail.');
        }

        const response = await fetch('/api/auth/invitation/password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            token: invitationActivationToken,
            newPassword,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result?.success) {
          throw new Error(
            result?.message ||
              result?.error ||
              'Não foi possível concluir a ativação deste convite.',
          );
        }

        const loginEmail = String(result?.loginEmail || invitedEmail).trim().toLowerCase();
        const loginInvitationId = String(result?.invitationId || invitationId).trim();
        const loginRes = await onLogin(
          null,
          intendedRole,
          { email: loginEmail, password: newPassword },
          {
            provider: 'email',
            activationFlow: true,
            passwordSetupCompleted: true,
            activationEmail: loginEmail,
            invitationId: loginInvitationId || null,
          },
        );
        if (!loginRes?.success) {
          throw new Error(loginRes?.error || 'Senha definida, mas não foi possível concluir o login.');
        }
        setInvitationActivationToken('');
        setMessage('Senha definida com sucesso. Redirecionando...');
        return;
      }
      const supabase = await getSupabase();
      let {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        session = await establishSessionFromUrl();
      }

      if (!session?.user) {
        if (!isRecoveryRoute) {
          const fallbackEmail = String(identifiedEmail || email).trim().toLowerCase();
          const resendRequested = await requestActivationBootstrap(fallbackEmail);
          if (resendRequested) {
            setMessage(
              'Se esta conta ainda estiver pendente, enviaremos um novo link de ativação por e-mail.',
            );
            return;
          }
        }
        throw new Error(
          isRecoveryRoute
            ? 'Link de recuperacao invalido ou expirado. Solicite um novo e-mail de recuperacao.'
            : 'Nao foi possivel validar o link automaticamente. Solicite um novo e-mail de ativacao.',
        );
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) {
        const msg = String((updateError as any)?.message || '').toLowerCase();
        if (
          msg.includes('user from sub claim in jwt does not exist') ||
          msg.includes('jwt') ||
          msg.includes('forbidden')
        ) {
          const fallbackEmail = String(identifiedEmail || email).trim().toLowerCase();
          if (!isRecoveryRoute && fallbackEmail) {
            const resendRequested = await requestActivationBootstrap(fallbackEmail);
            if (resendRequested) {
              setMessage(
                'Se esta conta ainda estiver pendente, enviaremos um novo link de ativação por e-mail.',
              );
              return;
            }
          }
        }
        throw updateError;
      }

      const {
        data: { session: refreshedSession },
      } = await supabase.auth.getSession();

      const userEmail = String(session.user.email || identifiedEmail || email).trim().toLowerCase();
      const loginRes = await onLogin(
        refreshedSession || session,
        intendedRole,
        { email: userEmail },
        {
          provider: 'email',
          activationFlow: true,
          passwordSetupCompleted: true,
          activationEmail: userEmail,
          invitationId: invitationId || null,
        },
      );
      if (!loginRes?.success) {
        throw new Error(loginRes?.error || 'Senha definida, mas nao foi possivel concluir o login.');
      }
      setMessage(
        isRecoveryRoute
          ? 'Senha redefinida com sucesso. Redirecionando...'
          : 'Senha definida com sucesso. Redirecionando...',
      );
    } catch (err: any) {
      setError(err?.message || 'Falha ao definir senha.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-white border border-slate-100 rounded-3xl shadow-sm p-6 md:p-8">
        <div className="text-center mb-6">
          <LogoVerto size={34} showText={true} className="mx-auto mb-5" />
          <h1 className="text-2xl font-extrabold text-slate-900">
            {isRecoveryRoute ? 'Recuperacao de Senha' : isExistingAccountInvite ? 'Entrar e aceitar convite' : 'Ativacao de Conta'}
          </h1>
          <p className="text-sm text-slate-500 mt-2">
            {isRecoveryRoute
              ? 'Defina sua nova senha pelo link recebido no e-mail de recuperacao.'
              : isExistingAccountInvite
              ? 'Use o mesmo acesso que você já possui na Verto para entrar na clínica que enviou este convite.'
              : isActivationLinkContext
              ? 'Defina sua senha para ativar o acesso. O e-mail ja foi identificado no convite.'
              : 'Entre com Google, entre com sua senha, ou ative sua conta pelo link recebido no e-mail.'}
          </p>
        </div>

        <div className="space-y-4">
          {!isRecoveryRoute ? (
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full h-11 rounded-xl border border-slate-200 bg-white text-slate-800 font-semibold hover:bg-slate-50 transition disabled:opacity-60 flex items-center justify-center gap-3"
            >
              <GoogleIcon size={18} className="shrink-0" />
              <span>Entrar com Google</span>
            </button>
          ) : null}

          <div className="border-t border-slate-100 pt-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {isRecoveryRoute ? 'Redefinir senha' : isExistingAccountInvite ? 'Entrar com acesso existente' : 'Definir senha'}
            </p>
            {isRecoveryRoute && recoveryToken ? (
              <p className="rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-xs leading-relaxed text-violet-700">
                Link de recuperação identificado. Defina uma nova senha para continuar.
              </p>
            ) : identifiedEmail ? (
              <p className="text-xs text-slate-500">
                E-mail identificado: <span className="font-semibold">{identifiedEmail}</span>
              </p>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-slate-500">
                  Informe o e-mail usado no convite para validar a ativação.
                </p>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seuemail@exemplo.com"
                  className="w-full h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#7a32fc]"
                />
              </div>
            )}
            {isRecoveryRoute && !recoveryToken ? (
              <input
                type="text"
                inputMode="numeric"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Codigo de recuperacao (6 digitos)"
                className="w-full h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#7a32fc]"
              />
            ) : null}
            {isRecoveryRoute && requiresMfa ? (
              <div className="space-y-1">
                <label htmlFor="recovery-mfa-token" className="text-xs font-medium text-slate-600">
                  Código do Google Authenticator
                </label>
                <input
                  id="recovery-mfa-token"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={mfaToken}
                  onChange={(event) => setMfaToken(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6 dígitos"
                  className="w-full h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#7a32fc]"
                />
              </div>
            ) : null}
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={isExistingAccountInvite ? 'Senha atual' : 'Nova senha'}
                autoComplete={isExistingAccountInvite ? 'current-password' : 'new-password'}
                className="w-full h-11 rounded-xl border border-slate-200 px-3 pr-11 text-sm outline-none focus:border-[#7a32fc]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-300"
              >
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </div>
            {!isExistingAccountInvite ? <p className="text-xs text-slate-400">{passwordHint}</p> : null}
            <button
              onClick={handleSetPassword}
              disabled={loading}
              className="w-full h-11 rounded-xl border border-[#7a32fc] text-[#7a32fc] font-semibold hover:bg-violet-50 transition disabled:opacity-60"
            >
              {isRecoveryRoute ? 'Redefinir senha e entrar' : isExistingAccountInvite ? 'Entrar e aceitar convite' : 'Definir senha e entrar'}
            </button>
          </div>
        </div>

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        {message ? <p className="mt-4 text-sm text-emerald-600">{message}</p> : null}
      </div>
    </div>
  );
};
