import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/20261015183500_group_financial_rate_atomic_update.sql','utf8');
const base=fs.readFileSync('supabase/migrations/20261015162000_group_session_specialty_rates.sql','utf8');
const route=fs.readFileSync('services/groupSessions/groupSessionFinancialRateRoutes.ts','utf8');
const registry=fs.readFileSync('services/clinicAppointmentPolicyRoutes.ts','utf8');

assert.match(base,/add column if not exists group_amount_cents integer not null default 0/i);
assert.match(base,/and plan\.group_amount_cents is not distinct from v_group_amount_cents/);
assert.match(base,/group_amount_cents = v_group_amount_cents/);
assert.match(base,/v_group_amount_cents := coalesce\(v_existing\.group_amount_cents, 0\)/);

assert.match(sql,/create or replace function public\.update_patient_specialty_group_rate_v1/);
assert.match(sql,/security invoker/);
assert.match(sql,/pg_advisory_xact_lock/);
assert.match(sql,/v_requested\.billing_mode<>'PRIVATE'/);
assert.match(sql,/GROUP_RATE_STALE_PLAN/);
assert.match(sql,/reconcile_patient_financial_plans_v2\(/);
assert.match(sql,/p_organization_id,p_patient_id,p_actor_id,v_plans,true/);
assert.match(sql,/and plan\.billing_mode<>'INSURANCE'/);
assert.match(sql,/GROUP_RATE_PERSISTENCE_VERIFY_FAILED/);
assert.match(sql,/revoke all on function public\.update_patient_specialty_group_rate_v1/);
assert.match(sql,/grant execute on function public\.update_patient_specialty_group_rate_v1[^;]+to service_role/s);
assert.doesNotMatch(sql,/\btruncate\s+|\bdelete\s+from\s+public\.(?:patient_financial_plans|payments|appointments)/i);
assert.match(route,/requireClinicCapability\('patient\.demographics\.edit'\)/);
assert.match(route,/p_organization_id:clinicId/);
assert.match(route,/p_actor_id:actorId/);
assert.match(registry,/registerGroupSessionFinancialRateRoutes\(app,/);
console.log('groupSessionFinanceAtomicSql.test.ts: ok');
