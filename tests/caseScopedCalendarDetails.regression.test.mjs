import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const calendar = readFileSync('src/components/Calendar.tsx', 'utf8');
const dashboard = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const authorizations = readFileSync('src/constants/authorizationModel.ts', 'utf8');

const modalEntry = calendar.slice(calendar.indexOf('const openEventDetail ='), calendar.indexOf('const openClosureChecklist ='));
assert.match(calendar, /const isCaseScopedActor = isTherapistActor \|\| isSupervisorActor/);
assert.match(calendar, /const localEvents = useMemo\(\(\) => \(isCaseScopedActor \? \[\] : agenda \|\| \[\]\)/);
assert.match(calendar, /isCaseScopedActor \? \(remoteState\.loaded \? serverEvents : \[\]\) : mergeCalendarEventsForRender/);
assert.match(modalEntry, /if \(isCaseScopedActor\) \{[\s\S]*?!remoteState\.loaded[\s\S]*?!serverEvents\.some/);
assert.match(modalEntry, /setSelectedEvent\(normalized\);[\s\S]*?dataService\.getCalendarEventDetail\(normalized\.id\)/);
assert.match(modalEntry, /if \(result\?\.error === 'CALENDAR_SCOPE_DENIED' \|\| result\?\.error === 'CLINIC_SCOPE_DENIED'\)/);
assert.doesNotMatch(modalEntry, /onOpenPatient\?\.\(/, 'open details first, not the chart');

assert.match(calendar, /\{!isCaseScopedActor && \(\s*<button[^\n]*aria-label="Editar sessão"/);
assert.match(calendar, /\{!isReceptionistActor && !isCaseScopedActor && \(\s*<div[^\n]*rounded-3xl/);
assert.match(calendar, /\{!isReceptionistActor && !isCaseScopedActor && \(billingFinancialContextType/);
assert.match(calendar, /\{!isCaseScopedActor && actionRequests\.filter/);
assert.match(calendar, /\{!isCaseScopedActor && statusActionEvent && \(/);
assert.match(calendar, /\{!isCaseScopedActor && \(\s*<button[^\n]*setStatusActionEvent\(detailEvent\)/);
assert.match(calendar, /\{!isCaseScopedActor && \(\s*<button[^\n]*onDeleteAppointment\?\.\(detailEvent\)/);
assert.match(calendar, /Ver prontuário/);
assert.match(calendar, /Histórico operacional/);
assert.match(calendar, /detailCancellationState\.isCancelled/);

assert.match(dashboard, /onCreateAppointment=\{!isTherapist && hasCapability\('calendar\.appointment\.create'\)/);
for (const name of ['onEditAppointment', 'onConfirmAppointment', 'onCancelAppointment', 'onDeleteAppointment']) {
  assert.match(dashboard, new RegExp(name + '=\\{isTherapist \\? undefined : '));
}
assert.match(dashboard, /onAppointmentActionResolved=\{isTherapist \? undefined : onAppointmentActionResolved\}/);
assert.match(dashboard, /if \(!isAddSessionModalOpen \|\| isTherapist \|\|/);
assert.match(dashboard, /key=\{\x60\$\{String\(user\?\.id/);
assert.match(authorizations, /supervisor: \['SUPERVISED_CASES', 'OWN_RESOURCES'\]/);
assert.match(authorizations, /therapist: \['ASSIGNED_PATIENTS', 'OWN_RESOURCES'\]/);
console.log('caseScopedCalendarDetails.regression.test.mjs: OK');
