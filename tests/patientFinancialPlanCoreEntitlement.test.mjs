import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const modules = fs.readFileSync('src/constants/organizationModules.ts', 'utf8');

// Full financial management remains an add-on.
assert.match(modules, /\['finance\.', 'financial_management'\]/);
assert.match(coordinator, /financial: "financial_management"/);

// Patient treatment pricing is core and must remain available even when the
// clinic did not contract the financial-management add-on.
assert.match(coordinator, /const canManagePatientFinancialPlan = hasCapability\("patient\.demographics\.edit"\);/);
assert.match(coordinator, /canManagePatientFinancialPlan[\s\S]{0,220}id: "financial"/);
assert.match(coordinator, /const financialPlans = canManagePatientFinancialPlan/);
assert.match(coordinator, /\{canManagePatientFinancialPlan && activePatientRegistrationTab === "financial"/);
assert.match(server, /app\.get\('\/api\/patients\/:patientId\/financial-plans', checkAuth, requireClinicCapability\('patient\.demographics\.edit'\)/);

// Insurance/TISS remains separately optional and cannot leak through a nested
// financial-plan payload.
assert.match(coordinator, /hasInsuranceTissModule && canViewPatientInsurance/);
assert.match(coordinator, /hasInsuranceTissModule && canViewPatientTissAuthorizations/);
assert.match(coordinator, /filter\(\(option\) => canAccessClinicFinance \|\| hasInsuranceTissModule \|\| option\.value !== "INSURANCE"\)/);
assert.match(server, /source\?\.recordPayload\?\.financialPlans/);
assert.match(server, /function patientPayloadRequestsGenericPayerCapability[\s\S]{0,2200}normalizedMode === 'INSURANCE'/);
assert.match(server, /billingMode=INSURANCE and payer identity are generic financial master data/);
assert.match(server, /PATIENT_INSURANCE_EDIT_CAPABILITY_REQUIRED/);

console.log('patientFinancialPlanCoreEntitlement.test.mjs: ok');
