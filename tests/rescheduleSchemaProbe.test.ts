import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPOINTMENT_ACTION_RESOLUTION_SCHEMA_PROBE,
  APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION,
  APPOINTMENT_ACTION_APPROVAL_REQUIRED_COLUMNS,
  APPOINTMENT_ACTION_AVAILABILITY_REQUIRED_COLUMNS,
  APPOINTMENT_ACTION_OPTIONAL_COLUMNS,
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
const completeAvailabilityColumns = Object.fromEntries(
  APPOINTMENT_ACTION_AVAILABILITY_REQUIRED_COLUMNS.map((column) => [column, true]),
);
const completeApprovalColumns = Object.fromEntries(
  APPOINTMENT_ACTION_APPROVAL_REQUIRED_COLUMNS.map((column) => [column, true]),
);
const completeOptionalColumns = Object.fromEntries(
  APPOINTMENT_ACTION_OPTIONAL_COLUMNS.map((column) => [column, true]),
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

test('approval-only fields do not block availability, but keep approval protected', async () => {
  const client = makeClient({
    status: Promise.resolve({
      data: {
        reschedule: {
          version: APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION,
          approve_rpc: true,
          service_role_execute: true,
          anon_execute: false,
          authenticated_execute: false,
          appointment_columns: completeAppointmentColumns,
          availability_columns: completeAvailabilityColumns,
          approval_columns: { ...completeApprovalColumns, patient_confirmation_status: false },
          optional_columns: completeOptionalColumns,
          legacy_columns: { date: true, time: true, duration_minutes: true },
        },
      },
      error: null,
    }),
  });
  const result = await checkAppointmentActionResolutionSchema(client);
  assert.equal(result.compatible, false);
  assert.equal(result.availabilityReady, true);
  assert.equal(result.approvalReady, false);
  assert.equal(result.reason, 'availability_ready_approval_schema_incomplete');
  assert.equal(result.approvalReason, 'approval_columns_missing');
  assert.deepEqual(result.missingCriticalColumns, []);
  assert.deepEqual(result.missingApprovalColumns, ['patient_confirmation_status']);
  assert.deepEqual(result.legacyColumnsDetected, ['date', 'time', 'duration_minutes']);
  assert.equal(client.calls[0].name, APPOINTMENT_ACTION_RESOLUTION_SCHEMA_PROBE);
  assert.equal(client.calls[1].name, VERTO_CRITICAL_SCHEMA_STATUS_RPC);
  assert.equal(client.calls.some((call) => call.name === 'approve_appointment_reschedule_v2'), false);
});

test('persisted request scope can support read-only availability while physical scope columns keep approval blocked', async () => {
  const missingScopeColumns = ['organization_id', 'clinic_id', 'patient_id', 'status'];
  const result = await checkAppointmentActionResolutionSchema(makeClient({
    status: Promise.resolve({
      data: {
        reschedule: {
          version: APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION,
          approve_rpc: true,
          service_role_execute: true,
          anon_execute: false,
          authenticated_execute: false,
          availability_columns: completeAvailabilityColumns,
          approval_columns: {
            ...completeApprovalColumns,
            ...Object.fromEntries(missingScopeColumns.map((column) => [column, false])),
          },
          optional_columns: completeOptionalColumns,
          legacy_columns: {},
        },
      },
      error: null,
    }),
  }));

  assert.equal(result.availabilityReady, true);
  assert.equal(result.approvalReady, false);
  assert.deepEqual(result.missingCriticalColumns, []);
  assert.deepEqual(result.missingApprovalColumns, missingScopeColumns);
  assert.equal(result.approvalReason, 'approval_columns_missing');
});

test('availability remains blocked only when an operational appointment field is missing', async () => {
  const result = await checkAppointmentActionResolutionSchema(makeClient({
    status: Promise.resolve({
      data: {
        reschedule: {
          version: APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION,
          approve_rpc: true,
          service_role_execute: true,
          anon_execute: false,
          authenticated_execute: false,
          availability_columns: { ...completeAvailabilityColumns, scheduled_duration_minutes: false },
          approval_columns: completeApprovalColumns,
          optional_columns: completeOptionalColumns,
          legacy_columns: {},
        },
      },
      error: null,
    }),
  }));

  assert.equal(result.compatible, false);
  assert.equal(result.availabilityReady, false);
  assert.equal(result.approvalReady, false);
  assert.equal(result.reason, 'appointment_columns_missing');
  assert.equal(result.stage, 'appointment_columns');
  assert.deepEqual(result.missingCriticalColumns, ['scheduled_duration_minutes']);
});

test('optional and legacy appointment fields are observable without changing readiness', async () => {
  const result = await checkAppointmentActionResolutionSchema(makeClient({
    status: Promise.resolve({
      data: {
        reschedule: {
          version: APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION,
          approve_rpc: true,
          service_role_execute: true,
          anon_execute: false,
          authenticated_execute: false,
          availability_columns: completeAvailabilityColumns,
          approval_columns: completeApprovalColumns,
          optional_columns: { ...completeOptionalColumns, patient_email: false },
          legacy_columns: { date: true },
        },
      },
      error: null,
    }),
  }));

  assert.equal(result.compatible, true);
  assert.equal(result.availabilityReady, true);
  assert.equal(result.approvalReady, true);
  assert.deepEqual(result.missingOptionalColumns, ['patient_email']);
  assert.deepEqual(result.legacyColumnsDetected, ['date']);
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
