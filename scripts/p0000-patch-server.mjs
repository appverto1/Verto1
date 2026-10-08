import fs from 'node:fs';
const file='server.ts';
let source=fs.readFileSync(file,'utf8');
const original=source;
const replace=(needle,replacement,name)=>{
  const hits=source.split(needle).length-1;
  if(hits!==1)throw new Error('P0000 patch drift '+name+' ('+hits+')');
  source=source.replace(needle,replacement);
};
replace(
  '    commercialCapacityBasis:\n      sanitizeString(source.commercialCapacityBasis, 40) === "current_patients"\n        ? "current_patients"\n        : "projected_demand",',
  '    commercialCapacityBasis:\n      sanitizeString(source.commercialCapacityBasis, 40) === "current_patients"\n        ? "current_patients"\n        : "projected_demand",\n    exactPerPatientBilling: source.exactPerPatientBilling === true,',
  'input sanitizer'
);
replace(
  '        const checkoutPlan = buildFrozenStripeCheckoutPlan({\n          currency: sanitizeString(offer.currency, 12) || "brl",\n          phases: checkoutPhases,\n          capacity,\n          effectiveAt: new Date().toISOString(),\n        });',
  '        const exactPerPatientBilling = frozenResults?.input?.exactPerPatientBilling === true;\n        const acceptedPatientQuantity = Number(frozenResults?.input?.patientQuantity);\n        const checkoutPlan = buildFrozenStripeCheckoutPlan({\n          currency: sanitizeString(offer.currency, 12) || "brl",\n          phases: checkoutPhases,\n          capacity,\n          effectiveAt: new Date().toISOString(),\n          exactPerPatientBilling,\n          patientQuantity: acceptedPatientQuantity,\n        });',
  'checkout planner'
);
replace(
  '            line_items: checkoutPlan.initialLineItems.map((line) => ({\n              quantity: 1,',
  '            line_items: checkoutPlan.initialLineItems.map((line) => ({\n              quantity: Number(line.quantity || 1),',
  'checkout quantity'
);
replace(
  '            quantity: 1,\n          }))),\n          metadata: {\n            flowType: "sales_modular_assisted",',
  '            quantity: Number(item.quantity || 1),\n          }))),\n          metadata: {\n            flowType: "sales_modular_assisted",',
  'future schedule quantity'
);
replace(
  '{ priceId: string; productId: string; amount: number }',
  '{ priceId: string; productId: string; amount: number; quantity: number }',
  'current map'
);
replace(
  '          amount: Number(subscriptionItem.price.unit_amount || 0),\n        });',
  '          amount: Number(subscriptionItem.price.unit_amount || 0),\n          quantity: Number(subscriptionItem.quantity || 1),\n        });',
  'current quantity'
);
replace(
  '      if (!current || current.amount !== expectedAmount) {',
  '      if (!current || current.amount !== expectedAmount || current.quantity !== Number(item?.quantity || 1)) {',
  'verify Stripe quantities'
);
replace(
  '        const stripeMetadata: Record<string, string> = {\n          flowType: "sales_modular_assisted",',
  '        const stripeMetadata: Record<string, string> = {\n          flowType: "sales_modular_assisted",\n          ...(exactPerPatientBilling ? { billingModel: "modular_exact_per_patient_v1" } : {}),',
  'Stripe subscription metadata'
);
replace(
  '        blockPricingBasis: sanitizeString(capacity.blockPricingBasis, 80) || "catalog_fixed",',
  [
    '        blockPricingBasis: sanitizeString(capacity.blockPricingBasis, 80) || "catalog_fixed",',
    '        billingModelVersion: frozenResults?.input?.exactPerPatientBilling === true',
    '          ? "modular_exact_per_patient_v1"',
    '          : "modular_capacity_v1",',
    '        acceptedPatientQuantity: frozenResults?.input?.exactPerPatientBilling === true',
    '          ? Number(frozenResults.input.patientQuantity)',
    '          : null,',
    '        exactRecurringModuleKeys: frozenResults?.input?.exactPerPatientBilling === true',
    '          ? (Array.isArray(frozenResults.commercialPhases?.[0]?.lines)',
    '              ? frozenResults.commercialPhases[0].lines',
    '              : []).filter((line: any) =>',
    '                line?.billingInterval === "monthly" &&',
    '                !isSalesInternalCommercialItemKey(line?.itemKey)',
    '              ).map((line: any) => sanitizeString(line.itemKey, 80)).filter(Boolean)',
    '          : [],'
  ].join('\n'),
  'frozen billing contract'
);
if(source===original)throw new Error('empty patch');
fs.writeFileSync(file,source);
console.log('P0000 server.ts patch verified');
