import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const detail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../src/components/PatientEvolutionTimelinePanel.tsx', import.meta.url), 'utf8');
const external = fs.readFileSync(new URL('../src/components/ExternalEvolutionShare.tsx', import.meta.url), 'utf8');
const externalTimeline = fs.readFileSync(new URL('../src/components/ExternalPatientTimeline.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const data = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260903033000_external_care_network_collaboration_v1.sql', import.meta.url), 'utf8');

assert.match(detail, /PatientEvolutionTimelinePanel/);
assert.match(panel, /Timeline de evolução compartilhável/);
assert.match(panel, /Compartilhado com/);
assert.match(panel, /Gerenciar compartilhamento/);
assert.match(panel, /Pode comentar|Habilitar comentário/);
assert.match(panel, /Visualizado/);
assert.match(panel, /Copiar acesso/);
assert.match(panel, /Reenviar/);
assert.match(panel, /authorizationConfirmed: true/);
assert.match(panel, /Estar na Rede de cuidado não concede acesso automático/);

assert.match(data, /grantPatientEvolutionTimelineAccess/);
assert.match(data, /revokePatientEvolutionTimelineAccess/);
assert.match(data, /resendPatientEvolutionTimelineAccess/);
assert.match(data, /createPatientEvolutionTimelineAccessLink/);

assert.match(server, /upsert_patient_evolution_share_grant_v2/);
assert.match(server, /careNetworkContactId/);
assert.match(server, /ensureExternalEvolutionGrantCareContact/);
assert.match(server, /resolveExternalEvolutionAuthorizedShare/);
assert.match(server, /record_external_evolution_view_v1/);
assert.match(server, /append_external_evolution_comment_v1/);
assert.match(server, /createSignedUrl\([^\n]+60 \* 5\)/);
assert.match(server, /itemId !== sanitizeString\(loaded\.item\?\.id, 120\)/);

const preauthStart = server.indexOf("app.get('/api/external/evolution/:publicId'");
const preauthEnd = server.indexOf("app.post('/api/external/evolution/:publicId/access-state'", preauthStart);
const preauth = server.slice(preauthStart, preauthEnd);
assert.doesNotMatch(preauth, /patientName:/);
assert.doesNotMatch(preauth, /clinicName:/);
assert.doesNotMatch(preauth, /subject:/);
assert.doesNotMatch(preauth, /content:/);

assert.match(external, /Crie uma senha/);
assert.match(external, /current-password/);
assert.doesNotMatch(external, /one-time-code/);
assert.match(external, /EXTERNAL_ACCOUNT_MISMATCH/);
assert.match(external, /openAuthorizedTimeline/);
assert.match(external, /\/api\/external\/evolution\/\$\{encodeURIComponent\(publicId\)\}\/context/);
assert.match(externalTimeline, /Comentários/);
assert.match(externalTimeline, /canComment/);
assert.match(externalTimeline, /rede-de-cuidado/);
assert.match(app, /ExternalEvolutionShare publicId=\{externalEvolutionPublicId\}/);

assert.match(migration, /external_professional_accounts/);
assert.match(migration, /external_evolution_activation_tokens/);
assert.match(migration, /patient_evolution_external_comments/);
assert.match(migration, /first_viewed_at/);
assert.match(migration, /last_viewed_at/);
assert.match(migration, /view_count/);
assert.match(migration, /can_comment/);
assert.match(migration, /FOR UPDATE/);
assert.match(migration, /ON CONFLICT \(idempotency_key\) DO NOTHING/);
assert.doesNotMatch(migration, /drop table/i);
assert.doesNotMatch(migration, /truncate/i);

console.log('patientEvolutionExternalTimelineBlock2.regression: PASS');
