import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

export const TISS_AUTHORIZATION_RESERVATION_RPC = 'reserve_tiss_authorization_billing_context';
export const TISS_AUTHORIZATION_RESERVATION_SCHEMA_VERSION = '20260715120000';

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
  console.log('[Schema] RPC de reserva TISS compativel com o backend.');
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error('[Schema] Deploy bloqueado:', error?.message || String(error));
    process.exit(1);
  });
}
