import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const dom=new JSDOM('<!doctype html><html><body><div id="test"></div></body></html>',{
  url:'https://verto.test'
});
Object.assign(globalThis,{
  window:dom.window,document:dom.window.document,
  HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true
});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
const React=await import('react');
const {act}=React;
const {createRoot}=await import('react-dom/client');
const {PartnerMarketplace}=await import('../src/components/PartnerMarketplace');

const clinicId='22222222-2222-4222-8222-222222222222';
let count=1;
let directoryReads=0;
let reviewWrites=0;
globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(input);
  if(path.startsWith('/api/partnerships/marketplace?')){
    directoryReads++;
    return {ok:true,json:async()=>({
      success:true,services:[],canManage:true,contact:null,
      mine:[{id:'44444444-4444-4444-8444-444444444444',
        partner_id:'33333333-3333-4333-8333-333333333333',status:'active',
        partner_confirmed_at:'2026-11-13T12:00:00Z',
        clinic_confirmed_at:'2026-11-13T12:00:00Z',agreed_monthly_cents:10000,
        my_review_count:count}]
    })} as Response;
  }
  if(path.includes('/api/partnerships/marketplace/review/')&&init?.method==='POST'){
    reviewWrites++;
    count=2; // concurrent submission made the state stale before this save
    return {ok:false,json:async()=>({success:false,error:'REVIEW_LIMIT_REACHED'})} as Response;
  }
  throw new Error('Unexpected API request '+path);
}) as typeof fetch;

const root=createRoot(document.getElementById('test')!);
try{
  await act(async()=>root.render(React.createElement(PartnerMarketplace,{
    open:true,clinicId,onClose:()=>{}
  })));
  await act(async()=>{await Promise.resolve();});
  const mineButton=Array.from(document.querySelectorAll('button'))
    .find(el=>el.textContent?.includes('Meus parceiros'))!;
  await act(async()=>mineButton.click());
  let rateButton=Array.from(document.querySelectorAll('button'))
    .find(el=>el.textContent?.trim()==='Avaliar parceiro');
  assert.ok(rateButton,'first review is allowed');
  await act(async()=>rateButton!.click());
  const submit=Array.from(document.querySelectorAll('button'))
    .find(el=>el.textContent?.trim()==='Salvar avaliação')!;
  await act(async()=>submit.click());
  assert.equal(reviewWrites,1);
  assert.equal(directoryReads,2,'reload only after the stale write was rejected');
  assert.match(document.body.textContent||'',/limite de duas avaliações para este parceiro/i);
  assert.match(document.body.textContent||'',/Limite de duas avaliações desta clínica atingido/);
  rateButton=Array.from(document.querySelectorAll('button'))
    .find(el=>el.textContent?.trim()==='Avaliar parceiro');
  assert.equal(rateButton,undefined,'third review must not be offered');
  assert.equal(document.querySelector('[aria-label="Avaliar parceiro"]'),null);
  console.log('partnerMarketplaceReviewLimit: stale 409 refresh, clear guidance, no third-review button');
}finally{
  await act(async()=>root.unmount());
  dom.window.close();
}
