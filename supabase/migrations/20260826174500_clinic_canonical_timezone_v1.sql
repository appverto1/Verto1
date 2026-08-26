-- Canonical clinic timezone (IANA) for clinical wall-clock rendering.
-- Database timestamps remain timestamptz/UTC; this column is the presentation
-- and clinical-calendar authority for the clinic, independent from device TZ.
-- Additive/idempotent. Existing clinics are backfilled from UF when available.

begin;

alter table if exists public.clinics
  add column if not exists timezone text;

do $backfill$
begin
  if to_regclass('public.clinics') is null then
    raise exception 'CLINICS_SCHEMA_PENDING';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clinics'
      and column_name = 'state'
  ) then
    execute $sql$
      update public.clinics clinic
      set timezone = case upper(coalesce(clinic.state, ''))
        when 'AC' then 'America/Rio_Branco'
        when 'AL' then 'America/Maceio'
        when 'AP' then 'America/Belem'
        when 'AM' then 'America/Manaus'
        when 'BA' then 'America/Bahia'
        when 'CE' then 'America/Fortaleza'
        when 'DF' then 'America/Sao_Paulo'
        when 'ES' then 'America/Sao_Paulo'
        when 'GO' then 'America/Sao_Paulo'
        when 'MA' then 'America/Fortaleza'
        when 'MT' then 'America/Cuiaba'
        when 'MS' then 'America/Campo_Grande'
        when 'MG' then 'America/Sao_Paulo'
        when 'PA' then 'America/Belem'
        when 'PB' then 'America/Fortaleza'
        when 'PR' then 'America/Sao_Paulo'
        when 'PE' then 'America/Recife'
        when 'PI' then 'America/Fortaleza'
        when 'RJ' then 'America/Sao_Paulo'
        when 'RN' then 'America/Fortaleza'
        when 'RS' then 'America/Sao_Paulo'
        when 'RO' then 'America/Porto_Velho'
        when 'RR' then 'America/Boa_Vista'
        when 'SC' then 'America/Sao_Paulo'
        when 'SP' then 'America/Sao_Paulo'
        when 'SE' then 'America/Maceio'
        when 'TO' then 'America/Araguaina'
        else 'America/Sao_Paulo'
      end
      where nullif(btrim(clinic.timezone), '') is null
         or not exists (
           select 1
           from pg_catalog.pg_timezone_names zone
           where zone.name = btrim(clinic.timezone)
         )
    $sql$;
  else
    update public.clinics clinic
    set timezone = 'America/Sao_Paulo'
    where nullif(btrim(clinic.timezone), '') is null
       or not exists (
         select 1
         from pg_catalog.pg_timezone_names zone
         where zone.name = btrim(clinic.timezone)
       );
  end if;
end;
$backfill$;

alter table if exists public.clinics
  alter column timezone set default 'America/Sao_Paulo';

alter table if exists public.clinics
  alter column timezone set not null;

create or replace function public.guard_clinic_timezone_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_timezone text;
begin
  select zone.name
  into v_timezone
  from pg_catalog.pg_timezone_names zone
  where zone.name = nullif(btrim(new.timezone), '')
  limit 1;

  if v_timezone is null then
    raise exception 'CLINIC_TIMEZONE_INVALID'
      using detail = 'Use a valid IANA timezone such as America/Sao_Paulo or America/Campo_Grande';
  end if;

  new.timezone := v_timezone;
  return new;
end;
$function$;

revoke all on function public.guard_clinic_timezone_v1() from public, anon;

drop trigger if exists trg_guard_clinic_timezone_v1 on public.clinics;
create trigger trg_guard_clinic_timezone_v1
before insert or update of timezone on public.clinics
for each row execute function public.guard_clinic_timezone_v1();

comment on column public.clinics.timezone is
  'Canonical clinic IANA timezone. Timestamps remain UTC; clinical wall-clock rendering derives from this value.';

notify pgrst, 'reload schema';

commit;
