-- Clinical audit context for Verto activity logs.
-- Stores timestamps canonically as timestamptz (UTC internally) and keeps the
-- clinic timezone snapshot only for presentation/audit interpretation.
-- Sensitive audit events are append-only via immutable_audit.

begin;

alter table public.activity_logs
  add column if not exists idempotency_key text,
  add column if not exists resource_type text,
  add column if not exists resource_id text,
  add column if not exists patient_id uuid,
  add column if not exists session_id text,
  add column if not exists timezone_snapshot text,
  add column if not exists immutable_audit boolean not null default false;

create index if not exists activity_logs_patient_timestamp_idx
  on public.activity_logs (patient_id, timestamp desc)
  where patient_id is not null;

create index if not exists activity_logs_resource_timestamp_idx
  on public.activity_logs (resource_type, resource_id, timestamp desc)
  where resource_type is not null and resource_id is not null;

create index if not exists activity_logs_session_timestamp_idx
  on public.activity_logs (session_id, timestamp desc)
  where session_id is not null;

create index if not exists activity_logs_immutable_timestamp_idx
  on public.activity_logs (clinic_id, timestamp desc)
  where immutable_audit = true;

-- Preserve every legacy event while making old duplicate keys unique before
-- enforcing idempotency for new audit writes.
with ranked_keys as (
  select
    id,
    idempotency_key,
    row_number() over (partition by idempotency_key order by timestamp asc, id asc) as rn
  from public.activity_logs
  where idempotency_key is not null
)
update public.activity_logs logs
set idempotency_key = ranked_keys.idempotency_key || ':legacy:' || logs.id::text
from ranked_keys
where logs.id = ranked_keys.id
  and ranked_keys.rn > 1;

create unique index if not exists activity_logs_idempotency_key_uidx
  on public.activity_logs (idempotency_key)
  where idempotency_key is not null;

-- Activity logs are served through the authenticated backend. Direct browser
-- access to the table is denied so tenant/capability checks cannot be bypassed.
alter table public.activity_logs enable row level security;
revoke all on table public.activity_logs from anon, authenticated;
grant select, insert, update, delete on table public.activity_logs to service_role;

-- Historical anamnesis logs produced by the Railway process embedded the
-- server UTC clock inside `content`, while `timestamp` was already canonical.
-- Remove only that redundant legacy suffix; the authoritative timestamp stays
-- untouched and will be rendered in the clinic timezone by the UI.
update public.activity_logs
set content = regexp_replace(
  content,
  '\s+em\s+[0-3][0-9]/[0-1][0-9]/[0-9]{4},\s+[0-2][0-9]:[0-5][0-9]:[0-5][0-9]\.?',
  '',
  'g'
)
where (action = 'patient_anamnesis_updated' or title = 'Ficha de anamnese registrada')
  and content ~ '\s+em\s+[0-3][0-9]/[0-1][0-9]/[0-9]{4},\s+[0-2][0-9]:[0-5][0-9]:[0-5][0-9]';

create or replace function public.prevent_immutable_activity_log_mutation_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if old.immutable_audit is true then
    raise exception using
      errcode = 'P0001',
      message = 'IMMUTABLE_AUDIT_LOG';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

revoke all on function public.prevent_immutable_activity_log_mutation_v1() from public, anon, authenticated;

drop trigger if exists activity_logs_prevent_immutable_update_v1 on public.activity_logs;
create trigger activity_logs_prevent_immutable_update_v1
before update on public.activity_logs
for each row
execute function public.prevent_immutable_activity_log_mutation_v1();

drop trigger if exists activity_logs_prevent_immutable_delete_v1 on public.activity_logs;
create trigger activity_logs_prevent_immutable_delete_v1
before delete on public.activity_logs
for each row
execute function public.prevent_immutable_activity_log_mutation_v1();

commit;
