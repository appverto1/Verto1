import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const server=readFileSync('server.ts','utf8');
const hash=s=>createHash('sha256').update(s).digest('hex');
const sections=[
  {file:"services/paidDirectorSessionBootstrap.ts",hash:"098eb3652859b3efe50221ed264ae5010929375816c81dce41d26462c29e53ba",factory:"createPaidDirectorSessionBootstrap"},
  {file:"services/publicSalesPostPaymentReconciliationRoute.ts",hash:"c61c79c0d3c0a31ac64475b014b7a1b34ca5200083b512bd493acd726dd14e16",factory:"registerPublicSalesPostPaymentReconciliationRoute"},
  {file:"services/salesDirectorContractAccess.ts",hash:"d3e346bbc21e96892d7c4c12b30987f2bfb3eb1cf202dcc2de64dc0fdd61882d",factory:"createSalesDirectorContractAccess"},
  {file:"services/salesPaidDirectorAccountProvisioning.ts",hash:"6ace99737a7a298dbd61814017ae7917aefde4a666378a21c2550ff000934fc3",factory:"createSalesPaidDirectorAccountProvisioning"},

];
test('Paid Director modules retain reviewed behavior and are registered once',()=>{
 for(const section of sections){
   const code=readFileSync(section.file,'utf8');
   const begin='  // ITEM10_SOURCE_BEGIN\n',end='  // ITEM10_SOURCE_END\n';
   assert.equal(code.split(begin).length,2,section.file);
   assert.equal(code.split(end).length,2,section.file);
   const original=code.split(begin)[1].split(end)[0];
   assert.equal(hash(original),section.hash,section.file+' reviewed source changed');
   assert.equal(server.split(section.factory+'({').length,2,section.file);
 }
 assert.doesNotMatch(server,/app\.post\(\s*"\/api\/public\/sales-offers\/:token\/prepare-activation"/);
 assert.match(server,/registerPublicSalesPostPaymentReconciliationRoute\(\{/);
});
test('paid Director access never trusts a return URL, frontend email, role or clinic ID',()=>{
 const reconcile=readFileSync('services/publicSalesPostPaymentReconciliationRoute.ts','utf8');
 const contract=readFileSync('services/salesDirectorContractAccess.ts','utf8');
 const bootstrap=readFileSync('services/paidDirectorSessionBootstrap.ts','utf8');
 const provisioning=readFileSync('services/salesPaidDirectorAccountProvisioning.ts','utf8');
 assert.match(reconcile,/resolveSalesPostPaymentContextToken\(token, checkoutSessionId\)/);
 assert.match(reconcile,/stripe\.checkout\.sessions\.retrieve\(checkoutSessionId\)/);
 assert.match(reconcile,/sanitizeString\(metadata\.offerId/);
 assert.match(reconcile,/sanitizeString\(metadata\.leadId/);
 assert.match(reconcile,/reconcileSalesAssistedCheckout\(stripe, session\)/);
 assert.doesNotMatch(reconcile,/checkout\.sessions\.create|subscriptions\.create\(/);
 assert.match(contract,/everyActiveModuleComesFromContract/);
 assert.match(contract,/exactModules/);
 assert.match(bootstrap,/SALES_DIRECTOR_BOOTSTRAP_LINKAGE_CONFLICT/);
 assert.match(bootstrap,/\.eq\("used", false\)/);
 assert.match(provisioning,/SALES_DIRECTOR_EXISTING_ACCOUNT_REVIEW_REQUIRED/);
 assert.match(provisioning,/membershipClinicId === authUser\.id/);
 assert.match(provisioning,/\["director", "coordinator"\]\.includes\(membershipRole\)/);
 assert.match(provisioning,/requireActivationRecord/);
 assert.match(provisioning,/provisioning_status:\s*"completed"/);
 assert.match(provisioning,/verifySalesDirectorContractAccess/);
 assert.doesNotMatch(reconcile+bootstrap+provisioning,/checkout\.sessions\.create|subscriptions\.create\(/);
});
