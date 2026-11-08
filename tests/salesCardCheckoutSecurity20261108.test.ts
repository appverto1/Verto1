import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveSalesSettledCheckoutMethod } from '../services/salesSettledCheckoutMethod';
import {
  SALES_CARD_PROOF_COOKIE,
  issueSalesCardCheckoutBrowserProof,
  verifySalesCardCheckoutBrowserProof,
} from '../services/salesCardCheckoutBrowserProof';

const session = (status: string, total: number) => ({
  payment_status: status, amount_total: total,
  invoice: 'in_test_checkout', payment_method_types: ['card','boleto'],
});

const paidStripe = (chosen: 'card' | 'boleto') => ({
  invoicePayments: { list: async (params: any) => {
    assert.equal(params.invoice, 'in_test_checkout');
    return { data: [{ status:'paid',
      payment: {type:'payment_intent', payment_intent:'pi_test_final'} }] };
  }},
  paymentIntents: { retrieve: async (id: string, opts: any) => {
    assert.equal(id, 'pi_test_final');
    assert.deepEqual(opts.expand, ['latest_charge']);
    return { status:'succeeded', amount_received:20000,
      latest_charge: {paid:true,status:'succeeded',payment_method_details:{type:chosen}}};
  }},
});

test('actual card charge activates immediately regardless of available boleto choice', async () => {
  assert.equal(await resolveSalesSettledCheckoutMethod(
    paidStripe('card') as any, session('paid',20000) as any
  ), 'card');
});

test('actual boleto charge remains boleto and never takes card path', async () => {
  assert.equal(await resolveSalesSettledCheckoutMethod(
    paidStripe('boleto') as any, session('paid',20000) as any
  ), 'boleto');
});

test('pending, zero, or failed charges fail closed without creating credentials', async () => {
  for (const [status,amount] of [['unpaid',20000],['paid',0],['no_payment_required',0]] as const) {
    await assert.rejects(
      resolveSalesSettledCheckoutMethod(paidStripe('card') as any, session(status,amount) as any),
      /SALES_PAYMENT_NOT_SETTLED/,
    );
  }
  const bad = paidStripe('card');
  bad.paymentIntents.retrieve = async () => ({
    status:'processing', amount_received:0, latest_charge:null,
  }) as any;
  await assert.rejects(
    resolveSalesSettledCheckoutMethod(bad as any,session('paid',20000) as any),
    /SALES_PAYMENT_INTENT_NOT_SUCCEEDED/,
  );
});

test('public link + session ID alone cannot mint first access; original browser only', async () => {
  const offerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const checkoutSessionId='cs_test_unit123';
  let row:any=null;
  const db = {
    from(table:string) {
      if (table === 'sales_offers') return {
        select() { return {
          eq() { return this; },
          async maybeSingle() { return {data:{
            id:offerId,status:'checkout_created',payment_confirmed_at:null,
            stripe_checkout_session_id:checkoutSessionId,
          },error:null}; },
        }; },
      };
      assert.equal(table,'sales_card_checkout_handoffs');
      return {
        insert(value:any) {
          return { select() { return { async maybeSingle() {
            if (row) return { data:null,error:{code:'23505'} };
            row=value; return {data:{checkout_session_id:value.checkout_session_id},error:null};
          }}; } };
        },
        select(column:string) {
          assert.equal(column,'proof_hash');
          let offer=offerId;
          let sid=checkoutSessionId;
          return {
            eq(name:string,value:string) {
              if(name==='offer_id')offer=value;
              if(name==='checkout_session_id')sid=value;
              return this;
            },
            gt(){return this;},
            async maybeSingle(){
              return {data:row&&offer===row.offer_id&&sid===row.checkout_session_id
                ? {proof_hash:row.proof_hash}:null,error:null};
            },
          };
        },
      };
    },
  };
  let proofCookie='';
  const res = {
    cookie(name:string,value:string,options:any){
      assert.equal(name, SALES_CARD_PROOF_COOKIE);
      assert.equal(options.httpOnly,true);
      assert.equal(options.secure,true);
      assert.equal(options.sameSite,'lax');
      proofCookie=`${name}=${value}`;
    },
    setHeader() {},
  };
  assert.equal(await issueSalesCardCheckoutBrowserProof(db as any,res as any,offerId,checkoutSessionId),true);
  assert.ok(row.proof_hash.length===64);
  assert.ok(!proofCookie.includes(row.proof_hash),'never place hash on client');
  assert.equal(await verifySalesCardCheckoutBrowserProof(db as any,proofCookie,offerId,checkoutSessionId),true);
  assert.equal(await verifySalesCardCheckoutBrowserProof(db as any,'',offerId,checkoutSessionId),false);
  assert.equal(await verifySalesCardCheckoutBrowserProof(db as any,proofCookie,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',checkoutSessionId),false);
  assert.equal(await verifySalesCardCheckoutBrowserProof(db as any,proofCookie,offerId,'cs_test_other'),false);
  assert.equal(await issueSalesCardCheckoutBrowserProof(db as any,res as any,offerId,checkoutSessionId),false);
});
