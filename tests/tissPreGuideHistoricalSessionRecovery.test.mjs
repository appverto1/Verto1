import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const panel = fs.readFileSync('src/components/PayerRequirementsPanel.tsx', 'utf8');

const route = server.match(/app\.get\('\/api\/tiss\/pre-guides\/test-options'[\s\S]*?const normalizeTissXmlCompetenceMonth/)?.[0] || '';
assert.ok(route, 'rota de opções da Pré-guia deve existir');
assert.match(route, /buildHistoricalPreGuideOptionsQuery/);
assert.match(route, /\.eq\('payer_id', payerId\)/);
assert.match(route, /\.gte\('scheduled_start', range\.fromIso\)/);
assert.match(route, /\.lte\('scheduled_start', range\.toIso\)/);
assert.match(route, /if \(patientId\) query = query\.eq\('patient_id', patientId\)/);
assert.match(route, /fetchClosureAppointmentRowsByIds\(/);
assert.match(route, /fetchLegacyClosurePeriodAppointmentRows\(/);
assert.match(route, /missingHistoricalAppointmentIds/);
assert.match(route, /preGuide\?\.scheduled_start/);
assert.match(route, /validationErrorCodes:/);
assert.doesNotMatch(route, /mirrorLegacyClosureAppointmentsForPeriod\(/, 'GET de teste não deve materializar/escrever atendimentos legados');

const revalidationHandler = server.match(/const handleTissPreGuideRevalidation = async[\s\S]*?app\.get\('\/api\/admin\/tiss\/provider-profile'/)?.[0] || '';
assert.ok(revalidationHandler, 'revalidação manual da Pré-guia deve existir');
assert.match(revalidationHandler, /fetchLegacyClinicStateAppointmentById\(/);
assert.match(revalidationHandler, /syncAppointmentsTableFromClinicState\(/);
assert.match(revalidationHandler, /TISS_HISTORICAL_APPOINTMENT_INCOMPLETE/);

const serviceResolver = server.match(/const fetchMatchingTussServiceCatalog = async \([\s\S]*?\n  };\n\n  const mappingIsValidForDate/)?.[0] || '';
assert.ok(serviceResolver, 'resolver de catálogo TUSS deve existir');
const historicalIndex = serviceResolver.indexOf('const historicalServiceId');
const fuzzyIndex = serviceResolver.indexOf('const serviceKey = normalizeBillingServiceMatchKey(serviceType)');
assert.ok(historicalIndex >= 0 && fuzzyIndex >= 0 && historicalIndex < fuzzyIndex, 'service_catalog_id histórico deve ser preservado antes do match textual');

assert.match(panel, /selectedAppointmentPreGuideErrorCodes\?: string\[\]/);
assert.match(panel, /PAYER_TUSS_MAPPING_MISSING/);
assert.match(panel, /PAYER_TUSS_MAPPING_EXPIRED/);
assert.match(panel, /status: hasLegacyTussCode \? "blocked" : allActiveMappingsReady \? "ready" : "incomplete"/);
assert.match(panel, /selectedAppointmentTestIssues/);
assert.match(panel, /A sessão selecionada não possui De\/Para TUSS válido para este procedimento e data\./);
assert.match(panel, /selectedSetupAppointmentPreGuideErrorCodes/);
assert.match(panel, /type="month"/);
assert.match(panel, /buildTissPreGuideTestMonthRange\(setupTestMonth\)/);
assert.match(panel, /Nenhuma sessão encontrada em/);

console.log('tissPreGuideHistoricalSessionRecovery: ok');
