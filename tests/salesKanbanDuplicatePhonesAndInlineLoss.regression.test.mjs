import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const api=readFileSync(new URL('../services/salesProspectingRoutes.ts',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/components/CommercialKanban.tsx',import.meta.url),'utf8');
const lossRoutes=readFileSync(new URL('../services/salesLossReasonsRoutes.ts',import.meta.url),'utf8');
const creation=readFileSync(new URL('../supabase/migrations/20261027193000_sales_kanban_opportunity_crud_v1.sql',import.meta.url),'utf8');

test('telephone duplicates are checked server-side, with a single scoped batch query',()=>{
  assert.match(api,/app\.post\('\/api\/owner\/sales\/kanban\/opportunities\/duplicates', \.\.\.salesGuard/);
  assert.match(api,/phones\.length > 100/);
  assert.match(api,/value\.length > 40/);
  assert.match(api,/value\.replace\(\/\[\^0-9\]\/g, ''\)/);
  assert.match(api,/digits\.length === 10 \|\| digits\.length === 11/);
  assert.match(api,/new Map<string,number>\(\)/);
  assert.match(api,/\.in\('normalized_phone',unique\)\.is\('deleted_at',null\)\.limit\(101\)/);
  assert.match(api,/inBatch:phone!==null && \(counts\.get\(phone\)\|\|0\)>1/);
  assert.match(api,/existing:phone===null\?null:existingByPhone\.get\(phone\)\|\|null/);
  assert.match(api,/Cache-Control','private, no-store'/);
  assert.doesNotMatch(api,/app\.post\('\/api\/owner\/sales\/kanban\/opportunities\/duplicates'[\s\S]*?\.select\('\*'\)/);
});

test('paste and individual creation mark duplicates without auto-deleting or saving them',()=>{
  assert.match(ui,/request\('\/api\/owner\/sales\/kanban\/opportunities\/duplicates'/);
  assert.match(ui,/\},350\);/);
  assert.match(ui,/checkedDuplicates\?\.\[index\]\?\.inBatch/);
  assert.match(ui,/checkedDuplicates\?\.\[index\]\?\.existing/);
  assert.match(ui,/Já cadastrado/);
  assert.match(ui,/Repetido no lote/);
  assert.match(ui,/blockedByDuplicate/);
  assert.match(ui,/disabled=\{creatingBusy\|\|!phonesDraft\.trim\(\)\|\|!checkedDuplicates/);
  assert.match(ui,/setDuplicateCheckRetry\(v=>v\+1\)/);
  assert.match(creation,/PHONE_ALREADY_EXISTS/);
  assert.match(creation,/DUPLICATE_IN_BATCH/);
  assert.match(creation,/pg_advisory_xact_lock/);
  assert.match(creation,/public\.sales_kanban_creation_batches/);
});

test('loss popup allows catalog creation, auto-selects the new reason and only saves loss on confirmation',()=>{
  assert.match(ui,/role="dialog" aria-modal="true" aria-label="Selecionar motivo da perda"/);
  assert.match(ui,/Não encontrou o motivo\? Cadastre aqui/);
  assert.match(ui,/const createInlineLossReason=async\(\)=>/);
  assert.match(ui,/request\('\/api\/owner\/sales\/loss-reasons',\{/);
  assert.match(ui,/method:'POST',body:JSON\.stringify\(\{name\}\)/);
  assert.match(ui,/setLossReasonDraft\(json\.reason\.id\)/);
  assert.match(ui,/setInlineLossError\(e\.message\|\|'Não foi possível cadastrar o motivo\.'\)/);
  assert.match(ui,/A oportunidade só será marcada como perdida ao clicar em Salvar perda\./);
  assert.match(ui,/onClick=\{\(\)=>void saveLoss\(\)\}/);
  assert.match(ui,/disabled=\{Boolean\(busyLead\)\|\|inlineLossBusy\|\|!lossReasons\.some/);
  assert.match(lossRoutes,/app\.post\('\/api\/owner\/sales\/loss-reasons',\.\.\.guard/);
  assert.match(lossRoutes,/save_sales_loss_reason_v1/);
  assert.match(ui,/onLeadPatch\(id,\{status:json\.data\.status,lostAt:json\.data\.lostAt,updatedAt:json\.data\.updatedAt,lossReasonId:json\.data\.lossReasonId\}\)/);
});
