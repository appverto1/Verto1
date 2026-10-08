import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canManageAppointmentActionInClinic, resolveAuthenticatedCalendarScope } from '../services/appointmentTenantGuards';

const clinicA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const clinicB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const org = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const patientA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const patientB = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const scope = resolveAuthenticatedCalendarScope(clinicA, org);
assert.deepEqual(scope, { clinicId: clinicA, organizationId: org }, 'organization must remain independent of clinic');
assert.deepEqual(resolveAuthenticatedCalendarScope(clinicA, ''), { clinicId: clinicA, organizationId: clinicA });
assert.throws(() => resolveAuthenticatedCalendarScope('', org), /clínica autenticada/);

const allowed = {
  activeClinicId: clinicA,
  appointmentClinicId: clinicA,
  requestOrganizationId: org,
  appointmentOrganizationId: org,
  requestPatientId: patientA,
  appointmentPatientId: patientA,
};
assert.equal(canManageAppointmentActionInClinic(allowed), true, 'authorized reception must not need clinical patient chart access');
assert.equal(canManageAppointmentActionInClinic({ ...allowed, activeClinicId: clinicB }), false, 'tenant B cannot see tenant A request');
assert.equal(canManageAppointmentActionInClinic({ ...allowed, appointmentClinicId: clinicB }), false, 'request bound to wrong clinic is denied');
assert.equal(canManageAppointmentActionInClinic({ ...allowed, appointmentOrganizationId: clinicA }), false, 'organization is not interchangeable with clinic');
assert.equal(canManageAppointmentActionInClinic({ ...allowed, appointmentPatientId: patientB }), false, 'patient mismatch denied');
assert.equal(canManageAppointmentActionInClinic({ ...allowed, requestOrganizationId: '' }), false, 'unscoped request denied');
assert.equal(canManageAppointmentActionInClinic({ ...allowed, activeClinicId: clinicB, globalAccess: true }), true, 'global scope still checks persisted patient and organization');
assert.equal(canManageAppointmentActionInClinic({ ...allowed, appointmentPatientId: patientB, globalAccess: true }), false, 'global permission cannot override patient mismatch');

const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const checkConflict = server.slice(server.indexOf('  const checkScheduleConflicts = async'), server.indexOf('    const parsedDates = normalizeConflictInputDates(', server.indexOf('  const checkScheduleConflicts = async')));
assert.ok(checkConflict.includes('resolveAuthenticatedCalendarScope(currentClinicId(user)'), 'conflicts must derive scope from server session');
assert.ok(!checkConflict.includes('rawInput?.clinic_id'), 'browser clinic ID must not choose query tenant');
assert.ok(!checkConflict.includes('rawInput?.organization_id'), 'browser org ID must not choose query tenant');

const admin = server.slice(server.indexOf('  const fetchAppointmentActionRequestForAdmin = async'), server.indexOf('  const mapAuditLogToHumanHistory ='));
assert.ok(admin.includes('canManageAppointmentActionInClinic({'), 'admin request must check persistent appointment and request identifiers');
assert.ok(admin.includes("query.eq('clinic_id', activeClinicId)"), 'admin lookup must include clinic in database predicate');
assert.ok(!admin.includes('fetchPortalAppointmentForUser('), 'administrative calendar permission must not be blocked by clinical chart access');

const confirm = server.slice(server.indexOf("app.post('/api/portal/appointments/:appointmentId/confirm'"), server.indexOf("app.post('/api/portal/appointments/:appointmentId/confirm'") + 5500);
assert.ok(confirm.includes('let notificationIds: string[] = [];'), 'postcommit notification failures cannot change confirmation status');
assert.ok(confirm.includes("console.warn('[PortalAppointments] confirmation persisted;"), 'postcommit errors must remain observable');
assert.ok(!confirm.includes('return res.status((notificationUpdate as any).status'), 'notification 404 must not mask confirmed session');
console.log('PASS P0 backend appointment scope, tenant isolation and persisted confirmation contracts');
