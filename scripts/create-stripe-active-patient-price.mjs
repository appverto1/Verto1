import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
if (!secretKey) {
  console.error('STRIPE_SECRET_KEY ausente.');
  process.exit(1);
}

const stripe = new Stripe(secretKey);

const productName = process.env.STRIPE_ACTIVE_PATIENT_PRODUCT_NAME || 'Verto - Planos por pacientes ativos';
const lookupKey = process.env.STRIPE_ACTIVE_PATIENT_LOOKUP_KEY || 'verto_active_patient_packages_brl_monthly';
const eventName = process.env.STRIPE_ACTIVE_PATIENT_METER_EVENT_NAME || 'verto_active_patients_monthly';

const packageTiers = [
  { name: 'Verto Start', upTo: 5, amount: 49900 },
  { name: 'Verto Essencial', upTo: 10, amount: 89900 },
  { name: 'Verto Growth', upTo: 20, amount: 159900 },
  { name: 'Verto Clinic 50', upTo: 50, amount: 349900 },
  { name: 'Verto Clinic 100', upTo: 100, amount: 599900 },
  { name: 'Verto Clinic 150', upTo: 150, amount: 824900 },
  { name: 'Verto Clinic 200', upTo: 200, amount: 999900 },
  { name: 'Verto Clinic 299', upTo: 299, amount: 1349900 }
];

const product = await stripe.products.create({
  name: productName,
  metadata: {
    billingModel: 'active_patient_package_volume',
    enterpriseRequiredAfter: '299'
  }
});

const meter = await stripe.billing.meters.create({
  display_name: 'Verto - Pacientes ativos no mes',
  event_name: eventName,
  default_aggregation: {
    // Equivale ao antigo usage record com action=set: usa o ultimo valor reportado no periodo.
    formula: 'last'
  },
  customer_mapping: {
    type: 'by_id',
    event_payload_key: 'stripe_customer_id'
  },
  value_settings: {
    event_payload_key: 'value'
  }
});

const price = await stripe.prices.create({
  product: product.id,
  currency: 'brl',
  recurring: {
    interval: 'month',
    usage_type: 'metered',
    meter: meter.id
  },
  billing_scheme: 'tiered',
  tiers_mode: 'volume',
  lookup_key: lookupKey,
  transfer_lookup_key: true,
  tiers: [
    ...packageTiers.map((tier) => ({
      up_to: tier.upTo,
      flat_amount: tier.amount
    })),
    // Stripe exige uma faixa final infinita em precos tiered.
    // O app bloqueia reporte acima de 299 por padrao, ate contrato Enterprise.
    { up_to: 'inf', flat_amount: 0 }
  ],
  metadata: {
    billingModel: 'active_patient_package_volume',
    enterpriseRequiredAfter: '299',
    over299BlockedByAppDefault: 'true',
    tiers: packageTiers.map((tier) => `${tier.name}:${tier.upTo}:${tier.amount}`).join('|')
  }
});

console.log(JSON.stringify({
  productId: product.id,
  meterId: meter.id,
  meterEventName: eventName,
  priceId: price.id,
  lookupKey,
  tiers: packageTiers.map((tier) => ({
    name: tier.name,
    upTo: tier.upTo,
    monthlyAmount: Number((tier.amount / 100).toFixed(2))
  })),
  env: [
    `STRIPE_ACTIVE_PATIENT_PRICE_ID=${price.id}`,
    `STRIPE_ACTIVE_PATIENT_METER_EVENT_NAME=${eventName}`,
    'STRIPE_ACTIVE_PATIENT_BILLING_MODE=metered'
  ].join('\n')
}, null, 2));
