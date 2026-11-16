import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const calendar = readFileSync('src/components/Calendar.tsx', 'utf8');
const dashboard = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');

const openEvent = calendar.slice(calendar.indexOf('const openEventDetail ='), calendar.indexOf('const openClosureChecklist ='));
assert.match(openEvent, /if \(isCaseScopedActor\) \{[\s\S]*?!remoteState\.loaded[\s\S]*?!serverEvents\.some/);
assert.match(openEvent, /setSelectedEvent\(normalized\);[\s\S]*?dataService\.getCalendarEventDetail\(normalized\.id\)/);
assert.doesNotMatch(openEvent, /onOpenPatient\?\.\(/, 'the professional and supervisor see session details before opening a chart');

assert.match(dashboard, /onCreateAppointment=\{!isTherapist && hasCapability\('calendar\.appointment\.create'\)/);
assert.match(dashboard, /onEditAppointment=\{isTherapist \? undefined : handleEditAppointment\}/);
assert.match(dashboard, /onConfirmAppointment=\{isTherapist \? undefined : handleConfirmAppointmentFromAgenda\}/);
assert.match(dashboard, /onCancelAppointment=\{isTherapist \? undefined : handleCancelAppointmentFromAgenda\}/);
assert.match(dashboard, /onDeleteAppointment=\{isTherapist \? undefined : handleDeleteAppointmentFromAgenda\}/);
assert.match(dashboard, /if \(!isAddSessionModalOpen \|\| isTherapist \|\|[\s\S]*?hasCapability\('calendar\.appointment\.create'\)/);
assert.match(calendar, /\{onCreateAppointment && !isCaseScopedActor && \(/);
assert.match(calendar, /\{!isCaseScopedActor && renderSection\('team'/);

const status = calendar.slice(calendar.indexOf('const statusForColor ='), calendar.indexOf('const normalizeAgendaStatus'));
assert.match(status, /canonical === 'CANCELLED_BY_CLINIC' \|\| canonical === 'CANCELLED'\s*\? 'cancelled'/);
assert.match(status, /canonical === 'CANCEL_REQUESTED'\s*\? 'cancel_requested'/);
assert.match(calendar, /CANCELLED: \{[\s\S]*?card: 'border-red-700 bg-red-700 text-white/);
console.log('therapistCalendarReadOnly.regression.test.mjs: OK');
