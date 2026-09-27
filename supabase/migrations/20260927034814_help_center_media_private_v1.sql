-- #260 Help Center tutorial media storage authority (staging-first).
-- Dedicated private bucket: do not reuse patient-photos or patient-files-private.
-- Browser access is intentionally not granted here; the application server must
-- resolve a contracted media_id, revalidate session/membership/capabilities, and
-- use server-side Storage authority. Final media validation (magic bytes, codec,
-- dimensions/duration/weight) remains application-owned before publication.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'help-center-media-private',
  'help-center-media-private',
  false,
  3145728,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'video/mp4',
    'video/webm'
  ]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
