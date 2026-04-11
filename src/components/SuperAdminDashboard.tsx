import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  DollarSign,
  LayoutDashboard,
  LogOut,
  Shield,
  TrendingUp,
  Users
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { LogoVerto } from './Common';
import { getSupabase } from '../lib/supabase';

const COLORS = ['#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#6366F1', '#EC4899'];

const formatCurrency = (value: number) =>
  `R$ ${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatPercent = (value: number) => `${Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

export const SuperAdminDashboard = ({ onLogout }: any) => {
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'financial' | 'customers'>('overview');
  const [stats, setStats] = useState<any>(null);
  const [financial, setFinancial] = useState<any>({
    summary: {},
    monthly: [],
    byPlan: [],
    topCustomers: [],
    delinquentCustomers: [],
    source: 'fallback'
  });
  const [allCustomers, setAllCustomers] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const supabase = await getSupabase();
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const headers = { Authorization: token ? `Bearer ${token}` : '' };

        const [statsRes, financialRes, customersRes] = await Promise.all([
          fetch('/api/owner/stats', { credentials: 'include', headers }),
          fetch('/api/owner/financial-overview', { credentials: 'include', headers }),
          fetch('/api/owner/clients', { credentials: 'include', headers })
        ]);

        const statsData = await statsRes.json();
        const financialData = await financialRes.json();
        const customersData = await customersRes.json();

        if (!statsRes.ok || !financialRes.ok || !customersRes.ok) {
          throw new Error('Erro ao carregar dados do super admin.');
        }

        if (statsData.success) setStats(statsData.stats);
        if (financialData.success) setFinancial(financialData.data);
        if (customersData.success) setAllCustomers(customersData.data || []);
      } catch (error: any) {
        console.error('Owner dashboard error:', error);
        alert(error.message || 'Nao foi possivel carregar o painel.');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const refreshAll = async () => {
    const supabase = await getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const headers = { Authorization: token ? `Bearer ${token}` : '' };

    const [statsRes, financialRes, customersRes] = await Promise.all([
      fetch('/api/owner/stats', { credentials: 'include', headers }),
      fetch('/api/owner/financial-overview', { credentials: 'include', headers }),
      fetch('/api/owner/clients', { credentials: 'include', headers })
    ]);

    const statsData = await statsRes.json();
    const financialData = await financialRes.json();
    const customersData = await customersRes.json();
    if (statsData.success) setStats(statsData.stats);
    if (financialData.success) setFinancial(financialData.data);
    if (customersData.success) setAllCustomers(customersData.data || []);
  };

  const handleBootstrapFinance = async () => {
    try {
      setBootstrapping(true);
      const supabase = await getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch('/api/owner/bootstrap-finance', {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: token ? `Bearer ${token}` : '' }
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Erro ao criar base inicial.');
      }
      await refreshAll();
      alert('Base financeira inicial criada com sucesso. O painel ja foi atualizado.');
    } catch (error: any) {
      alert(error.message || 'Nao foi possivel criar os dados iniciais.');
    } finally {
      setBootstrapping(false);
    }
  };

  const filteredCustomers = useMemo(() => {
    return allCustomers.filter((customer) => {
      const name = (customer.name || '').toLowerCase();
      const email = (customer.email || '').toLowerCase();
      const search = searchTerm.toLowerCase();
      return name.includes(search) || email.includes(search);
    });
  }, [allCustomers, searchTerm]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#EEF6FF] flex items-center justify-center">
        <div className="h-12 w-12 rounded-full border-b-2 border-[#0EA5E9] animate-spin" />
      </div>
    );
  }

  const monthlyData = financial.monthly || [];
  const summary = financial.summary || {};
  const byPlanData = financial.byPlan || [];
  const topCustomers = financial.topCustomers || [];
  const delinquentCustomers = financial.delinquentCustomers || [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F5FBFF] via-[#F8FAFC] to-[#FFF6ED] text-slate-900 flex">
      <aside className="w-72 bg-white/80 backdrop-blur border-r border-slate-100 h-screen sticky top-0 flex flex-col">
        <div className="p-8 flex items-center gap-3">
          <LogoVerto size={42} />
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-bold">Painel</p>
            <h2 className="text-xl font-black text-slate-900">SUPER ADMIN</h2>
          </div>
        </div>

        <nav className="px-4 space-y-2">
          <SidebarItem icon={<LayoutDashboard size={18} />} label="Resumo" active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} />
          <SidebarItem icon={<BarChart3 size={18} />} label="DRE e EBITDA" active={activeTab === 'financial'} onClick={() => setActiveTab('financial')} />
          <SidebarItem icon={<Users size={18} />} label="Clientes e Lucro" active={activeTab === 'customers'} onClick={() => setActiveTab('customers')} />
        </nav>

        <div className="mt-auto p-6 border-t border-slate-100">
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 font-bold text-slate-500 hover:bg-red-50 hover:text-red-500 transition-all"
          >
            <LogOut size={18} /> Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 p-8 overflow-y-auto">
        <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400 font-bold">Governanca Financeira</p>
            <h1 className="text-3xl font-black text-slate-900">
              {activeTab === 'overview' ? 'Visao Geral da Rentabilidade' : activeTab === 'financial' ? 'DRE Completo' : 'Clientes e Performance'}
            </h1>
          </div>
          <div className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold">
            Fonte: {financial.source === 'supabase_financial_views' ? 'SQL financeiro ativo' : 'fallback automatico'}
          </div>
        </div>

        {financial.source !== 'supabase_financial_views' && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-bold text-amber-800">
              Sua base financeira ainda esta vazia. Clique para criar dados iniciais automaticamente.
            </p>
            <button
              onClick={handleBootstrapFinance}
              disabled={bootstrapping}
              className="px-4 py-2 rounded-xl bg-amber-500 text-white text-xs font-black uppercase tracking-[0.12em] disabled:opacity-70"
            >
              {bootstrapping ? 'Criando base...' : 'Criar base inicial'}
            </button>
          </div>
        )}

        {activeTab === 'overview' && (
          <div className="space-y-7">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-5">
              <MetricCard title="Receita Liquida" value={formatCurrency(summary.revenueNet)} icon={<DollarSign size={20} />} color="bg-sky-500" />
              <MetricCard title="Margem Contribuicao" value={formatPercent(summary.contributionMarginPct)} icon={<TrendingUp size={20} />} color="bg-emerald-500" />
              <MetricCard title="EBITDA" value={formatCurrency(summary.ebitda)} icon={<BarChart3 size={20} />} color="bg-indigo-500" />
              <MetricCard title="Inadimplencia" value={formatCurrency(summary.delinquencyAmount)} icon={<AlertCircle size={20} />} color="bg-rose-500" />
              <MetricCard title="Clientes Ativos" value={`${stats?.activeUsers || 0}`} icon={<Users size={20} />} color="bg-amber-500" />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="xl:col-span-2 bg-white rounded-[28px] p-6 border border-slate-100 shadow-sm">
                <h3 className="text-lg font-black mb-4">Evolucao de Receita e EBITDA</h3>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monthlyData}>
                      <defs>
                        <linearGradient id="ownerRevenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0EA5E9" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#0EA5E9" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="ownerEbitda" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10B981" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                      <XAxis dataKey="monthLabel" tick={{ fill: '#64748B', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#64748B', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(value: any) => formatCurrency(Number(value))} />
                      <Area type="monotone" dataKey="revenueNet" stroke="#0EA5E9" strokeWidth={3} fill="url(#ownerRevenue)" />
                      <Area type="monotone" dataKey="ebitda" stroke="#10B981" strokeWidth={3} fill="url(#ownerEbitda)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white rounded-[28px] p-6 border border-slate-100 shadow-sm">
                <h3 className="text-lg font-black mb-4">Faturamento por Plano</h3>
                <div className="space-y-4">
                  {byPlanData.map((plan: any, index: number) => {
                    const maxRevenue = byPlanData[0]?.revenueNet || 1;
                    const width = (Number(plan.revenueNet || 0) / maxRevenue) * 100;
                    return (
                      <div key={`${plan.planName}-${index}`} className="space-y-1">
                        <div className="flex justify-between text-xs font-bold">
                          <span>{plan.planName}</span>
                          <span>{formatCurrency(plan.revenueNet)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(width, 3)}%`, backgroundColor: COLORS[index % COLORS.length] }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'financial' && (
          <div className="space-y-7">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-[28px] p-6 border border-slate-100 shadow-sm">
                <h3 className="text-lg font-black mb-4">Composicao do DRE Mensal</h3>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                      <XAxis dataKey="monthLabel" tick={{ fill: '#64748B', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#64748B', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(value: any) => formatCurrency(Number(value))} />
                      <Bar dataKey="revenueNet" fill="#0EA5E9" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="variableCosts" fill="#F59E0B" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="fixedCosts" fill="#6366F1" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white rounded-[28px] p-6 border border-slate-100 shadow-sm">
                <h3 className="text-lg font-black mb-4">Inadimplencia por Mes</h3>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                      <XAxis dataKey="monthLabel" tick={{ fill: '#64748B', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#64748B', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(value: any) => formatCurrency(Number(value))} />
                      <Bar dataKey="delinquencyAmount" radius={[8, 8, 0, 0]}>
                        {monthlyData.map((_: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-[28px] p-6 border border-slate-100 shadow-sm">
              <h3 className="text-lg font-black mb-4">Top Clientes com Maior Prejuizo</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs uppercase tracking-[0.15em] text-slate-400">
                      <th className="py-3">Cliente</th>
                      <th className="py-3">Receita</th>
                      <th className="py-3">Custo</th>
                      <th className="py-3">Lucro</th>
                      <th className="py-3">Margem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCustomers.slice(0, 10).map((customer: any) => (
                      <tr key={customer.customerId} className="border-t border-slate-100">
                        <td className="py-3">
                          <div className="font-bold text-sm">{customer.name || customer.email || 'Sem nome'}</div>
                          <div className="text-xs text-slate-500">{customer.email}</div>
                        </td>
                        <td className="py-3 text-sm">{formatCurrency(customer.revenueNet)}</td>
                        <td className="py-3 text-sm">{formatCurrency(customer.totalCost)}</td>
                        <td className={`py-3 text-sm font-black ${Number(customer.profit) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {formatCurrency(customer.profit)}
                        </td>
                        <td className="py-3 text-sm">{formatPercent(customer.marginPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'customers' && (
          <div className="space-y-6">
            <div className="bg-white rounded-[24px] border border-slate-100 p-5 flex flex-wrap gap-4 items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield size={17} className="text-slate-500" />
                <span className="text-sm font-bold text-slate-600">Leitura segura para super admin</span>
              </div>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar cliente por nome ou email"
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-sky-300 w-full sm:w-80"
              />
            </div>

            <div className="bg-white rounded-[28px] p-6 border border-slate-100 shadow-sm">
              <h3 className="text-lg font-black mb-4">Clientes Inadimplentes</h3>
              <div className="space-y-2">
                {delinquentCustomers.length === 0 && <p className="text-sm text-slate-500">Sem inadimplentes no periodo.</p>}
                {delinquentCustomers.map((customer: any) => (
                  <div key={customer.customerId} className="flex items-center justify-between rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
                    <div>
                      <p className="font-bold text-sm">{customer.name || customer.email || 'Sem nome'}</p>
                      <p className="text-xs text-slate-500">{customer.email}</p>
                    </div>
                    <p className="font-black text-rose-600">{formatCurrency(customer.delinquencyAmount)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-[28px] p-6 border border-slate-100 shadow-sm overflow-x-auto">
              <h3 className="text-lg font-black mb-4">Base de Clientes</h3>
              <table className="w-full text-left">
                <thead>
                  <tr className="text-xs uppercase tracking-[0.15em] text-slate-400">
                    <th className="py-3">Nome</th>
                    <th className="py-3">Plano</th>
                    <th className="py-3">Valor</th>
                    <th className="py-3">Status</th>
                    <th className="py-3">Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map((customer) => (
                    <tr key={customer.id} className="border-t border-slate-100">
                      <td className="py-3">
                        <div className="font-bold text-sm">{customer.name || 'Sem nome'}</div>
                        <div className="text-xs text-slate-500">{customer.email}</div>
                      </td>
                      <td className="py-3 text-sm font-semibold">{customer.plan_name || 'Nao definido'}</td>
                      <td className="py-3 text-sm font-semibold">{formatCurrency(customer.plan_price)}</td>
                      <td className="py-3">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.12em] ${
                            customer.subscription_status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                          }`}
                        >
                          {customer.subscription_status === 'active' ? 'ativo' : 'inadimplente'}
                        </span>
                      </td>
                      <td className="py-3 text-sm text-slate-500">
                        {customer.created_at ? new Date(customer.created_at).toLocaleDateString('pt-BR') : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

const MetricCard = ({ title, value, icon, color }: any) => (
  <div className="bg-white rounded-[24px] p-5 border border-slate-100 shadow-sm flex items-center gap-4">
    <div className={`w-11 h-11 rounded-xl text-white flex items-center justify-center ${color}`}>
      {icon}
    </div>
    <div>
      <p className="text-[10px] uppercase tracking-[0.15em] text-slate-400 font-bold">{title}</p>
      <h4 className="text-xl font-black">{value}</h4>
    </div>
  </div>
);

const SidebarItem = ({ icon, label, active, onClick }: any) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 rounded-2xl px-4 py-3 font-bold transition-all ${
      active ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'
    }`}
  >
    {icon} <span className="text-sm">{label}</span>
  </button>
);
