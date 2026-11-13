import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261113110000_ia01_privileged_rpc_execute_lockdown.sql'),
  'utf8',
);

const signatures = [
  ['aba_touch_patient_summary', 'text, text, uuid, integer, integer, integer, timestamptz, text, timestamptz'],
  ['aba_create_maintenance_schedules_for_mastery', 'text, text, uuid, text, text, timestamptz, jsonb'],
  ['claim_active_patient_billing_sync_jobs', 'uuid, integer'],
];

function normalize(input) {
  return input.replace(/\\s+/g, '').toLowerCase();
}

test('IA-01 denies both public database roles while preserving the service worker', () => {
  for (const [name, signature] of signatures) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(
      `(revoke|grant)\\s+execute\\s+on\\s+function\\s+public\\.${escapedName}\\s*\\(([^)]*)\\)\\s*(from|to)\\s*([^;]+);`,
      'gi',
    );
    const matches = [...migration.matchAll(expression)];
    assert.equal(matches.length, 2, `Expected exactly one revoke and one grant for ${name}`);

    const revoke = matches.find((match) => match[1].toLowerCase() === 'revoke');
    const grant = matches.find((match) => match[1].toLowerCase() === 'grant');
    assert.ok(revoke, `Missing revoke for ${name}`);
    assert.ok(grant, `Missing service-role grant for ${name}`);

    assert.equal(normalize(revoke[2]), normalize(signature));
    assert.equal(normalize(grant[2]), normalize(signature));
    assert.equal(normalize(revoke[3]), 'from');
    assert.equal(normalize(revoke[4]), 'public,anon,authenticated');
    assert.equal(normalize(grant[3]), 'to');
    assert.equal(normalize(grant[4]), 'service_role');
  }
});

test('IA-01 includes preflight and post-apply privilege checks', () => {
  assert.match(migration, /ia01_preflight/);
  assert.match(migration, /ia01_verify/);
  assert.match(migration, /to_regprocedure/);
  assert.match(migration, /has_function_privilege\\('anon'/);
  assert.match(migration, /has_function_privilege\\('authenticated'/);
  assert.match(migration, /has_function_privilege\\('service_role'/);
});

test('IA-01 does not rewrite clinical, billing, trigger, or RLS logic', () => {
  const sql = migration.replace(/--[^\\n]*/g, '').toLowerCase();
  assert.doesNotMatch(sql, /(?:create|alter|drop)\\s+(?:or replace\\s+)?function\\b/);
  assert.doesNotMatch(sql, /(?:create|alter|drop)\\s+trigger\\b/);
  assert.doesNotMatch(sql, /(?:insert|update|delete|truncate)\\s+/);
  assert.doesNotMatch(sql, /\\bpolicy\\b/);
});
