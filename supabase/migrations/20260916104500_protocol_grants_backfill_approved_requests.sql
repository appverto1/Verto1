-- Issue #178: preserve historical approved protocol access in canonical grants.
-- Forward-only and idempotent. Does not rewrite requests or clinic_state.

insert into public.clinic_protocol_grants (
  clinic_id,
  canonical_key,
  source_request_id,
  granted_by,
  granted_at
)
select
  r.clinic_id,
  lower(trim(r.approved_canonical_key)),
  r.id,
  r.reviewed_by,
  coalesce(r.reviewed_at, r.updated_at, r.created_at, now())
from public.protocol_import_requests r
where r.status = 'approved'
  and r.clinic_id is not null
  and nullif(trim(coalesce(r.approved_canonical_key, '')), '') is not null
  and r.reviewed_by is not null
  and exists (select 1 from public.users u where u.id = r.reviewed_by)
on conflict (clinic_id, canonical_key) do nothing;
