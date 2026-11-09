import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(path, 'utf8');

const routes = read('services/patientSharedChartRoutes.ts');
const control = read('src/components/ProfessionalSharedChartControl.tsx');
const portal = read('src/components/PortalSharedClinicalChart.tsx');
const workspace = read('src/components/ClinicalChartsWorkspace.tsx');
const dashboard = read('src/components/ClinicalOutcomesDashboard.tsx');
const shell = read('src/components/ClinicalPlanAnalyticsShell.tsx');

// The database must remain the authority: one publication or none, case/clinic
// permissions checked on every mutation and patient-scoped server projection.
for (const token of [
  'SHARED_CHART_CASE_PUBLISH_DENIED',
  'checkSharedChartProfessionalPatientScope',
  'requirePatientSharedChartPortalScope',
  'readSharedChartSelection(clinicId, patientId)',
  'set_patient_shared_chart_selection_v2',
  'clear_patient_shared_chart_selection_v2',
]) assert.ok(routes.includes(token), 'missing hard gate: ' + token);
assert.match(routes, /requestedDomains\.length > \(overview \? 4 : 3\)/, 'server bounds supplementary tabs by selected chart');
assert.match(routes, /allowedDomains\.some/, 'server validates tab allowlist');
assert.match(routes, /new Set\(allowedDomains\)\.size !== allowedDomains\.length/, 'duplicate tabs rejected');
assert.match(routes, /requestedPlanIds\.includes\(/, 'supplementary tabs limited to selected authorized plan IDs');
assert.match(routes, /planIds\.length > 12/, 'overview descriptor must cap server-authorized plans');
assert.match(routes, /planIds\.some\(\(id: string\) => !isUuid\(id\)\)/, 'overview rejects forged plan IDs');
assert.match(routes, /filterTherapeuticPlanScopesForActor/, 'specialty plan selection must be actor-scoped');
assert.match(routes, /requestedPlanIds\.some\(\(planId\) => !allowedPlanIds\.has\(planId\)\)/, 'server denies unauthorized plans');
assert.match(routes, /buildPtsClusteredSpecialtyMetrics\(/, 'grouped projection is recomputed server-side');
assert.match(routes, /item\.id === descriptor\.metricSignature/, 'server rejects mismatched metric signature');
assert.match(routes, /if \(overview && !groupedMetric\) return null/, 'overview without valid canonical measure cannot publish');
assert.match(routes, /classify\(series\) === domain/, 'server independently classifies supplementary views');
const additionalViews = routes.slice(routes.indexOf('const additionalViews ='), routes.indexOf('return {\n      family: \'PLAN_PTS\'', routes.indexOf('const additionalViews =')));
assert.doesNotMatch(additionalViews, /supabase\.|await /, 'navigation must not create N+1 queries');

// A checkbox is draft-only until the server acknowledges the explicit Save.
// Changing plans must not publish automatically, and clearing must not
// delete clinical observations.
assert.match(control, /type="checkbox"/);
assert.match(control, /Exibir este gráfico no portal do paciente/);
assert.match(control, /Permitir navegação por outras abas/);
assert.match(control, /Não exibir nenhum gráfico/);
assert.match(control, /Salvar/);
assert.match(control, /setPatientSharedChartSelection\(patientId, nextDescriptor\)/);
assert.match(control, /clearPatientSharedChartSelection\(patientId\)/);
assert.match(control, /result\?\.success !== true/);
assert.doesNotMatch(control, /setPatientSharedChartSelection\(patientId, descriptor\);\s*setConfirmed/, 'do not fake save success');
assert.match(workspace, /shareControl=\{<ProfessionalSharedChartControl/, 'publication control belongs to plan chart');
assert.match(dashboard, /shareControl=\{shareControl\}/, 'current graph renders its control');
assert.match(shell, /data-testid="clinical-chart-sharing-controls"/);

// Patient gets only the one server-selected graph with optional approved tabs;
// no raw professional read API, no client-managed unrestricted domain switch.
assert.match(portal, /Array\.isArray\(chart\.views\)/);
assert.match(portal, /sharedChart\.views\.map/, 'tab list comes from the server projection');
assert.match(portal, /activeView\.series\.map/, 'chart data comes from selected authorized tab');
assert.match(portal, /chart\.grouped\?\.plans/, 'PTS bars come from scoped server projection');
assert.match(portal, /sharedChart\.grouped\.plans\.map/, 'patient grouped bars use only projected specialties');
assert.match(shell, /domain: 'overview'/, 'PTS general chart can be explicitly selected for publication');
assert.match(shell, /planIds: ptsSpecialtyPlans\.map/, 'PTS selection carries plan identities, not client-computed scores');
assert.doesNotMatch(portal, /getClinicalOutcomesDashboard|getAbaChartSeriesBundle|supabase|\.rpc\(/);
assert.match(shell, /PtsClusteredSpecialtyProgress/, 'PTS overview compares specialties');
console.log('patientSharedChartNavigation.regression.test.mjs: PASS');
