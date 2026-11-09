import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const server = readFileSync('server.ts', 'utf8');
const source = readFileSync('services/abaNextSessionPlanItemMutationHandler.ts', 'utf8');
const path = '/api/aba/next-session-plan-items/:planItemId';
const handlerName = 'createAbaNextSessionPlanItemPatchHandler';
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandbox = { exports: {}, console };
vm.runInNewContext(js, sandbox);
const handlerFactory = sandbox.exports[handlerName];
assert.equal(typeof handlerFactory, 'function');

const ids = {
  clinic: '11111111-1111-4111-8111-111111111111',
  otherClinic: '99999999-9999-4999-8999-999999999999',
  patient: '22222222-2222-4222-8222-222222222222',
  item: '33333333-3333-4333-8333-333333333333',
  otherItem: '44444444-4444-4444-8444-444444444444',
  actor: '55555555-5555-4555-8555-555555555555'
};
const validUuid = v => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(v));
const stored = { id: ids.item, patient_id: ids.patient, clinic_id: ids.clinic, organization_id: ids.clinic };
const response = () => ({
  statusCode: 200, payload: null,
  status(code) { this.statusCode = code; return this; },
  json(value) { this.payload = value; return this; }
});
function makeHarness({ payloadOk = true, row = stored, patientAllowed = true, readError = null, writeError = null, writeData = { id: ids.item, status: 'PLANNED' }, globalAccess = false } = {}) {
  const trace = { limits: [], reads: [], writes: [], patientAccess: [], selectColumns: [] };
  const user = { id: ids.actor, clinicId: ids.clinic, organizationId: ids.clinic, role: 'professional' };
  const deps = {
    enforcePayloadLimit(req, res, limit) {
      trace.limits.push(limit);
      if (!payloadOk) { res.status(413).json({ success: false, error: 'PAYLOAD_TOO_LARGE' }); return false; }
      return true;
    },
    sanitizeString: (value, length) => String(value ?? '').trim().slice(0, length),
    currentClinicId: actor => actor.clinicId,
    isUuid: validUuid,
    hasMissingFinancialSchema: error => error?.code === 'SCHEMA_MISSING',
    async canAccessPatientInCurrentClinic(patientId, actor) {
      trace.patientAccess.push({ patientId, clinicId: actor.clinicId });
      return patientAllowed && patientId === ids.patient && actor.clinicId === ids.clinic;
    },
    cleanObject: value => Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined)),
    normalizeAbaPlanItemStatus: value => ['PLANNED', 'COMPLETED'].includes(value) ? value : 'PLANNED',
    sanitizeTextField: (value, length) => String(value ?? '').trim().slice(0, length),
    normalizeAbaPlanTrialType: value => value === 'DTT' ? 'DTT' : 'OTHER',
    hasGlobalClinicAccess: () => globalAccess,
    ABA_NEXT_SESSION_PLAN_ITEM_SELECT: 'id,patient_id,clinic_id,organization_id,status',
    supabase: {
      from(table) {
        assert.equal(table, 'aba_next_session_plan_items', 'only intended table');
        const query = (kind, patch) => {
          const filters = [], instance = {
            eq(key, value) { filters.push([key, value]); return instance; },
            limit() { return instance; },
            select(columns) { trace.selectColumns.push({ kind, columns }); return instance; },
            async maybeSingle() {
              if (kind === 'read') {
                trace.reads.push(filters);
                const match = row && filters.every(([k,v]) => row[k] === v);
                return { data: match ? row : null, error: readError };
              }
              trace.writes.push({ filters, patch });
              return { data: writeData, error: writeError };
            }
          };
          return instance;
        };
        return {
          select(columns) { return query('read').select(columns); },
          update(patch) { return query('write', patch); }
        };
      }
    }
  };
  async function invoke(body = {}, overrides = {}) {
    const req = { params: { planItemId: ids.item }, body, session: { user }, ...overrides };
    const res = response();
    await handlerFactory(() => deps)(req, res);
    return res;
  }
  return { invoke, trace, user };
}
const body = { status: 'COMPLETED', instructions: 'x'.repeat(1300), plannedTrialType: 'DTT', clinicId: ids.otherClinic, patientId: ids.otherClinic };
{
  const h = makeHarness({ payloadOk: false });
  const res = await h.invoke(body);
  assert.equal(res.statusCode, 413, 'oversized request blocked before DB');
  assert.equal(h.trace.limits[0], 49152);
  assert.equal(h.trace.reads.length + h.trace.writes.length, 0);
}
{
  const h = makeHarness();
  const res = await h.invoke(body, { params: { planItemId: 'forged' } });
  assert.equal(res.statusCode, 400, 'invalid item ID blocked');
  assert.equal(h.trace.reads.length + h.trace.writes.length, 0);
}
{
  const h = makeHarness({ row: { ...stored, clinic_id: ids.otherClinic } });
  const res = await h.invoke(body);
  assert.equal(res.statusCode, 404, 'cross-clinic item hidden');
  assert.equal(h.trace.writes.length, 0);
  assert.deepEqual(h.trace.reads[0].map(x => x[0]), ['id', 'clinic_id']);
  assert.equal(h.trace.reads[0][1][1], ids.clinic, 'clinic from server session, not client');
}
{
  const h = makeHarness({ row: { ...stored, patient_id: 'bad-patient-id' } });
  assert.equal((await h.invoke(body)).statusCode, 404, 'invalid stored patient ID rejected');
  assert.equal(h.trace.writes.length, 0);
}
{
  const h = makeHarness({ patientAllowed: false });
  assert.equal((await h.invoke(body)).statusCode, 403, 'cross-patient/unauthorized access rejected');
  assert.equal(h.trace.writes.length, 0);
  assert.equal(h.trace.patientAccess[0].patientId, ids.patient);
}
for (const code of ['SCHEMA_MISSING', 'DB_ERROR']) {
  const read = makeHarness({ readError: { code, message: code } });
  const readRes = await read.invoke(body);
  assert.equal(readRes.statusCode, code === 'SCHEMA_MISSING' ? 503 : 500, 'read error mapped');
  assert.equal(read.trace.writes.length, 0);
  const write = makeHarness({ writeError: { code, message: code }, writeData: null });
  const writeRes = await write.invoke(body);
  assert.equal(writeRes.statusCode, code === 'SCHEMA_MISSING' ? 503 : 500, 'write error mapped');
  assert.equal(write.trace.writes.length, 1);
}
for (const data of [null, { id: ids.otherItem }]) {
  const h = makeHarness({ writeData: data });
  const res = await h.invoke(body);
  assert.equal(res.statusCode, 409, 'no-row/wrong-row write cannot report Save success');
  assert.equal(res.payload.error, 'PERSISTENCE_NOT_CONFIRMED');
  assert.equal(h.trace.reads.length, 1, 'no extra verification read');
  assert.equal(h.trace.writes.length, 1);
}
{
  const h = makeHarness();
  const res = await h.invoke(body);
  assert.equal(res.statusCode, 200, 'successful Save');
  assert.equal(res.payload.success, true);
  assert.equal(res.payload.data.id, ids.item);
  assert.equal(h.trace.reads.length, 1);
  assert.equal(h.trace.writes.length, 1);
  const update = h.trace.writes[0];
  assert.deepEqual(update.filters.map(x => x[0]), ['id', 'clinic_id'], 'update stays clinic scoped');
  assert.equal(update.filters[0][1], ids.item);
  assert.equal(update.filters[1][1], ids.clinic);
  assert.equal(update.patch.status, 'COMPLETED');
  assert.equal(update.patch.instructions.length, 1000);
  assert.equal(update.patch.planned_trial_type, 'DTT');
  assert.equal(h.trace.selectColumns[0].columns, 'id,patient_id,clinic_id,organization_id', 'read uses minimal columns');
  assert.equal(h.trace.selectColumns[1].columns, 'id,patient_id,clinic_id,organization_id,status');
}
{
  const h = makeHarness({ globalAccess: true });
  const res = await h.invoke(body);
  assert.equal(res.statusCode, 200, 'preserve global-role behavior');
  assert.deepEqual(h.trace.reads[0].map(x => x[0]), ['id', 'clinic_id'], 'even global read scoped to session clinic');
  assert.deepEqual(h.trace.writes[0].filters.map(x => x[0]), ['id'], 'original global write predicate preserved');
}
{
  const h = makeHarness({ writeData: null });
  const responses = await Promise.all([h.invoke(body), h.invoke(body)]);
  assert.deepEqual(responses.map(x => x.statusCode), [409, 409], 'concurrent stale saves never return false success');
  assert.equal(h.trace.reads.length, 2);
  assert.equal(h.trace.writes.length, 2);
}
{
  const h = makeHarness();
  await h.invoke(body);
  await h.invoke(body);
  assert.equal(h.trace.writes.length, 2, 'repeat PATCH does not insert/duplicate items');
  assert.equal(h.trace.reads.length, 2, 'no extra read for repeated PATCH');
}
console.log('ABA-M16: Save ACK, tenant/IDOR, payload, schema errors, no-row/race, no-extra-query PASS');
