import assert from 'node:assert/strict';
import fs from 'node:fs';

const calendar = fs.readFileSync('src/components/Calendar.tsx', 'utf8');
const dashboard = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const settings = fs.readFileSync('src/components/ClinicGlobalSettingsPanel.tsx', 'utf8');
const policyRoutes = fs.readFileSync('services/clinicAppointmentPolicyRoutes.ts', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

assert.match(calendar, /schoolModuleEnabled = false/);
assert.match(calendar, /if \(!schoolModuleEnabled\) \{[\s\S]*?setSchoolOptions\(\[\]\)/);
assert.match(calendar, /schoolModuleEnabled\s*\? dataService\.getSchoolCalendarEvents\(/);
assert.match(calendar, /: Promise\.resolve\(\{ success: true, data: \[\] \}\)/);
assert.match(calendar, /\{schoolModuleEnabled && renderSection\('school', 'Escola'/);
assert.match(
  dashboard,
  /schoolModuleEnabled=\{authorizationHydrated && hasModule\("school_management"\)\}/,
  'agenda must only mount school integrations for entitled clinics',
);
assert.match(
  dashboard,
  /if \(!authorizationHydrated \|\| !hasModule\("school_management"\)\) \{[\s\S]*?setPatientSchoolOptions\(\[\]\)/,
  'patient screen must not call school discovery for clinics without the school module',
);

assert.match(settings, /hasOrganizationModule\([\s\S]*?"appointments_communication"/);
assert.match(settings, /\{hasAppointmentsCommunicationModule && \([\s\S]*?<PatientReschedulePolicySettings/);
assert.match(policyRoutes, /requireClinicModule\('appointments_communication'\)/);
assert.match(
  server,
  /registerClinicAppointmentPolicyRoutes\(app, \{[\s\S]*?requireClinicModule,/,
  'appointment policy route must receive the server-side module gate',
);

console.log('calendarSchoolModuleGating.test.mjs: ok');
