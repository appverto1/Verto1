import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPatientWhatsAppUrl } from '../src/utils/patientWhatsapp';

test('patient WhatsApp links preserve the DDD after saving, with or without country code', () => {
  const expected = 'https://wa.me/5511987654321';
  for (const phone of [
    '(11) 98765-4321',
    '11 98765-4321',
    '+55 (11) 98765-4321',
    '5511987654321',
    '011 98765-4321',
  ]) {
    assert.equal(getPatientWhatsAppUrl(phone), expected, phone);
  }
});

test('DDD 55 is not confused with the Brazilian country code', () => {
  assert.equal(getPatientWhatsAppUrl('(55) 99999-1234'), 'https://wa.me/5555999991234');
  assert.equal(getPatientWhatsAppUrl('+55 (55) 99999-1234'), 'https://wa.me/5555999991234');
});

test('supports Brazilian landlines and explicit international numbers', () => {
  assert.equal(getPatientWhatsAppUrl('(21) 2345-6789'), 'https://wa.me/552123456789');
  assert.equal(getPatientWhatsAppUrl('+1 (415) 555-0123'), 'https://wa.me/14155550123');
});

test('does not build links for incomplete, missing or malformed numbers', () => {
  for (const phone of [null, undefined, '', '99999-1234', '(00) 99999-1234', '119876543', '+55 99999-1234', 'contato', '11999999999 ramal 2', '551198765432199']) {
    assert.equal(getPatientWhatsAppUrl(phone), null, String(phone));
  }
});
