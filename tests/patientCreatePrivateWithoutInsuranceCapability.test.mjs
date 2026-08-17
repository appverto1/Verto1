import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');

// Private-pay patient creation deliberately submits insuranceType="particular"
// even when the clinic has no insurance/TISS module. This is identity/billing
// classification, not an insurance-management operation.
assert.match(
  coordinator,
  /insuranceType:\s*newPatientForm\.convenioTipo\s*\|\|\s*["']particular["']/,
  'patient form keeps the canonical private-pay classification',
);

assert.match(
  server,
  /const requestedInsuranceType = normalizePatientInsuranceTypeForPersistence\(requestedInsuranceTypeRaw\)/,
);
assert.match(
  server,
  /requestedInsuranceType !== 'particular'/,
  'particular/private classification alone must not require patient.insurance.create',
);
assert.match(
  server,
  /hasInsuranceCreatePayload = explicitlyRequestsInsuranceMode \|\| \[/,
);
assert.match(
  server,
  /hasInsuranceCreatePayload && !context\.capabilities\.has\('patient\.insurance\.create'\)/,
  'real insurance payload remains protected by capability enforcement',
);

for (const protectedAlias of [
  'insurancePayerId',
  'convenioNome',
  'convenioCarteirinha',
  'insuranceCardValidUntil',
  'insurancePlanCategory',
  'insuranceHolderCpf',
  'insuranceEligibilityNotes',
]) {
  assert.match(
    server,
    new RegExp(`req\\.body\\?\\.${protectedAlias}`),
    `${protectedAlias} must remain capability-protected`,
  );
}

console.log('patientCreatePrivateWithoutInsuranceCapability.test.mjs: ok');
