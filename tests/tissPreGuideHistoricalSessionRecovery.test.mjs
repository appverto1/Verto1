import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const panel = fs.readFileSync('src/components/PayerRequirementsPanel.tsx', 'utf8');
const preGuideEngine = fs.readFileSync('src/services/tissPreGuideEngine.ts', 'utf8');

const route = server.match(/app\.get\('\/api\/tiss\/pre-guides\/test-options'[\s\S]*?const normalizeTissXmlCompetenceMonth/)?.[0] || '';
assert.ok(route, 'rota de opções da Pré-guia deve existir');
assert.match(route, /buildHistoricalPreGuideOptionsQuery/);
assert.match(route, /\.eq\('payer_id', payerId\)/);
assert.match(route, /\.gte\('scheduled_start', range\.fromIso\)/);
assert.match(route, /\.lte\('scheduled_start', range\.toIso\)/);
assert.match(route, /if \(patientId\) query = query\.eq\('patient_id', patientId\)/);
assert.match(route, /fetchClosureAppointmentRowsByIds\(/);
assert.match(route, /missingHistoricalAppointmentIds/);
assert.match(route, /preGuide\?\.scheduled_start/);
assert.match(route, /validationErrorCodes:/);
assert.doesNotMatch(route, /mirrorLegacyClosureAppointmentsForPeriod\(/, 'GET de teste não deve materializar/escrever atendimentos legados');

const serviceResolver = server.match(/const fetchMatchingTussServiceCatalog = async \([\s\S]*?\n  };\n\n  const mappingIsValidForDate/)?.[0] || '';
assert.ok(serviceResolver, 'resolver de catálogo TUSS deve existir');
const historicalIndex = serviceResolver.indexOf('const historicalServiceId');
const fuzzyIndex = serviceResolver.indexOf('const serviceKey = normalizeBillingServiceMatchKey(serviceType)');
assert.ok(historicalIndex >= 0 && fuzzyIndex >= 0 && historicalIndex < fuzzyIndex, 'service_catalog_id histórico deve ser preservado antes do match textual');

assert.match(preGuideEngine, /PAYER_TUSS_MAPPING_MISSING/);
assert.match(preGuideEngine, /PAYER_TUSS_MAPPING_EXPIRED/);
const readiness = panel.match(/export function getPayerSetupReadiness[\s\S]*?return \{\s*overallStatus/)?.[0] || '';
assert.ok(readiness, 'readiness da configuração do convênio deve existir');
assert.match(readiness, /status: hasLegacyTussCode \? "blocked" : allActiveMappingsReady \? "ready" : "incomplete"/);
assert.doesNotMatch(readiness, /selectedAppointmentPreGuideErrorCodes|selectedAppointmentMappingIssue/);

console.log('tissPreGuideHistoricalSessionRecovery: ok');
