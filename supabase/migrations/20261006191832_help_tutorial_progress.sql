-- Self-reported topic completion. No chat transcript or Super Admin projection.
create table public.help_tutorial_progress (
  user_id uuid not null references public.users(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  article_id text not null check (article_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  content_revision text not null check (content_revision ~ '^[a-f0-9]{16}$'),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, clinic_id, article_id, content_revision)
);
alter table public.help_tutorial_progress enable row level security;
revoke all on public.help_tutorial_progress from public, anon, authenticated;
grant select, insert, update, delete on public.help_tutorial_progress to service_role;

-- Only the trusted backend can call these functions after projecting the topic
-- from current capabilities/modules. Membership is checked again inside the DB.
create function public.set_help_tutorial_completion(
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
  insert into public.help_tutorial_progress(user_id,clinic_id,article_id,content_revision,completed_at)
    values(p_user_id,p_clinic_id,p_article_id,p_content_revision,case when p_completed then now() else null end)
    on conflict(user_id,clinic_id,article_id,content_revision) do update
      set completed_at=case when p_completed then coalesce(public.help_tutorial_progress.completed_at,excluded.completed_at) else null end,
          updated_at=now()
    returning completed_at into v_completed_at;
  return jsonb_build_object('completedAt',v_completed_at);
end;
$$;

create function public.get_help_tutorial_completion(
  p_user_id uuid, p_clinic_id uuid, p_membership_id uuid, p_role text,
  p_article_id text, p_content_revision text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_completed_at timestamptz;
begin
  perform 1 from public.clinic_memberships
    where id=p_membership_id and user_id=p_user_id and clinic_id=p_clinic_id
      and status='active' and role=p_role for share;
  if not found then raise exception 'HELP_ACCESS_DENIED' using errcode='42501'; end if;
  select completed_at into v_completed_at from public.help_tutorial_progress
    where user_id=p_user_id and clinic_id=p_clinic_id and article_id=p_article_id and content_revision=p_content_revision;
  return jsonb_build_object('completedAt',v_completed_at);
end;
$$;
revoke all on function public.set_help_tutorial_completion(uuid,uuid,uuid,text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.get_help_tutorial_completion(uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.set_help_tutorial_completion(uuid,uuid,uuid,text,text,text,boolean) to service_role;
grant execute on function public.get_help_tutorial_completion(uuid,uuid,uuid,text,text,text) to service_role;
