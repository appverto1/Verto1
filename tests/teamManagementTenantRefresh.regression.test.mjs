import assert from 'node:assert/strict';
import fs from 'node:fs';

const team = fs.readFileSync('src/components/TeamManagement.tsx', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

assert.match(team, /const activeTenantKey = String\([\s\S]{0,240}activeAccessContext\?\.clinicId[\s\S]{0,240}activeWorkspaceId[\s\S]{0,160}clinicId/);
assert.match(team, /useEffect\(\(\) => \{[\s\S]{0,900}fetchMembers\(expectedTenantKey\)[\s\S]{0,160}fetchInvitations\(expectedTenantKey\)[\s\S]{0,120}\}, \[activeTenantKey\]\)/);
assert.match(team, /activeTenantKeyRef\.current !== expectedTenantKey/);
assert.match(team, /membersTenantKey === activeTenantKey \? members : \[\]/);
assert.match(team, /invitationsTenantKey === activeTenantKey \? invitations : \[\]/);
assert.match(team, /setMembersTenantKey\(''\)[\s\S]{0,180}setMembers\(\[\]\)/);
assert.match(team, /formatAccessRoleLabel\(member\.role, member\)/);

const membersRouteStart = server.indexOf("app.get('/api/clinic/members'");
const membersRouteEnd = server.indexOf("app.patch('/api/clinic/members/:memberId/supervision-eligibility'", membersRouteStart);
assert.ok(membersRouteStart >= 0 && membersRouteEnd > membersRouteStart);
const membersRoute = server.slice(membersRouteStart, membersRouteEnd);
assert.match(membersRoute, /role:\s*m\.role/);
assert.doesNotMatch(membersRoute, /role:\s*m\.users\?\.role|role:\s*m\.users\.role/);

let activeTenant = 'clinic-a';
const visible = { value: null };
const commit = (expectedTenant, value) => {
  if (activeTenant !== expectedTenant) return false;
  visible.value = value;
  return true;
};
assert.equal(commit('clinic-a', 'therapist'), true);
activeTenant = 'clinic-b';
assert.equal(commit('clinic-b', 'biller'), true);
assert.equal(commit('clinic-a', 'therapist-late-response'), false);
assert.equal(visible.value, 'biller');
activeTenant = 'clinic-a';
assert.equal(commit('clinic-a', 'therapist'), true);
assert.equal(visible.value, 'therapist');

console.log('teamManagementTenantRefresh.regression.test.mjs: ok');
