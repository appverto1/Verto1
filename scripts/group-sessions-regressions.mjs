import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const tests = [
  ...readdirSync('tests').filter(name => /^group.*\.(ts|mjs)$/.test(name)).sort(),
  'patientFinancialPlanHistorySafePayersP0.regression.test.mjs',
  'patientFinancialPlanTissReadBoundary.regression.test.mjs',
  'patientFinancialPlanFinanceWithoutTissPayload.regression.test.mjs',
  'schedulingOverlappingRoomsPatientIdentity.test.ts',
  'appointmentFinancialSpecialtyPlanLinking.regression.test.mjs',
];
let failures = 0;
for (const name of tests) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tests/' + name], {
    encoding: 'utf8', timeout: 60_000, env: {...process.env, NODE_ENV: 'test'},
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {failures++; console.error('FAILED:', name);}
}
console.log(`Group session regressions: ${tests.length - failures}/${tests.length} passed`);
process.exitCode = failures ? 1 : 0;
