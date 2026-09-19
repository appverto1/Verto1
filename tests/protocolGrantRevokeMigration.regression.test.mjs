import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20260918231500_protocol_grant_revoke_v1.sql';
const sql = readFileSync(migrationPath, 'utf8');

assert.match(sql, /create or replace function public\.revoke_clinic_protocol_grant_v1\(/, 'canonical revoke RPC must exist');
assert.match(sql, /security definer/, 'revoke RPC must be atomic and security-definer bounded');
assert.match(sql, /from public\.protocol_import_requests[\s\S]*where id = p_request_id[\s\S]*for update;/, 'request must be resolved and locked server-side');
assert.match(sql, /v_request\.status <> 'approved'/, 'pending deletion must remain semantically separate');
assert.match(sql, /public\.is_platform_admin\(p_actor_id\)/, 'platform-admin authority must be explicit');
assert.match(sql, /clinic_memberships[\s\S]*cm\.user_id = p_actor_id[\s\S]*cm\.clinic_id = v_request\.clinic_id[\s\S]*cm\.status = 'active'/, 'clinic actor must have active tenant membership');
assert.match(sql, /permission_key = 'aba\.program\.edit'[\s\S]*effect = 'deny'/, 'explicit capability deny must fail closed in DB');
assert.match(sql, /clinic_id = v_request\.clinic_id[\s\S]*canonical_key = lower\(trim\(v_request\.approved_canonical_key\)\)[\s\S]*for update;/, 'grant must be resolved by request tenant and canonical key');
assert.match(sql, /if v_grant\.revoked_at is not null then[\s\S]*return v_grant;/, 'repeated revoke must be idempotent');
assert.match(sql, /set revoked_at = now\(\),[\s\S]*revoked_by = p_actor_id/, 'revoke may update only canonical grant revoke fields');
assert.doesNotMatch(sql, /delete\s+from\s+public\.(protocol_import_requests|clinic_protocol_grants)/i, 'revoke must never delete request or grant history');
assert.match(sql, /protocol_grant_admin_revoked/, 'admin revoke audit event must be distinct');
assert.match(sql, /protocol_grant_self_revoked/, 'clinic self-revoke audit event must be distinct');
assert.match(sql, /authorization_audit_events/, 'revoke must persist audit evidence');
assert.match(sql, /revoke all on function public\.revoke_clinic_protocol_grant_v1\(uuid, uuid\)[\s\S]*from public, anon, authenticated;/, 'browser roles must not receive execute');
assert.match(sql, /grant execute on function public\.revoke_clinic_protocol_grant_v1\(uuid, uuid\)[\s\S]*to service_role;/, 'only service role may invoke revoke');
assert.match(sql, /approve_protocol_import_request_v1/, 'forward recovery must preserve existing regrant authority');

console.log('protocolGrantRevokeMigration.regression.test.mjs: ok');
