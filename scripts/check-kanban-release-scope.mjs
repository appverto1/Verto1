// Read-only, fail-closed allowlist for PR #547. Does not deploy or access external data.
// Run from the repository root: node scripts/check-kanban-release-scope.mjs [base-ref]
import {execFileSync} from 'node:child_process';

const ALLOWED = new Set([
  'docs/sales-kanban-production-promotion-20261029.md',
  'scripts/check-kanban-release-scope.mjs',
  'src/components/CommercialKanban.tsx',
  'src/components/SuperAdminDashboard.tsx',
  'tests/salesKanbanProductionPromotion.regression.test.mjs',
  'tests/salesKanbanUsability.regression.test.mjs',
  'tests/salesProspectingKanban.regression.test.mjs',
]);
const REQUIRED = [
  'src/components/CommercialKanban.tsx',
  'src/components/SuperAdminDashboard.tsx',
  'tests/salesKanbanProductionPromotion.regression.test.mjs',
];

const base = process.argv[2] || 'origin/main';
if (!/^(?:origin\/main|[a-fA-F0-9]{40})$/.test(base)) {
  console.error('SCOPE_GUARD_FAIL: base must be origin/main or an exact commit SHA.');
  process.exit(2);
}
function git(args) {
  return execFileSync('git', args, {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
}

try {
  // A future main commit is safe: merge-base covers all changes introduced by this branch.
  const baseCommit = git(['merge-base',base,'HEAD']);
  const head = git(['rev-parse','HEAD']);
  const changed = git(['diff','--no-ext-diff','--no-renames','--name-only',baseCommit+'..'+head])
    .split('\n').map(x=>x.trim()).filter(Boolean);
  if (!changed.length) throw Error('No changes detected: refusing an empty promotion.');
  const disallowed = changed.filter(path=>!ALLOWED.has(path));
  if (disallowed.length) {
    throw Error('Unexpected files outside isolated Kanban release:\n'+disallowed.join('\n'));
  }
  const missing = REQUIRED.filter(path=>!changed.includes(path));
  if (missing.length) throw Error('Mandatory release files are missing:\n'+missing.join('\n'));
  console.log('KANBAN_SCOPE_PASS: '+changed.length+' allowlisted files; main untouched. HEAD '+head);
} catch(error) {
  console.error('SCOPE_GUARD_FAIL: '+String(error?.message||error));
  process.exitCode=1;
}
