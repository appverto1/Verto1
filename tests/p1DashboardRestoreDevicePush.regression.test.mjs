import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard=fs.readFileSync('src/components/CoordinatorDashboard.tsx','utf8');
const portal=fs.readFileSync('src/components/PatientDashboard.tsx','utf8');
const renewal=fs.readFileSync('src/services/pushSubscriptionRenewal.ts','utf8');
const push=fs.readFileSync('services/pushNotificationService.ts','utf8');
const server=fs.readFileSync('server.ts','utf8');

// Restore only when the authoritative capabilities of the selected clinic are loaded.
assert.match(dashboard,/hasRestoredDashboardStateRef = useRef\(''\)/);
assert.match(dashboard,/!dashboardResumeKey \|\| !authorizationHydrated \|\| hasRestoredDashboardStateRef\.current === dashboardResumeKey/);
assert.match(dashboard,/hasRestoredDashboardStateRef\.current = dashboardResumeKey/);
assert.match(dashboard,/skipDashboardResumeSaveRef\.current = true/);
assert.match(dashboard,/if \(skipDashboardResumeSaveRef\.current\)/);
assert.match(dashboard,/!authorizationHydrated \|\| hasRestoredDashboardStateRef\.current !== dashboardResumeKey/);
assert.match(dashboard,/filter\(\(tab: any\) => tab && canAccessTab\(tab as DashboardTab\)\)/);
assert.match(dashboard,/setSelectedPatientId\(null\);[\s\S]{0,120}setView\("home"\)/);
assert.match(dashboard,/nextView === "patient" && nextPatientId && canAccessTab\("patients"\)/);
assert.match(dashboard,/Invalid persisted state must not leak a previous clinic patient view/);
assert.match(dashboard,/verto:dashboard:resume:\$\{userId\}:\$\{workspaceId\}/);

// Device push OFF must revoke on the server before unsubscribing browser SW.
// Push notifications must not auto-renew once deliberately disabled.
assert.match(portal,/const disablePatientNotifications = async \(\) =>/);
assert.match(portal,/method: 'DELETE'/);
assert.match(portal,/\/api\/push\/subscribe/);
assert.match(portal,/await clearPushRenewalContext\(\)/);
assert.match(portal,/subscription\.unsubscribe\(\)/);
assert.match(portal,/onChange=\{\(event\) => \{ void \(event\.currentTarget\.checked \? enablePatientNotifications\(\) : disablePatientNotifications\(\)\)/);
assert.doesNotMatch(portal,/disabled=\{notificationSubscriptionReady \|\| isEnablingNotifications/);
assert.match(renewal,/window\.caches\.delete\('verto-push-renewal-v1'\)/);

// Backend must derive unsubscribe target from signed user_id, never arbitrary body.patientId.
const start=server.indexOf('const handlePushUnsubscribe =');
const end=server.indexOf('const handlePushRenew =',start);
assert.ok(start>=0&&end>start);
const handler=server.slice(start,end);
assert.match(handler,/PUSH_UNSUBSCRIBE_ROLE_DENIED/);
assert.match(handler,/\.eq\('user_id', actorUserId\)/);
assert.match(handler,/\.eq\('deployment_env', vertoDeploymentEnv\)/);
assert.match(handler,/\.eq\('endpoint', endpoint\)/);
assert.doesNotMatch(handler,/req\.body\?\.patientId|req\.body\?\.patientEmail/);
assert.match(handler,/actorUserId,\s*endpoint/);
const serviceStart=push.indexOf('export async function removePatientPushSubscription');
const serviceEnd=push.indexOf('export async function deleteInvalidPushSubscription',serviceStart);
assert.ok(serviceStart>=0&&serviceEnd>serviceStart);
const service=push.slice(serviceStart,serviceEnd);
assert.match(service,/!isUuid\(patientId\) \|\| !isUuid\(actorUserId\) \|\| !endpoint/);
assert.match(service,/\.eq\('patient_id', patientId\)/);
assert.match(service,/\.eq\('user_id', actorUserId\)/);
assert.match(service,/\.eq\('deployment_env', deploymentEnv\)/);
console.log('PASS P1 dashboard hydration, scoped push on-off persistence and backend owner guard');
