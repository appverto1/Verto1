import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleClinicDre } from '../services/clinicDreHandler';

const source = readFileSync('server.ts', 'utf8');
const registration = "app.get('/api/clinic/dre', checkAuth, handleClinicDre)";
assert.equal(source.split(registration).length, 2, 'keep exactly one original authenticated route registration');
assert.ok(source.indexOf(registration) < source.indexOf("app.get('/api/admin/dre'"), 'route order preserved');

function response() {
  const state: { status: number; value: unknown } = { status: 200, value: undefined };
  const res = {
    status(code: number) { state.status = code; return this; },
    json(value: unknown) { state.value = value; return this; },
  };
  return { res, state };
}

for (const user of [{ id: 'clinic-one' }, { id: 'clinic-two', clinic_id: 'clinic-two' }]) {
  const { res, state } = response();
  await handleClinicDre({ session: { user } }, res);
  assert.equal(state.status, 200);
  assert.deepEqual(state.value, {
    success: true,
    data: {
      revenue: 25450.00, costs: 12300.00, expenses: 4500.00, profit: 8650.00,
      byProfessional: { 'Dra. Raísa': 8500.00, 'Dr. Marcos': 7200.00, 'Dra. Ana': 6800.00, 'Outros': 2950.00 },
      byService: { ABA: 12400.00, TCC: 8200.00, Fonoaudiologia: 4850.00 },
      monthly: [{ month: 'Jan', revenue: 22000, profit: 7200 }, { month: 'Fev', revenue: 23500, profit: 7800 }, { month: 'Mar', revenue: 25450, profit: 8650 }]
    }
  });
}
const { res, state } = response();
await handleClinicDre({ session: undefined }, res);
assert.equal(state.status, 500);
assert.deepEqual(state.value, { error: 'Erro interno do servidor.' });
console.log('clinicDreHandler.test.ts: 3 cases + route structure passed');
