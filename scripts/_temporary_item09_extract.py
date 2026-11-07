from pathlib import Path
import hashlib,re,json
ROOT=Path(".")
p=ROOT/"server.ts"
source=p.read_text(encoding="utf8")
BASE_LINES=len(source.splitlines())
expected_sha="16ab15b95aa0f6f57e3bcb4b574f3881c2e0c697b48730b5a94e9985af9ed246"
if hashlib.sha256(source.encode()).hexdigest()!=expected_sha: raise RuntimeError("Staging source changed; refusing blind Stripe extraction")

groups=[
  dict(id="eventState",path="services/stripeWebhookEventState.ts",factory="createStripeWebhookEventState",
       start="async function reserveStripeWebhookEvent(",end=None,
       names=["reserveStripeWebhookEvent","markStripeWebhookEventStatus"]),
  dict(id="discount",path="services/salesSubscriptionDiscountSync.ts",factory="createSalesSubscriptionDiscountSync",
       start="  const syncSalesSubscriptionDiscount = async (",
       end="  const SALES_ACTIVATION_EMAIL_CLAIM_TTL_MS = ",
       names=["syncSalesSubscriptionDiscount","eventTypeSubscriptionIsActive"]),
  dict(id="paid",path="services/salesAssistedCheckoutPaymentProcessor.ts",factory="createSalesAssistedCheckoutPaymentProcessor",
       start="  const processSalesAssistedCheckoutCompleted = async (",
       end="  const stripeInvoiceSubscriptionId = ",
       names=["processSalesAssistedCheckoutCompleted"]),
  dict(id="financial",path="services/salesSubscriptionFinancialReconciliation.ts",factory="createSalesSubscriptionFinancialReconciliation",
       start="  const stripeInvoiceSubscriptionId = ",
       end="  const stripeExpandableId = ",
       names=["stripeInvoiceSubscriptionId","stripeTimestampToIso","stripeInvoicePeriodBounds","persistPlatformSubscriptionFinancialState","persistPlatformBillingInvoiceLedger","salesAssistedFlowType"]),
  dict(id="schedule",path="services/salesModularSubscriptionSchedule.ts",factory="createSalesModularSubscriptionSchedule",
       start="  const stripeExpandableId = ",
       end="  const {\n    isSalesAssistedStripeEvent,",
       names=["stripeExpandableId","sanitizeStripeScheduleMetadata","preserveStripeSchedulePhaseForUpdate","buildStripeScheduleContinuationPhase","normalizeModularSchedulePhaseBoundaries","ensureModularSubscriptionSchedule","reconcileSalesAssistedCheckout"]),
  dict(id="entitlements",path="services/salesSubscriptionEntitlementTransitions.ts",factory="createSalesSubscriptionEntitlementTransitions",
       start="  const stripeSubscriptionToEntitlementStatus = (",
       end="  const verifySalesDirectorContractAccess = async (",
       names=["stripeSubscriptionToEntitlementStatus","applyModularEntitlementsForOrganization"]),
]
# Extract only the audited intervals; never sweep all functions or additional business code.
for g in groups:
    if source.count(g["start"])!=1: raise RuntimeError("Missing/duplicated source anchor: "+g["start"])
    st=source.index(g["start"])
    if g["end"] is None:
        t=source.index("async function markStripeWebhookEventStatus(",st)
        ed=source.index("\n}\n",t)+3
    else:
        if source.count(g["end"])!=1: raise RuntimeError("Missing/duplicated boundary: "+g["end"])
        ed=source.index(g["end"],st)
    g.update(st=st,ed=ed,original=source[st:ed])
    for n in g["names"]:
        if len(re.findall(r"\b(?:const|function)\s+"+re.escape(n)+r"\s*(?:=|\()",g["original"]))!=1:
            raise RuntimeError("Group "+g["id"]+" must have exactly one declaration for "+n)
    g["hash"]=hashlib.sha256(g["original"].encode()).hexdigest()
    out=ROOT/g["path"]
    if out.exists():raise RuntimeError("Refusing to overwrite service "+str(out))
    out.parent.mkdir(parents=True,exist_ok=True)
    # Original financial source is embedded byte-identically between markers.
    module=("import type Stripe from 'stripe';\n"
            "import crypto from 'crypto';\n"
            f"// Item 09: Stripe {g['id']}; original audited statements retained unchanged.\n"
            f"export const {g['factory']} = (deps: Record<string, any>) => {{\n"
            f"  // ITEM09_{g['id']}_DEPS\n"
            "  // ITEM09_SOURCE_BEGIN\n"
            +g["original"]+
            "  // ITEM09_SOURCE_END\n"
            "  return { "+", ".join(g["names"])+" };\n"
            "};\n")
    out.write_text(module,encoding="utf8")
    g["replace"]=("  " if g["st"]>0 and source[g["st"]-1]!="\n" else "")+(
      f"const {{ {', '.join(g['names'])} }} = {g['factory']}({{\n"
      f"  // ITEM09_{g['id']}_INJECT\n"
      "});\n\n"
    ) if g["id"]=="eventState" else (
      f"  const {{ {', '.join(g['names'])} }} = {g['factory']}({{\n"
      f"    // ITEM09_{g['id']}_INJECT\n"
      "  });\n\n"
    )

# Reverse index order guarantees other Stripe, clinical and commercial code is untouched.
revised=source
for g in sorted(groups,key=lambda x:x["st"],reverse=True):
    assert revised[g["st"]:g["ed"]]==g["original"]
    revised=revised[:g["st"]]+g["replace"]+revised[g["ed"]:]
imports="".join(f"import {{ {g['factory']} }} from './{g['path'][:-3]}';\n" for g in groups)
revised=imports+revised
p.write_text(revised,encoding="utf8")
print("ITEM09_EXTRACTION_BEFORE_AFTER",BASE_LINES,len(revised.splitlines()),"DELTA",BASE_LINES-len(revised.splitlines()))
for g in groups:print("ITEM09_EXTRACTED_GROUP",g["id"],len(g["original"].splitlines()),g["hash"],g["path"])

# Defense-in-depth static parity verifies the actual service source (not a test copy).
test="""import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const server=readFileSync('server.ts','utf8');
const digest=x=>createHash('sha256').update(x).digest('hex');
const parts=[
"""
for g in groups:
    test+=f"  {{path:'{g['path']}',hash:'{g['hash']}',factory:'{g['factory']}',names:{json.dumps(g['names'])}}},\n"
test+="""
];
test('all six Stripe groups retain exact audited source content and run from module factories',()=>{
 for(const section of parts){
   const content=readFileSync(section.path,'utf8');
   const a='  // ITEM09_SOURCE_BEGIN\\n',b='  // ITEM09_SOURCE_END\\n';
   assert.equal(content.split(a).length,2,section.path);
   assert.equal(content.split(b).length,2,section.path);
   const original=content.split(a)[1].split(b)[0];
   assert.equal(digest(original),section.hash,section.path+' original block must remain byte identical');
   assert.match(server,new RegExp(section.factory+'\\\\(\\\\{'),section.path+' factory must be wired in server');
   for(const name of section.names){
     assert.match(original,new RegExp('\\\\b'+name+'\\\\b'));
     assert.doesNotMatch(server,new RegExp('(?:async function|const)\\\\s+'+name+'\\\\s*(?:=|\\\\()'),name+' cannot be duplicated');
   }
 }
});
test('Stripe webhook registrations retain their precise order, raw signature and idempotent reserve',()=>{
 const legacy=server.indexOf('registerLegacySalesActivationStripeWebhookRoute(app, {');
 const canonical=server.indexOf('registerStripeCanonicalWebhookRoute(app, {');
 const handlers=server.indexOf('createSalesAssistedStripeEventHandlers({');
 const states=server.indexOf('createStripeWebhookEventState({');
 assert.ok(states>=0&&handlers>states&&legacy>handlers&&canonical>legacy);
 assert.match(server,/reserveStripeWebhookEvent/);
 assert.match(server,/markStripeWebhookEventStatus/);
 assert.match(readFileSync('services/legacySalesActivationStripeWebhookRoute.ts','utf8'),/express\\.raw\\(\\{ type: "application\\/json" \\}\\)/);
 assert.match(readFileSync('services/stripeCanonicalWebhookRoute.ts','utf8'),/stripe\\.webhooks\\.constructEvent/);
 const state=readFileSync('services/stripeWebhookEventState.ts','utf8');
 assert.match(state,/\\.insert\\(\\[\\{/);
 assert.match(state,/code !== '23505'/);
 assert.match(state,/\\.eq\\('status', sanitizeString\\(existing\\.status, 40\\)\\)/);
 assert.match(state,/\\.lt\\('processed_at', staleBefore\\)/);
});
test('subscription schedule and paid-state authority stay in backend without new payment creation',()=>{
 const mod=readFileSync('services/salesModularSubscriptionSchedule.ts','utf8');
 const paid=readFileSync('services/salesAssistedCheckoutPaymentProcessor.ts','utf8');
 const entitlement=readFileSync('services/salesSubscriptionEntitlementTransitions.ts','utf8');
 assert.match(mod,/MODULAR_CHECKOUT_ENVIRONMENT_MISMATCH/);
 assert.match(mod,/MODULAR_SUBSCRIPTION_LINKAGE_CONFLICT/);
 assert.match(mod,/subscriptionSchedules\\.create/);
 assert.match(mod,/subscriptionSchedules\\.update/);
 assert.match(mod,/modular-schedule-configure:/);
 assert.doesNotMatch(mod,/checkout\\.sessions\\.create|subscriptions\\.create\\(/);
 assert.match(paid,/confirm_sales_assisted_checkout_payment/);
 assert.match(paid,/\\.neq\\("status", "converted"\\)/);
 assert.match(paid,/payment-completed:\\$\\{session\\.id\\}/);
 assert.match(entitlement,/apply_sales_offer_module_entitlements_v2/);
});
"""
(ROOT/"tests/stripeWebhookCoreExtraction.regression.test.mjs").write_text(test,encoding="utf8")
gate=ROOT/"scripts/pre-main-gate.mjs"
g=gate.read_text(encoding="utf8")
marker="  'tests/stripeCanonicalWebhookRoute.test.ts',"
if g.count(marker)!=1: raise RuntimeError("Critical test gate marker missing")
g=g.replace(marker,marker+"\n  'tests/stripeWebhookCoreExtraction.regression.test.mjs',\n  'tests/stripeWebhookEventState.behavior.test.ts',\n  'tests/salesModularSubscriptionSchedule.behavior.test.ts',")
gate.write_text(g,encoding="utf8")
print("ITEM09_EXTRACTED_GROUPS",len(groups))
