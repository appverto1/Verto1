import assert from 'node:assert/strict';
import {
  DEFAULT_CLINIC_TIME_ZONE,
  inferBrazilClinicTimeZoneFromState,
  isValidIanaTimeZone,
  resolveClinicTimeZone,
} from '../src/utils/clinicTimeZone';

assert.equal(inferBrazilClinicTimeZoneFromState('MS'), 'America/Campo_Grande');
assert.equal(inferBrazilClinicTimeZoneFromState('MT'), 'America/Cuiaba');
assert.equal(inferBrazilClinicTimeZoneFromState('AC'), 'America/Rio_Branco');
assert.equal(inferBrazilClinicTimeZoneFromState('SP'), 'America/Sao_Paulo');
assert.equal(inferBrazilClinicTimeZoneFromState(''), DEFAULT_CLINIC_TIME_ZONE);

assert.equal(isValidIanaTimeZone('America/Campo_Grande'), true);
assert.equal(isValidIanaTimeZone('UTC-4'), false);
assert.equal(resolveClinicTimeZone({ timeZone: 'America/Campo_Grande', state: 'SP' }), 'America/Campo_Grande');
assert.equal(resolveClinicTimeZone({ timeZone: 'invalid', state: 'MS' }), 'America/Campo_Grande');

console.log('clinicTimeZone.test.ts: ok');
