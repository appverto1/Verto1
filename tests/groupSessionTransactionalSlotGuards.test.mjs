import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = 'supabase/operations/promotion_staging_sources/20261015225500_group_session_transactional_slot_guards.sql';
const sql = readFileSync(path, 'utf8');
assert.match(sql, /begin;[\s\S]+commit;/i);
assert.match(sql, /create or replace function public\.guard_group_booking_slot_v1\(\)/);
assert.match(sql, /create or replace function public\.guard_group_participant_slot_v1\(\)/);

// Concurrent GROUP creations and joins must serialize on the SAME clinic key.
const lock = "hashtextextended('group-booking-slot:' || ";
assert.equal(sql.split(lock).length - 1, 2, 'booking and participant share clinic lock');
assert.match(sql, /pg_advisory_xact_lock/);
assert.match(sql, /booking\.professional_ids && new\.professional_ids/);
assert.match(sql, /booking\.scheduled_start_at < new\.scheduled_end_at/);
assert.match(sql, /booking\.scheduled_end_at > new\.scheduled_start_at/);
assert.match(sql, /v_room_blocks and booking\.room_id = new\.room_id/);
assert.match(sql, /coalesce\(room\.prevent_overlapping_appointments,true\)/);
assert.match(sql, /a\.clinic_id = new\.organization_id/);
assert.match(sql, /v_other\.therapist_id = any\(new\.professional_ids\)/);
for (const field of ['professionalIds', 'professional_ids', 'teamProfessionalIds', 'team_professional_ids']) {
  assert.ok(sql.includes("'" + field + "'"), field + ' must block secondary professional collisions');
}
assert.match(sql, /GROUP_BOOKING_TEAM_UNVERIFIABLE/);

// A different GROUP cannot reuse the same patient at an overlapping time.
assert.match(sql, /a\.patient_id=new\.patient_id and a\.id <> new\.appointment_id/);
assert.match(sql, /GROUP_PARTICIPANT_PATIENT_BUSY/);
assert.match(sql, /group_participant_a_slot_guard/);
assert.match(sql, /group_booking_z_slot_guard/);
assert.ok(sql.indexOf('group_participant_a_slot_guard') < sql.indexOf('group_participant_verify_scope') ||
  sql.includes('Must precede existing participant scope verification'));
assert.match(sql, /revoke all on function public\.guard_group_booking_slot_v1\(\) from public,anon,authenticated/);
assert.match(sql, /revoke all on function public\.guard_group_participant_slot_v1\(\) from public,anon,authenticated/);
assert.doesNotMatch(sql, /grant execute on function public\.guard_group_(?:booking|participant)_slot_v1\(\) to (?:public|anon|authenticated)/i);

// The migration only creates fail-closed checks; it must not create or charge
// sessions or publish an incomplete booking API.
assert.doesNotMatch(sql, /insert into public\.(?:appointments|payments|group_session_bookings|group_session_participants)/i);
console.log('groupSessionTransactionalSlotGuards.test.mjs: ok');
