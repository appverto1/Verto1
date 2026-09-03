import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');

const helperSource = server.match(
  /const normalizeModularSchedulePhaseBoundaries = \([\s\S]*?\n  \};\n\n  const ensureModularSubscriptionSchedule = async \(/
)?.[0]
  ?.replace(/\n\n  const ensureModularSubscriptionSchedule = async \($/, '') || '';
assert.ok(helperSource, 'normalizador operacional das fronteiras deve existir');

const normalizeModularSchedulePhaseBoundaries = new Function(
  `${helperSource}\nreturn normalizeModularSchedulePhaseBoundaries;`,
)();

const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

// Incidente real modelado: termos/proposta em T0, pagamento alguns minutos
// depois em T1. O snapshot congelado continua com R$ 500 no primeiro ciclo e
// R$ 600 no futuro; somente a fronteira operacional é ancorada na Stripe.
const t0 = '2026-09-02T18:00:00.000Z';
const frozenBoundary = '2026-10-02T18:00:00.000Z';
const stripeBoundary = '2026-10-02T18:07:00.000Z';
const phases500to600 = [
  {
    startsAt: t0,
    endsAt: frozenBoundary,
    items: [
      { itemKey: 'module_a', unitAmountCents: 25_000 },
      { itemKey: 'module_b', unitAmountCents: 25_000 },
      { itemKey: 'module_c', unitAmountCents: 0 },
    ],
  },
  {
    startsAt: frozenBoundary,
    endsAt: null,
    items: [
      { itemKey: 'module_a', unitAmountCents: 25_000 },
      { itemKey: 'module_b', unitAmountCents: 25_000 },
      { itemKey: 'module_c', unitAmountCents: 10_000 },
    ],
  },
];
const normalized = normalizeModularSchedulePhaseBoundaries(
  phases500to600,
  unix(stripeBoundary),
  unix(stripeBoundary),
);
assert.equal(normalized.firstPlanEnd, unix(frozenBoundary));
assert.equal(normalized.effectiveFirstTransitionEnd, unix(stripeBoundary));
assert.equal(normalized.boundaryShiftSeconds, 7 * 60);
assert.equal(normalized.futurePhases.length, 1);
assert.equal(normalized.futurePhases[0].startDate, unix(stripeBoundary));
assert.equal(normalized.futurePhases[0].endDate, null);
assert.equal(
  phases500to600[0].items.reduce((sum, item) => sum + item.unitAmountCents, 0),
  50_000,
  'primeiro ciclo deve permanecer R$ 500',
);
assert.equal(
  normalized.futurePhases[0].phase.items.reduce(
    (sum, item) => sum + item.unitAmountCents,
    0,
  ),
  60_000,
  'fase futura deve permanecer R$ 600',
);

// Se a fronteira comercial já é posterior ao current_period_end, não há shift
// nem encurtamento da condição comercial já congelada.
const futureBoundary = '2026-10-09T18:00:00.000Z';
const laterCommercialBoundary = normalizeModularSchedulePhaseBoundaries(
  [
    { startsAt: t0, endsAt: futureBoundary, items: phases500to600[0].items },
    { startsAt: futureBoundary, endsAt: null, items: phases500to600[1].items },
  ],
  unix(stripeBoundary),
  unix(stripeBoundary),
);
assert.equal(laterCommercialBoundary.boundaryShiftSeconds, 0);
assert.equal(laterCommercialBoundary.effectiveFirstTransitionEnd, unix(futureBoundary));
assert.equal(laterCommercialBoundary.futurePhases[0].startDate, unix(futureBoundary));

// Múltiplas fases futuras conservam suas durações quando T1 desloca o anchor.
const secondBoundary = '2026-11-02T18:00:00.000Z';
const multiPhase = normalizeModularSchedulePhaseBoundaries(
  [
    { startsAt: t0, endsAt: frozenBoundary, items: [] },
    { startsAt: frozenBoundary, endsAt: secondBoundary, items: [] },
    { startsAt: secondBoundary, endsAt: null, items: [] },
  ],
  unix(stripeBoundary),
  unix(stripeBoundary),
);
assert.equal(multiPhase.futurePhases[0].startDate, unix(stripeBoundary));
assert.equal(
  multiPhase.futurePhases[0].endDate - multiPhase.futurePhases[0].startDate,
  unix(secondBoundary) - unix(frozenBoundary),
  'duração comercial futura deve ser preservada após normalização',
);
assert.equal(
  multiPhase.futurePhases[1].startDate,
  unix(secondBoundary) + 7 * 60,
);

// Proposta sem transição (sem promoção ou desconto permanente) não cria
// fronteira/schedule adicional.
assert.deepEqual(
  normalizeModularSchedulePhaseBoundaries(
    [{ startsAt: t0, endsAt: null, items: phases500to600[1].items }],
    unix(stripeBoundary),
    unix(stripeBoundary),
  ).futurePhases,
  [],
);

assert.throws(
  () => normalizeModularSchedulePhaseBoundaries(phases500to600, 0, unix(stripeBoundary)),
  /MODULAR_SUBSCRIPTION_CURRENT_PERIOD_END_MISSING/,
);
assert.throws(
  () => normalizeModularSchedulePhaseBoundaries(
    phases500to600,
    unix(stripeBoundary),
    unix(frozenBoundary),
  ),
  /MODULAR_SCHEDULE_CURRENT_PHASE_BEFORE_SUBSCRIPTION_PERIOD_END/,
);

const ensureBlock = server.match(
  /const ensureModularSubscriptionSchedule = async \([\s\S]*?\n  const reconcileSalesAssistedCheckout = async \(/
)?.[0] || '';
const reconcileBlock = server.match(
  /const reconcileSalesAssistedCheckout = async \([\s\S]*?\n  const isSalesAssistedStripeEvent = async \(/
)?.[0] || '';
const reserveBlock = server.match(
  /async function reserveStripeWebhookEvent\([\s\S]*?\n}\n\nasync function markStripeWebhookEventStatus/
)?.[0] || '';
const processPaidBlock = server.match(
  /const processSalesAssistedCheckoutCompleted = async \([\s\S]*?\n  const stripeInvoiceSubscriptionId/
)?.[0] || '';
const provisionDirectorBlock = server.match(
  /async function provisionPaidSalesDirectorAccount\([\s\S]*?\n  async function finalizeSalesActivationForUser/
)?.[0] || '';
const finalizeActivationBlock = server.match(
  /async function finalizeSalesActivationForUser\([\s\S]*?\n  const mutationActionLabel/
)?.[0] || '';

assert.ok(ensureBlock, 'ensureModularSubscriptionSchedule deve existir');
assert.match(ensureBlock, /current_period_end/);
assert.match(ensureBlock, /normalizeModularSchedulePhaseBoundaries\(/);
assert.match(helperSource, /MODULAR_SCHEDULE_PHASE_BOUNDARY_BEFORE_CURRENT_PERIOD_END/);
assert.match(ensureBlock, /phases\.length <= 1\) return null/);
assert.match(ensureBlock, /subscriptionScheduleId \|\| storedScheduleId/);
assert.match(ensureBlock, /subscriptionSchedules\.retrieve\(/);
assert.match(ensureBlock, /subscriptionSchedules\.create\(/);
assert.match(ensureBlock, /modular-schedule:\$\{link\.id\}:\$\{subscriptionId\}/);
assert.match(ensureBlock, /modular-schedule-configure:\$\{link\.id\}:\$\{subscriptionId\}:\$\{schedule\.id\}/);
assert.match(ensureBlock, /MODULAR_CHECKOUT_ENVIRONMENT_MISMATCH/);
assert.match(ensureBlock, /Boolean\(\(schedule as any\)\?\.livemode\) !== \(stripeEnvironment === "live"\)/);
assert.doesNotMatch(ensureBlock, /subscriptions\.create\(/);
assert.doesNotMatch(ensureBlock, /checkout\.sessions\.create\(/);
assert.doesNotMatch(ensureBlock, /paymentIntents\.create\(|charges\.create\(/);

// O schedule deve ser reconciliado antes de qualquer transição financeira ou
// provisionamento, permitindo retry do mesmo checkout sem nova cobrança.
assert.match(
  reconcileBlock,
  /await ensureModularSubscriptionSchedule\(stripe, session\);[\s\S]*?processSalesAssistedCheckoutCompleted\(stripe, session\)/,
);
assert.match(reserveBlock, /sanitizeString\(existing\.status, 40\) === 'failed'/);
assert.match(reserveBlock, /attempt_count: Math\.max\(1, Number\(existing\.attempt_count \|\| 1\)\) \+ 1/);
assert.match(processPaidBlock, /confirm_sales_assisted_checkout_payment/);
assert.match(processPaidBlock, /provisionPaidSalesDirectorAccount\(/);
assert.match(provisionDirectorBlock, /supabase\.auth\.admin\.createUser\(/);
assert.match(finalizeActivationBlock, /applyModularEntitlementsForOrganization\(/);
assert.match(finalizeActivationBlock, /verifySalesDirectorContractAccess\(/);
assert.match(finalizeActivationBlock, /provisioning_status: "completed"/);

console.log('salesStripeModularScheduleBoundaryP0_20260902.regression.test.mjs: ok');
