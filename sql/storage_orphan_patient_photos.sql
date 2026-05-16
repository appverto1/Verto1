-- Lists objects in patient-photos that are not referenced by history photos
-- and are not used as patient profile pictures.
select
  o.id,
  o.name,
  o.created_at,
  o.updated_at,
  o.metadata
from storage.objects o
where o.bucket_id = 'patient-photos'
  and not exists (
    select 1
    from public.history h
    where h.deleted_at is null
      and (
        h.image_path = o.name
        or h.image_path = concat('patient-photos/', o.name)
        or h.image like concat('%', replace(o.name, '/', '%2F'), '%')
        or h.image like concat('%', o.name, '%')
      )
  )
  and not exists (
    select 1
    from public.patients p
    where p.deleted_at is null
      and (
        p.profile_picture_path = o.name
        or p.profile_picture_path = concat('patient-photos/', o.name)
        or p.profile_picture like concat('%', replace(o.name, '/', '%2F'), '%')
        or p.profile_picture like concat('%', o.name, '%')
      )
  )
order by o.created_at desc;
