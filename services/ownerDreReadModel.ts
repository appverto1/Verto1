import { createClient } from '@supabase/supabase-js';
import { calculateOwnerDreCosts } from '../src/utils/ownerDreCostCalculator.mjs';

// Single backend-only client. Never expose or serialize its credentials to the browser.
let client: any = null;
const db = () => {
  if(client) return client;
  const url=process.env.SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const deployment=String(process.env.VERTO_DEPLOYMENT_ENV||'').toLowerCase();
  if(!url||!secret||!['staging','production'].includes(deployment))
    throw new Error('Owner DRE backend configuration missing');
  client=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{headers:{'x-verto-deployment-env':deployment}}});
  return client;
};
const monthFrom=(date:string)=>String(date||'').slice(0,7);
const roundMoney=(cents:number)=>Math.round(cents)/100;

// The Stripe ledger is still the ONLY source of realized gross SaaS revenue.
// No simulated direct costs, forecasts or clinic/patient billing flow into this report.
export async function applyOwnerDreCostsToOverview(overview:any):Promise<any>{
  if(!overview || overview.source!=='platform_invoice_ledger')return overview;
  const first=overview.monthly?.[0]?.periodMonth;
  if(!/^\d{4}-\d{2}$/.test(String(first||'')))return {...overview,costRules:[]};
  const api=db();
  const [costsResult,invoicesResult]=await Promise.all([
    api.from('platform_dre_cost_rules')
      .select('id,name,cost_type,category,amount_cents,rate_basis_points,starts_month,ends_month,created_at')
      .order('created_at',{ascending:false}).limit(500),
    api.from('platform_billing_invoice_ledger')
      .select('stripe_invoice_id,organization_id,amount_paid_cents,paid_at')
      .not('paid_at','is',null)
      .gte('paid_at',first+'-01T00:00:00.000Z')
      .gt('amount_paid_cents',0)
      .eq('currency','brl')
      .order('paid_at',{ascending:true}).limit(1000),
  ]);
  if(costsResult.error)throw costsResult.error;
  if(invoicesResult.error)throw invoicesResult.error;
  if((costsResult.data||[]).length>=500||(invoicesResult.data||[]).length>=1000)
    throw new Error('Owner DRE reached safe pagination limit; refuse inaccurate totals.');
  const rules=costsResult.data||[];
  const invoiceMonths=new Map<string,Map<string,number[]>>();
  for(const inv of invoicesResult.data||[]){
    const clinicId=String(inv.organization_id||'');
    const month=monthFrom(inv.paid_at);
    const cents=Number(inv.amount_paid_cents||0);
    if(!clinicId||!Number.isSafeInteger(cents)||cents<=0||!month)continue;
    if(!invoiceMonths.has(month))invoiceMonths.set(month,new Map());
    const clinics=invoiceMonths.get(month)!;
    if(!clinics.has(clinicId))clinics.set(clinicId,[]);
    clinics.get(clinicId)!.push(cents);
  }
  const clinicTotals=new Map<string,{variable:number;fixed:number;below:number}>();
  const monthly=(overview.monthly||[]).map((m:any)=>{
    const perClinic=Array.from(invoiceMonths.get(m.periodMonth)||[]).map(([clinicId,invoiceAmountsCents])=>({clinicId,invoiceAmountsCents}));
    const costs=calculateOwnerDreCosts(rules,perClinic,m.periodMonth);
    const revenueGrossCents=perClinic.reduce((sum,row)=>sum+row.invoiceAmountsCents.reduce((a,v)=>a+v,0),0);
    const variableCents=Array.from(costs.perClinic.values()).reduce((sum,x)=>sum+x.operatingCents,0);
    const belowVariable=Array.from(costs.perClinic.values()).reduce((sum,x)=>sum+x.belowEbitdaCents,0);
    const fixedCents=costs.fixedOperatingCents;
    const belowCents=belowVariable+costs.fixedBelowEbitdaCents;
    const contributionCents=revenueGrossCents-variableCents;
    const ebitdaCents=contributionCents-fixedCents;
    const netCents=ebitdaCents-belowCents;

    // Allocate shared fixed costs in-memory by positive contribution, with exact remainder.
    const perClinicContrib=perClinic.map(row=>{
      const variable=costs.perClinic.get(row.clinicId)?.operatingCents||0;
      const gross=row.invoiceAmountsCents.reduce((a,v)=>a+v,0);
      return {clinicId:row.clinicId,gross,variable,below:costs.perClinic.get(row.clinicId)?.belowEbitdaCents||0,
        weight:Math.max(0,gross-variable)};
    });
    const totalWeight=perClinicContrib.reduce((sum,row)=>sum+row.weight,0);
    let allocatedFixed=0,allocatedBelow=0;
    perClinicContrib.forEach((row,i)=>{
      const denominator=totalWeight||perClinicContrib.length||1;
      const weight=totalWeight?row.weight:1;
      const fixed=i===perClinicContrib.length-1?fixedCents-allocatedFixed:Math.round(fixedCents*weight/denominator);
      const below=i===perClinicContrib.length-1?costs.fixedBelowEbitdaCents-allocatedBelow:
        Math.round(costs.fixedBelowEbitdaCents*weight/denominator);
      allocatedFixed+=fixed;allocatedBelow+=below;
      const old=clinicTotals.get(row.clinicId)||{variable:0,fixed:0,below:0};
      clinicTotals.set(row.clinicId,{
        variable:old.variable+row.variable,
        fixed:old.fixed+fixed,
        below:old.below+row.below+below,
      });
    });
    return {...m,revenueGross:roundMoney(revenueGrossCents),revenueNet:roundMoney(revenueGrossCents),deductions:0,
      variableCosts:roundMoney(variableCents),fixedCosts:roundMoney(fixedCents),
      contributionMarginValue:roundMoney(contributionCents),
      contributionMarginPct:revenueGrossCents?contributionCents/revenueGrossCents*100:0,
      ebitda:roundMoney(ebitdaCents),ebitdaPct:revenueGrossCents?ebitdaCents/revenueGrossCents*100:0,
      belowEbitdaCosts:roundMoney(belowCents),netResult:roundMoney(netCents),
      cashFlowEstimated:roundMoney(netCents),
    };
  });
  // The existing owner IDs are attached to customer cards; resolve clinic ID in ONE batched read.
  const clinicIds=Array.from(clinicTotals.keys());
  const profiles=clinicIds.length?await api.from('clinics').select('id,name').in('id',clinicIds):{data:[],error:null};
  if(profiles.error)throw profiles.error;
  const clinicNames=new Map((profiles.data||[]).map((r:any)=>[String(r.id),String(r.name||'Clínica')]));
  const grossByClinic=new Map<string,number>();
  for(const clinics of invoiceMonths.values()){
    for(const [clinicId,amounts] of clinics){
      grossByClinic.set(clinicId,(grossByClinic.get(clinicId)||0)+amounts.reduce((a,v)=>a+v,0));
    }
  }
  // One row per clinic (not owner user): owners of multiple clinics are never conflated.
  const topCustomers=clinicIds.map(clinicId=>{
    const costs=clinicTotals.get(clinicId)||{variable:0,fixed:0,below:0};
    const totalCost=costs.variable+costs.fixed+costs.below;
    const gross=grossByClinic.get(clinicId)||0;
    const result=gross-totalCost;
    return {customerId:clinicId,name:clinicNames.get(clinicId)||'Clínica',email:'',
      revenueNet:roundMoney(gross),totalCost:roundMoney(totalCost),
      variableCost:roundMoney(costs.variable),fixedCostAllocated:roundMoney(costs.fixed),
      profit:roundMoney(result),marginPct:gross?result/gross*100:0};
  }).sort((a:any,b:any)=>a.profit-b.profit);
  return {...overview,monthly,summary:monthly[monthly.length-1]||overview.summary,
    topCustomers,costRules:rules,allocationMethod:'contribution_share_pre_fixed',
    dataQuality:{...(overview.dataQuality||{}),fixedCostPoolSource:'owner_dre_cost_rules',
      directCostSource:'owner_dre_cost_rules',stripeCostSource:'owner_dre_cost_rules_only',cashFlowIsEstimated:true}};
}
