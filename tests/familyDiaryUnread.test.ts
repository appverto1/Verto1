import assert from 'node:assert/strict';
import {
  familyDiaryReadMarkerKey, familyDiaryEntryTime, familyDiaryNewCount,
  markFamilyDiarySeen, readFamilyDiarySeenAt,
} from '../src/utils/familyDiaryUnread';

const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secondUser = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const clinic = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const secondClinic = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const patient = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const secondPatient = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const key = familyDiaryReadMarkerKey({ userId: user, clinicId: clinic, patientId: patient });
assert.ok(key);
assert.notEqual(key, familyDiaryReadMarkerKey({ userId: secondUser, clinicId: clinic, patientId: patient }));
assert.notEqual(key, familyDiaryReadMarkerKey({ userId: user, clinicId: secondClinic, patientId: patient }));
assert.notEqual(key, familyDiaryReadMarkerKey({ userId: user, clinicId: clinic, patientId: secondPatient }));
for (const value of [null, undefined, '', 'not-an-id']) {
  assert.equal(familyDiaryReadMarkerKey({ userId: value, clinicId: clinic, patientId: patient }), '');
}

const memory = new Map<string, string>();
const storage = {
  getItem: (k: string) => memory.get(k) || null,
  setItem: (k: string, v: string) => { memory.set(k, v); },
};
const entries = [
  { id: 'photo-1', type: 'photo', created_at: '2026-10-21T10:00:00.000Z' },
  { id: 'diary-1', type: 'family_note', created_at: '2026-10-21T10:01:00.000Z' },
  { id: 'clinical-1', type: 'session', created_at: '2026-10-21T10:03:00.000Z' },
  { id: 'broken-date', type: 'photo', created_at: 'not-a-date' },
];
assert.equal(familyDiaryNewCount(entries, 0), 2);
assert.equal(familyDiaryEntryTime(entries[2]), 0, 'clinical work never raises family unread status');
assert.equal(familyDiaryEntryTime(entries[3]), 0);
assert.equal(markFamilyDiarySeen(key, entries, storage), true);
assert.equal(familyDiaryNewCount(entries, readFamilyDiarySeenAt(key, storage)), 0, 'F5/login keep read watermark');
assert.equal(readFamilyDiarySeenAt(familyDiaryReadMarkerKey({ userId: secondUser, clinicId: clinic, patientId: patient }), storage), 0);
const newEntries = [...entries, { id: 'photo-2', type: 'photo', created_at: '2026-10-21T10:02:00.000Z' }];
assert.equal(familyDiaryNewCount(newEntries, readFamilyDiarySeenAt(key, storage)), 1);
assert.equal(markFamilyDiarySeen(key, newEntries, storage), true);
assert.equal(familyDiaryNewCount(newEntries, readFamilyDiarySeenAt(key, storage)), 0);
assert.equal(markFamilyDiarySeen(key, entries, storage), true);
assert.equal(familyDiaryNewCount(newEntries, readFamilyDiarySeenAt(key, storage)), 0, 'older page never resets read state');

const brokenStorage = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } };
assert.equal(readFamilyDiarySeenAt(key, brokenStorage), 0);
assert.equal(markFamilyDiarySeen(key, newEntries, brokenStorage), false);
assert.equal(markFamilyDiarySeen('', newEntries, storage), false);

console.log('familyDiaryUnread.test.ts: ok');
