import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const calendar = fs.readFileSync('src/components/Calendar.tsx', 'utf8');
const rooms = fs.readFileSync('src/components/RoomReservation.tsx', 'utf8');
const dashboard = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const withAuth = fs.readFileSync('src/hoc/withAuth.tsx', 'utf8');
const activation = fs.readFileSync('src/components/ActivationAccess.tsx', 'utf8');

assert.match(server, /\['owner', 'admin', 'director', 'coordinator'\]\.includes\(role\)/);
assert.match(server, /role === 'director' \|\| role === 'coordinator' \|\| role === 'admin' \|\| role === 'owner'/);
assert.match(server, /user\.role === 'director' \|\| user\.role === 'coordinator' \|\| user\.role === 'admin' \|\| user\.role === 'owner'/);
assert.match(server, /!isClinicManagedMember && clinicId && \(role === 'director' \|\| role === 'coordinator'/);
assert.match(calendar, /\['director', 'coordinator', 'admin', 'owner'\]/);
assert.match(rooms, /\['director', 'coordinator', 'receptionist', 'admin', 'owner'\]/);
assert.match(dashboard, /\["director", "coordinator", "receptionist", "admin", "owner"\]/);
assert.match(dashboard, /canManagePrivateSessionAmount = \["owner", "admin", "director"\]/);
assert.match(withAuth, /'director'[\s\S]*?'supervisor'[\s\S]*?'biller'/);
assert.match(activation, /'director', 'coordinator', 'supervisor', 'admin', 'therapist', 'receptionist', 'biller'/);

console.log('directorLegacyCompatibility.test.mjs: ok');
