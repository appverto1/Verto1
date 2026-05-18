import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
if (!secretKey) {
  console.error('STRIPE_SECRET_KEY ausente.');
  process.exit(1);
}

const stripe = new Stripe(secretKey);

const productName = process.env.STRIPE_ACTIVE_PATIENT_PRODUCT_NAME || 'Verto - Paciente ativo';
const lookupKey = process.env.STRIPE_ACTIVE_PATIENT_LOOKUP_KEY || 'verto_active_patient_metered_graduated_brl_monthly';
const eventName = process.env.STRIPE_ACTIVE_PATIENT_METER_EVENT_NAME || 'verto_active_patients_monthly';

const product = await stripe.products.create({
  name: productName,
  metadata: {
    billingModel: 'active_patient_metered_graduated',
    negotiationRequiredAfter: '50'
  }
});

const meter = await stripe.billing.meters.create({
  display_name: 'Verto - Pacientes ativos no mês',
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
  tiers_mode: 'graduated',
  lookup_key: lookupKey,
  transfer_lookup_key: true,
  tiers: [
    { up_to: 5, unit_amount: 4000 },
    { up_to: 10, unit_amount: 3200 },
    { up_to: 20, unit_amount: 2600 },
    { up_to: 30, unit_amount: 2200 },
    { up_to: 40, unit_amount: 1900 },
    { up_to: 50, unit_amount: 1700 },
    // Stripe exige uma faixa final infinita em precos tiered.
    // O app bloqueia reporte acima de 50 por padrao, ate negociacao comercial.
    { up_to: 'inf', unit_amount: 0 }
  ],
  metadata: {
    billingModel: 'active_patient_metered_graduated',
    negotiationRequiredAfter: '50',
    over50BlockedByAppDefault: 'true'
  }
});

console.log(JSON.stringify({
  productId: product.id,
  meterId: meter.id,
  meterEventName: eventName,
  priceId: price.id,
  lookupKey,
  env: [
    `STRIPE_ACTIVE_PATIENT_PRICE_ID=${price.id}`,
    `STRIPE_ACTIVE_PATIENT_METER_EVENT_NAME=${eventName}`
  ].join('\n')
}, null, 2));
