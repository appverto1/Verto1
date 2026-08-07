-- Explicit payer-scoped policy for XML TISS with R$ 0,00 when the operator
-- calculates the negotiated amount after import in its own portal.
--
-- This migration is additive. The default remains restrictive: zero amounts
-- continue blocked unless one payer profile explicitly enables the exception
-- and records the operational reason.

begin;

alter table public.payer_tiss_profiles
  add column if not exists allows_zero_amount_xml boolean not null default false,
  add column if not exists zero_amount_xml_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.payer_tiss_profiles'::regclass
      and constraint_row.conname = 'payer_tiss_profiles_zero_amount_xml_reason_check'
  ) then
    alter table public.payer_tiss_profiles
      add constraint payer_tiss_profiles_zero_amount_xml_reason_check
      check (
        not allows_zero_amount_xml
        or nullif(btrim(coalesce(zero_amount_xml_reason, '')), '') is not null
      );
  end if;
end
$$;

-- The official XML is still validated against the ANS XSD. The XSD decimal
-- type accepts 0.00, so persistence must permit a validated zero-total batch
-- only after the application-level payer policy has authorized it.
alter table public.tiss_official_documents
  drop constraint if exists tiss_official_documents_total_check;

alter table public.tiss_official_documents
  add constraint tiss_official_documents_total_check
  check (total_amount_cents >= 0);

create or replace function public.assert_tiss_official_zero_amount_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.total_amount_cents = 0 and not exists (
    select 1
    from public.payer_tiss_profiles profile
    where profile.organization_id = new.organization_id
      and profile.payer_id = new.payer_id
      and coalesce(profile.active, true)
      and profile.allows_zero_amount_xml
      and nullif(btrim(coalesce(profile.zero_amount_xml_reason, '')), '') is not null
  ) then
    raise exception using
      errcode = '23514',
      message = 'TISS_ZERO_AMOUNT_XML_POLICY_REQUIRED';
  end if;
  return new;
end;
$$;

drop trigger if exists assert_tiss_official_zero_amount_policy
  on public.tiss_official_documents;
create trigger assert_tiss_official_zero_amount_policy
before insert or update of total_amount_cents, organization_id, payer_id
on public.tiss_official_documents
for each row execute function public.assert_tiss_official_zero_amount_policy();

revoke all on function public.assert_tiss_official_zero_amount_policy() from public, anon, authenticated;
grant execute on function public.assert_tiss_official_zero_amount_policy() to service_role;

comment on column public.payer_tiss_profiles.allows_zero_amount_xml is
  'Allows TISS XML values of 0.00 only for this payer when its portal/operator calculates the contracted amount after import.';

comment on column public.payer_tiss_profiles.zero_amount_xml_reason is
  'Mandatory operational justification when allows_zero_amount_xml is enabled.';

commit;
