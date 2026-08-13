import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildTissPreGuideEligibilityContexts,
  chunkTissPreGuideScopeIds,
  consumeTissAuthorizationBalance,
  tissPreGuideContextNeedsBatchResolution
} from '../src/services/tissPreGuideBatchContext';
import { evaluateTissPreGuideEligibility } from '../src/services/tissPreGuideEngine';

const organizationId = '10000000-0000-4000-8000-000000000001';
const payerId = '20000000-0000-4000-8000-000000000001';
const patientId = '30000000-0000-4000-8000-000000000001';
const appointment = (index: number, extra: Record<string, any> = {}) => ({
  id: `40000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  organization_id: organizationId,
  clinic_id: organizationId,
  patient_id: patientId,
  service_type: 'Psicologia',
  scheduled_at: `2026-08-${String(Math.min(index, 28)).padStart(2, '0')}T14:00:00.000Z`,
  ...extra
});

const appointments = Array.from({ length: 40 }, (_, index) => appointment(index + 1));
const contexts = buildTissPreGuideEligibilityContexts({
  appointments,
  contextsByAppointment: new Map(),
  financialPlans: [{
    patient_id: patientId,
    service_type: 'Psicologia',
    billing_mode: 'INSURANCE',
    payer_id: payerId,
    payer_name_snapshot: 'Vivest',
    status: 'ACTIVE'
  }],
  patients: [{ id: patientId, insurance_type: 'Convênio', insurance_name: 'Vivest' }],
  payers: [{ id: payerId, name: 'Vivest', status: 'ACTIVE' }]
});

assert.equal(contexts.size, appointments.length, 'uma carga em lote deve resolver todo o período em memória');
for (const row of appointments) {
  const resolved = contexts.get(row.id);
  assert.equal(resolved?.payer_id, payerId);
  assert.equal(resolved?.payer_type, 'INSURANCE');
  assert.equal(evaluateTissPreGuideEligibility({ appointment: row, billingContext: resolved }).eligible, true);
}

const privateAppointment = appointment(90, { payer_type: 'PRIVATE' });
assert.equal(tissPreGuideContextNeedsBatchResolution(privateAppointment, {}), false);
const privateContext = buildTissPreGuideEligibilityContexts({
  appointments: [privateAppointment],
  contextsByAppointment: new Map(),
  financialPlans: [{
    patient_id: patientId,
    service_type: 'Psicologia',
    billing_mode: 'INSURANCE',
    payer_id: payerId,
    status: 'ACTIVE'
  }],
  patients: [],
  payers: [{ id: payerId, name: 'Vivest', status: 'ACTIVE' }]
}).get(privateAppointment.id);
assert.equal(privateContext?.payer_id, undefined, 'contexto particular explícito não pode ser convertido em convênio');

const persistedAppointment = appointment(91);
const persistedContext = {
  appointment_id: persistedAppointment.id,
  payer_type: 'INSURANCE',
  payer_id: payerId,
  payer_name_snapshot: 'Vivest',
  guide_number: 'GUIA-1'
};
const preserved = buildTissPreGuideEligibilityContexts({
  appointments: [persistedAppointment],
  contextsByAppointment: new Map([[persistedAppointment.id, persistedContext]]),
  financialPlans: [],
  patients: [],
  payers: []
}).get(persistedAppointment.id);
assert.equal(preserved?.guide_number, persistedContext.guide_number);
assert.equal(preserved?.payer_id, persistedContext.payer_id);
assert.equal(persistedContext.payer_name_snapshot, 'Vivest', 'snapshot persistido não pode ser mutado');

const ambiguousAppointment = appointment(92, { payer_type: 'INSURANCE', payer_name_snapshot: 'Vivest' });
const ambiguous = buildTissPreGuideEligibilityContexts({
  appointments: [ambiguousAppointment],
  contextsByAppointment: new Map(),
  financialPlans: [],
  patients: [],
  payers: [
    { id: payerId, name: 'Vivest', status: 'ACTIVE' },
    { id: '20000000-0000-4000-8000-000000000002', name: 'VIVEST', status: 'ACTIVE' }
  ]
}).get(ambiguousAppointment.id);
assert.equal(ambiguous?.payer_id, null, 'nome ambíguo não pode escolher tenant/pagador silenciosamente');
assert.equal(evaluateTissPreGuideEligibility({ appointment: ambiguousAppointment, billingContext: ambiguous }).eligible, false);

const ids = Array.from({ length: 301 }, (_, index) => `50000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
assert.deepEqual(chunkTissPreGuideScopeIds(ids).map((chunk) => chunk.length), [150, 150, 1]);

const authorizationBalance = {
  confirmed: true,
  preGuideCount: 0,
  officialPreGuideCount: 0,
  committedAppointmentIds: new Set<string>(),
  reserved: 0,
  historicalOfficialCommitments: 0,
  futureReservations: 0,
  available: 1,
};
assert.equal(consumeTissAuthorizationBalance({
  balance: authorizationBalance,
  appointmentId: appointments[0].id,
  activePreGuide: true,
  officialPreGuide: false,
  historical: false,
}), true);
assert.equal(authorizationBalance.available, 0);
assert.equal(authorizationBalance.futureReservations, 1);
assert.equal(consumeTissAuthorizationBalance({
  balance: authorizationBalance,
  appointmentId: appointments[1].id,
  activePreGuide: true,
  officialPreGuide: false,
  historical: false,
}), false, 'a ultima unidade nao pode ser reservada por duas sessoes no mesmo lote');
assert.equal(authorizationBalance.reserved, 1);

const serverSource = fs.readFileSync('server.ts', 'utf8');
const economyMigration = fs.readFileSync('supabase/migrations/20260813150000_database_economy_indexes.sql', 'utf8');
assert.match(serverSource, /rpc\('get_patient_financial_plans_batch_v1'/,
  'planos ativos precisam ser limitados por paciente no banco');
assert.match(economyMigration, /row_number\(\) over \([\s\S]*partition by plan\.patient_id/,
  'um paciente com muitos planos nao pode ocultar o plano de outro paciente');
const coverageRoute = serverSource.slice(
  serverSource.indexOf("app.get('/api/tiss/pre-guides/coverage'"),
  serverSource.indexOf("app.post('/api/tiss/pre-guides/revalidate-period'")
);
assert.match(coverageRoute, /resolveTissPreGuideEligibilityContextsInBatch\(/);
assert.doesNotMatch(coverageRoute, /for \(const appointment[\s\S]*await resolveEffectiveTissPreGuideBillingContext/);

const revalidationRoute = serverSource.slice(
  serverSource.indexOf("app.post('/api/tiss/pre-guides/revalidate-period'"),
  serverSource.indexOf("app.get('/api/payers'", serverSource.indexOf("app.post('/api/tiss/pre-guides/revalidate-period'"))
);
assert.match(revalidationRoute, /resolveTissPreGuideEligibilityContextsInBatch\(/);
assert.match(revalidationRoute, /prefetchedBillingContext: contextsByAppointment\.get\(appointmentId\)/);
assert.match(revalidationRoute, /patientAccessPrevalidated: true/);
assert.match(revalidationRoute, /preloadAppointmentTissBillingBatchContext\(/,
  'autorizaÃ§Ãµes e referÃªncias TISS devem ser carregadas uma vez antes do loop');
assert.match(revalidationRoute, /tissBillingContext: tissBillingBatchContext/,
  'cada item deve reutilizar o contexto TISS prÃ©-carregado');
assert.match(serverSource, /function registerTissPreGuideCommitmentInBatchContext/,
  'o saldo pre-carregado precisa avancar apos cada pre-guia persistida');
assert.match(revalidationRoute, /const revalidationConcurrency = tissBillingBatchContext\s*\? 1/,
  'consumidores do mesmo snapshot de autorizacao precisam ser serializados');
assert.match(revalidationRoute, /registerTissPreGuideCommitmentInBatchContext\(tissBillingBatchContext, preGuide\)/);
assert.ok(
  revalidationRoute.indexOf('preloadAppointmentTissBillingBatchContext(') <
    revalidationRoute.indexOf('const processEligibleAppointment = async'),
  'o preload precisa ocorrer antes do processamento por atendimento',
);

console.log('tissPreGuideBatchEconomy tests passed');
