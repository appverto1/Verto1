import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const server = readFileSync('server.ts', 'utf8');
const source = readFileSync('services/abaMaintenanceScheduleLinkHandlers.ts', 'utf8');
const root = '/api/aba/maintenance-schedules/:scheduleId/';
const common = ", requireAbaV2Feature, checkAuth, requireClinicCapability('aba.maintenance.manage'), ";
const entries = [
  { slug: 'confirm-link', name: 'createAbaMaintenanceConfirmLinkHandler', oldHeader: "  app.post('" + root + "confirm-link'" + common + "async (req: any, res) => {", close: '\n  });', methods: ['post'] },
  { slug: 'assign-appointment', name: 'createAbaMaintenanceAssignAppointmentHandler', oldHeader: '  const handleAssignMaintenanceScheduleToAppointment = async (req: any, res: any) => {', close: '\n  };', methods: ['post', 'patch'] },
  { slug: 'relink-target', name: 'createAbaMaintenanceRelinkTargetHandler', oldHeader: '  const handleRelinkMaintenanceScheduleTarget = async (req: any, res: any) => {', close: '\n  };', methods: ['post', 'patch'] },
  { slug: 'skip-link', name: 'createAbaMaintenanceSkipLinkHandler', oldHeader: "  app.post('" + root + "skip-link'" + common + "async (req: any, res) => {", close: '\n  });', methods: ['post'] }
];
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandbox = { exports: {}, process: { env: { NODE_ENV: 'test' } }, console };
vm.runInNewContext(compiled, sandbox);
const handlers = entries.map(({ name }) => sandbox.exports[name]);
for (const handler of handlers) assert.equal(typeof handler, 'function');

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
const row = { id: ids.schedule, clinic_id: ids.clinic, organization_id: ids.clinic, patient_id: ids.patient, target_id: ids.target, status: 'PENDING_LINK', raw_payload: { ignoredAppointmentIds: ['old-appointment'], pendingConfirmationPreviousStatus: 'PENDING_LINK' }, metadata: {} };
const response = () => ({ statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(body) { this.payload = body; return this; } });
function makeHarness({ allowed = true, payloadOk = true, schedule = row, result = { data: { id: ids.schedule }, error: null }, appointmentExists = true, targetExists = true, stale = false } = {}) {
  const trace = { limits: [], reads: [], writes: [], scopes: [], access: [], activity: [], enrich: [], appointments: [], targets: [] };
  const deps = {
    enforcePayloadLimit(req, res, limit) { trace.limits.push(limit); if (!payloadOk) { res.status(413).json({ success: false }); return false; } return true; },
    sanitizeString: (value, size) => String(value ?? '').trim().slice(0, size),
    currentClinicId: user => user.clinicId,
    hasPersistedMaintenanceScheduleId: isUuid,
    isUuid,
    supabase: { from(table) {
      assert.equal(table, 'aba_maintenance_schedules');
      const filters = [];
      return { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; }, limit() { return this; },
        async maybeSingle() {
          trace.reads.push(filters);
          const visible = schedule && filters.every(([key, value]) => key === 'id' ? value === schedule.id : key === 'clinic_id' ? value === schedule.clinic_id : key === 'organization_id' ? value === schedule.organization_id : true);
          return { data: visible ? schedule : null, error: null };
        }
      };
    } },
    ABA_MAINTENANCE_SCHEDULE_SELECT: 'id,patient_id,clinic_id,organization_id,target_id,status,raw_payload,metadata',
    applyAbaTenantScope(query, user, clinicId, organizationId) {
      trace.scopes.push({ clinicId, organizationId });
      return query.eq('clinic_id', clinicId).eq('organization_id', organizationId);
    },
    hasMissingFinancialSchema: () => false,
    async canAccessPatientInCurrentClinic(patientId, user) {
      trace.access.push({ patientId, clinicId: user.clinicId });
      return allowed && patientId === ids.patient && user.clinicId === ids.clinic;
    },
    readMaintenanceStoredPayload: value => value || {},
    async fetchMaintenanceAppointmentById(args) {
      trace.appointments.push(args);
      return appointmentExists && args.patientId === ids.patient && args.clinicId === ids.clinic && args.organizationId === ids.clinic ? { id: ids.appointment, scheduled_at: '2026-11-09T10:00:00Z' } : null;
    },
    async fetchTargetForMaintenance(args) {
      trace.targets.push(args);
      return targetExists && args.patientId === ids.patient && args.clinicId === ids.clinic && args.organizationId === ids.clinic ? { id: ids.target, name: 'Mock PEI target' } : null;
    },
    cleanObject: value => value,
    sanitizeClinicalPayload: value => value,
    async updateAbaScheduleWithSchemaFallback(scheduleId, patch, clinicId, organizationId, patientId) {
      trace.writes.push({ scheduleId, patch, clinicId, organizationId, patientId });
      return stale ? { data: null, error: null } : result;
    },
    persistActivityLog: value => { trace.activity.push(value); },
    async enrichMaintenanceRowsWithTargetDisplay(rows) { trace.enrich.push(rows); return rows; }
  };
  const user = { id: ids.actor, clinicId: ids.clinic, organizationId: ids.clinic };
  async function invoke(idx, body = {}, overrides = {}) {
    const req = { params: { scheduleId: ids.schedule }, body, session: { user }, ...overrides };
    const res = response();
    await handlers[idx](() => deps)(req, res);
    return res;
  }
  return { trace, invoke };
}
const validBodies = [
  { appointmentId: ids.appointment, clinicId: ids.otherClinic },
  { appointmentId: ids.appointment, organizationId: ids.otherClinic },
  { targetId: ids.target, patientId: ids.otherClinic },
  { appointmentId: ids.appointment, clinicId: ids.otherClinic }
];
for (let i = 0; i < 4; i++) {
  const oversized = makeHarness({ payloadOk: false });
  const result = await oversized.invoke(i, validBodies[i]);
  assert.equal(result.statusCode, 413, 'payload threshold: ' + i);
  assert.equal(oversized.trace.limits[0], 49152);
  assert.equal(oversized.trace.reads.length, 0);
  assert.equal(oversized.trace.writes.length, 0);

  const invalid = makeHarness();
  const invalidRes = await invalid.invoke(i, validBodies[i], { params: { scheduleId: 'forged-id' } });
  assert.equal(invalidRes.statusCode, 400, 'invalid schedule ID: ' + i);
  assert.equal(invalid.trace.reads.length, 0);

  const denied = makeHarness({ allowed: false });
  const deniedRes = await denied.invoke(i, validBodies[i]);
  assert.equal(deniedRes.statusCode, 404, 'patient access denied: ' + i);
  assert.equal(denied.trace.writes.length, 0);

  const otherTenant = makeHarness({ schedule: { ...row, clinic_id: ids.otherClinic } });
  const otherTenantRes = await otherTenant.invoke(i, validBodies[i]);
  assert.equal(otherTenantRes.statusCode, 404, 'cross-tenant denied: ' + i);
  assert.equal(otherTenant.trace.writes.length, 0);

  const noAck = makeHarness({ result: { data: null, error: null } });
  const noAckRes = await noAck.invoke(i, validBodies[i]);
  assert.equal(noAckRes.statusCode, 409, 'zero-row UPDATE rejected: ' + i);
  assert.equal(noAckRes.payload.error, 'PERSISTENCE_NOT_CONFIRMED');
  assert.equal(noAck.trace.writes.length, 1, 'single UPDATE, no extra query');
  assert.equal(noAck.trace.activity.length, 0, 'no phantom audit');
  assert.equal(noAck.trace.enrich.length, 0, 'no phantom enrichment');

  const wrongAck = makeHarness({ result: { data: { id: ids.otherSchedule }, error: null } });
  const wrongAckRes = await wrongAck.invoke(i, validBodies[i]);
  assert.equal(wrongAckRes.statusCode, 409, 'wrong-row ACK rejected: ' + i);

  const raced = makeHarness({ stale: true });
  assert.equal((await raced.invoke(i, validBodies[i])).statusCode, 409, 'simulated concurrent zero-row write: ' + i);
  assert.equal(raced.trace.activity.length, 0);

  const rejected = makeHarness({ result: { data: null, error: { message: 'write rejected' } } });
  assert.equal((await rejected.invoke(i, validBodies[i])).statusCode, 500, 'storage error: ' + i);
  assert.equal(rejected.trace.activity.length, 0);

  const ok = makeHarness();
  const okRes = await ok.invoke(i, validBodies[i]);
  assert.equal(okRes.statusCode, 200, 'successful write: ' + i);
  assert.equal(okRes.payload.success, true);
  assert.equal(ok.trace.writes.length, 1);
  assert.equal(ok.trace.writes[0].clinicId, ids.clinic, 'clinic sourced from server session/row');
  assert.equal(ok.trace.writes[0].organizationId, ids.clinic, 'organization sourced from server session/row');
  assert.equal(ok.trace.writes[0].patientId, ids.patient, 'patient sourced from persisted row');
  assert.equal(ok.trace.activity.length, 1);
  assert.equal(ok.trace.enrich.length, 1);
}
for (const [i, body, code] of [[0, {}, 400], [0, { appointmentId: 'bad' }, 400], [1, { appointmentId: 'bad' }, 400], [2, { targetId: 'bad' }, 400]]) {
  const h = makeHarness(), res = await h.invoke(i, body);
  assert.equal(res.statusCode, code, 'invalid target/appointment input ' + i);
  assert.equal(h.trace.writes.length, 0);
}
for (const [i, option, code] of [[0, { appointmentExists: false }, 409], [1, { appointmentExists: false }, 409], [2, { targetExists: false }, 404]]) {
  const h = makeHarness(option), res = await h.invoke(i, validBodies[i]);
  assert.equal(res.statusCode, code, 'canonical appointment/target not found');
  assert.equal(h.trace.writes.length, 0);
}
{
  const h = makeHarness();
  const res = await h.invoke(0, validBodies[0]);
  assert.equal(h.trace.writes[0].patch.appointment_id, ids.appointment);
  assert.equal(h.trace.writes[0].patch.status, 'SCHEDULED');
  assert.equal(h.trace.appointments[0].patientId, ids.patient);
}
{
  const h = makeHarness();
  await h.invoke(1, validBodies[1]);
  assert.equal(h.trace.writes[0].patch.status, 'SCHEDULED');
  assert.equal(h.trace.writes[0].patch.appointment_id, ids.appointment);
}
{
  const h = makeHarness();
  await h.invoke(2, validBodies[2]);
  assert.equal(h.trace.writes[0].patch.target_id, ids.target);
  assert.equal(h.trace.targets[0].patientId, ids.patient);
}
{
  const h = makeHarness();
  await h.invoke(3, validBodies[3]);
  assert.equal(h.trace.writes[0].patch.appointment_id, null);
  assert.equal(h.trace.writes[0].patch.status, 'PENDING_LINK');
  assert.equal(h.trace.writes[0].patch.raw_payload.ignoredAppointmentIds.length, 2);
  assert.equal(h.trace.writes[0].patch.raw_payload.nextSessionPolicy, true);
}
console.log('ABA-M14: six handlers, tenant/IDOR, payload, appointment/target canonical IDs, skip states, zero-row/race, no-extra-query PASS');
