import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  ClipboardCheck,
  CheckCircle2,
  DollarSign,
  FileText,
  LayoutDashboard,
  Loader2,
  LogOut,
  MessageCircle,
  Phone,
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
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';
import { LogoVerto } from './Common';
import { getSupabase } from '../lib/supabase';
import { AFLS_ADULT_SOCIAL_PARTICIPATION_PROTOCOL } from '../constants/aflsProtocol';
import { VBMAPP_LEVEL_1_CANONICAL_PROTOCOL } from '../constants/vbmappLevel1Protocol';

const COLORS = ['#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#6366F1', '#EC4899'];

const formatCurrency = (value: number) =>
  `R$ ${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatPercent = (value: number) => `${Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

const formatProtocolRequestDateTime = (value: any) => {
  if (!value) return 'data nao informada';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'data nao informada';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const getProtocolRequestPreviewImage = (request: any) => {
  const screenshotEvidence = request?.scanReport?.evidence?.mode === 'screenshots'
    ? (request.scanReport?.evidence?.screenshots || [])
    : [];
  return screenshotEvidence.find((shot: any) => typeof shot?.dataUrl === 'string' && shot.dataUrl.startsWith('data:image/'))
    || (typeof request?.fileDataUrl === 'string' && request.fileDataUrl.startsWith('data:image/')
      ? {
          pageNumber: request?.scanReport?.evidence?.screenshots?.[0]?.pageNumber || null,
          dataUrl: request.fileDataUrl
        }
      : null);
};

const isAflsRequest = (request: any) => (
  `${request?.canonicalKey || ''} ${request?.canonicalName || ''} ${request?.protocolName || ''}`
    .toLowerCase()
    .includes('afls')
);

const VERTO_PROTOCOL_OPTIONS = [
  {
    key: 'afls-social-participation-adult',
    name: 'AFLS - Habilidades de Participação Social',
    hint: 'Adultos',
    completionPercent: 100,
    statusLabel: 'Completo'
  },
  {
    key: 'vb-mapp-level-1',
    name: 'VB-MAPP - Nivel 1',
    hint: '0 a 18 meses',
    completionPercent: 100,
    statusLabel: 'Completo'
  }
];

const VERTO_PROTOCOL_EDITOR_CATALOG = [
  { ...VERTO_PROTOCOL_OPTIONS[0], protocol: AFLS_ADULT_SOCIAL_PARTICIPATION_PROTOCOL },
  { ...VERTO_PROTOCOL_OPTIONS[1], protocol: VBMAPP_LEVEL_1_CANONICAL_PROTOCOL }
];

export const SuperAdminDashboard = ({ onLogout }: any) => {
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'financial' | 'customers' | 'leads' | 'protocols'>('overview');
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
  const [leadRecoveryItems, setLeadRecoveryItems] = useState<any[]>([]);
  const [protocolRequests, setProtocolRequests] = useState<any[]>([]);
  const [protocolRequestsError, setProtocolRequestsError] = useState<string | null>(null);
  const [approvingProtocolId, setApprovingProtocolId] = useState<string | null>(null);
  const [scanningProtocolId, setScanningProtocolId] = useState<string | null>(null);
  const [rejectingProtocolId, setRejectingProtocolId] = useState<string | null>(null);
  const [savingProtocolAccess, setSavingProtocolAccess] = useState<string | null>(null);
  const [selectedCatalogProtocolKey, setSelectedCatalogProtocolKey] = useState('afls-social-participation-adult');
  const [protocolEditorSearch, setProtocolEditorSearch] = useState('');
  const [selectedCatalogDomainId, setSelectedCatalogDomainId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [financialFeatureSurveys, setFinancialFeatureSurveys] = useState<any[]>([]);
  const [dashboardWarning, setDashboardWarning] = useState<string | null>(null);
  const [complimentaryEmail, setComplimentaryEmail] = useState('');
  const [complimentaryPlan, setComplimentaryPlan] = useState<'Essencial' | 'Crescimento' | 'Avançado'>('Essencial');
  const [complimentaryNote, setComplimentaryNote] = useState('');
  const [grantingComplimentaryPlan, setGrantingComplimentaryPlan] = useState(false);

  const selectedCatalogEntry = useMemo(
    () => VERTO_PROTOCOL_EDITOR_CATALOG.find((entry) => entry.key === selectedCatalogProtocolKey) || VERTO_PROTOCOL_EDITOR_CATALOG[0],
    [selectedCatalogProtocolKey]
  );
  const selectedCatalogProtocol: any = selectedCatalogEntry?.protocol || null;
  const selectedCatalogDomains = Array.isArray(selectedCatalogProtocol?.data) ? selectedCatalogProtocol.data : [];
  const activeCatalogDomain = selectedCatalogDomains.find((domain: any) => domain.id === selectedCatalogDomainId) || selectedCatalogDomains[0] || null;
  const visibleCatalogSkills = useMemo(() => {
    const skills = Array.isArray(activeCatalogDomain?.skills) ? activeCatalogDomain.skills : [];
    const query = protocolEditorSearch.trim().toLowerCase();
    if (!query) return skills.slice(0, 80);
    return skills.filter((skill: any) => (
      `${skill.code || ''} ${skill.name || ''} ${skill.objective || ''} ${skill.criteria || ''}`
        .toLowerCase()
        .includes(query)
    )).slice(0, 120);
  }, [activeCatalogDomain, protocolEditorSearch]);

  const fetchJsonSoft = async (url: string, headers: Record<string, string>, label: string) => {
    try {
      const response = await fetch(url, { credentials: 'include', headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || `${label} indisponivel (${response.status}).`);
      }
      return data;
    } catch (error: any) {
      console.warn(`${label} unavailable:`, error);
      setDashboardWarning((prev) => prev || `${label} nao carregou agora. O painel abriu com os demais dados.`);
      return null;
    }
  };

  const fetchProtocolRequests = async (headers: Record<string, string>) => {
    try {
      const response = await fetch('/api/admin/protocol-import-requests', { credentials: 'include', headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || `Fila de protocolos indisponivel (${response.status}).`);
      }
      setProtocolRequests(data.data || []);
      setProtocolRequestsError(null);
    } catch (error: any) {
      console.warn('Protocol request queue unavailable:', error);
      setProtocolRequests([]);
      setProtocolRequestsError(error?.message || 'Fila de protocolos indisponivel.');
    }
  };

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const supabase = await getSupabase();
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const headers = { Authorization: token ? `Bearer ${token}` : '' };

        setDashboardWarning(null);
        const [statsData, financialData, customersData, surveysData, leadsData] = await Promise.all([
          fetchJsonSoft('/api/owner/stats', headers, 'Resumo'),
          fetchJsonSoft('/api/owner/financial-overview', headers, 'Financeiro'),
          fetchJsonSoft('/api/owner/clients', headers, 'Clientes'),
          fetchJsonSoft('/api/owner/financial-feature-surveys', headers, 'Pesquisa financeira'),
          fetchJsonSoft('/api/owner/leads/recovery', headers, 'Recuperacao de leads')
        ]);

        if (statsData?.success) setStats(statsData.stats);
        if (financialData?.success) setFinancial(financialData.data);
        if (customersData?.success) setAllCustomers(customersData.data || []);
        if (surveysData?.success) setFinancialFeatureSurveys(surveysData.data || []);
        if (leadsData?.success) setLeadRecoveryItems(leadsData.data || []);
        await fetchProtocolRequests(headers);
      } catch (error: any) {
        console.error('Owner dashboard error:', error);
        setDashboardWarning(error.message || 'Nao foi possivel carregar todos os dados do painel.');
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

    setDashboardWarning(null);
    const [statsData, financialData, customersData, surveysData, leadsData] = await Promise.all([
      fetchJsonSoft('/api/owner/stats', headers, 'Resumo'),
      fetchJsonSoft('/api/owner/financial-overview', headers, 'Financeiro'),
      fetchJsonSoft('/api/owner/clients', headers, 'Clientes'),
      fetchJsonSoft('/api/owner/financial-feature-surveys', headers, 'Pesquisa financeira'),
      fetchJsonSoft('/api/owner/leads/recovery', headers, 'Recuperacao de leads')
    ]);

    if (statsData?.success) setStats(statsData.stats);
    if (financialData?.success) setFinancial(financialData.data);
    if (customersData?.success) setAllCustomers(customersData.data || []);
    if (surveysData?.success) setFinancialFeatureSurveys(surveysData.data || []);
    if (leadsData?.success) setLeadRecoveryItems(leadsData.data || []);
    await fetchProtocolRequests(headers);
  };

  const handleGrantComplimentaryPlan = async () => {
    const email = complimentaryEmail.trim();
    if (!email) {
      alert('Informe o e-mail cadastrado antes de conceder o acesso.');
      return;
    }
    if (!window.confirm(`Conceder plano ${complimentaryPlan} sem cobranca para ${email}?`)) return;

    try {
      setGrantingComplimentaryPlan(true);
      const supabase = await getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const response = await fetch('/api/admin/grant-complimentary-plan', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
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
      setAllCustomers((current) => current.map((customer) => (
        String(customer.email || '').toLowerCase() === email.toLowerCase()
          ? { ...customer, role: 'coordinator', subscription_status: 'active', plan_name: data.data?.planName || complimentaryPlan, plan_price: 0 }
          : customer
      )));
      setComplimentaryEmail('');
      setComplimentaryNote('');
      alert(`Acesso gratuito liberado no plano ${data.data?.planName || complimentaryPlan}.${data.data?.activationEmailSent ? ' E-mail de ativacao enviado.' : ''}`);
    } catch (error: any) {
      alert(error.message || 'Erro ao conceder acesso gratuito.');
    } finally {
      setGrantingComplimentaryPlan(false);
    }
  };

  const handleApproveProtocolRequest = async (request: any, forcedCanonicalName?: string) => {
    const hasSafeImageEvidence = Boolean(getProtocolRequestPreviewImage(request)?.dataUrl);
    if (request.scanStatus && request.scanStatus !== 'clean' && !hasSafeImageEvidence) {
      alert('Antes de aprovar, confirme que existe uma imagem valida visivel ou rode o processamento seguro com varredura limpa.');
      return;
    }
    const suggested = isAflsRequest(request)
      ? 'AFLS - Habilidades de Participação Social'
      : request.canonicalName || request.suggestedCanonicalName || request.protocolName || '';
    const canonicalName = forcedCanonicalName || window.prompt('Qual protocolo da biblioteca Verto deve ser liberado?', suggested);
    if (!canonicalName) return;
    const canonicalKey = isAflsRequest(request) ? 'afls-social-participation-adult' : request.canonicalKey;

    try {
      setApprovingProtocolId(request.id);
      const supabase = await getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const response = await fetch(`/api/admin/protocol-import-requests/${request.id}/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          canonicalName,
          canonicalKey
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Nao foi possivel aprovar o protocolo.');
      }
      setProtocolRequests((current) => current.map((item) => (
        item.id === request.id
          ? { ...item, status: 'approved', canonicalName, reviewedAt: new Date().toISOString() }
          : item
      )));
    } catch (error: any) {
      alert(error.message || 'Nao foi possivel aprovar o protocolo.');
    } finally {
      setApprovingProtocolId(null);
    }
  };

  const handleToggleProtocolAccess = async (request: any, protocolKey: string, enabled: boolean) => {
    const scopeKey = request.accessScopeKey;
    if (!scopeKey) {
      alert('Nao consegui identificar o acervo desta clinica/profissional.');
      return;
    }

    const saveKey = `${scopeKey}:${protocolKey}`;
    const previousRequests = protocolRequests;
    const nextKeys = (keys: any[]) => {
      const set = new Set((Array.isArray(keys) ? keys : []).map(String));
      if (enabled) set.add(protocolKey);
      else set.delete(protocolKey);
      return Array.from(set);
    };

    setSavingProtocolAccess(saveKey);
    setProtocolRequests((current) => current.map((item) => (
      item.accessScopeKey === scopeKey
        ? { ...item, authorizedProtocolKeys: nextKeys(item.authorizedProtocolKeys) }
        : item
    )));

    try {
      const supabase = await getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const response = await fetch('/api/admin/protocol-access', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ scopeKey, protocolKey, enabled, requestId: request.id })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Nao foi possivel atualizar o acervo.');
      }
      const savedKeys = Array.isArray(data.data?.protocolKeys) ? data.data.protocolKeys : [];
      setProtocolRequests((current) => current.map((item) => (
        item.accessScopeKey === scopeKey
          ? {
              ...item,
              authorizedProtocolKeys: savedKeys,
              ...(item.id === request.id && enabled ? {
                status: 'approved',
                canonicalKey: data.data?.canonicalKey || protocolKey,
                canonicalName: data.data?.canonicalName || item.canonicalName,
                reviewedAt: new Date().toISOString()
              } : {})
            }
          : item
      )));
    } catch (error: any) {
      setProtocolRequests(previousRequests);
      alert(error.message || 'Nao foi possivel atualizar o acervo.');
    } finally {
      setSavingProtocolAccess(null);
    }
  };

  const handleScanProtocolRequest = async (request: any) => {
    try {
      setScanningProtocolId(request.id);
      const supabase = await getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const response = await fetch(`/api/admin/protocol-import-requests/${request.id}/scan`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Nao foi possivel processar a varredura segura.');
      }
      setProtocolRequests((current) => current.map((item) => (
        item.id === request.id ? { ...item, ...data.data } : item
      )));
    } catch (error: any) {
      alert(error.message || 'Nao foi possivel processar a varredura segura.');
    } finally {
      setScanningProtocolId(null);
    }
  };

  const handleRejectProtocolRequest = async (request: any) => {
    if (!window.confirm('Recusar esta solicitacao de protocolo?')) return;
    try {
      setRejectingProtocolId(request.id);
      const supabase = await getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const response = await fetch(`/api/admin/protocol-import-requests/${request.id}/reject`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Nao foi possivel recusar o protocolo.');
      }
      setProtocolRequests((current) => current.map((item) => (
        item.id === request.id
          ? { ...item, status: 'rejected', reviewedAt: new Date().toISOString() }
          : item
      )));
    } catch (error: any) {
      alert(error.message || 'Nao foi possivel recusar o protocolo.');
    } finally {
      setRejectingProtocolId(null);
    }
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
          <SidebarItem icon={<MessageCircle size={18} />} label="Recuperação de Leads" active={activeTab === 'leads'} onClick={() => setActiveTab('leads')} />
          <SidebarItem icon={<ClipboardCheck size={18} />} label="Protocolos" active={activeTab === 'protocols'} onClick={() => setActiveTab('protocols')} />
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
              {activeTab === 'overview'
                ? 'Visao Geral da Rentabilidade'
                : activeTab === 'financial'
                  ? 'DRE Completo'
                  : activeTab === 'customers'
                    ? 'Clientes e Performance'
                    : activeTab === 'leads'
                      ? 'Recuperacao de Leads'
                      : 'Governanca de Protocolos'}
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

        {dashboardWarning && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            {dashboardWarning}
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
                <div className="h-80 min-h-[300px]">
                <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
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
                  </SafeResponsiveContainer>
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
                <div className="h-80 min-h-[300px]">
                  <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
                    <BarChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                      <XAxis dataKey="monthLabel" tick={{ fill: '#64748B', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#64748B', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(value: any) => formatCurrency(Number(value))} />
                      <Bar dataKey="revenueNet" fill="#0EA5E9" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="variableCosts" fill="#F59E0B" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="fixedCosts" fill="#6366F1" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </SafeResponsiveContainer>
                </div>
              </div>

              <div className="bg-white rounded-[28px] p-6 border border-slate-100 shadow-sm">
                <h3 className="text-lg font-black mb-4">Inadimplencia por Mes</h3>
                <div className="h-80 min-h-[300px]">
                  <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
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
                  </SafeResponsiveContainer>
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
            <div className="bg-white rounded-[28px] border border-emerald-100 p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-emerald-500 font-black mb-1">Acesso cortesia</p>
                  <h3 className="text-xl font-black text-slate-900">Liberar plano sem cobranca</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Use depois que a pessoa criou o cadastro e chegou na etapa de pagamento. O acesso fica ativo com valor R$ 0,00.
                  </p>
                </div>
                <button
                  onClick={handleGrantComplimentaryPlan}
                  disabled={grantingComplimentaryPlan}
                  className="px-5 py-3 rounded-2xl bg-emerald-500 text-white text-xs font-black hover:bg-emerald-600 disabled:opacity-60 transition-all"
                >
                  {grantingComplimentaryPlan ? 'Liberando...' : 'Liberar sem cobrar'}
                </button>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <input
                  type="email"
                  value={complimentaryEmail}
                  onChange={(event) => setComplimentaryEmail(event.target.value)}
                  placeholder="email@clinica.com.br"
                  className="lg:col-span-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-200"
                />
                <select
                  value={complimentaryPlan}
                  onChange={(event) => setComplimentaryPlan(event.target.value as 'Essencial' | 'Crescimento' | 'Avançado')}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-200"
                >
                  <option value="Essencial">Essencial</option>
                  <option value="Crescimento">Crescimento</option>
                  <option value="Avançado">Avançado</option>
                </select>
                <input
                  type="text"
                  value={complimentaryNote}
                  onChange={(event) => setComplimentaryNote(event.target.value)}
                  placeholder="Observacao interna"
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-200"
                />
              </div>
            </div>

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

            <div className="bg-white rounded-[28px] p-6 border border-slate-100 shadow-sm">
              <h3 className="text-lg font-black mb-4">Pesquisa do MÃ³dulo Financeiro</h3>
              {financialFeatureSurveys.length === 0 ? (
                <p className="text-sm text-slate-500">Ainda nÃ£o hÃ¡ respostas.</p>
              ) : (
                <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
                  {financialFeatureSurveys.map((item: any, idx: number) => (
                    <div
                      key={`${item.clinic_id}-${item.user_id}-${idx}`}
                      className="p-4 rounded-2xl border border-slate-100 bg-slate-50"
                    >
                      <p className="text-sm font-bold text-slate-800">
                        {item.user_email || "UsuÃ¡rio sem e-mail"}
                      </p>
                      <p className="text-[11px] text-slate-500 mb-2">ClÃ­nica: {item.clinic_id}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(item.selected_features || []).map((feature: string) => (
                          <span
                            key={feature}
                            className="px-2 py-1 rounded-full bg-purple-100 text-[#7a32fc] text-[10px] font-semibold"
                          >
                            {feature}
                          </span>
                        ))}
                      </div>
                      {item.notes && <p className="text-xs text-slate-600 mt-2">{item.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'leads' && (
          <div className="space-y-6">
            <div className="bg-white rounded-[24px] border border-slate-100 p-5 flex flex-wrap gap-4 items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageCircle size={17} className="text-slate-500" />
                <span className="text-sm font-bold text-slate-600">
                  Leads de checkout cancelado para recuperação comercial
                </span>
              </div>
              <button
                onClick={refreshAll}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-700 hover:bg-slate-50"
              >
                Atualizar lista
              </button>
            </div>

            <div className="bg-white rounded-[28px] p-6 border border-slate-100 shadow-sm">
              <h3 className="text-lg font-black mb-4">Fila de Recuperação</h3>
              {leadRecoveryItems.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhum lead pendente no momento.</p>
              ) : (
                <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                  {leadRecoveryItems.map((lead) => {
                    const whatsappDigits = String(lead.phone || '').replace(/\D/g, '');
                    const waLink = whatsappDigits
                      ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent('Olá, vi seu cadastro na Verto e posso te ajudar a concluir a ativação.')}`
                      : null;

                    return (
                      <div
                        key={lead.userId}
                        className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                      >
                        <div>
                          <p className="font-black text-sm text-slate-800">{lead.name || 'Lead sem nome'}</p>
                          <p className="text-xs text-slate-500">{lead.email || 'Sem e-mail'}</p>
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-black uppercase tracking-[0.1em]">
                              {lead.planName || 'Plano não informado'}
                            </span>
                            <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700 text-[10px] font-black uppercase tracking-[0.1em]">
                              {lead.subscriptionStatus || 'pending'}
                            </span>
                            <span className="px-2 py-1 rounded-full bg-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-[0.1em]">
                              Cancelamentos: {Number(lead.cancelCount || 0)}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-2">
                            Último cancelamento:{' '}
                            {lead.lastCheckoutCancelAt
                              ? new Date(lead.lastCheckoutCancelAt).toLocaleString('pt-BR')
                              : 'Não registrado'}
                          </p>
                        </div>

                        <div className="flex flex-col gap-2 min-w-[220px]">
                          <div className="text-xs font-semibold text-slate-600 flex items-center gap-2">
                            <Phone size={14} />
                            {lead.phone || 'Sem WhatsApp informado'}
                          </div>
                          {waLink ? (
                            <a
                              href={waLink}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 text-white text-xs font-black uppercase tracking-[0.1em] px-3 py-2 hover:bg-emerald-600 transition-colors"
                            >
                              <MessageCircle size={14} /> Contatar no WhatsApp
                            </a>
                          ) : (
                            <div className="text-[11px] text-rose-600 font-semibold">
                              Lead sem telefone. Solicite atualização do cadastro.
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'protocols' && (
          <div className="space-y-6">
            <div className="rounded-[32px] bg-slate-900 text-white p-8 shadow-xl">
              <p className="text-xs uppercase tracking-[0.18em] text-violet-200 font-bold mb-2">Checkpoint Verto Protocol Engine</p>
              <h2 className="text-2xl font-black">Solicitacoes de protocolos importados</h2>
              <p className="text-sm text-slate-300 mt-2 max-w-3xl">
                O arquivo enviado pela clinica serve como comprovacao/base. A liberacao final aponta para o protocolo canonico da biblioteca Verto, evitando duplicidade entre clientes.
              </p>
            </div>

            <div className="rounded-[32px] bg-white border border-slate-100 p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-emerald-600 font-black mb-1">Editor de protocolos Verto</p>
                  <h3 className="text-xl font-black text-slate-900">Revisar modelos canônicos</h3>
                  <p className="text-sm text-slate-500 mt-1 max-w-3xl">
                    Use este painel para conferir os protocolos que formos adicionando: domínios, tarefas, pontuação, objetivos e critérios.
                  </p>
                </div>
                <select
                  value={selectedCatalogProtocolKey}
                  onChange={(event) => {
                    setSelectedCatalogProtocolKey(event.target.value);
                    setSelectedCatalogDomainId('');
                    setProtocolEditorSearch('');
                  }}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black outline-none focus:ring-2 focus:ring-emerald-100"
                >
                  {VERTO_PROTOCOL_EDITOR_CATALOG.map((entry) => (
                    <option key={entry.key} value={entry.key}>{entry.name}</option>
                  ))}
                </select>
              </div>

              {selectedCatalogProtocol ? (
                <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
                  <div className="rounded-3xl border border-emerald-100 bg-emerald-50/50 p-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700">Resumo</p>
                    <h4 className="mt-2 text-lg font-black text-slate-900">{selectedCatalogProtocol.title}</h4>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-2xl bg-white p-3 border border-emerald-100">
                        <p className="text-xl font-black text-slate-900">{selectedCatalogProtocol.canonicalMeta?.domainCount || selectedCatalogDomains.length}</p>
                        <p className="text-[10px] font-black uppercase text-slate-400">Domínios</p>
                      </div>
                      <div className="rounded-2xl bg-white p-3 border border-emerald-100">
                        <p className="text-xl font-black text-slate-900">{selectedCatalogProtocol.canonicalMeta?.taskCount || 0}</p>
                        <p className="text-[10px] font-black uppercase text-slate-400">Tarefas</p>
                      </div>
                    </div>
                    <div className="mt-3 rounded-2xl bg-white p-3 border border-emerald-100 text-center">
                      <p className="text-xl font-black text-emerald-700">{selectedCatalogProtocol.canonicalMeta?.completionPercent || 0}%</p>
                      <p className="text-[10px] font-black uppercase text-slate-400">Inclusão Verto</p>
                    </div>
                    <p className="mt-4 text-xs font-bold text-slate-600">
                      {selectedCatalogProtocol.licenseScope || 'Modelo canônico Verto.'}
                    </p>
                    <div className="mt-4 space-y-2">
                      {selectedCatalogDomains.map((domain: any) => (
                        <button
                          key={domain.id}
                          type="button"
                          onClick={() => setSelectedCatalogDomainId(domain.id)}
                          className={`w-full rounded-2xl px-3 py-2 text-left text-xs font-black transition-all ${activeCatalogDomain?.id === domain.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}
                        >
                          {domain.name}
                          <span className="ml-2 text-[10px] opacity-70">{domain.skills?.length || 0}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Domínio aberto</p>
                        <h4 className="text-lg font-black text-slate-900">{activeCatalogDomain?.name || 'Sem domínio'}</h4>
                      </div>
                      <input
                        value={protocolEditorSearch}
                        onChange={(event) => setProtocolEditorSearch(event.target.value)}
                        className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-100"
                        placeholder="Buscar tarefa, código ou critério"
                      />
                    </div>
                    <div className="max-h-[520px] overflow-y-auto pr-2 space-y-3">
                      {visibleCatalogSkills.map((skill: any) => (
                        <div key={skill.id || skill.code} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-emerald-600">{skill.code} · 0-{skill.maxScore || 2}</p>
                              <h5 className="text-base font-black text-slate-900">{skill.name}</h5>
                            </div>
                            {skill.sourcePage && (
                              <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase text-slate-500">
                                pág. {skill.sourcePage}
                              </span>
                            )}
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div className="rounded-2xl bg-white p-3 border border-slate-100">
                              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Objetivo</p>
                              <p className="mt-1 text-xs font-bold text-slate-700">{skill.objective || 'Sem objetivo preenchido.'}</p>
                            </div>
                            <div className="rounded-2xl bg-white p-3 border border-slate-100">
                              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Pergunta</p>
                              <p className="mt-1 text-xs font-bold text-slate-700">{skill.question || 'Sem pergunta preenchida.'}</p>
                            </div>
                          </div>
                          <div className="mt-3 rounded-2xl bg-white p-3 border border-slate-100">
                            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Critérios</p>
                            <p className="mt-1 text-xs font-bold text-slate-700">{skill.criteria || 'Sem critérios preenchidos.'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                  <p className="font-black text-slate-700">Modelo ainda não estruturado</p>
                  <p className="mt-1 text-sm text-slate-500">Quando adicionarmos este protocolo, ele aparecerá aqui para revisão.</p>
                </div>
              )}
            </div>

            <div className="grid gap-4">
                  {protocolRequestsError && (
                <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-800">
                  A fila de protocolos ainda nao respondeu: {protocolRequestsError}. O restante do painel continua funcionando. Se voce acabou de enviar um protocolo antes da correcao do 500, esse envio provavelmente nao foi salvo e precisa ser reenviado.
                </div>
              )}
              {!protocolRequestsError && protocolRequests.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">
                  Nenhuma solicitacao de protocolo pendente.
                </div>
              ) : (
                (() => {
                  const pendingRequests = protocolRequests.filter((request: any) => request.status === 'pending');
                  const reviewedRequests = protocolRequests.filter((request: any) => request.status !== 'pending');
                  const orderedRequests = [...pendingRequests, ...reviewedRequests];
                  return orderedRequests.map((request) => {
                  const isApproved = request.status === 'approved';
                  const isRejected = request.status === 'rejected';
                  const isClean = request.scanStatus === 'clean';
                  const isBlocked = request.scanStatus === 'blocked';
                  const screenshotEvidence = request.scanReport?.evidence?.mode === 'screenshots'
                    ? (request.scanReport?.evidence?.screenshots || [])
                    : [];
                  const isScreenshotFlow = screenshotEvidence.length > 0;
                  const quickPreviewShot = getProtocolRequestPreviewImage(request);
                  const canApproveWithImageEvidence = Boolean(quickPreviewShot?.dataUrl);
                  const effectiveClean = isClean || canApproveWithImageEvidence;
                  const declaredAgeMin = request.scanReport?.evidence?.ageMin;
                  const declaredAgeMax = request.scanReport?.evidence?.ageMax;
                  const hasDeclaredAgeRange = Number.isFinite(Number(declaredAgeMin));
                  const applicableAgeLabel = hasDeclaredAgeRange
                    ? `${Number(declaredAgeMin)} ate ${Number.isFinite(Number(declaredAgeMax)) ? Number(declaredAgeMax) : '+'} anos`
                    : request.scanReport?.evidence?.applicableAgeGroup === 'child'
                    ? 'Criancas'
                    : request.scanReport?.evidence?.applicableAgeGroup === 'teen'
                      ? 'Adolescentes'
                      : request.scanReport?.evidence?.applicableAgeGroup === 'adult'
                        ? 'Adultos'
                        : 'Todas as idades';
                  const canFastTrackCanonical = effectiveClean && !isApproved && Number(request.confidence || 0) >= 0.9;
                  return (
                    <div key={request.id} className={`rounded-[28px] p-5 shadow-sm grid grid-cols-1 xl:grid-cols-[minmax(340px,1fr)_260px_320px] gap-5 items-start border ${request.status === 'pending' ? 'bg-gradient-to-br from-white to-amber-50 border-amber-200 shadow-amber-100/50' : 'bg-white border-slate-100'}`}>
                      <div className="flex min-w-0 gap-4">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${request.status === 'pending' ? 'bg-amber-100 text-amber-700' : isApproved ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                        <FileText size={22} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <h3 className="font-black text-slate-900">{request.protocolName || request.fileName}</h3>
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${isApproved ? 'bg-emerald-50 text-emerald-600' : isRejected ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`}>
                            {isApproved ? 'Aprovado' : isRejected ? 'Recusado' : 'Pendente'}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-slate-500">
                          {request.requesterName || 'Profissional'} · {request.requesterEmail || 'sem e-mail'} · {request.fileName}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          Sugestao Verto: <strong>{request.canonicalName || 'Analise manual'}</strong> · confianca {Math.round(Number(request.confidence || 0) * 100)}%
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          Solicitacao enviada em <strong>{formatProtocolRequestDateTime(request.createdAt)}</strong>
                        </p>
                        {isScreenshotFlow && (
                          <p className="text-xs text-slate-400 mt-1">
                            Aplicacao declarada: <strong>{applicableAgeLabel}</strong>
                          </p>
                        )}
                        {request.status === 'pending' && (
                          <div className="mt-3 rounded-2xl bg-amber-100/80 border border-amber-200 px-4 py-3">
                            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-amber-700">Nova solicitacao</p>
                            <p className="text-sm font-bold text-amber-900 mt-1">
                              Se a miniatura aparecer e fizer sentido visualmente, voce pode confiar mais no envio e liberar o protocolo correspondente.
                            </p>
                          </div>
                        )}
                        {isScreenshotFlow && (
                          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                              <span className="rounded-full px-3 py-1 text-[11px] font-black uppercase bg-violet-100 text-violet-700">
                                Visual enviado pelo profissional
                              </span>
                              <span className="rounded-full bg-white px-3 py-1 text-[11px] font-black uppercase text-slate-700">
                                {screenshotEvidence.length} imagem{Number(screenshotEvidence.length) > 1 ? 'ns' : ''}
                              </span>
                            </div>
                            <p className="text-sm font-bold text-slate-800">
                              Veja a miniatura e valide se o material parece coerente com o protocolo informado.
                            </p>
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase">
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
                            <Shield size={12} />
                            {quickPreviewShot?.dataUrl ? 'Imagem recebida' : 'Sem imagem validavel'}
                          </span>
                          <span className={`rounded-full px-2.5 py-1 ${effectiveClean ? 'bg-emerald-50 text-emerald-700' : isBlocked ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                            {canApproveWithImageEvidence ? 'Evidência por imagem validável' : `Varredura: ${isClean ? 'limpa' : isBlocked ? 'bloqueada' : 'pendente'}`}
                          </span>
                          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">
                            Acesso bruto bloqueado
                          </span>
                        </div>
                        {request.safePreviewText && (
                          <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600 whitespace-pre-wrap">
                            {request.safePreviewText}
                          </div>
                        )}
                      </div>
                      </div>
                      <div className="w-full min-w-0">
                        <div className={`rounded-[22px] border p-3 h-full ${request.status === 'pending' ? 'border-amber-200 bg-white' : 'border-slate-200 bg-slate-50'}`}>
                          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500 mb-3">Visualizacao rapida</p>
                          {quickPreviewShot?.dataUrl ? (
                            <>
                              <img
                                src={quickPreviewShot.dataUrl}
                                alt={`Imagem enviada pagina ${quickPreviewShot.pageNumber || '-'}`}
                                className="w-full h-44 object-contain rounded-2xl border border-slate-200 bg-white"
                              />
                              <div className="mt-3 rounded-2xl bg-slate-100 px-3 py-2">
                                <p className="text-xs font-black text-slate-900">Imagem enviada{quickPreviewShot.pageNumber ? ` · pagina ${quickPreviewShot.pageNumber}` : ''}</p>
                                <p className="text-[11px] text-slate-600 mt-1 leading-snug">
                                  Miniatura recebida com sucesso. Valide visualmente antes de aprovar.
                                </p>
                              </div>
                            </>
                          ) : (
                            <div className="rounded-2xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center">
                              <p className="text-sm font-black text-rose-700">Sem miniatura visivel</p>
                              <p className="text-[11px] text-rose-600 mt-2">
                                O envio nao trouxe uma imagem valida para preview. Nesse caso, trate com mais desconfiança.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-3 w-full">
                        <div className="rounded-[22px] border border-slate-200 bg-white p-4">
                          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Acervo desta clínica</p>
                          <p className="mt-1 text-xs font-bold text-slate-700">
                            Marque os protocolos Verto que este profissional pode usar. As próximas solicitações já virão com essas caixas marcadas.
                          </p>
                          <div className="mt-3 space-y-2">
                            {VERTO_PROTOCOL_OPTIONS.map((protocol) => {
                              const checked = Array.isArray(request.authorizedProtocolKeys) && request.authorizedProtocolKeys.includes(protocol.key);
                              const saveKey = `${request.accessScopeKey}:${protocol.key}`;
                              const saving = savingProtocolAccess === saveKey;
                              return (
                                <label
                                  key={protocol.key}
                                  className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-3 py-3 transition-all ${checked ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:bg-white'}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={saving || isRejected}
                                    onChange={(event) => handleToggleProtocolAccess(request, protocol.key, event.target.checked)}
                                    className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600"
                                  />
                                  <span className="min-w-0">
                                    <span className={`block text-xs font-black ${checked ? 'text-emerald-800' : 'text-slate-800'}`}>
                                      {protocol.name}
                                    </span>
                                    <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                                      {saving ? 'Salvando...' : `${protocol.hint} · ${protocol.completionPercent}% ${protocol.statusLabel}`}
                                    </span>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                        {!isApproved && (
                          <button
                            type="button"
                            onClick={() => handleRejectProtocolRequest(request)}
                            disabled={rejectingProtocolId === request.id}
                            className="w-full justify-center px-4 py-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-black hover:bg-rose-100 disabled:bg-slate-200 disabled:text-slate-400 transition-all flex items-center gap-2"
                          >
                            {rejectingProtocolId === request.id ? <Loader2 size={14} className="animate-spin" /> : <AlertCircle size={14} />}
                            Recusar
                          </button>
                        )}
                        {request.hasFileData && !canApproveWithImageEvidence && !isApproved && (
                          <button
                            type="button"
                            onClick={() => handleScanProtocolRequest(request)}
                            disabled={scanningProtocolId === request.id || isRejected}
                            className="w-full justify-center px-4 py-3 rounded-2xl bg-slate-900 text-white text-xs font-black hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 transition-all flex items-center gap-2"
                          >
                            {scanningProtocolId === request.id ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
                            {scanningProtocolId === request.id ? 'Processando...' : 'Processar seguro'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                });
                })()
              )}
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





