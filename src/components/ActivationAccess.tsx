import React, { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '../lib/supabase';

type ActivationAccessProps = {
  onLogin: (
    session: any,
    intendedRole?: string,
    credentials?: { email?: string; password?: string },
    authContext?: { provider?: string | null },
  ) => Promise<any>;
};

export const ActivationAccess = ({ onLogin }: ActivationAccessProps) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [intendedRole, setIntendedRole] = useState<'patient' | 'coordinator'>('patient');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roleParam = String(params.get('role') || '').toLowerCase();
    if (roleParam === 'coordinator' || roleParam === 'therapist' || roleParam === 'receptionist') {
      setIntendedRole('coordinator');
      return;
    }
    setIntendedRole('patient');
  }, []);

  const passwordHint = useMemo(
    () => 'Use no mínimo 12 caracteres, com maiúscula, minúscula, número e símbolo.',
    [],
  );

  const handleEmailLogin = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const safeEmail = String(email || '').trim().toLowerCase();
      if (!safeEmail || !password) {
        throw new Error('Informe e-mail e senha para entrar.');
      }

      const supabase = await getSupabase();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: safeEmail,
        password,
      });
      if (signInError) throw signInError;

      const loginRes = await onLogin(
        data.session,
        intendedRole,
        { email: safeEmail, password },
        { provider: 'email' },
      );
      if (!loginRes?.success) {
        throw new Error(loginRes?.error || 'Não foi possível concluir o login.');
      }
    } catch (err: any) {
      setError(err?.message || 'Falha ao entrar.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      localStorage.setItem('verto_intended_role', intendedRole);
      const supabase = await getSupabase();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/ativar`,
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
        throw new Error('Informe a nova senha.');
      }
      const supabase = await getSupabase();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Abra esta tela a partir do link de ativação recebido no e-mail.');
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) throw updateError;

      const {
        data: { session: refreshedSession },
      } = await supabase.auth.getSession();
      const loginRes = await onLogin(
        refreshedSession || session,
        intendedRole,
        { email: session.user.email || email },
        { provider: 'email' },
      );
      if (!loginRes?.success) {
        throw new Error(loginRes?.error || 'Senha definida, mas não foi possível concluir o login.');
      }
      setMessage('Senha definida com sucesso. Redirecionando...');
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
          <h1 className="text-2xl font-extrabold text-slate-900">Ativação de Conta</h1>
          <p className="text-sm text-slate-500 mt-2">
            Continue com Google, entre com sua senha, ou defina uma nova senha usando o link de ativação.
          </p>
        </div>

        <div className="space-y-4">
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full h-12 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-semibold transition disabled:opacity-60"
          >
            Entrar com Google
          </button>

          <div className="border-t border-slate-100 pt-4 space-y-3">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seuemail@exemplo.com"
              className="w-full h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#7a32fc]"
            />
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Sua senha"
              className="w-full h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#7a32fc]"
            />
            <button
              onClick={handleEmailLogin}
              disabled={loading}
              className="w-full h-11 rounded-xl bg-[#7a32fc] text-white font-semibold hover:opacity-95 transition disabled:opacity-60"
            >
              Entrar com e-mail
            </button>
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Definir senha (link de ativação)
            </p>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Nova senha"
              className="w-full h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#7a32fc]"
            />
            <p className="text-xs text-slate-400">{passwordHint}</p>
            <button
              onClick={handleSetPassword}
              disabled={loading}
              className="w-full h-11 rounded-xl border border-[#7a32fc] text-[#7a32fc] font-semibold hover:bg-violet-50 transition disabled:opacity-60"
            >
              Definir senha e entrar
            </button>
          </div>
        </div>

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        {message ? <p className="mt-4 text-sm text-emerald-600">{message}</p> : null}
      </div>
    </div>
  );
};

