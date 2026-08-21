import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const component = fs.readFileSync(new URL('../src/components/PortalRelationshipConfirmation.tsx', import.meta.url), 'utf8');
const dataService = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');

const csrfStart = server.indexOf('const publicStateChangingPaths = new Set<string>([');
const csrfEnd = server.indexOf(']);', csrfStart);
assert.ok(csrfStart >= 0 && csrfEnd > csrfStart, 'public state-changing allowlist must exist');
const publicPaths = server.slice(csrfStart, csrfEnd);
assert.match(publicPaths, /"\/portal\/auth\/request-code"/);
assert.match(publicPaths, /"\/portal\/auth\/verify-code"/);

const relationshipGetStart = server.indexOf("app.get('/api/portal/relationship-confirmations/:token'");
const relationshipGetEnd = server.indexOf("app.post('/api/portal/relationship-confirmations/:token/confirm'", relationshipGetStart);
assert.ok(relationshipGetStart >= 0 && relationshipGetEnd > relationshipGetStart, 'relationship confirmation GET route must exist');
const relationshipGet = server.slice(relationshipGetStart, relationshipGetEnd);
assert.match(relationshipGet, /Cache-Control', 'private, no-store'/);
assert.match(relationshipGet, /requiresAuth: !authenticatedMatches/);

const portalVerifyStart = server.indexOf("app.post('/api/portal/auth/verify-code'");
const portalVerifyEnd = server.indexOf("app.post('/api/auth/password/recovery/verify'", portalVerifyStart);
assert.ok(portalVerifyStart >= 0 && portalVerifyEnd > portalVerifyStart, 'portal verify-code route must exist');
const portalVerify = server.slice(portalVerifyStart, portalVerifyEnd);
assert.match(portalVerify, /await saveExpressSession\(req\)/);
assert.match(portalVerify, /invalidateActiveSession\(/);
assert.match(portalVerify, /PORTAL_SESSION_UNAVAILABLE/);

assert.match(component, /const \[requiresAuth, setRequiresAuth\] = useState\(true\)/);
assert.match(component, /setRequiresAuth\(Boolean\(result\.requiresAuth\)\)/);
assert.match(component, /\) : requiresAuth \? \(/);
assert.match(component, /authError === 'PORTAL_AUTH_REQUIRED'/);
assert.match(component, /authError === 'Requisição sensível sem autenticação válida\.'/);

const relationshipServiceStart = dataService.indexOf('async getRelationshipConfirmation(token: string)');
const relationshipServiceEnd = dataService.indexOf('async confirmRelationship(token: string)', relationshipServiceStart);
assert.ok(relationshipServiceStart >= 0 && relationshipServiceEnd > relationshipServiceStart, 'relationship confirmation client service must exist');
const relationshipService = dataService.slice(relationshipServiceStart, relationshipServiceEnd);
assert.match(relationshipService, /getNoStoreAuthHeaders\(\)/);
assert.match(relationshipService, /cache: 'no-store'/);
assert.match(relationshipService, /credentials: 'include'/);

console.log('portalRelationshipConfirmationAuth.regression.test.mjs: ok');
