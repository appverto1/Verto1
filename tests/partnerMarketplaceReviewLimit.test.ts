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
let count=4;
let directoryReads=0;
let reviewWrites=0;
globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(input);
  if(path.startsWith('/api/partnerships/marketplace?')){
    directoryReads++;
    return {ok:true,json:async()=>({
      success:true,services:[{
        partner_id:'33333333-3333-4333-8333-333333333333',
        service_name:'Tráfego pago',category:'Marketing',
        description:'Gestão de campanhas digitais para clínicas.',
        logo_url:'https://example.test/company-logo.png',
        partner:{display_name:'Empresa Teste'},rating_average:4.0,review_count:4
      }],canManage:true,contact:null,
      mine:[{id:'44444444-4444-4444-8444-444444444444',
        partner_id:'33333333-3333-4333-8333-333333333333',status:'active',
        partner_confirmed_at:'2026-11-13T12:00:00Z',
        clinic_confirmed_at:'2026-11-13T12:00:00Z',agreed_monthly_cents:10000,
        my_review_count:count}]
    })} as Response;
  }
  if(path.includes('/api/partnerships/marketplace/review/')&&init?.method==='POST'){
    reviewWrites++;
    count=5; // concurrent submission made the state stale before this save
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
  const discoverCard=document.querySelector('article')!;
  assert.ok(discoverCard,'service must be displayed in a card');
  assert.match(discoverCard.textContent||'',/Empresa Teste|Tráfego pago/);
  assert.equal(discoverCard.querySelectorAll('img').length,1,'only the logo is displayed');
  assert.ok(Array.from(discoverCard.querySelectorAll('button'))
    .some(el=>el.textContent?.trim()==='Avaliar parceiro'),
    'contracted clinics should be able to review directly in Explorar serviços');

  const mineButton=Array.from(document.querySelectorAll('button'))
    .find(el=>el.textContent?.includes('Meus parceiros'))!;
  await act(async()=>mineButton.click());
  const mineGrid=document.querySelector('article')?.parentElement!;
  assert.match(mineGrid.className,/grid gap-4 md:grid-cols-2/,
    'Meus parceiros should follow the same responsive two-column grid');
  assert.equal(document.querySelector('article')?.querySelectorAll('img').length,1);
  assert.match(document.querySelector('article')?.textContent||'',/Empresa Teste|Tráfego pago|Gestão de campanhas digitais/);
  assert.equal(directoryReads,1,'switching tabs must reuse existing data');
  let rateButton=Array.from(document.querySelectorAll('button'))
    .find(el=>el.textContent?.trim()==='Avaliar parceiro');
  assert.ok(rateButton,'first review is allowed');
  await act(async()=>rateButton!.click());
  const submit=Array.from(document.querySelectorAll('button'))
    .find(el=>el.textContent?.trim()==='Salvar avaliação')!;
  await act(async()=>submit.click());
  assert.equal(reviewWrites,1);
  assert.equal(directoryReads,2,'reload only after the stale write was rejected');
  assert.match(document.body.textContent||'',/limite de cinco avaliações para este parceiro/i);
  assert.match(document.body.textContent||'',/Limite de cinco avaliações desta clínica atingido/);
  rateButton=Array.from(document.querySelectorAll('button'))
    .find(el=>el.textContent?.trim()==='Avaliar parceiro');
  assert.equal(rateButton,undefined,'sixth review must not be offered');
  assert.equal(document.querySelector('[aria-label="Avaliar parceiro"]'),null);
  await act(async()=>Array.from(document.querySelectorAll('button'))
    .find(el=>el.textContent?.trim()==='Explorar serviços')!.click());
  assert.equal(Array.from(document.querySelectorAll('article button')).some(el=>el.textContent?.trim()==='Avaliar parceiro'),false,
    'sixth review must not be offered in Explorar serviços either');
  console.log('partnerMarketplaceReviewLimit: responsive cards, review from discovery, race refresh, five-review limit, logo-only, no extra requests');
}finally{
  await act(async()=>root.unmount());
  dom.window.close();
}
