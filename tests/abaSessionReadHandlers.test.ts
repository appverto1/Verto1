import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createAbaSessionReadHandlers } from '../services/abaSessionReadHandlers';

const baseline = 'b8928ebe3ee93a2ed5557307b4459d2fc6479e37';
const original = execFileSync('git', ['show', baseline + ':server.ts'], { encoding: 'utf8', maxBuffer: 12000000 });
const current = readFileSync('server.ts', 'utf8');
const service = readFileSync('services/abaSessionReadHandlers.ts', 'utf8');
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
const imp = "import { createAbaSessionReadHandlers } from './services/abaSessionReadHandlers';\n";
const factory = '  const abaSessionReadHandlers = createAbaSessionReadHandlers(() => ({ ' + deps + ' }));\n';
assert.ok(current.startsWith(imp), 'factory import must be first');
assert.equal(current.split(factory).length - 1, 1, 'factory must be registered once');
let recovered = current.replace(imp, '').replace(factory, '');
for (const [key, path] of [...routes].reverse()) {
  const pattern = new RegExp("^  app\\.get\\('" + path + "'[^\\n]*?async \\(req: any, res\\) => \\{\\n([\\s\\S]*?)^  \\}\\);", 'gm');
  const matches = [...original.matchAll(pattern)];
  assert.equal(matches.length, 1, key + ' baseline route');
  const raw = matches[0][0], body = matches[0][1], header = raw.slice(0, raw.indexOf('\n'));
  const replacement = header.replace(/async \(req: any, res\) => \{$/, "abaSessionReadHandlers['" + key + "']);");
  assert.equal(current.split(replacement).length - 1, 1, key + ' original middleware');
  const start = '    // ORIGINAL_BEGIN ' + key + '\n', end = '    // ORIGINAL_END ' + key;
  assert.equal(service.split(start).length - 1, 1, key + ' body marker');
  assert.equal(service.split(start)[1].split(end)[0], body, key + ' exact body');
  recovered = recovered.replace(replacement, raw);
}
assert.equal(recovered, original, 'exact full-source roundtrip');

const response = () => ({
  statusCode: 200, payload: null as any, headers: {} as Record<string, string>,
  status(code: number) { this.statusCode = code; return this; },
  json(value: any) { this.payload = value; return this; },
  setHeader(key: string, value: string) { this.headers[key] = value; return this; }
});
const sanitizeString = (value: any, max: number) => String(value ?? '').slice(0, max);
let dbCalls = 0, scopeCalls = 0;
const noAccess = createAbaSessionReadHandlers(() => ({
  sanitizeString, currentClinicId: () => '', isUuid: () => false,
  resolveAbaSessionReadScope: async () => { scopeCalls++; return { ok: false, status: 403, error: 'DENIED' }; },
  supabase: { from() { dbCalls++; throw new Error('DB must not be reached'); } }
}));
const req = { params: { sessionId: 'draft-test', patientId: 'invalid', targetId: 'invalid' }, query: {}, session: { user: { id: 'user' } } };
for (const key of ['live', 'report']) {
  const res = response();
  await (noAccess as any)[key](req, res);
  assert.equal(res.statusCode, 403, key + ' scope denial');
  assert.equal(res.payload.error, 'DENIED');
}
for (const key of ['records', 'recent']) {
  const res = response();
  await (noAccess as any)[key](req, res);
  assert.equal(res.statusCode, 200, key + ' invalid session');
  assert.deepEqual(res.payload.data, []);
}
const summary = response();
await noAccess['patient-summary'](req, summary);
assert.equal(summary.statusCode, 200);
assert.equal(summary.payload.data, null);
for (const key of ['next-probe', 'quick-preferences', 'prompt-types']) {
  const res = response();
  await (noAccess as any)[key](req, res);
  assert.equal(res.statusCode, 400, key + ' invalid identifiers');
}
assert.equal(scopeCalls, 2);
assert.equal(dbCalls, 0, 'invalid and unauthorized requests cannot query DB');

const filters: Array<[string, string]> = [];
const query = {
  select(value: string) { assert.equal(value, 'summary_select'); return this; },
  eq(key: string, value: string) { filters.push([key, value]); return this; },
  async maybeSingle() { return { data: { id: 'summary' }, error: null }; }
};
const tenantHandler = createAbaSessionReadHandlers(() => ({
  sanitizeString, supabase: { from(table: string) { assert.equal(table, 'aba_session_live_summaries'); return query; } },
  ABA_SESSION_LIVE_SUMMARY_SELECT: 'summary_select',
  resolveAbaSessionReadScope: async () => ({ ok: true, patientId: 'patient-a', clinicId: 'clinic-a' }),
  hasGlobalClinicAccess: () => false
}));
const scoped = response();
await tenantHandler.live({ ...req, params: { sessionId: 'session-a' } }, scoped);
assert.equal(scoped.statusCode, 200);
assert.deepEqual(scoped.payload.data, { id: 'summary' });
assert.deepEqual(filters, [['session_id', 'session-a'], ['patient_id', 'patient-a'], ['clinic_id', 'clinic-a']]);

let probeCalls = 0;
const forbiddenProbe = createAbaSessionReadHandlers(() => ({
  sanitizeString, currentClinicId: () => 'clinic-a', isUuid: () => true,
  canAccessPatientInCurrentClinic: async () => false,
  fetchNextMaintenanceProbeForTarget: async () => { probeCalls++; throw new Error('forbidden'); }
}));
const denied = response();
await forbiddenProbe['next-probe']({ ...req, params: { targetId: 'target-a' }, query: { patientId: 'patient-a' } }, denied);
assert.equal(denied.statusCode, 403);
assert.equal(probeCalls, 0, 'unauthorized patient cannot reach probe fetch');
console.log('abaSessionReadHandlers.test.ts: PASS');
