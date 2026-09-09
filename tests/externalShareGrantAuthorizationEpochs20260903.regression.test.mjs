import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260903123000_external_share_grant_authorization_epochs.sql', import.meta.url),
  'utf8',
);
const previousMigration = fs.readFileSync(
  new URL('../supabase/migrations/20260903033000_external_care_network_collaboration_v1.sql', import.meta.url),
  'utf8',
);

// The corrective migration is transactional, additive to data, and specifically
// recognizes the historical global unique index before replacing it.
assert.match(migration, /^BEGIN;/);
assert.match(migration, /patient_evolution_share_grants_item_email_uidx/);
assert.match(migration, /EXTERNAL_SHARE_GRANT_EPOCH_PREFLIGHT_INDEX_UNEXPECTED/);
assert.match(migration, /EXTERNAL_SHARE_GRANT_EPOCH_PREFLIGHT_ACTIVE_DUPLICATE/);
assert.match(migration, /DROP INDEX public\.patient_evolution_share_grants_item_email_uidx/);
assert.match(
  migration,
  /CREATE UNIQUE INDEX patient_evolution_share_grants_item_email_uidx[\s\S]*timeline_item_id,[\s\S]*lower\(btrim\(recipient_email\)\)[\s\S]*WHERE status = 'ACTIVE'/,
);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.patient_evolution_share_grants/i);
assert.doesNotMatch(migration, /TRUNCATE/i);
assert.match(migration, /COMMIT;\s*$/);

// The old migration did contain reactivation semantics; the corrective RPC must
// replace them without mutating revoked rows.
assert.match(previousMigration, /reactivated_at = v_now/);
assert.match(migration, /AND status = 'ACTIVE'[\s\S]*ORDER BY created_at DESC, id DESC[\s\S]*FOR UPDATE/);
assert.doesNotMatch(migration, /reactivated_at\s*=/);
assert.doesNotMatch(migration, /reactivation_count\s*=/);
assert.doesNotMatch(migration, /revoked_at\s*=\s*NULL[\s\S]*UPDATE public\.patient_evolution_share_grants/i);

// ACTIVE -> update the same epoch. No ACTIVE -> INSERT a brand-new epoch with
// fresh locator/read state. Comments are keyed by grant_id elsewhere, so they
// cannot cross epochs when grant ids differ.
assert.match(migration, /IF v_grant\.id IS NOT NULL THEN[\s\S]*UPDATE public\.patient_evolution_share_grants/);
assert.match(migration, /ELSE[\s\S]*INSERT INTO public\.patient_evolution_share_grants/);
assert.match(migration, /gen_random_uuid\(\)/);
assert.match(migration, /first_viewed_at,[\s\S]*last_viewed_at,[\s\S]*view_count/);
assert.match(migration, /NULL,[\s\n]+NULL,[\s\n]+0,[\s\n]+NULL,[\s\n]+NULL,[\s\n]+NULL/);

// Patient unlink/restoration never reactivates grants. The previous feature
// migration revokes only ACTIVE rows, and the corrected upsert sees only ACTIVE
// rows; a future explicit share therefore inserts a new epoch.
assert.match(previousMigration, /SET status = 'REVOKED'/);
assert.match(previousMigration, /WHERE clinic_id = p_clinic_id AND patient_id = p_patient_id AND status = 'ACTIVE'/);
assert.match(migration, /Only the current ACTIVE epoch may be updated/);

// Security boundary remains backend/service-role only.
assert.match(migration, /REVOKE ALL ON FUNCTION public\.upsert_patient_evolution_share_grant_v2/);
assert.match(migration, /TO service_role/);

console.log('externalShareGrantAuthorizationEpochs20260903.regression: PASS');
