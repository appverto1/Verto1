import React, { useState, useMemo } from 'react';
import { 
  BarChart3, 
  Users, 
  TrendingUp, 
  AlertCircle, 
  DollarSign, 
  Plus, 
  Search, 
  Filter, 
  Download, 
  ChevronRight, 
  ArrowUpRight, 
  ArrowDownRight,
  LayoutDashboard,
  CreditCard,
  Settings,
  LogOut,
  UserPlus,
  PieChart as PieChartIcon,
  Calendar,
  Database,
  ExternalLink,
  CheckCircle2,
  Shield
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area
} from 'recharts';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';
import { LogoVerto } from './Common';
import { SecureImage } from './SecureMedia';
import { getSupabase } from '../lib/supabase';

// Mock Data for Admin Dashboard (Removed as we use real data now)
const DRE_DATA_MOCK = [
  { month: 'Jan', revenue: 45000, costs: 12000, expenses: 8000, profit: 25000 },
  { month: 'Fev', revenue: 52000, costs: 14000, expenses: 8500, profit: 29500 },
  { month: 'Mar', revenue: 61000, costs: 15500, expenses: 9000, profit: 36500 },
  { month: 'Abr', revenue: 58000, costs: 15000, expenses: 9200, profit: 33800 },
  { month: 'Mai', revenue: 68000, costs: 18000, expenses: 10000, profit: 40000 },
  { month: 'Jun', revenue: 75000, costs: 20000, expenses: 11000, profit: 44000 },
];

const CLIENT_PLANS = [
  { name: 'Profissional', count: 145, price: 79, color: '#7a32fc' },
  { name: 'Equipe', count: 82, price: 69, color: '#05CD99' },
  { name: 'ClÃ­nico', count: 34, price: 59, color: '#FFB547' },
  { name: 'Enterprise', count: 12, price: 450, color: '#7000FF' },
];

const RECENT_CLIENTS = [
  { id: 1, name: 'ClÃ­nica NeuroViver', email: 'contato@neuroviver.com.br', plan: 'Equipe', value: 828, status: 'active', date: '2026-03-20' },
  { id: 2, name: 'Dr. Marcos Silva', email: 'marcos.silva@gmail.com', plan: 'Profissional', value: 79, status: 'active', date: '2026-03-18' },
  { id: 3, name: 'EspaÃ§o Evoluir', email: 'financeiro@evoluir.com', plan: 'ClÃ­nico', value: 1475, status: 'delinquent', date: '2026-03-15' },
  { id: 4, name: 'Centro ABA CrianÃ§a', email: 'adm@abacrianca.com', plan: 'Enterprise', value: 2500, status: 'active', date: '2026-03-10' },
  { id: 5, name: 'Dra. Ana Paula', email: 'ana.paula@to.com.br', plan: 'Profissional', value: 79, status: 'active', date: '2026-03-05' },
];

export const AdminDashboard = ({ onLogout }: any) => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [searchTerm, setSearchTerm] = useState('');
  const [stats, setStats] = useState<any>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [dreData, setDreData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [twoFactorToken, setTwoFactorToken] = useState('');
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [complimentaryEmail, setComplimentaryEmail] = useState('');
  const [complimentaryPlan, setComplimentaryPlan] = useState<'Essencial' | 'Crescimento' | 'Avançado'>('Essencial');
  const [complimentaryNote, setComplimentaryNote] = useState('');
  const [grantingComplimentaryPlan, setGrantingComplimentaryPlan] = useState(false);

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const supabase = await getSupabase();
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const headers = {
          'Authorization': token ? `Bearer ${token}` : ''
        };

        const [statsRes, clientsRes, dreRes, profileRes] = await Promise.all([
          fetch('/api/admin/stats', { credentials: 'include', headers }),
          fetch('/api/admin/clients', { credentials: 'include', headers }),
          fetch('/api/admin/dre', { credentials: 'include', headers }),
          fetch('/api/auth/profile', { credentials: 'include', headers })
        ]);
        
        // Check if all responses are OK
        if (!statsRes.ok || !clientsRes.ok || !dreRes.ok) {
          throw new Error('Erro ao carregar dados administrativos. Verifique suas permissÃµes.');
        }

        const statsData = await statsRes.json();
        const clientsData = await clientsRes.json();
        const dreData = await dreRes.json();
        const profileData = await profileRes.json();
        
        if (statsData.success) setStats(statsData.stats);
        if (clientsData.success) setClients(clientsData.data);
        if (dreData.success) setDreData(dreData.data);
        if (profileData.success) setIs2FAEnabled(profileData.user.two_factor_enabled);
      } catch (err: any) {
        console.error('Error fetching admin data:', err);
        alert(err.message || 'Ocorreu um erro ao carregar o painel.');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

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
        setIs2FAEnabled(true);
        alert('2FA habilitado com sucesso!');
      } else {
        alert('CÃ³digo invÃ¡lido.');
      }
    } catch (err) {
      console.error('2FA verify error:', err);
    }
  };

  const handleRefund = async (userId: string, amount: number) => {
    if (!window.confirm(`Deseja realmente reembolsar R$ ${amount.toFixed(2)} para este cliente?`)) return;
    try {
      const res = await fetch('/api/admin/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, amount })
      });
      const data = await res.json();
      if (data.success) alert(data.message);
    } catch (err) {
      alert('Erro ao processar reembolso');
    }
  };

  const handleCharge = async (userId: string) => {
    try {
      const res = await fetch('/api/admin/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      const data = await res.json();
      if (data.success) alert(data.message);
    } catch (err) {
      alert('Erro ao processar cobranÃ§a');
    }
  };

  const handleGrantComplimentaryPlan = async () => {
    const email = complimentaryEmail.trim();
    if (!email) {
      alert('Informe o e-mail cadastrado antes de conceder o acesso.');
      return;
    }
    if (!window.confirm(`Conceder plano ${complimentaryPlan} sem cobranca para ${email}?`)) return;

    setGrantingComplimentaryPlan(true);
    try {
      const supabase = await getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const response = await fetch('/api/admin/grant-complimentary-plan', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          email,
          planName: complimentaryPlan,
          note: complimentaryNote
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Nao foi possivel conceder o acesso.');
      }

      setClients((current) => current.map((client) => (
        String(client.email || '').toLowerCase() === email.toLowerCase()
          ? {
              ...client,
              role: 'coordinator',
              subscription_status: 'active',
              plan_name: data.data?.planName || complimentaryPlan,
              plan_price: 0
            }
          : client
      )));
      setComplimentaryEmail('');
      setComplimentaryNote('');
      alert(`Acesso gratuito liberado no plano ${data.data?.planName || complimentaryPlan}.${data.data?.activationEmailSent ? ' E-mail de ativacao enviado.' : ''}`);
    } catch (err: any) {
      alert(err.message || 'Erro ao conceder acesso gratuito.');
    } finally {
      setGrantingComplimentaryPlan(false);
    }
  };

  const filteredClients = useMemo(() => {
    return clients.filter(c => 
      (c.name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) || 
      (c.email?.toLowerCase() || '').includes(searchTerm.toLowerCase())
    );
  }, [clients, searchTerm]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F7FE]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#7a32fc]"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F7FE] flex font-sans text-gray-900">
      {/* Sidebar */}
      <aside 
        onMouseEnter={() => setIsSidebarExpanded(true)}
        onMouseLeave={() => setIsSidebarExpanded(false)}
        className={`${isSidebarExpanded ? 'w-72' : 'w-24'} bg-white border-r border-gray-100 flex flex-col sticky top-0 h-screen transition-all duration-300 ease-in-out z-50`}
      >
        <div className={`p-8 flex items-center ${isSidebarExpanded ? 'gap-3' : 'justify-center'} transition-all duration-300`}>
          <LogoVerto size={40} />
          {isSidebarExpanded && <span className="text-2xl font-bold tracking-tighter text-[#7a32fc]">ADMIN</span>}
        </div>

        <nav className="flex-1 px-4 py-4 space-y-2">
          <SidebarItem 
            icon={<LayoutDashboard size={20} />} 
            label={isSidebarExpanded ? "Dashboard" : ""} 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')} 
            isExpanded={isSidebarExpanded}
          />
          <SidebarItem 
            icon={<Users size={20} />} 
            label={isSidebarExpanded ? "Clientes" : ""} 
            active={activeTab === 'clients'} 
            onClick={() => setActiveTab('clients')} 
            isExpanded={isSidebarExpanded}
          />
          <SidebarItem 
            icon={<BarChart3 size={20} />} 
            label={isSidebarExpanded ? "Financeiro (DRE)" : ""} 
            badge={isSidebarExpanded ? "EM BREVE" : ""}
            active={activeTab === 'financial'} 
            onClick={() => setActiveTab('financial')} 
            isExpanded={isSidebarExpanded}
          />
          <SidebarItem 
            icon={<CreditCard size={20} />} 
            label={isSidebarExpanded ? "Planos & PreÃ§os" : ""} 
            active={activeTab === 'plans'} 
            onClick={() => setActiveTab('plans')} 
            isExpanded={isSidebarExpanded}
          />
          <SidebarItem 
            icon={<Settings size={20} />} 
            label={isSidebarExpanded ? "ConfiguraÃ§Ãµes" : ""} 
            active={activeTab === 'settings'} 
            onClick={() => setActiveTab('settings')} 
            isExpanded={isSidebarExpanded}
          />
        </nav>

        <div className="p-6 border-t border-gray-50">
          <button 
            onClick={onLogout}
            className={`w-full flex items-center ${isSidebarExpanded ? 'gap-3 px-4' : 'justify-center'} py-3 text-gray-400 font-bold hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all`}
            title={!isSidebarExpanded ? "Sair" : ""}
          >
            <LogOut size={20} />
            {isSidebarExpanded && <span>Sair do Admin</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto">
        <header className="flex justify-between items-center mb-8">
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Painel Administrativo</p>
            <h1 className="text-3xl font-bold text-gray-800 tracking-tight">
              {activeTab === 'dashboard' ? 'VisÃ£o Geral' : 
               activeTab === 'clients' ? 'GestÃ£o de Clientes' : 
               activeTab === 'financial' ? 'Demonstrativo de Resultados (DRE)' : 
               'ConfiguraÃ§Ãµes'}
            </h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
              <input 
                type="text" 
                placeholder="Buscar cliente ou transaÃ§Ã£o..."
                className="bg-white border-none rounded-2xl py-3 pl-12 pr-6 text-sm font-bold shadow-sm w-64 focus:ring-2 focus:ring-[#7a32fc]/20 transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <button className="p-3 bg-white rounded-2xl shadow-sm text-gray-400 hover:text-[#7a32fc] transition-all">
              <Calendar size={20} />
            </button>
          </div>
        </header>

        {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-fade-in">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <KpiCard 
                title="MRR (Mensal)" 
                value={`R$ ${(stats?.mrr || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} 
                trend="+12.5%" 
                isPositive={true} 
                icon={<DollarSign size={24} />}
                color="bg-[#7a32fc]"
              />
              <KpiCard 
                title="Clientes Ativos" 
                value={stats?.activeUsers?.toString() || '0'} 
                trend="+8" 
                isPositive={true} 
                icon={<Users size={24} />}
                color="bg-[#05CD99]"
              />
              <KpiCard 
                title="Total de UsuÃ¡rios" 
                value={stats?.totalUsers?.toString() || '0'} 
                trend="+15" 
                isPositive={true} 
                icon={<TrendingUp size={24} />}
                color="bg-[#FFB547]"
              />
              <KpiCard 
                title="Inadimplentes" 
                value={stats?.delinquentUsers?.toString() || '0'} 
                trend="+2" 
                isPositive={false} 
                icon={<AlertCircle size={24} />}
                color="bg-[#EE5D50]"
              />
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white p-8 rounded-[32px] shadow-sm border border-gray-50">
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-xl font-bold text-gray-800 tracking-tight">EvoluÃ§Ã£o Financeira</h3>
                  <div className="flex gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-[#7a32fc]"></div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase">Receita</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-[#05CD99]"></div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase">Lucro</span>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto no-scrollbar -mx-8 px-8">
                  <div className="h-80 min-h-[300px] min-w-[600px]">
              <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
                      <AreaChart data={DRE_DATA_MOCK} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#7a32fc" stopOpacity={0.1}/>
                            <stop offset="95%" stopColor="#7a32fc" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#05CD99" stopOpacity={0.1}/>
                            <stop offset="95%" stopColor="#05CD99" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F4F7FE" />
                        <XAxis 
                          dataKey="month" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{fill: '#A3AED0', fontSize: 12, fontWeight: 'bold'}} 
                          dy={10}
                          padding={{ left: 30, right: 30 }}
                        />
                        <YAxis 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{fill: '#A3AED0', fontSize: 12, fontWeight: 'bold'}} 
                        />
                        <Tooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}
                        />
                        <Area type="monotone" dataKey="revenue" stroke="#7a32fc" strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
                        <Area type="monotone" dataKey="profit" stroke="#05CD99" strokeWidth={3} fillOpacity={1} fill="url(#colorProfit)" />
                      </AreaChart>
                    </SafeResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-50">
                <h3 className="text-xl font-bold text-gray-800 tracking-tight mb-8">Mix de Planos</h3>
                <div className="space-y-6">
                  {Object.entries(dreData?.byPlan || {}).map(([name, value]: [string, any], i) => (
                    <div key={i} className="space-y-2">
                      <div className="flex justify-between items-center">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-gray-700">{name}</span>
                          <span className="text-[9px] font-bold text-gray-400 uppercase">Receita: R$ {value.toLocaleString()}</span>
                        </div>
                        <span className="text-xs font-bold text-gray-400">{Math.round(value / (dreData?.revenue || 1) * 100)}%</span>
                      </div>
                      <div className="h-2 w-full bg-gray-50 rounded-full overflow-hidden">
                        <div 
                          className="h-full rounded-full transition-all duration-1000 bg-[#7a32fc]" 
                          style={{ width: `${(value / (dreData?.revenue || 1) * 100)}%` }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-10 p-6 bg-[#F4F7FE] rounded-3xl">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Insight de Vendas</p>
                  <p className="text-xs font-bold text-gray-600 leading-relaxed">
                    A maior parte da receita vem do plano <span className="text-[#7a32fc]">{Object.entries(dreData?.byPlan || {}).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || '...'}</span>.
                  </p>
                </div>
              </div>
            </div>

            {/* Recent Clients Table */}
            <div className="bg-white rounded-[32px] shadow-sm border border-gray-50 overflow-hidden">
              <div className="p-8 border-b border-gray-50 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-800 tracking-tight">Novos Clientes & Cadastro</h3>
                <button className="flex items-center gap-2 bg-[#7a32fc] text-white px-6 py-2.5 rounded-2xl font-bold text-sm shadow-lg shadow-purple-500/20 hover:opacity-90 transition-all">
                  <UserPlus size={18} />
                  Novo Cliente
                </button>
              </div>
              <div className="mx-8 mt-8 mb-2 rounded-[28px] border border-blue-100 bg-blue-50/40 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
                  <div className="flex-1">
                    <p className="text-[10px] font-bold text-[#7a32fc] uppercase tracking-widest mb-2">Acesso cortesia</p>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">E-mail cadastrado</label>
                    <input
                      type="email"
                      value={complimentaryEmail}
                      onChange={(event) => setComplimentaryEmail(event.target.value)}
                      placeholder="socia@clinica.com.br"
                      className="mt-2 w-full bg-white border border-blue-100 rounded-2xl py-3 px-4 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#7a32fc]/20"
                    />
                  </div>
                  <div className="w-full lg:w-56">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Plano liberado</label>
                    <select
                      value={complimentaryPlan}
                      onChange={(event) => setComplimentaryPlan(event.target.value as 'Essencial' | 'Crescimento' | 'Avançado')}
                      className="mt-2 w-full bg-white border border-blue-100 rounded-2xl py-3 px-4 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#7a32fc]/20"
                    >
                      <option value="Essencial">Essencial</option>
                      <option value="Crescimento">Crescimento</option>
                      <option value="Avançado">Avançado</option>
                    </select>
                  </div>
                  <div className="flex-[1.2]">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Observacao interna</label>
                    <input
                      type="text"
                      value={complimentaryNote}
                      onChange={(event) => setComplimentaryNote(event.target.value)}
                      placeholder="Ex.: socia fundadora, sem cobranca"
                      className="mt-2 w-full bg-white border border-blue-100 rounded-2xl py-3 px-4 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#7a32fc]/20"
                    />
                  </div>
                  <button
                    onClick={handleGrantComplimentaryPlan}
                    disabled={grantingComplimentaryPlan}
                    className="bg-[#05CD99] text-white px-6 py-3 rounded-2xl font-bold text-sm shadow-lg shadow-emerald-500/20 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {grantingComplimentaryPlan ? 'Liberando...' : 'Liberar sem cobrar'}
                  </button>
                </div>
                <p className="mt-3 text-xs font-semibold text-gray-500">
                  Use depois que a pessoa criou o cadastro e chegou na etapa de pagamento. O plano fica ativo com valor R$ 0,00 e registro de auditoria.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50/50">
                      <th className="px-8 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cliente</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Plano</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Valor Mensal</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Data AdesÃ£o</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Status</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">AÃ§Ãµes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredClients.map((client) => (
                      <tr key={client.id} className="hover:bg-gray-50/50 transition-colors group">
                        <td className="px-8 py-5">
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-gray-800">{client.name}</span>
                            <span className="text-xs font-bold text-gray-400">{client.email}</span>
                          </div>
                        </td>
                        <td className="px-8 py-5">
                          <span className="text-xs font-bold text-gray-600">{client.plan_name || 'Nenhum'}</span>
                        </td>
                        <td className="px-8 py-5">
                          <span className="text-sm font-bold text-gray-800">R$ {client.plan_price?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0,00'}</span>
                        </td>
                        <td className="px-8 py-5">
                          <span className="text-xs font-bold text-gray-400">{client.created_at ? new Date(client.created_at).toLocaleDateString('pt-BR') : 'N/A'}</span>
                        </td>
                        <td className="px-8 py-5">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${
                            client.subscription_status === 'active' ? 'bg-green-50 text-green-500' : 'bg-red-50 text-red-500'
                          }`}>
                            {client.subscription_status === 'active' ? 'Ativo' : 'Inadimplente'}
                          </span>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <div className="flex justify-end gap-2">
                            {client.subscription_status === 'delinquent' && (
                              <button 
                                onClick={() => handleCharge(client.id)}
                                className="p-2 text-[#EE5D50] hover:bg-red-50 rounded-xl transition-all"
                                title="Cobrar Inadimplente"
                              >
                                <CreditCard size={16} />
                              </button>
                            )}
                            <button 
                              onClick={() => handleRefund(client.id, client.plan_price || 0)}
                              className="p-2 text-gray-400 hover:text-[#7a32fc] hover:bg-blue-50 rounded-xl transition-all"
                              title="Reembolsar"
                            >
                              <ArrowDownRight size={16} />
                            </button>
                            <button className="p-2 text-gray-300 hover:text-[#7a32fc] transition-all">
                              <ChevronRight size={20} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-6 bg-gray-50/30 text-center">
                <button className="text-xs font-bold text-[#7a32fc] uppercase tracking-widest hover:underline">Ver todos os clientes</button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'financial' && (
          <div className="flex flex-col items-center justify-center py-20 bg-white rounded-[32px] shadow-sm border border-gray-50 animate-fade-in">
            <div className="w-20 h-20 bg-blue-50 text-[#7a32fc] rounded-3xl flex items-center justify-center mb-6">
              <DollarSign size={40} />
            </div>
            <h3 className="text-2xl font-bold text-gray-800 tracking-tight mb-2">DRE e GestÃ£o Financeira</h3>
            <p className="text-gray-500 font-medium mb-8">Esta funcionalidade estÃ¡ sendo preparada para vocÃª.</p>
            <span className="px-6 py-2 bg-[#7a32fc] text-white rounded-full text-xs font-bold uppercase tracking-widest shadow-lg shadow-purple-200">Em Breve</span>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-8 animate-fade-in">
            <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-50">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-blue-50 text-[#7a32fc] rounded-2xl flex items-center justify-center">
                  <Database size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-800 tracking-tight">Infraestrutura Firebase</h3>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Banco de Dados & AutenticaÃ§Ã£o</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div className="p-6 bg-gray-50 rounded-3xl border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">SeguranÃ§a Robusta (2FA)</p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${is2FAEnabled ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        <span className="text-sm font-bold text-gray-800">
                          {is2FAEnabled ? '2FA Ativado' : '2FA Desativado'}
                        </span>
                      </div>
                      {!is2FAEnabled && (
                        <button 
                          onClick={start2FASetup}
                          className="text-xs font-bold text-[#7a32fc] uppercase tracking-widest hover:underline"
                        >
                          Configurar Agora
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-4 leading-relaxed">
                      A autenticaÃ§Ã£o de dois fatores adiciona uma camada extra de seguranÃ§a Ã  sua conta de administrador.
                    </p>
                  </div>

                  {show2FASetup && (
                    <div className="p-6 bg-blue-50 rounded-3xl border border-blue-100 animate-fade-in">
                      <p className="text-[10px] font-bold text-[#7a32fc] uppercase tracking-widest mb-4">Configurar Google Authenticator</p>
                      <div className="flex flex-col items-center gap-4">
                        <SecureImage src={qrCodeUrl} alt="QR Code" className="w-32 h-32 bg-white p-2 rounded-xl" />
                        <div className="w-full space-y-2">
                          <input 
                            type="text" 
                            placeholder="CÃ³digo de 6 dÃ­gitos"
                            value={twoFactorToken}
                            onChange={(e) => setTwoFactorToken(e.target.value)}
                            className="w-full bg-white border border-blue-100 rounded-xl py-3 px-4 text-center font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                            maxLength={6}
                          />
                          <button 
                            onClick={verifyAndEnable2FA}
                            className="w-full bg-[#7a32fc] text-white py-3 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-purple-500/20"
                          >
                            Ativar ProteÃ§Ã£o
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="p-6 bg-gray-50 rounded-3xl border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Status da ConexÃ£o</p>
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse"></div>
                      <span className="text-sm font-bold text-gray-800">Firebase Conectado</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-4 leading-relaxed">
                      Sua plataforma estÃ¡ integrada ao Firebase (Firestore & Auth). Logs de atividade, dados clÃ­nicos e perfis de usuÃ¡rio estÃ£o sendo sincronizados em tempo real.
                    </p>
                  </div>

                  <div className="p-6 bg-white border border-gray-100 rounded-3xl">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Estrutura de ColeÃ§Ãµes</p>
                    <p className="text-xs text-gray-600 mb-4">
                      As seguintes coleÃ§Ãµes estÃ£o ativas no Firestore:
                    </p>
                    <ul className="space-y-2">
                      <li className="flex items-center gap-2 text-xs font-bold text-gray-700">
                        <CheckCircle2 size={14} className="text-green-500" /> users (Perfis e PapÃ©is)
                      </li>
                      <li className="flex items-center gap-2 text-xs font-bold text-gray-700">
                        <CheckCircle2 size={14} className="text-green-500" /> activity_logs
                      </li>
                      <li className="flex items-center gap-2 text-xs font-bold text-gray-700">
                        <CheckCircle2 size={14} className="text-green-500" /> patients
                      </li>
                      <li className="flex items-center gap-2 text-xs font-bold text-gray-700">
                        <CheckCircle2 size={14} className="text-green-500" /> notes
                      </li>
                      <li className="flex items-center gap-2 text-xs font-bold text-gray-700">
                        <CheckCircle2 size={14} className="text-green-500" /> history
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="p-6 bg-[#7a32fc]/5 rounded-3xl border border-[#7a32fc]/10">
                    <p className="text-[10px] font-bold text-[#7a32fc] uppercase tracking-widest mb-4">SeguranÃ§a (Rules)</p>
                    <p className="text-xs text-gray-600 mb-6 leading-relaxed">
                      As regras de seguranÃ§a do Firestore (Security Rules) estÃ£o configuradas para proteger os dados sensÃ­veis dos pacientes e garantir que cada usuÃ¡rio acesse apenas o que lhe Ã© permitido.
                    </p>
                    <button className="w-full bg-[#7a32fc] text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-purple-500/20 hover:opacity-90 transition-all flex items-center justify-center gap-2">
                      Ver Regras de SeguranÃ§a <ExternalLink size={16} />
                    </button>
                  </div>

                  <div className="p-6 bg-orange-50 rounded-3xl border border-orange-100">
                    <div className="flex items-center gap-2 text-orange-600 mb-2">
                      <AlertCircle size={16} />
                      <p className="text-[10px] font-bold uppercase tracking-widest">AtenÃ§Ã£o</p>
                    </div>
                    <p className="text-xs text-orange-800 font-medium leading-relaxed">
                      A migraÃ§Ã£o do Supabase para o Firebase estÃ¡ em fase final. Alguns dados legados ainda podem estar sendo sincronizados em ambos os bancos.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

const SidebarItem = ({ icon, label, active, onClick, badge, isExpanded }: any) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center ${isExpanded ? 'gap-3 px-4' : 'justify-center px-4'} py-3 rounded-2xl font-bold transition-all ${
      active 
        ? 'bg-[#7a32fc] text-white shadow-lg shadow-purple-500/20' 
        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
    }`}
    title={!isExpanded ? label : ""}
  >
    {icon}
    {isExpanded && <span className="text-sm">{label}</span>}
    {isExpanded && badge && <span className="ml-auto text-[8px] bg-purple-100 text-[#7a32fc] px-1.5 py-0.5 rounded-full">{badge}</span>}
    {isExpanded && active && !badge && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white"></div>}
  </button>
);

const KpiCard = ({ title, value, trend, isPositive, icon, color }: any) => (
  <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-50 flex items-center gap-4 group hover:shadow-md transition-all">
    <div className={`w-14 h-14 ${color} rounded-2xl flex items-center justify-center text-white shadow-lg shadow-gray-100 group-hover:scale-110 transition-transform`}>
      {icon}
    </div>
    <div>
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{title}</p>
      <div className="flex items-baseline gap-2">
        <h4 className="text-2xl font-bold text-gray-800">{value}</h4>
        <span className={`text-[10px] font-bold ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
          {trend}
        </span>
      </div>
    </div>
  </div>
);

const DreRow = ({ label, data, isHeader, isSubtotal, isTotal }: any) => (
  <tr className={`${isHeader ? 'bg-gray-50/50' : ''} ${isTotal ? 'bg-[#7a32fc]/5' : ''}`}>
    <td className={`py-4 px-4 ${isHeader || isTotal ? 'font-bold text-gray-800' : isSubtotal ? 'font-bold text-gray-700 italic' : 'text-gray-500'}`}>
      {label}
    </td>
    {data.map((val: number, i: number) => (
      <td key={i} className={`py-4 px-4 text-center font-bold ${
        val < 0 ? 'text-red-500' : isTotal ? 'text-[#7a32fc] text-base' : 'text-gray-700'
      }`}>
        {val < 0 ? `(R$ ${Math.abs(val).toLocaleString()})` : `R$ ${val.toLocaleString()}`}
      </td>
    ))}
  </tr>
);





