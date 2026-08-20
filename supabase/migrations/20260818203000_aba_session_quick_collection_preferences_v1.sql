-- ABA session quick-collection preferences.
-- Additive/idempotent: clinic-scoped context locations + per-user/clinic quick shortcuts.
-- Clinical events continue to persist in the existing canonical ABA event tables.

begin;

create table if not exists public.aba_session_locations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aba_session_locations_name_length_v1
    check (char_length(trim(name)) between 1 and 40),
  constraint aba_session_locations_normalized_name_length_v1
    check (char_length(trim(normalized_name)) between 1 and 40)
);

create unique index if not exists aba_session_locations_active_name_unique_v1
  on public.aba_session_locations (clinic_id, normalized_name)
  where is_active = true;

create index if not exists aba_session_locations_clinic_active_v1
  on public.aba_session_locations (clinic_id, is_active, name);

create table if not exists public.aba_user_session_preferences (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  quick_behavior_shortcuts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (clinic_id, user_id),
  constraint aba_user_session_preferences_shortcuts_array_v1
    check (
      jsonb_typeof(quick_behavior_shortcuts) = 'array'
      and jsonb_array_length(quick_behavior_shortcuts) <= 6
    )
);

alter table public.aba_session_locations enable row level security;
alter table public.aba_user_session_preferences enable row level security;

-- Browser clients never write/read these tables directly. The authenticated
-- API resolves the active clinic/capability first and uses service_role.
revoke all on public.aba_session_locations from anon, authenticated;
revoke all on public.aba_user_session_preferences from anon, authenticated;
grant select, insert, update, delete on public.aba_session_locations to service_role;
grant select, insert, update, delete on public.aba_user_session_preferences to service_role;

comment on table public.aba_session_locations is
  'Clinic-scoped reusable ABA session context locations. Clinical event rows snapshot the selected label separately.';
comment on table public.aba_user_session_preferences is
  'Per-user and per-clinic ABA session UI preferences. No patient or clinical outcome data is stored here.';

create or replace function public.save_aba_user_session_preferences_v1(
  p_clinic_id uuid,
  p_user_id uuid,
  p_quick_behavior_shortcuts jsonb
)
returns public.aba_user_session_preferences
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_row public.aba_user_session_preferences%rowtype;
  v_shortcuts jsonb := coalesce(p_quick_behavior_shortcuts, '[]'::jsonb);
begin
  if p_clinic_id is null or p_user_id is null then
    raise exception using errcode = 'P0001', message = 'ABA_SESSION_PREFERENCES_SCOPE_REQUIRED';
  end if;
  if jsonb_typeof(v_shortcuts) <> 'array' or jsonb_array_length(v_shortcuts) > 6 then
    raise exception using errcode = 'P0001', message = 'ABA_SESSION_PREFERENCES_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('aba-session-preferences:' || p_clinic_id::text || ':' || p_user_id::text, 0)
  );

  insert into public.aba_user_session_preferences (
    clinic_id,
    user_id,
    quick_behavior_shortcuts,
    created_at,
    updated_at
  ) values (
    p_clinic_id,
    p_user_id,
    v_shortcuts,
    now(),
    now()
  )
  on conflict (clinic_id, user_id) do update
    set quick_behavior_shortcuts = excluded.quick_behavior_shortcuts,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.save_aba_user_session_preferences_v1(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_aba_user_session_preferences_v1(uuid, uuid, jsonb)
  to service_role;

commit;
