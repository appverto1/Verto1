import React, { useState, useEffect, useMemo } from 'react';
import { HelpCircle, ShoppingBag, UserPlus, LogOut, Search, Menu, X, Calendar, CalendarRange, CalendarDays, Plus, CalendarPlus, MessageCircle, ChevronRight, Settings, Users, Rocket, ShieldCheck, Lightbulb, ClipboardList, Clock, Filter as FilterIcon, Camera, Share2, AlertCircle, CheckCircle2, LayoutDashboard, DoorOpen } from 'lucide-react';
import { LogoVerto } from './Common';
import { googleCalendarService } from '../services/googleCalendarService';
import { TutorialOverlay } from './Tutorial';
import { AnamnesisModal } from './Anamnesis';
import { DayDetailsModal, CalendarWidget } from './Calendar';
import { ProtocolManagementSystem } from './Protocols';
import { PatientRegistry } from './PatientRegistry';
import { PatientDetailView } from './PatientDetailView';
import { TeamManagement } from './TeamManagement';
import { SettingsMenu } from './SettingsMenu';
import { InvitationModal } from './InvitationModal';
import { RoomReservation } from './RoomReservation';

export const TherapistDashboard = ({ user, onLogout, protocols, setProtocols, therapistAgenda, patientsHistory, therapistNotes, onAddNote, allTasks, onAddTask, onUpdateHistoryItem, onAddPatient, onUpdateHistoryItem: onUpdateHistoryItemProp, onUpdateTask, allPatients, clinicalRecords, onScheduleSession, onUpdatePatient, onRecordTrial, onDeleteHistoryItem, activityLogs, onAddActivityLog, onViewTeam, onUpdateAgendaStatus }: any) => { 
  const [view, setView] = useState('home'); 
  const [selectedPatientId, setSelectedPatientId] = useState<any>(null); 
  const [runTutorial, setRunTutorial] = useState(false); 
  const [tutorialStep, setTutorialStep] = useState(0); 
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [isAddSessionModalOpen, setIsAddSessionModalOpen] = useState(false);
  const [isMarketplaceOpen, setIsMarketplaceOpen] = useState(false);
  const [isFinancialOpen, setIsFinancialOpen] = useState(false);
  const [showInvitationModal, setShowInvitationModal] = useState(false);
  const [payments, setPayments] = useState<any[]>([
    { id: 1, patientId: 101, patientName: 'Alexandre', amount: 150, date: new Date().toISOString(), method: 'pix', status: 'paid' },
    { id: 2, patientId: 102, patientName: 'Júlia S.', amount: 200, date: new Date().toISOString(), method: 'card', status: 'pending' }
  ]);
  const [professionalFilter, setProfessionalFilter] = useState('all');
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedPaymentPatient, setSelectedPaymentPatient] = useState<any>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('pix');
  const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
  const [sessionPatientName, setSessionPatientName] = useState("");
  const [filteredPatients, setFilteredPatients] = useState<any[]>([]);
  const [sessionTime, setSessionTime] = useState("");
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0]);
  const [sessionApproach, setSessionApproach] = useState("");
  const [sessionRoom, setSessionRoom] = useState("");
  const [sessionProfessional, setSessionProfessional] = useState("Dra. Raísa");
  const [agendaView, setAgendaView] = useState('day'); 
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [isDayDetailsModalOpen, setIsDayDetailsModalOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false); 

  useEffect(() => {
    if (runTutorial) {
      if (tutorialStep === 2 || tutorialStep === 3) setIsMenuOpen(true);
      else setIsMenuOpen(false);
    }
  }, [runTutorial, tutorialStep]);

  const dashboardSteps = [ 
    { targetId: 'welcome-header', title: 'Bem-vindo ao Verto!', content: 'Este é o seu painel de controle. Aqui você gerencia seus pacientes e agenda.', placement: 'bottom' }, 
    { targetId: 'menu-btn', title: 'Menu Principal', content: 'Acesse busca de pacientes, marketplace, cadastro e configurações da clínica por aqui.', placement: 'bottom' },
    { targetId: 'menu-search', title: 'Busca de Pacientes', content: 'Encontre prontuários rapidamente digitando o nome do paciente aqui.', placement: 'bottom' },
    { targetId: 'menu-new-patient', title: 'Novo Cadastro', content: 'Adicione novos pacientes ao sistema preenchendo a ficha de anamnese completa.', placement: 'bottom' },
    { targetId: 'agenda-toggles', title: 'Visualização da Agenda', content: 'Alterne entre visão Diária, Semanal ou Mensal para organizar seus atendimentos.', placement: 'bottom' },
    { targetId: 'schedule-list', title: 'Sua Agenda', content: 'Aqui você vê todos os seus compromissos do dia. Arraste para o lado para ver mais.', placement: 'bottom' }, 
    { targetId: 'schedule-btn', title: 'Agendar Sessão', content: 'Use este botão para marcar uma sessão avulsa rapidamente com pacientes já cadastrados.', placement: 'bottom' }, 
    { targetId: 'summary-stats', title: 'Resumo de Atendimentos', content: 'Acompanhe o status das suas sessões: confirmadas, pendentes ou ausentes.', placement: 'top' },
    { targetId: 'patient-card-0', title: 'Acessar Prontuário', content: 'Clique no paciente para ver detalhes, enviar tarefas e avaliar progresso.', placement: 'bottom' },
    { targetId: 'protocols-btn', title: 'Gestão de Protocolos', content: 'Crie e edite as estruturas de avaliação (VB-MAPP, AFLS, etc) que você utiliza.', placement: 'top' },
    { targetId: 'patients-btn', title: 'Meus Pacientes', content: 'Acesse a lista completa de todos os seus pacientes cadastrados e seus prontuários.', placement: 'top' },
    { targetId: 'clinic-btn', title: 'Gestão da Clínica', content: 'Acompanhe o financeiro, DRE e metas de faturamento da sua clínica ou consultório.', placement: 'top' }
  ]; 
  
  const handleSaveProtocol = (updatedProtocol: any) => { const exists = protocols.find((p: any) => p.id === updatedProtocol.id); if (exists) { setProtocols((prev: any) => prev.map((p: any) => p.id === updatedProtocol.id ? updatedProtocol : p)); } else { setProtocols((prev: any) => [...prev, updatedProtocol]); } }; 
  const handleDeleteProtocol = (protocolId: any) => { setProtocols((prev: any) => prev.filter((p: any) => p.id !== protocolId)); }; 
  const onPatientClick = (patientId: any) => { 
    setSelectedPatientId(patientId); 
    setView('patient'); 
    setIsDayDetailsModalOpen(false); 
  }; 
  
  const handleRegisterSubmit = (formData: any) => { 
    if (!formData.nome) return alert("Nome é obrigatório"); 
    const newId = Date.now(); 
    const newPatientData = { 
      id: newId, 
      name: formData.nome, 
      email: formData.email,
      age: formData.idade ? parseInt(formData.idade) : undefined,
      phone: formData.telefone, 
      address: formData.endereco, 
      diagnosis: formData.motivoConsulta, 
      anamnesisData: formData, 
      scheduleImmediate: formData.scheduleImmediate, 
      date: formData.date, 
      time: formData.time, 
      approach: formData.approach, 
      room: formData.room, 
      professional: formData.professional 
    }; 
    onAddPatient(newPatientData); 
    setIsRegisterModalOpen(false); 
    setSelectedPatientId(newId); 
    setView('patient'); 
  }; 
  
  useEffect(() => { if (sessionPatientName) { const matches = allPatients.filter((p: any) => p.name.toLowerCase().includes(sessionPatientName.toLowerCase())); setFilteredPatients(matches); } else { setFilteredPatients([]); } }, [sessionPatientName, allPatients]); 
  const selectPatientForSession = (name: string) => { setSessionPatientName(name); setFilteredPatients([]); }; 
  const handleSessionSubmit = async () => { 
    if(!sessionPatientName || !sessionTime) return alert("Preencha nome e horário"); 
    const newSession = { patientName: sessionPatientName, date: sessionDate, time: sessionTime, approach: sessionApproach || "Consulta Padrão", room: sessionRoom || "Sala 01", professional: sessionProfessional }; 
    onScheduleSession(newSession); 
    
    // Sync to Google Calendar if connected
    const isConnected = await googleCalendarService.isConnected();
    if (isConnected) {
      const startTime = `${sessionDate}T${sessionTime}:00`;
      const endDateTime = new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString(); // Default 1h
      await googleCalendarService.syncEvent({
        title: `Verto: ${sessionPatientName} - ${sessionApproach || 'Consulta'}`,
        description: `Sessão agendada via Verto Health. Sala: ${sessionRoom || 'Sala 01'}`,
        startTime,
        endTime: endDateTime,
        location: sessionRoom || 'Clínica Verto'
      });
    }

    setIsAddSessionModalOpen(false); 
    setSessionPatientName(""); 
    setSessionTime(""); 
    setSessionDate(new Date().toISOString().split('T')[0]); 
    setSessionApproach(""); 
    setSessionRoom(""); 
    setSessionProfessional("Dra. Raísa"); 
  }; 
  
  const handleStatusUpdate = (appointmentId: any, newStatus: string) => {
    if (onUpdateAgendaStatus) {
      onUpdateAgendaStatus(appointmentId, newStatus);
    }
    onAddActivityLog("Atualização de Agenda", `Status do agendamento ${appointmentId} alterado para: ${newStatus}`, 'management');
  };

  const handleAddPayment = () => {
    if (!selectedPaymentPatient || !paymentAmount) return alert("Preencha todos os campos");
    const newPayment = {
      id: Date.now(),
      patientId: selectedPaymentPatient.id,
      patientName: selectedPaymentPatient.name,
      amount: parseFloat(paymentAmount),
      date: new Date().toISOString(),
      method: paymentMethod,
      status: 'paid'
    };
    setPayments(prev => [newPayment, ...prev]);
    setIsPaymentModalOpen(false);
    setPaymentAmount('');
    setSelectedPaymentPatient(null);
  };

  const confirmedCount = therapistAgenda.filter((a: any) => a.status === 'confirmed').length;
  const pendingCount = therapistAgenda.filter((a: any) => a.status === 'pending').length;
  const canceledCount = therapistAgenda.filter((a: any) => a.status === 'canceled').length;

  const getFilteredAgenda = () => {
    const today = new Date();
    today.setHours(0,0,0,0);
    
    let list = therapistAgenda;
    
    // Filter by professional if not 'all'
    if (professionalFilter !== 'all') {
      list = list.filter((item: any) => item.professional === professionalFilter);
    }
    
    return list.filter((item: any) => {
      const itemDate = new Date(item.date + 'T00:00:00');
      if (agendaView === 'day') {
        return itemDate.getTime() === today.getTime();
      } else if (agendaView === 'week') {
        const nextWeek = new Date(today);
        nextWeek.setDate(today.getDate() + 7);
        return itemDate >= today && itemDate <= nextWeek;
      } else if (agendaView === 'month') {
        return itemDate.getMonth() === today.getMonth() && itemDate.getFullYear() === today.getFullYear();
      }
      return true;
    }).sort((a: any, b: any) => {
      const dateA: any = new Date(`${a.date}T${a.time}`);
      const dateB: any = new Date(`${b.date}T${b.time}`);
      return dateA - dateB;
    });
  };

  const groupedAgenda = useMemo(() => {
    if (agendaView === 'day' || agendaView === 'month') return null; 
    const items = getFilteredAgenda();
    const grouped: any = {};
    items.forEach((item: any) => {
      const dateKey = new Date(item.date + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(item);
    });
    return grouped;
  }, [agendaView, therapistAgenda]);

  const filteredAgendaList = agendaView === 'day' ? getFilteredAgenda() : [];

  const marketProtocols = [
    { id: 'm1', title: 'VB-MAPP Completo', price: 'R$ 1,90', badge: 'Popular', badgeColor: 'bg-orange-500', description: 'Avaliação de marcos de desenvolvimento e comportamento verbal para crianças com autismo.', includes: ['Checklist Completo', 'Planilhas de Registro', 'Sugestões de Metas'], color: 'bg-purple-100 text-purple-600' },
    { id: 'm2', title: 'ESDM - Denver II', price: 'R$ 1,50', badge: 'Novo', badgeColor: 'bg-blue-500', description: 'Checklist de competências para intervenção precoce (12 a 60 meses).', includes: ['Avaliação por Domínios', 'Gráficos de Evolução', 'Passo a Passo'], color: 'bg-blue-100 text-blue-600' },
    { id: 'm3', title: 'Habilidades Sociais', price: 'R$ 0,90', badge: 'Essencial', badgeColor: 'bg-green-500', description: 'Protocolo exclusivo Verto para treino de interação, empatia e regras sociais.', includes: ['30 Tarefas Prontas', 'Reforços Visuais', 'Guia do Terapeuta'], color: 'bg-green-100 text-green-600' },
    { id: 'm4', title: 'Ansiedade e TCC', price: 'R$ 1,20', badge: 'Adultos', badgeColor: 'bg-yellow-500', description: 'Estrutura para manejo clínico de transtornos de ansiedade utilizando TCC.', includes: ['Registros de Pensamentos', 'Escalas de Humor', 'Exercícios Práticos'], color: 'bg-orange-100 text-orange-600' }
  ];

  if (view === 'protocols') return <ProtocolManagementSystem protocols={protocols} onSaveProtocol={handleSaveProtocol} onDeleteProtocol={handleDeleteProtocol} onBack={() => setView('home')} />; 
  if (view === 'patients_registry') return <PatientRegistry patients={allPatients} clinicalRecords={clinicalRecords} onBack={() => setView('home')} onSelectPatient={onPatientClick} userRole={user.role} />; 
  if (view === 'room_reservation') return <RoomReservation user={user} />;
  if (view === 'clinic') return <div className="p-8 text-center bg-white min-h-screen flex flex-col items-center justify-center"><Rocket size={64} className="text-emerald-500 mb-4 animate-bounce" /><h2 className="text-2xl font-bold text-gray-800">Gestão da Clínica</h2><p className="text-gray-500 max-w-md mx-auto mt-2">Esta funcionalidade está sendo atualizada para incluir novos relatórios financeiros e DRE automático.</p><button onClick={() => setView('home')} className="mt-8 px-8 py-3 bg-emerald-500 text-white rounded-2xl font-bold shadow-lg shadow-emerald-500/20 hover:opacity-90 transition-all">Voltar ao Início</button></div>;
  
  if (view === 'financial') {
    return (
      <div className="p-6 bg-slate-50 min-h-screen">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button onClick={() => setView('home')} className="p-2 hover:bg-white rounded-xl transition-all"><ChevronRight className="rotate-180" /></button>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Financeiro & Pagamentos</h2>
          </div>
          <button 
            onClick={() => setIsPaymentModalOpen(true)}
            className="bg-[#4318FF] text-white px-6 py-3 rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 flex items-center gap-2 hover:scale-105 transition-all"
          >
            <Plus size={18} /> Registrar Pagamento
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-100">
              <h3 className="text-lg font-bold text-slate-900 mb-6">Últimos Recebimentos</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left border-b border-slate-50">
                      <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Paciente</th>
                      <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Valor</th>
                      <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data</th>
                      <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Método</th>
                      <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {payments.map(p => (
                      <tr key={p.id} className="group hover:bg-slate-50 transition-all">
                        <td className="py-4 font-semibold text-slate-700">{p.patientName}</td>
                        <td className="py-4 font-bold text-[#4318FF]">R$ {p.amount.toFixed(2)}</td>
                        <td className="py-4 text-slate-500 text-sm">{new Date(p.date).toLocaleDateString()}</td>
                        <td className="py-4"><span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[10px] font-bold uppercase">{p.method}</span></td>
                        <td className="py-4"><span className="px-3 py-1 bg-green-100 text-green-600 rounded-full text-[10px] font-bold uppercase">Pago</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-100">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-red-50 text-red-500 rounded-xl"><AlertCircle size={20} /></div>
                <h3 className="text-lg font-bold text-slate-900">Inadimplência</h3>
              </div>
              <div className="space-y-4">
                {allPatients.filter(p => p.status === 'delinquent').length > 0 ? (
                  allPatients.filter(p => p.status === 'delinquent').map(p => (
                    <div key={p.id} className="p-4 bg-red-50/50 rounded-2xl border border-red-100 flex items-center justify-between">
                      <div>
                        <p className="font-bold text-slate-900 text-sm">{p.name}</p>
                        <p className="text-[10px] text-red-500 font-semibold">Débito em aberto</p>
                      </div>
                      <button className="p-2 bg-white text-red-500 rounded-xl shadow-sm hover:bg-red-500 hover:text-white transition-all">
                        <MessageCircle size={16} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 opacity-50">
                    <CheckCircle2 size={32} className="mx-auto mb-2 text-green-500" />
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Tudo em dia!</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (view === 'patient' && selectedPatientId) { 
    const patient = allPatients.find((p: any) => p.id === selectedPatientId) || therapistAgenda.find((a: any) => a.id === selectedPatientId) || { id: selectedPatientId, name: 'Paciente', avatarColor: 'bg-gray-200' }; 
    const clinicalRecord = clinicalRecords.find((r: any) => r.patientId === selectedPatientId) || {};
    const patientData = { ...patient, ...clinicalRecord };
    return <PatientDetailView patient={patientData} onBack={() => setView('home')} history={patientsHistory.filter((h: any) => h.patientId === selectedPatientId)} notes={therapistNotes} onAddNote={onAddNote} protocols={protocols} setProtocols={setProtocols} onAddTask={onAddTask} patientTasks={allTasks.filter((t: any) => t.patientId === selectedPatientId)} onToggleNoteType={(id: any) => (window as any).handleToggleNoteTypeApp(id)} onEvaluateHistoryItem={onUpdateHistoryItem} onUpdateTask={onUpdateTask} isTutorialActive={runTutorial} tutorialStep={tutorialStep} setTutorialStep={setTutorialStep} onUpdatePatient={onUpdatePatient} onRecordTrial={onRecordTrial} onDeleteHistoryItem={onDeleteHistoryItem} />; 
  } 
  
  return ( 
    <div className="flex min-h-screen bg-[#F4F7FE] font-sans overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-72 bg-white border-r border-slate-100 p-6 sticky top-0 h-screen overflow-y-auto shrink-0">
        <div className="mb-10 px-4">
          <LogoVerto size={40} showText={true} />
        </div>
        
        <nav className="flex-1 space-y-2">
          <button 
            onClick={() => setView('home')}
            className={`w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all font-bold text-sm ${view === 'home' ? 'bg-[#4318FF] text-white shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
          >
            <LayoutDashboard size={20} /> Dashboard
          </button>
          
          <button 
            onClick={() => setView('patients_registry')}
            className={`w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all font-bold text-sm ${view === 'patients_registry' ? 'bg-[#4318FF] text-white shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
          >
            <Users size={20} /> Pacientes
          </button>
          
          <button 
            onClick={() => setView('protocols')}
            className={`w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all font-bold text-sm ${view === 'protocols' ? 'bg-[#4318FF] text-white shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
          >
            <ClipboardList size={20} /> Protocolos
          </button>

          <button 
            onClick={() => setView('room_reservation')}
            className={`w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all font-bold text-sm ${view === 'room_reservation' ? 'bg-[#4318FF] text-white shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
          >
            <DoorOpen size={20} /> Reserva de Salas
          </button>
          
          {(user?.role === 'coordinator' || user?.role === 'receptionist') && (
            <button 
              onClick={() => setView('financial')}
              className={`w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all font-bold text-sm ${view === 'financial' ? 'bg-[#4318FF] text-white shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
            >
              <ShoppingBag size={20} /> Financeiro
            </button>
          )}
          
          {user?.role === 'coordinator' && (
            <button 
              onClick={onViewTeam}
              className="w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all font-bold text-sm text-slate-400 hover:bg-slate-50 hover:text-slate-600"
            >
              <Users size={20} /> Gestão da Equipe
            </button>
          )}
          
          {(user?.role === 'coordinator' || user?.role === 'therapist') && (
            <button 
              onClick={() => setView('clinic')}
              className={`w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all font-bold text-sm ${view === 'clinic' ? 'bg-[#4318FF] text-white shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
            >
              <Rocket size={20} /> Gestão da Clínica
            </button>
          )}
          
          <div className="pt-6 mt-6 border-t border-slate-50 space-y-2">
            <button onClick={() => setIsMarketplaceOpen(true)} className="w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all font-bold text-sm text-slate-400 hover:bg-slate-50 hover:text-slate-600">
              <ShoppingBag size={20} /> Marketplace
            </button>
            <button onClick={() => setIsActivityLogOpen(true)} className="w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all font-bold text-sm text-slate-400 hover:bg-slate-50 hover:text-slate-600">
              <ClipboardList size={20} /> Log de Atividades
            </button>
            <button 
              onClick={async () => {
                const result = await googleCalendarService.connect();
                if (result.success) alert('Google Agenda conectado com sucesso!');
              }} 
              className="w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all font-bold text-sm text-slate-400 hover:bg-slate-50 hover:text-slate-600"
            >
              <Share2 size={20} /> Google Agenda
            </button>
          </div>
        </nav>
        
        <div className="mt-auto pt-6 border-t border-slate-50">
          <button onClick={onLogout} className="flex items-center gap-3 p-3.5 w-full text-red-500 hover:bg-red-50 rounded-2xl transition-all font-bold text-sm">
            <LogOut size={20} /> Sair
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto h-screen relative">
        {runTutorial && ( <TutorialOverlay steps={dashboardSteps} onClose={() => setRunTutorial(false)} currentStepIndex={tutorialStep} onStepChange={setTutorialStep} /> )} 
      <AnamnesisModal isOpen={isRegisterModalOpen} onClose={() => setIsRegisterModalOpen(false)} initialData={null} onSave={handleRegisterSubmit} mode="create" /> 
      
      {isPaymentModalOpen && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setIsPaymentModalOpen(false)}>
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl animate-pop relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setIsPaymentModalOpen(false)} className="absolute top-6 right-6 text-gray-400 hover:text-gray-600"><X size={24}/></button>
            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2"><ShoppingBag size={24} className="text-[#4318FF]"/> Registrar Pagamento</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Paciente</label>
                <select 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                  onChange={(e) => {
                    const p = allPatients.find((p: any) => p.id === parseInt(e.target.value));
                    setSelectedPaymentPatient(p);
                  }}
                >
                  <option value="">Selecione o paciente...</option>
                  {allPatients.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Valor (R$)</label>
                <input 
                  type="number" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700" 
                  placeholder="0,00"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Método</label>
                <div className="grid grid-cols-3 gap-2">
                  {['pix', 'card', 'cash'].map(m => (
                    <button 
                      key={m}
                      onClick={() => setPaymentMethod(m)}
                      className={`py-2 rounded-xl text-[10px] font-bold uppercase transition-all ${paymentMethod === m ? 'bg-[#4318FF] text-white' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <button 
                onClick={handleAddPayment}
                className="w-full bg-[#4318FF] text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-500/20 hover:opacity-90 transition-all mt-4 uppercase tracking-widest"
              >
                Confirmar Recebimento
              </button>
            </div>
          </div>
        </div>
      )}
      
      {isActivityLogOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setIsActivityLogOpen(false)}>
          <div className="bg-white w-full max-w-4xl rounded-[40px] shadow-2xl animate-pop relative overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="absolute top-0 left-0 right-0 h-2 bg-blue-600"></div>
            <div className="p-8 pb-4">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-blue-50 rounded-2xl text-blue-600">
                    <ClipboardList size={28}/>
                  </div>
                  <div>
                    <h2 className="text-3xl font-semibold text-gray-800 tracking-tight">Log de <span className="text-blue-600">Atividades</span></h2>
                    <div className="flex items-center gap-2 mt-1">
                      <ShieldCheck size={14} className="text-blue-500" />
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Auditoria e Rastreabilidade Completa</span>
                    </div>
                  </div>
                </div>
                <button onClick={() => setIsActivityLogOpen(false)} className="p-2 bg-gray-100 rounded-full text-gray-400 hover:bg-red-50 hover:text-red-500 transition-all"><X size={20}/></button>
              </div>
            </div>

            <div className="p-8 pt-0 overflow-y-auto custom-scrollbar flex-1">
              <div className="bg-gray-50 rounded-3xl p-6 mb-6">
                <div className="flex flex-wrap gap-4 items-center justify-between">
                  <div className="flex gap-2">
                    <span className="px-3 py-1 bg-white border border-gray-200 rounded-full text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Total: {activityLogs.length} registros</span>
                  </div>
                  <div className="flex gap-2">
                    <button className="p-2 bg-white border border-gray-200 rounded-xl text-gray-400 hover:text-blue-600 transition-all"><FilterIcon size={16}/></button>
                    <button className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-all">Exportar PDF</button>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {activityLogs.length > 0 ? (
                  activityLogs.map((log: any) => (
                    <div key={log.id} className="bg-white border border-gray-100 p-4 rounded-2xl hover:shadow-md transition-all flex items-start gap-4 group">
                      <div className={`p-2.5 rounded-xl shrink-0 ${
                        log.category === 'clinical' ? 'bg-blue-50 text-blue-600' : 
                        log.category === 'management' ? 'bg-emerald-50 text-emerald-600' : 
                        'bg-amber-50 text-amber-600'
                      }`}>
                        {log.category === 'clinical' ? <Users size={18}/> : 
                         log.category === 'management' ? <Calendar size={18}/> : 
                         <Settings size={18}/>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h4 className="font-semibold text-gray-800 text-sm truncate">{log.action}</h4>
                          <span className="text-[10px] font-semibold text-gray-400 flex items-center gap-1">
                            <Clock size={10}/> {new Date(log.timestamp).toLocaleString('pt-BR')}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed">{log.details}</p>
                        <div className="mt-2 flex items-center gap-3">
                          <span className="text-[9px] font-semibold text-gray-300 uppercase tracking-widest">Profissional: {log.professional}</span>
                          <span className={`text-[9px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full ${
                            log.category === 'clinical' ? 'bg-blue-50 text-blue-500' : 
                            log.category === 'management' ? 'bg-emerald-50 text-emerald-500' : 
                            'bg-amber-50 text-amber-500'
                          }`}>
                            {log.category}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-20 opacity-50">
                    <ClipboardList size={48} className="mx-auto mb-4 text-gray-300"/>
                    <p className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Nenhuma atividade registrada ainda.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 bg-gray-50 text-center border-t border-gray-100">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Este log é imutável e segue os padrões de segurança LGPD e HIPAA para auditoria clínica.</p>
            </div>
          </div>
        </div>
      )}

      <DayDetailsModal 
        isOpen={isDayDetailsModalOpen}
        onClose={() => setIsDayDetailsModalOpen(false)}
        date={sessionDate}
        agenda={therapistAgenda}
        onAddSession={() => setIsAddSessionModalOpen(true)}
        onPatientClick={onPatientClick}
      />
      {isMarketplaceOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setIsMarketplaceOpen(false)}>
          <div className="bg-white w-full max-w-2xl rounded-[40px] shadow-2xl animate-pop relative overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-purple-500 via-blue-500 to-green-500"></div>
            <div className="p-8 pb-4">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-[#05CD99]/10 rounded-2xl text-[#05CD99]">
                    <ShoppingBag size={28}/>
                  </div>
                  <div>
                    <h2 className="text-3xl font-semibold text-gray-800 tracking-tight">Marketplace <span className="text-[#05CD99] font-logo font-bold lowercase">verto</span></h2>
                    <div className="flex items-center gap-2 mt-1">
                      <ShieldCheck size={14} className="text-blue-500" />
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Protocolos Validados e Editáveis</span>
                    </div>
                  </div>
                </div>
                <button onClick={() => setIsMarketplaceOpen(false)} className="p-2 bg-gray-100 rounded-full text-gray-400 hover:bg-red-50 hover:text-red-500 transition-all"><X size={20}/></button>
              </div>
            </div>
            <div className="p-8 pt-0 overflow-y-auto custom-scrollbar flex-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {marketProtocols.map(proto => (
                  <div key={proto.id} className="bg-white p-5 rounded-[32px] border border-gray-100 shadow-sm flex flex-col gap-4 group hover:shadow-xl hover:border-[#05CD99]/20 transition-all duration-300 relative overflow-hidden">
                    <div className="flex justify-between items-start relative z-10">
                      <div className={`p-3 rounded-2xl ${proto.color} shadow-sm group-hover:scale-110 transition-transform`}>
                        <Rocket size={20} />
                      </div>
                      <div className="flex flex-col items-end">
                        <span className={`${proto.badgeColor} text-white text-[9px] font-semibold px-2.5 py-1 rounded-full uppercase mb-2 shadow-sm`}>{proto.badge}</span>
                        <div className="flex flex-col items-end">
                          <span className="text-lg font-semibold text-[#05CD99] leading-none">{proto.price}</span>
                          <span className="text-[9px] font-semibold text-gray-300 uppercase">por mês</span>
                        </div>
                      </div>
                    </div>
                    <div className="relative z-10">
                      <h3 className="font-semibold text-gray-800 text-base tracking-tight">{proto.title}</h3>
                      <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed h-12 overflow-hidden">{proto.description}</p>
                    </div>
                    <div className="bg-gray-50/80 rounded-2xl p-3 relative z-10">
                      <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest mb-2 ml-1">O que inclui:</p>
                      <ul className="space-y-1.5">
                        {proto.includes.map((inc, i) => (
                          <li key={i} className="flex items-center gap-2 text-[10px] font-semibold text-gray-600">
                            <div className="w-1 h-1 rounded-full bg-[#05CD99]"></div>
                            {inc}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <button onClick={() => alert('Assinatura iniciada! O protocolo já está na sua biblioteca.')} className="w-full bg-[#05CD99] text-white font-semibold py-3 rounded-2xl text-xs shadow-lg shadow-[#05CD99]/20 hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2 relative z-10 uppercase tracking-widest">
                      Assinar Protocolo
                    </button>
                    <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-gray-50 rounded-full opacity-50 -z-0 group-hover:scale-150 transition-transform"></div>
                  </div>
                ))}
              </div>
              <div className="mt-8 p-6 bg-blue-50 rounded-[32px] border border-blue-100 flex items-center gap-4 animate-pulse">
                <div className="p-3 bg-white rounded-full text-blue-500 shadow-sm">
                  <Lightbulb size={24} />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-blue-700 tracking-tight">Dica Verto</h4>
                  <p className="text-[11px] font-semibold text-blue-600/70">Assine protocolos para automatizar o envio de tarefas e os gráficos de evolução!</p>
                </div>
              </div>
            </div>
            <div className="p-6 bg-gray-50 text-center border-t border-gray-100">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Pagamento mensal via cartão ou PIX • Cancele quando quiser</p>
            </div>
          </div>
        </div>
      )}

      {isAddSessionModalOpen && ( 
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setIsAddSessionModalOpen(false)}> 
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl animate-pop relative" onClick={e => e.stopPropagation()}> 
            <button onClick={() => setIsAddSessionModalOpen(false)} className="absolute top-6 right-6 text-gray-400 hover:text-gray-600"><X size={24}/></button> 
            <h2 className="text-2xl font-semibold text-gray-800 mb-6 flex items-center gap-2 tracking-tight"><CalendarPlus size={24} className="text-[#4318FF]"/> Agendar Sessão</h2> 
            <div className="space-y-4"> 
              <div className="relative"><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Paciente</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-[#4318FF] font-semibold text-gray-700" placeholder="Buscar..." value={sessionPatientName} onChange={e => setSessionPatientName(e.target.value)} />{filteredPatients.length > 0 && (<div className="absolute top-full left-0 right-0 bg-white border border-gray-100 rounded-xl shadow-xl mt-1 z-20 max-h-40 overflow-y-auto no-scrollbar">{filteredPatients.map(p => (<div key={p.id} onClick={() => selectPatientForSession(p.name)} className="p-3 hover:bg-[#F4F7FE] cursor-pointer text-sm font-semibold text-gray-700 border-b border-gray-50 last:border-0 flex items-center gap-2"><div className="w-6 h-6 rounded-full bg-[#4318FF]/10 text-[#4318FF] flex items-center justify-center text-xs">{p.name.charAt(0)}</div>{p.name}</div>))}</div>)}</div> 
              <div className="grid grid-cols-2 gap-3"><div><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Data</label><input type="date" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none font-semibold text-gray-700" value={sessionDate} onChange={e => setSessionDate(e.target.value)} /></div><div><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Hora</label><input type="time" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none font-semibold text-gray-700" value={sessionTime} onChange={e => setSessionTime(e.target.value)} /></div></div> 
              <div className="grid grid-cols-2 gap-3"><div><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Abordagem</label><select className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none font-semibold text-gray-700" value={sessionApproach} onChange={e => setSessionApproach(e.target.value)}><option value="">Selecione...</option><option value="Consulta Padrão">Consulta Padrão</option><option value="TCC">TCC</option><option value="ABA">ABA</option><option value="Integração Sensorial">Integração Sensorial</option></select></div><div><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Sala</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none font-semibold text-gray-700" placeholder="Ex: Sala 01" value={sessionRoom} onChange={e => setSessionRoom(e.target.value)} /></div></div><div><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Profissional Responsável</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none font-semibold text-gray-700" placeholder="Nome do Profissional" value={sessionProfessional} onChange={e => setSessionProfessional(e.target.value)} /></div> 
              <button onClick={handleSessionSubmit} className="w-full bg-[#4318FF] text-white font-semibold py-4 rounded-xl shadow-lg shadow-[#4318FF]/30 hover:opacity-90 transition-all mt-2 active:scale-95 uppercase tracking-widest">Confirmar Agendamento</button> 
            </div> 
          </div> 
        </div> 
      )} 
      {/* Responsive Header */}
      <div className="bg-white lg:bg-transparent px-6 lg:px-10 pt-6 lg:pt-10 pb-6 z-20"> 
        {/* Mobile Header */}
        <div className="lg:hidden flex justify-between items-center mb-6"> 
          <LogoVerto size={32} showText={true} />
          <div className="flex items-center gap-3 relative"> 
            <SettingsMenu 
              user={user} 
              onLogout={onLogout} 
              onViewTeam={onViewTeam} 
              onOpenInvitations={() => setShowInvitationModal(true)} 
            />
            <button 
              id="menu-btn"
              onClick={() => setIsMenuOpen(!isMenuOpen)} 
              className={`p-3 rounded-2xl transition-all shadow-sm ${isMenuOpen ? 'bg-[#4318FF] text-white shadow-lg' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            {isMenuOpen && (
              <div className="absolute right-0 top-14 w-64 bg-white rounded-[24px] shadow-2xl border border-gray-100 p-4 z-50 animate-pop flex flex-col gap-2">
                <div id="menu-search" className="bg-gray-50 rounded-xl p-3 flex items-center gap-2 mb-2 border border-gray-100">
                   <Search size={16} className="text-gray-400" />
                   <input 
                     type="text" 
                     placeholder="Buscar paciente..." 
                     className="bg-transparent outline-none text-xs w-full font-semibold text-gray-600 placeholder-gray-400" 
                     autoFocus 
                   />
                </div>

                <button onClick={() => {setView('home'); setIsMenuOpen(false);}} className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl text-gray-600 hover:text-[#4318FF] transition-colors text-xs font-semibold uppercase tracking-wider text-left">
                  <LayoutDashboard size={18}/> Dashboard
                </button>

                <button onClick={() => {setView('patients_registry'); setIsMenuOpen(false);}} className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl text-gray-600 hover:text-[#4318FF] transition-colors text-xs font-semibold uppercase tracking-wider text-left">
                  <Users size={18}/> Pacientes
                </button>

                <button onClick={() => {setView('protocols'); setIsMenuOpen(false);}} className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl text-gray-600 hover:text-[#4318FF] transition-colors text-xs font-semibold uppercase tracking-wider text-left">
                  <ClipboardList size={18}/> Protocolos
                </button>

                <button onClick={() => {setView('room_reservation'); setIsMenuOpen(false);}} className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl text-gray-600 hover:text-[#4318FF] transition-colors text-xs font-semibold uppercase tracking-wider text-left">
                  <DoorOpen size={18}/> Reserva de Salas
                </button>

                <div className="h-px bg-gray-100 my-1"></div>

                <button onClick={() => {setRunTutorial(true); setTutorialStep(0); setIsMenuOpen(false);}} className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl text-gray-600 hover:text-[#4318FF] transition-colors text-xs font-semibold uppercase tracking-wider text-left">
                  <HelpCircle size={18}/> Tutorial / Ajuda
                </button>
                
                <button id="menu-marketplace" onClick={() => {setIsMarketplaceOpen(true); setIsMenuOpen(false);}} className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl text-gray-600 hover:text-[#05CD99] transition-colors text-xs font-semibold uppercase tracking-wider text-left">
                  <ShoppingBag size={18}/> Marketplace
                </button>

                {(user?.role === 'coordinator' || user?.role === 'receptionist') && (
                  <button id="menu-financial" onClick={() => {setView('financial'); setIsMenuOpen(false);}} className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl text-gray-600 hover:text-emerald-500 transition-colors text-xs font-semibold uppercase tracking-wider text-left">
                    <ShoppingBag size={18}/> Financeiro & Pagamentos
                  </button>
                )}

                <button id="menu-new-patient" onClick={() => {setIsRegisterModalOpen(true); setIsMenuOpen(false);}} className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl text-gray-600 hover:text-[#4318FF] transition-colors text-xs font-semibold uppercase tracking-wider text-left">
                  <UserPlus size={18}/> Novo Paciente
                </button>

                {user?.role === 'coordinator' && (
                  <button id="menu-team" onClick={() => {onViewTeam(); setIsMenuOpen(false);}} className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl text-gray-600 hover:text-purple-600 transition-colors text-xs font-semibold uppercase tracking-wider text-left">
                    <Users size={18}/> Gestão da Equipe
                  </button>
                )}

                {(user?.role === 'coordinator' || user?.role === 'therapist') && (
                  <button id="menu-clinic" onClick={() => {setView('clinic'); setIsMenuOpen(false);}} className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl text-gray-600 hover:text-emerald-500 transition-colors text-xs font-semibold uppercase tracking-wider text-left">
                    <Rocket size={18}/> Gestão da Clínica
                  </button>
                )}

                <button id="menu-activity-log" onClick={() => {setIsActivityLogOpen(true); setIsMenuOpen(false);}} className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl text-gray-600 hover:text-blue-500 transition-colors text-xs font-semibold uppercase tracking-wider text-left">
                  <ClipboardList size={18}/> Log de Atividades
                </button>

                <button 
                  onClick={async () => {
                    const result = await googleCalendarService.connect();
                    if (result.success) {
                      alert('Google Agenda conectado com sucesso!');
                    }
                    setIsMenuOpen(false);
                  }} 
                  className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl text-gray-600 hover:text-blue-600 transition-colors text-xs font-semibold uppercase tracking-wider text-left"
                >
                  <Share2 size={18}/> Integrar Google Agenda
                </button>

                <div className="h-px bg-gray-100 my-1"></div>

                <button id="menu-logout" onClick={onLogout} className="flex items-center gap-3 p-3 hover:bg-red-50 rounded-xl text-red-500 transition-colors text-xs font-semibold uppercase tracking-wider text-left">
                  <LogOut size={18}/> Sair
                </button>
              </div>
            )}
          </div> 
        </div>

        {/* Desktop Header */}
        <div className="hidden lg:flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Olá, {user?.name?.split(' ')[0] || 'Profissional'}</h1>
            <p className="text-slate-500 font-medium">Bem-vindo de volta ao seu painel.</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="text" 
                placeholder="Buscar..." 
                className="pl-12 pr-4 py-3 bg-white border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all w-64 shadow-sm"
              />
            </div>
            <SettingsMenu 
              user={user} 
              onLogout={onLogout} 
              onViewTeam={onViewTeam} 
              onOpenInvitations={() => setShowInvitationModal(true)} 
            />
          </div>
        </div>

        <div id="agenda-toggles" className="bg-gray-100 p-1 rounded-xl mb-6 flex gap-1 w-full max-w-sm">
          <button 
            id="agenda-day-btn"
            onClick={() => setAgendaView('day')} 
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-2 ${agendaView === 'day' ? 'bg-white text-[#4318FF] shadow-sm' : 'text-gray-500'}`}
          >
            <Calendar size={14} /> Dia
          </button>
          <button 
            id="agenda-week-btn"
            onClick={() => setAgendaView('week')} 
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-2 ${agendaView === 'week' ? 'bg-white text-[#4318FF] shadow-sm' : 'text-gray-500'}`}
          >
            <CalendarRange size={14} /> Semana
          </button>
          <button 
            id="agenda-month-btn"
            onClick={() => setAgendaView('month')} 
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-2 ${agendaView === 'month' ? 'bg-white text-[#4318FF] shadow-sm' : 'text-gray-500'}`}
          >
            <CalendarDays size={14} /> Mês
          </button>
        </div>

        {(user.role === 'receptionist' || user.role === 'coordinator') && (
          <div className="mb-6 flex items-center gap-3 bg-white p-3 rounded-2xl border border-gray-100 shadow-sm overflow-x-auto no-scrollbar">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">Filtrar Profissional:</span>
            <button 
              onClick={() => setProfessionalFilter('all')}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${professionalFilter === 'all' ? 'bg-[#4318FF] text-white shadow-md' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
            >
              Todos
            </button>
            {['Dra. Raísa', 'Dr. Marcos', 'Dra. Ana'].map(prof => (
              <button 
                key={prof}
                onClick={() => setProfessionalFilter(prof)}
                className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${professionalFilter === prof ? 'bg-[#4318FF] text-white shadow-md' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
              >
                {prof}
              </button>
            ))}
          </div>
        )}

        {agendaView === 'day' ? (
          <div id="schedule-list" className="flex overflow-x-auto pb-4 -mx-6 px-6 space-x-4 snap-x no-scrollbar"> 
            <div id="schedule-btn" onClick={() => setIsAddSessionModalOpen(true)} className="min-w-[120px] bg-white rounded-3xl border-2 border-dashed border-[#4318FF]/40 flex flex-col items-center justify-center cursor-pointer hover:bg-[#F4F7FE] transition-all snap-center h-40 group shrink-0"> <div className="w-10 h-10 rounded-full bg-[#4318FF]/10 text-[#4318FF] flex items-center justify-center mb-2 group-hover:scale-110 transition-transform"><CalendarPlus size={24} /></div><span className="text-xs font-semibold text-[#4318FF] uppercase tracking-tighter">Agendar</span> </div> 
            {filteredAgendaList.map((patientItem: any, idx: number) => {
              const patientData = allPatients.find((p: any) => p.id === patientItem.id);
              const isKid = (patientData?.age !== undefined && patientData.age <= 12) || patientData?.anamnesisData?.formType === 'child';
              const category = isKid ? 'Kids' : 'Adulto';
              
              const statusColors: any = {
                confirmed: 'bg-green-50 border-green-100',
                pending: 'bg-yellow-50 border-yellow-100',
                canceled: 'bg-red-50 border-red-100',
                reschedule: 'bg-red-50 border-red-100',
                absent: 'bg-gray-50 border-gray-100'
              };
              const cardBg = statusColors[patientItem.status] || 'bg-white border-indigo-50';

              return ( 
                <div id={idx === 0 ? 'patient-card-0' : ''} key={patientItem.id} onClick={() => { if (user.role !== 'receptionist') onPatientClick(patientItem.id); }} className={`min-w-[200px] rounded-3xl p-4 shadow-sm border snap-center flex flex-col justify-between h-44 hover:shadow-md transition-all relative overflow-hidden group cursor-pointer active:scale-95 ${cardBg}`}> 
                  <div className={`absolute top-0 right-0 w-20 h-20 rounded-bl-full opacity-10 transition-transform group-hover:scale-110 ${isKid ? 'bg-pink-500' : 'bg-indigo-500'}`}></div> 
                  <div className="flex justify-between items-start z-10">
                    <span className="font-semibold text-gray-800 text-xl tracking-tight">{patientItem.time}</span>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-[10px] font-semibold px-2 py-1 rounded-full uppercase ${patientItem.status === 'confirmed' ? 'bg-green-100 text-green-600' : patientItem.status === 'pending' ? 'bg-yellow-100 text-yellow-600' : 'bg-red-100 text-red-500'}`}>
                        {patientItem.status === 'confirmed' ? 'Conf' : patientItem.status === 'pending' ? 'Pend' : 'Canc'}
                      </span>
                      <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-tighter ${isKid ? 'bg-pink-100 text-pink-500' : 'bg-indigo-50 text-indigo-500'}`}>{category}</span>
                    </div>
                  </div> 
                  <div className="z-10 mt-auto">
                    <div className="flex items-center gap-2 mb-3">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleStatusUpdate(patientItem.id, 'confirmed'); }}
                        className="flex-1 py-1.5 bg-white/80 text-green-600 rounded-lg text-[9px] font-bold hover:bg-green-600 hover:text-white transition-all border border-green-200 uppercase"
                      >
                        Confirmar
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleStatusUpdate(patientItem.id, 'canceled'); }}
                        className="flex-1 py-1.5 bg-white/80 text-red-600 rounded-lg text-[9px] font-bold hover:bg-red-600 hover:text-white transition-all border border-red-200 uppercase"
                      >
                        Cancelar
                      </button>
                    </div>
                    <div className="flex items-end justify-between">
                      <div>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-xs mb-1 ${isKid ? 'bg-pink-400 text-white' : 'bg-indigo-400 text-white'}`}>{patientItem.name.charAt(0)}</div>
                        <h3 className="font-semibold text-gray-700 text-sm truncate tracking-tight max-w-[100px]">{patientItem.name}</h3>
                        <p className="text-[10px] text-gray-400 font-medium">{patientItem.type}</p>
                      </div>
                      <a 
                        href={`https://wa.me/${(patientData?.phone || '').replace(/\D/g, '')}`} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="mb-1 p-1.5 bg-green-50 text-green-500 rounded-xl hover:bg-green-500 hover:text-white transition-all shadow-sm"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MessageCircle size={14} />
                      </a>
                    </div>
                  </div> 
                </div> 
              );
            })} 
          </div> 
        ) : agendaView === 'month' ? (
          <div className="space-y-6 pb-6 animate-fade-in">
             <div id="schedule-btn" onClick={() => setIsAddSessionModalOpen(true)} className="w-full bg-white rounded-2xl border-2 border-dashed border-[#4318FF]/40 p-4 flex items-center justify-center cursor-pointer hover:bg-[#F4F7FE] transition-all gap-3 group">
                <div className="w-8 h-8 rounded-full bg-[#4318FF]/10 text-[#4318FF] flex items-center justify-center group-hover:scale-110 transition-transform"><Plus size={18} /></div>
                <span className="text-xs font-semibold text-[#4318FF] uppercase tracking-wider">Novo Agendamento</span>
             </div>
             
             <CalendarWidget 
               agenda={therapistAgenda} 
               currentDate={calendarDate} 
               onDateChange={setCalendarDate}
               onDateSelect={(dateStr: string) => {
                 setSessionDate(dateStr);
                 const hasAppointments = therapistAgenda.some((a: any) => a.date === dateStr);
                 if (hasAppointments) {
                    setIsDayDetailsModalOpen(true);
                 } else {
                    setIsAddSessionModalOpen(true);
                 }
               }}
             />
          </div>
        ) : (
          <div className="space-y-6 pb-6 animate-fade-in">
             <div id="schedule-btn" onClick={() => setIsAddSessionModalOpen(true)} className="w-full bg-white rounded-2xl border-2 border-dashed border-[#4318FF]/40 p-4 flex items-center justify-center cursor-pointer hover:bg-[#F4F7FE] transition-all gap-3 group">
                <div className="w-8 h-8 rounded-full bg-[#4318FF]/10 text-[#4318FF] flex items-center justify-center group-hover:scale-110 transition-transform"><Plus size={18} /></div>
                <span className="text-xs font-semibold text-[#4318FF] uppercase tracking-wider">Novo Agendamento</span>
             </div>
            {groupedAgenda && Object.keys(groupedAgenda).length > 0 ? (
              Object.keys(groupedAgenda).map(dateKey => (
                <div key={dateKey}>
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 ml-1 bg-gray-100 px-3 py-1 rounded-lg w-fit">{dateKey}</h4>
                  <div className="space-y-3">
                    {groupedAgenda[dateKey].map((item: any) => (
                      <div key={item.id} onClick={() => onPatientClick(item.id)} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between hover:shadow-md transition-all cursor-pointer group">
                        <div className="flex items-center gap-4">
                            <div className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center font-semibold text-white ${item.color.replace('text', 'bg').replace('-100', '-500')}`}>
                              <span className="text-xs opacity-70">AS</span>
                              <span className="text-sm">{item.time}</span>
                            </div>
                            <div>
                              <h3 className="font-semibold text-gray-800 text-sm">{item.name}</h3>
                              <p className="text-xs text-gray-500">{item.type} • {item.status === 'confirmed' ? 'Confirmado' : 'Pendente'}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <a href={`https://wa.me/${(allPatients.find((p: any) => p.id === item.id)?.phone || '').replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="p-2 text-green-500 hover:bg-green-50 rounded-xl transition-all" onClick={e => e.stopPropagation()}>
                               <MessageCircle size={18} />
                            </a>
                            <div className="p-2 text-gray-300 hover:text-[#4318FF] hover:bg-blue-50 rounded-xl transition-all">
                               <ChevronRight size={18} />
                            </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-10 opacity-50">
                <CalendarRange size={40} className="mx-auto mb-2 text-gray-300"/>
                <p className="text-sm font-semibold text-gray-400">Nenhum agendamento para este período.</p>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 animate-fade-in">
          <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3 ml-1">Resumo {agendaView === 'day' ? 'do Dia' : agendaView === 'week' ? 'da Semana' : 'do Mês'}</h3>
          <div id="summary-stats" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div id="summary-confirmed" className="flex-1 bg-white p-4 rounded-[24px] border border-gray-100 shadow-sm flex flex-col group hover:border-green-100 transition-all">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Confirmadas</span>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#05CD99] animate-pulse"></div>
                <span className="text-xl font-semibold text-gray-800">
                  {agendaView === 'day' ? confirmedCount : (filteredAgendaList.length > 0 ? 0 : getFilteredAgenda().filter((a: any) => a.status === 'confirmed').length)}
                </span>
              </div>
            </div>
            <div id="summary-pending" className="flex-1 bg-white p-4 rounded-[24px] border border-gray-100 shadow-sm flex flex-col group hover:border-yellow-100 transition-all">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Pendentes</span>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#FFB547]"></div>
                <span className="text-xl font-semibold text-gray-800">
                   {agendaView === 'day' ? pendingCount : (filteredAgendaList.length > 0 ? 0 : getFilteredAgenda().filter((a: any) => a.status === 'pending').length)}
                </span>
              </div>
            </div>
            <div id="summary-canceled" className="flex-1 bg-white p-4 rounded-[24px] border border-gray-100 shadow-sm flex flex-col group hover:border-red-100 transition-all">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Ausentes</span>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#EE5D50]"></div>
                <span className="text-xl font-semibold text-gray-800">
                   {agendaView === 'day' ? canceledCount : (filteredAgendaList.length > 0 ? 0 : getFilteredAgenda().filter((a: any) => a.status === 'canceled').length)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div> 
      <div className="p-6 flex flex-col gap-6"> 
        <div className="flex flex-col sm:flex-row gap-4"> 
          {user?.role !== 'receptionist' && (
            <>
              <button id="protocols-btn" onClick={() => setView('protocols')} className="flex-1 bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition-all group"> <div className="flex items-center gap-4"><div className="w-12 h-12 rounded-full bg-blue-50 text-[#4318FF] flex items-center justify-center group-hover:scale-110 transition-transform"><Settings size={24} /></div><div className="text-left"><h3 className="font-semibold text-gray-800 text-lg tracking-tight">Gestão de Protocolos</h3><p className="text-gray-500 text-xs font-medium">Crie e edite estruturas</p></div></div><ChevronRight className="text-gray-300" /> </button> 
              <button id="patients-btn" onClick={() => setView('patients_registry')} className="flex-1 bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition-all group"> <div className="flex items-center gap-4"><div className="w-12 h-12 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center group-hover:scale-110 transition-transform"><Users size={24} /></div><div className="text-left"><h3 className="font-semibold text-gray-800 text-lg tracking-tight">Meus Pacientes</h3><p className="text-gray-500 text-xs font-medium">Acesse os prontuários</p></div></div><ChevronRight className="text-gray-300" /> </button> 
            </>
          )}
          {user?.role === 'receptionist' && (
            <div className="flex-1 bg-blue-50 p-6 rounded-3xl border border-blue-100 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-white text-blue-500 flex items-center justify-center">
                <Calendar size={24} />
              </div>
              <div>
                <h3 className="font-bold text-blue-900">Acesso Recepcionista</h3>
                <p className="text-blue-700/70 text-xs">Seu acesso é focado na gestão de agendas e horários.</p>
              </div>
            </div>
          )}
        </div> 

        {user?.role === 'coordinator' && (
          <button id="clinic-btn" onClick={() => setView('clinic')} className="w-full bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition-all group">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Rocket size={24} />
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-gray-800 text-lg tracking-tight">Gestão da Clínica</h3>
                <p className="text-gray-500 text-xs font-medium">DRE Mensal, Financeiro e Metas</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Lucro do Mês</p>
                <p className="text-sm font-semibold text-emerald-600">R$ 12.450,00</p>
              </div>
              <ChevronRight className="text-gray-300" />
            </div>
          </button>
        )}
      </div>
    </main>

      {showInvitationModal && (
        <InvitationModal 
          user={user} 
          onClose={() => setShowInvitationModal(false)} 
        />
      )}
    </div> 
  ); 
};
