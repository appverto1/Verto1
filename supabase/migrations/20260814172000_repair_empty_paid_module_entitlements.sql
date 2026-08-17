begin;

set local lock_timeout = '5s';
set local statement_timeout = '45s';

-- Hotfix de produção: um contrato modular pago nunca pode permanecer em
-- mode='contract' com zero módulos efetivos. Reconstrói SOMENTE a partir da
-- proposta modular paga/congelada da própria clínica. Não cria módulos extras,
-- não lê seleção do cliente e não relaxa RLS.
do $verto_entitlement_repair_preflight$
begin
  if to_regclass('public.organization_module_access_profiles') is null
     or to_regclass('public.organization_module_entitlements') is null
     or to_regclass('public.organization_module_entitlement_events') is null
     or to_regclass('public.sales_offers') is null
     or to_regclass('public.sales_offer_items') is null
     or to_regclass('public.sales_leads') is null then
    raise exception 'ORGANIZATION_MODULE_ENTITLEMENTS_BASE_MIGRATION_REQUIRED'
      using errcode = '55000';
  end if;
end
$verto_entitlement_repair_preflight$;

create temporary table if not exists _verto_paid_module_repair_candidates (
  organization_id uuid primary key,
  offer_id uuid not null,
  stripe_subscription_id text not null,
  entitlement_status text not null,
  effective_starts_at timestamptz not null
);
truncate table _verto_paid_module_repair_candidates;

insert into _verto_paid_module_repair_candidates (
  organization_id,
  offer_id,
  stripe_subscription_id,
  entitlement_status,
  effective_starts_at
)
select
  p.organization_id,
  chosen_offer.id,
  chosen_offer.stripe_subscription_id,
  case
    when coalesce(chosen_offer.trial_days, 0) > 0
      and coalesce(chosen_offer.accepted_at, chosen_offer.created_at, now())
          + make_interval(days => coalesce(chosen_offer.trial_days, 0)) > now()
      then 'trial'
    else 'active'
  end,
  coalesce(chosen_offer.accepted_at, chosen_offer.created_at, now())
from public.organization_module_access_profiles p
join lateral (
  select candidate.*
  from (
    -- 1) Fonte canônica já congelada no perfil.
    select o.*, 0 as source_priority
    from public.sales_offers o
    join public.sales_leads l
      on l.id = o.lead_id
     and l.deleted_at is null
     and l.converted_clinic_id = p.organization_id
    where o.id = p.source_offer_id
      and o.offer_type = 'modular'
      and o.status = 'paid'
      and o.accepted_at is not null
      and o.revoked_at is null
      and nullif(btrim(o.stripe_subscription_id), '') is not null

    union all

    -- 2) Compatibilidade para ativações antigas que chegaram a contract antes
    --    de source_offer_id ser persistido: usa somente a oferta paga mais
    --    recente convertida para a MESMA clínica.
    select o.*, 1 as source_priority
    from public.sales_offers o
    join public.sales_leads l
      on l.id = o.lead_id
     and l.deleted_at is null
     and l.converted_clinic_id = p.organization_id
    where p.source_offer_id is null
      and o.offer_type = 'modular'
      and o.status = 'paid'
      and o.accepted_at is not null
      and o.revoked_at is null
      and nullif(btrim(o.stripe_subscription_id), '') is not null
  ) candidate
  where exists (
    select 1
    from public.sales_offer_items i
    where i.offer_id = candidate.id
      and i.item_key in (
        'clinical_core',
        'appointments_communication',
        'financial_management',
        'insurance_tiss',
        'school_management'
      )
  )
  -- Nunca ressuscitar uma assinatura que já possua evidência explícita de
  -- suspensão/cancelamento no ledger imutável de entitlements.
  and not exists (
    select 1
    from public.organization_module_entitlement_events ev
    where ev.organization_id = p.organization_id
      and ev.event_type in ('SUSPENDED', 'CANCELLED')
      and ev.created_at >= coalesce(candidate.accepted_at, candidate.created_at, '-infinity'::timestamptz)
  )
  order by candidate.source_priority, candidate.accepted_at desc, candidate.created_at desc, candidate.id desc
  limit 1
) chosen_offer on true
where p.mode = 'contract'
  and not exists (
    select 1
    from public.organization_module_entitlements e
    where e.organization_id = p.organization_id
      and e.status in ('active', 'trial', 'grace')
      and e.starts_at <= now()
      and (e.ends_at is null or e.ends_at > now())
  );

-- A proposta congelada é a ÚNICA fonte da lista de módulos.
insert into public.organization_module_entitlements (
  organization_id,
  module_key,
  status,
  source_offer_id,
  source_offer_item_id,
  stripe_subscription_id,
  starts_at,
  ends_at,
  created_at,
  updated_at
)
select
  c.organization_id,
  i.item_key,
  c.entitlement_status,
  c.offer_id,
  (array_agg(i.id order by i.sort_order, i.id))[1],
  c.stripe_subscription_id,
  c.effective_starts_at,
  null,
  now(),
  now()
from _verto_paid_module_repair_candidates c
join public.sales_offer_items i
  on i.offer_id = c.offer_id
 and i.item_key in (
   'clinical_core',
   'appointments_communication',
   'financial_management',
   'insurance_tiss',
   'school_management'
 )
group by
  c.organization_id,
  c.offer_id,
  c.stripe_subscription_id,
  c.entitlement_status,
  c.effective_starts_at,
  i.item_key
on conflict (organization_id, module_key) do update set
  status = excluded.status,
  source_offer_id = excluded.source_offer_id,
  source_offer_item_id = excluded.source_offer_item_id,
  stripe_subscription_id = excluded.stripe_subscription_id,
  starts_at = excluded.starts_at,
  ends_at = null,
  updated_at = now();

-- Reafirma o vínculo técnico sem mudar o modo de acesso e incrementa a versão
-- uma única vez; reexecuções não reencontram candidatos após o reparo.
update public.organization_module_access_profiles p
set
  source_offer_id = c.offer_id,
  stripe_subscription_id = c.stripe_subscription_id,
  activated_at = coalesce(p.activated_at, c.effective_starts_at, now()),
  version = p.version + 1,
  updated_at = now()
from _verto_paid_module_repair_candidates c
where p.organization_id = c.organization_id;

insert into public.organization_module_entitlement_events (
  organization_id,
  module_key,
  event_type,
  source_offer_id,
  stripe_subscription_id,
  stripe_event_id,
  idempotency_key,
  payload,
  created_at
)
select
  c.organization_id,
  null,
  'RECOVERED_FROM_PAID_OFFER',
  c.offer_id,
  c.stripe_subscription_id,
  null,
  'module-entitlement-repair:' || c.organization_id::text || ':' || c.offer_id::text,
  jsonb_build_object(
    'reason', 'contract_profile_without_active_entitlements',
    'source', 'frozen_paid_sales_offer',
    'modules', coalesce((
      select jsonb_agg(x.item_key order by x.item_key)
      from (
        select distinct i.item_key
        from public.sales_offer_items i
        where i.offer_id = c.offer_id
          and i.item_key in (
            'clinical_core',
            'appointments_communication',
            'financial_management',
            'insurance_tiss',
            'school_management'
          )
      ) x
    ), '[]'::jsonb)
  ),
  now()
from _verto_paid_module_repair_candidates c
on conflict (idempotency_key) do nothing;

notify pgrst, 'reload schema';
commit;

select
  (select count(*) from _verto_paid_module_repair_candidates) as repaired_organizations,
  (
    select count(*)
    from public.organization_module_access_profiles p
    where p.mode = 'contract'
      and not exists (
        select 1
        from public.organization_module_entitlements e
        where e.organization_id = p.organization_id
          and e.status in ('active', 'trial', 'grace')
          and e.starts_at <= now()
          and (e.ends_at is null or e.ends_at > now())
      )
  ) as contract_profiles_without_active_modules,
  (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'organizationId', c.organization_id,
        'offerId', c.offer_id,
        'modules', (
          select coalesce(jsonb_agg(e.module_key order by e.module_key), '[]'::jsonb)
          from public.organization_module_entitlements e
          where e.organization_id = c.organization_id
            and e.status in ('active', 'trial', 'grace')
            and e.starts_at <= now()
            and (e.ends_at is null or e.ends_at > now())
        )
      ) order by c.organization_id
    ), '[]'::jsonb)
    from _verto_paid_module_repair_candidates c
  ) as repaired_access;
