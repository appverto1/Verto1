import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const activation = fs.readFileSync('src/components/ActivationAccess.tsx', 'utf8');

const section = (source, start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `início ausente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const helperSection = section(server, 'const PATIENT_ACTIVATION_TTL_MS', 'function getRecoveryRedirectUrl');
const passwordRoute = section(server, "app.post('/api/auth/patient-activation/password'", "app.post('/api/auth/invitation/password'");
const bootstrapRoute = section(server, "app.post('/api/auth/activation/bootstrap'", "app.post('/api/auth/password/recovery/bootstrap'");
const patientCreateSection = section(server, 'const sendPatientActivationEmail = async', "'/api/patients/:id/resend-activation'");
const patientResendRoute = section(server, "'/api/patients/:id/resend-activation'", "'/api/patients/:id/resend-recovery'");
const setPassword = section(activation, 'const handleSetPassword', 'return (');

// Links are Verto-owned signed, short-lived and nonce-bound; they no longer rely on a browser Supabase session to set the password.
assert.match(helperSection, /PATIENT_ACTIVATION_TTL_MS\s*=\s*24 \* 60 \* 60 \* 1000/);
assert.match(helperSection, /createHmac\('sha256', patientActivationSigningSecret\(\)\)/);
assert.match(helperSection, /crypto\.timingSafeEqual/);
assert.match(helperSection, /patient_activation_nonce/);
assert.match(helperSection, /patient_activation_token/);
assert.match(helperSection, /patient_activation_required:\s*true/);

// Public password activation validates token + nonce, writes the Auth password server-side and makes future normal credential login possible.
assert.match(server, /"\/auth\/patient-activation\/password"/);
assert.match(passwordRoute, /verifyPatientActivationToken\(token\)/);
assert.match(passwordRoute, /supabase\.auth\.admin\.getUserById\(claims\.userId\)/);
assert.match(passwordRoute, /patientActivationIsPending\(authUser, profile\)/);
assert.match(passwordRoute, /metadata\?\.patient_activation_nonce/);
assert.match(passwordRoute, /invalidateAllActiveSessions\(claims\.userId\)/);
assert.match(passwordRoute, /supabase\.auth\.admin\.updateUserById\(claims\.userId/);
assert.match(passwordRoute, /password,/);
assert.match(passwordRoute, /email_confirm:\s*true/);
assert.match(passwordRoute, /patient_activation_required:\s*false/);
assert.match(passwordRoute, /first_login_completed:\s*true/);
assert.match(passwordRoute, /tableName:\s*'users'/);
assert.match(passwordRoute, /status:\s*'active'/);

// Confirmed-but-still-pending patients must still receive a usable activation link.
assert.match(bootstrapRoute, /pendingPatientActivation\s*=\s*patientActivationIsPending\(authUser, profile\)/);
assert.match(bootstrapRoute, /isAlreadyConfirmed && !pendingPatientActivation/);
assert.match(bootstrapRoute, /pendingPatientActivation[\s\S]*?createPatientActivationLink\(authUser\)/);

// New patient creation and manual resend use the same canonical secure activation link.
assert.match(patientCreateSection, /sendPatientActivationEmail = async \(authUserId\?/);
assert.match(patientCreateSection, /createPatientActivationLink\(activationAuthUser\)/);
assert.doesNotMatch(patientCreateSection, /const signupLink = await generateSupabaseActionLink/);
assert.match(patientResendRoute, /pendingActivation\s*=\s*patientActivationIsPending\(authUser, profileResult\.data\)/);
assert.match(patientResendRoute, /createPatientActivationLink\(refreshedAuthUserResult\?\.user \|\| authUser\)/);

// Client consumes the signed token and does not depend on supabase.auth.updateUser for this path.
assert.match(activation, /patientActivationToken/);
assert.match(activation, /patient_activation_token/);
assert.match(setPassword, /fetch\('\/api\/auth\/patient-activation\/password'/);
assert.match(setPassword, /token:\s*patientActivationToken/);
assert.match(setPassword, /newPassword/);
assert.match(setPassword, /passwordSetupCompleted:\s*true/);
assert.match(setPassword, /setPatientActivationToken\(''\)/);
assert.doesNotMatch(setPassword, /supabase\.auth\.getSession\(\)/, 'activation password flow must not wait on an unbounded session read');

console.log('patientActivationPasswordPersistence.regression.test.mjs: ok');
