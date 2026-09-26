import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.cwd());
const failures = [];
const passes = [];

const pass = (label) => passes.push(label);
const fail = (label, detail = '') => failures.push({ label, detail });

const requireFile = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    fail(`arquivo obrigatório: ${path}`, 'não encontrado');
    return null;
  }
  pass(`arquivo obrigatório: ${path}`);
  return readFileSync(absolute, 'utf8');
};

const requiredMigrations = [
  'supabase/migrations/20260826143000_pts_document_lineage_events_v2.sql',
  'supabase/migrations/20260826152500_therapeutic_plan_rebac_hierarchy_v1.sql',
  'supabase/migrations/20260826154500_specialty_session_pts_context_binding_v1.sql',
  'supabase/migrations/20260826174500_clinic_canonical_timezone_v1.sql',
  'supabase/migrations/20260826183000_patient_case_team_coordinator_authority_v2.sql',
  'supabase/migrations/20260826190000_pts_draft_persistence_activation_v3.sql',
  'supabase/migrations/20260826200000_patient_case_team_manager_removal_v3.sql',
  'supabase/migrations/20260826211500_patient_primary_pointer_nullable_v1.sql',
];

for (const migrationPath of requiredMigrations) {
  const sql = requireFile(migrationPath);
  if (!sql) continue;
  if (!/\bbegin\s*;/i.test(sql) || !/\bcommit\s*;/i.test(sql)) {
    fail(`transação SQL: ${migrationPath}`, 'migration sem BEGIN/COMMIT explícitos');
  } else {
    pass(`transação SQL: ${migrationPath}`);
  }
  const malformedComment = sql.split(/\r?\n/).find((line) => /^\s*-[^-]/.test(line));
  if (malformedComment) {
    fail(`comentários SQL: ${migrationPath}`, `linha inválida: ${malformedComment.trim()}`);
  } else {
    pass(`comentários SQL: ${migrationPath}`);
  }
}

const rebacMigration = readFileSync(join(root, requiredMigrations[1]), 'utf8');
if (/create or replace function public\.therapeutic_patient_actor_has_link_permission_v1\s*\(/i.test(rebacMigration)) {
  pass('ReBAC migration autossuficiente');
} else {
  fail('ReBAC migration autossuficiente', 'helper therapeutic_patient_actor_has_link_permission_v1 ausente');
}

const removalMigration = readFileSync(join(root, requiredMigrations[6]), 'utf8');
for (const contract of [
  'patient_case_team_actor_can_manage_v1',
  'end_patient_professional_link_v1',
  'PATIENT_PROFESSIONAL_LINK_PROTECTED_CLINIC_MANAGER',
]) {
  if (removalMigration.includes(contract)) pass(`case-team contract: ${contract}`);
  else fail(`case-team contract: ${contract}`, 'ausente na migration corretiva final');
}

const primaryPointerMigration = readFileSync(join(root, requiredMigrations[7]), 'utf8');
if (/alter\s+column\s+therapist_id\s+drop\s+not\s+null/i.test(primaryPointerMigration)) {
  pass('legacy patients.therapist_id permite ausência de responsável primário');
} else {
  fail(
    'legacy patients.therapist_id permite ausência de responsável primário',
    'migration não remove NOT NULL de patients.therapist_id',
  );
}

const railway = JSON.parse(readFileSync(join(root, 'railway.json'), 'utf8'));
if (railway?.deploy?.healthcheckPath === '/api/ready') {
  pass('Railway usa /api/ready');
} else {
  fail('Railway usa /api/ready', `healthcheckPath=${railway?.deploy?.healthcheckPath ?? 'ausente'}`);
}

const server = readFileSync(join(root, 'server.ts'), 'utf8');
if (server.includes("app.get('/api/ready'")) pass('endpoint /api/ready existe');
else fail('endpoint /api/ready existe');
if (server.includes("app.get('/api/health'")) pass('endpoint /api/health existe');
else fail('endpoint /api/health existe');

const envValidator = readFileSync(join(root, 'scripts/validate-required-env.mjs'), 'utf8');
if (envValidator.includes('SUPABASE_EXPECTED_PROJECT_REF')) pass('proteção contra Supabase errado no deploy');
else fail('proteção contra Supabase errado no deploy');

const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
if (/FROM node:20-/i.test(dockerfile) && /RUN npm ci\b/.test(dockerfile)) {
  pass('Docker build determinístico com Node 20 + npm ci');
} else {
  fail('Docker build determinístico com Node 20 + npm ci');
}

const sourceExtensions = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|sql|html)$/i;
const ignoredDirs = new Set(['node_modules', 'dist', '.git']);
const secretPatterns = [
  ['Stripe secret', /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ['Stripe webhook secret', /\bwhsec_[A-Za-z0-9]{12,}/g],
  ['Supabase/JWT token', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g],
  ['Postgres credential URL', /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/gi],
];

const walk = (dir, callback) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, callback);
    else if (entry.isFile()) callback(full);
  }
};

const secretHits = [];
walk(root, (file) => {
  if (!sourceExtensions.test(file) || file.endsWith('package-lock.json')) return;
  let content = '';
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const [label, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) secretHits.push(`${label}: ${relative(root, file)}`);
  }
});
if (secretHits.length === 0) pass('nenhum secret óbvio versionado');
else fail('nenhum secret óbvio versionado', secretHits.join('; '));

const criticalTests = [
  'tests/security.regression.test.mjs',
  'tests/goLiveHardening.test.mjs',
  'tests/distributedSessionSafety.regression.test.mjs',
  'tests/productionSessionPersistence.regression.test.mjs',
  'tests/backgroundWorkerEconomyMode.test.ts',
  'tests/therapeuticPlanHierarchyRebac.regression.test.mjs',
  'tests/therapeuticPlanSessionContext.regression.test.mjs',
  'tests/patientCaseTeamCoordinatorAuthority.regression.test.mjs',
  'tests/patientCaseTeamManagerRemoval.regression.test.mjs',
  'tests/patientCaseTeamPrimaryPointerNullable.regression.test.mjs',
  'tests/patientCaseTeamSchemaDriftRecovery.test.mjs',
  'tests/ptsDraftPersistenceActivation.regression.test.mjs',
  'tests/ptsLegacyEvidenceBoundary.regression.test.mjs',
  'tests/ptsTherapeuticDashboard.test.mjs',
  'tests/clinicCanonicalTimeZone.regression.test.mjs',
  'tests/abaSessionClinicalDateTimezone.regression.test.mjs',
  'tests/patientDirectoryOrdering.regression.test.mjs',
  'tests/progressReportFilters.regression.test.mjs',
  'tests/clinicalPlanAnalyticsShell.regression.test.mjs',
  'tests/clinicalProgramChangeOverview.regression.test.mjs',
  'tests/sidebarHoverExpansion.regression.test.mjs',
  'tests/vertoBrandingAssets.regression.test.mjs',
  'tests/modulePurchaseEligibility.test.ts',
  'tests/moduleSubscriptionUpgrade.test.ts',
  'tests/moduleSubscriptionUpgradeExecution.test.ts',
  'tests/moduleUpgradeV5S1Finalization.regression.test.mjs',
  'tests/moduleUpgradeV5S1Http.test.ts',
];

for (const testFile of criticalTests) {
  if (!existsSync(join(root, testFile))) {
    fail(`teste: ${testFile}`, 'arquivo não encontrado');
    continue;
  }
  const command = testFile.endsWith('.mjs') ? process.execPath : 'tsx';
  const commandLabel = testFile.endsWith('.mjs') ? 'node' : 'tsx';
  console.log(`\n[critical-test] run: ${commandLabel} ${testFile}`);
  const result = spawnSync(command, [testFile], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, NODE_ENV: 'test' },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  console.log(`[critical-test] exit_code=${result.status ?? 1} test=${testFile}`);
  if (result.status === 0) {
    pass(`teste: ${testFile}`);
  } else {
    fail(
      `teste: ${testFile}`,
      String(result.stderr || result.stdout || `status=${result.status}`).trim().slice(0, 1200),
    );
  }
}

console.log(`\nPRE-MAIN GATE: ${failures.length === 0 ? 'PASS' : 'FAIL'}`);
console.log(`Passes: ${passes.length}`);
for (const label of passes) console.log(`  ✓ ${label}`);
if (failures.length) {
  console.error(`\nFalhas: ${failures.length}`);
  for (const item of failures) {
    console.error(`  ✗ ${item.label}${item.detail ? ` — ${item.detail}` : ''}`);
  }
  process.exit(1);
}
