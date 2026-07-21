import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPOINTMENT_ACTION_RESOLUTION_SCHEMA_PROBE,
  APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION,
  APPOINTMENT_ACTION_REQUIRED_COLUMNS,
  VERTO_CRITICAL_SCHEMA_STATUS_RPC,
  checkAppointmentActionResolutionSchema,
  classifyAppointmentActionSchemaProbe,
  describeSupabaseTarget,
  getSupabaseProjectRef,
  validateSupabaseTargetConfiguration,
} from '../scripts/check-critical-schema.mjs';

const completeAppointmentColumns = Object.fromEntries(
  APPOINTMENT_ACTION_REQUIRED_COLUMNS.map((column) => [column, true]),
);

const makeClient = (options: {
  probe?: any;
  status?: any;
} = {}) => {
  const calls: Array<{ name: string; payload: any }> = [];
  const client = {
    calls,
    rpc(name: string, payload?: any) {
      calls.push({ name, payload });
      if (name === APPOINTMENT_ACTION_RESOLUTION_SCHEMA_PROBE) {
        return options.probe ?? Promise.resolve({ data: APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION, error: null });
      }
      if (name === VERTO_CRITICAL_SCHEMA_STATUS_RPC) {
        return options.status ?? Promise.resolve({
          data: {
            reschedule: {
              version: APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION,
              approve_rpc: true,
              service_role_execute: true,
              anon_execute: false,
              authenticated_execute: false,
              appointment_columns: completeAppointmentColumns,
            },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'unknown rpc' } });
    },
  };
  return client as any;
};

test('dedicated reschedule probe accepts only the exact version and RPC signature', async () => {
  const result = await checkAppointmentActionResolutionSchema(makeClient());
  assert.equal(result.compatible, true);
  assert.equal(result.schemaVersion, APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION);
  assert.equal(result.stage, 'complete');
});

test('version mismatch is distinct from missing function and permission denial', async () => {
  const oldVersion = await checkAppointmentActionResolutionSchema(makeClient({
    probe: Promise.resolve({ data: '20260720143000', error: null }),
  }));
  assert.equal(oldVersion.compatible, false);
  assert.equal(oldVersion.reason, 'version_probe_mismatch');

  const missing = await checkAppointmentActionResolutionSchema(makeClient({
    probe: Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
  }));
  assert.equal(missing.reason, 'version_probe_missing_or_schema_cache_stale');
  assert.equal(missing.retryable, true);

  const denied = await checkAppointmentActionResolutionSchema(makeClient({
    probe: Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied' } }),
  }));
  assert.equal(denied.reason, 'version_probe_permission_denied');
  assert.equal(denied.retryable, false);
});

test('null and unexpected probe responses do not produce a false ready state', async () => {
  const nullResult = await checkAppointmentActionResolutionSchema(makeClient({
    probe: Promise.resolve({ data: null, error: null }),
  }));
  assert.equal(nullResult.compatible, false);
  assert.equal(nullResult.reason, 'version_probe_mismatch');

  const objectResult = await checkAppointmentActionResolutionSchema(makeClient({
    probe: Promise.resolve({ data: { unexpected: true }, error: null }),
  }));
  assert.equal(objectResult.compatible, false);
  assert.equal(objectResult.reason, 'version_probe_mismatch');
});

test('timeouts and network errors are classified as transient and retryable', async () => {
  const timeout = await checkAppointmentActionResolutionSchema(makeClient({
    probe: new Promise(() => undefined),
  }), { timeoutMs: 5 });
  assert.equal(timeout.reason, 'probe_timeout');
  assert.equal(timeout.failureKind, 'transient');
  assert.equal(timeout.retryable, true);

  const classified = classifyAppointmentActionSchemaProbe({ code: 'ECONNRESET', message: 'network failure' });
  assert.equal(classified.failureKind, 'transient');
  assert.equal(classified.retryable, true);
});

test('missing appointment columns are detected after the version probe', async () => {
  const client = makeClient({
    status: Promise.resolve({
      data: {
        reschedule: {
          version: APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION,
          approve_rpc: true,
          service_role_execute: true,
          anon_execute: false,
          authenticated_execute: false,
          appointment_columns: { ...completeAppointmentColumns, patient_confirmation_status: false },
        },
      },
      error: null,
    }),
  });
  const result = await checkAppointmentActionResolutionSchema(client);
  assert.equal(result.compatible, false);
  assert.equal(result.reason, 'appointment_columns_missing');
  assert.equal(result.stage, 'appointment_columns');
  assert.equal(client.calls[0].name, APPOINTMENT_ACTION_RESOLUTION_SCHEMA_PROBE);
  assert.equal(client.calls[1].name, VERTO_CRITICAL_SCHEMA_STATUS_RPC);
  assert.equal(client.calls.some((call) => call.name === 'approve_appointment_reschedule_v2'), false);
});

test('Supabase target validation masks logs and detects URL/key/environment mismatch', () => {
  const url = 'https://abcdefghijklmnop.supabase.co';
  assert.equal(getSupabaseProjectRef(url), 'abcdefghijklmnop');
  const target = describeSupabaseTarget(url, 'production');
  assert.equal(target.environment, 'production');
  assert.notEqual(target.projectRef, 'abcdefghijklmnop');
  assert.match(target.host, /\*\*\*/);

  const expectedMismatch = validateSupabaseTargetConfiguration({
    url,
    serviceRoleKey: '',
    expectedProjectRef: 'outroprojeto',
  });
  assert.equal(expectedMismatch.ok, false);
  assert.equal(expectedMismatch.reason, 'expected_project_mismatch');
});
