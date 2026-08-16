import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('server.ts', 'utf8');
const dataService = readFileSync('src/services/dataService.ts', 'utf8');
const sessionMode = readFileSync('src/components/SessionMode.tsx', 'utf8');
const calendar = readFileSync('src/components/Calendar.tsx', 'utf8');
const patientDetail = readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const dashboard = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const caseTeam = readFileSync('src/components/PatientProfessionalLinksPanel.tsx', 'utf8');
const authorizationModel = readFileSync('src/constants/authorizationModel.ts', 'utf8');

// A completed session is a persisted clinical resource, not a transient browser state.
// The backend resolves the exact session scope, then reads effective V3 trials + steps
// in batches so revisions are reflected without N+1 or direct client DB authority.
const routeStart = server.indexOf("'/api/aba/session-reports/:sessionId/records'");
const routeEnd = server.indexOf("'/api/aba/recent-session-events/:sessionId'", routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'completed-session records route must exist');
const reportRoute = server.slice(routeStart, routeEnd);
assert.match(reportRoute, /checkAuth,[\s\S]*?requireClinicCapability\('aba\.analytics\.view'\)/);
assert.match(reportRoute, /resolveAbaSessionReadScope\(requestedSessionId, req\.session\.user\)/);
assert.match(reportRoute, /\.from\('aba_effective_trials_v3'\)/);
assert.match(reportRoute, /\.from\('aba_trial_steps_v3'\)[\s\S]*?\.in\('trial_id', v3TrialIds\)/);
assert.match(reportRoute, /\.from\('aba_targets'\)\.select\('id,name,program_id'\)\.in\('id', targetIds\)/);
assert.match(reportRoute, /\.eq\('patient_id', patientId\)/);
assert.match(reportRoute, /\.eq\('organization_id', clinicId\)/);
assert.doesNotMatch(reportRoute, /\.update\(|\.delete\(|\.insert\(/);

assert.match(dataService, /async getSessionReportRecords\(sessionId: string, limit = 120\)/);
assert.match(dataService, /\/api\/aba\/session-reports\/\$\{encodeURIComponent\(String\(sessionId\)\)\}\/records/);

// SessionMode can be opened in explicit read/revision mode for a completed session.
assert.match(sessionMode, /reviewSessionId = ''/);
assert.match(sessionMode, /const isCompletedSessionReview = Boolean\(requestedReviewSessionId\)/);
assert.match(sessionMode, /Promise\.all\(\[[\s\S]*?dataService\.getSessionReport\(sessionId\),[\s\S]*?dataService\.getSessionReportRecords\(sessionId, 160\)/);
assert.match(sessionMode, /measurementModelVersion: 'V3'/);
assert.match(sessionMode, /abaV3ActionDisplayLabel\(v3ActionKey\)/);
assert.match(sessionMode, /score: null/);
assert.match(sessionMode, /Editar complementos autorizados/);
assert.match(sessionMode, /openV3Revision\(record, 'CORRECT'\)/);
assert.match(sessionMode, /openV3Revision\(record, 'VOID'\)/);

// The exact session can be reached both from Agenda and from the patient chart.
assert.match(calendar, /sessionReportId: detailLinkedAbaSessionId/);
assert.match(calendar, /Relatório da sessão/);
assert.match(calendar, /canViewAbaSessionReport = capabilities instanceof Set/);
assert.match(calendar, /!detailLinkedAbaSessionId \|\| canViewAbaSessionReport/);
assert.match(dashboard, /capabilities=\{effectiveCapabilities\}/);
const receptionistDefaultsStart = authorizationModel.indexOf('receptionist: internal(');
const receptionistDefaultsEnd = authorizationModel.indexOf('biller: internal(', receptionistDefaultsStart);
assert.ok(receptionistDefaultsStart >= 0 && receptionistDefaultsEnd > receptionistDefaultsStart, 'receptionist defaults must exist');
assert.doesNotMatch(authorizationModel.slice(receptionistDefaultsStart, receptionistDefaultsEnd), /aba\.analytics\.view/, 'receptionists must be denied session-report analytics by default');
assert.match(authorizationModel, /key: 'aba\.analytics\.view'[\s\S]{0,180}?delegable: true/, 'a superior may explicitly delegate the sensitive report capability');
assert.match(patientDetail, /Relatórios de sessão/);
assert.match(patientDetail, /Abrir relatório/);
assert.match(patientDetail, /reviewSessionId=\{requestedSessionReportId\}/);
assert.match(patientDetail, /openCompletedReport=\{Boolean\(requestedSessionReportId\)\}/);

// F5 while reviewing a completed report preserves the exact session context.
assert.match(dashboard, /patientSessionReportId/);
assert.match(dashboard, /patientSessionReportId: patientSessionReportId \|\| null/);
assert.match(dashboard, /const nextSessionReportId = String\(state\?\.patientSessionReportId \|\| ""\)\.trim\(\)/);
assert.match(dashboard, /setPatientSessionReportId\(nextSessionReportId\)/);
assert.match(dashboard, /sessionReportId=\{patientSessionReportId\}/);

// Case-team cards show the real specialty only; the generic case-role label remains
// a relationship concept but is not duplicated next to every specialty in the UI.
assert.doesNotMatch(caseTeam, /patientProfessionalCaseRoleLabel/);
assert.match(caseTeam, /link\.specialty/);

console.log('ABA completed-session report access contracts: OK');
