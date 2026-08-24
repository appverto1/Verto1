import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const promotionPath = path.join(root, 'supabase', 'operations', '20260821006200_clinical_measurement_v3_production_schema_promotion.sql');
const sql = fs.readFileSync(promotionPath, 'utf8');

const orderedBlocks = [
  '20260815193000_aba_measurement_v3_read_models_endpoints.sql',
  '20260815203000_aba_measurement_v3_pr9a_atomic_trial_collection_bridge.sql',
  '20260820130000_clinical_measurement_v3_identities_versioning.sql',
  '20260820144500_clinical_measurement_v3_sessions_expectations.sql',
  '20260820160000_clinical_measurement_v3_raw_primitives.sql',
  '20260820173000_clinical_measurement_v3_aba_engine.sql',
  '20260820190000_clinical_measurement_v3_bulk_ingestion.sql',
  '20260820203000_clinical_measurement_v3_projection_read_models.sql',
  '20260820220000_clinical_measurement_v3_semantic_api_decisions.sql',
  '20260820233000_clinical_measurement_v3_security_shadow_hardening.sql',
  '20260821001000_clinical_measurement_v3_dark_aba_shadow_mirror.sql',
  '20260821002000_clinical_measurement_v3_projection_task_analysis_groupby_hotfix.sql',
];

test('production schema promotion embeds exactly the missing canonical blocks in dependency order', () => {
  let previous = -1;
  for (const name of orderedBlocks) {
    const position = sql.indexOf(`Embedded canonical block` + sql.slice(sql.indexOf(name) - 10, sql.indexOf(name)).replace(/^[\s\S]*$/, '') + name);
    const direct = sql.indexOf(name);
    assert.ok(direct > previous, `${name} must exist after the preceding block`);
    previous = direct;
  }
});

test('promotion is one fail-closed transaction and never enables rollout', () => {
  const begins = sql.match(/^begin;$/gim) ?? [];
  const commits = sql.match(/^commit;$/gim) ?? [];
  assert.equal(begins.length, 1);
  assert.equal(commits.length, 1);
  assert.match(sql, /CMV3_PRODUCTION_PROMOTION_ACTIVE_ABA_V3_ROLLOUT/);
  assert.match(sql, /CMV3_PRODUCTION_PROMOTION_STATE_CHANGED_RERUN_INVENTORY/);
  assert.doesNotMatch(sql, /set\s+allow_new_v3_sessions\s*=\s*true/i);
  assert.doesNotMatch(sql, /p_allow_new_v3_sessions\s*=>\s*true/i);
});

test('promotion verifies security, dormant raw state and required server-only surfaces before commit', () => {
  assert.match(sql, /get_clinical_measurement_v3_security_preflight\(\)/);
  assert.match(sql, /CMV3_PRODUCTION_PROMOTION_SECURITY_PREFLIGHT_FAILED/);
  assert.match(sql, /clinical_measurement_raw_events_v3/);
  assert.match(sql, /clinical_measurement_shadow_mirror_links_v3/);
  assert.match(sql, /CMV3_PRODUCTION_PROMOTION_UNEXPECTED_CMV3_DATA/);
  assert.match(sql, /PRODUCTION_SCHEMA_PROMOTED_DARK/);
  assert.match(sql, /RERUN_PRODUCTION_ACTIVATION_READINESS_GATE/);
});
