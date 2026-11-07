import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shiftRecurringAppointmentDatePreservingCadence as shift } from '../src/utils/scheduling';

const app = readFileSync('src/App.tsx', 'utf8');
assert.match(app, /return shiftRecurringAppointmentDatePreservingCadence\(\s*currentAppointment\.date,\s*appointment\?\.date,\s*nextDate,\s*\);/,
  'future-series edit must use the existing calendar gaps, not recurrence index * 7');
assert.doesNotMatch(app, /appointmentIndex - currentRecurrenceIndex\) \* 7/,
  'do not reintroduce forced weekly spacing in recurring edits');

// The unchanged selected occurrence is moved to the user-chosen date.
assert.equal(shift('2026-01-15', '2026-01-15', '2026-01-20'), '2026-01-20');
// Ordinary weekly and biweekly appointments preserve their original intervals.
assert.equal(shift('2026-01-15', '2026-01-22', '2026-01-20'), '2026-01-27');
assert.equal(shift('2026-01-15', '2026-01-29', '2026-01-20'), '2026-02-03');
// Monthly recurrence is not silently converted to seven-day spacing.
assert.equal(shift('2026-01-15', '2026-02-15', '2026-01-20'), '2026-02-20');
// Weekly agendas may have multiple sessions within the same week.
assert.equal(shift('2026-01-05', '2026-01-07', '2026-01-12'), '2026-01-14');
assert.equal(shift('2026-01-05', '2026-01-12', '2026-01-12'), '2026-01-19');
// Date-only arithmetic must not lose or add a day around DST transitions.
assert.equal(shift('2026-03-07', '2026-03-14', '2026-03-09'), '2026-03-16');
// Missing or invalid stored dates retain the selected date (fail closed for UI).
assert.equal(shift('invalid', '2026-01-22', '2026-01-20'), '2026-01-20');
assert.equal(shift('2026-01-15', '2026-02-30', '2026-01-20'), '2026-01-20');
console.log('critical22RecurringAppointmentCadence.test.ts: ok — weekly, biweekly, monthly, weekly agenda, DST, invalid date');
