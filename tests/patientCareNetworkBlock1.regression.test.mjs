import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/components/PatientDashboard.tsx', import.meta.url), 'utf8');
const detail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../src/components/PatientCareNetworkPanel.tsx', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260828160000_patient_care_network_v1.sql', import.meta.url), 'utf8');

const block = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
};

// Portal navigation + professional surface.
assert.match(dashboard, /'care-network'/);
assert.match(dashboard, /label: 'Rede de cuidado'/);
assert.match(dashboard, /<PatientCareNetworkPanel\s+mode="patient"/);
assert.match(detail, /'care-network'/);
assert.match(detail, />Rede de cuidado<\/button>/);
assert.match(detail, /<PatientCareNetworkPanel mode="professional"/);

// Exact field order requested by product, with only professional name + phone required.
const clinicPos = panel.indexOf('1. Nome da clínica');
const professionalPos = panel.indexOf('2. Nome do profissional');
const specialtyPos = panel.indexOf('3. Especialidade');
const phonePos = panel.indexOf('4. Telefone');
const emailPos = panel.indexOf('5. E-mail');
assert.ok(clinicPos >= 0 && clinicPos < professionalPos && professionalPos < specialtyPos && specialtyPos < phonePos && phonePos < emailPos);
assert.match(panel, /<input required value=\{form\.professionalName\}/);
assert.match(panel, /<input required type="tel" value=\{form\.phone\}/);
assert.doesNotMatch(panel, /required value=\{form\.clinicName\}/);
assert.doesNotMatch(panel, /required value=\{form\.specialty\}/);
assert.doesNotMatch(panel, /required type="email"/);

// This block is informational only; it must not claim that listing a person grants data access.
assert.match(panel, /não concede acesso a dados clínicos ou documentos/);
assert.match(panel, /não representa, por si só, autorização para compartilhamento de dados clínicos/);
assert.doesNotMatch(panel, /checkbox/i);
assert.doesNotMatch(panel, /consent/i);

// Professional can copy the optional e-mail, but cannot mutate the network here.
assert.match(panel, /Copiar e-mail/);
assert.match(panel, /mode === 'patient'/);

// Patient self routes must bind every read/write to the canonical patient + clinic scope.
for (const [start, end] of [
  ["app.get('/api/patient/self/care-network'", "\n  app.post('/api/patient/self/care-network'"],
  ["app.post('/api/patient/self/care-network'", "\n  app.patch('/api/patient/self/care-network/:contactId'"],
  ["app.patch('/api/patient/self/care-network/:contactId'", "\n  app.delete('/api/patient/self/care-network/:contactId'"],
  ["app.delete('/api/patient/self/care-network/:contactId'", "\n  app.get(\n    '/api/patients/:patientId/care-network'"]
]) {
  const route = block(server, start, end);
  assert.match(route, /resolveCanonicalPatientPortalScope\(req\.session\.user\)/);
  assert.match(route, /\.eq\('clinic_id', portalScope\.clinicId\)/);
  assert.match(route, /\.eq\('patient_id', portalScope\.patientId\)/);
  assert.doesNotMatch(route, /getPatientIdsByEmailAcrossClinics/);
  assert.doesNotMatch(route, /\.ilike\('patient_email'/);
}

const professionalRoute = block(server, "'/api/patients/:patientId/care-network'", "\n  app.patch('/api/patient/self/profile'");
assert.match(professionalRoute, /requireAnyClinicCapability\('clinical\.record\.view', 'clinical\.history\.view'\)/);
assert.match(professionalRoute, /checkPatientAccess/);
assert.match(professionalRoute, /req\.resolvedPatientId/);
assert.match(professionalRoute, /req\.resolvedPatientClinicId/);

// Data service uses dedicated endpoints; no direct Supabase access from the UI.
assert.match(service, /getPatientSelfCareNetwork/);
assert.match(service, /createPatientSelfCareNetworkContact/);
assert.match(service, /updatePatientSelfCareNetworkContact/);
assert.match(service, /archivePatientSelfCareNetworkContact/);
assert.match(service, /getPatientCareNetwork/);

// Database is server-only and explicitly states that contact presence is not an authorization source.
assert.match(migration, /create table if not exists public\.patient_care_network_contacts/);
assert.match(migration, /professional_name text not null/);
assert.match(migration, /phone text not null/);
assert.match(migration, /clinic_name text null/);
assert.match(migration, /specialty text null/);
assert.match(migration, /email text null/);
assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all on table public\.patient_care_network_contacts from public, anon, authenticated/);
assert.match(migration, /grant select, insert, update, delete on table public\.patient_care_network_contacts to service_role/);
assert.match(migration, /never implies consent or permission to access clinical data/);

console.log('patientCareNetworkBlock1.regression: PASS');
