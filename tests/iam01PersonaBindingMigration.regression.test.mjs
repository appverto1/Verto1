import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  'supabase/migrations/20261116185752_iam01_persona_login_bindings_v1.sql',
  'utf8',
);

test('IAM binding table is additive and does not rewrite clinical identities', () => {
  assert.match(sql, /CREATE TABLE public\.iam_persona_access_bindings_v1/);
  assert.match(sql, /auth_user_id uuid NOT NULL REFERENCES auth\.users\(id\)/);
  assert.match(sql, /clinic_id uuid REFERENCES public\.clinics\(id\)/);
  assert.match(sql, /patient_id uuid REFERENCES public\.patients\(id\)/);
  assert.match(sql, /partner_account_id uuid REFERENCES public\.verto_partner_accounts\(id\)/);
  assert.match(sql, /portal IN \('professional', 'patient', 'partner'\)/);
  assert.match(sql, /allowed_login_method IN \('password', 'google'\)/);
  assert.match(sql, /iam_persona_exactly_one_scoped_target_v1 CHECK/);
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:public\.)?(?:users|patients|clinics|clinic_memberships|verto_partner_accounts)\b/i);
});

test('IAM target bindings are unique and cannot silently duplicate a revoked identity', () => {
  for (const portal of ['professional', 'patient', 'partner']) {
    assert.match(sql, new RegExp(`CREATE UNIQUE INDEX iam_persona_unique_${portal}_v1`));
  }
  assert.match(sql, /access_status IN \('active', 'suspended', 'revoked'\)/);
  assert.match(sql, /version integer NOT NULL DEFAULT 1 CHECK \(version > 0\)/);
  assert.match(sql, /CREATE INDEX iam_persona_user_portal_status_v1/);
});

test('IAM table is closed to direct frontend reads and mutations (RLS + ACL)', () => {
  assert.match(sql, /ALTER TABLE public\.iam_persona_access_bindings_v1 ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.iam_persona_access_bindings_v1 FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE\s+ON TABLE public\.iam_persona_access_bindings_v1 TO service_role/);
  assert.doesNotMatch(sql, /CREATE POLICY|GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE)\s+ON TABLE [^;]+ TO (?:PUBLIC|anon|authenticated)/i);
  assert.doesNotMatch(sql, /SECURITY DEFINER|BYPASSRLS/i);
});
