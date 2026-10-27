/**
 * P0-504 alternative CI gate. Runs in the Docker build stage (Node 20 + npm ci).
 * Pure/source-contract regressions only; never calls Supabase, Stripe or production.
 * A nonzero result fails the Docker build BEFORE the new app can be deployed.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const tests = [
  'tests/sessionContinuationPolicy.regression.test.mjs',
  'tests/sessionContinuationTransactionPlan.test.mjs',
  'tests/sessionAutoFinalization.regression.test.mjs',
  'tests/sessionCompletionNoShow.regression.test.mjs',
  'tests/conventionalSessionLifecycle.regression.test.mjs',
  'tests/monthlySessionPatientBilling.regression.test.mjs',
  'tests/groupSessionAtomicReservation.test.mjs',
  'tests/groupSessionFinanceAtomicSql.test.ts',
  'tests/sessionSpecialtyIsolation.test.ts',
  'tests/appointmentCancellationReasons.test.ts',
];
for (const file of tests) {
  if (!existsSync(file)) {
    console.error('[P0-504 Railway gate] Required test missing: ' + file);
    process.exit(1);
  }
  const args = file.endsWith('.ts') ? ['--import', 'tsx', file] : [file];
  console.log('[P0-504 Railway gate] node ' + args.join(' '));
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    timeout: 120_000,
    env: {
      ...process.env,
      // Tests MUST NOT receive any runtime secrets. Block accidental remote access.
      DATABASE_URL: '',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      STRIPE_SECRET_KEY: '',
      RAILWAY_ENVIRONMENT: '',
    },
  });
  if (result.status !== 0 || result.error) {
    console.error('[P0-504 Railway gate] FAIL ' + file + ': ' +
      (result.error?.message || result.signal || String(result.status)));
    process.exit(1);
  }
}
console.log('[P0-504 Railway gate] PASS: ' + tests.length + ' regression files.');
