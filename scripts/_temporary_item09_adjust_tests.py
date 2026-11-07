from pathlib import Path
import re

modules={
 'stripeWebhookEventStateSource':'services/stripeWebhookEventState.ts',
 'stripePaidProcessorSource':'services/salesAssistedCheckoutPaymentProcessor.ts',
 'stripeFinancialSource':'services/salesSubscriptionFinancialReconciliation.ts',
 'stripeScheduleSource':'services/salesModularSubscriptionSchedule.ts',
 'stripeDiscountSource':'services/salesSubscriptionDiscountSync.ts',
 'stripeEntitlementsSource':'services/salesSubscriptionEntitlementTransitions.ts',
}
symbols=['reserveStripeWebhookEvent','markStripeWebhookEventStatus','processSalesAssistedCheckoutCompleted',
         'stripeInvoiceSubscriptionId','persistPlatformSubscriptionFinancialState','persistPlatformBillingInvoiceLedger',
         'syncSalesSubscriptionDiscount','eventTypeSubscriptionIsActive','salesAssistedFlowType',
         'stripeExpandableId','ensureModularSubscriptionSchedule','normalizeModularSchedulePhaseBoundaries',
         'applyModularEntitlementsForOrganization','stripeSubscriptionToEntitlementStatus',
         'reconcileSalesAssistedCheckout']
updated=[]
for path in sorted(Path('tests').glob('*')):
 if path.suffix not in ('.ts','.mjs','.js'):continue
 text=path.read_text(encoding='utf8')
 if "server.ts" not in text or not (any(s in text for s in symbols) or path.name=='salesExactPerPatientBillingP0000.test.ts'):continue
 original=text
 inserts="import {readFileSync as readItem09Source} from 'node:fs';\n"
 inserts+=''.join("const "+name+" = readItem09Source('"+src+"','utf8');\n" for name,src in modules.items())
 # Test source files have existing imports; put declarations only after all imports.
 imports=list(re.finditer(r'^import[^\n]*;\s*$',text,re.M))
 if not imports: raise RuntimeError('Cannot find imports for '+str(path))
 split=imports[-1].end()
 text=text[:split]+"\n"+inserts.replace("import {readFileSync as readItem09Source} from 'node:fs';\n","")+text[split:]
 text="import {readFileSync as readItem09Source} from 'node:fs';\n"+text

 # Old source windows now reside inside their precise new module, with the
 # same original regex invariants. Do not reconstruct fake monolith source.
 anchors={
   'const processSalesAssistedCheckoutCompleted':'stripePaidProcessorSource',
   'async function reserveStripeWebhookEvent':'stripeWebhookEventStateSource',
   'const persistPlatformSubscriptionFinancialState':'stripeFinancialSource',
   'const persistPlatformBillingInvoiceLedger':'stripeFinancialSource',
   'const stripeInvoiceSubscriptionId':'stripeFinancialSource',
   'const ensureModularSubscriptionSchedule':'stripeScheduleSource',
   'const reconcileSalesAssistedCheckout':'stripeScheduleSource',
   'const stripeExpandableId':'stripeScheduleSource',
   'const normalizeModularSchedulePhaseBoundaries':'stripeScheduleSource',
   'const syncSalesSubscriptionDiscount':'stripeDiscountSource',
   'const salesAssistedFlowType':'stripeFinancialSource',
   'const stripeSubscriptionToEntitlementStatus':'stripeEntitlementsSource',
   'const applyModularEntitlementsForOrganization':'stripeEntitlementsSource',
 }
 for anchor,dest in anchors.items():
   pattern=r'\bserver\.match\(\s*(?=/(?:'+re.escape(anchor)+'))'
   text=re.sub(pattern,dest+'.match(',text)
 # For literal regexes with multiline parenthesized capture we need only
 # change which source is evaluated, not weaken the pattern itself.
 if 'const processSalesAssistedCheckoutCompleted' in text:
   # The trailing declaration originally just delimited the paid function.
   text=text.replace('const stripeInvoiceSubscriptionId/', '// ITEM09_SOURCE_END/')
   text=text.replace('const processSalesAssistedStripeEvent = async/', '// ITEM09_SOURCE_END/')
 if 'const preparePaidDirectorSessionBootstrap' in text:
   text=text.replace('const processSalesAssistedCheckoutCompleted/', 'createSalesAssistedCheckoutPaymentProcessor/')
 if 'const SALES_ACTIVATION_EMAIL_CLAIM_TTL_MS' in text:
   text=text.replace('const processSalesAssistedCheckoutCompleted/', 'createSalesAssistedCheckoutPaymentProcessor/')
 if 'const reconcileSalesAssistedCheckout' in text:
   text=text.replace('const isSalesAssistedStripeEvent = async/', '// ITEM09_SOURCE_END/')
 # Source before subscription discount and phase schedule was used only
 # as an end-delimiter for the existing pure function under test.
 if 'const currentPeriodHelperSource' in text:
   text=text.replace('const syncSalesSubscriptionDiscount = async \\(/',
                     'const \\{ syncSalesSubscriptionDiscount, eventTypeSubscriptionIsActive \\} = createSalesSubscriptionDiscountSync\\(/')
   text=text.replace("const syncSalesSubscriptionDiscount = async \\($/", "const \\{ syncSalesSubscriptionDiscount, eventTypeSubscriptionIsActive \\} = createSalesSubscriptionDiscountSync\\($/")
 # The code for normalization is extracted alongside the schedule, intact.
 text=re.sub(r'\bserver\.match\(\s*(?=/const normalizeModularSchedulePhaseBoundaries)', 'stripeScheduleSource.match(', text)
 if 'const serverWithoutCurrentPeriodResolver' in text:
   # This original test asserts no direct period reads remain in the monolith.
   # Add a cross-module guard rather than removing that assertion.
   text+="\nassert.doesNotMatch(stripeFinancialSource.replace(/const stripeInvoicePeriodBounds[\\s\\S]*?\\n  \\};/,''),/subscription as any\\)\\?\\.current_period_end/);\n"
 if "server.split('if (!paymentConfirmed) {')" in text:
   text=text.replace("server.split('if (!paymentConfirmed) {')","stripePaidProcessorSource.split('if (!paymentConfirmed) {')")

 # Direct assertions on definitions or strings moved to another module.
 for needle,dest in [
   ('async function reserveStripeWebhookEvent','stripeWebhookEventStateSource'),
   ('async function markStripeWebhookEventStatus','stripeWebhookEventStateSource'),
   ('confirm_sales_assisted_checkout_payment','stripePaidProcessorSource'),
   ('processSalesAssistedCheckoutCompleted','stripePaidProcessorSource'),
   ('MODULAR_CHECKOUT_ENVIRONMENT_MISMATCH','stripeScheduleSource'),
   ('MODULAR_SCHEDULE_METADATA_INVALID','stripeScheduleSource'),
   ('subscriptionSchedules.create','stripeScheduleSource'),
   ('subscriptionSchedules.update','stripeScheduleSource'),
   ('apply_sales_offer_module_entitlements_v2','stripeEntitlementsSource'),
 ]:
   text=text.replace('assert.match(server, /'+needle+'/', 'assert.match('+dest+', /'+needle+'/')
   text=text.replace('assert.match(server,/'+needle+'/', 'assert.match('+dest+',/'+needle+'/')
 # Exact source test windows in cases without a .match(...) call.
 if path.name=='salesStripeWebhookLeadStateIsolation.regression.test.mjs':
   text=text.replace('const checkout = server.match','const checkout = stripePaidProcessorSource.match')
 if path.name=='salesStripeScheduleLinkHotfix20260901.regression.test.mjs':
   text=text.replace('const scheduleBlock = server.match','const scheduleBlock = stripeScheduleSource.match')
   text=text.replace('const ensureBlock = server.match','const ensureBlock = stripeScheduleSource.match')
 if path.name=='salesStripeModularScheduleBoundaryP0_20260902.regression.test.mjs':
   text=text.replace('const helperSource = server.match','const helperSource = stripeScheduleSource.match')
   text=text.replace('const ensureBlock = server.match','const ensureBlock = stripeScheduleSource.match')
   text=text.replace('const reconcileBlock = server.match','const reconcileBlock = stripeScheduleSource.match')
   text=text.replace('const reserveBlock = server.match','const reserveBlock = stripeWebhookEventStateSource.match')
   text=text.replace('const processPaidBlock = server.match','const processPaidBlock = stripePaidProcessorSource.match')
   text=text.replace('const discountSyncBlock = server.match','const discountSyncBlock = stripeDiscountSource.match')
   text=text.replace('const financialStateBlock = server.match','const financialStateBlock = stripeFinancialSource.match')
 if path.name=='salesPaidDirectorActivationEmailRecovery20260831.regression.test.mjs':
   text=text.replace('const bootstrap = server.match','const bootstrap = server.match')
 if path.name=='salesContractIdentity.test.ts':
   text=text.replace('const checkoutProcessor = server.match', 'const checkoutProcessor = stripePaidProcessorSource.match')
 if path.name=='salesStripeWebhookDbMonotonicGuard.regression.test.mjs':
   text=text.replace('assert.match(server,/if \\(sanitizeString\\(existing\\.status, 40\\) ===', 'assert.match(stripeWebhookEventStateSource,/if \\(sanitizeString\\(existing\\.status, 40\\) ===')
 # Preserve frozen-seat, boleto and webhook dedupe assertions against the new
 # runtime module containing each unmodified expression.
 if path.name=='salesBoletoPaymentPendingSafety.regression.test.mjs':
   for expression in [
     'paymentStatus === \\"paid\\" \\\\|\\\\|',
     'paymentStatus === \\"no_payment_required\\"',
     'if \\\\(!paymentConfirmed\\\\) \\\\{',
     'activationPrepared: false',
   ]:
     text=text.replace('assert.match(server,/'+expression+'/);',
                       'assert.match(stripePaidProcessorSource,/'+expression+'/);')
 if path.name=='salesExactPerPatientBillingP0000.test.ts':
   text=text.replace("const checkoutBackend = server + '\\\\n' + checkoutCoreSource;",
                     "const checkoutBackend = server + '\\\\n' + checkoutCoreSource + '\\\\n' + stripeScheduleSource + '\\\\n' + stripePaidProcessorSource;")
 for pathName in ['salesStripeWebhookDbMonotonicGuard.regression.test.mjs','salesStripeWebhookLeadStateIsolation.regression.test.mjs']:
   if path.name==pathName:
     text=text.replace("assert.match(server,/\\\\.from\\\\('stripe_webhook_events'\\\\)/);",
                       "assert.match(stripeWebhookEventStateSource,/\\\\.from\\\\('stripe_webhook_events'\\\\)/);")
     text=text.replace("assert.match(server,/if \\\\(sanitizeString\\\\(existing\\\\.status, 40\\\\) === 'processed'\\\\) return false/);",
                       "assert.match(stripeWebhookEventStateSource,/if \\\\(sanitizeString\\\\(existing\\\\.status, 40\\\\) === 'processed'\\\\) return false/);")
     text=text.replace('assert.match(server,/async function reserveStripeWebhookEvent/);',
                       'assert.match(stripeWebhookEventStateSource,/async function reserveStripeWebhookEvent/);')
 # Exact target lines retain the original expression, changing only the
 # file they inspect. This is intentionally stricter than blanket replacements.
 lines=text.splitlines(keepends=True)
 moved=[]
 for idx,line in enumerate(lines):
   if 'assert.match(server,' in line:
     if path.name=='salesBoletoPaymentPendingSafety.regression.test.mjs' and (
       'paymentStatus ===' in line or 'activationPrepared: false' in line
       or 'if \\(!paymentConfirmed\\)' in line
     ):
       lines[idx]=line.replace('assert.match(server,','assert.match(stripePaidProcessorSource,',1)
       moved.append(idx)
     if path.name in (
       'salesStripeWebhookDbMonotonicGuard.regression.test.mjs',
       'salesStripeWebhookLeadStateIsolation.regression.test.mjs'
     ) and ('stripe_webhook_events' in line or 'existing' in line and "'processed'" in line):
       lines[idx]=line.replace('assert.match(server,','assert.match(stripeWebhookEventStateSource,',1)
       moved.append(idx)
   if path.name=='salesExactPerPatientBillingP0000.test.ts' and line.lstrip().startswith('const checkoutBackend = server +'):
     lines[idx]=line.rstrip().removesuffix(';')+" + '\\n' + stripeScheduleSource + '\\n' + stripePaidProcessorSource;\n"
     moved.append(idx)
 if moved:
   text=''.join(lines)
   print('ITEM09_TEST_SOURCE_RELOCATION',path.name,len(moved))
 if path.name=='salesExactPerPatientBillingP0000.test.ts' and not moved:
   raise RuntimeError('Exact per-patient checkout source aggregation not found')
 if text!=original:
   path.write_text(text,encoding='utf8')
   updated.append(str(path))
print('ITEM09_STATIC_ASSERTIONS_UPDATED',len(updated),updated)
