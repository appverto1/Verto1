export type TissAuthorizationCommitment = {
  appointmentId: string;
  authorizationId: string;
  futureReservation?: boolean;
  historicalOfficialCommitment?: boolean;
};

export type TissAuthorizationBalance = {
  authorized: number;
  consumed: number;
  reserved: number;
  available: number | null;
  futureReservations: number;
  historicalOfficialCommitments: number;
  currentAppointmentReserved: boolean;
};

const nonNegativeInteger = (value: unknown) =>
  Math.max(0, Math.trunc(Number(value) || 0));

export const resolveTissAuthorizationBalance = (params: {
  authorizationId: string;
  authorizedQuantity: unknown;
  consumedQuantity: unknown;
  commitments: TissAuthorizationCommitment[];
  currentAppointmentId?: string | null;
}): TissAuthorizationBalance => {
  const authorizationId = String(params.authorizationId || '').trim();
  const currentAppointmentId = String(params.currentAppointmentId || '').trim();
  const uniqueCommitments = new Map<string, {
    appointmentId: string;
    futureReservation: boolean;
    historicalOfficialCommitment: boolean;
  }>();

  for (const commitment of Array.isArray(params.commitments) ? params.commitments : []) {
    const appointmentId = String(commitment?.appointmentId || '').trim();
    const commitmentAuthorizationId = String(commitment?.authorizationId || '').trim();
    if (!appointmentId || !authorizationId || commitmentAuthorizationId !== authorizationId) continue;
    const key = `${appointmentId}:${authorizationId}`;
    const current = uniqueCommitments.get(key);
    uniqueCommitments.set(key, {
      appointmentId,
      futureReservation: Boolean(current?.futureReservation || commitment?.futureReservation),
      historicalOfficialCommitment: Boolean(
        current?.historicalOfficialCommitment || commitment?.historicalOfficialCommitment,
      ),
    });
  }

  let futureReservations = 0;
  let historicalOfficialCommitments = 0;
  let currentAppointmentReserved = false;
  for (const commitment of uniqueCommitments.values()) {
    if (commitment.futureReservation) {
      futureReservations += 1;
      if (currentAppointmentId && commitment.appointmentId === currentAppointmentId) {
        currentAppointmentReserved = true;
      }
      continue;
    }
    if (commitment.historicalOfficialCommitment) {
      historicalOfficialCommitments += 1;
      if (currentAppointmentId && commitment.appointmentId === currentAppointmentId) {
        currentAppointmentReserved = true;
      }
    }
  }

  const authorized = nonNegativeInteger(params.authorizedQuantity);
  const consumed = nonNegativeInteger(params.consumedQuantity);
  const reserved = futureReservations + Math.max(0, historicalOfficialCommitments - consumed);
  const available = authorized > 0
    ? Math.max(0, authorized - consumed - reserved)
    : null;

  return {
    authorized,
    consumed,
    reserved,
    available,
    futureReservations,
    historicalOfficialCommitments,
    currentAppointmentReserved,
  };
};
