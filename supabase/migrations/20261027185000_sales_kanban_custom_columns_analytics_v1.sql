-- Owner-only, configurable Kanban and aggregate commercial intelligence.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.sales_kanban_columns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  kind text not null check (kind in ('prospecting','contact','proposals','lost','customers','custom')),
  title text not null check (char_length(title) between 1 and 60),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  position integer not null default 0,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_system or kind <> 'custom')
);
create unique index if not exists sales_kanban_system_kind_unique on
  public.sales_kanban_columns(kind) where is_system;
insert into public.sales_kanban_columns(slug,kind,title,color,position,is_system)
values
 ('prospecting','prospecting','Prospecção','#943B75',0,true),
 ('contact','contact','Contato e negociação','#1D65C1',1,true),
 ('proposals','proposals','Apresentações e propostas','#0F8478',2,true),
 ('lost','lost','Perdidos','#BD404D',3,true),
 ('customers','customers','Clientes','#7650B5',4,true)
on conflict (slug) do nothing;

create table if not exists public.sales_kanban_placements (
  lead_id uuid primary key references public.sales_leads(id) on delete cascade,
  column_id uuid not null references public.sales_kanban_columns(id) on delete cascade,
  moved_at timestamptz not null default clock_timestamp()
);
create index if not exists sales_kanban_placements_column_idx on public.sales_kanban_placements(column_id);

create table if not exists public.sales_kanban_movements (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  from_column text,
  to_column text not null,
  idempotency_key text not null unique,
  moved_at timestamptz not null default clock_timestamp()
);
create index if not exists sales_kanban_movements_lead_idx on public.sales_kanban_movements(lead_id,moved_at desc);

alter table public.sales_kanban_columns enable row level security;
alter table public.sales_kanban_placements enable row level security;
alter table public.sales_kanban_movements enable row level security;
revoke all on public.sales_kanban_columns,public.sales_kanban_placements,public.sales_kanban_movements from public,anon,authenticated;
grant select,insert,update,delete on public.sales_kanban_columns,public.sales_kanban_placements,public.sales_kanban_movements to service_role;

create or replace function public.move_sales_kanban_lead_v1(
  p_lead_id uuid, p_column_id uuid, p_actor_id uuid, p_action_key text
) returns jsonb language plpgsql security definer
  set search_path = pg_catalog, public as $$
declare
  v_lead public.sales_leads%rowtype;
  v_column public.sales_kanban_columns%rowtype;
  v_previous text;
  v_existing public.sales_kanban_movements%rowtype;
  v_at timestamptz := clock_timestamp();
begin
  if p_action_key is null or char_length(p_action_key) not between 12 and 120 then
    raise exception 'INVALID_KANBAN_ACTION_KEY';
  end if;
  select * into v_lead from public.sales_leads
   where id=p_lead_id and deleted_at is null for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;
  select * into v_column from public.sales_kanban_columns where id=p_column_id;
  if not found then raise exception 'COLUMN_NOT_FOUND'; end if;
  select * into v_existing from public.sales_kanban_movements where idempotency_key=p_action_key;
  if found then
    if v_existing.lead_id <> p_lead_id or v_existing.to_column <> v_column.slug
      or v_existing.actor_user_id is distinct from p_actor_id then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('status',v_lead.status,'columnId',p_column_id,'lostAt',v_lead.lost_at,'updatedAt',v_lead.updated_at);
  end if;
  if v_lead.status='converted' or v_lead.converted_user_id is not null or v_lead.converted_clinic_id is not null then
    raise exception 'CONVERTED_LEAD_IMMUTABLE';
  end if;
  if v_column.kind='customers' then raise exception 'PAYMENT_REQUIRED_FOR_CONVERSION'; end if;
  if v_column.kind='custom' and v_lead.status in ('lost','archived') then
    raise exception 'CANNOT_HIDE_CLOSED_LEAD_IN_CUSTOM';
  end if;
  select c.slug into v_previous
    from public.sales_kanban_placements p
      join public.sales_kanban_columns c on c.id=p.column_id
    where p.lead_id=p_lead_id;
  if v_previous is null then
    v_previous := case
      when v_lead.status='new' then 'prospecting'
      when v_lead.status='contact_started' then 'contact'
      when v_lead.status in ('lost','archived') then 'lost'
      when v_lead.status='converted' then 'customers'
      else 'proposals' end;
  end if;
  if v_column.kind='custom' then
    insert into public.sales_kanban_placements(lead_id,column_id,moved_at)
      values(p_lead_id,p_column_id,v_at)
      on conflict (lead_id) do update set column_id=excluded.column_id,moved_at=excluded.moved_at;
  else
    delete from public.sales_kanban_placements where lead_id=p_lead_id;
    update public.sales_leads set
      status = (case v_column.kind
        when 'prospecting' then 'new'
        when 'contact' then 'contact_started'
        when 'proposals' then 'demo_scheduled'
        when 'lost' then 'lost'
        else v_lead.status::text end)::public.sales_lead_status,
      updated_at=v_at
    where id=p_lead_id returning * into v_lead;
  end if;
  insert into public.sales_kanban_movements(lead_id,actor_user_id,from_column,to_column,idempotency_key,moved_at)
  values(p_lead_id,p_actor_id,v_previous,v_column.slug,p_action_key,v_at);
  return jsonb_build_object('status',v_lead.status,'columnId',p_column_id,
     'lostAt',v_lead.lost_at,'updatedAt',v_lead.updated_at);
end $$;

create or replace function public.order_sales_kanban_columns_v1(p_ids uuid[])
returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.sales_kanban_columns;
  if p_ids is null or cardinality(p_ids) <> v_count
    or (select count(distinct x) from unnest(p_ids) x) <> v_count
    or exists (select 1 from unnest(p_ids) x
      where not exists (select 1 from public.sales_kanban_columns where id=x)) then
    raise exception 'INVALID_COLUMN_ORDER';
  end if;
  perform 1 from public.sales_kanban_columns for update;
  update public.sales_kanban_columns c set position=x.ordinality-1,updated_at=clock_timestamp()
    from unnest(p_ids) with ordinality as x(id,ordinality) where c.id=x.id;
  return v_count;
end $$;

create or replace function public.sales_prospecting_analytics_v1(p_days integer default 90)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_since timestamptz;
  v_overview jsonb;
  v_daily jsonb;
  v_hours jsonb;
  v_weekdays jsonb;
  v_channels jsonb;
  v_attempts jsonb;
  v_stages jsonb;
begin
  if p_days not in (7,30,90,365) then raise exception 'INVALID_ANALYTICS_WINDOW'; end if;
  v_since := now() - make_interval(days=>p_days);
  with scoped as (
    select lead_id,channel,outcome,occurred_at from public.sales_prospecting_attempts
    where occurred_at >= v_since
  )
  select jsonb_build_object(
    'totalLeads',(select count(*) from public.sales_leads where deleted_at is null),
    'attemptedLeads',(select count(distinct lead_id) from scoped),
    'contactedLeads',(select count(distinct lead_id) from scoped where outcome='decisor_spoken'),
    'totalCalls',(select count(*) from scoped),
    'successfulCalls',(select count(*) from scoped where outcome='decisor_spoken'),
    'convertedLeads',(select count(*) from public.sales_leads where deleted_at is null and status='converted'),
    'lostLeads',(select count(*) from public.sales_leads where deleted_at is null and status='lost')
  ) into v_overview;
  select coalesce(jsonb_agg(jsonb_build_object('day',day_bucket,'calls',calls,'conversations',conversations) order by day_bucket),'[]'::jsonb)
    into v_daily from (
      select to_char(occurred_at at time zone 'America/Sao_Paulo','YYYY-MM-DD') as day_bucket,
        count(*) calls,count(*) filter(where outcome='decisor_spoken') conversations
      from public.sales_prospecting_attempts where occurred_at >= v_since group by 1
    ) x;
  select coalesce(jsonb_agg(jsonb_build_object('hour',hour_bucket,'calls',calls,'conversations',conversations) order by hour_bucket),'[]'::jsonb)
    into v_hours from (
      select extract(hour from occurred_at at time zone 'America/Sao_Paulo')::int as hour_bucket,
        count(*) calls,count(*) filter(where outcome='decisor_spoken') conversations
      from public.sales_prospecting_attempts where occurred_at >= v_since group by 1
    ) x;
  select coalesce(jsonb_agg(jsonb_build_object('weekday',weekday_bucket,'calls',calls,'conversations',conversations) order by weekday_bucket),'[]'::jsonb)
    into v_weekdays from (
      select extract(isodow from occurred_at at time zone 'America/Sao_Paulo')::int as weekday_bucket,
        count(*) calls,count(*) filter(where outcome='decisor_spoken') conversations
      from public.sales_prospecting_attempts where occurred_at >= v_since group by 1
    ) x;
  select coalesce(jsonb_agg(jsonb_build_object('channel',channel,'calls',calls,'conversations',conversations) order by channel),'[]'::jsonb)
    into v_channels from (
      select channel,count(*) calls,count(*) filter(where outcome='decisor_spoken') conversations
      from public.sales_prospecting_attempts where occurred_at >= v_since group by channel
    ) x;
  select coalesce(jsonb_agg(jsonb_build_object('attempt',attempt_no,'calls',calls,'conversations',conversations) order by attempt_no),'[]'::jsonb)
    into v_attempts from (
      select attempt_no,count(*) calls,count(*) filter(where outcome='decisor_spoken') conversations
      from (
        select row_number() over(partition by lead_id order by occurred_at,id)::int as attempt_no,outcome
        from public.sales_prospecting_attempts where occurred_at >= v_since
      ) y group by attempt_no
    ) x;
  select coalesce(jsonb_agg(jsonb_build_object('status',status_key,'leads',leads) order by status_key),'[]'::jsonb)
    into v_stages from (
      select status::text as status_key,count(*) leads
      from public.sales_leads where deleted_at is null group by status
    ) x;
  return jsonb_build_object('days',p_days,'overview',v_overview,'daily',v_daily,
    'hours',v_hours,'weekdays',v_weekdays,'channels',v_channels,'attempts',v_attempts,'stages',v_stages);
end $$;

revoke all on function public.move_sales_kanban_lead_v1(uuid,uuid,uuid,text),
  public.order_sales_kanban_columns_v1(uuid[]),
  public.sales_prospecting_analytics_v1(integer)
  from public,anon,authenticated;
grant execute on function public.move_sales_kanban_lead_v1(uuid,uuid,uuid,text),
  public.order_sales_kanban_columns_v1(uuid[]),
  public.sales_prospecting_analytics_v1(integer)
  to service_role;
notify pgrst,'reload schema';
commit;