-- Enforce one active patient diary photo per day at the database layer.
-- date_group is stored as YYYY-MM-DD using the clinic's application timezone.

alter table public.history
  add column if not exists date_group text;

update public.history
set date_group = to_char((created_at at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD')
where date_group is null
  and created_at is not null;

create unique index if not exists history_one_photo_per_day
on public.history (patient_id, date_group)
where type = 'photo' and deleted_at is null;
