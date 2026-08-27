import type {
  SalesAssumptionSnapshot,
  SalesAssumptionValues,
  SalesUsageProfile
} from './salesProfitability';
import type {
  SalesModularConsolidatedPeriod,
  SalesModularProposalLineResult
} from './salesModularProposal';

export type SalesMoneyFlowItem = {
  key: string;
  label: string;
  amountCents: number | null;
  explanation: string;
};

export type SalesModuleCostExplanation = {
  itemKey: string;
  publicName: string;
  revenueCents: number;
  directCostCents: number | null;
  costSource: string;
  costSourceDetail: string;
};

export type SalesRecurringMoneyFlow = {
  revenueCents: number;
  revenueDeductions: SalesMoneyFlowItem[];
  revenueDeductionsTotalCents: number | null;
  paymentFeesCents: number | null;
  lossProvisionCents: number | null;
  revenueTaxCents: number | null;
  totalTaxCents: number | null;
  revenueAfterDeductionsCents: number | null;
  directCosts: SalesMoneyFlowItem[];
  directCostsTotalCents: number | null;
  contributionMarginCents: number | null;
  sharedOperatingCosts: SalesMoneyFlowItem[];
  sharedOperatingCostsTotalCents: number | null;
  ebitdaCents: number | null;
  belowEbitdaExpenses: SalesMoneyFlowItem[];
  belowEbitdaExpensesTotalCents: number | null;
  preTaxIncomeCents: number | null;
  profitTaxCents: number | null;
  netIncomeCents: number | null;
  totalEstimatedDeductionsCents: number | null;
  distributableCashCents: null;
  distributableCashReason: string;
  moduleCosts: SalesModuleCostExplanation[];
  reconciled: boolean;
};

const multiplyBasisPoints = (amountCents: number, basisPoints: number) =>
  Math.round((amountCents * basisPoints) / 10_000);

const nullableSum = (values: Array<number | null>): number | null =>
  values.every((value) => value !== null)
    ? values.reduce<number>((sum, value) => sum + Number(value), 0)
    : null;

const resolveProfileValues = (
  snapshot: SalesAssumptionSnapshot,
  profile: SalesUsageProfile
): SalesAssumptionValues => {
  if (profile === 'custom') return snapshot.values;
  return {
    ...snapshot.values,
    ...(snapshot.values.usageProfiles?.[profile] || {}),
    usageProfiles: snapshot.values.usageProfiles
  };
};

const percentageItem = (
  key: string,
  label: string,
  revenueCents: number,
  basisPoints: number | null,
  explanation: string
): SalesMoneyFlowItem => ({
  key,
  label,
  amountCents:
    basisPoints === null
      ? null
      : multiplyBasisPoints(revenueCents, basisPoints),
  explanation
});

const adjustmentItem = (
  key: string,
  label: string,
  expectedTotal: number | null,
  knownItems: SalesMoneyFlowItem[],
  explanation: string
): SalesMoneyFlowItem | null => {
  if (expectedTotal === null) return null;
  const knownTotal = nullableSum(knownItems.map((item) => item.amountCents));
  if (knownTotal === null || knownTotal === expectedTotal) return null;
  return {
    key,
    label,
    amountCents: expectedTotal - knownTotal,
    explanation
  };
};

export const buildSalesRecurringMoneyFlow = ({
  period,
  assumptions,
  usageProfile,
  lines
}: {
  period: SalesModularConsolidatedPeriod;
  assumptions: SalesAssumptionSnapshot;
  usageProfile: SalesUsageProfile;
  lines: SalesModularProposalLineResult[];
}): SalesRecurringMoneyFlow => {
  const values = resolveProfileValues(assumptions, usageProfile);
  const revenue = period.recurringRevenueCents;

  const revenueDeductions: SalesMoneyFlowItem[] = [
    percentageItem(
      'stripe_percentage',
      'Stripe — tarifa percentual',
      revenue,
      values.stripeFeeBasisPoints,
      'Taxa percentual cobrada pelo meio de pagamento sobre a mensalidade.'
    ),
    {
      key: 'stripe_fixed',
      label: 'Stripe — tarifa fixa da cobrança',
      amountCents: period.fixedPaymentFeeAllocatedCents,
      explanation: 'Tarifa fixa estimada para processar a cobrança mensal.'
    },
    percentageItem(
      'revenue_tax',
      'Impostos sobre faturamento',
      revenue,
      values.revenueTaxBasisPoints,
      'Tributos incidentes sobre a receita. Não é imposto sobre o lucro.'
    ),
    percentageItem(
      'delinquency',
      'Inadimplência estimada',
      revenue,
      values.estimatedDelinquencyBasisPoints,
      'Perda estatística esperada por cobranças que podem não ser recebidas.'
    ),
    percentageItem(
      'chargebacks',
      'Estornos e chargebacks',
      revenue,
      values.refundChargebackBasisPoints,
      'Reserva estimada para devoluções, disputas e estornos.'
    )
  ];
  const revenueAdjustment = adjustmentItem(
    'revenue_deduction_adjustment',
    'Ajuste de arredondamento das deduções',
    period.transactionAndTaxCostAllocatedCents,
    revenueDeductions,
    'Ajuste técnico para reconciliar o detalhamento com o total congelado pelo motor.'
  );
  if (revenueAdjustment) revenueDeductions.push(revenueAdjustment);

  const directCosts: SalesMoneyFlowItem[] = [
    {
      key: 'fixed_direct',
      label: 'Custos fixos diretos dos módulos',
      amountCents: period.directCostBreakdown.fixedCostCents,
      explanation: 'Custos fixos causados diretamente pelas funcionalidades contratadas.'
    },
    {
      key: 'patient_direct',
      label: 'Custos diretos por paciente',
      amountCents: period.directCostBreakdown.patientCostCents,
      explanation: 'Custos que crescem conforme a quantidade de pacientes.'
    },
    {
      key: 'usage_direct',
      label: 'Processamento e unidades de uso',
      amountCents: period.directCostBreakdown.usageCostCents,
      explanation: 'Sessões, lançamentos, guias, relatórios e demais unidades de utilização.'
    },
    {
      key: 'storage',
      label: 'Armazenamento',
      amountCents: period.directCostBreakdown.storageCostCents,
      explanation: 'Custo estimado para manter arquivos e dados armazenados.'
    },
    {
      key: 'egress',
      label: 'Tráfego de dados (egress)',
      amountCents: period.directCostBreakdown.egressCostCents,
      explanation: 'Custo estimado da transferência e entrega de arquivos e dados.'
    },
    {
      key: 'notifications',
      label: 'E-mails e notificações',
      amountCents: period.directCostBreakdown.notificationCostCents,
      explanation: 'Mensagens, e-mails e notificações gerados pelo uso contratado.'
    },
    {
      key: 'support',
      label: 'Suporte direto do contrato',
      amountCents: period.directCostBreakdown.supportCostCents,
      explanation: 'Parcela de suporte diretamente atribuída aos módulos e pacientes.'
    },
    {
      key: 'operational',
      label: 'Operação direta dos módulos',
      amountCents: period.directCostBreakdown.operationalCostCents,
      explanation: 'Rotinas operacionais diretamente associadas às funcionalidades.'
    },
    {
      key: 'other_direct',
      label: 'Outros custos variáveis diretos',
      amountCents: period.directCostBreakdown.otherVariableCostCents,
      explanation: 'Outros custos incrementais registrados no modelo dos módulos.'
    }
  ];
  const directAdjustment = adjustmentItem(
    'direct_cost_adjustment',
    'Outros custos diretos conciliados',
    period.directCostCents,
    directCosts,
    'Diferença entre a soma das categorias e o custo direto consolidado congelado pelo motor.'
  );
  if (directAdjustment) directCosts.push(directAdjustment);

  const belowEbitdaExpenses: SalesMoneyFlowItem[] = [
    {
      key: 'depreciation_amortization',
      label: 'Depreciação e amortização',
      amountCents: values.depreciationAmortizationCents,
      explanation: 'Premissa histórica isolada em novas propostas; somente entra quando houver custo contábil atual explicitamente configurado.'
    },
    {
      key: 'financial_expenses',
      label: 'Despesas financeiras',
      amountCents: values.financialExpensesCents,
      explanation: 'Premissa histórica isolada em novas propostas; somente entra quando houver despesa financeira atual explicitamente configurada.'
    },
    {
      key: 'other_below_ebitda',
      label: 'Outras despesas abaixo do EBITDA',
      amountCents: values.otherBelowEbitdaCents,
      explanation: 'Premissa histórica isolada em novas propostas; somente entra quando houver despesa atual explicitamente configurada.'
    }
  ];
  const belowAdjustment = adjustmentItem(
    'below_ebitda_adjustment',
    'Ajuste de rateio abaixo do EBITDA',
    period.belowEbitdaCostAllocatedCents,
    belowEbitdaExpenses,
    'Ajuste para reconciliar o rateio congelado pelo motor com as premissas detalhadas.'
  );
  if (belowAdjustment) belowEbitdaExpenses.push(belowAdjustment);

  const sharedOperatingCosts: SalesMoneyFlowItem[] = [
    {
      key: 'shared_operating',
      label: 'Estrutura compartilhada atribuída',
      amountCents: period.sharedPlatformCostAllocatedCents,
      explanation:
        'Parcela do pool mensal atual (DAS MEI + Supabase + Railway) rateada entre as clínicas operacionais e esta nova proposta. Premissas históricas não entram neste valor.'
    }
  ];

  const revenueDeductionsTotalCents = nullableSum(
    revenueDeductions.map((item) => item.amountCents)
  );
  const revenueDeductionByKey = new Map(
    revenueDeductions.map((item) => [item.key, item.amountCents] as const)
  );
  const paymentFeesCents = nullableSum([
    revenueDeductionByKey.get('stripe_percentage') ?? null,
    revenueDeductionByKey.get('stripe_fixed') ?? null
  ]);
  const lossProvisionCents = nullableSum([
    revenueDeductionByKey.get('delinquency') ?? null,
    revenueDeductionByKey.get('chargebacks') ?? null
  ]);
  const revenueTaxCents =
    revenueDeductionByKey.get('revenue_tax') ?? null;
  const directCostsTotalCents = nullableSum(
    directCosts.map((item) => item.amountCents)
  );
  const sharedOperatingCostsTotalCents = nullableSum(
    sharedOperatingCosts.map((item) => item.amountCents)
  );
  const belowEbitdaExpensesTotalCents = nullableSum(
    belowEbitdaExpenses.map((item) => item.amountCents)
  );
  const revenueAfterDeductionsCents =
    revenueDeductionsTotalCents === null
      ? null
      : revenue - revenueDeductionsTotalCents;
  const preTaxIncomeCents =
    period.ebitdaCents === null || belowEbitdaExpensesTotalCents === null
      ? null
      : period.ebitdaCents - belowEbitdaExpensesTotalCents;
  const totalEstimatedDeductionsCents =
    period.netIncomeCents === null ? null : revenue - period.netIncomeCents;

  const expectedContribution = nullableSum([
    revenueDeductionsTotalCents,
    directCostsTotalCents
  ]);
  const calculatedContribution =
    expectedContribution === null ? null : revenue - expectedContribution;
  const calculatedEbitda =
    calculatedContribution === null || sharedOperatingCostsTotalCents === null
      ? null
      : calculatedContribution - sharedOperatingCostsTotalCents;
  const calculatedNetIncome =
    calculatedEbitda === null ||
    belowEbitdaExpensesTotalCents === null ||
    period.profitTaxAllocatedCents === null
      ? null
      : calculatedEbitda -
        belowEbitdaExpensesTotalCents -
        period.profitTaxAllocatedCents;

  return {
    revenueCents: revenue,
    revenueDeductions,
    revenueDeductionsTotalCents,
    paymentFeesCents,
    lossProvisionCents,
    revenueTaxCents,
    totalTaxCents:
      revenueTaxCents === null || period.profitTaxAllocatedCents === null
        ? null
        : revenueTaxCents + period.profitTaxAllocatedCents,
    revenueAfterDeductionsCents,
    directCosts,
    directCostsTotalCents,
    contributionMarginCents: period.contributionMarginCents,
    sharedOperatingCosts,
    sharedOperatingCostsTotalCents,
    ebitdaCents: period.ebitdaCents,
    belowEbitdaExpenses,
    belowEbitdaExpensesTotalCents,
    preTaxIncomeCents,
    profitTaxCents: period.profitTaxAllocatedCents,
    netIncomeCents: period.netIncomeCents,
    totalEstimatedDeductionsCents,
    distributableCashCents: null,
    distributableCashReason:
      'Não calculado: lucro líquido não é automaticamente dinheiro disponível para retirada. Faltam investimentos, capital de giro, reservas, tributos da distribuição e política de retirada dos sócios.',
    moduleCosts: lines
      .filter((line) => line.pricingMode !== 'one_time')
      .map((line) => ({
        itemKey: line.itemKey,
        publicName: line.publicName,
        revenueCents: line.promotionalRecurringRevenueCents,
        directCostCents: line.promotional.directCostCents,
        costSource: line.costSource,
        costSourceDetail: line.costSourceDetail
      })),
    reconciled:
      calculatedContribution === period.contributionMarginCents &&
      calculatedEbitda === period.ebitdaCents &&
      calculatedNetIncome === period.netIncomeCents
  };
};
