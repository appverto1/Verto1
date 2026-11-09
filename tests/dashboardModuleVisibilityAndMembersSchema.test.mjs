import { readModularServerSource } from './helpers/modularServerSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dashboard = fs.readFileSync(path.join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
const server = readModularServerSource();

assert.match(
  dashboard,
  /const hasAppointmentsCommunicationModule = authorizationHydrated && hasModule\("appointments_communication"\)/,
  'dashboard must derive agenda visibility from the contracted module after authorization hydration',
);
assert.match(
  dashboard,
  /\{hasAppointmentsCommunicationModule && \(\s*<>[\s\S]*?renderAgendaContent\(\)[\s\S]*?renderRoomsContent\(\)/,
  'dashboard agenda and rooms must not mount when appointments_communication is absent',
);
assert.match(
  dashboard,
  /if \(hasAppointmentsCommunicationModule\) \{\s*stats\.push\(/,
  'agenda summary cards must also be module-gated',
);

const membersRouteStart = server.indexOf("app.get('/api/clinic/members'");
const membersRouteEnd = server.indexOf("app.get('/api/clinic/members/:memberId/work-schedule'", membersRouteStart);
assert.ok(membersRouteStart >= 0 && membersRouteEnd > membersRouteStart, 'clinic members route must exist');
const membersRoute = server.slice(membersRouteStart, membersRouteEnd);
const membershipSelectEnd = membersRoute.indexOf(".eq('clinic_id'");
const membershipSelect = membersRoute.slice(0, membershipSelectEnd);
assert.doesNotMatch(
  membershipSelect,
  /profile_picture_path/,
  'clinic members query must not request removed users.profile_picture_path',
);
assert.match(
  membersRoute,
  /professional_profiles[\s\S]*?profile_photo_url, metadata/,
  'clinic members photo resolution must continue using the canonical professional profile data',
);

console.log('dashboardModuleVisibilityAndMembersSchema.test.mjs: ok');
