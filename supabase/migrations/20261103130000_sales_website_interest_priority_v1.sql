-- Website interest is a commercial acquisition source, not a new clinic or patient.
-- Site priority is independent of the editable, multi-touch acquisition selections.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

insert into public.sales_acquisition_channels(name)
values ('Cadastro no site')
on conflict do nothing;

-- NULL represents a system-assigned channel; manual edits still require a valid actor.
alter table public.sales_lead_acquisition_channels
  alter column assigned_by drop not null;
comment on column public.sales_lead_acquisition_channels.assigned_by
  is 'NULL only for automated website acquisition; manual channel edits retain their actor.';

alter table public.sales_leads
  add column site_interest_at timestamptz;
create index sales_leads_site_interest_priority_idx
  on public.sales_leads(site_interest_at desc,id)
  where deleted_at is null and site_interest_at is not null;

create or replace function public.mark_website_interest_acquisition_v1()
returns trigger
language plpgsql security invoker
set search_path=pg_catalog,public
as $$
declare v_channel_id uuid;
begin
  -- Only the server-owned public signup RPC issues this namespace of events.
  if new.idempotency_key not like 'public-sales:%'
     or coalesce(new.metadata->>'source','') not in ('public_landing','google_interest')
  then return new; end if;

  select id into v_channel_id from public.sales_acquisition_channels
   where lower(btrim(name))='cadastro no site' limit 1;
  if v_channel_id is null then
    raise exception 'WEBSITE_ACQUISITION_CHANNEL_MISSING';
  end if;

  update public.sales_leads
     set site_interest_at=greatest(
       coalesce(site_interest_at,'-infinity'::timestamptz),new.created_at
     )
   where id=new.lead_id and deleted_at is null;

  if found then
    insert into public.sales_lead_acquisition_channels(lead_id,channel_id,assigned_by)
    values(new.lead_id,v_channel_id,null)
    on conflict(lead_id,channel_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.mark_website_interest_acquisition_v1()
  from public,anon,authenticated;

create trigger mark_website_interest_acquisition_v1
after insert on public.sales_lead_events
for each row execute function public.mark_website_interest_acquisition_v1();

-- Backfill only verified website submissions, preserving status, placement and other sources.
with website_events as (
  select e.lead_id,max(e.created_at) as last_interest_at
  from public.sales_lead_events e
  where e.idempotency_key like 'public-sales:%'
    and e.metadata->>'source' in ('public_landing','google_interest')
  group by e.lead_id
)
update public.sales_leads l
set site_interest_at=website_events.last_interest_at
from website_events
where l.id=website_events.lead_id and l.deleted_at is null;

insert into public.sales_lead_acquisition_channels(lead_id,channel_id,assigned_by)
select l.id,c.id,null
from public.sales_leads l
cross join public.sales_acquisition_channels c
where l.site_interest_at is not null and l.deleted_at is null
  and lower(btrim(c.name))='cadastro no site'
on conflict(lead_id,channel_id) do nothing;

-- Read-only indexed list; consumed only by owner-authorized Kanban board endpoint.
create or replace function public.site_interest_prospecting_priority_v1()
returns table (
 id uuid,name text,email text,phone text,clinic_name text,
 status public.sales_lead_status,created_at timestamptz,
 updated_at timestamptz,site_interest_at timestamptz
)
language sql stable security invoker
set search_path=pg_catalog,public
as $$
select l.id,l.name,l.email,l.phone,l.clinic_name,l.status,
       l.created_at,l.updated_at,l.site_interest_at
from public.sales_leads l
where l.deleted_at is null and l.status='new'
  and l.site_interest_at is not null
  and not exists (
    select 1 from public.sales_kanban_opportunity_overrides o
    where o.lead_id=l.id and o.hidden_at is not null
  )
  and not exists (
    select 1 from public.sales_kanban_placements p
    join public.sales_kanban_columns c on c.id=p.column_id
    where p.lead_id=l.id and c.slug<>'prospecting'
  )
order by l.site_interest_at desc,l.id
limit 100
$$;
revoke all on function public.site_interest_prospecting_priority_v1()
  from public,anon,authenticated;
grant execute on function public.site_interest_prospecting_priority_v1()
  to service_role;
commit;
