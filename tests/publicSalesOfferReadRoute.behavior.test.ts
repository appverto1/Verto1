import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { registerPublicSalesOfferReadRoute } from '../services/publicSalesOfferReadRoute';

const TOKEN_A = 'A'.repeat(43);
const TOKEN_B = 'B'.repeat(43);
const expiresAt = '2099-12-31T23:59:59.000Z';
const sanitizeString = (value: unknown, max = 256) => String(value ?? '').trim().slice(0, max);
const limiter = (_req: unknown, _res: unknown, next: () => void) => next();

const modular = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, lead_id: 'lead-' + id, status: 'opened', offer_type: 'modular',
  expires_at: expiresAt, revoked_at: null, accepted_at: null,
  currency: 'BRL', proposal_name: 'Contrato ' + id,
  modular_checkout_enabled: true, trial_days: 7, discount_percentage: 10,
  discount_duration_months: 3, public_notes: 'Valores congelados',
  initial_active_patient_quantity: 20,
  modular_snapshot: {
    promotionalRecurringRevenueCents: 17000,
    postPromotionRecurringRevenueCents: 21000,
    oneTimeRevenueCents: 0, globalDiscountCents: 4000,
    discountDurationMonths: 3, onboardingInstallments: 1,
    basePackage: null,
    commercialPhases: [{
      phaseNumber: 1, startsAt: '2026-11-07', endsAt: null,
      lines: [
        {itemKey: 'clinical_core',publicName: 'Clínico',billingInterval: 'monthly',normalPriceCents: 21000,activePriceCents: 17000},
        {itemKey: 'platform_foundation',publicName: 'Interno',billingInterval: 'monthly',normalPriceCents: 0,activePriceCents: 0},
      ],
      recurringRevenueCents: 17000, invoiceAmountCents: 17000,
      secretInternalRate: 12345,
    }],
    commercialPricing: {capacityBlockPhases: []},
    confidentialInternalPolicy: {minMargin: 999},
  },
  ...overrides,
});

const publicItem = (item_key = 'clinical_core', recurring_amount_cents = 17000) => ({
  item_key, public_name_snapshot: item_key === 'clinical_core' ? 'Clínico' : 'Infraestrutura',
  public_description_snapshot: 'Descrição pública',
  pricing_mode_snapshot: 'monthly', quantity: 20,
  limit_quantity: 25, included_quantity: 20,
  gross_recurring_amount_cents: recurring_amount_cents,
  recurring_amount_cents, post_promotion_recurring_amount_cents: recurring_amount_cents,
  one_time_amount_cents: 0, item_discount_basis_points: 0,
  allocated_global_discount_cents: 0, sort_order: 0,
  public_metadata: {
    features: ['Recurso A'], tierName: 'Tier', internalNotes: 'não publicar',
    offerDiscount: {type: 'percent', priceBeforeDiscountCents: 21000, discountedPriceCents: 17000,
      priceAfterExpirationCents: 21000, internalNotes: 'não publicar'},
  },
});

const makeHarness = ({
  offers = {} as Record<string, any>,
  leads = {} as Record<string, any>,
  items = {} as Record<string, any[]>,
}: {
  offers?: Record<string, any>; leads?: Record<string, any>; items?: Record<string, any[]>;
} = {}) => {
  const calls: Array<{table: string; column?: string; value?: any; action?: string}> = [];
  const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();
  const app = {
    get: (path: string, guard: any, handler: (...args: any[]) => Promise<unknown>) => {
      assert.equal(guard, limiter, 'existing rate limiter must stay active');
      handlers.set(path, handler);
    },
  };
  const supabase = {
    from: (table: string) => {
      calls.push({table});
      if (table === 'sales_offers') return {
        select: (columns: string) => ({
          eq: (column: string, value: string) => ({
            maybeSingle: async () => {
              calls.push({table,column,value,action:'select'});
              assert.match(columns,/public_token_hash|offer_type|base_unit_amount_cents/);
              return {data: offers[value] ?? null, error: null};
            },
          }),
        }),
        update: (changes: any) => ({
          eq: (column: string, value: string) => ({
            in: async (_field: string, _statuses: string[]) => {
              calls.push({table,column,value,action:'update'});
              assert.equal(changes.status,'opened');
              return {data: null,error:null};
            },
          }),
        }),
      };
      if (table === 'sales_leads') return {
        select: (_columns: string) => ({
          eq: (column: string, value: string) => ({
            is: (_deleted: string, _nullValue: null) => ({
              maybeSingle: async () => {
                calls.push({table,column,value,action:'select'});
                return {data: leads[value] ?? null,error:null};
              },
            }),
          }),
        }),
      };
      if (table === 'sales_offer_items') return {
        select: (_columns: string) => ({
          eq: (column: string, value: string) => ({
            order: async () => {
              calls.push({table,column,value,action:'select'});
              return {data: items[value] ?? [],error:null};
            },
          }),
        }),
      };
      if (table === 'sales_lead_events') return {
        upsert: async () => {
          calls.push({table,action:'upsert'});
          return {data:null,error:null};
        },
      };
      throw Error('Unexpected table ' + table);
    },
  };
  const loader = registerPublicSalesOfferReadRoute({
    app, supabase, publicSalesLeadIpLimiter: limiter, sanitizeString,
    hashSalesOfferToken: (value: string) => 'sha256:' + value,
    extractMissingColumnName: () => null, isMissingRelationError: () => false,
    salesOfferPublicStatusAllowed: (status: string) => ['ready','sent','opened'].includes(status),
    salesOfferUsesCustomerFacingModulesOnly: () => true,
    isSalesInternalCommercialItemKey: (value: string) => value === 'platform_foundation',
    PUBLIC_ACTIVE_PATIENT_PRICE: {currency:'BRL',unitAmountCents:1000},
    resolveStripeEnvironment: () => 'test',
    validateStripeSecretForEnvironment: () => undefined,
    resolveSalesStripeConfiguration: () => ({}),
    isSalesOfferStripeReady: () => true,
  } as any);
  const handler = handlers.get('/api/public/sales-offers/:token');
  assert.equal(typeof handler,'function','GET registered exactly once');
  const invoke = async (token: string) => {
    const res: any = {
      statusCode: 200, payload: null,
      status(code: number) { this.statusCode=code; return this; },
      json(payload: any) { this.payload=payload; return this; },
    };
    await handler!({params:{token}},res);
    return res as { statusCode: number; payload: any };
  };
  return {loader, invoke, calls, handlers};
};

test('new service owns the unique existing GET and server passes its loader to acceptance/checkout',()=>{
  const server=readFileSync('server.ts','utf8');
  const service=readFileSync('services/publicSalesOfferReadRoute.ts','utf8');
  assert.match(server,/import \{ registerPublicSalesOfferReadRoute \} from '\.\/services\/publicSalesOfferReadRoute';/);
  assert.match(server,/const loadPublicSalesOffer = registerPublicSalesOfferReadRoute\(\{/);
  assert.ok(server.indexOf('const loadPublicSalesOffer = registerPublicSalesOfferReadRoute') <
    server.indexOf('registerPublicSalesCheckoutRoutes({'));
  assert.match(server,/registerPublicSalesCheckoutRoutes\(\{[\s\S]*?loadPublicSalesOffer,/);
  assert.doesNotMatch(server,/app\.get\(\s*"\/api\/public\/sales-offers\/:token"/);
  assert.doesNotMatch(server,/const sanitizePublicOfferDiscount = \(raw: any\)/);
  assert.match(service,/app\.get\(\s*"\/api\/public\/sales-offers\/:token"/);
  assert.match(service,/publicSalesLeadIpLimiter/);
  assert.match(service,/hashSalesOfferToken\(safeToken\)/);
  assert.match(service,/return loadPublicSalesOffer;/);
  // A byte-exact copy of the reviewed 552-line server block: no silent
  // changes to status, token, expiry, sanitization or legacy semantics.
  const start=service.indexOf('  const sanitizePublicOfferDiscount = (raw: any) => {');
  const end=service.indexOf('  return loadPublicSalesOffer;',start);
  assert.ok(start>=0 && end>start);
  const originalBlock=service.slice(start,end);
  let fingerprint=0x811c9dc5;
  for(let i=0;i<originalBlock.length;i++) {
    fingerprint=Math.imul(fingerprint^originalBlock.charCodeAt(i),0x01000193)>>>0;
  }
  assert.equal(fingerprint.toString(16).padStart(8,'0'),'5d8daf79');
  assert.doesNotMatch(service,/getStripe\(|createOrReuseModularCheckout\(|createCheckoutSession\(/);
});

test('invalid token and unknown hash fail closed without querying other leads or returning token hints',async()=>{
  const h=makeHarness();
  const short=await h.invoke('short');
  assert.equal(short.statusCode,400);
  assert.equal(short.payload.success,false);
  assert.equal(short.payload.error,'OFFER_UNAVAILABLE');
  assert.equal(h.calls.length,0);
  const unknown=await h.invoke(TOKEN_A);
  assert.equal(unknown.statusCode,404);
  assert.equal(unknown.payload.error,'OFFER_UNAVAILABLE');
  assert.deepEqual(h.calls.filter(x=>x.action==='select').map(x=>x.table),['sales_offers']);
  assert.equal(h.calls.find(x=>x.action==='select')?.value,'sha256:'+TOKEN_A);
});

test('expired or revoked offer cannot reach lead lookup, items, acceptance or checkout',async()=>{
  for (const state of [
    {expires_at:'2020-01-01T00:00:00.000Z'},
    {revoked_at:'2026-11-07T00:00:00.000Z'},
    {status:'paid'},
  ]) {
    const h=makeHarness({offers:{['sha256:'+TOKEN_A]:modular('one',state)}});
    const result=await h.invoke(TOKEN_A);
    assert.equal(result.statusCode,404);
    assert.equal(result.payload.error,'OFFER_UNAVAILABLE');
    assert.equal(h.calls.filter(x=>x.action==='select').length,1);
    assert.equal(h.calls.filter(x=>x.action==='update'||x.action==='upsert').length,0);
  }
});

test('distinct public tokens isolate clinics and expose only sanitized frozen commercial projections',async()=>{
  const h=makeHarness({
    offers:{['sha256:'+TOKEN_A]:modular('A'),['sha256:'+TOKEN_B]:modular('B', {proposal_name:'Outro contrato',modular_snapshot:{promotionalRecurringRevenueCents:9000,postPromotionRecurringRevenueCents:10000,commercialPhases:[],commercialPricing:{capacityBlockPhases:[]}}})},
    leads:{
      'lead-A':{id:'lead-A',name:'Pessoa A',clinic_name:'Clínica A',email:'private-a@example.com',normalized_phone:'11999999999'},
      'lead-B':{id:'lead-B',name:'Pessoa B',clinic_name:'Clínica B',email:'private-b@example.com'},
    },
    items:{A:[publicItem(),publicItem('platform_foundation',0)],B:[publicItem()]},
  });
  const a=await h.invoke(TOKEN_A);
  const b=await h.invoke(TOKEN_B);
  assert.equal(a.statusCode,200);assert.equal(b.statusCode,200);
  assert.equal(a.payload.success,true);assert.equal(b.payload.success,true);
  assert.equal(a.payload.offer.offerType,'modular');
  assert.equal(a.payload.offer.clinicName,'Clínica A');
  assert.equal(b.payload.offer.clinicName,'Clínica B');
  assert.equal(a.payload.offer.promotionalMonthlyAmountCents,17000);
  assert.equal(b.payload.offer.promotionalMonthlyAmountCents,9000);
  assert.deepEqual(a.payload.offer.items.map((x:any)=>x.itemKey),['clinical_core']);
  assert.deepEqual(a.payload.offer.commercialPhases[0].lines.map((x:any)=>x.itemKey),['clinical_core']);
  const serialized=JSON.stringify(a.payload);
  assert.doesNotMatch(serialized,/private-a@|private-b@|11999999999|secretInternalRate|confidentialInternalPolicy|internalNotes/);
  assert.ok(h.calls.every(x=>x.table!=='sales_lead_events'));
  assert.equal(h.calls.filter(x=>x.action==='select'&&x.table==='sales_offers').length,2);
  assert.equal(h.calls.filter(x=>x.action==='select'&&x.table==='sales_offer_items').length,2);
});

test('nonzero internal customer-facing charges block proposal instead of hiding or recomputing',async()=>{
  const h=makeHarness({
    offers:{['sha256:'+TOKEN_A]:modular('A')},
    leads:{'lead-A':{id:'lead-A',name:'A',clinic_name:'Clínica A'}},
    items:{A:[publicItem(),publicItem('platform_foundation',1000)]},
  });
  const response=await h.invoke(TOKEN_A);
  assert.equal(response.statusCode,409);
  assert.equal(response.payload.success,false);
  assert.equal(response.payload.error,'OFFER_UNAVAILABLE');
  assert.equal(h.calls.filter(x=>x.action==='update').length,0);
});

test('legacy open offer retains its frozen pricing without modular items or extra reads',async()=>{
  const h=makeHarness({
    offers:{['sha256:'+TOKEN_A]:modular('L',{offer_type:'legacy',base_unit_amount_cents:1200,initial_active_patient_quantity:10,discount_type:'none',discount_percentage:0,promotional_unit_amount_cents:1200,promotional_monthly_amount_cents:12000,post_discount_monthly_amount_cents:12000})},
    leads:{'lead-L':{id:'lead-L',name:'Histórica',clinic_name:'Clínica antiga',email:'private@example.com'}},
  });
  const response=await h.invoke(TOKEN_A);
  assert.equal(response.statusCode,200);
  assert.equal(response.payload.offer.offerType,'legacy');
  assert.equal(response.payload.offer.clinicName,'Clínica antiga');
  assert.equal(response.payload.offer.promotionalMonthlyAmountCents,12000);
  assert.equal(response.payload.offer.postDiscountMonthlyAmountCents,12000);
  assert.equal(h.calls.filter(x=>x.action==='select').length,2);
  assert.doesNotMatch(JSON.stringify(response.payload),/private@example.com/);
});
