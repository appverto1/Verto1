import assert from 'node:assert/strict';
import {
  buildAvailableRescheduleSlots,
  evaluateRequestedRescheduleSlot,
} from '../src/services/portalRescheduleAvailability';

// P1-11: an explicit clinic-scoped professional schedule is an allowlist.
// An omitted weekday must not become available through the 08:00–18:00 fallback.
const monday = '2026-11-02T10:00:00-03:00';
const tuesday = '2026-11-03T10:00:00-03:00';
const now = '2026-11-01T09:00:00-03:00';
const configuredMondayOnly = {
  active: true,
  days: {
    monday: {
      enabled: true,
      periods: [{ start: '08:00', end: '18:00' }],
    },
  },
};

const evaluate = (scheduledStart: string, workingSchedule?: any) =>
  evaluateRequestedRescheduleSlot({
    scheduledStart,
    durationMinutes: 50,
    now,
    minLeadMinutes: 0,
    workingSchedule,
  });

assert.equal(evaluate(monday, configuredMondayOnly).available, true, 'configured Monday remains available');
const omittedTuesday = evaluate(tuesday, configuredMondayOnly);
assert.equal(omittedTuesday.available, false, 'omitted Tuesday must be closed');
assert.equal(omittedTuesday.reasonCode, 'OUTSIDE_WORKING_HOURS');

const slots = buildAvailableRescheduleSlots({
  dateFrom: '2026-11-02',
  maxDays: 2,
  now,
  minLeadMinutes: 0,
  durationMinutes: 50,
  workingSchedule: configuredMondayOnly,
});
assert.deepEqual(slots.days.map((day) => day.date), ['2026-11-02'],
  'slot suggestions must never offer omitted weekdays');
assert.ok(slots.totalSlots > 0, 'configured Monday must retain valid slots');

const explicitTuesdayClosed = {
  ...configuredMondayOnly,
  days: {
    ...configuredMondayOnly.days,
    tuesday: { enabled: false, periods: [{ start: '08:00', end: '18:00' }] },
  },
};
assert.equal(evaluate(tuesday, explicitTuesdayClosed).available, false,
  'explicitly disabled days remain blocked');

const abbreviatedMonday = {
  active: true,
  days: { mon: { enabled: true, periods: [{ start: '08:00', end: '18:00' }] } },
};
assert.equal(evaluate(monday, abbreviatedMonday).available, true,
  'supported weekday aliases still resolve correctly');
assert.equal(evaluate(tuesday, abbreviatedMonday).available, false,
  'weekday aliases must not reopen absent days');

// Preserve legacy behavior only when there is no configured weekly schedule.
assert.equal(evaluate(tuesday).available, true,
  'the preexisting fallback for an entirely unconfigured schedule is unchanged');

console.log('P1-11 portal weekday allowlist: PASS');
