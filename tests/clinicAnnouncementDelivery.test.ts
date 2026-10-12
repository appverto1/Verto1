import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClinicAnnouncementDeliveryService, type ActiveCronServiceOptions } from '../services/clinicAnnouncementDelivery';

const cronSource = readFileSync('services/clinicAnnouncementCronService.ts', 'utf8');
const deliverySource = readFileSync('services/clinicAnnouncementDelivery.ts', 'utf8');
assert.match(cronSource, /createClinicAnnouncementDeliveryService\(/);
assert.match(deliverySource, /async function dispatchClinicAnnouncementById\(/);
assert.doesNotMatch(cronSource, /async function dispatchClinicAnnouncementById\(/);
assert.match(cronSource, /async function recoverClinicAnnouncementAfterFailure\(/);
assert.match(cronSource, /claim_due_clinic_announcements_v1/);
assert.match(cronSource, /cron\.schedule\(/);

const aid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const patient = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const clinic = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const validUuid = (value: unknown) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(value || ''));
const sanitize = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max);
const { dispatchClinicAnnouncementById } = createClinicAnnouncementDeliveryService({
  sanitizeText: sanitize,
  sanitizeEmail: (value) => sanitize(value, 320).toLowerCase(),
  isUuid: validUuid,
  resolveReminderClinicBranding: async () => ({ clinicName: 'Clínica exemplo', clinicLogoUrl: null }),
});
type Row = { patient_id: string; recipient_user_id: string; recipient_email: string; push_status: string };
const results: string[] = [];
async function scenario(
  name: string,
  config: {
    announcement?: Record<string, any> | null;
    recipients?: Row[];
    invalidId?: boolean;
    readError?: { message: string } | null;
    materializeError?: { message: string } | null;
  },
  expected: { reason?: string; delivered?: boolean; failed?: boolean; throwMessage?: string; calls: number; updates: number; rpcs: number },
) {
  const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const updates: Array<{ table: string; payload: Record<string, any>; filters: Array<[string, unknown]> }> = [];
  const rpcs: Array<{ name: string; args: any }> = [];
  const supabase = {
    from(table: string) {
      const call = { table, filters: [] as Array<[string, unknown]> };
      calls.push(call);
      const q = {
        select(_columns: string) { return q; },
        eq(k: string, v: unknown) { call.filters.push([k, v]); return q; },
        order() { return q; },
        limit() { return q; },
        update(payload: Record<string, any>) { updates.push({ table, payload, filters: call.filters }); return q; },
        in(k: string, values: unknown) { call.filters.push([k, values]); return q; },
        async maybeSingle() { return { data: config.announcement ?? null, error: config.readError ?? null }; },
        then(resolve: (value: any) => any, reject: (error: any) => any) {
          return Promise.resolve({ data: table === 'clinic_announcement_recipients' ? config.recipients ?? [] : [], error: null }).then(resolve, reject);
        },
      };
      return q;
    },
    async rpc(name: string, args: any) {
      rpcs.push({ name, args });
      return { data: null, error: config.materializeError ?? null };
    },
  };
  const options: ActiveCronServiceOptions = {
    supabase,
    deploymentEnv: 'staging',
    vapidPublicKey: null,
    vapidPrivateKey: null,
    logger: { log() {}, warn() {}, error() {} },
    runtimeOwnerId: 'test-worker',
    requireDistributedLease: false,
  };
  let result: any;
  let thrown: any = null;
  try {
    result = await dispatchClinicAnnouncementById(options, config.invalidId ? 'invalid' : aid, 'regression');
  } catch (error) { thrown = error; }
  if (expected.throwMessage) assert.match(String(thrown?.message || thrown), new RegExp(expected.throwMessage), name);
  else {
    assert.equal(thrown, null, name);
    assert.equal(result.reason, expected.reason, name);
    assert.equal(result.delivered, expected.delivered, name);
    assert.equal(result.failed, expected.failed, name);
  }
  assert.equal(calls.length, expected.calls, name + ': query count');
  assert.equal(updates.length, expected.updates, name + ': update count');
  assert.equal(rpcs.length, expected.rpcs, name + ': RPC count');
  for (const call of calls.filter((x) => x.table === 'clinic_announcements')) {
    assert.ok(call.filters.some(([k, v]) => k === 'deployment_env' && v === 'staging'), name + ': environment filter');
    assert.ok(call.filters.some(([k, v]) => k === 'id' && v === aid), name + ': announcement filter');
  }
  if (rpcs.length) {
    assert.equal(rpcs[0].name, 'materialize_clinic_announcement_portal_notifications_v1');
    assert.equal(rpcs[0].args.p_deployment_env, 'staging');
    assert.equal(rpcs[0].args.p_announcement_id, aid);
  }
  results.push(name);
}
await scenario('invalid ID fail-closed', { invalidId: true },
  { reason: 'INVALID_ANNOUNCEMENT_ID', delivered: false, failed: true, calls: 0, updates: 0, rpcs: 0 });
await scenario('not found', {},
  { reason: 'NOT_FOUND', delivered: false, failed: false, calls: 1, updates: 0, rpcs: 0 });
await scenario('already sent idempotent', { announcement: { id: aid, clinic_id: clinic, status: 'SENT' } },
  { reason: 'ALREADY_FINAL', delivered: true, failed: false, calls: 1, updates: 0, rpcs: 0 });
await scenario('no recipients', { announcement: { id: aid, clinic_id: clinic, status: 'SCHEDULED' } },
  { reason: 'NO_RECIPIENTS', delivered: false, failed: true, calls: 3, updates: 1, rpcs: 1 });
await scenario('pending recipient without VAPID', {
  announcement: { id: aid, clinic_id: clinic, status: 'SCHEDULED' },
  recipients: [{ patient_id: patient, recipient_user_id: aid, recipient_email: 'a@clinic.test', push_status: 'PENDING' }],
}, { reason: 'SENT', delivered: true, failed: false, calls: 4, updates: 2, rpcs: 1 });
await scenario('already sent recipient avoids double push', {
  announcement: { id: aid, clinic_id: clinic, status: 'SCHEDULED' },
  recipients: [{ patient_id: patient, recipient_user_id: aid, recipient_email: 'a@clinic.test', push_status: 'SENT' }],
}, { reason: 'SENT', delivered: true, failed: false, calls: 3, updates: 1, rpcs: 1 });
await scenario('database read failure', { readError: { message: 'READ_FAILED' } },
  { throwMessage: 'READ_FAILED', calls: 1, updates: 0, rpcs: 0 });
await scenario('materialization RPC failure', { announcement: { id: aid, clinic_id: clinic, status: 'SCHEDULED' }, materializeError: { message: 'RPC_FAILED' } },
  { throwMessage: 'RPC_FAILED', calls: 1, updates: 0, rpcs: 1 });
console.log('clinicAnnouncementDelivery.test: PASS (' + results.length + ' cases)');
