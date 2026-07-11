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
  Trash2,
  User,
  Users,
  X,
  Zap
} from 'lucide-react';
import { dataService } from '../services/dataService';
import { formatDisplayDate, formatDisplayDateTime, formatDisplayMonthYear } from '../utils/dateFormatting';
import { formatRescheduleOptionLabel, parseRescheduleRequestPayload } from '../services/portalRescheduleAvailability';
import { formatMinutesHuman, getActualDurationMinutes, getAppointmentDurationMinutes } from '../utils/scheduling';
import { resolveMaintenanceTargetDisplay } from '../utils/peiMaintenancePanel';
import { mergeAppointmentIdentity } from '../utils/appointmentActionUpdates';
import {
  APPOINTMENT_FINANCIAL_CONTEXT_OPTIONS,
  APPOINTMENT_FINANCIAL_CONTEXT_REQUIRED_MESSAGE,
  appointmentFinancialContextRequiresPayer,
  getAppointmentFinancialContextLabel,
  normalizeAppointmentFinancialContextType,
} from '../utils/appointmentFinancialContext';
import {
  buildPayerScopedBillingForm,
  clearPayerDependentBillingFields,
  payerScopedBillingSourceLabel,
} from '../utils/appointmentBillingPayerSwitch';
import { resolveAppointmentCancellationState } from '../utils/appointmentCancellationState';
import { getAppointmentPrimaryAction } from '../utils/appointmentPrimaryAction';

const isPersistedUuid = (value: any) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());

const isPersistedMaintenanceScheduleId = (value: any) => {
  const id = String(value || '').trim();
  if (isPersistedUuid(id)) return true;
  return /^maintenance-[a-z0-9][a-z0-9-]{7,}$/i.test(id) && !/(^|-)local-|(^|-)temp-|(^|-)tmp-|(^|-)offline-/i.test(id);
};

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
  if (normalized.includes('CANCEL_REQUEST') || normalized.includes('CANCELAMENTO_SOLICITADO') || normalized.includes('DECLIN') || normalized.includes('RECUS')) return 'CANCEL_REQUESTED';
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
      card: 'border-slate-300 bg-slate-200 text-slate-900 shadow-[0_10px_22px_rgba(100,116,139,0.20)] hover:bg-slate-300',
      text: 'text-slate-600',
      icon: Clock
    },
    PENDING_CONFIRMATION: {
      canonical,
      dot: 'bg-sky-400',
      badge: 'border-sky-200 bg-sky-50 text-sky-700',
      soft: 'border-sky-100 bg-sky-50/70 text-sky-950',
      card: 'border-sky-400 bg-sky-400 text-sky-950 shadow-[0_10px_24px_rgba(14,165,233,0.30)] hover:bg-sky-300',
      text: 'text-sky-700',
      icon: Clock
    },
    CONFIRMED: {
      canonical,
      dot: 'bg-emerald-500',
      badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      soft: 'border-emerald-100 bg-emerald-50/70 text-emerald-950',
      card: 'border-emerald-500 bg-emerald-500 text-white shadow-[0_10px_26px_rgba(16,185,129,0.36)] hover:bg-emerald-400',
      text: 'text-emerald-700',
      icon: CheckCircle2
    },
    RESCHEDULE_REQUESTED: {
      canonical,
      dot: 'bg-amber-500',
      badge: 'border-amber-200 bg-amber-50 text-amber-700',
      soft: 'border-amber-100 bg-amber-50/70 text-amber-950',
      card: 'border-amber-400 bg-amber-400 text-amber-950 shadow-[0_10px_26px_rgba(245,158,11,0.34)] hover:bg-amber-300',
      text: 'text-amber-700',
      icon: RefreshCcw
    },
    RESCHEDULED: {
      canonical,
      dot: 'bg-orange-500',
      badge: 'border-orange-200 bg-orange-50 text-orange-700',
      soft: 'border-orange-100 bg-orange-50/70 text-orange-950',
      card: 'border-orange-500 bg-orange-500 text-white shadow-[0_10px_26px_rgba(249,115,22,0.34)] hover:bg-orange-400',
      text: 'text-orange-700',
      icon: RefreshCcw
    },
    CANCEL_REQUESTED: {
      canonical,
      dot: 'bg-rose-500',
      badge: 'border-rose-200 bg-rose-50 text-rose-700',
      soft: 'border-rose-100 bg-rose-50/70 text-rose-950',
      card: 'border-rose-500 bg-rose-500 text-white shadow-[0_10px_26px_rgba(244,63,94,0.34)] hover:bg-rose-400',
      text: 'text-rose-700',
      icon: Ban
    },
    CANCELLED: {
      canonical,
      dot: 'bg-red-500',
      badge: 'border-red-200 bg-red-50 text-red-700',
      soft: 'border-red-100 bg-red-50/70 text-red-950',
      card: 'border-red-500 bg-red-500 text-white shadow-[0_10px_26px_rgba(239,68,68,0.34)] hover:bg-red-400',
      text: 'text-red-700',
      icon: Ban
    },
    IN_PROGRESS: {
      canonical,
      dot: 'bg-violet-500',
      badge: 'border-violet-200 bg-violet-50 text-violet-700',
      soft: 'border-violet-100 bg-violet-50/70 text-violet-950',
      card: 'border-violet-500 bg-violet-500 text-white shadow-[0_10px_26px_rgba(122,50,252,0.34)] hover:bg-violet-400',
      text: 'text-violet-700',
      icon: Play
    },
    COMPLETED: {
      canonical,
      dot: 'bg-emerald-600',
      badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      soft: 'border-emerald-100 bg-emerald-50/60 text-emerald-950',
      card: 'border-emerald-600 bg-emerald-600 text-white shadow-[0_10px_26px_rgba(5,150,105,0.34)] hover:bg-emerald-500',
      text: 'text-emerald-700',
      icon: CheckCircle2
    },
    NO_SHOW: {
      canonical,
      dot: 'bg-pink-500',
      badge: 'border-pink-200 bg-pink-50 text-pink-700',
      soft: 'border-pink-100 bg-pink-50/70 text-pink-950',
      card: 'border-pink-500 bg-pink-500 text-white shadow-[0_10px_26px_rgba(236,72,153,0.32)] hover:bg-pink-400',
      text: 'text-pink-700',
      icon: AlertCircle
    }
  };
  return colors[canonical] || colors.SCHEDULED;
};

const normalizeAppointmentPatientConfirmationStatus = (appointment: any) => {
  const cancellationState = resolveAppointmentCancellationState(appointment);
  if (cancellationState.status === 'declined') return 'CANCEL_REQUESTED';
  if (cancellationState.status === 'cancelled_by_clinic') return 'CANCELLED_BY_CLINIC';
  if (cancellationState.status === 'cancelled') return 'CANCELLED';
  const raw =
    appointment?.patientConfirmationStatus ||
    appointment?.patient_confirmation_status ||
    appointment?.patientResponse ||
    appointment?.patient_response ||
    appointment?.patientConfirmation ||
    appointment?.patient_confirmation;
  const explicit = canonicalAppointmentStatus(raw);
  if (explicit === 'CONFIRMED') return 'CONFIRMED';
  // Uma consulta remarcada ja foi resolvida pela clinica. Apenas a solicitacao
  // pendente deve manter o badge de remarcacao solicitada.
  if (explicit === 'RESCHEDULE_REQUESTED') return 'RESCHEDULE_REQUESTED';
  if (explicit === 'CANCEL_REQUESTED') return 'CANCEL_REQUESTED';
  const fallback = canonicalAppointmentStatus(appointment?.status || appointment?.appointment_status);
  if (fallback === 'CONFIRMED') return 'CONFIRMED';
  if (fallback === 'RESCHEDULE_REQUESTED') return 'RESCHEDULE_REQUESTED';
  if (fallback === 'CANCEL_REQUESTED') return 'CANCEL_REQUESTED';
  return 'PENDING_CONFIRMATION';
};

export const getAppointmentPatientConfirmationVisualState = (appointment: any) => {
  const canonical = normalizeAppointmentPatientConfirmationStatus(appointment);
  const cancellationState = resolveAppointmentCancellationState(appointment);
  const label =
    cancellationState.label ||
    appointment?.patientConfirmationLabel ||
    appointment?.patient_confirmation_label ||
    {
      CONFIRMED: 'CONFIRMADO',
      RESCHEDULE_REQUESTED: 'REMARCAÇÃO SOLICITADA',
      CANCEL_REQUESTED: 'CANCELAMENTO SOLICITADO',
      CANCELLED_BY_CLINIC: 'CANCELADO PELA CLÍNICA',
      CANCELLED: 'CANCELADO',
      PENDING_CONFIRMATION: 'PENDENTE'
    }[canonical] ||
    'PENDENTE';
  const statusForColor =
    canonical === 'CONFIRMED'
      ? 'confirmed'
      : canonical === 'RESCHEDULE_REQUESTED'
        ? 'reschedule_requested'
        : canonical === 'CANCEL_REQUESTED' || canonical === 'CANCELLED_BY_CLINIC' || canonical === 'CANCELLED'
          ? 'cancel_requested'
          : 'pending';
  return {
    ...getAppointmentStatusColor(statusForColor),
    canonical,
    label,
    responseStatus: canonical
  };
};

const normalizeAgendaStatus = (status: any) => canonicalAppointmentStatus(status).toLowerCase();

const isDeletedAppointmentEvent = (event: any) => {
  const normalizedStatus = normalizeAppointmentStatusKey(event?.status || event?.appointment_status || '');
  return (
    normalizedStatus === 'DELETED' ||
    normalizedStatus.includes('DELET') ||
    normalizedStatus.includes('EXCLUID') ||
    event?.is_active === false ||
    event?.isActive === false ||
    Boolean(event?.deleted_at || event?.deletedAt)
  );
};

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
    const dayAppointments = agenda.filter((a: any) => a.date === dateStr && !isDeletedAppointmentEvent(a));
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
  
  const appointments = agenda.filter((a: any) => a.date === date && !isDeletedAppointmentEvent(a)).sort((a: any, b: any) => a.time.localeCompare(b.time));
  const dateObj = new Date(date + 'T00:00:00');
  const dateDisplay = formatDisplayDate(dateObj);

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
  { value: 'signature_pending', label: 'Assinatura pendente' },
  { value: 'maintenance_only', label: 'Somente manutencoes' },
  { value: 'probes_pending', label: 'Probes pendentes' },
  { value: 'probes_today', label: 'Probes para hoje' },
  { value: 'probes_overdue', label: 'Probes atrasadas' },
  { value: 'maintenance_pending_confirmation', label: 'Pendentes de confirmacao' },
  { value: 'maintenance_unlinked', label: 'Sem sessao vinculada' }
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
export const calculateCalendarEventVisualLayout = (start: Date, end: Date) => {
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const durationMinutes = Math.max(1, endMinutes - startMinutes);
  return {
    top: Math.max(0, ((startMinutes - HOUR_START * 60) / 60) * HOUR_HEIGHT),
    height: (durationMinutes / 60) * HOUR_HEIGHT,
    durationMinutes
  };
};

const getTimelineClickTime = (event: React.MouseEvent<HTMLElement>) => {
  const rect = event.currentTarget.getBoundingClientRect();
  const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
  const minutesFromStart = Math.round(((y / HOUR_HEIGHT) * 60) / 15) * 15;
  const totalMinutes = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60, HOUR_START * 60 + minutesFromStart));
  return `${pad2(Math.floor(totalMinutes / 60))}:${pad2(totalMinutes % 60)}`;
};

export type CalendarVisualEventLayout = ReturnType<typeof calculateCalendarEventVisualLayout> & {
  laneIndex: number;
  laneCount: number;
  widthPercent: number;
  leftPercent: number;
};

const getVisualEventKey = (event: any, index: number) => String(event?.id || event?.localId || event?.clientAppointmentId || `event-${index}`);

export const calculateCalendarOverlappingEventLayouts = (events: any[] = []): Map<string, CalendarVisualEventLayout> => {
  const sorted = (Array.isArray(events) ? events : [])
    .map((event, index) => {
      const start = event?.start instanceof Date ? event.start : new Date(event?.start || event?.scheduled_at || 0);
      const end = event?.end instanceof Date ? event.end : new Date(event?.end || event?.scheduled_end_at || 0);
      return {
        event,
        index,
        key: getVisualEventKey(event, index),
        start,
        end,
        startMs: start.getTime(),
        endMs: end.getTime()
      };
    })
    .filter((item) => Number.isFinite(item.startMs) && Number.isFinite(item.endMs) && item.endMs > item.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.key.localeCompare(b.key));

  const result = new Map<string, CalendarVisualEventLayout>();
  const applyGroup = (group: typeof sorted) => {
    const laneEndTimes: number[] = [];
    const assignments: Array<typeof sorted[number] & { laneIndex: number }> = [];
    group.forEach((item) => {
      let laneIndex = laneEndTimes.findIndex((endMs) => endMs <= item.startMs);
      if (laneIndex < 0) {
        laneIndex = laneEndTimes.length;
        laneEndTimes.push(item.endMs);
      } else {
        laneEndTimes[laneIndex] = item.endMs;
      }
      assignments.push({ ...item, laneIndex });
    });
    const laneCount = Math.max(1, laneEndTimes.length);
    assignments.forEach((item) => {
      const base = calculateCalendarEventVisualLayout(item.start, item.end);
      const widthPercent = 100 / laneCount;
      result.set(item.key, {
        ...base,
        laneIndex: item.laneIndex,
        laneCount,
        widthPercent,
        leftPercent: item.laneIndex * widthPercent
      });
    });
  };

  let group: typeof sorted = [];
  let groupEnd = Number.NEGATIVE_INFINITY;
  sorted.forEach((item) => {
    if (group.length > 0 && item.startMs >= groupEnd) {
      applyGroup(group);
      group = [];
      groupEnd = Number.NEGATIVE_INFINITY;
    }
    group.push(item);
    groupEnd = Math.max(groupEnd, item.endMs);
  });
  if (group.length > 0) applyGroup(group);
  return result;
};
const CALENDAR_EVENTS_CACHE_TTL_MS = 60_000;
const CALENDAR_EVENTS_FOCUS_REFRESH_TTL_MS = 3 * 60_000;
const CALENDAR_DOMAIN_EVENT_DEBOUNCE_MS = 350;

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

const CLOSURE_SECTION_META: Record<string, { title: string; description: string }> = {
  preSession: {
    title: 'Antes da sessão',
    description: 'Preparação que pode ser resolvida pela recepção antes do atendimento.'
  },
  postSession: {
    title: 'Depois da sessão',
    description: 'Conferências clínicas feitas após a conclusão do atendimento.'
  },
  tissBilling: {
    title: 'Faturamento TISS',
    description: 'Itens usados na conferência e na preparação da Pré-guia TISS.'
  }
};

export const getAppointmentClosureOperationalView = (event: any, detail: any = null) => {
  const checklist = Array.isArray(detail?.checklist) ? detail.checklist : [];
  const status = String(event?.status || event?.appointment_status || '').toLowerCase();
  const closureReadinessStatus = normalizeClosureStatus(
    event?.closure_readiness_status ||
    event?.closureReadinessStatus ||
    detail?.readiness_status
  );
  const explicitPhase =
    detail?.phase ||
    checklist.find((item: any) => item?.operationalPhase)?.operationalPhase ||
    event?.closure_operational_phase ||
    event?.closureOperationalPhase;
  const concluded = Boolean(
    event?.has_session_record ||
    event?.hasSessionRecord ||
    event?.actual_end_at ||
    event?.actualEndAt ||
    ['READY', 'PENDING', 'WARNING'].includes(closureReadinessStatus) ||
    ['completed', 'concluida', 'concluída', 'concluido', 'concluído'].includes(status)
  );
  const inSession = !concluded && Boolean(
    event?.actual_start_at ||
    event?.actualStartAt ||
    ['in_progress', 'active'].includes(status)
  );
  const cancellationState = resolveAppointmentCancellationState(event);
  const cancelled = cancellationState.isCancelled || ['no_show', 'missed', 'falta', 'faltou'].includes(status);
  const phase =
    cancelled
      ? 'cancelled'
      : explicitPhase ||
      (
        concluded
          ? closureReadinessStatus === 'READY'
            ? 'prefacturing_ready'
            : 'completed_pending_closure'
          : inSession
            ? 'in_session'
            : 'scheduled_pre_session'
      );
  const blockingCount = Number(
    detail?.phaseSummary?.actionableCount ??
    detail?.blocking_issues_count ??
    event?.closure_blocking_count ??
    0
  );
  const warningCount = Number(detail?.warning_issues_count ?? event?.closure_warning_count ?? 0);
  const actionableCount = detail?.phaseSummary?.actionableCount ?? (blockingCount + warningCount);
  const fallbackSummary: Record<string, { title: string; message: string; status: string }> = {
    scheduled_pre_session: actionableCount > 0
      ? { title: 'Preparação do atendimento', message: `${actionableCount} pendência(s) antes da sessão.`, status: 'blocked' }
      : { title: 'Preparação do atendimento', message: 'Pronto para receber o paciente.', status: 'ready' },
    in_session: { title: 'Sessão em aberto', message: 'Os itens de fechamento serão conferidos após a conclusão.', status: 'open' },
    completed_pending_closure: { title: 'Fechamento da sessão', message: `${actionableCount} pendência(s) para concluir o fechamento.`, status: 'blocked' },
    prefacturing_blocked: { title: 'Faturamento TISS', message: `${actionableCount} bloqueio(s) para Pré-guia TISS.`, status: 'blocked' },
    prefacturing_ready: { title: 'Faturamento TISS', message: 'Pronto para Pré-guia TISS.', status: 'ready' },
    closed_ready_for_prefacturing: { title: 'Faturamento TISS', message: 'Pronto para Pré-guia TISS.', status: 'ready' },
    cancelled: {
      title: 'Consulta cancelada',
      message: cancellationState.message || 'Esta consulta foi cancelada.',
      status: 'info'
    }
  };
  const sections = cancelled ? {
    preSession: [],
    postSession: [],
    tissBilling: []
  } : detail?.sections || {
    preSession: checklist.filter((item: any) => item?.section === 'preSession'),
    postSession: checklist.filter((item: any) => item?.section === 'postSession'),
    tissBilling: checklist.filter((item: any) => item?.section === 'tissBilling')
  };
  return {
    phase,
    phaseSummary: {
      ...(fallbackSummary[phase] || fallbackSummary.scheduled_pre_session),
      ...(cancelled ? {} : detail?.phaseSummary || {}),
      actionableCount: cancelled ? 0 : actionableCount
    },
    sections
  };
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

const sanitizeHumanPayerName = (value: any) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text && !looksLikeTechnicalId(text) ? text : '';
};

const normalizePayerNameKey = (value: any) => removeDiacritics(sanitizeHumanPayerName(value)).replace(/\s+/g, ' ').trim();

const normalizePayerOptions = (items: any[] = []) => {
  const byId = new Map<string, any>();
  const byName = new Map<string, any>();
  return (Array.isArray(items) ? items : [])
    .map((payer: any) => ({
      ...payer,
      id: String(payer?.id || '').trim(),
      name: sanitizeHumanPayerName(payer?.name),
      active: payer?.active !== false && payer?.is_active !== false && String(payer?.status || 'ACTIVE').toUpperCase() !== 'INACTIVE'
    }))
    .filter((payer: any) => payer.id && payer.name)
    .reduce((acc: any[], payer: any) => {
      if (byId.has(payer.id)) return acc;
      byId.set(payer.id, payer);
      const nameKey = normalizePayerNameKey(payer.name);
      const existingByName = byName.get(nameKey);
      if (existingByName) {
        if (!existingByName.active && payer.active) {
          const index = acc.findIndex((item) => String(item.id) === String(existingByName.id));
          if (index >= 0) acc[index] = payer;
          byName.set(nameKey, payer);
        }
        return acc;
      }
      byName.set(nameKey, payer);
      acc.push(payer);
      return acc;
    }, [])
    .sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || ''), 'pt-BR'));
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
  const locationType = roomId
    ? 'clinica'
    : event?.location_type || event?.locationType || event?.location || '';
  const locationLabel = roomId
    ? 'Clínica'
    : event?.location_label || event?.locationLabel || locationTypeLabel(locationType);
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

const getProfessionalDisplayLine = (event: any) => {
  const source = parseEventSourcePayload(event);
  const name = String(
    event?.therapistName ||
      event?.therapist_name ||
      event?.therapist?.name ||
      event?.responsibleProfessionalName ||
      event?.responsible_professional_name ||
      event?.professionalName ||
      event?.professional_name ||
      event?.professional?.name ||
      event?.professional ||
      source?.therapistName ||
      source?.therapist_name ||
      source?.professionalName ||
      source?.professional_name ||
      source?.professional?.name ||
      source?.professional ||
      '',
  ).trim();
  const title = String(
    event?.professionalTitle ||
      event?.professional_title ||
      event?.professionalRole ||
      event?.professional_role ||
      event?.therapistRole ||
      event?.therapist_role ||
      source?.professionalTitle ||
      source?.professional_title ||
      source?.professionalRole ||
      source?.professional_role ||
      source?.therapistRole ||
      source?.therapist_role ||
      '',
  ).trim();
  const normalized = removeDiacritics(name).toLowerCase();
  if (name && !['equipe', 'team', 'profissional', 'profissional nao definido', 'nao informado'].includes(normalized)) {
    const normalizedTitle = removeDiacritics(title).toLowerCase();
    const titleIsProfessional = [
      'psicologo',
      'psicologa',
      'terapeuta ocupacional',
      'acompanhante terapeutico',
      'aplicador aba',
      'profissional'
    ].includes(normalizedTitle);
    const withoutGenericPrefix = name.replace(/^terapeuta\s+/i, '').trim();
    if (titleIsProfessional && !normalized.startsWith(normalizedTitle)) {
      return `${title} ${withoutGenericPrefix || name}`.trim();
    }
    if (/^terapeuta\s+/i.test(name)) {
      return `Psicólogo ${withoutGenericPrefix}`.trim();
    }
    return name;
  }
  return event?.therapistId || event?.therapist_id || event?.professionalId || event?.professional_id
    ? 'Profissional cadastrado não carregado'
    : 'Profissional não definido';
};

const getFamilyResponsibleDisplayLine = (event: any) => {
  const source = parseEventSourcePayload(event);
  const name = String(
    event?.guardianName ||
      event?.guardian_name ||
      event?.familyResponsibleName ||
      event?.family_responsible_name ||
      event?.responsibleName ||
      event?.responsible_name ||
      event?.patient?.responsibleName ||
      event?.patient?.responsible_name ||
      event?.patient?.guardian?.nome ||
      event?.patient?.guardian?.name ||
      event?.patient?.metadata?.guardian?.nome ||
      event?.patient?.metadata?.responsible?.name ||
      source?.guardianName ||
      source?.guardian_name ||
      source?.familyResponsibleName ||
      source?.family_responsible_name ||
      source?.responsibleName ||
      source?.responsible_name ||
      source?.patient?.responsibleName ||
      source?.patient?.responsible_name ||
      source?.patient?.guardian?.nome ||
      source?.patient?.guardian?.name ||
      '',
  ).trim();
  return name || 'Não informado';
};

const isAppointmentPendingOfflineSync = (event: any) => {
  const status = String(event?.syncStatus || event?.sync_status || '').trim().toLowerCase();
  return Boolean(event?.pendingSync || event?.pending_sync || status === 'pending_sync' || status === 'pending');
};

const classifyLocation = (event: any) => {
  const value = removeDiacritics(`${event?.location || ''} ${event?.location_type || ''} ${event?.room || ''} ${event?.room_name || ''} ${event?.roomDisplayName || ''}`);
  if (value.includes('online') || value.includes('remoto')) return 'online';
  if (value.includes('domic')) return 'domicilio';
  if (value.includes('escola')) return 'escola';
  if (value.includes('clinica') || value.includes('sala') || event?.room_id || event?.room || event?.room_name || event?.roomDisplayName) return 'sala';
  return 'outro';
};

const parseEventSourcePayload = (event: any) => {
  const source = event?.source_payload || event?.sourcePayload;
  if (!source) return {};
  if (typeof source === 'object' && !Array.isArray(source)) return source;
  if (typeof source !== 'string') return {};
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const isGenericPatientLabel = (value: any) => {
  const normalized = removeDiacritics(String(value || ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return !normalized || normalized === 'paciente' || normalized === 'patient' || normalized === 'cliente';
};

const pickPatientLabel = (candidates: any[]) => {
  const labels = candidates.map((value) => String(value || '').trim()).filter(Boolean);
  return labels.find((label) => !isGenericPatientLabel(label)) || labels[0] || 'Paciente';
};

const getCalendarEventPatientId = (event: any) => {
  const source = parseEventSourcePayload(event);
  return String(event?.patient_id || event?.patientId || source?.patient_id || source?.patientId || '').trim();
};

const getCalendarEventPatientLabel = (event: any) => {
  const source = parseEventSourcePayload(event);
  return pickPatientLabel([
    event?.patientName,
    event?.patient_name,
    event?.patient?.name,
    source?.patientName,
    source?.patient_name,
    source?.patient?.name,
    event?.name,
    source?.name,
  ]);
};

const hydrateCalendarEventsByKnownPatientNames = (events: any[]) => {
  const namesByPatientId = new Map<string, string>();
  for (const event of events || []) {
    const patientId = getCalendarEventPatientId(event);
    const patientName = getCalendarEventPatientLabel(event);
    if (patientId && patientName && !isGenericPatientLabel(patientName)) {
      namesByPatientId.set(patientId, patientName);
    }
  }
  if (namesByPatientId.size === 0) return events;
  return (events || []).map((event) => {
    const patientId = getCalendarEventPatientId(event);
    const patientName = namesByPatientId.get(patientId);
    if (!patientName || !isGenericPatientLabel(getCalendarEventPatientLabel(event))) return event;
    return {
      ...event,
      patientName,
      patient_name: patientName,
      name: patientName,
    };
  });
};

const mergeAppointmentStatusForRender = (serverEvent: any, localEvent: any) => {
  const serverStatus = serverEvent?.status || serverEvent?.appointment_status;
  const localStatus = localEvent?.status || localEvent?.appointment_status;
  const isResolvedStatus = (status: any) => {
    const canonical = canonicalAppointmentStatus(status);
    return canonical !== 'SCHEDULED' && canonical !== 'PENDING_CONFIRMATION';
  };
  if (isResolvedStatus(serverStatus)) return serverStatus;
  if (isResolvedStatus(localStatus)) return localStatus;
  return localStatus || serverStatus || 'scheduled';
};

const mergeCalendarEventForRender = (serverEvent: any, localEvent: any) => {
  if (!serverEvent) return localEvent;
  if (!localEvent) return serverEvent;
  const mergedEvent = mergeAppointmentIdentity(serverEvent, localEvent);
  const patientName = pickPatientLabel([
    localEvent?.patientName,
    localEvent?.patient_name,
    localEvent?.name,
    serverEvent?.patientName,
    serverEvent?.patient_name,
    serverEvent?.name,
  ]);
  return {
    ...mergedEvent,
    status: mergeAppointmentStatusForRender(serverEvent, localEvent),
    appointment_status: mergeAppointmentStatusForRender(serverEvent, localEvent),
    patient_response: serverEvent?.patient_response || localEvent?.patient_response || null,
    patientResponse: serverEvent?.patientResponse || localEvent?.patientResponse || null,
    patient_confirmation_status: serverEvent?.patient_confirmation_status || localEvent?.patient_confirmation_status || null,
    patientConfirmationStatus: serverEvent?.patientConfirmationStatus || localEvent?.patientConfirmationStatus || null,
    patient_confirmation_at: serverEvent?.patient_confirmation_at || localEvent?.patient_confirmation_at || null,
    patientConfirmationAt: serverEvent?.patientConfirmationAt || localEvent?.patientConfirmationAt || null,
    patient_responded_at: serverEvent?.patient_responded_at || localEvent?.patient_responded_at || null,
    patientRespondedAt: serverEvent?.patientRespondedAt || localEvent?.patientRespondedAt || null,
    patient_confirmation_label: serverEvent?.patient_confirmation_label || localEvent?.patient_confirmation_label || null,
    patientConfirmationLabel: serverEvent?.patientConfirmationLabel || localEvent?.patientConfirmationLabel || null,
    patient_confirmation_color: serverEvent?.patient_confirmation_color || localEvent?.patient_confirmation_color || null,
    patientConfirmationColor: serverEvent?.patientConfirmationColor || localEvent?.patientConfirmationColor || null,
    patient_confirmation_source: serverEvent?.patient_confirmation_source || localEvent?.patient_confirmation_source || null,
    patientConfirmationSource: serverEvent?.patientConfirmationSource || localEvent?.patientConfirmationSource || null,
    patientName,
    patient_name: patientName,
    name: patientName,
    closure_readiness_status: localEvent?.closure_readiness_status || serverEvent?.closure_readiness_status || null,
    closureReadinessStatus: localEvent?.closureReadinessStatus || serverEvent?.closureReadinessStatus || null,
    closure_blocking_count: Number(localEvent?.closure_blocking_count ?? serverEvent?.closure_blocking_count ?? 0),
    closure_warning_count: Number(localEvent?.closure_warning_count ?? serverEvent?.closure_warning_count ?? 0),
    closure_main_issues: Array.isArray(localEvent?.closure_main_issues) && localEvent.closure_main_issues.length > 0
      ? localEvent.closure_main_issues
      : Array.isArray(serverEvent?.closure_main_issues)
        ? serverEvent.closure_main_issues
        : [],
  };
};

const mergeCalendarEventsForRender = (localEvents: any[], serverEvents: any[], remoteLoaded: boolean) => {
  if (!remoteLoaded) return localEvents;
  const byId = new Map<string, any>();
  const withoutId: any[] = [];
  for (const event of serverEvents || []) {
    const id = String(event?.id || event?.appointment_id || '').trim();
    if (id) byId.set(id, event);
    else withoutId.push(event);
  }
  for (const event of localEvents || []) {
    const id = String(event?.id || event?.appointment_id || '').trim();
    if (id) byId.set(id, mergeCalendarEventForRender(byId.get(id), event));
    else withoutId.push(event);
  }
  return hydrateCalendarEventsByKnownPatientNames([...withoutId, ...Array.from(byId.values())]);
};

const normalizeClinicalEvent = (event: any, roomLookup?: Map<string, any>) => {
  const source = parseEventSourcePayload(event);
  const start = parseEventStart(event);
  const end = parseEventEnd(event, start);
  const patientName = pickPatientLabel([
    event?.patient_name,
    event?.patientName,
    event?.patientNameSnapshot,
    event?.patient_name_snapshot,
    event?.patient?.name,
    source?.patient_name,
    source?.patientName,
    source?.patientNameSnapshot,
    source?.patient_name_snapshot,
    source?.patient?.name,
    source?.name,
    event?.name
  ]);
  const rawTherapistName =
    event?.responsible_professional_name ||
    event?.responsibleProfessionalName ||
    event?.therapist_name ||
    event?.therapistName ||
    event?.therapistDisplayName ||
    event?.professionalName ||
    event?.professional_name ||
    event?.professional ||
    source?.responsible_professional_name ||
    source?.responsibleProfessionalName ||
    source?.therapist_name ||
    source?.therapistName ||
    source?.therapistDisplayName ||
    source?.professionalName ||
    source?.professional_name ||
    source?.professional ||
    '';
  const therapistName = ['equipe', 'team'].includes(
    String(rawTherapistName).trim().toLowerCase(),
  )
    ? ''
    : String(rawTherapistName).trim();
  const patientId = event?.patient_id || event?.patientId || source?.patient_id || source?.patientId || null;
  const familyResponsibleName = String(
    event?.guardianName ||
      event?.guardian_name ||
      event?.familyResponsibleName ||
      event?.family_responsible_name ||
      event?.responsibleName ||
      event?.responsible_name ||
      event?.patient?.responsibleName ||
      event?.patient?.responsible_name ||
      event?.patient?.guardian?.nome ||
      event?.patient?.guardian?.name ||
      source?.guardianName ||
      source?.guardian_name ||
      source?.familyResponsibleName ||
      source?.family_responsible_name ||
      source?.responsibleName ||
      source?.responsible_name ||
      source?.patient?.responsibleName ||
      source?.patient?.responsible_name ||
      source?.patient?.guardian?.nome ||
      source?.patient?.guardian?.name ||
      ''
  ).trim();
  const therapistId =
    event?.responsible_professional_id ||
    event?.responsibleProfessionalId ||
    event?.therapist_id ||
    event?.therapistId ||
    event?.professional_id ||
    event?.professionalId ||
    source?.responsible_professional_id ||
    source?.responsibleProfessionalId ||
    source?.therapist_id ||
    source?.therapistId ||
    source?.professional_id ||
    source?.professionalId ||
    null;
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
    guardianName: familyResponsibleName || null,
    guardian_name: familyResponsibleName || null,
    familyResponsibleName: familyResponsibleName || null,
    family_responsible_name: familyResponsibleName || null,
    therapist_id: therapistId,
    therapistId,
    therapist_name: therapistName,
    therapistName,
    responsible_professional_id: therapistId,
    responsibleProfessionalId: therapistId,
    responsible_professional_name: therapistName || null,
    responsibleProfessionalName: therapistName || null,
    type,
    status: event?.status || 'scheduled',
    patient_response: event?.patient_response || event?.patientResponse || source?.patient_response || source?.patientResponse || null,
    patientResponse: event?.patientResponse || event?.patient_response || source?.patientResponse || source?.patient_response || null,
    patient_responded_at: event?.patient_responded_at || event?.patientRespondedAt || source?.patient_responded_at || source?.patientRespondedAt || null,
    patientRespondedAt: event?.patientRespondedAt || event?.patient_responded_at || source?.patientRespondedAt || source?.patient_responded_at || null,
    patient_confirmation_status: event?.patient_confirmation_status || event?.patientConfirmationStatus || source?.patient_confirmation_status || source?.patientConfirmationStatus || null,
    patientConfirmationStatus: event?.patientConfirmationStatus || event?.patient_confirmation_status || source?.patientConfirmationStatus || source?.patient_confirmation_status || null,
    patient_confirmation_label: event?.patient_confirmation_label || event?.patientConfirmationLabel || source?.patient_confirmation_label || source?.patientConfirmationLabel || null,
    patientConfirmationLabel: event?.patientConfirmationLabel || event?.patient_confirmation_label || source?.patientConfirmationLabel || source?.patient_confirmation_label || null,
    patient_confirmation_color: event?.patient_confirmation_color || event?.patientConfirmationColor || source?.patient_confirmation_color || source?.patientConfirmationColor || null,
    patientConfirmationColor: event?.patientConfirmationColor || event?.patient_confirmation_color || source?.patientConfirmationColor || source?.patient_confirmation_color || null,
    patient_confirmation_source: event?.patient_confirmation_source || event?.patientConfirmationSource || source?.patient_confirmation_source || source?.patientConfirmationSource || null,
    patientConfirmationSource: event?.patientConfirmationSource || event?.patient_confirmation_source || source?.patientConfirmationSource || source?.patient_confirmation_source || null,
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
    aba_session_id: event?.aba_session_id || event?.abaSessionId || source?.aba_session_id || source?.abaSessionId || null,
    abaSessionId: event?.abaSessionId || event?.aba_session_id || source?.abaSessionId || source?.aba_session_id || null,
    has_report: Boolean(event?.has_report ?? event?.hasReport),
    has_pending_signature: Boolean(event?.has_pending_signature ?? event?.hasPendingSignature),
    has_next_session_plan: Boolean(event?.has_next_session_plan ?? event?.hasNextSessionPlan),
    has_maintenance_probe: Boolean(event?.has_maintenance_probe ?? event?.hasMaintenanceProbe),
    maintenance_probe_count: Number(event?.maintenance_probe_count ?? event?.maintenanceProbeCount ?? 0),
    pending_maintenance_probe_count: Number(event?.pending_maintenance_probe_count ?? event?.pendingMaintenanceProbeCount ?? 0),
    pending_maintenance_confirmation_count: Number(event?.pending_maintenance_confirmation_count ?? event?.pendingMaintenanceConfirmationCount ?? 0),
    unlinked_maintenance_probe_count: Number(event?.unlinked_maintenance_probe_count ?? event?.unlinkedMaintenanceProbeCount ?? 0),
    maintenance_due_today_count: Number(event?.maintenance_due_today_count ?? event?.maintenanceDueTodayCount ?? 0),
    overdue_maintenance_probe_count: Number(event?.overdue_maintenance_probe_count ?? event?.overdueMaintenanceProbeCount ?? 0),
    has_pending_maintenance_confirmation: Boolean(event?.has_pending_maintenance_confirmation ?? event?.hasPendingMaintenanceConfirmation),
    has_unlinked_maintenance_probe: Boolean(event?.has_unlinked_maintenance_probe ?? event?.hasUnlinkedMaintenanceProbe),
    has_overdue_maintenance_probe: Boolean(event?.has_overdue_maintenance_probe ?? event?.hasOverdueMaintenanceProbe),
    has_maintenance_due_today: Boolean(event?.has_maintenance_due_today ?? event?.hasMaintenanceDueToday),
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

const formatLongDate = (date: Date) => formatDisplayDate(date);

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
  onDeleteAppointment,
  onOpenPatient,
  onStartSession,
  onNavigateTissPreGuides,
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
  const [remoteState, setRemoteState] = useState<{ loading: boolean; refreshing: boolean; error: string; loaded: boolean }>({
    loading: false,
    refreshing: false,
    error: '',
    loaded: false
  });
  const [remoteRefreshNonce, setRemoteRefreshNonce] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [statusActionEvent, setStatusActionEvent] = useState<any>(null);
  const [eventDetail, setEventDetail] = useState<any>(null);
  const [detailState, setDetailState] = useState<{ loading: boolean; error: string }>({ loading: false, error: '' });
  const [closureDetailState, setClosureDetailState] = useState<{ loading: boolean; error: string; data: any | null }>({ loading: false, error: '', data: null });
  const [closureChecklistExpanded, setClosureChecklistExpanded] = useState(false);
  const [actionRequestState, setActionRequestState] = useState<{ loadingId: string; error: string; message?: string }>({ loadingId: '', error: '', message: '' });
  const [actionRequestResolution, setActionRequestResolution] = useState<{ requestId: string; note: string }>({ requestId: '', note: '' });
  const [billingEditorOpen, setBillingEditorOpen] = useState(false);
  const [financialValidationOpen, setFinancialValidationOpen] = useState(false);
  const [billingEditorState, setBillingEditorState] = useState<{ loading: boolean; saving: boolean; error: string; success: string }>({
    loading: false,
    saving: false,
    error: '',
    success: ''
  });
  const [billingPayers, setBillingPayers] = useState<any[]>([]);
  const [billingPayersLoaded, setBillingPayersLoaded] = useState(false);
  const [billingPayerResolution, setBillingPayerResolution] = useState<{
    loading: boolean;
    error: string;
    payerId: string;
    suggestion: any | null;
    searched: boolean;
  }>({ loading: false, error: '', payerId: '', suggestion: null, searched: false });
  const [billingManualOverrideOpen, setBillingManualOverrideOpen] = useState(false);
  const [billingForm, setBillingForm] = useState({
    financialContextType: 'INSURANCE',
    payerId: '',
    payerName: '',
    serviceType: '',
    insuranceCardNumber: '',
    insurancePlanName: '',
    guideNumber: '',
    authorizationCode: '',
    patientTissAuthorizationId: '',
    procedureCode: '',
    notes: '',
    source: ''
  });
  const [quickPayerForm, setQuickPayerForm] = useState({
    open: false,
    saving: false,
    error: '',
    name: '',
    payerType: 'INSURANCE'
  });
  const cacheRef = useRef<Map<string, { data: any[]; fetchedAt: number }>>(new Map());
  const inFlightRequestRef = useRef<{ key: string; controller: AbortController | null } | null>(null);
  const lastSuccessfulFetchAtRef = useRef(0);
  const refreshDebounceTimerRef = useRef<number | null>(null);
  const pendingVisibilityRefreshRef = useRef(false);
  const localAgendaIdsRef = useRef(new Set<string>());
  const canEditBillingContext = ['coordinator', 'admin', 'owner'].includes(String(currentUser?.role || '').toLowerCase());
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
      if (isDeletedAppointmentEvent(item)) continue;
      const id = String(item?.id || '').trim();
      if (id) localById.set(id, item);
    }
    const removedLocalIds = new Set<string>();
    localAgendaIdsRef.current.forEach((id: any) => {
      const normalizedId = String(id || '');
      if (normalizedId && !localById.has(normalizedId)) removedLocalIds.add(normalizedId);
    });
    localAgendaIdsRef.current = new Set(localById.keys());
    if (removedLocalIds.size > 0) {
      setRemoteEvents((prev) => prev.filter((event: any) => !removedLocalIds.has(String(event?.id || event?.appointment_id || ''))));
      setSelectedEvent((prev: any) => prev && removedLocalIds.has(String(prev?.id || prev?.appointment_id || '')) ? null : prev);
      setEventDetail((prev: any) => prev?.event && removedLocalIds.has(String(prev.event?.id || prev.event?.appointment_id || '')) ? null : prev);
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
            String(merged.recurrenceGroupId || merged.recurrence_group_id || '') !== String(event.recurrenceGroupId || event.recurrence_group_id || '') ||
            String(merged.recurrenceIndex || merged.recurrence_index || '') !== String(event.recurrenceIndex || event.recurrence_index || '') ||
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
    if (cached && Date.now() - cached.fetchedAt < CALENDAR_EVENTS_CACHE_TTL_MS) {
      setRemoteEvents(cached.data);
      setRemoteState({ loading: false, refreshing: false, error: '', loaded: true });
      return;
    }
    if (inFlightRequestRef.current?.key === key) return;
    if (inFlightRequestRef.current?.controller) {
      inFlightRequestRef.current.controller.abort();
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    inFlightRequestRef.current = { key, controller };

    setRemoteState((prev) => ({ ...prev, loading: !prev.loaded, refreshing: prev.loaded, error: '' }));
    dataService.getCalendarEvents({ ...params, signal: controller?.signal })
      .then((result: any) => {
        if (cancelled || inFlightRequestRef.current?.key !== key || result?.aborted) return;
        if (result?.success && Array.isArray(result?.data)) {
          const fetchedAt = Date.now();
          lastSuccessfulFetchAtRef.current = fetchedAt;
          cacheRef.current.set(key, { data: result.data, fetchedAt });
          setRemoteEvents(result.data);
          setRemoteState({ loading: false, refreshing: false, error: '', loaded: true });
          return;
        }
        setRemoteState((prev) => ({
          loading: false,
          refreshing: false,
          error: result?.error || 'Não foi possível carregar a agenda agora.',
          loaded: prev.loaded
        }));
      })
      .catch((error: any) => {
        if (cancelled || error?.name === 'AbortError') return;
        setRemoteState((prev) => ({
          loading: false,
          refreshing: false,
          error: 'Não foi possível carregar a agenda agora.',
          loaded: prev.loaded
        }));
      })
      .finally(() => {
        if (inFlightRequestRef.current?.key === key) inFlightRequestRef.current = null;
      });

    return () => {
      cancelled = true;
      if (inFlightRequestRef.current?.key === key) {
        inFlightRequestRef.current.controller?.abort();
      }
    };
  }, [
    visibleRange.start.getTime(),
    visibleRange.end.getTime(),
    view,
    selectedTherapistIds.join(','),
    selectedPatientIds.join(','),
    selectedTypes.join(','),
    selectedStatuses.join(','),
    selectedLocations.join(','),
    remoteRefreshNonce
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const forceRefresh = () => {
      pendingVisibilityRefreshRef.current = false;
      cacheRef.current.clear();
      setRemoteRefreshNonce((value) => value + 1);
    };
    const requestRefresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        pendingVisibilityRefreshRef.current = true;
        return;
      }
      if (refreshDebounceTimerRef.current) return;
      refreshDebounceTimerRef.current = window.setTimeout(() => {
        refreshDebounceTimerRef.current = null;
        forceRefresh();
      }, CALENDAR_DOMAIN_EVENT_DEBOUNCE_MS);
    };
    const refreshWhenVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (
        !pendingVisibilityRefreshRef.current &&
        Date.now() - lastSuccessfulFetchAtRef.current < CALENDAR_EVENTS_FOCUS_REFRESH_TTL_MS
      ) {
        return;
      }
      forceRefresh();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('verto:appointment-domain-event', requestRefresh as EventListener);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('verto:appointment-domain-event', requestRefresh as EventListener);
      if (refreshDebounceTimerRef.current) {
        window.clearTimeout(refreshDebounceTimerRef.current);
        refreshDebounceTimerRef.current = null;
      }
    };
  }, []);

  const localEvents = useMemo(() => (agenda || []).filter((event: any) => !isDeletedAppointmentEvent(event)).map((event: any) => normalizeClinicalEvent(event, roomLookup)), [agenda, roomLookup]);
  const serverEvents = useMemo(() => (remoteEvents || []).filter((event: any) => !isDeletedAppointmentEvent(event)).map((event: any) => normalizeClinicalEvent(event, roomLookup)), [remoteEvents, roomLookup]);
  const baseEvents = useMemo(
    () => mergeCalendarEventsForRender(localEvents, serverEvents, remoteState.loaded),
    [localEvents, serverEvents, remoteState.loaded]
  );

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
        if (isDeletedAppointmentEvent(event)) return false;
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
            if (item === 'maintenance_only') return event.has_maintenance_probe;
            if (item === 'probes_pending') return Number(event.pending_maintenance_probe_count || 0) > 0;
            if (item === 'probes_today') return Number(event.maintenance_due_today_count || 0) > 0;
            if (item === 'probes_overdue') return Number(event.overdue_maintenance_probe_count || 0) > 0;
            if (item === 'maintenance_pending_confirmation') return Number(event.pending_maintenance_confirmation_count || 0) > 0;
            if (item === 'maintenance_unlinked') return Number(event.unlinked_maintenance_probe_count || 0) > 0;
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
    if (view === 'month') return formatDisplayMonthYear(activeDate);
    if (view === 'day') return formatDisplayDate(activeDate);
    const start = formatDisplayDate(visibleRange.start);
    const end = formatDisplayDate(visibleRange.end);
    return `${start} - ${end}`;
  }, [activeDate, view, visibleRange]);

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

  const openEventDetail = (event: any) => {
    const normalized = normalizeClinicalEvent(event);
    setSelectedEvent(normalized);
    setEventDetail(null);
    setDetailState({ loading: true, error: '' });
    setClosureChecklistExpanded(false);
    setClosureDetailState({ loading: true, error: '', data: null });
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
    dataService.getClosureAppointmentDetail(normalized.id)
      .then((result: any) => {
        if (result?.success) {
          setClosureDetailState({ loading: false, error: '', data: result.data || null });
          return;
        }
        setClosureDetailState({ loading: false, error: result?.error || 'Não foi possível carregar o fechamento agora.', data: null });
      })
      .catch(() => setClosureDetailState({ loading: false, error: 'Não foi possível carregar o fechamento agora.', data: null }));
  };

  const openClosureChecklist = (event: any) => {
    if (closureDetailState.data) {
      setClosureChecklistExpanded((current) => !current);
      return;
    }
    const appointmentId = String(event?.id || '').trim();
    if (!appointmentId) return;
    setClosureChecklistExpanded(true);
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

  const handleStatusAction = (event: any, action: 'confirm' | 'reschedule' | 'cancel' | 'delete') => {
    const normalized = normalizeClinicalEvent(event, roomLookup);
    if (action === 'confirm') onConfirmAppointment?.(normalized);
    if (action === 'reschedule') onEditAppointment?.(normalized);
    if (action === 'cancel') onCancelAppointment?.(normalized);
    if (action === 'delete') onDeleteAppointment?.(normalized);
    setStatusActionEvent(null);
  };

  const applyUpdatedAppointmentToAgenda = (appointment: any) => {
    if (!appointment?.id) return;
    const normalized = normalizeClinicalEvent(appointment, roomLookup);
    cacheRef.current.clear();
    setRemoteEvents((prev) => prev.map((event: any) =>
      String(event?.id) === String(normalized.id)
        ? normalizeClinicalEvent({ ...event, ...appointment, status: appointment.status || event.status }, roomLookup)
        : event
    ));
    setSelectedEvent((prev: any) => prev && String(prev?.id) === String(normalized.id) ? { ...prev, ...normalized } : prev);
    setEventDetail((prev: any) => prev ? { ...prev, event: { ...(prev.event || {}), ...appointment } } : prev);
  };

  const hydrateBillingForm = (source: any = {}) => {
    const financialContextType =
      normalizeAppointmentFinancialContextType(
        source?.financialContextType ||
          source?.financial_context_type ||
          source?.billingContextType ||
          source?.billing_context_type ||
          source?.payerType ||
          source?.payer_type ||
          (source?.payerId || source?.payer_id ? 'INSURANCE' : '')
      ) || 'INSURANCE';
    setBillingForm({
      financialContextType,
      payerId: financialContextType === 'INSURANCE' ? String(source?.payerId || source?.payer_id || '') : '',
      payerName: financialContextType === 'INSURANCE' ? sanitizeHumanPayerName(source?.payerName || source?.payer_name_snapshot || '') : '',
      serviceType: String(source?.serviceType || source?.service_type || detailEvent.type || ''),
      insuranceCardNumber: financialContextType === 'INSURANCE' ? String(source?.insuranceCardNumber || source?.insurance_card_number || source?.cardNumber || source?.card_number || '') : '',
      insurancePlanName: financialContextType === 'INSURANCE' ? String(source?.insurancePlanName || source?.insurance_plan_name || '') : '',
      guideNumber: financialContextType === 'INSURANCE' ? String(source?.guideNumber || source?.guide_number || '') : '',
      authorizationCode: financialContextType === 'INSURANCE' ? String(source?.authorizationCode || source?.authorization_code || '') : '',
      patientTissAuthorizationId: financialContextType === 'INSURANCE' ? String(source?.patientTissAuthorizationId || source?.patient_tiss_authorization_id || source?.authorizationId || source?.authorization_id || '') : '',
      procedureCode: String(source?.procedureCode || source?.procedure_code || ''),
      notes: String(source?.notes || ''),
      source: String(source?.source || '')
    });
  };

  const getBillingFormSource = (currentBilling: any = {}) => {
    if (!currentBilling?.hasContext) return currentBilling?.suggestion || currentBilling;
    const suggestion = currentBilling?.suggestion || {};
    return {
      ...currentBilling,
      serviceType: currentBilling?.serviceType || currentBilling?.service_type || suggestion?.serviceType || suggestion?.service_type || '',
      insuranceCardNumber:
        currentBilling?.insuranceCardNumber ||
        currentBilling?.insurance_card_number ||
        suggestion?.insuranceCardNumber ||
        suggestion?.insurance_card_number ||
        '',
      insurancePlanName:
        currentBilling?.insurancePlanName ||
        currentBilling?.insurance_plan_name ||
        suggestion?.insurancePlanName ||
        suggestion?.insurance_plan_name ||
        ''
    };
  };

  const loadBillingPayers = async () => {
    if (billingPayersLoaded) return;
    setBillingEditorState((prev) => ({ ...prev, loading: true, error: '' }));
    const result = await dataService.getPayers({ status: 'ACTIVE', limit: 80 });
    if (result?.success && Array.isArray(result.data)) {
      setBillingPayers(normalizePayerOptions(result.data));
      setBillingPayersLoaded(true);
      setBillingEditorState((prev) => ({ ...prev, loading: false, error: '' }));
      return;
    }
    setBillingEditorState((prev) => ({
      ...prev,
      loading: false,
      error: result?.error || 'Não foi possível carregar pagadores agora.'
    }));
  };

  const createQuickBillingPayer = async () => {
    const name = quickPayerForm.name.trim();
    if (name.length < 2) {
      setQuickPayerForm((prev) => ({ ...prev, error: 'Informe o nome do pagador.' }));
      return;
    }
    setQuickPayerForm((prev) => ({ ...prev, saving: true, error: '' }));
    const result = await dataService.createPayer({
      name,
      payerType: quickPayerForm.payerType,
      status: 'ACTIVE'
    });
    if (!result?.success || !result?.data) {
      setQuickPayerForm((prev) => ({
        ...prev,
        saving: false,
        error: result?.error || 'Não foi possível criar o pagador agora.'
      }));
      return;
    }
    const payer = result.data;
    setBillingPayers((prev) => {
      const withoutDuplicate = prev.filter((item: any) => String(item?.id || '') !== String(payer?.id || ''));
      return normalizePayerOptions([...withoutDuplicate, payer]);
    });
    setBillingPayersLoaded(true);
    const payerId = String(payer?.id || '');
    const payerName = sanitizeHumanPayerName(payer?.name || name);
    setBillingManualOverrideOpen(false);
    setBillingForm((prev) => clearPayerDependentBillingFields({
      ...prev,
      financialContextType: 'INSURANCE',
      payerId,
      payerName,
      source: 'PATIENT_DEFAULT'
    }));
    setQuickPayerForm({ open: false, saving: false, error: '', name: '', payerType: 'INSURANCE' });
    if (payerId) void loadBillingSuggestionForPayer(payerId, payerName);
  };

  const findUniqueBillingPayerByName = (payerName: any) => {
    const payerNameKey = normalizePayerNameKey(payerName);
    if (!payerNameKey) return null;
    const matches = billingPayers.filter((payer: any) => normalizePayerNameKey(payer?.name) === payerNameKey);
    return matches.length === 1 ? matches[0] : null;
  };

  const normalizeBillingFormWithResolvedPayer = (values: any) => {
    const payerId = String(values?.payerId || '').trim();
    const selectedPayer = payerId
      ? billingPayers.find((payer: any) => String(payer?.id || '') === payerId)
      : findUniqueBillingPayerByName(values?.payerName);
    return {
      ...values,
      payerId: selectedPayer?.id || payerId,
      payerName: selectedPayer?.name || sanitizeHumanPayerName(values?.payerName)
    };
  };

  const loadBillingSuggestionForPayer = async (payerId: string, payerName = '') => {
    const appointmentId = String(detailEvent?.id || selectedEvent?.id || '').trim();
    const safePayerId = String(payerId || '').trim();
    if (!appointmentId || !safePayerId) {
      setBillingPayerResolution({ loading: false, error: '', payerId: safePayerId, suggestion: null, searched: Boolean(safePayerId) });
      return;
    }
    setBillingPayerResolution({ loading: true, error: '', payerId: safePayerId, suggestion: null, searched: true });
    const result = await dataService.getAppointmentBillingContext(appointmentId, {
      payerId: safePayerId,
      payerName,
      serviceType: billingForm.serviceType || detailEvent?.type || ''
    });
    if (!result?.success) {
      setBillingPayerResolution({
        loading: false,
        error: result?.error || 'Nao foi possivel buscar dados deste convenio.',
        payerId: safePayerId,
        suggestion: null,
        searched: true
      });
      return;
    }
    const suggestion = result?.data?.suggestion || null;
    setBillingPayerResolution({ loading: false, error: '', payerId: safePayerId, suggestion, searched: true });
    setBillingForm((prev: any) => {
      if (String(prev.payerId || '') !== safePayerId) return prev;
      return buildPayerScopedBillingForm(prev, { payerId: safePayerId, payerName, suggestion });
    });
  };

  const handleBillingPayerChange = (value: string) => {
    if (billingSnapshotOptionVisible && value === billingSnapshotSelectValue) return;
    const payer = billingPayers.find((item: any) => String(item?.id || '') === value);
    setBillingManualOverrideOpen(false);
    setBillingForm((prev: any) => clearPayerDependentBillingFields({
      ...prev,
      payerId: value,
      payerName: payer?.name || '',
      source: value ? 'PATIENT_DEFAULT' : 'MANUAL'
    }));
    if (!value) {
      setBillingPayerResolution({ loading: false, error: '', payerId: '', suggestion: null, searched: false });
      return;
    }
    void loadBillingSuggestionForPayer(value, payer?.name || '');
  };

  const openBillingEditor = (source: any = null) => {
    if (!canEditBillingContext) return;
    const currentBilling = detail?.billingContext || {};
    hydrateBillingForm(source || getBillingFormSource(currentBilling));
    setBillingManualOverrideOpen(false);
    setBillingPayerResolution({ loading: false, error: '', payerId: '', suggestion: currentBilling?.suggestion || null, searched: false });
    setQuickPayerForm({ open: false, saving: false, error: '', name: '', payerType: 'INSURANCE' });
    setBillingEditorOpen(true);
    setBillingEditorState({ loading: false, saving: false, error: '', success: '' });
    void loadBillingPayers();
  };

  useEffect(() => {
    if (!billingEditorOpen || !billingPayersLoaded) return;
    setBillingForm((prev) => {
      const financialContextType = normalizeAppointmentFinancialContextType(prev.financialContextType) || 'INSURANCE';
      if (!appointmentFinancialContextRequiresPayer(financialContextType) || prev.payerId || !prev.payerName) return prev;
      const payer = findUniqueBillingPayerByName(prev.payerName);
      if (!payer?.id) return prev;
      return { ...prev, payerId: String(payer.id), payerName: String(payer.name || prev.payerName) };
    });
  }, [billingEditorOpen, billingPayersLoaded, billingPayers]);

  const mergeBillingContextIntoDetail = (nextBillingContext: any) => {
    const financialContextType =
      normalizeAppointmentFinancialContextType(
        nextBillingContext?.financialContextType ||
          nextBillingContext?.financial_context_type ||
          nextBillingContext?.billingContextType ||
          nextBillingContext?.billing_context_type ||
          nextBillingContext?.payerType ||
          nextBillingContext?.payer_type ||
          (nextBillingContext?.payerId || nextBillingContext?.payer_id ? 'INSURANCE' : '')
      ) || '';
    const usesInsuranceContext = financialContextType === 'INSURANCE';
    const appointmentPatch = {
      payer_id: usesInsuranceContext ? nextBillingContext?.payerId || nextBillingContext?.payer_id || null : null,
      payerId: usesInsuranceContext ? nextBillingContext?.payerId || nextBillingContext?.payer_id || null : null,
      payer_name_snapshot: usesInsuranceContext ? nextBillingContext?.payerName || null : null,
      payerName: usesInsuranceContext ? nextBillingContext?.payerName || null : null,
      payer_type: financialContextType || null,
      payerType: financialContextType || null,
      financial_context_type: financialContextType || null,
      financialContextType: financialContextType || null,
      insurance_card_number: usesInsuranceContext ? nextBillingContext?.insuranceCardNumber || null : null,
      insuranceCardNumber: usesInsuranceContext ? nextBillingContext?.insuranceCardNumber || null : null,
      insurance_plan_name: usesInsuranceContext ? nextBillingContext?.insurancePlanName || null : null,
      insurancePlanName: usesInsuranceContext ? nextBillingContext?.insurancePlanName || null : null,
      guide_number: usesInsuranceContext ? nextBillingContext?.guideNumber || null : null,
      guideNumber: usesInsuranceContext ? nextBillingContext?.guideNumber || null : null,
      authorization_code: usesInsuranceContext ? nextBillingContext?.authorizationCode || null : null,
      authorizationCode: usesInsuranceContext ? nextBillingContext?.authorizationCode || null : null
    };
    cacheRef.current.clear();
    setEventDetail((prev: any) => prev ? {
      ...prev,
      billingContext: nextBillingContext,
      event: { ...(prev.event || {}), ...appointmentPatch },
      closure: { ...(prev.closure || {}), ...appointmentPatch }
    } : prev);
    setSelectedEvent((prev: any) => prev ? { ...prev, ...appointmentPatch } : prev);
    setRemoteEvents((prev) => prev.map((event: any) =>
      String(event?.id || '') === String(detailEvent?.id || '') ? { ...event, ...appointmentPatch } : event
    ));
  };

  const saveBillingContext = async (values: any) => {
    const appointmentId = String(detailEvent?.id || selectedEvent?.id || '').trim();
    if (!appointmentId) return false;
    const resolvedValues = normalizeBillingFormWithResolvedPayer(values);
    const financialContextType = normalizeAppointmentFinancialContextType(resolvedValues.financialContextType) || 'INSURANCE';
    const usesInsuranceContext = appointmentFinancialContextRequiresPayer(financialContextType);
    if (usesInsuranceContext && !String(resolvedValues.payerId || '').trim()) {
      setBillingEditorState((prev) => ({
        ...prev,
        saving: false,
        error: 'Selecione um pagador/convênio cadastrado ou escolha outro contexto financeiro válido.',
        success: ''
      }));
      return false;
    }
    setBillingEditorState((prev) => ({ ...prev, saving: true, error: '', success: '' }));
    const result = await dataService.updateAppointmentBillingContext(appointmentId, {
      financialContextType,
      financial_context_type: financialContextType,
      billingContextType: financialContextType,
      billing_context_type: financialContextType,
      payerType: financialContextType,
      payer_type: financialContextType,
      payerId: usesInsuranceContext ? resolvedValues.payerId || null : null,
      payerName: usesInsuranceContext ? resolvedValues.payerName || null : null,
      serviceType: resolvedValues.serviceType || detailEvent.type || null,
      insuranceCardNumber: usesInsuranceContext ? resolvedValues.insuranceCardNumber || null : null,
      insurancePlanName: usesInsuranceContext ? resolvedValues.insurancePlanName || null : null,
      guideNumber: usesInsuranceContext ? resolvedValues.guideNumber || null : null,
      authorizationCode: usesInsuranceContext ? resolvedValues.authorizationCode || null : null,
      patientTissAuthorizationId: usesInsuranceContext ? resolvedValues.patientTissAuthorizationId || null : null,
      procedureCode: resolvedValues.procedureCode || null,
      notes: resolvedValues.notes || null,
      source: resolvedValues.source || null
    });
    if (!result?.success) {
      setBillingEditorState((prev) => ({
        ...prev,
        saving: false,
        error: result?.error || 'Não foi possível atualizar pagador da consulta.',
        success: ''
      }));
      return false;
    }
    mergeBillingContextIntoDetail(result.data || {});
    setBillingEditorState({ loading: false, saving: false, error: '', success: result.message || 'Pagador atualizado.' });
    dataService.getCalendarEventDetail(appointmentId).then((detailResult: any) => {
      if (detailResult?.success) setEventDetail(detailResult.data || null);
    });
    dataService.getClosureAppointmentDetail(appointmentId).then((closureResult: any) => {
      if (closureResult?.success) setClosureDetailState((prev) => ({ ...prev, data: closureResult.data || prev.data }));
    });
    return true;
  };

  const submitBillingEditor = async () => {
    const saved = await saveBillingContext(billingForm);
    if (saved) setBillingEditorOpen(false);
  };

  const applyBillingSuggestion = async () => {
    const suggestion = (detail?.billingContext || {}).suggestion;
    if (!suggestion?.payerName && !suggestion?.payerId) return;
    await saveBillingContext({
      financialContextType: 'INSURANCE',
      payerId: suggestion.payerId || '',
      payerName: suggestion.payerName || '',
      serviceType: suggestion.serviceType || detailEvent.type || '',
      insuranceCardNumber: suggestion.insuranceCardNumber || '',
      insurancePlanName: suggestion.insurancePlanName || '',
      guideNumber: suggestion.guideNumber || '',
      authorizationCode: suggestion.authorizationCode || '',
      patientTissAuthorizationId: suggestion.patientTissAuthorizationId || suggestion.patient_tiss_authorization_id || suggestion.authorizationId || suggestion.authorization_id || suggestion.tissAuthorization?.authorizationId || '',
      procedureCode: '',
      notes: suggestion.notes || '',
      source: suggestion.source || 'PATIENT_DEFAULT'
    });
  };

  const handleActionRequestDecision = async (request: any, decision: 'approve' | 'reject', payload: any = {}) => {
    const requestId = String(request?.id || '').trim();
    if (!requestId) return;
    setActionRequestState({ loadingId: requestId, error: '' });
    const isApprove = decision === 'approve';
    const result = isApprove
      ? await dataService.approveAppointmentActionRequest(requestId, payload)
      : await dataService.rejectAppointmentActionRequest(requestId, payload);
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
    setActionRequestState({
      loadingId: '',
      error: '',
      message: decision === 'approve' ? 'Solicitação aprovada e agenda atualizada.' : 'Solicitação recusada. O horário atual foi mantido.'
    });
    setActionRequestResolution({ requestId: '', note: '' });
  };

  const handleMaintenanceLinkDecision = async (probe: any, decision: 'confirm' | 'skip') => {
    const scheduleId = String(probe?.id || '').trim();
    const currentEvent = normalizeClinicalEvent({
      ...(selectedEvent || {}),
      ...((eventDetail || {}).event || {})
    });
    const appointmentId = String(currentEvent?.id || '').trim();
    if (!isPersistedMaintenanceScheduleId(scheduleId)) {
      setActionRequestState({ loadingId: '', error: 'Sondagem de manutenção inválida. Revise o vínculo antes de atualizar.' });
      return;
    }
    if (!isPersistedUuid(appointmentId)) {
      setActionRequestState({ loadingId: '', error: 'Consulta inválida para confirmar esta sondagem.' });
      return;
    }
    const loadingId = `${decision}:${scheduleId}`;
    setActionRequestState({ loadingId, error: '', message: '' });
    const result = decision === 'confirm'
      ? await dataService.confirmMaintenanceScheduleLink(scheduleId, { appointmentId })
      : await dataService.skipMaintenanceScheduleLink(scheduleId, { appointmentId });
    if (!result?.success) {
      setActionRequestState({ loadingId: '', error: result?.message || result?.error || 'Nao foi possivel atualizar a sondagem.', message: '' });
      return;
    }
    cacheRef.current.clear();
    const currentId = String(selectedEvent?.id || detailEvent?.id || '').trim();
    if (currentId) {
      const detailResult = await dataService.getCalendarEventDetail(currentId);
      if (detailResult?.success) setEventDetail(detailResult.data || null);
    }
    setActionRequestState({ loadingId: '', error: '', message: result?.message || (decision === 'confirm' ? 'Vínculo confirmado.' : 'Sondagem mantida para depois.') });
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
        <div className="mb-3 flex items-center justify-center">
          <p className={`text-sm font-semibold capitalize ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {formatDisplayMonthYear(activeDate)}
          </p>
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
            {(teamMembers || []).slice(0, 8).map((member: any) => {
              const memberPhotoUrl = String(
                member?.profilePicture ||
                member?.profile_picture ||
                member?.profilePhotoUrl ||
                member?.profile_photo_url ||
                member?.avatarUrl ||
                member?.avatar_url ||
                member?.photoUrl ||
                member?.photo_url ||
                member?.imageUrl ||
                member?.image_url ||
                ''
              ).trim();
              return (
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
                  <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-900 text-[11px] font-bold text-white">
                    {memberPhotoUrl ? (
                      <img
                        src={memberPhotoUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-full w-full rounded-full object-cover"
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                          event.currentTarget.parentElement?.querySelector('[data-avatar-fallback="true"]')?.classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    <span data-avatar-fallback="true" className={memberPhotoUrl ? 'hidden' : ''}>
                      {getInitials(member.label || member.name)}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className={`block truncate text-xs font-semibold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{member.label || member.name}</span>
                    {member.specialty && <span className="block truncate text-[10px] text-slate-400">{member.specialty}</span>}
                  </span>
                </button>
              );
            })}
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
  const renderIndicators = (event: any) => {
    const closureStyle = getClosureStatusStyle(event.closure_readiness_status);
    const indicators = [
      closureStyle ? { label: closureStyle.label, icon: closureStyle.icon, className: closureStyle.className } : null,
      event.has_next_session_plan ? { label: 'Plano', icon: Zap, className: 'bg-violet-100 text-violet-700' } : null,
      Number(event.pending_maintenance_confirmation_count || 0) > 0 ? { label: 'Pendente de confirmacao', icon: AlertCircle, className: 'bg-amber-100 text-amber-800' } : null,
      Number(event.overdue_maintenance_probe_count || 0) > 0 ? { label: 'Sondagem atrasada', icon: AlertCircle, className: 'bg-rose-100 text-rose-700' } : null,
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
    const statusColor = getAppointmentPatientConfirmationVisualState(event);
    const StatusIcon = statusColor.icon;
    return (
      <button
        key={event.id}
        type="button"
        onClick={(clickEvent) => {
          clickEvent.stopPropagation();
          openEventDetail(event);
        }}
        className={`group relative h-full min-h-0 w-full overflow-hidden rounded-xl border ${compact ? 'p-1.5' : 'p-2'} text-left transition-all hover:shadow-md ${statusColor.card}`}
      >
        <div className="pl-1">
          <div className="flex items-start justify-between gap-2">
            <span className="text-[10px] font-semibold leading-tight opacity-85">
              {event.time} - {event.endTime}
            </span>
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${statusColor.badge}`}>
              <StatusIcon size={10} />
              {!compact && statusColor.label}
            </span>
          </div>
          <p className={`mt-1 truncate text-sm font-semibold leading-tight ${compact ? 'text-xs' : ''}`}>{event.patientName}</p>
          <p className={`${compact ? 'mt-0.5' : 'mt-1'} truncate text-[11px] font-medium opacity-85`}>
            <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${style.badge}`}>{style.label}</span>
            <span className="ml-1">{getRoomDisplayLine(event)}</span>
          </p>
          {!compact && <p className="mt-1 truncate text-[10px] opacity-80">{event.therapistName}</p>}
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
                <p className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{formatDisplayDate(day)}</p>
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
            const eventLayouts = calculateCalendarOverlappingEventLayouts(dayEvents);
            const isToday = key === toDateKey(new Date());
            return (
              <div
                key={key}
                className={`relative border-l ${isDark ? 'border-slate-800 bg-slate-950' : 'border-slate-100 bg-white'}`}
                style={{ height: gridHeight }}
                onClick={(event) => onCreateAppointment?.(key, getTimelineClickTime(event))}
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
                  const layout = eventLayouts.get(getVisualEventKey(event, index)) || {
                    ...calculateCalendarEventVisualLayout(event.start, event.end),
                    laneIndex: 0,
                    laneCount: 1,
                    widthPercent: 100,
                    leftPercent: 0
                  };
                  return (
                    <div
                      key={event.id}
                      className="absolute z-10 overflow-hidden px-2"
                      style={{
                        top: layout.top,
                        height: layout.height,
                        left: `calc(${layout.leftPercent}% + 4px)`,
                        width: `calc(${layout.widthPercent}% - 8px)`
                      }}
                    >
                      {renderEventCard(event, layout.height < 72 || layout.laneCount > 1)}
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
      <div className={`flex h-full min-h-0 flex-col overflow-hidden rounded-[18px] border p-1 ${isDark ? 'border-slate-700 bg-slate-950' : 'border-slate-200 bg-white'}`}>
        <div className="grid shrink-0 grid-cols-7 gap-1 pb-1 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1 overflow-hidden">
          {blanks.map((blank) => <div key={`month-blank-${blank}`} className={`min-h-0 rounded-lg border ${isDark ? 'border-slate-900 bg-slate-900/40' : 'border-slate-50 bg-slate-50/40'}`} />)}
          {dayCells.map((day) => {
            const date = new Date(year, month, day);
            const key = toDateKey(date);
            const items = eventsByDate[key] || [];
            const isToday = key === toDateKey(new Date());
            const dayMaintenancePendingCount = items.reduce((total: number, event: any) => (
              total +
              Number(event.pending_maintenance_probe_count || 0) +
              Number(event.pending_maintenance_confirmation_count || 0) +
              Number(event.unlinked_maintenance_probe_count || 0) +
              Number(event.overdue_maintenance_probe_count || 0)
            ), 0);
            return (
              <div
                key={key}
                role="button"
                tabIndex={0}
                onClick={() => {
                  onDateChange?.(date);
                  onCreateAppointment?.(key, '08:00');
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onCreateAppointment?.(key, '08:00');
                }}
                className={`flex min-h-0 cursor-pointer flex-col overflow-hidden rounded-lg border p-1 text-left transition-all ${
                  key === selectedDateKey
                    ? 'border-[#7a32fc]/40 bg-[#7a32fc]/5'
                    : isToday
                      ? isDark ? 'border-sky-500/40 bg-sky-500/10' : 'border-sky-200 bg-sky-50/60'
                      : isDark ? 'border-slate-800 bg-slate-900 hover:bg-slate-800' : 'border-slate-100 bg-slate-50/60 hover:bg-white'
                }`}
              >
                <div className="mb-0.5 flex shrink-0 items-center justify-between gap-1.5">
                  <span className={`text-[11px] font-bold ${isToday ? 'text-[#7a32fc]' : isDark ? 'text-slate-200' : 'text-slate-700'}`}>{day}</span>
                  {items.length > 0 && (
                    <span className="flex items-center gap-1">
                      {dayMaintenancePendingCount > 0 && <span title={`${dayMaintenancePendingCount} sondagem(ns) pendente(s)`} className="h-2 w-2 rounded-full bg-amber-500" />}
                      <span className={`rounded-full px-1 py-0 text-[8px] font-bold ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-500'}`}>
                        {items.length}
                      </span>
                    </span>
                  )}
                </div>
                <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-0.5 overscroll-contain custom-scrollbar">
                  {items.map((event: any) => {
                    const statusColor = getAppointmentPatientConfirmationVisualState(event);
                    return (
                      <button
                        key={event.id}
                        type="button"
                        title={`${event.time} ${event.patientName}${event.type ? ` · ${event.type}` : ''}${getRoomDisplayLine(event) ? ` · ${getRoomDisplayLine(event)}` : ''}`}
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          openEventDetail(event);
                        }}
                        className={`flex min-h-[20px] w-full items-center gap-1 rounded-md border px-1.5 py-0 text-left text-[10px] font-medium leading-4 transition-colors ${statusColor.card}`}
                      >
                        <span className="shrink-0 tabular-nums">{event.time}</span>
                        <span className="min-w-0 truncate">{event.patientName}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {trailingBlanks.map((blank) => <div key={`month-trailing-${blank}`} className={`min-h-0 rounded-lg border ${isDark ? 'border-slate-900 bg-slate-900/40' : 'border-slate-50 bg-slate-50/40'}`} />)}
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
  const closureOperationalView = getAppointmentClosureOperationalView(detailEvent, closureDetailState.data);
  const detailCancellationState = resolveAppointmentCancellationState(detailEvent);
  const detailPrimaryAction = getAppointmentPrimaryAction(detailEvent, closureOperationalView.phase);
  const detailLinkedAbaSessionId = String(
    detailEvent.aba_session_id ||
      detailEvent.abaSessionId ||
      detailEvent.source_payload?.aba_session_id ||
      detailEvent.source_payload?.abaSessionId ||
      detailEvent.sourcePayload?.aba_session_id ||
      detailEvent.sourcePayload?.abaSessionId ||
      ''
  ).trim();
  const detailHasActiveLinkedSession =
    !detailCancellationState.isCancelled &&
    (detailPrimaryAction.kind === 'continue' ||
      Boolean(detailLinkedAbaSessionId && !detailEvent.has_session_record && !detailEvent.actual_end_at && !detailEvent.actualEndAt));
  const detailHasCompletedLinkedSession =
    !detailCancellationState.isCancelled &&
    (detailPrimaryAction.kind === 'closure' ||
      Boolean(detailEvent.has_session_record || detailEvent.actual_end_at || detailEvent.actualEndAt));
  const detailStatusColor = getAppointmentPatientConfirmationVisualState(detailEvent);
  const detailAppointmentConfirmed = detailStatusColor.canonical === 'CONFIRMED';
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
  const billingSuggestion = billingContext.suggestion || null;
  const billingEditorSuggestion = billingPayerResolution.searched ? billingPayerResolution.suggestion : billingSuggestion;
  const billingSuggestedTissAuthorization = billingEditorSuggestion?.tissAuthorization || null;
  const billingAvailableTissAuthorizations = Array.isArray(billingEditorSuggestion?.availableTissAuthorizations)
    ? billingEditorSuggestion.availableTissAuthorizations
    : Array.isArray(billingEditorSuggestion?.available_tiss_authorizations)
      ? billingEditorSuggestion.available_tiss_authorizations
      : [];
  const billingContextTissAuthorization = billingContext?.tissAuthorization || null;
  const visibleBillingTissAuthorization = billingContextTissAuthorization || billingSuggestedTissAuthorization;
  const billingFinancialContextType =
    normalizeAppointmentFinancialContextType(
      billingContext.financialContextType ||
        billingContext.financial_context_type ||
        billingContext.billingContextType ||
        billingContext.billing_context_type ||
        billingContext.payerType ||
        billingContext.payer_type ||
        (billingContext.payerId || billingContext.payer_id ? 'INSURANCE' : '')
    ) || '';
  const billingDetailIsNonInsuranceContext = Boolean(billingFinancialContextType && billingFinancialContextType !== 'INSURANCE');
  const billingFormFinancialContextType = normalizeAppointmentFinancialContextType(billingForm.financialContextType) || 'INSURANCE';
  const billingFormUsesInsurance = appointmentFinancialContextRequiresPayer(billingFormFinancialContextType);
  const matchedBillingPayerByName =
    billingFormUsesInsurance && !billingForm.payerId
      ? findUniqueBillingPayerByName(billingForm.payerName)
      : null;
  const effectiveBillingPayerId = billingForm.payerId || matchedBillingPayerByName?.id || '';
  const billingEditorFinancialContextError =
    billingFormUsesInsurance && !String(effectiveBillingPayerId || '').trim()
      ? 'Selecione um pagador/convênio cadastrado ou escolha outro contexto financeiro válido.'
      : '';
  const hasSavedBillingContext = Boolean(
    billingContext.hasContext ||
      billingFinancialContextType ||
      billingContext.payerName ||
      billingContext.guideNumber ||
      billingContext.authorizationCode ||
      billingContext.notes
  );
  const selectedBillingPayerKnown = Boolean(billingFormUsesInsurance && effectiveBillingPayerId && billingPayers.some((payer: any) => String(payer?.id || '') === String(effectiveBillingPayerId || '')));
  const billingSnapshotSelectValue = billingForm.payerId || '__snapshot__';
  const billingSnapshotOptionVisible = Boolean(billingFormUsesInsurance && billingForm.payerName && !selectedBillingPayerKnown && !matchedBillingPayerByName);
  const billingPayerSelectValue = selectedBillingPayerKnown
    ? effectiveBillingPayerId
    : billingSnapshotOptionVisible
      ? billingSnapshotSelectValue
      : '';
  const billingEditorBadge = billingContext.hasContext
    ? 'Dados desta consulta'
    : billingSuggestion?.payerName || billingSuggestion?.payerId
      ? 'Pagador sugerido pelo plano financeiro, não aplicado ao atendimento'
      : String(billingForm.source || '').toUpperCase() === 'PATIENT_DEFAULT'
        ? 'Dados sugeridos a partir do cadastro do paciente'
      : '';
  const billingTissAuthorizationSummary = billingSuggestedTissAuthorization
    ? [
        billingSuggestedTissAuthorization.authorizationCode ? `Senha ${billingSuggestedTissAuthorization.authorizationCode}` : '',
        billingSuggestedTissAuthorization.guideNumber ? `Guia ${billingSuggestedTissAuthorization.guideNumber}` : '',
        billingSuggestedTissAuthorization.tussCode ? `TUSS ${billingSuggestedTissAuthorization.tussCode}` : '',
        billingSuggestedTissAuthorization.balance !== null && billingSuggestedTissAuthorization.balance !== undefined ? `saldo ${billingSuggestedTissAuthorization.balance}` : '',
        billingSuggestedTissAuthorization.validUntil ? `válida até ${String(billingSuggestedTissAuthorization.validUntil).slice(0, 10).split('-').reverse().join('/')}` : ''
      ].filter(Boolean).join(' · ')
    : '';
  const financialValidationItems = [
    {
      label: 'Pagador',
      ok: billingDetailIsNonInsuranceContext || Boolean(billingContext.payerName || billingContext.payerId || billingSuggestion?.payerName),
      message: billingDetailIsNonInsuranceContext
        ? `Contexto ${getAppointmentFinancialContextLabel(billingFinancialContextType).toLowerCase()} definido.`
        : 'Selecione o convenio/pagador da consulta.'
    },
    {
      label: 'Plano/carteirinha',
      ok: billingDetailIsNonInsuranceContext || Boolean(billingContext.insuranceCardNumber || billingSuggestion?.insuranceCardNumber),
      message: 'Confirme carteirinha e plano do paciente neste convenio.'
    },
    {
      label: 'Guia/autorizacao',
      ok: billingDetailIsNonInsuranceContext || Boolean(billingContext.guideNumber || billingContext.authorizationCode || visibleBillingTissAuthorization),
      message: 'Use uma autorizacao vigente ou registre override manual justificado.'
    },
    {
      label: 'Servico',
      ok: Boolean(billingContext.serviceType || detailEvent.service_type || detailEvent.type),
      message: 'Servico/tipo de atendimento precisa estar definido.'
    },
    {
      label: 'TUSS/DePara',
      ok: billingDetailIsNonInsuranceContext || Boolean(visibleBillingTissAuthorization?.tussCode || billingContext.procedureCode || billingContext.procedure_code),
      message: 'Confirme De/Para TUSS do convenio para este servico.'
    },
    {
      label: 'Valor',
      ok: pendingBillingDocuments.length === 0 && !billingDetailIsNonInsuranceContext ? Boolean(billingContext.payerName || billingSuggestion?.payerName) : true,
      message: 'Valor negociado deve estar vigente na tabela do convenio.'
    },
    {
      label: 'Anti-glosa',
      ok: Number(detailEvent.closure_blocking_count || 0) === 0,
      warning: Number(detailEvent.closure_warning_count || 0) > 0,
      message: Number(detailEvent.closure_warning_count || 0) > 0 ? 'Ha alertas operacionais. Revise antes do XML.' : 'Sem bloqueios anti-glosa carregados nesta consulta.'
    }
  ];
  const financialBlockingCount = financialValidationItems.filter((item: any) => !item.ok).length;
  const financialWarningCount = financialValidationItems.filter((item: any) => item.ok && item.warning).length;
  const financialValidationStatus = financialBlockingCount > 0
    ? 'Bloqueada para faturamento'
    : financialWarningCount > 0
      ? 'Pronta com alerta'
      : 'Pronta para faturamento';
  const applySuggestedTissAuthorizationToBillingForm = () => {
    if (!billingSuggestedTissAuthorization) return;
    setBillingForm((prev: any) => ({
      ...prev,
      guideNumber: billingSuggestedTissAuthorization.guideNumber || prev.guideNumber,
      authorizationCode: billingSuggestedTissAuthorization.authorizationCode || prev.authorizationCode,
      source: 'PATIENT_TISS_AUTHORIZATION',
      patientTissAuthorizationId: billingSuggestedTissAuthorization.authorizationId || billingSuggestedTissAuthorization.patientTissAuthorizationId || ''
    }));
  };
  const applyAvailableTissAuthorizationToBillingForm = (authorization: any) => {
    if (!authorization?.authorizationId && !authorization?.patientTissAuthorizationId) return;
    setBillingForm((prev: any) => ({
      ...prev,
      guideNumber: authorization.guideNumber || prev.guideNumber,
      authorizationCode: authorization.authorizationCode || authorization.authorizationNumber || prev.authorizationCode,
      procedureCode: authorization.tussCode || prev.procedureCode,
      source: 'PATIENT_TISS_AUTHORIZATION',
      patientTissAuthorizationId: authorization.authorizationId || authorization.patientTissAuthorizationId || ''
    }));
  };

  return (
    <div className="flex flex-col gap-2 pb-[calc(env(safe-area-inset-bottom)+5rem)] xl:h-[calc(100vh-4.25rem)] xl:min-h-[580px] xl:overflow-hidden xl:pb-0">
      <div className="shrink-0 px-1 py-1">
        <div className="grid gap-2 xl:grid-cols-[1fr_auto_1fr] xl:items-center">
          <div className="hidden xl:block" aria-hidden="true" />
          <div className="flex min-w-0 items-center justify-center gap-1.5">
            <button type="button" onClick={() => moveDate(-1)} className={`rounded-xl border p-1.5 ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-white'}`} aria-label="Período anterior">
              <ChevronLeft size={17} />
            </button>
            <h2 className={`min-w-[180px] px-2 text-center text-base font-semibold capitalize tracking-tight lg:text-lg ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{periodLabel}</h2>
            <button type="button" onClick={() => moveDate(1)} className={`rounded-xl border p-1.5 ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-white'}`} aria-label="Próximo período">
              <ChevronRight size={17} />
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5 xl:justify-end">
            <div className={`flex rounded-xl p-0.5 ${isDark ? 'bg-slate-900' : 'bg-slate-100'}`}>
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
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-all ${active ? 'bg-white text-[#7a32fc] shadow-sm' : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    <Icon size={13} />
                    {item.label}
                  </button>
                );
              })}
            </div>
            {filteredEvents.length > 0 && (
              <button
                type="button"
                onClick={() => setTimeReportsOpen(true)}
                className={`rounded-xl border p-1.5 ${isDark ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-slate-200 text-slate-500 hover:bg-white'}`}
                aria-label="Relatórios de tempo"
                title={`Tempo: ${formatMinutesHuman(timeReports.scheduledMinutes)} previsto`}
              >
                <Clock size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                cacheRef.current.clear();
                setRemoteRefreshNonce((value) => value + 1);
              }}
              className={`rounded-xl border p-1.5 ${isDark ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-slate-200 text-slate-500 hover:bg-white'}`}
              aria-label="Atualizar agenda"
              title="Atualizar agenda"
            >
              <RefreshCcw size={15} className={remoteState.refreshing ? 'animate-spin' : ''} />
            </button>
            <button type="button" onClick={() => setFilterSheetOpen(true)} className="inline-flex rounded-xl bg-slate-900 p-1.5 text-white xl:hidden" aria-label="Abrir filtros">
              <Filter size={17} />
            </button>
          </div>
        </div>
      </div>

      <div className="grid flex-1 min-h-0 gap-2 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className={`hidden min-h-0 overflow-hidden rounded-[18px] border shadow-sm xl:block ${isDark ? 'border-slate-700 bg-[#101827] text-slate-100' : 'border-slate-100 bg-white text-slate-900'}`}>
          <div className="h-full overflow-y-auto p-3 pr-2 custom-scrollbar">
            {renderSidebarContent()}
          </div>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
          {remoteState.loading && !remoteState.loaded && (
            <div className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold ${isDark ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-slate-100 bg-white text-slate-500'}`}>
              <Loader2 size={16} className="animate-spin" />
              Carregando agenda...
            </div>
          )}
          {remoteState.refreshing && remoteState.loaded && (
            <div className={`self-end inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-bold ${isDark ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-slate-100 bg-white text-slate-500'}`}>
              <Loader2 size={14} className="animate-spin" />
              Atualizando...
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

      {statusActionEvent && (
        <div className="fixed inset-0 z-[155] flex items-end justify-center bg-black/35 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setStatusActionEvent(null)}>
          <div className="w-full max-w-md rounded-t-[28px] bg-white p-5 text-slate-900 shadow-2xl sm:rounded-[28px]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7a32fc]">Ações da consulta</p>
                <h3 className="text-lg font-bold">{statusActionEvent.patientName || statusActionEvent.patient_name || 'Consulta'}</h3>
                <p className="mt-1 text-xs text-slate-500">{statusActionEvent.time} · {getAppointmentPatientConfirmationVisualState(statusActionEvent).label}</p>
              </div>
              <button type="button" onClick={() => setStatusActionEvent(null)} className="rounded-2xl border border-violet-100 p-2 text-violet-700 hover:bg-violet-50" aria-label="Fechar ações da consulta">
                <X size={18} />
              </button>
            </div>
            <div className="mt-5 grid gap-2">
              {!resolveAppointmentCancellationState(statusActionEvent).isCancelled && (
                <button type="button" onClick={() => handleStatusAction(statusActionEvent, 'confirm')} className="rounded-2xl bg-[#7a32fc] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-violet-500/20">
                  Confirmar
                </button>
              )}
              <button type="button" onClick={() => handleStatusAction(statusActionEvent, 'reschedule')} className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm font-bold text-[#7a32fc] hover:bg-violet-50">
                Remarcar
              </button>
              {!resolveAppointmentCancellationState(statusActionEvent).isCancelled && (
                <button type="button" onClick={() => handleStatusAction(statusActionEvent, 'cancel')} className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm font-bold text-[#7a32fc] hover:bg-violet-50">
                  Cancelar
                </button>
              )}
              <button type="button" onClick={() => handleStatusAction(statusActionEvent, 'delete')} className="rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm font-bold text-rose-600 hover:bg-rose-50">
                Excluir
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

      {billingEditorOpen && (
        <div className="fixed inset-0 z-[170] flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => !billingEditorState.saving && setBillingEditorOpen(false)}>
          <div className={`max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-[28px] p-5 shadow-2xl sm:rounded-[28px] ${isDark ? 'bg-[#101827] text-slate-100' : 'bg-white text-slate-900'}`} onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7a32fc]">Pagador da consulta</p>
                <h3 className="text-lg font-bold">Editar pagador</h3>
              </div>
              <button type="button" disabled={billingEditorState.saving} onClick={() => setBillingEditorOpen(false)} className={`rounded-2xl border p-2 disabled:opacity-50 ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50'}`} aria-label="Fechar pagador">
                <X size={18} />
              </button>
            </div>

            {billingEditorState.error && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                {billingEditorState.error}
              </div>
            )}
            {billingEditorBadge && (
              <div className={`mt-4 inline-flex rounded-full border px-3 py-1 text-[11px] font-bold ${isDark ? 'border-violet-500/30 bg-violet-500/10 text-violet-200' : 'border-violet-100 bg-violet-50 text-[#7a32fc]'}`}>
                {billingEditorBadge}
              </div>
            )}
            {billingFormUsesInsurance && billingSuggestedTissAuthorization && (
              <div className={`mt-4 rounded-2xl border p-4 ${isDark ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em]">Autorização TISS sugerida</p>
                <p className="mt-1 text-sm font-semibold">{billingTissAuthorizationSummary || 'Autorização vigente do paciente disponível para esta consulta.'}</p>
                <button
                  type="button"
                  disabled={billingEditorState.saving}
                  onClick={applySuggestedTissAuthorizationToBillingForm}
                  className="mt-3 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                >
                  Usar esta autorização
                </button>
              </div>
            )}
            {billingFormUsesInsurance && !billingSuggestedTissAuthorization && (billingEditorSuggestion?.payerName || billingPayerResolution.searched) && (
              <div className={`mt-4 rounded-2xl border px-4 py-3 text-xs font-semibold ${isDark ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-slate-100 bg-slate-50 text-slate-500'}`}>
                Nenhuma autorizacao TISS vigente encontrada para este paciente, convenio e servico.
              </div>
            )}

            {billingFormUsesInsurance && billingAvailableTissAuthorizations.length > 0 && (
              <div className={`mt-4 rounded-2xl border p-4 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-violet-100 bg-violet-50/40'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7a32fc]">Autorizacoes disponiveis</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">Use apenas guias/senhas vinculadas a este paciente, convenio e servico.</p>
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-slate-500">{billingAvailableTissAuthorizations.length}</span>
                </div>
                <div className="mt-3 grid gap-2">
                  {billingAvailableTissAuthorizations.slice(0, 6).map((authorization: any) => {
                    const canUse = Boolean(authorization?.canUseForAppointment || authorization?.isEligibleForAppointment);
                    const key = authorization?.authorizationId || authorization?.patientTissAuthorizationId || `${authorization?.guideNumber}-${authorization?.authorizationCode}`;
                    const validity = [authorization?.validFrom, authorization?.validUntil]
                      .filter(Boolean)
                      .map((value: string) => String(value).slice(0, 10).split('-').reverse().join('/'))
                      .join(' a ');
                    return (
                      <div key={key} className={`rounded-xl border px-3 py-2 ${canUse ? 'border-emerald-200 bg-emerald-50' : isDark ? 'border-slate-700 bg-[#101827]' : 'border-slate-100 bg-white'}`}>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className={`text-sm font-bold ${canUse ? 'text-emerald-800' : isDark ? 'text-slate-100' : 'text-slate-700'}`}>
                              Guia {authorization?.guideNumber || 'sem guia'} - Senha {authorization?.authorizationCode || authorization?.authorizationNumber || 'sem senha'}
                            </p>
                            <p className="mt-1 text-xs font-semibold text-slate-500">
                              {authorization?.payerName || billingForm.payerName || 'Convenio'} - {authorization?.procedureName || authorization?.tussDescription || 'Procedimento'} {authorization?.tussCode ? `- TUSS ${authorization.tussCode}` : ''}
                            </p>
                            <p className="mt-1 text-[11px] font-semibold text-slate-400">
                              {authorization?.availabilityLabel || authorization?.status || 'Status nao informado'}
                              {validity ? ` - Validade ${validity}` : ''}
                              {authorization?.balance !== null && authorization?.balance !== undefined ? ` - Saldo ${authorization.balance}` : ''}
                            </p>
                            {!canUse && authorization?.unavailableReason && (
                              <p className="mt-1 text-[11px] font-bold text-amber-700">{authorization.unavailableReason}</p>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={!canUse || billingEditorState.saving}
                            onClick={() => applyAvailableTissAuthorizationToBillingForm(authorization)}
                            className={`rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50 ${canUse ? 'bg-emerald-600 text-white' : 'border border-slate-200 text-slate-400'}`}
                          >
                            Usar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Contexto financeiro
                <select
                  className={`mt-1 w-full rounded-xl border p-3 text-sm font-semibold normal-case tracking-normal outline-none ${isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-violet-100 bg-white text-slate-700'}`}
                  value={billingFormFinancialContextType}
                  disabled={billingEditorState.loading || billingEditorState.saving}
                  onChange={(event) => {
                    const nextType = normalizeAppointmentFinancialContextType(event.target.value) || 'INSURANCE';
                    const nextUsesInsurance = appointmentFinancialContextRequiresPayer(nextType);
                    if (!nextUsesInsurance) setQuickPayerForm((prev) => ({ ...prev, open: false, error: '' }));
                    setBillingForm((prev) => ({
                      ...prev,
                      financialContextType: nextType,
                      payerId: nextUsesInsurance ? prev.payerId : '',
                      payerName: nextUsesInsurance ? prev.payerName : '',
                      insuranceCardNumber: nextUsesInsurance ? prev.insuranceCardNumber : '',
                      insurancePlanName: nextUsesInsurance ? prev.insurancePlanName : '',
                      guideNumber: nextUsesInsurance ? prev.guideNumber : '',
                      authorizationCode: nextUsesInsurance ? prev.authorizationCode : '',
                      patientTissAuthorizationId: nextUsesInsurance ? prev.patientTissAuthorizationId : '',
                      source: 'MANUAL'
                    }));
                  }}
                >
                  {APPOINTMENT_FINANCIAL_CONTEXT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="mt-2 block text-xs font-semibold normal-case tracking-normal text-slate-400">
                  {APPOINTMENT_FINANCIAL_CONTEXT_OPTIONS.find((option) => option.value === billingFormFinancialContextType)?.description || APPOINTMENT_FINANCIAL_CONTEXT_REQUIRED_MESSAGE}
                </span>
              </label>
              {!billingFormUsesInsurance && (
                <div className={`rounded-2xl border p-3 text-xs font-semibold ${isDark ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-slate-100 bg-slate-50 text-slate-500'}`}>
                  Este atendimento ficará registrado como {getAppointmentFinancialContextLabel(billingFormFinancialContextType).toLowerCase()} e não tentará resolver TUSS por pagador.
                </div>
              )}
              {billingEditorFinancialContextError && (
                <div className="sm:col-span-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">
                  {billingEditorFinancialContextError}
                </div>
              )}
              {billingFormUsesInsurance && (
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Pagador/convênio
                <select
                  className={`mt-1 w-full rounded-xl border p-3 text-sm font-semibold normal-case tracking-normal outline-none ${isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-violet-100 bg-white text-slate-700'}`}
                  value={billingPayerSelectValue}
                  disabled={billingEditorState.loading || billingEditorState.saving}
                  onChange={(event) => handleBillingPayerChange(event.target.value)}
                >
                  <option value="">Sem pagador</option>
                  {billingSnapshotOptionVisible && (
                    <option value={billingSnapshotSelectValue}>{billingForm.payerName}</option>
                  )}
                  {billingPayers.map((payer: any) => (
                    <option key={payer.id} value={payer.id}>
                      {payer.name}
                    </option>
                  ))}
                </select>
                {!billingEditorState.loading && billingPayers.length === 0 && (
                  <span className="mt-2 block text-xs font-semibold normal-case tracking-normal text-slate-400">Nenhum pagador cadastrado.</span>
                )}
                <button
                  type="button"
                  disabled={billingEditorState.saving || quickPayerForm.saving}
                  onClick={() => setQuickPayerForm((prev) => ({ ...prev, open: !prev.open, error: '' }))}
                  className="mt-2 inline-flex items-center gap-1 rounded-xl border border-violet-200 px-3 py-2 text-xs font-bold normal-case tracking-normal text-[#7a32fc] disabled:opacity-60"
                >
                  <Plus size={13} /> Criar pagador
                </button>
              </label>
              )}
              {billingFormUsesInsurance && quickPayerForm.open && (
                <div className={`sm:col-span-2 rounded-2xl border p-3 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-violet-100 bg-violet-50/40'}`}>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Nome do pagador/convênio
                      <input
                        className={`mt-1 w-full rounded-xl border p-3 text-sm font-semibold normal-case tracking-normal outline-none ${isDark ? 'border-slate-700 bg-[#101827] text-slate-100' : 'border-violet-100 bg-white text-slate-700'}`}
                        value={quickPayerForm.name}
                        onChange={(event) => setQuickPayerForm((prev) => ({ ...prev, name: event.target.value, error: '' }))}
                        placeholder="Unimed, Particular..."
                      />
                    </label>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Tipo
                      <select
                        className={`mt-1 w-full rounded-xl border p-3 text-sm font-semibold normal-case tracking-normal outline-none ${isDark ? 'border-slate-700 bg-[#101827] text-slate-100' : 'border-violet-100 bg-white text-slate-700'}`}
                        value={quickPayerForm.payerType}
                        onChange={(event) => setQuickPayerForm((prev) => ({ ...prev, payerType: event.target.value }))}
                      >
                        <option value="INSURANCE">Convênio</option>
                        <option value="PRIVATE">Particular</option>
                        <option value="COURTESY">Cortesia</option>
                        <option value="OTHER">Outro</option>
                      </select>
                    </label>
                  </div>
                  {quickPayerForm.error && <p className="mt-2 text-xs font-bold text-amber-700">{quickPayerForm.error}</p>}
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      disabled={quickPayerForm.saving}
                      onClick={() => setQuickPayerForm({ open: false, saving: false, error: '', name: '', payerType: 'INSURANCE' })}
                      className={`rounded-xl border px-3 py-2 text-xs font-bold disabled:opacity-60 ${isDark ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-slate-200 text-slate-600 hover:bg-white'}`}
                    >
                      Cancelar criação
                    </button>
                    <button
                      type="button"
                      disabled={quickPayerForm.saving || quickPayerForm.name.trim().length < 2}
                      onClick={createQuickBillingPayer}
                      className="rounded-xl bg-[#7a32fc] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                    >
                      {quickPayerForm.saving ? 'Criando...' : 'Salvar e selecionar'}
                    </button>
                  </div>
                </div>
              )}
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Serviço
                <input
                  className={`mt-1 w-full rounded-xl border p-3 text-sm font-semibold normal-case tracking-normal outline-none ${isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-violet-100 bg-white text-slate-700'}`}
                  value={billingForm.serviceType}
                  onChange={(event) => setBillingForm((prev) => ({ ...prev, serviceType: event.target.value, patientTissAuthorizationId: '', source: 'MANUAL' }))}
                  placeholder="Tipo de atendimento"
                />
              </label>
              {billingFormUsesInsurance && (
              <>
              <div className={`sm:col-span-2 rounded-2xl border p-4 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-100 bg-slate-50/80'}`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7a32fc]">Dados encontrados para este convenio</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">Ao trocar o pagador, carteirinha, plano, guia e autorizacao sao recarregados apenas da fonte deste convenio.</p>
                  </div>
                  {billingPayerResolution.loading && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-3 py-1 text-[11px] font-bold text-[#7a32fc]">
                      <Loader2 size={12} className="animate-spin" /> Buscando
                    </span>
                  )}
                </div>
                {billingPayerResolution.error && (
                  <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{billingPayerResolution.error}</p>
                )}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[
                    { label: 'Carteirinha', value: billingForm.insuranceCardNumber || 'Nao encontrada', source: payerScopedBillingSourceLabel({ field: 'card', form: billingForm }) },
                    { label: 'Plano', value: billingForm.insurancePlanName || 'Nao encontrado', source: payerScopedBillingSourceLabel({ field: 'plan', form: billingForm }) },
                    { label: 'Guia', value: billingForm.guideNumber || 'Nao encontrada', source: payerScopedBillingSourceLabel({ field: 'guide', form: billingForm }) },
                    { label: 'Autorizacao/senha', value: billingForm.authorizationCode || 'Nao encontrada', source: payerScopedBillingSourceLabel({ field: 'authorization', form: billingForm }) }
                  ].map((item) => (
                    <div key={item.label} className={`rounded-xl border px-3 py-2 ${isDark ? 'border-slate-700 bg-[#101827]' : 'border-white bg-white'}`}>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{item.label}</p>
                      <p className={`mt-1 truncate text-sm font-bold ${item.value.startsWith('Nao ') ? 'text-slate-400' : isDark ? 'text-slate-100' : 'text-slate-800'}`}>{item.value}</p>
                      <p className="mt-1 text-[11px] font-semibold text-slate-400">{item.source}</p>
                    </div>
                  ))}
                </div>
              </div>
              <details
                className={`sm:col-span-2 rounded-2xl border p-4 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-amber-100 bg-amber-50/40'}`}
                open={billingManualOverrideOpen}
                onToggle={(event) => setBillingManualOverrideOpen(event.currentTarget.open)}
              >
                <summary className="cursor-pointer text-sm font-bold text-slate-700">Ajuste manual avancado</summary>
                <p className="mt-2 text-xs font-semibold leading-relaxed text-amber-700">
                  Use apenas se a operadora orientou preencher dados diferentes do cadastro/autorizacao. Esses dados serao salvos apenas para esta consulta.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Número da carteirinha
                <input
                  className={`mt-1 w-full rounded-xl border p-3 text-sm font-semibold normal-case tracking-normal outline-none ${isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-violet-100 bg-white text-slate-700'}`}
                  value={billingForm.insuranceCardNumber}
                  onChange={(event) => setBillingForm((prev) => ({ ...prev, insuranceCardNumber: event.target.value, source: 'MANUAL' }))}
                  placeholder="Carteirinha do paciente"
                />
              </label>
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Plano
                <input
                  className={`mt-1 w-full rounded-xl border p-3 text-sm font-semibold normal-case tracking-normal outline-none ${isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-violet-100 bg-white text-slate-700'}`}
                  value={billingForm.insurancePlanName}
                  onChange={(event) => setBillingForm((prev) => ({ ...prev, insurancePlanName: event.target.value, source: 'MANUAL' }))}
                  placeholder="Plano do convênio"
                />
              </label>
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Guia
                <input
                  className={`mt-1 w-full rounded-xl border p-3 text-sm font-semibold normal-case tracking-normal outline-none ${isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-violet-100 bg-white text-slate-700'}`}
                  value={billingForm.guideNumber}
                  onChange={(event) => setBillingForm((prev) => ({ ...prev, guideNumber: event.target.value, patientTissAuthorizationId: '', source: 'MANUAL' }))}
                  placeholder="Número da guia"
                />
              </label>
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Autorização/senha
                <input
                  className={`mt-1 w-full rounded-xl border p-3 text-sm font-semibold normal-case tracking-normal outline-none ${isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-violet-100 bg-white text-slate-700'}`}
                  value={billingForm.authorizationCode}
                  onChange={(event) => setBillingForm((prev) => ({ ...prev, authorizationCode: event.target.value, patientTissAuthorizationId: '', source: 'MANUAL' }))}
                  placeholder="Código informado pelo pagador"
                />
              </label>
                </div>
              </details>
              </>
              )}
              <label className="sm:col-span-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Observações administrativas
                <textarea
                  className={`mt-1 min-h-[96px] w-full rounded-xl border p-3 text-sm font-semibold normal-case tracking-normal outline-none ${isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-violet-100 bg-white text-slate-700'}`}
                  value={billingForm.notes}
                  onChange={(event) => setBillingForm((prev) => ({ ...prev, notes: event.target.value, source: 'MANUAL' }))}
                  placeholder="Observações para conferência"
                />
              </label>
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" disabled={billingEditorState.saving} onClick={() => setBillingEditorOpen(false)} className={`rounded-2xl border px-4 py-3 text-sm font-bold disabled:opacity-60 ${isDark ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                Cancelar
              </button>
              <button type="button" disabled={billingEditorState.saving || Boolean(billingEditorFinancialContextError)} onClick={submitBillingEditor} className="rounded-2xl bg-[#7a32fc] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-violet-500/20 disabled:opacity-60">
                {billingEditorState.saving ? 'Salvando...' : billingContext.hasContext ? 'Salvar pagador' : 'Salvar na consulta'}
              </button>
            </div>
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
                  <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase ${detailStatusColor.badge}`}>
                    {detailStatusColor.label}
                  </span>
                  {isAppointmentPendingOfflineSync(detailEvent) && (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[10px] font-bold uppercase text-amber-800">
                      Pendente de sincronizacao
                    </span>
                  )}
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
            {detailAppointmentConfirmed && (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                Consulta confirmada pelo responsável.
              </div>
            )}

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                { label: 'Duração', value: `${Math.max(1, Math.round((detailEvent.end.getTime() - detailEvent.start.getTime()) / 60000))} min`, icon: Clock },
                { label: 'Sala/local', value: getRoomDisplayLine(detailEvent), icon: MapPin },
                { label: 'Equipe/profissional', value: getProfessionalDisplayLine(detailEvent), icon: Users },
                { label: 'Responsável familiar', value: getFamilyResponsibleDisplayLine(detailEvent), icon: User }
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
                    <p>
                      <span className="font-semibold">
                        {billingDetailIsNonInsuranceContext ? 'Contexto:' : hasSavedBillingContext ? 'Pagador:' : billingSuggestion?.payerName ? 'Sugestao do paciente:' : 'Pagador:'}
                      </span>{' '}
                      {billingDetailIsNonInsuranceContext ? getAppointmentFinancialContextLabel(billingFinancialContextType) : billingContext.payerName || detailEvent.payer_name_snapshot || billingSuggestion?.payerName || 'nao informado'}
                    </p>
                    <p><span className="font-semibold">Serviço:</span> {billingContext.serviceType || detailEvent.service_type || detailEvent.type || 'ABA'}</p>
                    {!billingDetailIsNonInsuranceContext && (
                      <>
                        <p><span className="font-semibold">Carteirinha:</span> {billingContext.insuranceCardNumber || detailEvent.insurance_card_number || 'pendente'}</p>
                        <p><span className="font-semibold">Plano:</span> {billingContext.insurancePlanName || detailEvent.insurance_plan_name || billingSuggestion?.insurancePlanName || 'não cadastrado'}</p>
                        <p><span className="font-semibold">Guia:</span> {billingContext.guideNumber || detailEvent.guide_number || 'pendente'}</p>
                        <p><span className="font-semibold">Autorização:</span> {billingContext.authorizationCode || detailEvent.authorization_code || 'pendente'}</p>
                        {visibleBillingTissAuthorization && (
                          <p className="sm:col-span-2 text-xs font-semibold text-emerald-700">Autorização TISS vigente do paciente</p>
                        )}
                        <p><span className="font-semibold">Documentos:</span> {pendingBillingDocuments.length > 0 ? `${pendingBillingDocuments.length} pendente(s)` : 'Sem pendência extra'}</p>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canEditBillingContext && billingSuggestion?.payerName && !hasSavedBillingContext && (
                    <button type="button" onClick={applyBillingSuggestion} disabled={billingEditorState.saving} className="rounded-2xl bg-[#7a32fc] px-3 py-2 text-xs font-bold text-white disabled:opacity-60">
                      Aplicar a consulta
                    </button>
                  )}
                  {canEditBillingContext && (
                    <button type="button" onClick={() => openBillingEditor()} className={`rounded-2xl px-3 py-2 text-xs font-bold ${hasSavedBillingContext ? 'bg-[#7a32fc] text-white' : 'border border-violet-200 bg-white text-[#7a32fc]'}`}>
                      {billingDetailIsNonInsuranceContext ? 'Editar contexto' : hasSavedBillingContext ? 'Editar pagador' : 'Definir pagador'}
                    </button>
                  )}
                  <button type="button" onClick={() => setFinancialValidationOpen((value) => !value)} className={`rounded-2xl border px-3 py-2 text-xs font-bold ${isDark ? 'border-slate-700 text-slate-200' : 'border-violet-200 bg-white text-[#7a32fc]'}`}>
                    Validar financeiro da consulta
                  </button>
                </div>
              </div>
              {financialValidationOpen && (
                <div className={`mt-4 rounded-2xl border p-4 ${isDark ? 'border-slate-700 bg-[#101827]' : 'border-white bg-white'}`}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7a32fc]">Validacao financeira da consulta</p>
                      <h4 className={`mt-1 text-base font-bold ${financialBlockingCount > 0 ? 'text-rose-700' : financialWarningCount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                        {financialValidationStatus}
                      </h4>
                    </div>
                    <button type="button" onClick={() => openBillingEditor()} className="rounded-xl bg-[#7a32fc] px-3 py-2 text-xs font-bold text-white">
                      Corrigir pagador
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {financialValidationItems.map((item: any) => {
                      const statusLabel = !item.ok ? 'Pendente' : item.warning ? 'Alerta' : 'OK';
                      const statusClass = !item.ok
                        ? 'bg-rose-50 text-rose-700'
                        : item.warning
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-emerald-50 text-emerald-700';
                      return (
                        <div key={item.label} className={`rounded-xl border px-3 py-2 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-100 bg-slate-50'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-bold">{item.label}</p>
                              <p className="mt-0.5 text-xs font-semibold text-slate-500">{item.message}</p>
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${statusClass}`}>{statusLabel}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {actionRequests.filter((request: any) => request.status === 'PENDING').length > 0 && (
              <div className={`mt-5 rounded-3xl border p-4 ${isDark ? 'border-violet-500/30 bg-violet-500/10' : 'border-violet-100 bg-violet-50/70'}`}>
                <h4 className="flex items-center gap-2 text-sm font-bold text-[#7a32fc]">
                  <RefreshCcw size={16} />
                  Solicitações do responsável
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
                    const parsedRescheduleNote = parseRescheduleRequestPayload(request.note, request.metadata);
                    const rescheduleOptions = Array.isArray(request.rescheduleOptions) && request.rescheduleOptions.length > 0
                      ? request.rescheduleOptions
                      : Array.isArray(request.reschedule_options) && request.reschedule_options.length > 0
                        ? request.reschedule_options
                        : parsedRescheduleNote.options;
                    const requestNote = parsedRescheduleNote.note;
                    const loading = actionRequestState.loadingId === String(request.id || '');
                    const isRejecting = actionRequestResolution.requestId === String(request.id || '');
                    const requestAppointment = {
                      ...detailEvent,
                      pendingActionRequestId: request.id,
                      pendingActionRequestType: request.request_type,
                      requestedStart: request.requested_start,
                      requestedEnd: request.requested_end
                    };
                    return (
                      <div key={request.id} className={`rounded-2xl border px-3 py-3 ${isDark ? 'border-slate-700 bg-slate-950' : 'border-white bg-white'}`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-bold">{isCancel ? 'Cancelamento solicitado' : 'Remarcação solicitada'}</p>
                            <p className={`mt-1 text-xs ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>
                              {isCancel
                                ? 'O responsável solicitou o cancelamento desta consulta.'
                                : 'O responsável solicitou a remarcação desta consulta.'}
                            </p>
                            {request.reason && <p className={`mt-1 text-xs ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>Motivo: {request.reason}</p>}
                            {requestNote && <p className={`mt-1 text-xs ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>{requestNote}</p>}
                            {!isCancel && rescheduleOptions.length > 0 && (
                              <div className="mt-2 space-y-1">
                                <p className={`text-[11px] font-bold uppercase tracking-[0.14em] ${isDark ? 'text-slate-400' : 'text-slate-400'}`}>Opções escolhidas</p>
                                {rescheduleOptions.slice(0, 3).map((option: any, index: number) => (
                                  <div key={`${request.id}-${option.scheduledStart || index}`} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-violet-100 bg-violet-50 text-slate-700'}`}>
                                    {index + 1}. {formatRescheduleOptionLabel(option)}
                                  </div>
                                ))}
                              </div>
                            )}
                            {!isCancel && rescheduleOptions.length === 0 && requestedStart && !Number.isNaN(requestedStart.getTime()) && (
                              <p className={`mt-1 text-xs font-semibold ${isDark ? 'text-slate-200' : 'text-slate-600'}`}>
                                Sugestão: {formatDisplayDateTime(requestedStart)}
                              </p>
                            )}
                            {!isCancel && rescheduleOptions.length === 0 && parsedRescheduleNote.hasStructuredPayload && parsedRescheduleNote.invalidPayload && (
                              <p className={`mt-2 text-xs font-semibold ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>
                                O responsável solicitou remarcação, mas as opções não puderam ser carregadas.
                              </p>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {isCancel ? (
                              <button type="button" disabled={loading} onClick={() => void handleActionRequestDecision(request, 'approve')} className="rounded-xl bg-[#7a32fc] px-3 py-2 text-[11px] font-bold text-white disabled:opacity-60">
                                {loading ? 'Atualizando...' : 'Cancelar consulta'}
                              </button>
                            ) : rescheduleOptions.length > 0 ? (
                              rescheduleOptions.slice(0, 3).map((option: any, index: number) => (
                                <button
                                  key={`approve-${request.id}-${option.scheduledStart || index}`}
                                  type="button"
                                  disabled={loading}
                                  onClick={() => void handleActionRequestDecision(request, 'approve', {
                                    selectedOptionIndex: index,
                                    scheduledStart: option.scheduledStart,
                                    scheduledEnd: option.scheduledEnd
                                  })}
                                  className="rounded-xl bg-[#7a32fc] px-3 py-2 text-[11px] font-bold text-white disabled:opacity-60"
                                >
                                  {loading ? 'Atualizando...' : `Aprovar opção ${index + 1}`}
                                </button>
                              ))
                            ) : (
                              <button type="button" onClick={() => onEditAppointment?.(requestAppointment)} className="rounded-xl bg-[#7a32fc] px-3 py-2 text-[11px] font-bold text-white">
                                Remarcar consulta
                              </button>
                            )}
                            {!isCancel && (
                              <button type="button" disabled={loading || !onEditAppointment} onClick={() => onEditAppointment?.(requestAppointment)} className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-[11px] font-bold text-[#7a32fc] hover:bg-violet-50 disabled:opacity-60">
                                Sugerir outro horário
                              </button>
                            )}
                            <button type="button" disabled={loading} onClick={() => setActionRequestResolution({ requestId: String(request.id || ''), note: '' })} className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-[11px] font-bold text-[#7a32fc] hover:bg-violet-50 disabled:opacity-60">
                              Recusar
                            </button>
                          </div>
                        </div>
                        {isRejecting && (
                          <div className={`mt-3 rounded-2xl border p-3 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-violet-100 bg-violet-50/60'}`}>
                            <label className={`block text-xs font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                              Motivo da recusa
                              <textarea
                                value={actionRequestResolution.note}
                                onChange={(event) => setActionRequestResolution({ requestId: String(request.id || ''), note: event.target.value })}
                                placeholder="Ex.: Este horário não está mais disponível."
                                className="mt-2 min-h-[72px] w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none focus:border-[#7a32fc]"
                              />
                            </label>
                            <div className="mt-2 flex justify-end gap-2">
                              <button type="button" onClick={() => setActionRequestResolution({ requestId: '', note: '' })} className="rounded-xl px-3 py-2 text-[11px] font-semibold text-slate-600">
                                Cancelar
                              </button>
                              <button type="button" disabled={loading} onClick={() => void handleActionRequestDecision(request, 'reject', { resolutionNote: actionRequestResolution.note })} className="rounded-xl bg-[#7a32fc] px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-60">
                                {loading ? 'Atualizando...' : 'Confirmar recusa'}
                              </button>
                            </div>
                          </div>
                        )}
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
                  Histórico operacional
                </h4>
                <div className="mt-3 space-y-2">
                  {signatures.slice(0, 2).map((signature: any, index: number) => (
                    <div key={`signature-${index}`} className="rounded-2xl bg-white/80 px-3 py-2 text-sm">
                      <p className="font-semibold text-slate-800">Sessão assinada por {signature.signedByName || 'responsável'}</p>
                      {signature.signedAt && <p className="mt-0.5 text-xs text-slate-500">{formatDisplayDateTime(signature.signedAt)}</p>}
                    </div>
                  ))}
                  {statusHistory.slice(0, 4).map((entry: any, index: number) => (
                    <div key={`history-${index}`} className="rounded-2xl bg-white/80 px-3 py-2 text-sm">
                      <p className="font-semibold text-slate-800">{entry.label || 'Ação registrada'}</p>
                      {entry.performedAt && <p className="mt-0.5 text-xs text-slate-500">{formatDisplayDateTime(entry.performedAt)}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(detailEvent.closure_readiness_status || detailCancellationState.isCancelled) && (
              <div className={`mt-5 rounded-3xl border p-4 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-100 bg-slate-50/70'}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                      {closureOperationalView.phaseSummary.title}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {(() => {
                        const summaryStatus = closureOperationalView.phaseSummary.status;
                        const closureStyle =
                          summaryStatus === 'ready'
                            ? { label: 'Pronto', className: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 }
                            : summaryStatus === 'blocked'
                              ? { label: 'Atenção necessária', className: 'bg-amber-100 text-amber-800', icon: AlertCircle }
                              : summaryStatus === 'open'
                                ? { label: 'Em andamento', className: 'bg-sky-100 text-sky-700', icon: Clock }
                                : { label: 'Informativo', className: 'bg-slate-200 text-slate-700', icon: ClipboardCheck };
                        const ClosureIcon = closureStyle.icon;
                        return (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${closureStyle.className}`}>
                            <ClosureIcon size={13} />
                            {closureStyle.label}
                          </span>
                        );
                      })()}
                      {Number(closureOperationalView.phaseSummary.actionableCount || 0) > 0 && (
                        <span className="rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">
                          {closureOperationalView.phaseSummary.actionableCount} pendência(s)
                        </span>
                      )}
                    </div>
                    <p className={`mt-2 text-sm ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                      {closureOperationalView.phaseSummary.message}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!detailCancellationState.isCancelled && [
                      'completed_pending_closure',
                      'closed_ready_for_prefacturing',
                      'prefacturing_ready',
                      'prefacturing_blocked'
                    ].includes(closureOperationalView.phase) && onNavigateTissPreGuides && (
                      <button
                        type="button"
                        onClick={() => onNavigateTissPreGuides(detailEvent)}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-3 py-2 text-xs font-bold text-white hover:bg-[#6a28df]"
                      >
                        <FileText size={14} />
                        Ver Pré-guias TISS
                      </button>
                    )}
                    {!detailCancellationState.isCancelled && (
                      <button
                        type="button"
                        onClick={() => openClosureChecklist(detailEvent)}
                        className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-xs font-bold ${isDark ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                      >
                        {closureDetailState.loading ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />}
                        {closureChecklistExpanded ? 'Ocultar checklist' : 'Ver checklist'}
                      </button>
                    )}
                  </div>
                </div>
                {!detailCancellationState.isCancelled && closureDetailState.error && (
                  <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    {closureDetailState.error}
                  </div>
                )}
                {!detailCancellationState.isCancelled && closureChecklistExpanded && Array.isArray(closureDetailState.data?.checklist) && closureDetailState.data.checklist.length > 0 && (
                  <div className="mt-4 space-y-4">
                    {Object.entries(CLOSURE_SECTION_META).map(([sectionKey, meta]) => {
                      const items = Array.isArray(closureOperationalView.sections?.[sectionKey])
                        ? closureOperationalView.sections[sectionKey]
                        : [];
                      if (items.length === 0) return null;
                      return (
                        <section key={sectionKey}>
                          <h5 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{meta.title}</h5>
                          <p className={`mt-1 text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{meta.description}</p>
                          <div className="mt-2 space-y-2">
                            {items.map((item: any) => {
                              const operationalStatus = item.operationalStatus || 'info';
                              const passed = operationalStatus === 'passed';
                              const future = operationalStatus === 'future_check' || operationalStatus === 'info';
                              const blocking = operationalStatus === 'blocking_now';
                              const Icon = passed ? CheckCircle2 : future ? Clock : blocking ? X : AlertCircle;
                              const color = passed ? 'text-emerald-600' : future ? 'text-slate-400' : blocking ? 'text-rose-600' : 'text-amber-600';
                              return (
                                <div key={item.key || item.label} className={`rounded-2xl border px-3 py-2 ${future ? 'opacity-75' : ''} ${isDark ? 'border-slate-700 bg-slate-950' : 'border-slate-100 bg-white'}`}>
                                  <div className="flex items-start gap-2">
                                    <Icon size={16} className={`${color} mt-0.5 shrink-0`} />
                                    <div>
                                      <p className="text-sm font-semibold">{item.label || 'Item do checklist'}</p>
                                      {item.message && <p className={`mt-0.5 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{item.message}</p>}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {detailPrimaryAction.kind !== 'none' && (
                <button
                  type="button"
                  onClick={() => {
                    if (detailPrimaryAction.kind === 'closure') {
                      if (!closureChecklistExpanded) openClosureChecklist(detailEvent);
                      return;
                    }
                    onStartSession?.(detailEvent);
                  }}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-violet-500/20"
                >
                  {detailPrimaryAction.kind === 'closure' ? <ClipboardCheck size={16} /> : <Play size={16} />}
                  {detailPrimaryAction.label}
                </button>
              )}
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
              {!detailCancellationState.isCancelled && (
                <button type="button" onClick={() => onCancelAppointment?.(detailEvent)} className="flex items-center justify-center gap-2 rounded-2xl border border-rose-200 px-4 py-3 text-sm font-bold text-rose-600 hover:bg-rose-50">
                  <Ban size={16} />
                  Cancelar
                </button>
              )}
              <button type="button" onClick={() => onDeleteAppointment?.(detailEvent)} className="flex items-center justify-center gap-2 rounded-2xl border border-rose-200 px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-50">
                <Trash2 size={16} />
                Excluir
              </button>
            </div>

            {detailEvent.has_session_record && !detailCancellationState.isCancelled && (
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
                    Manutencoes vinculadas
                  </h4>
                  {actionRequestState.message && (
                    <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                      {actionRequestState.message}
                    </div>
                  )}
                  {actionRequestState.error && (
                    <div className="mt-3 rounded-2xl border border-amber-200 bg-white/80 px-3 py-2 text-xs font-semibold text-amber-800">
                      {actionRequestState.error}
                    </div>
                  )}
                  {maintenanceProbes.some((probe: any) => String(probe?.status || '').toUpperCase() === 'PENDING_CONFIRMATION') && (
                    <p className="mt-2 rounded-2xl border border-amber-200 bg-white/80 px-3 py-2 text-xs font-semibold text-amber-800">
                      Ha sondagem de manutencao pendente para esta consulta. Confirme antes de vincular.
                    </p>
                  )}
                  <div className="mt-3 space-y-2">
                    {maintenanceProbes.slice(0, 6).map((probe: any, index: number) => {
                      const status = String(probe.status || 'PENDING').toUpperCase();
                      const statusLabel: Record<string, string> = {
                        PENDING_NEXT_SESSION: 'Aguardando proxima sessao',
                        PENDING_CONFIRMATION: 'Pendente de confirmacao',
                        PENDING_LINK: 'Sem sessao vinculada',
                        PENDING_SCHEDULING: 'Pendente',
                        SCHEDULED: 'Agendada',
                        DUE_TODAY: 'Para hoje',
                        OVERDUE: 'Atrasada',
                        MISSED: 'Perdida'
                      };
                      const display = resolveMaintenanceTargetDisplay({ schedule: probe });
                      const loadingConfirm = actionRequestState.loadingId === `confirm:${probe.id}`;
                      const loadingSkip = actionRequestState.loadingId === `skip:${probe.id}`;
                      return (
                        <div key={probe.id || index} className="rounded-2xl bg-white/70 px-3 py-2 text-sm">
                          <p className="font-semibold text-slate-800">{display.targetDisplayName}</p>
                          <p className="mt-1 text-xs text-slate-500">{display.contextLabel}</p>
                          <p className="mt-1 text-xs text-slate-500">Marco clinico: {display.clinicalMilestoneLabel} - Status: {statusLabel[status] || display.statusLabel}</p>
                          {display.reviewBadgeLabel && <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-amber-700">{display.reviewBadgeLabel}</p>}
                          {status === 'PENDING_CONFIRMATION' ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={loadingConfirm || loadingSkip}
                                onClick={() => void handleMaintenanceLinkDecision(probe, 'confirm')}
                                className="inline-flex min-h-[32px] items-center justify-center rounded-full bg-amber-600 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white disabled:opacity-60"
                              >
                                {loadingConfirm ? 'Confirmando...' : 'Confirmar vinculo'}
                              </button>
                              <button
                                type="button"
                                disabled={loadingConfirm || loadingSkip}
                                onClick={() => void handleMaintenanceLinkDecision(probe, 'skip')}
                                className="inline-flex min-h-[32px] items-center justify-center rounded-full border border-amber-200 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700 disabled:opacity-60"
                              >
                                {loadingSkip ? 'Atualizando...' : 'Fazer depois'}
                              </button>
                            </div>
                          ) : detailHasActiveLinkedSession ? (
                            <button
                              type="button"
                              onClick={() => onStartSession?.(detailEvent)}
                              className="mt-2 inline-flex min-h-[32px] items-center justify-center rounded-full bg-amber-600 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white transition hover:bg-amber-700"
                            >
                              Abrir na sessão ativa
                            </button>
                          ) : detailHasCompletedLinkedSession ? (
                            <p className="mt-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                              Usada na sessão.
                            </p>
                          ) : (
                            <p className="mt-2 rounded-2xl border border-amber-200 bg-white/80 px-3 py-2 text-xs font-semibold text-amber-800">
                              Inicie a sessão para usar esta Maintenance Probe.
                            </p>
                          )}
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
