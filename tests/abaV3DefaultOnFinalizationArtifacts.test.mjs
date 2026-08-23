import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath = new URL('../supabase/migrations/20260821006810_aba_v3_default_on_override_lifecycle.sql', import.meta.url);
const selectedAttestationPath = new URL('../supabase/verification/20260821006808_aba_v3_default_on_selected_session_attestation.sql', import.meta.url);
const retirementOperationPath = new URL('../supabase/operations/history/production-canary/20260821006811_aba_v3_retire_legacy_positive_canary_overrides.sql', import.meta.url);
const pureInheritAttestationPath = new URL('../supabase/verification/20260821006812_aba_v3_default_on_pure_inherit_ui_binding_attestation.sql', import.meta.url);
const pureInheritAttestationV2Path = new URL('../supabase/verification/20260823182500_aba_v3_default_on_pure_inherit_ui_binding_attestation_v2.sql', import.meta.url);
const inventoryPath = new URL('../SQL_INVENTORY.md', import.meta.url);

for (const path of [migrationPath, selectedAttestationPath, retirementOperationPath, pureInheritAttestationPath, pureInheritAttestationV2Path]) {
  assert.equal(fs.existsSync(path), true, `artefato V3 final ausente: ${path.pathname}`);
}

const migration = fs.readFileSync(migrationPath, 'utf8');
const selectedAttestation = fs.readFileSync(selectedAttestationPath, 'utf8');
const retirementOperation = fs.readFileSync(retirementOperationPath, 'utf8');
const pureInheritAttestation = fs.readFileSync(pureInheritAttestationPath, 'utf8');
const pureInheritAttestationV2 = fs.readFileSync(pureInheritAttestationV2Path, 'utf8');
const inventory = fs.readFileSync(inventoryPath, 'utf8');

assert.match(migration, /add column if not exists override_active boolean not null default true/i);
assert.match(migration, /create or replace function public\.clear_aba_measurement_rollout_override_v3/i);
assert.match(migration, /absence_or_inactive_override_means[\s\S]*INHERIT_DEFAULT_ON/i);
assert.match(migration, /explicit_false_means[\s\S]*KILL_SWITCH/i);
assert.match(migration, /revoke all on function public\.clear_aba_measurement_rollout_override_v3[\s\S]*from public, anon, authenticated/i);
assert.match(migration, /grant execute on function public\.clear_aba_measurement_rollout_override_v3[\s\S]*to service_role/i);

assert.match(selectedAttestation, /PASS_DEFAULT_ON_SELECTED_SESSION_END_TO_END/);
assert.match(selectedAttestation, /source_aba_v3_mutated',false/);
assert.match(selectedAttestation, /legacy_v2_mutated',false/);

assert.match(retirementOperation, /operational transition, NOT a schema migration/i);
assert.match(retirementOperation, /clear_aba_measurement_rollout_override_v3/);
assert.doesNotMatch(retirementOperation, /delete\s+from\s+public\.aba_measurement_rollout_states_v3/i);
assert.equal(
  fs.existsSync(new URL('../supabase/migrations/20260821006811_aba_v3_retire_legacy_positive_canary_overrides.sql', import.meta.url)),
  false,
  'a operação histórica 06811 não pode virar migration automática',
);

assert.match(pureInheritAttestation, /Safety: READ ONLY/i);
assert.match(pureInheritAttestation, /PASS_PURE_DEFAULT_ON_FRESH_SESSION_BINDING/);
assert.match(pureInheritAttestation, /ABA_V3_DEFAULT_ON_GLOBAL_PRODUCTION_FINAL/);
assert.match(pureInheritAttestation, /active_override_count <> 0/);
assert.match(pureInheritAttestation, /measurement_model_version <> 'V3'/);
assert.match(pureInheritAttestation, /binding_source <> 'SERVER_RESOLVER'/);
assert.match(pureInheritAttestation, /rollout_state_id is not null or f\.rollout_state_version is not null/);
assert.match(pureInheritAttestation, /v3_trial_count <> 0 or f\.legacy_v2_trial_count <> 0/);

assert.match(pureInheritAttestationV2, /left join public\.aba_session_target_measurement_bindings b/i);
assert.match(pureInheritAttestationV2, /BLOCKED_FRESH_SESSION_BINDING_MISSING/);
assert.match(pureInheritAttestationV2, /PASS_PURE_DEFAULT_ON_FRESH_SESSION_BINDING/);

for (const fileName of [
  '20260821006810_aba_v3_default_on_override_lifecycle.sql',
  '20260821006808_aba_v3_default_on_selected_session_attestation.sql',
  '20260821006811_aba_v3_retire_legacy_positive_canary_overrides.sql',
  '20260821006812_aba_v3_default_on_pure_inherit_ui_binding_attestation.sql',
  '20260823182500_aba_v3_default_on_pure_inherit_ui_binding_attestation_v2.sql',
]) {
  assert.match(inventory, new RegExp(fileName.replaceAll('.', '\\.')));
}

console.log('abaV3DefaultOnFinalizationArtifacts: PASS');
