export type DreRule = {
  cost_type: 'fixed'|'variable';category:'operating'|'below_ebitda';
  amount_cents:number;rate_basis_points:number;
  starts_month:string;ends_month?:string|null;
};
export function ruleAppliesToMonth(rule:DreRule,month:string):boolean;
export function feeForAmountCents(rule:DreRule,basisCents:number):number;
export function calculateOwnerDreCosts(
  rules:DreRule[],
  clinics:{clinicId:string;invoiceAmountsCents:number[]}[],
  month:string
):{
  fixedOperatingCents:number;
  fixedBelowEbitdaCents:number;
  perClinic:Map<string,{operatingCents:number;belowEbitdaCents:number}>;
};
