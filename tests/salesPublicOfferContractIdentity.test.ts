import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  normalizeContractEmail,
  isValidContractEmail,
  resolveFrozenPublicOfferContractEmail,
} from '../src/utils/salesPublicOfferContractIdentity';

test('contract email normalization and validation preserve the unchanged original rules',()=>{
  assert.equal(normalizeContractEmail('  DIRETOR@EXAMPLE.COM  '),'diretor@example.com');
  assert.equal(normalizeContractEmail(null),'');
  assert.equal(normalizeContractEmail(0),'');
  assert.equal(isValidContractEmail('  CONTATO@EXAMPLE.COM  '),true);
  assert.equal(isValidContractEmail('invalid'),false);
  assert.equal(isValidContractEmail('  '),false);
  assert.equal(isValidContractEmail('x'.repeat(250)+'@example.com'),false);
  assert.equal(isValidContractEmail('a@b.c'),true);
});

test('link recovery selects the first frozen offer identity without mutating either snapshot',()=>{
  const prepared={contract_email:'  NEW@EXAMPLE.COM  '};
  const historical={contract_email:'  OLD@EXAMPLE.COM  '};
  const preserved=JSON.stringify({prepared,historical});
  assert.equal(resolveFrozenPublicOfferContractEmail(prepared,historical),'new@example.com');
  assert.equal(resolveFrozenPublicOfferContractEmail(null,historical),'old@example.com');
  assert.equal(resolveFrozenPublicOfferContractEmail({contract_email:''},historical),'old@example.com');
  assert.equal(resolveFrozenPublicOfferContractEmail(undefined,undefined),'');
  assert.equal(JSON.stringify({prepared,historical}),preserved);
});

test('invalid authoritative frozen email never silently falls back to another identity',()=>{
  const first={contract_email:'invalid-email'};
  const old={contract_email:'old@example.com'};
  const result=resolveFrozenPublicOfferContractEmail(first,old);
  assert.equal(result,'invalid-email');
  assert.equal(isValidContractEmail(result),false);
});
