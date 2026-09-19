import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const DIAGNOSTIC_HEADER = /^(.*?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s*(.*)$/;

function normalizePath(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

function normalizeMessage(parts) {
  return parts
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTypeScriptDiagnostics(logText) {
  const diagnostics = [];
  let current = null;

  for (const rawLine of String(logText || '').split(/\r?\n/)) {
    const match = rawLine.match(DIAGNOSTIC_HEADER);
    if (match) {
      current = {
        file: normalizePath(match[1]),
        line: Number(match[2]),
        column: Number(match[3]),
        code: match[4],
        messageParts: [match[5]],
        originalLines: [rawLine.trimEnd()],
      };
      diagnostics.push(current);
      continue;
    }

    if (current && /^\s+\S/.test(rawLine)) {
      current.messageParts.push(rawLine.trim());
      current.originalLines.push(rawLine.trimEnd());
    }
  }

  return diagnostics.map((diagnostic) => ({
    file: diagnostic.file,
    line: diagnostic.line,
    column: diagnostic.column,
    code: diagnostic.code,
    message: normalizeMessage(diagnostic.messageParts),
    original: diagnostic.originalLines.join('\n'),
  }));
}

export function diagnosticSignature(diagnostic) {
  return JSON.stringify([
    normalizePath(diagnostic.file),
    String(diagnostic.code || '').trim(),
    normalizeMessage([diagnostic.message]),
  ]);
}

export function findNewTypeScriptDiagnostics(candidateLog, baselineLog) {
  const candidate = parseTypeScriptDiagnostics(candidateLog);
  const baseline = parseTypeScriptDiagnostics(baselineLog);

  if (candidate.length === 0) {
    throw new Error('Candidate typecheck failed but no TypeScript diagnostics could be parsed.');
  }
  if (baseline.length === 0) {
    throw new Error('Baseline typecheck failed but no TypeScript diagnostics could be parsed.');
  }

  const remainingBaseline = new Map();
  for (const diagnostic of baseline) {
    const signature = diagnosticSignature(diagnostic);
    remainingBaseline.set(signature, (remainingBaseline.get(signature) || 0) + 1);
  }

  const added = [];
  for (const diagnostic of candidate) {
    const signature = diagnosticSignature(diagnostic);
    const available = remainingBaseline.get(signature) || 0;
    if (available > 0) {
      remainingBaseline.set(signature, available - 1);
    } else {
      added.push(diagnostic);
    }
  }

  return added;
}

function readFlag(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function runCli() {
  const args = process.argv.slice(2);
  const candidatePath = readFlag(args, '--candidate');
  const baselinePath = readFlag(args, '--baseline');
  const outputPath = readFlag(args, '--output');

  if (!candidatePath || !baselinePath || !outputPath) {
    console.error('Usage: node scripts/typecheck-ratchet.mjs --candidate <log> --baseline <log> --output <log>');
    process.exitCode = 2;
    return;
  }

  try {
    const candidateLog = fs.readFileSync(candidatePath, 'utf8');
    const baselineLog = fs.readFileSync(baselinePath, 'utf8');
    const added = findNewTypeScriptDiagnostics(candidateLog, baselineLog);

    fs.writeFileSync(
      outputPath,
      added.map((diagnostic) => diagnostic.original).join('\n') + (added.length ? '\n' : ''),
      'utf8',
    );

    process.exitCode = added.length > 0 ? 1 : 0;
  } catch (error) {
    const message = `TYPECHECK_RATCHET_ERROR: ${error instanceof Error ? error.message : String(error)}\n`;
    fs.writeFileSync(outputPath, message, 'utf8');
    console.error(message.trim());
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
