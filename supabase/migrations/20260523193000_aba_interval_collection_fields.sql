alter table public.aba_behavior_events
  add column if not exists interval_number integer,
  add column if not exists interval_started_at timestamptz,
  add column if not exists interval_ended_at timestamptz,
  add column if not exists occurred boolean,
  add column if not exists sync_status text not null default 'synced';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'aba_behavior_events_sync_status_check'
      and conrelid = 'public.aba_behavior_events'::regclass
  ) then
    alter table public.aba_behavior_events
      add constraint aba_behavior_events_sync_status_check
      check (sync_status in ('local', 'local_only', 'queued', 'syncing', 'synced', 'error', 'failed', 'conflict'));
  end if;
end $$;

create index if not exists idx_aba_behavior_events_interval_collection
  on public.aba_behavior_events (session_id, behavior_id, interval_number);
