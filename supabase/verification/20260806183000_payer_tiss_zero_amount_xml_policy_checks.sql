-- Read-only checks for 20260806183000_payer_tiss_zero_amount_xml_policy.sql.

-- 1. New payer policy columns.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'payer_tiss_profiles'
  and column_name in ('allows_zero_amount_xml', 'zero_amount_xml_reason')
order by column_name;

-- 2. Policy reason constraint.
select
  constraint_row.conname as constraint_name,
  pg_get_constraintdef(constraint_row.oid) as definition
from pg_catalog.pg_constraint constraint_row
where constraint_row.conrelid = 'public.payer_tiss_profiles'::regclass
  and constraint_row.conname = 'payer_tiss_profiles_zero_amount_xml_reason_check';

-- 3. Official document total constraint accepts zero and still blocks negatives.
select
  constraint_row.conname as constraint_name,
  pg_get_constraintdef(constraint_row.oid) as definition
from pg_catalog.pg_constraint constraint_row
where constraint_row.conrelid = 'public.tiss_official_documents'::regclass
  and constraint_row.conname = 'tiss_official_documents_total_check';

-- 4. Database trigger that blocks zero-total official documents without payer policy.
select
  trigger_row.tgname as trigger_name,
  pg_get_triggerdef(trigger_row.oid) as definition
from pg_catalog.pg_trigger trigger_row
where trigger_row.tgrelid = 'public.tiss_official_documents'::regclass
  and trigger_row.tgname = 'assert_tiss_official_zero_amount_policy'
  and not trigger_row.tgisinternal;

-- 5. Payers explicitly configured for portal/operator price calculation.
select
  profile.organization_id,
  profile.payer_id,
  payer.name as payer_name,
  profile.allows_zero_amount_xml,
  profile.zero_amount_xml_reason,
  profile.updated_at
from public.payer_tiss_profiles profile
join public.clinic_payers payer
  on payer.id = profile.payer_id
 and payer.organization_id = profile.organization_id
where profile.allows_zero_amount_xml
order by profile.organization_id, payer.name;

-- 6. Zero-valued prices. These are only operationally valid for payers from check 5.
select
  price.organization_id,
  price.payer_id,
  payer.name as payer_name,
  price.service_catalog_id,
  service.name as service_name,
  price.amount_cents,
  price.valid_from,
  price.valid_until,
  price.active
from public.payer_procedure_prices price
join public.clinic_payers payer
  on payer.id = price.payer_id
 and payer.organization_id = price.organization_id
left join public.tuss_service_catalog service
  on service.id = price.service_catalog_id
 and service.organization_id = price.organization_id
where price.amount_cents = 0
order by price.organization_id, payer.name, service.name;

-- 7. Pre-guides that use the explicit zero policy.
select
  pre_guide.organization_id,
  pre_guide.id as pre_guide_id,
  pre_guide.appointment_id,
  pre_guide.payer_id,
  pre_guide.status,
  pre_guide.snapshot_data #>> '{procedure,totalAmountCents}' as total_amount_cents,
  pre_guide.snapshot_data #>> '{payer,requirements,allowsZeroAmountXml}' as allows_zero_amount_xml,
  pre_guide.snapshot_data #>> '{payer,requirements,zeroAmountXmlReason}' as zero_amount_xml_reason,
  pre_guide.validation_warning_codes
from public.appointment_tiss_pre_guides pre_guide
where case
  when coalesce(pre_guide.snapshot_data #>> '{procedure,totalAmountCents}', '') ~ '^-?[0-9]+([.][0-9]+)?$'
    then (pre_guide.snapshot_data #>> '{procedure,totalAmountCents}')::numeric = 0
  else false
end
order by pre_guide.updated_at desc;

-- 8. Official zero-total documents, if any were generated after explicit activation.
select
  document.organization_id,
  document.id,
  document.payer_id,
  document.competence_month,
  document.batch_number,
  document.total_amount_cents,
  document.status,
  document.generated_at
from public.tiss_official_documents document
where document.total_amount_cents = 0
order by document.generated_at desc;


-- 9. Expected: zero rows. Every persisted zero-total document must still have an active payer policy.
select
  document.organization_id,
  document.id,
  document.payer_id,
  document.total_amount_cents,
  document.generated_at
from public.tiss_official_documents document
where document.total_amount_cents = 0
  and not exists (
    select 1
    from public.payer_tiss_profiles profile
    where profile.organization_id = document.organization_id
      and profile.payer_id = document.payer_id
      and coalesce(profile.active, true)
      and profile.allows_zero_amount_xml
      and nullif(btrim(coalesce(profile.zero_amount_xml_reason, '')), '') is not null
  )
order by document.generated_at desc;
