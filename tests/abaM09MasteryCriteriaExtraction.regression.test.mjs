import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// ABA-M09: the PATCH clinical body must match the staging blob before extraction.
const before = execFileSync('git', ['cat-file', 'blob', '1a3e27f6e4a33def790c3f1cd324c263417403ec'], { encoding: 'utf8', maxBuffer: 8_000_000 });
const server = readFileSync('server.ts', 'utf8');
const moduleSource = readFileSync('services/abaMasteryCriteriaWriteHandler.ts', 'utf8');
assert.ok(moduleSource.includes('canonicalMasteryCriteriaJson(persistedCriteria)'), 'real persisted JSONB content must match');
assert.ok(server.includes("requiredPersistedField?: 'mastery_criteria'"), 'schema fallback helper requires field on M09');
assert.ok(server.includes("missingColumn !== requiredPersistedField"), 'required criteria field cannot be dropped silently');
const path = '/api/aba/patients/:patientId/targets/:targetId/mastery-criteria';
const originalHeader = "  app.patch('" + path + "', checkAuth, checkPatientAccess, requireClinicCapability('aba.program.edit'), async (req: any, res) => {";
const oldStart = before.indexOf(originalHeader);
const oldEnd = before.indexOf('\n  });', oldStart + originalHeader.length);
assert.ok(oldStart > -1 && oldEnd > oldStart, 'previous PATCH body must exist');
const bodyStart = moduleSource.indexOf('\n    try {');
const bodyEnd = moduleSource.lastIndexOf('\n  };');
assert.ok(bodyStart >= 0 && bodyEnd > bodyStart, 'extracted handler must contain its original body');
const originalBody = before.slice(oldStart + originalHeader.length, oldEnd);
const intendedBody = originalBody
  .replace("        organizationId,\n        patientId\n      );", "        organizationId,\n        patientId,\n        'mastery_criteria'\n      );")
  .replace('      void persistActivityLog({', "      const persistedCriteria = update.data?.mastery_criteria;\n      if (\n        update.data?.id !== targetId ||\n        !persistedCriteria ||\n        canonicalMasteryCriteriaJson(persistedCriteria) !== canonicalMasteryCriteriaJson(built.criteria)\n      ) {\n        return res.status(409).json({\n          success: false,\n          error: 'MASTERY_CRITERIA_NOT_PERSISTED',\n          message: 'A gravação do critério não foi confirmada. Tente novamente.'\n        });\n      }" + '\n\n      void persistActivityLog({');
assert.equal(moduleSource.slice(bodyStart, bodyEnd), intendedBody, 'original handler remains byte-identical except required write ACK and returned field');
const registration = "app.patch('" + path + "', checkAuth, checkPatientAccess, requireClinicCapability('aba.program.edit'), createAbaMasteryCriteriaWriteHandler(() => ({";
assert.equal(server.split(registration).length, 2, 'original middleware and route registered exactly once');
assert.ok(server.indexOf("app.patch('/api/aba/program-templates/:templateId'") < server.indexOf(registration), 'preserve route order after templates');
assert.ok(server.indexOf(registration) < server.indexOf('const fetchAbaMasteryCriterion = async'), 'evaluation helper must stay after writer');
assert.ok(server.includes("import { createAbaMasteryCriteriaWriteHandler } from './services/abaMasteryCriteriaWriteHandler';"), 'explicit import');
assert.ok(!moduleSource.includes("from '../server'"), 'no circular server import');
for (const guard of [
  "currentClinicId(req.session.user)", ".eq('organization_id', organizationId)", ".eq('patient_id', patientId)",
  "applyAbaTenantScope(targetQuery, req.session.user, clinicId, organizationId)",
  "buildAbaMasteryCriteriaUpdatePayload(req.body, actorId)",
  "updateAbaTargetWithSchemaFallback(", "persistActivityLog({",
  "formatAbaMasteryCriterion(", "MASTERy_CRITERIA_UPDATED".replace('MASTERy', 'MASTERY'),
  "sendRouteDbError(res,"
]) assert.ok(moduleSource.includes(guard), 'preserve security and persistence contract: ' + guard);

const compiled = ts.transpileModule(moduleSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const scope = { exports: {} };
vm.runInNewContext(compiled, scope);
const factory = scope.exports.createAbaMasteryCriteriaWriteHandler;
assert.equal(typeof factory, 'function');

const ids = {
  clinic: '11111111-1111-4111-8111-111111111111',
  patient: '22222222-2222-4222-8222-222222222222',
  target: '33333333-3333-4333-8333-333333333333',
  actor: '44444444-4444-4444-8444-444444444444',
  other: '55555555-5555-4555-8555-555555555555'
};
const validTarget = { id: ids.target, organization_id: ids.clinic, patient_id: ids.patient, clinic_id: ids.clinic, name: 'Meta sintética', mastery_criteria: null };
const fakeResponse = () => ({ statusCode: 200, payload: null, status(n) { this.statusCode = n; return this; }, json(data) { this.payload = data; return this; } });
const fakeRequest = (overrides = {}) => ({
  params: { patientId: ids.patient, targetId: ids.target },
  body: { criteria: { requiredIndependentCorrectTrials: 3 }, patientId: ids.other, targetId: ids.other, clinicId: ids.other },
  session: { user: { id: ids.actor, organizationId: ids.clinic, clinicId: ids.clinic } },
  ...overrides
});
const isUuid = (v) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(v));
function harness({ target = validTarget, readError = null, writeError = null, invalidCriteria = false, returnedWriteData = undefined } = {}) {
  const reads = []; const writes = [];
  const deps = {
    sanitizeString: (value, max) => String(value ?? '').slice(0, max),
    currentClinicId: () => ids.clinic,
    isUuid,
    ABA_TARGET_RECOMMENDATION_SELECT: 'id,organization_id,clinic_id,patient_id,name,mastery_criteria',
    supabase: { from(table) {
      const filters = [];
      return {
        select() { return this; },
        eq(k, v) { filters.push([k, v]); return this; },
        limit() { return this; },
        async maybeSingle() {
          reads.push({ table, filters: [...filters] });
          return { error: readError, data: target && !filters.some(([key, val]) => String(target[key]) !== String(val)) ? target : null };
        }
      };
    }},
    applyAbaTenantScope: (query, _user, clinicId) => query.eq('clinic_id', clinicId),
    hasMissingFinancialSchema: err => err?.code === 'MISSING_SCHEMA',
    isMissingRelationError: err => err?.code === 'MISSING_RELATION',
    buildAbaMasteryCriteriaUpdatePayload: (body, actorId) => invalidCriteria
      ? { error: 'INVALID_CRITERION', criteria: null, normalized: null }
      : { criteria: { ...body.criteria, updated_by: actorId }, normalized: body.criteria },
    async updateAbaTargetWithSchemaFallback(...args) {
      writes.push(args);
      return { data: writeError ? null : (returnedWriteData === undefined ? { id: args[0], mastery_criteria: args[1].mastery_criteria } : returnedWriteData), error: writeError };
    },
    persistActivityLog: () => Promise.resolve(),
    formatAbaMasteryCriterion: () => '3 tentativas independentes',
    normalizeAbaMasteryCriterion: () => ({ requiredIndependentCorrectTrials: 3 }),
    abaMasteryCriterionSourceLabel: () => 'Critério da habilidade',
    sendRouteDbError: (response) => response.status(500).json({ success: false, error: 'DB_WRITE_FAILED' })
  };
  return { handler: factory(() => deps), reads, writes };
}
{
  const h = harness(), r = fakeResponse();
  await h.handler(fakeRequest({ params: { patientId: ids.patient, targetId: 'bad-id' } }), r);
  assert.equal(r.statusCode, 400); assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0, 'forged target ID rejected before writes');
}
{
  const h = harness(), r = fakeResponse();
  await h.handler(fakeRequest({ params: { patientId: 'bad-id', targetId: ids.target } }), r);
  assert.equal(r.statusCode, 400); assert.equal(h.writes.length, 0, 'forged patient ID rejected');
}
for (const key of ['organization_id', 'clinic_id', 'patient_id']) {
  const h = harness({ target: { ...validTarget, [key]: ids.other } }), r = fakeResponse();
  await h.handler(fakeRequest(), r);
  assert.equal(r.statusCode, 404, 'cross-tenant/patient target concealed: ' + key);
  assert.equal(h.writes.length, 0, 'cross-tenant write blocked: ' + key);
}
{
  const h = harness({ target: null }), r = fakeResponse();
  await h.handler(fakeRequest(), r);
  assert.equal(r.statusCode, 404); assert.equal(h.writes.length, 0, 'nonexistent target rejected');
}
{
  const h = harness({ invalidCriteria: true }), r = fakeResponse();
  await h.handler(fakeRequest(), r);
  assert.equal(r.statusCode, 400); assert.equal(h.writes.length, 0, 'invalid criterion is not written');
}
{
  const h = harness({ readError: { code: 'MISSING_SCHEMA' } }), r = fakeResponse();
  await h.handler(fakeRequest(), r);
  assert.equal(r.statusCode, 503); assert.equal(h.writes.length, 0, 'schema missing blocks writes');
}
{
  const h = harness({ writeError: { code: 'MISSING_SCHEMA' } }), r = fakeResponse();
  await h.handler(fakeRequest(), r);
  assert.equal(r.statusCode, 503, 'schema missing on write is not a successful save');
}
{
  const h = harness({ writeError: { code: '23505' } }), r = fakeResponse();
  await h.handler(fakeRequest(), r);
  assert.equal(r.statusCode, 500, 'write conflict cannot masquerade as success');
}
for (const returnedWriteData of [null, { id: ids.other, mastery_criteria: { requiredIndependentCorrectTrials: 3 } }, { id: ids.target }, { id: ids.target, mastery_criteria: { requiredIndependentCorrectTrials: 999 } }]) {
  const h = harness({ returnedWriteData }), r = fakeResponse();
  await h.handler(fakeRequest(), r);
  assert.equal(r.statusCode, 409, 'no authoritative persisted ACK must fail closed');
  assert.equal(r.payload.success, false);
  assert.equal(r.payload.error, 'MASTERY_CRITERIA_NOT_PERSISTED');
  assert.equal(h.writes.length, 1, 'no extra reads or retries');
}
{
  const h = harness({ returnedWriteData: { id: ids.target, mastery_criteria: { updated_by: ids.actor, requiredIndependentCorrectTrials: 3 } } }), r = fakeResponse();
  await h.handler(fakeRequest(), r);
  assert.equal(r.statusCode, 200, 'canonical object key reordering is accepted');
}
{
  const h = harness(), r = fakeResponse();
  await h.handler(fakeRequest(), r);
  assert.equal(r.statusCode, 200);
  assert.equal(h.reads.length, 1, 'no extra read requests');
  assert.equal(h.writes.length, 1, 'single write call');
  assert.deepEqual([...h.reads[0].filters], [
    ['organization_id', ids.clinic], ['patient_id', ids.patient], ['id', ids.target], ['clinic_id', ids.clinic]
  ], 'request-supplied clinic/patient/target in body cannot override path and session');
  assert.equal(h.writes[0][0], ids.target);
  assert.equal(h.writes[0][2], ids.clinic);
  assert.equal(h.writes[0][3], ids.clinic);
  assert.equal(h.writes[0][4], ids.patient);
  assert.equal(h.writes[0][5], 'mastery_criteria', 'critical field must not be dropped by schema fallback');
  assert.equal(h.writes[0][1].mastery_criteria.updated_by, ids.actor);
}
console.log('ABA-M09: literal parity, middleware, API-direct cross-tenant, bad IDs, invalid data, write errors and no extra requests PASS');
