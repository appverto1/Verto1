import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');

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
// Execute the actual unsubscribe service with a forged endpoint and IDs:
// only the exact actor + patient + deployment row may ever be deleted.
const scopeContext = {
  sanitizeText: (v, max = 3000) => String(v || '').trim().slice(0,max),
  requireDeploymentEnv: (value) => value,
  isUuid: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || '')),
};
vm.createContext(scopeContext);
const executable = ts.transpileModule(
  push.slice(serviceStart,serviceEnd).replace('export async function','async function'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
).outputText;
vm.runInContext(executable+'\nglobalThis.removeOwnPush = removePatientPushSubscription;',scopeContext);
const removeOwnPush=scopeContext.removeOwnPush;
assert.equal(typeof removeOwnPush,'function');
const own='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const endpoint='https://push.example.invalid/one-device';
const rows=[
  {patient_id:own,user_id:own,deployment_env:'staging',endpoint},
  {patient_id:other,user_id:other,deployment_env:'staging',endpoint},
  {patient_id:own,user_id:own,deployment_env:'production',endpoint},
];
let dbCalls=0;
const fakeDb={from(table){
  assert.equal(table,'push_subscriptions'); dbCalls++;
  const filters={};
  return {delete(){return this},eq(key,value){filters[key]=value;return this},
    then(resolve){ const index=rows.findIndex(row=>Object.entries(filters).every(([key,v])=>row[key]===v));
      if(index>=0)rows.splice(index,1);
      resolve({error:null});
    }
  };
}};
assert.equal((await removeOwnPush({supabase:fakeDb,deploymentEnv:'staging',patientId:own,actorUserId:'forged',endpoint})).success,false);
assert.equal(dbCalls,0,'invalid IDs must stop before hitting the DB');
assert.equal((await removeOwnPush({supabase:fakeDb,deploymentEnv:'staging',patientId:other,actorUserId:own,endpoint})).success,true);
assert.equal(rows.length,3,'cannot delete another patient under current login');
assert.equal((await removeOwnPush({supabase:fakeDb,deploymentEnv:'staging',patientId:own,actorUserId:own,endpoint})).success,true);
assert.equal(rows.length,2);
assert.ok(rows.some(row=>row.user_id===other && row.deployment_env==='staging'));
assert.ok(rows.some(row=>row.deployment_env==='production'));
console.log('PASS P1 scoped unsubscribe adversarial service execution');

console.log('PASS P1 dashboard hydration, scoped push on-off persistence and backend owner guard');
