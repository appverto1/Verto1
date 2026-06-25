export type AppointmentPrimaryAction = {
  kind: 'start' | 'continue' | 'closure' | 'none';
  label: string;
};

function normalizedStatus(appointment: any): string {
  return String(appointment?.status || appointment?.appointment_status || '')
    .trim()
    .toLowerCase();
}

export function getAppointmentPrimaryAction(
  appointment: any,
  closurePhase?: string | null
): AppointmentPrimaryAction {
  const status = normalizedStatus(appointment);
  const cancelled = closurePhase === 'cancelled' || [
    'canceled',
    'cancelled',
    'cancelada',
    'cancelado',
    'no_show',
    'missed',
    'falta',
    'faltou'
  ].includes(status);
  if (cancelled) return { kind: 'none', label: '' };

  const concluded = Boolean(
    appointment?.has_session_record ||
    appointment?.hasSessionRecord ||
    appointment?.actual_end_at ||
    appointment?.actualEndAt ||
    ['completed', 'concluida', 'concluída', 'concluido', 'concluído'].includes(status) ||
    [
      'completed_pending_closure',
      'closed_ready_for_prefacturing',
      'prefacturing_ready',
      'prefacturing_blocked'
    ].includes(String(closurePhase || ''))
  );
  if (concluded) return { kind: 'closure', label: 'Ver fechamento' };

  const inSession = closurePhase === 'in_session' || Boolean(
    appointment?.actual_start_at ||
    appointment?.actualStartAt ||
    ['in_progress', 'active'].includes(status)
  );
  if (inSession) return { kind: 'continue', label: 'Continuar sessão' };

  return { kind: 'start', label: 'Iniciar sessão' };
}
