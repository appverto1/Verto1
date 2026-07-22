import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  describeSupabaseTarget,
  validateSupabaseTargetConfiguration,
} from './check-critical-schema.mjs';

export const SALES_COMMERCIAL_SCHEMA_VERSION = '20260722170000';
export const SALES_COMMERCIAL_SCHEMA_CONTRACT = 'sales_assisted_signup_v2_minimal_capture';
export const SALES_COMMERCIAL_SCHEMA_FINGERPRINT =
  'sha256:a978f0d9079d3585d92d22e143c57c8236bb2256b2ddb0d86564c759480f198e';
export const SALES_COMMERCIAL_SCHEMA_RPC =
  'get_sales_commercial_schema_fingerprint';

export const SALES_COMMERCIAL_TABLES = [
  'sales_leads',
  'sales_lead_events',
  'sales_offers',
  'pending_activations',
  'sales_subscription_discounts',
  'sales_discount_notifications',
];

export const SALES_COMMERCIAL_ENUMS = [
  'sales_lead_status',
  'sales_lead_event_type',
  'sales_offer_status',
];

export const SALES_COMMERCIAL_ADMIN_POLICY_TABLES = [
  'sales_leads',
  'sales_lead_events',
  'sales_offers',
  'sales_subscription_discounts',
  'sales_discount_notifications',
];

export const SALES_COMMERCIAL_INDEXES = [
  'sales_leads_normalized_email_uidx',
  'sales_leads_normalized_phone_uidx',
  'sales_lead_events_idempotency_uidx',
  'sales_offers_public_token_hash_uidx',
  'sales_offers_creator_idempotency_uidx',
  'pending_activations_sales_checkout_uidx',
  'pending_activations_sales_token_uidx',
  'sales_subscription_discounts_subscription_uidx',
  'sales_discount_notifications_idempotency_uidx',
];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readPath(value, path) {
  return path.split('.').reduce(
    (current, segment) => (isObject(current) ? current[segment] : undefined),
    value,
  );
}

export function evaluateSalesCommercialSchemaAudit(payload) {
  const checks = [];
  const add = (ok, label) => checks.push({ ok: ok === true, label });

  if (!isObject(payload)) {
    add(false, 'sales commercial fingerprint available');
    return { ok: false, checks };
  }

  add(
    payload.version === SALES_COMMERCIAL_SCHEMA_VERSION,
    `sales commercial version ${SALES_COMMERCIAL_SCHEMA_VERSION}`,
  );
  add(
    payload.contract === SALES_COMMERCIAL_SCHEMA_CONTRACT,
    `sales commercial contract ${SALES_COMMERCIAL_SCHEMA_CONTRACT}`,
  );
  add(
    payload.fingerprint === SALES_COMMERCIAL_SCHEMA_FINGERPRINT,
    'sales commercial fingerprint',
  );

  for (const table of SALES_COMMERCIAL_TABLES) {
    add(readPath(payload, `checks.tables.${table}`) === true, `table ${table}`);
    add(readPath(payload, `checks.columns.${table}`) === true, `columns ${table}`);
    add(readPath(payload, `checks.rls.${table}`) === true, `RLS ${table}`);
  }

  add(readPath(payload, 'checks.critical_types') === true, 'critical column types');
  add(
    readPath(payload, 'checks.minimal_capture.email_optional') === true,
    'minimal capture optional email',
  );
  add(
    readPath(payload, 'checks.minimal_capture.estimated_active_patients_optional') === true,
    'minimal capture optional patient estimate',
  );
  add(
    readPath(payload, 'checks.minimal_capture.whatsapp_identity') === true,
    'minimal capture WhatsApp identity',
  );
  for (const enumName of SALES_COMMERCIAL_ENUMS) {
    add(readPath(payload, `checks.enums.${enumName}`) === true, `enum ${enumName}`);
  }

  add(
    readPath(payload, 'checks.rpc.upsert_public_sales_lead') === true,
    'upsert_public_sales_lead available',
  );
  add(readPath(payload, 'checks.rpc.signature') === true, 'upsert_public_sales_lead signature');
  add(readPath(payload, 'checks.rpc.security_definer') === true, 'upsert RPC security definer');
  add(readPath(payload, 'checks.rpc.search_path_fixed') === true, 'upsert RPC fixed search_path');
  add(readPath(payload, 'checks.rpc.named_arguments') === true, 'upsert RPC named arguments');
  add(readPath(payload, 'checks.rpc.postgres_execute') === true, 'postgres can execute upsert RPC');
  add(readPath(payload, 'checks.rpc.service_role_execute') === true, 'service_role can execute upsert RPC');
  add(readPath(payload, 'checks.rpc.anon_execute') === false, 'anon cannot execute upsert RPC');
  add(
    readPath(payload, 'checks.rpc.authenticated_execute') === false,
    'authenticated cannot execute upsert RPC',
  );

  for (const table of SALES_COMMERCIAL_ADMIN_POLICY_TABLES) {
    add(readPath(payload, `checks.policies.${table}`) === true, `admin policy ${table}`);
  }
  add(
    readPath(payload, 'checks.policies.platform_admin_helper') === true,
    'platform sales admin policy helper',
  );
  add(
    readPath(payload, 'checks.policies.pending_activations_no_public_policy') === true,
    'pending_activations has no public policy',
  );

  for (const index of SALES_COMMERCIAL_INDEXES) {
    add(readPath(payload, `checks.indexes.${index}`) === true, `index ${index}`);
  }

  add(
    readPath(payload, 'checks.grants.commercial_tables_restricted') === true,
    'commercial table grants',
  );
  add(
    readPath(payload, 'checks.grants.pending_activations_least_privilege') === true,
    'pending_activations least privilege',
  );
  add(
    readPath(payload, 'checks.grants.upsert_rpc_server_only') === true,
    'upsert RPC server-only access',
  );
  add(
    readPath(payload, 'checks.grants.fingerprint_rpc_server_only') === true,
    'fingerprint RPC server-only access',
  );

  add(readPath(payload, 'checks.legacy.sales_activations') === false, 'legacy sales_activations absent');
  add(readPath(payload, 'checks.legacy.capture_sales_lead') === false, 'legacy capture_sales_lead absent');
  add(readPath(payload, 'checks.legacy.legacy_columns') === false, 'legacy commercial columns absent');
  add(readPath(payload, 'checks.legacy.legacy_indexes') === false, 'legacy commercial indexes absent');
  add(payload.structural_ready === true, 'commercial structural readiness');
  add(payload.security_ready === true, 'commercial security readiness');
  add(payload.ready === true, 'sales commercial schema ready');

  return { ok: checks.every((check) => check.ok), checks };
}

function printAudit(result) {
  for (const check of result.checks) {
    const log = check.ok ? console.log : console.error;
    log(`${check.ok ? 'PASS' : 'FAIL'} ${check.label}`);
  }
}

export async function runSalesCommercialSchemaAudit({
  supabaseUrl = process.env.SUPABASE_URL,
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  expectedProjectRef = process.env.SUPABASE_EXPECTED_PROJECT_REF,
} = {}) {
  const url = String(supabaseUrl || '').trim();
  const key = String(serviceRoleKey || '').trim();
  if (!url || !key) {
    return {
      ok: false,
      checks: [{ ok: false, label: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY configured' }],
    };
  }

  const targetValidation = validateSupabaseTargetConfiguration({
    url,
    serviceRoleKey: key,
    expectedProjectRef,
  });
  if (!targetValidation.ok) {
    return {
      ok: false,
      checks: [{ ok: false, label: `Supabase target confirmed (${targetValidation.reason})` }],
    };
  }

  const target = describeSupabaseTarget(
    url,
    process.env.RAILWAY_ENVIRONMENT || process.env.DEPLOY_ENV || process.env.NODE_ENV,
  );
  console.log(
    `[Sales Schema] Target: environment=${target.environment}; host=${target.host}; ref=${target.projectRef}`,
  );

  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await client.rpc(SALES_COMMERCIAL_SCHEMA_RPC);
  if (error) {
    return {
      ok: false,
      checks: [
        {
          ok: false,
          label: `sales commercial fingerprint available (code ${String(error.code || 'unknown').slice(0, 32)})`,
        },
      ],
    };
  }
  return evaluateSalesCommercialSchemaAudit(data);
}

async function main() {
  const result = await runSalesCommercialSchemaAudit();
  printAudit(result);
  if (!result.ok) process.exitCode = 1;
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(
      `FAIL sales commercial schema audit (${String(error?.code || 'unexpected_error').slice(0, 40)})`,
    );
    process.exitCode = 1;
  });
}
