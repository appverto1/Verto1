import assert from 'node:assert/strict';

import {
  buildTissPreGuideTestMonthRange,
  currentTissPreGuideTestMonth,
  formatTissPreGuideTestMonthLabel,
  normalizeTissPreGuideTestMonth,
} from '../src/utils/tissPreGuideTestPeriod';

assert.equal(normalizeTissPreGuideTestMonth('2026-07'), '2026-07');
assert.equal(normalizeTissPreGuideTestMonth('2026-13'), '');
assert.equal(normalizeTissPreGuideTestMonth('07/2026'), '');

assert.deepEqual(buildTissPreGuideTestMonthRange('2026-07'), {
  month: '2026-07',
  from: '2026-07-01T03:00:00.000Z',
  to: '2026-08-01T02:59:59.999Z',
});
assert.deepEqual(buildTissPreGuideTestMonthRange('2026-02'), {
  month: '2026-02',
  from: '2026-02-01T03:00:00.000Z',
  to: '2026-03-01T02:59:59.999Z',
});
assert.deepEqual(buildTissPreGuideTestMonthRange('invalid'), { month: '', from: '', to: '' });

assert.equal(currentTissPreGuideTestMonth(new Date('2026-08-01T01:30:00.000Z')), '2026-07');
assert.equal(formatTissPreGuideTestMonthLabel('2026-07'), 'julho de 2026');
assert.equal(formatTissPreGuideTestMonthLabel('invalid'), 'período selecionado');

console.log('tissPreGuideSetupPeriod.test.ts: ok');
