import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const patientDetail = read('src/components/PatientDetailView.tsx');
const patientDashboard = read('src/components/PatientDashboard.tsx');
const dataService = read('src/services/dataService.ts');
const server = read('server.ts');
const migration = read('sql/20260802183000_patient_milestone_celebration.sql');

const milestoneButtonIndex = patientDetail.indexOf('aria-label={`${kidsMilestoneStars} marcos validados');
const whatsappButtonIndex = patientDetail.indexOf('id="whatsapp-btn"');
assert.ok(milestoneButtonIndex >= 0, 'o atalho de marcos validados deve existir no cabeçalho');
assert.ok(whatsappButtonIndex > milestoneButtonIndex, 'marcos validados deve ficar à esquerda do WhatsApp');
assert.equal(
  (patientDetail.match(/Marcos validados/g) || []).length,
  1,
  'o contador não deve continuar duplicado na linha do tempo',
);
assert.match(patientDetail, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);

assert.match(dataService, /consumePortalMilestoneCelebration/);
assert.match(dataService, /\/api\/portal\/milestone-celebration\/consume/);
assert.match(dataService, /credentials: 'include'/);

assert.match(server, /app\.post\('\/api\/portal\/milestone-celebration\/consume'/);
assert.match(server, /requireRoles\('patient'\)/);
assert.match(server, /resolvePatientPortalContext\(req\.session\.user\)/);
assert.match(server, /consume_patient_milestone_celebration_v1/);
assert.doesNotMatch(
  server.slice(
    server.indexOf("app.post('/api/portal/milestone-celebration/consume'"),
    server.indexOf("const readPortalAppointmentPatientScope", server.indexOf("app.post('/api/portal/milestone-celebration/consume'")),
  ),
  /req\.body\?\.patient|req\.query\?\.patient/,
  'o paciente deve ser resolvido pelo backend, não pelo navegador',
);

assert.match(migration, /patient_milestone_celebration_receipts/);
assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all on table[\s\S]*from anon, authenticated/);
assert.match(migration, /grant execute[\s\S]*to service_role/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /subject = 'milestone_event'/);
assert.match(migration, /awarded=1/);
assert.match(migration, /on conflict \(user_id, patient_id\)/);

assert.match(patientDashboard, /consumePortalMilestoneCelebration\(\)/);
assert.match(patientDashboard, /verto:milestone-celebration:/);
assert.match(patientDashboard, /sessionStorage/);
assert.doesNotMatch(patientDashboard, /kids_star_seen_total/);
assert.match(patientDashboard, /fixed inset-0 z-\[10000\]/);
assert.match(patientDashboard, /STAR_CONFETTI_PARTICLES/);
assert.match(patientDashboard, /Você ganhou \{milestoneCelebrationCount/);
assert.match(patientDashboard, /onAnimationComplete=\{dismissMilestoneCelebration\}/);
assert.doesNotMatch(
  patientDashboard.slice(
    patientDashboard.indexOf('const dismissMilestoneCelebration'),
    patientDashboard.indexOf('const familyPhotoCountToday'),
  ),
  /setTimeout/,
  'a entrega da celebração não deve depender de temporizador para funcionar',
);

console.log('patientMilestoneCelebration.test.ts: ok');
