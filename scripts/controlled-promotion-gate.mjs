import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const names = JSON.parse(readFileSync('scripts/controlled-promotion-tests.json', 'utf8'));
let passed = 0;
for (const name of names) {
  const args = name.endsWith('.ts') ? ['--import', 'tsx', `tests/${name}`] : [`tests/${name}`];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`FAIL ${name}\n${result.stdout}\n${result.stderr}`);
    process.exit(result.status || 1);
  }
  console.log(`PASS ${name}`);
  passed++;
}
console.log(`${passed} controlled-promotion checks passed.`);
