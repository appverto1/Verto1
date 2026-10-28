-- Hotfix: keep existing owner prospecting endpoints functional while script attribution rolls out.
-- Legacy no_decisor calls do not send contact_result; derive the unambiguous no_answer outcome.
-- Never fabricate a script version for historical or unassigned contacts.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function public.enforce_sales_script_attribution_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if tg_op='UPDATE' then
    if new.script_version_id is distinct from old.script_version_id
      or new.contact_result is distinct from old.contact_result
    then raise exception 'SCRIPT_ATTRIBUTION_IMMUTABLE'; end if;
    return new;
  end if;
  if new.outcome='no_decisor' and new.contact_result is null then
    new.contact_result:='no_answer';
  end if;
  if (new.outcome='no_decisor' and new.contact_result <> 'no_answer')
    or (new.outcome='decisor_spoken' and new.script_version_id is not null
        and coalesce(new.contact_result,'') not in ('interested','not_interested'))
    or (new.outcome='decisor_spoken' and new.script_version_id is null
        and new.contact_result is not null and new.contact_result not in ('interested','not_interested'))
  then raise exception 'INVALID_CONTACT_RESULT'; end if;
  if new.script_version_id is not null and not exists(
     select 1 from public.sales_script_versions where id=new.script_version_id and is_active=true)
  then raise exception 'SCRIPT_NOT_ACTIVE'; end if;
  -- Unassigned is permitted for older clients and records created before the script UI.
  -- The new UI asks users to select one when versions exist; no automatic guessing.
  return new;
end $$;
commit;
