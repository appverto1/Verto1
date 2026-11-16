import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveEffectiveClinicCapabilities } from '../src/utils/authorizationRuntime.ts';

const dashboard = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const detail = readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const charts = readFileSync('src/components/ClinicalChartsWorkspace.tsx', 'utf8');
const publication = readFileSync('src/components/ProfessionalSharedChartControl.tsx', 'utf8');
const routes = readFileSync('services/patientSharedChartRoutes.ts', 'utf8');

// The server-backed capability is authoritative. A common specialist must
// never load protected anamnesis templates merely because their role is therapist.
const therapist = resolveEffectiveClinicCapabilities('therapist');
const supervisor = resolveEffectiveClinicCapabilities('supervisor');
const delegatedSupervisor = resolveEffectiveClinicCapabilities('therapist', [], { canSupervise: true });
assert.equal(therapist?.capabilities.has('clinical.anamnesis.view'), false);
assert.equal(therapist?.capabilities.has('clinical.anamnesis.edit'), false);
assert.equal(supervisor?.capabilities.has('clinical.anamnesis.view'), true);
assert.equal(delegatedSupervisor?.capabilities.has('clinical.anamnesis.view'), true);
assert.equal(therapist?.capabilities.has('calendar.team.view'), false);
assert.equal(supervisor?.capabilities.has('calendar.team.view'), true);
assert.equal(delegatedSupervisor?.capabilities.has('calendar.team.view'), true);
assert.match(dashboard, /const canLoadAnamnesisTemplate = hasCapability\("clinical\.anamnesis\.view"\);/);
assert.match(dashboard, /const canEditAnamnesisTemplate = canManageClinicSettings \|\| \(isDirectTherapist && hasCapability\("clinical\.anamnesis\.edit"\)\);/);
assert.doesNotMatch(dashboard, /const canLoadAnamnesisTemplate = [^;]*\|\| isDirectTherapist/);
assert.match(dashboard, /if \(authorizationHydrated && canLoadAnamnesisTemplate\) loadClinicAnamnesisTemplate\(\)/);

// Clinical chart visibility remains available; ordinary specialists do not
// inherit an ability to publish a chart solely from viewing that chart.
assert.match(detail, /const canRequestClinicalCharts = !hasClinicalChartCapabilityContext/);
assert.match(detail, /const canManagePatientChartSharing =\s*\['director', 'coordinator', 'supervisor'\]\.includes\(normalizedChartActorRole\)/);
assert.match(detail, /normalizedChartActorRole === 'therapist' && hasCapability\('calendar\.team\.view'\)/);
assert.equal((detail.match(/<ClinicalChartsWorkspace patientId=\{String\(patient\.id\)\} canManagePatientChartSharing=\{canManagePatientChartSharing\}/g) || []).length, 2);

// The publishing component is never mounted for ordinary specialists and
// is lazy for authorized users; toggling the dropdown must not prefetch data.
assert.match(charts, /\{sharingMenuActivated && \(canManagePatientChartSharing\s*\? <ProfessionalSharedChartControl/);
assert.match(charts, /onClick=\{\(\) => \{ setSharingMenuActivated\(true\); setSharingMenuOpen/);
assert.match(charts, /setSharingMenuActivated\(false\);\s*\}, \[patientId\]\)/);
assert.ok(charts.includes('Você não tem permissão para compartilhar gráficos com pacientes'));
assert.match(charts, /<p role="status"[^>]*>Você não tem permissão para compartilhar gráficos com pacientes<\/p>/);
assert.match(publication, /dataService\.getPatientSharedChartSelection\(patientId\)/);
assert.match(publication, /if \(!ready \|\| !governance\.canPublish \|\| busy \|\| !dirty\) return;/);
assert.match(routes, /checkSharedChartProfessionalPatientScope/);
assert.match(routes, /SHARED_CHART_SCOPE_DENIED/);

console.log('therapistAnamnesisChartShare.regression.test.mjs: OK');
