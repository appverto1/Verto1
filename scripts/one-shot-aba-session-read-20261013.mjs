import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const baseline = 'b8928ebe3ee93a2ed5557307b4459d2fc6479e37';
const source = readFileSync('server.ts', 'utf8');
const original = execFileSync('git', ['show', baseline + ':server.ts'], { encoding: 'utf8', maxBuffer: 12000000 });
assert.equal(source, original, 'abort if server.ts differs from pinned staging baseline');
const routes = [
  ['live', '/api/aba/session-live-summaries/:sessionId'],
  ['report', '/api/aba/session-reports/:sessionId'],
  ['records', '/api/aba/session-reports/:sessionId/records'],
  ['recent', '/api/aba/recent-session-events/:sessionId'],
  ['patient-summary', '/api/aba/patient-summary/:patientId'],
  ['next-probe', '/api/aba/targets/:targetId/next-maintenance-probe'],
  ['quick-preferences', '/api/aba/session-quick-collection/preferences'],
  ['prompt-types', '/api/aba/prompt-types']
];
const deps = 'supabase, resolveAbaSessionReadScope, sanitizeString, sanitizeTextField, parseStoredJsonObject, hasMissingFinancialSchema, hasGlobalClinicAccess, currentClinicId, currentClinicTimeZone, persistActivityLog, isUuid, isMissingRelationError, parseAbaRecordListLimit, ABA_SESSION_LIVE_SUMMARY_SELECT, ABA_SESSION_REPORT_SELECT, ABA_TRIAL_LIST_SELECT, ABA_BEHAVIOR_EVENT_LIST_SELECT, ABA_MASTERY_LIST_SELECT, ABA_PATIENT_SUMMARY_SELECT, fetchNextMaintenanceProbeForTarget, canAccessPatientInCurrentClinic, normalizeAbaPromptTypeConfig';
const extracted = [];
let candidate = source;
for (const [key, path] of routes) {
  const pattern = new RegExp("^  app\\.get\\('" + path + "'[^\\n]*?async \\(req: any, res\\) => \\{\\n([\\s\\S]*?)^  \\}\\);", 'gm');
  const matches = [...source.matchAll(pattern)];
  assert.equal(matches.length, 1, key + ': exactly one original GET route');
  const raw = matches[0][0], body = matches[0][1];
  const header = raw.slice(0, raw.indexOf('\n'));
  const replacement = header.replace(/async \(req: any, res\) => \{$/, "abaSessionReadHandlers['" + key + "']);");
  assert.notEqual(header, replacement, key + ': expected callback header');
  assert.equal(candidate.split(raw).length - 1, 1, key + ': unique source block');
  candidate = candidate.replace(raw, replacement);
  extracted.push({ key, path, body, header, replacement, lines: raw.split('\n').length });
}
const imp = "import { createAbaSessionReadHandlers } from './services/abaSessionReadHandlers';\n";
const factory = '  const abaSessionReadHandlers = createAbaSessionReadHandlers(() => ({ ' + deps + ' }));\n';
assert.ok(!candidate.includes(imp) && !candidate.includes(factory), 'must not extract twice');
candidate = imp + candidate.replace(extracted[0].replacement, factory + extracted[0].replacement);
let recovered = candidate.replace(imp, '').replace(factory, '');
for (const item of [...extracted].reverse()) {
  recovered = recovered.replace(item.replacement, item.header + '\n' + item.body + '  });');
}
assert.equal(recovered, source, 'full source must be reconstructable byte for byte');
const service = [
  '// Eight ABA read-only handlers; original route middleware stays in server.ts.',
  '// Resolve dependencies only when the authorized request invokes a handler.',
  'export const createAbaSessionReadHandlers = (getDeps: () => any) => ({',
  ...extracted.map((item) => [
    "  '" + item.key + "': async (req: any, res: any) => {",
    '    const { ' + deps + ' } = getDeps();',
    '    // ORIGINAL_BEGIN ' + item.key,
    item.body.slice(0, -1),
    '    // ORIGINAL_END ' + item.key,
    '  }'
  ].join('\n')).join(',\n').split('\n'),
  '});',
  ''
].join('\n');
for (const item of extracted) {
  const marker = '    // ORIGINAL_BEGIN ' + item.key + '\n';
  const end = '    // ORIGINAL_END ' + item.key;
  assert.equal(service.split(marker)[1].split(end)[0], item.body, item.key + ' exact body parity');
}
const runner = readFileSync('scripts/pre-main-gate.mjs', 'utf8');
const runnerMarker = "  'tests/abaChartReadHandlers.test.ts',\n";
assert.equal(runner.split(runnerMarker).length - 1, 1, 'unique pre-main runner insertion point');
const nextRunner = runner.replace(runnerMarker, runnerMarker + "  'tests/abaSessionReadHandlers.test.ts',\n");
const originalLines = source.split('\n').length;
const candidateLines = candidate.split('\n').length;
assert.equal(originalLines, 98712, 'baseline line count');
assert.equal(candidateLines, 98331, 'expected 381-line reduction');
mkdirSync('services', { recursive: true });
mkdirSync('docs/backend-modularization', { recursive: true });
writeFileSync('server.ts', candidate);
writeFileSync('services/abaSessionReadHandlers.ts', service);
writeFileSync('scripts/pre-main-gate.mjs', nextRunner);
const doc = [
  '# ABA session/summary GET batch — 2026-10-13',
  '',
  '- Baseline staging: ' + baseline + ' (98,712 lines).',
  '- Extracted 8 GET handlers: ' + routes.map(([key, path]) => key + ' (' + path + ')').join(', ') + '.',
  '- Original callback bodies preserved byte-for-byte, including authorization and tenant checks, HTTP responses, audits and fallback behavior.',
  '- Middleware declarations, route order and registration positions unchanged; lazy dependency injection only.',
  '- server.ts: 98,712 to 98,331 lines (381 lines removed; 0.386% of baseline); new module is independent of DB migrations and runtime services.',
  '- Pre-commit checks: 8/8 unique routes, full server.ts roundtrip and 8/8 body parity checks. Focused tests cover scope denials, invalid input, tenant scoping, and unauthorized probe reads.',
  '- No changes to main, production, Stripe, schema, RLS, patient/clinical persistence or commercial routes. CI/typecheck/build and staging smoke require evidence from subsequent runs.',
  ''
].join('\n');
writeFileSync('docs/backend-modularization/20261013-aba-session-read-batch.md', doc);
console.log(JSON.stringify({ extracted: extracted.map(({key, path, lines}) => ({key,path,lines})), originalLines, candidateLines, delta: originalLines-candidateLines, serviceLines: service.split('\n').length, parity: true, roundtrip: true }, null, 2));
