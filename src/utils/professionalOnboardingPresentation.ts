// Presentation-only labels and deterministic initial work schedule for onboarding.
// This module never writes clinical/profile data, grants access or authorizes a role.

export const WEEKDAYS = [
  ['monday', 'Segunda'],
  ['tuesday', 'Terça'],
  ['wednesday', 'Quarta'],
  ['thursday', 'Quinta'],
  ['friday', 'Sexta'],
  ['saturday', 'Sábado'],
  ['sunday', 'Domingo'],
] as const;

export const roleLabel = (role: string) => {
  if (role === 'director') return 'Diretor';
  if (role === 'coordinator') return 'Coordenador';
  if (role === 'supervisor') return 'Profissional · Supervisor';
  if (role === 'receptionist') return 'Recepcionista/Assistente';
  if (role === 'biller') return 'Faturista';
  if (role === 'admin') return 'Administrador';
  if (role === 'owner') return 'Proprietário';
  return 'Profissional de atendimento';
};

export const buildProfessionalOnboardingSchedule = ({
  selectedDays, sessionDurationMinutes, workStart, workEnd
}: {
  selectedDays: string[];
  sessionDurationMinutes: string;
  workStart: string;
  workEnd: string;
}) => {
    const days = Object.fromEntries(
      WEEKDAYS.map(([key]) => [
        key,
        selectedDays.includes(key)
          ? { enabled: true, periods: [{ start: workStart, end: workEnd }], intervals: [] }
          : { enabled: false, periods: [], intervals: [] },
      ]),
    );
    const duration = Number(sessionDurationMinutes) || 50;
    return {
      active: true,
      stepMinutes: duration,
      defaultSessionDurationMinutes: duration,
      minLeadMinutes: 120,
      maxSlotsPerDay: 8,
      sessionBufferMinutes: 0,
      days,
      exceptions: [],
    };
};
