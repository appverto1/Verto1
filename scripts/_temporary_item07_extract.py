from pathlib import Path
import re, hashlib

root=Path('.')
server_path=root/'server.ts'
source=server_path.read_text(encoding='utf8')
core_start='  const createOrReuseModularCheckout = async ('
core_end='  app.post(\n    "/api/owner/sales/offers/:offerId/modular-checkout",'
public_start='  app.post(\n    "/api/public/sales-offers/:token/accept",'
public_end='  registerPublicSalesPaymentStatusRoute(app,'
for anchor in (core_start,core_end,public_start,public_end):
    if source.count(anchor)!=1: raise RuntimeError('Nonunique/missing checkout anchor: '+anchor)
a=source.index(core_start)
b=source.index(core_end,a)
c=source.index(public_start)
d=source.index(public_end,c)
if not (c<d<a<b): raise RuntimeError('Checkout registrations are unexpectedly reordered')
core=source[a:b]
public=source[c:d]
hcore=hashlib.sha256(core.encode()).hexdigest()
hpub=hashlib.sha256(public.encode()).hexdigest()
core_module=("import type Stripe from 'stripe';\n"
    "// Item 07: extract existing checkout core unchanged; server remains authoritative.\n"
    "export function createModularCheckoutCore(deps: Record<string, any>) {\n"
    "  // ITEM07_CORE_DEPS\n"
    +core+
    "  return createOrReuseModularCheckout;\n"
    "}\n")
public_module=("import type Stripe from 'stripe';\n"
    "// Item 07: original public accept and card Checkout handlers, in original registration order.\n"
    "export function registerPublicSalesCheckoutRoutes(deps: Record<string, any>) {\n"
    "  // ITEM07_PUBLIC_DEPS\n"
    +public+
    "}\n")
(root/'services/salesModularCheckoutCore.ts').write_text(core_module,encoding='utf8')
(root/'services/publicSalesCheckoutRoutes.ts').write_text(public_module,encoding='utf8')

# The lazily resolved delegate is essential: the legacy server registered public routes
# before the owner-only Checkout core, but no request could run before startServer completed.
public_repl="""  registerPublicSalesCheckoutRoutes({
    // ITEM07_PUBLIC_INJECT
    createOrReuseModularCheckout: (req: any, res: any, params: any) =>
      createOrReuseModularCheckout(req, res, params),
  });

"""
core_repl="""  const createOrReuseModularCheckout = createModularCheckoutCore({
    // ITEM07_CORE_INJECT
  });

"""
rewritten=source[:a]+core_repl+source[b:]
rewritten=rewritten.replace(public,public_repl)
if rewritten.count('registerPublicSalesCheckoutRoutes({')!=1 or rewritten.count('createModularCheckoutCore({')!=1:raise RuntimeError('Route registration mismatch')
rewritten=("import { createModularCheckoutCore } from './services/salesModularCheckoutCore';\n"
    "import { registerPublicSalesCheckoutRoutes } from './services/publicSalesCheckoutRoutes';\n"
    +rewritten)
server_path.write_text(rewritten,encoding='utf8')

# Move static assertions from the monolith to their actual new source modules;
# never change what a security/snapshot assertion is checking.
tests=[
 'tests/salesBoletoPaymentPendingSafety.regression.test.mjs',
 'tests/salesCheckoutReturnContext20260831.regression.test.mjs',
 'tests/salesCustomerFacingModulesOnly.test.mjs',
 'tests/salesStripeWebhookDbMonotonicGuard.regression.test.mjs',
 'tests/salesStripeWebhookLeadStateIsolation.regression.test.mjs',
 'tests/organizationModuleEntitlements.test.mjs',
 'tests/salesCheckoutProvisioning.test.ts',
 'tests/salesModularStripeAssisted.test.ts',
 'tests/salesPublicCardCheckoutSafety.regression.test.mjs',
 'tests/salesContractIdentity.test.ts',
 'tests/salesCurrentOperatingSalesGate20260901.regression.test.mjs',
]
for path in tests:
    p=root/path
    t=p.read_text(encoding='utf8')
    original=t
    # Distinct alias avoids collision with existing test imports.
    import_statement="import { readFileSync as readItem07Source } from 'node:fs';\n"
    t=import_statement+t
    # Declarations intentionally placed before first test/assignment, after imports.
    imports=list(re.finditer(r'^import .*?;\s*$',t,re.M))
    if not imports: raise RuntimeError('Missing import region: '+path)
    pos=imports[-1].end()
    declarations="\nconst checkoutCoreSource = readItem07Source('services/salesModularCheckoutCore.ts','utf8');\n"
    declarations+="const publicCheckoutRouteSource = readItem07Source('services/publicSalesCheckoutRoutes.ts','utf8');\n"
    t=t[:pos]+declarations+t[pos:]
    # Core-source captures were only testing the same large handler before the move.
    for name in ('modularCheckout','checkoutCore','moduleCheckout'):
        pat=r'(?:const\s+'+name+r'\s*=\s*)(?:server\s*\.\s*match\s*\([\s\S]*?\)\?\.\[0\]\s*\|\|\s*[\x27\x22]{2})'
        t,num=re.subn(pat,"const "+name+" = checkoutCoreSource.slice(checkoutCoreSource.indexOf('const createOrReuseModularCheckout = async'))",t,count=1)
        if num: print('CORE_ASSERT_MOVED',path,name)
    # Public route is now registered through a module instead of inlining its bodies.
    for name in ('publicLegacyCheckout','checkoutRoute'):
        # checkoutRoute also names owner route: only move it for salesCheckoutProvisioning
        # (owner route in salesModularStripeAssisted stays in server).
        if name=='checkoutRoute' and path!='tests/salesCheckoutProvisioning.test.ts':continue
        pat=r'(?:const\s+'+name+r'\s*=\s*)(?:server\s*\.\s*match\s*\([\s\S]*?\)\?\.\[0\]\s*\|\|\s*[\x27\x22]{2})'
        t,num=re.subn(pat,"const "+name+" = publicCheckoutRouteSource.slice(publicCheckoutRouteSource.indexOf('\"/api/public/sales-offers/:token/checkout\"'))",t,count=1)
        if num: print('PUBLIC_ASSERT_MOVED',path,name)
    if path.endswith('salesCurrentOperatingSalesGate20260901.regression.test.mjs'):
        t=t.replace("const checkoutStart = server.indexOf('const createOrReuseModularCheckout = async')","const checkoutStart = checkoutCoreSource.indexOf('const createOrReuseModularCheckout = async')")
        t=t.replace("const checkoutRouteStart = server.indexOf('\"/api/owner/sales/offers/:offerId/modular-checkout\"', checkoutStart)","const checkoutRouteStart = checkoutCoreSource.indexOf('return createOrReuseModularCheckout;', checkoutStart)")
        t=t.replace('const checkout = server.slice(checkoutStart, checkoutRouteStart)','const checkout = checkoutCoreSource.slice(checkoutStart, checkoutRouteStart)')
    if path.endswith('salesCustomerFacingModulesOnly.test.mjs'):
        t=t.replace(r'app\.post\(\s*"\/api\/public\/sales-offers\/:token\/accept"',r'registerPublicSalesCheckoutRoutes')
    # These identifiers moved physically to the checkout backend, not to frontend.
    if path.endswith('salesModularStripeAssisted.test.ts'):
        t=t.replace('assert.match(server, /PROPOSAL_TRIAL_SNAPSHOT_MISMATCH/);','assert.match(server, /PROPOSAL_TRIAL_SNAPSHOT_MISMATCH/);')
        # Original tests for server-only ledger/webhooks remain on server.
    if path.endswith('salesCheckoutProvisioning.test.ts'):
        t=t.replace('assert.match(server, /const createOrReuseModularCheckout/)', 'assert.match(checkoutCoreSource, /const createOrReuseModularCheckout/)')
        t=t.replace('assert.match(server, /stripe\\.checkout\\.sessions\\.create/)', 'assert.match(checkoutCoreSource, /stripe\\.checkout\\.sessions\\.create/)')
        t=t.replace('assert.match(server, /operationIdempotencyKey/)', 'assert.match(checkoutCoreSource, /operationIdempotencyKey/)')
        t=t.replace('assert.match(server, /public-modular-checkout:/)', 'assert.match(publicCheckoutRouteSource, /public-modular-checkout:/)')
    if path.endswith('salesPublicCardCheckoutSafety.regression.test.mjs'):
        for pattern in ['const createOrReuseModularCheckout = async','MODULAR_OFFER_ACCEPTANCE_REQUIRED','MODULAR_CHECKOUT_IDEMPOTENCY_CONFLICT','operationIdempotencyKey']:
            t=t.replace('assert.match(server,/'+pattern.replace(' ','\\s*')+'/)', 'assert.match(checkoutCoreSource,/'+pattern.replace(' ','\\s*')+'/)')
        t=t.replace('assert.match(server,/const createOrReuseModularCheckout = async/)', 'assert.match(checkoutCoreSource,/const createOrReuseModularCheckout = async/)')
        t=t.replace('assert.match(server,/MODULAR_OFFER_ACCEPTANCE_REQUIRED/)', 'assert.match(checkoutCoreSource,/MODULAR_OFFER_ACCEPTANCE_REQUIRED/)')
        t=t.replace('assert.match(server,/MODULAR_CHECKOUT_IDEMPOTENCY_CONFLICT/)', 'assert.match(checkoutCoreSource,/MODULAR_CHECKOUT_IDEMPOTENCY_CONFLICT/)')
        t=t.replace('assert.match(server,/operationIdempotencyKey/)', 'assert.match(checkoutCoreSource,/operationIdempotencyKey/)')
        t=t.replace('assert.match(server,/public-modular-checkout:/)', 'assert.match(publicCheckoutRouteSource,/public-modular-checkout:/)')
        t=t.replace('assert.match(server,/stripe\\.checkout\\.sessions\\.create/)', 'assert.match(publicCheckoutRouteSource,/stripe\\.checkout\\.sessions\\.create/)')
    if path.endswith('organizationModuleEntitlements.test.mjs'):
        for pattern in ['trial_period_days','payment_method_collection: \\"always\\"','MODULAR_OFFER_ACCEPTANCE_REQUIRED','moduleSetHash','MODULAR_CHECKOUT_ENVIRONMENT_MISMATCH']:
            t=t.replace('assert.match(server, /'+pattern+'/)', 'assert.match(checkoutCoreSource, /'+pattern+'/)')
        t=t.replace("assert.doesNotMatch(server, /\\.eq\\([\"']environment[\"'],\\s*[\"']test[\"']\\)/);", "assert.doesNotMatch(server, /\\.eq\\([\"']environment[\"'],\\s*[\"']test[\"']\\)/);")
        # No hardcoded environment on either moved surface.
        t+="\nassert.doesNotMatch(checkoutCoreSource,/\\.eq\\([\"']environment[\"'],\\s*[\"']test[\"']\\)/);\n"
        t+="assert.doesNotMatch(publicCheckoutRouteSource,/environment:\\s*[\"']test[\"']/);\n"
    if path.endswith('salesStripeWebhookDbMonotonicGuard.regression.test.mjs') or path.endswith('salesStripeWebhookLeadStateIsolation.regression.test.mjs'):
        t=t.replace('assert.match(server,/MODULAR_CHECKOUT_IDEMPOTENCY_CONFLICT/)', 'assert.match(checkoutCoreSource,/MODULAR_CHECKOUT_IDEMPOTENCY_CONFLICT/)')
        t=t.replace('assert.match(server,/operationIdempotencyKey/)', 'assert.match(checkoutCoreSource,/operationIdempotencyKey/)')
    if t==original: raise RuntimeError('No test change: '+path)
    p.write_text(t,encoding='utf8')

# Parity regression compares exact unmodified bodies to the real staging base,
# guaranteeing SQL/Stripe calls, error codes and action order stay identical.
test= r'''import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const baseline='35e426feb6670b7a26f89cb86bbba4d378425e48';
const before=execFileSync('git',['show',baseline+':server.ts'],{encoding:'utf8'});
const after=readFileSync('server.ts','utf8');
const core=readFileSync('services/salesModularCheckoutCore.ts','utf8');
const routes=readFileSync('services/publicSalesCheckoutRoutes.ts','utf8');
const between=(s,a,b)=>{
  const start=s.indexOf(a);const end=s.indexOf(b,start);
  assert.ok(start>=0&&end>start, 'missing or reordered source boundary');
  return s.slice(start,end);
};
const coreBefore=between(before,'  const createOrReuseModularCheckout = async (','  app.post(\n    "/api/owner/sales/offers/:offerId/modular-checkout",');
const publicBefore=between(before,'  app.post(\n    "/api/public/sales-offers/:token/accept",','  registerPublicSalesPaymentStatusRoute(app,');
const hash=s=>createHash('sha256').update(s).digest('hex');
test('public consent and both checkout implementations are byte-identical to staging baseline',()=>{
  assert.ok(core.includes(coreBefore),'core statements must remain unchanged');
  assert.ok(routes.includes(publicBefore),'public route handlers must remain unchanged');
  assert.equal(hash(coreBefore),'PIN_CORE_HASH');
  assert.equal(hash(publicBefore),'PIN_PUBLIC_HASH');
  assert.doesNotMatch(after,/app\.post\(\s*"\/api\/public\/sales-offers\/:token\/checkout"/);
  assert.doesNotMatch(after,/const createOrReuseModularCheckout = async/);
  assert.match(after,/registerPublicSalesCheckoutRoutes\(\{/);
  assert.match(after,/createModularCheckoutCore\(\{/);
});
test('no new requests, no owner MFA bypass, no client supplied pricing or tenant',()=>{
  assert.match(routes,/publicSalesLeadIpLimiter/);
  assert.match(routes,/req\.body\?\.commercialValuesConsent !== true/);
  assert.match(routes,/req\.body\?\.acceptTerms !== true/);
  assert.match(routes,/MODULAR_CHECKOUT_BROWSER_VALUES_REJECTED/);
  assert.match(routes,/actorUserId = sanitizeString\(\(offer as any\)\.created_by/);
  assert.match(routes,/createOrReuseModularCheckout\(req, res, \{/);
  assert.match(after,/checkPlatformAdmin/);
  assert.match(after,/hasVerifiedMfaSession/);
  assert.match(core,/MODULAR_CHECKOUT_IDEMPOTENCY_CONFLICT/);
  assert.match(core,/MODULAR_CHECKOUT_RECONCILIATION_FAILED/);
  assert.match(core,/customer_email: contractEmail/);
  assert.match(core,/payment_method_collection: "always"/);
  assert.match(core,/checkout\.sessions\.expire\(session\.id\)/);
  assert.match(core,/operationIdempotencyKey/);
});
'''
test=test.replace('PIN_CORE_HASH',hcore).replace('PIN_PUBLIC_HASH',hpub)
(root/'tests/salesCheckoutBackendExtraction.regression.test.mjs').write_text(test,encoding='utf8')
gate_path=root/'scripts/pre-main-gate.mjs'
gate=gate_path.read_text(encoding='utf8')
anchor="  'tests/salesPublicCardCheckoutSafety.regression.test.mjs',"
if gate.count(anchor)!=1: raise RuntimeError('Gate insertion anchor missing')
gate=gate.replace(anchor,anchor+"\n  'tests/salesCheckoutBackendExtraction.regression.test.mjs',\n  'tests/publicSalesCheckoutBackendRoutes.behavior.test.ts',")
gate_path.write_text(gate,encoding='utf8')
print('ITEM07_SOURCE_EXTRACTED','BEFORE',len(source.splitlines()),'AFTER',len(rewritten.splitlines()),'CORE',len(core.splitlines()),'PUBLIC',len(public.splitlines()),'CORE_SHA',hcore,'PUBLIC_SHA',hpub)
