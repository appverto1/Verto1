-- Verto: compatibilidade de direção com as RPCs de presença/falta.
-- A camada HTTP autoriza "director" por capability; as RPCs históricas tratam o
-- papel gerencial equivalente como "coordinator". Normalizamos somente dentro
-- deste helper, preservando memberships, perfis e auditoria originais.

begin;

create or replace function public.verto_clinic_actor_role_v1(
  p_actor_id uuid,
  p_clinic_id uuid
) returns text
language sql
stable
security definer
set search_path = public
as $$
  with resolved as (
    select lower(coalesce(
      case when clinic.owner_user_id = p_actor_id then 'owner' end,
      nullif(membership.role, ''),
      case when actor.clinic_id = clinic.id then nullif(actor.role, '') end,
      ''
    )) as actor_role
    from public.clinics clinic
    left join public.clinic_memberships membership
      on membership.clinic_id = clinic.id
     and membership.user_id = p_actor_id
     and lower(coalesce(membership.status, 'active')) = 'active'
    left join public.users actor
      on actor.id = p_actor_id
    where clinic.id = p_clinic_id
      and (
        clinic.owner_user_id = p_actor_id
        or membership.user_id is not null
        or actor.clinic_id = clinic.id
      )
    limit 1
  )
  select case
    when actor_role = 'director' then 'coordinator'
    else actor_role
  end
  from resolved
$$;

revoke all on function public.verto_clinic_actor_role_v1(uuid,uuid) from public, anon, authenticated;
grant execute on function public.verto_clinic_actor_role_v1(uuid,uuid) to service_role;

comment on function public.verto_clinic_actor_role_v1(uuid,uuid) is
  'Resolve papel operacional das RPCs atômicas de agenda/sessão; director é compatível com coordinator sem alterar o membership persistido.';

commit;
