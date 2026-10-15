import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createPatientFinancialPlan,
  serializePatientFinancialPlanForPayload,
  serializePatientFinancialPlanForGenericFinancialPayload,
} from '../src/utils/patientFinancialPlan';

const plan = createPatientFinancialPlan({
  serviceType: 'SPEECH_THERAPY', billingMode: 'PRIVATE', amount: '150,00', groupAmount: '80,00'
});
assert.equal(plan.amountCents, 15000);
assert.equal(plan.groupAmountCents, 8000);
assert.equal(plan.groupAmount, '80,00');
for (const serialize of [serializePatientFinancialPlanForPayload, serializePatientFinancialPlanForGenericFinancialPayload]) {
  const payload = serialize(plan);
  assert.equal(payload.amountCents, 15000);
  assert.equal(payload.groupAmountCents, 8000);
}
const changed = createPatientFinancialPlan({ ...plan, groupAmount: '95,00' });
assert.equal(changed.amountCents, 15000, 'alteração coletiva não modifica preço individual');
assert.equal(changed.groupAmountCents, 9500);
assert.equal(createPatientFinancialPlan({ ...plan, groupAmount: '', groupAmountCents: 8000 }).groupAmountCents, 0, 'campo apagado desabilita grupo');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
assert.match(coordinator, /label="Sessão em grupo \(por paciente\)"/);
assert.match(coordinator, /handleFinancialPlanChange\(plan\.id, "groupAmount", event\.target\.value\)/);
assert.match(coordinator, /value=\{plan\.groupAmount\}/);
assert.match(coordinator, /serializePatientFinancialPlanForGenericFinancialPayload/);
assert.match(coordinator, /const financialPlans = canManagePatientFinancialPlan/);
const reconciliation = fs.readFileSync('supabase/migrations/20261015162000_group_session_specialty_rates.sql','utf8');
assert.match(reconciliation, /group_amount_cents integer not null default 0/);
assert.match(reconciliation, /plan\.group_amount_cents is not distinct from v_group_amount_cents/);
assert.match(reconciliation, /v_group_amount_cents := coalesce\(v_existing\.group_amount_cents, 0\)/);
assert.match(reconciliation, /pg_advisory_xact_lock/);
const authority = fs.readFileSync('supabase/migrations/20261015171000_group_session_private_rate_authority.sql','utf8');
assert.match(authority, /security invoker/);
assert.match(authority, /GROUP_RATE_PLAN_AMBIGUOUS/);
assert.match(authority, /GROUP_RATE_NOT_CONFIGURED/);
assert.match(authority, /and p\.clinic_id=p_organization_id/);
assert.match(authority, /grant execute on function public\.resolve_group_patient_private_rate_v1[\s\S]*to service_role/);
assert.doesNotMatch(authority, /grant execute[\s\S]*to authenticated/);
console.log('groupFinancialPlanFormAndAuthority.test.ts: ok');
