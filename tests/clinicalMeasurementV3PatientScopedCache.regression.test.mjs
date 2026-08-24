import assert from 'node:assert/strict';
import fs from 'node:fs';

const cache = fs.readFileSync('src/services/clinicalAnalyticsQueryCache.ts', 'utf8');
const dashboard = fs.readFileSync('src/components/ClinicalOutcomesDashboard.tsx', 'utf8');
const aba = fs.readFileSync('src/components/AbaV3ClinicalChartPanel.tsx', 'utf8');
const universal = fs.readFileSync('src/components/ClinicalMeasurementV3Panel.tsx', 'utf8');
const workspace = fs.readFileSync('src/components/ClinicalChartsWorkspace.tsx', 'utf8');
const patient = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');

assert.match(cache, /CACHE_VERSION = 'clinical-analytics-v3-cache-v1'/);
assert.match(cache, /clean\(scope\.organizationId\).*clean\(scope\.patientId\)/s, 'cache scope must include organization and patient');
assert.match(cache, /stableValue\(scope\.params \|\| \{\}\)/, 'query parameters must participate in the cache key');
assert.match(cache, /entry\.requestId !== requestId/, 'late requests must not overwrite newer results');
assert.match(cache, /Never carry committed clinical data across patient\/organization scope changes/, 'previous data must be dropped when patient/organization scope changes');
assert.match(cache, /keepPreviousData/, 'same-patient query transitions should preserve committed data');
assert.match(cache, /BroadcastChannel\('verto-clinical-analytics-v3'\)/, 'multi-tab invalidation must be present');
assert.match(cache, /channel\.postMessage\(\{ patientHash, family, revision \}\)/, 'cross-tab payload must contain only opaque scope hash, family and revision');
assert.doesNotMatch(cache.match(/channel\.postMessage\([\s\S]*?\);/)?.[0] || '', /patientId|organizationId|observations|payload|value/, 'broadcast payload must not expose patient identifiers or clinical values');

assert.match(dashboard, /useClinicalAnalyticsQuery/);
assert.match(dashboard, /committedPeriodRange/);
assert.match(dashboard, /effectivePeriodRange/, 'period filters must swap atomically with committed data');
assert.doesNotMatch(dashboard, /setData\(EMPTY_DATA\)/, 'refresh failures must not blank already committed clinical data');
assert.match(aba, /family: 'aba-v3-catalog-overview'/);
assert.match(aba, /family: 'aba-v3-series-bundle'/);
assert.match(universal, /family: 'clinical-measurement-v3-catalog'/);
assert.match(universal, /family: 'clinical-measurement-v3-view'/);
assert.match(workspace, /organizationId=\{organizationId\}/, 'organization scope must propagate to all V3 analytic panels');
assert.match(patient, /organizationId=\{String\(resolvedClinicContext\?\.clinicId/, 'patient workspace must seed analytics cache with active clinic scope');

assert.match(dataService, /invalidateClinicalAnalyticsPatient\(safePatientId, 'all'\)/, 'confirmed clinical writes must invalidate patient query families');
assert.match(dataService, /pending !== true\) notifyClinicalOutcomesChanged/, 'offline queued writes must not trigger a false server-confirmed refresh');

console.log('clinicalMeasurementV3PatientScopedCache.regression.test.mjs: ok');
