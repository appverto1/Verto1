export const APPOINTMENT_CANCELLATION_REASONS = [
  'Paciente ou responsável solicitou cancelamento',
  'Profissional indisponível',
  'Paciente indisponível por motivo de saúde',
  'Imprevisto da clínica',
  'Conflito de horário',
  'Outro motivo',
] as const;

export function buildAppointmentCancellationNote(reason: string, details: string): string {
  const selected = String(reason || '').trim();
  if (!APPOINTMENT_CANCELLATION_REASONS.some((option) => option === selected)) return '';
  const extra = String(details || '').trim().slice(0, 900);
  if (selected === 'Outro motivo') return extra;
  return [selected, extra].filter(Boolean).join(' — ').slice(0, 1200);
}
