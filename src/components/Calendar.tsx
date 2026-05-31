import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Ban,
  BarChart3,
  Calendar as CalendarIcon,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardCheck,
  Clock,
  Edit2,
  FileText,
  Filter,
  Home,
  Loader2,
  MapPin,
  Monitor,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Stethoscope,
  User,
  Users,
  X,
  Zap
} from 'lucide-react';
import { dataService } from '../services/dataService';
import { formatMinutesHuman, getActualDurationMinutes, getAppointmentDurationMinutes } from '../utils/scheduling';

const normalizeAppointmentStatusKey = (status: any) =>
  String(status || 'scheduled')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const canonicalAppointmentStatus = (status: any) => {
  const normalized = normalizeAppointmentStatusKey(status);
  if (normalized.includes('PENDING') || normalized === 'PENDENTE') return 'PENDING_CONFIRMATION';
  if (normalized.includes('CONFIRM')) return 'CONFIRMED';
  if (normalized.includes('RESCHEDULE_REQUEST')) return 'RESCHEDULE_REQUESTED';
  if (normalized === 'RESCHEDULE' || normalized === 'REMARCAR' || normalized.includes('REMARCACAO_SOLICITADA')) return 'RESCHEDULE_REQUESTED';
  if (normalized.includes('RESCHEDULED') || normalized.includes('REMARCADA')) return 'RESCHEDULED';
  if (normalized.includes('CANCEL_REQUEST') || normalized.includes('CANCELAMENTO_SOLICITADO')) return 'CANCEL_REQUESTED';
  if (normalized.includes('CANCEL')) return 'CANCELLED';
  if (normalized.includes('PROGRESS') || normalized.includes('ANDAMENTO')) return 'IN_PROGRESS';
  if (normalized.includes('COMPLET') || normalized.includes('CONCLUID')) return 'COMPLETED';
  if (normalized.includes('NO_SHOW') || normalized.includes('MISSED') || normalized.includes('FALTA') || normalized.includes('FALTOU')) return 'NO_SHOW';
  return 'SCHEDULED';
};

export const getAppointmentStatusLabel = (status: any) => {
  const canonical = canonicalAppointmentStatus(status);
  const labels: Record<string, string> = {
    SCHEDULED: 'Agendada',
    PENDING_CONFIRMATION: 'Pendente',
    CONFIRMED: 'Confirmada',
    RESCHEDULE_REQUESTED: 'Remarcação solicitada',
    RESCHEDULED: 'Remarcada',
    CANCEL_REQUESTED: 'Cancelamento solicitado',
    CANCELLED: 'Cancelada',
    IN_PROGRESS: 'Em andamento',
    COMPLETED: 'Concluída',
    NO_SHOW: 'Falta'
  };
  return labels[canonical] || labels.SCHEDULED;
};

export const getAppointmentStatusColor = (status: any) => {
  const canonical = canonicalAppointmentStatus(status);
  const colors: Record<string, any> = {
    SCHEDULED: {
      canonical,
      dot: 'bg-slate-400',
      badge: 'border-slate-200 bg-slate-100 text-slate-600',
      soft: 'border-slate-200 bg-white text-slate-800',
      text: 'text-slate-600',
      icon: Clock
    },
    PENDING_CONFIRMATION: {
      canonical,
      dot: 'bg-sky-400',
      badge: 'border-sky-200 bg-sky-50 text-sky-700',
      soft: 'border-sky-100 bg-sky-50/70 text-sky-950',
      text: 'text-sky-700',
      icon: Clock
    },
    CONFIRMED: {
      canonical,
      dot: 'bg-emerald-500',
      badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      soft: 'border-emerald-100 bg-emerald-50/70 text-emerald-950',
      text: 'text-emerald-700',
      icon: CheckCircle2
    },
    RESCHEDULE_REQUESTED: {
      canonical,
      dot: 'bg-amber-500',
      badge: 'border-amber-200 bg-amber-50 text-amber-700',
      soft: 'border-amber-100 bg-amber-50/70 text-amber-950',
      text: 'text-amber-700',
      icon: RefreshCcw
    },
    RESCHEDULED: {
      canonical,
      dot: 'bg-orange-500',
      badge: 'border-orange-200 bg-orange-50 text-orange-700',
      soft: 'border-orange-100 bg-orange-50/70 text-orange-950',
      text: 'text-orange-700',
      icon: RefreshCcw
    },
    CANCEL_REQUESTED: {
      canonical,
      dot: 'bg-rose-500',
      badge: 'border-rose-200 bg-rose-50 text-rose-700',
      soft: 'border-rose-100 bg-rose-50/70 text-rose-950',
      text: 'text-rose-700',
      icon: Ban
    },
    CANCELLED: {
      canonical,
      dot: 'bg-red-500',
      badge: 'border-red-200 bg-red-50 text-red-700',
      soft: 'border-red-100 bg-red-50/70 text-red-950',
      text: 'text-red-700',
      icon: Ban
    },
    IN_PROGRESS: {
      canonical,
      dot: 'bg-violet-500',
      badge: 'border-violet-200 bg-violet-50 text-violet-700',
      soft: 'border-violet-100 bg-violet-50/70 text-violet-950',
      text: 'text-violet-700',
      icon: Play
    },
    COMPLETED: {
      canonical,
      dot: 'bg-emerald-600',
      badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      soft: 'border-emerald-100 bg-emerald-50/60 text-emerald-950',
      text: 'text-emerald-700',
      icon: CheckCircle2
    },
    NO_SHOW: {
      canonical,
      dot: 'bg-pink-500',
      badge: 'border-pink-200 bg-pink-50 text-pink-700',
      soft: 'border-pink-100 bg-pink-50/70 text-pink-950',
      text: 'text-pink-700',
      icon: AlertCircle
    }
  };
  return colors[canonical] || colors.SCHEDULED;
};

const normalizeAgendaStatus = (status: any) => canonicalAppointmentStatus(status).toLowerCase();

const getAgendaStatusDotClass = (status: any) => {
  return getAppointmentStatusColor(status).dot;
};

const getAgendaStatusBadgeClass = (status: any) => {
  return getAppointmentStatusColor(status).badge;
};

const getAgendaStatusLabel = (status: any) => {
  return getAppointmentStatusLabel(status);
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
            <CalendarIcon size={16} className="text-[#4318FF]"/>
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

type ClinicalAgendaView = 'day' | 'week' | 'month';

const CLINICAL_SESSION_TYPES = [
  'ABA',
  'Fonoaudiologia',
  'Terapia Ocupacional',
  'Psicologia',
  'Psicopedagogia',
  'Avaliação',
  'Supervisão',
  'Reunião interdisciplinar',
  'Orientação familiar',
  'Outro'
];

const CLINICAL_STATUS_OPTIONS = [
  { value: 'scheduled', label: 'Agendada' },
  { value: 'pending', label: 'Pendente' },
  { value: 'confirmed', label: 'Confirmada' },
  { value: 'reschedule', label: 'Remarcação solicitada' },
  { value: 'rescheduled', label: 'Remarcada' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'completed', label: 'Concluída' },
  { value: 'no_show', label: 'Falta' },
  { value: 'missed', label: 'Faltou' },
  { value: 'canceled', label: 'Cancelada' },
  { value: 'session_registered', label: 'Sessão registrada' },
  { value: 'report_pending', label: 'Relatório pendente' },
  { value: 'signature_pending', label: 'Assinatura pendente' }
];

const LOCATION_FILTERS = [
  { value: 'sala', label: 'Clínica', icon: MapPin },
  { value: 'online', label: 'Online', icon: Monitor },
  { value: 'domicilio', label: 'Domicílio', icon: Home },
  { value: 'escola', label: 'Escola', icon: Users },
  { value: 'outro', label: 'Outro', icon: MapPin }
];

const HOUR_START = 7;
const HOUR_END = 20;
const HOUR_HEIGHT = 56;

const SESSION_TYPE_STYLES: Record<string, any> = {
  aba: {
    label: 'ABA',
    card: 'border-orange-300 bg-orange-50/90 text-orange-950',
    badge: 'bg-orange-100 text-orange-700 border-orange-200',
    stripe: 'bg-orange-400'
  },
  fonoaudiologia: {
    label: 'Fono',
    card: 'border-emerald-300 bg-emerald-50/90 text-emerald-950',
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    stripe: 'bg-emerald-500'
  },
  terapiaocupacional: {
    label: 'TO',
    card: 'border-sky-300 bg-sky-50/90 text-sky-950',
    badge: 'bg-sky-100 text-sky-700 border-sky-200',
    stripe: 'bg-sky-500'
  },
  psicologia: {
    label: 'Psico',
    card: 'border-purple-300 bg-purple-50/90 text-purple-950',
    badge: 'bg-purple-100 text-purple-700 border-purple-200',
    stripe: 'bg-purple-500'
  },
  psicopedagogia: {
    label: 'Psicoped.',
    card: 'border-teal-300 bg-teal-50/90 text-teal-950',
    badge: 'bg-teal-100 text-teal-700 border-teal-200',
    stripe: 'bg-teal-500'
  },
  avaliacao: {
    label: 'Avaliação',
    card: 'border-amber-300 bg-amber-50/90 text-amber-950',
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
    stripe: 'bg-amber-500'
  },
  supervisao: {
    label: 'Supervisão',
    card: 'border-indigo-300 bg-indigo-50/90 text-indigo-950',
    badge: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    stripe: 'bg-indigo-500'
  },
  reuniaointerdisciplinar: {
    label: 'Reunião',
    card: 'border-slate-300 bg-slate-100 text-slate-900',
    badge: 'bg-slate-200 text-slate-700 border-slate-300',
    stripe: 'bg-slate-500'
  },
  orientacaofamiliar: {
    label: 'Família',
    card: 'border-rose-200 bg-rose-50/90 text-rose-950',
    badge: 'bg-rose-100 text-rose-700 border-rose-200',
    stripe: 'bg-rose-400'
  },
  outro: {
    label: 'Outro',
    card: 'border-stone-300 bg-stone-50 text-stone-900',
    badge: 'bg-stone-100 text-stone-700 border-stone-200',
    stripe: 'bg-stone-500'
  }
};

const removeDiacritics = (value: any) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const getSessionTypeStyle = (type: any) => {
  const key = removeDiacritics(type || 'outro');
  if (key.includes('aba')) return SESSION_TYPE_STYLES.aba;
  if (key.includes('fono')) return SESSION_TYPE_STYLES.fonoaudiologia;
  if (key.includes('ocupacional') || key === 'to') return SESSION_TYPE_STYLES.terapiaocupacional;
  if (key.includes('psicologia')) return SESSION_TYPE_STYLES.psicologia;
  if (key.includes('psicoped')) return SESSION_TYPE_STYLES.psicopedagogia;
  if (key.includes('avali')) return SESSION_TYPE_STYLES.avaliacao;
  if (key.includes('supervis')) return SESSION_TYPE_STYLES.supervisao;
  if (key.includes('reuniao') || key.includes('interdisciplinar')) return SESSION_TYPE_STYLES.reuniaointerdisciplinar;
  if (key.includes('orientacao') || key.includes('famil')) return SESSION_TYPE_STYLES.orientacaofamiliar;
  return SESSION_TYPE_STYLES.outro;
};

const getClinicalStatusStyle = (status: any, event?: any) => {
  const color = getAppointmentStatusColor(status);
  return { label: getAppointmentStatusLabel(status), className: color.badge, icon: color.icon };
};

const normalizeClosureStatus = (status: any) => {
  const value = String(status || '').toUpperCase();
  return ['READY', 'PENDING', 'WARNING', 'NOT_BILLABLE', 'DRAFT', 'UNKNOWN'].includes(value) ? value : '';
};

const getClosureStatusStyle = (status: any) => {
  const normalized = normalizeClosureStatus(status);
  const styles: Record<string, any> = {
    READY: { label: 'Pronta', className: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
    PENDING: { label: 'Pendência', className: 'bg-rose-100 text-rose-700', icon: ClipboardCheck },
    WARNING: { label: 'Atenção', className: 'bg-amber-100 text-amber-700', icon: AlertCircle },
    NOT_BILLABLE: { label: 'Não faturável', className: 'bg-slate-200 text-slate-700', icon: Ban },
    DRAFT: { label: 'Em aberto', className: 'bg-sky-100 text-sky-700', icon: Clock },
    UNKNOWN: { label: 'Dados insuficientes', className: 'bg-zinc-100 text-zinc-700', icon: AlertCircle }
  };
  return styles[normalized] || null;
};

const pad2 = (value: number) => String(value).padStart(2, '0');

const toDateKey = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const dateFromKey = (key: string) => {
  const parsed = new Date(`${key}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const startOfWeekMonday = (date: Date) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + offset);
  return start;
};

const addDays = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

const formatTime = (date: Date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

const parseEventStart = (event: any) => {
  const value = event?.start_time || event?.startTime || event?.scheduled_at || event?.scheduledAt || event?.start;
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const date = event?.date || new Date().toISOString().slice(0, 10);
  const time = event?.time || '08:00';
  const parsed = new Date(`${date}T${String(time).length === 5 ? `${time}:00` : time}`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const parseEventEnd = (event: any, start: Date) => {
  const value = event?.end_time || event?.endTime || event?.end;
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const duration = Number(event?.duration_minutes || event?.durationMinutes || event?.duration || 50);
  return new Date(start.getTime() + (Number.isFinite(duration) && duration > 0 ? duration : 50) * 60 * 1000);
};

const normalizeRoomSpecialties = (value: any): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6);
  }
  return String(value || '')
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
};

const looksLikeTechnicalId = (value: any) => {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) return true;
  if (/^[0-9a-f]{20,}$/i.test(text)) return true;
  if (/^(clinic_room|room|sala)_[0-9a-f-]{8,}$/i.test(text)) return true;
  return false;
};

const sanitizeHumanRoomName = (value: any) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text && !looksLikeTechnicalId(text) ? text : '';
};

const locationTypeLabel = (value: any) => {
  const normalized = removeDiacritics(value || '');
  if (normalized.includes('online') || normalized.includes('remoto')) return 'Online';
  if (normalized.includes('domic')) return 'Domicílio';
  if (normalized.includes('escola')) return 'Escola';
  if (normalized.includes('clinica') || normalized.includes('sala')) return 'Clínica';
  if (normalized.includes('outro')) return 'Outro';
  return 'Local não informado';
};

const resolveRoomInfo = (event: any, roomLookup?: Map<string, any>) => {
  const roomId = String(event?.room_id || event?.roomId || '').trim();
  const matchedRoom = roomId ? roomLookup?.get(roomId) : null;
  const locationType = event?.location_type || event?.locationType || event?.location || (roomId ? 'clinica' : '');
  const locationLabel = event?.location_label || event?.locationLabel || locationTypeLabel(locationType);
  const roomName =
    sanitizeHumanRoomName(event?.room_name) ||
    sanitizeHumanRoomName(event?.roomName) ||
    sanitizeHumanRoomName(event?.roomDisplayName) ||
    sanitizeHumanRoomName(matchedRoom?.name) ||
    sanitizeHumanRoomName(event?.room);
  const roomSpecialties = normalizeRoomSpecialties(
    event?.room_specialties ||
    event?.roomSpecialties ||
    matchedRoom?.specialties ||
    matchedRoom?.specialty ||
    matchedRoom?.description
  );
  const isClinic = removeDiacritics(locationType || locationLabel).includes('clinic') || removeDiacritics(locationType || locationLabel).includes('sala') || Boolean(roomId);
  const safeRoomName = roomName || (isClinic ? (roomId ? 'Sala não identificada' : 'Sala não informada') : '');
  return {
    roomId: roomId || null,
    roomName: safeRoomName,
    roomSpecialties,
    locationType: locationType || (isClinic ? 'clinica' : ''),
    locationLabel,
    roomDisplay: safeRoomName || locationLabel || 'Não informado'
  };
};

const getRoomDisplayLine = (event: any) => {
  const specialties = normalizeRoomSpecialties(event?.roomSpecialties || event?.room_specialties);
  if (event?.roomName) return specialties.length ? `${specialties[0]} · ${event.roomName}` : event.roomName;
  return event?.locationLabel || event?.location || 'Não informado';
};

const classifyLocation = (event: any) => {
  const value = removeDiacritics(`${event?.location || ''} ${event?.location_type || ''} ${event?.room || ''} ${event?.room_name || ''} ${event?.roomDisplayName || ''}`);
  if (value.includes('online') || value.includes('remoto')) return 'online';
  if (value.includes('domic')) return 'domicilio';
  if (value.includes('escola')) return 'escola';
  if (value.includes('clinica') || value.includes('sala') || event?.room_id || event?.room || event?.room_name || event?.roomDisplayName) return 'sala';
  return 'outro';
};

const normalizeClinicalEvent = (event: any, roomLookup?: Map<string, any>) => {
  const start = parseEventStart(event);
  const end = parseEventEnd(event, start);
  const patientName = event?.patient_name || event?.patientName || event?.name || 'Paciente';
  const therapistName = event?.therapist_name || event?.therapistName || event?.therapistDisplayName || event?.professional || 'Equipe';
  const patientId = event?.patient_id || event?.patientId || null;
  const therapistId = event?.therapist_id || event?.therapistId || event?.professionalId || null;
  const type = event?.type || event?.approach || 'Sessão';
  const roomInfo = resolveRoomInfo(event, roomLookup);
  const closureSource = event?.closure && typeof event.closure === 'object' ? event.closure : {};
  const closureReadinessStatus = normalizeClosureStatus(
    event?.closure_readiness_status ||
    event?.closureReadinessStatus ||
    closureSource?.closure_readiness_status ||
    closureSource?.readiness_status
  );
  const normalized = {
    ...event,
    id: String(event?.id || `${patientName}-${start.toISOString()}`),
    patient_id: patientId,
    patientId,
    patient_name: patientName,
    patientName,
    therapist_id: therapistId,
    therapistId,
    therapist_name: therapistName,
    therapistName,
    type,
    status: event?.status || 'scheduled',
    room: roomInfo.roomName,
    roomId: roomInfo.roomId,
    room_id: roomInfo.roomId,
    roomName: roomInfo.roomName,
    room_name: roomInfo.roomName,
    roomSpecialties: roomInfo.roomSpecialties,
    room_specialties: roomInfo.roomSpecialties,
    location: event?.location || classifyLocation(event),
    locationType: roomInfo.locationType,
    location_type: roomInfo.locationType,
    locationLabel: roomInfo.locationLabel,
    location_label: roomInfo.locationLabel,
    start,
    end,
    date: toDateKey(start),
    time: formatTime(start),
    endTime: formatTime(end),
    has_session_record: Boolean(event?.has_session_record ?? event?.hasSessionRecord),
    has_report: Boolean(event?.has_report ?? event?.hasReport),
    has_pending_signature: Boolean(event?.has_pending_signature ?? event?.hasPendingSignature),
    has_next_session_plan: Boolean(event?.has_next_session_plan ?? event?.hasNextSessionPlan),
    has_maintenance_probe: Boolean(event?.has_maintenance_probe ?? event?.hasMaintenanceProbe),
    maintenance_probe_count: Number(event?.maintenance_probe_count ?? event?.maintenanceProbeCount ?? 0),
    plan_item_count: Number(event?.plan_item_count ?? event?.planItemCount ?? 0),
    closure_readiness_status: closureReadinessStatus || null,
    closureReadinessStatus: closureReadinessStatus || null,
    closure_blocking_count: Number(event?.closure_blocking_count ?? event?.closureBlockingCount ?? closureSource?.closure_blocking_count ?? closureSource?.blocking_issues_count ?? 0),
    closure_warning_count: Number(event?.closure_warning_count ?? event?.closureWarningCount ?? closureSource?.closure_warning_count ?? closureSource?.warning_issues_count ?? 0),
    closure_main_issues: Array.isArray(event?.closure_main_issues)
      ? event.closure_main_issues.slice(0, 3)
      : Array.isArray(event?.closureMainIssues)
        ? event.closureMainIssues.slice(0, 3)
        : Array.isArray(closureSource?.closure_main_issues)
          ? closureSource.closure_main_issues.slice(0, 3)
          : Array.isArray(closureSource?.main_issues)
            ? closureSource.main_issues.slice(0, 3)
            : []
  };
  return normalized;
};

const formatLongDate = (date: Date) =>
  date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

const toggleArrayValue = (values: string[], value: string) =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

const getInitials = (name: any) =>
  String(name || 'V')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'V';

export const ClinicalAgendaBoard = ({
  agenda = [],
  patients = [],
  rooms = [],
  teamMembers = [],
  currentUser = null,
  currentDate,
  view = 'month',
  onDateChange,
  onViewChange,
  onCreateAppointment,
  onEditAppointment,
  onConfirmAppointment,
  onCancelAppointment,
  onOpenPatient,
  onStartSession,
  theme = 'light'
}: any) => {
  const isDark = theme === 'dark';
  const activeDate = currentDate instanceof Date ? currentDate : new Date(currentDate || Date.now());
  const [selectedTherapistIds, setSelectedTherapistIds] = useState<string[]>([]);
  const [selectedPatientIds, setSelectedPatientIds] = useState<string[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [patientSearch, setPatientSearch] = useState('');
  const [significantOnly, setSignificantOnly] = useState(false);
  const [improvementOnly, setImprovementOnly] = useState(false);
  const [worseningOnly, setWorseningOnly] = useState(false);
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [timeReportsOpen, setTimeReportsOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    const defaults = {
      calendar: true,
      team: true,
      patients: true,
      location: false,
      type: false,
      status: false
    };
    if (typeof window === 'undefined') return defaults;
    try {
      const saved = window.localStorage.getItem('calendar:filterSections');
      const parsed = saved ? JSON.parse(saved) : null;
      return parsed && typeof parsed === 'object' ? { ...defaults, ...parsed } : defaults;
    } catch {
      return defaults;
    }
  });
  const [remoteEvents, setRemoteEvents] = useState<any[]>([]);
  const [remoteState, setRemoteState] = useState<{ loading: boolean; error: string; loaded: boolean }>({
    loading: false,
    error: '',
    loaded: false
  });
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [selectedDayKeyForPanel, setSelectedDayKeyForPanel] = useState('');
  const [statusActionEvent, setStatusActionEvent] = useState<any>(null);
  const [eventDetail, setEventDetail] = useState<any>(null);
  const [detailState, setDetailState] = useState<{ loading: boolean; error: string }>({ loading: false, error: '' });
  const [closureDetailState, setClosureDetailState] = useState<{ loading: boolean; error: string; data: any | null }>({ loading: false, error: '', data: null });
  const [actionRequestState, setActionRequestState] = useState<{ loadingId: string; error: string }>({ loadingId: '', error: '' });
  const cacheRef = useRef<Map<string, any[]>>(new Map());
  const roomLookup = useMemo(() => {
    const map = new Map<string, any>();
    (rooms || []).forEach((room: any) => {
      const id = String(room?.id || '').trim();
      if (id) map.set(id, room);
      const name = sanitizeHumanRoomName(room?.name);
      if (name) map.set(name, room);
    });
    return map;
  }, [rooms]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('calendar:filterSections', JSON.stringify(expandedSections));
    } catch {
      // Local preference only; ignore storage failures.
    }
  }, [expandedSections]);

  const visibleRange = useMemo(() => {
    if (view === 'month') {
      const start = new Date(activeDate.getFullYear(), activeDate.getMonth(), 1);
      const end = new Date(activeDate.getFullYear(), activeDate.getMonth() + 1, 0);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (view === 'day') {
      const start = new Date(activeDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(activeDate);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    const start = startOfWeekMonday(activeDate);
    const end = addDays(start, 4);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, [activeDate, view]);

  const agendaVersion = useMemo(
    () => (agenda || []).map((item: any) => `${item?.id || ''}:${item?.date || ''}:${item?.time || ''}:${item?.status || ''}`).join('|'),
    [agenda]
  );

  useEffect(() => {
    cacheRef.current.clear();
    const localById = new Map<string, any>();
    for (const item of agenda || []) {
      const id = String(item?.id || '').trim();
      if (id) localById.set(id, item);
    }
    if (localById.size === 0) return;

    const mergeLocalAppointment = (event: any) => {
      const id = String(event?.id || event?.appointment_id || '').trim();
      const local = id ? localById.get(id) : null;
      if (!local) return event;
      return {
        ...event,
        ...local,
        status: local.status ?? event.status,
        notes: local.notes ?? local.note ?? event.notes,
        updated_at: local.updated_at ?? local.updatedAt ?? event.updated_at
      };
    };

    setRemoteEvents((prev) => {
      if (!prev.length) return prev;
      let changed = false;
      const next = prev.map((event: any) => {
        const merged = mergeLocalAppointment(event);
        if (
          merged !== event &&
          (
            String(merged.status || '') !== String(event.status || '') ||
            String(merged.notes || '') !== String(event.notes || '') ||
            String(merged.updated_at || '') !== String(event.updated_at || '')
          )
        ) {
          changed = true;
        }
        return merged;
      });
      return changed ? next : prev;
    });

    setSelectedEvent((prev: any) => {
      if (!prev) return prev;
      const merged = mergeLocalAppointment(prev);
      return merged === prev ? prev : normalizeClinicalEvent(merged, roomLookup);
    });

    setEventDetail((prev: any) => {
      if (!prev?.event) return prev;
      const merged = mergeLocalAppointment(prev.event);
      return merged === prev.event
        ? prev
        : { ...prev, event: normalizeClinicalEvent(merged, roomLookup) };
    });
  }, [agendaVersion, roomLookup]);

  useEffect(() => {
    let cancelled = false;
    const selectedRoomIds = selectedLocations.filter((item) => item.startsWith('room:')).map((item) => item.slice(5)).filter(Boolean);
    const selectedLocationTypes = selectedLocations.filter((item) => !item.startsWith('room:'));
    const params = {
      from: visibleRange.start.toISOString(),
      to: visibleRange.end.toISOString(),
      view,
      therapistId: selectedTherapistIds.join(','),
      patientId: selectedPatientIds.join(','),
      type: selectedTypes.join(','),
      status: selectedStatuses.join(','),
      roomId: selectedRoomIds.join(','),
      locationType: selectedLocationTypes.join(','),
      limit: 180
    };
    const key = JSON.stringify(params);
    const cached = cacheRef.current.get(key);
    if (cached) {
      setRemoteEvents(cached);
      setRemoteState({ loading: false, error: '', loaded: true });
      return;
    }

    setRemoteState((prev) => ({ ...prev, loading: true, error: '' }));
    dataService.getCalendarEvents(params)
      .then((result: any) => {
        if (cancelled) return;
        if (result?.success && Array.isArray(result?.data)) {
          cacheRef.current.set(key, result.data);
          setRemoteEvents(result.data);
          setRemoteState({ loading: false, error: '', loaded: true });
          return;
        }
        setRemoteState({ loading: false, error: result?.error || 'Não foi possível carregar a agenda agora.', loaded: false });
      })
      .catch(() => {
        if (!cancelled) setRemoteState({ loading: false, error: 'Não foi possível carregar a agenda agora.', loaded: false });
      });

    return () => {
      cancelled = true;
    };
  }, [
    visibleRange.start,
    visibleRange.end,
    view,
    selectedTherapistIds.join(','),
    selectedPatientIds.join(','),
    selectedTypes.join(','),
    selectedStatuses.join(','),
    selectedLocations.join(',')
  ]);

  const localEvents = useMemo(() => (agenda || []).map((event: any) => normalizeClinicalEvent(event, roomLookup)), [agenda, roomLookup]);
  const serverEvents = useMemo(() => (remoteEvents || []).map((event: any) => normalizeClinicalEvent(event, roomLookup)), [remoteEvents, roomLookup]);
  const baseEvents = remoteState.loaded ? serverEvents : localEvents;

  const selectedDateKey = toDateKey(activeDate);
  const weekDays = useMemo(() => Array.from({ length: 5 }, (_, index) => addDays(startOfWeekMonday(activeDate), index)), [activeDate]);
  const hourSlots = useMemo(() => Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, index) => HOUR_START + index), []);

  const matchesQuickFilters = (event: any) => {
    const normalizedText = removeDiacritics(`${event?.status || ''} ${event?.clinicalTrend || ''} ${event?.interpretation || ''}`);
    const isAlert = Boolean(event.has_maintenance_probe || event.has_pending_signature || event.has_report === false && normalizedText.includes('conclu') || normalizedText.includes('alert') || normalizedText.includes('regress') || normalizedText.includes('piora'));
    const isSignificant = Boolean(event.has_next_session_plan || event.has_maintenance_probe || event.has_pending_signature || event.has_session_record || isAlert);
    if (significantOnly && !isSignificant) return false;
    if (alertsOnly && !isAlert) return false;
    if (improvementOnly && !(normalizedText.includes('melhora') || normalizedText.includes('improvement'))) return false;
    if (worseningOnly && !(normalizedText.includes('piora') || normalizedText.includes('regress') || normalizedText.includes('wors'))) return false;
    return true;
  };

  const filteredEvents = useMemo(() => {
    const fromTime = visibleRange.start.getTime();
    const toTime = visibleRange.end.getTime();
    return baseEvents
      .filter((event: any) => {
        const startTime = event.start.getTime();
        if (startTime < fromTime || startTime > toTime) return false;
        if (selectedTherapistIds.length > 0 && !selectedTherapistIds.includes(String(event.therapist_id || ''))) return false;
        if (selectedPatientIds.length > 0 && !selectedPatientIds.includes(String(event.patient_id || ''))) return false;
        if (selectedTypes.length > 0 && !selectedTypes.some((type) => removeDiacritics(event.type) === removeDiacritics(type))) return false;
        if (selectedLocations.length > 0) {
          const roomFilter = event.roomId ? `room:${event.roomId}` : '';
          const locationMatches = selectedLocations.includes(classifyLocation(event)) || selectedLocations.includes(event.locationType) || (roomFilter && selectedLocations.includes(roomFilter));
          if (!locationMatches) return false;
        }
        if (selectedStatuses.length > 0) {
          const status = removeDiacritics(event.status);
          const matches = selectedStatuses.some((item) => {
            if (item === 'session_registered') return event.has_session_record;
            if (item === 'report_pending') return !event.has_report && status.includes('conclu');
            if (item === 'signature_pending') return event.has_pending_signature;
            return status.includes(removeDiacritics(item));
          });
          if (!matches) return false;
        }
        return matchesQuickFilters(event);
      })
      .sort((a: any, b: any) => a.start.getTime() - b.start.getTime());
  }, [
    baseEvents,
    visibleRange,
    selectedTherapistIds,
    selectedPatientIds,
    selectedTypes,
    selectedLocations,
    selectedStatuses,
    significantOnly,
    improvementOnly,
    worseningOnly,
    alertsOnly
  ]);

  const periodLabel = useMemo(() => {
    if (view === 'month') return activeDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    if (view === 'day') return activeDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const start = visibleRange.start.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    const end = visibleRange.end.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${start} - ${end}`;
  }, [activeDate, view, visibleRange]);

  const kpis = useMemo(() => {
    const total = filteredEvents.length;
    const registered = filteredEvents.filter((event: any) => event.has_session_record).length;
    const plan = filteredEvents.filter((event: any) => event.has_next_session_plan).length;
    const probes = filteredEvents.filter((event: any) => event.has_maintenance_probe).length;
    const pending = filteredEvents.filter((event: any) => event.has_pending_signature || (!event.has_report && removeDiacritics(event.status).includes('conclu'))).length;
    return { total, registered, plan, probes, pending };
  }, [filteredEvents]);
  const headerKpis = useMemo(() => {
    const items = [
      { label: 'Sessões', value: kpis.total, icon: BarChart3, color: 'text-slate-700', bg: 'bg-slate-100' },
      { label: 'Registradas', value: kpis.registered, icon: CheckCircle2, color: 'text-emerald-700', bg: 'bg-emerald-100' },
      { label: 'Plano', value: kpis.plan, icon: Zap, color: 'text-violet-700', bg: 'bg-violet-100' },
      { label: 'Probes', value: kpis.probes, icon: AlertCircle, color: 'text-amber-700', bg: 'bg-amber-100' },
      { label: 'Pendências', value: kpis.pending, icon: ClipboardCheck, color: 'text-rose-700', bg: 'bg-rose-100' }
    ];
    return items.filter((item) => item.label === 'Sessões' || item.value > 0);
  }, [kpis]);

  const timeReports = useMemo(() => {
    const byPatient = new Map<string, any>();
    const byProfessional = new Map<string, any>();
    const byServiceType = new Map<string, number>();
    const byRoom = new Map<string, number>();
    let scheduledMinutes = 0;
    let actualMinutes = 0;

    filteredEvents.forEach((event: any) => {
      const scheduled = getAppointmentDurationMinutes(event);
      const actual = event.has_session_record || removeDiacritics(event.status).includes('completed') || removeDiacritics(event.status).includes('conclu')
        ? getActualDurationMinutes(event)
        : 0;
      scheduledMinutes += scheduled;
      actualMinutes += actual;

      const patientKey = event.patient_id || event.patientName;
      const patientRow = byPatient.get(patientKey) || { name: event.patientName || 'Paciente', scheduledMinutes: 0, actualMinutes: 0, sessions: 0 };
      patientRow.scheduledMinutes += scheduled;
      patientRow.actualMinutes += actual;
      patientRow.sessions += 1;
      byPatient.set(patientKey, patientRow);

      const professionalKey = event.therapist_id || event.therapistName;
      const professionalRow = byProfessional.get(professionalKey) || { name: event.therapistName || 'Profissional', scheduledMinutes: 0, actualMinutes: 0, sessions: 0, days: new Set<string>() };
      professionalRow.scheduledMinutes += scheduled;
      professionalRow.actualMinutes += actual;
      professionalRow.sessions += 1;
      professionalRow.days.add(event.date);
      byProfessional.set(professionalKey, professionalRow);

      const roomReportLabel = event.roomName || event.room || event.locationLabel || event.location || 'Sem sala/local';
      byServiceType.set(event.type || 'Sessão', (byServiceType.get(event.type || 'Sessão') || 0) + scheduled);
      byRoom.set(roomReportLabel, (byRoom.get(roomReportLabel) || 0) + scheduled);
    });

    const topPatients = Array.from(byPatient.values()).sort((a: any, b: any) => b.scheduledMinutes - a.scheduledMinutes).slice(0, 4);
    const topProfessionals = Array.from(byProfessional.values())
      .map((row: any) => ({ ...row, workedDays: row.days.size }))
      .sort((a: any, b: any) => b.scheduledMinutes - a.scheduledMinutes)
      .slice(0, 4);
    const serviceDistribution = Array.from(byServiceType.entries()).map(([serviceType, minutes]) => ({ serviceType, minutes })).sort((a, b) => b.minutes - a.minutes).slice(0, 5);
    const roomDistribution = Array.from(byRoom.entries()).map(([room, minutes]) => ({ room, minutes })).sort((a, b) => b.minutes - a.minutes).slice(0, 5);
    return { scheduledMinutes, actualMinutes, topPatients, topProfessionals, serviceDistribution, roomDistribution };
  }, [filteredEvents]);

  const filteredPatientOptions = useMemo(() => {
    const search = patientSearch.trim().toLowerCase();
    const recentIds = new Set(baseEvents.slice(0, 30).map((event: any) => String(event.patient_id || '')).filter(Boolean));
    return (patients || [])
      .filter((patient: any) => !search || String(patient?.name || '').toLowerCase().includes(search))
      .sort((a: any, b: any) => Number(recentIds.has(String(b?.id))) - Number(recentIds.has(String(a?.id))))
      .slice(0, 8);
  }, [patients, patientSearch, baseEvents]);

  const moveDate = (direction: -1 | 1) => {
    const next = new Date(activeDate);
    if (view === 'month') next.setMonth(next.getMonth() + direction);
    else if (view === 'week') next.setDate(next.getDate() + direction * 7);
    else next.setDate(next.getDate() + direction);
    onDateChange?.(next);
  };

  const moveMiniCalendarMonth = (direction: -1 | 1) => {
    const next = new Date(activeDate);
    next.setMonth(next.getMonth() + direction);
    onDateChange?.(next);
  };

  const openEventDetail = (event: any) => {
    const normalized = normalizeClinicalEvent(event);
    setSelectedEvent(normalized);
    setEventDetail(null);
    setDetailState({ loading: true, error: '' });
    setClosureDetailState({ loading: false, error: '', data: null });
    dataService.getCalendarEventDetail(normalized.id)
      .then((result: any) => {
        if (result?.success) {
          setEventDetail(result.data || null);
          setDetailState({ loading: false, error: '' });
          return;
        }
        setDetailState({ loading: false, error: result?.error || 'Não foi possível carregar os detalhes da sessão agora.' });
      })
      .catch(() => setDetailState({ loading: false, error: 'Não foi possível carregar os detalhes da sessão agora.' }));
  };

  const openClosureChecklist = (event: any) => {
    const appointmentId = String(event?.id || '').trim();
    if (!appointmentId) return;
    setClosureDetailState({ loading: true, error: '', data: null });
    dataService.getClosureAppointmentDetail(appointmentId)
      .then((result: any) => {
        if (result?.success) {
          setClosureDetailState({ loading: false, error: '', data: result.data || null });
          return;
        }
        setClosureDetailState({ loading: false, error: result?.error || 'Não foi possível carregar o fechamento agora.', data: null });
      })
      .catch(() => setClosureDetailState({ loading: false, error: 'Não foi possível carregar o fechamento agora.', data: null }));
  };

  const openDayPanel = (dateKey: string) => {
    const date = dateFromKey(dateKey);
    onDateChange?.(date);
    setSelectedDayKeyForPanel(dateKey);
  };

  const handleStatusAction = (event: any, action: 'confirm' | 'reschedule' | 'cancel') => {
    const normalized = normalizeClinicalEvent(event, roomLookup);
    if (action === 'confirm') onConfirmAppointment?.(normalized);
    if (action === 'reschedule') onEditAppointment?.(normalized);
    if (action === 'cancel') onCancelAppointment?.(normalized);
    setStatusActionEvent(null);
  };

  const applyUpdatedAppointmentToAgenda = (appointment: any) => {
    if (!appointment?.id) return;
    const normalized = normalizeClinicalEvent(appointment, roomLookup);
    cacheRef.current.clear();
    setRemoteEvents((prev) => prev.map((event: any) => String(event?.id) === String(normalized.id) ? { ...event, ...appointment, status: appointment.status || event.status } : event));
    setSelectedEvent((prev: any) => prev && String(prev?.id) === String(normalized.id) ? { ...prev, ...normalized } : prev);
    setEventDetail((prev: any) => prev ? { ...prev, event: { ...(prev.event || {}), ...appointment } } : prev);
  };

  const handleActionRequestDecision = async (request: any, decision: 'approve' | 'reject') => {
    const requestId = String(request?.id || '').trim();
    if (!requestId) return;
    setActionRequestState({ loadingId: requestId, error: '' });
    const isApprove = decision === 'approve';
    const result = isApprove
      ? await dataService.approveAppointmentActionRequest(requestId, {})
      : await dataService.rejectAppointmentActionRequest(requestId, {});
    if (!result?.success) {
      setActionRequestState({ loadingId: '', error: result?.error || 'Não foi possível atualizar a solicitação.' });
      return;
    }
    applyUpdatedAppointmentToAgenda(result.appointment);
    const currentId = String(selectedEvent?.id || '').trim();
    if (currentId) {
      dataService.getCalendarEventDetail(currentId).then((detailResult: any) => {
        if (detailResult?.success) setEventDetail(detailResult.data || null);
      });
    }
    setActionRequestState({ loadingId: '', error: '' });
  };

  const renderSection = (id: string, title: string, count: number | null, children: React.ReactNode) => {
    const expanded = expandedSections[id] !== false;
    return (
      <div className={`border-b pb-4 last:border-b-0 last:pb-0 ${isDark ? 'border-slate-700' : 'border-slate-100'}`}>
        <button
          type="button"
          onClick={() => setExpandedSections((prev) => ({ ...prev, [id]: !expanded }))}
          className="flex w-full items-center justify-between gap-3 py-2 text-left"
        >
          <span className={`text-[11px] font-bold uppercase tracking-[0.16em] ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>
            {title}
          </span>
          <span className="flex items-center gap-2">
            {count !== null && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-500'}`}>
                {count}
              </span>
            )}
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </button>
        {expanded && <div className="pt-2">{children}</div>}
      </div>
    );
  };

  const renderMiniCalendar = () => {
    const year = activeDate.getFullYear();
    const month = activeDate.getMonth();
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = first.getDay();
    const blanks = Array.from({ length: firstDay }, (_, index) => index);
    const eventDays = new Set(baseEvents.map((event: any) => event.date));
    return (
      <div>
        <div className="mb-3 flex items-center justify-between">
          <button type="button" onClick={() => moveMiniCalendarMonth(-1)} className={`rounded-xl p-2 ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`} aria-label="Mês anterior">
            <ChevronLeft size={16} />
          </button>
          <p className={`text-sm font-bold capitalize ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {activeDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </p>
          <button type="button" onClick={() => moveMiniCalendarMonth(1)} className={`rounded-xl p-2 ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`} aria-label="Próximo mês">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-slate-400">
          {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-1">
          {blanks.map((item) => <span key={`blank-${item}`} />)}
          {Array.from({ length: daysInMonth }, (_, index) => {
            const day = index + 1;
            const date = new Date(year, month, day);
            const key = toDateKey(date);
            const selected = key === selectedDateKey;
            const today = key === toDateKey(new Date());
            return (
              <button
                key={key}
                type="button"
                onClick={() => onDateChange?.(date)}
                className={`relative h-8 rounded-xl text-xs font-semibold transition-all ${
                  selected
                    ? 'bg-[#7a32fc] text-white shadow-lg shadow-violet-500/20'
                    : today
                      ? isDark ? 'bg-slate-800 text-sky-200' : 'bg-sky-50 text-sky-700'
                      : isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {day}
                {eventDays.has(key) && <span className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${selected ? 'bg-white' : 'bg-[#7a32fc]'}`} />}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const chipClass = (active: boolean) =>
    `inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${
      active
        ? 'border-[#7a32fc]/30 bg-[#7a32fc] text-white shadow-sm'
        : isDark ? 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
    }`;

  const renderSidebarContent = () => (
    <div className="space-y-4">
      {renderSection('calendar', 'Mini calendário', null, renderMiniCalendar())}
      {renderSection('team', 'Equipe', selectedTherapistIds.length, (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelectedTherapistIds([])} className={chipClass(selectedTherapistIds.length === 0)}>
              Todos
            </button>
            {currentUser?.id && (
              <button type="button" onClick={() => setSelectedTherapistIds([String(currentUser.id)])} className={chipClass(selectedTherapistIds.includes(String(currentUser.id)))}>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/25 text-[10px]">{getInitials(currentUser.name || currentUser.email)}</span>
                Eu
              </button>
            )}
          </div>
          <div className="space-y-2">
            {(teamMembers || []).slice(0, 8).map((member: any) => (
              <button
                type="button"
                key={member.id || member.label}
                onClick={() => setSelectedTherapistIds((prev) => toggleArrayValue(prev, String(member.id || member.label)))}
                className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left transition-all ${
                  selectedTherapistIds.includes(String(member.id || member.label))
                    ? 'border-[#7a32fc]/40 bg-[#7a32fc]/10'
                    : isDark ? 'border-slate-700 bg-slate-900 hover:bg-slate-800' : 'border-slate-100 bg-white hover:bg-slate-50'
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
                  {getInitials(member.label || member.name)}
                </span>
                <span className="min-w-0">
                  <span className={`block truncate text-xs font-semibold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{member.label || member.name}</span>
                  {member.specialty && <span className="block truncate text-[10px] text-slate-400">{member.specialty}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {renderSection('patients', 'Paciente', selectedPatientIds.length, (
        <div className="space-y-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={patientSearch}
              onChange={(event) => setPatientSearch(event.target.value)}
              placeholder="Buscar paciente..."
              className={`w-full rounded-2xl border py-2.5 pl-9 pr-3 text-sm outline-none transition-all ${
                isDark ? 'border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-500' : 'border-slate-200 bg-white text-slate-700 placeholder:text-slate-400'
              }`}
            />
          </div>
          <div className="space-y-2">
            {filteredPatientOptions.map((patient: any) => (
              <button
                type="button"
                key={patient.id || patient.name}
                onClick={() => setSelectedPatientIds((prev) => toggleArrayValue(prev, String(patient.id)))}
                className={chipClass(selectedPatientIds.includes(String(patient.id)))}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/25 text-[10px]">{getInitials(patient.name)}</span>
                <span className="max-w-[170px] truncate">{patient.name}</span>
              </button>
            ))}
            {filteredPatientOptions.length === 0 && <p className="text-xs text-slate-400">Nenhum paciente encontrado.</p>}
          </div>
        </div>
      ))}
      {renderSection('location', 'Local/Sala', selectedLocations.length, (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {LOCATION_FILTERS.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.value} type="button" onClick={() => setSelectedLocations((prev) => toggleArrayValue(prev, item.value))} className={chipClass(selectedLocations.includes(item.value))}>
                  <Icon size={13} />
                  {item.label}
                </button>
              );
            })}
          </div>
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Salas da clínica</p>
            <div className="flex flex-wrap gap-2">
              {(rooms || [])
                .filter((room: any) => room?.is_active !== false && room?.isActive !== false)
                .slice(0, 12)
                .map((room: any) => {
                  const roomKey = `room:${room.id}`;
                  const specialties = normalizeRoomSpecialties(room.specialties || room.specialty);
                  return (
                    <button
                      key={room.id || room.name}
                      type="button"
                      onClick={() => setSelectedLocations((prev) => toggleArrayValue(prev, roomKey))}
                      className={chipClass(selectedLocations.includes(roomKey))}
                    >
                      <MapPin size={13} />
                      <span className="max-w-[150px] truncate">
                        {sanitizeHumanRoomName(room.name) || 'Sala não identificada'}
                        {specialties[0] ? ` · ${specialties[0]}` : ''}
                      </span>
                    </button>
                  );
                })}
              {(rooms || []).length === 0 && <p className="text-xs font-semibold text-slate-400">Nenhuma sala ativa cadastrada.</p>}
            </div>
          </div>
        </div>
      ))}
      {renderSection('type', 'Tipo de sessão', selectedTypes.length, (
        <div className="flex flex-wrap gap-2">
          {CLINICAL_SESSION_TYPES.map((type) => {
            const style = getSessionTypeStyle(type);
            const active = selectedTypes.includes(type);
            return (
              <button key={type} type="button" onClick={() => setSelectedTypes((prev) => toggleArrayValue(prev, type))} className={`${chipClass(active)} ${active ? '' : style.badge}`}>
                <span className={`h-2 w-2 rounded-full ${style.stripe}`} />
                {type}
              </button>
            );
          })}
        </div>
      ))}
      {renderSection('status', 'Status e pendências', selectedStatuses.length, (
        <div className="flex flex-wrap gap-2">
          {CLINICAL_STATUS_OPTIONS.map((item) => (
            <button key={item.value} type="button" onClick={() => setSelectedStatuses((prev) => toggleArrayValue(prev, item.value))} className={chipClass(selectedStatuses.includes(item.value))}>
              {item.label}
            </button>
          ))}
        </div>
      ))}
      <div className="space-y-2 pt-1">
        {[
          { label: 'Somente significativas', value: significantOnly, set: setSignificantOnly },
          { label: 'Somente melhora', value: improvementOnly, set: setImprovementOnly },
          { label: 'Somente piora', value: worseningOnly, set: setWorseningOnly },
          { label: 'Somente alertas', value: alertsOnly, set: setAlertsOnly }
        ].map((item) => (
          <label key={item.label} className={`flex items-center justify-between rounded-2xl border px-3 py-2 text-xs font-semibold ${isDark ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-slate-100 bg-white text-slate-600'}`}>
            {item.label}
            <input type="checkbox" checked={item.value} onChange={(event) => item.set(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-[#7a32fc]" />
          </label>
        ))}
      </div>
    </div>
  );

  const eventsByDate = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    filteredEvents.forEach((event: any) => {
      if (!grouped[event.date]) grouped[event.date] = [];
      grouped[event.date].push(event);
    });
    return grouped;
  }, [filteredEvents]);
  const selectedDayPanelEvents = selectedDayKeyForPanel ? eventsByDate[selectedDayKeyForPanel] || [] : [];
  const selectedDayPanelLabel = selectedDayKeyForPanel
    ? dateFromKey(selectedDayKeyForPanel).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';

  const renderIndicators = (event: any) => {
    const closureStyle = getClosureStatusStyle(event.closure_readiness_status);
    const indicators = [
      closureStyle ? { label: closureStyle.label, icon: closureStyle.icon, className: closureStyle.className } : null,
      event.has_next_session_plan ? { label: 'Plano', icon: Zap, className: 'bg-violet-100 text-violet-700' } : null,
      event.has_maintenance_probe ? { label: `Probe${event.maintenance_probe_count > 1 ? ` ${event.maintenance_probe_count}` : ''}`, icon: AlertCircle, className: 'bg-amber-100 text-amber-700' } : null,
      event.has_session_record ? { label: 'Registrada', icon: CheckCircle2, className: 'bg-emerald-100 text-emerald-700' } : null,
      event.has_pending_signature ? { label: 'Assinatura', icon: ClipboardCheck, className: 'bg-rose-100 text-rose-700' } : null,
      !event.has_report && removeDiacritics(event.status).includes('conclu') ? { label: 'Relatório', icon: FileText, className: 'bg-orange-100 text-orange-700' } : null
    ].filter(Boolean) as any[];
    if (indicators.length === 0) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-1">
        {indicators.slice(0, 3).map((item) => {
          const Icon = item.icon;
          return (
            <span key={item.label} className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${item.className}`}>
              <Icon size={10} />
              {item.label}
            </span>
          );
        })}
      </div>
    );
  };

  const renderEventCard = (event: any, compact = false) => {
    const style = getSessionTypeStyle(event.type);
    const status = getClinicalStatusStyle(event.status, event);
    const statusColor = getAppointmentStatusColor(event.status);
    const StatusIcon = status.icon;
    return (
      <button
        key={event.id}
        type="button"
        onClick={(clickEvent) => {
          clickEvent.stopPropagation();
          openEventDetail(event);
        }}
        className={`group relative w-full overflow-hidden rounded-xl border p-2 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${statusColor.soft}`}
      >
        <span className={`absolute inset-y-0 left-0 w-1 ${statusColor.dot}`} />
        <div className="pl-1">
          <div className="flex items-start justify-between gap-2">
            <span className="text-[10px] font-semibold leading-tight opacity-75">
              {event.time} - {event.endTime}
            </span>
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${status.className}`}>
              <StatusIcon size={10} />
              {!compact && status.label}
            </span>
          </div>
          <p className={`mt-1 truncate text-sm font-semibold leading-tight ${compact ? 'text-xs' : ''}`}>{event.patientName}</p>
          <p className="mt-1 truncate text-[11px] font-medium opacity-75">
            <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${style.badge}`}>{style.label}</span>
            <span className="ml-1">{getRoomDisplayLine(event)}</span>
          </p>
          {!compact && <p className="mt-1 truncate text-[10px] opacity-65">{event.therapistName}</p>}
          {!compact && renderIndicators(event)}
        </div>
      </button>
    );
  };

  const renderTimeline = (days: Date[]) => {
    const now = new Date();
    const timelineTop = ((now.getHours() * 60 + now.getMinutes()) - HOUR_START * 60) / 60 * HOUR_HEIGHT;
    const showLine = now.getHours() >= HOUR_START && now.getHours() <= HOUR_END;
    const gridHeight = (HOUR_END - HOUR_START + 1) * HOUR_HEIGHT;
    return (
      <div className={`h-full min-h-0 overflow-auto rounded-3xl border ${isDark ? 'border-slate-700 bg-slate-950' : 'border-slate-200 bg-white'}`}>
        <div className={`min-w-[980px] grid ${days.length === 1 ? 'grid-cols-[82px_1fr]' : 'grid-cols-[82px_repeat(5,minmax(0,1fr))]'}`}>
          <div className={`sticky left-0 z-20 border-b px-3 py-4 text-[10px] font-bold uppercase tracking-[0.18em] ${isDark ? 'border-slate-700 bg-slate-950 text-slate-400' : 'border-slate-200 bg-white text-slate-400'}`}>
            Hora
          </div>
          {days.map((day) => {
            const key = toDateKey(day);
            const isToday = key === toDateKey(new Date());
            return (
              <div key={key} className={`border-b border-l px-4 py-3 text-center ${isDark ? 'border-slate-700 bg-slate-950' : 'border-slate-200 bg-white'}`}>
                <p className={`text-xs font-semibold capitalize ${isToday ? 'text-[#7a32fc]' : isDark ? 'text-slate-300' : 'text-slate-500'}`}>
                  {day.toLocaleDateString('pt-BR', { weekday: 'short' })}
                </p>
                <p className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{day.getDate()}</p>
              </div>
            );
          })}

          <div className={`sticky left-0 z-10 ${isDark ? 'bg-slate-950' : 'bg-white'}`} style={{ height: gridHeight }}>
            {hourSlots.map((hour) => (
              <div key={hour} className={`h-[56px] border-b px-3 pt-2 text-xs font-semibold ${isDark ? 'border-slate-800 text-slate-500' : 'border-slate-100 text-slate-400'}`}>
                {pad2(hour)}:00
              </div>
            ))}
          </div>
          {days.map((day) => {
            const key = toDateKey(day);
            const dayEvents = eventsByDate[key] || [];
            const isToday = key === toDateKey(new Date());
            return (
              <div
                key={key}
                className={`relative border-l ${isDark ? 'border-slate-800 bg-slate-950' : 'border-slate-100 bg-white'}`}
                style={{ height: gridHeight }}
                onClick={() => onCreateAppointment?.(key, '08:00')}
              >
                {hourSlots.map((hour) => (
                  <div key={`${key}-${hour}`} className={`h-[56px] border-b ${isDark ? 'border-slate-800/80' : 'border-slate-100'}`} />
                ))}
                {isToday && showLine && (
                  <div className="pointer-events-none absolute left-0 right-0 z-20" style={{ top: timelineTop }}>
                    <div className="relative h-[2px] bg-sky-500">
                      <span className="absolute -left-1 -top-1.5 h-3 w-3 rounded-full bg-sky-500" />
                    </div>
                  </div>
                )}
                {dayEvents.map((event: any, index: number) => {
                  const startMinutes = event.start.getHours() * 60 + event.start.getMinutes();
                  const endMinutes = event.end.getHours() * 60 + event.end.getMinutes();
                  const top = Math.max(0, ((startMinutes - HOUR_START * 60) / 60) * HOUR_HEIGHT);
                  const height = Math.max(48, ((endMinutes - startMinutes) / 60) * HOUR_HEIGHT - 6);
                  const sameStartIndex = dayEvents.slice(0, index).filter((item: any) => item.time === event.time).length;
                  return (
                    <div
                      key={event.id}
                      className="absolute z-10 px-2"
                      style={{
                        top,
                        height,
                        left: `${sameStartIndex * 4 + 4}%`,
                        right: '4%'
                      }}
                    >
                      {renderEventCard(event, height < 72)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderMobileList = () => {
    const dayEvents = eventsByDate[selectedDateKey] || [];
    return (
      <div className={`rounded-3xl border p-4 ${isDark ? 'border-slate-700 bg-slate-950' : 'border-slate-200 bg-white'}`}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Hoje no foco</p>
            <h3 className={`text-base font-bold capitalize ${isDark ? 'text-white' : 'text-slate-900'}`}>{formatLongDate(activeDate)}</h3>
          </div>
          <button type="button" onClick={() => onCreateAppointment?.(selectedDateKey, '08:00')} className="rounded-2xl bg-[#7a32fc] p-3 text-white shadow-lg shadow-violet-500/20">
            <Plus size={18} />
          </button>
        </div>
        <div className="space-y-3">
          {dayEvents.map((event: any) => renderEventCard(event))}
          {dayEvents.length === 0 && <p className="rounded-2xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">Nenhuma sessão neste período.</p>}
        </div>
      </div>
    );
  };

  const renderMonthView = () => {
    const year = activeDate.getFullYear();
    const month = activeDate.getMonth();
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const blanks = Array.from({ length: first.getDay() }, (_, index) => index);
    const dayCells = Array.from({ length: daysInMonth }, (_, index) => index + 1);
    const trailingBlanks = Array.from({ length: Math.max(0, 42 - blanks.length - dayCells.length) }, (_, index) => index);
    return (
      <div className={`flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] border p-2 ${isDark ? 'border-slate-700 bg-slate-950' : 'border-slate-200 bg-white'}`}>
        <div className="grid shrink-0 grid-cols-7 gap-1.5 pb-2 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1.5">
          {blanks.map((blank) => <div key={`month-blank-${blank}`} className={`min-h-0 rounded-xl border ${isDark ? 'border-slate-900 bg-slate-900/40' : 'border-slate-50 bg-slate-50/40'}`} />)}
          {dayCells.map((day) => {
            const date = new Date(year, month, day);
            const key = toDateKey(date);
            const items = eventsByDate[key] || [];
            const isToday = key === toDateKey(new Date());
            const visibleItems = items.slice(0, 10);
            return (
              <div
                key={key}
                role="button"
                tabIndex={0}
                onClick={() => {
                  onDateChange?.(date);
                  if (items.length > 10) openDayPanel(key);
                  else onCreateAppointment?.(key, '08:00');
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  if (items.length > 10) openDayPanel(key);
                  else onCreateAppointment?.(key, '08:00');
                }}
                className={`flex min-h-0 cursor-pointer flex-col overflow-hidden rounded-xl border p-2 text-left transition-all ${
                  key === selectedDateKey
                    ? 'border-[#7a32fc]/40 bg-[#7a32fc]/5'
                    : isToday
                      ? isDark ? 'border-sky-500/40 bg-sky-500/10' : 'border-sky-200 bg-sky-50/60'
                      : isDark ? 'border-slate-800 bg-slate-900 hover:bg-slate-800' : 'border-slate-100 bg-slate-50/60 hover:bg-white'
                }`}
              >
                <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
                  <span className={`text-xs font-bold ${isToday ? 'text-[#7a32fc]' : isDark ? 'text-slate-200' : 'text-slate-700'}`}>{day}</span>
                  {items.length > 0 && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-500'}`}>
                      {items.length}
                    </span>
                  )}
                </div>
                <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 custom-scrollbar">
                  {visibleItems.map((event: any) => {
                    const statusColor = getAppointmentStatusColor(event.status);
                    return (
                      <button
                        key={event.id}
                        type="button"
                        title={`${event.time} ${event.patientName}${event.type ? ` · ${event.type}` : ''}${getRoomDisplayLine(event) ? ` · ${getRoomDisplayLine(event)}` : ''}`}
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          openEventDetail(event);
                        }}
                        className={`flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left text-[10px] font-semibold leading-tight transition-colors ${isDark ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-700 hover:bg-white'}`}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColor.dot}`} />
                        <span className="shrink-0 tabular-nums">{event.time}</span>
                        <span className="min-w-0 truncate">{event.patientName}</span>
                      </button>
                    );
                  })}
                </div>
                {items.length > 10 && (
                  <button
                    type="button"
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation();
                      openDayPanel(key);
                    }}
                    className={`mt-1 shrink-0 rounded-md px-1 py-0.5 text-left text-[10px] font-bold ${isDark ? 'text-violet-300 hover:bg-slate-800' : 'text-[#7a32fc] hover:bg-violet-50'}`}
                  >
                    ver mais
                  </button>
                )}
              </div>
            );
          })}
          {trailingBlanks.map((blank) => <div key={`month-trailing-${blank}`} className={`min-h-0 rounded-xl border ${isDark ? 'border-slate-900 bg-slate-900/40' : 'border-slate-50 bg-slate-50/40'}`} />)}
        </div>
      </div>
    );
  };

  const detail = eventDetail || {};
  const detailEvent = normalizeClinicalEvent({
    ...(selectedEvent || {}),
    ...(detail.event || {}),
    ...(detail.closure || {})
  });
  const planItems = Array.isArray(detail.nextSessionPlanItems) ? detail.nextSessionPlanItems : [];
  const maintenanceProbes = [
    ...(Array.isArray(detail.maintenanceProbes) ? detail.maintenanceProbes : []),
    ...(Array.isArray(detail.overdueMaintenanceProbes) ? detail.overdueMaintenanceProbes : [])
  ];
  const recommendations = Array.isArray(detail.acceptedRecommendations) ? detail.acceptedRecommendations : [];
  const actionRequests = Array.isArray(detail.actionRequests) ? detail.actionRequests : [];
  const statusHistory = Array.isArray(detail.statusHistory) ? detail.statusHistory : [];
  const signatures = Array.isArray(detail.signatures) ? detail.signatures : [];
  const billingContext = detail.billingContext || {};
  const billingDocuments = Array.isArray(billingContext.documents) ? billingContext.documents : [];
  const pendingBillingDocuments = billingDocuments.filter((doc: any) => ['REQUIRED', 'PENDING', 'EXPIRED'].includes(String(doc.status || '').toUpperCase()));

  return (
    <div className="flex flex-col gap-3 pb-[calc(env(safe-area-inset-bottom)+5rem)] xl:h-[calc(100vh-2rem)] xl:min-h-[680px] xl:overflow-hidden xl:pb-0">
      <div className={`shrink-0 rounded-[24px] border p-3 shadow-sm ${isDark ? 'border-slate-700 bg-[#101827] text-slate-100' : 'border-slate-100 bg-white text-slate-900'}`}>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#7a32fc]">Agenda clínica</p>
            <h2 className="mt-0.5 text-xl font-bold tracking-tight">Agenda operacional</h2>
            <p className={`mt-0.5 text-xs ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>Sessões, status e pendências com a agenda sempre à vista.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onDateChange?.(new Date())} className={`rounded-2xl border px-4 py-2 text-xs font-bold ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50'}`}>
              Hoje
            </button>
            <button type="button" onClick={() => moveDate(-1)} className={`rounded-2xl border p-2 ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50'}`} aria-label="Período anterior">
              <ChevronLeft size={18} />
            </button>
            <button type="button" onClick={() => moveDate(1)} className={`rounded-2xl border p-2 ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50'}`} aria-label="Próximo período">
              <ChevronRight size={18} />
            </button>
            <div className="min-w-[190px] text-sm font-bold capitalize">{periodLabel}</div>
            <div className={`flex rounded-2xl p-1 ${isDark ? 'bg-slate-900' : 'bg-slate-100'}`}>
              {[
                { value: 'day', label: 'Dia', icon: CalendarIcon },
                { value: 'week', label: 'Semana', icon: CalendarRange },
                { value: 'month', label: 'Mês', icon: CalendarDays }
              ].map((item) => {
                const Icon = item.icon;
                const active = view === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => onViewChange?.(item.value as ClinicalAgendaView)}
                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all ${active ? 'bg-white text-[#7a32fc] shadow-sm' : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    <Icon size={14} />
                    {item.label}
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => setFilterSheetOpen(true)} className="inline-flex rounded-2xl bg-slate-900 p-2 text-white xl:hidden" aria-label="Abrir filtros">
              <Filter size={18} />
            </button>
            <button type="button" onClick={() => onCreateAppointment?.(selectedDateKey, '08:00')} className="inline-flex items-center gap-2 rounded-2xl bg-[#7a32fc] px-4 py-2 text-xs font-bold text-white shadow-lg shadow-violet-500/20">
              <Plus size={16} />
              Nova sessão
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {headerKpis.map((item) => {
            const Icon = item.icon;
            return (
              <span key={item.label} className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-bold ${isDark ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-slate-100 bg-slate-50/80 text-slate-700'}`}>
                <span className={`rounded-xl p-1 ${item.bg} ${item.color}`}><Icon size={12} /></span>
                {item.label}: <strong className={isDark ? 'text-white' : 'text-slate-900'}>{item.value}</strong>
              </span>
            );
          })}
          {filteredEvents.length > 0 && (
            <button
              type="button"
              onClick={() => setTimeReportsOpen(true)}
              className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-bold ${isDark ? 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800' : 'border-slate-100 bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              <Clock size={13} />
              Tempo: {formatMinutesHuman(timeReports.scheduledMinutes)} previsto
            </button>
          )}
        </div>
      </div>

      <div className="grid flex-1 min-h-0 gap-3 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className={`hidden min-h-0 overflow-hidden rounded-[24px] border shadow-sm xl:block ${isDark ? 'border-slate-700 bg-[#101827] text-slate-100' : 'border-slate-100 bg-white text-slate-900'}`}>
          <div className="h-full overflow-y-auto p-4 pr-3 custom-scrollbar">
            {renderSidebarContent()}
          </div>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
          {remoteState.loading && (
            <div className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold ${isDark ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-slate-100 bg-white text-slate-500'}`}>
              <Loader2 size={16} className="animate-spin" />
              Carregando agenda...
            </div>
          )}
          {remoteState.error && !remoteState.loaded && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              {remoteState.error}
            </div>
          )}
          <div className="xl:hidden">{renderMobileList()}</div>
          <div className="hidden min-h-0 flex-1 xl:block">
            {view === 'month' ? renderMonthView() : renderTimeline(view === 'day' ? [activeDate] : weekDays)}
          </div>
          {view !== 'month' && filteredEvents.length === 0 && !remoteState.loading && (
            <div className={`rounded-3xl border border-dashed px-6 py-10 text-center ${isDark ? 'border-slate-700 bg-slate-900 text-slate-400' : 'border-slate-200 bg-white text-slate-400'}`}>
              <Stethoscope className="mx-auto mb-3" size={24} />
              <p className="text-sm font-semibold">
                {selectedTherapistIds.length || selectedPatientIds.length || selectedTypes.length || selectedStatuses.length || selectedLocations.length || significantOnly || alertsOnly
                  ? 'Nenhum resultado para os filtros selecionados.'
                  : 'Nenhuma sessão neste período.'}
              </p>
            </div>
          )}
        </main>
      </div>

      {timeReportsOpen && (
        <div className="fixed inset-0 z-[138] flex items-end justify-center bg-black/30 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setTimeReportsOpen(false)}>
          <div className={`max-h-[86vh] w-full max-w-3xl overflow-y-auto rounded-t-[28px] p-5 shadow-2xl sm:rounded-[28px] ${isDark ? 'bg-[#101827] text-slate-100' : 'bg-white text-slate-900'}`} onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7a32fc]">Relatórios de tempo</p>
                <h3 className="text-lg font-bold">Tempo clínico e carga operacional</h3>
                <p className={`mt-1 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Resumo do período filtrado, sem ocupar o espaço da agenda.</p>
              </div>
              <button type="button" onClick={() => setTimeReportsOpen(false)} className={`rounded-2xl border p-2 ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50'}`} aria-label="Fechar relatório de tempo">
                <X size={18} />
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
              <span className="rounded-xl bg-slate-100 px-3 py-2">Previsto: {formatMinutesHuman(timeReports.scheduledMinutes)}</span>
              <span className="rounded-xl bg-emerald-100 px-3 py-2 text-emerald-700">Realizado: {formatMinutesHuman(timeReports.actualMinutes)}</span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {[
                { title: 'Pacientes', rows: timeReports.topPatients.map((row: any) => `${row.name}: ${formatMinutesHuman(row.scheduledMinutes)}`) },
                { title: 'Profissionais', rows: timeReports.topProfessionals.map((row: any) => `${row.name}: ${formatMinutesHuman(row.scheduledMinutes)} · ${row.workedDays} dias`) },
                { title: 'Especialidades', rows: timeReports.serviceDistribution.map((row: any) => `${row.serviceType}: ${formatMinutesHuman(row.minutes)}`) },
                { title: 'Salas/locais', rows: timeReports.roomDistribution.map((row: any) => `${row.room}: ${formatMinutesHuman(row.minutes)}`) }
              ].map((section) => (
                <div key={section.title} className={`rounded-2xl border p-3 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-100 bg-slate-50/70'}`}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{section.title}</p>
                  <div className="mt-2 space-y-1">
                    {section.rows.length > 0
                      ? section.rows.map((row: string) => <p key={row} className="truncate text-xs font-semibold text-slate-600">{row}</p>)
                      : <p className="text-xs font-semibold text-slate-400">Sem dados no período.</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedDayKeyForPanel && (
        <div className="fixed inset-0 z-[142] flex items-end justify-center bg-black/35 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setSelectedDayKeyForPanel('')}>
          <div className={`max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-t-[28px] shadow-2xl sm:rounded-[28px] ${isDark ? 'bg-[#101827] text-slate-100' : 'bg-white text-slate-900'}`} onClick={(event) => event.stopPropagation()}>
            <div className={`flex items-start justify-between gap-4 border-b p-5 ${isDark ? 'border-slate-700' : 'border-slate-100'}`}>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7a32fc]">Dia selecionado</p>
                <h3 className="text-lg font-bold">Consultas de {selectedDayPanelLabel}</h3>
                <p className={`mt-1 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{selectedDayPanelEvents.length} consulta(s) no período visível.</p>
              </div>
              <button type="button" onClick={() => setSelectedDayKeyForPanel('')} className={`rounded-2xl border p-2 ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50'}`} aria-label="Fechar consultas do dia">
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[62vh] overflow-y-auto p-4 custom-scrollbar">
              <div className="space-y-2">
                {selectedDayPanelEvents.map((event: any) => {
                  const statusColor = getAppointmentStatusColor(event.status);
                  return (
                    <div key={event.id} className={`rounded-2xl border p-3 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-100 bg-slate-50/70'}`}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${statusColor.dot}`} />
                            <span className="text-sm font-bold tabular-nums">{event.time} - {event.endTime}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusColor.badge}`}>{getAppointmentStatusLabel(event.status)}</span>
                          </div>
                          <p className="mt-1 truncate text-sm font-semibold">{event.patientName}</p>
                          <p className={`mt-1 truncate text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                            {event.type || 'Sessão'} · {event.therapistName || 'Equipe'} · {getRoomDisplayLine(event)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <button type="button" onClick={() => setStatusActionEvent(event)} className="rounded-xl bg-[#7a32fc] px-3 py-2 text-[11px] font-bold text-white">
                            Ações
                          </button>
                          <button type="button" onClick={() => onEditAppointment?.(event)} className={`rounded-xl border px-3 py-2 text-[11px] font-bold ${isDark ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-slate-200 text-slate-600 hover:bg-white'}`}>
                            Editar
                          </button>
                          <button type="button" onClick={() => { setSelectedDayKeyForPanel(''); openEventDetail(event); }} className={`rounded-xl border px-3 py-2 text-[11px] font-bold ${isDark ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-slate-200 text-slate-600 hover:bg-white'}`}>
                            Detalhes
                          </button>
                          <button type="button" onClick={() => onStartSession?.(event)} className={`rounded-xl border px-3 py-2 text-[11px] font-bold ${isDark ? 'border-violet-500/40 text-violet-200 hover:bg-violet-500/10' : 'border-violet-100 text-[#7a32fc] hover:bg-violet-50'}`}>
                            Iniciar
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {selectedDayPanelEvents.length === 0 && <p className="py-8 text-center text-sm font-semibold text-slate-400">Nenhuma consulta neste dia.</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {statusActionEvent && (
        <div className="fixed inset-0 z-[155] flex items-end justify-center bg-black/35 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setStatusActionEvent(null)}>
          <div className="w-full max-w-md rounded-t-[28px] bg-white p-5 text-slate-900 shadow-2xl sm:rounded-[28px]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7a32fc]">Ações da consulta</p>
                <h3 className="text-lg font-bold">{statusActionEvent.patientName || statusActionEvent.patient_name || 'Consulta'}</h3>
                <p className="mt-1 text-xs text-slate-500">{statusActionEvent.time} · {getAppointmentStatusLabel(statusActionEvent.status)}</p>
              </div>
              <button type="button" onClick={() => setStatusActionEvent(null)} className="rounded-2xl border border-violet-100 p-2 text-violet-700 hover:bg-violet-50" aria-label="Fechar ações da consulta">
                <X size={18} />
              </button>
            </div>
            <div className="mt-5 grid gap-2">
              <button type="button" onClick={() => handleStatusAction(statusActionEvent, 'confirm')} className="rounded-2xl bg-[#7a32fc] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-violet-500/20">
                Confirmar
              </button>
              <button type="button" onClick={() => handleStatusAction(statusActionEvent, 'reschedule')} className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm font-bold text-[#7a32fc] hover:bg-violet-50">
                Remarcar
              </button>
              <button type="button" onClick={() => handleStatusAction(statusActionEvent, 'cancel')} className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm font-bold text-[#7a32fc] hover:bg-violet-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {filterSheetOpen && (
        <div className="fixed inset-0 z-[145] flex items-end bg-black/40 p-3 backdrop-blur-sm xl:hidden" onClick={() => setFilterSheetOpen(false)}>
          <div className={`max-h-[88vh] w-full overflow-y-auto rounded-t-[28px] p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl ${isDark ? 'bg-[#101827] text-slate-100' : 'bg-white text-slate-900'}`} onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold">Filtros da agenda</h3>
              <button type="button" onClick={() => setFilterSheetOpen(false)} className="rounded-xl p-2 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
            {renderSidebarContent()}
          </div>
        </div>
      )}

      {selectedEvent && (
        <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setSelectedEvent(null)}>
          <div className={`max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] p-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] shadow-2xl sm:rounded-[28px] sm:p-6 ${isDark ? 'bg-[#101827] text-slate-100' : 'bg-white text-slate-900'}`} onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase ${getSessionTypeStyle(detailEvent.type).badge}`}>
                    {detailEvent.type}
                  </span>
                  <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase ${getClinicalStatusStyle(detailEvent.status, detailEvent).className}`}>
                    {getClinicalStatusStyle(detailEvent.status, detailEvent).label}
                  </span>
                </div>
                <h3 className="text-xl font-bold">{detailEvent.patientName}</h3>
                <p className={`mt-1 text-sm ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>
                  {formatLongDate(detailEvent.start)} · {detailEvent.time} - {detailEvent.endTime}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => onEditAppointment?.(detailEvent)} className={`rounded-2xl border p-2 ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50'}`} aria-label="Editar sessão">
                  <Edit2 size={18} />
                </button>
                <button type="button" onClick={() => setSelectedEvent(null)} className={`rounded-2xl border p-2 ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50'}`} aria-label="Fechar detalhes">
                  <X size={18} />
                </button>
              </div>
            </div>

            {detailState.loading && (
              <div className="mt-5 flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500">
                <Loader2 size={16} className="animate-spin" />
                Carregando detalhes da sessão...
              </div>
            )}
            {detailState.error && (
              <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                {detailState.error}
              </div>
            )}

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                { label: 'Duração', value: `${Math.max(1, Math.round((detailEvent.end.getTime() - detailEvent.start.getTime()) / 60000))} min`, icon: Clock },
                { label: 'Sala/local', value: getRoomDisplayLine(detailEvent), icon: MapPin },
                { label: 'Equipe', value: detailEvent.therapistName || 'Equipe', icon: Users },
                { label: 'Responsável', value: detailEvent.therapistName || 'Não informado', icon: User }
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className={`rounded-2xl border p-4 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-100 bg-slate-50/70'}`}>
                    <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                      <Icon size={13} />
                      {item.label}
                    </p>
                    <p className={`mt-2 text-sm font-semibold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{item.value}</p>
                  </div>
                );
              })}
            </div>

            <div className={`mt-5 rounded-3xl border p-4 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-violet-100 bg-violet-50/70'}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7a32fc]">Pagador e conferência</p>
                  <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                    <p><span className="font-semibold">Pagador:</span> {billingContext.payerName || detailEvent.payer_name_snapshot || 'Sem pagador'}</p>
                    <p><span className="font-semibold">Guia:</span> {billingContext.guideNumber || detailEvent.guide_number || 'Pendente/não informada'}</p>
                    <p><span className="font-semibold">Autorização:</span> {billingContext.authorizationCode || detailEvent.authorization_code || 'Pendente/não informada'}</p>
                    <p><span className="font-semibold">Documentos:</span> {pendingBillingDocuments.length > 0 ? `${pendingBillingDocuments.length} pendente(s)` : 'Sem pendência extra'}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => onEditAppointment?.(detailEvent)} className="rounded-2xl bg-[#7a32fc] px-3 py-2 text-xs font-bold text-white">
                    Editar pagador
                  </button>
                  <button type="button" onClick={() => openClosureChecklist(detailEvent)} className={`rounded-2xl border px-3 py-2 text-xs font-bold ${isDark ? 'border-slate-700 text-slate-200' : 'border-violet-200 bg-white text-[#7a32fc]'}`}>
                    Ver checklist
                  </button>
                </div>
              </div>
            </div>

            {actionRequests.filter((request: any) => request.status === 'PENDING').length > 0 && (
              <div className={`mt-5 rounded-3xl border p-4 ${isDark ? 'border-violet-500/30 bg-violet-500/10' : 'border-violet-100 bg-violet-50/70'}`}>
                <h4 className="flex items-center gap-2 text-sm font-bold text-[#7a32fc]">
                  <RefreshCcw size={16} />
                  SolicitaÃ§Ãµes do responsÃ¡vel
                </h4>
                {actionRequestState.error && (
                  <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    {actionRequestState.error}
                  </div>
                )}
                <div className="mt-3 space-y-2">
                  {actionRequests.filter((request: any) => request.status === 'PENDING').slice(0, 4).map((request: any) => {
                    const isCancel = request.request_type === 'CANCEL';
                    const requestedStart = request.requested_start ? new Date(request.requested_start) : null;
                    const canApprove = isCancel || (requestedStart && !Number.isNaN(requestedStart.getTime()));
                    const loading = actionRequestState.loadingId === String(request.id || '');
                    return (
                      <div key={request.id} className={`rounded-2xl border px-3 py-3 ${isDark ? 'border-slate-700 bg-slate-950' : 'border-white bg-white'}`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-bold">{isCancel ? 'Cancelamento solicitado' : 'RemarcaÃ§Ã£o solicitada'}</p>
                            {request.reason && <p className={`mt-1 text-xs ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>Motivo: {request.reason}</p>}
                            {request.note && <p className={`mt-1 text-xs ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>{request.note}</p>}
                            {!isCancel && requestedStart && !Number.isNaN(requestedStart.getTime()) && (
                              <p className={`mt-1 text-xs font-semibold ${isDark ? 'text-slate-200' : 'text-slate-600'}`}>
                                SugestÃ£o: {requestedStart.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {!canApprove && (
                              <button type="button" onClick={() => onEditAppointment?.(detailEvent)} className="rounded-xl bg-[#7a32fc] px-3 py-2 text-[11px] font-bold text-white">
                                Escolher horÃ¡rio
                              </button>
                            )}
                            {canApprove && (
                              <button type="button" disabled={loading} onClick={() => void handleActionRequestDecision(request, 'approve')} className="rounded-xl bg-[#7a32fc] px-3 py-2 text-[11px] font-bold text-white disabled:opacity-60">
                                {loading ? 'Atualizando...' : isCancel ? 'Aprovar cancelamento' : 'Aprovar'}
                              </button>
                            )}
                            <button type="button" disabled={loading} onClick={() => void handleActionRequestDecision(request, 'reject')} className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-[11px] font-bold text-[#7a32fc] hover:bg-violet-50 disabled:opacity-60">
                              Recusar
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {(signatures.length > 0 || statusHistory.length > 0) && (
              <div className={`mt-5 rounded-3xl border p-4 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-100 bg-slate-50/70'}`}>
                <h4 className="flex items-center gap-2 text-sm font-bold">
                  <ClipboardCheck size={16} className="text-slate-600" />
                  HistÃ³rico operacional
                </h4>
                <div className="mt-3 space-y-2">
                  {signatures.slice(0, 2).map((signature: any, index: number) => (
                    <div key={`signature-${index}`} className="rounded-2xl bg-white/80 px-3 py-2 text-sm">
                      <p className="font-semibold text-slate-800">SessÃ£o assinada por {signature.signedByName || 'responsÃ¡vel'}</p>
                      {signature.signedAt && <p className="mt-0.5 text-xs text-slate-500">{new Date(signature.signedAt).toLocaleString('pt-BR')}</p>}
                    </div>
                  ))}
                  {statusHistory.slice(0, 4).map((entry: any, index: number) => (
                    <div key={`history-${index}`} className="rounded-2xl bg-white/80 px-3 py-2 text-sm">
                      <p className="font-semibold text-slate-800">{entry.label || 'AÃ§Ã£o registrada'}</p>
                      {entry.performedAt && <p className="mt-0.5 text-xs text-slate-500">{new Date(entry.performedAt).toLocaleString('pt-BR')}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detailEvent.closure_readiness_status && (
              <div className={`mt-5 rounded-3xl border p-4 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-100 bg-slate-50/70'}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Fechamento</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {(() => {
                        const closureStyle = getClosureStatusStyle(detailEvent.closure_readiness_status);
                        const ClosureIcon = closureStyle?.icon || AlertCircle;
                        return (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${closureStyle?.className || 'bg-slate-100 text-slate-600'}`}>
                            <ClosureIcon size={13} />
                            {closureStyle?.label || 'Dados insuficientes'}
                          </span>
                        );
                      })()}
                      {Number(detailEvent.closure_blocking_count || 0) > 0 && (
                        <span className="rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">
                          {detailEvent.closure_blocking_count} pendência(s)
                        </span>
                      )}
                      {Number(detailEvent.closure_warning_count || 0) > 0 && (
                        <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                          {detailEvent.closure_warning_count} alerta(s)
                        </span>
                      )}
                    </div>
                    {Array.isArray(detailEvent.closure_main_issues) && detailEvent.closure_main_issues.length > 0 && (
                      <p className={`mt-2 text-sm ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                        {detailEvent.closure_main_issues.slice(0, 2).join(' e ')}.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => openClosureChecklist(detailEvent)}
                    className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-xs font-bold ${isDark ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                  >
                    {closureDetailState.loading ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />}
                    Ver checklist
                  </button>
                </div>
                {closureDetailState.error && (
                  <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    {closureDetailState.error}
                  </div>
                )}
                {Array.isArray(closureDetailState.data?.checklist) && closureDetailState.data.checklist.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {closureDetailState.data.checklist.map((item: any) => {
                      const failed = item.status === 'FAILED';
                      const warning = item.status === 'WARNING';
                      const passed = item.status === 'PASSED';
                      const Icon = passed ? CheckCircle2 : warning ? AlertCircle : failed ? X : Clock;
                      const color = passed ? 'text-emerald-600' : warning ? 'text-amber-600' : failed ? 'text-rose-600' : 'text-slate-400';
                      return (
                        <div key={item.key || item.label} className={`rounded-2xl border px-3 py-2 ${isDark ? 'border-slate-700 bg-slate-950' : 'border-slate-100 bg-white'}`}>
                          <div className="flex items-start gap-2">
                            <Icon size={16} className={`${color} mt-0.5`} />
                            <div>
                              <p className="text-sm font-semibold">{item.label || 'Item de fechamento'}</p>
                              {item.message && <p className={`mt-0.5 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{item.message}</p>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => onStartSession?.(detailEvent)} className="flex items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-violet-500/20">
                <Play size={16} />
                Iniciar sessão
              </button>
              <button type="button" onClick={() => setStatusActionEvent(detailEvent)} className="flex items-center justify-center gap-2 rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm font-bold text-[#7a32fc] hover:bg-violet-50">
                <CheckCircle2 size={16} />
                Ações de status
              </button>
              <button type="button" onClick={() => onOpenPatient?.(detailEvent.patientId, { tab: 'history' }, detailEvent.patientName)} className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50'}`}>
                <FileText size={16} />
                Ver prontuário
              </button>
              <button type="button" onClick={() => onOpenPatient?.(detailEvent.patientId, { tab: 'plan' }, detailEvent.patientName)} className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50'}`}>
                <Zap size={16} />
                Ver plano sugerido
              </button>
              <button type="button" onClick={() => onOpenPatient?.(detailEvent.patientId, { tab: 'report' }, detailEvent.patientName)} className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50'}`}>
                <FileText size={16} />
                Ver relatório
              </button>
              <button type="button" onClick={() => onOpenPatient?.(detailEvent.patientId, { tab: 'history' }, detailEvent.patientName)} className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50'}`}>
                <BarChart3 size={16} />
                Ver gráficos
              </button>
              <button type="button" onClick={() => onEditAppointment?.(detailEvent)} className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50'}`}>
                <RefreshCcw size={16} />
                Remarcar
              </button>
              <button type="button" onClick={() => onCancelAppointment?.(detailEvent)} className="flex items-center justify-center gap-2 rounded-2xl border border-rose-200 px-4 py-3 text-sm font-bold text-rose-600 hover:bg-rose-50">
                <Ban size={16} />
                Cancelar
              </button>
            </div>

            {detailEvent.has_session_record && (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                Sessão registrada. Use os botões acima para abrir relatório e gráficos.
              </div>
            )}

            <div className="mt-5 space-y-3">
              {planItems.length > 0 && (
                <div className={`rounded-3xl border p-4 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-violet-100 bg-violet-50/70'}`}>
                  <h4 className="flex items-center gap-2 text-sm font-bold">
                    <Zap size={16} className="text-violet-600" />
                    Plano sugerido para esta sessão
                  </h4>
                  <div className="mt-3 space-y-2">
                    {planItems.slice(0, 6).map((item: any, index: number) => (
                      <div key={item.id || index} className="rounded-2xl bg-white/70 px-3 py-2 text-sm">
                        <p className="font-semibold text-slate-800">{item.instructions || item.planned_trial_type || 'Item planejado'}</p>
                        <p className="mt-1 text-xs text-slate-500">Prioridade: {item.priority || 'média'} · Ação: {item.planned_prompt || item.planned_trial_type || 'coleta clínica'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {maintenanceProbes.length > 0 && (
                <div className={`rounded-3xl border p-4 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-amber-100 bg-amber-50/70'}`}>
                  <h4 className="flex items-center gap-2 text-sm font-bold">
                    <AlertCircle size={16} className="text-amber-600" />
                    Maintenance Probes pendentes
                  </h4>
                  <div className="mt-3 space-y-2">
                    {maintenanceProbes.slice(0, 6).map((probe: any, index: number) => {
                      const raw = typeof probe.raw_payload === 'object' && probe.raw_payload ? probe.raw_payload : {};
                      return (
                        <div key={probe.id || index} className="rounded-2xl bg-white/70 px-3 py-2 text-sm">
                          <p className="font-semibold text-slate-800">{raw.targetName || raw.target_name || 'Target em manutenção'}</p>
                          <p className="mt-1 text-xs text-slate-500">Marco clínico: {probe.target_due_date ? new Date(probe.target_due_date).toLocaleDateString('pt-BR') : 'a definir'} · Status: {probe.status || 'PENDING'}</p>
                          <button
                            type="button"
                            onClick={() => onStartSession?.({ ...detailEvent, maintenanceProbe: probe, activeCollectionType: 'maintenance_probe' })}
                            className="mt-2 inline-flex min-h-[32px] items-center justify-center rounded-full bg-amber-600 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white"
                          >
                            Usar na sessão
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {recommendations.length > 0 && (
                <div className={`rounded-3xl border p-4 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-100 bg-slate-50'}`}>
                  <h4 className="flex items-center gap-2 text-sm font-bold">
                    <ClipboardCheck size={16} className="text-slate-600" />
                    Recomendações aceitas
                  </h4>
                  <div className="mt-3 space-y-2">
                    {recommendations.slice(0, 4).map((item: any, index: number) => (
                      <div key={item.id || index} className="rounded-2xl bg-white px-3 py-2 text-sm">
                        <p className="font-semibold text-slate-800">{item.title || item.summary || 'Recomendação clínica aceita'}</p>
                        <p className="mt-1 text-xs text-slate-500">{item.suggested_action || item.rationale || 'Aplicar no plano da próxima sessão.'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
