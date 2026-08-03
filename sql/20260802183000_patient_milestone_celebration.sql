begin;

create table if not exists public.patient_milestone_celebration_receipts (
  user_id uuid not null references public.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  last_seen_award_id uuid null references public.notes(id) on delete set null,
  last_seen_award_at timestamptz null,
  updated_at timestamptz not null default now(),
  primary key (user_id, patient_id)
);

alter table public.patient_milestone_celebration_receipts enable row level security;

revoke all on table public.patient_milestone_celebration_receipts from anon, authenticated;
grant select, insert, update on table public.patient_milestone_celebration_receipts to service_role;

create index if not exists notes_patient_milestone_award_lookup_v1
  on public.notes (patient_id, updated_at desc, id desc)
  where subject = 'milestone_event'
    and is_active = true
    and deleted_at is null;

create or replace function public.consume_patient_milestone_celebration_v1(
  p_user_id uuid,
  p_patient_id uuid
)
returns table (
  celebrate boolean,
  unseen_count integer,
  latest_award_id uuid,
  latest_award_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_last_seen_at timestamptz;
  v_latest_award_id uuid;
  v_latest_award_at timestamptz;
  v_unseen_count integer := 0;
begin
  if p_user_id is null or p_patient_id is null then
    raise exception using errcode = '22004', message = 'MILESTONE_CELEBRATION_ID_REQUIRED';
  end if;

  if not exists (select 1 from public.users as user_row where user_row.id = p_user_id)
     or not exists (select 1 from public.patients as patient_row where patient_row.id = p_patient_id) then
    raise exception using errcode = 'P0002', message = 'MILESTONE_CELEBRATION_CONTEXT_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_patient_id::text, 0)
  );

  select receipt.last_seen_award_at
    into v_last_seen_at
  from public.patient_milestone_celebration_receipts as receipt
  where receipt.user_id = p_user_id
    and receipt.patient_id = p_patient_id
  for update;

  select note_row.id,
         coalesce(note_row.updated_at, note_row.created_at)
    into v_latest_award_id, v_latest_award_at
  from public.notes as note_row
  where note_row.patient_id = p_patient_id
    and note_row.subject = 'milestone_event'
    and note_row.is_active = true
    and note_row.deleted_at is null
    and (
      coalesce(note_row.score, 0) >= 1
      or coalesce(note_row.text, '') ~* 'awarded=1'
    )
    and (
      v_last_seen_at is null
      or coalesce(note_row.updated_at, note_row.created_at) > v_last_seen_at
    )
  order by coalesce(note_row.updated_at, note_row.created_at) desc, note_row.id desc
  limit 1;

  if v_latest_award_id is null then
    insert into public.patient_milestone_celebration_receipts as receipt (
      user_id,
      patient_id,
      updated_at
    ) values (
      p_user_id,
      p_patient_id,
      now()
    )
    on conflict (user_id, patient_id)
    do update set updated_at = excluded.updated_at;

    return query
      select false, 0, null::uuid, null::timestamptz;
    return;
  end if;

  select count(*)::integer
    into v_unseen_count
  from public.notes as note_row
  where note_row.patient_id = p_patient_id
    and note_row.subject = 'milestone_event'
    and note_row.is_active = true
    and note_row.deleted_at is null
    and (
      coalesce(note_row.score, 0) >= 1
      or coalesce(note_row.text, '') ~* 'awarded=1'
    )
    and (
      v_last_seen_at is null
      or coalesce(note_row.updated_at, note_row.created_at) > v_last_seen_at
    );

  insert into public.patient_milestone_celebration_receipts as receipt (
    user_id,
    patient_id,
    last_seen_award_id,
    last_seen_award_at,
    updated_at
  ) values (
    p_user_id,
    p_patient_id,
    v_latest_award_id,
    v_latest_award_at,
    now()
  )
  on conflict (user_id, patient_id)
  do update set
    last_seen_award_id = excluded.last_seen_award_id,
    last_seen_award_at = excluded.last_seen_award_at,
    updated_at = excluded.updated_at;

  return query
    select true, greatest(v_unseen_count, 1), v_latest_award_id, v_latest_award_at;
end;
$$;

revoke all on function public.consume_patient_milestone_celebration_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.consume_patient_milestone_celebration_v1(uuid, uuid) to service_role;

commit;
