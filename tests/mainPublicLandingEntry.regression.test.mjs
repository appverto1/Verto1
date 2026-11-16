import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const landing = readFileSync('src/components/LandingPage.tsx', 'utf8');

const section = (start, end) => {
  const begin = landing.indexOf(start);
  assert.notEqual(begin, -1, 'Missing section: ' + start);
  const finish = landing.indexOf(end, begin + start.length);
  assert.notEqual(finish, -1, 'Missing section end: ' + end);
  return landing.slice(begin, finish);
};

test('professional and patient entry buttons open a choice, not an immediate login', () => {
  assert.match(landing, /const \[entryAudience, setEntryAudience\] = useState/);
  assert.match(landing, /onClick=\{\(\) => openAudienceEntry\('professional'\)\}/);
  assert.match(landing, /onClick=\{\(\) => openAudienceEntry\('patient'\)\}/);
  const entry = section('const openAudienceEntry =', 'const openAudienceRegistration =');
  assert.match(entry, /setEntryAudience\(audience\)/);
  assert.match(entry, /setShowLogin\(false\)/);
  assert.match(entry, /setShowRegister\(false\)/);
  assert.doesNotMatch(entry, /setShowLogin\(true\)/);
  const signupChoice = section('{/* Signup-first choice on public landing entry', '{/* Login Modal */}');
  assert.match(signupChoice, /entryAudience && \(/);
  assert.match(signupChoice, /role="dialog"/);
  assert.match(signupChoice, /aria-modal="true"/);
  assert.match(signupChoice, /Tenho interesse em conhecer/);
  assert.match(signupChoice, /Já é cliente\?/);
  assert.match(signupChoice, /Fazer login/);
  assert.match(signupChoice, /onClick=\{openAudienceRegistration\}/);
  assert.match(signupChoice, /onClick=\{openAudienceLogin\}/);
});

test('professional registration keeps the existing sales interest workflow, while login is explicit', () => {
  const registration = section('const openAudienceRegistration =', 'const openAudienceLogin =');
  assert.match(registration, /if \(entryAudience === 'professional'\) \{\s*openSalesInterest\(\)/);
  assert.match(landing, /<SalesInterestForm/);
  assert.match(landing, /const openSalesInterest = \(\) => \{/);
  assert.match(landing, /setEntryAudience\(null\)/);
  const login = section('const openAudienceLogin =', 'const audienceCards =');
  assert.match(login, /setLoginType\(entryAudience === 'patient' \? 'patient' : 'professional'\)/);
  assert.match(login, /setLoginStep\('email'\)/);
  assert.match(login, /setShowLogin\(true\)/);
  assert.doesNotMatch(login, /createUser|createClinic|stripe|checkout/);
});

test('patient entry still uses the existing patient registration and login, never a privileged client role', () => {
  const registration = section('const openAudienceRegistration =', 'const openAudienceLogin =');
  assert.match(registration, /setRegisterType\('patient'\)/);
  assert.match(registration, /setShowRegister\(true\)/);
  assert.doesNotMatch(registration, /setRegisterType\('professional'\)|setRegisterType\('director'\)/);
  assert.match(landing, /fetch\('\/api\/auth\/signup'/);
});

test('care-network sharing remains invitation-only and routes to the existing portal', () => {
  const registration = section('const openAudienceRegistration =', 'const openAudienceLogin =');
  assert.match(registration, /if \(entryAudience === 'care-network'\) \{/);
  assert.match(registration, /setCareNetworkGuidance\(true\)/);
  const login = section('const openAudienceLogin =', 'const audienceCards =');
  assert.match(login, /window\.location\.assign\('\/rede-de-cuidado'\)/);
  assert.match(landing, /onClick=\{\(\) => openAudienceEntry\('care-network'\)\}/);
  assert.doesNotMatch(landing, /href="\/parcerias"/);
});

test('the Google account selector and existing credential checks remain present', () => {
  assert.match(landing, /queryParams:\s*\{\s*prompt:\s*'select_account'\s*\}/);
  assert.match(landing, /const handleLogin = async \(e: React\.FormEvent\) => \{/);
  assert.match(landing, /const handleGoogleLogin = async \(\) => \{/);
  assert.match(landing, /const handle2FALogin = async/);
});
