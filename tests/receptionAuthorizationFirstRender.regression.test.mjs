import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');

const authHelperStart = dataService.indexOf('async getClinicAuthorizationContext()');
const authHelperEnd = dataService.indexOf('async selectWorkspace(', authHelperStart);
const authHelper = dataService.slice(authHelperStart, authHelperEnd);
assert.ok(authHelperStart > 0 && authHelperEnd > authHelperStart);
assert.match(authHelper, /fetchWithAuthRetry\('\/api\/clinic\/authorization\/me'/);
assert.doesNotMatch(authHelper, /const response = await fetch\('\/api\/clinic\/authorization\/me'/);

const hydrationStart = dashboard.indexOf('const applyFailClosedAuthorization = () =>');
const hydrationEnd = dashboard.indexOf('const hasCapability = useCallback', hydrationStart);
const hydration = dashboard.slice(hydrationStart, hydrationEnd);
assert.ok(hydrationStart > 0 && hydrationEnd > hydrationStart);
assert.match(hydration, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
assert.match(hydration, /await dataService\.getClinicAuthorizationContext\(\)/);
assert.match(hydration, /result\?\.success && Array\.isArray\(result\?\.data\?\.capabilities\)/);
assert.match(hydration, /setAuthorizationHydrated\(true\);\s*return;/);
assert.match(hydration, /applyFailClosedAuthorization\(\)/);
assert.match(hydration, /filterCapabilitiesByOrganizationModules\(baseCapabilities, 'contract', new Set<OrganizationModuleKey>\(\)\)/);
assert.match(hydration, /user\?\.activeAccessContextId/);

const tabGuardStart = dashboard.indexOf('const canAccessTab = (tabId: string) =>');
const tabGuardEnd = dashboard.indexOf('const canAccessNotices', tabGuardStart);
const tabGuard = dashboard.slice(tabGuardStart, tabGuardEnd);
assert.match(tabGuard, /if \(!authorizationHydrated\)/);
assert.match(tabGuard, /return tabId === "dashboard" \|\| tabId === "professionalProfile"/);

console.log('receptionAuthorizationFirstRender.regression.test.mjs: ok');
