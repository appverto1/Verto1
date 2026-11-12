import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const landing = readFileSync(new URL('../src/components/LandingPage.tsx', import.meta.url), 'utf8');
const partnership = readFileSync(new URL('../src/components/ExternalPartnershipPortal.tsx', import.meta.url), 'utf8');

test('landing role buttons open signup-first choice rather than clinical login directly', () => {
  assert.match(landing, /onClick=\{\(\) => openAudienceEntry\('professional'\)\}/);
  assert.match(landing, /onClick=\{\(\) => openAudienceEntry\('patient'\)\}/);
  assert.match(landing, /onClick=\{\(\) => openAudienceEntry\('care-network'\)\}/);
  assert.match(landing, /entryAudience && \(/);
  assert.match(landing, /Tenho interesse em conhecer/);
  assert.match(landing, /Quero me cadastrar/);
  assert.match(landing, /Já é cliente\?/);
  assert.match(landing, /Fazer login/);
});

test('professional interest retains commercial lead persistence and patient signup retains existing route', () => {
  assert.match(landing, /if \(entryAudience === 'professional'\) \{\s*openSalesInterest\(\)/);
  assert.match(landing, /<SalesInterestForm/);
  assert.match(landing, /onClick=\{\(\) => openAudienceEntry\('professional'\)\}/);
  assert.match(landing, /setRegisterType\('patient'\)/);
  assert.match(landing, /fetch\('\/api\/auth\/signup'/);
  assert.match(landing, /handleLoginSuccess|onLogin\(/);
});

test('care network remains invitation-only and commercial partners have separate mobile entry', () => {
  assert.match(landing, /if \(entryAudience === 'care-network'\) \{\s*\/\/ Clinical sharing is invitation-only/);
  assert.match(landing, /window\.location\.assign\('\/rede-de-cuidado'\)/);
  assert.match(landing, /href="\/parcerias"/);
  assert.match(landing, /Parcerias comerciais/);
});

test('commercial partner shows signup first, password/Google login and approval-only activation', () => {
  assert.match(partnership, /entryChoice, setEntryChoice/);
  assert.match(partnership, /entryChoice === null && !applicationResult/);
  assert.match(partnership, /setEntryChoice\('signup'\)/);
  assert.match(partnership, /setEntryChoice\('login'\)/);
  assert.match(partnership, /Já é parceiro\?/);
  assert.match(partnership, /Fazer login/);
  assert.match(partnership, /if \(setupReturn\) \{/);
  assert.match(partnership, /await exchangeSession\(session\.access_token\)/);
  assert.match(partnership, /fetch\('\/api\/partnerships\/apply'/);
  assert.match(partnership, /signInWithPassword/);
  assert.match(partnership, /signInWithOAuth/);
  assert.match(partnership, /updateUser\(\{ password \}\)/);
  assert.doesNotMatch(partnership, /signInWithOtp|verifyOtp/);
});
