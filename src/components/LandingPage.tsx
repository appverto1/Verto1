import React, { useState, useEffect } from 'react';
import { 
  Rocket, 
  ShieldCheck, 
  Zap, 
  Users, 
  ArrowRight, 
  Star, 
  Heart, 
  Brain,
  Image,
  Pencil,
  BarChart3,
  CalendarCheck,
  CheckCircle2,
  Lock,
  Mail,
  Eye,
  EyeOff,
  X,
  Check,
  ChevronDown,
  MessageCircle,
  User,
  Building,
  Stethoscope,
  ArrowLeft,
  Shield,
  Copy,
  ExternalLink
} from 'lucide-react';
import { LogoVerto } from './Common';
import { SecureImage } from './SecureMedia';
import { getSupabase } from '../lib/supabase';
import { dataService } from '../services/dataService';
import { formatProfessionalRegistry } from '../utils/professionalRegistry';

const heroStories = [
  {
    src: '/hero-story-progress.webp',
    alt: 'Tela do paciente na Verto mostrando evolução, registros recentes e gráfico de progresso.'
  },
  {
    src: '/hero-story-diary.webp',
    alt: 'Tela do diário da família na Verto para registrar texto e foto no histórico.'
  }
];

export const LandingPage = ({ onLogin, setUser }: any) => {
  const registerPasswordInputRef = React.useRef<HTMLInputElement | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [loginType, setLoginType] = useState<'professional' | 'patient' | 'coordinator' | null>(null);
  const [registerType, setRegisterType] = useState<'professional' | 'patient' | 'coordinator' | null>(null);
  const [registerStep, setRegisterStep] = useState(1); // 1: Type, 2: Form, 3: Plan (for prof)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [crp, setCrp] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [registerError, setRegisterError] = useState('');
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const [isVerifyingEmail, setIsVerifyingEmail] = useState(false);
  const [showPricingAfterClick, setShowPricingAfterClick] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [twoFactorToken, setTwoFactorToken] = useState('');
  const [twoFactorEmail, setTwoFactorEmail] = useState('');
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [loginStep, setLoginStep] = useState<'email' | 'password'>('email');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [tempSecret, setTempSecret] = useState('');
  const [showPasswordRecovery, setShowPasswordRecovery] = useState(false);
  const [recoveryStep, setRecoveryStep] = useState<'request' | 'verify'>('request');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryNewPassword, setRecoveryNewPassword] = useState('');
  const [recoveryMfaToken, setRecoveryMfaToken] = useState('');
  const [recoveryMfaRequired, setRecoveryMfaRequired] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [activeHeroStory, setActiveHeroStory] = useState(0);

  const parseApiResponse = async (response: Response) => {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { error: text.slice(0, 300) };
    }
  };

  const resetPasswordRecoveryState = () => {
    setShowPasswordRecovery(false);
    setRecoveryStep('request');
    setRecoveryCode('');
    setRecoveryNewPassword('');
    setRecoveryMfaToken('');
    setRecoveryMfaRequired(false);
    setRecoveryLoading(false);
    setRecoveryMessage('');
    setRecoveryError('');
  };

  React.useEffect(() => {
    const savedEmail = localStorage.getItem('verto_email');
    const savedPassword = localStorage.getItem('verto_password');
    const savedRemember = localStorage.getItem('verto_remember') === 'true';
    
    if (savedRemember && savedEmail) {
      setEmail(savedEmail);
      if (savedPassword) setPassword(savedPassword);
      setRememberMe(true);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loginStep === 'email') {
      setLoginStep('password');
      return;
    }
    setLoginError('');
    setLoading(true);
    
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        if (error.message.includes('Email not confirmed')) {
          setLoginError('Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada ou clique abaixo para reenviar o link.');
          return;
        }
        throw error;
      }

      if (data.session) {
        if (rememberMe) {
          localStorage.setItem('verto_email', email);
          localStorage.setItem('verto_password', password);
          localStorage.setItem('verto_remember', 'true');
        } else {
          localStorage.removeItem('verto_email');
          localStorage.removeItem('verto_password');
          localStorage.setItem('verto_remember', 'false');
        }

        // Call onLogin (which is handleLoginSuccess in App.tsx)
        // This will exchange the supabase token for a server session
        const loginRes = await onLogin(data.session, loginType, {
          email,
          password
        });
        
        if (loginRes?.twoFactorRequired) {
          setTwoFactorRequired(true);
          setTwoFactorEmail(loginRes.email);
          setLoginStep('password');
          setShowLogin(true); // Ensure login modal is still open
        } else if (loginRes?.success) {
          setShowLogin(false);
          // App.tsx handles setUser
        } else if (loginRes?.error) {
          throw new Error(loginRes.error);
        }
      }
    } catch (err: any) {
      const rawMessage = String(err?.message || '').toLowerCase();
      const isInvalidCredentials =
        rawMessage.includes('invalid login credentials') ||
        rawMessage.includes('credenciais inválidas') ||
        rawMessage.includes('email or password') ||
        Number(err?.status || 0) === 400;

      if (isInvalidCredentials) {
        setLoginError('E-mail ou senha incorretos. Tente novamente.');
      } else {
        console.error('Login error:', err);
        setLoginError(`Erro no login: ${err?.message || 'Erro de conexão. Tente novamente.'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    try {
      const response = await fetch('/api/auth/resend-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Falha ao reenviar confirmação');
      setLoginError('E-mail de confirmação reenviado com sucesso! Verifique sua caixa de entrada.');
    } catch (err: any) {
      console.error('Resend error:', err);
      setLoginError('Erro ao reenviar confirmação: ' + err.message);
    }
  };

  const openPasswordRecovery = () => {
    setLoginError('');
    setTwoFactorRequired(false);
    setRecoveryError('');
    setRecoveryMessage('');
    setRecoveryMfaRequired(false);
    setRecoveryStep('request');
    setRecoveryCode('');
    setRecoveryNewPassword('');
    setRecoveryMfaToken('');
    setRecoveryEmail(email);
    setShowPasswordRecovery(true);
  };

  const handleRecoveryRequest = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setRecoveryError('');
    setRecoveryMessage('');
    setRecoveryLoading(true);
    try {
      const response = await fetch('/api/auth/password/recovery/email/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: recoveryEmail })
      });
      const data = await parseApiResponse(response);
      if (!response.ok) {
        throw new Error(data?.error || 'Falha ao iniciar recuperação.');
      }
      setRecoveryMessage(data?.message || 'Se este e-mail estiver cadastrado, você receberá instruções.');
      setRecoveryStep('verify');
    } catch (err: any) {
      setRecoveryError(err?.message || 'Não foi possível iniciar a recuperação de senha.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleRecoveryVerify = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setRecoveryError('');
    setRecoveryMessage('');
    setRecoveryLoading(true);
    try {
      const payload: Record<string, string> = {
        email: recoveryEmail,
        code: recoveryCode,
        newPassword: recoveryNewPassword
      };
      if (recoveryMfaToken.trim()) {
        payload.mfaToken = recoveryMfaToken.trim();
      }

      const response = await fetch('/api/auth/password/recovery/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const data = await parseApiResponse(response);

      if (!response.ok) {
        if (response.status === 401 && data?.error === 'MFA_REQUIRED') {
          setRecoveryMfaRequired(true);
          setRecoveryError(data?.message || 'Validação MFA obrigatória para concluir a recuperação.');
          return;
        }
        throw new Error(data?.error || 'Falha ao redefinir senha.');
      }

      setPassword('');
      setRecoveryCode('');
      setRecoveryNewPassword('');
      setRecoveryMfaToken('');
      setRecoveryMfaRequired(false);
      setRecoveryMessage('Senha redefinida com sucesso. Faça login com a nova senha.');
      setShowPasswordRecovery(false);
      setLoginStep('email');
    } catch (err: any) {
      setRecoveryError(err?.message || 'Não foi possível concluir a recuperação de senha.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      // Store intended role in localStorage to retrieve after redirect
      // Use registerType if in register modal, otherwise loginType
      const rawRole = showRegister ? registerType : loginType;
      const roleToStore =
        rawRole === 'patient'
          ? 'patient'
          : rawRole === 'coordinator'
            ? 'coordinator'
            : 'coordinator';
      localStorage.setItem('verto_intended_role', roleToStore);
      
      const supabase = await getSupabase();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        }
      });
      if (error) throw error;
    } catch (err: any) {
      console.error('Google login error:', err);
      setLoginError('Erro ao entrar com Google: ' + err.message);
    }
  };

  const [acquisitionChannel, setAcquisitionChannel] = useState('organic');

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const utmSource = urlParams.get('utm_source');
    if (utmSource) {
      setAcquisitionChannel(utmSource);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveHeroStory((current) => (current + 1) % heroStories.length);
    }, 4200);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const signupMode = String(urlParams.get('signup') || '').toLowerCase();
    const postPaymentMessage = sessionStorage.getItem('verto_professional_signup_success');
    if (signupMode === 'check-email' || postPaymentMessage) {
      setShowLogin(true);
      setLoginStep('email');
      setLoginError(
        postPaymentMessage ||
          'Pagamento confirmado. Confirme seu e-mail para ativar sua conta e concluir o acesso.'
      );
      sessionStorage.removeItem('verto_professional_signup_success');
      if (signupMode === 'check-email') {
        urlParams.delete('signup');
        const nextQuery = urlParams.toString();
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
        window.history.replaceState({}, document.title, nextUrl);
      }
    }
  }, []);

  useEffect(() => {
    const syncCancelledCheckoutLead = async () => {
      const params = new URLSearchParams(window.location.search);
      const payment = params.get('payment');
      const mode = params.get('mode');
      const leadRef = params.get('lead_ref');
      const checkoutSessionId = params.get('checkout_session_id') || params.get('session_id');
      const planName = params.get('plan');

      if (payment !== 'cancel' || mode !== 'professional-signup' || !leadRef) return;

      const dedupeKey = `verto_lead_cancel_sent_${leadRef}_${checkoutSessionId || 'no-session'}`;
      if (sessionStorage.getItem(dedupeKey) === '1') return;

      try {
        await fetch('/api/stripe/checkout-cancelled', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            leadRef,
            checkoutSessionId,
            planName,
            source: 'cancel_url_return'
          })
        });
        sessionStorage.setItem(dedupeKey, '1');
      } catch (error) {
        console.error('Lead cancel sync error:', error);
      } finally {
        params.delete('payment');
        params.delete('mode');
        params.delete('lead_ref');
        params.delete('checkout_session_id');
        params.delete('session_id');
        params.delete('plan');
        const nextQuery = params.toString();
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
        window.history.replaceState({}, document.title, nextUrl);
      }
    };

    void syncCancelledCheckoutLead();
  }, []);

  const handle2FALogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoading(true);
    
    try {
      const supabase = await getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch('/api/auth/2fa/login', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        credentials: 'include',
        body: JSON.stringify({ email: twoFactorEmail, token: twoFactorToken })
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Código inválido');
      
      if (data.success) {
        window.location.reload(); // Reload to pick up new session
      }
    } catch (err: any) {
      setLoginError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const start2FASetup = async () => {
    try {
      const supabase = await getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch('/api/auth/2fa/setup', { 
        method: 'POST',
        credentials: 'include',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        }
      });
      const data = await response.json();
      if (data.qrCodeUrl) {
        setQrCodeUrl(data.qrCodeUrl);
        setTempSecret(data.secret);
        setShow2FASetup(true);
      }
    } catch (err) {
      console.error('2FA setup error:', err);
    }
  };

  const verifyAndEnable2FA = async () => {
    try {
      const supabase = await getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        credentials: 'include',
        body: JSON.stringify({ token: twoFactorToken })
      });
      const data = await response.json();
      if (data.success) {
        setShow2FASetup(false);
        alert('2FA habilitado com sucesso! Use seu app Authenticator no próximo login.');
      } else {
        alert('Código inválido. Tente novamente.');
      }
    } catch (err) {
      console.error('2FA verify error:', err);
    }
  };

  const validateStrongPassword = (value: string): string | null => {
    const normalized = String(value || '');
    if (normalized.length < 12) return 'A senha deve ter no mínimo 12 caracteres.';
    if (!/[A-Z]/.test(normalized)) return 'A senha deve incluir ao menos uma letra maiúscula.';
    if (!/[a-z]/.test(normalized)) return 'A senha deve incluir ao menos uma letra minúscula.';
    if (!/\d/.test(normalized)) return 'A senha deve incluir ao menos um número.';
    if (!/[^A-Za-z0-9]/.test(normalized)) return 'A senha deve incluir ao menos um caractere especial.';
    return null;
  };

  const normalizeWhatsappPhone = (value: string) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 13 && digits.startsWith('55')) return `+${digits}`;
    if (digits.length >= 10 && digits.length <= 11) return `+55${digits}`;
    return '';
  };

  const buildEnterpriseWhatsappUrl = () => {
    const message = 'Olá, me interessei pelo plano enterprise da Verto';
    return `https://wa.me/5511959348563?text=${encodeURIComponent(message)}`;
  };

  const buildDemoWhatsappUrl = () => {
    const message = 'Olá, quero saber mais sobre a Verto.';
    return `https://wa.me/5511959348563?text=${encodeURIComponent(message)}`;
  };

  const handleRegister = async (e: React.FormEvent, planOverride?: string) => {
    e.preventDefault();
    setRegisterError('');
    const effectiveSelectedPlan = planOverride || selectedPlan;

    try {
      if ((registerType === 'professional' || registerType === 'coordinator') && !crp.trim()) {
        setRegisterError('CRP é obrigatório para profissionais.');
        return;
      }
      if ((registerType === 'professional' || registerType === 'coordinator') && !normalizeWhatsappPhone(whatsappPhone)) {
        setRegisterError('WhatsApp é obrigatório para profissionais (com DDD).');
        return;
      }

      const passwordValidationError = validateStrongPassword(password);
      if (passwordValidationError) {
        setRegisterError(passwordValidationError);
        requestAnimationFrame(() => registerPasswordInputRef.current?.focus());
        return;
      }

      if (registerType === 'professional' && !effectiveSelectedPlan) {
        setRegisterStep(3);
        return;
      }

      setLoading(true);
      const endpoint = registerType === 'professional'
        ? '/api/stripe/create-checkout-registration'
        : '/api/auth/signup';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          password,
          name,
          role: registerType === 'professional' ? 'coordinator' : 'patient',
          crp: registerType === 'professional' ? crp : undefined,
          planName: registerType === 'patient' ? 'Paciente' : effectiveSelectedPlan,
          phone: registerType === 'professional' ? normalizeWhatsappPhone(whatsappPhone) : undefined,
          acquisitionChannel
        })
      });

      let data: any = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        throw new Error(data?.error || `Erro ao criar conta (HTTP ${response.status})`);
      }

      if (registerType === 'professional') {
        if (data?.url) {
          try {
            const safeEmail = String(email || '').trim().toLowerCase();
            if (safeEmail) {
              sessionStorage.setItem('verto_pending_professional_signup_email', safeEmail);
            }
          } catch {
            // no-op
          }
          window.location.href = data.url;
          return;
        }
        throw new Error('Checkout não retornou URL de pagamento.');
      }

      alert(data.message || 'Conta criada. Verifique seu e-mail para confirmar o cadastro.');
      setShowRegister(false);
      setLoginStep('email');
      setShowLogin(true);
      setLoginError('Cadastro iniciado. Confirme seu e-mail para concluir o acesso.');
    } catch (error: any) {
      console.error('Register error:', error);
      if (error.message.includes('already been registered') || error.message.includes('já está cadastrado')) {
        setRegisterError('Este e-mail já está cadastrado. Por favor, faça login.');
      } else {
        setRegisterError(error.message || 'Erro ao cadastrar. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
	  };

	  const handleSelectPlan = async (planName: string) => {
    try {
      setSelectedPlan(planName);
      const syntheticSubmitEvent = { preventDefault: () => {} } as React.FormEvent;
      await handleRegister(syntheticSubmitEvent, planName);
    } catch (err: any) {
      console.error('Select plan error:', err);
      setRegisterError('Erro ao processar checkout: ' + err.message);
    }
  };

  return (
    <div className="min-h-screen bg-white font-sans text-gray-900 overflow-x-hidden">
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6">
          <LogoVerto size={40} showText={true} />
          <div className="hidden items-center gap-8 md:flex">
            <a href="#ecossistema" className="text-sm font-semibold text-gray-500 transition-colors hover:text-[#7a32fc]">Ecossistema</a>
            <a href="#operacao" className="text-sm font-semibold text-gray-500 transition-colors hover:text-[#7a32fc]">Operação</a>
            <a href="#contato" className="text-sm font-semibold text-gray-500 transition-colors hover:text-[#7a32fc]">Contato</a>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setLoginType('patient');
                setLoginStep('email');
                setShowLogin(true);
              }}
              className="hidden text-sm font-semibold text-gray-500 transition-colors hover:text-pink-500 sm:block"
            >
              Sou Paciente
            </button>
            <button
              onClick={() => {
                setLoginType('professional');
                setLoginStep('email');
                setShowLogin(true);
              }}
              className="rounded-full bg-[#7a32fc] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition-all hover:opacity-90 active:scale-95"
            >
              Sou Profissional
            </button>
          </div>
        </div>
      </nav>

      <section className="px-6 pb-16 pt-28 md:pb-20 md:pt-32">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-[40px] bg-[#f7f5ff] shadow-sm ring-1 ring-purple-100">
          <div className="grid min-h-[720px] grid-cols-1 lg:min-h-[760px] lg:grid-cols-[1.05fr_0.95fr]">
            <div className="flex flex-col justify-between px-8 py-10 md:px-12 md:py-12 lg:px-14 lg:py-14">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-[#7a32fc] shadow-sm ring-1 ring-purple-100">
                  <Rocket size={14} />
                  Ecossistema de cuidado contínuo
                </span>
                <h1 className="mt-8 max-w-3xl text-4xl font-semibold tracking-tight text-slate-900 md:text-6xl md:leading-[0.95]">
                  A terapia não termina quando a sessão acaba.
                </h1>
                <p className="mt-6 max-w-2xl text-base font-medium leading-8 text-slate-500 md:text-xl md:leading-9">
                  A Verto cria um ecossistema de cuidado contínuo entre paciente, família e profissional — para que cada semana de vida do paciente alimente o trabalho dentro do consultório.
                </p>
                <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={() => window.open(buildDemoWhatsappUrl(), '_blank', 'noopener,noreferrer')}
                    className="inline-flex items-center justify-center gap-3 rounded-2xl bg-[#7a32fc] px-7 py-4 text-sm font-semibold text-white shadow-2xl shadow-purple-500/20 transition-all hover:opacity-90"
                  >
                    Quero saber mais
                    <ArrowRight size={18} />
                  </button>
                </div>
              </div>

              <div className="mt-10 grid gap-3 md:grid-cols-3">
                {[
                  { label: 'Crianças e famílias', value: 'Diário, estrelinhas e evolução visível' },
                  { label: 'Pacientes adultos', value: 'Tarefas, humor e histórico portátil' },
                  { label: 'Clínica e equipe', value: 'Agenda, confirmações e workspaces' }
                ].map((item) => (
                  <div key={item.label} className="rounded-3xl bg-white px-5 py-4 shadow-sm ring-1 ring-gray-100">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{item.label}</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative flex min-h-[520px] items-center justify-center overflow-hidden bg-gradient-to-br from-[#eef6ff] via-white to-[#f4efff] px-6 py-8 lg:min-h-full lg:px-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(122,50,252,0.12),transparent_32%),radial-gradient(circle_at_88%_22%,rgba(5,205,153,0.14),transparent_30%)]" />
              <div className="relative w-full max-w-[360px]">
                <div className="mb-4 flex gap-2 px-1">
                  {heroStories.map((story, index) => (
                    <button
                      key={story.src}
                      type="button"
                      aria-label={`Ver imagem ${index + 1} da hero`}
                      onClick={() => setActiveHeroStory(index)}
                      className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200"
                    >
                      <span
                        className={`block h-full rounded-full bg-[#7a32fc] transition-all duration-700 ${
                          index === activeHeroStory ? 'w-full' : 'w-0'
                        }`}
                      />
                    </button>
                  ))}
                </div>
                <div className="relative aspect-[9/16] overflow-hidden rounded-[38px] border border-white/80 bg-white shadow-2xl shadow-purple-500/15">
                  {heroStories.map((story, index) => (
                    <img
                      key={story.src}
                      src={story.src}
                      alt={story.alt}
                      className={`absolute inset-0 h-full w-full object-contain transition-all duration-700 ${
                        index === activeHeroStory
                          ? 'scale-100 opacity-100'
                          : 'scale-[1.03] opacity-0'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="ecossistema" className="px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-16 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-700">
                Ecossistema
              </span>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900 md:text-5xl">
                Uma hora por semana não dá conta sozinha.
              </h2>
              <p className="mt-6 text-lg font-medium leading-8 text-slate-500">
                O progresso terapêutico acontece no cotidiano — nas reações, nos padrões, nas pequenas conquistas do dia a dia. Sem registro e sem continuidade, esse material se perde antes de chegar ao consultório.
              </p>
              <p className="mt-5 text-lg font-medium leading-8 text-slate-500">
                Para crianças com TEA, o desafio é ainda maior: o avanço depende de reforço consistente fora da sessão, e os pais precisam ser parte ativa do processo — mas quase sempre ficam de fora.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              {[
                {
                  icon: <Image size={22} />,
                  title: 'Foto diária personalizada',
                  desc: 'A criança envia uma foto por dia e a personaliza com um editor criativo antes de compartilhar com a família.'
                },
                {
                  icon: <Pencil size={22} />,
                  title: 'Mural da família',
                  desc: 'Pais e criança fazem registros diários em texto. Um espaço compartilhado que mantém o cuidado vivo entre as sessões.'
                },
                {
                  icon: <Star size={22} />,
                  title: 'Estrelinhas e marcos',
                  desc: 'O terapeuta pontua o engajamento da criança. A clínica cria premiações ao atingir marcos — reforço positivo integrado ao tratamento.'
                },
                {
                  icon: <BarChart3 size={22} />,
                  title: 'Gráfico de progresso',
                  desc: 'A família acompanha a evolução da criança em tempo real — visibilidade que fortalece o vínculo com o tratamento.'
                }
              ].map((item) => (
                <div key={item.title} className="rounded-[32px] border border-gray-100 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#f4f0ff] text-[#7a32fc]">
                    {item.icon}
                  </div>
                  <h3 className="mt-5 text-xl font-semibold tracking-tight text-slate-900">{item.title}</h3>
                  <p className="mt-3 text-sm font-medium leading-7 text-slate-500">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#f9fafc] px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="rounded-[36px] bg-white p-8 shadow-sm ring-1 ring-gray-100 md:p-10">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-orange-500">
                <Zap size={26} />
              </div>
              <h2 className="mt-6 text-3xl font-semibold tracking-tight text-slate-900">Para adultos, o registro vira parte da terapia.</h2>
              <p className="mt-5 text-base font-medium leading-8 text-slate-500">
                Humor, tarefas e registros do dia a dia — tudo organizado no app e disponível para o profissional na sessão. O paciente chega com material. O terapeuta chega com contexto.
              </p>
              <p className="mt-4 text-base font-medium leading-8 text-slate-500">
                O histórico de evolução fica na palma da mão do paciente — acessível, portátil e contínuo, independentemente de qual clínica ou profissional o atende.
              </p>
            </div>

            <div className="rounded-[36px] bg-slate-900 p-8 text-white shadow-sm md:p-10">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-emerald-300">
                <Users size={26} />
              </div>
              <h2 className="mt-6 text-3xl font-semibold tracking-tight">O profissional recebe tudo organizado. A clínica opera sem ruído.</h2>
              <p className="mt-5 text-base font-medium leading-8 text-slate-300">
                Registros do paciente adulto chegam estruturados para discussão na sessão. Para o paciente kids, o terapeuta acompanha o engajamento e pontua com estrelinhas — alimentando o ciclo de reforço positivo.
              </p>
              <p className="mt-4 text-base font-medium leading-8 text-slate-300">
                O psicólogo que atende em mais de uma clínica acessa todos os seus pacientes em um único login, com controle total sobre quais workspaces gerenciar.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="operacao" className="px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-4xl">
            <span className="inline-flex rounded-full bg-[#f4f0ff] px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-[#7a32fc]">
              Operação clínica
            </span>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900 md:text-5xl">
              Para que o ecossistema funcione, a Verto também cuida da operação da sua clínica.
            </h2>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2">
            {[
              {
                icon: <CalendarCheck size={22} />,
                title: 'Confirmação inteligente de consulta',
                desc: 'Notificação 24h antes — e outra 12h antes, se necessário. Sempre dentro do horário respeitoso (8h–21h). O paciente confirma, remarca ou cancela, e a agenda da clínica se atualiza automaticamente.'
              },
              {
                icon: <Users size={22} />,
                title: 'Gestão de equipe e papéis',
                desc: 'Convite por e-mail, atribuição de pacientes e controle de acesso por papel. O coordenador mantém a operação organizada sem depender de processos manuais.'
              },
              {
                icon: <Building size={22} />,
                title: 'Múltiplos workspaces',
                desc: 'O profissional que atende em mais de uma clínica decide quais pacientes gerenciar em cada ambiente — sem confusão e sem trocas de conta.'
              },
              {
                icon: <Shield size={22} />,
                title: 'Histórico portátil e seguro',
                desc: 'Os dados do paciente são dele. O histórico permanece acessível mesmo que o profissional ou a clínica mude — com segurança em padrão HIPAA.'
              }
            ].map((item) => (
              <div key={item.title} className="rounded-[32px] border border-gray-100 bg-white p-7 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                  {item.icon}
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-tight text-slate-900">{item.title}</h3>
                <p className="mt-3 text-sm font-medium leading-7 text-slate-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="contato" className="px-6 pb-20 pt-10">
        <div className="mx-auto max-w-7xl rounded-[40px] bg-slate-900 px-8 py-10 text-white shadow-sm md:px-12 md:py-14">
          <div className="max-w-4xl">
            <h2 className="text-3xl font-semibold tracking-tight md:text-5xl">
              Pronto para estruturar o cuidado contínuo na sua clínica?
            </h2>
            <p className="mt-5 text-lg font-medium leading-8 text-slate-300">
              Conheça a Verto e veja como o ecossistema funciona na prática.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => window.open(buildDemoWhatsappUrl(), '_blank', 'noopener,noreferrer')}
                className="inline-flex items-center justify-center gap-3 rounded-2xl bg-white px-7 py-4 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100"
              >
                Quero saber mais
                <ArrowRight size={18} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 2FA Setup Modal */}
      {show2FASetup && (
        <div className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-md flex items-center justify-center p-4 md:p-6 animate-fade-in">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-xl overflow-hidden relative animate-pop p-8 text-center">
            <div className="w-16 h-16 bg-purple-50 text-[#7a32fc] rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Shield size={32} />
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Configurar 2FA</h2>
            <p className="text-sm text-gray-500 mb-8">Escaneie o QR Code abaixo com seu app Google Authenticator para habilitar a proteção robusta.</p>
            
            <div className="bg-gray-50 p-4 rounded-2xl mb-8 inline-block">
              <SecureImage src={qrCodeUrl} alt="2FA QR Code" className="w-48 h-48 mx-auto" />
            </div>

            <div className="space-y-4">
              <div className="space-y-2 text-left">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Código de Verificação</label>
                <input 
                  type="text" 
                  required
                  value={twoFactorToken}
                  onChange={(e) => setTwoFactorToken(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-4 px-4 text-center text-2xl font-bold tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                  placeholder="000000"
                  maxLength={6}
                />
              </div>
              <button 
                onClick={verifyAndEnable2FA}
                className="w-full bg-[#7a32fc] text-white py-4 rounded-2xl font-bold text-sm shadow-xl shadow-purple-500/20 hover:opacity-90 transition-all"
              >
                Verificar e Ativar
              </button>
              <button 
                onClick={() => setShow2FASetup(false)}
                className="w-full py-2 text-xs font-bold text-gray-400 uppercase tracking-widest hover:text-gray-600 transition-colors"
              >
                Configurar depois
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Login Modal */}
      {showLogin && (
          <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-md flex items-center justify-center p-4 md:p-6 animate-fade-in">
            <div className="bg-white w-full max-w-md max-h-[95vh] rounded-3xl shadow-xl overflow-hidden relative animate-pop flex flex-col">
              <button 
                onClick={() => {
                  setShowLogin(false);
                  resetPasswordRecoveryState();
                }}
                className="absolute top-4 right-4 md:top-6 md:right-6 p-2 hover:bg-gray-100 rounded-full transition-all text-gray-400 z-10"
              >
                <X size={20} />
              </button>

              <div className="p-6 md:p-8 overflow-y-auto">
                <div className="flex items-center gap-3 mb-6">
                  <LogoVerto size={32} />
                  <div>
                    <h2 className="text-lg md:text-xl font-semibold tracking-tight">
                      {loginType === 'patient' ? 'Portal do Paciente' : 'Portal do Profissional'}
                    </h2>
                    <p className="text-gray-400 font-normal text-[9px] md:text-[10px] uppercase tracking-wider">
                      {loginType === 'patient' ? 'Acompanhe sua evolução' : 'Acesse sua conta Verto'}
                    </p>
                  </div>
                </div>

                <div className="bg-purple-50/50 border border-purple-100/50 rounded-2xl p-3 md:p-4 mb-6">
                  <p className="text-[9px] font-semibold text-[#7a32fc] uppercase tracking-wider mb-1 flex items-center gap-2">
                    <ShieldCheck size={10} /> Segurança & Privacidade
                  </p>
                  <p className="text-[10px] md:text-[11px] text-gray-500 font-normal leading-relaxed">
                    Acesse sua conta com e-mail e senha cadastrados. Seus dados são protegidos por criptografia.
                  </p>
                </div>

                <form
                  onSubmit={
                    showPasswordRecovery
                      ? (recoveryStep === 'request' ? handleRecoveryRequest : handleRecoveryVerify)
                      : (twoFactorRequired ? handle2FALogin : handleLogin)
                  }
                  className="space-y-3 md:space-y-4"
                >
                  {showPasswordRecovery ? (
                    <div className="space-y-4 animate-fade-in">
                      <button
                        type="button"
                        onClick={() => {
                          resetPasswordRecoveryState();
                          setLoginStep('email');
                        }}
                        className="inline-flex items-center gap-2 text-[11px] font-semibold text-[#7a32fc] hover:underline"
                      >
                        <ArrowLeft size={14} />
                        Voltar para login
                      </button>

                      <div className="p-4 bg-purple-50 rounded-2xl flex items-start gap-3">
                        <Shield className="text-[#7a32fc] mt-0.5" size={20} />
                        <div>
                          <p className="text-sm font-bold text-gray-800">Recuperar senha</p>
                          <p className="text-xs text-gray-500">
                            {recoveryStep === 'request'
                              ? 'Informe seu e-mail para receber um código de recuperação.'
                              : 'Digite o código recebido e defina sua nova senha.'}
                          </p>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1.5 ml-1">E-mail</label>
                        <div className="relative">
                          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={16} />
                          <input
                            type="email"
                            required
                            className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-3 pl-11 pr-6 text-sm font-normal outline-none focus:border-[#7a32fc] transition-all"
                            placeholder="seu@email.com"
                            value={recoveryEmail}
                            onChange={(e) => setRecoveryEmail(e.target.value)}
                          />
                        </div>
                      </div>

                      {recoveryStep === 'verify' && (
                        <>
                          <div>
                            <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Código de recuperação</label>
                            <input
                              type="text"
                              required
                              inputMode="numeric"
                              maxLength={6}
                              className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-3 px-4 text-sm font-normal outline-none focus:border-[#7a32fc] transition-all tracking-[0.25em] text-center"
                              placeholder="000000"
                              value={recoveryCode}
                              onChange={(e) => setRecoveryCode(e.target.value)}
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Nova senha</label>
                            <div className="relative">
                              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={16} />
                              <input
                                type={showPassword ? "text" : "password"}
                                required
                                className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-3 pl-11 pr-11 text-sm font-normal outline-none focus:border-[#7a32fc] transition-all"
                                placeholder="Mínimo de 12 caracteres"
                                value={recoveryNewPassword}
                                onChange={(e) => setRecoveryNewPassword(e.target.value)}
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
                              >
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                              </button>
                            </div>
                          </div>

                          {recoveryMfaRequired && (
                            <div>
                              <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Código MFA</label>
                              <input
                                type="text"
                                required
                                inputMode="numeric"
                                maxLength={6}
                                className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-3 px-4 text-sm font-normal outline-none focus:border-[#7a32fc] transition-all tracking-[0.25em] text-center"
                                placeholder="000000"
                                value={recoveryMfaToken}
                                onChange={(e) => setRecoveryMfaToken(e.target.value)}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ) : !twoFactorRequired ? (
                    <>
                      {loginStep === 'email' ? (
                        <div>
                          <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1.5 ml-1">E-mail</label>
                          <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={16} />
                            <input 
                              id="email"
                              name="email"
                              type="email" 
                              autoComplete="username"
                              required
                              className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-3 pl-11 pr-6 text-sm font-normal outline-none focus:border-[#7a32fc] transition-all"
                              placeholder="seu@email.com"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                            />
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center justify-between mb-1.5 ml-1">
                            <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wider">Senha</label>
                            <button 
                              type="button"
                              onClick={() => setLoginStep('email')}
                              className="text-[10px] font-bold text-[#7a32fc] hover:underline"
                            >
                              Alterar e-mail
                            </button>
                          </div>
                          <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={16} />
                            <input 
                              id="password"
                              name="password"
                              type={showPassword ? "text" : "password"} 
                              autoComplete="current-password"
                              required
                              className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-3 pl-11 pr-11 text-sm font-normal outline-none focus:border-[#7a32fc] transition-all"
                              placeholder={email === 'appverto1@gmail.com' ? "Cadastre uma senha forte" : "••••••••"}
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                            />
                            <button 
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
                            >
                              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </div>
                        </div>
                      )}

                      {loginStep === 'password' && (
                        <div className="flex items-center justify-between gap-2 ml-1">
                          <div className="flex items-center gap-2">
                            <button 
                              type="button"
                              onClick={() => setRememberMe(!rememberMe)}
                              className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${rememberMe ? 'bg-[#7a32fc] border-[#7a32fc]' : 'bg-white border-gray-200'}`}
                            >
                              {rememberMe && <Check size={10} className="text-white" />}
                            </button>
                            <span className="text-[11px] font-normal text-gray-500 cursor-pointer select-none" onClick={() => setRememberMe(!rememberMe)}>Manter conectado</span>
                          </div>
                          <button
                            type="button"
                            onClick={openPasswordRecovery}
                            className="text-[11px] font-semibold text-[#7a32fc] hover:underline"
                          >
                            Esqueci minha senha
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-4 animate-fade-in">
                      <div className="p-4 bg-purple-50 rounded-2xl flex items-start gap-3">
                        <Shield className="text-[#7a32fc] mt-0.5" size={20} />
                        <div>
                          <p className="text-sm font-bold text-gray-800">Autenticação de 2 Fatores</p>
                          <p className="text-xs text-gray-500">Insira o código gerado pelo seu app Google Authenticator.</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Código de Verificação</label>
                        <input 
                          type="text" 
                          required
                          value={twoFactorToken}
                          onChange={(e) => setTwoFactorToken(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-4 px-4 text-center text-2xl font-bold tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all"
                          placeholder="000000"
                          maxLength={6}
                        />
                      </div>
                    </div>
                  )}

                  {showPasswordRecovery && recoveryMessage && (
                    <p className="text-emerald-600 text-[10px] font-normal text-center">{recoveryMessage}</p>
                  )}

                  {showPasswordRecovery && recoveryError && (
                    <p className="text-red-500 text-[10px] font-normal text-center">{recoveryError}</p>
                  )}

                  {!showPasswordRecovery && loginError && (
                    <div className="space-y-2">
                      <p className="text-red-500 text-[10px] font-normal text-center">{loginError}</p>
                      {loginError.includes('não foi confirmado') && (
                        <button 
                          type="button"
                          onClick={handleResendConfirmation}
                          className="w-full text-[#7a32fc] text-[10px] font-semibold hover:underline"
                        >
                          Reenviar e-mail de confirmação
                        </button>
                      )}
                    </div>
                  )}

                  <button 
                    type="submit"
                    disabled={showPasswordRecovery ? recoveryLoading : loading}
                    className="w-full bg-[#7a32fc] text-white py-3.5 rounded-2xl font-semibold text-sm shadow-lg shadow-purple-500/20 hover:opacity-90 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    {(showPasswordRecovery ? recoveryLoading : loading) ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
                    {showPasswordRecovery
                      ? (recoveryStep === 'request' ? 'Enviar código' : 'Redefinir senha')
                      : (loginStep === 'email' ? 'Continuar' : 'Entrar na Verto')}
                  </button>

                  {!showPasswordRecovery && (
                    <>
                      <div className="relative my-6">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-gray-100"></div>
                        </div>
                        <div className="relative flex justify-center text-[10px] uppercase">
                          <span className="bg-white px-4 text-gray-400 font-medium tracking-widest">ou entrar com</span>
                        </div>
                      </div>

                      <button 
                        type="button"
                        onClick={handleGoogleLogin}
                        className="w-full bg-white border border-gray-200 text-gray-700 py-3.5 rounded-2xl font-bold text-sm shadow-sm hover:bg-gray-50 transition-all active:scale-[0.98] flex items-center justify-center gap-3"
                      >
                        <img src="https://www.gstatic.com/images/branding/product/1x/gsa_512dp.png" alt="Google" className="w-5 h-5" />
                        Entrar com Google
                      </button>

                      {window.self !== window.top && (
                        <p className="mt-4 text-[9px] text-amber-600 font-medium text-center leading-tight bg-amber-50 p-2 rounded-xl border border-amber-100">
                          Nota: Se o login do Google falhar, clique no ícone no topo para abrir o app em uma nova aba.
                        </p>
                      )}
                    </>
                  )}
                </form>

                {!showPasswordRecovery && (
                  <div className="mt-6 pt-6 border-t border-gray-100 text-center">
                    <p className="text-xs text-gray-500 font-normal">
                      Não tem uma conta?{" "}
                      <button 
                        onClick={() => {
                          setShowLogin(false);
                          resetPasswordRecoveryState();
                          setShowRegister(true);
                          setRegisterStep(2);
                          setRegisterType(loginType === 'patient' ? 'patient' : 'professional');
                        }}
                        className="text-[#7a32fc] font-medium hover:underline"
                      >
                        Cadastre-se agora
                      </button>
                    </p>
                  </div>
                )}

                {showPasswordRecovery && recoveryStep === 'verify' && (
                  <div className="mt-4 text-center">
                    <button
                      type="button"
                      onClick={() => setRecoveryStep('request')}
                      className="text-[11px] font-semibold text-[#7a32fc] hover:underline"
                    >
                      Reenviar código
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
      )}

      {/* Register Modal */}
      {showRegister && (
          <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-md flex items-center justify-center p-4 md:p-6 animate-fade-in">
            <div className="bg-white w-full max-w-md max-h-[95vh] rounded-3xl shadow-xl overflow-hidden relative animate-pop flex flex-col">
              <button 
                onClick={() => setShowRegister(false)}
                className="absolute top-4 right-4 md:top-6 md:right-6 p-2 hover:bg-gray-100 rounded-full transition-all text-gray-400 z-10"
              >
                <X size={20} />
              </button>

              <div className="p-6 md:p-8 overflow-y-auto">
                {registerStep === 1 && (
                  <div className="animate-slide-up">
                    <div className="flex items-center gap-3 mb-6">
                      <LogoVerto size={32} />
                      <div>
                        <h2 className="text-lg md:text-xl font-semibold tracking-tight">Começar</h2>
                        <p className="text-gray-400 font-normal text-[9px] md:text-[10px] uppercase tracking-wider">Escolha como deseja usar a Verto</p>
                      </div>
                    </div>

                    <div className="grid gap-3">
                      <button 
                        onClick={() => {
                          setRegisterType('professional');
                          setRegisterStep(2);
                        }}
                        className="flex items-center gap-4 p-4 bg-gray-50 border border-transparent hover:border-[#7a32fc] hover:bg-purple-50/50 rounded-2xl transition-all group text-left"
                      >
                        <div className="w-10 h-10 md:w-12 md:h-12 bg-white rounded-xl flex items-center justify-center text-[#7a32fc] shadow-sm group-hover:scale-105 transition-transform">
                          <Building size={20} />
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-800 text-xs md:text-sm">Coordenador ou Clínica</h3>
                          <p className="text-[10px] md:text-xs text-gray-500 font-normal">Gestão da equipe, clínica e faturamento.</p>
                        </div>
                      </button>

                      <button 
                        onClick={() => {
                          setRegisterType('patient');
                          setRegisterStep(2);
                        }}
                        className="flex items-center gap-4 p-4 bg-gray-50 border border-transparent hover:border-pink-500 hover:bg-pink-50/50 rounded-2xl transition-all group text-left"
                      >
                        <div className="w-10 h-10 md:w-12 md:h-12 bg-white rounded-xl flex items-center justify-center text-pink-500 shadow-sm group-hover:scale-105 transition-transform">
                          <User size={20} />
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-800 text-xs md:text-sm">Paciente</h3>
                          <p className="text-[10px] md:text-xs text-gray-500 font-normal">Acompanhe seu tratamento e atividades.</p>
                        </div>
                      </button>
                    </div>

                    <div className="mt-6 pt-6 border-t border-gray-100 text-center">
                      <p className="text-xs text-gray-500 font-normal">
                        Já tem uma conta?{" "}
                        <button 
                          onClick={() => {
                            setShowRegister(false);
                            setLoginStep('email');
                            setShowLogin(true);
                          }}
                          className="text-[#7a32fc] font-medium hover:underline"
                        >
                          Fazer Login
                        </button>
                      </p>
                    </div>
                  </div>
                )}

                {registerStep === 2 && !isVerifyingEmail && (
                  <div className="animate-slide-up">
                    <button 
                      onClick={() => setRegisterStep(1)}
                      className="flex items-center gap-2 text-gray-400 hover:text-gray-600 font-medium text-[9px] md:text-[10px] uppercase tracking-wider mb-4"
                    >
                      <ArrowLeft size={12} /> Voltar
                    </button>

                    <div className="flex items-center gap-3 mb-6">
                      <div className={`p-2 rounded-xl ${registerType === 'professional' ? 'bg-purple-100 text-[#7a32fc]' : 'bg-pink-100 text-pink-500'}`}>
                        {registerType === 'professional' ? <Stethoscope size={16} /> : <User size={16} />}
                      </div>
                      <div>
                        <h2 className="text-base md:text-lg font-semibold tracking-tight">Cadastro</h2>
                        <p className="text-gray-400 font-normal text-[9px] md:text-[10px] uppercase tracking-wider">
                          {registerType === 'professional' ? 'Coordenador / Clínica' : 'Paciente'}
                        </p>
                      </div>
                    </div>

                    {registerType === 'patient' && (
                      <div className="bg-pink-50 border border-pink-100 p-4 rounded-2xl mb-6">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-sm font-bold text-pink-600">Plano Paciente</h3>
                          <span className="text-[10px] text-pink-600 font-bold uppercase tracking-widest bg-white px-3 py-1 rounded-full">
                            Acesso acompanhado
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-500 font-medium leading-relaxed">
                          Acompanhe sua evolução, visualize metas e receba feedbacks em tempo real.
                        </p>
                      </div>
                    )}

                    <form onSubmit={handleRegister} className="space-y-3 md:space-y-3.5">
                      <div>
                        <label className="block text-[9px] md:text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1 ml-1">Nome Completo</label>
                        <input 
                          type="text" 
                          required
                          className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-2.5 md:py-3 px-4 md:px-5 text-sm font-normal outline-none focus:border-[#7a32fc] transition-all"
                          placeholder="Seu nome"
                          value={name}
                          onChange={(e) => { setName(e.target.value); if (registerError) setRegisterError(''); }}
                        />
                      </div>

                      {registerType === 'professional' && (
                        <div>
                          <label className="block text-[9px] md:text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1 ml-1">CRP (Conselho Regional)</label>
                          <input 
                            type="text" 
                            required
                            className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-2.5 md:py-3 px-4 md:px-5 text-sm font-normal outline-none focus:border-[#7a32fc] transition-all"
                            placeholder="Ex: 06/123456"
                            value={crp}
                            onChange={(e) => { setCrp(formatProfessionalRegistry(e.target.value)); if (registerError) setRegisterError(''); }}
                          />
                        </div>
                      )}

                      {registerType === 'professional' && (
                        <div>
                          <label className="block text-[9px] md:text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1 ml-1">
                            WhatsApp (Obrigatório)
                          </label>
                          <input
                            type="tel"
                            required
                            className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-2.5 md:py-3 px-4 md:px-5 text-sm font-normal outline-none focus:border-[#7a32fc] transition-all"
                            placeholder="(11) 99999-9999"
                            value={whatsappPhone}
                            onChange={(e) => { setWhatsappPhone(e.target.value); if (registerError) setRegisterError(''); }}
                          />
                        </div>
                      )}

                      <div>
                        <label className="block text-[9px] md:text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1 ml-1">E-mail</label>
                        <input 
                          type="email" 
                          required
                          className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-2.5 md:py-3 px-4 md:px-5 text-sm font-normal outline-none focus:border-[#7a32fc] transition-all"
                          placeholder="seu@email.com"
                          value={email}
                          onChange={(e) => { setEmail(e.target.value); if (registerError) setRegisterError(''); }}
                        />
                      </div>

                      <div>
                        <label className="block text-[9px] md:text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1 ml-1">Senha</label>
                        <input 
                          ref={registerPasswordInputRef}
                          type="password" 
                          required
                          className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-2.5 md:py-3 px-4 md:px-5 text-sm font-normal outline-none focus:border-[#7a32fc] transition-all"
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => { setPassword(e.target.value); if (registerError) setRegisterError(''); }}
                        />
                      </div>

                      {registerError && (
                        <p className="text-red-500 text-[9px] md:text-[10px] font-normal text-center">{registerError}</p>
                      )}

                      <button 
                        type="submit"
                        disabled={loading}
                        className={`w-full py-3 md:py-3.5 rounded-2xl font-semibold text-sm shadow-lg transition-all active:scale-[0.98] mt-2 ${registerType === 'professional' ? 'bg-[#7a32fc] text-white shadow-purple-500/10' : 'bg-pink-500 text-white shadow-pink-500/10'} ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {loading ? 'Processando...' : (registerType === 'professional' && !selectedPlan ? 'Continuar para perfis de implantação' : 'Criar minha conta')}
                      </button>

                      <div className="relative my-3 md:my-4">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-gray-100"></div>
                        </div>
                        <div className="relative flex justify-center text-[9px] md:text-[10px] uppercase">
                          <span className="bg-white px-4 text-gray-400 font-medium tracking-widest">ou</span>
                        </div>
                      </div>

                      <button 
                        type="button"
                        onClick={handleGoogleLogin}
                        className="w-full bg-white border border-gray-100 text-gray-600 py-2.5 md:py-3 rounded-2xl font-semibold text-[11px] md:text-xs shadow-sm hover:bg-gray-50 transition-all active:scale-[0.98] flex items-center justify-center gap-3"
                      >
                        <img src="https://www.gstatic.com/images/branding/product/1x/gsa_512dp.png" alt="Google" className="w-4 h-4" />
                        Cadastrar com Google
                      </button>
                    </form>
                  </div>
                )}

                {isVerifyingEmail && (
                  <div className="animate-slide-up text-center py-4">
                    <div className="w-14 h-14 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Mail size={28} />
                    </div>
                    <h2 className="text-lg font-semibold tracking-tight mb-2">Verifique seu E-mail</h2>
                    <p className="text-gray-500 font-normal text-xs mb-6 leading-relaxed">
                      Enviamos um link de confirmação para <strong>{email}</strong>. 
                      Acesse seu e-mail para ativar sua conta.
                    </p>
                    <button 
                      onClick={() => {
                        setShowRegister(false);
                        setIsVerifyingEmail(false);
                      }}
                      className="bg-gray-900 text-white px-8 py-3 rounded-2xl font-semibold text-xs hover:bg-black transition-all"
                    >
                      Entendi
                    </button>
                  </div>
                )}

                {registerStep === 3 && registerType === 'professional' && (
                  <div className="animate-slide-up">
                    <div className="text-center mb-6">
                      <div className="w-10 h-10 md:w-12 md:h-12 bg-purple-100 text-[#7a32fc] rounded-xl flex items-center justify-center mx-auto mb-3">
                        <Rocket size={20} />
                      </div>
                      <h2 className="text-base md:text-lg font-semibold tracking-tight">Quase lá, {name.split(' ')[0]}!</h2>
                      <p className="text-gray-400 font-normal text-[9px] md:text-[10px] uppercase tracking-wider mt-1">Escolha um plano e conclua o pagamento pela Stripe</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                      <div className="bg-violet-50 border border-violet-100 rounded-xl px-3 py-2">
                        <p className="text-[9px] uppercase tracking-wider text-violet-500 font-semibold">Inclui</p>
                        <p className="text-[11px] text-slate-700 font-medium">Prontuário + Agenda</p>
                      </div>
                      <div className="bg-sky-50 border border-sky-100 rounded-xl px-3 py-2">
                        <p className="text-[9px] uppercase tracking-wider text-sky-500 font-semibold">Suporte</p>
                        <p className="text-[11px] text-slate-700 font-medium">Onboarding assistido</p>
                      </div>
                      <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
                        <p className="text-[9px] uppercase tracking-wider text-emerald-500 font-semibold">Escala</p>
                        <p className="text-[11px] text-slate-700 font-medium">Upgrade sem perda de dados</p>
                      </div>
                    </div>

                    <div className="space-y-2 md:space-y-2.5">
                      {[
                        { name: 'Essencial', desc: 'Até 2 profissionais', price: 'R$ 149,90/mês' },
                        { name: 'Crescimento', desc: '3 a 7 profissionais', price: 'R$ 399,90/mês' },
                        { name: 'Avançado', desc: '8 a 12 profissionais', price: 'R$ 679,90/mês' }
                      ].map((plan) => (
                        <button 
                          key={plan.name}
                          onClick={() => void handleSelectPlan(plan.name)}
                          disabled={loading}
                          className="w-full p-3 md:p-4 bg-gray-50 border border-transparent hover:border-[#7a32fc] hover:bg-purple-50/50 rounded-2xl transition-all flex items-center justify-between group text-left"
                        >
                          <div>
                            <h3 className="font-semibold text-gray-800 text-[11px] md:text-xs">{plan.name}</h3>
                            <p className="text-[8px] md:text-[9px] text-gray-400 font-normal uppercase tracking-wider">{plan.desc}</p>
                          </div>
                          <span className="text-[8px] md:text-[9px] font-semibold uppercase tracking-wider text-[#7a32fc] flex items-center gap-1">
                            <ExternalLink size={12} /> {loading && selectedPlan === plan.name ? 'Abrindo Stripe...' : plan.price}
                          </span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => window.open(buildEnterpriseWhatsappUrl(), '_blank', 'noopener,noreferrer')}
                        className="w-full p-3 md:p-4 bg-gray-900 text-white rounded-2xl hover:bg-black transition-all flex items-center justify-between group text-left"
                      >
                        <div>
                          <h3 className="font-semibold text-[11px] md:text-xs">Enterprise</h3>
                          <p className="text-[8px] md:text-[9px] text-gray-400 font-normal uppercase tracking-wider">Clínicas de grande porte com suporte dedicado</p>
                        </div>
                        <span className="text-[8px] md:text-[9px] font-semibold uppercase tracking-wider flex items-center gap-1">
                          <MessageCircle size={12} /> Falar com especialista
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
      )}

      {/* Footer */}
      <footer className="bg-[#1d1f1c] py-20 border-t border-white/10">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <LogoVerto size={40} />
              <span className="text-2xl font-logo font-bold tracking-tighter text-[#7a32fc] lowercase">verto</span>
            </div>
            <p className="text-[#bdb8ae] font-normal max-w-sm leading-relaxed">
              Estruturando cuidado contínuo entre paciente, família, profissional e clínica.
            </p>
          </div>
          <div>
            <h4 className="font-semibold uppercase tracking-widest text-xs mb-6 text-white">Plataforma</h4>
            <ul className="space-y-4 text-sm font-semibold text-[#bdb8ae]">
              <li className="hover:text-white cursor-pointer">Ecossistema</li>
              <li className="hover:text-white cursor-pointer">Operação clínica</li>
              <li className="hover:text-white cursor-pointer">Segurança</li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold uppercase tracking-widest text-xs mb-6 text-white">Suporte</h4>
            <ul className="space-y-4 text-sm font-semibold text-[#bdb8ae]">
              <li className="hover:text-white cursor-pointer">Central de Ajuda</li>
              <li className="hover:text-white cursor-pointer">Contato</li>
              <li className="hover:text-white cursor-pointer">Termos de Uso</li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 mt-20 pt-8 border-t border-white/10 text-center text-xs font-semibold text-[#8f8a82] uppercase tracking-widest">
          © 2026 Verto Health Technologies. Todos os direitos reservados.
        </div>
      </footer>
    </div>
  );
};


