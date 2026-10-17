import assert from 'node:assert/strict';
import {buildGroupSessionRecurrenceSlots,groupSessionWeekday} from '../src/utils/groupSessionRecurrence';
const build=(overrides:Partial<Parameters<typeof buildGroupSessionRecurrenceSlots>[0]>={})=>
  buildGroupSessionRecurrenceSlots({date:'2026-10-17',time:'21:45',recurrence:'WEEKLY',
    intervalWeeks:1,weekdays:[6],occurrences:3,...overrides});
assert.equal(groupSessionWeekday('2026-10-17'),6);
assert.equal(groupSessionWeekday('2026-02-30'),-1);
assert.deepEqual(build({recurrence:'NONE'}),[{date:'2026-10-17',time:'21:45'}]);
assert.deepEqual(build().map(x=>x.date),['2026-10-17','2026-10-24','2026-10-31']);
assert.deepEqual(build({intervalWeeks:2}).map(x=>x.date),['2026-10-17','2026-10-31','2026-11-14']);
assert.deepEqual(build({weekdays:[6,2],occurrences:5}).map(x=>x.date),
  ['2026-10-17','2026-10-20','2026-10-24','2026-10-27','2026-10-31']);
assert.deepEqual(build({date:'2026-12-31',weekdays:[4]}).map(x=>x.date),
  ['2026-12-31','2027-01-07','2027-01-14']);
for(const bad of [{weekdays:[1]},{weekdays:[6,6]},{intervalWeeks:5},{occurrences:13},
  {occurrences:1},{date:'2026-02-30'},{time:'25:00'},{recurrence:'INVALID' as 'WEEKLY'}]){
  assert.deepEqual(build(bad),[],'invalid recurrence must fail closed');
}
console.log('groupSessionRecurrence: weekly, fortnightly, multiple weekdays, year boundary and invalid patterns passed');
