import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detail = readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const chart = readFileSync('src/components/ClinicalOutcomesDashboard.tsx', 'utf8');
const shell = readFileSync('src/components/ClinicalPlanAnalyticsShell.tsx', 'utf8');
const scopes = readFileSync('src/utils/clinicalOutcomePlanScope.ts', 'utf8');

// P1 17: the UI must not call the API while an explicit capability set is
// empty during hydration. This is presentation gating, not authorization.
assert.match(detail, /const hasClinicalChartCapabilityContext = capabilities instanceof Set/);
assert.match(detail, /const canRequestClinicalCharts = !hasClinicalChartCapabilityContext\s*\|\| \(hasCapability\('clinical\.record\.view'\)/);
assert.match(detail, /hasCapability\('treatment_plan\.view'\) \|\| hasCapability\('aba\.analytics\.view'\)/);
assert.match(detail, /activeTab === 'aba-charts' \? \(\s*canRequestClinicalCharts \? <div/);
assert.match(detail, /<ClinicalChartsWorkspace patientId=/, 'chart loading stays under the F5 capability gate');
assert.match(detail, /Gráficos clínicos indisponíveis para as permissões atuais/);

// P1 13-16: every specialty plan reuses the same detail + overview read model.
assert.match(chart, /selectedPlanSeries = useMemo/);
assert.match(chart, /buildClinicalTargetGroups\(selectedPlanSeries\)/);
assert.match(chart, /<SeriesChart series=\{series\}/);
assert.match(chart, /scopeId === 'pts'\s*\? ptsAnalyticsSeries\s*: selectedPlanSeries\.filter/);
assert.match(chart, /<ClinicalPlanAnalyticsShell/);
assert.match(shell, /stackId="domains"/);
assert.match(scopes, /rows\.length > 0 && rows\.every/);
assert.match(scopes, /clinicalSpecialtiesMatch\(row\.specialty, specialty\)/);
assert.doesNotMatch(scopes, /return\s+clinicalSpecialtiesMatch\(series\.specialty, specialty\)/,
  'single series label is not enough to attribute mixed behavior evidence');

console.log('p1ClinicalChartHydration.regression.test.mjs: ok');
