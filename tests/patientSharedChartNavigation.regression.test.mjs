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
assert.match(workspace, /data-testid="chart-sharing-dropdown"/, 'publication settings must live in a discreet top-of-charts dropdown');
assert.match(workspace, /aria-expanded=\{sharingMenuOpen\}/, 'dropdown must announce expanded state');
assert.match(workspace, /aria-controls="chart-sharing-dropdown-panel"/, 'dropdown must expose the controlled panel');
assert.match(workspace, /sharingMenuOpen \? 'absolute' : 'hidden'/, 'sharing controls are hidden without taking graph space when closed');
assert.match(workspace, /document\.addEventListener\('pointerdown', onPointerDown\)/, 'dropdown must close on click outside');
assert.match(workspace, /event\.key === 'Escape'/, 'dropdown must close with Escape');
assert.match(workspace, /<ProfessionalSharedChartControl key=\{patientId\} patientId=\{patientId\} descriptor=\{descriptor\}/,
  'the same authorized publication control must be used for PTS and ABA V3');
assert.doesNotMatch(workspace, /shareControl=\{<ProfessionalSharedChartControl/, 'publication card must not remain beneath the graph');
assert.doesNotMatch(workspace, /view === 'aba-v3' && showAbaV3Details && \(\s*<ProfessionalSharedChartControl/,
  'ABA V3 publication control must not create another full-width row');
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

// Compact clinical publication controls must remain accessible and draft-only.
// Visual changes must not move the Save authority or the case-delegation gate.
const delegationPanel = read('src/components/PatientSharedChartDelegationPanel.tsx');
assert.match(control, /data-professional-shared-chart className=\{\`min-w-0 space-y-3 px-1 py-1/,
  'the dropdown must not contain another large bordered publication card');
assert.match(control, /flex min-h-10 w-full cursor-pointer items-center gap-2\.5 rounded-lg border/,
  'publish checkbox has a full-width row rather than competing with the actions');
assert.match(control, /<span className="whitespace-nowrap">Exibir no portal do paciente<\/span>/,
  'shortened publication label must not wrap');
assert.match(control, /flex flex-wrap items-center justify-end gap-2/,
  'Save and removal controls stay aligned in their own action row');
assert.match(control, /grid grid-cols-1 gap-y-1 sm:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1\.55fr\)\]/,
  'domains use one column on mobile and balanced columns on desktop');
assert.match(control, /min-w-0 cursor-pointer items-center gap-2 whitespace-nowrap text-xs/,
  'domain labels must not break into multiple lines');
assert.match(control, /aria-live="polite"/, 'published-state indicator announces status changes');
assert.match(control, /disabled=\{busy \|\| !dirty\} onClick=\{\(\) => void save\(\)\}/,
  'the explicit Save remains the only authority for publication changes');
assert.match(control, /setDraftClearAll\(true\); setDraftEnabled\(false\)/,
  'removal remains a draft that requires Save');
assert.match(control, /confirm\('Retirar o gráfico do painel do paciente/,
  'removal still requires confirmation before persistence');
assert.match(control, /governance\.canDelegate && <PatientSharedChartDelegationPanel/,
  'case permissions remain visible only when authorized');
assert.match(delegationPanel, /!open\) return;/, 'authorization details load only when explicitly opened');
assert.match(delegationPanel, /min-h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border/,
  'case authorization must look like an actual button');
assert.match(delegationPanel, /border-slate-300 bg-white text-slate-700 shadow-sm/,
  'case authorization must have visible border, background and text');
assert.match(delegationPanel, /focus-visible:ring-2 focus-visible:ring-violet-500/,
  'authorization must be keyboard accessible');
assert.match(control, /<PatientSharedChartDelegationPanel key=\{patientId\} patientId=\{patientId\} isDark=\{isDark\}/,
  'case authorization uses current theme and current patient');
assert.doesNotMatch(control, /border-violet-100 bg-violet-50\/40/,
  'full-width tinted legacy sharing panel must not return');

console.log('patientSharedChartNavigation.regression.test.mjs: PASS');
