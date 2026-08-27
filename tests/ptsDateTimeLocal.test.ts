import assert from 'node:assert/strict';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '../src/utils/dateTimeLocal';

const originalTz = process.env.TZ;
// Deliberately use a device timezone different from both clinics. PTS rendering
// must follow the clinic, not the browser/OS where the professional is logged in.
process.env.TZ = 'Europe/Lisbon';

try {
  assert.equal(
    toDateTimeLocalValue('2026-08-26T10:53:00.000Z', 'America/Sao_Paulo'),
    '2026-08-26T07:53',
    'PTS de clínica em São Paulo deve exibir o horário da clínica',
  );
  assert.equal(
    fromDateTimeLocalValue('2026-08-26T07:53', 'America/Sao_Paulo'),
    '2026-08-26T10:53:00.000Z',
    'horário clínico de São Paulo deve persistir em UTC',
  );

  assert.equal(
    toDateTimeLocalValue('2026-08-26T10:53:00.000Z', 'America/Campo_Grande'),
    '2026-08-26T06:53',
    'PTS de clínica em Mato Grosso do Sul deve usar America/Campo_Grande',
  );
  assert.equal(
    fromDateTimeLocalValue('2026-08-26T06:53', 'America/Campo_Grande'),
    '2026-08-26T10:53:00.000Z',
    'horário clínico de Mato Grosso do Sul deve persistir como o mesmo instante UTC',
  );

  const roundTripSource = '2026-08-26T14:21:00.000Z';
  for (const clinicTimeZone of ['America/Sao_Paulo', 'America/Campo_Grande', 'America/Cuiaba']) {
    assert.equal(
      fromDateTimeLocalValue(toDateTimeLocalValue(roundTripSource, clinicTimeZone), clinicTimeZone),
      roundTripSource,
      `salvar e reabrir não pode deslocar o horário em ${clinicTimeZone}`,
    );
  }

  assert.equal(toDateTimeLocalValue('', 'America/Campo_Grande'), '');
  assert.equal(fromDateTimeLocalValue('', 'America/Campo_Grande'), '');
  assert.equal(toDateTimeLocalValue('invalid-date', 'America/Campo_Grande'), '');
  assert.equal(fromDateTimeLocalValue('invalid-date', 'America/Campo_Grande'), '');
} finally {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
}

console.log('ptsDateTimeLocal.test.ts: ok');
