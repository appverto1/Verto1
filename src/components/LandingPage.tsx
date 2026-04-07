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
  Activity,
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
import { getSupabase } from '../lib/supabase';
import { dataService } from '../services/dataService';

export const LandingPage = ({ onLogin, setUser }: any) => {
  const [showLogin, setShowLogin] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [loginType, setLoginType] = useState<'professional' | 'patient' | 'coordinator' | null>(null);
  const [registerType, setRegisterType] = useState<'professional' | 'patient' | 'coordinator' | null>(null);
  const [registerStep, setRegisterStep] = useState(1); // 1: Type, 2: Form, 3: Plan (for prof)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [crp, setCrp] = useState('');
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
        const loginRes = await onLogin(data.session, loginType);
        
        if (loginRes?.twoFactorRequired) {
          setTwoFactorRequired(true);
          setTwoFactorEmail(loginRes.email);
          setLoginStep('password');
          setShowLogin(true); // Ensure login modal is still open
        }
      }
    } catch (err: any) {
      console.error('Login error:', err);
      setLoginError('Credenciais inválidas ou erro de conexão. Verifique seus dados.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    try {
      const supabase = await getSupabase();
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email,
      });
      if (error) throw error;
      setLoginError('E-mail de confirmação reenviado com sucesso! Verifique sua caixa de entrada.');
    } catch (err: any) {
      console.error('Resend error:', err);
      setLoginError('Erro ao reenviar confirmação: ' + err.message);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      // Store intended role in localStorage to retrieve after redirect
      // Use registerType if in register modal, otherwise loginType
      const roleToStore = showRegister ? registerType : loginType;
      localStorage.setItem('verto_intended_role', roleToStore);
      
      const supabase = await getSupabase();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + '/',
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

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError('');
    
    if ((registerType === 'professional' || registerType === 'coordinator') && !crp) {
      setRegisterError('CRP é obrigatório para profissionais.');
      return;
    }

    try {
      setLoading(true);
      // Use direct signup route to bypass email confirmation
      const response = await fetch('/api/auth/signup-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          password,
          name,
          role: registerType === 'professional' ? 'coordinator' : 'patient', // Professionals sign up as coordinators
          crp: registerType === 'professional' ? crp : undefined,
          planName: registerType === 'patient' ? 'Paciente' : selectedPlan,
          acquisitionChannel
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao criar conta');
      }

      if (data.user.subscriptionStatus === 'active' || registerType === 'professional') {
        // Free access or professional (needs onboarding first)
        if (email === 'appverto1@gmail.com') {
          await start2FASetup();
        }
        setShowRegister(false);
        setUser(data.user); // Log in directly
      } else if (registerType === 'professional' && !selectedPlan) {
        setRegisterStep(3);
      } else {
        // Redirect to Stripe checkout
        const supabase = await getSupabase();
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        const checkoutRes = await fetch('/api/stripe/create-checkout', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
          },
          credentials: 'include'
        });
        const checkoutData = await checkoutRes.json();
        if (checkoutData.url) {
          window.location.href = checkoutData.url;
        } else {
          // Fallback if Stripe fails
          console.error('Stripe creation failed:', checkoutData);
          alert(`Conta criada com sucesso! No entanto, houve um erro ao iniciar o pagamento: ${checkoutData.error || 'Erro desconhecido'}. Por favor, faça login para tentar novamente.`);
          setShowRegister(false);
          setLoginStep('email');
          setShowLogin(true);
        }
      }
    } catch (error: any) {
      console.error('Register error:', error);
      if (error.message.includes('already been registered') || error.message.includes('já está cadastrado')) {
        setRegisterError('Este e-mail já está cadastrado. Por favor, faça login.');
      } else {
        setRegisterError(error.message || 'Erro ao cadastrar. Tente novamente.');
      }
    }
  };

  const handleSelectPlan = async (planName: string) => {
    try {
      setLoading(true);
      
      // Call create-checkout with the selected plan
      const checkoutRes = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planName })
      });
      const checkoutData = await checkoutRes.json();
      
      if (checkoutData.url) {
        window.location.href = checkoutData.url;
      } else {
        throw new Error(checkoutData.error || 'Erro ao iniciar checkout');
      }
    } catch (err: any) {
      console.error('Select plan error:', err);
      setRegisterError('Erro ao processar checkout: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white font-sans text-gray-900 overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LogoVerto size={40} showText={true} />
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#funcionalidades" className="text-sm font-semibold text-gray-500 hover:text-[#4318FF] transition-colors">Funcionalidades</a>
            <a href="#sobre" className="text-sm font-semibold text-gray-500 hover:text-[#4318FF] transition-colors">Sobre</a>
            <a href="#precos" className="text-sm font-semibold text-gray-500 hover:text-[#4318FF] transition-colors">Preços</a>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => {
                setLoginType('patient');
                setLoginStep('email');
                setShowLogin(true);
              }}
              className="text-gray-500 font-semibold text-sm hover:text-pink-500 transition-colors"
            >
              Sou Paciente
            </button>
            <button 
              onClick={() => {
                setLoginType('professional');
                setLoginStep('email');
                setShowLogin(true);
              }}
              className="bg-[#4318FF] text-white px-6 py-2.5 rounded-full font-semibold text-sm shadow-lg shadow-blue-500/20 hover:opacity-90 transition-all active:scale-95"
            >
              Sou Profissional
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-40 pb-20 px-6">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div className="animate-slide-up">
            <div className="inline-flex items-center gap-2 bg-blue-50 text-[#4318FF] px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-widest mb-6">
              <Rocket size={14} />
              O Futuro da Terapia Neuroevolutiva
            </div>
            <h1 className="text-6xl md:text-7xl font-semibold leading-[0.9] tracking-tighter mb-8">
              O centro da <br />
              terapia é a <br />
              <span className="text-[#4318FF]">evolução</span>.
            </h1>
            <p className="text-xl text-gray-500 font-normal leading-relaxed mb-10 max-w-lg">
              A Verto é a única plataforma projetada para transformar avaliações em resultados reais. 
              Da primeira consulta à alta, tudo converge para o progresso do seu paciente.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <button 
                onClick={() => {
                  window.open('https://calendly.com/verto-health', '_blank');
                }}
                className="bg-[#4318FF] text-white px-10 py-5 rounded-3xl font-semibold text-lg shadow-2xl shadow-blue-500/30 hover:scale-105 transition-all flex items-center justify-center gap-3"
              >
                Agendar uma demonstração <ArrowRight size={20} />
              </button>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -top-20 -right-20 w-64 h-64 bg-blue-100 rounded-full blur-3xl opacity-50 animate-pulse"></div>
            <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-purple-100 rounded-full blur-3xl opacity-50 animate-pulse delay-700"></div>
            
            <div className="relative bg-white rounded-[40px] shadow-2xl border border-gray-100 p-4 overflow-hidden group">
              <img 
                src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?q=80&w=2015&auto=format&fit=crop" 
                alt="Verto Financial Dashboard" 
                className="rounded-[32px] w-full h-auto transform group-hover:scale-[1.02] transition-transform duration-700"
                referrerPolicy="no-referrer"
                onError={(e: any) => {
                  e.target.src = 'https://placehold.co/1200x800/4318FF/white?text=Verto+Financial+Dashboard';
                }}
              />
              
              {/* Professional Insight Card - Replaces the "balloon" */}
              <div className="absolute bottom-10 left-10 right-10 md:right-auto md:w-80 bg-white/90 backdrop-blur-md p-6 rounded-[32px] shadow-2xl border border-white/20 animate-slide-up">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-[#4318FF] text-white rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                    <Activity size={24} />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-[#4318FF] uppercase tracking-widest">Insight Clínico</p>
                    <p className="text-base font-semibold text-gray-900">Análise de Energia</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-gray-500">Nível Sensorial</span>
                    <span className="text-xs font-semibold text-orange-500">ALTO</span>
                  </div>
                  <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-orange-500 w-[85%] rounded-full"></div>
                  </div>
                  <p className="text-[11px] text-gray-500 font-normal leading-tight">
                    Paciente apresenta sinais de sobrecarga sensorial. Sugerido pausa reguladora.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Showcase Section - PEI FOCUS */}
      <section className="py-24 bg-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-6">
          {/* 1. PEI Creation and Monitoring */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 items-center mb-32">
            <div className="order-2 lg:order-1">
              <div className="relative bg-gray-50 rounded-[48px] p-8 shadow-inner border border-gray-100">
                <div className="bg-white rounded-[32px] shadow-2xl p-6 border border-gray-100">
                  <div className="flex items-center justify-between mb-6">
                    <h4 className="text-lg font-semibold text-gray-800 tracking-tight">Plano Terapêutico Inteligente</h4>
                    <div className="px-4 py-1.5 bg-[#4318FF]/10 text-[#4318FF] rounded-full text-[10px] font-semibold uppercase tracking-widest">Em Evolução</div>
                  </div>
                  <div className="space-y-6">
                    <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-semibold text-gray-700">Habilidade: Comunicação Funcional</span>
                        <span className="text-[10px] font-semibold text-blue-500 uppercase">65%</span>
                      </div>
                      <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-[#4318FF] w-[65%]"></div>
                      </div>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-semibold text-gray-700">Habilidade: Interação Social</span>
                        <span className="text-[10px] font-semibold text-green-500 uppercase">Concluído</span>
                      </div>
                      <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 w-full"></div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="absolute -bottom-6 -right-6 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl"></div>
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <div className="inline-flex items-center gap-2 bg-blue-50 text-[#4318FF] px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-widest mb-4">
                Nossa Proposta Única
              </div>
              <h2 className="text-4xl md:text-5xl font-semibold tracking-tighter mb-6">Gestão do <span className="text-[#4318FF]">Plano de Ensino</span> sem fricção.</h2>
              <p className="text-lg text-gray-500 font-normal leading-relaxed mb-8">
                Esqueça planilhas e papéis. Na Verto, o planejamento individualizado é o motor da sua clínica. Vincule avaliações a intervenções automaticamente e veja o progresso ser desenhado em tempo real a cada sessão.
              </p>
              <ul className="space-y-4">
                {['Vinculação automática Avaliação-Intervenção', 'Critérios de maestria baseados em evidência', 'Histórico de evolução por domínio', 'Ajustes dinâmicos de metas'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-gray-700 font-semibold">
                    <div className="w-6 h-6 bg-blue-100 text-[#4318FF] rounded-full flex items-center justify-center">
                      <CheckCircle2 size={14} />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 2. PEI-Driven Reports */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 items-center mb-32">
            <div className="order-1 lg:order-1">
              <div className="inline-flex items-center gap-2 bg-emerald-50 text-[#05CD99] px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-widest mb-4">
                Relatórios de Impacto
              </div>
              <h2 className="text-4xl md:text-5xl font-semibold tracking-tighter mb-6">Relatórios que provam o <span className="text-[#05CD99]">resultado clínico</span>.</h2>
              <p className="text-lg text-gray-500 font-normal leading-relaxed mb-8">
                Não entregue apenas anotações, entregue evidências. Nossos relatórios profissionais compilam automaticamente os dados de cada sessão em gráficos de fácil compreensão para pais e operadoras de saúde.
              </p>
              <div className="flex gap-4">
                <div className="p-4 bg-gray-50 rounded-3xl border border-gray-100 flex-1">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Dados Estruturados</p>
                  <p className="text-2xl font-semibold text-gray-800">100%</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-3xl border border-gray-100 flex-1">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Geração de Relatórios</p>
                  <p className="text-2xl font-semibold text-gray-800">&lt; 1 min</p>
                </div>
              </div>
            </div>
            <div className="order-2 lg:order-2 relative">
              <div className="bg-gray-50 rounded-[48px] p-8 shadow-inner border border-gray-100">
                <div className="bg-white rounded-[32px] shadow-2xl p-8 border border-gray-100">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 bg-emerald-50 text-[#05CD99] rounded-xl flex items-center justify-center">
                      <Activity size={20} />
                    </div>
                    <h4 className="text-lg font-semibold text-gray-800 tracking-tight">Evolução por Domínio</h4>
                  </div>
                  <div className="flex items-end gap-3 h-48">
                    {[1, 0.7, 0.9, 1, 0.6, 0.8, 0.5].map((h, i) => (
                      <div key={i} className="flex-1 h-full flex flex-col gap-2 items-center">
                        <div className="w-full bg-gray-100 rounded-t-lg relative overflow-hidden flex flex-col justify-end h-full">
                          <div className="w-full bg-[#05CD99] opacity-80 rounded-t-lg transition-all duration-1000" style={{ height: `${h * 100}%` }}></div>
                        </div>
                        <div className="w-full h-1 bg-gray-100 rounded-full"></div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 flex justify-between text-[7px] font-semibold text-gray-300 uppercase tracking-widest">
                    <span>Mando</span>
                    <span>Tato</span>
                    <span>Intra</span>
                    <span>Social</span>
                    <span>Brincar</span>
                    <span>Imitação</span>
                    <span>Ecoico</span>
                  </div>
                </div>
              </div>
              <div className="absolute -top-6 -left-6 w-32 h-32 bg-green-500/10 rounded-full blur-2xl"></div>
            </div>
          </div>

          {/* 3. PEI and Engagement */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 items-center">
            <div className="order-2 lg:order-1">
              <div className="relative bg-gray-50 rounded-[48px] p-8 shadow-inner border border-gray-100">
                <div className="bg-white rounded-[32px] shadow-2xl p-8 border border-gray-100">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 bg-pink-100 text-pink-500 rounded-2xl flex items-center justify-center">
                      <Heart size={24} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Conquista do Dia</p>
                      <p className="text-lg font-semibold text-gray-800">Meta Batida!</p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-500 font-normal leading-relaxed mb-6">
                    "Alexandre completou 5 mandos independentes hoje. O progresso no PEI está acelerado!"
                  </p>
                  <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-pink-500 w-full animate-pulse"></div>
                  </div>
                </div>
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <h2 className="text-4xl md:text-5xl font-semibold tracking-tighter mb-6">A <span className="text-pink-500">jornada</span> como conexão.</h2>
              <p className="text-lg text-gray-500 font-normal leading-relaxed mb-8">
                O progresso não deve ficar guardado na gaveta. Na Verto, o plano de ensino é compartilhado com the família de forma lúdica, transformando metas técnicas em celebrações reais de desenvolvimento.
              </p>
              <ul className="space-y-4">
                {['Portal da Família integrado ao plano', 'Feedback imediato de conquistas', 'Engajamento lúdico para crianças', 'Protagonismo na evolução para adultos'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-gray-700 font-semibold">
                    <div className="w-6 h-6 bg-pink-100 text-pink-600 rounded-full flex items-center justify-center">
                      <CheckCircle2 size={14} />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Experience Comparison Section */}
      <section className="py-24 bg-gray-900 text-white relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500 rounded-full blur-[120px]"></div>
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500 rounded-full blur-[120px]"></div>
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-6xl font-semibold tracking-tighter mb-6">Experiências que <span className="text-[#4318FF]">transformam</span> vidas.</h2>
            <p className="text-xl text-gray-400 font-normal max-w-3xl mx-auto">
              Projetamos interfaces específicas para cada perfil, garantindo que a tecnologia seja uma aliada do engajamento e do resultado clínico individualizado.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-32">
            {/* Kids & Family */}
            <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-[56px] p-12 hover:bg-white/10 transition-all group">
              <div className="w-16 h-16 bg-pink-500/20 text-pink-400 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">
                <Heart size={32} />
              </div>
              <h3 className="text-3xl font-semibold mb-6">O progresso na palma da mão</h3>
              <p className="text-lg text-gray-400 font-normal leading-relaxed mb-8">
                Transformamos o planejamento técnico em uma jornada de conquistas. O progresso da criança se torna uma fonte de orgulho diário para os pais através de uma interface lúdica e gamificada.
              </p>
              <ul className="space-y-4">
                {[
                  "Visualização lúdica do desenvolvimento",
                  "Acesso em tempo real às metas alcançadas",
                  "Transformação de dados em vitórias familiares",
                  "Engajamento através de reforçadores digitais"
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-gray-300 font-semibold">
                    <Check size={20} className="text-pink-400 shrink-0 mt-1" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Adults */}
            <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-[56px] p-12 hover:bg-white/10 transition-all group">
              <div className="w-16 h-16 bg-orange-500/20 text-orange-400 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">
                <Zap size={32} />
              </div>
              <h3 className="text-3xl font-semibold mb-6">Protagonismo na evolução</h3>
              <p className="text-lg text-gray-400 font-normal leading-relaxed mb-8">
                Diferencie sua clínica oferecendo ferramentas de autonomia. Seus pacientes adultos gerem o próprio plano, realizam tarefas terapêuticas e aceleram a própria evolução.
              </p>
              <ul className="space-y-4">
                {[
                  "Gestão autônoma de metas e objetivos",
                  "Registro diário de evolução e bem-estar",
                  "Acompanhamento claro da própria jornada",
                  "Lembretes inteligentes para metas de autonomia"
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-gray-300 font-semibold">
                    <Check size={20} className="text-orange-400 shrink-0 mt-1" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Journeys Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-24">
            {/* Therapist Journey */}
            <div>
              <div className="inline-flex items-center gap-2 bg-blue-500/20 text-blue-400 px-4 py-2 rounded-full text-[10px] font-semibold uppercase tracking-widest mb-8">
                Jornada do Terapeuta
              </div>
              <h3 className="text-4xl font-semibold mb-12 tracking-tighter">Do diagnóstico à <span className="text-blue-400">alta baseada em dados</span>.</h3>
              <div className="space-y-12 relative">
                <div className="absolute left-[27px] top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-500/50 to-transparent"></div>
                {[
                  { step: "01", title: "Avaliação Inicial", desc: "Aplique protocolos padrão ouro (VB-MAPP, AFLS) e identifique lacunas de desenvolvimento instantaneamente." },
                  { step: "02", title: "Plano Individualizado", desc: "O sistema sugere metas e intervenções baseadas na avaliação, criando um planejamento robusto em minutos." },
                  { step: "03", title: "Registro em Tempo Real", desc: "Durante a sessão, registre tentativas e comportamentos. Os dados alimentam o progresso automaticamente." },
                  { step: "04", title: "Relatórios de Evolução", desc: "Gere relatórios profissionais com gráficos de progresso por domínio, prontos para pais e operadoras." }
                ].map((item, i) => (
                  <div key={i} className="relative pl-20 group">
                    <div className="absolute left-0 top-0 w-14 h-14 bg-blue-500/20 border border-blue-500/30 rounded-2xl flex items-center justify-center text-blue-400 font-semibold text-xl group-hover:bg-blue-500 group-hover:text-white transition-all">
                      {item.step}
                    </div>
                    <h4 className="text-xl font-semibold mb-2">{item.title}</h4>
                    <p className="text-gray-400 font-medium leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Patient Journey */}
            <div>
              <div className="inline-flex items-center gap-2 bg-pink-500/20 text-pink-400 px-4 py-2 rounded-full text-[10px] font-semibold uppercase tracking-widest mb-8">
                Jornada do Paciente
              </div>
              <h3 className="text-4xl font-semibold mb-12 tracking-tighter">Engajamento que acelera o <span className="text-pink-400">resultado clínico</span>.</h3>
              <div className="space-y-12 relative">
                <div className="absolute left-[27px] top-0 bottom-0 w-0.5 bg-gradient-to-b from-pink-500/50 to-transparent"></div>
                {[
                  { step: "01", title: "Portal Personalizado", desc: "Acesso a uma interface desenhada para o perfil do paciente (lúdica para kids, funcional para adultos)." },
                  { step: "02", title: "Visualização de Metas", desc: "O paciente e a família acompanham o progresso do tratamento de forma clara, celebrando cada conquista." },
                  { step: "03", title: "Tarefas Terapêuticas", desc: "Engajamento contínuo fora da clínica com tarefas que reforçam as habilidades trabalhadas no plano." },
                  { step: "04", title: "Celebração de Vitórias", desc: "Reforço positivo imediato a cada meta batida, transformando o tratamento em uma jornada positiva." }
                ].map((item, i) => (
                  <div key={i} className="relative pl-20 group">
                    <div className="absolute left-0 top-0 w-14 h-14 bg-pink-500/20 border border-pink-500/30 rounded-2xl flex items-center justify-center text-pink-400 font-semibold text-xl group-hover:bg-pink-500 group-hover:text-white transition-all">
                      {item.step}
                    </div>
                    <h4 className="text-xl font-semibold mb-2">{item.title}</h4>
                    <p className="text-gray-400 font-medium leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="funcionalidades" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-semibold tracking-tight mb-4">Tudo o que sua clínica precisa para escalar.</h2>
            <p className="text-gray-500 font-medium max-w-2xl mx-auto text-lg">
              Desenvolvemos ferramentas específicas para cada etapa da operação, do acolhimento à alta.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: <Brain />, title: "Plano Individualizado", desc: "Criação e monitoramento dinâmico do planejamento terapêutico com vinculação inteligente de metas.", color: "text-[#4318FF]", bg: "bg-blue-100" },
              { icon: <Activity />, title: "Relatórios de Progresso", desc: "Transforme dados de sessão em relatórios visuais automáticos que provam a evolução do paciente.", color: "text-[#05CD99]", bg: "bg-emerald-100" },
              { icon: <Heart />, title: "Portal da Família", desc: "Compartilhe o progresso do tratamento de forma lúdica, celebrando cada pequena vitória com os pais.", color: "text-pink-600", bg: "bg-pink-100" },
              { icon: <Zap />, title: "Autonomia do Paciente", desc: "Pacientes adultos assumem o protagonismo do próprio tratamento através de tarefas e registros de bem-estar.", color: "text-orange-600", bg: "bg-orange-100" },
              { icon: <Rocket />, title: "Gestão da Clínica", desc: "Controle financeiro completo, DRE e gestão administrativa simplificada para sua operação.", color: "text-emerald-600", bg: "bg-emerald-50" },
              { icon: <Users />, title: "Equipe Multidisciplinar", desc: "Equipe alinhada em torno do mesmo planejamento, garantindo consistência e troca de informações.", color: "text-red-600", bg: "bg-red-100" }
            ].map((feature, i) => (
              <div 
                key={i}
                className="bg-white p-10 rounded-[40px] shadow-sm border border-gray-100 hover:shadow-xl transition-all hover:-translate-y-2"
              >
                <div className={`w-16 h-16 ${feature.bg} ${feature.color} rounded-2xl flex items-center justify-center mb-6`}>
                  {React.cloneElement(feature.icon as React.ReactElement, { size: 32 })}
                </div>
                <h3 className="text-xl font-semibold mb-4">{feature.title}</h3>
                <p className="text-gray-500 font-medium leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="precos" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-20">
            <h2 className="text-5xl font-semibold tracking-tighter mb-6">Planos que crescem com sua clínica e geram lucro real.</h2>
            <p className="text-xl text-gray-500 font-medium max-w-3xl mx-auto">
              De clínicas boutique a grandes redes, a Verto oferece a infraestrutura para escalar sua operação e entregar uma experiência premium.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
            {/* Essencial */}
            <div className="bg-white border border-gray-100 rounded-[40px] p-8 shadow-sm hover:shadow-xl transition-all flex flex-col">
              <div className="mb-8">
                <h3 className="text-xl font-semibold mb-2">Essencial</h3>
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-6">Para clínicas boutique ou autônomos</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-semibold">R$ 149,90</span>
                  <span className="text-gray-400 font-semibold text-sm">/ mês</span>
                </div>
              </div>
              <button 
                onClick={() => {
                  setSelectedPlan('Essencial');
                  setRegisterType('professional');
                  setRegisterStep(2);
                  setShowRegister(true);
                }}
                className="w-full bg-gray-900 text-white py-4 rounded-2xl font-semibold text-sm mb-8 hover:bg-black transition-all"
              >
                Começar Agora
              </button>
              <ul className="space-y-4 flex-1">
                {['Até 2 Profissionais', 'Planos Terapêuticos Ilimitados', 'Relatórios de Evolução Automáticos', 'Portal do Paciente', 'Gestão Financeira Básica', 'Histórico Portátil', 'Dashboard do Profissional'].map((f, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm font-medium text-gray-600">
                    <Check size={18} className="text-green-500 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            {/* Crescimento */}
            <div className="bg-[#4318FF]/5 border-2 border-[#4318FF] rounded-[40px] p-8 shadow-xl relative flex flex-col transform lg:-translate-y-4">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#4318FF] text-white px-4 py-1 rounded-full text-[10px] font-semibold uppercase tracking-widest">Mais Popular</div>
              <div className="mb-8">
                <h3 className="text-xl font-semibold mb-2">Crescimento</h3>
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-6">Para clínicas em crescimento</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-semibold">R$ 399,90</span>
                  <span className="text-gray-400 font-semibold text-sm">/ mês</span>
                </div>
              </div>
              <button 
                onClick={() => {
                  setSelectedPlan('Crescimento');
                  setRegisterType('professional');
                  setRegisterStep(2);
                  setShowRegister(true);
                }}
                className="w-full bg-[#4318FF] text-white py-4 rounded-2xl font-semibold text-sm mb-8 shadow-lg shadow-blue-500/20 hover:opacity-90 transition-all"
              >
                Começar Agora
              </button>
              <ul className="space-y-4 flex-1">
                <li className="text-xs font-semibold text-[#4318FF] uppercase tracking-widest mb-2">Tudo do Essencial +</li>
                {['3 a 7 Profissionais', 'Dashboard de Evolução Clínica', 'Relatórios Consolidados', 'Gestão Financeira Avançada', 'Suporte Prioritário'].map((f, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm font-medium text-gray-600">
                    <Check size={18} className="text-[#4318FF] shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            {/* Avançado */}
            <div className="bg-white border border-gray-100 rounded-[40px] p-8 shadow-sm hover:shadow-xl transition-all flex flex-col">
              <div className="mb-8">
                <h3 className="text-xl font-semibold mb-2">Avançado</h3>
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-6">Para clínicas estabelecidas</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-semibold">R$ 679,90</span>
                  <span className="text-gray-400 font-semibold text-sm">/ mês</span>
                </div>
              </div>
              <button 
                onClick={() => {
                  setSelectedPlan('Avançado');
                  setRegisterType('professional');
                  setRegisterStep(2);
                  setShowRegister(true);
                }}
                className="w-full bg-gray-900 text-white py-4 rounded-2xl font-semibold text-sm mb-8 hover:bg-black transition-all"
              >
                Começar Agora
              </button>
              <ul className="space-y-4 flex-1">
                <li className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Tudo do Crescimento +</li>
                {['7 a 12 Profissionais', 'Múltiplos Workspaces de PEI', 'API de Integração de Dados', 'Gerente de Conta Dedicado'].map((f, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm font-medium text-gray-600">
                    <Check size={18} className="text-green-500 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            {/* Enterprise */}
            <div className="bg-slate-50 text-slate-900 border border-slate-200 rounded-[40px] p-8 shadow-sm hover:shadow-xl transition-all flex flex-col">
              <div className="mb-8">
                <h3 className="text-xl font-semibold mb-2">Enterprise</h3>
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest mb-6">Para grandes redes e franquias</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-semibold">Personalizado</span>
                </div>
              </div>
              <button 
                onClick={() => {
                  window.open('https://calendly.com/verto-health', '_blank');
                }}
                className="w-full bg-slate-900 text-white py-4 rounded-2xl font-semibold text-sm mb-8 hover:bg-black transition-all"
              >
                Agendar uma demonstração
              </button>
              <ul className="space-y-4 flex-1">
                <li className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Tudo do Avançado +</li>
                {['12+ Profissionais', 'Workspaces Ilimitados', 'Dashboard de Organização', 'Faturamento Centralizado', 'Opções de White-label'].map((f, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm font-medium text-slate-600">
                    <Check size={18} className="text-[#4318FF] shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* ROI Callout */}
          <div className="bg-gradient-to-r from-[#4318FF] to-[#7000FF] rounded-[48px] p-12 text-white relative overflow-hidden mb-24">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32 blur-3xl"></div>
            <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <h3 className="text-3xl font-semibold mb-4">O Valor Real do Resultado</h3>
                <p className="text-lg text-white/80 font-medium leading-relaxed">
                  Ao oferecer um planejamento dinâmico e relatórios de evolução automáticos, sua clínica entrega um valor premium. O investimento se traduz em maior retenção e valorização do seu serviço.
                </p>
              </div>
              <div className="flex justify-center lg:justify-end">
                <div className="bg-white/10 backdrop-blur-md rounded-3xl p-8 border border-white/20 inline-block">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 bg-green-400 rounded-2xl flex items-center justify-center text-gray-900">
                      <Zap size={24} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest opacity-60">Valorização Estimada</p>
                      <p className="text-2xl font-semibold">+ 104%</p>
                    </div>
                  </div>
                  <p className="text-[10px] font-semibold opacity-60 uppercase tracking-widest">Baseado em 20 planos ativos</p>
                </div>
              </div>
            </div>
          </div>

          {/* Detailed Comparison Table */}
          <div className="mb-32 overflow-x-auto">
            <div className="text-center mb-12">
              <h3 className="text-3xl font-semibold tracking-tight">Compare as Funcionalidades</h3>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="py-6 px-4 text-xs font-semibold text-gray-400 uppercase tracking-widest">Funcionalidade</th>
                  <th className="py-6 px-4 text-center text-sm font-semibold">Essencial</th>
                  <th className="py-6 px-4 text-center text-sm font-semibold text-[#4318FF]">Crescimento</th>
                  <th className="py-6 px-4 text-center text-sm font-semibold">Avançado</th>
                  <th className="py-6 px-4 text-center text-sm font-semibold">Enterprise</th>
                </tr>
              </thead>
              <tbody className="text-sm font-medium text-gray-600">
                {[
                  { name: 'Plano Individualizado', p: true, eq: true, cl: true, en: true },
                  { name: 'Agenda Inteligente', p: true, eq: true, cl: true, en: true },
                  { name: 'Relatórios de Evolução', p: true, eq: true, cl: true, en: true },
                  { name: 'Portal do Paciente', p: true, eq: true, cl: true, en: true },
                  { name: 'Dashboard de Evolução Clínica', p: false, eq: true, cl: true, en: true },
                  { name: 'Relatórios Consolidados', p: false, eq: true, cl: true, en: true },
                  { name: 'Múltiplos Workspaces', p: false, eq: false, cl: 'Até 2', en: 'Ilimitados' },
                  { name: 'API de Integração', p: false, eq: false, cl: true, en: true },
                  { name: 'Dashboard de Rede', p: false, eq: false, cl: false, en: true },
                  { name: 'White-label', p: false, eq: false, cl: false, en: true },
                  { name: 'Gerente de Conta', p: false, eq: false, cl: true, en: true },
                  { name: 'Suporte', p: 'E-mail', eq: 'Prioritário', cl: '24/7', en: 'Dedicado' },
                ].map((row, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="py-4 px-4 font-semibold text-gray-800">{row.name}</td>
                    <td className="py-4 px-4 text-center">
                      {typeof row.p === 'boolean' ? (row.p ? <Check size={18} className="mx-auto text-green-500" /> : <span className="text-gray-200">—</span>) : row.p}
                    </td>
                    <td className="py-4 px-4 text-center">
                      {typeof row.eq === 'boolean' ? (row.eq ? <Check size={18} className="mx-auto text-[#4318FF]" /> : <span className="text-gray-200">—</span>) : row.eq}
                    </td>
                    <td className="py-4 px-4 text-center">
                      {typeof row.cl === 'boolean' ? (row.cl ? <Check size={18} className="mx-auto text-green-500" /> : <span className="text-gray-200">—</span>) : row.cl}
                    </td>
                    <td className="py-4 px-4 text-center">
                      {typeof row.en === 'boolean' ? (row.en ? <Check size={18} className="mx-auto text-green-500" /> : <span className="text-gray-200">—</span>) : row.en}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* FAQ Section */}
          <div className="max-w-3xl mx-auto mb-32">
            <div className="text-center mb-12">
              <h3 className="text-3xl font-semibold tracking-tight">Perguntas Frequentes</h3>
            </div>
            <div className="space-y-4">
              {[
                { q: "Como a Verto ajuda na criação do plano terapêutico?", a: "A Verto automatiza a transição da avaliação para o planejamento. Ao identificar lacunas em protocolos como VB-MAPP ou AFLS, o sistema sugere metas e intervenções, permitindo que você monte um plano robusto em minutos." },
                { q: "O progresso é atualizado em tempo real?", a: "Sim. Cada registro de sessão alimenta automaticamente a evolução das metas. Você e a família podem ver o desenvolvimento acontecer sem a necessidade de compilação manual de dados." },
                { q: "Posso personalizar os critérios de maestria?", a: "Totalmente. Entendemos que cada paciente é único. Você pode definir critérios de maestria específicos para cada meta, garantindo que a progressão respeite o ritmo individual." },
                { q: "Como os relatórios de evolução são gerados?", a: "Com um clique. O sistema compila todo o histórico de registros, anotações profissionais e gráficos de evolução em um documento profissional pronto para ser compartilhado." },
                { q: "Meus dados clínicos estão seguros?", a: "Segurança é nossa prioridade. Utilizamos criptografia de ponta a ponta e servidores em conformidade com HIPAA e LGPD para garantir que os dados sensíveis estejam sempre protegidos." }
              ].map((faq, i) => (
                <div key={i} className="bg-gray-50 rounded-3xl overflow-hidden border border-gray-100">
                  <button 
                    onClick={() => setActiveFaq(activeFaq === i ? null : i)}
                    className="w-full p-6 text-left flex items-center justify-between hover:bg-gray-100 transition-all"
                  >
                    <span className="font-semibold text-gray-800">{faq.q}</span>
                    <ChevronDown size={20} className={`text-gray-400 transition-transform ${activeFaq === i ? 'rotate-180' : ''}`} />
                  </button>
                  {activeFaq === i && (
                    <div className="px-6 pb-6 text-sm text-gray-500 font-normal leading-relaxed animate-slide-down">
                      {faq.a}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Final CTA */}
          <div className="bg-slate-50 rounded-[64px] p-16 text-center text-slate-900 border border-slate-100 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-full opacity-10">
              <div className="absolute top-10 left-10 w-32 h-32 bg-blue-200 rounded-full blur-3xl"></div>
              <div className="absolute bottom-10 right-10 w-32 h-32 bg-purple-200 rounded-full blur-3xl"></div>
            </div>
            <div className="relative z-10 max-w-2xl mx-auto">
              <h3 className="text-4xl font-semibold mb-6">Ainda em dúvida?</h3>
              <p className="text-xl text-slate-600 font-normal mb-10">
                Nossa equipe está pronta para entender seu desafio e mostrar como a Verto pode ajudar. Agende uma demonstração sem compromisso e veja a plataforma em ação.
              </p>
              <a 
                href="https://wa.me/5511959348563" 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center gap-3 bg-[#25D366] text-white px-10 py-5 rounded-3xl font-semibold text-lg shadow-2xl shadow-green-500/20 hover:scale-105 transition-all"
              >
                <MessageCircle size={24} />
                Agendar Demonstração
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* 2FA Setup Modal */}
      {show2FASetup && (
        <div className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-md flex items-center justify-center p-4 md:p-6 animate-fade-in">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-xl overflow-hidden relative animate-pop p-8 text-center">
            <div className="w-16 h-16 bg-blue-50 text-[#4318FF] rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Shield size={32} />
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Configurar 2FA</h2>
            <p className="text-sm text-gray-500 mb-8">Escaneie o QR Code abaixo com seu app Google Authenticator para habilitar a proteção robusta.</p>
            
            <div className="bg-gray-50 p-4 rounded-2xl mb-8 inline-block">
              <img src={qrCodeUrl} alt="2FA QR Code" className="w-48 h-48 mx-auto" />
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
                className="w-full bg-[#4318FF] text-white py-4 rounded-2xl font-bold text-sm shadow-xl shadow-blue-500/20 hover:opacity-90 transition-all"
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
                onClick={() => setShowLogin(false)}
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

                <div className="bg-blue-50/50 border border-blue-100/50 rounded-2xl p-3 md:p-4 mb-6">
                  <p className="text-[9px] font-semibold text-[#4318FF] uppercase tracking-wider mb-1 flex items-center gap-2">
                    <ShieldCheck size={10} /> Segurança & Privacidade
                  </p>
                  <p className="text-[10px] md:text-[11px] text-gray-500 font-normal leading-relaxed">
                    Acesse sua conta com e-mail e senha cadastrados. Seus dados são protegidos por criptografia.
                  </p>
                </div>

                <form onSubmit={twoFactorRequired ? handle2FALogin : handleLogin} className="space-y-3 md:space-y-4">
                  {!twoFactorRequired ? (
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
                              className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-3 pl-11 pr-6 text-sm font-normal outline-none focus:border-[#4318FF] transition-all"
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
                              className="text-[10px] font-bold text-[#4318FF] hover:underline"
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
                              className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-3 pl-11 pr-11 text-sm font-normal outline-none focus:border-[#4318FF] transition-all"
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
                        <div className="flex items-center gap-2 ml-1">
                          <button 
                            type="button"
                            onClick={() => setRememberMe(!rememberMe)}
                            className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${rememberMe ? 'bg-[#4318FF] border-[#4318FF]' : 'bg-white border-gray-200'}`}
                          >
                            {rememberMe && <Check size={10} className="text-white" />}
                          </button>
                          <span className="text-[11px] font-normal text-gray-500 cursor-pointer select-none" onClick={() => setRememberMe(!rememberMe)}>Manter conectado</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-4 animate-fade-in">
                      <div className="p-4 bg-blue-50 rounded-2xl flex items-start gap-3">
                        <Shield className="text-[#4318FF] mt-0.5" size={20} />
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
                          className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-4 px-4 text-center text-2xl font-bold tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                          placeholder="000000"
                          maxLength={6}
                        />
                      </div>
                    </div>
                  )}

                  {loginError && (
                    <div className="space-y-2">
                      <p className="text-red-500 text-[10px] font-normal text-center">{loginError}</p>
                      {loginError.includes('não foi confirmado') && (
                        <button 
                          type="button"
                          onClick={handleResendConfirmation}
                          className="w-full text-[#4318FF] text-[10px] font-semibold hover:underline"
                        >
                          Reenviar e-mail de confirmação
                        </button>
                      )}
                    </div>
                  )}

                  <button 
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#4318FF] text-white py-3.5 rounded-2xl font-semibold text-sm shadow-lg shadow-blue-500/20 hover:opacity-90 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
                    {loginStep === 'email' ? 'Continuar' : 'Entrar na Verto'}
                  </button>

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
                </form>

                <div className="mt-6 pt-6 border-t border-gray-100 text-center">
                  <p className="text-xs text-gray-500 font-normal">
                    Não tem uma conta?{" "}
                    <button 
                      onClick={() => {
                        setShowLogin(false);
                        setShowRegister(true);
                        setRegisterStep(2);
                        setRegisterType(loginType === 'patient' ? 'patient' : 'professional');
                      }}
                      className="text-[#4318FF] font-medium hover:underline"
                    >
                      Cadastre-se agora
                    </button>
                  </p>
                </div>
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
                        className="flex items-center gap-4 p-4 bg-gray-50 border border-transparent hover:border-[#4318FF] hover:bg-blue-50/50 rounded-2xl transition-all group text-left"
                      >
                        <div className="w-10 h-10 md:w-12 md:h-12 bg-white rounded-xl flex items-center justify-center text-[#4318FF] shadow-sm group-hover:scale-105 transition-transform">
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
                          className="text-[#4318FF] font-medium hover:underline"
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
                      <div className={`p-2 rounded-xl ${registerType === 'professional' ? 'bg-blue-100 text-[#4318FF]' : 'bg-pink-100 text-pink-500'}`}>
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
                          <div className="text-right">
                            <span className="text-xl font-bold text-pink-600">R$ 4,90</span>
                            <span className="text-[10px] text-gray-400 font-bold uppercase ml-1">/mês</span>
                          </div>
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
                          className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-2.5 md:py-3 px-4 md:px-5 text-sm font-normal outline-none focus:border-[#4318FF] transition-all"
                          placeholder="Seu nome"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </div>

                      {registerType === 'professional' && (
                        <div>
                          <label className="block text-[9px] md:text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1 ml-1">CRP (Conselho Regional)</label>
                          <input 
                            type="text" 
                            required
                            className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-2.5 md:py-3 px-4 md:px-5 text-sm font-normal outline-none focus:border-[#4318FF] transition-all"
                            placeholder="Ex: 06/123456"
                            value={crp}
                            onChange={(e) => setCrp(e.target.value)}
                          />
                        </div>
                      )}

                      <div>
                        <label className="block text-[9px] md:text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1 ml-1">E-mail</label>
                        <input 
                          type="email" 
                          required
                          className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-2.5 md:py-3 px-4 md:px-5 text-sm font-normal outline-none focus:border-[#4318FF] transition-all"
                          placeholder="seu@email.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                      </div>

                      <div>
                        <label className="block text-[9px] md:text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1 ml-1">Senha</label>
                        <input 
                          type="password" 
                          required
                          className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-2.5 md:py-3 px-4 md:px-5 text-sm font-normal outline-none focus:border-[#4318FF] transition-all"
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </div>

                      {registerError && (
                        <p className="text-red-500 text-[9px] md:text-[10px] font-normal text-center">{registerError}</p>
                      )}

                      <button 
                        type="submit"
                        disabled={loading}
                        className={`w-full py-3 md:py-3.5 rounded-2xl font-semibold text-sm shadow-lg transition-all active:scale-[0.98] mt-2 ${registerType === 'professional' ? 'bg-[#4318FF] text-white shadow-blue-500/10' : 'bg-pink-500 text-white shadow-pink-500/10'} ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {loading ? 'Processando...' : (registerType === 'professional' && !selectedPlan ? 'Continuar para Planos' : 'Criar minha conta e Pagar')}
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
                      <div className="w-10 h-10 md:w-12 md:h-12 bg-blue-100 text-[#4318FF] rounded-xl flex items-center justify-center mx-auto mb-3">
                        <Rocket size={20} />
                      </div>
                      <h2 className="text-base md:text-lg font-semibold tracking-tight">Quase lá, {name.split(' ')[0]}!</h2>
                      <p className="text-gray-400 font-normal text-[9px] md:text-[10px] uppercase tracking-wider mt-1">Selecione o plano ideal para você</p>
                    </div>

                    <div className="space-y-2 md:space-y-2.5">
                      {[
                        { name: 'Essencial', price: '149,90', desc: 'Até 2 profissionais' },
                        { name: 'Crescimento', price: '399,90', desc: '3 a 7 profissionais' },
                        { name: 'Avançado', price: '679,90', desc: '7 a 12 profissionais' }
                      ].map((plan) => (
                        <button 
                          key={plan.name}
                          onClick={() => handleSelectPlan(plan.name)}
                          className="w-full p-3 md:p-4 bg-gray-50 border border-transparent hover:border-[#4318FF] hover:bg-blue-50/50 rounded-2xl transition-all flex items-center justify-between group text-left"
                        >
                          <div>
                            <h3 className="font-semibold text-gray-800 text-[11px] md:text-xs">{plan.name}</h3>
                            <p className="text-[8px] md:text-[9px] text-gray-400 font-normal uppercase tracking-wider">{plan.desc}</p>
                          </div>
                          <div className="text-right">
                            <span className="text-xs md:text-sm font-semibold text-[#4318FF]">R$ {plan.price}</span>
                            <p className="text-[7px] md:text-[8px] text-gray-400 font-normal uppercase">/mês</p>
                          </div>
                        </button>
                      ))}
                      <button 
                        onClick={() => handleSelectPlan('Enterprise')}
                        className="w-full p-3 md:p-4 bg-gray-900 text-white rounded-2xl hover:bg-black transition-all flex items-center justify-between group text-left"
                      >
                        <div>
                          <h3 className="font-semibold text-[11px] md:text-xs">Enterprise</h3>
                          <p className="text-[8px] md:text-[9px] text-gray-400 font-normal uppercase tracking-wider">Clínicas de grande porte</p>
                        </div>
                        <span className="text-[8px] md:text-[9px] font-semibold uppercase tracking-wider">Sob Consulta</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
      )}

      {/* Footer */}
      <footer className="bg-white py-20 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <LogoVerto size={40} />
              <span className="text-2xl font-logo font-bold tracking-tighter text-[#4318FF] lowercase">verto</span>
            </div>
            <p className="text-gray-500 font-normal max-w-sm leading-relaxed">
              Transformando a jornada terapêutica através da tecnologia e do design centrado no ser humano.
            </p>
          </div>
          <div>
            <h4 className="font-semibold uppercase tracking-widest text-xs mb-6 text-gray-800">Plataforma</h4>
            <ul className="space-y-4 text-sm font-semibold text-gray-400">
              <li className="hover:text-[#4318FF] cursor-pointer">Funcionalidades</li>
              <li className="hover:text-[#4318FF] cursor-pointer">Protocolos</li>
              <li className="hover:text-[#4318FF] cursor-pointer">Segurança</li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold uppercase tracking-widest text-xs mb-6 text-gray-800">Suporte</h4>
            <ul className="space-y-4 text-sm font-semibold text-gray-400">
              <li className="hover:text-[#4318FF] cursor-pointer">Central de Ajuda</li>
              <li className="hover:text-[#4318FF] cursor-pointer">Contato</li>
              <li className="hover:text-[#4318FF] cursor-pointer">Termos de Uso</li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 mt-20 pt-8 border-t border-gray-50 text-center text-xs font-semibold text-gray-300 uppercase tracking-widest">
          © 2026 Verto Health Technologies. Todos os direitos reservados.
        </div>
      </footer>
    </div>
  );
};
