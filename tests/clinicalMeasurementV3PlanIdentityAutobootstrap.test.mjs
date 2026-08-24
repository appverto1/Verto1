import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20260821152000_clinical_measurement_v3_plan_identity_autobootstrap.sql';
const migration = readFileSync(migrationPath, 'utf8');
const lower = migration.toLowerCase();

// Marco 1 must connect both non-ABA identity families without touching graph/UI code.
assert.match(migration, /'THERAPEUTIC_OBJECTIVE'/);
assert.match(migration, /'PLAN_GOAL'/);
assert.match(migration, /clinical_measurement_v3_plan_goal_sources_v1/);
assert.match(migration, /sync_clinical_measurement_v3_therapeutic_objective_identity_v1/);
assert.match(migration, /sync_clinical_measurement_v3_plan_goal_identities_v1/);

// Stable PTS ids win over mutable titles; title hashing is only a legacy compatibility fallback.
assert.match(migration, /'pts:' \|\| btrim\(value ->> 'id'\)/i);
assert.match(migration, /'pts-legacy:' \|\| pg_catalog\.md5/i);
assert.match(migration, /'legacy:' \|\| pg_catalog\.md5/i);
assert.match(migration, /where not exists \(select 1 from pts_goals\)/i);

// Registration is set-based and idempotent, never a browser/server N+1 loop.
assert.match(migration, /on conflict \(organization_id, therapeutic_objective_id\)[\s\S]*where source_kind = 'THERAPEUTIC_OBJECTIVE'/i);
assert.match(migration, /on conflict \(organization_id, therapeutic_plan_id, source_goal_key\)[\s\S]*where source_kind = 'PLAN_GOAL'/i);
assert.match(migration, /cross join lateral public\.clinical_measurement_v3_plan_goal_sources_v1\(plan\) goal/i);
assert.doesNotMatch(lower, /\bloop\b|for\s+.+\s+in\s+select/);

// Identity lifecycle stays reversible while source plans/objectives remain reversible.
// No V3 ARCHIVE is synthesized from source COMPLETED/ARCHIVED/CANCELLED states.
assert.match(migration, /when upper\(coalesce\(new\.status, ''\)\) = 'ACTIVE' then 'ACTIVE' else 'PAUSED'/i);
assert.match(migration, /when lower\(coalesce\(value ->> 'status', ''\)\) in \('paused', 'cancelled'\) then 'PAUSED'/i);
assert.match(migration, /removed goals are retained as immutable identities and merely paused/i);

// Cross-tenant rebinding is explicitly blocked before privileged metadata writes.
assert.match(migration, /CMV3_THERAPEUTIC_OBJECTIVE_IDENTITY_SCOPE_CONFLICT/);
assert.match(migration, /CMV3_PLAN_GOAL_IDENTITY_SCOPE_CONFLICT/);
assert.match(migration, /pg_advisory_xact_lock/i);

// Browser roles cannot invoke privileged synchronization functions directly.
assert.match(migration, /revoke all on function public\.sync_clinical_measurement_v3_therapeutic_objective_identity_v1\(\)[\s\S]*from public, anon, authenticated, service_role/i);
assert.match(migration, /revoke all on function public\.sync_clinical_measurement_v3_plan_goal_identities_v1\(\)[\s\S]*from public, anon, authenticated, service_role/i);
assert.match(migration, /CMV3_PLAN_IDENTITY_BROWSER_EXECUTE_OPEN/);

// Absolute preservation: source clinical records and evidence stores are read-only here.
for (const sourceTable of [
  'patient_therapeutic_plans',
  'patient_therapeutic_objectives',
  'clinical_observations',
  'aba_session_metric_snapshots',
  'aba_trials',
  'aba_trials_v3',
]) {
  assert.doesNotMatch(
    lower,
    new RegExp(`insert\\s+into\\s+public\\.${sourceTable}(?:\\s|\\()`),
    `migration must not insert into ${sourceTable}`,
  );
  assert.doesNotMatch(
    lower,
    new RegExp(`update\\s+public\\.${sourceTable}(?:\\s|\\n)`),
    `migration must not update ${sourceTable}`,
  );
  assert.doesNotMatch(
    lower,
    new RegExp(`delete\\s+from\\s+public\\.${sourceTable}(?:\\s|\\n)`),
    `migration must not delete from ${sourceTable}`,
  );
}

// This milestone creates identities only; evidence/read-model rollout remains a later step.
assert.doesNotMatch(lower, /insert\s+into\s+public\.clinical_measurement_sessions_v3/);
assert.doesNotMatch(lower, /insert\s+into\s+public\.clinical_measurement_raw_/);
assert.doesNotMatch(lower, /insert\s+into\s+public\.clinical_observations/);
assert.match(migration, /'next', 'GENERIC_V3_PLAN_WRITER'/);

console.log('Clinical Measurement V3 plan/objective identity autobootstrap contracts: OK');
