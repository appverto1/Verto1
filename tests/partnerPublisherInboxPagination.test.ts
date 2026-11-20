import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom=new JSDOM('<!doctype html><html><body><div id="test"></div></body></html>',{url:'https://verto.test'});
Object.assign(globalThis,{
  window:dom.window,document:dom.window.document,
  HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true
});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
const React=await import('react');
const {act}=React;
const {createRoot}=await import('react-dom/client');
const {PartnerMarketplacePublisher}=await import('../src/components/PartnerMarketplacePublisher');

const first=Array.from({length:50},(_,i)=>({
  id:'lead-'+i,contact_name:'Contato '+i,contact_email:'test'+i+'@example.test',
  status:'interested',created_at:'2026-11-20T10:00:00Z',agreed_monthly_cents:null,clinic:{name:'Clínica '+i}
}));
const requests:string[]=[];
globalThis.fetch=(async(input:RequestInfo|URL)=>{
  const path=String(input);requests.push(path);
  if(path==='/api/partnerships/marketplace/partner'){
    return {ok:true,json:async()=>({
      success:true,profile:{service_name:'Serviço',category:'Marketing',
        description:'Descrição comercial existente, sem persistência automática.'},
      inbox:first,hasMoreInbox:true,nextInboxOffset:50
    })} as Response;
  }
  if(path==='/api/partnerships/marketplace/partner?offset=50'){
    return {ok:true,json:async()=>({
      success:true,profile:null,inbox:[first[49],{
        id:'lead-50',contact_name:'Contato 50',contact_email:'test50@example.test',
        status:'interested',created_at:'2026-11-19T10:00:00Z',agreed_monthly_cents:null,clinic:{name:'Clínica 50'}
      }],hasMoreInbox:false,nextInboxOffset:52
    })} as Response;
  }
  throw Error('Unexpected request '+path);
}) as typeof fetch;

const pendingCounts:number[]=[];
const root=createRoot(document.getElementById('test')!);
try {
  await act(async()=>root.render(React.createElement(PartnerMarketplacePublisher,{
    activeSection:'interests',onPendingInterestsChange:(count:number|null)=>pendingCounts.push(count??-1)
  })));
  await act(async()=>{await Promise.resolve()});
  assert.equal(document.querySelectorAll('li').length,50,'initial batch preserves existing size');
  assert.deepEqual(requests,['/api/partnerships/marketplace/partner'],'opening portal makes no extra reads');
  const more=Array.from(document.querySelectorAll('button')).find(el=>el.textContent?.includes('Carregar mais interesses'));
  assert.ok(more,'hasMoreInbox enables paging');
  await act(async()=>{more.click();more.click();});
  await act(async()=>{await Promise.resolve()});
  assert.equal(requests.filter(path=>path.includes('offset=50')).length,1,'double-click is deduplicated');
  assert.equal(document.querySelectorAll('li').length,51,'duplicated result from shifted page must be merged');
  assert.equal(Array.from(document.querySelectorAll('li')).filter(li=>li.textContent?.includes('Contato 49')).length,1);
  assert.equal(Array.from(document.querySelectorAll('li')).filter(li=>li.textContent?.includes('Contato 50')).length,1);
  assert.equal(document.body.textContent?.includes('Carregar mais interesses'),false,'no button after last page');
  assert.deepEqual(pendingCounts,[50,51],'badge counts distinct loaded interests');
  assert.equal(requests.some(path=>path.includes('/profile')),false,'pagination cannot persist drafts');
  console.log('partnerPublisherInboxPagination: PASS');
} finally {
  await act(async()=>root.unmount());
  dom.window.close();
}
