import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/components/PatientDashboard.tsx', import.meta.url), 'utf8');
const detail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../src/components/PatientCareNetworkPanel.tsx', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260903033000_external_care_network_collaboration_v1.sql', import.meta.url), 'utf8');

assert.match(dashboard, /'care-network'/);
assert.match(detail, /<PatientCareNetworkPanel mode="professional"/);
assert.match(panel, />Rede de cuidado</);
assert.match(panel, /Profissionais externos envolvidos no cuidado deste paciente/);
assert.match(panel, /Adicionar profissional/);
assert.match(panel, /Cadastrado pela clínica/);
assert.match(panel, /Informado pelo paciente/);
assert.match(panel, /Conselho \/ registro/);
assert.match(panel, /não concede acesso clínico sozinho/);
assert.match(panel, /restoreAfterPatientRevocation: true/);
assert.match(panel, /Desfazer vínculo/);

assert.match(service, /createPatientSelfCareNetworkContact/);
assert.match(service, /updatePatientSelfCareNetworkContact/);
assert.match(service, /archivePatientSelfCareNetworkContact/);
assert.match(service, /createPatientCareNetworkContact/);
assert.match(service, /updatePatientCareNetworkContact/);
assert.match(service, /archivePatientCareNetworkContact/);

for (const route of [
  "app.get('/api/patient/self/care-network'",
  "app.post('/api/patient/self/care-network'",
  "app.patch('/api/patient/self/care-network/:contactId'",
  "app.delete('/api/patient/self/care-network/:contactId'",
]) {
  const start = server.indexOf(route);
  assert.ok(start >= 0, `missing route ${route}`);
  const block = server.slice(start, start + 4200);
  assert.match(block, /resolveCanonicalPatientPortalScope\(req\.session\.user\)/);
  assert.doesNotMatch(block, /getPatientIdsByEmailAcrossClinics/);
}

const clinicRoute = server.slice(server.indexOf("app.get('/api/patients/:patientId/care-network'"), server.indexOf('const patientEvolutionTimelineColumns'));
assert.match(clinicRoute, /checkPatientAccess/);
assert.match(clinicRoute, /req\.resolvedPatientClinicId/);
assert.match(server, /upsert_patient_care_network_contact_v2/);
assert.match(clinicRoute, /archive_patient_care_network_contact_v2/);

assert.match(migration, /patient_care_network_contacts_active_email_uidx/);
assert.match(migration, /clinic_id, patient_id, lower\(btrim\(email\)\)/);
assert.match(migration, /CARE_NETWORK_PATIENT_REVOCATION_CONFIRMATION_REQUIRED/);
assert.match(migration, /CONTACT_EMAIL_CHANGED/);
assert.match(migration, /PATIENT_UNLINKED/);
assert.match(migration, /supersedes_contact_id/);
assert.doesNotMatch(migration, /truncate/i);
assert.doesNotMatch(migration, /drop table/i);

console.log('patientCareNetworkBlock1.regression: PASS');
