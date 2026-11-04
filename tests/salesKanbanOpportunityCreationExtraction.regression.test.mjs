import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const prospecting=readFileSync('services/salesProspectingRoutes.ts','utf8');
const routes=readFileSync('services/salesKanbanOpportunityCreationRoutes.ts','utf8');
const ui=readFileSync('src/components/CommercialKanban.tsx','utf8');
const transport=readFileSync('src/services/salesKanbanOpportunityCreation.ts','utf8');
const sql=readFileSync('supabase/migrations/20261028235930_sales_bulk_acquisition_atomic_v1.sql','utf8');
const fnv=(str)=>{let h=0x811c9dc5;for(let i=0;i<str.length;i++)h=Math.imul(h^str.charCodeAt(i),0x01000193)>>>0;return h.toString(16).padStart(8,'0');};

test('both manual opportunity routes have byte-exact 04/11 staging semantics',()=>{
  const first=routes.indexOf('  // Preview only:');
  const last=routes.lastIndexOf('\n}\n');
  assert.ok(first>=0&&last>first);
  assert.equal(fnv(routes.slice(first,last+1)),'543f5240');
  assert.match(prospecting,/import \{ registerSalesKanbanOpportunityCreationRoutes \} from '\.\/salesKanbanOpportunityCreationRoutes'/);
  assert.equal((prospecting.match(/registerSalesKanbanOpportunityCreationRoutes\(app, \{/g)||[]).length,1);
  assert.doesNotMatch(prospecting,/app\.post\('\/api\/owner\/sales\/kanban\/opportunities(?:\/duplicates)?'/);
  assert.match(routes,/app\.post\('\/api\/owner\/sales\/kanban\/opportunities\/duplicates', \.\.\.salesGuard/);
  assert.match(routes,/app\.post\('\/api\/owner\/sales\/kanban\/opportunities', \.\.\.salesGuard/);
});

test('privileged writes, duplicate previews, SQL idempotency and cost envelope remain unchanged',()=>{
  assert.match(prospecting,/const salesGuard = \[checkAuth, checkPlatformAdmin\]/);
  assert.match(prospecting,/registerSalesKanbanOpportunityCreationRoutes\(app, \{supabase, salesGuard, sanitizeString, isUuid, boardError\}\)/);
  assert.match(routes,/create_sales_kanban_opportunities_v2/);
  assert.match(routes,/\.select\('id,name,phone,status,normalized_phone'\)/);
  assert.match(routes,/\.in\('normalized_phone',unique\)\.is\('deleted_at',null\)\.limit\(101\)/);
  assert.match(routes,/res\.setHeader\('Cache-Control','private, no-store'\)/);
  assert.match(routes,/p_phones:phones,p_actor_id:actorId,p_action_key:key,p_channels:channelsByPhone/);
  assert.match(routes,/if \(!isUuid\(actorId\) \|\| key.length < 12 \|\| key.length > 120/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/DUPLICATE_BATCH_CHANNEL/);
  assert.match(sql,/IDEMPOTENCY_CONFLICT/);
  assert.match(sql,/PLATFORM_ADMIN_REQUIRED/);
  assert.doesNotMatch(routes,/\.select\('\*'\)/);
});

test('creation is still triggered only by Save, with no F5 and no additional HTTP calls',()=>{
  assert.match(ui,/const bulkPhones=splitOpportunityPhones\(phonesDraft\)/);
  assert.match(ui,/previewOpportunityDuplicates\(request,phonesDraft\)/);
  assert.match(ui,/const json=await createManualOpportunities\(request,phones,channelsByPhone,key\)/);
  assert.match(ui,/onClick=\{\(\)=>void createOpportunities\(\)\}/);
  assert.match(ui,/onLeadsCreated\(json.leads\|\|\[\]\)/);
  assert.match(ui,/for\(const item of json.leads\|\|\[\]\)next\[item.id\]=item.channelIds\|\|\[\]/);
  assert.match(ui,/if\(\/repetido\|cadastrado\/i\.test/);
  assert.match(transport,/request\('\/api\/owner\/sales\/kanban\/opportunities\/duplicates', \{/);
  assert.match(transport,/request\('\/api\/owner\/sales\/kanban\/opportunities', \{/);
  assert.match(transport,/method:'POST',headers:\{'X-Idempotency-Key':key\},body:JSON.stringify\(\{phones,channelsByPhone\}\)/);
  assert.doesNotMatch(ui,/request\('\/api\/owner\/sales\/kanban\/opportunities(?:\/duplicates)?'/);
});
