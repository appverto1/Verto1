import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {buildPartnerWhatsAppUrl,normalizeBrazilWhatsApp,preparePartnerWhatsAppMessage} from '../src/utils/partnerWhatsApp';

assert.equal(normalizeBrazilWhatsApp('(11) 99999-9999'),'5511999999999');
assert.equal(normalizeBrazilWhatsApp('5511999999999'),'5511999999999');
assert.equal(normalizeBrazilWhatsApp('+55 11 3333-4444'),'551133334444');
assert.equal(normalizeBrazilWhatsApp('0011'),null);
assert.equal(normalizeBrazilWhatsApp('https://attacker.invalid'),null);
const referralLink='https://verto.test/interesse?ref=TESTE1234';
const message=preparePartnerWhatsAppMessage(
  'Olá, {{clinica}}! Sou {{parceiro}}. {{link}}',
  {partnerName:'Parceira Teste',clinicName:'Clínica Alfa',referralLink});
assert.equal(message,'Olá, Clínica Alfa! Sou Parceira Teste. '+referralLink);
assert.equal(preparePartnerWhatsAppMessage('Conheça a Verto',
  {partnerName:'Teste',clinicName:'Alfa',referralLink}),'Conheça a Verto\n\n'+referralLink);
const target=buildPartnerWhatsAppUrl('(11) 99999-9999',message)!;
assert.equal(new URL(target).hostname,'wa.me');
assert.equal(new URL(target).pathname,'/5511999999999');
assert.equal(new URL(target).searchParams.get('text'),message);

const dom=new JSDOM('<!doctype html><html><body><div id="test"></div></body></html>',{url:'https://verto.test'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,
  HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
const React=await import('react');
const {act}=React;
const {createRoot}=await import('react-dom/client');
const {PartnerWhatsAppReferral}=await import('../src/components/PartnerWhatsAppReferral');
const requests:Array<{path:string,body:any}>=[];
const savedContact={id:'11111111-1111-4111-8111-111111111111',
  clinic_name:'Clínica Alfa',phone_e164:'5511999999999',created_at:'2026-11-17T10:00:00Z'};
globalThis.fetch=(async(path:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(path);
  requests.push({path:url,body:init?.body?JSON.parse(String(init.body)):null});
  assert.equal(url,'/api/partnerships/portal/whatsapp-contacts');
  if(init?.method==='POST'){
    return {ok:true,json:async()=>({success:true,contact:savedContact})} as Response;
  }
  assert.equal(init?.method,undefined);
  return {ok:true,json:async()=>({success:true,contacts:[]})} as Response;
}) as typeof fetch;
const root=createRoot(document.getElementById('test')!);
const update=(selector:string,value:string)=>{
  const input=document.querySelector<HTMLInputElement>(selector)!;
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(input,value);
  input.dispatchEvent(new window.Event('input',{bubbles:true}));
};
try{
  await act(async()=>root.render(React.createElement(PartnerWhatsAppReferral,{
    mode:'external',referralLink,partnerName:'Parceira Teste',messageTemplate:'Olá, {{clinica}}! Sou {{parceiro}}. {{link}}'
  })));
  await act(async()=>{await Promise.resolve();});
  assert.equal(requests.length,1,'one on-demand list read per mount');
  assert.equal(document.querySelectorAll('a[href*="wa.me"]').length,0,
    'nothing is shared before explicit save');
  await act(async()=>{update('#partner-whatsapp-clinic','Clínica Alfa');
    update('#partner-whatsapp-phone','(11) 99999-9999');});
  await act(async()=>{
    document.querySelector('form')!.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  });
  assert.equal(requests.length,2,'contact is written only after Save');
  assert.deepEqual(requests[1].body,{clinicName:'Clínica Alfa',phone:'(11) 99999-9999'},
    'client must not submit partner ID, leads, commission or status');
  assert.match(document.querySelector('[role="status"]')?.textContent||'',/Contato salvo/);
  const links=Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="wa.me"]'));
  assert.ok(links.length>=1,'share is enabled only after saved response');
  assert.equal(new URL(links[0].href).searchParams.get('text'),message,
    'message is prefilled; there is no auto-send');
  assert.equal(links[0].getAttribute('target'),'_blank');

  await act(async()=>update('#partner-whatsapp-phone','(11) 98888-1111'));
  assert.equal(document.querySelector('[role="status"]'),null,'editing invalidates saved state');
  assert.equal(requests.length,2,'editing does not persist');
  await act(async()=>root.render(React.createElement(PartnerWhatsAppReferral,{
    mode:'external',referralLink,partnerName:'Parceira Teste',messageTemplate:null
  })));
  assert.equal(document.querySelectorAll('a[href*="wa.me"]').length,0,
    'unapproved copy must never enable WhatsApp');
  assert.match(document.body.textContent||'',/Mensagem em definição/);
  console.log('partnerWhatsappReferral: normalization, URL, save authority, attribution isolation, manual send and pending copy passed');
}finally{
  await act(async()=>root.unmount());
  dom.window.close();
}
