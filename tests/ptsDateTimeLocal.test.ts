import assert from 'node:assert/strict';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '../src/utils/dateTimeLocal';

const originalTz = process.env.TZ;
process.env.TZ = 'America/Sao_Paulo';

try {
  // 10:53 UTC is 07:53 in Sao Paulo. The previous implementation leaked
  // 10:53 directly into datetime-local by slicing the ISO string.
  assert.equal(
    toDateTimeLocalValue('2026-08-26T10:53:00.000Z'),
    '2026-08-26T07:53',
    'datetime-local deve exibir o horário local, não o horário UTC bruto',
  );

  assert.equal(
    fromDateTimeLocalValue('2026-08-26T07:53'),
    '2026-08-26T10:53:00.000Z',
    'horário local selecionado deve persistir como o mesmo instante em ISO/UTC',
  );

  const roundTripSource = '2026-08-26T14:21:00.000Z';
  assert.equal(
    fromDateTimeLocalValue(toDateTimeLocalValue(roundTripSource)),
    roundTripSource,
    'salvar e reabrir não pode deslocar o horário em três horas',
  );

  assert.equal(toDateTimeLocalValue(''), '');
  assert.equal(fromDateTimeLocalValue(''), '');
  assert.equal(toDateTimeLocalValue('invalid-date'), '');
  assert.equal(fromDateTimeLocalValue('invalid-date'), '');
} finally {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
}

console.log('ptsDateTimeLocal.test.ts: ok');
