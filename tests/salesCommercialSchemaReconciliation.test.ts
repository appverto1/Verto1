import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SALES_COMMERCIAL_ADMIN_POLICY_TABLES,
  SALES_COMMERCIAL_ENUMS,
  SALES_COMMERCIAL_INDEXES,
  SALES_COMMERCIAL_SCHEMA_CONTRACT,
  SALES_COMMERCIAL_SCHEMA_FINGERPRINT,
  SALES_COMMERCIAL_SCHEMA_VERSION,
  SALES_COMMERCIAL_TABLES,
  evaluateSalesCommercialSchemaAudit,
} from "../scripts/check-sales-commercial-schema.mjs";

const migration = readFileSync(
  "supabase/migrations/20260722153000_sales_commercial_schema_reconciliation.sql",
  "utf8",
);
const auditor = readFileSync("scripts/check-sales-commercial-schema.mjs", "utf8");
const manifest = readFileSync(
  "docs/sales-commercial-schema-reconciliation.md",
  "utf8",
);
const server = readFileSync("server.ts", "utf8");

function canonicalPayload() {
  return {
    version: SALES_COMMERCIAL_SCHEMA_VERSION,
    contract: SALES_COMMERCIAL_SCHEMA_CONTRACT,
    fingerprint: SALES_COMMERCIAL_SCHEMA_FINGERPRINT,
    ready: true,
    structural_ready: true,
    security_ready: true,
    checks: {
      tables: Object.fromEntries(SALES_COMMERCIAL_TABLES.map((name) => [name, true])),
      columns: Object.fromEntries(SALES_COMMERCIAL_TABLES.map((name) => [name, true])),
      critical_types: true,
      enums: Object.fromEntries(SALES_COMMERCIAL_ENUMS.map((name) => [name, true])),
      rpc: {
        upsert_public_sales_lead: true,
        signature: true,
        security_definer: true,
        search_path_fixed: true,
        named_arguments: true,
        postgres_execute: true,
        service_role_execute: true,
        anon_execute: false,
        authenticated_execute: false,
      },
      rls: Object.fromEntries(SALES_COMMERCIAL_TABLES.map((name) => [name, true])),
      policies: {
        ...Object.fromEntries(
          SALES_COMMERCIAL_ADMIN_POLICY_TABLES.map((name) => [name, true]),
        ),
        platform_admin_helper: true,
        pending_activations_no_public_policy: true,
      },
      indexes: Object.fromEntries(SALES_COMMERCIAL_INDEXES.map((name) => [name, true])),
      grants: {
        commercial_tables_restricted: true,
        pending_activations_least_privilege: true,
        upsert_rpc_server_only: true,
        fingerprint_rpc_server_only: true,
      },
      legacy: {
        sales_activations: false,
        capture_sales_lead: false,
        legacy_columns: false,
        legacy_indexes: false,
      },
    },
  };
}

test("canonical commercial schema is accepted deterministically", () => {
  const payload = canonicalPayload();
  const first = evaluateSalesCommercialSchemaAudit(payload);
  const second = evaluateSalesCommercialSchemaAudit(payload);
  assert.equal(first.ok, true);
  assert.deepEqual(second, first);
});

test("legacy and hybrid commercial schemas are rejected", () => {
  const legacy = canonicalPayload();
  legacy.checks.legacy.sales_activations = true;
  assert.equal(evaluateSalesCommercialSchemaAudit(legacy).ok, false);

  const hybrid = canonicalPayload();
  hybrid.checks.legacy.legacy_columns = true;
  assert.equal(evaluateSalesCommercialSchemaAudit(hybrid).ok, false);
});

test("missing table, column, wrong type, or enum drift is rejected", () => {
  const missingTable = canonicalPayload();
  missingTable.checks.tables.sales_offers = false;
  assert.equal(evaluateSalesCommercialSchemaAudit(missingTable).ok, false);

  const missingColumn = canonicalPayload();
  missingColumn.checks.columns.pending_activations = false;
  assert.equal(evaluateSalesCommercialSchemaAudit(missingColumn).ok, false);

  const wrongType = canonicalPayload();
  wrongType.checks.critical_types = false;
  assert.equal(evaluateSalesCommercialSchemaAudit(wrongType).ok, false);

  const wrongEnum = canonicalPayload();
  wrongEnum.checks.enums.sales_lead_event_type = false;
  assert.equal(evaluateSalesCommercialSchemaAudit(wrongEnum).ok, false);
});

test("missing or incompatible upsert RPC is rejected", () => {
  const missing = canonicalPayload();
  missing.checks.rpc.upsert_public_sales_lead = false;
  assert.equal(evaluateSalesCommercialSchemaAudit(missing).ok, false);

  const wrongSignature = canonicalPayload();
  wrongSignature.checks.rpc.signature = false;
  assert.equal(evaluateSalesCommercialSchemaAudit(wrongSignature).ok, false);

  const wrongNames = canonicalPayload();
  wrongNames.checks.rpc.named_arguments = false;
  assert.equal(evaluateSalesCommercialSchemaAudit(wrongNames).ok, false);
});

test("excessive grants and wrong index definitions are rejected", () => {
  const excessiveGrant = canonicalPayload();
  excessiveGrant.checks.rpc.anon_execute = true;
  assert.equal(evaluateSalesCommercialSchemaAudit(excessiveGrant).ok, false);

  const pendingGrant = canonicalPayload();
  pendingGrant.checks.grants.pending_activations_least_privilege = false;
  assert.equal(evaluateSalesCommercialSchemaAudit(pendingGrant).ok, false);

  const wrongIndex = canonicalPayload();
  wrongIndex.checks.indexes.sales_offers_public_token_hash_uidx = false;
  assert.equal(evaluateSalesCommercialSchemaAudit(wrongIndex).ok, false);
});

test("fingerprint mismatch or unavailable fingerprint fails closed", () => {
  const mismatch = canonicalPayload();
  mismatch.fingerprint = "sha256:invalid";
  assert.equal(evaluateSalesCommercialSchemaAudit(mismatch).ok, false);
  assert.equal(evaluateSalesCommercialSchemaAudit(null).ok, false);
});

test("migration validates first, performs no commercial DML, and is idempotent", () => {
  assert.match(migration, /begin;[\s\S]*commit;/i);
  assert.match(migration, /create or replace function public\.get_sales_commercial_schema_fingerprint\(\)/i);
  assert.match(migration, /SALES_COMMERCIAL_SCHEMA_LEGACY_OR_HYBRID/i);
  assert.match(migration, /SALES_COMMERCIAL_SCHEMA_INCOMPATIBLE/i);
  assert.match(migration, /revoke all on table public\.pending_activations from anon/i);
  assert.match(migration, /revoke all on table public\.pending_activations from authenticated/i);
  assert.match(
    migration,
    /grant select, insert, update, delete on table public\.pending_activations to service_role/i,
  );
  assert.doesNotMatch(migration, /grant[^;]*truncate[^;]*pending_activations/i);
  assert.doesNotMatch(migration, /^\s*(?:insert\s+into|update|delete\s+from|truncate)\s+public\.(?:sales_|pending_activations)/im);
  assert.doesNotMatch(migration, /create\s+table|drop\s+table|alter\s+table/i);
  assert.doesNotMatch(migration, /supabase_migrations\.schema_migrations/i);
});

test("migration checks index semantics instead of trusting index names", () => {
  assert.match(migration, /i\.indisunique/);
  assert.match(migration, /i\.indisvalid/);
  assert.match(migration, /i\.indkey::smallint\[\]/);
  assert.match(migration, /pg_get_expr\(i\.indpred, i\.indrelid\)/);
  for (const indexName of SALES_COMMERCIAL_INDEXES) {
    assert.match(migration, new RegExp(indexName));
  }
});

test("pending activations remain backend-only after hardening", () => {
  assert.match(server, /const supabaseServiceKey = process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(server, /supabase = createClient\(supabaseUrl, supabaseServiceKey/);
  assert.match(server, /supabase[\s\S]*\.from\("pending_activations"\)/);
  assert.doesNotMatch(server, /supabaseAuthClient[\s\S]{0,160}\.from\("pending_activations"\)/);
  assert.match(migration, /pending_activations_least_privilege/);
});

test("public lead capture and post-payment activation contracts stay intact", () => {
  assert.match(server, /"\/api\/public\/sales-leads"/);
  assert.match(server, /supabase\.rpc\("upsert_public_sales_lead"/);
  assert.match(server, /processSalesAssistedCheckoutCompleted/);
  assert.match(server, /\.from\("pending_activations"\)[\s\S]*\.insert\(/);
  assert.match(migration, /revoke all on function public\.upsert_public_sales_lead/);
  assert.match(migration, /to postgres, service_role/);
});

test("auditor is read-only, fails closed, and never prints commercial records", () => {
  assert.match(auditor, /client\.rpc\(SALES_COMMERCIAL_SCHEMA_RPC\)/);
  assert.match(auditor, /process\.exitCode = 1/);
  assert.doesNotMatch(auditor, /\.from\(|\.insert\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(auditor, /console\.(?:log|error).*serviceRoleKey/);
  assert.equal(
    (auditor.match(/client\.rpc\(SALES_COMMERCIAL_SCHEMA_RPC\)/g) || []).length,
    1,
  );
});

test("manifest documents manual order and clean-install guardrails", () => {
  assert.match(manifest, /Manual application order/);
  assert.match(manifest, /Do not edit[\s\S]*historical commercial migration/i);
  assert.match(manifest, /does not insert a synthetic row/i);
  assert.match(manifest, /future clean-install baseline/i);
  assert.match(manifest, /Legacy or hybrid databases require a separately reviewed data migration/i);
});
