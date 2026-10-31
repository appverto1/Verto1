// Pure owner DRE rule evaluation. Input amounts are integer centavos; no database access.
export const ruleAppliesToMonth = (rule, month) =>
  String(rule.starts_month || '').slice(0,7) <= month &&
  (!rule.ends_month || String(rule.ends_month).slice(0,7) >= month);

export const feeForAmountCents = (rule, basisCents) =>
  Math.max(0, Number(rule.amount_cents || 0)) +
  Math.round(Math.max(0, basisCents) * Math.max(0, Number(rule.rate_basis_points || 0)) / 10000);

export const calculateOwnerDreCosts = (rules, clinicInvoices, month) => {
  const valid = rules.filter(rule => ruleAppliesToMonth(rule, month));
  const variable = valid.filter(rule => rule.cost_type === 'variable');
  const fixed = valid.filter(rule => rule.cost_type === 'fixed');
  const totalGrossCents = clinicInvoices.reduce((sum,row) =>
    sum + row.invoiceAmountsCents.reduce((a,v)=>a+v,0),0);
  const fixedOperatingCents = fixed.filter(r=>r.category==='operating')
    .reduce((sum,rule)=>sum+feeForAmountCents(rule,totalGrossCents),0);
  const fixedBelowEbitdaCents = fixed.filter(r=>r.category==='below_ebitda')
    .reduce((sum,rule)=>sum+feeForAmountCents(rule,totalGrossCents),0);
  const perClinic = new Map();
  for (const clinic of clinicInvoices) {
    let operatingCents=0, belowEbitdaCents=0;
    for (const amount of clinic.invoiceAmountsCents) {
      for (const rule of variable) {
        if (rule.category==='operating') operatingCents+=feeForAmountCents(rule,amount);
        else belowEbitdaCents+=feeForAmountCents(rule,amount);
      }
    }
    perClinic.set(clinic.clinicId,{operatingCents,belowEbitdaCents});
  }
  return { fixedOperatingCents,fixedBelowEbitdaCents,perClinic };
};
