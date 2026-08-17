import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');

// Private-pay patient creation deliberately keeps insuranceType="particular"
// even when the clinic has no insurance/TISS module. This is a core patient
// classification, not an insurance-management operation.
assert.match(
  coordinator,
  /: \{ insuranceType: "particular" \};/,
  'new patient without TISS must remain explicitly classified as private-pay',
);

assert.match(
  server,
  /function patientPayloadRequestsInsuranceCreateCapability\(body: any\): boolean/,
);
assert.match(
  server,
  /normalizePatientInsuranceTypeForPersistence\(requestedTypeRaw\) !== 'particular'/,
  'particular/private classification alone must not require patient.insurance.create',
);
assert.match(
  server,
  /hasInsuranceCreatePayload = patientPayloadRequestsInsuranceCreateCapability\(req\.body\)/,
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
    new RegExp(`['\"]${protectedAlias}['\"]`),
    `${protectedAlias} must remain capability-protected`,
  );
}

console.log('patientCreatePrivateWithoutInsuranceCapability.test.mjs: ok');
