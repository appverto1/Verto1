import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');

const section = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `início ausente: ${start}`);
  assert.notEqual(endIndex, -1, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const acceptanceError = section(
  server,
  'function clinicInvitationAcceptanceError',
  'async function acceptClinicInvitationAtomically',
);
const acceptRoute = section(
  server,
  "app.post('/api/clinic/accept-invite'",
  "app.post('/api/clinic/assign-role'",
);

// A especialidade inválida é um erro de domínio conhecido, nunca um 500 genérico.
assert.match(acceptanceError, /CLINIC_INVITATION_SPECIALTY_INVALID/);
assert.match(acceptanceError, /CLINIC_INVITATION_SPECIALTY_INVALID:\s*422/);
assert.match(acceptRoute, /CLINIC_INVITATION_SPECIALTY_INVALID:[\s\S]*?especialidade clínica/i);

// Somente a RPC atômica fica dentro do bloco que pode responder "aceite falhou".
const atomicTryStart = acceptRoute.indexOf('let acceptedInvitation: AtomicClinicInvitationAcceptance;');
const postCommitMarker = acceptRoute.indexOf('From this point the database transaction is committed');
assert.ok(atomicTryStart >= 0 && postCommitMarker > atomicTryStart);
const atomicRegion = acceptRoute.slice(atomicTryStart, postCommitMarker);
assert.match(atomicRegion, /acceptClinicInvitationAtomically/);
assert.doesNotMatch(atomicRegion, /resolveOnboardingContextForUser/);
assert.doesNotMatch(atomicRegion, /hydrateSessionUserWithOnboardingContext/);

// Falha de hidratação pós-commit é registrada, mas o endpoint continua sucesso.
const postCommitRegion = acceptRoute.slice(postCommitMarker);
assert.match(postCommitRegion, /postAcceptanceRefreshPending = true/);
assert.match(postCommitRegion, /POST_ACCEPT_REFRESH/);
assert.match(postCommitRegion, /return res\.json\(\{[\s\S]*?success: true/);
assert.match(postCommitRegion, /postAcceptanceRefreshPending/);

// Auditoria do aceite é idempotente: retry não duplica evento.
assert.match(postCommitRegion, /idempotencyKey: `clinic-invitation-accepted:/);

console.log('clinicInvitationAcceptanceCommitBoundary.test.mjs: ok');
