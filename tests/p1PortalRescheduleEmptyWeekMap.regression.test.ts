import assert from 'node:assert/strict';
import {
  buildAvailableRescheduleSlots,
  evaluateRequestedRescheduleSlot,
} from '../src/services/portalRescheduleAvailability';

// P1-11: an explicitly saved empty weekly map is a closed clinic schedule,
// not a reason to silently reopen the legacy 08:00–18:00 fallback.
const monday = '2026-11-02T10:00:00-03:00';
const now = '2026-11-01T09:00:00-03:00';
const evaluate = (workingSchedule?: any) => evaluateRequestedRescheduleSlot({
  scheduledStart: monday,
  durationMinutes: 50,
  now,
  minLeadMinutes: 0,
  workingSchedule,
});

const emptyWeek = { active: true, days: {} };
const denied = evaluate(emptyWeek);
assert.equal(denied.available, false, 'explicit empty weekly map must close all weekdays');
assert.equal(denied.reasonCode, 'OUTSIDE_WORKING_HOURS');
const suggestions = buildAvailableRescheduleSlots({
  dateFrom: '2026-11-02',
  maxDays: 2,
  now,
  minLeadMinutes: 0,
  durationMinutes: 50,
  workingSchedule: emptyWeek,
});
assert.equal(suggestions.totalSlots, 0, 'empty week must never generate suggestions');
assert.deepEqual(suggestions.days, []);

// Absence of a weekly map is legacy/unconfigured, and must remain compatible.
assert.equal(evaluate().available, true);
assert.equal(evaluate({ active: true }).available, true);
const legacySlots = buildAvailableRescheduleSlots({
  dateFrom: '2026-11-02',
  maxDays: 1,
  now,
  minLeadMinutes: 0,
  durationMinutes: 50,
  workingSchedule: { active: true },
});
assert.ok(legacySlots.totalSlots > 0, 'unconfigured legacy schedule retains fallback');

// Configured days continue to allow only the declared weekday.
const mondayOnly = { active: true, days: { monday: { enabled: true, periods: [{ start: '08:00', end: '18:00' }] } } };
assert.equal(evaluate(mondayOnly).available, true);
assert.equal(evaluate({ active: false, days: {} }).available, false);
console.log('P1-11 explicit empty week: PASS');
