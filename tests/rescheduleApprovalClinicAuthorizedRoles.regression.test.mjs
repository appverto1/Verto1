import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20261019235000_reschedule_approval_clinic_authorized_roles.sql', 'utf8');
const permissions = readFileSync('src/constants/authorizationModel.ts', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const approvalStart = server.indexOf("app.post('/api/appointments/action-requests/:requestId/approve'");
const rejectStart = server.indexOf("app.post('/api/appointments/action-requests/:requestId/reject'", approvalStart);
assert.ok(approvalStart >= 0 && rejectStart > approvalStart, 'approval and rejection endpoints remain registered');
const approve = server.slice(approvalStart, rejectStart);

assert.match(approve, /requireClinicCapability\('calendar\.requests\.manage'\)/,
  'the backend must require the clinic-scoped capability before invoking privileged RPC');
assert.match(approve, /fetchAppointmentActionRequestForAdmin\(req\.params\.requestId, req\.session\.user\)/,
  'the request and appointment must still be verified against the active clinic');
assert.match(approve, /p_actor_role: actorRole/,
  'RPC receives the authenticated session role, not user input');
assert.match(approve, /p_actor_id: actorId/,
  'RPC receives the authenticated session identity');
assert.match(approve, /supabase\.rpc\('approve_appointment_reschedule_v2'/,
  'approval remains atomic');

const roles = permissions.slice(permissions.indexOf('receptionist: internal('), permissions.indexOf('biller: internal('));
assert.match(roles, /'calendar\.requests\.manage'/,
  'reception staff already have the canonical capability');
assert.match(permissions, /const COORDINATOR_DEFAULTS = internal\(/);
assert.match(permissions, /'calendar\.requests\.manage'/);

assert.match(migration, /'approve_appointment_reschedule',\s*'approve_appointment_reschedule_v2'/,
  'both the wrapper and the atomic mutation must be updated');
assert.match(migration, /'director'', ''receptionist'/,
  'the allowlist includes director and receptionist');
assert.match(migration, /v_occurrences <> 3/,
  'migration refuses to patch unexpected function definitions');
assert.match(migration, /v_functions_updated <> 2/,
  'migration refuses partial updates');
assert.match(migration, /pg_get_functiondef\(v_row\.oid\)/,
  'the installed body is preserved instead of replaced with an outdated snapshot');
assert.match(migration, /EXECUTE replace\(v_definition, v_old_roles, v_new_roles\)/);
assert.doesNotMatch(migration, /'therapist''|''biller''|''patient''/,
  'clinical/financial/portal roles must not gain this authority by default');
assert.match(approve, /acknowledgeStaleAppointmentReminderNotifications\(nextAppointment\)/);
assert.match(approve, /notifyPortalRescheduleApproval\(/);
assert.match(approve, /triggerAppointmentReminderScan\('appointment_reschedule_approved'\)/);

console.log('rescheduleApprovalClinicAuthorizedRoles: PASS');
