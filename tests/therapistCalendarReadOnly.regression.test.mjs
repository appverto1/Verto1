import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const calendar = readFileSync('src/components/Calendar.tsx', 'utf8');
const dashboard = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');

const openEvent = calendar.slice(calendar.indexOf('const openEventDetail ='), calendar.indexOf('const openClosureChecklist ='));
assert.match(openEvent, /if \(isTherapistActor\) \{[\s\S]*?onOpenPatient\?\.\(patientId, \{ tab: 'history' \}, normalized\.patientName\);[\s\S]*?return;/);
assert.ok(openEvent.indexOf('if (isTherapistActor)') < openEvent.indexOf('dataService.getCalendarEventDetail('), 'therapist must navigate before appointment detail requests');

assert.match(dashboard, /onCreateAppointment=\{!isDirectTherapist && hasCapability\('calendar\.appointment\.create'\)/);
assert.match(dashboard, /onEditAppointment=\{isDirectTherapist \? undefined : handleEditAppointment\}/);
assert.match(dashboard, /onConfirmAppointment=\{isDirectTherapist \? undefined : handleConfirmAppointmentFromAgenda\}/);
assert.match(dashboard, /onCancelAppointment=\{isDirectTherapist \? undefined : handleCancelAppointmentFromAgenda\}/);
assert.match(dashboard, /onDeleteAppointment=\{isDirectTherapist \? undefined : handleDeleteAppointmentFromAgenda\}/);
assert.match(dashboard, /if \(!isAddSessionModalOpen \|\| isDirectTherapist \|\|[\s\S]*?hasCapability\('calendar\.appointment\.create'\)/);
assert.match(calendar, /\{onCreateAppointment && !isTherapistActor && \(/);
assert.match(calendar, /\{!isTherapistActor && renderSection\('team'/);

const status = calendar.slice(calendar.indexOf('const statusForColor ='), calendar.indexOf('const normalizeAgendaStatus'));
assert.match(status, /canonical === 'CANCELLED_BY_CLINIC' \|\| canonical === 'CANCELLED'\s*\? 'cancelled'/);
assert.match(status, /canonical === 'CANCEL_REQUESTED'\s*\? 'cancel_requested'/);
assert.match(calendar, /CANCELLED: \{[\s\S]*?card: 'border-red-700 bg-red-700 text-white/);
console.log('therapistCalendarReadOnly.regression.test.mjs: OK');
