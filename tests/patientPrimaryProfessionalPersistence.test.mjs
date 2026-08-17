import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const detail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const dataService = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');
const authorization = fs.readFileSync(new URL('../src/utils/patientAuthorization.ts', import.meta.url), 'utf8');
const linksPanel = fs.readFileSync(new URL('../src/components/PatientProfessionalLinksPanel.tsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260817090000_patient_primary_professional_atomic_assignment_v1.sql', import.meta.url),
  'utf8',
);

assert.match(server, /\/api\/patients\/:patientId\/primary-professional/);
assert.match(server, /requireClinicCapability\('team\.patient_primary\.manage'\)/);
assert.match(server, /set_patient_primary_professional_v1/);
assert.match(dataService, /setPatientPrimaryProfessional\(patientId: string, professionalId: string \| null\)/);
assert.match(detail, /dataService\.setPatientPrimaryProfessional\(patientId, nextValue\)/);
assert.match(authorization, /team\.patient_primary\.manage'\)\) add\('therapist_id'\)/);
assert.match(linksPanel, /Função no caso → Supervisão/);
assert.match(linksPanel, /patientProfessionalCaseRoleLabel\(link\.case_role\)/);
assert.doesNotMatch(
  detail.match(/const handleTherapistAssignmentChange[\s\S]*?\n  };/)?.[0] || '',
  /onUpdatePatient\(/,
);

assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /patient_professional_links/);
assert.match(migration, /relationship_type = 'primary'/);
assert.match(migration, /set therapist_id = p_professional_id/);
assert.match(migration, /relationship_type = 'collaborator'/);
assert.match(migration, /Reconcile legacy patients\.therapist_id pointers/);
assert.match(migration, /upsert_patient_professional_link_v1/);
assert.match(migration, /professional_membership\.role = 'therapist'/);

console.log('patientPrimaryProfessionalPersistence.test.mjs: ok');
