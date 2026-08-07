-- Keep active patient/case links aligned with the canonical professional profile.
-- Historical ended links retain their original specialty snapshot.

begin;

do $migration_guard$
begin
  if to_regclass('public.patient_professional_links') is null
     or to_regclass('public.professional_profiles') is null then
    raise exception 'PATIENT_PROFESSIONAL_SPECIALTY_AUTHORITY_SCHEMA_PENDING'
      using detail = 'patient_professional_links and professional_profiles are required';
  end if;
end;
$migration_guard$;

-- Repair only active links. Ended links are immutable historical snapshots.
update public.patient_professional_links link
set
  specialty = trim(profile.specialty),
  updated_at = now()
from public.professional_profiles profile
where link.status = 'active'
  and profile.user_id::text = link.professional_id
  and char_length(nullif(trim(profile.specialty), '')) >= 2
  and link.specialty is distinct from trim(profile.specialty);

create or replace function public.patient_professional_link_enforce_specialty_authority_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  canonical_specialty text;
begin
  if coalesce(lower(new.status), '') <> 'active' then
    return new;
  end if;

  select nullif(trim(profile.specialty), '')
  into canonical_specialty
  from public.professional_profiles profile
  where profile.user_id::text = new.professional_id
  limit 1;

  if canonical_specialty is null or char_length(canonical_specialty) < 2 then
    raise exception 'PATIENT_PROFESSIONAL_SPECIALTY_REQUIRED';
  end if;

  new.specialty := canonical_specialty;
  return new;
end;
$function$;

drop trigger if exists patient_professional_link_enforce_specialty_authority
  on public.patient_professional_links;
create trigger patient_professional_link_enforce_specialty_authority
before insert or update of professional_id, specialty, status
on public.patient_professional_links
for each row
execute function public.patient_professional_link_enforce_specialty_authority_v1();

create or replace function public.sync_active_patient_professional_link_specialty_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if char_length(nullif(trim(new.specialty), '')) < 2 then
    return new;
  end if;

  update public.patient_professional_links link
  set
    specialty = trim(new.specialty),
    updated_at = now()
  where link.professional_id = new.user_id::text
    and link.status = 'active'
    and link.specialty is distinct from trim(new.specialty);

  return new;
end;
$function$;

drop trigger if exists sync_active_patient_professional_link_specialty
  on public.professional_profiles;
create trigger sync_active_patient_professional_link_specialty
after update of specialty
on public.professional_profiles
for each row
when (old.specialty is distinct from new.specialty)
execute function public.sync_active_patient_professional_link_specialty_v1();

revoke all on function public.patient_professional_link_enforce_specialty_authority_v1()
  from public, anon, authenticated;
revoke all on function public.sync_active_patient_professional_link_specialty_v1()
  from public, anon, authenticated;

grant execute on function public.patient_professional_link_enforce_specialty_authority_v1()
  to service_role;
grant execute on function public.sync_active_patient_professional_link_specialty_v1()
  to service_role;

comment on function public.patient_professional_link_enforce_specialty_authority_v1() is
  'For active case links, professional_profiles.specialty is the canonical specialty. Ended links keep historical snapshots.';

commit;
