import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const server = read('server.ts');
const app = read('src/App.tsx');
const coordinator = read('src/components/CoordinatorDashboard.tsx');
const calendar = read('src/components/Calendar.tsx');
const therapist = read('src/components/TherapistDashboard.tsx');
const receptionist = read('src/components/ReceptionistDashboard.tsx');
const patientAuth = read('src/utils/patientAuthorization.ts');

// P0 1: canonical patient_financial_plans survives every list/workspace hydration.
const patientListAt = server.indexOf("app.get('/api/patients'");
const patientListEnd = server.indexOf("app.post('/api/patients'", patientListAt);
assert.ok(patientListAt >= 0 && patientListEnd > patientListAt, 'patient list route missing');
const patientList = server.slice(patientListAt, patientListEnd);
assert.match(patientList, /patientFinancialPlanSelectForCapabilities\(context\.capabilities\)/);
assert.match(patientList, /from\('patient_financial_plans'\)/);
assert.match(patientList, /\.eq\('organization_id', context\.clinicId\)/);
assert.match(patientList, /\.eq\('status', 'ACTIVE'\)/);
assert.match(patientList, /index \+= 100/);
assert.match(patientList, /financialPlans: activeFinancialPlansByPatient\.get\(patientId\) \|\| \[\]/);
assert.match(patientList, /financial_plans: activeFinancialPlansByPatient\.get\(patientId\) \|\| \[\]/);
assert.match(patientAuth, /'profile_picture'/);
assert.match(patientAuth, /'profile_picture_path'/);

// App refreshes replace allPatients from /api/patients, so the server list hydration is the canonical fix.
assert.match(app, /setAllPatients\(scopedPatients\)/);
assert.match(app, /dataService\.getPatients\(\{ workspaceId, forceRemote: true \}\)/);

// Financial-plan lifecycle mutations remain owned by patient/profile endpoints.
// Appointment/Agenda flows consume the canonical plan but never reconcile its lifecycle.
const planPersistCalls = [...server.matchAll(/await persistPatientFinancialPlans\(/g)];
assert.equal(planPersistCalls.length, 4, 'only the established patient mutation flows may persist financial plans');
const calendarRoutesAt = server.indexOf("app.get('/api/calendar");
assert.ok(calendarRoutesAt > 0, 'calendar route boundary missing');
assert.doesNotMatch(server.slice(calendarRoutesAt), /await persistPatientFinancialPlans\(/, 'Agenda must not administer patient_financial_plans lifecycle');
assert.doesNotMatch(server.slice(calendarRoutesAt), /rpc\('reconcile_patient_financial_plans_v2'/, 'Agenda must not reconcile patient_financial_plans');

// MONTHLY/SESSION unit price is not treated as a fixed monthly projection.
assert.match(coordinator, /isMonthlySessionVariable:[\s\S]{0,260}ELIGIBLE_COMPLETED_SESSIONS/);
assert.match(coordinator, /const getFixedProjectionPlanAmount = \(plan: any\) =>[\s\S]{0,120}plan\?\.isMonthlySessionVariable \? 0/);
assert.match(coordinator, /projection \+= projectedPlanAmount/);
assert.match(coordinator, /mensal por sessões entra pelos recebíveis consolidados/);

// Explicit PRIVATE context cannot be overwritten by historical insurance payer data.
assert.match(app, /if \(!financialContextType && !effectivePayerId && canonicalPatientPayerId\)/);

// Server checklist/payer suggestion honors PRIVATE instead of demanding/suggesting insurance.
const checklistAt = server.indexOf('function normalizeHydratedClosureChecklist');
const checklistEnd = server.indexOf('const setAppointmentPatientConfirmationStateCandidate', checklistAt);
const checklist = server.slice(checklistAt, checklistEnd);
assert.match(checklist, /financialContextSkipsInsuranceBilling\(financialContextType\)/);
assert.match(checklist, /required: false/);
assert.match(checklist, /notApplicable: true/);
const conferenceAt = server.indexOf('const selectConferenceFinancialPlan');
const conferenceEnd = server.indexOf('const handleTissPreGuideRevalidation', conferenceAt);
const conference = server.slice(conferenceAt, conferenceEnd);
assert.match(conference, /const financialPlan = !financialContextSkipsInsuranceBilling\(billingContextType\)/);

// Calendar detail exposes the canonical DB engine, never inferring monthly from missing individual payment.
assert.match(server, /rpc\('resolve_appointment_financial_engine_v1'/);
assert.match(server, /patientFinancialEngine: canViewPatientFinance \? patientFinancialEngine : null/);
assert.match(calendar, /patientFinancialEngine === 'MONTHLY_SESSION'/);
assert.match(calendar, /Faturamento mensal automático/);
assert.match(calendar, /Ainda não incluída na competência/);
assert.match(calendar, /!patientFinance\?\.payment_id && !isMonthlySessionFinance/);
assert.match(calendar, /sectionKey === 'tissBilling'/);
assert.match(calendar, /!billingDetailIsNonInsuranceContext && \[/);

// Billing mode select gets enough responsive width without changing values/handlers.
assert.match(coordinator, /md:col-span-2 xl:col-span-2/);
assert.match(coordinator, /Faturamento mensal por sessões realizadas/);
assert.match(coordinator, /setFinancialPlanMonthlySessionBilling\(plan\.id, e\.target\.value === "MONTHLY_SESSION"\)/);

// Canonical patient media survives legacy clinical snapshot merges across panels.
for (const [name, source] of [['therapist', therapist], ['receptionist', receptionist]]) {
  assert.match(source, /profilePicture: patient\?\.profilePicture \|\| patient\?\.profile_picture/,
    `${name} detail merge must preserve canonical patient photo`);
  assert.match(source, /profile_picture_path: patient\?\.profile_picture_path \|\| patient\?\.profilePicturePath/,
    `${name} detail merge must preserve canonical patient photo path`);
}

console.log('postSmokeMonthlyFinanceRegressions.regression.test.mjs: ok');
