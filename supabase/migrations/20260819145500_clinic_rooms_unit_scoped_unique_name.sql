begin;

-- Rooms are unit/clinic resources. The previous unique index used
-- coalesce(organization_id, clinic_id), which prevented two clinics in the same
-- organization from using the same room name and could surface a misleading
-- duplicate error when the active clinic changed during session hydration.
drop index if exists public.idx_clinic_rooms_unique_active_name;

create unique index if not exists idx_clinic_rooms_unique_active_name
  on public.clinic_rooms (clinic_id, lower(name))
  where is_active = true and clinic_id is not null;

-- Preserve a narrow legacy guard only for old rows that still have no clinic_id.
create unique index if not exists idx_clinic_rooms_legacy_org_unique_active_name
  on public.clinic_rooms (organization_id, lower(name))
  where is_active = true and clinic_id is null and organization_id is not null;

commit;
