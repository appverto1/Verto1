import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

export const TISS_AUTHORIZATION_RESERVATION_RPC = 'reserve_tiss_authorization_billing_context';
export const TISS_AUTHORIZATION_RESERVATION_SCHEMA_VERSION = '20260715120000';
export const APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION = '20260721123000';
export const APPOINTMENT_ACTION_RESOLUTION_SCHEMA_PROBE = 'get_reschedule_schema_version';
export const VERTO_CRITICAL_SCHEMA_STATUS_RPC = 'get_verto_critical_schema_status';
export const APPOINTMENT_ACTION_RESOLUTION_RPCS = [
  'approve_appointment_reschedule_v2',
  'approve_appointment_cancellation',
  'reject_appointment_action_request',
];
// Availability only reads the appointment's operational identity and its time
// window. Keep this deliberately smaller than the write contract so an
// optional audit/notification column cannot hide viable alternatives.
export const APPOINTMENT_ACTION_AVAILABILITY_REQUIRED_COLUMNS = [
  'id',
  'organization_id',
  'clinic_id',
  'patient_id',
  'status',
  'scheduled_at',
  'scheduled_start_at',
  'scheduled_end_at',
  'scheduled_duration_minutes',
  'therapist_id',
];

// The approval RPC updates these fields in the same transaction. A missing
// field must keep approval blocked, but must not block the availability view.
export const APPOINTMENT_ACTION_APPROVAL_REQUIRED_COLUMNS = [
  ...APPOINTMENT_ACTION_AVAILABILITY_REQUIRED_COLUMNS,
  'therapist_name',
  'room_id',
  'room_name',
  'location_type',
  'patient_response',
  'patient_responded_at',
  'patient_confirmation_status',
  'patient_confirmation_at',
  'patient_confirmation_by',
  'patient_confirmation_source',
  'source_payload',
  'reschedule_requested_at',
  'reschedule_requested_by',
  'notification_24h_sent_at',
  'notification_12h_sent_at',
  'notification_sent',
  'notification_sent_at',
  'notification_12h_sent',
  'notification_12h_sent_at',
];

export const APPOINTMENT_ACTION_OPTIONAL_COLUMNS = [
  'patient_email',
  'date',
  'time',
  'duration_minutes',
  'approach',
  'service_type',
  'location_notes',
  'call_link',
  'confirmed_at',
  'confirmed_by',
  'confirmed_by_role',
  'cancel_requested_at',
  'cancel_requested_by',
  'recurrence_group_id',
  'recurrence_index',
  'notes',
  'created_at',
  'updated_at',
];

// These remain readable compatibility fields. Their absence must never make
// the reschedule module unavailable.
export const APPOINTMENT_ACTION_LEGACY_COLUMNS = [
  'date',
  'time',
  'duration_minutes',
];

// Backwards-compatible export used by deployment and source tests. It now
// denotes the full write contract, not the smaller availability contract.
export const APPOINTMENT_ACTION_REQUIRED_COLUMNS = APPOINTMENT_ACTION_APPROVAL_REQUIRED_COLUMNS;

const probeId = '00000000-0000-4000-8000-000000000001';
const DEFAULT_SCHEMA_PROBE_TIMEOUT_MS = 6_000;

export function isDeployEnvironment(env = process.env) {
  return (
    String(env.NODE_ENV || '').toLowerCase() === 'production' ||
    Boolean(env.RAILWAY_ENVIRONMENT) ||
    String(env.VERCEL_ENV || '').toLowerCase() === 'production' ||
    String(env.DEPLOY_ENV || '').toLowerCase() === 'production'
  );
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export function getSupabaseProjectRef(url) {
  try {
    const host = new URL(String(url || '')).hostname.toLowerCase();
    if (!host.endsWith('.supabase.co')) return null;
    return host.split('.')[0] || null;
  } catch {
    return null;
  }
}

export function getSupabaseProjectRefFromJwt(token) {
  const payload = decodeJwtPayload(token);
  const issuer = String(payload?.iss || '');
  const match = issuer.match(/https:\/\/([a-z0-9-]+)\.supabase\.co\/auth\/v1/i);
  return match?.[1]?.toLowerCase() || null;
}

function maskValue(value, visibleStart = 4, visibleEnd = 3) {
  const normalized = String(value || '').trim();
  if (!normalized) return 'unknown';
  if (normalized.length <= visibleStart + visibleEnd) return `${normalized.slice(0, 1)}***`;
  return `${normalized.slice(0, visibleStart)}***${normalized.slice(-visibleEnd)}`;
}

export function describeSupabaseTarget(url, environment = process.env.NODE_ENV || process.env.RAILWAY_ENVIRONMENT || 'unknown') {
  let host = 'unknown';
  try {
    host = new URL(String(url || '')).hostname.toLowerCase();
  } catch {
    host = 'invalid';
  }
  const projectRef = getSupabaseProjectRef(url);
  const maskedHost = projectRef && host.endsWith('.supabase.co')
    ? `${maskValue(projectRef)}.supabase.co`
    : maskValue(host, 8, 6);
  return {
    environment: String(environment || 'unknown').slice(0, 80),
    host: maskedHost,
    projectRef: maskValue(projectRef),
  };
}

export function validateSupabaseTargetConfiguration({ url, serviceRoleKey, expectedProjectRef }) {
  const urlRef = getSupabaseProjectRef(url);
  const tokenRef = getSupabaseProjectRefFromJwt(serviceRoleKey);
  const expectedRef = String(expectedProjectRef || '').trim().toLowerCase() || null;
  if (urlRef && tokenRef && urlRef !== tokenRef) {
    return { ok: false, reason: 'service_role_project_mismatch', urlRef, tokenRef, expectedRef };
  }
  if (expectedRef && urlRef && expectedRef !== urlRef) {
    return { ok: false, reason: 'expected_project_mismatch', urlRef, tokenRef, expectedRef };
  }
  if (expectedRef && tokenRef && expectedRef !== tokenRef) {
    return { ok: false, reason: 'expected_service_role_mismatch', urlRef, tokenRef, expectedRef };
  }
  return { ok: true, reason: 'target_confirmed', urlRef, tokenRef, expectedRef };
}

function schemaProbeTimeout(timeoutMs = DEFAULT_SCHEMA_PROBE_TIMEOUT_MS) {
  const error = new Error(`schema probe timeout after ${timeoutMs}ms`);
  error.code = 'SCHEMA_PROBE_TIMEOUT';
  return error;
}

async function withSchemaProbeTimeout(promise, timeoutMs = DEFAULT_SCHEMA_PROBE_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(schemaProbeTimeout(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function classifyReservationSchemaProbe(error) {
  const code = String(error?.code || '').trim().toUpperCase();
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();

  if (message.includes('TISS_AUTHORIZATION_SCOPE_INVALID')) {
    return { compatible: false, reason: 'rpc_legacy_version', retryable: false };
  }
  if (code === '42501' || message.includes('PERMISSION DENIED')) {
    return { compatible: false, reason: 'rpc_permission_mismatch', retryable: false };
  }
  if (code === 'PGRST202' || code === '42883' || message.includes(TISS_AUTHORIZATION_RESERVATION_RPC.toUpperCase())) {
    return { compatible: false, reason: 'rpc_missing_or_signature_mismatch', retryable: true };
  }
  return { compatible: false, reason: 'rpc_probe_failed', retryable: true };
}

export function classifyAppointmentActionSchemaProbe(error, stage = 'version_probe') {
  const code = String(error?.code || '').trim().toUpperCase();
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  if (code === 'SCHEMA_PROBE_TIMEOUT') {
    return { compatible: false, reason: 'probe_timeout', retryable: true, failureKind: 'transient' };
  }
  if (code === '42501' || message.includes('PERMISSION DENIED')) {
    return { compatible: false, reason: `${stage}_permission_denied`, retryable: false, failureKind: 'permission' };
  }
  if (code === 'PGRST202' || code === '42883' || message.includes('COULD NOT FIND THE FUNCTION')) {
    return { compatible: false, reason: `${stage}_missing_or_schema_cache_stale`, retryable: true, failureKind: 'schema' };
  }
  if (
    code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' ||
    message.includes('FETCH FAILED') || message.includes('NETWORK') || message.includes('TIMEOUT')
  ) {
    return { compatible: false, reason: `${stage}_network_error`, retryable: true, failureKind: 'transient' };
  }
  return { compatible: false, reason: `${stage}_failed`, retryable: true, failureKind: 'unknown' };
}

export async function checkCriticalSchema(client) {
  const { data, error } = await client.rpc(TISS_AUTHORIZATION_RESERVATION_RPC, {
    p_organization_id: probeId,
    p_appointment_id: probeId,
    p_patient_id: probeId,
    p_authorization_id: probeId,
    p_context: {
      organization_id: probeId,
      patient_id: probeId,
      payer_id: probeId,
      metadata: { schema_probe: true },
    },
  });

  if (error) return classifyReservationSchemaProbe(error);
  const schemaVersion = String(data?.schema_version || '').trim();
  const compatible = data?.compatible === true && schemaVersion === TISS_AUTHORIZATION_RESERVATION_SCHEMA_VERSION;
  return {
    compatible,
    reason: compatible ? 'compatible' : 'rpc_version_mismatch',
    schemaVersion: schemaVersion || null,
    retryable: !compatible,
  };
}

export async function checkAppointmentActionResolutionSchema(client, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_SCHEMA_PROBE_TIMEOUT_MS);
  let versionProbe;
  try {
    versionProbe = await withSchemaProbeTimeout(
      client.rpc(APPOINTMENT_ACTION_RESOLUTION_SCHEMA_PROBE),
      timeoutMs,
    );
  } catch (error) {
    return {
      ...classifyAppointmentActionSchemaProbe(error, 'version_probe'),
      schemaVersion: null,
      rpc: APPOINTMENT_ACTION_RESOLUTION_SCHEMA_PROBE,
      stage: 'version_probe',
      details: String(error?.message || error || '').slice(0, 500),
    };
  }
  if (versionProbe?.error) {
    return {
      ...classifyAppointmentActionSchemaProbe(versionProbe.error, 'version_probe'),
      schemaVersion: null,
      rpc: APPOINTMENT_ACTION_RESOLUTION_SCHEMA_PROBE,
      stage: 'version_probe',
      details: String(versionProbe.error?.message || '').slice(0, 500),
    };
  }

  const schemaVersion = String(
    typeof versionProbe?.data === 'string'
      ? versionProbe.data
      : versionProbe?.data?.schema_version || versionProbe?.data?.version || '',
  ).trim();
  if (schemaVersion !== APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION) {
    return {
      compatible: false,
      schemaVersion: schemaVersion || null,
      rpc: APPOINTMENT_ACTION_RESOLUTION_SCHEMA_PROBE,
      stage: 'version_probe',
      reason: 'version_probe_mismatch',
      retryable: true,
      failureKind: 'schema',
    };
  }

  // The catalog status probe is intentionally read-only. It validates columns,
  // the exact approval signature and grants without selecting clinical rows or
  // invoking mutation RPCs with synthetic identifiers.
  const statusResult = await readCriticalSchemaStatus(client, { timeoutMs });
  if (!statusResult.ok) {
    return {
      compatible: false,
      schemaVersion,
      rpc: VERTO_CRITICAL_SCHEMA_STATUS_RPC,
      stage: 'schema_status',
      reason: statusResult.reason || 'schema_status_failed',
      retryable: statusResult.retryable !== false,
      failureKind: statusResult.failureKind || 'unknown',
      details: statusResult.details || null,
    };
  }

  const reschedule = statusResult.data?.reschedule || {};
  const statusVersion = String(reschedule.version || '').trim();
  if (statusVersion !== APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION) {
    return {
      compatible: false,
      schemaVersion: statusVersion || schemaVersion,
      rpc: VERTO_CRITICAL_SCHEMA_STATUS_RPC,
      stage: 'schema_status',
      reason: 'schema_status_version_mismatch',
      retryable: true,
      failureKind: 'schema',
    };
  }
  const appointmentColumns = reschedule.appointment_columns || {};
  const availabilityColumns = reschedule.availability_columns || appointmentColumns;
  const approvalColumns = reschedule.approval_columns || appointmentColumns;
  const optionalColumns = reschedule.optional_columns || {};
  const legacyColumns = reschedule.legacy_columns || {};
  const missingCriticalColumns = APPOINTMENT_ACTION_AVAILABILITY_REQUIRED_COLUMNS.filter(
    (column) => availabilityColumns[column] !== true,
  );
  const missingApprovalColumns = APPOINTMENT_ACTION_APPROVAL_REQUIRED_COLUMNS.filter(
    (column) => approvalColumns[column] !== true,
  );
  const missingOptionalColumns = APPOINTMENT_ACTION_OPTIONAL_COLUMNS.filter(
    (column) => optionalColumns[column] === false,
  );
  const legacyColumnsDetected = APPOINTMENT_ACTION_LEGACY_COLUMNS.filter(
    (column) => legacyColumns[column] === true,
  );
  if (missingCriticalColumns.length > 0) {
    return {
      compatible: false,
      availabilityReady: false,
      approvalReady: false,
      schemaVersion: statusVersion,
      rpc: VERTO_CRITICAL_SCHEMA_STATUS_RPC,
      stage: 'appointment_columns',
      reason: 'appointment_columns_missing',
      retryable: true,
      failureKind: 'schema',
      missingCriticalColumns,
      missingApprovalColumns,
      missingOptionalColumns,
      legacyColumnsDetected,
      details: `missing:${missingCriticalColumns.join(',')}`,
    };
  }

  const rpcAvailable = reschedule.approve_rpc === true;
  const rpcSignatureValid = rpcAvailable;
  const serviceRoleExecute = reschedule.service_role_execute === true;
  const excessiveApprovalPermissions = reschedule.anon_execute === true || reschedule.authenticated_execute === true;
  const approvalReady =
    rpcAvailable &&
    rpcSignatureValid &&
    serviceRoleExecute &&
    !excessiveApprovalPermissions &&
    missingApprovalColumns.length === 0;
  const approvalReason = !rpcAvailable
    ? 'approval_rpc_missing_or_signature_mismatch'
    : !serviceRoleExecute
      ? 'approval_rpc_service_role_permission_missing'
      : excessiveApprovalPermissions
        ? 'approval_rpc_excessive_permissions'
        : missingApprovalColumns.length > 0
          ? 'approval_columns_missing'
          : 'ready';

  return {
    compatible: approvalReady,
    availabilityReady: true,
    approvalReady,
    schemaVersion: statusVersion,
    rpc: approvalReady ? null : APPOINTMENT_ACTION_RESOLUTION_RPCS[0],
    rpcAvailable,
    rpcSignatureValid,
    serviceRoleExecute,
    missingCriticalColumns,
    missingApprovalColumns,
    missingOptionalColumns,
    legacyColumnsDetected,
    reason: approvalReady ? 'compatible' : 'availability_ready_approval_schema_incomplete',
    approvalReason,
    retryable: approvalReason !== 'approval_rpc_service_role_permission_missing' && approvalReason !== 'approval_rpc_excessive_permissions',
    failureKind: approvalReady ? null : approvalReason.includes('permission') ? 'permission' : 'schema',
    stage: approvalReady ? 'complete' : 'approval_schema',
  };
}

export async function readCriticalSchemaStatus(client, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_SCHEMA_PROBE_TIMEOUT_MS);
  try {
    const result = await withSchemaProbeTimeout(client.rpc(VERTO_CRITICAL_SCHEMA_STATUS_RPC), timeoutMs);
    if (result?.error) {
      return {
        ok: false,
        ...classifyAppointmentActionSchemaProbe(result.error, 'schema_status'),
        details: String(result.error?.message || '').slice(0, 500),
      };
    }
    return { ok: true, data: result?.data || null };
  } catch (error) {
    return {
      ok: false,
      ...classifyAppointmentActionSchemaProbe(error, 'schema_status'),
      details: String(error?.message || error || '').slice(0, 500),
    };
  }
}

function logSchemaAudit(status) {
  const reschedule = status?.reschedule || {};
  const tasks = status?.tasks || {};
  const invitations = status?.invitations || {};
  const pass = (message) => console.log(`PASS ${message}`);
  const warn = (message) => console.warn(`WARN ${message}`);
  const fail = (message) => console.error(`FAIL ${message}`);

  if (reschedule.version === APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION) {
    pass(`reschedule schema version: ${reschedule.version}`);
  } else {
    fail(`reschedule schema version: ${reschedule.version || 'missing'}`);
  }
  if (reschedule.approve_rpc === true) pass('approve_appointment_reschedule_v2');
  else fail('approve_appointment_reschedule_v2 missing or signature mismatch');
  if (reschedule.service_role_execute === true) pass('service_role can execute reschedule RPC');
  else fail('service_role cannot execute reschedule RPC');
  if (reschedule.anon_execute === false && reschedule.authenticated_execute === false) {
    pass('anon/authenticated direct execution revoked');
  } else {
    fail('reschedule RPC has excessive execute grants');
  }

  for (const [column, present] of Object.entries(tasks.columns || {})) {
    if (present) pass(`tasks.${column}`);
    else warn(`tasks.${column} absent; apply the audited tasks alignment migration`);
  }
  for (const [column, present] of Object.entries(invitations.columns || {})) {
    if (present) pass(`invitations.${column}`);
    else warn(`invitations.${column} absent; apply the audited invitations alignment migration`);
  }
}

async function main() {
  const forceCheck = String(process.env.VERTO_CHECK_CRITICAL_SCHEMA || '').trim() === '1';
  const explicitScriptRun = process.env.npm_lifecycle_event === 'check:critical-schema';
  if (!isDeployEnvironment() && !forceCheck && !explicitScriptRun) {
    console.log('[Schema] Checagem critica ignorada fora de deploy. Use npm run check:critical-schema para executar.');
    return;
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios para validar o schema critico.');
  }

  const target = describeSupabaseTarget(supabaseUrl, process.env.RAILWAY_ENVIRONMENT || process.env.DEPLOY_ENV || process.env.NODE_ENV);
  const targetValidation = validateSupabaseTargetConfiguration({
    url: supabaseUrl,
    serviceRoleKey,
    expectedProjectRef: process.env.SUPABASE_EXPECTED_PROJECT_REF,
  });
  console.log(`[Schema] Target Supabase: environment=${target.environment}; host=${target.host}; ref=${target.projectRef}`);
  if (!targetValidation.ok) {
    throw new Error(`Projeto Supabase divergente (${targetValidation.reason}). Revise as variaveis do ambiente antes de aplicar migrations.`);
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const result = await checkCriticalSchema(client);
  if (!result.compatible) {
    throw new Error(`Schema TISS incompativel (${result.reason}). Aplique as migrations antes de publicar o backend.`);
  }
  const appointmentActions = await checkAppointmentActionResolutionSchema(client);
  if (!appointmentActions.compatible) {
    const diagnostic = {
      expectedVersion: APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION,
      actualVersion: appointmentActions.schemaVersion || null,
      stage: appointmentActions.stage || null,
      reason: appointmentActions.reason || null,
      approvalReason: appointmentActions.approvalReason || null,
      missingCriticalColumns: appointmentActions.missingCriticalColumns || [],
      missingApprovalColumns: appointmentActions.missingApprovalColumns || [],
      missingOptionalColumns: appointmentActions.missingOptionalColumns || [],
      legacyColumnsDetected: appointmentActions.legacyColumnsDetected || [],
    };
    console.error('[Schema] Diagnóstico técnico de remarcação:', diagnostic);
    throw new Error(
      `Schema de solicitacoes de agenda incompativel (${appointmentActions.reason}; etapa ${appointmentActions.stage || 'unknown'}; RPC ${appointmentActions.rpc || 'n/a'}). ` +
      'Aplique a migration corretiva no mesmo projeto Supabase e aguarde o reload do PostgREST.',
    );
  }
  const audit = await readCriticalSchemaStatus(client);
  if (audit.ok) logSchemaAudit(audit.data);
  else console.warn(`WARN auditor detalhado indisponivel (${audit.reason})`);
  console.log('[Schema] RPC de reserva TISS compativel com o backend.');
  console.log('[Schema] RPCs atomicas de solicitacoes de agenda compativeis com o backend.');
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error('[Schema] Deploy bloqueado:', error?.message || String(error));
    process.exit(1);
  });
}
