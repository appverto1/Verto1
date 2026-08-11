import assert from 'node:assert/strict';
import fs from 'node:fs';
import { roleHasDefaultCapability } from '../src/constants/authorizationModel';
import { isTherapeuticPlanManager } from '../src/utils/therapeuticPlanAccess';

const server = fs.readFileSync('server.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const dashboard = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');

// Frozen role defaults: supervisor manages supervised clinical plans/analytics,
// but does not become an executing therapist or clinic administrator.
assert.equal(roleHasDefaultCapability('supervisor', 'clinical.record.view'), true);
assert.equal(roleHasDefaultCapability('supervisor', 'treatment_plan.edit'), true);
assert.equal(roleHasDefaultCapability('supervisor', 'treatment_plan.approve'), true);
assert.equal(roleHasDefaultCapability('supervisor', 'aba.analytics.view'), true);
assert.equal(roleHasDefaultCapability('supervisor', 'calendar.team.view'), true);
assert.equal(roleHasDefaultCapability('supervisor', 'session.start'), false);
assert.equal(roleHasDefaultCapability('supervisor', 'aba.trial.record'), false);
assert.equal(roleHasDefaultCapability('supervisor', 'finance.payments.view'), false);
assert.equal(roleHasDefaultCapability('supervisor', 'team.permissions.manage'), false);

assert.equal(isTherapeuticPlanManager('director'), true);
assert.equal(isTherapeuticPlanManager('supervisor'), true);
assert.equal(isTherapeuticPlanManager('therapist'), false);

assert.match(server, /app\.get\('\/api\/clinic\/authorization\/me', checkAuth,/);
assert.match(server, /ROLE_DEFAULT_SCOPES\[context\.role\]/);
assert.match(dataService, /async getClinicAuthorizationContext\(\)/);

assert.match(
  server,
  /app\.get\('\/api\/clinic\/state'[^\n]*requireAnyClinicCapability\('clinic\.view', 'calendar\.own\.view', 'calendar\.team\.view', 'calendar\.clinic\.view', 'aba\.program\.view'\)/,
);
assert.match(server, /context\.capabilities\.has\('calendar\.team\.view'\)/);
assert.match(server, /resolvePatientListScopedPatientIds\(context\)/);


assert.match(server, /app\.get\('\/api\/calendar\/events'[^\n]*requireAnyClinicCapability\('calendar\.clinic\.view', 'calendar\.team\.view', 'calendar\.own\.view'\)/);
assert.match(server, /const calendarScope = await resolveCalendarReadScope\(context\)/);
assert.match(server, /calendarRowMatchesReadScope\(row, calendarScope\)/);
assert.match(server, /canViewBillingContext[\s\S]{0,500}Promise\.resolve\(\{ data: null, error: null \}\)/);
assert.match(server, /const canViewCalendarClosure = context\.capabilities\.has\('billing\.sessions\.view'\)[\s\S]{0,120}billing\.preguide\.view/);
assert.match(server, /const closureByAppointment = canViewCalendarClosure[\s\S]{0,180}fetchClosureSummariesByAppointment/);
assert.match(server, /if \(canViewBillingContext\) \{[\s\S]{0,180}persistAppointmentClosureCheck/);
assert.match(server, /const closureByAppointment = canViewBillingContext[\s\S]{0,180}fetchClosureSummariesByAppointment/);
assert.match(server, /const canViewCalendarAbaHints = context\.capabilities\.has\('aba\.next_session\.view'\)/);
assert.match(server, /patientFinance: canViewPatientFinance \? patientFinance : null/);
assert.match(server, /app\.get\('\/api\/patient-files\/:patientId'[^\n]*clinical\.documents\.view[^\n]*checkPatientAccess/);
assert.match(server, /app\.post\('\/api\/patient-files\/:patientId'[^\n]*clinical\.documents\.upload[^\n]*checkPatientAccess/);
assert.match(server, /app\.post\('\/api\/history'[^\n]*clinical\.evolution\.create[^\n]*checkPatientAccess/);

assert.match(server, /app\.post\('\/api\/appointments'[^\n]*requireClinicCapability\('calendar\.appointment\.create'\)/);
assert.match(server, /app\.patch\('\/api\/appointments\/:appointmentId'[^\n]*requireClinicCapability\('calendar\.appointment\.edit'\)/);
assert.match(server, /app\.delete\('\/api\/appointments\/:appointmentId'[^\n]*requireClinicCapability\('calendar\.appointment\.cancel'\)/);

assert.match(server, /app\.get\('\/api\/aba\/patients\/:patientId\/therapeutic-plan'[^\n]*requireClinicCapability\('treatment_plan\.view'\)[^\n]*checkPatientAccess/);
assert.match(server, /app\.post\('\/api\/aba\/patients\/:patientId\/therapeutic-plans'[^\n]*requireClinicCapability\('treatment_plan\.create'\)[^\n]*checkPatientAccess/);
assert.match(server, /app\.patch\('\/api\/aba\/patients\/:patientId\/therapeutic-plans\/:planId'[^\n]*requireClinicCapability\('treatment_plan\.edit'\)[^\n]*checkPatientAccess/);
assert.match(server, /app\.get\('\/api\/aba\/patient-summary\/:patientId'[^\n]*requireClinicCapability\('aba\.analytics\.view'\)[^\n]*checkPatientAccess/);
assert.match(server, /app\.post\('\/api\/aba\/sessions'[^\n]*requireClinicCapability\('session\.start'\)[^\n]*checkPatientAccess/);
assert.match(server, /app\.post\('\/api\/aba\/trials'[^\n]*requireClinicCapability\('aba\.trial\.record'\)[^\n]*checkPatientAccess/);

// Clinical record/history must honor explicit capability overrides before case scope.
assert.match(server, /function requireClinicCapabilityOrPatientPortal\(capability: CapabilityKey\)/);
assert.match(server, /app\.get\('\/api\/patient-records\/:patientId'[^\n]*requireClinicCapabilityOrPatientPortal\('clinical\.record\.view'\)[^\n]*checkPatientAccess/);
assert.match(server, /app\.get\('\/api\/notes\/:patientId'[^\n]*requireClinicCapabilityOrPatientPortal\('clinical\.history\.view'\)[^\n]*checkPatientAccess/);
assert.match(server, /app\.post\('\/api\/notes'[^\n]*requireClinicCapabilityOrPatientPortal\('clinical\.notes\.create'\)[^\n]*checkPatientAccess/);
assert.match(server, /app\.get\('\/api\/history\/:patientId'[^\n]*requireClinicCapabilityOrPatientPortal\('clinical\.history\.view'\)[^\n]*checkPatientAccess/);

// Insurance aliases in the encrypted legacy record are stripped when the
// effective membership lacks patient.insurance.view (Supervisor/Therapist by default).
assert.match(server, /const PATIENT_INSURANCE_PAYLOAD_KEYS = new Set\(\[/);
for (const key of ['convenioNome', 'convenioCarteirinha', 'insuranceCardNumber', 'insuranceHolderCpf']) {
  assert.match(server, new RegExp(`['"]${key}['"]`), `${key} deve estar no conjunto protegido`);
}
assert.match(server, /!capabilities\.has\('patient\.insurance\.view'\)[\s\S]{0,180}PATIENT_INSURANCE_PAYLOAD_KEYS/);
assert.match(server, /normalizePatientInsuranceEligibilityPayload\(decryptedPayload\)[\s\S]{0,220}capabilityContext\?\.capabilities/);

// Director may bridge coordinator-only legacy routes only after server-side
// resolution of the active membership; Supervisor never inherits therapist routes.
assert.match(server, /role === 'director' && allowed\.has\('coordinator'\)[\s\S]{0,220}resolveEffectiveClinicRole/);
assert.doesNotMatch(server, /role === 'supervisor' && allowed\.has\('therapist'\)/);

// Frontend uses the server-resolved effective capability set, including overrides.
assert.match(dashboard, /dataService\.getClinicAuthorizationContext\(\)/);
assert.match(dashboard, /setEffectiveCapabilities\(new Set\(result\.data\.capabilities/);
assert.match(dashboard, /"team-compensation": \["team\.permissions\.manage"\]/);
assert.match(dashboard, /return isDirectTherapist[\s\S]{0,180}mainListPatients\.filter/);
assert.match(app, /\['director', 'coordinator', 'supervisor', 'receptionist', 'therapist'\]\.includes/);
assert.doesNotMatch(
  app,
  /user\.role === 'director' \|\| user\.role === 'supervisor'\)[\s\S]{0,160}<ClinicRoleFoundationPending/,
);

console.log('directorSupervisorCapabilityRoutes.test.ts: ok');
