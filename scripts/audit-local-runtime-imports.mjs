import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const resolveExts = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const ignoredDirs = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', 'artifacts', 'backups']);
const importRe = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (sourceExts.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function resolves(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const ext of resolveExts) {
    const candidate = `${base}${ext}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const name of ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs']) {
      const candidate = path.join(base, name);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

const missing = [];
for (const file of walk(root)) {
  const text = fs.readFileSync(file, 'utf8');
  importRe.lastIndex = 0;
  let match;
  while ((match = importRe.exec(text))) {
    const spec = match[1] || match[2];
    if (!spec?.startsWith('.')) continue;
    if (!resolves(file, spec)) {
      missing.push({ file: path.relative(root, file), import: spec });
    }
  }
}

if (missing.length) {
  console.error(`UNRESOLVED_LOCAL_IMPORTS=${missing.length}`);
  for (const item of missing) console.error(`${item.file} -> ${item.import}`);
  process.exitCode = 1;
} else {
  console.log('UNRESOLVED_LOCAL_IMPORTS=0');
  console.log('All relative runtime imports resolve to files in this checkout.');
}
