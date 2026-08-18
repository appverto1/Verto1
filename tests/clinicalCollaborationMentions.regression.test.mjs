import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const patient = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const therapist = fs.readFileSync('src/components/TherapistDashboard.tsx', 'utf8');
const notifications = fs.readFileSync('src/components/ClinicalMentionNotifications.tsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260818174500_clinical_note_mentions_v1.sql', 'utf8');

assert.match(server, /persistClinicalNoteMentions/);
assert.match(server, /patient_professional_links[\s\S]*?\.eq\('patient_id', params\.patientId\)[\s\S]*?\.eq\('status', 'active'\)/);
assert.match(server, /clinic_memberships[\s\S]*?\.eq\('status', 'active'\)/);
assert.match(server, /app\.get\('\/api\/clinical-note-mentions'/);
assert.match(server, /\.eq\('recipient_user_id', actorId\)/);
assert.match(server, /app\.patch\('\/api\/clinical-note-mentions\/:mentionId\/read'/);
assert.match(server, /upsert\(rows, \{ onConflict: 'note_id,recipient_user_id', ignoreDuplicates: true \}\)/);

assert.match(patient, /Use @ para mencionar alguém/);
assert.match(patient, /mentionUserIds: noteMode === 'professional'/);
assert.match(patient, /getPatientProfessionalLinks\(patientId\)/);
assert.match(patient, /patient-note-\$\{note\.id\}/);
assert.match(patient, /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/);

assert.match(coordinator, /ClinicalMentionNotifications/);
assert.match(coordinator, /setPatientOpenTab\("notes"\)/);
assert.match(therapist, /ClinicalMentionNotifications/);
assert.match(therapist, /setPatientOpenTab\("notes"\)/);
assert.match(notifications, /mencionou você/);

assert.match(migration, /create table if not exists public\.clinical_note_mentions/);
assert.match(migration, /unique index if not exists clinical_note_mentions_note_recipient_uidx/);
assert.match(migration, /recipient_user_id = auth\.uid\(\)/);
assert.match(migration, /revoke insert, delete on table public\.clinical_note_mentions from authenticated/);
assert.match(migration, /grant all on table public\.clinical_note_mentions to service_role/);

console.log('clinicalCollaborationMentions.regression.test.mjs: ok');
