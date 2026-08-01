import React, { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '../lib/supabase';
import { GoogleIcon } from './GoogleIcon';
import { LogoVerto } from './Common';

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
  const safeAuthErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : 'Falha na operação de autenticação.';

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
  const [newPassword, setNewPassword] = useState('');
  const [identifiedEmail, setIdentifiedEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [intendedRole, setIntendedRole] = useState<'patient' | 'coordinator'>('patient');
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

    if (code || tokenHash || accessToken || refreshToken) {
      // Token exchanges must not inherit a stale local session. A plain invitation link,
      // however, keeps an already authenticated professional signed in.
      try {
        await supabase.auth.signOut({ scope: 'local' } as any);
      } catch {
        // no-op
      }
    }

    if (code) {
      try {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) throw exchangeError;
      } catch (exchangeErr) {
        console.error('Activation code exchange failed:', safeAuthErrorMessage(exchangeErr));
      }
    } else if (tokenHash) {
      try {
        const otpType = type || 'signup';
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: otpType as any,
        });
        if (verifyError) throw verifyError;
      } catch (verifyErr) {
        console.error('Activation verification failed:', safeAuthErrorMessage(verifyErr));
      }
    } else if (accessToken && refreshToken) {
      try {
        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (setSessionError) throw setSessionError;
      } catch (setSessionErr) {
        console.error('Activation session setup failed:', safeAuthErrorMessage(setSessionErr));
      }
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const sessionEmail = String(session?.user?.email || '').trim().toLowerCase();
    if (sessionEmail) {
      setIdentifiedEmail(sessionEmail);
      setEmail(sessionEmail);
      setIsActivationLinkContext(true);
      if (hasActivationParams) {
        const continuationParams = new URLSearchParams({
          auth_action: action === 'recovery' || type === 'recovery'
            ? 'recovery'
            : action === 'accept_invitation'
              ? 'accept_invitation'
              : 'activate',
        });
        if (parsedInvitationId) continuationParams.set('invitation_id', parsedInvitationId);
        if (parsedInvitationId) continuationParams.set('invite_mode', parsedInviteMode);
        window.history.replaceState({}, document.title, `/?${continuationParams.toString()}`);
      }
      return session;
    }

    setIsActivationLinkContext(true);
    return null;
  };

  const requestActivationBootstrap = async (targetEmail: string) => {
    const safeEmail = String(targetEmail || '').trim().toLowerCase();
    if (!safeEmail) return { link: null, alreadyConfirmed: false };
    try {
      const response = await fetch('/api/auth/activation/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: safeEmail, role: intendedRole }),
      });
      const result = await response.json();
      if (response.ok && result?.success && result?.activationLink) {
        return { link: String(result.activationLink), alreadyConfirmed: false };
      }
      if (response.status === 409 && String(result?.code || '').toUpperCase() === 'ALREADY_CONFIRMED') {
        return { link: null, alreadyConfirmed: true };
      }
    } catch (bootstrapError) {
      console.error('Activation bootstrap error:', bootstrapError);
    }
    return { link: null, alreadyConfirmed: false };
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roleParam = String(params.get('role') || '').toLowerCase();
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
    if (roleParam === 'coordinator' || roleParam === 'therapist' || roleParam === 'receptionist') {
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
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/?${redirectParams.toString()}`,
        },
      });
      if (oauthError) throw oauthError;
    } catch (err: any) {
      setError(err?.message || 'Falha ao iniciar login com Google.');
      setLoading(false);
    }
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
        const recoveryEmail = String(identifiedEmail || email).trim().toLowerCase();
        const otpCode = String(recoveryCode || '').trim();
        if (!recoveryEmail || !otpCode) {
          throw new Error('Informe e-mail e código de recuperação para redefinir a senha.');
        }

        const response = await fetch('/api/auth/password/recovery/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            email: recoveryEmail,
            code: otpCode,
            newPassword,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result?.success) {
          throw new Error(
            result?.message ||
              result?.error ||
              'Link de recuperacao invalido ou expirado. Solicite um novo e-mail de recuperacao.',
          );
        }

        const loginRes = await onLogin(
          null,
          intendedRole,
          { email: recoveryEmail, password: newPassword },
          { provider: 'email', activationFlow: false, passwordSetupCompleted: true, activationEmail: recoveryEmail },
        );
        if (!loginRes?.success) {
          throw new Error(loginRes?.error || 'Senha redefinida, mas nao foi possivel concluir o login.');
        }
        setMessage('Senha redefinida com sucesso. Redirecionando...');
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
          const bootstrapResult = await requestActivationBootstrap(fallbackEmail);
          if (bootstrapResult?.link) {
            window.location.href = bootstrapResult.link;
            return;
          }
          if (bootstrapResult?.alreadyConfirmed) {
            throw new Error(
              'Esta conta já foi ativada. Faça login normal ou use "Esqueci minha senha".',
            );
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
            const bootstrapResult = await requestActivationBootstrap(fallbackEmail);
            if (bootstrapResult?.link) {
              window.location.href = bootstrapResult.link;
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
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full h-11 rounded-xl border border-slate-200 bg-white text-slate-800 font-semibold hover:bg-slate-50 transition disabled:opacity-60"
          >
            <GoogleIcon size={18} />
            {isRecoveryRoute ? 'Continuar com Google' : 'Entrar com Google'}
          </button>

          <div className="border-t border-slate-100 pt-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {isRecoveryRoute ? 'Redefinir senha' : isExistingAccountInvite ? 'Entrar com acesso existente' : 'Definir senha'}
            </p>
            {identifiedEmail ? (
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
            {isRecoveryRoute ? (
              <input
                type="text"
                inputMode="numeric"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Codigo de recuperacao (6 digitos)"
                className="w-full h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#7a32fc]"
              />
            ) : null}
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={isExistingAccountInvite ? 'Senha atual' : 'Nova senha'}
              className="w-full h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#7a32fc]"
            />
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
