# Sales commercial schema reconciliation

## Scope

This package reconciles the production schema with the canonical
`sales_assisted_signup_v2_minimal_capture` contract without configuring Stripe or Railway.
It does not modify leads, events, offers, activation rows, discounts, tokens,
or the Supabase migration ledger.

## Files

- Migration: `supabase/migrations/20260722153000_sales_commercial_schema_reconciliation.sql`
- Minimal-capture extension: `supabase/migrations/20260722170000_sales_lead_minimal_capture.sql`
- Read-only auditor: `scripts/check-sales-commercial-schema.mjs`
- Focused tests: `tests/salesCommercialSchemaReconciliation.test.ts`

## Expected fingerprint

```text
version:     20260722170000
contract:    sales_assisted_signup_v2_minimal_capture
fingerprint: sha256:a978f0d9079d3585d92d22e143c57c8236bb2256b2ddb0d86564c759480f198e
```

The fingerprint RPC reads PostgreSQL catalogs only. It does not read rows from
commercial tables and is executable only by `postgres` and `service_role`.

## Manual application order

1. Confirm the target Supabase project before opening the SQL editor.
2. Run the base reconciliation migration and then the minimal-capture extension, each in one execution.
3. If it raises `SALES_COMMERCIAL_SCHEMA_LEGACY_OR_HYBRID`, stop. Do not edit
   the exception away and do not apply either historical commercial migration.
   If it raises `SALES_COMMERCIAL_SCHEMA_INCOMPATIBLE`, the canonical contract
   is incomplete; stop and reconcile the reported fingerprint checks before
   retrying.
4. Wait for the PostgREST schema reload notification to take effect.
5. Run `npm run check:sales-commercial-schema` with the same production
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and, when configured,
   `SUPABASE_EXPECTED_PROJECT_REF`.
6. Run `npm run test:sales-assisted` and the focused reconciliation test.
7. Only after every check passes should a later task configure Stripe or
   Railway commercial variables.

The migration is idempotent and may be executed a second time after a clean
first execution. It intentionally does not insert a synthetic row into
`supabase_migrations.schema_migrations`.

## What the migration changes

- Creates or replaces the read-only commercial fingerprint RPC.
- Revokes every table privilege on `pending_activations` from `PUBLIC`, `anon`,
  and `authenticated`.
- Replaces the `service_role` grant on `pending_activations` with only
  `SELECT`, `INSERT`, `UPDATE`, and `DELETE`.
- Reapplies server-only execution grants to `upsert_public_sales_lead` and the
  fingerprint RPC.
- Requests a PostgREST schema reload.

It performs no DML against commercial records and does not create, drop,
rename, or alter commercial tables or columns.

The later minimal-capture extension only makes lead e-mail and patient estimate
optional, preserves enriched values on retries, and replaces the same server-only
upsert RPC. It performs no backfill and does not rewrite existing commercial rows.

## Clean installations

The historical migrations at `20260720170000` and `20260720190000` are
incompatible when applied blindly in sequence. `CREATE TABLE IF NOT EXISTS` in
the later file cannot transform the earlier text/check-based tables into the
canonical enum-based and normalized contract.

A future clean-install baseline should:

1. Start directly from the canonical `sales_assisted_signup_v1` definitions.
2. Exclude `20260720170000_sales_assisted_commercial_flow.sql` from the clean
   bootstrap manifest without rewriting production history.
3. Apply the reconciliation migration after the canonical baseline.
4. Run the read-only auditor against an empty test database.
5. Reject any bootstrap that exposes `sales_activations`,
   `capture_sales_lead`, legacy lead aliases, or the old notification shape.

Legacy or hybrid databases require a separately reviewed data migration. This
reconciliation deliberately refuses to guess field mappings or move records.

## Rollback note

No commercial data rollback is required because no commercial row is changed.
If the privilege hardening reveals an undocumented direct-client consumer,
restore only the minimum required privilege after security review. Do not
restore `TRUNCATE`, public policies, or direct execution of the lead RPC.
