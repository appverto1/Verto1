import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync('supabase/migrations/20261020210000_reschedule_approval_delegated_calendar_capability.sql', 'utf8');
const authorization = readFileSync('src/constants/authorizationModel.ts', 'utf8');
const canonicalRoleTest = readFileSync('tests/rescheduleApprovalClinicAuthorizedRoles.regression.test.mjs', 'utf8');
const reminderLifecycle = readFileSync('tests/portalRescheduleRequestLifecycle.regression.test.ts', 'utf8');

// Keep the same authority as the clinic-scoped HTTP capability guard:
// director, coordinator and reception by default, with explicit staff grants.
const defaults = authorization.slice(authorization.indexOf('export const ROLE_DEFAULT_CAPABILITIES:'));
assert.match(authorization, /'calendar\.requests\.manage'/);
assert.match(defaults, /director: \[\.\.\.COORDINATOR_DEFAULTS/);
assert.match(defaults, /coordinator: COORDINATOR_DEFAULTS/);
const receptionist = defaults.slice(defaults.indexOf('receptionist: internal('), defaults.indexOf('biller: internal('));
assert.match(receptionist, /'calendar\.requests\.manage'/);
assert.match(canonicalRoleTest, /requireClinicCapability/);

// Both DB approval implementations share an independent, clinic-scoped
// permission guard, not just a hard-coded role allowlist.
assert.match(schema, /create or replace function public\.verto_can_approve_reschedule_for_clinic_v1/);
assert.match(schema, /cm\.user_id::text = p_actor_id/);
assert.match(schema, /cm\.clinic_id = p_clinic_id/);
assert.match(schema, /lower\(coalesce\(cm\.status, 'active'\)\) = 'active'/);
assert.match(schema, /o\.permission_key = 'calendar\.requests\.manage'/);
assert.match(schema, /o\.effect = 'allow'/);
assert.match(schema, /o\.effect is distinct from 'deny'/);
assert.match(schema, /left join public\.clinic_membership_permission_overrides/);
assert.match(schema, /not exists \([\s\S]*?from public\.clinic_memberships cm[\s\S]*?cm\.clinic_id = p_clinic_id/);
assert.match(schema, /v_updated <> 2/);
assert.match(schema, /RESCHEDULE_CAPABILITY_GUARD_CHANGED/);
assert.match(schema, /revoke all on function public\.verto_can_approve_reschedule_for_clinic_v1/);
assert.match(schema, /from public, anon, authenticated/);
assert.match(schema, /grant execute on function public\.verto_can_approve_reschedule_for_clinic_v1[\s\S]*to service_role/);

// Route still evaluates the session (not request payload); SQL mutation,
// notification generation and post-approval recovery remain unmodified.
assert.match(canonicalRoleTest, /p_actor_role: actorRole/);
assert.match(canonicalRoleTest, /p_actor_id: actorId/);
assert.match(reminderLifecycle, /notification_24h_sent_at/);
assert.match(reminderLifecycle, /notification_12h_sent_at/);
assert.match(reminderLifecycle, /acknowledgeStaleAppointmentReminderNotifications/);
assert.match(reminderLifecycle, /APPOINTMENT_REMINDER_24H/);
assert.match(reminderLifecycle, /APPOINTMENT_REMINDER_12H/);
console.log('rescheduleApprovalDelegatedAgendaCapability: PASS');
