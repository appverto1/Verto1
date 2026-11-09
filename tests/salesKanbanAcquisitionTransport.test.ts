import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  loadSalesKanbanAcquisitionBoard,
  persistSalesKanbanAcquisition,
  persistSalesKanbanAcquisitionBulk,
} from '../src/services/salesKanbanAcquisition';

const leadId = '11111111-1111-4111-8111-111111111111';
const channelId = '22222222-2222-4222-8222-222222222222';
const key = 'item-03-acquisition-idempotency-key';

test('acquisition catalogs retain one authenticated owner request without extra reads', async () => {
  const calls: Array<{url:string;init?:RequestInit}> = [];
  const request = async (url:string,init?:RequestInit) => {
    calls.push({url,init});
    return {success:true,channels:[],links:[]};
  };
  await loadSalesKanbanAcquisitionBoard(request);
  await loadSalesKanbanAcquisitionBoard(request,'a%2Cb');
  assert.deepEqual(calls, [
    {url:'/api/owner/sales/acquisition/board',init:undefined},
    {url:'/api/owner/sales/acquisition/board?leadIds=a%2Cb',init:undefined},
  ]);
});

test('a single channel Save and bulk Save preserve method, payload and idempotency', async () => {
  const calls: Array<{url:string;init?:RequestInit}> = [];
  const request = async (url:string,init?:RequestInit) => {
    calls.push({url,init});
    return {success:true,selection:{channelIds:[channelId]},selections:[]};
  };
  const selections = [{leadId,channelIds:[channelId]}];
  await persistSalesKanbanAcquisition(request,leadId,key,[channelId]);
  await persistSalesKanbanAcquisitionBulk(request,key,selections);
  assert.deepEqual(calls.map(call=>call.url), [
    '/api/owner/sales/acquisition/leads/'+leadId,
    '/api/owner/sales/acquisition/leads/bulk',
  ]);
  assert.deepEqual(calls.map(call=>call.init?.method),['PUT','PUT']);
  assert.ok(calls.every(call=>(call.init?.headers as Record<string,string>)?.['X-Idempotency-Key']===key));
  assert.deepEqual(calls.map(call=>JSON.parse(String(call.init?.body))),[
    {channelIds:[channelId]},
    {selections},
  ]);
});

test('a failed Save propagates without optimistic state or repeated HTTP calls', async () => {
  let calls=0;
  const request=async () => { calls++; throw new Error('IDEMPOTENCY_CONFLICT'); };
  await assert.rejects(persistSalesKanbanAcquisition(request,leadId,key,[channelId]),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(persistSalesKanbanAcquisitionBulk(request,key,[{leadId,channelIds:[channelId]}]),/IDEMPOTENCY_CONFLICT/);
  assert.equal(calls,2);
});

test('Kanban only confirms mutations on strict success:true and delegates acquisition I/O', () => {
  const component=readFileSync('src/components/CommercialKanban.tsx','utf8');
  assert.match(component,/if \(!response\.ok \|\| json\.success !== true\) throw Error/);
  assert.match(component,/loadSalesKanbanAcquisitionBoard\(request,q\)/);
  assert.match(component,/persistSalesKanbanAcquisition\(request,dialog\.leadId,key,dialog\.channelIds\)/);
  assert.match(component,/persistSalesKanbanAcquisitionBulk\(request,key,selections\)/);
  assert.doesNotMatch(component,/request\('\/api\/owner\/sales\/acquisition\//);
});
