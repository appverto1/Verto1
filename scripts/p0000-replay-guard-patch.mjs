import fs from 'node:fs';
const file='server.ts';
let source=fs.readFileSync(file,'utf8');
const needle='      throw new Error("MODULAR_SUBSCRIPTION_METADATA_MISMATCH");\n    }\n\n    const currentByItem = new Map<';
const replacement=[
'      throw new Error("MODULAR_SUBSCRIPTION_METADATA_MISMATCH");',
'    }',
'',
'    // P0000: recurring invoice webhooks must not reset the live seat quantity.',
'    if (sanitizeString(subscriptionMetadata.billingModel, 100) === "modular_exact_per_patient_v1") {',
'      const { data: activeExactContract, error: exactContractError } = await supabase',
'        .from("organization_billing_contracts")',
'        .select("id,organization_id,sales_offer_id,stripe_subscription_id,stripe_schedule_id,status,source_snapshot")',
'        .eq("sales_offer_id", sanitizeString(link.offer_id, 120))',
'        .eq("stripe_subscription_id", subscriptionId)',
'        .eq("status", "active")',
'        .maybeSingle();',
'      if (exactContractError) throw exactContractError;',
'      if (activeExactContract) {',
'        if (',
'          activeExactContract.source_snapshot?.billingModelVersion !== "modular_exact_per_patient_v1" ||',
'          sanitizeString(activeExactContract.sales_offer_id, 120) !== sanitizeString(link.offer_id, 120)',
'        ) throw new Error("MODULAR_EXACT_CONTRACT_REPLAY_SCOPE_INVALID");',
'        const liveScheduleId = stripeExpandableId((subscription as any)?.schedule, 200);',
'        const acceptedScheduleId = sanitizeString(activeExactContract.stripe_schedule_id, 200);',
'        const linkScheduleId = sanitizeString(link.stripe_schedule_id, 200);',
'        if (',
'          (acceptedScheduleId && liveScheduleId && acceptedScheduleId !== liveScheduleId) ||',
'          (linkScheduleId && liveScheduleId && linkScheduleId !== liveScheduleId)',
'        ) throw new Error("MODULAR_EXACT_SCHEDULE_REPLAY_LINKAGE_CONFLICT");',
'        const scheduleId = liveScheduleId || acceptedScheduleId || linkScheduleId;',
'        if (!scheduleId) throw new Error("MODULAR_EXACT_SCHEDULE_REPLAY_MISSING");',
'        const existingSchedule = await stripe.subscriptionSchedules.retrieve(scheduleId);',
'        if (',
'          stripeExpandableId((existingSchedule as any)?.subscription, 200) !== subscriptionId ||',
'          Boolean((existingSchedule as any)?.livemode) !== (stripeEnvironment === "live")',
'        ) throw new Error("MODULAR_EXACT_SCHEDULE_REPLAY_SCOPE_INVALID");',
'        return scheduleId;',
'      }',
'    }',
'',
'    const currentByItem = new Map<'
].join('\n');
const hits=source.split(needle).length-1;
if(hits!==1)throw new Error('P0000 replay patch drift '+hits);
source=source.replace(needle,replacement);
fs.writeFileSync(file,source);
console.log('P0000 webhook replay guard patched');
