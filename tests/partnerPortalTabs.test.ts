import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const dom=new JSDOM('<!doctype html><html><body><div id="test"></div></body></html>',{url:'https://verto.test'});
Object.assign(globalThis,{
  window:dom.window,document:dom.window.document,
  HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,
});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});

const React=await import('react');
const {act}=React;
const {createRoot}=await import('react-dom/client');
const {PartnershipPanel}=await import('../src/components/PartnershipPanel');

const requests:string[]=[];
const account={
  id:'11111111-1111-4111-8111-111111111111',display_name:'Parceiro de Teste',
  referral_code:'DEMO0001',referral_alias:'TESTE1234',status:'approved',compliance_approved:true,
};
const referrals=[{
  referral_id:'22222222-2222-4222-8222-222222222222',clinic_name:'Clínica Teste',
  lead_status:'won',has_paid:true,referred_at:'2026-11-13T12:00:00Z',
}];
globalThis.fetch=(async(input:RequestInfo|URL)=>{
  const path=String(input);
  requests.push(path);
  const result=path==='/api/partnerships/portal'
    ?{success:true,account,referrals}
    :path==='/api/partnerships/marketplace/partner'
      ?{success:true,profile:{service_name:'Serviço de teste',category:'Marketing',
        description:'Descrição comercial de teste disponível para clínicas.'},inbox:[
          {id:'33333333-3333-4333-8333-333333333333',contact_name:'Contato de Teste',
          contact_email:'contato@example.test',status:'interested',created_at:'2026-11-13T12:00:00Z',
          agreed_monthly_cents:null,clinic:{name:'Clínica Interessada'}},
        ]}
      :null;
  assert.ok(result,'Unexpected API request: '+path);
  return {ok:true,json:async()=>result} as Response;
}) as typeof fetch;

const root=createRoot(document.getElementById('test')!);
const tab=(label:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  .find(element=>element.textContent?.trim()===label)!;
const panel=(id:string)=>document.getElementById(id)!;

try{
  await act(async()=>root.render(React.createElement(PartnershipPanel,{mode:'external',onBack:()=>{}})));
  await act(async()=>{await Promise.resolve();});
  assert.equal(document.querySelectorAll('[role="tab"]').length,4);
  assert.equal(tab('Programa de parceiros').getAttribute('aria-selected'),'true');
  assert.equal(panel('partner-panel-program').hidden,false);
  assert.match(panel('partner-panel-program').textContent||'',/10% por até 12 meses/);
  assert.doesNotMatch(panel('partner-panel-program').textContent||'',/Parceiro aprovado|Participação, elegibilidade/);
  assert.equal(requests.filter(path=>path==='/api/partnerships/portal').length,1);
  assert.equal(requests.filter(path=>path==='/api/partnerships/marketplace/partner').length,1);

  await act(async()=>tab('Suas indicações').click());
  assert.equal(panel('partner-panel-program').hidden,true);
  assert.equal(panel('partner-panel-referrals').hidden,false);
  assert.match(panel('partner-panel-referrals').textContent||'',/Clínica Teste|Pagamento confirmado/);

  await act(async()=>tab('Sua vitrine na Verto').click());
  assert.equal(panel('partner-panel-marketplace').hidden,false);
  assert.ok(document.querySelector('button[type="submit"]')?.textContent?.includes('Salvar apresentação'));
  const field=document.querySelector<HTMLInputElement>('input[placeholder="Gestão de tráfego pago"]')!;
  assert.ok(field);
  await act(async()=>{
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(field,'Rascunho não salvo');
    field.dispatchEvent(new window.Event('input',{bubbles:true}));
  });

  await act(async()=>tab('Interesses recebidos').click());
  assert.match(panel('partner-panel-marketplace').textContent||'',/Clínica Interessada/);
  assert.equal(document.querySelector('input[placeholder="Gestão de tráfego pago"]'),null);
  await act(async()=>tab('Sua vitrine na Verto').click());
  assert.equal(document.querySelector<HTMLInputElement>('input[placeholder="Gestão de tráfego pago"]')?.value,
    'Rascunho não salvo','switching tabs must not discard unsaved drafts');
  assert.equal(requests.length,2,'tab changes must not reload portal or marketplace data');
  await act(async()=>{
    const key=new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true});
    tab('Sua vitrine na Verto').dispatchEvent(key);
  });
  assert.equal(tab('Interesses recebidos').getAttribute('aria-selected'),'true');
  console.log('partnerPortalTabs: four tabs, referral isolation, unsaved draft, keyboard navigation and no extra API reads passed');
} finally {
  await act(async()=>root.unmount());
  dom.window.close();
}
