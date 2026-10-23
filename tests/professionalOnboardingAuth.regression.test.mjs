import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSensitiveApiMutationProtectionMiddleware } from '../src/utils/sensitiveApiMutationProtection.mjs';

const component = fs.readFileSync('src/components/ProfessionalOnboarding.tsx', 'utf8');
const service = fs.readFileSync('src/services/dataService.ts', 'utf8');
const guard = fs.readFileSync('src/utils/sensitiveApiMutationProtection.mjs', 'utf8');

const upload = service.slice(
  service.indexOf('async uploadProfessionalOnboardingMedia('),
  service.indexOf('async completeProfessionalOnboarding(')
);
const complete = service.slice(
  service.indexOf('async completeProfessionalOnboarding('),
  service.indexOf('async getOnboardingContext()')
);
for (const [name, implementation] of [['upload', upload], ['completion', complete]]) {
  assert.ok(implementation.startsWith('async '), name + ' method must exist');
  assert.match(implementation, /headers: await getAuthHeaders\(\)/,
    name + ' must forward the authenticated bearer or canonical cookie session');
  assert.match(implementation, /credentials: 'include'/,
    name + ' must preserve the HTTP session cookie');
  assert.match(implementation, /method: 'POST'/);
  assert.match(implementation, /fetchWithAuthRetry\(/);
  assert.match(implementation, /return await safeJson\(response\)/);
}
assert.match(upload, /'\/api\/storage\/upload'/);
assert.match(complete, /encodeURIComponent\(userId\)/);
assert.match(complete, /complete-onboarding/);
assert.match(component, /dataService\.uploadProfessionalOnboardingMedia\(/);
assert.match(component, /dataService\.completeProfessionalOnboarding\(/);
assert.doesNotMatch(component, /fetch\(['"]\/api\/storage\/upload['"]/);
assert.doesNotMatch(component, /fetch\(`\/api\/profile\/\$\{user\.id\}\/complete-onboarding`/);
assert.match(guard, /hasBearerAuth/);
assert.match(guard, /Requisição sensível sem autenticação válida\./);
assert.doesNotMatch(guard, /complete-onboarding/,
  'do not weaken the server guard by adding an unauthenticated onboarding exception');

// The middleware must continue rejecting requests without cookie/bearer,
// even from the correct website, while permitting the bearer to reach checkAuth.
const middleware = createSensitiveApiMutationProtectionMiddleware({
  configuredAppBase: () => 'https://appverto.com.br'
});
const callGuard = (authorization) => {
  let nextCalled = false;
  let status = 200;
  let payload;
  const req = {
    method: 'POST',
    path: '/api/profile/9f000000-0000-4000-8000-000000000001/complete-onboarding',
    protocol: 'https',
    headers: {origin: 'https://appverto.com.br', ...(authorization ? {authorization} : {})},
    cookies: {},
    get: () => 'appverto.com.br'
  };
  const res = {
    status(value) { status = value; return this; },
    json(value) { payload = value; return this; }
  };
  middleware(req, res, () => { nextCalled = true; });
  return {nextCalled, status, payload};
};
const unauthenticated = callGuard(null);
assert.equal(unauthenticated.nextCalled, false);
assert.equal(unauthenticated.status, 403);
assert.equal(unauthenticated.payload?.error, 'Requisição sensível sem autenticação válida.');
assert.equal(callGuard('Bearer test-supabase-token').nextCalled, true);
console.log('professionalOnboardingAuth: authenticated mutation and middleware regression PASS');
