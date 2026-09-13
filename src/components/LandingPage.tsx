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
  User,
  Building,
  Stethoscope,
  ArrowLeft,
  Shield,
  Copy
} from 'lucide-react';
import { LogoVerto } from './Common';
import { SecureImage } from './SecureMedia';
import { GoogleIcon } from './GoogleIcon';
import { SalesInterestForm } from './SalesInterestForm';
import { getSupabase } from '../lib/supabase';
import { dataService } from '../services/dataService';

const heroStories = [
  {
    src: '/lp-hero-agenda.webp',
    width: 1797,
    height: 906,
    variant: 'agenda-pan',
    alt: 'Tela da Verto mostrando a agenda operacional mensal com sessoes e filtros clinicos.'
  },
  {
    src: '/lp-hero-charts.webp',
    width: 1195,
    height: 941,
    variant: 'charts',
    alt: 'Tela da Verto mostrando graficos ABA de mudancas clinicas por sessao.'
  }
];

const LANDING_HERO_MEDIA_ASPECT_RATIO = '16 / 9';

const centralAbaShowcase = [
  {
    src: '/lp-central-aba-collection.webp',
    width: 1142,
    height: 576,
    alt: 'Tela da Verto mostrando um target ABA em manutencao com coleta de tentativa e criterio de maestria.'
  },
  {
    src: '/lp-central-aba-maintenance.webp',
    width: 853,
    height: 305,
    alt: 'Tela da Verto mostrando targets em manutencao e risco de regressao.'
  }
];

const CENTRAL_ABA_SHOWCASE_ASPECT_RATIO = '1142 / 576';

export const LandingPage = ({ onLogin, setUser, accessOnly = false }: any) => {
  const [showLogin, setShowLogin] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [loginType, setLoginType] = useState<'professional' | 'patient' | 'coordinator' | null>(null);
  const [registerType, setRegisterType] = useState<'professional' | 'patient' | 'coordinator' | null>(null);
  const [registerStep, setRegisterStep] = useState(1); // 1: Type, 2: Form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [registerError, setRegisterError] = useState('');
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const [isVerifyingEmail, setIsVerifyingEmail] = useState(false);
  const [loading, setLoading] = useState(false);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [twoFactorToken, setTwoFactorToken] = useState('');
  const [twoFactorChallengeId, setTwoFactorChallengeId] = useState('');
  const [twoFactorSetupRequired, setTwoFactorSetupRequired] = useState(false);
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [loginStep, setLoginStep] = useState<'email' | 'password'>('email');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [showPasswordRecovery, setShowPasswordRecovery] = useState(false);
  const [recoveryStep, setRecoveryStep] = useState<'request' | 'sent'>('request');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [activeHeroStory, setActiveHeroStory] = useState(0);
  const [activeCentralAbaShot, setActiveCentralAbaShot] = useState(0);
  const [salesGooglePrefill, setSalesGooglePrefill] = useState<{ name: string; email: string; googleVerified: boolean } | null>(null);
  const activeHeroStoryData = heroStories[activeHeroStory] || heroStories[0];

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
    setRecoveryLoading(false);
    setRecoveryMessage('');
    setRecoveryError('');
  };

  React.useEffect(() => {
    const savedEmail = localStorage.getItem('verto_email');
    const savedRemember = localStorage.getItem('verto_remember') === 'true';
    localStorage.removeItem('verto_password');
    
    if (savedRemember && savedEmail) {
      setEmail(savedEmail);
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
          localStorage.removeItem('verto_password');
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
          setTwoFactorChallengeId(loginRes.challengeId || '');
          setTwoFactorSetupRequired(Boolean(loginRes.twoFactorSetupRequired));
          setQrCodeUrl(loginRes.qrCodeUrl || '');
          setTwoFactorToken('');
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
    setRecoveryStep('request');
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
      // O rate limiter preserva privacidade respondendo com uma mensagem genérica
      // mesmo quando usa HTTP 429. Para o usuário, isso continua sendo um pedido
      // aceito: nunca revelamos se o e-mail existe nem mostramos um falso erro.
      if (!response.ok && data?.success !== true) {
        throw new Error(data?.error || data?.message || 'Falha ao iniciar recuperação.');
      }
      setRecoveryMessage(data?.message || 'Se este e-mail estiver cadastrado, você receberá instruções.');
      setRecoveryStep('sent');
    } catch (err: any) {
      setRecoveryError(err?.message || 'Não foi possível iniciar a recuperação de senha.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      // The role hint remains only for known login flows; it is never authorization.
      const rawRole = showRegister ? registerType : loginType;
      const isPublicProfessionalInterest = showRegister && rawRole === 'professional';
      const roleToStore = rawRole === 'patient' ? 'patient' : 'coordinator';
      localStorage.setItem('verto_intended_role', roleToStore);
      if (isPublicProfessionalInterest) {
        sessionStorage.setItem('verto_sales_google_interest', '1');
      } else {
        sessionStorage.removeItem('verto_sales_google_interest');
      }
      
      const supabase = await getSupabase();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          scopes: 'https://www.googleapis.com/auth/userinfo.email',
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
    const rawPrefill = sessionStorage.getItem('verto_sales_google_prefill');
    if (!rawPrefill) return;
    sessionStorage.removeItem('verto_sales_google_prefill');
    try {
      const parsed = JSON.parse(rawPrefill);
      setSalesGooglePrefill({
        name: String(parsed?.name || '').slice(0, 180),
        email: String(parsed?.email || '').trim().toLowerCase().slice(0, 254),
        googleVerified: Boolean(parsed?.googleVerified),
      });
      setRegisterType('professional');
      setRegisterStep(2);
      setShowLogin(false);
      setShowRegister(true);
    } catch {
      sessionStorage.removeItem('verto_sales_google_interest');
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveHeroStory((current) => (current + 1) % heroStories.length);
    }, 4200);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveCentralAbaShot((current) => (current + 1) % centralAbaShowcase.length);
    }, 4600);

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
      const response = await fetch('/api/auth/2fa/login', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ challengeId: twoFactorChallengeId, token: twoFactorToken })
      });
      
      const data = await response.json();
      if (!response.ok) {
        const message = data.error === 'MFA_CODE_INVALID'
          ? 'Código inválido. Confira o Google Authenticator e tente novamente.'
          : data.error === 'MFA_CHALLENGE_EXPIRED'
            ? 'Esta verificação expirou. Entre novamente com sua senha.'
            : 'Não foi possível concluir a verificação de segurança.';
        throw new Error(message);
      }
      
      if (data.success) {
        const resolvedLogin = await onLogin(null, loginType);
        if (!resolvedLogin?.success) {
          throw new Error(resolvedLogin?.error || 'Não foi possível abrir sua sessão protegida.');
        }
        setTwoFactorRequired(false);
        setTwoFactorSetupRequired(false);
        setTwoFactorChallengeId('');
        setTwoFactorToken('');
        setQrCodeUrl('');
        setShowLogin(false);
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

  const openSalesInterest = () => {
    setSalesGooglePrefill(null);
    setRegisterError('');
    setRegisterType('professional');
    setRegisterStep(2);
    setShowLogin(false);
    setShowRegister(true);
  };

  const audienceCards = [
    { label: 'Crianças e famílias', value: 'Rotina, engajamento e evolução mais visíveis fora da sessão.' },
    { label: 'Equipe clínica', value: 'PEI, sessão, dados e relatórios conectados em um só fluxo.' },
    { label: 'Clínica e operação', value: 'Agenda, prontuário, equipe, arquivos e acompanhamento em uma plataforma.' }
  ];

  const pathCards = [
    {
      icon: <Brain size={22} />,
      title: 'Sessões estruturadas',
      desc: 'Coleta em tempo real, metas conectadas ao plano terapêutico e critérios clínicos mais claros.'
    },
    {
      icon: <BarChart3 size={22} />,
      title: 'Decisão orientada por dados',
      desc: 'Gráficos, tendências e leituras clínicas para apoiar supervisão, ajustes e acompanhamento.'
    },
    {
      icon: <Heart size={22} />,
      title: 'Continuidade do cuidado',
      desc: 'Família, equipe e clínica acompanhando a evolução em uma experiência mais contínua.'
    }
  ];

  const painPoints = [
    'Dados clínicos espalhados em diferentes ferramentas',
    'PEI desconectado da sessão',
    'Relatórios manuais e demorados',
    'Dificuldade para visualizar progresso real',
    'Supervisão sem visão rápida de evolução',
    'Pouca rastreabilidade entre meta, sessão e relatório'
  ];

  const abaFeatures = [
    {
      icon: <CheckCircle2 size={22} />,
      title: 'Tentativas DTT, NET e Probe',
      desc: 'Registre respostas independentes, com ajuda ou erro, vinculadas a metas, targets e tipos de tentativa.'
    },
    {
      icon: <Zap size={22} />,
      title: 'Prompts e hierarquia de ajuda',
      desc: 'Acompanhe o nível de suporte em cada tentativa e visualize a evolução da independência.'
    },
    {
      icon: <Brain size={22} />,
      title: 'Comportamentos em tempo real',
      desc: 'Registre frequência, duração, intervalo, taxa e eventos comportamentais durante a sessão.'
    },
    {
      icon: <Pencil size={22} />,
      title: 'ABC rápido',
      desc: 'Documente antecedente, comportamento e consequência com mais agilidade e rastreabilidade.'
    },
    {
      icon: <Rocket size={22} />,
      title: 'Mobile-first para atendimento',
      desc: 'Atalhos rápidos, feedback visual, eventos em andamento e fluxo pensado para uso durante a sessão.'
    },
    {
      icon: <Star size={22} />,
      title: 'Maestria e manutenção',
      desc: 'Critérios clínicos, revisão de maestria, probes de manutenção e sinais de regressão.'
    },
    {
      icon: <BarChart3 size={22} />,
      title: 'Gráficos interpretáveis',
      desc: 'Visualize mudanças por sessão, evolução por meta, redução de comportamentos e dados relevantes.'
    },
    {
      icon: <Copy size={22} />,
      title: 'Resumo e relatório',
      desc: 'Transforme a sessão em um registro estruturado para supervisão, acompanhamento e histórico clínico.'
    }
  ];

  const clinicalReadings = [
    'Independência subiu de 60% para 80% (+20 p.p.)',
    'Agressão reduziu de 11 para 1 ocorrência (-91%)',
    'Meta pronta para revisão de maestria',
    'Habilidade entrou em manutenção',
    'Sinal de regressão detectado',
    'Primeira medição registrada'
  ];

  const peiConnections = [
    'Metas por domínio',
    'Objetivos individualizados',
    'Critérios de maestria',
    'Histórico por target',
    'Evolução por sessão',
    'Dados da sessão alimentando gráficos e relatórios'
  ];

  const familyFeatures = [
    'Diário da família',
    'Registros de rotina',
    'Evolução visível por gráfico',
    'Engajamento entre sessões',
    'Histórico acessível',
    'Comunicação mais organizada com a equipe'
  ];

  const chartCards = [
    {
      icon: <BarChart3 size={22} />,
      title: 'Habilidades',
      desc: 'Acurácia, independência, prompts e evolução por meta.'
    },
    {
      icon: <Brain size={22} />,
      title: 'Comportamentos',
      desc: 'Frequência, duração, intervalo e redução de comportamentos-alvo.'
    },
    {
      icon: <Star size={22} />,
      title: 'Maestria',
      desc: 'Critérios atingidos, metas prontas para revisão e dados insuficientes.'
    },
    {
      icon: <ShieldCheck size={22} />,
      title: 'Manutenção',
      desc: 'Probes, status de manutenção, watch e risco de regressão.'
    },
    {
      icon: <Zap size={22} />,
      title: 'Mudanças por sessão',
      desc: 'Compare anterior e atual para ver onde houve melhora, piora ou estabilidade.'
    }
  ];

  const operationCards = [
    {
      icon: <User size={22} />,
      title: 'Prontuário do paciente',
      desc: 'Histórico, anotações, arquivos, relatórios, PEI e sessões em um só lugar.'
    },
    {
      icon: <Users size={22} />,
      title: 'Equipe e responsáveis',
      desc: 'Organize terapeutas, responsáveis pelo caso e rotina de atendimento.'
    },
    {
      icon: <CalendarCheck size={22} />,
      title: 'Agenda e confirmações',
      desc: 'Apoie a rotina da clínica com organização de atendimentos e comunicação com pacientes.'
    },
    {
      icon: <Copy size={22} />,
      title: 'Relatórios estruturados',
      desc: 'Gere registros a partir dos dados coletados em sessão.'
    },
    {
      icon: <Image size={22} />,
      title: 'Arquivos e documentos',
      desc: 'Centralize materiais importantes do paciente.'
    },
    {
      icon: <Building size={22} />,
      title: 'Preparação administrativa',
      desc: 'Estruture a sessão clínica para futuras etapas como assinatura, conferência e pré-faturamento.'
    }
  ];

  const beforeAfterRows = [
    { before: 'Formulários soltos', after: 'Sessão estruturada' },
    { before: 'Planilhas paralelas', after: 'Dados clínicos conectados' },
    { before: 'PEI parado', after: 'PEI ligado à sessão' },
    { before: 'Gráficos manuais', after: 'Gráficos automáticos e interpretáveis' },
    { before: 'Supervisão com pouca visibilidade', after: 'Mudanças clínicas por sessão' },
    { before: 'Relatórios demorados', after: 'Resumos estruturados' },
    { before: 'Dados difíceis de rastrear', after: 'Histórico auditável' }
  ];

  const targetAudiences = [
    'Clínicas ABA',
    'Clínicas de TEA',
    'Psicologia infantil',
    'Fonoaudiologia',
    'Terapia ocupacional',
    'Psicopedagogia',
    'Equipes multidisciplinares',
    'Clínicas de desenvolvimento infantil'
  ];

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError('');

    if (registerType !== 'patient') {
      setRegisterError('O cadastro profissional é concluído após uma apresentação da Verto.');
      return;
    }

    try {
      const passwordValidationError = validateStrongPassword(password);
      if (passwordValidationError) {
        setRegisterError(passwordValidationError);
        return;
      }

      setLoading(true);
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          password,
          name,
          role: 'patient',
          acquisitionChannel
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || `Erro ao criar conta (HTTP ${response.status})`);
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

  return (
    <div className="min-h-screen bg-white font-sans text-gray-900 overflow-x-hidden">
      {accessOnly ? (
        <main
          className="flex min-h-[100dvh] items-center justify-center bg-[#f7f5ff] px-5 py-8"
          style={{
            paddingTop: 'max(2rem, env(safe-area-inset-top))',
            paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
          }}
        >
          <section className="w-full max-w-sm rounded-[32px] border border-purple-100 bg-white p-6 shadow-[0_24px_70px_rgba(67,45,122,0.10)] sm:p-7">
            <div className="flex justify-center">
              <LogoVerto size={44} showText={true} />
            </div>
            <div className="mt-8 text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Acesse sua área</h1>
              <p className="mt-2 text-sm font-normal leading-6 text-slate-500">Escolha como deseja entrar na Verto.</p>
            </div>

            <div className="mt-7 space-y-3">
              <button
                type="button"
                onClick={() => {
                  setLoginType('professional');
                  setLoginStep('email');
                  setShowLogin(true);
                }}
                className="flex min-h-16 w-full items-center gap-4 rounded-2xl border border-purple-100 bg-purple-50/60 px-4 py-4 text-left transition hover:border-[#7a32fc]/40 hover:bg-purple-50 active:scale-[0.99]"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-[#7a32fc] shadow-sm">
                  <Stethoscope size={21} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">Área do profissional</span>
                  <span className="mt-0.5 block text-xs font-normal text-slate-500">Clínica, coordenação e atendimento</span>
                </span>
                <ArrowRight size={18} className="ml-auto shrink-0 text-slate-400" />
              </button>

              <button
                type="button"
                onClick={() => { window.location.href = '/rede-de-cuidado'; }}
                className="flex min-h-16 w-full items-center gap-4 rounded-2xl border border-violet-100 bg-white px-4 py-4 text-left transition hover:border-[#7a32fc]/35 hover:bg-violet-50/40 active:scale-[0.99]"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-[#7a32fc]">
                  <Users size={21} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">Sou parceiro</span>
                  <span className="mt-0.5 block text-xs font-normal text-slate-500">Conteúdos compartilhados por clínicas Verto</span>
                </span>
                <ArrowRight size={18} className="ml-auto shrink-0 text-slate-400" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setLoginType('patient');
                  setLoginStep('email');
                  setShowLogin(true);
                }}
                className="flex min-h-16 w-full items-center gap-4 rounded-2xl border border-pink-100 bg-pink-50/60 px-4 py-4 text-left transition hover:border-pink-300 hover:bg-pink-50 active:scale-[0.99]"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-pink-500 shadow-sm">
                  <Heart size={21} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">Área do paciente</span>
                  <span className="mt-0.5 block text-xs font-normal text-slate-500">Portal, atividades e acompanhamento</span>
                </span>
                <ArrowRight size={18} className="ml-auto shrink-0 text-slate-400" />
              </button>
            </div>
          </section>
        </main>
      ) : (
        <>
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <LogoVerto size={40} showText={true} />
          <div className="hidden items-center gap-6 lg:flex">
            <a href="#caminho" className="text-sm font-semibold text-gray-500 transition-colors hover:text-[#7a32fc]">Caminho</a>
            <a href="#central-aba" className="text-sm font-semibold text-gray-500 transition-colors hover:text-[#7a32fc]">Central ABA</a>
            <a href="#operacao" className="text-sm font-semibold text-gray-500 transition-colors hover:text-[#7a32fc]">Operação</a>
            <a href="#contato" className="text-sm font-semibold text-gray-500 transition-colors hover:text-[#7a32fc]">Contato</a>
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button type="button" onClick={() => { window.location.href = '/entrar'; }} className="rounded-full bg-[#7a32fc] px-4 py-2.5 text-xs font-medium text-white shadow-lg shadow-purple-500/20 sm:hidden">Entrar</button>
            <button
              onClick={() => {
                setLoginType('patient');
                setLoginStep('email');
                setShowLogin(true);
              }}
              className="hidden whitespace-nowrap rounded-full border border-purple-100 bg-white px-3 py-2 text-xs font-semibold text-[#7a32fc] shadow-sm transition-colors hover:border-[#7a32fc] hover:bg-purple-50 sm:inline-flex sm:px-4 sm:text-sm"
            >
              Sou Paciente
            </button>
            <button
              onClick={() => { window.location.href = '/rede-de-cuidado'; }}
              className="hidden whitespace-nowrap rounded-full border border-violet-100 bg-violet-50/70 px-3 py-2 text-xs font-medium text-[#6d2ee8] shadow-sm transition-colors hover:border-violet-200 hover:bg-violet-50 sm:inline-flex sm:px-4 sm:text-sm"
              title="Acesse conteúdos compartilhados por clínicas que utilizam a Verto"
            >
              Sou parceiro
            </button>
            <button
              onClick={() => {
                setLoginType('professional');
                setLoginStep('email');
                setShowLogin(true);
              }}
              className="hidden whitespace-nowrap rounded-full bg-[#7a32fc] px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-purple-500/20 transition-all hover:opacity-90 active:scale-95 sm:inline-flex sm:px-5 sm:py-2.5 sm:text-sm"
            >
              Sou Profissional
            </button>
          </div>
        </div>
      </nav>

      <section className="px-6 pb-16 pt-28 md:pb-20 md:pt-32">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-[40px] bg-[#f7f5ff] shadow-sm ring-1 ring-purple-100">
          <div className="grid min-h-[720px] grid-cols-1 lg:min-h-[760px] lg:grid-cols-[0.9fr_1.1fr]">
            <div className="flex flex-col justify-between px-8 py-10 md:px-12 md:py-12 lg:px-14 lg:py-14">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-[#7a32fc] shadow-sm ring-1 ring-purple-100">
                  <Rocket size={14} />
                  Cuidado clínico contínuo
                </span>
                <h1 className="mt-8 max-w-3xl text-4xl font-semibold tracking-tight text-slate-900 md:text-6xl md:leading-[0.95]">
                  A terapia não termina quando a sessão acaba.
                </h1>
                <p className="mt-6 max-w-2xl text-base font-normal leading-8 text-slate-500 md:text-xl md:leading-9">
                  A Verto conecta prontuário, PEI, sessão, família, equipe e dados clínicos em uma única plataforma para que cada atendimento gere continuidade, clareza e evolução acompanhável.
                </p>
                <p className="mt-5 inline-flex max-w-2xl rounded-2xl bg-white/80 px-5 py-4 text-sm font-semibold leading-6 text-[#5f2bc4] shadow-sm ring-1 ring-purple-100">
                  Inspirada por práticas internacionais, construída para a realidade brasileira.
                </p>
                <p className="mt-5 max-w-2xl text-sm font-normal leading-7 text-slate-500 md:text-base md:leading-8">
                  A plataforma mais completa feita para clínicas de desenvolvimento infantil, TEA e ABA que querem sair de registros espalhados e evoluir para uma operação clínica mais estruturada, rastreável e orientada por dados.
                </p>
                <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={openSalesInterest}
                    className="inline-flex items-center justify-center gap-3 rounded-2xl bg-[#7a32fc] px-7 py-4 text-sm font-semibold text-white shadow-2xl shadow-purple-500/20 transition-all hover:opacity-90"
                  >
                    Quero saber mais
                    <ArrowRight size={18} />
                  </button>
                </div>
              </div>

              <div className="mt-10 hidden gap-3 lg:grid lg:grid-cols-3">
                {audienceCards.map((item) => (
                  <div key={item.label} className="rounded-3xl bg-white px-5 py-4 shadow-sm ring-1 ring-gray-100">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{item.label}</p>
                    <p className="mt-2 text-sm font-normal leading-6 text-slate-600">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden bg-white px-3 py-6 sm:px-5 lg:min-h-full lg:justify-start lg:px-3 lg:py-14 xl:px-4">
              <div className="relative w-full max-w-[760px]">
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
                <div
                  className="landing-hero-media-frame relative mx-auto overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-xl shadow-slate-900/10 transition-all duration-700 sm:rounded-[24px]"
                  data-hero-kind={activeHeroStoryData.variant}
                  style={{ aspectRatio: LANDING_HERO_MEDIA_ASPECT_RATIO }}
                >
                  {heroStories.map((story, index) => {
                    const isActiveStory = index === activeHeroStory;
                    return (
                      <img
                        key={story.src}
                        src={story.src}
                        alt={story.alt}
                        width={story.width}
                        height={story.height}
                        loading={index === 0 ? 'eager' : 'lazy'}
                        decoding="async"
                        className={`absolute inset-y-0 max-w-none select-none transition-opacity duration-700 ${
                          story.variant === 'agenda-pan' ? 'landing-hero-agenda-shot' : 'landing-hero-chart-shot'
                        } ${isActiveStory ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
                      />
                    );
                  })}
                </div>
              </div>
              <div className="relative mt-8 grid w-full max-w-[360px] gap-3 lg:hidden">
                {audienceCards.map((item) => (
                  <div key={item.label} className="rounded-3xl bg-white px-6 py-5 shadow-sm ring-1 ring-gray-100">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{item.label}</p>
                    <p className="mt-2 text-base font-normal leading-6 text-slate-600">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="caminho" className="px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-16 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-700">
                O caminho que estamos construindo
              </span>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900 md:text-5xl">
                Uma nova forma de organizar a rotina clínica.
              </h2>
              <p className="mt-6 text-lg font-normal leading-8 text-slate-500">
                Em centros avançados de intervenção para TEA e desenvolvimento infantil, a rotina clínica é cada vez mais orientada por dados: sessões estruturadas, coleta em tempo real, metas conectadas ao plano terapêutico, critérios de maestria, manutenção de habilidades e gráficos que apoiam a tomada de decisão.
              </p>
              <p className="mt-5 text-lg font-normal leading-8 text-slate-500">
                A Verto segue nessa direção: uma plataforma brasileira para conectar o cuidado clínico, o PEI, a sessão, a família e a gestão da clínica em uma experiência mais clara, contínua e rastreável.
              </p>
            </div>

            <div className="grid gap-5">
              {pathCards.map((item) => (
                <div key={item.title} className="rounded-[32px] border border-gray-100 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#f4f0ff] text-[#7a32fc]">
                    {item.icon}
                  </div>
                  <h3 className="mt-5 text-xl font-semibold tracking-tight text-slate-900">{item.title}</h3>
                  <p className="mt-3 text-sm font-normal leading-7 text-slate-500">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#f9fafc] px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <span className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-orange-600">
                Problema
              </span>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900 md:text-5xl">
                Clínicas não deveriam depender de planilhas, formulários soltos e memória da equipe.
              </h2>
              <p className="mt-6 text-lg font-normal leading-8 text-slate-500">
                Na prática, muitos dados importantes nascem dentro da sessão: respostas do paciente, comportamentos, uso de ajuda, evolução de metas, observações clínicas e orientações para a família.
              </p>
              <p className="mt-5 text-lg font-normal leading-8 text-slate-500">
                Mas quando esses registros ficam espalhados, a equipe perde contexto, a supervisão fica mais difícil, os relatórios demoram e o PEI deixa de acompanhar o que realmente acontece no atendimento.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {painPoints.map((item) => (
                <div key={item} className="rounded-[28px] border border-orange-100 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-2xl bg-orange-50 text-orange-500">
                    <CheckCircle2 size={18} />
                  </div>
                  <p className="text-sm font-normal leading-6 text-slate-600">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="central-aba" className="px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
            <div className="max-w-4xl">
              <span className="inline-flex rounded-full bg-[#f4f0ff] px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-[#7a32fc]">
                Central ABA
              </span>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900 md:text-5xl">
                Central ABA: coleta, análise e evolução clínica em tempo real.
              </h2>
              <p className="mt-6 text-lg font-normal leading-8 text-slate-500">
                Registre tentativas, comportamentos, prompts, intervalos, duração, frequência e ABC sem perder o ritmo da sessão.
              </p>
              <p className="mt-5 rounded-3xl bg-[#f4f0ff] px-5 py-4 text-sm font-semibold leading-7 text-[#5f2bc4]">
                A equipe coleta dados no celular enquanto atende, e cada resposta já nasce conectada ao PEI, ao target e ao histórico clínico do paciente.
              </p>
            </div>

            <div className="rounded-[28px] border border-purple-100 bg-white p-3 shadow-sm sm:p-4 md:p-5">
              <div className="mb-3 flex gap-2 px-1">
                {centralAbaShowcase.map((shot, index) => (
                  <button
                    key={shot.src}
                    type="button"
                    aria-label={`Ver tela ABA ${index + 1}`}
                    onClick={() => setActiveCentralAbaShot(index)}
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200"
                  >
                    <span
                      className={`block h-full rounded-full bg-[#7a32fc] transition-all duration-700 ${
                        index === activeCentralAbaShot ? 'w-full' : 'w-0'
                      }`}
                    />
                  </button>
                ))}
              </div>
              <div
                className="relative overflow-hidden rounded-[22px] bg-[#fbf8ff] transition-all duration-700"
                style={{ aspectRatio: CENTRAL_ABA_SHOWCASE_ASPECT_RATIO }}
              >
                {centralAbaShowcase.map((shot, index) => (
                  <img
                    key={shot.src}
                    src={shot.src}
                    alt={shot.alt}
                    width={shot.width}
                    height={shot.height}
                    loading="lazy"
                    decoding="async"
                    className={`absolute inset-0 h-full w-full object-contain transition-all duration-700 ${
                      index === activeCentralAbaShot
                        ? 'scale-100 opacity-100'
                        : 'pointer-events-none scale-[1.02] opacity-0'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {abaFeatures.map((item) => (
              <div key={item.title} className="rounded-[32px] border border-gray-100 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#f4f0ff] text-[#7a32fc]">
                  {item.icon}
                </div>
                <h3 className="mt-5 text-lg font-semibold tracking-tight text-slate-900">{item.title}</h3>
                <p className="mt-3 text-sm font-normal leading-7 text-slate-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-7xl rounded-[40px] bg-slate-900 px-8 py-10 text-white shadow-sm md:px-12 md:py-14">
          <div className="grid gap-10 lg:grid-cols-[0.85fr_0.75fr_0.9fr] lg:items-center">
            <div>
              <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-200">
                Leitura clínica
              </span>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight md:text-5xl">
                Não basta registrar. É preciso entender o que mudou.
              </h2>
              <p className="mt-6 text-lg font-normal leading-8 text-slate-300">
                A Verto ajuda a equipe a enxergar evolução clínica com mais clareza: não apenas se houve melhora, mas quando ela aconteceu, em qual sessão, em qual meta e com qual magnitude.
              </p>
            </div>

            <div className="rounded-[28px] bg-white/10 p-6 ring-1 ring-white/10">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-200">Resumo automatico</p>
              <p className="mt-4 text-base font-normal leading-7 text-slate-200">
                Cada coleta vira leitura para supervisao, historico e tomada de decisao.
              </p>
              <div className="mt-6 grid gap-3">
                {clinicalReadings.slice(0, 3).map((item) => (
                  <div key={item} className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-normal leading-6 text-white">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-slate-400">Exemplos de leitura clínica</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {clinicalReadings.map((item) => (
                  <div key={item} className="rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/10">
                    <p className="text-sm font-normal leading-6 text-slate-100">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="pei" className="bg-[#f9fafc] px-6 py-20">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[1fr_0.9fr] lg:items-start">
          <div>
            <span className="inline-flex rounded-full bg-sky-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-sky-700">
              PEI conectado à sessão
            </span>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900 md:text-5xl">
              O PEI deixa de ser um documento parado.
            </h2>
            <p className="mt-6 text-lg font-normal leading-8 text-slate-500">
              Na Verto, metas, domínios, protocolos e objetivos ficam conectados ao que acontece na sessão. A equipe registra dados em tempo real, acompanha evolução por target e transforma o plano terapêutico em uma ferramenta viva de acompanhamento.
            </p>
          </div>

          <div className="rounded-[36px] border border-sky-100 bg-white p-7 shadow-sm md:p-9">
            <p className="text-sm font-semibold uppercase tracking-widest text-sky-700">Maestria e manutencao</p>
            <p className="mt-4 text-sm font-normal leading-7 text-slate-500">
              Targets em manutencao, probes e sinais de regressao aparecem antes que a evolucao se perca.
            </p>
            <p className="mt-8 text-sm font-semibold uppercase tracking-widest text-sky-700">O que fica conectado</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {peiConnections.map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-2xl bg-sky-50/70 px-4 py-3">
                  <Check size={16} className="mt-1 shrink-0 text-sky-700" />
                  <p className="text-sm font-normal leading-6 text-slate-600">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.9fr_1fr] lg:items-start">
          <div className="rounded-[36px] border border-emerald-100 bg-emerald-50/60 p-7 shadow-sm md:p-9">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-emerald-600 shadow-sm">
              <Heart size={24} />
            </div>
            <p className="mt-6 text-sm font-semibold uppercase tracking-widest text-emerald-700">Para crianças e famílias</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {familyFeatures.map((item) => (
                <div key={item} className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-emerald-100">
                  <p className="text-sm font-normal leading-6 text-slate-600">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-700">
              Família e continuidade
            </span>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900 md:text-5xl">
              O cuidado continua fora da sala de atendimento.
            </h2>
            <p className="mt-6 text-lg font-normal leading-8 text-slate-500">
              A evolução também acontece na rotina: em casa, na escola, nas interações com a família e nas pequenas conquistas do dia a dia.
            </p>
            <p className="mt-5 text-lg font-normal leading-8 text-slate-500">
              A Verto mantém esse vínculo ativo, permitindo que família e equipe compartilhem registros, acompanhem progresso e mantenham mais continuidade entre uma sessão e outra.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-[#f9fafc] px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-4xl">
            <span className="inline-flex rounded-full bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600 ring-1 ring-gray-100">
              Gráficos clínicos
            </span>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900 md:text-5xl">
              Gráficos que falam a língua da clínica.
            </h2>
            <p className="mt-6 text-lg font-normal leading-8 text-slate-500">
              A Verto organiza os dados para que supervisores e equipes entendam a evolução com mais contexto. Em vez de apenas exibir números, os gráficos mostram mudanças relevantes, tendências, alertas e pontos de atenção.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
            {chartCards.map((item) => (
              <div key={item.title} className="rounded-[32px] border border-gray-100 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                  {item.icon}
                </div>
                <h3 className="mt-5 text-lg font-semibold tracking-tight text-slate-900">{item.title}</h3>
                <p className="mt-3 text-sm font-normal leading-7 text-slate-500">{item.desc}</p>
              </div>
            ))}
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
              Para que o cuidado funcione, a operação também precisa estar organizada.
            </h2>
            <p className="mt-6 text-lg font-normal leading-8 text-slate-500">
              A Verto também apoia a rotina da clínica fora da sessão. Prontuário, equipe, agenda, arquivos, relatórios e acompanhamento ficam reunidos em um ambiente pensado para clínicas multidisciplinares.
            </p>
          </div>

          <div className="mt-12 grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <div className="rounded-[28px] bg-slate-950 p-7 text-white shadow-sm md:p-9">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-200">Dock clinico</p>
              <p className="mt-4 text-base font-normal leading-7 text-slate-300">
                Atalhos para crise, ABC rapido e registros prioritarios sem sair da sessao.
              </p>
              <div className="mt-6 grid gap-3">
                {['Crise', 'ABC rapido', 'Registros prioritarios'].map((item) => (
                  <div key={item} className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-normal text-white ring-1 ring-white/10">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              {operationCards.map((item) => (
                <div key={item.title} className="rounded-[32px] border border-gray-100 bg-white p-7 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                    {item.icon}
                  </div>
                  <h3 className="mt-5 text-xl font-semibold tracking-tight text-slate-900">{item.title}</h3>
                  <p className="mt-3 text-sm font-normal leading-7 text-slate-500">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#f9fafc] px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-4xl">
            <span className="inline-flex rounded-full bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600 ring-1 ring-gray-100">
              Antes e depois
            </span>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900 md:text-5xl">
              De uma rotina fragmentada para uma operação conectada.
            </h2>
          </div>

          <div className="mt-12 overflow-hidden rounded-[36px] border border-gray-100 bg-white shadow-sm">
            <div className="grid grid-cols-2 border-b border-gray-100 bg-slate-50 px-5 py-4 text-sm font-semibold uppercase tracking-widest text-slate-500">
              <p>Antes</p>
              <p>Com Verto</p>
            </div>
            {beforeAfterRows.map((row) => (
              <div key={row.before} className="grid grid-cols-2 gap-4 border-b border-gray-100 px-5 py-4 last:border-b-0">
                <p className="text-sm font-normal leading-6 text-slate-500">{row.before}</p>
                <p className="text-sm font-normal leading-6 text-slate-800">{row.after}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <span className="inline-flex rounded-full bg-[#f4f0ff] px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-[#7a32fc]">
              Público-alvo
            </span>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900 md:text-5xl">
              Feita para clínicas que atendem desenvolvimento infantil, TEA e equipes multidisciplinares.
            </h2>
            <p className="mt-6 text-lg font-normal leading-8 text-slate-500">
              A Verto foi pensada para clínicas que precisam organizar cuidado, dados e operação sem perder a complexidade clínica do atendimento.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {targetAudiences.map((item) => (
              <div key={item} className="rounded-2xl border border-gray-100 bg-white px-5 py-4 shadow-sm">
                <p className="text-sm font-normal leading-6 text-slate-700">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="contato" className="px-6 pb-20 pt-10">
        <div className="mx-auto max-w-7xl rounded-[40px] bg-slate-900 px-8 py-10 text-white shadow-sm md:px-12 md:py-14">
          <div className="max-w-4xl">
            <h2 className="text-3xl font-semibold tracking-tight md:text-5xl">
              Pronto para construir uma operação clínica mais contínua, rastreável e orientada por dados?
            </h2>
            <p className="mt-5 text-lg font-normal leading-8 text-slate-300">
              Conheça a Verto e veja como prontuário, PEI, sessão, família, dados clínicos e gestão podem funcionar em um fluxo mais integrado.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={openSalesInterest}
                className="inline-flex items-center justify-center gap-3 rounded-2xl bg-white px-7 py-4 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100"
              >
                Quero saber mais
                <ArrowRight size={18} />
              </button>
            </div>
          </div>
        </div>
      </section>
        </>
      )}

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
                  <LogoVerto size={30} showText={true} />
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
                      ? handleRecoveryRequest
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
                              ? 'Informe seu e-mail para receber um link seguro de recuperação.'
                              : 'Abra o link enviado por e-mail para definir uma nova senha.'}
                          </p>
                        </div>
                      </div>

                      {recoveryStep === 'request' ? (
                        <div>
                          <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1.5 ml-1">E-mail</label>
                          <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={16} />
                            <input
                              type="email"
                              required
                              autoComplete="email"
                              className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-3 pl-11 pr-6 text-sm font-normal outline-none focus:border-[#7a32fc] transition-all"
                              placeholder="seu@email.com"
                              value={recoveryEmail}
                              onChange={(e) => setRecoveryEmail(e.target.value)}
                            />
                          </div>
                        </div>
                      ) : (
                        <div role="status" aria-live="polite" className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-center">
                          <CheckCircle2 className="mx-auto text-emerald-600" size={24} />
                          <p className="mt-2 text-sm font-semibold text-emerald-900">Verifique sua caixa de entrada</p>
                          <p className="mt-1 text-xs leading-relaxed text-emerald-700">
                            Se este e-mail estiver cadastrado, você receberá um link seguro para redefinir a senha.
                          </p>
                        </div>
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
                              placeholder="••••••••"
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
                          <p className="text-sm font-semibold text-gray-800">
                            {twoFactorSetupRequired ? 'Proteja o acesso administrativo' : 'Autenticação de dois fatores'}
                          </p>
                          <p className="text-xs font-normal text-gray-500">
                            {twoFactorSetupRequired
                              ? 'Escaneie o QR Code no Google Authenticator e confirme o primeiro código.'
                              : 'Insira o código gerado pelo Google Authenticator.'}
                          </p>
                        </div>
                      </div>
                      {twoFactorSetupRequired && qrCodeUrl && (
                        <div className="flex justify-center rounded-2xl border border-purple-100 bg-white p-4">
                          <SecureImage src={qrCodeUrl} alt="QR Code para configurar o Google Authenticator" className="h-44 w-44" />
                        </div>
                      )}
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">Código de verificação</label>
                        <input 
                          type="text" 
                          inputMode="numeric"
                          autoComplete="one-time-code"
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

                  {showPasswordRecovery && recoveryStep === 'request' && recoveryMessage && (
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

                  {showPasswordRecovery && recoveryStep === 'sent' ? (
                    <button
                      type="button"
                      onClick={() => {
                        resetPasswordRecoveryState();
                        setLoginStep('email');
                      }}
                      className="w-full bg-[#7a32fc] text-white py-3.5 rounded-2xl font-semibold text-sm shadow-lg shadow-purple-500/20 hover:opacity-90 transition-all active:scale-[0.98]"
                    >
                      Voltar para entrar
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={showPasswordRecovery ? recoveryLoading : loading}
                      className="w-full bg-[#7a32fc] text-white py-3.5 rounded-2xl font-semibold text-sm shadow-lg shadow-purple-500/20 hover:opacity-90 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      {(showPasswordRecovery ? recoveryLoading : loading) ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
                      {showPasswordRecovery
                        ? 'Enviar link de recuperação'
                        : twoFactorRequired
                          ? (twoFactorSetupRequired ? 'Ativar e entrar' : 'Verificar e entrar')
                          : (loginStep === 'email' ? 'Continuar' : 'Entrar na Verto')}
                    </button>
                  )}

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
                        <GoogleIcon size={18} />
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

                {showPasswordRecovery && recoveryStep === 'sent' && (
                  <div className="mt-4 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setRecoveryStep('request');
                        setRecoveryMessage('');
                        setRecoveryError('');
                      }}
                      className="text-[11px] font-semibold text-[#7a32fc] hover:underline"
                    >
                      Enviar novamente
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
                      <LogoVerto size={30} showText={true} />
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
                    className="mb-4 flex items-center gap-2 text-[9px] font-medium uppercase tracking-wider text-gray-400 transition hover:text-gray-600 md:text-[10px]"
                  >
                    <ArrowLeft size={12} /> Voltar
                  </button>

                  <div className="mb-6 flex items-center gap-3">
                    <div
                      className={`rounded-xl p-2 ${registerType === "professional" ? "bg-purple-100 text-[#7a32fc]" : "bg-pink-100 text-pink-500"}`}
                    >
                      {registerType === "professional" ? (
                        <Stethoscope size={16} />
                      ) : (
                        <User size={16} />
                      )}
                    </div>
                    <div>
                      <h2 className="text-base font-semibold tracking-tight md:text-lg">
                        {registerType === "professional"
                          ? "Conhecer a Verto"
                          : "Cadastro"}
                      </h2>
                      <p className="text-[9px] font-normal uppercase tracking-wider text-gray-400 md:text-[10px]">
                        {registerType === "professional"
                          ? "Interesse comercial"
                          : "Paciente"}
                      </p>
                    </div>
                  </div>

                  {registerType === "professional" ? (
                    <SalesInterestForm
                      initialName={salesGooglePrefill?.name || ""}
                      initialAcquisitionChannel={acquisitionChannel}
                    />
                  ) : (
                    <>
                      <div className="mb-6 rounded-2xl border border-pink-100 bg-pink-50 p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <h3 className="text-sm font-semibold text-pink-600">
                            Plano Paciente
                          </h3>
                          <span className="rounded-full bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-pink-600">
                            Acesso acompanhado
                          </span>
                        </div>
                        <p className="text-[10px] font-normal leading-relaxed text-gray-500">
                          Acompanhe sua evolução, visualize metas e receba
                          feedbacks em tempo real.
                        </p>
                      </div>

                      <form
                        onSubmit={handleRegister}
                        className="space-y-3 md:space-y-3.5"
                      >
                        <div>
                          <label className="mb-1 ml-1 block text-[9px] font-medium uppercase tracking-wider text-gray-400 md:text-[10px]">
                            Nome completo
                          </label>
                          <input
                            type="text"
                            required
                            maxLength={180}
                            className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-2.5 text-sm font-normal outline-none transition-all focus:border-pink-400 md:px-5 md:py-3"
                            placeholder="Seu nome"
                            value={name}
                            onChange={(event) => {
                              setName(event.target.value);
                              if (registerError) setRegisterError("");
                            }}
                          />
                        </div>
                        <div>
                          <label className="mb-1 ml-1 block text-[9px] font-medium uppercase tracking-wider text-gray-400 md:text-[10px]">
                            E-mail
                          </label>
                          <input
                            type="email"
                            required
                            maxLength={254}
                            className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-2.5 text-sm font-normal outline-none transition-all focus:border-pink-400 md:px-5 md:py-3"
                            placeholder="seu@email.com"
                            value={email}
                            onChange={(event) => {
                              setEmail(event.target.value);
                              if (registerError) setRegisterError("");
                            }}
                          />
                        </div>
                        <div>
                          <label className="mb-1 ml-1 block text-[9px] font-medium uppercase tracking-wider text-gray-400 md:text-[10px]">
                            Senha
                          </label>
                          <input
                            type="password"
                            required
                            className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-2.5 text-sm font-normal outline-none transition-all focus:border-pink-400 md:px-5 md:py-3"
                            placeholder="••••••••••••"
                            value={password}
                            onChange={(event) => {
                              setPassword(event.target.value);
                              if (registerError) setRegisterError("");
                            }}
                          />
                        </div>

                        {registerError ? (
                          <p className="text-center text-[10px] font-normal text-red-500">
                            {registerError}
                          </p>
                        ) : null}

                        <button
                          type="submit"
                          disabled={loading}
                          className="w-full rounded-2xl bg-pink-500 py-3 text-sm font-semibold text-white shadow-lg shadow-pink-500/10 transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 md:py-3.5"
                        >
                          {loading ? "Processando..." : "Criar minha conta"}
                        </button>

                        <div className="relative my-4">
                          <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-gray-100" />
                          </div>
                          <div className="relative flex justify-center text-[10px] uppercase">
                            <span className="bg-white px-4 font-medium tracking-widest text-gray-400">
                              ou
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleGoogleLogin}
                          className="flex w-full items-center justify-center gap-3 rounded-2xl border border-gray-100 bg-white py-3 text-xs font-semibold text-gray-600 shadow-sm transition-all hover:bg-gray-50 active:scale-[0.98]"
                        >
                          <GoogleIcon size={16} /> Cadastrar com Google
                        </button>
                      </form>
                    </>
                  )}
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

              </div>
            </div>
          </div>
      )}

      {/* Footer */}
      {!accessOnly && (
      <footer className="bg-[#1d1f1c] py-20 border-t border-white/10">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="col-span-1 md:col-span-2">
            <LogoVerto size={40} showText={true} className="mb-6" />
            <p className="text-[#bdb8ae] font-normal max-w-sm leading-relaxed">
              Estruturando cuidado contínuo entre paciente, família, profissional e clínica.
            </p>
          </div>
          <div>
            <h4 className="font-semibold uppercase tracking-widest text-xs mb-6 text-white">Plataforma</h4>
            <ul className="space-y-4 text-sm font-semibold text-[#bdb8ae]">
              <li className="hover:text-white cursor-pointer">Central ABA</li>
              <li className="hover:text-white cursor-pointer">PEI e sessão</li>
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
      )}
    </div>
  );
};
