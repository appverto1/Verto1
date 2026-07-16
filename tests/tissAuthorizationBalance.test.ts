import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPatientTissAuthorizationQuantitySummary,
  hasConfirmedPatientTissAuthorizationBalance,
} from '../src/utils/patientTissAuthorizationView';
import { resolveTissAuthorizationBalance } from '../src/utils/tissAuthorizationBalance';

test('saldo central deduplica contexto, pre-guia e lote da mesma consulta', () => {
  const balance = resolveTissAuthorizationBalance({
    authorizationId: 'auth-1',
    authorizedQuantity: 12,
    consumedQuantity: 0,
    commitments: [
      {
        appointmentId: 'appointment-1',
        authorizationId: 'auth-1',
        futureReservation: true,
      },
      {
        appointmentId: 'appointment-1',
        authorizationId: 'auth-1',
        futureReservation: true,
      },
      {
        appointmentId: 'appointment-2',
        authorizationId: 'auth-1',
        futureReservation: true,
      },
    ],
  });

  assert.deepEqual(balance, {
    authorized: 12,
    consumed: 0,
    reserved: 2,
    available: 10,
    futureReservations: 2,
    historicalOfficialCommitments: 0,
    currentAppointmentReserved: false,
  });
});

test('saldo central reconcilia lote historico com consumo sem dupla contagem', () => {
  const balance = resolveTissAuthorizationBalance({
    authorizationId: 'auth-1',
    authorizedQuantity: 12,
    consumedQuantity: 1,
    commitments: [
      {
        appointmentId: 'appointment-consumed',
        authorizationId: 'auth-1',
        historicalOfficialCommitment: true,
      },
      {
        appointmentId: 'appointment-official-pending-consumption',
        authorizationId: 'auth-1',
        historicalOfficialCommitment: true,
      },
      {
        appointmentId: 'appointment-future',
        authorizationId: 'auth-1',
        futureReservation: true,
      },
    ],
  });

  assert.equal(balance.futureReservations, 1);
  assert.equal(balance.historicalOfficialCommitments, 2);
  assert.equal(balance.reserved, 2);
  assert.equal(balance.available, 9);
});

test('retry da mesma consulta e autorizacao continua sendo uma unica reserva', () => {
  const balance = resolveTissAuthorizationBalance({
    authorizationId: 'auth-1',
    authorizedQuantity: 1,
    consumedQuantity: 0,
    currentAppointmentId: 'appointment-1',
    commitments: Array.from({ length: 4 }, () => ({
      appointmentId: 'appointment-1',
      authorizationId: 'auth-1',
      futureReservation: true,
    })),
  });

  assert.equal(balance.reserved, 1);
  assert.equal(balance.available, 0);
  assert.equal(balance.currentAppointmentReserved, true);
});

test('frontend usa saldo explicito do servidor e bloqueia resumo divergente', () => {
  const authorization = {
    quantityAuthorized: 12,
    quantityConsumed: 0,
    quantityReserved: 2,
    quantityAvailable: 10,
    balanceConfirmed: true,
  };
  assert.deepEqual(getPatientTissAuthorizationQuantitySummary(authorization), {
    authorized: 12,
    consumed: 0,
    reserved: 2,
    available: 10,
    hasPackageLimit: true,
  });
  assert.equal(hasConfirmedPatientTissAuthorizationBalance(authorization), true);
  assert.equal(hasConfirmedPatientTissAuthorizationBalance({
    ...authorization,
    quantityAvailable: 12,
  }), false);
  assert.equal(hasConfirmedPatientTissAuthorizationBalance({
    quantityAuthorized: 12,
    quantityConsumed: 0,
    quantityReserved: 2,
    balanceConfirmed: true,
  }), false);
  assert.equal(getPatientTissAuthorizationQuantitySummary({
    ...authorization,
    balanceConfirmed: false,
  }).available, null);
});
