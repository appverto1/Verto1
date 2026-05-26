import fs from 'fs';
import path from 'path';

const projectRoot = process.cwd();
const dockerfilePath = path.join(projectRoot, 'Dockerfile');
const entrypoints = ['server.ts', 'scripts/validate-required-env.mjs'];
const extensions = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'];

const toPosix = (value) => value.split(path.sep).join('/');
const toRelative = (absolutePath) => toPosix(path.relative(projectRoot, absolutePath));
const isLocalImport = (specifier) => specifier.startsWith('./') || specifier.startsWith('../');

function hasExactCase(absolutePath) {
  const parsed = path.parse(absolutePath);
  let current = parsed.root;
  const segments = path.relative(parsed.root, absolutePath).split(path.sep).filter(Boolean);

  for (const segment of segments) {
    let entries;
    try {
      entries = fs.readdirSync(current);
    } catch {
      return false;
    }

    if (!entries.includes(segment)) return false;
    current = path.join(current, segment);
  }

  return true;
}

function resolveLocalImport(fromFile, specifier) {
  const basePath = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    basePath,
    ...extensions.map((extension) => `${basePath}${extension}`),
    ...extensions.map((extension) => path.join(basePath, `index${extension}`))
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { file: candidate, caseExact: hasExactCase(candidate) };
    }
  }

  return null;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function collectLocalImports(file) {
  const source = stripComments(fs.readFileSync(file, 'utf8'));
  const imports = new Set();
  const patterns = [
    /\bimport\s+(?!type\b)[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      if (isLocalImport(match[1])) imports.add(match[1]);
    }
  }

  return Array.from(imports);
}

function collectRuntimeFiles() {
  const pending = entrypoints.map((entrypoint) => path.join(projectRoot, entrypoint));
  const seen = new Map();
  const errors = [];

  while (pending.length > 0) {
    const file = pending.pop();
    const key = path.normalize(file).toLowerCase();
    if (seen.has(key)) continue;
    seen.set(key, file);

    if (!fs.existsSync(file)) {
      errors.push(`Missing entrypoint: ${toRelative(file)}`);
      continue;
    }

    for (const specifier of collectLocalImports(file)) {
      const resolved = resolveLocalImport(file, specifier);
      if (!resolved) {
        errors.push(`Missing import: ${toRelative(file)} -> ${specifier}`);
        continue;
      }
      if (!resolved.caseExact) {
        errors.push(`Import casing mismatch: ${toRelative(file)} -> ${specifier}`);
        continue;
      }
      pending.push(resolved.file);
    }
  }

  return { files: Array.from(seen.values()), errors };
}

function readRunnerCopies() {
  const dockerfile = fs.readFileSync(dockerfilePath, 'utf8').split(/\r?\n/);
  const copiedPaths = [];
  let inRunner = false;

  for (const rawLine of dockerfile) {
    const line = rawLine.trim();
    if (/^FROM\b/i.test(line)) {
      inRunner = /\bAS\s+runner\b/i.test(line);
      continue;
    }
    if (!inRunner || !line || line.startsWith('#')) continue;

    const match = line.match(/^COPY\s+--from=build\s+(\S+)\s+\S+/i);
    if (!match) continue;

    const source = match[1].replace(/^\/app\/?/, '');
    if (source) copiedPaths.push(toPosix(source));
  }

  return copiedPaths;
}

function isCoveredByCopy(relativeFile, copiedPath) {
  const normalizedFile = toPosix(relativeFile);
  const normalizedCopy = copiedPath.replace(/\/+$/, '');
  const absoluteCopy = path.join(projectRoot, normalizedCopy);

  if (fs.existsSync(absoluteCopy) && fs.statSync(absoluteCopy).isDirectory()) {
    return normalizedFile === normalizedCopy || normalizedFile.startsWith(`${normalizedCopy}/`);
  }

  return normalizedFile === normalizedCopy;
}

const { files, errors } = collectRuntimeFiles();
const copiedPaths = readRunnerCopies();
const uncovered = files
  .map((file) => toRelative(file))
  .filter((file) => !copiedPaths.some((copiedPath) => isCoveredByCopy(file, copiedPath)));

if (errors.length > 0 || uncovered.length > 0) {
  for (const error of errors) console.error(error);
  for (const file of uncovered) console.error(`Runtime file is not copied into Docker runner: ${file}`);
  process.exit(1);
}

console.log(`Docker runtime imports covered (${files.length} files).`);
