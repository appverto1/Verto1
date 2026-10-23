import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import express from 'express';
import { registerPatientTimeReportRoute } from '../services/patientTimeReportRoute';

const source = readFileSync('server.ts', 'utf8');
const call = 'registerPatientTimeReportRoute(app, {';
assert.equal(source.split(call).length, 2, 'exactly one original route registration');
assert.ok(source.indexOf(call) < source.indexOf("app.get('/api/reports/time/professional'"), 'relative route order retained');
assert.ok(!source.includes("app.get('/api/reports/time/patient'"), 'extracted route has no duplicate in server.ts');

const clinicOne = '10000000-1000-4000-8000-000000000001';
const clinicTwo = '20000000-1000-4000-8000-000000000002';
const calls: any[] = [];
let builders = 0;
const app = express();
registerPatientTimeReportRoute(app, {
  checkAuth: (req: any, res: any, next: any) => {
    if (req.headers['x-test-auth'] === 'deny') return res.status(401).json({ error: 'UNAUTHORIZED' });
    req.session = { user: { clinicId: req.headers['x-test-clinic'] || clinicOne, organizationId: 'org' } };
    next();
  },
  requireClinicCapability: (capability: string) => {
    assert.equal(capability, 'reports.view');
    return (req: any, res: any, next: any) =>
      req.headers['x-test-capability'] === 'deny' ? res.status(403).json({ error: 'FORBIDDEN' }) : next();
  },
  sanitizeString: (value: unknown, max: number) => String(value ?? '').trim().slice(0, max),
  currentClinicId: (user: any) => user?.clinicId,
  sanitizeIsoDateTime: (value: unknown) => String(value),
  fetchTimeReportAppointments: async (args: any) => {
    calls.push(args);
    if (args.status === 'explode') throw new Error('simulated DB fault');
    return [{ id: 'appointment' }];
  },
  buildPatientTimeReport: (appointments: any, filters: any) => {
    builders++;
    return { appointments, filters };
  }
});
const server = http.createServer(app);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = 'http://127.0.0.1:' + address.port;
  const denied = await fetch(url + '/api/reports/time/patient', { headers: { 'x-test-auth': 'deny' } });
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { error: 'UNAUTHORIZED' });
  const forbidden = await fetch(url + '/api/reports/time/patient', { headers: { 'x-test-capability': 'deny' } });
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), { error: 'FORBIDDEN' });
  assert.equal(calls.length, 0, 'authorization must block database access');

  for (const clinicId of [clinicOne, clinicTwo]) {
    const response = await fetch(url + '/api/reports/time/patient?patientId=pat-1&status=completed&limit=10&from=2026-01-01&to=2026-01-31', {
      headers: { 'x-test-clinic': clinicId }
    });
    assert.equal(response.status, 200);
    const payload: any = await response.json();
    assert.equal(payload.success, true);
    assert.deepEqual(payload.data.appointments, [{ id: 'appointment' }]);
    assert.equal(payload.data.filters.patient_id, 'pat-1');
    assert.equal(payload.data.filters.status, 'completed');
    assert.equal(calls.at(-1).clinicId, clinicId, 'tenant boundary is from authenticated session');
    assert.equal(calls.at(-1).limit, 10);
    assert.equal(calls.at(-1).patientId, 'pat-1');
  }
  assert.equal(builders, 2);
  const failed = await fetch(url + '/api/reports/time/patient?status=explode');
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { success: false, error: 'Não foi possível gerar o relatório de tempo do paciente.' });
  assert.equal(builders, 2, 'report building must not happen after DB failure');
  assert.equal(calls.length, 3);
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
console.log('patientTimeReportRoute: authorization, tenant isolation, success, filters and 500 paths passed');
