from pathlib import Path
import re,hashlib,json
root=Path('.'); server=root/'server.ts'
src=server.read_text('utf8'); lines=src.splitlines()
expected='6888311ca8732320aff274cd75971e9866c6886047cb1a0c93090c2100543064'
if len(lines)!=88455 or hashlib.sha256('\n'.join(lines).encode()).hexdigest()!=expected:
    raise RuntimeError('Unrecognized staging source. Refusing to modify paid Director. lines='+str(len(lines)))
groups=[
 dict(name='bootstrap',target='services/paidDirectorSessionBootstrap.ts',
      factory='createPaidDirectorSessionBootstrap',
      start='  const preparePaidDirectorSessionBootstrap = async (',
      end='  const {\n    isSalesAssistedStripeEvent,',
      exports=['preparePaidDirectorSessionBootstrap']),
 dict(name='reconciliation',target='services/publicSalesPostPaymentReconciliationRoute.ts',
      factory='registerPublicSalesPostPaymentReconciliationRoute',
      start='  app.post(\n    "/api/public/sales-offers/:token/prepare-activation",',
      end='  registerPublicSalesDirectorSessionRoute(app, {',
      exports=[]),
 dict(name='contract',target='services/salesDirectorContractAccess.ts',
      factory='createSalesDirectorContractAccess',
      start='  const verifySalesDirectorContractAccess = async (',
      end='  const resolveAcceptedModularCapacityContract = (',
      exports=['verifySalesDirectorContractAccess']),
 dict(name='provisioning',target='services/salesPaidDirectorAccountProvisioning.ts',
      factory='createSalesPaidDirectorAccountProvisioning',
      start='  async function provisionPaidSalesDirectorAccount(params: {',
      end='  const mutationActionLabel',
      exports=['provisionPaidSalesDirectorAccount','finalizeSalesActivationForUser'])
]
for g in groups:
    if src.count(g['start'])!=1:raise RuntimeError('Missing/ambiguous beginning '+g['name'])
    if src.count(g['end'])!=1:raise RuntimeError('Missing/ambiguous ending '+g['name'])
    a=src.index(g['start']);b=src.index(g['end'],a)
    if b<a:raise RuntimeError('Invalid boundary '+g['name'])
    g.update(a=a,b=b,original=src[a:b])
    for name in g['exports']:
        if not re.search(r'\b(?:const|function)\s+'+name+r'\s*(?:=|\()',g['original']):
            raise RuntimeError('Missing expected function '+name)
    g['sha']=hashlib.sha256(g['original'].encode()).hexdigest()
    module=("import type Stripe from 'stripe';\n"
            "// Item 10: statements preserved exactly from paid-Director backend in staging.\n"
            f"export function {g['factory']}(deps: Record<string, any>) {{\n"
            f"  // ITEM10_{g['name']}_DEPS\n"
            "  // ITEM10_SOURCE_BEGIN\n"+g['original']+"  // ITEM10_SOURCE_END\n")
    if g['name']=='reconciliation':
        module+="}\n"
        g['replacement']="  registerPublicSalesPostPaymentReconciliationRoute({\n    // ITEM10_reconciliation_INJECT\n  });\n\n"
    else:
        module+="  return { "+', '.join(g['exports'])+" };\n}\n"
        g['replacement']=f"  const {{ {', '.join(g['exports'])} }} = {g['factory']}({{\n    // ITEM10_{g['name']}_INJECT\n  }});\n\n"
    p=root/g['target']
    if p.exists():raise RuntimeError('Refusing to overwrite: '+str(p))
    p.write_text(module,'utf8')
    print('ITEM10_GROUP',g['name'],'ORIGINAL_LINES',len(g['original'].splitlines()),'SHA',g['sha'])
out=src
for g in sorted(groups,key=lambda g:g['a'],reverse=True):
    assert out[g['a']:g['b']]==g['original']
    out=out[:g['a']]+g['replacement']+out[g['b']:]
imports=''.join(f"import {{ {g['factory']} }} from './{g['target'][:-3]}';\n" for g in groups)
out=imports+out
server.write_text(out,'utf8')
print('ITEM10_SERVER_LINE_DELTA',len(lines)-len(out.splitlines()),'BEFORE',len(lines),'AFTER',len(out.splitlines()))

test=String.raw if False else ''
test="""import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const server=readFileSync('server.ts','utf8');
const hash=s=>createHash('sha256').update(s).digest('hex');
const sections=[
"""
for g in groups:
    test+=f"  {{file:{json.dumps(g['target'])},hash:{json.dumps(g['sha'])},factory:{json.dumps(g['factory'])}}},\n"
test+="""
];
test('Item 10 all four backend responsibilities retain source-exact statements and are registered once',()=>{
 for(const section of sections){
   const code=readFileSync(section.file,'utf8');
   const begin='  // ITEM10_SOURCE_BEGIN\\n',end='  // ITEM10_SOURCE_END\\n';
   assert.equal(code.split(begin).length,2,section.file);
   assert.equal(code.split(end).length,2,section.file);
   const original=code.split(begin)[1].split(end)[0];
   assert.equal(hash(original),section.hash,section.file+' source changed during extraction');
   assert.equal(server.split(section.factory+'({').length,2,section.file);
 }
 assert.doesNotMatch(server,/app\\.post\\(\\s*"\\/api\\/public\\/sales-offers\\/:token\\/prepare-activation"/);
 assert.match(server,/registerPublicSalesPostPaymentReconciliationRoute\\(\\{/);
});
test('paid Director access never trusts a return URL, frontend email, role or clinic ID',()=>{
 const reconcile=readFileSync('services/publicSalesPostPaymentReconciliationRoute.ts','utf8');
 const contract=readFileSync('services/salesDirectorContractAccess.ts','utf8');
 const bootstrap=readFileSync('services/paidDirectorSessionBootstrap.ts','utf8');
 const provisioning=readFileSync('services/salesPaidDirectorAccountProvisioning.ts','utf8');
 assert.match(reconcile,/resolveSalesPostPaymentContextToken\\(token, checkoutSessionId\\)/);
 assert.match(reconcile,/stripe\\.checkout\\.sessions\\.retrieve\\(checkoutSessionId\\)/);
 assert.match(reconcile,/sanitizeString\\(metadata\\.offerId/);
 assert.match(reconcile,/sanitizeString\\(metadata\\.leadId/);
 assert.match(reconcile,/reconcileSalesAssistedCheckout\\(stripe, session\\)/);
 assert.doesNotMatch(reconcile,/checkout\\.sessions\\.create|subscriptions\\.create\\(/);
 assert.match(contract,/everyActiveModuleComesFromContract/);
 assert.match(contract,/exactModules/);
 assert.match(bootstrap,/SALES_DIRECTOR_BOOTSTRAP_LINKAGE_CONFLICT/);
 assert.match(bootstrap,/\\.eq\\("used", false\\)/);
 assert.match(provisioning,/SALES_DIRECTOR_EXISTING_ACCOUNT_REVIEW_REQUIRED/);
 assert.match(provisioning,/membershipClinicId === authUser\\.id/);
 assert.match(provisioning,/\\["director", "coordinator"\\]\\.includes\\(membershipRole\\)/);
 assert.match(provisioning,/requireActivationRecord/);
 assert.match(provisioning,/provisioning_status:\\s*"completed"/);
 assert.match(provisioning,/verifySalesDirectorContractAccess/);
 assert.doesNotMatch(reconcile+bootstrap+provisioning,/checkout\\.sessions\\.create|subscriptions\\.create\\(/);
});
"""
(root/'tests/salesPaidDirectorBackendExtraction.regression.test.mjs').write_text(test,'utf8')
gate=root/'scripts/pre-main-gate.mjs'
g=gate.read_text('utf8')
needle="  'tests/salesPaidDirectorDirectOnboardingTask10.regression.test.mjs',"
if g.count(needle)!=1:raise RuntimeError('Missing pre-main test insertion point')
g=g.replace(needle,needle+"\n  'tests/salesPaidDirectorBackendExtraction.regression.test.mjs',\n  'tests/publicSalesPostPaymentReconciliationRoute.behavior.test.ts',")
gate.write_text(g,'utf8')
