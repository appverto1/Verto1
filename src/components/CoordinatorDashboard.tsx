import React, { useState, useMemo, useEffect } from 'react';
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
  FileText,
  DoorOpen,
  Edit2,
  Trash2,
  History,
  ClipboardCheck,
  CalendarRange,
  CalendarDays,
  CalendarPlus,
  MessageCircle,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Zap,
  Heart,
  X
} from 'lucide-react';
import { TeamManagement } from './TeamManagement';
import { InvitationModal } from './InvitationModal';
import { SettingsMenu } from './SettingsMenu';
import { PatientDetailView } from './PatientDetailView';
import { RoomReservation } from './RoomReservation';
import { ProtocolManagementSystem } from './Protocols';
import { CalendarWidget, DayDetailsModal } from './Calendar';
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
  onOpenOnboarding?: () => void;
  rooms: any[];
  setRooms: React.Dispatch<React.SetStateAction<any[]>>;
  roomReservations: any[];
  onDeleteRoomReservation: (id: string) => void;
  protocols: any[];
  setProtocols: (protocols: any) => void;
  activityLogs: any[];
  onAddActivityLog: (title: string, content: string, type?: string) => void;
  onScheduleSession: (session: any) => any;
  onUpdateAppointment: (id: number, updates: any) => void;
  onUpdateAgendaStatus: (id: number, status: string) => void;
  onAddPatient: (patient: any) => void;
  patientsHistory: any[];
  therapistNotes: any[];
  onAddNote: (pid: any, txt: string, visibility: string, subject?: string) => void;
  onUpdateProfile: (updates: any) => void;
}

export function CoordinatorDashboard({ 
  user, 
  onLogout, 
  allPatients, 
  therapistAgenda, 
  onOpenOnboarding,
  rooms,
  setRooms,
  roomReservations,
  onDeleteRoomReservation,
  protocols,
  setProtocols,
  activityLogs,
  onAddActivityLog,
  onScheduleSession,
  onUpdateAppointment,
  onUpdateAgendaStatus,
  onAddPatient,
  patientsHistory,
  therapistNotes,
  onAddNote,
  onUpdateProfile
}: CoordinatorDashboardProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'team' | 'financial' | 'patients' | 'agenda' | 'rooms' | 'protocols' | 'settings' | 'logs' | 'billing'>('dashboard');
  const [showInvitationModal, setShowInvitationModal] = useState(false);
  const [showBillingDetails, setShowBillingDetails] = useState(false);

  const billingHistory = [
    { date: '15/03/2026', amount: 149.90, status: 'paid', method: 'Cartão •••• 4242' },
    { date: '15/02/2026', amount: 149.90, status: 'paid', method: 'Cartão •••• 4242' },
    { date: '15/01/2026', amount: 149.90, status: 'paid', method: 'Cartão •••• 4242' },
  ];

  const upcomingBills = [
    { date: '15/04/2026', amount: 149.90, status: 'pending' },
    { date: '15/05/2026', amount: 149.90, status: 'pending' },
    { date: '15/06/2026', amount: 149.90, status: 'pending' },
  ];

  const mockMedicalRecord = {
    firstInterview: {
      date: '10/01/2024',
      therapist: 'Dra. Ana Silva',
      mainComplaint: 'Dificuldades na interação social e atraso na fala.',
      history: 'Gestação sem intercorrências. Marcos do desenvolvimento motores dentro do esperado, porém sem balbucio aos 12 meses.',
      observations: 'Paciente evita contato visual, apresenta estereotipias motoras (flapping).',
      diagnosis: 'TEA (Transtorno do Espectro Autista) - Nível 1 de suporte.',
      recommendations: 'Terapia ABA 20h semanais, Fonoaudiologia 2h semanais.'
    }
  };
  const [loading, setLoading] = useState(false);
  const [isEditingRooms, setIsEditingRooms] = useState(false);
  const [newRoom, setNewRoom] = useState({ name: '', specialties: '' });
  const [editingRoom, setEditingRoom] = useState<any>(null);

  // Agenda State
  const [agendaView, setAgendaView] = useState<'day' | 'week' | 'month'>('day');
  const [professionalFilter, setProfessionalFilter] = useState('all');
  const [isAddSessionModalOpen, setIsAddSessionModalOpen] = useState(false);
  const [isDayDetailsModalOpen, setIsDayDetailsModalOpen] = useState(false);
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0]);
  const [sessionTime, setSessionTime] = useState('08:00');
  const [sessionPatientName, setSessionPatientName] = useState('');
  const [sessionApproach, setSessionApproach] = useState('');
  const [sessionRoom, setSessionRoom] = useState('');
  const [sessionProfessional, setSessionProfessional] = useState('');
  const [sessionNumSessions, setSessionNumSessions] = useState(1);
  const [editingAppointmentId, setEditingAppointmentId] = useState<number | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<any>(null);
  const [view, setView] = useState<'home' | 'patient'>('home');
  const [filteredPatients, setFilteredPatients] = useState<any[]>([]);

  useEffect(() => {
    if (sessionPatientName) {
      const matches = allPatients.filter((p: any) => p.name.toLowerCase().includes(sessionPatientName.toLowerCase()));
      setFilteredPatients(matches);
    } else {
      setFilteredPatients([]);
    }
  }, [sessionPatientName, allPatients]);

  const selectPatientForSession = (name: string) => {
    setSessionPatientName(name);
    setFilteredPatients([]);
  };

  const resetSessionForm = () => {
    setSessionPatientName('');
    setSessionTime('08:00');
    setSessionRoom('');
    setSessionApproach('');
    setSessionProfessional('');
    setSessionNumSessions(1);
    setEditingAppointmentId(null);
  };

  const handleSessionSubmit = async () => {
    if (!sessionPatientName || !sessionTime || !sessionRoom) return alert("Preencha nome, horário e sala");

    if (editingAppointmentId) {
      const updates = {
        name: sessionPatientName,
        date: sessionDate,
        time: sessionTime,
        type: sessionApproach || "Consulta Padrão",
        room: sessionRoom,
        professional: sessionProfessional
      };
      onUpdateAppointment(editingAppointmentId, updates);
      setIsAddSessionModalOpen(false);
      resetSessionForm();
      return;
    }

    const newSession = {
      patientName: sessionPatientName,
      date: sessionDate,
      time: sessionTime,
      approach: sessionApproach || "Consulta Padrão",
      room: sessionRoom,
      professional: sessionProfessional,
      numSessions: sessionNumSessions
    };
    const result = onScheduleSession(newSession);
    if (result && !result.success) {
      return alert(result.errors.join('\n'));
    }

    setIsAddSessionModalOpen(false);
    resetSessionForm();
  };

  const handleStatusUpdate = (id: number, status: string) => {
    onUpdateAgendaStatus(id, status);
  };

  const handleEditAppointment = (appointment: any) => {
    setEditingAppointmentId(appointment.id);
    setSessionPatientName(appointment.name);
    setSessionDate(appointment.date);
    setSessionTime(appointment.time);
    setSessionApproach(appointment.type);
    setSessionRoom(appointment.room);
    setSessionProfessional(appointment.therapistName);
    setIsAddSessionModalOpen(true);
  };

  const onPatientClick = (patientId: any) => {
    setSelectedPatientId(patientId);
    setView('patient');
  };

  const filteredAgenda = useMemo(() => {
    let filtered = therapistAgenda;
    if (professionalFilter !== 'all') {
      filtered = filtered.filter(a => a.therapistName === professionalFilter);
    }
    return filtered;
  }, [therapistAgenda, professionalFilter]);

  const currentViewAgenda = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return filteredAgenda.filter((a: any) => {
      const itemDate = new Date(a.date + 'T00:00:00');
      if (agendaView === 'day') return itemDate.getTime() === today.getTime();
      if (agendaView === 'week') {
        const nextWeek = new Date(today);
        nextWeek.setDate(today.getDate() + 7);
        return itemDate >= today && itemDate <= nextWeek;
      }
      if (agendaView === 'month') return itemDate.getMonth() === today.getMonth() && itemDate.getFullYear() === today.getFullYear();
      return true;
    }).sort((a, b) => a.time.localeCompare(b.time));
  }, [agendaView, filteredAgenda]);

  const groupedAgenda = useMemo(() => {
    if (agendaView === 'day' || agendaView === 'month') return null;
    const items = currentViewAgenda;
    const grouped: any = {};
    items.forEach((item: any) => {
      const dateKey = new Date(item.date + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(item);
    });
    return grouped;
  }, [agendaView, currentViewAgenda]);

  const handleCheckout = async (planId: string) => {
    setLoading(true);
    try {
      const response = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, userId: user.id })
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Erro ao iniciar checkout: ' + data.error);
      }
    } catch (error) {
      console.error('Checkout error:', error);
      alert('Erro de conexão ao processar pagamento.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const specialtiesArray = newRoom.specialties.split(',').map(s => s.trim()).filter(s => s !== '');
    const room = {
      id: Date.now().toString(),
      name: newRoom.name,
      specialties: specialtiesArray
    };
    setRooms(prev => [...prev, room]);
    setNewRoom({ name: '', specialties: '' });
  };

  const handleEditRoom = (room: any) => {
    setEditingRoom(room);
    setNewRoom({ name: room.name, specialties: room.specialties.join(', ') });
  };

  const handleUpdateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRoom) return;
    const specialtiesArray = newRoom.specialties.split(',').map(s => s.trim()).filter(s => s !== '');
    setRooms(prev => prev.map(r => r.id === editingRoom.id ? { ...r, name: newRoom.name, specialties: specialtiesArray } : r));
    setEditingRoom(null);
    setNewRoom({ name: '', specialties: '' });
  };

  const handleDeleteRoom = (id: string) => {
    setRooms(prev => prev.filter(r => r.id !== id));
  };

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

  const renderAgendaContent = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
        <div>
          <h3 className="text-xl font-bold text-slate-900">Agenda Global da Clínica</h3>
          <p className="text-slate-500 text-sm">Visualize e gerencie todos os atendimentos.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-slate-100 p-1 rounded-xl flex gap-1">
            <button 
              onClick={() => setAgendaView('day')} 
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${agendaView === 'day' ? 'bg-white text-[#4318FF] shadow-sm' : 'text-slate-400'}`}
            >
              <Calendar size={14} /> Dia
            </button>
            <button 
              onClick={() => setAgendaView('week')} 
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${agendaView === 'week' ? 'bg-white text-[#4318FF] shadow-sm' : 'text-slate-400'}`}
            >
              <CalendarRange size={14} /> Semana
            </button>
            <button 
              onClick={() => setAgendaView('month')} 
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${agendaView === 'month' ? 'bg-white text-[#4318FF] shadow-sm' : 'text-slate-400'}`}
            >
              <CalendarDays size={14} /> Mês
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
        <div className="mb-6 flex items-center gap-3 overflow-x-auto no-scrollbar pb-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Filtrar Profissional:</span>
          <button 
            onClick={() => setProfessionalFilter('all')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${professionalFilter === 'all' ? 'bg-[#4318FF] text-white shadow-md' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
          >
            Todos
          </button>
          {Array.from(new Set(therapistAgenda.map(a => a.therapistName))).filter(Boolean).map(prof => (
            <button 
              key={prof}
              onClick={() => setProfessionalFilter(prof)}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${professionalFilter === prof ? 'bg-[#4318FF] text-white shadow-md' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
            >
              {prof}
            </button>
          ))}
        </div>

        {agendaView === 'day' ? (
          <div className="space-y-4">
            <button 
              onClick={() => setIsAddSessionModalOpen(true)}
              className="w-full bg-white rounded-2xl border-2 border-dashed border-[#4318FF]/40 p-4 flex items-center justify-center cursor-pointer hover:bg-[#F4F7FE] transition-all gap-3 group mb-4"
            >
              <div className="w-8 h-8 rounded-full bg-[#4318FF]/10 text-[#4318FF] flex items-center justify-center group-hover:scale-110 transition-transform"><Plus size={18} /></div>
              <span className="text-xs font-semibold text-[#4318FF] uppercase tracking-wider">Novo Agendamento</span>
            </button>
            {currentViewAgenda.length > 0 ? (
              currentViewAgenda.map((item, i) => (
                <div key={i} onClick={() => onPatientClick(item.patientId)} className="flex items-center gap-6 p-4 bg-white hover:bg-slate-50 rounded-2xl transition-all border border-slate-100 hover:border-blue-500/30 group cursor-pointer">
                  <div className="w-20 text-center">
                    <p className="text-sm font-black text-[#4318FF]">{item.time}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Hoje</p>
                  </div>
                  <div className="w-1 h-10 bg-blue-100 rounded-full" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-slate-900">{item.patientName}</p>
                    <p className="text-xs text-slate-400 font-medium">Terapeuta: {item.therapistName || 'Dr. Ricardo'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleStatusUpdate(item.id, 'confirmed'); }}
                        className={`px-2 py-1 rounded-lg text-[8px] font-bold uppercase transition-all ${item.status === 'confirmed' ? 'bg-green-600 text-white' : 'bg-green-50 text-green-600 hover:bg-green-600 hover:text-white'}`}
                      >
                        Conf
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleStatusUpdate(item.id, 'pending'); }}
                        className={`px-2 py-1 rounded-lg text-[8px] font-bold uppercase transition-all ${item.status === 'pending' ? 'bg-yellow-500 text-white' : 'bg-yellow-50 text-yellow-600 hover:bg-yellow-500 hover:text-white'}`}
                      >
                        Pend
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleStatusUpdate(item.id, 'canceled'); }}
                        className={`px-2 py-1 rounded-lg text-[8px] font-bold uppercase transition-all ${item.status === 'canceled' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-600 hover:bg-red-600 hover:text-white'}`}
                      >
                        Canc
                      </button>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleEditAppointment(item); }}
                      className="p-2 text-slate-400 hover:text-[#4318FF] hover:bg-blue-50 rounded-xl transition-all"
                    >
                      <Settings size={14} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-20 opacity-50">
                <Calendar size={48} className="mx-auto mb-4 text-slate-300" />
                <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Nenhum atendimento para hoje</p>
              </div>
            )}
          </div>
        ) : agendaView === 'month' ? (
          <CalendarWidget 
            agenda={filteredAgenda} 
            currentDate={calendarDate} 
            onDateChange={setCalendarDate}
            onDateSelect={(dateStr: string) => {
              setSessionDate(dateStr);
              setIsDayDetailsModalOpen(true);
            }}
          />
        ) : (
          <div className="space-y-8">
            {groupedAgenda && Object.keys(groupedAgenda).length > 0 ? (
              Object.keys(groupedAgenda).map(dateKey => (
                <div key={dateKey}>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 ml-1 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#4318FF]" />
                    {dateKey}
                  </h4>
                  <div className="space-y-3">
                    {groupedAgenda[dateKey].map((item: any, i: number) => (
                      <div key={i} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex items-center justify-between hover:bg-white hover:shadow-md transition-all group">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-white rounded-xl flex flex-col items-center justify-center font-bold text-[#4318FF] shadow-sm">
                            <span className="text-[8px] opacity-50 uppercase">ÀS</span>
                            <span className="text-sm">{item.time}</span>
                          </div>
                          <div>
                            <h3 className="font-bold text-slate-900 text-sm">{item.patientName}</h3>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">Terapeuta: {item.therapistName}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`px-2 py-1 rounded-lg text-[8px] font-bold uppercase ${item.status === 'confirmed' ? 'bg-green-100 text-green-600' : item.status === 'pending' ? 'bg-yellow-100 text-yellow-600' : 'bg-red-100 text-red-500'}`}>
                            {item.status}
                          </span>
                          <div className="px-2 py-1 bg-white text-slate-400 rounded-lg text-[8px] font-bold uppercase border border-slate-100">
                            {item.type}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-20 opacity-50">
                <CalendarRange size={48} className="mx-auto mb-4 text-slate-300" />
                <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Nenhum atendimento para esta semana</p>
              </div>
            )}
          </div>
        )}
      </div>

      <DayDetailsModal 
        isOpen={isDayDetailsModalOpen}
        onClose={() => setIsDayDetailsModalOpen(false)}
        date={sessionDate}
        agenda={filteredAgenda}
        onAddSession={() => setIsAddSessionModalOpen(true)}
        onPatientClick={onPatientClick}
      />
    </div>
  );

  const renderRoomsContent = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
        <div>
          <h3 className="text-xl font-bold text-slate-900">Gestão de Salas</h3>
          <p className="text-slate-500 text-sm">Configure as salas disponíveis para reserva.</p>
        </div>
        <button 
          onClick={() => setIsEditingRooms(!isEditingRooms)}
          className={`px-6 py-3 rounded-2xl font-bold text-sm transition-all flex items-center gap-2 ${isEditingRooms ? 'bg-slate-100 text-slate-600' : 'bg-[#4318FF] text-white shadow-lg shadow-blue-500/20'}`}
        >
          {isEditingRooms ? 'Ver Reservas' : 'Editar Salas'}
        </button>
      </div>

      {isEditingRooms ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100 sticky top-6">
              <h4 className="text-sm font-bold text-slate-900 mb-6 flex items-center gap-2">
                <Plus size={18} className="text-[#4318FF]" />
                {editingRoom ? 'Editar Sala' : 'Nova Sala'}
              </h4>
              <form onSubmit={editingRoom ? handleUpdateRoom : handleAddRoom} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Nome da Sala</label>
                  <input 
                    type="text" 
                    value={newRoom.name}
                    onChange={(e) => setNewRoom({...newRoom, name: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl text-sm font-semibold focus:ring-2 focus:ring-blue-500/20 transition-all"
                    placeholder="Ex: Sala 01"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Especialidades</label>
                  <input 
                    type="text" 
                    value={newRoom.specialties}
                    onChange={(e) => setNewRoom({...newRoom, specialties: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl text-sm font-semibold focus:ring-2 focus:ring-blue-500/20 transition-all"
                    placeholder="Ex: ABA, TCC, Fono"
                  />
                  <p className="text-[9px] text-slate-400 mt-1 ml-1">Separe por vírgula</p>
                </div>
                <button 
                  type="submit"
                  className="w-full py-4 bg-[#4318FF] text-white rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 hover:scale-[1.02] transition-all active:scale-[0.98]"
                >
                  {editingRoom ? 'Atualizar Sala' : 'Adicionar Sala'}
                </button>
                {editingRoom && (
                  <button 
                    type="button"
                    onClick={() => { setEditingRoom(null); setNewRoom({ name: '', specialties: '' }); }}
                    className="w-full py-2 text-slate-400 text-[10px] font-bold uppercase tracking-widest"
                  >
                    Cancelar Edição
                  </button>
                )}
              </form>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
              <h4 className="text-sm font-bold text-slate-900 mb-6">Salas Cadastradas</h4>
              <div className="grid gap-4">
                {rooms.map(room => (
                  <div key={room.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 group hover:bg-white hover:shadow-md transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-white text-slate-400 rounded-xl flex items-center justify-center group-hover:text-[#4318FF] transition-all">
                        <DoorOpen size={24} />
                      </div>
                      <div>
                        <h5 className="font-bold text-slate-900">{room.name}</h5>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {room.specialties.map((s: string) => (
                            <span key={s} className="px-2 py-0.5 bg-white text-slate-500 rounded-full text-[9px] font-bold uppercase tracking-wider border border-slate-100">{s}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleEditRoom(room)}
                        className="p-2 text-slate-400 hover:text-[#4318FF] hover:bg-blue-50 rounded-xl transition-all"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        onClick={() => handleDeleteRoom(room.id)}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <RoomReservation 
          user={user}
          rooms={rooms}
          reservations={roomReservations}
          onDeleteReservation={onDeleteRoomReservation}
          onBack={() => setIsEditingRooms(true)}
        />
      )}
    </div>
  );

  const renderDashboard = () => (
    <div className="space-y-12 animate-in fade-in duration-500">
      {/* Agenda Global Section */}
      <section className="space-y-6">
        <div className="flex items-center gap-3 px-2">
          <div className="p-2 bg-blue-50 text-[#4318FF] rounded-xl"><Calendar size={24} /></div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Agenda Global</h2>
        </div>
        {renderAgendaContent()}
      </section>

      {/* Gestão de Salas Section */}
      <section className="space-y-6">
        <div className="flex items-center gap-3 px-2">
          <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl"><DoorOpen size={24} /></div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Gestão de Salas</h2>
        </div>
        {renderRoomsContent()}
      </section>

      {/* Gestão de Equipe Section */}
      <section className="space-y-6">
        <div className="flex items-center gap-3 px-2">
          <div className="p-2 bg-purple-50 text-purple-600 rounded-xl"><Users size={24} /></div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Gestão de Equipe</h2>
        </div>
        <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
          <TeamManagement user={user} />
        </div>
      </section>

      {/* Stats Grid - Moved below */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-8 border-t border-slate-100">
        {[
          { id: 'patients', label: 'Pacientes Ativos', value: allPatients.length.toString(), icon: Users, trend: '+3', color: 'bg-purple-50 text-purple-600' },
          { id: 'agenda', label: 'Sessões Realizadas', value: '142', icon: Calendar, trend: '+15', color: 'bg-orange-50 text-orange-600' },
        ].map((stat, i) => (
          <div 
            key={i} 
            onClick={() => setActiveTab(stat.id as any)}
            className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100 hover:shadow-xl hover:border-blue-500/30 transition-all group cursor-pointer"
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`w-14 h-14 ${stat.color} rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform`}>
                <stat.icon size={28} />
              </div>
              <div className="flex flex-col items-end">
                <span className="text-xs font-bold text-green-500 bg-green-50 px-2 py-1 rounded-lg">{stat.trend}</span>
                <span className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">Ver Detalhes</span>
              </div>
            </div>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">{stat.label}</p>
            <h3 className="text-3xl font-bold text-slate-900">{stat.value}</h3>
          </div>
        ))}
      </div>

      {/* Removed financial and performance charts as they belong to DRE */}
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

  if (view === 'patient' && selectedPatientId) {
    const patient = allPatients.find(p => p.id === selectedPatientId);
    return (
      <PatientDetailView 
        patient={patient} 
        onBack={() => setView('home')} 
        history={patientsHistory.filter(h => h.patientId === selectedPatientId)}
        notes={therapistNotes.filter(n => n.patientId === selectedPatientId)}
        onAddNote={onAddNote}
        protocols={protocols}
        userRole={user.role}
      />
    );
  }

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
            { id: 'patients', label: 'Pacientes', icon: ClipboardList },
            { id: 'protocols', label: 'Protocolos', icon: ClipboardCheck },
            { id: 'logs', label: 'Log de Atividades', icon: History },
            { id: 'settings', label: 'Configurações', icon: Settings },
            { id: 'financial', label: 'Financeiro (DRE)', icon: DollarSign, badge: 'EM BREVE' },
            { id: 'flow', label: 'Verto Flow', icon: Zap, badge: 'EM BREVE' },
            { id: 'birthdays', label: 'Aniversariantes', icon: Heart, badge: 'EM BREVE' },
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
              {item.badge && <span className="ml-auto text-[8px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">{item.badge}</span>}
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
            <SettingsMenu 
              user={user} 
              onLogout={onLogout} 
              onViewTeam={() => setActiveTab('team')}
              onOpenInvitations={() => setShowInvitationModal(true)}
              onViewProfile={() => setActiveTab('settings')}
              onViewBilling={() => setActiveTab('billing')}
              onOpenOnboarding={onOpenOnboarding}
            />
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
                <div className="mb-6">
                  <button onClick={() => setActiveTab('dashboard')} className="flex items-center gap-2 text-slate-400 hover:text-slate-900 font-bold text-xs uppercase tracking-widest transition-all">
                    <ChevronRight size={16} className="rotate-180" /> Voltar ao Dashboard
                  </button>
                </div>
                <TeamManagement user={user} />
              </motion.div>
            )}
            {activeTab === 'financial' && (
              <motion.div key="financial" initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -20}} className="flex flex-col items-center justify-center py-20 bg-white rounded-[40px] shadow-sm border border-slate-100 p-8 text-center">
                <div className="w-20 h-20 bg-blue-50 text-[#4318FF] rounded-[32px] flex items-center justify-center mb-6">
                  <DollarSign size={40} />
                </div>
                <h3 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Financeiro e DRE</h3>
                <p className="text-slate-500 font-medium mb-8 max-w-md">Esta funcionalidade está sendo preparada para você. Em Breve.</p>
                <span className="px-6 py-2 bg-[#4318FF] text-white rounded-full text-xs font-bold uppercase tracking-widest shadow-lg shadow-blue-500/20">Em Breve</span>
              </motion.div>
            )}
            {activeTab === 'flow' && (
              <motion.div key="flow" initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -20}} className="flex flex-col items-center justify-center py-20 bg-white rounded-[40px] shadow-sm border border-slate-100 p-8 text-center">
                <div className="w-20 h-20 bg-blue-50 text-[#4318FF] rounded-[32px] flex items-center justify-center mb-6">
                  <Zap size={40} />
                </div>
                <h3 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Verto Flow</h3>
                <p className="text-slate-500 font-medium mb-8 max-w-md">
                  O coordenador vai poder gerenciar uma lista de espera inteligente para que a agenda seja preenchida por outro paciente caso haja algum cancelamento e horário disponível.
                </p>
                <span className="px-6 py-2 bg-[#4318FF] text-white rounded-full text-xs font-bold uppercase tracking-widest shadow-lg shadow-blue-500/20">Em Breve</span>
              </motion.div>
            )}
            {activeTab === 'birthdays' && (
              <motion.div key="birthdays" initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -20}} className="flex flex-col items-center justify-center py-20 bg-white rounded-[40px] shadow-sm border border-slate-100 p-8 text-center">
                <div className="w-20 h-20 bg-pink-50 text-pink-600 rounded-[32px] flex items-center justify-center mb-6">
                  <Heart size={40} />
                </div>
                <h3 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Aniversariantes</h3>
                <p className="text-slate-500 font-medium mb-8 max-w-md">
                  Configuração que possibilite o envio de mensagens automáticas de feliz aniversário aos pacientes e profissionais da clínica.
                </p>
                <span className="px-6 py-2 bg-[#4318FF] text-white rounded-full text-xs font-bold uppercase tracking-widest shadow-lg shadow-blue-500/20">Em Breve</span>
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
                        <button 
                          onClick={() => onPatientClick(patient.id)}
                          className="text-[10px] font-bold text-[#4318FF] uppercase tracking-widest hover:underline flex items-center gap-1"
                        >
                          <FileText size={12} /> Prontuário Completo
                        </button>
                        <span className="px-2 py-1 bg-green-100 text-green-600 rounded-lg text-[10px] font-bold uppercase">Ativo</span>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
            {activeTab === 'agenda' && (
              <motion.div key="agenda" initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -20}} className="space-y-6">
                <div className="mb-2">
                  <button onClick={() => setActiveTab('dashboard')} className="flex items-center gap-2 text-slate-400 hover:text-slate-900 font-bold text-xs uppercase tracking-widest transition-all">
                    <ChevronRight size={16} className="rotate-180" /> Voltar ao Dashboard
                  </button>
                </div>
                {renderAgendaContent()}
              </motion.div>
            )}
            {activeTab === 'billing' && (
              <motion.div key="billing" initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -20}} className="max-w-4xl mx-auto space-y-8">
                <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
                  <div className="flex items-center gap-4 mb-8">
                    <div className="p-3 bg-blue-50 text-[#4318FF] rounded-2xl">
                      <CreditCard size={24} />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-slate-900 tracking-tight">Assinatura e Planos</h3>
                      <p className="text-slate-500 font-medium">Gerencie seu plano e faturamento.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                    <div className="p-6 bg-slate-50 rounded-[32px] border border-slate-100">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Plano Atual</p>
                      <h4 className="text-xl font-bold text-slate-900">{user.planName || 'Verto Pro'}</h4>
                      <p className="text-emerald-500 text-xs font-bold mt-2 flex items-center gap-1">
                        <CheckCircle2 size={12} /> Ativo
                      </p>
                    </div>
                    <div className="p-6 bg-slate-50 rounded-[32px] border border-slate-100">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Próximo Vencimento</p>
                      <h4 className="text-xl font-bold text-slate-900">15/05/2026</h4>
                      <p className="text-slate-400 text-xs font-medium mt-2">Renovação automática</p>
                    </div>
                    <div className="p-6 bg-slate-50 rounded-[32px] border border-slate-100">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Valor Mensal</p>
                      <h4 className="text-xl font-bold text-slate-900">R$ {user.planPrice?.toFixed(2).replace('.', ',') || '149,90'}</h4>
                      <p className="text-blue-500 text-xs font-bold mt-2 cursor-pointer hover:underline" onClick={() => setShowBillingDetails(!showBillingDetails)}>
                        {showBillingDetails ? 'Ocultar detalhes' : 'Ver detalhes'}
                      </p>
                    </div>
                  </div>

                  {showBillingDetails && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mb-12 space-y-6 overflow-hidden">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-slate-50 p-6 rounded-[32px] border border-slate-100">
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Histórico de Pagamentos</h4>
                          <div className="space-y-3">
                            {billingHistory.map((bill, i) => (
                              <div key={i} className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-100">
                                <div>
                                  <p className="text-sm font-bold text-slate-900">{bill.date}</p>
                                  <p className="text-[10px] text-slate-400 font-medium">{bill.method}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-sm font-bold text-slate-900">R$ {bill.amount.toFixed(2).replace('.', ',')}</p>
                                  <span className="text-[8px] font-bold text-green-500 uppercase">Pago</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="bg-slate-50 p-6 rounded-[32px] border border-slate-100">
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Próximos Vencimentos</h4>
                          <div className="space-y-3">
                            {upcomingBills.map((bill, i) => (
                              <div key={i} className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-100">
                                <div>
                                  <p className="text-sm font-bold text-slate-900">{bill.date}</p>
                                  <p className="text-[10px] text-slate-400 font-medium">Renovação Automática</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-sm font-bold text-slate-900">R$ {bill.amount.toFixed(2).replace('.', ',')}</p>
                                  <span className="text-[8px] font-bold text-blue-500 uppercase">Agendado</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  <h4 className="text-lg font-bold text-slate-900 mb-6">Upgrade de Plano</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className={`p-8 rounded-[40px] border-2 transition-all ${user.planName === 'Crescimento' ? 'border-[#4318FF] bg-blue-50/30' : 'border-slate-100 hover:border-blue-200'}`}>
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <h5 className="text-xl font-bold text-slate-900">Crescimento</h5>
                          <p className="text-slate-500 text-sm">Para clínicas em crescimento</p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-black text-[#4318FF]">R$ 399,90</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase">por mês</p>
                        </div>
                      </div>
                      <ul className="space-y-3 mb-8">
                        {['3 a 7 Profissionais', 'Dashboard de Evolução Clínica', 'Relatórios Consolidados', 'Gestão Financeira Avançada', 'Suporte Prioritário'].map(feat => (
                          <li key={feat} className="flex items-center gap-2 text-sm text-slate-600 font-medium">
                            <CheckCircle2 size={16} className="text-emerald-500" /> {feat}
                          </li>
                        ))}
                      </ul>
                      <button 
                        onClick={() => handleCheckout('growth_plan_id')}
                        disabled={loading || user.planName === 'Crescimento'}
                        className={`w-full py-4 rounded-2xl font-bold text-sm transition-all ${user.planName === 'Crescimento' ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-[#4318FF] text-white shadow-lg shadow-blue-500/20 hover:scale-[1.02]'}`}
                      >
                        {user.planName === 'Crescimento' ? 'Plano Atual' : 'Fazer Upgrade'}
                      </button>
                    </div>

                    <div className="p-8 rounded-[40px] border-2 transition-all border-slate-100 hover:border-blue-200">
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <h5 className="text-xl font-bold text-slate-900">Avançado</h5>
                          <p className="text-slate-500 text-sm">Para clínicas estabelecidas</p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-black text-[#4318FF]">R$ 679,90</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase">por mês</p>
                        </div>
                      </div>
                      <ul className="space-y-3 mb-8">
                        {['7 a 12 Profissionais', 'Múltiplos Workspaces de PEI', 'API de Integração de Dados', 'Gerente de Conta Dedicado'].map(feat => (
                          <li key={feat} className="flex items-center gap-2 text-sm text-slate-600 font-medium">
                            <CheckCircle2 size={16} className="text-emerald-500" /> {feat}
                          </li>
                        ))}
                      </ul>
                      <button 
                        onClick={() => handleCheckout('advanced_plan_id')}
                        disabled={loading}
                        className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold text-sm shadow-lg shadow-slate-900/20 hover:scale-[1.02] transition-all"
                      >
                        Fazer Upgrade
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
            {activeTab === 'rooms' && (
              <motion.div key="rooms" initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -20}} className="space-y-6">
                <div className="mb-2">
                  <button onClick={() => setActiveTab('dashboard')} className="flex items-center gap-2 text-slate-400 hover:text-slate-900 font-bold text-xs uppercase tracking-widest transition-all">
                    <ChevronRight size={16} className="rotate-180" /> Voltar ao Dashboard
                  </button>
                </div>
                {renderRoomsContent()}
              </motion.div>
            )}
            {activeTab === 'protocols' && (
              <div className="animate-fade-in">
                <ProtocolManagementSystem 
                  protocols={protocols} 
                  onSaveProtocol={(p: any) => {
                    const exists = protocols.find((old: any) => old.id === p.id);
                    if (exists) {
                      setProtocols(protocols.map((old: any) => old.id === p.id ? p : old));
                    } else {
                      setProtocols([...protocols, p]);
                    }
                  }} 
                  onDeleteProtocol={(id: any) => setProtocols(protocols.filter((p: any) => p.id !== id))} 
                  onBack={() => setActiveTab('overview')} 
                />
              </div>
            )}
            {activeTab === 'logs' && (
              <div className="space-y-6 animate-fade-in">
                <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
                  <h3 className="text-xl font-bold text-slate-900 mb-6">Log de Atividades do Sistema</h3>
                  <div className="space-y-4">
                    {activityLogs && activityLogs.length > 0 ? (
                      activityLogs.map((log, i) => (
                        <div key={i} className="flex items-start gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <div className={`p-2 rounded-xl ${
                            log.type === 'management' ? 'bg-purple-100 text-purple-600' : 
                            log.type === 'clinical' ? 'bg-blue-100 text-blue-600' : 
                            'bg-slate-200 text-slate-600'
                          }`}>
                            <History size={18} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-sm font-bold text-slate-900">{log.title}</p>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{log.time || new Date(log.created_at).toLocaleString()}</span>
                            </div>
                            <p className="text-xs text-slate-500 leading-relaxed">{log.content}</p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-20">
                        <div className="w-20 h-20 bg-slate-50 rounded-[32px] flex items-center justify-center mx-auto mb-6 text-slate-200">
                          <History size={40} />
                        </div>
                        <h4 className="text-lg font-bold text-slate-900 mb-2">Nenhuma atividade registrada</h4>
                        <p className="text-sm text-slate-400 max-w-xs mx-auto">As ações realizadas no sistema aparecerão aqui para acompanhamento da coordenação.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'settings' && (
              <motion.div key="settings" initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -20}} className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-xl font-bold text-slate-900">Configurações da Clínica</h3>
                  <button className="px-6 py-3 bg-[#4318FF] text-white rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 hover:bg-blue-700 transition-all">
                    Salvar Alterações
                  </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Horários e Sessões</h4>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-2">Duração Padrão da Sessão</label>
                        <select 
                          defaultValue={user.clinicSettings?.defaultSessionDuration || "50"}
                          className="w-full p-4 bg-slate-50 border-none rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                        >
                          <option value="30">30 minutos</option>
                          <option value="45">45 minutos</option>
                          <option value="50">50 minutos</option>
                          <option value="60">60 minutos</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-2">Início do Expediente</label>
                          <input type="time" defaultValue={user.clinicSettings?.workStart || "08:00"} className="w-full p-4 bg-slate-50 border-none rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-2">Fim do Expediente</label>
                          <input type="time" defaultValue={user.clinicSettings?.workEnd || "18:00"} className="w-full p-4 bg-slate-50 border-none rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Plano e Assinatura</h4>
                    <div className="p-6 bg-blue-50 rounded-3xl border border-blue-100">
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-sm font-bold text-blue-900">Plano {user.planName || 'Essencial'}</p>
                        <span className="px-3 py-1 bg-blue-100 text-[#4318FF] rounded-lg text-[10px] font-bold uppercase">Ativo</span>
                      </div>
                      <p className="text-xs text-blue-600 mb-6">Sua clínica possui acesso a todas as ferramentas de gestão e prontuário eletrônico.</p>
                      <button 
                        onClick={() => setActiveTab('billing')}
                        className="w-full py-3 bg-white text-[#4318FF] rounded-2xl font-bold text-xs shadow-sm hover:shadow-md transition-all"
                      >
                        Gerenciar Assinatura
                      </button>
                    </div>
                  </div>
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

      {isAddSessionModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setIsAddSessionModalOpen(false)}>
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl animate-pop relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setIsAddSessionModalOpen(false)} className="absolute top-6 right-6 text-slate-400 hover:text-slate-600"><X size={24}/></button>
            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2 tracking-tight"><CalendarPlus size={24} className="text-[#4318FF]"/> {editingAppointmentId ? 'Editar Agendamento' : 'Agendar Sessão'}</h2>
            <div className="space-y-4">
              <div className="relative">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Paciente</label>
                <input 
                  type="text" 
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 font-semibold text-slate-700" 
                  placeholder="Buscar..." 
                  value={sessionPatientName} 
                  onChange={e => setSessionPatientName(e.target.value)} 
                />
                {filteredPatients.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-slate-100 rounded-xl shadow-xl mt-1 z-20 max-h-40 overflow-y-auto no-scrollbar">
                    {filteredPatients.map(p => (
                      <div key={p.id} onClick={() => selectPatientForSession(p.name)} className="p-3 hover:bg-slate-50 cursor-pointer text-sm font-semibold text-slate-700 border-b border-slate-50 last:border-0 flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-blue-50 text-[#4318FF] flex items-center justify-center text-xs">{p.name.charAt(0)}</div>
                        {p.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Data</label>
                  <input type="date" className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700" value={sessionDate} onChange={e => setSessionDate(e.target.value)} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Hora</label>
                  <input type="time" className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700" value={sessionTime} onChange={e => setSessionTime(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Abordagem</label>
                  <select className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700" value={sessionApproach} onChange={e => setSessionApproach(e.target.value)}>
                    <option value="">Selecione...</option>
                    <option value="Consulta Padrão">Consulta Padrão</option>
                    <option value="TCC">TCC</option>
                    <option value="ABA">ABA</option>
                    <option value="Integração Sensorial">Integração Sensorial</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Sala</label>
                  <select className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700" value={sessionRoom} onChange={e => setSessionRoom(e.target.value)}>
                    <option value="">Selecione...</option>
                    {rooms.map((room: any) => (
                      <option key={room.id} value={room.id}>{room.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Terapeuta Responsável</label>
                <input type="text" className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700" placeholder="Nome do Profissional" value={sessionProfessional} onChange={e => setSessionProfessional(e.target.value)} />
              </div>
              <button onClick={handleSessionSubmit} className="w-full bg-[#4318FF] text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-500/20 hover:opacity-90 transition-all mt-2 active:scale-95 uppercase tracking-widest">
                {editingAppointmentId ? 'Salvar Alterações' : 'Confirmar Agendamento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
