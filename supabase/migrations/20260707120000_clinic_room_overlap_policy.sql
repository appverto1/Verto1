alter table public.clinic_rooms
  add column if not exists prevent_overlapping_appointments boolean not null default true;

comment on column public.clinic_rooms.prevent_overlapping_appointments is
  'When true, the schedule conflict engine blocks overlapping appointments using this room.';
