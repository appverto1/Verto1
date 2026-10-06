import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const entrypoint = readFileSync('services/clinicalMeasurementV3Routes.ts', 'utf8');
const planRoutes = readFileSync('services/clinicalMeasurementV3PlanRoutes.ts', 'utf8');
const catalogRoutes = readFileSync('services/clinicalMeasurementV3CatalogRoutes.ts', 'utf8');
const shared = readFileSync('services/clinicalMeasurementV3Shared.ts', 'utf8');
const server = readFileSync('server.ts', 'utf8');

assert.match(server, /registerClinicalMeasurementV3Routes/);
assert.match(entrypoint, /registerClinicalMeasurementV3PlanRoutes\(app, deps\)/);
assert.match(entrypoint, /registerClinicalMeasurementV3CatalogRoutes\(app, deps\)/);
assert.doesNotMatch(entrypoint, /app\.(get|post|patch|put|delete)\(/);

assert.match(planRoutes, /\/api\/clinical-measurement-v3\/patients\/:patientId\/plan-measurements/);
assert.match(planRoutes, /\/api\/clinical-measurement-v3\/patients\/:patientId\/plan-outcomes/);
assert.doesNotMatch(planRoutes, /\/catalog|\/targets\/:targetId\/view/);

assert.match(catalogRoutes, /\/api\/clinical-measurement-v3\/patients\/:patientId\/catalog/);
assert.match(catalogRoutes, /\/api\/clinical-measurement-v3\/patients\/:patientId\/targets\/:targetId\/view/);
assert.doesNotMatch(catalogRoutes, /\/plan-measurements|\/plan-outcomes/);

assert.match(shared, /ClinicalMeasurementV3Deps/);
assert.match(shared, /SUMMARY_TABLES/);
assert.match(shared, /directionalityFrom/);

console.log('clinicalMeasurementV3RouteModularization.regression: PASS');
