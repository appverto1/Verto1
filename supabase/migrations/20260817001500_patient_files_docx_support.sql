begin;

-- The patient chart UI advertises DOCX as an accepted format. Keep the private
-- bucket aligned with the 10 MB product limit and the server-side magic-byte
-- validation. Upsert is idempotent and does not touch stored objects.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'patient-files-private',
  'patient-files-private',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/json',
    'text/plain',
    'text/html'
  ]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
