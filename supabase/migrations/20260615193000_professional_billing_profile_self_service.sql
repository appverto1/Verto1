-- Self-service do perfil faturavel: o profissional edita apenas o proprio cadastro.
-- A politica administrativa existente continua responsavel pela gestao da clinica.

alter table public.professional_billing_profiles enable row level security;

drop policy if exists professional_billing_profiles_self_select on public.professional_billing_profiles;
create policy professional_billing_profiles_self_select
on public.professional_billing_profiles
for select
to authenticated
using (
  professional_id = auth.uid()
  and exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'therapist'
      and u.clinic_id = professional_billing_profiles.clinic_id
  )
);

drop policy if exists professional_billing_profiles_self_insert on public.professional_billing_profiles;
create policy professional_billing_profiles_self_insert
on public.professional_billing_profiles
for insert
to authenticated
with check (
  professional_id = auth.uid()
  and organization_id = clinic_id
  and exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'therapist'
      and u.clinic_id = professional_billing_profiles.clinic_id
  )
);

drop policy if exists professional_billing_profiles_self_update on public.professional_billing_profiles;
create policy professional_billing_profiles_self_update
on public.professional_billing_profiles
for update
to authenticated
using (
  professional_id = auth.uid()
  and exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'therapist'
      and u.clinic_id = professional_billing_profiles.clinic_id
  )
)
with check (
  professional_id = auth.uid()
  and organization_id = clinic_id
  and exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'therapist'
      and u.clinic_id = professional_billing_profiles.clinic_id
  )
);

revoke all on table public.professional_billing_profiles from anon;
