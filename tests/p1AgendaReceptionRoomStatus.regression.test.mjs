import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const coordinator = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const calendar = readFileSync('src/components/Calendar.tsx', 'utf8');
const server = readFileSync('server.ts', 'utf8');

// P1-23: both default and weekly selectors must derive only from linked team
// member specialties; ABA and nonclinical agenda events are not specialties.
assert.doesNotMatch(coordinator, /SESSION_SPECIALTY_OPTIONS/);
assert.match(coordinator, /const clinicSessionSpecialtyOptions = useMemo/);
assert.match(coordinator, /Object\.values\(therapistMembersById/);
assert.match(coordinator, /activeClinicAppointmentSpecialty\(member\)/);
assert.match(coordinator, /clinicSpecialty: activeSpecialtiesById\.get/);
assert.equal((coordinator.match(/\.map\(\(specialty\) => \(/g)||[]).length >= 2, true,
  'new appointment and weekly recurrence must use the same clinic-scoped list');
assert.match(coordinator, /histórico; não disponível na equipe atual/);

// P1-25: modal-open refresh is not conditional on visiting room setup.
assert.match(coordinator, /if \(!isAddSessionModalOpen \|\| !workspaceScopeKey\) return/);
assert.match(coordinator, /void dataService\.getClinicRooms\(\)\.then/);
assert.match(coordinator, /roomCanonicalRequestSeqRef\.current !== requestSeq/);
assert.match(coordinator, /setRooms\(result\.data\)/);
assert.match(coordinator, /sessionRoomsError && <p role="alert"/);

// P1-24: administrative status actions remain; clinical content and
// direct medical-record navigation are inaccessible in reception's session card.
assert.match(calendar, /const isReceptionistActor = \['receptionist', 'reception'\]/);
assert.match(calendar, /!isReceptionistActor && detailPrimaryAction\.kind !== 'none'/);
assert.match(calendar, /!isReceptionistActor && \(<>[\s\S]*?Ver prontuário[\s\S]*?Ver gráficos[\s\S]*?<\/>\)\}/);
assert.match(calendar, /Ações de status/);
assert.match(calendar, /!isReceptionistActor && \(detailEvent\.closure_readiness_status \|\| detailCancellationState\.isCancelled\)/);
assert.match(calendar, /!isReceptionistActor && \(\s*<div className=\{`mt-5 rounded-3xl/);
for (const value of ['planItems.length', 'maintenanceProbes.length', 'recommendations.length']) {
  assert.ok(calendar.includes('!isReceptionistActor && '+value), 'reception cannot access '+value);
}

// P1-26: a pending confirmation is not a cancelled session even if a stale
// closure cache still reports the previous cancelled phase.
assert.match(calendar, /pendingConfirmation = canonicalAppointmentStatus/);
assert.match(calendar, /pendingConfirmation\s*\? 'scheduled_pre_session'/);
assert.match(calendar, /cancelled \|\| pendingConfirmation \? \{\} : detail\?\.phaseSummary/);

// P1-27: only a sent, schedule-matching 24h reminder permits automatic
// cancellation; other requests still follow the clinic's pending queue.
const start = server.indexOf("app.post('/api/portal/appointments/:appointmentId/request-cancel'");
assert.ok(start > 0, 'keep authoritative portal cancellation route');
const end = server.indexOf('\n  app.', start + 5);
const cancelRoute = server.slice(start, end > start ? end : undefined);
assert.match(cancelRoute, /fetchPortalAppointmentForUser/);
assert.match(cancelRoute, /createOrUpdateAppointmentActionRequest/);
assert.match(cancelRoute, /patient_confirmation_status: 'CANCEL_REQUESTED'/);
assert.match(cancelRoute, /cancel_appointment_from_24h_reminder_v1/);
assert.match(cancelRoute, /automaticCancellation\\?\\.autoCancelled === true/);
console.log('p1AgendaReceptionRoomStatus.regression.test.mjs: ok — P1-27 24h scoped atomic cancellation and fallback');
