import fs from 'node:fs';
import assert from 'node:assert/strict';

const activation = fs.readFileSync('src/components/ActivationAccess.tsx', 'utf8');
const landing = fs.readFileSync('src/components/LandingPage.tsx', 'utf8');
const salesActivation = fs.readFileSync('src/components/SalesActivationAccess.tsx', 'utf8');

assert.ok(
  activation.includes('flex items-center justify-center gap-3'),
  'activation Google button must center icon and label as one row',
);
assert.ok(
  activation.includes('<GoogleIcon size={18} className="shrink-0" />'),
  'activation Google icon must not shrink or detach from the label',
);
assert.ok(
  activation.includes('<span>Entrar com Google</span>'),
  'activation Google label must stay grouped with the icon',
);
assert.ok(
  activation.includes('type="button"'),
  'activation Google control must remain an explicit non-submit button',
);

for (const [name, source] of [
  ['activation', activation],
  ['landing', landing],
  ['sales activation', salesActivation],
]) {
  assert.match(source, /provider:\s*'google'/, `${name} must keep Google as the OAuth provider`);
  assert.ok(
    source.includes("scopes: 'https://www.googleapis.com/auth/userinfo.email'"),
    `${name} must explicitly request the Google e-mail scope`,
  );
}

assert.match(
  activation,
  /activationEmail:\s*(existingEmail|loginEmail|userEmail)/,
  'activation flow must keep passing the invited e-mail for server-side identity matching',
);

console.log('googleOauthActivationUi.regression.test.mjs passed');
