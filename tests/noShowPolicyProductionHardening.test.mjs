import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(currentDir, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const settingsPanel = read('src/components/ClinicGlobalSettingsPanel.tsx');
const policyRoutes = read('services/clinicAppointmentPolicyRoutes.ts');
const server = read('server.ts');
const migration = read('supabase/migrations/20260815003000_no_show_policy_director_compatibility.sql');

// Direção tem a mesma autoridade operacional já concedida por capability à coordenação.
assert.match(migration, /when actor_role = 'director' then 'coordinator'/);
assert.match(migration, /grant execute on function public\.verto_clinic_actor_role_v1\(uuid,uuid\) to service_role/);

// Mudanças independentes não podem persistir rascunhos de outra política por acidente.
assert.match(settingsPanel, /updateClinicAppointmentPolicy\(\{\s*allowPatientReschedule: nextValue,[\s\S]*?idempotencyKey:/);
assert.doesNotMatch(settingsPanel, /allowPatientReschedule: nextValue,\s*autoNoShowEnabled:/);
assert.match(settingsPanel, /updateClinicAppointmentPolicy\(\{\s*autoNoShowEnabled: state\.autoNoShowEnabled,[\s\S]*?noShowMode: state\.noShowMode/);
assert.doesNotMatch(settingsPanel, /updateClinicAppointmentPolicy\(\{\s*allowPatientReschedule: state\.allowPatientReschedule,\s*autoNoShowEnabled:/);

// A UI deixa claro que o switch só vira persistente após salvar.
assert.match(settingsPanel, /attendanceDirty: true/);
assert.match(settingsPanel, /Alterações ainda não salvas/);
assert.match(settingsPanel, /Salvar horário da clínica/);
assert.match(settingsPanel, /Aguardar revisão manual da equipe/);

// Backend limita payload e mantém idempotência server-side.
assert.match(policyRoutes, /enforcePayloadLimit\(req, res, 16 \* 1024, 'Política operacional da agenda'\)/);
assert.match(policyRoutes, /CLINIC_POLICY_IDEMPOTENCY_REQUIRED/);
assert.match(policyRoutes, /set_clinic_appointment_policy_v2/);

// Uma falta manual passa a carregar metadados coerentes com reabertura auditável.
assert.match(server, /patchWithConfirmation\.attendance_status = 'NO_SHOW'/);
assert.match(server, /patchWithConfirmation\.no_show_previous_status/);
assert.match(server, /patchWithConfirmation\.no_show_classified_at = now/);
assert.match(server, /patchWithConfirmation\.no_show_review_required_at = null/);
assert.match(server, /patchWithConfirmation\.no_show_source = 'MANUAL_AGENDA'/);

console.log('noShowPolicyProductionHardening: ok');
