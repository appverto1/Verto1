-- ABA V3 prompt catalog hardening.
-- Persist system prompt types once per clinic so the V3 collection UI never
-- advertises an in-memory default that the authoritative writer cannot accept.
-- Existing rows are preserved exactly; only missing defaults are inserted.

create or replace function public.aba_prompt_type_system_defaults_v1()
returns table (
  key text,
  name text,
  category text,
  independence_score numeric,
  intrusiveness_order integer,
  counts_as_independent boolean,
  show_in_session boolean,
  active boolean,
  description text,
  is_system_default boolean
)
language sql
immutable
set search_path = pg_catalog, public
as $function$
  values
    ('independent',      'Independente',     'Independente', 100::numeric, 0,  true,  true, true, 'Resposta sem ajuda.', true),
    ('visual_partial',   'Visual parcial',    'Visual',        80::numeric, 1,  false, true, true, 'Dica visual parcial sem entregar a resposta completa.', true),
    ('visual_total',     'Visual total',      'Visual',        60::numeric, 2,  false, true, true, 'Ajuda visual completa.', true),
    ('gestural',         'Gestual',           'Gestual',       70::numeric, 3,  false, true, true, 'Gestos, apontamentos ou indicação corporal.', true),
    ('verbal_partial',   'Verbal parcial',    'Verbal',        60::numeric, 4,  false, true, true, 'Dica verbal parcial.', true),
    ('verbal_total',     'Verbal total',      'Verbal',        40::numeric, 5,  false, true, true, 'Dica verbal completa.', true),
    ('model',            'Modelo',            'Modelo',        50::numeric, 6,  false, true, true, 'Modelo demonstrado pelo terapeuta.', true),
    ('partial_physical', 'Física parcial',    'Física',        30::numeric, 7,  false, true, true, 'Ajuda física parcial.', true),
    ('full_physical',    'Física total',      'Física',         0::numeric, 8,  false, true, true, 'Ajuda física total.', true),
    ('error_block',      'Bloqueio de erro',  'Bloqueio',       0::numeric, 9,  false, true, true, 'Bloqueio preventivo ou correção segura do erro.', true),
    ('positional_cue',   'Dica posicional',   'Posicional',    70::numeric, 10, false, true, true, 'Organização posicional dos estímulos para favorecer resposta.', true)
$function$;

revoke all on function public.aba_prompt_type_system_defaults_v1() from public, anon, authenticated;
grant execute on function public.aba_prompt_type_system_defaults_v1() to service_role;

create or replace function public.initialize_aba_prompt_types_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  insert into public.aba_prompt_types (
    organization_id,
    key,
    name,
    category,
    independence_score,
    intrusiveness_order,
    counts_as_independent,
    show_in_session,
    active,
    description,
    is_system_default
  )
  select
    new.id,
    defaults.key,
    defaults.name,
    defaults.category,
    defaults.independence_score,
    defaults.intrusiveness_order,
    defaults.counts_as_independent,
    defaults.show_in_session,
    defaults.active,
    defaults.description,
    defaults.is_system_default
  from public.aba_prompt_type_system_defaults_v1() defaults
  where not exists (
    select 1
    from public.aba_prompt_types existing
    where existing.organization_id = new.id
      and existing.key = defaults.key
  )
    and not exists (
      select 1
      from public.aba_prompt_types existing
      where existing.organization_id = new.id
        and existing.active = true
        and lower(existing.name) = lower(defaults.name)
    );

  return new;
end
$function$;

revoke all on function public.initialize_aba_prompt_types_v1() from public, anon, authenticated;
grant execute on function public.initialize_aba_prompt_types_v1() to service_role;

drop trigger if exists clinics_initialize_aba_prompt_types_v1 on public.clinics;
create trigger clinics_initialize_aba_prompt_types_v1
after insert on public.clinics
for each row execute function public.initialize_aba_prompt_types_v1();

-- Set-based, idempotent backfill for clinics that already existed before this
-- migration. Do not update any existing prompt: clinic customizations and V2
-- compatibility snapshots remain untouched.
insert into public.aba_prompt_types (
  organization_id,
  key,
  name,
  category,
  independence_score,
  intrusiveness_order,
  counts_as_independent,
  show_in_session,
  active,
  description,
  is_system_default
)
select
  clinic.id,
  defaults.key,
  defaults.name,
  defaults.category,
  defaults.independence_score,
  defaults.intrusiveness_order,
  defaults.counts_as_independent,
  defaults.show_in_session,
  defaults.active,
  defaults.description,
  defaults.is_system_default
from public.clinics clinic
cross join public.aba_prompt_type_system_defaults_v1() defaults
where not exists (
  select 1
  from public.aba_prompt_types existing
  where existing.organization_id = clinic.id
    and existing.key = defaults.key
)
  and not exists (
    select 1
    from public.aba_prompt_types existing
    where existing.organization_id = clinic.id
      and existing.active = true
      and lower(existing.name) = lower(defaults.name)
  );
