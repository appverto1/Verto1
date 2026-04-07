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
  ResponsiveContainer, 
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area
} from 'recharts';
import { LogoVerto } from './Common';

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
  { name: 'Profissional', count: 145, price: 79, color: '#4318FF' },
  { name: 'Equipe', count: 82, price: 69, color: '#05CD99' },
  { name: 'Clínico', count: 34, price: 59, color: '#FFB547' },
  { name: 'Enterprise', count: 12, price: 450, color: '#7000FF' },
];

const RECENT_CLIENTS = [
  { id: 1, name: 'Clínica NeuroViver', email: 'contato@neuroviver.com.br', plan: 'Equipe', value: 828, status: 'active', date: '2026-03-20' },
  { id: 2, name: 'Dr. Marcos Silva', email: 'marcos.silva@gmail.com', plan: 'Profissional', value: 79, status: 'active', date: '2026-03-18' },
  { id: 3, name: 'Espaço Evoluir', email: 'financeiro@evoluir.com', plan: 'Clínico', value: 1475, status: 'delinquent', date: '2026-03-15' },
  { id: 4, name: 'Centro ABA Kids', email: 'adm@abakids.com', plan: 'Enterprise', value: 2500, status: 'active', date: '2026-03-10' },
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

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsRes, clientsRes, dreRes, profileRes] = await Promise.all([
          fetch('/api/admin/stats', { credentials: 'include' }),
          fetch('/api/admin/clients', { credentials: 'include' }),
          fetch('/api/admin/dre', { credentials: 'include' }),
          fetch('/api/auth/profile', { credentials: 'include' })
        ]);
        
        // Check if all responses are OK
        if (!statsRes.ok || !clientsRes.ok || !dreRes.ok) {
          throw new Error('Erro ao carregar dados administrativos. Verifique suas permissões.');
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
      const response = await fetch('/api/auth/2fa/setup', { method: 'POST', credentials: 'include' });
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
      const response = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: twoFactorToken })
      });
      const data = await response.json();
      if (data.success) {
        setShow2FASetup(false);
        setIs2FAEnabled(true);
        alert('2FA habilitado com sucesso!');
      } else {
        alert('Código inválido.');
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
      alert('Erro ao processar cobrança');
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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#4318FF]"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F7FE] flex font-sans text-gray-900">
      {/* Sidebar */}
      <aside className="w-72 bg-white border-r border-gray-100 flex flex-col sticky top-0 h-screen">
        <div className="p-8 flex items-center gap-3">
          <LogoVerto size={40} />
          <span className="text-2xl font-bold tracking-tighter text-[#4318FF]">ADMIN</span>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-2">
          <SidebarItem 
            icon={<LayoutDashboard size={20} />} 
            label="Dashboard" 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')} 
          />
          <SidebarItem 
            icon={<Users size={20} />} 
            label="Clientes" 
            active={activeTab === 'clients'} 
            onClick={() => setActiveTab('clients')} 
          />
          <SidebarItem 
            icon={<BarChart3 size={20} />} 
            label="Financeiro (DRE)" 
            active={activeTab === 'financial'} 
            onClick={() => setActiveTab('financial')} 
          />
          <SidebarItem 
            icon={<CreditCard size={20} />} 
            label="Planos & Preços" 
            active={activeTab === 'plans'} 
            onClick={() => setActiveTab('plans')} 
          />
          <SidebarItem 
            icon={<Settings size={20} />} 
            label="Configurações" 
            active={activeTab === 'settings'} 
            onClick={() => setActiveTab('settings')} 
          />
        </nav>

        <div className="p-6 border-t border-gray-50">
          <button 
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-4 py-3 text-gray-400 font-bold hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all"
          >
            <LogOut size={20} />
            Sair do Admin
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto">
        <header className="flex justify-between items-center mb-8">
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Painel Administrativo</p>
            <h1 className="text-3xl font-bold text-gray-800 tracking-tight">
              {activeTab === 'dashboard' ? 'Visão Geral' : 
               activeTab === 'clients' ? 'Gestão de Clientes' : 
               activeTab === 'financial' ? 'Demonstrativo de Resultados (DRE)' : 
               'Configurações'}
            </h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
              <input 
                type="text" 
                placeholder="Buscar cliente ou transação..."
                className="bg-white border-none rounded-2xl py-3 pl-12 pr-6 text-sm font-bold shadow-sm w-64 focus:ring-2 focus:ring-[#4318FF]/20 transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <button className="p-3 bg-white rounded-2xl shadow-sm text-gray-400 hover:text-[#4318FF] transition-all">
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
                color="bg-[#4318FF]"
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
                title="Total de Usuários" 
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
                  <h3 className="text-xl font-bold text-gray-800 tracking-tight">Evolução Financeira</h3>
                  <div className="flex gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-[#4318FF]"></div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase">Receita</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-[#05CD99]"></div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase">Lucro</span>
                    </div>
                  </div>
                </div>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={DRE_DATA_MOCK}>
                      <defs>
                        <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#4318FF" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#4318FF" stopOpacity={0}/>
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
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{fill: '#A3AED0', fontSize: 12, fontWeight: 'bold'}} 
                      />
                      <Tooltip 
                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}
                      />
                      <Area type="monotone" dataKey="revenue" stroke="#4318FF" strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
                      <Area type="monotone" dataKey="profit" stroke="#05CD99" strokeWidth={3} fillOpacity={1} fill="url(#colorProfit)" />
                    </AreaChart>
                  </ResponsiveContainer>
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
                          className="h-full rounded-full transition-all duration-1000 bg-[#4318FF]" 
                          style={{ width: `${(value / (dreData?.revenue || 1) * 100)}%` }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-10 p-6 bg-[#F4F7FE] rounded-3xl">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Insight de Vendas</p>
                  <p className="text-xs font-bold text-gray-600 leading-relaxed">
                    A maior parte da receita vem do plano <span className="text-[#4318FF]">{Object.entries(dreData?.byPlan || {}).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || '...'}</span>.
                  </p>
                </div>
              </div>
            </div>

            {/* Recent Clients Table */}
            <div className="bg-white rounded-[32px] shadow-sm border border-gray-50 overflow-hidden">
              <div className="p-8 border-b border-gray-50 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-800 tracking-tight">Novos Clientes & Cadastro</h3>
                <button className="flex items-center gap-2 bg-[#4318FF] text-white px-6 py-2.5 rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 hover:opacity-90 transition-all">
                  <UserPlus size={18} />
                  Novo Cliente
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50/50">
                      <th className="px-8 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cliente</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Plano</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Valor Mensal</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Data Adesão</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Status</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Ações</th>
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
                              className="p-2 text-gray-400 hover:text-[#4318FF] hover:bg-blue-50 rounded-xl transition-all"
                              title="Reembolsar"
                            >
                              <ArrowDownRight size={16} />
                            </button>
                            <button className="p-2 text-gray-300 hover:text-[#4318FF] transition-all">
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
                <button className="text-xs font-bold text-[#4318FF] uppercase tracking-widest hover:underline">Ver todos os clientes</button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'financial' && (
          <div className="space-y-8 animate-fade-in">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-50">
                <h3 className="text-xl font-bold text-gray-800 tracking-tight mb-8">Receita por Canal de Aquisição</h3>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={Object.entries(dreData?.byChannel || {}).map(([name, value]) => ({ name, value: Number(value) }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F4F7FE" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#A3AED0', fontSize: 12, fontWeight: 'bold'}} />
                      <YAxis axisLine={false} tickLine={false} tick={{fill: '#A3AED0', fontSize: 12, fontWeight: 'bold'}} />
                      <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }} />
                      <Bar dataKey="value" fill="#4318FF" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-50">
                <h3 className="text-xl font-bold text-gray-800 tracking-tight mb-8">Receita por Plano</h3>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={Object.entries(dreData?.byPlan || {}).map(([name, value]) => ({ name, value: Number(value) }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F4F7FE" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#A3AED0', fontSize: 12, fontWeight: 'bold'}} />
                      <YAxis axisLine={false} tickLine={false} tick={{fill: '#A3AED0', fontSize: 12, fontWeight: 'bold'}} />
                      <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }} />
                      <Bar dataKey="value" fill="#05CD99" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-50">
              <h3 className="text-xl font-bold text-gray-800 tracking-tight mb-8">Demonstrativo de Resultados (DRE)</h3>
              <div className="space-y-4">
                <div className="flex justify-between p-4 bg-gray-50 rounded-2xl">
                  <span className="font-bold text-gray-600">Receita Bruta</span>
                  <span className="font-bold text-[#4318FF]">R$ {dreData?.revenue?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between p-4 border-b border-gray-50">
                  <span className="text-gray-500">Impostos (Simulado 6%)</span>
                  <span className="text-red-500">- R$ {(dreData?.revenue * 0.06).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between p-4 border-b border-gray-50">
                  <span className="text-gray-500">Taxas Stripe (Simulado 3.99% + R$0,39)</span>
                  <span className="text-red-500">- R$ {(dreData?.revenue * 0.0399).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between p-4 bg-blue-50 rounded-2xl">
                  <span className="font-bold text-gray-800">Receita Líquida</span>
                  <span className="font-bold text-[#05CD99]">R$ {(dreData?.revenue * 0.9).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-8 animate-fade-in">
            <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-50">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-blue-50 text-[#4318FF] rounded-2xl flex items-center justify-center">
                  <Database size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-800 tracking-tight">Infraestrutura Firebase</h3>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Banco de Dados & Autenticação</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div className="p-6 bg-gray-50 rounded-3xl border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Segurança Robusta (2FA)</p>
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
                          className="text-xs font-bold text-[#4318FF] uppercase tracking-widest hover:underline"
                        >
                          Configurar Agora
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-4 leading-relaxed">
                      A autenticação de dois fatores adiciona uma camada extra de segurança à sua conta de administrador.
                    </p>
                  </div>

                  {show2FASetup && (
                    <div className="p-6 bg-blue-50 rounded-3xl border border-blue-100 animate-fade-in">
                      <p className="text-[10px] font-bold text-[#4318FF] uppercase tracking-widest mb-4">Configurar Google Authenticator</p>
                      <div className="flex flex-col items-center gap-4">
                        <img src={qrCodeUrl} alt="QR Code" className="w-32 h-32 bg-white p-2 rounded-xl" />
                        <div className="w-full space-y-2">
                          <input 
                            type="text" 
                            placeholder="Código de 6 dígitos"
                            value={twoFactorToken}
                            onChange={(e) => setTwoFactorToken(e.target.value)}
                            className="w-full bg-white border border-blue-100 rounded-xl py-3 px-4 text-center font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                            maxLength={6}
                          />
                          <button 
                            onClick={verifyAndEnable2FA}
                            className="w-full bg-[#4318FF] text-white py-3 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-blue-500/20"
                          >
                            Ativar Proteção
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="p-6 bg-gray-50 rounded-3xl border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Status da Conexão</p>
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse"></div>
                      <span className="text-sm font-bold text-gray-800">Firebase Conectado</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-4 leading-relaxed">
                      Sua plataforma está integrada ao Firebase (Firestore & Auth). Logs de atividade, dados clínicos e perfis de usuário estão sendo sincronizados em tempo real.
                    </p>
                  </div>

                  <div className="p-6 bg-white border border-gray-100 rounded-3xl">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Estrutura de Coleções</p>
                    <p className="text-xs text-gray-600 mb-4">
                      As seguintes coleções estão ativas no Firestore:
                    </p>
                    <ul className="space-y-2">
                      <li className="flex items-center gap-2 text-xs font-bold text-gray-700">
                        <CheckCircle2 size={14} className="text-green-500" /> users (Perfis e Papéis)
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
                  <div className="p-6 bg-[#4318FF]/5 rounded-3xl border border-[#4318FF]/10">
                    <p className="text-[10px] font-bold text-[#4318FF] uppercase tracking-widest mb-4">Segurança (Rules)</p>
                    <p className="text-xs text-gray-600 mb-6 leading-relaxed">
                      As regras de segurança do Firestore (Security Rules) estão configuradas para proteger os dados sensíveis dos pacientes e garantir que cada usuário acesse apenas o que lhe é permitido.
                    </p>
                    <button className="w-full bg-[#4318FF] text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 hover:opacity-90 transition-all flex items-center justify-center gap-2">
                      Ver Regras de Segurança <ExternalLink size={16} />
                    </button>
                  </div>

                  <div className="p-6 bg-orange-50 rounded-3xl border border-orange-100">
                    <div className="flex items-center gap-2 text-orange-600 mb-2">
                      <AlertCircle size={16} />
                      <p className="text-[10px] font-bold uppercase tracking-widest">Atenção</p>
                    </div>
                    <p className="text-xs text-orange-800 font-medium leading-relaxed">
                      A migração do Supabase para o Firebase está em fase final. Alguns dados legados ainda podem estar sendo sincronizados em ambos os bancos.
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

const SidebarItem = ({ icon, label, active, onClick }: any) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-bold transition-all ${
      active 
        ? 'bg-[#4318FF] text-white shadow-lg shadow-blue-500/20' 
        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
    }`}
  >
    {icon}
    <span className="text-sm">{label}</span>
    {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white"></div>}
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
  <tr className={`${isHeader ? 'bg-gray-50/50' : ''} ${isTotal ? 'bg-[#4318FF]/5' : ''}`}>
    <td className={`py-4 px-4 ${isHeader || isTotal ? 'font-bold text-gray-800' : isSubtotal ? 'font-bold text-gray-700 italic' : 'text-gray-500'}`}>
      {label}
    </td>
    {data.map((val: number, i: number) => (
      <td key={i} className={`py-4 px-4 text-center font-bold ${
        val < 0 ? 'text-red-500' : isTotal ? 'text-[#4318FF] text-base' : 'text-gray-700'
      }`}>
        {val < 0 ? `(R$ ${Math.abs(val).toLocaleString()})` : `R$ ${val.toLocaleString()}`}
      </td>
    ))}
  </tr>
);
