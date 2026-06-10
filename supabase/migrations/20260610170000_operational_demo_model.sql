begin;

alter table public.clinics
  add column if not exists demo_kind text,
  add column if not exists demo_key text,
  add column if not exists demo_last_activity_at timestamptz;

alter table public.users
  add column if not exists demo_access_mode text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clinics_demo_kind_check'
  ) then
    alter table public.clinics
      add constraint clinics_demo_kind_check
      check (demo_kind is null or demo_kind in ('presentation', 'playground', 'prospect'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_demo_access_mode_check'
  ) then
    alter table public.users
      add constraint users_demo_access_mode_check
      check (demo_access_mode is null or demo_access_mode in ('shared_guided', 'prospect'));
  end if;
end
$$;

create unique index if not exists clinics_demo_key_unique_idx
  on public.clinics (demo_key)
  where demo_key is not null;

create index if not exists clinics_demo_kind_status_idx
  on public.clinics (demo_kind, demo_status, demo_last_activity_at desc)
  where is_demo = true;

comment on column public.clinics.demo_kind is
  'Classifica ambientes demo operacionais: presentation, playground ou prospect.';

comment on column public.clinics.demo_key is
  'Chave estável para localizar demos fixas sem inferência por nome.';

comment on column public.clinics.demo_last_activity_at is
  'Última atividade mutável confirmada no ambiente demo.';

comment on column public.users.demo_access_mode is
  'Escopo da identidade demo compartilhada ou de prospect.';

commit;
