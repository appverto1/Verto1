-- Seed for test workspaces/memberships
-- Prerequisite: create users in Supabase Auth first (Dashboard > Authentication > Users).
-- Suggested emails:
--   coord.teste@verto.local
--   terapeuta.teste@verto.local
--   recepcao.teste@verto.local
--   multi.teste@verto.local

do $$
declare
  coord_id uuid;
  therapist_id uuid;
  receptionist_id uuid;
  multi_id uuid;
begin
  select id into coord_id from public.users where email = 'coord.teste@verto.local' limit 1;
  select id into therapist_id from public.users where email = 'terapeuta.teste@verto.local' limit 1;
  select id into receptionist_id from public.users where email = 'recepcao.teste@verto.local' limit 1;
  select id into multi_id from public.users where email = 'multi.teste@verto.local' limit 1;

  if coord_id is null then
    raise notice 'Usuario coord.teste@verto.local nao encontrado em public.users.';
    return;
  end if;

  insert into public.clinics (id, owner_user_id, name)
  values (coord_id, coord_id, 'Clinica Demo Verto')
  on conflict (id) do update set name = excluded.name, updated_at = now();

  insert into public.clinic_memberships (user_id, clinic_id, role, status)
  values (coord_id, coord_id, 'coordinator', 'active')
  on conflict (user_id, clinic_id) do update set role = excluded.role, status = excluded.status, updated_at = now();

  update public.users set clinic_id = coord_id, role = 'coordinator' where id = coord_id;

  if therapist_id is not null then
    insert into public.clinic_memberships (user_id, clinic_id, role, status, invited_by)
    values (therapist_id, coord_id, 'therapist', 'active', coord_id)
    on conflict (user_id, clinic_id) do update set role = excluded.role, status = excluded.status, updated_at = now();
  end if;

  if receptionist_id is not null then
    insert into public.clinic_memberships (user_id, clinic_id, role, status, invited_by)
    values (receptionist_id, coord_id, 'receptionist', 'active', coord_id)
    on conflict (user_id, clinic_id) do update set role = excluded.role, status = excluded.status, updated_at = now();
  end if;

  if multi_id is not null then
    insert into public.clinic_memberships (user_id, clinic_id, role, status, invited_by)
    values (multi_id, coord_id, 'therapist', 'active', coord_id)
    on conflict (user_id, clinic_id) do update set role = excluded.role, status = excluded.status, updated_at = now();
  end if;
end $$;

