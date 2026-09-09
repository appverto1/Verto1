import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const server = read('server.ts');
const monthlyBase = read('supabase/migrations/20260905101500_monthly_session_patient_billing.sql');
const fix = read('supabase/migrations/20260905123000_monthly_session_payment_uuid_aggregate_fix.sql');
const completion = read('supabase/migrations/20260807010000_session_completion_and_no_show_policy.sql');
const behavior = read('supabase/migrations/20260815163000_aba_measurement_v3_behavior_engine.sql');
const v3 = read('supabase/migrations/20260815173000_aba_measurement_v3_probes_session_fsm.sql');

// Exact staging P0 root cause is documented by the applied Etapa 2 function.
assert.match(monthlyBase, /min\(item\.appointment_id\)/);

// The patch replaces the function semantically: aggregate amount/count separately and
// choose the representative compatibility appointment by clinical chronology.
assert.match(fix, /create or replace function public\.refresh_monthly_session_payment_v1/);
assert.doesNotMatch(fix, /min\(item\.appointment_id\)/);
assert.match(fix, /select item\.appointment_id[\s\S]{0,500}order by item\.appointment_scheduled_at asc nulls last/);
assert.match(fix, /item\.created_at asc nulls last/);
assert.match(fix, /item\.appointment_id::text asc/);
assert.match(fix, /MONTHLY_SESSION_UUID_FIX_PREFLIGHT_APPOINTMENT_ID_DRIFT/);
assert.match(fix, /revoke all on function public\.refresh_monthly_session_payment_v1\(text\)/);
assert.match(fix, /grant execute on function public\.refresh_monthly_session_payment_v1\(text\) to service_role/);

// ABA complete remains the atomic/idempotent canonical completion route.
const routeAt = server.indexOf("app.post('/api/aba/sessions/:sessionId/complete'");
const routeEnd = server.indexOf("app.", routeAt + 60);
const route = server.slice(routeAt, routeEnd > routeAt ? routeEnd : routeAt + 14000);
assert.match(route, /idempotency/i);
assert.match(route, /complete_aba_session_v3/);
assert.match(route, /complete_aba_session_atomic_v1/);

// A ~70h session is not truncated by the DB completion contract: duration is the full
// ended-started interval, while future/end-before-start are validated.
assert.match(completion, /v_duration_seconds := greatest\(0, floor\(extract\(epoch from \(v_ended_at - v_started_at\)\)\)::integer\)/);
assert.match(completion, /SESSION_COMPLETION_END_TIME_INVALID/);
assert.match(completion, /SESSION_COMPLETION_END_BEFORE_START/);
assert.match(completion, /aba_session_completion_operations/);
assert.match(completion, /SESSION_COMPLETION_IDEMPOTENCY_CONFLICT/);

// Open V3 timers are finalized safely instead of blocking completion or deleting data.
assert.match(behavior, /finalize_aba_behavior_timers_v3/);
assert.match(behavior, /close_reason = 'SESSION_FINALIZATION'/);
assert.match(behavior, /is_censored = true/);
assert.match(behavior, /end_reason = 'SESSION_FINALIZATION'/);
assert.match(behavior, /'requires_review', true/);
assert.match(v3, /public\.finalize_aba_behavior_timers_v3\(p_session_id, v_effective_end\)/);

// Completing the linked appointment feeds the already-installed monthly engine once.
// Database uniqueness/idempotency is owned by the Etapa 2 trigger/ledger, not the ABA route.
assert.match(monthlyBase, /sync_monthly_session_billing_for_appointment_v1/);
assert.match(monthlyBase, /create trigger appointments_sync_monthly_session_finance[\s\S]{0,420}on public\.appointments[\s\S]{0,200}sync_monthly_session_appointment_trigger_v1/i);
assert.match(monthlyBase, /sync_monthly_session_appointment_trigger_v1[\s\S]{0,1400}sync_monthly_session_billing_for_appointment_v1/i);
assert.match(monthlyBase, /billing_item_key/);
assert.match(monthlyBase, /unique[\s\S]{0,240}billing_item_key/i);

console.log('abaCompletionPostSmokeP0.regression.test.mjs: ok');
