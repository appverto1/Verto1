import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
import { protocolImportManifest as manifest } from './helpers/protocolImportSource.mjs';

const historical = execFileSync('git', ['cat-file', 'blob', manifest.originalBlob], { encoding: 'utf8', maxBuffer: 12_000_000 });
const id = '11111111-1111-4111-8111-111111111111', clinicId = '22222222-2222-4222-8222-222222222222';
const foreignClinic = '33333333-3333-4333-8333-333333333333';
const normalize = value => JSON.parse(JSON.stringify(value));
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-15T12:00:00.000Z'])); } }
function compile(source, context = {}) {
  const exports = {};
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const sandbox = { exports, module: { exports }, Date: FixedDate, process: { env: { NODE_ENV: 'test' } }, console: { log() {}, warn() {}, error() {}, info() {} }, ...context };
  vm.runInNewContext(js, sandbox, { timeout: 5000 });
  return sandbox.module.exports;
}
const modules = new Map([...new Set(manifest.routes.map(r => r.module))].map(name => [name, compile(readFileSync(`services/${name}.ts`, 'utf8'))]));

function environment(route, mode) {
  const trace = [];
  const response = { status: 200, body: null, headers: {} };
  const res = { status(code) { response.status = code; return res; }, json(body) { response.body = body; return res; }, setHeader(key, value) { response.headers[key] = value; return res; } };
  const strings = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
  const row = { id, clinic_id: mode === 'foreign-clinic' ? foreignClinic : clinicId, status: route.name.includes('Revoke') || mode === 'approved-delete' ? 'approved' : 'pending', approved_canonical_key: 'TEST', protocol_name: 'Test', scan_status: 'clean', quarantine_status: 'clean', file_type: 'screenshots', file_data_url: 'data:image/png;base64,AA==', scan_report: {} };
  const error = mode === 'database-error' ? { message: 'DB_UNAVAILABLE' } : null;
  function query(table) {
    const chain = new Proxy({}, { get(_target, method) {
      if (method === 'then') return resolve => resolve({ data: [], error });
      return (...args) => {
        trace.push(normalize([table, String(method), ...args]));
        if (method === 'maybeSingle' || method === 'single') return Promise.resolve({ data: mode === 'not-found' || (mode === 'foreign-clinic' && route.module === 'protocolImportClinicHandlers') ? null : row, error });
        return chain;
      };
    } });
    return chain;
  }
  const sync = { synced: true, added: 1, refreshed: 0, removed: 1 };
  const deps = {
    sanitizeString: strings, sanitizeEmail: value => strings(value).toLowerCase(),
    sanitizeSafePreviewText: strings,
    isUuid: value => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(value)),
    currentClinicId: () => clinicId,
    asSafeNumber: (value, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : null,
    isAllowedScreenshotDataUrl: value => String(value || '').startsWith('data:image/png;base64,'),
    identifyVertoProtocolCandidate: () => ({ canonicalKey: 'TEST', canonicalName: 'Test', confidence: 1 }),
    normalizeApprovedProtocolKey: value => strings(value).toUpperCase(),
    crypto: { randomUUID: () => id },
    buildScreenshotEvidenceSummary: () => 'Fixture evidence',
    sanitizeClinicalPayload: value => value,
    parseStoredJsonObject: value => typeof value === 'string' ? JSON.parse(value) : value || {},
    supabase: { from(table) { trace.push(['from', table]); return query(table); } },
    extractMissingColumnName: () => null,
    extractSupabaseErrorMessage: error => strings(error?.message),
    persistActivityLog: async value => { trace.push(['audit', normalize(value)]); if (mode === 'audit-error') throw Error('AUDIT_UNAVAILABLE'); return true; },
    enforcePayloadLimit: (_req, response) => { if (mode !== 'oversize') return true; response.status(413).json({ error: 'PAYLOAD_TOO_LARGE' }); return false; },
    loadProtocolAccessMap: async () => new Map([[`clinic:${clinicId}`, ['TEST']]]),
    buildProtocolAccessScopeKeys: () => [`clinic:${clinicId}`],
    buildProtocolAccessScopeKey: () => `clinic:${clinicId}`,
    VERTO_PROTOCOL_BY_KEY: new Map([['TEST', { key: 'TEST', name: 'Test' }]]),
    PROTOCOL_IMPORT_REQUEST_SELECT: 'id,clinic_id,status',
    VERTO_PROTOCOL_PANEL_RESET_AT: '2026-01-01T00:00:00.000Z',
    isProd: true,
    redactForLogs: value => value,
    logRouteDbError: (...args) => trace.push(['log', normalize(args)]),
    applyNoStoreHeaders: response => response.setHeader('Cache-Control', 'private, no-store'),
    sendNoStoreJson: (response, body, status = 200) => response.status(status).json(body),
    revokeProtocolGrantForRequest: async value => { trace.push(['revoke', normalize(value)]); return { protocolSync: sync }; },
    syncApprovedProtocolsToClinicState: async value => { trace.push(['sync', normalize(value)]); return sync; },
    supabaseUrl: 'https://fixture.invalid', supabasePublicClientKey: 'fixture-public-key', vertoDeploymentEnv: 'staging',
    getUserFromAccessToken: async token => { trace.push(['token', token]); return { user: { id: mode === 'token-mismatch' ? foreignClinic : id }, error: null }; },
    createClient: (...args) => { trace.push(['actor-client', normalize(args)]); return { rpc: async (name, payload) => { trace.push(['rpc', name, normalize(payload)]); return { error: mode === 'rpc-denied' ? { message: 'platform_admin_required' } : null }; } }; },
    scanProtocolUpload: () => ({ scanStatus: 'clean', quarantineStatus: 'clean', safePreviewStatus: 'generated', safePreviewText: 'Fixture preview', scanReport: {} }),
  };
  for (const name of route.deps) if (!(name in deps)) throw Error(`Missing fixture: ${name}`);
  const req = { params: { requestId: mode === 'invalid-id' ? '' : id }, query: {}, headers: { authorization: 'Bearer fixture-token' }, session: { user: { id, clinicId, name: 'Fixture', email: 'fixture@example.invalid', role: 'owner' } }, body: {
    protocolName: mode === 'invalid-id' ? '' : 'Test', evidenceMode: 'screenshots', ageMin: 0, ageMax: 12, totalPages: 10, coverageMaxPage: 3, rightsAccepted: true, fullProtocolConfirmed: true,
    screenshotChallenges: [{ pageNumber: 1, dataUrl: 'data:image/png;base64,AA==', fileSize: 10 }],
    canonicalName: 'Test', canonicalKey: 'TEST', protocolKey: 'TEST', scopeKey: `clinic:${clinicId}`, requestId: id, enabled: true,
  } };
  return { deps, req, res, trace, response };
}

let scenarios = 0;
for (const route of manifest.routes) {
  for (const mode of ['valid', 'invalid-id', 'not-found', 'foreign-clinic', 'database-error', 'token-mismatch', 'rpc-denied', 'approved-delete', 'oversize', 'audit-error']) {
    if (mode === 'audit-error' && route.method === 'delete') continue; // Existing DELETE audit is intentionally fire-and-forget.
    const old = environment(route, mode), next = environment(route, mode);
    const before = compile('module.exports = ' + historical.slice(route.start, route.end), old.deps);
    let reads = 0;
    const after = modules.get(route.module)[route.name](() => { reads++; return next.deps; });
    assert.equal(reads, 0, 'no dependency evaluation during registration');
    await before(old.req, old.res); await after(next.req, next.res);
    assert.equal(reads, 1);
    assert.deepEqual(normalize(next.response), normalize(old.response), `${route.name}: ${mode} response`);
    assert.deepEqual(normalize(next.trace), normalize(old.trace), `${route.name}: ${mode} exact writes, queries, RPCs and audits`);
    if (mode === 'valid') assert.equal(next.response.status, 200, `${route.name}: valid fixture ${JSON.stringify(next.response.body)}`);
    if (mode === 'token-mismatch') assert.ok(!next.trace.some(item => item[0] === 'rpc'), 'actor credential mismatch cannot invoke approval RPC');
    if (mode === 'foreign-clinic' && route.name === 'createClinicProtocolGrantRevokeHandler') {
      assert.equal(next.response.status, 404); assert.ok(!next.trace.some(item => item[0] === 'revoke'));
    }
    if (mode === 'approved-delete' && route.method === 'delete') {
      assert.equal(next.response.status, 409); assert.ok(!next.trace.some(item => item[1] === 'delete'));
    }
    scenarios++;
  }
}

for (const route of manifest.routes) {
  const keys = ['auth', ...(route.header.includes('checkPlatformAdmin') ? ['platform'] : []), ...(route.header.includes('requireClinicCapability') ? ['capability'] : [])];
  for (const denied of keys) {
    let chain, reached = false, code = 200;
    const res = { status(value) { code = value; return res; }, json() { return res; } };
    const guard = key => (_req, response, next) => key === denied ? response.status(key === 'auth' ? 401 : 403).json({}) : next();
    const pass = (_req, _res, next) => next();
    vm.runInNewContext(route.header + 'handler);', {
      app: { [route.method](_path, ...handlers) { chain = handlers; } }, checkAuth: guard('auth'),
      checkPlatformAdmin: guard('platform'), requireClinicCapability: () => guard('capability'),
      portalActionLimiter: pass, noStoreDynamicResponse: pass, handler: () => { reached = true; },
    });
    let position = 0; const next = () => chain[position++]({}, res, next); next();
    assert.equal(reached, false); assert.equal(code, denied === 'auth' ? 401 : 403); scenarios++;
  }
}
console.log(`Protocol imports: ${scenarios} differential/authorization scenarios PASS`);
