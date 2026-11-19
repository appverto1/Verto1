import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const removed = ['@google/genai', 'cookie-session', 'clsx', 'tailwind-merge'];
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json','utf8'));
for (const name of removed) {
  assert.equal(pkg.dependencies?.[name], undefined, name + ' must not be installed as a direct dependency');
  assert.equal(lock.packages?.['']?.dependencies?.[name], undefined);
}
assert.ok(Object.keys(lock.packages || {}).length <= 510, 'unused package graph should be pruned');
const searchPaths = ['src','services','scripts','tests','server.ts'];
const suffix = /\\.(ts|tsx|js|mjs|cjs)$/;
function collect(relative) {
  const stat = fs.statSync(relative);
  if (stat.isFile()) return suffix.test(relative) ? [relative] : [];
  return fs.readdirSync(relative).flatMap(name => {
    const full = path.join(relative,name);
    if (['node_modules','dist','.git'].includes(name)) return [];
    return collect(full);
  });
}
const sourcePaths = searchPaths.flatMap(collect);
for (const file of sourcePaths) {
  if (file === 'tests/unusedDependenciesAudit.regression.test.mjs') continue;
  const source = fs.readFileSync(file,'utf8');
  for (const name of removed) {
    const escaped = name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
    const usage = new RegExp('(?:from\\s*|require\\s*\\(|import\\s*\\()\\s*[\\\'"]' + escaped + '(?:[\\\'"/])');
    assert.doesNotMatch(source, usage, file + ' must not import removed package ' + name);
  }
}
console.log('unused dependencies PASS:', removed.length, 'direct imports removed;', Object.keys(lock.packages).length, 'lockfile package entries');
