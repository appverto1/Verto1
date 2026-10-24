import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const calendar = readFileSync('src/components/Calendar.tsx', 'utf8');
const statusModalStart = calendar.indexOf('{statusActionEvent && (');
const statusModalEnd = calendar.indexOf('{filterSheetOpen && (', statusModalStart);
assert.ok(statusModalStart > 0 && statusModalEnd > statusModalStart, 'status actions modal remains available');
const statusModal = calendar.slice(statusModalStart, statusModalEnd);
for (const action of ['confirm', 'reschedule', 'cancel', 'delete']) {
  assert.ok(statusModal.includes(`handleStatusAction(statusActionEvent, '${action}')`), `status modal retains ${action}`);
}
assert.match(calendar, /const handleStatusAction = \(event: any, action: 'confirm' \| 'reschedule' \| 'cancel' \| 'delete'\)/);
assert.match(calendar, /if \(action === 'reschedule'\) openAppointmentEditor\(normalized\)/);
assert.match(calendar, /if \(action === 'cancel'\) onCancelAppointment\?\.\(normalized\)/);

const detailStart = calendar.indexOf('Ações de status', statusModalEnd);
const detailEnd = calendar.indexOf('{!isReceptionistActor && detailEvent.has_session_record', detailStart);
assert.ok(detailStart > statusModalEnd && detailEnd > detailStart, 'appointment detail action grid remains available');
const detailActions = calendar.slice(detailStart, detailEnd);
assert.doesNotMatch(detailActions, /onClick=\{\(\) => openAppointmentEditor\(detailEvent\)\}/, 'no duplicate direct reschedule');
assert.doesNotMatch(detailActions, /onClick=\{\(\) => onCancelAppointment\?\.\(detailEvent\)\}/, 'no duplicate direct cancellation');
assert.match(detailActions, /onDeleteAppointment\?\.\(detailEvent\)/, 'unrelated delete action remains');
assert.match(calendar, /setStatusActionEvent\(detailEvent\)/, 'status actions entry remains available');
console.log('p2SingleStatusActions.regression.test.mjs: ok — P2-29 no duplicated reschedule/cancel; handlers preserved');
