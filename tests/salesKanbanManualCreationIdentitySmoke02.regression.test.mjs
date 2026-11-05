import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ui = readFileSync('src/components/CommercialKanban.tsx','utf8');
const route = readFileSync('services/salesKanbanOpportunityCreationRoutes.ts','utf8');
const transport = readFileSync('src/services/salesKanbanOpportunityCreation.ts','utf8');
const migration = readFileSync('supabase/migrations/20261105101500_sales_kanban_creation_details_atomic_v3.sql','utf8');

test('Smoke 02: create dialog visibly contains contact, clinic, phone and email before Save',()=>{
  const start=ui.indexOf('{creatingOpen&&<div className="fixed inset-0');
  const end=ui.indexOf('{editingId&&<div className="fixed inset-0',start);
  assert.ok(start>=0&&end>start);
  const modal=ui.slice(start,end);
  assert.match(modal,/role="dialog" aria-modal="true" aria-label="Cadastrar oportunidades"/);
  assert.match(modal,/Dados da primeira oportunidade/);
  assert.match(modal,/'name','Nome do contato'/);
  assert.match(modal,/'clinicName','Nome da clínica'/);
  assert.match(modal,/'email','E-mail \(opcional\)'/);
  assert.match(modal,/Telefones \(até 100 por cadastro\)/);
  assert.match(modal,/Dados deste contato \(nome, clínica e e-mail\)/);
  assert.match(modal,/Salvar oportunidades/);
  assert.match(modal,/onClick=\{\(\)=>void createOpportunities\(\)\}/);
});

test('Save is the only mutation point; all contact details go in one authorized POST',()=>{
  const start=ui.indexOf('const createOpportunities = async () => {');
  const end=ui.indexOf('const saveLeadDetails',start);
  const save=ui.slice(start,end);
  assert.match(save,/const detailsByPhone=phones.map/);
  assert.match(save,/firstCreationContact/);
  assert.match(save,/additionalCreationContacts\[index\]/);
  assert.match(save,/const json=await createManualOpportunities\(request,phones,channelsByPhone,key,detailsByPhone\)/);
  assert.ok(save.indexOf('const json=await createManualOpportunities') < save.indexOf('onLeadsCreated(json.leads||[])'));
  assert.match(save,/setPhonesDraft\(''\);setFirstCreationContact/);
  assert.doesNotMatch(ui,/window.location.reload\(|window.location.href\s*=\s*window.location.href/);
  assert.match(transport,/detailsByPhone \? \{phones,channelsByPhone,detailsByPhone\} : \{phones,channelsByPhone\}/);
  assert.match(route,/withDetails \? 'create_sales_kanban_opportunities_v3' : 'create_sales_kanban_opportunities_v2'/);
});

test('new v3 is atomic, idempotent, scoped to platform admin and denies browser SQL execution',()=>{
  assert.match(migration,/^begin;/m);
  assert.match(migration,/^commit;/m);
  assert.match(migration,/add column if not exists details_hash text/);
  assert.match(migration,/create or replace function public\.create_sales_kanban_opportunities_v3/);
  assert.match(migration,/language plpgsql security definer/);
  assert.match(migration,/set search_path = pg_catalog, public/);
  assert.match(migration,/public\.platform_admins where user_id = p_actor_id and active = true/);
  assert.match(migration,/v_batch\.actor_user_id is distinct from p_actor_id/);
  assert.match(migration,/v_batch\.request_hash <> v_request_hash/);
  assert.match(migration,/v_batch\.details_hash is distinct from v_details_hash/);
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/v_created := public\.create_sales_kanban_opportunities_v2/);
  assert.match(migration,/update public\.sales_leads l set[\s\S]*from provided/);
  assert.match(migration,/where l\.id = provided\.lead_id/);
  assert.match(migration,/normalized_email = coalesce\(provided\.contact_email, l\.normalized_email\)/);
  assert.match(migration,/update public\.sales_kanban_creation_channel_batches set[\s\S]*details_hash = v_details_hash,[\s\S]*response = v_result/);
  assert.match(migration,/revoke all on function public\.create_sales_kanban_opportunities_v3\([\s\S]*?\) from public, anon, authenticated;/);
  assert.match(migration,/grant execute on function public\.create_sales_kanban_opportunities_v3\([\s\S]*?\) to service_role;/);
  assert.doesNotMatch(migration,/grant execute on function[\s\S]*?to (?:anon|authenticated);/i);
  assert.equal((migration.match(/update public\.sales_leads l set/g)||[]).length,1,'single set-based update for batch, not N+1');
});

test('server rejects injected and duplicate contact information before touching the RPC',()=>{
  assert.match(route,/Object\.keys\(row\)\.some\(k=>!\['name','clinicName','email'\]\.includes\(k\)\)/);
  assert.match(route,/Object\.values\(row\)\.some\(v=>v!==null && typeof v!=='string'\)/);
  assert.match(route,/detailsByPhone\.length!==phones\.length/);
  assert.match(route,/emails\.has\(email\)/);
  assert.match(route,/new Set<string>\(\)/);
  assert.match(route,/p_phones:phones,p_actor_id:actorId,p_action_key:key,p_channels:channelsByPhone/);
  assert.match(route,/withDetails \? \{p_details:detailsByPhone\} : \{\}/);
  assert.match(migration,/exists \(select 1 from jsonb_object_keys\(v_entry\)/);
  assert.match(migration,/DUPLICATE_EMAIL_IN_BATCH/);
  assert.match(migration,/INVALID_CREATION_DETAILS/);
  assert.match(migration,/into v_result/); // result assembled after the single SQL update
});
