import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const dom=new JSDOM('<!doctype html><html><body><div id="test"></div></body></html>',{
  url:'https://staging.example/interesse?ref=fratelli10'
});
Object.assign(globalThis,{
  window:dom.window,document:dom.window.document,
  HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,
});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});

const React=await import('react');
const {act}=React;
const {createRoot}=await import('react-dom/client');
const {PartnerInterestPage}=await import('../src/components/PartnerInterestPage');
const {SalesInterestForm}=await import('../src/components/SalesInterestForm');

const submissions:any[]=[];
globalThis.fetch=(async(path:RequestInfo|URL,init?:RequestInit)=>{
  assert.equal(String(path),'/api/public/sales-leads');
  assert.equal(init?.method,'POST');
  submissions.push(JSON.parse(String(init?.body)));
  return {ok:true,json:async()=>({success:true,referralRecorded:true})} as Response;
}) as typeof fetch;
const root=createRoot(document.getElementById('test')!);
const coupon=()=>document.querySelector<HTMLInputElement>('#sales-referral-coupon');
const change=(input:HTMLInputElement,value:string)=>{
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(input,value);
  input.dispatchEvent(new window.Event('input',{bubbles:true}));
};

try {
  await act(async()=>root.render(React.createElement(PartnerInterestPage)));
  assert.match(document.body.textContent||'',/Cadastre seu interesse na Verto/);
  assert.equal(coupon()?.value,'FRATELLI10');
  assert.equal(coupon()?.readOnly,true);
  assert.match(document.body.textContent||'',/não pode ser alterado/);

  await act(async()=>{
    change(document.querySelector<HTMLInputElement>('#sales-name')!,'Lead de Teste');
    change(document.querySelector<HTMLInputElement>('#sales-phone')!,'11999999999');
    change(coupon()!,'OUTRO10');
  });
  await act(async()=>{
    document.querySelector('form')!.dispatchEvent(
      new window.Event('submit',{bubbles:true,cancelable:true}));
  });
  assert.equal(submissions.length,1);
  assert.equal(submissions[0].partnerCode,'FRATELLI10',
    'UI manipulation must not change the code sent by the locked form');

  dom.window.history.replaceState(null,'','/interesse?ref=%3Cscript%3E');
  await act(async()=>root.render(React.createElement(PartnerInterestPage)));
  assert.equal(coupon(),null,'invalid link must not show a submittable form');
  assert.match(document.querySelector('[role="alert"]')?.textContent||'',/inválido ou incompleto/);

  dom.window.history.replaceState(null,'','/interesse');
  await act(async()=>root.render(React.createElement(PartnerInterestPage)));
  assert.equal(coupon(),null,'missing referral code must not lead to untracked registration');

  dom.window.history.replaceState(null,'','/?ref=LEGACY10');
  await act(async()=>root.render(React.createElement(SalesInterestForm)));
  assert.equal(coupon()?.readOnly,false,'ordinary landing code entry remains editable');
  assert.equal(coupon()?.value,'LEGACY10');
  console.log('partnerDirectInterestLink: direct route, locked code, submit payload, malformed/missing links and editable legacy form passed');
} finally {
  await act(async()=>root.unmount());
  dom.window.close();
}
