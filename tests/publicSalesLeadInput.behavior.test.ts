import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePublicSalesLeadInput } from '../services/publicSalesLeadInput';

const deps = {
  sanitizeString: (v: unknown, n: number) => String(v ?? '').trim().slice(0,n),
  sanitizeEmail: (v: unknown) => { const s=String(v??'').trim().toLowerCase(); return s && /^[^@ ]+@[^@ ]+\.[^@ ]+$/.test(s)?s:null; },
  normalizeSalesPhone: (v: unknown) => { const digits=String(v??'').replace(/\D/g,''); return digits.length===11?'55'+digits:digits.startsWith('55')&&digits.length===13?digits:null; },
  normalizeSalesInteger: (v: unknown, max: number) => v===undefined||v===null||v===''?null:Number.isInteger(Number(v))&&Number(v)>=0&&Number(v)<=max?Number(v):null,
  SALES_PUBLIC_PAYLOAD_MAX_BYTES: 24*1024,
  SALES_ESTIMATED_ACTIVE_PATIENTS_MAX: 100000,
  SALES_ESTIMATED_PROFESSIONALS_MAX: 10000,
  SALES_CONTACT_CONSENT_VERSION: 'sales-contact-v1',
  SALES_OPERATION_TYPES: new Set(['clinic','independent_professional','multidisciplinary_team']),
  SALES_PREFERRED_CONTACT_PERIODS: new Set(['','morning','afternoon','evening']),
  BRAZIL_STATE_CODES: new Set(['SP','RJ']),
};
const request = () => ({
  headers: {'x-idempotency-key':'synthetic-key-123456'},
  body: { name:'Pessoa Sintética', phone:'(11) 99999-9999', clinicName:'Clínica Sintética',
    acquisitionChannel:'organic', source:'public_landing', website:'', formStartedAt:Date.now()-2000 }
}) as any;
const expectRejected=(req:any, status:number) => {
  const parsed=parsePublicSalesLeadInput(req,deps);
  assert.equal(parsed.ok,false);
  if (!parsed.ok) assert.equal(parsed.status,status);
};
test('public lead normalization preserves the existing RPC contract and idempotency',()=>{
  const parsed=parsePublicSalesLeadInput(request(),deps);
  assert.equal(parsed.ok,true);
  if (!parsed.ok) return;
  assert.equal(parsed.input.name,'Pessoa Sintética');
  assert.equal(parsed.input.normalizedPhone,'5511999999999');
  assert.equal(parsed.input.phone,'+5511999999999');
  assert.equal(parsed.input.clinicName,'Clínica Sintética');
  assert.equal(parsed.input.operationType,'clinic');
  assert.equal(parsed.input.source,'public_landing');
  assert.equal(parsed.input.consentPurpose,'sales_contact');
  assert.equal(parsed.input.idempotencyKey,'public-sales:synthetic-key-123456');
  const fallback=request();fallback.headers['x-idempotency-key']='short';
  const a=parsePublicSalesLeadInput(fallback,deps);
  const b=parsePublicSalesLeadInput(fallback,deps);
  assert.equal(a.ok,true);assert.equal(b.ok,true);
  if(a.ok && b.ok){
    assert.match(a.input.idempotencyKey,/^public-sales:[a-f0-9]{64}$/);
    assert.equal(a.input.idempotencyKey,b.input.idempotencyKey);
  }
});
test('all existing reject-before-database guards remain effective',()=>{
  const large=request();large.headers['content-length']='24577';expectRejected(large,413);
  const huge=request();huge.body.notes='x'.repeat(24576);expectRejected(huge,413);
  const trap=request();trap.body.website='filled';expectRejected(trap,400);
  const early=request();early.body.formStartedAt=Date.now();expectRejected(early,400);
  const late=request();late.body.formStartedAt=Date.now()-25*60*60*1000;expectRejected(late,400);
  const short=request();short.body.name='X';expectRejected(short,400);
  const badEmail=request();badEmail.body.email='not-an-email';expectRejected(badEmail,400);
  const state=request();state.body.state='ZZ';expectRejected(state,400);
  const period=request();period.body.preferredContactPeriod='invalid';expectRejected(period,400);
  const estimate=request();estimate.body.estimatedProfessionals=10001;expectRejected(estimate,400);
});
test('source and acquisition labels keep their original fallbacks',()=>{
  const req=request();req.body.source='arbitrary';req.body.acquisitionChannel='';
  const result=parsePublicSalesLeadInput(req,deps);
  assert.equal(result.ok,true);
  if(result.ok){
    assert.equal(result.input.source,'public_landing');
    assert.equal(result.input.acquisitionChannel,'public_landing');
  }
});
