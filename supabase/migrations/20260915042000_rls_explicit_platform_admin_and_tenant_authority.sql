-- Issue #174 / RLS-H13-A1
-- Forward-only, state-aware hardening. Staging validated first.

do $$ begin
  if to_regclass('public.platform_admins') is null then raise exception 'platform_admins missing'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='platform_admins' and column_name='user_id' and data_type='uuid')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='platform_admins' and column_name='active' and data_type='boolean') then
    raise exception 'platform_admins incompatible shape';
  end if;
  if exists (select 1 from public.demo_sandbox_audit_logs l left join public.clinics c on c.id::text=l.clinic_id where c.id is null or coalesce(c.is_demo,false)=false)
     or exists (select 1 from public.demo_sandbox_templates t left join public.clinics c on c.id::text=t.clinic_id where c.id is null or coalesce(c.is_demo,false)=false) then
    raise exception 'demo sandbox contains non-demo tenant rows';
  end if;
end $$;

create or replace function public.is_platform_admin(target_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$
 select target_user is not null and exists(select 1 from public.platform_admins pa where pa.user_id=target_user and pa.active=true)
$$;

-- Legacy helper must no longer confer a global clinical bypass.
create or replace function public.is_admin_or_owner(target_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$ select false $$;

create or replace function public.can_access_clinic(target_clinic uuid, target_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$
 select target_clinic is not null and exists(select 1 from public.clinic_memberships cm where cm.user_id=target_user and cm.clinic_id=target_clinic and cm.status='active')
$$;

create or replace function public.can_manage_clinic(target_clinic uuid, target_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$
 select target_clinic is not null and exists(select 1 from public.clinic_memberships cm where cm.user_id=target_user and cm.clinic_id=target_clinic and cm.status='active' and cm.role='coordinator')
$$;

create or replace function public.is_platform_sales_admin() returns boolean language sql stable security definer set search_path=public as $$ select public.is_platform_admin(auth.uid()) $$;

insert into public.clinic_memberships(user_id,clinic_id,role,status,created_at,updated_at)
select 'd5e99767-3595-4b29-b4ec-d48ac3c66e3e'::uuid,'7a7054c6-0e1a-4745-910b-f1296faacaff'::uuid,'receptionist','active',now(),now()
where exists(select 1 from public.users u where u.id='d5e99767-3595-4b29-b4ec-d48ac3c66e3e'::uuid and u.clinic_id='7a7054c6-0e1a-4745-910b-f1296faacaff'::uuid and u.role='receptionist')
on conflict (user_id,clinic_id) do update set status='active', role='receptionist', updated_at=now();

alter policy users_select_self_or_admin on public.users using ((id=auth.uid()) or public.is_platform_admin(auth.uid()));
alter policy users_update_self_or_admin on public.users using ((id=auth.uid()) or public.is_platform_admin(auth.uid())) with check ((id=auth.uid()) or public.is_platform_admin(auth.uid()));

alter policy activity_logs_select_own_or_admin on public.activity_logs using ((user_id=auth.uid()) or (clinic_id is null and public.is_platform_admin(auth.uid())) or (clinic_id is not null and public.can_access_clinic(clinic_id,auth.uid())));
alter policy activity_logs_update_own_or_admin on public.activity_logs using ((user_id=auth.uid()) or (clinic_id is null and public.is_platform_admin(auth.uid())) or (clinic_id is not null and public.can_manage_clinic(clinic_id,auth.uid()))) with check ((user_id=auth.uid()) or (clinic_id is null and public.is_platform_admin(auth.uid())) or (clinic_id is not null and public.can_manage_clinic(clinic_id,auth.uid())));
alter policy activity_logs_write_own_or_admin on public.activity_logs with check ((user_id=auth.uid()) or (clinic_id is null and public.is_platform_admin(auth.uid())) or (clinic_id is not null and public.can_access_clinic(clinic_id,auth.uid())));

alter policy professional_profiles_access on public.professional_profiles using ((user_id=auth.uid()) or public.is_platform_admin(auth.uid()) or exists(select 1 from public.clinic_memberships mine join public.clinic_memberships theirs on theirs.clinic_id=mine.clinic_id where mine.user_id=auth.uid() and mine.status='active' and theirs.user_id=professional_profiles.user_id and theirs.status='active')) with check ((user_id=auth.uid()) or public.is_platform_admin(auth.uid()));

alter policy record_read_audit_select_internal on public.record_read_audit using (clinic_id is not null and public.can_manage_clinic(clinic_id,auth.uid()));
alter policy record_read_audit_select_owner_admin on public.record_read_audit using (clinic_id is not null and public.can_manage_clinic(clinic_id,auth.uid()));

alter policy financial_feedback_owner_read on public.financial_module_feedback using (public.is_platform_admin(auth.uid()));
alter policy protocol_import_requests_owner_all on public.protocol_import_requests using (public.is_platform_admin(auth.uid())) with check (public.is_platform_admin(auth.uid()));
alter policy verto_canonical_protocols_owner_all on public.verto_canonical_protocols using (public.is_platform_admin(auth.uid())) with check (public.is_platform_admin(auth.uid()));
alter policy demo_sandbox_audit_logs_admin_read on public.demo_sandbox_audit_logs using (public.is_platform_admin(auth.uid()));
alter policy demo_sandbox_templates_admin_read on public.demo_sandbox_templates using (public.is_platform_admin(auth.uid()));

alter policy clinic_state_select on public.clinic_state using (public.can_access_clinic(clinic_id,auth.uid()));
alter policy clinic_state_insert on public.clinic_state with check (public.can_access_clinic(clinic_id,auth.uid()));
alter policy clinic_state_update on public.clinic_state using (public.can_access_clinic(clinic_id,auth.uid())) with check (public.can_access_clinic(clinic_id,auth.uid()));
alter policy clinic_state_delete on public.clinic_state using (public.can_manage_clinic(clinic_id,auth.uid()));
