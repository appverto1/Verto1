import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
const module=readFileSync(new URL('../services/partnerships/partnershipRoutes.ts',import.meta.url),'utf8');
test('standalone partner routes are mounted once after API guards and before fallback',()=>{
  assert.match(server,/import \{ approvedExternalPartnerForClinicalIdentity, registerPartnershipRoutes \} from '\.\/services\/partnerships\/partnershipRoutes';/);
  assert.equal((server.match(/registerPartnershipRoutes\(app, \{supabase,checkAuth,checkPlatformAdmin\}\)/g)||[]).length,1);
  assert.ok(server.indexOf('createSensitiveApiMutationProtectionMiddleware({')<server.indexOf('registerPartnershipRoutes(app, {'));
  assert.ok(server.indexOf('registerPartnershipRoutes(app, {')<server.indexOf("app.all('/api/*'"));
  assert.match(module,/app\.post\('\/api\/partnerships\/apply'/);
  assert.match(module,/registerPartnerMarketplaceRoutes\(app,deps\)/);
});
