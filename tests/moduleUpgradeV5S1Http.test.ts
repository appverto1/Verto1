import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { registerModuleSubscriptionUpgradeExecutionRoutes } from '../services/moduleSubscriptionUpgradeExecutionRoutes';

const app = express();
app.use(express.json());

const query = {
  select() { return this; },
  eq() { return this; },
  limit() { return this; },
  async maybeSingle() { return { data: null, error: null }; },
};
const supabase = { from: () => Object.create(query), rpc: async () => ({ data: null, error: null }) };
const pass = (_req: any, _res: any, next: any) => next();
const checkAuth = (req: any, _res: any, next: any) => {
  const mode = String(req.headers['x-test-auth'] || 'none');
  req.session = { user: mode === 'none' ? null : { id: 'actor-1', activeWorkspaceId: String(req.headers['x-test-clinic'] || '') } };
  next();
};
const requireClinicCapability = () => (req: any, _res: any, next: any) => {
  const allowed = String(req.headers['x-test-capability'] || '') === 'edit';
  req.authorizationContext = {
    role: allowed ? 'director' : 'therapist',
    capabilities: new Set(allowed ? ['clinic.settings.edit'] : []),
  };
  next();
};

registerModuleSubscriptionUpgradeExecutionRoutes(app, {
  supabase,
  noStoreDynamicResponse: pass,
  checkAuth,
  requireClinicCapability,
  sanitizeString: (value: any, max = 240) => String(value || '').trim().slice(0, max),
  currentClinicId: (user: any) => String(user?.activeWorkspaceId || '').trim() || null,
});

const server = http.createServer(app);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const base = `http://127.0.0.1:${address.port}`;

try {
  const noSession = await fetch(`${base}/api/clinic/modules/upgrade-intents/intent-a/execute`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(noSession.status, 403, 'sem clínica/sessão deve falhar fechado');
  assert.equal((await noSession.json()).error, 'CLINIC_REQUIRED');

  const insufficient = await fetch(`${base}/api/clinic/modules/upgrade-intents/intent-a/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-auth': 'member', 'x-test-clinic': 'clinic-a' },
    body: '{}',
  });
  assert.equal(insufficient.status, 403, 'capability insuficiente não executa upgrade');
  assert.equal((await insufficient.json()).error, 'MODULE_UPGRADE_COMMERCIAL_FORBIDDEN');

  const crossTenant = await fetch(`${base}/api/clinic/modules/upgrade-intents/foreign-intent/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-auth': 'member', 'x-test-clinic': 'clinic-a', 'x-test-capability': 'edit' },
    body: JSON.stringify({ acceptTerms: true }),
  });
  assert.equal(crossTenant.status, 404, 'intent fora do tenant não pode ser enumerada/executada');
  assert.equal((await crossTenant.json()).error, 'MODULE_UPGRADE_INTENT_NOT_FOUND');
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

console.log('moduleUpgradeV5S1Http.test.ts: ok');
