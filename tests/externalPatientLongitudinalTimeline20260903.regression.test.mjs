import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const locator = fs.readFileSync(new URL('../src/components/ExternalEvolutionShare.tsx', import.meta.url), 'utf8');
const timeline = fs.readFileSync(new URL('../src/components/ExternalPatientTimeline.tsx', import.meta.url), 'utf8');
const central = fs.readFileSync(new URL('../src/components/ExternalCareNetworkCentral.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const epochMigration = fs.readFileSync(new URL('../supabase/migrations/20260903123000_external_share_grant_authorization_epochs.sql', import.meta.url), 'utf8');
const inviteContract = fs.readFileSync(new URL('../src/utils/externalEvolutionInviteContract.mjs', import.meta.url), 'utf8');

// Invite/public_id is only the authenticated entry point; it normalizes to a stable patient timeline route.
assert.match(server, /app\.get\('\/api\/external\/evolution\/:publicId\/context'/);
assert.match(server, /externalPatientTimelinePath/);
assert.match(locator, /openAuthorizedTimeline/);
assert.match(locator, /window\.location\.replace\(path\)/);
assert.doesNotMatch(locator, /\/content`/);
assert.match(inviteContract, /Acessar timeline compartilhada/);

// Stable route is first-class and can survive another browser/device after normal authentication.
assert.match(app, /\/rede-de-cuidado\\\/paciente\\\/\(\[\^\/\]\+\)\\\/\(\[\^\/\]\+\)/);
assert.match(app, /ExternalPatientTimeline clinicId=\{externalCarePatientClinicId\} patientId=\{externalCarePatientId\}/);
assert.match(timeline, /\/api\/external\/auth\/login/);
assert.match(timeline, /signInWithOAuth/);
assert.match(timeline, /redirectTo: `\$\{window\.location\.origin\}\$\{window\.location\.pathname\}\?partner_oauth=1`/);
assert.match(timeline, /EXTERNAL_PATIENT_TIMELINE_FORBIDDEN/);
assert.match(timeline, /Trocar conta/);

// Backend authorization starts from the authenticated external account and ACTIVE grants for exact clinic+patient.
const loadStart = server.indexOf('const loadExternalPatientTimeline');
const loadEnd = server.indexOf("app.get('/api/external/care-network/shared'", loadStart);
const loadBody = server.slice(loadStart, loadEnd);
assert.match(loadBody, /\.eq\('external_account_id', accountId\)/);
assert.match(loadBody, /\.eq\('clinic_id', clinicId\)/);
assert.match(loadBody, /\.eq\('patient_id', patientId\)/);
assert.match(loadBody, /\.eq\('status', 'ACTIVE'\)/);
assert.match(loadBody, /\.in\('id', itemIds\)/);
assert.match(loadBody, /patient\?\.is_active !== false/);
assert.match(loadBody, /PATIENT_STATUS_ARCHIVED/);
assert.match(loadBody, /sanitizeEmail\(contact\.email\) === sanitizeEmail\(grant\.recipient_email\)/);
assert.doesNotMatch(loadBody, /select\('\*'\)/);

// Only comments/files attached to the current ACTIVE grant epoch are returned.
assert.match(loadBody, /\.eq\('external_account_id', accountId\)\.in\('grant_id', eligibleGrantIds\)/);
assert.match(loadBody, /commentsByGrant\.get\(String\(grant\.id\)\)/);
assert.match(loadBody, /attachment: file\?\.id/);

// Comment permission remains per-item and files continue through exact-grant/publicId authorization.
assert.match(timeline, /item\.canComment \?/);
assert.match(timeline, /\/api\/external\/evolution\/\$\{encodeURIComponent\(item\.publicId\)\}\/comments/);
assert.match(timeline, /\/api\/external\/evolution\/\$\{encodeURIComponent\(item\.publicId\)\}\/file\/\$\{encodeURIComponent\(item\.timelineItemId\)\}/);

// Loading the timeline itself does not mark all items viewed; visibility of each card triggers its own view event.
assert.match(timeline, /IntersectionObserver/);
assert.match(timeline, /intersectionRatio < 0\.35/);
assert.match(timeline, /items\/\$\{encodeURIComponent\(grantId\)\}\/view/);
const timelineRouteStart = server.indexOf("app.get('/api/external/care-network/patients/:clinicId/:patientId/timeline'");
const viewRouteStart = server.indexOf("app.post('/api/external/care-network/patients/:clinicId/:patientId/items/:grantId/view'", timelineRouteStart);
const timelineRoute = server.slice(timelineRouteStart, viewRouteStart);
assert.doesNotMatch(timelineRoute, /record_external_evolution_view_v1/);
const viewRouteEnd = server.indexOf("app.get('/api/external/evolution/:publicId/content'", viewRouteStart);
const viewRoute = server.slice(viewRouteStart, viewRouteEnd);
assert.match(viewRoute, /record_external_evolution_view_v1/);

// A legitimately consumed activation token can return to LOGIN on another device, but is never treated as auth.
assert.match(server, /inspectExternalEvolutionActivationToken/);
assert.match(server, /tokenRow\?\.consumed_at/);
assert.match(server, /mode: 'LOGIN'/);
assert.match(server, /A consumed\/expired activation token is never authentication/);

// Central groups by clinic/patient and opens patient timeline instead of one grant.
assert.match(central, /openPatientTimeline/);
assert.match(central, /evoluções/);
assert.match(central, /formatFriendlyUpdate/);
assert.doesNotMatch(central, /openShare\(/);

// Authorization epochs remain immutable and only ACTIVE grants participate in the longitudinal read path.
assert.match(epochMigration, /WHERE status = 'ACTIVE'/);
assert.match(epochMigration, /INSERT INTO public\.patient_evolution_share_grants/);
assert.doesNotMatch(epochMigration, /revoked_at\s*=\s*NULL[\s\S]*UPDATE public\.patient_evolution_share_grants/i);

console.log('externalPatientLongitudinalTimeline20260903.regression: PASS');
