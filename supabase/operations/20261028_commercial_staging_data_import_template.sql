-- Verto commercial release: operator-driven staging snapshot import.
-- Placeholder __STAGING_JSON_SQL_LITERAL__ is replaced IN MEMORY with a single
-- escaped Postgres SQL string literal; NEVER commit prospect PII to GitHub.
-- Execute in one transaction after schema migrations, with a rollback rehearsal.
-- Source reference safety: own staged UUID wins; only cross-environment phone
-- conflicts map to an existing production lead. Deleted staging records retain ID.
begin;
set local lock_timeout='3s';
set local statement_timeout='180s';

create temp table _crm_payload as select __STAGING_JSON_SQL_LITERAL__::jsonb as d;
create temp table _crm_stage_leads as
select x.*,(item->>'_hidden_at')::timestamptz as _source_hidden_at
from _crm_payload p cross join lateral jsonb_array_elements(p.d->'leads') item
cross join lateral jsonb_populate_record(null::public.sales_leads,item) x;
create temp table _crm_stage_columns as select * from jsonb_populate_recordset(null::public.sales_kanban_columns,(select d->'columns' from _crm_payload));
create temp table _crm_stage_events as select * from jsonb_populate_recordset(null::public.sales_lead_events,(select d->'events' from _crm_payload));
create temp table _crm_stage_attempts as select * from jsonb_populate_recordset(null::public.sales_prospecting_attempts,(select d->'attempts' from _crm_payload));
create temp table _crm_stage_scripts as select * from jsonb_populate_recordset(null::public.sales_script_versions,(select d->'scripts' from _crm_payload));
create temp table _crm_stage_channels as select * from jsonb_populate_recordset(null::public.sales_acquisition_channels,(select d->'channels' from _crm_payload));
create temp table _crm_stage_links as select * from jsonb_populate_recordset(null::public.sales_lead_acquisition_channels,(select d->'links' from _crm_payload));
create temp table _crm_stage_placements as select * from jsonb_populate_recordset(null::public.sales_kanban_placements,(select d->'placements' from _crm_payload));
create temp table _crm_stage_overrides as select * from jsonb_populate_recordset(null::public.sales_kanban_opportunity_overrides,(select d->'overrides' from _crm_payload));
create temp table _crm_stage_followups as select * from jsonb_populate_recordset(null::public.sales_contact_followups,(select d->'followups' from _crm_payload));

do $import$
declare leadcols text;admin_id uuid;
begin
select user_id into strict admin_id from public.platform_admins where active limit 1;
select string_agg(format('%I',column_name),', ' order by ordinal_position) into leadcols
from information_schema.columns where table_schema='public' and table_name='sales_leads'
and column_name not in('converted_user_id','converted_clinic_id','assigned_owner_id');
execute format('insert into public.sales_leads(%1$s) select %1$s from _crm_stage_leads src
where not exists(select 1 from public.sales_leads dest where dest.normalized_phone=src.normalized_phone
  and dest.deleted_at is null and src.deleted_at is null)
on conflict do nothing',leadcols);

insert into public.sales_crm_import_lead_map(source_lead_id,target_lead_id,source_phone_conflict,source_status,source_conflict_snapshot,source_hidden,source_deleted,source_converted_user_id,source_converted_clinic_id,source_updated_at)
select src.id,
 coalesce(
   (select dest.id from public.sales_leads dest where dest.id=src.id limit 1),
   (select dest.id from public.sales_leads dest where dest.normalized_phone=src.normalized_phone
     and dest.deleted_at is null and src.deleted_at is null
     order by dest.created_at,dest.id limit 1),
   src.id),
 exists(select 1 from public.sales_leads dest where dest.normalized_phone=src.normalized_phone
   and dest.id<>src.id and dest.deleted_at is null and src.deleted_at is null),
 src.status::text,
 case when not exists(select 1 from public.sales_leads dest where dest.id=src.id)
   then to_jsonb(src)-'_source_hidden_at' else null end,
 src._source_hidden_at is not null,src.deleted_at is not null,
 src.converted_user_id,src.converted_clinic_id,src.updated_at
from _crm_stage_leads src on conflict(source_environment,source_lead_id) do nothing;

insert into public.sales_kanban_columns(id,slug,kind,title,color,position,is_system,created_at,updated_at)
select src.id,src.slug,src.kind,src.title,src.color,src.position,src.is_system,src.created_at,src.updated_at
from _crm_stage_columns src where not exists(select 1 from public.sales_kanban_columns dest where dest.slug=src.slug)
on conflict do nothing;
update public.sales_kanban_columns dest set title=src.title,color=src.color,position=src.position,updated_at=src.updated_at
from _crm_stage_columns src where dest.slug=src.slug;

insert into public.sales_script_versions(id,name,version_label,source_kind,source_text,source_url,file_path,file_name,file_mime,file_bytes,is_active,created_by,client_action_key,created_at,updated_at)
select id,name,version_label,source_kind,source_text,source_url,file_path,file_name,file_mime,file_bytes,is_active,admin_id,client_action_key,created_at,updated_at
from _crm_stage_scripts on conflict do nothing;
insert into public.sales_acquisition_channels(id,name,is_active,created_at,updated_at)
select src.id,src.name,src.is_active,src.created_at,src.updated_at from _crm_stage_channels src
where not exists(select 1 from public.sales_acquisition_channels dest where lower(btrim(dest.name))=lower(btrim(src.name)))
on conflict do nothing;
update public.sales_acquisition_channels dest set is_active=src.is_active,updated_at=src.updated_at
from _crm_stage_channels src where lower(btrim(dest.name))=lower(btrim(src.name));

insert into public.sales_kanban_placements(lead_id,column_id,moved_at)
select lm.target_lead_id,col.id,src.moved_at
from _crm_stage_placements src
join public.sales_crm_import_lead_map lm on lm.source_lead_id=src.lead_id
join _crm_stage_columns sc on sc.id=src.column_id
join public.sales_kanban_columns col on col.slug=sc.slug
on conflict do nothing;

insert into public.sales_kanban_opportunity_overrides(lead_id,details,hidden_at,updated_at)
select m.target_lead_id,src.details,src.hidden_at,src.updated_at
from _crm_stage_overrides src join public.sales_crm_import_lead_map m on m.source_lead_id=src.lead_id
where m.source_phone_conflict=false on conflict do nothing;

insert into public.sales_prospecting_attempts(id,lead_id,actor_user_id,channel,outcome,idempotency_key,occurred_at,script_version_id,contact_result)
select a.id,m.target_lead_id,null,a.channel,a.outcome,a.idempotency_key,a.occurred_at,a.script_version_id,a.contact_result
from _crm_stage_attempts a join public.sales_crm_import_lead_map m on m.source_lead_id=a.lead_id
on conflict do nothing;

insert into public.sales_contact_followups(id,lead_id,actor_user_id,contact_due_at,status,created_at,updated_at)
select f.id,m.target_lead_id,admin_id,f.contact_due_at,f.status,f.created_at,f.updated_at
from _crm_stage_followups f join public.sales_crm_import_lead_map m on m.source_lead_id=f.lead_id
on conflict do nothing;

insert into public.sales_lead_acquisition_channels(lead_id,channel_id,assigned_at,assigned_by)
select lm.target_lead_id,prodch.id,src.assigned_at,admin_id
from _crm_stage_links src join public.sales_crm_import_lead_map lm on lm.source_lead_id=src.lead_id
join _crm_stage_channels ch on ch.id=src.channel_id
join public.sales_acquisition_channels prodch on lower(btrim(prodch.name))=lower(btrim(ch.name))
on conflict do nothing;

insert into public.sales_lead_events(id,lead_id,event_type,actor_user_id,metadata,idempotency_key,created_at)
select src.id,m.target_lead_id,src.event_type,null,
coalesce(src.metadata,'{}'::jsonb)||jsonb_build_object('importedFrom','staging','sourceActorId',src.actor_user_id,'sourceIdempotencyKey',src.idempotency_key),
'import:staging:'||src.id::text,src.created_at
from _crm_stage_events src join public.sales_crm_import_lead_map m on m.source_lead_id=src.lead_id
on conflict do nothing;

insert into public.sales_crm_import_actor_refs(source_table,source_record_key,source_actor_user_id,mapped_actor_user_id)
select 'sales_prospecting_attempts',id::text,actor_user_id,null
from _crm_stage_attempts on conflict do nothing;
insert into public.sales_crm_import_actor_refs(source_table,source_record_key,source_actor_user_id,mapped_actor_user_id)
select 'sales_script_versions',id::text,created_by,admin_id
from _crm_stage_scripts on conflict do nothing;
insert into public.sales_crm_import_actor_refs(source_table,source_record_key,source_actor_user_id,mapped_actor_user_id)
select 'sales_lead_acquisition_channels',lead_id::text||':'||channel_id::text,assigned_by,admin_id
from _crm_stage_links on conflict do nothing;

if (select count(*) from public.sales_crm_import_actor_refs)<>31 then raise exception 'ACTOR_PROVENANCE_NOT_31';end if;
if (select count(*) from public.sales_crm_import_lead_map)<>47 then raise exception 'MAPPING_COUNT_NOT_47';end if;
if (select count(*) from public.sales_leads)<>59 then raise exception 'LEAD_COUNT_NOT_59';end if;
if (select count(*) from public.sales_prospecting_attempts)<>21 then raise exception 'ATTEMPT_COUNT_NOT_21';end if;
if (select count(*) from public.sales_lead_events)<>252 then raise exception 'EVENT_COUNT_NOT_252';end if;
if (select count(*) from public.sales_lead_acquisition_channels)<>8 then raise exception 'LINKS_COUNT_NOT_8';end if;
if (select count(*) from public.sales_script_versions)<>2 then raise exception 'SCRIPT_COUNT_NOT_2';end if;
if (select count(*) from public.sales_kanban_columns)<>6 then raise exception 'COLUMN_COUNT_NOT_6';end if;
if (select count(*) from public.sales_kanban_placements)<>3 then raise exception 'PLACEMENT_COUNT_NOT_3';end if;
if (select count(*) from public.sales_kanban_opportunity_overrides where hidden_at is not null)<>1 then raise exception 'HIDDEN_NOT_PRESERVED';end if;
if (select count(*) from public.sales_leads where deleted_at is not null)<>1 then raise exception 'DELETED_NOT_PRESERVED';end if;
if (select count(*) from public.sales_leads l where l.status='converted' and l.deleted_at is null
 and not exists(select 1 from public.sales_kanban_opportunity_overrides ov where ov.lead_id=l.id and ov.hidden_at is not null))<>3
then raise exception 'VISIBLE_PRODUCTION_CONVERSIONS_CHANGED';end if;
if (select count(*) from public.sales_offers)<>12 or (select count(*) from public.sales_checkout_links)<>13
then raise exception 'PRODUCTION_FINANCE_CHANGED';end if;
raise notice 'PASS full CRM import: 47 mapped, 46 new, 1 collision, 21 attempts, 110 events, 6 columns, all relations';
end $import$;

-- Replace with COMMIT only after dry-run, permission review, and source snapshot validation.
rollback;
