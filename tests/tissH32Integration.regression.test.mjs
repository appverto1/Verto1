import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const conference = fs.readFileSync('src/components/MonthlyConferenceCenter.tsx', 'utf8');
const tissUi = fs.readFileSync('src/components/TissPreGuideTab.tsx', 'utf8');

assert.match(server, /supabase\.rpc\('apply_tiss_official_tracking_mutation_v1'/);
for (const operation of ['mark_sent', 'register_return', 'guide_settlement', 'appeal_update']) {
  assert.match(server, new RegExp(`operation: '${operation}'`));
}
assert.match(server, /app\.post\('\/api\/tiss\/official-documents\/:documentId\/reissue'[\s\S]{0,260}requireClinicCapability\('billing\.xml\.generate'\)/);
assert.match(server, /supabase\.rpc\('reissue_tiss_official_document_v1'/);
assert.match(server, /buildTissAtomicIdempotencyKey/);

const filterResolver = server.slice(server.indexOf('const resolveConferenceFinancialPlanPatientIds'), server.indexOf('const applyConferenceFilters'));
assert.match(filterResolver, /from\('patient_financial_plans'\)/);
assert.match(filterResolver, /select\('patient_id'\)/);
assert.match(filterResolver, /eq\('organization_id', clinicId\)/);
assert.match(filterResolver, /eq\('billing_mode', financialContextType\)/);
assert.match(filterResolver, /ilike\('insurance_plan_name', plan\)/);
assert.match(server, /financialPlanPatientIds[\s\S]{0,600}loadConferenceClosureRows/);
assert.match(dataService, /plan: options\.plan/);
assert.match(dataService, /financialContextType: options\.financialContextType/);
assert.match(conference, /\bPlano\b/);
assert.match(conference, /Contexto financeiro/);
assert.match(tissUi, /Reemitir XML/);

console.log('tissH32Integration.regression: ok');
