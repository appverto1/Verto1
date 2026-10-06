import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = [
  readFileSync('services/clinicalMeasurementV3Routes.ts', 'utf8'),
  readFileSync('services/clinicalMeasurementV3PlanRoutes.ts', 'utf8'),
  readFileSync('services/clinicalMeasurementV3CatalogRoutes.ts', 'utf8'),
  readFileSync('services/clinicalMeasurementV3Shared.ts', 'utf8'),
].join('\n');
const dataService = readFileSync('src/services/dataService.ts', 'utf8');
const panel = readFileSync('src/components/ClinicalMeasurementV3Panel.tsx', 'utf8');
const workspace = readFileSync('src/components/ClinicalChartsWorkspace.tsx', 'utf8');
const patientDetail = readFileSync('src/components/PatientDetailView.tsx', 'utf8');

assert.match(routes, /\/api\/clinical-measurement-v3\/patients\/:patientId\/catalog/);
assert.match(routes, /clinical_measurement_targets_v3[\s\S]*clinical_measurement_definitions_v3/);
assert.match(routes, /\.eq\('organization_id',clinicId\)[\s\S]*\.eq\('patient_id',patientId\)/);
assert.match(dataService, /getClinicalMeasurementV3Catalog/);
assert.match(dataService, /getClinicalMeasurementV3View/);
assert.match(panel, /connectNulls=\{false\}/);
assert.match(panel, /TaskAnalysisMatrix/);
assert.match(panel, /ORDERED_CATEGORY_SERIES|OrdinalTimeline/);
assert.match(panel, /Distribuição de prompts/);
assert.match(panel, /nenhum prompt é convertido em score/i);
assert.match(panel, /A interface não calcula média, maestria, elegibilidade, IOA ou agregação clínica/i);
assert.doesNotMatch(panel, /reduce\([^\n]*=>[^\n]*\+[^\n]*measurement/i, 'frontend must not aggregate clinical measurements');
assert.match(workspace, /ABA Legacy[\s\S]*ABA V3[\s\S]*Métricas V3/);
assert.match(patientDetail, /showClinicalMeasurementV3Details=\{abaV3UiEnabled\}/);

console.log('clinicalMeasurementV3Presentation.test.mjs: ok');
