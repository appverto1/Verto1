-- Patient family diary now allows up to five active photos per day.
-- The previous unique index enforced one photo per patient/day and must be removed;
-- the application layer enforces the daily count with a patient-scoped check.

drop index if exists public.history_one_photo_per_day;

create index if not exists idx_history_family_photos_patient_day
on public.history (patient_id, date_group, created_at desc)
where type = 'photo' and deleted_at is null;
