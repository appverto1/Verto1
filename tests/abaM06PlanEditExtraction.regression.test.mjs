import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// ABA-M06: literal handler parity against pre-extraction staging.
// We intentionally preserve clinical guards, versioning and RPC arguments.
const prior = execFileSync('git', ['cat-file', 'blob', 'eeca8e311aacea6a481da36fbdaa383b44a3cf68'], {
  encoding: 'utf8',
  maxBuffer: 8_000_000,
});
const server = readFileSync('server.ts', 'utf8');
const handler = readFileSync('services/therapeuticPlanEditHandler.ts', 'utf8');
const oldHeader = "  app.patch('/api/aba/patients/:patientId/therapeutic-plans/:planId', checkAuth, requireScopedTherapeuticPlanCapability('edit'), checkPatientAccess, async (req: any, res) => {";
const nextHeader = "  app.post('/api/aba/patients/:patientId/therapeutic-plans/:planId/pts-draft'";
const oldStart = prior.indexOf(oldHeader);
const oldNext = prior.indexOf(nextHeader, oldStart);
const oldEnd = prior.lastIndexOf('\n  });', oldNext);
assert.ok(oldStart >= 0 && oldNext > oldStart && oldEnd > oldStart, 'old route bounds');
assert.equal(prior.slice(oldEnd + 6, oldNext).trim(), '', 'old route end is adjacent to PTS');
const oldBody = prior.slice(oldStart + oldHeader.length, oldEnd);
const newStart = handler.indexOf('\n    try {');
const newEnd = handler.lastIndexOf('\n  };');
assert.ok(newStart > 0 && newEnd > newStart, 'new handler bounds');
assert.equal(handler.slice(newStart, newEnd), oldBody, 'business logic and Supabase calls remain unchanged');
const register = "app.patch('/api/aba/patients/:patientId/therapeutic-plans/:planId'";
assert.equal(server.split(register).length, 2, 'edit route registered exactly once');
assert.ok(server.includes("app.patch('/api/aba/patients/:patientId/therapeutic-plans/:planId', checkAuth, requireScopedTherapeuticPlanCapability('edit'), checkPatientAccess, createTherapeuticPlanEditHandler(() => ({"), 'middleware chain unchanged');
assert.ok(server.indexOf("app.post('/api/aba/patients/:patientId/therapeutic-plans'") < server.indexOf(register), 'create before edit');
assert.ok(server.indexOf(register) < server.indexOf(nextHeader), 'edit before PTS');
for (const code of [
  ".eq('organization_id', organizationId)",
  ".eq('patient_id', patientId)",
  ".eq('status', 'active')",
  "THERAPEUTIC_PLAN_EDIT_DENIED",
  "THERAPEUTIC_PLAN_VERSION_CONFLICT",
  "if (!canManageAny && !permittedIds.has(actorId))",
  "canActivateSpecialtyPlanForCase",
  "PTS_VERSION_ENDPOINT_REQUIRED",
  "p_expected_version: expectedVersion",
  "p_actor_id: actorId",
  "activate_patient_specialty_plan_v1",
  "update_patient_therapeutic_plan_v3",
  "if (!updated?.id)",
  "res.json({ success: true, data: updated",
]) assert.ok(handler.includes(code), 'security/persistence guard: ' + code);
assert.ok(!handler.includes("from '../server'"), 'no circular import of server');
console.log('ABA-M06: parity, tenant scope, CAS, PTS restriction, RPC and ACK contracts OK');
