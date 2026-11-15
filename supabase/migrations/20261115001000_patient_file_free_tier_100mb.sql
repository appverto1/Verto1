-- Drive do paciente: 100 MiB gratuitos, capacidade concedida ate 1 GiB.
-- Apenas service_role pode ampliar a franquia; nenhuma compra/role e inferida do frontend.
-- Preserva arquivos e consumo existentes, inclusive pacientes que excedam a franquia inicial.
begin;

alter table public.patient_file_storage_usage
  add column if not exists quota_bytes bigint not null default 104857600;

alter table public.patient_file_storage_usage
  drop constraint if exists patient_file_storage_usage_quota_bytes_bounds;
alter table public.patient_file_storage_usage
  add constraint patient_file_storage_usage_quota_bytes_bounds
  check (quota_bytes between 104857600 and 1073741824);

comment on column public.patient_file_storage_usage.quota_bytes is
  'Franquia autorizada por paciente: 100 MiB gratuitos, maximo absoluto 1 GiB; alteracao exclusiva do servidor.';

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
  with allowance as (
    select
      coalesce(usage.used_bytes, 0::bigint) as used_bytes,
      coalesce(usage.quota_bytes, 104857600::bigint) as limit_bytes
    from (select 1) as anchor
    left join public.patient_file_storage_usage usage
      on usage.patient_id = p_patient_id
     and usage.clinic_id = p_clinic_id
  )
  select
    allowance.used_bytes,
    allowance.limit_bytes,
    greatest(allowance.limit_bytes - allowance.used_bytes, 0::bigint)
  from allowance;
$$;

revoke all on function public.get_patient_file_storage_usage_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_patient_file_storage_usage_v1(uuid, uuid) to service_role;

create or replace function public.enforce_patient_file_storage_quota_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_bytes bigint := 0;
  granted_bytes bigint := 104857600;
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

  select usage.used_bytes, usage.quota_bytes
    into current_bytes, granted_bytes
  from public.patient_file_storage_usage usage
  where usage.clinic_id = new.clinic_id
    and usage.patient_id = new.patient_id
  for update;

  delta_bytes := case
    when tg_op = 'UPDATE' then incoming_bytes - greatest(coalesce(old.file_size_bytes, 0), 0)
    else incoming_bytes
  end;
  projected_bytes := greatest(current_bytes + delta_bytes, 0);

  if projected_bytes > granted_bytes then
    raise exception 'O Drive deste paciente atingiu o espaço de armazenamento disponível.'
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

revoke all on function public.enforce_patient_file_storage_quota_v1() from public, anon, authenticated;

-- A tabela ja possui RLS; nenhuma operacao de quota e exposta ao cliente.
revoke all on table public.patient_file_storage_usage from public, anon, authenticated;
grant select, insert, update, delete on table public.patient_file_storage_usage to service_role;

commit;
