-- Consultas pos-migration para execucao manual no SQL Editor administrativo.
-- Somente leitura: nao cria, atualiza ou remove dados.

-- 1. Deve existir exatamente um catalogo ativo.
select
  count(*) filter (where status = 'active') as active_catalogs,
  count(*) filter (where status = 'draft') as draft_catalogs,
  count(*) filter (where status = 'archived') as archived_catalogs
from public.sales_pricing_catalog_versions;

-- 2. Catalogo ativo, itens, faixas e ultima versao de custo em lote.
select
  version.version,
  version.name as catalog_name,
  version.status,
  item.item_key,
  item.public_name,
  item.pricing_mode,
  tier.tier_key,
  tier.public_name as tier_name,
  tier.maximum_quantity,
  tier.recurring_amount_cents,
  cost.version as cost_version,
  cost.cost_source,
  cost.source_detail
from public.sales_pricing_catalog_versions version
join public.sales_pricing_catalog_items item
  on item.catalog_version_id = version.id
left join public.sales_pricing_catalog_tiers tier
  on tier.catalog_item_id = item.id
left join lateral (
  select model.*
  from public.sales_pricing_item_cost_models model
  where model.catalog_item_id = item.id
  order by model.version desc
  limit 1
) cost on true
where version.status = 'active'
order by item.sort_order, tier.sort_order;

-- 3. Diagnostico de custos ainda indisponiveis. Nao os trata como zero.
select
  item.item_key,
  item.public_name,
  cost.cost_source,
  cost.source_detail
from public.sales_pricing_catalog_versions version
join public.sales_pricing_catalog_items item
  on item.catalog_version_id = version.id
left join lateral (
  select model.*
  from public.sales_pricing_item_cost_models model
  where model.catalog_item_id = item.id
  order by model.version desc
  limit 1
) cost on true
where version.status = 'active'
  and (cost.id is null or cost.cost_source = 'unavailable')
order by item.sort_order;

-- 4. Grants: somente service_role deve ler estruturas internas.
select
  relation_name,
  has_table_privilege('anon', 'public.' || relation_name, 'SELECT') as anon_select,
  has_table_privilege('authenticated', 'public.' || relation_name, 'SELECT') as authenticated_select,
  has_table_privilege('service_role', 'public.' || relation_name, 'SELECT') as service_role_select
from unnest(array[
  'sales_pricing_catalog_versions',
  'sales_pricing_catalog_items',
  'sales_pricing_catalog_tiers',
  'sales_pricing_item_cost_models',
  'sales_pricing_catalog_audit_events',
  'sales_offer_simulation_items',
  'sales_offer_items',
  'sales_feature_profitability_summary_v1'
]) relation_name;

-- 5. Grants das RPCs internas.
select
  function_signature,
  has_function_privilege('anon', 'public.' || function_signature, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', 'public.' || function_signature, 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', 'public.' || function_signature, 'EXECUTE') as service_role_execute
from unnest(array[
  'clone_sales_pricing_catalog_version_v1(uuid,text,uuid,text)',
  'save_sales_pricing_catalog_draft_v1(uuid,text,jsonb,uuid,text)',
  'publish_sales_pricing_catalog_version_v1(uuid,uuid,text)',
  'save_sales_modular_simulation_v1(jsonb,jsonb)',
  'create_sales_modular_offer_v1(uuid,uuid,uuid,text,text,text,timestamp with time zone)'
]) function_signature;

-- 6. Integridade matematica: soma das linhas deve coincidir com o snapshot geral.
select
  simulation.id as simulation_id,
  simulation.scenario_name,
  sum(item.recurring_amount_cents) as line_promotional_revenue_cents,
  (simulation.results_snapshot->>'promotionalRecurringRevenueCents')::bigint as snapshot_promotional_revenue_cents,
  sum(item.post_promotion_recurring_amount_cents) as line_post_promotion_revenue_cents,
  (simulation.results_snapshot->>'postPromotionRecurringRevenueCents')::bigint as snapshot_post_promotion_revenue_cents,
  sum(item.item_discount_cents + item.allocated_global_discount_cents) as line_discount_cents,
  (
    (simulation.results_snapshot->>'itemDiscountCents')::bigint
    + (simulation.results_snapshot->>'globalDiscountCents')::bigint
  ) as snapshot_discount_cents,
  sum(item.ebitda_cents) as line_ebitda_cents,
  (simulation.results_snapshot#>>'{promotional,ebitdaCents}')::bigint as snapshot_ebitda_cents,
  sum(item.net_income_cents) as line_net_income_cents,
  (simulation.results_snapshot#>>'{promotional,netIncomeCents}')::bigint as snapshot_net_income_cents
from public.sales_offer_simulations simulation
join public.sales_offer_simulation_items item
  on item.simulation_id = simulation.id
where simulation.simulation_type = 'modular'
  and simulation.deleted_at is null
group by simulation.id, simulation.scenario_name, simulation.results_snapshot
order by simulation.created_at desc;

-- 7. Propostas modulares nao podem possuir Checkout ou objetos Stripe.
select
  id,
  simulation_id,
  status,
  modular_checkout_enabled,
  stripe_customer_id,
  stripe_checkout_session_id,
  stripe_subscription_id,
  stripe_discount_id,
  stripe_coupon_id,
  stripe_promotion_code_id
from public.sales_offers
where offer_type = 'modular'
  and (
    modular_checkout_enabled
    or stripe_customer_id is not null
    or stripe_checkout_session_id is not null
    or stripe_subscription_id is not null
    or stripe_discount_id is not null
    or stripe_coupon_id is not null
    or stripe_promotion_code_id is not null
  );

-- 8. Relatorio interno. O escopo deve continuar somente simulated_and_proposed_only.
select *
from public.sales_feature_profitability_summary_v1
order by item_key;

-- 9. Confirma que nenhuma tabela da DRE realizada recebeu FK ou coluna de simulacao modular.
select
  table_name,
  column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('financial_entries', 'revenues', 'expenses')
  and column_name in (
    'sales_offer_simulation_id',
    'sales_offer_id',
    'catalog_version_id',
    'simulation_type'
  );
