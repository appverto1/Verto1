begin;

-- Drive do paciente: 10 MiB por arquivo e 1 GiB total por paciente.
-- O uso total fica materializado em uma linha por paciente: registra 1x e lê várias.
-- A trigger atualiza essa linha na mesma transação de patient_files, usando row lock
-- para impedir race conditions em uploads concorrentes.

do $$
begin
  if to_regclass('public.patient_files') is null then
    raise exception 'public.patient_files precisa existir antes de aplicar a quota do Drive.';
  end if;
end
$$;

create table if not exists public.patient_file_storage_usage (
  clinic_id uuid not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  used_bytes bigint not null default 0 check (used_bytes >= 0),
  updated_at timestamptz not null default now(),
  primary key (clinic_id, patient_id)
);

alter table public.patient_file_storage_usage enable row level security;
revoke all on table public.patient_file_storage_usage from public;
revoke all on table public.patient_file_storage_usage from anon;
revoke all on table public.patient_file_storage_usage from authenticated;
grant select, insert, update, delete on table public.patient_file_storage_usage to service_role;

create index if not exists patient_files_clinic_patient_quota_idx
  on public.patient_files (clinic_id, patient_id)
  include (file_size_bytes);

-- Backfill único e idempotente. Não apaga nem altera arquivos existentes.
insert into public.patient_file_storage_usage (clinic_id, patient_id, used_bytes, updated_at)
select
  pf.clinic_id,
  pf.patient_id,
  coalesce(sum(greatest(coalesce(pf.file_size_bytes, 0), 0)), 0)::bigint,
  now()
from public.patient_files pf
group by pf.clinic_id, pf.patient_id
on conflict (clinic_id, patient_id) do update
set
  used_bytes = excluded.used_bytes,
  updated_at = excluded.updated_at;

create or replace function public.get_patient_file_storage_usage_v1(
  p_patient_id uuid,
  p_clinic_id uuid
)
returns table (
  used_bytes bigint,
  limit_bytes bigint,
  remaining_bytes bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with usage as (
    select coalesce((
      select storage_usage.used_bytes
      from public.patient_file_storage_usage storage_usage
      where storage_usage.patient_id = p_patient_id
        and storage_usage.clinic_id = p_clinic_id
    ), 0::bigint) as used_bytes
  )
  select
    usage.used_bytes,
    1073741824::bigint as limit_bytes,
    greatest(1073741824::bigint - usage.used_bytes, 0::bigint) as remaining_bytes
  from usage;
$$;

revoke all on function public.get_patient_file_storage_usage_v1(uuid, uuid) from public;
revoke all on function public.get_patient_file_storage_usage_v1(uuid, uuid) from anon;
revoke all on function public.get_patient_file_storage_usage_v1(uuid, uuid) from authenticated;
grant execute on function public.get_patient_file_storage_usage_v1(uuid, uuid) to service_role;

create or replace function public.enforce_patient_file_storage_quota_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_bytes bigint := 0;
  incoming_bytes bigint := 0;
  delta_bytes bigint := 0;
  projected_bytes bigint := 0;
begin
  if tg_op = 'DELETE' then
    insert into public.patient_file_storage_usage (clinic_id, patient_id, used_bytes, updated_at)
    values (old.clinic_id, old.patient_id, 0, now())
    on conflict (clinic_id, patient_id) do nothing;

    select usage.used_bytes
      into current_bytes
    from public.patient_file_storage_usage usage
    where usage.clinic_id = old.clinic_id
      and usage.patient_id = old.patient_id
    for update;

    update public.patient_file_storage_usage
    set
      used_bytes = greatest(current_bytes - greatest(coalesce(old.file_size_bytes, 0), 0), 0),
      updated_at = now()
    where clinic_id = old.clinic_id
      and patient_id = old.patient_id;

    return old;
  end if;

  if new.patient_id is null or new.clinic_id is null then
    raise exception 'Paciente e clínica são obrigatórios para armazenar arquivos.'
      using errcode = '23502', detail = 'PATIENT_FILE_SCOPE_REQUIRED';
  end if;

  incoming_bytes := greatest(coalesce(new.file_size_bytes, 0), 0);
  if incoming_bytes <= 0 then
    raise exception 'O arquivo deve possuir tamanho válido.'
      using errcode = '22023', detail = 'PATIENT_FILE_INVALID_SIZE';
  end if;

  if incoming_bytes > 10485760 then
    raise exception 'O arquivo deve ter no máximo 10 MB.'
      using errcode = '22023', detail = 'PATIENT_FILE_TOO_LARGE';
  end if;

  if tg_op = 'UPDATE' and (new.patient_id <> old.patient_id or new.clinic_id <> old.clinic_id) then
    raise exception 'O escopo de um arquivo do paciente não pode ser alterado.'
      using errcode = '22023', detail = 'PATIENT_FILE_SCOPE_IMMUTABLE';
  end if;

  insert into public.patient_file_storage_usage (clinic_id, patient_id, used_bytes, updated_at)
  values (new.clinic_id, new.patient_id, 0, now())
  on conflict (clinic_id, patient_id) do nothing;

  select usage.used_bytes
    into current_bytes
  from public.patient_file_storage_usage usage
  where usage.clinic_id = new.clinic_id
    and usage.patient_id = new.patient_id
  for update;

  delta_bytes := case
    when tg_op = 'UPDATE' then incoming_bytes - greatest(coalesce(old.file_size_bytes, 0), 0)
    else incoming_bytes
  end;
  projected_bytes := greatest(current_bytes + delta_bytes, 0);

  if projected_bytes > 1073741824 then
    raise exception 'O Drive deste paciente atingiu o limite total de 1 GB.'
      using errcode = 'P0001', detail = 'PATIENT_FILE_STORAGE_QUOTA_EXCEEDED';
  end if;

  update public.patient_file_storage_usage
  set
    used_bytes = projected_bytes,
    updated_at = now()
  where clinic_id = new.clinic_id
    and patient_id = new.patient_id;

  return new;
end;
$$;

revoke all on function public.enforce_patient_file_storage_quota_v1() from public;
revoke all on function public.enforce_patient_file_storage_quota_v1() from anon;
revoke all on function public.enforce_patient_file_storage_quota_v1() from authenticated;

drop trigger if exists patient_files_storage_quota_v1 on public.patient_files;
create trigger patient_files_storage_quota_v1
before insert or update of file_size_bytes, patient_id, clinic_id or delete
on public.patient_files
for each row
execute function public.enforce_patient_file_storage_quota_v1();

commit;
