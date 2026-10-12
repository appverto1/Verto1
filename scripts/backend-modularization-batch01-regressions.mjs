// Explicit deterministic execution of the new tests introduced by batch 01.
// Keep this list bounded; a green pre-main ratchet alone does not prove these test files ran.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const testFiles = [
  'tests/schoolPayloadHash.test.ts',
  'tests/reminderSourcePayload.test.ts',
  'tests/clinicalMeasurementV3TargetCatalogRoutes.test.ts',
  'tests/deploymentEnvironmentHelpers.test.ts',
  'tests/distributedRuntimePrimitives.test.ts',
  'tests/schemaSelectColumnFilter.test.ts',
  'tests/pushSubscriptionNormalization.test.ts',
  'tests/clinicalMeasurementV3PlanOutcomesRoutes.test.ts',
  'tests/clinicAnnouncementDelivery.test.ts',
  'tests/reminderClinicLogoAssets.test.ts',
  'tests/clinicFinancialReadHandlersSourceParity.test.mjs',
  'tests/clinicFinancialReadHandlers.test.ts',
  'tests/tissPayerReadHandlersSourceParity.test.mjs',
  'tests/tissPayerReadHandlers.test.ts',
];

for (const file of testFiles) {
  if (!existsSync(file)) {
    console.error('[batch01] Missing expected test: ' + file);
    process.exit(1);
  }
  console.log('\n[batch01] node --import tsx ' + file);
  const result = spawnSync(process.execPath, ['--import', 'tsx', file], {
    stdio: 'inherit',
    timeout: 120_000,
  });
  if (result.error || result.status !== 0) {
    console.error('[batch01] FAIL: ' + file + ' (' + (result.error?.message || result.status || result.signal) + ')');
    process.exit(1);
  }
}
console.log('\n[batch01] PASS: all ' + testFiles.length + ' regression files executed.');
