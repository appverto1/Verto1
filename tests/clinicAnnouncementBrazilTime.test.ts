import assert from 'node:assert/strict';
import {
  formatBrazilScheduleInput, parseBrazilScheduleInput,
  isBrazilQuietHour, formatBrazilHistoryTimestamp
} from '../src/utils/clinicAnnouncementBrazilTime';

const scheduled = new Date('2026-10-18T09:00:00.000Z');
assert.equal(formatBrazilScheduleInput(scheduled), '2026-10-18T06:00');
assert.equal(parseBrazilScheduleInput('2026-10-18T06:00')?.toISOString(), scheduled.toISOString());
assert.equal(formatBrazilScheduleInput(new Date('2026-10-20T00:59:00Z')), '2026-10-19T21:59');
assert.equal(parseBrazilScheduleInput('2026-10-19T21:59')?.toISOString(), '2026-10-20T00:59:00.000Z');
assert.equal(isBrazilQuietHour(new Date('2026-10-18T08:59:00Z')), true); // 05:59
assert.equal(isBrazilQuietHour(scheduled), false); // 06:00
assert.equal(isBrazilQuietHour(new Date('2026-10-20T00:59:00Z')), false); // 21:59
assert.equal(isBrazilQuietHour(new Date('2026-10-20T01:00:00Z')), true); // 22:00
for (const invalid of ['2026-02-30T06:00', '2026-10-18T25:00', '2026-10-18T06:60', '2026-10-18T06:00Z', 'not-a-date']) {
  assert.equal(parseBrazilScheduleInput(invalid), null);
}
const priorTZ = process.env.TZ;
try {
  for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
    process.env.TZ = zone;
    assert.equal(formatBrazilScheduleInput(scheduled), '2026-10-18T06:00');
    assert.equal(parseBrazilScheduleInput('2026-10-18T06:00')?.toISOString(), scheduled.toISOString());
    assert.match(formatBrazilHistoryTimestamp(scheduled), /06:00/);
  }
} finally {
  if (priorTZ === undefined) delete process.env.TZ; else process.env.TZ = priorTZ;
}
console.log('clinicAnnouncementBrazilTime.test: PASS');
