// One-time, exact-anchor patch for the existing 4.3 MB server.ts file.
// This script does not read variables, credentials, runtime services or patients.
// It must fail closed on branch drift or multiple matches.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const path = 'server.ts';
let source = readFileSync(path, 'utf8');
const replacements = [
  [
    "      service_type: sanitizeString(plan.serviceType, 60) || 'CUSTOM',\n      custom_service_name:",
    "      service_type: sanitizeString(plan.serviceType, 60) || 'CUSTOM',\n      professional_user_id: isUuid(sanitizeString(plan.professionalUserId, 120)) ? sanitizeString(plan.professionalUserId, 120) : null,\n      custom_service_name:",
  ],
  [
    "  const reconciliation = await supabase.rpc('reconcile_patient_financial_plans_v2', {",
    "  const reconciliation = await supabase.rpc('reconcile_patient_financial_plans_v3', {",
  ],
  [
    "    if (isMissingRelationError(reconciliation.error) || message.includes('reconcile_patient_financial_plans_v2')) {",
    "    if (isMissingRelationError(reconciliation.error) || message.includes('reconcile_patient_financial_plans_v3')) {",
  ],
];
replacements.push([
  "const PATIENT_FINANCIAL_PLAN_BASE_SELECT = [\\n  'id',\\n  'organization_id',\\n  'patient_id',\\n  'service_type',",
  "const PATIENT_FINANCIAL_PLAN_BASE_SELECT = [\\n  'id',\\n  'organization_id',\\n  'patient_id',\\n  'service_type',\\n  'professional_user_id',",
]);
for (const [oldText, newText] of replacements) {
  if (source.includes(newText)) continue;
  assert.equal(source.split(oldText).length - 1, 1, 'unexpected server source drift');
  source = source.replace(oldText, newText);
}
assert.match(source, /validateActiveClinicFinancialPlanSpecialties\(/);
assert.match(source, /professional_user_id: isUuid\(/);
assert.match(source, /supabase\.rpc\('reconcile_patient_financial_plans_v3'/);
writeFileSync(path, source, 'utf8');
console.log('P0-352: updated three exact backend contracts in server.ts');
