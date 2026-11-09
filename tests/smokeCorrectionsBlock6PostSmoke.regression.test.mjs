import { readModularServerSource } from './helpers/modularServerSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = readModularServerSource();
const plan = fs.readFileSync(new URL('../src/components/TherapeuticPlanPanel.tsx', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../src/components/ClinicGlobalSettingsPanel.tsx', import.meta.url), 'utf8');
const coordinator = fs.readFileSync(new URL('../src/components/CoordinatorDashboard.tsx', import.meta.url), 'utf8');
const therapist = fs.readFileSync(new URL('../src/components/TherapistDashboard.tsx', import.meta.url), 'utf8');
const receptionist = fs.readFileSync(new URL('../src/components/ReceptionistDashboard.tsx', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../src/components/AdminDashboard.tsx', import.meta.url), 'utf8');

const wellbeingRoute = server.slice(
  server.indexOf("app.post('/api/patient/self/wellbeing-checkins'"),
  server.indexOf("app.get(\n    '/api/patients/:patientId/wellbeing-checkins'"),
);
assert.match(wellbeingRoute, /!Number\.isFinite\(metricValue\)/);
assert.match(wellbeingRoute, /metricValue < 0/);
assert.match(wellbeingRoute, /metricValue > 100/);
assert.doesNotMatch(wellbeingRoute, /asSafeNumber\(req\.body\?\.metricValue/);

const profileRoute = server.slice(
  server.indexOf("app.post('/api/profile/:userId'"),
  server.indexOf("app.post('/api/profile/media"),
);
for (const source of [
  'professionalProfileInput?.council',
  'professionalProfileInput?.councilType',
  'professionalProfileInput?.councilNumber',
  'professionalProfileInput?.crp',
]) assert.ok(profileRoute.includes(source), `profile route must persist nested ${source}`);

const storedCouncilHelpers = server.slice(
  server.indexOf('function resolveStoredCrp'),
  server.indexOf('function maskEmail'),
);
assert.match(storedCouncilHelpers, /metadata\?\.councilNumber/);
assert.match(storedCouncilHelpers, /metadata\?\.council/);
assert.match(storedCouncilHelpers, /metadata\?\.councilType/);

const councilBlock = settings.slice(
  settings.indexOf('Conselho / tipo de registro'),
  settings.indexOf('Registro profissional / identificação'),
);
assert.match(councilBlock, /<select/);
assert.match(councilBlock, /PROFESSIONAL_COUNCIL_OPTIONS\.map/);

assert.match(plan, /effectiveProgramStatus/);
assert.match(plan, /Programa configurado no rascunho, ainda sem fase clínica ativa/);
assert.match(plan, /ativação clínica após publicação/);
assert.match(plan, /Retomar ensino/);
assert.match(plan, /updateStatus\(program, 'teaching'\)/);
assert.match(plan, /scopeFilterOptions/);
assert.match(plan, /scopeIsPaused[\s\S]{0,260}\['all', 'paused'\]/);
assert.match(plan, /scopeStatusOptionsFor/);
assert.match(plan, /currentStatus === 'paused'\) return \['paused', 'active', 'completed', 'archived'\]/);
assert.match(plan, /Pausado · retome o ensino para reativar a coleta/);
assert.match(plan, /programa\(s\) vinculados · plano pausado · retome o plano para reativar a coleta/);
assert.match(plan, /!border-l-amber-400/);
assert.match(plan, /!border-l-emerald-500/);
assert.match(plan, /!border-l-red-500/);
assert.match(server, /SESSION_THERAPEUTIC_PLAN_NOT_ACTIVE/);
assert.match(server, /planStatus !== 'active'/);
assert.match(server, /Programa configurado no rascunho; ativação clínica após publicação do plano/);
assert.match(server, /THERAPEUTIC_PLAN_STATUS_TRANSITION_INVALID/);
assert.match(server, /paused: \['paused', 'active', 'completed', 'archived'\]/);
assert.match(server, /THERAPEUTIC_PROGRAM_STATUS_TRANSITION_INVALID/);
assert.match(server, /paused: \['paused', 'teaching', 'maintenance', 'completed'\]/);
assert.match(server, /THERAPEUTIC_PROGRAM_PARENT_PLAN_NOT_ACTIVE/);
assert.match(server, /select\('id,status,version,therapeutic_plan_id'\)/);

for (const [name, source] of [
  ['CoordinatorDashboard', coordinator],
  ['TherapistDashboard', therapist],
  ['ReceptionistDashboard', receptionist],
  ['AdminDashboard', admin],
]) {
  assert.match(source, /onMouseEnter=\{\(\) => setIsSidebarExpanded\(true\)\}/, `${name} must expand on hover`);
  assert.match(source, /onMouseLeave=\{\(\) => setIsSidebarExpanded\(false\)\}/, `${name} must collapse on mouse leave`);
  assert.match(source, /onFocusCapture=\{\(\) => setIsSidebarExpanded\(true\)\}/, `${name} must remain keyboard accessible`);
  assert.doesNotMatch(source, /Expandir menu lateral|Recolher menu lateral|toggleSidebarExpanded|sidebar-expanded/, `${name} must not restore click-toggle sidebar controls`);
}

console.log('smokeCorrectionsBlock6PostSmoke.regression: PASS');
