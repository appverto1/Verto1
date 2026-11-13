import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');
const original = read('supabase/migrations/20260826154500_specialty_session_pts_context_binding_v1.sql');
const migration = read('supabase/migrations/20261113130609_aba_v3_pts_collection_context_idempotency.sql');
const immutableGuardMigration = read('supabase/migrations/20260826143000_pts_document_lineage_events_v2.sql');
const server = read('server.ts');

const extractBinder = (sql) => {
  const start = sql.indexOf('create or replace function public.bind_patient_pts_collection_contexts_v1(');
  assert.ok(start >= 0, 'PTS collection context binder must be present');
  const end = sql.indexOf('$function$;', start);
  assert.ok(end > start, 'PTS collection context binder must be complete');
  return sql.slice(start, end + '$function$;'.length);
};

test('ABA V3 PTS binder retries must not update an immutable bound session', () => {
  const before = extractBinder(original);
  const after = extractBinder(migration);
  const unsafeConflict = /on conflict \(organization_id, source_session_id, plan_id\) do update\s+set specialty_plan_id = coalesce\(\s+public\.patient_pts_collection_contexts_v1\.specialty_plan_id,\s+excluded\.specialty_plan_id\s+\);/;
  assert.match(before, unsafeConflict, 'Regression fixture must exercise the original conflicting UPDATE');
  assert.equal(
    after,
    before.replace(unsafeConflict, 'on conflict (organization_id, source_session_id, plan_id) do nothing;'),
    'Only the conflicting update may change: retain all scope checks, server time anchor, frozen PTS version and return shape',
  );
  assert.match(after, /on conflict \(organization_id, source_session_id, plan_id\) do nothing;/);
  assert.doesNotMatch(after, /on conflict[\s\S]*do update/);
});

test('immutable PTS context trigger and existing authorization boundaries remain intact', () => {
  assert.match(immutableGuardMigration, /create trigger guard_patient_pts_collection_context_v1\s+before update or delete/);
  assert.match(immutableGuardMigration, /raise exception 'PTS_COLLECTION_CONTEXT_IMMUTABLE'/);
  assert.doesNotMatch(migration, /\b(?:drop|alter)\s+(?:trigger|table|policy)\b|\b(?:grant|revoke)\b/i);
  const route = server.slice(server.indexOf("'/api/aba/v3/sessions/:sessionId/collection-plan'"), server.indexOf("'/api/aba/v3/patients/:patientId/overview'"));
  assert.match(route, /requireClinicCapability\('aba\.trial\.record'\)/);
  assert.match(route, /checkPatientAccess/);
  assert.match(route, /resolveAbaSessionReadScope\(sessionId, req\.session\.user\)/);
  assert.match(route, /validateAbaSessionTargetPlanScope/);
});
