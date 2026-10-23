-- P0-31: role-scoped tutorial completion without changing existing progress records.
-- V2 intentionally coexists with V1; no deletion, no destructive PK rewrite.
begin;

create table public.help_tutorial_role_progress_v2 (
  user_id uuid not null references public.users(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  membership_id uuid not null references public.clinic_memberships(id) on delete cascade,
  role text not null check (length(role) between 1 and 80),
  article_id text not null check (article_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  content_revision text not null check (content_revision ~ '^[a-f0-9]{16}$'),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, clinic_id, membership_id, role, article_id, content_revision)
);

alter table public.help_tutorial_role_progress_v2 enable row level security;
revoke all on public.help_tutorial_role_progress_v2 from public, anon, authenticated;
grant select, insert, update, delete on public.help_tutorial_role_progress_v2 to service_role;

-- Preserve legacy completions when an exact single active membership exists.
-- Ambiguous historical rows stay untouched in V1; never guess a role.
with unique_active_membership as (
  select m.user_id, m.clinic_id,
         min(m.id::text)::uuid as membership_id,
         min(m.role) as role
  from public.clinic_memberships m
  where m.status = 'active'
  group by m.user_id, m.clinic_id
  having count(*) = 1
)
insert into public.help_tutorial_role_progress_v2
  (user_id, clinic_id, membership_id, role, article_id, content_revision, completed_at, updated_at)
select p.user_id, p.clinic_id, m.membership_id, m.role,
       p.article_id, p.content_revision, p.completed_at, p.updated_at
from public.help_tutorial_progress p
join unique_active_membership m on m.user_id=p.user_id and m.clinic_id=p.clinic_id
on conflict do nothing;

-- All authority comes from the authenticated backend's resolved membership;
-- a browser cannot choose user, clinic, role or membership.
create function public.set_help_tutorial_completion_v2(
  p_user_id uuid, p_clinic_id uuid, p_membership_id uuid, p_role text,
  p_article_id text, p_content_revision text, p_completed boolean
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_completed_at timestamptz;
begin
  perform 1 from public.clinic_memberships
    where id=p_membership_id and user_id=p_user_id and clinic_id=p_clinic_id
      and status='active' and role=p_role
    for share;
  if not found then raise exception 'HELP_ACCESS_DENIED' using errcode='42501'; end if;
  if p_completed is null then raise exception 'HELP_INVALID_COMPLETION'; end if;
  insert into public.help_tutorial_role_progress_v2
    (user_id,clinic_id,membership_id,role,article_id,content_revision,completed_at)
    values(p_user_id,p_clinic_id,p_membership_id,p_role,p_article_id,p_content_revision,
           case when p_completed then now() else null end)
    on conflict(user_id,clinic_id,membership_id,role,article_id,content_revision) do update
      set completed_at=case when p_completed then
            coalesce(public.help_tutorial_role_progress_v2.completed_at,excluded.completed_at)
          else null end,
          updated_at=now()
    returning completed_at into v_completed_at;
  return jsonb_build_object('completedAt',v_completed_at);
end;
$$;

create function public.get_help_tutorial_completion_v2(
  p_user_id uuid, p_clinic_id uuid, p_membership_id uuid, p_role text,
  p_article_id text, p_content_revision text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_completed_at timestamptz;
begin
  perform 1 from public.clinic_memberships
    where id=p_membership_id and user_id=p_user_id and clinic_id=p_clinic_id
      and status='active' and role=p_role
    for share;
  if not found then raise exception 'HELP_ACCESS_DENIED' using errcode='42501'; end if;
  select completed_at into v_completed_at from public.help_tutorial_role_progress_v2
    where user_id=p_user_id and clinic_id=p_clinic_id and membership_id=p_membership_id
      and role=p_role and article_id=p_article_id and content_revision=p_content_revision;
  return jsonb_build_object('completedAt',v_completed_at);
end;
$$;

revoke all on function public.set_help_tutorial_completion_v2(uuid,uuid,uuid,text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.get_help_tutorial_completion_v2(uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.set_help_tutorial_completion_v2(uuid,uuid,uuid,text,text,text,boolean) to service_role;
grant execute on function public.get_help_tutorial_completion_v2(uuid,uuid,uuid,text,text,text) to service_role;
commit;
