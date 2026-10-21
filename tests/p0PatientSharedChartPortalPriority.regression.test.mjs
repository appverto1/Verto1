import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (file) => readFileSync(file, 'utf8');
const patient = read('src/components/PatientDashboard.tsx');
const portal = read('src/components/PortalSharedClinicalChart.tsx');
const professional = read('src/components/ProfessionalSharedChartControl.tsx');
const workspace = read('src/components/ClinicalChartsWorkspace.tsx');
const routes = read('services/patientSharedChartRoutes.ts');
const registration = read('services/clinicAppointmentPolicyRoutes.ts');
const service = read('src/services/dataService.ts');
const shell = read('src/components/ClinicalPlanAnalyticsShell.tsx');
const aba = read('src/components/AbaV3ClinicalChartPanel.tsx');

assert.doesNotMatch(patient, /<EvolutionBarChart|<CumulativeGrowthChart|import \{ EvolutionBarChart \}|import \{ CumulativeGrowthChart \}/,
  'portal infantil cannot display either automatic graph or any legacy fallback');
assert.match(patient, /<PortalSharedClinicalChart patientId=/, 'infant portal reads only published graph');
assert.match(patient, /<AdultWellbeingTrendChart/, 'adult wellbeing graph must remain fixed and untouched');
assert.match(patient, /familyDiaryHistory/, 'family diary preserved');
assert.match(patient, /kidsGamification\.stars/, 'infant gamification preserved');

for (const text of ['Carregando evolução compartilhada', 'Nenhum gráfico foi compartilhado', 'Não foi possível carregar o gráfico compartilhado', 'Ainda não há dados disponíveis', 'Tentar novamente']) {
  assert.ok(portal.includes(text), 'patient read-only states missing: ' + text);
}
assert.match(portal, /dataService\.getPortalSharedChart\(patientId\)/);
assert.doesNotMatch(portal, /getAbaChartSeriesBundle|clinical_observations|patient_therapeutic_plans|\.rpc\(/,
  'browser never pulls raw clinical series or privileged RPCs');
assert.match(workspace, /<ProfessionalSharedChartControl/, 'professional graph workspace has sharing controls');
assert.match(workspace, /onShareDescriptorChange=\{onAbaDescriptorChange\}/);
assert.match(workspace, /onShareDescriptorChange=\{onPlanDescriptorChange\}/);
assert.match(professional, /dataService\.setPatientSharedChartSelection/);
assert.match(professional, /dataService\.clearPatientSharedChartSelection/);
assert.match(professional, /window\.confirm\('Substituir gráfico compartilhado/);
assert.match(professional, /window\.confirm\('Remover gráfico do painel do paciente/);
assert.match(shell, /ClinicalPlanShareDescriptor/, 'PLAN_PTS reuses existing canonical series');
assert.match(aba, /AbaV3ShareDescriptor/, 'ABA V3 reuse canonical target series descriptors');
assert.doesNotMatch(read('src/components/AbaClinicalChartsPanel.tsx'), /AbaV3ShareDescriptor|onShareDescriptorChange/, 'ABA legacy not publishable');

assert.match(registration, /registerPatientSharedChartRoutes\(app, deps\)/);
assert.match(routes, /checkSharedChartProfessionalPatientScope/, 'professionals must pass server-side patient scope validation');
assert.match(routes, /patient_file_actor_has_patient_access_v1/, 'server validates clinic-patient membership');
assert.match(routes, /requireAnyClinicCapability\('reports\.clinical\.indicators', 'aba\.analytics\.view'\)/);
assert.match(routes, /requirePatientSharedChartPortalScope/, 'portal must use session-derived patient scope');
assert.match(routes, /PORTAL_PATIENT_SCOPE_DENIED/, 'unknown patient scopes deny');
assert.match(routes, /set_patient_shared_chart_selection_v2/, 'server-owned mutation');
assert.match(routes, /clear_patient_shared_chart_selection_v2/, 'server-owned revoke');
assert.match(routes, /get_aba_chart_series_bundle_v3/, 'ABA shared chart uses existing canonical read model');
assert.match(routes, /summarizeClinicalOutcomeSeries/, 'PLAN_PTS uses existing clinical series builder');
assert.match(routes, /SHARED_CHART_REFERENCE_NOT_RESOLVABLE/, 'stale references fail closed');
for (const m of ['getPatientSharedChartSelection','setPatientSharedChartSelection','clearPatientSharedChartSelection','getPortalSharedChart']) assert.match(service, new RegExp('async '+m+'\\('));
assert.doesNotMatch(service, /\.rpc\('set_patient_shared_chart_selection_v2'|\.rpc\('clear_patient_shared_chart_selection_v2'/);
assert.ok(read('supabase/migrations/20260916115000_patient_shared_chart_selection_server_rpc_v2.sql').includes('service_role'));
console.log('p0PatientSharedChartPortalPriority: PASS');
