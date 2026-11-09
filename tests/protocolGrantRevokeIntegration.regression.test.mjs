import { readModularServerSource } from './helpers/modularServerSource.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readModularServerSource();
const protocols = readFileSync('src/components/Protocols.tsx', 'utf8');
const admin = readFileSync('src/components/SuperAdminDashboard.tsx', 'utf8');

assert.match(server, /revokeProtocolGrantForRequest[\s\S]*supabase\.rpc\('revoke_clinic_protocol_grant_v1'/, 'server must invoke canonical revoke RPC');
assert.match(server, /\/api\/protocol-import-requests\/:requestId\/revoke'[\s\S]*requireClinicCapability\('aba\.program\.edit'\)/, 'clinic revoke endpoint must enforce effective capability');
assert.match(server, /\.eq\('id', requestId\)[\s\S]*\.eq\('clinic_id', clinicId\)/, 'clinic revoke must bind request to session clinic');
assert.match(server, /A revogacao de protocolo aprovado exige o fluxo canonico de grants/, 'approved DELETE must remain blocked');
assert.match(server, /\.delete\(\)[\s\S]*\.neq\('status', 'approved'\)/, 'legacy delete must exclude approved requests');
assert.match(server, /authorizedProtocolKeySet[\s\S]*status !== 'approved'[\s\S]*authorizedProtocolKeySet\.has/, 'clinic read model must hide revoked approved requests');
assert.match(server, /isDerivedApprovedProjection[\s\S]*activeIdentityKeys\.has/, 'sync must prune only derived inactive projections');
assert.match(server, /removed: merged\.removed/, 'sync must report projection removals');
assert.match(server, /app\.post\('\/api\/admin\/protocol-access'[\s\S]*if \(!enabled\)[\s\S]*revokeProtocolGrantForRequest/, 'Super Admin disable must use canonical revoke');
assert.doesNotMatch(server, /if \(!enabled\) \{\s*return res\.status\(409\).*fluxo canonico de grants/, 'valid admin revoke must not hit blanket guard');

const handlerStart = protocols.indexOf('const handleDeleteImportedRequest');
const handlerEnd = protocols.indexOf('const activeApprovedProtocolKeys', handlerStart);
const handler = protocols.slice(handlerStart, handlerEnd);
assert.match(handler, /status === 'approved'[\s\S]*\/revoke/, 'approved clinic removal must call revoke endpoint');
assert.match(handler, /method: isApproved \? 'POST' : 'DELETE'/, 'approved revoke and pending delete must stay separate');
assert.ok(handler.indexOf('await fetch') < handler.lastIndexOf('setImportedProtocolStatuses'), 'UI removal must occur after server response');
assert.match(protocols, /importedProtocolStatusesLoaded[\s\S]*isDerivedApprovedProjection[\s\S]*activeApprovedProtocolKeys\.has/, 'local projection must wait for and follow authoritative active grants');

const toggleStart = admin.indexOf('const handleToggleProtocolAccess');
const toggleEnd = admin.indexOf('const handleScanProtocolRequest', toggleStart);
const toggle = admin.slice(toggleStart, toggleEnd);
assert.match(toggle, /if \(enabled\) \{[\s\S]*setProtocolRequests/, 'only enable may retain optimistic preview');
assert.ok(toggle.indexOf('if (enabled)') < toggle.indexOf('await fetch'), 'disable must not mutate state before server authority');
assert.match(toggle, /const savedKeys = Array\.isArray\(data\.data\?\.protocolKeys\)/, 'Super Admin must reconcile saved keys from server');

console.log('protocolGrantRevokeIntegration.regression.test.mjs: ok');
