import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  TrendingUp, 
  Calendar, 
  ClipboardList, 
  Settings, 
  LogOut, 
  Plus, 
  Search, 
  Bell, 
  ChevronRight, 
  DollarSign, 
  PieChart, 
  ArrowUpRight, 
  ArrowDownRight,
  UserPlus,
  Mail,
  Filter,
  Download,
  FileText
} from 'lucide-react';
import { TeamManagement } from './TeamManagement';
import { InvitationModal } from './InvitationModal';
import { LogoVerto } from './Common';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line,
  Cell,
  PieChart as RePieChart,
  Pie
} from 'recharts';

interface CoordinatorDashboardProps {
  user: any;
  onLogout: () => void;
  allPatients: any[];
  therapistAgenda: any[];
}

export function CoordinatorDashboard({ user, onLogout, allPatients, therapistAgenda }: CoordinatorDashboardProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'team' | 'financial' | 'patients' | 'agenda' | 'protocols' | 'settings'>('dashboard');
  const [showInvitationModal, setShowInvitationModal] = useState(false);
  const [loading, setLoading] = useState(false);

  // Mock data for DRE
  const dreData = [
    { label: 'Receita Bruta', value: 45250, type: 'income', info: 'Total de faturamento no mês' },
    { label: 'Impostos (6%)', value: -2715, type: 'expense', info: 'Simples Nacional' },
    { label: 'Receita Líquida', value: 42535, type: 'total', info: 'Faturamento após impostos' },
    { label: 'Custos Variáveis (Repasses)', value: -18100, type: 'expense', info: 'Pagamento de profissionais' },
    { label: 'Margem de Contribuição', value: 24435, type: 'total', info: 'Sobra para custos fixos' },
    { label: 'Custos Fixos (Aluguel, Luz, etc)', value: -8500, type: 'expense', info: 'Custos operacionais' },
    { label: 'Lucro Líquido', value: 15935, type: 'profit', info: 'Resultado final do mês' },
  ];

  const revenueHistory = [
    { month: 'Jan', revenue: 38000, profit: 12000 },
    { month: 'Fev', revenue: 42000, profit: 14500 },
    { month: 'Mar', revenue: 45250, profit: 15935 },
    { month: 'Abr', revenue: 48000, profit: 17200 },
  ];

  const teamPerformance = [
    { name: 'Dr. Ricardo', patients: 12, revenue: 8400 },
    { name: 'Dra. Ana', patients: 15, revenue: 10500 },
    { name: 'Dr. Marcos', patients: 8, revenue: 5600 },
    { name: 'Dra. Julia', patients: 10, revenue: 7000 },
  ];

  const COLORS = ['#4318FF', '#6AD2FF', '#EFF4FB', '#A3AED0'];

  const renderDashboard = () => (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Faturamento Mensal', value: 'R$ 45.250', icon: DollarSign, trend: '+12%', color: 'bg-blue-50 text-[#4318FF]' },
          { label: 'Lucro Líquido', value: 'R$ 15.935', icon: TrendingUp, trend: '+8.4%', color: 'bg-green-50 text-green-600' },
          { label: 'Pacientes Ativos', value: allPatients.length.toString(), icon: Users, trend: '+3', color: 'bg-purple-50 text-purple-600' },
          { label: 'Sessões Realizadas', value: '142', icon: Calendar, trend: '+15', color: 'bg-orange-50 text-orange-600' },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100 hover:shadow-md transition-all group">
            <div className="flex items-center justify-between mb-4">
              <div className={`w-12 h-12 ${stat.color} rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform`}>
                <stat.icon size={24} />
              </div>
              <span className="text-xs font-bold text-green-500 bg-green-50 px-2 py-1 rounded-lg">{stat.trend}</span>
            </div>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">{stat.label}</p>
            <h3 className="text-2xl font-bold text-slate-900">{stat.value}</h3>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Revenue Chart */}
        <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">Crescimento da Clínica</h3>
              <p className="text-slate-400 text-xs font-medium">Faturamento vs Lucro (Últimos 4 meses)</p>
            </div>
            <select className="bg-slate-50 border-none rounded-xl px-4 py-2 text-xs font-bold text-slate-600 outline-none">
              <option>2024</option>
            </select>
          </div>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueHistory}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#A3AED0', fontSize: 12, fontWeight: 'bold'}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#A3AED0', fontSize: 12, fontWeight: 'bold'}} />
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ fontWeight: 'bold', fontSize: '12px' }}
                />
                <Line type="monotone" dataKey="revenue" stroke="#4318FF" strokeWidth={4} dot={{ r: 6, fill: '#4318FF', strokeWidth: 3, stroke: '#fff' }} activeDot={{ r: 8 }} />
                <Line type="monotone" dataKey="profit" stroke="#05CD99" strokeWidth={4} dot={{ r: 6, fill: '#05CD99', strokeWidth: 3, stroke: '#fff' }} activeDot={{ r: 8 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Team Performance */}
        <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">Desempenho da Equipe</h3>
              <p className="text-slate-400 text-xs font-medium">Pacientes por profissional</p>
            </div>
            <button className="p-2 hover:bg-slate-50 rounded-xl transition-all">
              <Plus size={20} className="text-[#4318FF]" />
            </button>
          </div>
          <div className="space-y-6">
            {teamPerformance.map((member, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center font-bold text-slate-600">
                    {member.name.split(' ')[1][0]}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">{member.name}</p>
                    <p className="text-xs text-slate-400 font-medium">{member.patients} pacientes ativos</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-[#4318FF]">R$ {member.revenue.toLocaleString()}</p>
                  <div className="w-24 h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
                    <div 
                      className="h-full bg-[#4318FF] rounded-full" 
                      style={{ width: `${(member.patients / 20) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const renderFinancial = () => (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Demonstrativo de Resultados (DRE)</h2>
          <p className="text-slate-400 font-medium">Visão detalhada da saúde financeira da clínica</p>
        </div>
        <div className="flex gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-100 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm">
            <Download size={16} /> Exportar PDF
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-[#4318FF] text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20">
            <Plus size={16} /> Novo Lançamento
          </button>
        </div>
      </div>

      <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-8 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white rounded-2xl shadow-sm border border-slate-100">
              <Calendar size={20} className="text-[#4318FF]" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Período Selecionado</p>
              <p className="text-sm font-bold text-slate-900">Março de 2024</p>
            </div>
          </div>
          <div className="flex items-center gap-8">
            <div className="text-right">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Margem Líquida</p>
              <p className="text-lg font-bold text-green-500">35.2%</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ponto de Equilíbrio</p>
              <p className="text-lg font-bold text-slate-900">R$ 14.166</p>
            </div>
          </div>
        </div>

        <div className="p-8">
          <table className="w-full">
            <thead>
              <tr className="text-left">
                <th className="pb-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Descrição</th>
                <th className="pb-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Valor (R$)</th>
                <th className="pb-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">% Receita</th>
                <th className="pb-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Info</th>
              </tr>
            </thead>
            <tbody className="space-y-4">
              {dreData.map((item, i) => (
                <tr key={i} className={`group ${item.type === 'total' || item.type === 'profit' ? 'bg-slate-50/50' : ''}`}>
                  <td className={`py-4 px-4 rounded-l-2xl ${item.type === 'profit' ? 'text-lg font-bold text-green-600' : item.type === 'total' ? 'font-bold text-slate-900' : 'text-slate-600 font-medium'}`}>
                    {item.label}
                  </td>
                  <td className={`py-4 px-4 text-right ${item.value < 0 ? 'text-red-500' : item.type === 'profit' ? 'text-lg font-bold text-green-600' : 'text-slate-900 font-bold'}`}>
                    {item.value < 0 ? `- R$ ${Math.abs(item.value).toLocaleString()}` : `R$ ${item.value.toLocaleString()}`}
                  </td>
                  <td className="py-4 px-4 text-right text-slate-400 font-bold text-xs">
                    {item.label === 'Receita Bruta' ? '100%' : `${Math.abs((item.value / 45250) * 100).toFixed(1)}%`}
                  </td>
                  <td className="py-4 px-4 rounded-r-2xl text-center">
                    <button className="p-1.5 hover:bg-white rounded-lg transition-all text-slate-300 hover:text-[#4318FF]">
                      <FileText size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Financial Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Composição de Custos</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[
                { name: 'Repasses', value: 18100 },
                { name: 'Aluguel', value: 3500 },
                { name: 'Marketing', value: 2000 },
                { name: 'Sistemas', value: 1200 },
                { name: 'Outros', value: 1800 },
              ]}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#A3AED0', fontSize: 12, fontWeight: 'bold'}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#A3AED0', fontSize: 12, fontWeight: 'bold'}} />
                <Tooltip cursor={{fill: '#F8FAFC'}} contentStyle={{borderRadius: '16px', border: 'none'}} />
                <Bar dataKey="value" fill="#4318FF" radius={[8, 8, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Distribuição</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie
                  data={[
                    { name: 'Lucro', value: 15935 },
                    { name: 'Repasses', value: 18100 },
                    { name: 'Custos Fixos', value: 8500 },
                    { name: 'Impostos', value: 2715 },
                  ]}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {COLORS.map((color, index) => (
                    <Cell key={`cell-${index}`} fill={color} />
                  ))}
                </Pie>
                <Tooltip />
              </RePieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2 mt-4">
            {['Lucro', 'Repasses', 'Custos Fixos', 'Impostos'].map((label, i) => (
              <div key={i} className="flex items-center justify-between text-xs font-bold">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                  <span className="text-slate-400">{label}</span>
                </div>
                <span className="text-slate-900">R$ {dreData.find(d => d.label.includes(label))?.value || 0}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F4F7FE] flex">
      {/* Sidebar */}
      <div className="w-72 bg-white hidden lg:flex flex-col p-8 sticky top-0 h-screen border-r border-slate-100">
        <div className="flex items-center gap-3 mb-12 px-2">
          <div className="w-12 h-12 bg-[#4318FF] rounded-[20px] flex items-center justify-center text-white shadow-xl shadow-blue-500/30">
            <TrendingUp size={24} />
          </div>
          <div>
            <span className="font-black text-2xl text-slate-900 tracking-tighter block leading-none">VERTO</span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Gestão</span>
          </div>
        </div>

        <nav className="space-y-2 flex-1">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
            { id: 'team', label: 'Equipe', icon: Users },
            { id: 'financial', label: 'Financeiro (DRE)', icon: DollarSign },
            { id: 'patients', label: 'Pacientes', icon: ClipboardList },
            { id: 'agenda', label: 'Agenda Global', icon: Calendar },
            { id: 'settings', label: 'Configurações', icon: Settings },
          ].map((item) => (
            <button 
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all font-bold text-sm ${
                activeTab === item.id 
                  ? 'text-[#4318FF] bg-blue-50 shadow-sm' 
                  : 'text-slate-400 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <item.icon size={20} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto pt-8 border-t border-slate-50">
          <div className="bg-slate-50 rounded-3xl p-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center font-bold text-[#4318FF] shadow-sm">
                {user.name?.[0]}
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-bold text-slate-900 truncate">{user.name}</p>
                <p className="text-[10px] font-medium text-slate-400 truncate">{user.email}</p>
              </div>
            </div>
          </div>
          <button 
            onClick={onLogout}
            className="w-full flex items-center gap-4 px-6 py-4 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-2xl transition-all font-bold text-sm"
          >
            <LogOut size={20} />
            Sair do Sistema
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <header className="px-8 py-6 flex items-center justify-between sticky top-0 bg-[#F4F7FE]/80 backdrop-blur-md z-10">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Páginas / {activeTab}</p>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight capitalize">{activeTab === 'financial' ? 'Financeiro' : activeTab}</h1>
          </div>
          
          <div className="flex items-center gap-4 bg-white p-2 rounded-[24px] shadow-sm border border-slate-100">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="text" 
                placeholder="Pesquisar..." 
                className="bg-slate-50 border-none rounded-full py-3 pl-12 pr-6 text-sm font-medium outline-none focus:ring-2 ring-blue-500/20 w-64 transition-all"
              />
            </div>
            <button className="p-3 text-slate-400 hover:text-[#4318FF] transition-all relative">
              <Bell size={20} />
              <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white" />
            </button>
            <button 
              onClick={() => setShowInvitationModal(true)}
              className="p-3 bg-[#4318FF] text-white rounded-full hover:scale-105 transition-all shadow-lg shadow-blue-500/20"
            >
              <UserPlus size={20} />
            </button>
          </div>
        </header>

        <main className="p-8 pb-20">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div key="dashboard" initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -20}}>
                {renderDashboard()}
              </motion.div>
            )}
            {activeTab === 'team' && (
              <motion.div key="team" initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -20}}>
                <TeamManagement user={user} />
              </motion.div>
            )}
            {activeTab === 'financial' && (
              <motion.div key="financial" initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -20}}>
                {renderFinancial()}
              </motion.div>
            )}
            {activeTab === 'patients' && (
              <motion.div key="patients" initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -20}} className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-xl font-bold text-slate-900">Gestão de Pacientes</h3>
                  <button className="px-6 py-3 bg-[#4318FF] text-white rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 hover:bg-blue-700 transition-all">
                    Novo Paciente
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {allPatients.map((patient, i) => (
                    <div key={i} className="p-6 bg-slate-50 rounded-3xl border border-slate-100 hover:border-blue-500/30 transition-all group">
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center font-bold text-slate-900 shadow-sm group-hover:scale-110 transition-transform">
                          {patient.name[0]}
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900">{patient.name}</h4>
                          <p className="text-xs text-slate-400 font-medium">ID: {patient.id}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-4 border-t border-slate-200/50">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</span>
                        <span className="px-2 py-1 bg-green-100 text-green-600 rounded-lg text-[10px] font-bold uppercase">Ativo</span>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
            {activeTab === 'agenda' && (
              <motion.div key="agenda" initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -20}} className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
                <h3 className="text-xl font-bold text-slate-900 mb-8">Agenda Global da Clínica</h3>
                <div className="space-y-4">
                  {therapistAgenda.map((item, i) => (
                    <div key={i} className="flex items-center gap-6 p-4 hover:bg-slate-50 rounded-2xl transition-all border border-transparent hover:border-slate-100">
                      <div className="w-20 text-center">
                        <p className="text-sm font-black text-[#4318FF]">{item.time}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Hoje</p>
                      </div>
                      <div className="w-1 h-10 bg-blue-100 rounded-full" />
                      <div className="flex-1">
                        <p className="text-sm font-bold text-slate-900">{item.patientName}</p>
                        <p className="text-xs text-slate-400 font-medium">Terapeuta: {item.therapistName || 'Dr. Ricardo'}</p>
                      </div>
                      <div className="px-3 py-1 bg-blue-50 text-[#4318FF] rounded-lg text-[10px] font-bold uppercase">
                        {item.type}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {showInvitationModal && (
        <InvitationModal 
          user={user} 
          onClose={() => setShowInvitationModal(false)} 
        />
      )}
    </div>
  );
}
