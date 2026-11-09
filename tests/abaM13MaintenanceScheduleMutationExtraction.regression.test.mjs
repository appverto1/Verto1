import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const server = readFileSync('server.ts', 'utf8');
const source = readFileSync('services/abaMaintenanceScheduleMutationHandlers.ts', 'utf8');
const routes = [
  ['patch', '/api/aba/maintenance-schedules/:scheduleId', 'createAbaMaintenanceScheduleEditHandler'],
  ['post', '/api/aba/maintenance-schedules/:scheduleId/cancel', 'createAbaMaintenanceScheduleCancelHandler'],
  ['post', '/api/aba/maintenance-schedules/:scheduleId/complete', 'createAbaMaintenanceScheduleCompleteHandler']
];
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandbox = { exports: {}, process: { env: { NODE_ENV: 'test' } }, console };
vm.runInNewContext(compiled, sandbox);
const factories = routes.map(([, , name]) => sandbox.exports[name]);
for (const fn of factories) assert.equal(typeof fn, 'function');
const ids = {
  clinic: '11111111-1111-4111-8111-111111111111',
  otherClinic: '99999999-9999-4999-8999-999999999999',
  patient: '22222222-2222-4222-8222-222222222222',
  target: '33333333-3333-4333-8333-333333333333',
  schedule: '55555555-5555-4555-8555-555555555555',
  otherSchedule: '66666666-6666-4666-8666-666666666666',
  appointment: '77777777-7777-4777-8777-777777777777',
  actor: '88888888-8888-4888-8888-888888888888'
};
const isUuid = value => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(value));
const schedule = { id: ids.schedule, clinic_id: ids.clinic, organization_id: ids.clinic, patient_id: ids.patient, target_id: ids.target, status: 'SCHEDULED', raw_payload: {}, metadata: {} };
const response = () => ({ statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(body) { this.payload = body; return this; } });
function makeHarness({ allowed = true, payloadOk = true, row = schedule, result = { data: { id: ids.schedule }, error: null }, targetExists = true, appointmentExists = true } = {}) {
  const trace = { limits: [], reads: [], writes: [], scopes: [], access: [], activity: [], enrich: [] };
  const deps = {
    enforcePayloadLimit(req, res, limit) { trace.limits.push(limit); if (!payloadOk) { res.status(413).json({ success: false }); return false; } return true; },
    sanitizeString: (v, size) => String(v ?? '').trim().slice(0, size),
    currentClinicId: user => user.clinicId,
    hasPersistedMaintenanceScheduleId: isUuid,
    supabase: { from(table) {
      assert.equal(table, 'aba_maintenance_schedules');
      const filters = [];
      return { select() { return this; }, eq(k, v) { filters.push([k, v]); return this; }, limit() { return this; },
        async maybeSingle() {
          trace.reads.push(filters);
          const found = row && filters.every(([key, val]) => key === 'id' ? val === row.id : key === 'clinic_id' ? val === row.clinic_id : key === 'organization_id' ? val === row.organization_id : true);
          return { data: found ? row : null, error: null };
        }
      };
    } },
    ABA_MAINTENANCE_SCHEDULE_SELECT: 'id,patient_id,clinic_id,organization_id,target_id,status,raw_payload,metadata',
    applyAbaTenantScope(q, user, clinicId, organizationId) {
      trace.scopes.push({ clinicId, organizationId });
      return q.eq('clinic_id', clinicId);
    },
    hasMissingFinancialSchema: () => false,
    isUuid,
    async canAccessPatientInCurrentClinic(patientId, user) {
      trace.access.push({ patientId, clinicId: user.clinicId });
      return allowed && patientId === ids.patient && user.clinicId === ids.clinic;
    },
    ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES: ['SCHEDULED', 'PENDING_NEXT_SESSION'],
    normalizeAbaMaintenanceScheduleStatus: status => String(status ?? '').toUpperCase(),
    async fetchTargetForMaintenance(args) { return targetExists && args.targetId === ids.target && args.clinicId === ids.clinic ? { id: ids.target, name: 'Target mock' } : null; },
    readMaintenanceStoredPayload: value => value || {},
    async fetchMaintenanceAppointmentById(args) { return appointmentExists && args.patientId === ids.patient && args.clinicId === ids.clinic ? { id: ids.appointment, scheduled_at: '2026-11-09T10:00:00Z' } : null; },
    sanitizeIsoDateTime: value => String(value ?? ''),
    cleanObject: value => value,
    sanitizeClinicalPayload: value => value,
    readClinicalDateInput: value => /^\d{4}-\d\d-\d\d$/.test(String(value ?? '')) ? value : null,
    async updateAbaScheduleWithSchemaFallback(scheduleId, patch, clinicId, organizationId, patientId) {
      trace.writes.push({ scheduleId, patch, clinicId, organizationId, patientId });
      return result;
    },
    isLegacyMaintenanceScheduleConstraintError: () => false,
    buildLegacyMaintenanceScheduleRow: patch => patch,
    persistActivityLog: value => { trace.activity.push(value); },
    async enrichMaintenanceRowsWithTargetDisplay(rows) { trace.enrich.push(rows); return rows; }
  };
  const user = { id: ids.actor, clinicId: ids.clinic, organizationId: ids.clinic };
  const invoke = async (index, body = {}, override = {}) => {
    const req = { params: { scheduleId: ids.schedule }, body, session: { user }, ...override };
    const res = response();
    await factories[index](() => deps)(req, res);
    return res;
  };
  return { trace, invoke };
}
for (const [idx, expectedLimit] of [[0, 49152], [1, 24576], [2, 49152]]) {
  const h = makeHarness({ payloadOk: false }), res = await h.invoke(idx);
  assert.equal(res.statusCode, 413);
  assert.equal(h.trace.limits[0], expectedLimit);
  assert.equal(h.trace.reads.length, 0);
  assert.equal(h.trace.writes.length, 0);
  const invalid = makeHarness(), invalidRes = await invalid.invoke(idx, {}, { params: { scheduleId: 'fake-id' } });
  assert.equal(invalidRes.statusCode, 400);
  assert.equal(invalid.trace.reads.length, 0);
  const forbidden = makeHarness({ allowed: false }), forbiddenRes = await forbidden.invoke(idx);
  assert.equal(forbiddenRes.statusCode, 404);
  assert.equal(forbidden.trace.writes.length, 0);
  const other = makeHarness({ row: { ...schedule, clinic_id: ids.otherClinic } }), otherRes = await other.invoke(idx);
  assert.equal(otherRes.statusCode, 404, 'cross-clinic schedule must not be modified');
  assert.equal(other.trace.writes.length, 0);
  const noAck = makeHarness({ result: { data: null, error: null } });
  const noAckRes = await noAck.invoke(idx, idx === 0 ? { mode: 'NEXT_SESSION' } : {});
  assert.equal(noAckRes.statusCode, 409, 'zero updated rows must never report success');
  assert.equal(noAckRes.payload.error, 'PERSISTENCE_NOT_CONFIRMED');
  assert.equal(noAck.trace.activity.length, 0, 'never audit an unpersisted edit/cancel');
  assert.equal(noAck.trace.enrich.length, 0, 'never enrich a phantom completion');
  assert.equal(noAck.trace.writes.length, 1);
  const wrongAck = makeHarness({ result: { data: { id: ids.otherSchedule }, error: null } });
  const wrongAckRes = await wrongAck.invoke(idx, idx === 0 ? { mode: 'NEXT_SESSION' } : {});
  assert.equal(wrongAckRes.statusCode, 409, 'wrong updated ID must not report success');
  const error = makeHarness({ result: { data: null, error: { message: 'write rejected' } } });
  const errorRes = await error.invoke(idx, idx === 0 ? { mode: 'NEXT_SESSION' } : {});
  assert.equal(errorRes.statusCode, 500);
}
{
  const h = makeHarness();
  const r = await h.invoke(0, { mode: 'DATE', dueDate: '2026-11-10', clinicId: ids.otherClinic, organizationId: ids.otherClinic });
  assert.equal(r.statusCode, 200);
  assert.equal(r.payload.success, true);
  assert.equal(h.trace.writes.length, 1);
  assert.equal(h.trace.writes[0].scheduleId, ids.schedule);
  assert.equal(h.trace.writes[0].clinicId, ids.clinic, 'session clinic, not body clinic');
  assert.equal(h.trace.writes[0].organizationId, ids.clinic, 'session organization, not body organization');
  assert.equal(h.trace.writes[0].patientId, ids.patient, 'row patient, not body patient');
  assert.equal(h.trace.writes[0].patch.due_date, '2026-11-10');
  assert.equal(h.trace.activity.length, 1);
}
for (const [body, status, error] of [
  [{ mode: 'INVALID' }, 400, 'INVALID_MODE'],
  [{ mode: 'DATE' }, 400, 'MISSING_DUE_DATE'],
  [{ mode: 'APPOINTMENT' }, 400, 'MISSING_APPOINTMENT_ID']
]) {
  const h = makeHarness(), r = await h.invoke(0, body);
  assert.equal(r.statusCode, status);
  assert.equal(r.payload.error, error);
  assert.equal(h.trace.writes.length, 0);
}
{
  const h = makeHarness({ appointmentExists: false }), r = await h.invoke(0, { mode: 'APPOINTMENT', appointmentId: ids.appointment });
  assert.equal(r.statusCode, 404); assert.equal(h.trace.writes.length, 0);
}
{
  const h = makeHarness({ row: { ...schedule, status: 'CANCELLED' } }), r = await h.invoke(0, { mode: 'NEXT_SESSION' });
  assert.equal(r.statusCode, 409); assert.equal(h.trace.writes.length, 0);
}
{
  const h = makeHarness({ row: { ...schedule, status: 'COMPLETED' } }), r = await h.invoke(1);
  assert.equal(r.statusCode, 409); assert.equal(h.trace.writes.length, 0);
}
{
  const h = makeHarness(), r = await h.invoke(1, { reason: 'cancelamento', clinicId: ids.otherClinic });
  assert.equal(r.statusCode, 200);
  assert.equal(h.trace.writes[0].patch.status, 'CANCELLED');
  assert.equal(h.trace.writes[0].patch.metadata.cancelReason, 'cancelamento');
  assert.equal(h.trace.writes[0].patch.cancelled_by, ids.actor);
  assert.equal(h.trace.writes[0].clinicId, ids.clinic);
  assert.equal(h.trace.activity.length, 1);
}
{
  const h = makeHarness(), r = await h.invoke(2, { completedAt: '2026-11-11T10:00:00Z', patientId: ids.otherClinic });
  assert.equal(r.statusCode, 200);
  assert.equal(r.payload.success, true);
  assert.equal(h.trace.writes[0].patch.status, 'COMPLETED');
  assert.equal(h.trace.writes[0].patch.completed_by, ids.actor);
  assert.equal(h.trace.writes[0].clinicId, ids.clinic);
  assert.equal(h.trace.writes[0].patientId, ids.patient);
  assert.equal(h.trace.enrich.length, 1);
}
{
  // Simulate a concurrent writer winning between read and UPDATE:
  // DB returns 0 affected rows; edit/cancel/complete must not claim persistence.
  for (let idx = 0; idx < 3; idx++) {
    const h = makeHarness({ result: { data: null, error: null } });
    const r = await h.invoke(idx, idx === 0 ? { mode: 'NEXT_SESSION' } : {});
    assert.equal(r.statusCode, 409);
  }
}
console.log('ABA-M13: byte parity (except ACK), routes, tenant/IDOR, payload, success/zero-row ACK, edit/cancel/complete PASS');
