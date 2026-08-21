import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const dashboard = fs.readFileSync('src/components/ClinicalOutcomesDashboard.tsx', 'utf8');
const analytics = fs.readFileSync('src/utils/clinicalOutcomeAnalytics.ts', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');

const routeStart = server.indexOf("app.get('/api/patients/:patientId/clinical-outcomes-dashboard'");
const routeEnd = server.indexOf("app.get('/api/aba/patients/:patientId/charts/targets'", routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'clinical outcomes dashboard route must remain present');
const route = server.slice(routeStart, routeEnd);

assert.match(route, /noStoreDynamicResponse/, 'dashboard response must not be served as a stale 304 shell');
assert.equal((route.match(/supabase\.rpc\('read_clinical_outcomes_converged_v3'/g) || []).length, 1, 'one dashboard request must execute exactly one converged V3 bulk RPC');
assert.doesNotMatch(route, /for\s*\([^)]*target[^)]*\)[\s\S]{0,320}read_clinical_outcomes_converged_v3/i, 'converged V3 read must not regress into an N+1 target loop');
assert.match(route, /p_plan_ids:\s*visiblePlanIdList/);
assert.match(route, /p_therapeutic_objective_ids:\s*visibleObjectiveIds/);
assert.match(route, /p_program_ids:\s*visibleProgramIdList/, 'ABA V3 rows must be constrained to already-visible programs');
assert.match(route, /normalizeClinicalPlanOutcomesV3ForDashboard/);
assert.match(route, /objectivePlanMap/, 'therapeutic-objective V3 rows must be rebound only to already-visible plans');
assert.match(server, /sourceAuthority:\s*'canonical'/);
assert.match(server, /sourceKind === 'PLAN_GOAL' \|\| sourceKind === 'ABA_TARGET'/, 'ABA V3 rows must rebind only to their directly authorized plan');
assert.match(server, /ABA_V3_TARGET_CHART_READ_MODEL/, 'dashboard normalizer must preserve the canonical ABA V3 read-model provenance');
assert.match(route, /sourceAuthority:\s*'legacy'/);
assert.match(route, /mergeClinicalOutcomeRowsV3First\(v3PlanOutcomeRows, legacyOutcomeRows\)/, 'V3 must have precedence over an exact duplicate legacy point');
assert.match(server, /canonicalFingerprints/, 'dedupe must compare legacy rows against canonical V3 rows');
assert.match(server, /canonicalAbaSessionTargets/, 'an ABA V3 session-target must own its derived legacy snapshot equivalents');
assert.match(server, /sourceRecordType === 'aba_snapshot'/, 'legacy ABA snapshots must be suppressed only when canonical V3 owns the same session-target');
assert.match(server, /row\?\.value_details\?\.series_key/, 'ABA V3 dashboard item identity must remain stable across phase changes');
assert.match(server, /metric_value === null \|\| row\?\.metric_value === undefined/, 'legacy snapshot nulls must remain null instead of collapsing to zero');
assert.match(route, /legacyFallbackPreserved:\s*true/);
assert.match(route, /rawEventsRead:\s*false/);
assert.doesNotMatch(route, /clinical_measurement_raw|clinical_measurement_events_v3/i, 'dashboard hot path must never read raw V3 events');
assert.match(server, /projectionStale:\s*row\?\.projection_stale === true/);
assert.match(server, /canonical_value_unit/);
assert.match(server, /finiteClinicalOutcomeNumber/, 'null numeric values must not collapse to zero');

assert.match(analytics, /valueText\?: string \| null/);
assert.match(analytics, /value === null \|\| value === undefined \|\| value === ''/);
assert.doesNotMatch(analytics.match(/clinicalOutcomeSeriesKey[\s\S]*?\.join\('::'\);/)?.[0] || '', /observation\.source|observation\.context/, 'legacy → V3 source changes must not split an otherwise comparable series');
assert.match(analytics, /Boolean\(latest\.projectionStale\)/);
assert.match(analytics, /instrumentId === 'ABA_V3_PHASE'/, 'phase snapshots must not split one ABA metric into multiple dashboard cards');
assert.match(analytics, /no_directional_judgment/);

assert.match(dashboard, /categoricalMode/);
assert.match(dashboard, /isSegmentBoundary/, 'phase changes must break the line inside the same card instead of creating duplicate cards');
assert.match(dashboard, /series\.itemLabel \|\| series\.metricLabel/, 'clinical cards should lead with the target/item label when available');
assert.match(dashboard, /tickFormatter=\{categoricalMode/);
assert.match(dashboard, /V3 canônico/);
assert.match(dashboard, /verto:clinical-outcomes-changed/);
assert.match(dashboard, /v3ObservationCount/);

assert.match(dataService, /notifyClinicalOutcomesChanged/);
assert.match(dataService, /getClinicalOutcomesDashboard[\s\S]*?getNoStoreAuthHeaders\(\)/);
assert.match(dataService, /getClinicalOutcomesDashboard[\s\S]*?cache:\s*'no-store'/);
assert.match(dataService, /read_clinical_outcomes_converged_v3/);

console.log('clinicalMeasurementV3ClinicalOutcomesConvergence.regression.test.mjs: ok');
