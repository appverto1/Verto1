import React, { useState, useEffect, useMemo } from 'react';
import { 
  HelpCircle, 
  UserPlus, 
  LogOut, 
  Search, 
  Menu, 
  X, 
  Calendar, 
  CalendarRange, 
  CalendarDays, 
  Plus, 
  ChevronRight, 
  Settings, 
  Users, 
  Rocket, 
  ShieldCheck, 
  Lightbulb, 
  Clock, 
  Camera, 
  AlertCircle, 
  CheckCircle2, 
  LayoutDashboard, 
  DoorOpen, 
  CreditCard,
  DollarSign,
  FileText,
  Paperclip,
  CalendarPlus
} from 'lucide-react';
import { LogoVerto } from './Common';
import { DayDetailsModal, CalendarWidget } from './Calendar';
import { PatientRegistry } from './PatientRegistry';
import { SettingsMenu } from './SettingsMenu';
import { 
  RoomReservation, 
} from './RoomReservation';
import { dataService } from '../services/dataService';

const ProfileView = ({ user, onUpdateProfile, onBack }: any) => {
  const [profileName, setProfileName] = useState(user.name || '');
  const [profileEmail, setProfileEmail] = useState(user.email || '');

  const handleSaveProfile = () => {
    onUpdateProfile({
      name: profileName,
      email: profileEmail,
    });
    setTimeout(() => {
      alert("Alterações salvas com sucesso!");
      onBack();
    }, 100);
  };

  return (
    <div className="p-8 bg-slate-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <button onClick={onBack} className="p-2 hover:bg-white rounded-xl transition-all shadow-sm border border-slate-100"><ChevronRight className="rotate-180" /></button>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Meu Perfil</h2>
        </div>
        
        <div className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-100">
          <div className="flex items-center gap-6 mb-8 pb-8 border-b border-slate-50">
            <div className="relative group">
              <div className="w-24 h-24 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center text-3xl font-bold overflow-hidden border-2 border-transparent group-hover:border-blue-500/20 transition-all">
                {user.profilePicture ? (
                  <img src={user.profilePicture} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  user.name?.charAt(0)
                )}
              </div>
              <input 
                type="file" 
                id="profile-pic-upload" 
                className="hidden" 
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      onUpdateProfile({ profilePicture: reader.result as string });
                    };
                    reader.readAsDataURL(file);
                  }
                }}
              />
              <button 
                onClick={() => document.getElementById('profile-pic-upload')?.click()}
                className="absolute -bottom-2 -right-2 p-2 bg-[#4318FF] text-white rounded-xl shadow-lg hover:scale-110 transition-all"
              >
                <Camera size={14} />
              </button>
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">{user.name}</h3>
              <p className="text-slate-500 font-medium">{user.email}</p>
              <span className="inline-block mt-2 px-3 py-1 bg-blue-100 text-blue-600 rounded-full text-[10px] font-bold uppercase tracking-widest">
                Recepcionista
              </span>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nome Completo</label>
              <input 
                type="text" 
                value={profileName} 
                onChange={(e) => setProfileName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-sm font-semibold outline-none focus:border-blue-500 transition-all" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">E-mail Profissional</label>
              <input 
                type="email" 
                value={profileEmail} 
                onChange={(e) => setProfileEmail(e.target.value)}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-sm font-semibold outline-none focus:border-blue-500 transition-all" 
              />
            </div>
          </div>

          <div className="mt-10 flex justify-end">
            <button 
              onClick={handleSaveProfile}
              className="bg-[#4318FF] text-white px-8 py-4 rounded-2xl font-bold shadow-lg shadow-blue-500/20 hover:scale-105 transition-all"
            >
              Salvar Alterações
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ReceptionistDashboard = ({ 
  user, onLogout, therapistAgenda, 
  onAddPatient, allPatients, onScheduleSession, 
  onUpdatePatient, onUpdateAgendaStatus, onUpdateAppointment,
  rooms, setRooms, roomReservations,
  onUpdateProfile
}: any) => { 
  const [view, setView] = useState('home'); 

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '') || 'home';
      setView(hash);
    };
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleSetView = (newView: string) => {
    window.location.hash = newView;
    setView(newView);
  };

  const [isAddSessionModalOpen, setIsAddSessionModalOpen] = useState(false);
  const [editingAppointmentId, setEditingAppointmentId] = useState<any>(null);
  const [isFinancialOpen, setIsFinancialOpen] = useState(false);
  const [payments, setPayments] = useState<any[]>([]);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedPaymentPatient, setSelectedPaymentPatient] = useState<any>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('pix');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentReceipt, setPaymentReceipt] = useState<string | null>(null);
  
  const [sessionPatientName, setSessionPatientName] = useState("");
  const [filteredPatients, setFilteredPatients] = useState<any[]>([]);
  const [sessionTime, setSessionTime] = useState("");
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0]);
  const [sessionApproach, setSessionApproach] = useState("");
  const [sessionRoom, setSessionRoom] = useState("");
  const [sessionProfessional, setSessionProfessional] = useState("");
  const [sessionNumSessions, setSessionNumSessions] = useState(1);
  const [agendaView, setAgendaView] = useState('day'); 
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [isDayDetailsModalOpen, setIsDayDetailsModalOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false); 

  useEffect(() => {
    const fetchPayments = async () => {
      const result = await dataService.getPayments();
      if (result.success) {
        setPayments(result.data);
      }
    };
    fetchPayments();
  }, []);

  const onPatientClick = (patientId: any) => { 
    // Receptionists only see registration data, so we don't open DetailView with clinical data
    // Instead, we might open a simplified view or just stay in the registry
    alert("Como recepcionista, você tem acesso apenas aos dados cadastrais na lista de pacientes.");
  }; 
  
  useEffect(() => { if (sessionPatientName) { const matches = allPatients.filter((p: any) => p.name.toLowerCase().includes(sessionPatientName.toLowerCase())); setFilteredPatients(matches); } else { setFilteredPatients([]); } }, [sessionPatientName, allPatients]); 
  
  const handleSessionSubmit = async () => { 
    if(!sessionPatientName || !sessionTime || !sessionRoom) return alert("Preencha nome, horário e sala"); 
    
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

  const resetSessionForm = () => {
    setEditingAppointmentId(null);
    setSessionPatientName(""); 
    setSessionTime(""); 
    setSessionDate(new Date().toISOString().split('T')[0]); 
    setSessionApproach(""); 
    setSessionRoom(""); 
    setSessionProfessional(""); 
    setSessionNumSessions(1);
  };

  const handleAddPayment = async () => {
    if (!selectedPaymentPatient || !paymentAmount) return alert("Preencha todos os campos");
    
    const newPayment = {
      patient_id: selectedPaymentPatient.id,
      patient_name: selectedPaymentPatient.name,
      amount: parseFloat(paymentAmount),
      payment_date: paymentDate,
      method: paymentMethod,
      status: 'paid',
      receipt_url: paymentReceipt
    };

    const result = await dataService.savePayment(newPayment);
    if (result.success) {
      setPayments(prev => [result.data || newPayment, ...prev]);
      setIsPaymentModalOpen(false);
      setPaymentAmount('');
      setSelectedPaymentPatient(null);
      setPaymentReceipt(null);
      alert("Pagamento registrado com sucesso!");
    } else {
      alert("Erro ao salvar pagamento.");
    }
  };

  const getFilteredAgenda = () => {
    const today = new Date();
    today.setHours(0,0,0,0);
    
    let list = therapistAgenda;
    
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

  const currentViewAgenda = useMemo(() => getFilteredAgenda(), [agendaView, therapistAgenda]);

  if (view === 'patients_registry') return <PatientRegistry patients={allPatients} clinicalRecords={[]} onBack={() => setView('home')} onSelectPatient={onPatientClick} userRole="receptionist" />; 
  if (view === 'room_reservation') return (
    <RoomReservation 
      user={user} 
      rooms={rooms} 
      reservations={roomReservations} 
      onDeleteReservation={(id) => {
        const appointmentId = id.replace('res-', '');
        onUpdateAgendaStatus(Number(appointmentId), 'canceled');
      }} 
      onBack={() => handleSetView('home')} 
    />
  );
  
  if (view === 'profile') {
    return (
      <ProfileView 
        user={user} 
        onUpdateProfile={onUpdateProfile} 
        onBack={() => handleSetView('home')} 
      />
    );
  }

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
                  <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Comprovante</th>
                  <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {payments.map((p, idx) => (
                  <tr key={p.id || idx} className="group hover:bg-slate-50 transition-all">
                    <td className="py-4 font-semibold text-slate-700">{p.patient_name}</td>
                    <td className="py-4 font-bold text-[#4318FF]">R$ {p.amount.toFixed(2)}</td>
                    <td className="py-4 text-slate-500 text-sm">{new Date(p.payment_date).toLocaleDateString()}</td>
                    <td className="py-4"><span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[10px] font-bold uppercase">{p.method}</span></td>
                    <td className="py-4">
                      {p.receipt_url ? (
                        <a href={p.receipt_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline flex items-center gap-1 text-xs font-bold">
                          <Paperclip size={12} /> Ver Anexo
                        </a>
                      ) : (
                        <span className="text-slate-300 text-xs">-</span>
                      )}
                    </td>
                    <td className="py-4"><span className="px-3 py-1 bg-green-100 text-green-600 rounded-full text-[10px] font-bold uppercase">Pago</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }
  
  return ( 
    <div className="flex min-h-screen bg-[#F4F7FE] font-sans overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-72 bg-white border-r border-slate-100 p-6 sticky top-0 h-screen overflow-y-auto shrink-0">
        <div className="mb-10 px-4">
          <LogoVerto size={40} showText={true} />
        </div>
        
        <nav className="flex-1 space-y-2 overflow-y-auto no-scrollbar pr-2">
          <button 
            onClick={() => handleSetView('home')}
            className={`w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all font-bold text-sm ${view === 'home' ? 'bg-[#4318FF] text-white shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
          >
            <LayoutDashboard size={20} /> Dashboard
          </button>
          
          <button 
            onClick={() => handleSetView('patients_registry')}
            className={`w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all font-bold text-sm ${view === 'patients_registry' ? 'bg-[#4318FF] text-white shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
          >
            <Users size={20} /> Pacientes
          </button>
          
          <button 
            onClick={() => handleSetView('room_reservation')}
            className={`w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all font-bold text-sm ${view === 'room_reservation' ? 'bg-[#4318FF] text-white shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
          >
            <DoorOpen size={20} /> Reserva de Salas
          </button>
          
          <button 
            onClick={() => handleSetView('financial')}
            className={`w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all font-bold text-sm ${view === 'financial' ? 'bg-[#4318FF] text-white shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
          >
            <DollarSign size={20} /> Financeiro
          </button>
        </nav>
        
        <div className="mt-auto pt-6 border-t border-slate-50">
          <button onClick={onLogout} className="flex items-center gap-3 p-3.5 w-full text-red-500 hover:bg-red-50 rounded-2xl transition-all font-bold text-sm">
            <LogOut size={20} /> Sair
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto h-screen relative">
      {isPaymentModalOpen && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setIsPaymentModalOpen(false)}>
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl animate-pop relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setIsPaymentModalOpen(false)} className="absolute top-6 right-6 text-gray-400 hover:text-gray-600"><X size={24}/></button>
            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2"><DollarSign size={24} className="text-[#4318FF]"/> Registrar Pagamento</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Paciente</label>
                <select 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                  onChange={(e) => {
                    const p = allPatients.find((p: any) => p.id === e.target.value || p.id === parseInt(e.target.value));
                    setSelectedPaymentPatient(p);
                  }}
                >
                  <option value="">Selecione o paciente...</option>
                  {allPatients.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Valor (R$)</label>
                  <input 
                    type="number" 
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700" 
                    placeholder="0,00"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Data</label>
                  <input 
                    type="date" 
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700" 
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Método</label>
                <div className="grid grid-cols-3 gap-2">
                  {['pix', 'card', 'cash'].map(m => (
                    <button 
                      key={m}
                      onClick={() => setPaymentMethod(m)}
                      className={`py-2 rounded-xl text-[10px] font-bold uppercase border-2 transition-all ${paymentMethod === m ? 'border-[#4318FF] bg-blue-50 text-[#4318FF]' : 'border-slate-100 text-slate-400'}`}
                    >
                      {m === 'pix' ? 'PIX' : m === 'card' ? 'Cartão' : 'Dinheiro'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Anexar Comprovante</label>
                <div 
                  className="border-2 border-dashed border-slate-200 rounded-2xl p-4 text-center cursor-pointer hover:border-blue-500 transition-all bg-slate-50"
                  onClick={() => document.getElementById('receipt-upload')?.click()}
                >
                  {paymentReceipt ? (
                    <div className="flex items-center justify-center gap-2 text-emerald-500 font-bold text-xs">
                      <CheckCircle2 size={16} /> Arquivo Selecionado
                    </div>
                  ) : (
                    <div className="text-slate-400 text-xs font-medium flex flex-col items-center gap-2">
                      <Paperclip size={20} />
                      Clique para anexar comprovante
                    </div>
                  )}
                  <input 
                    type="file" 
                    id="receipt-upload" 
                    className="hidden" 
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => setPaymentReceipt(reader.result as string);
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                </div>
              </div>
              <button 
                onClick={handleAddPayment}
                className="w-full bg-[#4318FF] text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 mt-4"
              >
                Confirmar Pagamento
              </button>
            </div>
          </div>
        </div>
      )}

      {isAddSessionModalOpen && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setIsAddSessionModalOpen(false)}>
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl animate-pop relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setIsAddSessionModalOpen(false)} className="absolute top-6 right-6 text-gray-400 hover:text-gray-600"><X size={24}/></button>
            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2"><CalendarPlus size={24} className="text-[#4318FF]"/> {editingAppointmentId ? 'Editar Sessão' : 'Agendar Sessão'}</h2>
            <div className="space-y-4">
              <div className="relative">
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Paciente</label>
                <input type="text" value={sessionPatientName} onChange={(e) => setSessionPatientName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700" placeholder="Nome do paciente..." />
                {filteredPatients.length > 0 && (
                  <div className="absolute z-10 w-full bg-white mt-1 rounded-xl shadow-xl border border-slate-100 overflow-hidden max-h-40 overflow-y-auto">
                    {filteredPatients.map((p: any) => (
                      <button key={p.id} onClick={() => { setSessionPatientName(p.name); setFilteredPatients([]); }} className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 font-medium">{p.name}</button>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Data</label>
                  <input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Horário</label>
                  <input type="time" value={sessionTime} onChange={(e) => setSessionTime(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Abordagem / Tipo</label>
                <input type="text" value={sessionApproach} onChange={(e) => setSessionApproach(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700" placeholder="Ex: ABA, TCC, Avaliação..." />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Sala</label>
                <select value={sessionRoom} onChange={(e) => setSessionRoom(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700">
                  <option value="">Selecione a sala...</option>
                  {rooms.map((r: any) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Profissional</label>
                <input type="text" value={sessionProfessional} onChange={(e) => setSessionProfessional(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700" placeholder="Nome do profissional..." />
              </div>
              {!editingAppointmentId && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Repetir por quantas semanas?</label>
                  <input type="number" min="1" max="52" value={sessionNumSessions} onChange={(e) => setSessionNumSessions(parseInt(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700" />
                </div>
              )}
              <button onClick={handleSessionSubmit} className="w-full bg-[#4318FF] text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 mt-4">{editingAppointmentId ? 'Salvar Alterações' : 'Confirmar Agendamento'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100 px-4 sm:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button id="menu-btn" onClick={() => setIsMenuOpen(!isMenuOpen)} className="lg:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-all">
            <Menu size={20} />
          </button>
          <div className="hidden sm:block">
            <h1 id="welcome-header" className="text-xl font-bold text-slate-900 tracking-tight">Olá, {user.name}</h1>
            <p className="text-slate-500 text-xs font-medium">Painel da Recepção</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="relative hidden md:block">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              id="menu-search"
              type="text" 
              placeholder="Buscar paciente..." 
              className="bg-slate-50 border-none rounded-2xl pl-12 pr-4 py-2.5 text-sm w-64 focus:ring-2 focus:ring-blue-500/20 transition-all outline-none font-medium"
            />
          </div>
          <SettingsMenu 
            user={user} 
            onLogout={onLogout} 
            onViewProfile={() => handleSetView('profile')} 
            onViewBilling={() => handleSetView('billing')} 
          />
        </div>
      </header>

      {/* View Content */}
      <div className="p-4 sm:p-8">
        {view === 'home' && (
          <div className="space-y-8 animate-fade-in">
            {/* Stats Summary */}
            <div id="summary-stats" className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              <div className="bg-white p-4 sm:p-6 rounded-[32px] shadow-sm border border-slate-100">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl"><Calendar size={20} /></div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sessões Hoje</p>
                </div>
                <h3 className="text-2xl font-black text-slate-900">{therapistAgenda.filter((a: any) => a.date === new Date().toISOString().split('T')[0]).length}</h3>
              </div>
              <div className="bg-white p-4 sm:p-6 rounded-[32px] shadow-sm border border-slate-100">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-green-50 text-green-600 rounded-2xl"><CheckCircle2 size={20} /></div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Confirmadas</p>
                </div>
                <h3 className="text-2xl font-black text-slate-900">{therapistAgenda.filter((a: any) => a.date === new Date().toISOString().split('T')[0] && a.status === 'confirmed').length}</h3>
              </div>
              <div className="bg-white p-4 sm:p-6 rounded-[32px] shadow-sm border border-slate-100">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-orange-50 text-orange-600 rounded-2xl"><Clock size={20} /></div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pendentes</p>
                </div>
                <h3 className="text-2xl font-black text-slate-900">{therapistAgenda.filter((a: any) => a.date === new Date().toISOString().split('T')[0] && a.status === 'pending').length}</h3>
              </div>
              <div className="bg-white p-4 sm:p-6 rounded-[32px] shadow-sm border border-slate-100">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-red-50 text-red-600 rounded-2xl"><AlertCircle size={20} /></div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Canceladas</p>
                </div>
                <h3 className="text-2xl font-black text-slate-900">{therapistAgenda.filter((a: any) => a.date === new Date().toISOString().split('T')[0] && a.status === 'canceled').length}</h3>
              </div>
            </div>

            {/* Agenda Section */}
            <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 overflow-hidden">
              <div className="p-6 sm:p-8 border-b border-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">Agenda do Dia</h2>
                  <p className="text-slate-500 text-xs font-medium">Controle de atendimentos e salas.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setIsAddSessionModalOpen(true)}
                    className="flex-1 sm:flex-none bg-[#4318FF] text-white px-6 py-3 rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 hover:scale-105 transition-all"
                  >
                    <Plus size={18} /> Agendar
                  </button>
                </div>
              </div>
              
              <div className="p-4 sm:p-8">
                <div className="space-y-4">
                  {currentViewAgenda.length > 0 ? (
                    currentViewAgenda.map((item: any, idx: number) => (
                      <div key={item.id || idx} className="flex items-center gap-4 p-4 bg-slate-50 rounded-3xl border border-slate-100 group hover:bg-white hover:shadow-xl hover:shadow-blue-500/5 transition-all">
                        <div className="w-16 text-center">
                          <p className="text-sm font-black text-[#4318FF]">{item.time}</p>
                        </div>
                        <div className="flex-1">
                          <h4 className="font-bold text-slate-900">{item.name}</h4>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{item.type} • {item.professional}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${
                            item.status === 'confirmed' ? 'bg-green-100 text-green-600' : 
                            item.status === 'canceled' ? 'bg-red-100 text-red-600' : 
                            'bg-orange-100 text-orange-600'
                          }`}>
                            {item.status === 'confirmed' ? 'Confirmado' : item.status === 'canceled' ? 'Cancelado' : 'Pendente'}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-12 opacity-50">
                      <Calendar size={48} className="mx-auto mb-4 text-slate-300" />
                      <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Nenhuma sessão agendada</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      </main>
    </div>
  );
};
