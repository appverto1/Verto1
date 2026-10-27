// Railway Staging CI replacement. Runs inside the existing Node 20 Docker build.
// These tests must never connect to production or modify external data.
// A failing test stops the build before deploy. Fail closed if a required test is missing.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const tests = [
  'tests/factoryRecoveryControls.regression.test.mjs',
  'tests/sessionCompletionNoShow.regression.test.mjs',
  'tests/sessionAutoFinalization.regression.test.mjs',
  'tests/conventionalSessionLifecycle.regression.test.mjs',
  'tests/monthlySessionPatientBilling.regression.test.mjs',
  'tests/sessionSpecialtyIsolation.test.ts',
  'tests/appointmentCancellationReasons.test.ts',
  'tests/groupSessionFinanceAtomicSql.test.ts',
  'tests/groupSessionAtomicReservation.test.mjs',
  'tests/salesProspectingKanban.regression.test.mjs',
  'tests/salesProspectingCadence.test.ts',
];
for (const file of tests) {
  if (!existsSync(file)) {
    console.error('[Railway staging CI] Required test missing: ' + file);
    process.exit(1);
  }
  const args = file.endsWith('.ts') ? ['--import', 'tsx', file] : [file];
  console.log('[Railway staging CI] Running ' + file);
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    timeout: 150_000,
    env: {
      ...process.env,
      DATABASE_URL: '',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      SUPABASE_ANON_KEY: '',
      STRIPE_SECRET_KEY: '',
      RAILWAY_ENVIRONMENT: '',
      NODE_ENV: 'test',
    },
  });
  if (result.error || result.status !== 0) {
    console.error('[Railway staging CI] Failed ' + file + ': ' +
      (result.error?.message || result.signal || String(result.status)));
    process.exit(1);
  }
}
console.log('[Railway staging CI] PASS: ' + tests.length + ' regression suites.');
