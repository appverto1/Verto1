import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

export const TISS_AUTHORIZATION_RESERVATION_RPC = 'reserve_tiss_authorization_billing_context';
export const TISS_AUTHORIZATION_RESERVATION_SCHEMA_VERSION = '20260715120000';
export const APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION = '20260720160000';
export const APPOINTMENT_ACTION_RESOLUTION_RPCS = [
  'approve_appointment_reschedule_v2',
  'approve_appointment_cancellation',
  'reject_appointment_action_request',
];

const probeId = '00000000-0000-4000-8000-000000000001';

export function isDeployEnvironment(env = process.env) {
  return (
    String(env.NODE_ENV || '').toLowerCase() === 'production' ||
    Boolean(env.RAILWAY_ENVIRONMENT) ||
    String(env.VERCEL_ENV || '').toLowerCase() === 'production' ||
    String(env.DEPLOY_ENV || '').toLowerCase() === 'production'
  );
}

export function classifyReservationSchemaProbe(error) {
  const code = String(error?.code || '').trim().toUpperCase();
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();

  if (message.includes('TISS_AUTHORIZATION_SCOPE_INVALID')) {
    return { compatible: false, reason: 'rpc_legacy_version' };
  }
  if (code === '42501' || message.includes('PERMISSION DENIED')) {
    return { compatible: false, reason: 'rpc_permission_mismatch' };
  }
  if (code === 'PGRST202' || code === '42883' || message.includes(TISS_AUTHORIZATION_RESERVATION_RPC.toUpperCase())) {
    return { compatible: false, reason: 'rpc_missing_or_signature_mismatch' };
  }
  return { compatible: false, reason: 'rpc_probe_failed' };
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
  };
}

export async function checkAppointmentActionResolutionSchema(client) {
  const requiredAppointmentColumns = [
    'id',
    'therapist_name',
    'patient_confirmation_status',
    'patient_confirmation_at',
    'patient_confirmation_by',
    'patient_confirmation_source',
    'source_payload',
    'notification_sent',
    'notification_sent_at',
    'notification_12h_sent',
    'notification_12h_sent_at'
  ];
  const appointmentColumnProbe = await client
    .from('appointments')
    .select(requiredAppointmentColumns.join(','))
    .limit(1);
  if (appointmentColumnProbe.error) {
    return {
      compatible: false,
      schemaVersion: null,
      reason: 'appointment_columns_missing',
      details: String(appointmentColumnProbe.error?.message || '')
    };
  }
  const common = {
    p_organization_id: probeId,
    p_clinic_id: probeId,
    p_request_id: probeId,
    p_appointment_id: probeId,
    p_patient_id: probeId,
    p_actor_id: probeId,
    p_actor_role: 'schema_probe',
    p_resolution_note: null,
  };
  const probes = await Promise.all([
    client.rpc('approve_appointment_reschedule_v2', {
      ...common,
      p_selected_option_index: 0,
      p_scheduled_start: '2099-01-01T12:00:00.000Z',
      p_scheduled_end: '2099-01-01T12:50:00.000Z',
      p_duration_minutes: 50,
      p_professional_id: probeId,
      p_professional_name: 'Schema probe',
      p_room_id: null,
      p_room_name: null,
      p_location_type: 'outro',
      p_session_buffer_minutes: 0,
      p_metadata: { schema_probe: true },
    }),
    client.rpc('approve_appointment_cancellation', {
      ...common,
      p_idempotency_key: 'schema-probe',
    }),
    client.rpc('reject_appointment_action_request', {
      ...common,
      p_idempotency_key: 'schema-probe',
    }),
  ]);
  const incompatible = probes.map((result, index) => {
    const error = result?.error;
    if (!error) return null;
    const code = String(error?.code || '').trim().toUpperCase();
    const message = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ').toUpperCase();
    if (code === '42501' || message.includes('FORBIDDEN')) return null;
    return {
      rpc: APPOINTMENT_ACTION_RESOLUTION_RPCS[index],
      reason: code === 'PGRST202' || code === '42883' ? 'rpc_missing_or_signature_mismatch' : 'rpc_probe_failed',
    };
  }).find(Boolean);
  return incompatible
    ? { compatible: false, schemaVersion: null, ...incompatible }
    : { compatible: true, schemaVersion: APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION, reason: 'compatible' };
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

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const result = await checkCriticalSchema(client);
  if (!result.compatible) {
    throw new Error(`Schema TISS incompativel (${result.reason}). Aplique as migrations antes de publicar o backend.`);
  }
  const appointmentActions = await checkAppointmentActionResolutionSchema(client);
  if (!appointmentActions.compatible) {
    throw new Error(`Schema de solicitacoes de agenda incompativel (${appointmentActions.reason}; RPC ${appointmentActions.rpc}). Aplique as migrations antes de publicar o backend.`);
  }
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
