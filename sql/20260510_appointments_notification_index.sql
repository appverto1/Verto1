do $$
begin
  if to_regclass('public.appointments') is not null then
    alter table public.appointments
      add column if not exists scheduled_at timestamptz,
      add column if not exists status text not null default 'pending',
      add column if not exists notification_sent boolean not null default false,
      add column if not exists notification_sent_at timestamptz,
      add column if not exists notification_12h_sent boolean not null default false,
      add column if not exists notification_12h_sent_at timestamptz;

    execute '
      create index if not exists idx_appointments_notification_scan
        on public.appointments (status, notification_sent, scheduled_at)
        where notification_sent = false or notification_sent is null
    ';

    execute '
      create index if not exists idx_appointments_notification_12h_scan
        on public.appointments (status, notification_12h_sent, scheduled_at)
        where notification_12h_sent = false or notification_12h_sent is null
    ';
  end if;
end $$;
