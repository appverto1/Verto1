import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync('src/services/abaReinforcers.ts', 'utf8');
const catalog = fs.readFileSync('src/components/AbaReinforcerCatalogPanel.tsx', 'utf8');
const sessionPanel = fs.readFileSync('src/components/AbaReinforcerSessionPanel.tsx', 'utf8');
const sessionMode = fs.readFileSync('src/components/SessionMode.tsx', 'utf8');
const patientDetail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const localDb = fs.readFileSync('src/services/localDb.ts', 'utf8');
const v3Collection = fs.readFileSync('src/utils/abaV3Collection.ts', 'utf8');
const v3Architecture = fs.readFileSync('docs/architecture/aba-measurement-v3.md', 'utf8');

for (const rpc of [
  'record_aba_reinforcer_delivery_authenticated_v1',
  'list_aba_patient_reinforcers_authenticated_v1',
  'list_recent_aba_patient_reinforcers_authenticated_v1',
  'list_aba_session_reinforcer_events_authenticated_v1',
  'get_aba_session_reinforcer_summary_authenticated_v1',
  'save_aba_patient_reinforcer_authenticated_v1',
]) {
  assert.match(service, new RegExp(rpc));
}

assert.match(service, /clientEventId = generateId\(\)/);
assert.match(service, /saveEncryptedRecord/);
assert.match(service, /SESSION_CLOSED/);
assert.doesNotMatch(service, /service_role|\.from\(/);
assert.match(localDb, /record\.endpoint\.startsWith\('supabase-rpc:'\)[\s\S]*?continue;/);

for (const word of ['Novo reforçador','Editar','Inativar','Reativar','Ativo','Inativo','Nenhum reforçador cadastrado']) {
  assert.match(catalog, new RegExp(word));
}
for (const category of ['SOCIAL','ACTIVITY','ITEM_OBJECT','SENSORY','FOOD','OTHER']) {
  assert.match(catalog, new RegExp(category));
}

assert.match(patientDetail, /AbaReinforcerCatalogPanel/);
assert.match(sessionPanel, /Registro factual de entrega\/uso/);
assert.doesNotMatch(sessionPanel, /eficaz|recomendad|melhor reforçador/i);
assert.match(sessionMode, /AbaReinforcerSessionPanel/);
assert.match(sessionMode, /if \(endingSession \|\| reinforcerClosureSyncing\) return;/);
assert.match(sessionMode, /flushReinforcerDeliveries\(sessionId\)/);
assert.match(sessionMode, /disabled=\{hasClosureBlockers \|\| endingSession \|\| reinforcerClosureSyncing\}/);
assert.match(sessionMode, /Sincronizando registros antes de encerrar/);
assert.doesNotMatch(sessionMode, /AbaReinforcerSessionPanel[^\n]*\\n\\n/);

assert.match(v3Collection, /'INDEPENDENT_INCORRECT'/);
assert.match(v3Collection, /'NO_RESPONSE'/);
assert.match(v3Architecture, /INDEPENDENT_INCORRECT[^\n]+NO_RESPONSE/);

assert.match(service, /kind: 'reinforcer_delivery_v1'/);
assert.doesNotMatch(service, /outcome|efficacy|effectiveness|score/i);

console.log('abaReinforcersRuntime.regression: PASS');
