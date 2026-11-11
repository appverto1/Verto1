-- A confirmed partner referral is the canonical CRM acquisition channel.
-- Preserve all other marketing channels, existing lead data and referral attribution.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.verto_partner_referral_acquisition_channel_v1()
returns trigger
language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare v_indication_id uuid;
begin
  select id into v_indication_id
    from public.sales_acquisition_channels
   where name = 'Indicação'
   order by id limit 1;
  if v_indication_id is null then
    -- Referral attribution must never fail solely because a CRM catalog entry is missing.
    return new;
  end if;

  insert into public.sales_lead_acquisition_channels (lead_id,channel_id)
  values (new.sales_lead_id,v_indication_id)
  on conflict (lead_id,channel_id) do nothing;

  delete from public.sales_lead_acquisition_channels
   where lead_id = new.sales_lead_id
     and channel_id in (
       select id from public.sales_acquisition_channels where name = 'Cadastro no site'
     );
  return new;
end;
$$;

drop trigger if exists verto_partner_referral_acquisition_channel_v1
  on public.verto_partner_referrals;
create trigger verto_partner_referral_acquisition_channel_v1
after insert on public.verto_partner_referrals
for each row execute function public.verto_partner_referral_acquisition_channel_v1();

-- Backfill only confirmed partner referrals. Existing non-referral leads stay untouched.
insert into public.sales_lead_acquisition_channels (lead_id,channel_id)
select r.sales_lead_id, c.id
from public.verto_partner_referrals r
cross join public.sales_acquisition_channels c
where c.name = 'Indicação'
on conflict (lead_id,channel_id) do nothing;

delete from public.sales_lead_acquisition_channels a
where a.channel_id in (
    select id from public.sales_acquisition_channels where name = 'Cadastro no site'
  )
  and exists (
    select 1 from public.verto_partner_referrals r where r.sales_lead_id = a.lead_id
  )
  and exists (
    select 1 from public.sales_lead_acquisition_channels marked
    join public.sales_acquisition_channels channel on channel.id=marked.channel_id
    where marked.lead_id=a.lead_id and channel.name = 'Indicação'
  );

revoke all on function public.verto_partner_referral_acquisition_channel_v1()
  from public,anon,authenticated;
commit;
