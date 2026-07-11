import React, { useState, useEffect } from 'react';
import { 
  Users, 
  UserPlus, 
  Shield, 
  Mail, 
  Trash2, 
  CheckCircle2, 
  AlertCircle,
  ChevronRight,
  Search,
  Filter,
  MoreVertical,
  UserCheck,
  Calendar,
  Stethoscope,
  Clock
} from 'lucide-react';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'framer-motion';

interface Member {
  id: string;
  name: string;
  email: string;
  role: 'coordinator' | 'therapist' | 'receptionist' | 'patient' | 'admin';
  profileRole?: string | null;
  professionalTitle?: string | null;
  clinic_id: string;
  created_at: string;
  workSchedule?: any;
  workScheduleConfigured?: boolean;
}

type BulkScheduleTargetMode = 'selected' | 'attendance' | 'sameRole' | 'sameProfile';

const PROFESSIONALS_PER_ACTIVE_PATIENT = 10;
const MIN_TEAM_ACCESS_LIMIT = 10;
const WORK_SCHEDULE_DAYS = [
  { key: 'monday', label: 'Segunda-feira' },
  { key: 'tuesday', label: 'Terça-feira' },
  { key: 'wednesday', label: 'Quarta-feira' },
  { key: 'thursday', label: 'Quinta-feira' },
  { key: 'friday', label: 'Sexta-feira' },
  { key: 'saturday', label: 'Sábado' },
  { key: 'sunday', label: 'Domingo' }
];
const PROFESSIONAL_TITLE_OPTIONS = [
  'Psicólogo',
  'Terapeuta Ocupacional',
  'Acompanhante Terapêutico',
  'Aplicador ABA'
];
const DEFAULT_PROFESSIONAL_TITLE = 'Psicólogo';

const buildDefaultWorkSchedule = () => ({
  active: true,
  stepMinutes: 50,
  minLeadMinutes: 120,
  maxSlotsPerDay: 8,
  defaultSessionDurationMinutes: 50,
  days: WORK_SCHEDULE_DAYS.reduce((acc, day, index) => {
    acc[day.key] = index < 5
      ? { enabled: true, periods: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }], intervals: [{ start: '12:00', end: '13:00' }] }
      : { enabled: false, periods: [], intervals: [] };
    return acc;
  }, {} as Record<string, any>),
  exceptions: []
});

const TIME_INPUT_PATTERN = /^([01]?\d|2[0-3]):[0-5]\d$/;

const normalizeScheduleTimeInput = (value: string) => {
  const text = String(value || '').trim();
  const match = text.match(TIME_INPUT_PATTERN);
  if (!match) return null;
  const [hour, minute] = text.split(':');
  return `${hour.padStart(2, '0')}:${minute}`;
};

const timeToMinutes = (value: string) => {
  const normalized = normalizeScheduleTimeInput(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(':').map(Number);
  return hour * 60 + minute;
};

const isAttendanceProfessional = (member: Member) => member.role === 'therapist' || member.role === 'coordinator';

const hasSameOperationalRole = (member: Member, reference: Member | null) => {
  if (!reference) return false;
  if (member.role === reference.role) return true;
  return isAttendanceProfessional(member) && isAttendanceProfessional(reference);
};

const normalizeProfessionalTitle = (value: unknown, fallback = '') => {
  const text = String(value || '').trim();
  const match = PROFESSIONAL_TITLE_OPTIONS.find((option) => option.toLowerCase() === text.toLowerCase());
  return match || fallback;
};

const getProfessionalTitleFromSource = (source: any, fallback = DEFAULT_PROFESSIONAL_TITLE) => {
  const requiredFields = source?.requiredOnboardingFields || source?.required_onboarding_fields || {};
  return normalizeProfessionalTitle(
    source?.professionalTitle ||
      source?.professional_title ||
      source?.profileRole ||
      requiredFields?.professionalTitle ||
      requiredFields?.professional_title ||
      requiredFields?.title,
    fallback
  );
};

const formatAccessRoleLabel = (role: unknown, source?: any) => {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (normalizedRole === 'coordinator') return 'Coordenador';
  if (normalizedRole === 'receptionist') return 'Recepcionista/Assistente';
  if (normalizedRole === 'admin' || normalizedRole === 'owner') return 'Administrador';
  if (normalizedRole === 'therapist') return getProfessionalTitleFromSource(source);
  if (normalizedRole === 'patient') return 'Paciente';
  return 'Profissional';
};

const formatWorkScheduleMemberTitle = (member: Member) => {
  const rawName = String(member?.name || member?.email || 'Profissional').trim();
  const nameWithoutGenericPrefix = rawName.replace(/^terapeuta\s+/i, '').trim() || rawName;
  if (member?.role === 'therapist') {
    return `${getProfessionalTitleFromSource(member, 'Profissional')} ${nameWithoutGenericPrefix}`.trim();
  }
  if (member?.role === 'coordinator') {
    return `Coordenador ${nameWithoutGenericPrefix}`.trim();
  }
  return nameWithoutGenericPrefix;
};

const formatInvitationRoleLabel = (invitation: any) => {
  const role = invitation?.role;
  const roleLabel = invitation?.roleLabel || invitation?.role_label;
  if (roleLabel && !/therapist/i.test(String(roleLabel))) return String(roleLabel);
  if (String(role || '').toLowerCase() === 'therapist') {
    return `Profissional de atendimento · ${getProfessionalTitleFromSource(invitation)}`;
  }
  return formatAccessRoleLabel(role, invitation);
};

const buildScheduleValidationError = (label: string, field: string) => `${label}: informe ${field} no formato HH:mm.`;
const defaultSchedulePeriods = () => [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }];
const defaultScheduleLunch = () => [{ start: '12:00', end: '13:00' }];

const normalizeSchedulePeriodForSave = (period: any, dayLabel: string, periodLabel: string) => {
  const rawStart = String(period?.start || '').trim();
  const rawEnd = String(period?.end || '').trim();
  if (!rawStart && !rawEnd) return { period: null, error: null };
  const start = normalizeScheduleTimeInput(rawStart);
  const end = normalizeScheduleTimeInput(rawEnd);
  if (!start) return { period: null, error: buildScheduleValidationError(`${dayLabel} · ${periodLabel}`, 'início') };
  if (!end) return { period: null, error: buildScheduleValidationError(`${dayLabel} · ${periodLabel}`, 'fim') };
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
    return { period: null, error: `${dayLabel} · ${periodLabel}: o início deve ser anterior ao fim.` };
  }
  return { period: { start, end }, error: null };
};

const normalizeWorkScheduleDraftForSave = (draft: any) => {
  const base = draft || buildDefaultWorkSchedule();
  const days = WORK_SCHEDULE_DAYS.reduce((acc, day) => {
    const current = base.days?.[day.key] || { enabled: false, periods: [], intervals: [] };
    if (current.enabled === false) {
      acc[day.key] = { enabled: false, periods: [], intervals: [] };
      return acc;
    }

    const rawPeriods = Array.isArray(current.periods) && current.periods.length > 0
      ? current.periods.slice(0, 2)
      : [{ start: '', end: '' }, { start: '', end: '' }];
    const normalizedPeriods: any[] = [];
    rawPeriods.forEach((rawPeriod: any, index: number) => {
      const result = normalizeSchedulePeriodForSave(rawPeriod || {}, day.label, index === 0 ? 'Manhã' : 'Tarde');
      if (result.error) throw new Error(result.error);
      if (result.period) normalizedPeriods.push(result.period);
    });
    if (normalizedPeriods.length === 0) {
      throw new Error(`${day.label}: informe pelo menos um horário de atendimento válido.`);
    }

    const rawLunch = Array.isArray(current.intervals) && current.intervals[0] ? current.intervals[0] : {};
    const lunchResult = normalizeSchedulePeriodForSave(rawLunch, day.label, 'Intervalo/almoço');
    if (lunchResult.error) throw new Error(lunchResult.error);

    acc[day.key] = {
      enabled: true,
      periods: normalizedPeriods,
      intervals: lunchResult.period ? [lunchResult.period] : []
    };
    return acc;
  }, {} as Record<string, any>);

  const exceptions = (Array.isArray(base.exceptions) ? base.exceptions : []).map((exception: any, index: number) => {
    const date = String(exception?.date || '').trim();
    if (!date) throw new Error(`Bloqueio ${index + 1}: informe a data.`);
    const result = normalizeSchedulePeriodForSave(exception, `Bloqueio ${index + 1}`, 'horário');
    if (result.error) throw new Error(result.error);
    return {
      ...exception,
      date,
      start: result.period?.start,
      end: result.period?.end,
      blocksAvailability: exception?.blocksAvailability !== false,
      active: exception?.active !== false
    };
  });

  return {
    ...base,
    defaultSessionDurationMinutes: Number(base.defaultSessionDurationMinutes || base.stepMinutes || 50),
    stepMinutes: Number(base.stepMinutes || base.defaultSessionDurationMinutes || 50),
    minLeadMinutes: Number(base.minLeadMinutes ?? 120),
    maxSlotsPerDay: Number(base.maxSlotsPerDay || 8),
    days,
    exceptions
  };
};

export function TeamManagement({
  user,
  onRequestUpgrade,
  activePatientCount = 0,
  memberSessionDurations = {},
  onUpdateMemberSessionDuration,
}: {
  user: any;
  onRequestUpgrade?: () => void;
  activePatientCount?: number;
  memberSessionDurations?: Record<string, string>;
  onUpdateMemberSessionDuration?: (member: Member, duration: string) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [membershipHistory, setMembershipHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [cancellingInvitationId, setCancellingInvitationId] = useState<string | null>(null);
  const [resendingInvitationId, setResendingInvitationId] = useState<string | null>(null);
  const [unlinkingMemberId, setUnlinkingMemberId] = useState<string | null>(null);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'therapist' | 'receptionist' | 'coordinator'>('therapist');
  const [newMemberProfessionalTitle, setNewMemberProfessionalTitle] = useState(DEFAULT_PROFESSIONAL_TITLE);
  const [editingScheduleMember, setEditingScheduleMember] = useState<Member | null>(null);
  const [workScheduleDraft, setWorkScheduleDraft] = useState<any>(null);
  const [workScheduleLoadingId, setWorkScheduleLoadingId] = useState<string | null>(null);
  const [workScheduleSaving, setWorkScheduleSaving] = useState(false);
  const [workScheduleSavedPulse, setWorkScheduleSavedPulse] = useState(false);
  const [workScheduleNewException, setWorkScheduleNewException] = useState({ date: '', start: '08:00', end: '12:00', type: 'Bloqueio manual' });
  const [workScheduleValidationError, setWorkScheduleValidationError] = useState<string | null>(null);
  const [bulkApplyOpen, setBulkApplyOpen] = useState(false);
  const [bulkTargetMode, setBulkTargetMode] = useState<BulkScheduleTargetMode>('selected');
  const [bulkSelectedMemberIds, setBulkSelectedMemberIds] = useState<string[]>([]);
  const [bulkPreserveExceptions, setBulkPreserveExceptions] = useState(true);
  const [bulkApplying, setBulkApplying] = useState(false);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  void onRequestUpgrade;
  const normalizedActivePatientCount = Math.max(0, Number(activePatientCount) || 0);
  const inviteLimit = Math.max(MIN_TEAM_ACCESS_LIMIT, normalizedActivePatientCount * PROFESSIONALS_PER_ACTIVE_PATIENT);
  const totalUsed = (members?.length || 0) + (invitations?.filter(i => i.status === 'pending').length || 0);
  const canInvite = totalUsed < inviteLimit;

  useEffect(() => {
    void (async () => {
      await Promise.allSettled([fetchMembers(), fetchInvitations()]);
    })();
  }, []);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const timeout = new Promise((resolve) =>
        setTimeout(() => resolve({ success: false, error: 'Tempo limite ao carregar equipe.' }), 12000),
      );
      const result: any = await Promise.race([dataService.getClinicMembers(), timeout]);
      if (result.success) {
        setMembers(result.data || []);
        setError(null);
      } else {
        setMembers([]);
        setError(result.error || 'Não foi possível carregar membros da equipe.');
      }
    } catch (err) {
      setError('Erro ao carregar membros da equipe');
    } finally {
      setLoading(false);
    }
  };

  const fetchInvitations = async () => {
    try {
      const result = await dataService.getInvitations();
      if (result.success) {
        setInvitations(result.data || []);
        setMembershipHistory(result.membershipHistory || []);
      }
    } catch (err) {
      console.error('Error fetching invitations:', err);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAssigning(true);
    setError(null);
    setSuccess(null);

    if (!canInvite) {
      setError(`Limite saudável atingido: ${inviteLimit} acessos de equipe para ${normalizedActivePatientCount} paciente(s) ativo(s).`);
      setIsAssigning(false);
      return;
    }

    try {
      const result = await dataService.inviteToClinic(
        newMemberEmail,
        newMemberRole,
        newMemberRole === 'therapist'
          ? {
              professionalTitle: newMemberProfessionalTitle,
              professional_title: newMemberProfessionalTitle,
              accessRoleLabel: 'Profissional de atendimento'
            }
          : {}
      );
      if (result.success) {
        setSuccess(`Convite enviado com sucesso para ${newMemberEmail}`);
        setNewMemberEmail('');
        fetchInvitations();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Erro ao enviar convite');
    } finally {
      setIsAssigning(false);
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    const confirmed = window.confirm('Tem certeza que deseja cancelar este convite? O link enviado ficará inválido.');
    if (!confirmed) return;
    setError(null);
    setSuccess(null);
    setCancellingInvitationId(invitationId);
    try {
      const result = await dataService.cancelInvitation(invitationId);
      if (result.success) {
        setSuccess(result.message || 'Convite cancelado com sucesso.');
        await fetchInvitations();
      } else {
        setError(result.error || 'Não foi possível cancelar convite.');
      }
    } catch (err) {
      setError('Erro ao cancelar convite.');
    } finally {
      setCancellingInvitationId(null);
    }
  };

  const handleResendInvitation = async (invitation: any) => {
    setError(null);
    setSuccess(null);
    setResendingInvitationId(invitation.id);
    try {
      const result = await dataService.inviteToClinic(
        invitation.email,
        invitation.role,
        invitation.role === 'therapist'
          ? {
              ...(invitation.requiredOnboardingFields || invitation.required_onboarding_fields || {}),
              professionalTitle: getProfessionalTitleFromSource(invitation),
              professional_title: getProfessionalTitleFromSource(invitation),
              accessRoleLabel: 'Profissional de atendimento'
            }
          : (invitation.requiredOnboardingFields || invitation.required_onboarding_fields || {})
      );
      if (result.success) {
        const baseMessage = result.message || `Convite reenviado para ${invitation.email}.`;
        setSuccess(baseMessage);
        await fetchInvitations();
      } else {
        setError(result.error || 'Não foi possível reenviar convite.');
      }
    } catch (err) {
      setError('Erro ao reenviar convite.');
    } finally {
      setResendingInvitationId(null);
    }
  };

  const handleUpdateRole = async (memberId: string, newRole: any, professionalTitle?: string | null) => {
    try {
      const resolvedTitle = newRole === 'therapist'
        ? normalizeProfessionalTitle(professionalTitle, DEFAULT_PROFESSIONAL_TITLE)
        : null;
      const result = await dataService.updateMemberRole(memberId, newRole, {
        professionalTitle: resolvedTitle,
        professional_title: resolvedTitle
      });
      if (result.success) {
        setSuccess('Acesso atualizado com sucesso');
        setMembers((prev) => prev.map((member) => member.id === memberId
          ? {
              ...member,
              role: newRole,
              professionalTitle: resolvedTitle,
              profileRole: resolvedTitle
            }
          : member));
        fetchMembers();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Erro ao atualizar papel');
    }
  };

  const handleUnlinkMember = async (member: Member) => {
    if (!member?.id) return;
    if (member.id === user.id) {
      setError('Você não pode se desvincular da clínica por esta ação.');
      return;
    }
    const confirmed = window.confirm(
      `Deseja desvincular ${member.name || member.email} da clínica? Ele(a) perderá acesso a este workspace.`
    );
    if (!confirmed) return;

    setError(null);
    setSuccess(null);
    setUnlinkingMemberId(member.id);
    try {
      const result = await dataService.unlinkClinicMember(member.id);
      if (result.success) {
        setSuccess(result.message || 'Membro desvinculado com sucesso.');
        await fetchMembers();
      } else {
        setError(result.error || 'Não foi possível desvincular o membro.');
      }
    } catch (_err) {
      setError('Erro ao desvincular membro.');
    } finally {
      setUnlinkingMemberId(null);
    }
  };

  const openWorkScheduleEditor = async (member: Member) => {
    setEditingScheduleMember(member);
    setWorkScheduleDraft(member.workSchedule || buildDefaultWorkSchedule());
    setWorkScheduleNewException({ date: '', start: '08:00', end: '12:00', type: 'Bloqueio manual' });
    setWorkScheduleValidationError(null);
    setBulkApplyOpen(false);
    setBulkTargetMode('selected');
    setBulkSelectedMemberIds([]);
    setBulkPreserveExceptions(true);
    setWorkScheduleSavedPulse(false);
    setError(null);
    setSuccess(null);
    setOpenMenuId(null);
    setWorkScheduleLoadingId(member.id);
    try {
      const result = await dataService.getMemberWorkSchedule(member.id);
      if (result?.success) {
        setWorkScheduleDraft(result.data?.workSchedule || buildDefaultWorkSchedule());
      }
    } catch (_err) {
      // Mantém a versão já carregada pela lista da equipe.
    } finally {
      setWorkScheduleLoadingId(null);
    }
  };

  const updateScheduleDay = (dayKey: string, updater: (day: any) => any) => {
    setWorkScheduleDraft((prev: any) => {
      const base = prev || buildDefaultWorkSchedule();
      const currentDay = base.days?.[dayKey] || { enabled: false, periods: [], intervals: [] };
      return {
        ...base,
        days: {
          ...(base.days || {}),
          [dayKey]: updater(currentDay)
        }
      };
    });
  };

  const updateSchedulePeriod = (dayKey: string, periodIndex: number, field: 'start' | 'end', value: string) => {
    updateScheduleDay(dayKey, (day) => {
      const periods = Array.isArray(day.periods) && day.periods.length > 0
        ? [...day.periods]
        : defaultSchedulePeriods();
      periods[periodIndex] = { ...(periods[periodIndex] || {}), [field]: value };
      return { ...day, periods, enabled: day.enabled !== false };
    });
  };

  const updateScheduleLunch = (dayKey: string, field: 'start' | 'end', value: string) => {
    updateScheduleDay(dayKey, (day) => {
      const intervals = Array.isArray(day.intervals) ? [...day.intervals] : defaultScheduleLunch();
      intervals[0] = { ...(intervals[0] || { start: '12:00', end: '13:00' }), [field]: value };
      return { ...day, intervals };
    });
  };

  const normalizeScheduleFieldOnBlur = (dayKey: string, kind: 'period' | 'lunch', index: number, field: 'start' | 'end') => {
    const day = workScheduleDraft?.days?.[dayKey];
    const value = kind === 'lunch'
      ? day?.intervals?.[0]?.[field]
      : day?.periods?.[index]?.[field];
    const normalized = normalizeScheduleTimeInput(String(value || ''));
    if (!normalized) return;
    if (kind === 'lunch') {
      updateScheduleLunch(dayKey, field, normalized);
    } else {
      updateSchedulePeriod(dayKey, index, field, normalized);
    }
  };

  const normalizeExceptionFieldOnBlur = (field: 'start' | 'end') => {
    const normalized = normalizeScheduleTimeInput(String(workScheduleNewException[field] || ''));
    if (normalized) {
      setWorkScheduleNewException((prev) => ({ ...prev, [field]: normalized }));
    }
  };

  const addWorkScheduleException = () => {
    if (!workScheduleNewException.date) {
      setWorkScheduleValidationError('Informe a data do bloqueio.');
      return;
    }
    const start = normalizeScheduleTimeInput(workScheduleNewException.start);
    const end = normalizeScheduleTimeInput(workScheduleNewException.end);
    if (!start || !end) {
      setWorkScheduleValidationError('Informe horários do bloqueio no formato HH:mm.');
      return;
    }
    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);
    if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
      setWorkScheduleValidationError('No bloqueio, o início deve ser anterior ao fim.');
      return;
    }
    setWorkScheduleDraft((prev: any) => {
      const base = prev || buildDefaultWorkSchedule();
      return {
        ...base,
        exceptions: [
          ...(Array.isArray(base.exceptions) ? base.exceptions : []),
          { ...workScheduleNewException, start, end, blocksAvailability: true, active: true }
        ]
      };
    });
    setWorkScheduleNewException({ date: '', start: '08:00', end: '12:00', type: 'Bloqueio manual' });
    setWorkScheduleValidationError(null);
  };

  const removeWorkScheduleException = (index: number) => {
    setWorkScheduleDraft((prev: any) => ({
      ...(prev || buildDefaultWorkSchedule()),
      exceptions: (Array.isArray(prev?.exceptions) ? prev.exceptions : []).filter((_: any, itemIndex: number) => itemIndex !== index)
    }));
  };

  const saveWorkSchedule = async () => {
    if (!editingScheduleMember?.id || !workScheduleDraft) return;
    setWorkScheduleSaving(true);
    setError(null);
    setSuccess(null);
    setWorkScheduleValidationError(null);
    try {
      const normalizedSchedule = normalizeWorkScheduleDraftForSave(workScheduleDraft);
      const result = await dataService.updateMemberWorkSchedule(editingScheduleMember.id, normalizedSchedule);
      if (!result?.success) {
        setError(result?.error || 'Não foi possível salvar horários de trabalho.');
        return;
      }
      const savedSchedule = result.data?.workSchedule || normalizedSchedule;
      setMembers((prev) => prev.map((member) => member.id === editingScheduleMember.id ? { ...member, workSchedule: savedSchedule, workScheduleConfigured: true } : member));
      setWorkScheduleDraft(savedSchedule);
      setSuccess('Horários de trabalho salvos.');
      setWorkScheduleSavedPulse(true);
      window.setTimeout(() => setWorkScheduleSavedPulse(false), 1800);
    } catch (err) {
      setWorkScheduleValidationError(err instanceof Error ? err.message : 'Erro ao salvar horários de trabalho.');
    } finally {
      setWorkScheduleSaving(false);
    }
  };

  const getBulkTargetMembers = () => {
    if (!editingScheduleMember) return [];
    if (bulkTargetMode === 'attendance') {
      return members.filter((member) => member.id !== editingScheduleMember.id && isAttendanceProfessional(member));
    }
    if (bulkTargetMode === 'sameRole') {
      return members.filter((member) => member.id !== editingScheduleMember.id && hasSameOperationalRole(member, editingScheduleMember));
    }
    if (bulkTargetMode === 'sameProfile') {
      const referenceProfile = String(editingScheduleMember.profileRole || '').trim().toLowerCase();
      if (!referenceProfile) return [];
      return members.filter((member) => member.id !== editingScheduleMember.id && String(member.profileRole || '').trim().toLowerCase() === referenceProfile);
    }
    return members.filter((member) => bulkSelectedMemberIds.includes(member.id));
  };

  const toggleBulkMember = (memberId: string) => {
    setBulkSelectedMemberIds((prev) => prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]);
  };

  const applyWorkScheduleInBulk = async () => {
    if (!editingScheduleMember?.id || !workScheduleDraft) return;
    setBulkApplying(true);
    setError(null);
    setSuccess(null);
    setWorkScheduleValidationError(null);
    try {
      const normalizedSchedule = normalizeWorkScheduleDraftForSave(workScheduleDraft);
      const targetMembers = getBulkTargetMembers();
      if (targetMembers.length === 0) {
        setWorkScheduleValidationError('Selecione pelo menos um profissional para receber a escala.');
        return;
      }
      const confirmed = window.confirm(
        `Você está prestes a aplicar esta escala para ${targetMembers.length} profissional(is).\n\nIsso substituirá a jornada semanal desses profissionais.${bulkPreserveExceptions ? '\nExceções individuais futuras serão preservadas.' : '\nExceções individuais também serão substituídas.'}`
      );
      if (!confirmed) return;

      const result = await dataService.applyMemberWorkSchedule(editingScheduleMember.id, {
        workSchedule: normalizedSchedule,
        targetMode: bulkTargetMode,
        targetMemberIds: targetMembers.map((member) => member.id),
        preserveExceptions: bulkPreserveExceptions
      });

      if (!result?.success) {
        setError(result?.error || 'Não foi possível aplicar a escala em massa.');
        return;
      }

      const affectedIds = new Set<string>(result.data?.affectedMemberIds || targetMembers.map((member) => member.id));
      setMembers((prev) => prev.map((member) => {
        if (!affectedIds.has(member.id)) return member;
        const preservedExceptions = bulkPreserveExceptions && Array.isArray(member.workSchedule?.exceptions)
          ? member.workSchedule.exceptions
          : normalizedSchedule.exceptions;
        return {
          ...member,
          workSchedule: { ...normalizedSchedule, exceptions: preservedExceptions },
          workScheduleConfigured: true
        };
      }));
      setWorkScheduleDraft(normalizedSchedule);
      setBulkApplyOpen(false);
      setBulkSelectedMemberIds([]);
      setSuccess(result.message || `Escala aplicada para ${affectedIds.size} profissional(is).`);
    } catch (err) {
      setWorkScheduleValidationError(err instanceof Error ? err.message : 'Erro ao aplicar escala em massa.');
    } finally {
      setBulkApplying(false);
    }
  };

  const roleIcons = {
    coordinator: <Shield className="text-purple-500" size={18} />,
    therapist: <Stethoscope className="text-blue-500" size={18} />,
    receptionist: <Calendar className="text-green-500" size={18} />,
    patient: <Users className="text-slate-400" size={18} />,
    admin: <Shield className="text-red-500" size={18} />
  };

  const filteredMembers = members.filter(m => 
    m.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    m.email.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const pendingInvitations = invitations.filter((inv) => String(inv?.status || '').toLowerCase() === 'pending');
  const invitationHistory = invitations.filter((inv) => String(inv?.status || '').toLowerCase() !== 'pending');
  const bulkManualCandidates = editingScheduleMember
    ? members.filter((member) => member.id !== editingScheduleMember.id && member.role !== 'patient')
    : [];
  const bulkPreviewMembers = getBulkTargetMembers();

  return (
    <div className="p-6 max-w-6xl mx-auto font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Gestão da Equipe</h1>
          <p className="text-slate-500 text-sm">
            Limite saudável: {totalUsed} de {inviteLimit} acessos usados • {normalizedActivePatientCount} paciente(s) ativo(s)
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text"
              placeholder="Buscar membro..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all w-full md:w-64"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Lista de Membros */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-visible">
            <div className="p-6 border-b border-slate-50 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">Membros Ativos</h2>
              <span className="px-3 py-1 bg-slate-100 text-slate-500 rounded-full text-[10px] font-bold uppercase tracking-wider">
                {filteredMembers?.length || 0} Colaboradores
              </span>
            </div>

            <div className="divide-y divide-slate-50 overflow-visible">
              {loading ? (
                <div className="p-12 text-center">
                  <div className="w-8 h-8 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mx-auto mb-4"></div>
                  <p className="text-slate-400 text-sm">Carregando equipe...</p>
                </div>
              ) : (filteredMembers?.length || 0) === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-3xl flex items-center justify-center mx-auto mb-4">
                    <Users size={32} />
                  </div>
                  <p className="text-slate-500 font-medium">Nenhum membro encontrado</p>
                  <p className="text-slate-400 text-xs mt-1">Atribua papéis para começar a montar sua equipe.</p>
                </div>
              ) : (
                filteredMembers.map((member) => (
                  <div key={member.id} className="p-6 hover:bg-slate-50/50 transition-all flex items-center justify-between group overflow-visible">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 font-bold text-lg">
                    {(String(member?.name || 'P').trim().charAt(0) || 'P').toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-slate-900 text-sm">{member.name}</h3>
                          {member.id === user.id && (
                            <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md text-[8px] font-bold uppercase tracking-widest">Você</span>
                          )}
                        </div>
                        <p className="text-slate-400 text-xs">{member.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="hidden md:block text-right">
                        <div className="flex items-center justify-end gap-1.5 mb-0.5">
                          {roleIcons[member.role as keyof typeof roleIcons]}
                          <span className="text-xs font-semibold text-slate-700">{formatAccessRoleLabel(member.role, member)}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium">Desde {new Date(member.created_at).toLocaleDateString()}</p>
                      </div>

                      {(member.role === 'therapist' || member.role === 'coordinator') && (
                        <div className="hidden md:flex items-center gap-2 bg-slate-50 rounded-xl px-2 py-1.5">
                          <Clock size={14} className="text-slate-400" />
                          <select
                            value={memberSessionDurations[member.id] || memberSessionDurations[member.email] || memberSessionDurations[member.name] || '50'}
                            onChange={(e) => onUpdateMemberSessionDuration?.(member, e.target.value)}
                            className="bg-transparent text-xs font-semibold text-slate-700 outline-none"
                          >
                            <option value="30">30 min</option>
                            <option value="45">45 min</option>
                            <option value="50">50 min</option>
                            <option value="60">60 min</option>
                            <option value="90">90 min</option>
                          </select>
                        </div>
                      )}
                      
                      <div className="relative z-20">
                        <button 
                          onClick={() => setOpenMenuId(openMenuId === member.id ? null : member.id)}
                          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-white rounded-xl transition-all"
                        >
                          <MoreVertical size={18} />
                        </button>
                        
                        {openMenuId === member.id && (
                          <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-100 z-50 py-2 animate-in fade-in zoom-in duration-200">
                            <div className="px-4 py-2 border-b border-slate-50 mb-1">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Alterar acesso</p>
                            </div>
                            <button 
                              onClick={() => { handleUpdateRole(member.id, 'coordinator', null); setOpenMenuId(null); }}
                              className={`w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium transition-all ${member.role === 'coordinator' ? 'text-purple-600 bg-purple-50' : 'text-slate-600 hover:bg-slate-50'}`}
                              disabled={member.id === user.id}
                            >
                              <Shield size={14} /> Coordenador
                            </button>
                            <button 
                              onClick={() => { handleUpdateRole(member.id, 'therapist', getProfessionalTitleFromSource(member)); setOpenMenuId(null); }}
                              className={`w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium transition-all ${member.role === 'therapist' ? 'text-blue-600 bg-blue-50' : 'text-slate-600 hover:bg-slate-50'}`}
                              disabled={member.id === user.id}
                            >
                              <Stethoscope size={14} /> Profissional de atendimento
                            </button>
                            <button 
                              onClick={() => { handleUpdateRole(member.id, 'receptionist', null); setOpenMenuId(null); }}
                              className={`w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium transition-all ${member.role === 'receptionist' ? 'text-green-600 bg-green-50' : 'text-slate-600 hover:bg-slate-50'}`}
                              disabled={member.id === user.id}
                            >
                              <Calendar size={14} /> Recepcionista/Assistente
                            </button>
                            {member.role === 'therapist' && (
                              <div className="border-t border-slate-50 pt-2 mt-1">
                                <div className="px-4 py-2">
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Título profissional</p>
                                </div>
                                {PROFESSIONAL_TITLE_OPTIONS.map((title) => {
                                  const selected = getProfessionalTitleFromSource(member) === title;
                                  return (
                                    <button
                                      key={title}
                                      type="button"
                                      onClick={() => { handleUpdateRole(member.id, 'therapist', title); setOpenMenuId(null); }}
                                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium transition-all ${selected ? 'text-blue-600 bg-blue-50' : 'text-slate-600 hover:bg-slate-50'}`}
                                    >
                                      <Stethoscope size={14} /> {title}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            {(member.role === 'therapist' || member.role === 'coordinator') && (
                              <button
                                type="button"
                                onClick={() => void openWorkScheduleEditor(member)}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-all"
                              >
                                <Clock size={14} /> Horários de trabalho
                              </button>
                            )}
                            <div className="h-px bg-slate-50 my-1" />
                            <button 
                              onClick={() => { handleUnlinkMember(member); setOpenMenuId(null); }}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-red-500 hover:bg-red-50 transition-all"
                              disabled={member.id === user.id || unlinkingMemberId === member.id}
                            >
                              <Trash2 size={14} /> {unlinkingMemberId === member.id ? 'Desvinculando...' : 'Desvincular da Clínica'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <AnimatePresence>
          {editingScheduleMember && workScheduleDraft && (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 p-3 md:p-6">
              <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
                <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-purple-600">Horários de trabalho</p>
                    <h2 className="mt-1 truncate text-xl font-semibold text-slate-900">{formatWorkScheduleMemberTitle(editingScheduleMember)}</h2>
                    <p className="mt-1 text-sm text-slate-500">Jornada usada para agenda e opções reais de remarcação no portal.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setBulkApplyOpen((prev) => !prev)}
                      className="rounded-2xl border border-purple-200 bg-purple-50 px-4 py-2.5 text-sm font-medium text-[#6f2cf5] hover:bg-purple-100"
                    >
                      Aplicar escala para outros
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingScheduleMember(null)}
                      className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Fechar
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                  {(workScheduleValidationError || workScheduleLoadingId === editingScheduleMember.id) && (
                    <div className={`mb-4 rounded-2xl px-4 py-3 text-sm ${workScheduleValidationError ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-500'}`}>
                      {workScheduleValidationError || 'Carregando horários de trabalho...'}
                    </div>
                  )}

                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
                    <div className="space-y-4">
                      <div className="grid gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-4 md:grid-cols-3">
                        <label className="text-sm font-medium text-slate-600">
                          Duração padrão da sessão
                          <select
                            value={String(workScheduleDraft.defaultSessionDurationMinutes || workScheduleDraft.stepMinutes || '50')}
                            onChange={(event) => setWorkScheduleDraft((prev: any) => ({ ...(prev || buildDefaultWorkSchedule()), defaultSessionDurationMinutes: Number(event.target.value), stepMinutes: Number(event.target.value) }))}
                            className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-purple-300"
                          >
                            <option value="30">30 min</option>
                            <option value="45">45 min</option>
                            <option value="50">50 min</option>
                            <option value="60">60 min</option>
                            <option value="90">90 min</option>
                          </select>
                        </label>
                        <label className="text-sm font-medium text-slate-600">
                          Antecedência mínima
                          <select
                            value={String(workScheduleDraft.minLeadMinutes ?? 120)}
                            onChange={(event) => setWorkScheduleDraft((prev: any) => ({ ...(prev || buildDefaultWorkSchedule()), minLeadMinutes: Number(event.target.value) }))}
                            className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-purple-300"
                          >
                            <option value="0">Sem trava</option>
                            <option value="120">2 horas</option>
                            <option value="1440">1 dia</option>
                            <option value="2880">2 dias</option>
                          </select>
                        </label>
                        <label className="text-sm font-medium text-slate-600">
                          Limite de opções por dia
                          <input
                            type="number"
                            min={1}
                            max={24}
                            value={String(workScheduleDraft.maxSlotsPerDay || 8)}
                            onChange={(event) => setWorkScheduleDraft((prev: any) => ({ ...(prev || buildDefaultWorkSchedule()), maxSlotsPerDay: event.target.value }))}
                            onBlur={(event) => setWorkScheduleDraft((prev: any) => ({ ...(prev || buildDefaultWorkSchedule()), maxSlotsPerDay: Math.min(24, Math.max(1, Number(event.target.value) || 8)) }))}
                            className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-purple-300"
                          />
                        </label>
                      </div>

                      <div className="space-y-3">
                        {WORK_SCHEDULE_DAYS.map((day) => {
                          const dayDraft = workScheduleDraft.days?.[day.key] || { enabled: false, periods: [], intervals: [] };
                          const periods = Array.isArray(dayDraft.periods) && dayDraft.periods.length > 0
                            ? dayDraft.periods
                            : defaultSchedulePeriods();
                          const lunch = Array.isArray(dayDraft.intervals) && dayDraft.intervals[0] ? dayDraft.intervals[0] : defaultScheduleLunch()[0];
                          return (
                            <section key={day.key} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <label className="flex items-center gap-3 text-base font-medium text-slate-800">
                                  <input
                                    type="checkbox"
                                    checked={dayDraft.enabled !== false}
                                    onChange={(event) => updateScheduleDay(day.key, (current) => ({
                                      ...current,
                                      enabled: event.target.checked,
                                      periods: event.target.checked && (!Array.isArray(current.periods) || current.periods.length === 0) ? defaultSchedulePeriods() : current.periods,
                                      intervals: event.target.checked && (!Array.isArray(current.intervals) || current.intervals.length === 0) ? defaultScheduleLunch() : current.intervals
                                    }))}
                                    className="h-5 w-5 rounded border-slate-300 accent-[#7a32fc]"
                                  />
                                  {day.label}
                                </label>
                                <span className={`rounded-full px-3 py-1 text-xs font-medium ${dayDraft.enabled === false ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'}`}>
                                  {dayDraft.enabled === false ? 'Não atende' : 'Atende'}
                                </span>
                              </div>

                              {dayDraft.enabled !== false ? (
                                <div className="mt-4 grid gap-3">
                                  {[0, 1].map((periodIndex) => (
                                    <div key={periodIndex} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                                      <div className="mb-3 flex items-center justify-between gap-3">
                                        <p className="text-sm font-medium text-slate-700">{periodIndex === 0 ? 'Manhã' : 'Tarde'}</p>
                                        <span className="text-xs text-slate-400">Atendimento</span>
                                      </div>
                                      <div className="grid gap-3 sm:grid-cols-2">
                                        <label className="text-xs font-medium text-slate-500">
                                          Início
                                          <input
                                            type="time"
                                            placeholder={periodIndex === 0 ? '08:00' : '13:00'}
                                            value={periods[periodIndex]?.start ?? ''}
                                            onChange={(event) => updateSchedulePeriod(day.key, periodIndex, 'start', event.target.value)}
                                            onBlur={() => normalizeScheduleFieldOnBlur(day.key, 'period', periodIndex, 'start')}
                                            className="mt-1 h-12 min-w-0 w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-medium text-slate-800 outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-100"
                                          />
                                        </label>
                                        <label className="text-xs font-medium text-slate-500">
                                          Fim
                                          <input
                                            type="time"
                                            placeholder={periodIndex === 0 ? '12:00' : '17:00'}
                                            value={periods[periodIndex]?.end ?? ''}
                                            onChange={(event) => updateSchedulePeriod(day.key, periodIndex, 'end', event.target.value)}
                                            onBlur={() => normalizeScheduleFieldOnBlur(day.key, 'period', periodIndex, 'end')}
                                            className="mt-1 h-12 min-w-0 w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-medium text-slate-800 outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-100"
                                          />
                                        </label>
                                      </div>
                                    </div>
                                  ))}

                                  <div className="rounded-2xl border border-purple-100 bg-purple-50/60 p-3">
                                    <div className="mb-3 flex items-center justify-between gap-3">
                                      <p className="text-sm font-medium text-purple-700">Intervalo/almoço</p>
                                      <span className="text-xs text-purple-500">Não conta como atendimento</span>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      <label className="text-xs font-medium text-purple-600">
                                        Início
                                        <input
                                          type="time"
                                          placeholder="12:00"
                                          value={lunch.start ?? ''}
                                          onChange={(event) => updateScheduleLunch(day.key, 'start', event.target.value)}
                                          onBlur={() => normalizeScheduleFieldOnBlur(day.key, 'lunch', 0, 'start')}
                                          className="mt-1 h-12 min-w-0 w-full rounded-xl border border-purple-100 bg-white px-4 text-base font-medium text-slate-800 outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-100"
                                        />
                                      </label>
                                      <label className="text-xs font-medium text-purple-600">
                                        Fim
                                        <input
                                          type="time"
                                          placeholder="13:00"
                                          value={lunch.end ?? ''}
                                          onChange={(event) => updateScheduleLunch(day.key, 'end', event.target.value)}
                                          onBlur={() => normalizeScheduleFieldOnBlur(day.key, 'lunch', 0, 'end')}
                                          className="mt-1 h-12 min-w-0 w-full rounded-xl border border-purple-100 bg-white px-4 text-base font-medium text-slate-800 outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-100"
                                        />
                                      </label>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">Dia sem atendimento. Não serão gerados slots para este dia.</p>
                              )}
                            </section>
                          );
                        })}
                      </div>
                    </div>

                    <aside className="space-y-4">
                      <section className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                        <h3 className="text-base font-semibold text-slate-900">Exceções e bloqueios</h3>
                        <p className="mt-1 text-sm text-slate-500">Folgas, reuniões e bloqueios removem disponibilidade sem apagar consultas.</p>
                        <div className="mt-4 space-y-3">
                          <label className="block text-sm font-medium text-slate-600">
                            Data
                            <input type="date" value={workScheduleNewException.date} onChange={(event) => setWorkScheduleNewException((prev) => ({ ...prev, date: event.target.value }))} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700" />
                          </label>
                          <div className="grid gap-3">
                            <label className="text-sm font-medium text-slate-600">
                              Início
                              <input type="time" placeholder="08:00" value={workScheduleNewException.start} onChange={(event) => setWorkScheduleNewException((prev) => ({ ...prev, start: event.target.value }))} onBlur={() => normalizeExceptionFieldOnBlur('start')} className="mt-1 h-11 min-w-0 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700" />
                            </label>
                            <label className="text-sm font-medium text-slate-600">
                              Fim
                              <input type="time" placeholder="12:00" value={workScheduleNewException.end} onChange={(event) => setWorkScheduleNewException((prev) => ({ ...prev, end: event.target.value }))} onBlur={() => normalizeExceptionFieldOnBlur('end')} className="mt-1 h-11 min-w-0 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700" />
                            </label>
                          </div>
                          <label className="block text-sm font-medium text-slate-600">
                            Tipo
                            <select value={workScheduleNewException.type} onChange={(event) => setWorkScheduleNewException((prev) => ({ ...prev, type: event.target.value }))} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700">
                              <option>Bloqueio manual</option>
                              <option>Folga</option>
                              <option>Férias</option>
                              <option>Reunião interna</option>
                              <option>Curso/supervisão</option>
                              <option>Feriado</option>
                              <option>Atendimento externo</option>
                            </select>
                          </label>
                          <button type="button" onClick={addWorkScheduleException} className="h-11 w-full rounded-xl border border-purple-200 bg-white px-3 text-sm font-semibold text-[#7a32fc] hover:bg-purple-50">
                            Adicionar bloqueio
                          </button>
                        </div>
                        <div className="mt-4 space-y-2">
                          {(Array.isArray(workScheduleDraft.exceptions) ? workScheduleDraft.exceptions : []).length === 0 ? (
                            <p className="rounded-xl bg-white px-3 py-3 text-sm text-slate-400">Nenhuma exceção futura cadastrada.</p>
                          ) : (
                            workScheduleDraft.exceptions.map((exception: any, index: number) => (
                              <div key={`${exception.date}-${index}`} className="rounded-xl bg-white p-3 text-sm text-slate-600">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="font-medium text-slate-800">{exception.date} · {exception.start}–{exception.end}</p>
                                    <p className="mt-0.5 text-slate-500">{exception.type || 'Bloqueio'}</p>
                                  </div>
                                  <button type="button" onClick={() => removeWorkScheduleException(index)} className="text-sm font-medium text-red-500 hover:text-red-600">
                                    Remover
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </section>

                      {bulkApplyOpen && (
                        <section className="rounded-2xl border border-purple-100 bg-purple-50/50 p-4">
                          <h3 className="text-base font-semibold text-slate-900">Aplicar escala para outros profissionais</h3>
                          <p className="mt-1 text-sm text-slate-500">Use a jornada atual como modelo. Exceções individuais são preservadas por padrão.</p>
                          <div className="mt-4 grid gap-2">
                            {[
                              { key: 'selected', label: 'Selecionados' },
                              { key: 'attendance', label: 'Todos de atendimento' },
                              { key: 'sameRole', label: 'Mesmo papel operacional' },
                              { key: 'sameProfile', label: 'Mesmo título profissional' }
                            ].map((option) => (
                              <button
                                key={option.key}
                                type="button"
                                onClick={() => setBulkTargetMode(option.key as BulkScheduleTargetMode)}
                                className={`rounded-xl border px-3 py-2 text-left text-sm font-medium ${bulkTargetMode === option.key ? 'border-purple-300 bg-white text-[#6f2cf5]' : 'border-transparent bg-white/60 text-slate-600 hover:bg-white'}`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>

                          {bulkTargetMode === 'selected' && (
                            <div className="mt-4 max-h-56 space-y-2 overflow-y-auto rounded-xl bg-white p-2">
                              {bulkManualCandidates.length === 0 ? (
                                <p className="px-2 py-3 text-sm text-slate-400">Nenhum outro profissional disponível.</p>
                              ) : (
                                bulkManualCandidates.map((member) => (
                                  <label key={member.id} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-50">
                                    <input
                                      type="checkbox"
                                      checked={bulkSelectedMemberIds.includes(member.id)}
                                      onChange={() => toggleBulkMember(member.id)}
                                      className="h-4 w-4 accent-[#7a32fc]"
                                    />
                                    <span className="min-w-0 flex-1 truncate">{member.name}</span>
                                    <span className="text-xs text-slate-400">{formatAccessRoleLabel(member.role, member)}</span>
                                  </label>
                                ))
                              )}
                            </div>
                          )}

                          <label className="mt-4 flex items-start gap-3 rounded-xl bg-white px-3 py-3 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={bulkPreserveExceptions}
                              onChange={(event) => setBulkPreserveExceptions(event.target.checked)}
                              className="mt-0.5 h-4 w-4 accent-[#7a32fc]"
                            />
                            <span>Preservar exceções e bloqueios individuais futuros</span>
                          </label>
                          <p className="mt-3 text-sm text-slate-500">{bulkPreviewMembers.length} profissional(is) serão afetados.</p>
                          <button
                            type="button"
                            onClick={() => void applyWorkScheduleInBulk()}
                            disabled={bulkApplying || bulkPreviewMembers.length === 0}
                            className="mt-3 h-11 w-full rounded-xl bg-[#7a32fc] px-4 text-sm font-semibold text-white disabled:opacity-60"
                          >
                            {bulkApplying ? 'Aplicando...' : 'Aplicar escala'}
                          </button>
                        </section>
                      )}
                    </aside>
                  </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-100 bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
                  <p className="text-sm text-slate-500">Após salvar, a remarcação do portal passa a usar esta jornada.</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingScheduleMember(null)}
                      className="h-11 rounded-2xl border border-slate-200 px-5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveWorkSchedule()}
                      disabled={workScheduleSaving || workScheduleLoadingId === editingScheduleMember.id}
                      className={`inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-5 text-sm font-semibold text-white shadow-sm transition-all duration-300 disabled:opacity-60 ${workScheduleSavedPulse ? 'bg-emerald-600 ring-4 ring-emerald-100' : 'bg-[#7a32fc] hover:bg-[#6924df]'}`}
                    >
                      {workScheduleSaving ? (
                        <>
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                          Salvando...
                        </>
                      ) : workScheduleSavedPulse ? (
                        <>
                          <CheckCircle2 size={17} className="animate-in zoom-in duration-200" />
                          Horários salvos
                        </>
                      ) : (
                        'Salvar horários'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </AnimatePresence>

        {/* Atribuir Papel */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-100 sticky top-6">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-6">
              <UserPlus size={24} />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Convidar Colaborador</h2>
            <p className="text-slate-500 text-xs mb-6">Se o colaborador ainda não tiver conta, ele poderá criar pelo próprio convite via e-mail.</p>

            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">E-mail do Colaborador</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input 
                    type="email"
                    required
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                    placeholder="exemplo@email.com"
                    className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-none rounded-2xl text-sm focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Papel / Nível de Acesso</label>
                <div className="grid grid-cols-1 gap-3">
                  <button
                    type="button"
                    onClick={() => setNewMemberRole('therapist')}
                    className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all text-left ${newMemberRole === 'therapist' ? 'border-blue-500 bg-blue-50/50' : 'border-slate-100 hover:border-slate-200'}`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${newMemberRole === 'therapist' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                      <Stethoscope size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">Profissional de atendimento</p>
                      <p className="text-[10px] text-slate-500">Agenda, prontuários e pacientes atribuídos</p>
                    </div>
                  </button>

                  {newMemberRole === 'therapist' && (
                    <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-3">
                      <p className="mb-2 text-xs font-semibold text-slate-500">Título profissional</p>
                      <div className="grid grid-cols-1 gap-2">
                        {PROFESSIONAL_TITLE_OPTIONS.map((title) => (
                          <button
                            key={title}
                            type="button"
                            onClick={() => setNewMemberProfessionalTitle(title)}
                            className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-all ${newMemberProfessionalTitle === title ? 'border-blue-400 bg-white text-blue-700' : 'border-transparent bg-white/60 text-slate-600 hover:bg-white'}`}
                          >
                            {title}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setNewMemberRole('coordinator')}
                    className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all text-left ${newMemberRole === 'coordinator' ? 'border-purple-500 bg-purple-50/50' : 'border-slate-100 hover:border-slate-200'}`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${newMemberRole === 'coordinator' ? 'bg-purple-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                      <Shield size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">Coordenador</p>
                      <p className="text-[10px] text-slate-500">Acesso completo à gestão da clínica</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewMemberRole('receptionist')}
                    className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all text-left ${newMemberRole === 'receptionist' ? 'border-green-500 bg-green-50/50' : 'border-slate-100 hover:border-slate-200'}`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${newMemberRole === 'receptionist' ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                      <Calendar size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">Recepcionista/Assistente</p>
                      <p className="text-[10px] text-slate-500">Agenda, pagamentos, cobranças e convênios</p>
                    </div>
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-xs flex items-center gap-2 animate-shake">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}

              {success && (
                <div className="p-4 bg-green-50 text-green-600 rounded-2xl text-xs flex items-center gap-2 animate-pop">
                  <CheckCircle2 size={16} />
                  {success}
                </div>
              )}

              <button
                type="submit"
                disabled={isAssigning || !canInvite}
                className={`w-full py-4 rounded-2xl font-bold text-sm shadow-lg transition-all ${
                  !canInvite
                    ? 'bg-slate-200 text-slate-500 cursor-not-allowed shadow-none'
                    : 'bg-gradient-to-r from-[#6D28FF] to-[#9F67FF] text-white shadow-purple-500/30 hover:scale-[1.02] active:scale-[0.98]'
                } disabled:opacity-50 disabled:scale-100`}
              >
                {isAssigning ? 'Enviando...' : !canInvite ? 'Limite atingido' : 'Enviar Convite'}
              </button>
            </form>

            {/* Pending Invitations */}
            {(pendingInvitations.length || 0) > 0 && (
              <div className="mt-12">
                <h3 className="text-lg font-bold text-slate-900 mb-6">Convites Pendentes</h3>
                <div className="space-y-3">
                  {pendingInvitations.map((inv) => (
                    <div key={inv.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-slate-400">
                          <Mail size={20} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 text-sm truncate">{inv.email}</p>
                          <p className="text-[10px] text-slate-500 font-semibold">{formatInvitationRoleLabel(inv)}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 md:justify-end">
                        <span className="shrink-0 px-3 py-1 bg-amber-100 text-amber-600 rounded-full text-[10px] font-bold uppercase tracking-widest">Pendente</span>
                        <button
                          type="button"
                          onClick={() => handleResendInvitation(inv)}
                          disabled={resendingInvitationId === inv.id}
                          className="shrink-0 px-3 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-600 text-[10px] font-bold uppercase tracking-widest hover:bg-blue-100 transition-colors disabled:opacity-60"
                          title="Reenviar convite"
                        >
                          {resendingInvitationId === inv.id ? 'Reenviando...' : 'Reenviar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelInvitation(inv.id)}
                          disabled={cancellingInvitationId === inv.id}
                          className="shrink-0 px-3 py-1 rounded-full border border-red-200 bg-red-50 text-red-600 text-[10px] font-bold uppercase tracking-widest hover:bg-red-100 transition-colors disabled:opacity-60"
                          title="Cancelar convite"
                        >
                          {cancellingInvitationId === inv.id ? 'Cancelando...' : 'Cancelar'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(invitationHistory.length || 0) > 0 && (
              <div className="mt-8">
                <h3 className="text-lg font-bold text-slate-900 mb-4">Histórico de Convites</h3>
                <div className="space-y-3">
                  {invitationHistory.map((inv) => {
                    const status = String(inv?.status || '').toLowerCase();
                    const statusLabel = status === 'accepted'
                      ? 'Ativado'
                      : status === 'canceled'
                        ? 'Cancelado'
                        : status;
                    const statusClass = status === 'accepted'
                      ? 'bg-emerald-100 text-emerald-700'
                      : status === 'canceled'
                        ? 'bg-slate-200 text-slate-600'
                        : 'bg-slate-100 text-slate-500';
                    return (
                      <div key={inv.id} className="p-4 bg-white rounded-2xl border border-slate-100 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400">
                            <Mail size={20} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 text-sm truncate">{inv.email}</p>
                            <p className="text-[10px] text-slate-500 font-semibold">{formatInvitationRoleLabel(inv)}</p>
                          </div>
                        </div>
                        <span className={`self-start md:self-center shrink-0 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${statusClass}`}>
                          {statusLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {(membershipHistory.length || 0) > 0 && (
              <div className="mt-8">
                <h3 className="text-lg font-bold text-slate-900 mb-4">Colaboradores Desvinculados</h3>
                <div className="space-y-3">
                  {membershipHistory.map((entry) => (
                    <div key={entry.id} className="p-4 bg-white rounded-2xl border border-slate-100 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-500">
                          <Users size={20} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 text-sm truncate">{entry.email || entry.name || 'Colaborador'}</p>
                          <p className="text-[10px] text-slate-500 font-semibold">{formatInvitationRoleLabel(entry)}</p>
                        </div>
                      </div>
                      <span className="self-start md:self-center shrink-0 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-amber-100 text-amber-700">
                        Desvinculado
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

