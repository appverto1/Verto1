import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  buildRescheduleAssignmentId,
  parseRescheduleAssignmentId,
  parseSelectedRescheduleOptionIndex,
  rankRescheduleOptions,
} from '../src/utils/rescheduleApproval';

const professionalId = '11111111-1111-4111-8111-111111111111';
const roomId = '22222222-2222-4222-8222-222222222222';

test('selected option must belong to the persisted request', () => {
  assert.deepEqual(parseSelectedRescheduleOptionIndex(1, 3), { ok: true, index: 1 });
  assert.equal(parseSelectedRescheduleOptionIndex(undefined, 3).ok, false);
  assert.equal(parseSelectedRescheduleOptionIndex(3, 3).ok, false);
  assert.equal(parseSelectedRescheduleOptionIndex('-1', 3).ok, false);
});

test('assignment token binds option, professional and room without trusting labels', () => {
  const assignmentId = buildRescheduleAssignmentId(2, professionalId, roomId);
  assert.equal(assignmentId, `2:${professionalId}:${roomId}`);
  assert.deepEqual(parseRescheduleAssignmentId(assignmentId, 2), {
    ok: true,
    assignment: { optionIndex: 2, professionalId, roomId },
  });
  assert.equal(parseRescheduleAssignmentId(assignmentId, 1).ok, false);
  assert.equal(parseRescheduleAssignmentId(`2:not-a-user:${roomId}`, 2).ok, false);
});

test('ranking promotes only a fully compatible option to best', () => {
  const ranked = rankRescheduleOptions([
    {
      index: 0,
      availableAssignmentCount: 1,
      directAssignmentAvailable: true,
      keepsOriginalProfessional: true,
      keepsOriginalRoom: true,
      financialContextCompatible: true,
      financialReviewRequired: false,
      distanceMinutes: 60,
    },
    {
      index: 1,
      availableAssignmentCount: 2,
      directAssignmentAvailable: false,
      keepsOriginalProfessional: true,
      keepsOriginalRoom: false,
      financialContextCompatible: true,
      financialReviewRequired: false,
      competingRequestCount: 1,
    },
    {
      index: 2,
      availableAssignmentCount: 0,
      directAssignmentAvailable: false,
      keepsOriginalProfessional: false,
      keepsOriginalRoom: false,
      financialContextCompatible: false,
      financialReviewRequired: true,
    },
  ]);
  assert.equal(ranked[0].recommendation, 'best');
  assert.equal(ranked[1].recommendation, 'attention');
  assert.match(ranked[1].reasons.join(' '), /sala original/i);
  assert.match(ranked[1].reasons.join(' '), /solicitação/i);
  assert.equal(ranked[2].recommendation, 'unavailable');
});

test('approval flow batches conflicts and resolves competing requests atomically', () => {
  const root = process.cwd();
  const server = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
  const calendar = fs.readFileSync(path.join(root, 'src/components/Calendar.tsx'), 'utf8');
  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260721123000_reschedule_approval_schema_alignment.sql'),
    'utf8',
  );
  const preview = server.slice(
    server.indexOf('const buildRescheduleApprovalPreview'),
    server.indexOf('const buildPortalRescheduleDateWindow'),
  );
  assert.match(preview, /Promise\.all\(\[[\s\S]*?fetchConflictAppointmentsFromTable[\s\S]*?fetchAppointmentBillingContextRow[\s\S]*?appointment_action_requests/);
  assert.match(preview, /\.in\('id', competingAppointmentIds\)/);
  assert.match(preview, /parseRescheduleRequestPayload\(row\?\.note, row\?\.metadata\)/);
  assert.match(preview, /normalizeRescheduleOptions\(\[\{/);
  assert.doesNotMatch(preview, /for \(const option[\s\S]*?await supabase/);
  assert.match(migration, /ACTION_REQUEST_SUPERSEDED/);
  assert.match(migration, /r\.id <> p_request_id[\s\S]*?r\.request_type in \('CANCEL', 'RESCHEDULE'\)/);
  assert.match(migration, /action_requests/);
  assert.match(migration, /audit_entries/);
  assert.match(server, /recoveringApprovedReschedule/);
  assert.match(server, /approve_appointment_reschedule_v2/);
  assert.match(server, /RESCHEDULE_APPROVAL_SCHEMA_INCOMPATIBLE/);
  assert.match(server, /appointmentScheduleMatches\(confirmedAppointment/);
  assert.doesNotMatch(migration, /set status = case when lower\(coalesce\(status/);
  assert.match(calendar, /Solicitação mais recente/);
  assert.match(calendar, /Cancelar sessão/);
  assert.match(calendar, /Recusar cancelamento/);
  assert.match(calendar, /result\.actionRequests/);
  assert.match(calendar, /result\.statusHistory/);
});
