import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

const coordinator = read('src/components/CoordinatorDashboard.tsx');
const app = read('src/App.tsx');
const server = read('server.ts');
const dataService = read('src/services/dataService.ts');
const eligibility = read('src/utils/patientInsuranceEligibility.ts');
const financialPlan = read('src/utils/patientFinancialPlan.ts');
const routeFallbacks = read('src/utils/routeSchemaFallbacks.ts');
const migration = read('supabase/migrations/20260806100000_patient_insurance_payer_link.sql');
const checks = read('supabase/verification/20260806100000_patient_insurance_payer_link_checks.sql');

assert.doesNotMatch(coordinator, /const\s+insuranceOptions\s*=/);
assert.match(coordinator, /dataService\.getPayerOptions\(\{\s*limit:\s*80\s*\}\)/);
assert.match(coordinator, /value=\{newPatientForm\.convenioPayerId\}/);
assert.match(coordinator, /handlePatientFormChange\("convenioPayerId"/);
assert.match(coordinator, /Nenhum convênio ativo cadastrado pela clínica/);
assert.doesNotMatch(coordinator, /insuranceOptions\.map/);
assert.match(coordinator, /insurancePayerId:\s*newPatientForm\.convenioTipo/);
assert.match(coordinator, /Selecione um convênio ativo cadastrado pela clínica/);
assert.match(coordinator, /payerNameMatches\.length === 1/);
assert.match(coordinator, /histórico inativo/);

assert.match(dataService, /async getPayerOptions/);
assert.match(dataService, /endpointWithQuery\('\/api\/payer-options'/);
assert.match(server, /app\.get\('\/api\/payer-options'/);
assert.match(server, /requireRoles\('coordinator', 'receptionist', 'admin', 'owner'\)/);
assert.match(server, /\.eq\('organization_id', organizationId\)/);
assert.match(server, /\.select\('id,name,payer_type,status'\)/);
assert.match(server, /\.eq\('payer_type', 'INSURANCE'\)/);
assert.match(server, /resolvePatientInsurancePayerSelection/);
assert.match(server, /insurance_payer_id:\s*\(\(\) =>/);
assert.match(server, /PATIENT_INSURANCE_PAYER_INVALID/);
assert.match(server, /allowInactivePayerId/);

assert.match(eligibility, /insurancePayerId:\s*string/);
assert.match(eligibility, /root\.insurance_payer_id/);
assert.match(eligibility, /convenioPayerId:\s*insurancePayerId/);
assert.match(financialPlan, /fallback\.insurance_payer_id/);
assert.match(routeFallbacks, /'insurance_payer_id'/);

assert.match(app, /canonicalPatientPayerId/);
assert.match(app, /financialContextType = 'INSURANCE'/);
assert.match(app, /insurance_payer_id:\s*updatedInsuranceEligibility\.insurancePayerId/);
assert.match(app, /insurancePayerId:\s*data\.insurancePayerId/);

assert.match(migration, /^begin;/m);
assert.match(migration, /add column if not exists insurance_payer_id uuid/);
assert.match(migration, /references public\.clinic_payers\(id\) on delete set null/);
assert.match(migration, /PATIENT_INSURANCE_PAYER_SCOPE_MISMATCH/);
assert.match(migration, /payer\.payer_type/);
assert.match(migration, /before insert or update of insurance_payer_id, clinic_id/);
assert.match(migration, /commit;/);
assert.doesNotMatch(migration, /\btruncate\b/i);
assert.doesNotMatch(migration, /\bdelete\s+from\b/i);
assert.doesNotMatch(migration, /\bdrop\s+table\b/i);
assert.match(checks, /Expected: zero rows/);
assert.doesNotMatch(checks, /\bupdate\b/i);
assert.doesNotMatch(checks, /\binsert\b/i);
assert.doesNotMatch(checks, /\bdelete\b/i);

console.log('patientInsurancePayerLink: 38/38 checks passed');
