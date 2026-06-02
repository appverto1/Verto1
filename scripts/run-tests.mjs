import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const testsDir = 'tests';
const testFiles = readdirSync(testsDir)
  .filter((file) => file.endsWith('.test.ts') || file.endsWith('.test.mjs'))
  .sort();

for (const file of testFiles) {
  const testPath = join(testsDir, file);
  const command = file.endsWith('.mjs') ? 'node' : 'tsx';
  console.log(`\n[run] ${command} ${testPath}`);
  const result = spawnSync(command, [testPath], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`\n[ok] ${testFiles.length} test file(s) passed.`);
