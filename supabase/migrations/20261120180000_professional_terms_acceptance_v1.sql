-- LGPD-04: immutable evidence of professional terms acceptance.
-- The invitation wrapper records acceptance in the same transaction that
-- links the account to the clinic. Only the trusted backend may call it.
begin;

create table if not exists public.user_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  document_key text not null check (document_key = 'professional_terms'),
  document_version text not null check (char_length(document_version) between 1 and 24),
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  context_key text not null check (char_length(context_key) between 1 and 110),
  accepted_at timestamptz not null default now(),
  constraint user_legal_acceptances_unique_v1
    unique (user_id, document_key, document_sha256, context_key)
);

alter table public.user_legal_acceptances enable row level security;
revoke all on table public.user_legal_acceptances from public, anon, authenticated;
grant select, insert on table public.user_legal_acceptances to service_role;

create or replace function public.accept_clinic_invitation_with_terms_v1(
  p_invitation_id uuid,
  p_user_id uuid,
  p_verified_email text,
  p_document_version text,
  p_document_sha256 text
)
returns table (
  invitation_id uuid,
  clinic_id uuid,
  membership_role text,
  invitation_status text,
  membership_status text,
  idempotent boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_link record;
begin
  if p_document_version <> 'v1.1'
    or p_document_sha256 is null
    or p_document_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0001', message = 'PROFESSIONAL_TERMS_VERSION_INVALID';
  end if;

  -- Invited identity, email, clinic role and concurrency are still validated
  -- by the canonical, pre-existing atomic invitation acceptance routine.
  select * into v_link
  from public.accept_clinic_invitation_v1(
    p_invitation_id, p_user_id, p_verified_email
  );
  if not found then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_ACCEPT_FAILED';
  end if;

  insert into public.user_legal_acceptances (
    user_id, document_key, document_version, document_sha256, context_key
  ) values (
    p_user_id,
    'professional_terms',
    p_document_version,
    p_document_sha256,
    'invitation:' || p_invitation_id::text
  )
  on conflict on constraint user_legal_acceptances_unique_v1 do nothing;

  return query
  select v_link.invitation_id::uuid,
    v_link.clinic_id::uuid,
    v_link.membership_role::text,
    v_link.invitation_status::text,
    v_link.membership_status::text,
    v_link.idempotent::boolean;
end;
$function$;

revoke all on function public.accept_clinic_invitation_with_terms_v1(uuid,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.accept_clinic_invitation_with_terms_v1(uuid,uuid,text,text,text)
  to service_role;

commit;
