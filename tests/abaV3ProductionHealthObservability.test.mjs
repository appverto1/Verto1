import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const migration = read('supabase/migrations/20260823213000_aba_v3_production_health_snapshot.sql');
const verification = read('supabase/verification/20260823213100_aba_v3_production_health_snapshot_checks.sql');
const server = read('server.ts');
const controlCenter = read('src/components/AbaV3RolloutControlCenter.tsx');
const runbook = read('docs/operations/ABA_V3_PRODUCTION_RUNBOOK.md');
const pilotRunbook = read('docs/operations/ABA_V3_PILOT_RUNBOOK.md');
const cmv3Readme = read('docs/architecture/clinical-measurement-v3/README.md');

assert.match(migration, /get_aba_v3_production_health_v1\s*\(/i);
assert.match(migration, /security definer/i);
assert.match(migration, /revoke all on function public\.get_aba_v3_production_health_v1\(uuid,integer\) from public, anon, authenticated/i);
assert.match(migration, /grant execute on function public\.get_aba_v3_production_health_v1\(uuid,integer\) to service_role/i);
assert.match(migration, /mixed_authority_session_targets_recent/i);
assert.match(migration, /aba_sync_quarantine_v3/i);
assert.match(migration, /clinical_measurement_projection_queue_v3/i);
assert.match(migration, /active_positive_overrides/i);
assert.match(migration, /active_kill_switches/i);
assert.match(migration, /'writes', false/i);
assert.doesNotMatch(migration, /\b(insert|update|delete)\s+(into|public\.)/i, 'health snapshot must stay read-only');

assert.match(verification, /PASS_ABA_V3_PRODUCTION_OBSERVABILITY/);
assert.match(verification, /browser_execute_revoked/);
assert.match(verification, /live_health/);

assert.match(server, /\/api\/aba\/v3\/admin\/production-health/);
assert.match(server, /requireAbaV3PreflightFeature/);
assert.match(server, /checkPlatformAdmin/);
assert.match(server, /get_aba_v3_production_health_v1/);
assert.match(server, /Cache-Control', 'private, no-store/);

assert.match(controlCenter, /Saúde da V3 em produção/);
assert.match(controlCenter, /Autoridade mista/);
assert.match(controlCenter, /Overrides positivos ativos/);
assert.match(controlCenter, /Kill switches ativos/);
assert.match(controlCenter, /Não exige rotina diária|não exige rotina diária/i);

assert.match(runbook, /V3_DEFAULT_ON/);
assert.match(runbook, /DEFAULT_INHERIT/);
assert.match(runbook, /Não existe frequência obrigatória/i);
assert.match(runbook, /BLOCKED_ABA_V3_MIXED_AUTHORITY/);
assert.match(pilotRunbook, /Documento histórico/);
assert.match(cmv3Readme, /Accepted production baseline/);

for (const adr of [
  '0001-foundations.md',
  '0002-bitemporal-clinical-time.md',
  '0003-semantic-measurement-families.md',
  '0004-projections-read-models.md',
  '0005-clinical-decisions-evidence.md',
  '0006-offline-idempotent-ingestion.md',
  '0007-reliability-ioa.md',
  '0008-semantic-api-contract.md',
]) {
  const body = read(`docs/architecture/clinical-measurement-v3/adr/${adr}`);
  assert.match(body, /\*\*Status:\*\* Accepted/);
  assert.doesNotMatch(body, /Implementation status:\*\* Not started/);
}
assert.match(read('docs/architecture/clinical-measurement-v3/contracts/semantic-measurement-response-v3.md'), /Status:\*\* Accepted/);

console.log('PASS abaV3ProductionHealthObservability');
