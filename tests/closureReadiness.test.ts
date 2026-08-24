import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateAppointmentClosureReadiness } from '../src/services/closureReadinessEngine';

// Regression coverage: appointment attendance state remains independent from billing context.

const UUIDS = {
  organization: '11111111-1111-4111-8111-111111111111',
  appointment: '22222222-2222-4222-8222-222222222222',
  patient: '33333333-3333-4333-8333-333333333333',
  professional: '44444444-4444-4444-8444-444444444444'
};

const minimalRequirements = {
  requireSignature: false,
  requireReport: false,
  requireActualDuration: false,
  requireRoomWhenClinic: false,
  requireAuthorization: false,
  requireGuide: false,
  requireProfessionalRegistry: false,
  requirePatientDocument: false
};

const evaluate = (appointment: Record<string, any>, extra: Record<string, any> = {}) =>
  evaluateAppointmentClosureReadiness({
    organizationId: UUIDS.organization,
    appointmentId: UUIDS.appointment,
    patientId: UUIDS.patient,
    appointment: {
      id: UUIDS.appointment,
      patient_id: UUIDS.patient,
      therapist_id: UUIDS.professional,
      service_type: 'Terapia Ocupacional',
      room: 'Sala 1',
      location_type: 'clinica',
      scheduled_start_at: '2026-08-25T14:00:00.000Z',
      scheduled_end_at: '2026-08-25T14:50:00.000Z',
      ...appointment
    },
    patient: { id: UUIDS.patient },
    professional: { id: UUIDS.professional, name: 'Profissional Teste' },
    requirements: minimalRequirements,
    now: '2026-08-24T16:00:00.000Z',
    ...extra
  });

// Billability and attendance are independent axes. A confirmed no-charge session remains a valid scheduled session.
const confirmedNoCharge = evaluate({
  status: 'confirmed',
  financial_context_type: 'NO_CHARGE'
});
assert.equal(confirmedNoCharge.readinessStatus, 'NOT_BILLABLE');
assert.equal(confirmedNoCharge.phase, 'scheduled_pre_session');
assert.equal(confirmedNoCharge.phaseSummary.title, 'Preparação do atendimento');
assert.doesNotMatch(confirmedNoCharge.phaseSummary.message, /cancelad/i);
const noChargeBillingCheck = confirmedNoCharge.checklist.find((item) => item.key === 'status_billable');
assert.equal(noChargeBillingCheck?.status, 'NOT_APPLICABLE');
assert.equal(noChargeBillingCheck?.required, false);
assert.match(noChargeBillingCheck?.message || '', /sem faturamento/i);

// True cancellation/no-show remains a cancelled attendance state even when there is no charge.
const cancelledNoCharge = evaluate({
  status: 'cancelled',
  financial_context_type: 'NO_CHARGE'
});
assert.equal(cancelledNoCharge.phase, 'cancelled');
assert.equal(cancelledNoCharge.phaseSummary.title, 'Sessão cancelada');

// A completed non-insurance/non-billable session closes clinically without pretending it is cancelled or TISS-ready.
const completedNoCharge = evaluate({
  status: 'completed',
  financial_context_type: 'NO_CHARGE',
  actual_start_at: '2026-08-25T14:00:00.000Z',
  actual_end_at: '2026-08-25T14:50:00.000Z',
  has_session_record: true
});
assert.equal(completedNoCharge.readinessStatus, 'NOT_BILLABLE');
assert.equal(completedNoCharge.phase, 'closed_ready_for_prefacturing');
assert.equal(completedNoCharge.phaseSummary.title, 'Fechamento concluído');
assert.match(completedNoCharge.phaseSummary.message, /não segue para Pré-guia TISS/i);

// Manual non-billable classification must not mutate attendance semantics and must participate in the cache/context hash.
const normalScheduled = evaluate({ status: 'confirmed', financial_context_type: 'INSURANCE' });
const manuallyNonBillable = evaluate(
  { status: 'confirmed', financial_context_type: 'INSURANCE' },
  { manualNotBillable: true }
);
assert.equal(manuallyNonBillable.phase, 'scheduled_pre_session');
assert.equal(manuallyNonBillable.readinessStatus, 'NOT_BILLABLE');
assert.notEqual(manuallyNonBillable.contextHash, normalScheduled.contextHash);

// UI fallback copy follows the same split and must not label non-insurance closure as TISS/cancelled.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const calendar = fs.readFileSync(path.join(currentDir, '../src/components/Calendar.tsx'), 'utf8');
assert.match(calendar, /closed_ready_for_prefacturing:\s*\{\s*title:\s*'Fechamento concluído'/);
assert.doesNotMatch(calendar, /closed_ready_for_prefacturing:\s*\{\s*title:\s*'Faturamento TISS'/);

console.log('closureReadiness: ok');
