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
let failNextPortalRead=false;
let savedCategory='Categoria histórica';
const legacyPhotoPath='storage://verto-partner-images/previous/photo-legacy.png';
let savedPhotoUrl='';
const account={
  id:'11111111-1111-4111-8111-111111111111',display_name:'Parceiro de Teste',
  referral_code:'DEMO0001',referral_alias:'TESTE1234',status:'approved',compliance_approved:true,
};
const referrals=[{
  referral_id:'22222222-2222-4222-8222-222222222222',clinic_name:'Clínica Teste',
  lead_status:'won',has_paid:true,referred_at:'2026-11-13T12:00:00Z',
  term_months:12,first_paid_at:'2026-11-13T12:00:00Z',
  term_ends_at:'2027-11-13T12:00:00Z',subscription_active:true,
}];
globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(input);
  requests.push(path);
  if(path==='/api/partnerships/marketplace/partner/profile'&&init?.method==='PATCH'){
    savedCategory=JSON.parse(String(init.body)).category;
    savedPhotoUrl=JSON.parse(String(init.body)).photoUrl;
    return {ok:true,json:async()=>({success:true})} as Response;
  }
  if(path==='/api/partnerships/portal' && failNextPortalRead){
    failNextPortalRead=false;
    throw new Error('Falha ao atualizar indicações de teste.');
  }
  const result=path==='/api/partnerships/portal'
    ?{success:true,account,referrals,currentTermMonths:12,qualifiedActive:6}
    :path==='/api/partnerships/marketplace/partner'
      ?{success:true,profile:{service_name:'Serviço de teste',category:savedCategory,
        description:'Descrição comercial de teste disponível para clínicas.',photo_url:legacyPhotoPath},inbox:[
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
  .find(element=>element.textContent?.trim().startsWith(label))!;
const panel=(id:string)=>document.getElementById(id)!;

try{
  await act(async()=>root.render(React.createElement(PartnershipPanel,{mode:'external',onBack:()=>{}})));
  await act(async()=>{await Promise.resolve();});
  assert.equal(document.querySelectorAll('[role="tab"]').length,4);
  assert.equal(tab('Programa de parceiros').getAttribute('aria-selected'),'true');
  assert.equal(panel('partner-panel-program').hidden,false);
  assert.match(panel('partner-panel-program').textContent||'',/10% por até 12 meses/);
  assert.match(panel('partner-panel-program').textContent||'',/Parceiro Ouro/);
  assert.match(panel('partner-panel-program').textContent||'',/Nível máximo alcançado/);
  assert.equal(panel('partner-panel-program').querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'),'100');
  assert.equal(panel('partner-panel-program').querySelectorAll('div.grid.grid-cols-3 > div').length,3);
  assert.doesNotMatch(panel('partner-panel-program').textContent||'',/Parceiro aprovado|Participação, elegibilidade/);
  assert.equal(requests.filter(path=>path==='/api/partnerships/portal').length,1);
  assert.equal(requests.filter(path=>path==='/api/partnerships/marketplace/partner').length,1);
  assert.equal(tab('Interesses recebidos').querySelector('span[aria-hidden="true"]')?.textContent,'1',
    'badge usa solicitação pendente já carregada, sem nova requisição');
  assert.match(tab('Interesses recebidos').getAttribute('aria-label')||'',/1 solicitação pendente/);

  await act(async()=>tab('Suas indicações').click());
  assert.equal(panel('partner-panel-program').hidden,true);
  assert.equal(panel('partner-panel-referrals').hidden,false);
  assert.match(panel('partner-panel-referrals').textContent||'',/Clínica Teste|Pagamento confirmado/);
  assert.match(panel('partner-panel-referrals').textContent||'',/Direito de 12 meses/);

  await act(async()=>tab('Sua vitrine na Verto').click());
  assert.equal(panel('partner-panel-marketplace').hidden,false);
  assert.ok(document.querySelector('button[type="submit"]')?.textContent?.includes('Salvar apresentação'));
  const categories=panel('partner-panel-marketplace').querySelector<HTMLSelectElement>('select')!;
  assert.ok(categories,'categoria deve ser um dropdown');
  assert.match(panel('partner-panel-marketplace').textContent||'',/800 × 800 px/);
  assert.doesNotMatch(panel('partner-panel-marketplace').textContent||'',/Foto de apresentação|1200 × 675 px/,
    'promotional artwork and its format guidance should be hidden');
  assert.equal(panel('partner-panel-marketplace').querySelectorAll('input[type="file"]').length,1,
    'only the company logo may be uploaded');
  assert.equal(categories.required,true);
  assert.equal(categories.value,'Categoria histórica','categorias legadas devem continuar editáveis');
  assert.deepEqual(Array.from(categories.options).filter(o=>!o.disabled&&o.value!=='Categoria histórica').map(o=>o.value),[
    'Marketing','Publicidade','Tecnologia e software','Consultoria e gestão',
    'Contabilidade e finanças','Jurídico e compliance','Recursos humanos',
    'Treinamento e capacitação','Equipamentos e suprimentos','Infraestrutura e manutenção'
  ]);
  await act(async()=>{
    categories.value='Marketing';
    categories.dispatchEvent(new window.Event('change',{bubbles:true}));
  });
  assert.equal(categories.value,'Marketing');
  assert.equal(requests.filter(path=>path==='/api/partnerships/marketplace/partner/profile').length,0,
    'alterar dropdown não deve persistir antes de salvar');
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
  assert.equal(panel('partner-panel-marketplace').querySelector<HTMLSelectElement>('select')?.value,
    'Marketing','alternar abas não pode descartar categoria escolhida');
  assert.equal(requests.length,2,'tab changes must not reload portal or marketplace data');
  await act(async()=>{
    const key=new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true});
    tab('Sua vitrine na Verto').dispatchEvent(key);
  });
  assert.equal(tab('Interesses recebidos').getAttribute('aria-selected'),'true');
  await act(async()=>tab('Suas indicações').click());
  failNextPortalRead=true;
  await act(async()=>document.querySelector<HTMLButtonElement>('button[aria-label="Atualizar indicações"]')!.click());
  assert.match(document.querySelector('[role="alert"]')?.textContent||'',/Falha ao atualizar indicações de teste/,
    'refresh errors must remain visible in the referrals tab');
  await act(async()=>tab('Sua vitrine na Verto').click());
  const form=panel('partner-panel-marketplace').querySelector('form')!;
  await act(async()=>{
    form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  });
  assert.equal(savedCategory,'Marketing','somente Salvar deve persistir a categoria selecionada');
  assert.equal(savedPhotoUrl,legacyPhotoPath,'removing promotional art must not erase previously saved media');
  assert.equal(requests.filter(path=>path==='/api/partnerships/marketplace/partner/profile').length,1);
  assert.equal(panel('partner-panel-marketplace').querySelector<HTMLSelectElement>('select')?.value,'Marketing',
    'categoria salva deve permanecer após recarregar dados');
  assert.equal(tab('Interesses recebidos').querySelector('span[aria-hidden="true"]')?.textContent,'1');
  console.log('partnerPortalTabs: four tabs, interest badge, logo-only, legacy media retained on save, category selector and bounded reads passed');
} finally {
  await act(async()=>root.unmount());
  dom.window.close();
}
