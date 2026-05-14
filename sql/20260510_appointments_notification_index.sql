do $$
begin
  if to_regclass('public.appointments') is not null then
    alter table public.appointments
      add column if not exists scheduled_at timestamptz,
      add column if not exists status text not null default 'pending',
      add column if not exists notification_sent boolean not null default false,
      add column if not exists notification_sent_at timestamptz,
      add column if not exists notification_12h_sent boolean not null default false,
      add column if not exists notification_12h_sent_at timestamptz,
      add column if not exists patient_confirmation_status text,
      add column if not exists patient_confirmation_at timestamptz,
      add column if not exists patient_confirmation_by text,
      add column if not exists patient_confirmation_source text;

    execute '
      create index if not exists idx_appointments_notification_scan
        on public.appointments (status, notification_sent, scheduled_at)
        where status = ''pending''
          and scheduled_at is not null
          and (notification_sent = false or notification_sent is null)
    ';

    execute '
      create index if not exists idx_appointments_notification_12h_scan
        on public.appointments (status, notification_12h_sent, scheduled_at)
        where status = ''pending''
          and scheduled_at is not null
          and (notification_12h_sent = false or notification_12h_sent is null)
    ';

    execute '
      create index if not exists idx_appointments_patient_confirmation_scan
        on public.appointments (patient_confirmation_status, status, scheduled_at)
        where status = ''pending''
          and scheduled_at is not null
    ';
  end if;
end $$;
