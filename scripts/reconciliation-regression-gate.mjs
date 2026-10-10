import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const [mode, first, second] = process.argv.slice(2);
if (mode === 'scan') {
  const files = readdirSync('tests').filter((name) => /\.test\.(ts|mjs)$/.test(name)).sort();
  if (files.length < 400) throw new Error('Incomplete regression inventory');
  const results = files.map((name) => {
    const run = spawnSync(process.execPath, ['--import', 'tsx', `tests/${name}`], { encoding: 'utf8', timeout: 90000 });
    const status = run.status ?? -1;
    console.log(`${status === 0 ? 'PASS' : 'FAIL'} ${name}`);
    if (status !== 0) console.log((run.stdout + run.stderr).slice(-2000));
    return { name, status };
  });
  writeFileSync(first, JSON.stringify(results, null, 2));
} else if (mode === 'compare') {
  const candidate = JSON.parse(readFileSync(first, 'utf8'));
  const baseline = JSON.parse(readFileSync(second, 'utf8'));
  const candidateNames = new Set(candidate.map((item) => item.name));
  const removed = baseline.filter((item) => !candidateNames.has(item.name));
  if (removed.length) throw new Error(`Removed baseline regressions: ${JSON.stringify(removed)}`);
  const priorFailures = new Set(baseline.filter((item) => item.status !== 0).map((item) => item.name));
  const newFailures = candidate.filter((item) => item.status !== 0 && !priorFailures.has(item.name));
  if (newFailures.length) throw new Error(`New regression failures: ${JSON.stringify(newFailures)}`);
  console.log(`${candidate.filter((item) => item.status === 0).length}/${candidate.length} pass; no new failed test files relative to the archived staging SHA.`);
  console.log(`Pre-existing failures retained explicitly: ${JSON.stringify(candidate.filter((item) => item.status !== 0).map((item) => item.name))}`);
} else {
  throw new Error('Expected scan <output> or compare <candidate> <baseline>');
}
