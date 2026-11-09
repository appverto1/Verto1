import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/operations/promotion_staging_sources/20261015211500_group_session_booking_ledger.sql', 'utf8');

assert.match(migration, /\bbegin\s*;/i, 'migration must use a transaction');
assert.match(migration, /\bcommit\s*;/i);
assert.equal((migration.match(/\bas \$\$\s*\n/g) || []).length, 2, 'both trigger functions must use $$ PLpgSQL delimiters');
assert.equal((migration.match(/\n\$\$;/g) || []).length, 2, 'both trigger functions must close with $$');
assert.doesNotMatch(migration, /\bas \$\s*\n/, 'single-dollar function delimiter is not valid SQL');
assert.match(migration, /create table if not exists public\.group_session_bookings/i);
assert.match(migration, /create table if not exists public\.group_session_participants/i);
assert.match(migration, /unique\s*\(organization_id,booking_key\)/i, 'tenant-scoped idempotency key must be unique');
assert.match(migration, /payload_hash\s+text\s+not null/i, 'idempotency fingerprint must be stored');
assert.match(migration, /unique\s*\(id,organization_id\)/i);
assert.match(migration, /foreign key\s*\(booking_id,organization_id\)[\s\S]*?references public\.group_session_bookings\(id,organization_id\)/i, 'participant cannot link a booking across clinics');
assert.match(migration, /primary key\s*\(booking_id,patient_id\)/i, 'patient may appear only once in a group');
assert.match(migration, /appointment_id\s+uuid\s+not null unique/i, 'appointment cannot be shared by two groups');
assert.match(migration, /financial_plan_id\s+uuid\s+not null references public\.patient_financial_plans/i);
assert.match(migration, /unit_amount_cents\s+integer\s+not null/i, 'group patient price snapshot must be explicit');

assert.match(migration, /create or replace function public\.verify_group_session_booking_v1/i);
assert.match(migration, /GROUP_BOOKING_SLOT_IMMUTABLE/, 'group slot/tenant identity immutable');
assert.match(migration, /GROUP_BOOKING_SLOT_IMMUTABLE[\s\S]{0,600}if tg_op = 'UPDATE' then[\s\S]*?return new;/i, 'cancellation must survive room/member deactivation');
assert.match(migration, /GROUP_BOOKING_STATUS_TRANSITION_INVALID/, 'terminal booking must not be silently reopened');
assert.match(migration, /old\.created_at is distinct from new\.created_at/, 'booking creation timestamp immutable');
assert.match(migration, /GROUP_BOOKING_ROOM_SCOPE_INVALID/, 'room must be active in clinic');
assert.match(migration, /GROUP_BOOKING_ACTOR_SCOPE_INVALID/, 'booking actor must have active clinic membership');
assert.match(migration, /GROUP_BOOKING_PROFESSIONAL_SCOPE_INVALID/, 'professional must be active in the correct specialty and clinic');
assert.match(migration, /lower\(membership\.role\)\s*=\s*'therapist'/i);
assert.match(migration, /count\(distinct membership\.user_id\)/i);

assert.match(migration, /create or replace function public\.verify_group_session_participant_v1/i);
assert.match(migration, /for update\s*;/i, 'joining a group must hold a booking row lock for concurrency');
assert.match(migration, /GROUP_PARTICIPANT_ROOM_CAPACITY_EXCEEDED/);
assert.match(migration, /GROUP_PARTICIPANT_PATIENT_SCOPE_INVALID/);
assert.match(migration, /GROUP_PARTICIPANT_RATE_SCOPE_INVALID/);
assert.match(migration, /plan\.group_amount_cents\s*=\s*new\.unit_amount_cents/i);
assert.match(migration, /GROUP_PARTICIPANT_APPOINTMENT_SCOPE_INVALID/);
assert.match(migration, /appointment\.therapist_id\s*=\s*any\(v_booking\.professional_ids\)/i);
assert.match(migration, /appointment\.location_type\s*=\s*'clinica'/i);
assert.match(migration, /appointment\.scheduled_duration_minutes/i);
assert.match(migration, /appointment\.source_payload->'professionalIds'\s*@>\s*to_jsonb\(v_booking\.professional_ids\)/i, 'full group team must be persisted for conflict checks');
assert.match(migration, /appointment\.deleted_at is null/i);
assert.match(migration, /public\.appointment_financial_service_key_v1\(v_booking\.specialty\)/i, 'billing specialty must match group specialty');
assert.match(migration, /appointment\.source_payload->>'sessionGroupId'\s*=\s*new\.booking_id::text/i);
assert.match(migration, /appointment\.source_payload->>'sessionModality'\s*=\s*'GROUP'/i);
assert.match(migration, /before insert on public\.group_session_participants/i, 'financial snapshots cannot be mutated through this trigger');
assert.doesNotMatch(migration, /grant\s+[^;]*update\s+on\s+table\s+public\.group_session_participants/i);

for (const table of ['group_session_bookings', 'group_session_participants']) {
  assert.match(migration, new RegExp('alter table public\\.' + table + ' enable row level security', 'i'));
  assert.match(migration, new RegExp('revoke all on table public\\.' + table + ' from public,anon,authenticated', 'i'));
}
assert.doesNotMatch(migration, /grant\s+[^;]*on\s+table\s+public\.group_session_(?:bookings|participants)\s+to\s+(?:anon|authenticated)/i);
assert.doesNotMatch(migration, /\bdrop table\b|\btruncate\b|\bdelete from\b/i);
console.log('groupSessionBookingLedgerSql.test.mjs: ok');
