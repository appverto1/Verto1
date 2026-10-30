-- Additive only: preserve every pre-existing opportunity, status, event and payment.
begin;

create table if not exists public.sales_loss_reasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_loss_reasons_name_valid check (
    name=btrim(name) and char_length(name) between 2 and 100
  )
);
create unique index if not exists sales_loss_reasons_name_ci
  on public.sales_loss_reasons (lower(name));
alter table public.sales_loss_reasons enable row level security;
revoke all on public.sales_loss_reasons from public,anon,authenticated;
grant select,insert,update on public.sales_loss_reasons to service_role;

alter table public.sales_leads
  add column if not exists loss_reason_id uuid references public.sales_loss_reasons(id) on delete restrict;
create index if not exists sales_leads_lost_reason_idx
  on public.sales_leads(loss_reason_id) where status='lost' and deleted_at is null;
-- Do not backfill: historical losses have no known reason.

create table if not exists public.sales_loss_reason_audit (
  id bigint generated always as identity primary key,
  reason_id uuid not null references public.sales_loss_reasons(id) on delete restrict,
  actor_user_id uuid not null,
  previous_name text,
  current_name text not null,
  previous_active boolean,
  current_active boolean not null,
  changed_at timestamptz not null default now()
);
alter table public.sales_loss_reason_audit enable row level security;
revoke all on public.sales_loss_reason_audit from public,anon,authenticated;
grant select,insert on public.sales_loss_reason_audit to service_role;

create or replace function public.save_sales_loss_reason_v1(
  p_actor_user_id uuid, p_reason_id uuid, p_name text, p_active boolean
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_old public.sales_loss_reasons%rowtype;
  v_new public.sales_loss_reasons%rowtype;
  v_name text;
begin
  if p_actor_user_id is null or not exists(
    select 1 from public.platform_admins
    where user_id=p_actor_user_id and active=true
  ) then raise exception 'PLATFORM_ADMIN_REQUIRED';end if;
  v_name:=btrim(coalesce(p_name,''));
  if char_length(v_name) not between 2 and 100 or p_active is null then
    raise exception 'INVALID_LOSS_REASON';
  end if;
  if p_reason_id is null then
    insert into public.sales_loss_reasons(name,is_active)
      values(v_name,p_active) returning * into v_new;
  else
    select * into v_old from public.sales_loss_reasons
      where id=p_reason_id for update;
    if not found then raise exception 'LOSS_REASON_NOT_FOUND';end if;
    update public.sales_loss_reasons
      set name=v_name,is_active=p_active,updated_at=clock_timestamp()
      where id=p_reason_id returning * into v_new;
  end if;
  insert into public.sales_loss_reason_audit
    (reason_id,actor_user_id,previous_name,current_name,previous_active,current_active)
  values(v_new.id,p_actor_user_id,v_old.name,v_new.name,v_old.is_active,v_new.is_active);
  return jsonb_build_object('id',v_new.id,'name',v_new.name,
    'is_active',v_new.is_active,'updated_at',v_new.updated_at);
end $$;

-- One transaction for loss status, reason, legacy placement and audit.
create or replace function public.mark_sales_lead_lost_with_reason_v1(
  p_lead_id uuid, p_reason_id uuid, p_actor_user_id uuid, p_action_key text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_lead public.sales_leads%rowtype;
  v_reason public.sales_loss_reasons%rowtype;
  v_event public.sales_lead_events%rowtype;
  v_from text;
  v_at timestamptz:=clock_timestamp();
  v_event_key text:='loss-reason:'||coalesce(p_action_key,'');
begin
  if p_actor_user_id is null or not exists(
    select 1 from public.platform_admins
    where user_id=p_actor_user_id and active=true
  ) then raise exception 'PLATFORM_ADMIN_REQUIRED';end if;
  if p_lead_id is null or p_reason_id is null
    or p_action_key is null or char_length(p_action_key) not between 12 and 120
  then raise exception 'INVALID_LOSS_REASON_REQUEST';end if;
  select * into v_lead from public.sales_leads
    where id=p_lead_id and deleted_at is null for update;
  if not found then raise exception 'LEAD_NOT_FOUND';end if;
  if v_lead.status='converted' or v_lead.converted_clinic_id is not null
    or v_lead.converted_user_id is not null then
    raise exception 'CONVERTED_LEAD_CANNOT_BE_LOST';
  end if;
  select * into v_event from public.sales_lead_events
    where idempotency_key=v_event_key;
  if found then
    if v_event.lead_id<>p_lead_id
      or v_event.actor_user_id is distinct from p_actor_user_id
      or v_event.metadata->>'lossReasonId'<>p_reason_id::text
    then raise exception 'IDEMPOTENCY_CONFLICT';end if;
    return jsonb_build_object('status',v_lead.status,'lostAt',v_lead.lost_at,
      'updatedAt',v_lead.updated_at,'lossReasonId',v_lead.loss_reason_id);
  end if;
  select * into v_reason from public.sales_loss_reasons
    where id=p_reason_id and is_active=true for share;
  if not found then raise exception 'LOSS_REASON_UNAVAILABLE';end if;
  select c.slug into v_from from public.sales_kanban_placements p
    join public.sales_kanban_columns c on c.id=p.column_id where p.lead_id=p_lead_id;
  if v_from is null then
    v_from:=case when v_lead.status='new' then 'prospecting'
      when v_lead.status='contact_started' then 'contact'
      when v_lead.status in ('lost','archived') then 'lost'
      when v_lead.status='converted' then 'customers' else 'proposals' end;
  end if;
  update public.sales_leads set status='lost',
    lost_at=coalesce(lost_at,v_at),
    loss_reason_id=p_reason_id,updated_at=v_at
  where id=p_lead_id returning * into v_lead;
  delete from public.sales_kanban_placements where lead_id=p_lead_id;
  if v_from<>'lost' then
    insert into public.sales_kanban_movements
      (lead_id,actor_user_id,from_column,to_column,idempotency_key,moved_at)
    values(p_lead_id,p_actor_user_id,v_from,'lost','loss-move:'||p_action_key,v_at);
  end if;
  insert into public.sales_lead_events
    (lead_id,event_type,actor_user_id,metadata,idempotency_key)
  values(p_lead_id,'lead_lost',p_actor_user_id,
    jsonb_build_object('reason','manual','lossReasonId',v_reason.id,'lossReasonName',v_reason.name),
    v_event_key);
  return jsonb_build_object('status',v_lead.status,'lostAt',v_lead.lost_at,
    'updatedAt',v_lead.updated_at,'lossReasonId',v_lead.loss_reason_id);
end $$;

-- Current visible losses only; legacy rows without a reason remain counted.
create or replace function public.sales_loss_reasons_analytics_v1(p_actor_user_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_rows jsonb;
begin
  if p_actor_user_id is null or not exists(
    select 1 from public.platform_admins where user_id=p_actor_user_id and active=true
  ) then raise exception 'PLATFORM_ADMIN_REQUIRED';end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'reasonId',s.reason_id,'name',coalesce(r.name,'Sem motivo informado'),'leads',s.total
  ) order by s.total desc,coalesce(r.name,'Sem motivo informado')),'[]'::jsonb)
  into v_rows from (
    select l.loss_reason_id as reason_id,count(*)::int as total
    from public.sales_leads l
    where l.status='lost' and l.deleted_at is null
      and not exists(select 1 from public.sales_kanban_opportunity_overrides hidden
        where hidden.lead_id=l.id and hidden.hidden_at is not null)
    group by l.loss_reason_id
  ) s left join public.sales_loss_reasons r on r.id=s.reason_id;
  return v_rows;
end $$;

create or replace function public.sales_loss_reason_drilldown_v1(
  p_actor_user_id uuid,p_reason_id uuid,p_offset integer default 0,p_limit integer default 25
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_total bigint;v_rows jsonb;
begin
  if p_actor_user_id is null or not exists(
    select 1 from public.platform_admins where user_id=p_actor_user_id and active=true
  ) then raise exception 'PLATFORM_ADMIN_REQUIRED';end if;
  if p_offset is null or p_offset<0 or p_offset>100000 or
    p_limit is null or p_limit<1 or p_limit>50
  then raise exception 'INVALID_DRILLDOWN_FILTER';end if;
  select count(*) into v_total from public.sales_leads l
    where l.status='lost' and l.deleted_at is null
      and l.loss_reason_id is not distinct from p_reason_id
      and not exists(select 1 from public.sales_kanban_opportunity_overrides h
        where h.lead_id=l.id and h.hidden_at is not null);
  select coalesce(jsonb_agg(to_jsonb(page) order by page.updated_at desc,page.id),'[]'::jsonb)
    into v_rows from (
      select l.id,l.name,l.clinic_name,l.phone,l.email,l.status::text as status,
        l.created_at,l.updated_at,l.lost_at,1::int as matching_events
      from public.sales_leads l
      where l.status='lost' and l.deleted_at is null
        and l.loss_reason_id is not distinct from p_reason_id
        and not exists(select 1 from public.sales_kanban_opportunity_overrides h
          where h.lead_id=l.id and h.hidden_at is not null)
      order by l.updated_at desc,l.id limit p_limit offset p_offset
    ) page;
  return jsonb_build_object('totalLeads',v_total,'matchingEvents',v_total,
    'items',v_rows,'offset',p_offset,'limit',p_limit);
end $$;

revoke all on function public.save_sales_loss_reason_v1(uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.mark_sales_lead_lost_with_reason_v1(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.sales_loss_reasons_analytics_v1(uuid) from public,anon,authenticated;
revoke all on function public.sales_loss_reason_drilldown_v1(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.save_sales_loss_reason_v1(uuid,uuid,text,boolean) to service_role;
grant execute on function public.mark_sales_lead_lost_with_reason_v1(uuid,uuid,uuid,text) to service_role;
grant execute on function public.sales_loss_reasons_analytics_v1(uuid) to service_role;
grant execute on function public.sales_loss_reason_drilldown_v1(uuid,uuid,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;
