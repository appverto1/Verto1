import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {buildPartnerWhatsAppUrl,normalizeBrazilWhatsApp,preparePartnerWhatsAppMessage} from '../src/utils/partnerWhatsApp';
import {PARTNER_WHATSAPP_COPY} from '../src/constants/partnerWhatsAppCopy';

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
assert.match(PARTNER_WHATSAPP_COPY,/mais liberdade e tranquilidade no dia a dia clínico/);
assert.match(PARTNER_WHATSAPP_COPY,/se você não tiver interesse, me avisa/);
const defaultCopyMessage=preparePartnerWhatsAppMessage(PARTNER_WHATSAPP_COPY,{
  partnerName:'Parceira Teste',clinicName:'Clínica Alfa',referralLink
});
assert.ok(defaultCopyMessage.startsWith('Oi, tudo bem?'),'copy supplied by owner is prefilled');
assert.equal(defaultCopyMessage.split(referralLink).length,2,'unique referral URL is included exactly once');
assert.ok(defaultCopyMessage.endsWith(referralLink),'referral link is appended after the supplied copy');
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
const secondContact={id:'22222222-2222-4222-8222-222222222222',
  clinic_name:'Clínica Alfa',phone_e164:'5521988887777',created_at:'2026-11-17T10:00:00Z'};
globalThis.fetch=(async(path:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(path);
  requests.push({path:url,body:init?.body?JSON.parse(String(init.body)):null});
  assert.equal(url,'/api/partnerships/portal/whatsapp-contacts');
  if(init?.method==='POST'){
    return {ok:true,json:async()=>({success:true,contacts:[savedContact,secondContact]})} as Response;
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
  assert.match(document.body.textContent||'',/Cadastre aqui suas oportunidades/);
  await act(async()=>{
    update('#partner-whatsapp-clinic','Clínica Alfa');
    update('#partner-whatsapp-phone','(11) 99999-9999');
  });
  await act(async()=>{
    const add=Array.from(document.querySelectorAll('button'))
      .find(button=>button.textContent?.includes('Adicionar outro número'));
    assert.ok(add,'partner can add another phone');
    add.click();
  });
  await act(async()=>update('#partner-whatsapp-phone-1','(21) 98888-7777'));
  assert.equal(document.querySelectorAll('a[href*="wa.me"]').length,0,
    'buttons are disabled until Save confirms persistence');
  await act(async()=>{
    document.querySelector('form')!.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  });
  assert.equal(requests.length,2,'contact is written only after Save');
  assert.deepEqual(requests[1].body,{
    clinicName:'Clínica Alfa',phones:['(11) 99999-9999','(21) 98888-7777']
  },'one batch request with only the clinic and its numbers; no partner IDs or commission fields');
  assert.match(document.querySelector('[role="status"]')?.textContent||'',/2 contatos salvos/);
  const links=Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="wa.me"]'));
  assert.equal(links.length,4,'each saved number has a button in its row and in saved contacts');
  const destinations=links.map(link=>new URL(link.href).pathname);
  assert.ok(destinations.includes('/5511999999999'));
  assert.ok(destinations.includes('/5521988887777'));
  assert.ok(links.every(link=>new URL(link.href).searchParams.get('text')===message),
    'both numbers receive the same prefilled message without auto-send');
  assert.ok(links.every(link=>link.getAttribute('target')==='_blank'));
  assert.ok(links.every(link=>link.textContent?.includes('Enviar mensagem')));

  await act(async()=>update('#partner-whatsapp-phone','(11) 98888-1111'));
  assert.equal(document.querySelector('[role="status"]'),null,'editing invalidates saved state');
  assert.equal(requests.length,2,'editing does not persist');
  await act(async()=>root.render(React.createElement(PartnerWhatsAppReferral,{
    mode:'external',referralLink,partnerName:'Parceira Teste',messageTemplate:null
  })));
  assert.equal(document.querySelectorAll('a[href*="wa.me"]').length,0,
    'unapproved copy must never enable WhatsApp');
  assert.match(document.body.textContent||'',/Mensagem em definição/);
  await act(async()=>root.render(React.createElement(PartnerWhatsAppReferral,{
    mode:'external',referralLink,partnerName:'Parceira Teste'
  })));
  const defaultShare=document.querySelector<HTMLAnchorElement>('a[href*="wa.me"]');
  assert.ok(defaultShare,'supplied default copy enables WhatsApp for a saved contact');
  assert.equal(new URL(defaultShare.href).searchParams.get('text'),defaultCopyMessage,
    'approved default copy and referral link are prefilled without sending');

  console.log('partnerWhatsappReferral: batch save, per-number WhatsApp, no auto-send, attribution isolation and default copy passed');
}finally{
  await act(async()=>root.unmount());
  dom.window.close();
}
