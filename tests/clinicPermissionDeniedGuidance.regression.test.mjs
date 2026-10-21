import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');

// Exercise the actual 403 classifier in isolation, without any network request,
// credentials, or clinical data.
const start = dataService.indexOf("const CLINIC_PERMISSION_DENIED_EVENT =");
const end = dataService.indexOf("const SERVER_SESSION_EXPIRED_CODES =", start);
assert.ok(start > 0 && end > start, '403 denial classifier must exist');
const js = dataService.slice(start, end)
  .replace('response: Response, url: string', 'response, url')
  .replace('let payload: any;', 'let payload;');
let clock = 100000;
const events = [];
const context = {
  window: {
    location: { origin: 'https://staging.example.test' },
    dispatchEvent: (event) => events.push(event.type),
  },
  Date: { now: () => clock },
  URL,
  CustomEvent: class { constructor(type) { this.type = type; } },
};
vm.createContext(context);
vm.runInContext(js + '\nthis.dispatch = notifyClinicPermissionDeniedIfNeeded;', context);
const response = (status, type = 'application/json', payload = { success: false, error: 'CLINIC_DENIED' }) => ({
  status,
  headers: { get: () => type },
  clone: () => ({ json: async () => payload }),
});

await context.dispatch(response(403), '/api/clinic/authorization/me');
assert.equal(events.length, 1, 'clinic 403 shows one permission notice');
await context.dispatch(response(403), '/api/patients/patient-a');
assert.equal(events.length, 1, 'concurrent denied requests must not create a notification loop');
clock += 30001;
await context.dispatch(response(403), '/api/calendar/events');
assert.equal(events.length, 2, 'a later denied action can notify again');
await context.dispatch(response(403), '/api/patient/self/history');
await context.dispatch(response(403), '/api/stripe/checkout');
await context.dispatch(response(401), '/api/clinic/authorization/me');
await context.dispatch(response(500), '/api/clinic/authorization/me');
await context.dispatch(response(403, 'text/html'), '/api/clinic/authorization/me');
await context.dispatch(response(403, 'application/json', null), '/api/clinic/authorization/me');
await context.dispatch(response(403), 'http://[');
assert.equal(events.length, 2, 'patient, billing, non-403, non-JSON and malformed responses must be ignored');

const fetchStart = dataService.indexOf('async function fetchWithAuthRetry');
const fetchEnd = dataService.indexOf('async function safeJson', fetchStart);
const fetchCode = dataService.slice(fetchStart, fetchEnd);
assert.match(fetchCode, /if \(response.status !== 401\) \{[\s\S]*?notifyClinicPermissionDeniedIfNeeded\(response, url\)/);
assert.match(fetchCode, /if \(response.status === 401\) \{[\s\S]*?notifyServerSessionExpiredIfNeeded\(response\)/,
  'session expiry remains authoritative and unaffected');

assert.match(app, /window\.addEventListener\('verto:clinic-permission-denied', handleClinicPermissionDenied\)/);
assert.match(app, /window\.removeEventListener\('verto:clinic-permission-denied', handleClinicPermissionDenied\)/);
assert.match(app, /if \(!user\?\.id \|\| !isProfessionalClinicRole\(user\?\.role\)\) return/,
  'patient accounts must not be treated as clinic workspace users');
assert.match(app, /const handleClinicPermissionDenied = \(\) => \{[\s\S]*?setClinicPermissionNotice\(true\)/);
assert.match(app, /A clínica pode ter atualizado seu papel ou suas permissões/,
  '403 must not be misrepresented as proven membership revocation');
assert.match(app, /onClick=\{\(\) => setClinicPermissionNotice\(false\)\}/,
  'limited-scope 403 must be dismissible without forcibly logging out');
assert.match(app, /setClinicPermissionNotice\(false\);\s*void handleLogout\('expired'\);/,
  'explicit re-entry uses canonical no-replay cleanup');
assert.match(app, /const \[clinicPermissionNotice, setClinicPermissionNotice\] = useState\(false\)/);

console.log('clinicPermissionDeniedGuidance.regression.test.mjs: ok');
