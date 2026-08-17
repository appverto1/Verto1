begin;

-- Anamnesis templates have two independent ownership scopes:
--   personal -> up to 15 active templates owned by one professional identity;
--   clinic   -> up to 10 active templates owned by one clinic.
-- Limits are enforced in PostgreSQL under an advisory transaction lock so two
-- concurrent creates cannot bypass the quota.

alter table public.anamnesis_templates
  add column if not exists revision integer not null default 1;

alter table public.anamnesis_templates
  drop constraint if exists anamnesis_templates_revision_positive;
alter table public.anamnesis_templates
  add constraint anamnesis_templates_revision_positive
  check (revision > 0);

alter table public.patient_anamnesis_requests
  add column if not exists template_snapshot jsonb,
  add column if not exists template_revision integer,
  add column if not exists template_scope_snapshot text;

alter table public.patient_anamnesis_responses
  add column if not exists template_snapshot jsonb,
  add column if not exists template_revision integer,
  add column if not exists template_scope_snapshot text;

alter table public.patient_anamnesis_requests
  drop constraint if exists patient_anamnesis_requests_template_revision_positive;
alter table public.patient_anamnesis_requests
  add constraint patient_anamnesis_requests_template_revision_positive
  check (template_revision is null or template_revision > 0);

alter table public.patient_anamnesis_responses
  drop constraint if exists patient_anamnesis_responses_template_revision_positive;
alter table public.patient_anamnesis_responses
  add constraint patient_anamnesis_responses_template_revision_positive
  check (template_revision is null or template_revision > 0);

alter table public.patient_anamnesis_requests
  drop constraint if exists patient_anamnesis_requests_template_scope_snapshot_check;
alter table public.patient_anamnesis_requests
  add constraint patient_anamnesis_requests_template_scope_snapshot_check
  check (template_scope_snapshot is null or template_scope_snapshot in ('global', 'clinic', 'personal'));

alter table public.patient_anamnesis_responses
  drop constraint if exists patient_anamnesis_responses_template_scope_snapshot_check;
alter table public.patient_anamnesis_responses
  add constraint patient_anamnesis_responses_template_scope_snapshot_check
  check (template_scope_snapshot is null or template_scope_snapshot in ('global', 'clinic', 'personal'));

create or replace function public.enforce_anamnesis_template_active_limit_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_scope text;
  v_owner uuid;
  v_limit integer;
  v_active_count integer;
  v_lock_key bigint;
begin
  if new.is_active is distinct from true then
    return new;
  end if;

  -- Editing an already-active template in the same ownership bucket does not
  -- consume a new slot. This preserves existing accounts even if historical
  -- data temporarily exceeds the new quota; they can edit/archive, but not add.
  if tg_op = 'UPDATE'
     and old.is_active is true
     and new.is_active is true
     and old.scope is not distinct from new.scope
     and old.owner_user_id is not distinct from new.owner_user_id
     and old.organization_id is not distinct from new.organization_id then
    return new;
  end if;

  v_scope := new.scope;
  if v_scope = 'personal' then
    v_owner := new.owner_user_id;
    v_limit := 15;
  elsif v_scope = 'clinic' then
    v_owner := new.organization_id;
    v_limit := 10;
  else
    return new;
  end if;

  if v_owner is null then
    raise exception using errcode = '23514', message = 'ANAMNESIS_TEMPLATE_OWNER_REQUIRED';
  end if;

  v_lock_key := hashtextextended('anamnesis-template-limit:' || v_scope || ':' || v_owner::text, 0);
  perform pg_advisory_xact_lock(v_lock_key);

  select count(*)::integer
    into v_active_count
  from public.anamnesis_templates existing
  where existing.scope = v_scope
    and existing.is_active = true
    and existing.id is distinct from new.id
    and (
      (v_scope = 'personal' and existing.owner_user_id = v_owner)
      or (v_scope = 'clinic' and existing.organization_id = v_owner)
    );

  if v_active_count >= v_limit then
    if v_scope = 'personal' then
      raise exception using errcode = 'P0001', message = 'ANAMNESIS_PERSONAL_TEMPLATE_LIMIT';
    end if;
    raise exception using errcode = 'P0001', message = 'ANAMNESIS_CLINIC_TEMPLATE_LIMIT';
  end if;

  return new;
end
$function$;

revoke all on function public.enforce_anamnesis_template_active_limit_v1() from public, anon, authenticated;

create or replace function public.bump_anamnesis_template_revision_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    return new;
  end if;

  if row(
    new.name,
    new.description,
    new.age_min_months,
    new.age_max_months,
    new.patient_profile_type,
    new.questions,
    new.scope,
    new.owner_user_id,
    new.organization_id,
    new.visibility
  ) is distinct from row(
    old.name,
    old.description,
    old.age_min_months,
    old.age_max_months,
    old.patient_profile_type,
    old.questions,
    old.scope,
    old.owner_user_id,
    old.organization_id,
    old.visibility
  ) then
    new.revision := greatest(coalesce(old.revision, 1), 1) + 1;
  else
    new.revision := greatest(coalesce(old.revision, 1), 1);
  end if;
  return new;
end
$function$;

revoke all on function public.bump_anamnesis_template_revision_v1() from public, anon, authenticated;

drop trigger if exists anamnesis_templates_active_limit_v1 on public.anamnesis_templates;
create trigger anamnesis_templates_active_limit_v1
before insert or update of is_active, scope, owner_user_id, organization_id
on public.anamnesis_templates
for each row execute function public.enforce_anamnesis_template_active_limit_v1();

drop trigger if exists anamnesis_templates_revision_v1 on public.anamnesis_templates;
create trigger anamnesis_templates_revision_v1
before insert or update
on public.anamnesis_templates
for each row execute function public.bump_anamnesis_template_revision_v1();

create index if not exists idx_patient_anamnesis_requests_template_snapshot
  on public.patient_anamnesis_requests (organization_id, patient_id, created_at desc)
  where template_snapshot is not null;

create index if not exists idx_patient_anamnesis_responses_template_snapshot
  on public.patient_anamnesis_responses (organization_id, patient_id, version desc)
  where template_snapshot is not null;

commit;
