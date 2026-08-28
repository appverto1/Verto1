import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const detail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../src/components/PatientEvolutionTimelinePanel.tsx', import.meta.url), 'utf8');
const external = fs.readFileSync(new URL('../src/components/ExternalEvolutionShare.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const data = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260828173000_patient_evolution_external_timeline_v1.sql', import.meta.url), 'utf8');

assert.match(detail, /PatientEvolutionTimelinePanel/);
assert.match(detail, /canCreate=\{hasCapability\('reports\.generate'\)\}/);
assert.match(detail, /canShare=\{hasCapability\('reports\.generate'\) && hasCapability\('documents\.patient_share'\)\}/);

assert.match(panel, /Timeline de evolução compartilhável/);
assert.match(panel, /Até três registros independentes por mês/);
assert.match(panel, /Assunto \/ tema/);
assert.match(panel, />Conteúdo</);
assert.match(panel, /Documento opcional/);
assert.match(panel, /selectedItems\.length >= 3/);
assert.match(panel, /authorizationConfirmed: true/);
assert.match(panel, /Declaro que existe autorização válida do paciente ou responsável legal/);
assert.match(panel, /Copiar link/);
assert.match(panel, /Revogar/);
assert.match(panel, /Reenviar/);
assert.match(panel, /source: 'evolution_timeline'/);

assert.match(data, /getPatientEvolutionTimeline/);
assert.match(data, /createPatientEvolutionTimelineItem/);
assert.match(data, /grantPatientEvolutionTimelineAccess/);
assert.match(data, /revokePatientEvolutionTimelineAccess/);
assert.match(data, /resendPatientEvolutionTimelineAccess/);

assert.match(server, /create_patient_evolution_timeline_item_v1/);
assert.match(server, /upsert_patient_evolution_share_grant_v1/);
assert.match(server, /revoke_patient_evolution_share_grant_v1/);
assert.match(server, /requireClinicCapability\('reports\.generate'\)/);
assert.match(server, /requireClinicCapability\('documents\.patient_share'\)/);
const grantRouteStart = server.indexOf("'/api/patients/:patientId/evolution-timeline/:itemId/grants'");
const externalRouteStart = server.indexOf("'/api/external/evolution/:publicId'", grantRouteStart);
const grantRoutes = server.slice(grantRouteStart, externalRouteStart);
assert.ok((grantRoutes.match(/requireClinicCapability\('reports\.generate'\)/g) || []).length >= 3);
assert.ok((grantRoutes.match(/requireClinicCapability\('documents\.patient_share'\)/g) || []).length >= 3);
assert.match(server, /EXTERNAL_EVOLUTION_SHARE_AUTH_STATEMENT_VERSION/);
assert.match(server, /purpose: 'external_clinical_share'/);
assert.match(server, /setExternalEvolutionShareCookie/);
assert.match(server, /httpOnly: true/);
assert.match(server, /sameSite: 'lax'/);
assert.match(server, /loadActiveExternalEvolutionShare/);
assert.match(server, /from\('patients'\)\.select\('id,name'\)\.eq\('id', grant\.patient_id\)\.eq\('clinic_id', grant\.clinic_id\)/);
assert.match(server, /sanitizeEmail\(sessionData\.email\) !== sanitizeEmail\(loaded\.grant\.recipient_email\)/);
assert.match(server, /createSignedUrl\([^\n]+60 \* 5\)/);
assert.match(server, /patient_evolution_external_access_audit/);

const publicMetadataRouteStart = server.indexOf("app.get('/api/external/evolution/:publicId'");
const requestCodeRouteStart = server.indexOf("app.post('/api/external/evolution/:publicId/request-code'");
assert.ok(publicMetadataRouteStart >= 0 && requestCodeRouteStart > publicMetadataRouteStart);
const publicMetadataRoute = server.slice(publicMetadataRouteStart, requestCodeRouteStart);
assert.doesNotMatch(publicMetadataRoute, /subject:/);
assert.doesNotMatch(publicMetadataRoute, /patientName:/);
assert.doesNotMatch(publicMetadataRoute, /signedUrl/);

assert.match(external, /O link sozinho não libera nenhum dado clínico/);
assert.match(external, /autoComplete="one-time-code"/);
assert.match(external, /\/api\/external\/evolution\/\$\{encodeURIComponent\(publicId\)\}\/content/);
assert.match(external, /\/api\/external\/evolution\/\$\{encodeURIComponent\(publicId\)\}\/file/);
assert.ok(app.includes('evolucao-compartilhada'));
assert.match(app, /ExternalEvolutionShare publicId=\{externalEvolutionPublicId\}/);

assert.match(migration, /create table if not exists public\.patient_evolution_timeline_items/);
assert.match(migration, /slot smallint not null/);
assert.match(migration, /check \(slot between 1 and 3\)/);
assert.match(migration, /patient_evolution_timeline_active_slot_uidx/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /generate_series\(1, 3\)/);
assert.match(migration, /EVOLUTION_TIMELINE_MONTH_LIMIT/);
assert.match(migration, /archived_at is not null[\s\S]*patient_file_id is not null/);
assert.match(migration, /create table if not exists public\.patient_evolution_share_grants/);
assert.match(migration, /public_id uuid not null default gen_random_uuid\(\)/);
assert.match(migration, /timeline_item_id, lower\(recipient_email\)/);
assert.match(migration, /status in \('ACTIVE', 'REVOKED'\)/);
assert.match(migration, /if v_grant\.status = 'ACTIVE' then[\s\S]*v_public_id := v_grant\.public_id/);
assert.match(migration, /create table if not exists public\.patient_evolution_external_access_audit/);
assert.match(migration, /external_clinical_share/);
assert.match(migration, /revoke all on table public\.patient_evolution_timeline_items from public, anon, authenticated/);
assert.match(migration, /revoke all on table public\.patient_evolution_share_grants from public, anon, authenticated/);
assert.match(migration, /revoke all on function public\.set_patient_evolution_timeline_updated_at_v1\(\) from public, anon, authenticated/);
assert.doesNotMatch(migration, /drop table/i);
assert.doesNotMatch(migration, /truncate/i);

console.log('patientEvolutionExternalTimelineBlock2.regression: PASS');
