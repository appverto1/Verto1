import assert from 'node:assert/strict';
import { countCanonicalFamilyStars } from '../src/utils/familyDiaryStars';

const event = (awarded: boolean) => ({ awarded });
const h = (id: string, score: number) => ({ id, type: 'photo', score, note: 'Registro da família' });
const n = (id: string, score: number) => ({ id, type: 'family_note', visibility: 'family', score, text: 'Conquista' });

assert.equal(countCanonicalFamilyStars([], [], new Map()), 0);
assert.equal(countCanonicalFamilyStars([h('one', 1)], [], new Map()), 1);
assert.equal(countCanonicalFamilyStars([h('one', 0)], [], new Map([['one', event(true)]])), 0,
  'a previous award cannot override an explicit canonical revocation');
assert.equal(countCanonicalFamilyStars([], [n('two', 0)], new Map([['note-family-two', event(true)]])), 0,
  'legacy milestone receipt cannot resurrect a revoked family note');
assert.equal(countCanonicalFamilyStars([h('one', 1)], [n('two', 1)], new Map([
  ['one', event(true)], ['note-family-two', event(true)],
])), 2, 'distinct records count once each, no event double counting');
assert.equal(countCanonicalFamilyStars([h('one', 1)], [n('two', 1)], new Map([
  ['legacy', event(true)]
])), 3, 'independent legacy award remains visible if source no longer loaded');
assert.equal(countCanonicalFamilyStars([], [
  { ...n('two', 1), subject: 'milestone_event', text: 'MILESTONE_EVENT|source=x|awarded=1' }
], new Map()), 0, 'the technical receipt does not independently become a family record');
assert.equal(countCanonicalFamilyStars([], [
  { id: 'shared-family', type: 'shared', visibility: 'shared_patient', subject: 'Diário da Família', score: 0, text: 'Conquista' }
], new Map([['note-family-shared-family', event(true)]])), 0,
  'legacy shared family note overrides stale event even without a family_note type');
assert.equal(countCanonicalFamilyStars([], [{ ...n('legacy', 0), text: '[STAR] milestone' }], new Map()), 0,
  'an explicit persisted revocation must override a stale text marker');
assert.equal(countCanonicalFamilyStars([], [{ ...n('legacy', 0), score: null, text: '[STAR] milestone' }], new Map()), 1,
  'old note without a canonical score keeps its legacy marker until an explicit update');

console.log('familyDiaryStars.test.ts: ok');
