import React from 'react';
import { ChevronLeft, ChevronRight, Calendar, X, Plus } from 'lucide-react';

const normalizeAgendaStatus = (status: any) => String(status || 'pending').toLowerCase();

const getAgendaStatusDotClass = (status: any) => {
  const normalized = normalizeAgendaStatus(status);
  if (normalized === 'confirmed') return 'bg-green-500';
  if (normalized === 'reschedule') return 'bg-amber-500';
  if (normalized === 'canceled' || normalized === 'cancelled') return 'bg-red-500';
  return 'bg-yellow-500';
};

const getAgendaStatusBadgeClass = (status: any) => {
  const normalized = normalizeAgendaStatus(status);
  if (normalized === 'confirmed') return 'bg-green-100 text-green-600';
  if (normalized === 'reschedule') return 'bg-amber-100 text-amber-700';
  if (normalized === 'canceled' || normalized === 'cancelled') return 'bg-red-100 text-red-600';
  return 'bg-yellow-100 text-yellow-600';
};

const getAgendaStatusLabel = (status: any) => {
  const normalized = normalizeAgendaStatus(status);
  if (normalized === 'confirmed') return 'Conf';
  if (normalized === 'reschedule') return 'Remarcar';
  if (normalized === 'canceled' || normalized === 'cancelled') return 'Canc';
  return 'Pend';
};

export const CalendarWidget = ({ agenda, currentDate, onDateChange, onDateSelect, theme = 'light' }: any) => {
  const isDark = theme === 'dark';
  const date = currentDate instanceof Date ? currentDate : new Date(currentDate);
  const year = date.getFullYear();
  const month = date.getMonth();
  
  const getDaysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const getFirstDayOfMonth = (y: number, m: number) => new Date(y, m, 1).getDay();

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const days = [];
  for (let i = 0; i < firstDay; i++) {
    days.push(<div key={`empty-${i}`} className="h-14 md:h-20"></div>);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayAppointments = agenda.filter((a: any) => a.date === dateStr);
    const isToday = new Date().toISOString().split('T')[0] === dateStr;

    days.push(
      <div 
        key={d} 
        onClick={() => onDateSelect(dateStr)}
        className={`h-14 md:h-20 rounded-2xl border flex flex-col items-center justify-start pt-2 cursor-pointer transition-all hover:shadow-md ${
          isDark
            ? isToday
              ? 'bg-[#172b46] text-white border-sky-400 border-2'
              : 'bg-[#101827] border-slate-700 text-slate-200 hover:border-slate-500'
            : isToday
              ? 'bg-white text-[#4318FF] border-[#4318FF] border-2'
              : 'bg-white border-gray-50 text-gray-700 hover:border-gray-200'
        }`}
      >
        <span className={`text-sm font-bold`}>{d}</span>
        <div className="flex gap-1 mt-2 flex-wrap justify-center px-1">
            {dayAppointments.slice(0, 5).map((apt: any, i: number) => (
                <div key={i} className={`w-1.5 h-1.5 rounded-full ${getAgendaStatusDotClass(apt.status)}`}></div>
            ))}
            {dayAppointments.length > 5 && <div className={`w-1.5 h-1.5 rounded-full bg-gray-300`}></div>}
        </div>
      </div>
    );
  }
  
  const changeMonth = (offset: number) => {
      const newDate = new Date(currentDate);
      newDate.setMonth(newDate.getMonth() + offset);
      onDateChange(newDate);
  };

  const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

  return (
    <div className={`${isDark ? 'bg-[#101827] border-slate-700 text-slate-100' : 'bg-white border-gray-100'} p-6 rounded-[32px] border shadow-sm animate-fade-in`}>
        <div className="flex justify-between items-center mb-6">
            <button onClick={() => changeMonth(-1)} className={`p-2 rounded-full transition-colors ${isDark ? 'text-slate-300 hover:bg-[#172b46]' : 'text-gray-500 hover:bg-gray-100'}`}><ChevronLeft size={20}/></button>
            <h3 className={`text-xl font-bold capitalize ${isDark ? 'text-slate-100' : 'text-gray-800'}`}>{monthNames[month]} <span className={isDark ? 'text-slate-400 font-medium' : 'text-gray-400 font-medium'}>{year}</span></h3>
            <button onClick={() => changeMonth(1)} className={`p-2 rounded-full transition-colors ${isDark ? 'text-slate-300 hover:bg-[#172b46]' : 'text-gray-500 hover:bg-gray-100'}`}><ChevronRight size={20}/></button>
        </div>
        <div className="grid grid-cols-7 mb-4">
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => (
                <div key={d} className="text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">{d}</div>
            ))}
        </div>
        <div className="grid grid-cols-7 gap-2">
            {days}
        </div>
        <div className="mt-6 flex items-center justify-center gap-6 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
             <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-green-500"></div> Confirmado</div>
             <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-yellow-500"></div> Pendente</div>
             <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-amber-500"></div> Remarcar</div>
             <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-red-500"></div> Cancelado</div>
        </div>
    </div>
  );
};

export const DayDetailsModal = ({ isOpen, onClose, date, agenda, onAddSession, onPatientClick, onAppointmentClick, theme = 'light' }: any) => {
  if (!isOpen) return null;
  const isDark = theme === 'dark';
  
  const appointments = agenda.filter((a: any) => a.date === date).sort((a: any, b: any) => a.time.localeCompare(b.time));
  const dateObj = new Date(date + 'T00:00:00');
  const dateDisplay = dateObj.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className={`${isDark ? 'bg-[#101827] border border-slate-700 text-slate-100' : 'bg-white'} w-full max-w-md rounded-[32px] p-8 shadow-2xl animate-pop relative max-h-[80vh] flex flex-col`} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className={`absolute top-6 right-6 ${isDark ? 'text-slate-400 hover:text-slate-200' : 'text-gray-400 hover:text-gray-600'}`}><X size={24}/></button>
        <h2 className={`text-xl font-bold mb-1 flex items-center gap-2 tracking-tight capitalize ${isDark ? 'text-slate-100' : 'text-gray-800'}`}>
           {dateDisplay}
        </h2>
        <div className="flex items-center gap-2 mb-6">
            <Calendar size={16} className="text-[#4318FF]"/>
            <p className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>{appointments.length} Agendamentos</p>
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 mb-6 pr-2 -mr-2">
            {appointments.map((apt: any) => (
                <div key={apt.id} onClick={() => onAppointmentClick ? onAppointmentClick(apt) : onPatientClick(apt.patientId ?? apt.id, undefined, apt.patientName || apt.name)} className={`${isDark ? 'bg-[#0b1220] border-slate-700 hover:bg-[#172b46] hover:border-sky-500/50' : 'bg-gray-50 border-gray-100 hover:bg-white hover:border-blue-100'} p-4 rounded-2xl border flex items-center justify-between hover:shadow-sm transition-all group cursor-pointer`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm text-white ${apt.color.replace('text', 'bg').replace('-100', '-500')}`}>
                      {(String(apt?.name || 'P').trim().charAt(0) || 'P').toUpperCase()}
                        </div>
                        <div>
                            <h4 className={`font-bold text-sm group-hover:text-[#4318FF] transition-colors ${isDark ? 'text-slate-100' : 'text-gray-800'}`}>{apt.name}</h4>
                            <p className={isDark ? 'text-xs text-slate-400' : 'text-xs text-gray-500'}>{apt.time} • {apt.type}</p>
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase ${getAgendaStatusBadgeClass(apt.status)}`}>
                        {getAgendaStatusLabel(apt.status)}
                      </span>
                </div>
            ))}
            {appointments.length === 0 && <p className="text-center text-gray-400 text-sm py-4">Nenhum agendamento para este dia.</p>}
        </div>

        <button onClick={() => { onClose(); onAddSession(); }} className="w-full bg-[#4318FF] text-white font-bold py-4 rounded-xl shadow-lg shadow-[#4318FF]/30 hover:opacity-90 transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest text-xs">
            <Plus size={18} /> Agendar Novo Paciente
        </button>
      </div>
    </div>
  );
}
