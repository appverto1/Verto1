-- Fail-closed MFA contract for privileged owner sessions.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regclass('public.users') is null then
    raise exception 'USERS_TABLE_REQUIRED_FOR_OWNER_MFA';
  end if;
end
$guard$;

alter table public.users
  add column if not exists two_factor_enabled boolean not null default false,
  add column if not exists two_factor_secret text;

update public.users
   set two_factor_enabled = false
 where two_factor_enabled is null;

alter table public.users
  alter column two_factor_enabled set default false,
  alter column two_factor_enabled set not null;

comment on column public.users.two_factor_enabled is
  'True only after a TOTP code has validated the stored owner MFA secret.';
comment on column public.users.two_factor_secret is
  'Server-only TOTP secret encrypted by the application. Legacy plaintext values are re-encrypted only after successful TOTP validation.';

create table if not exists public.auth_mfa_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge_hash text not null unique,
  user_id uuid not null references public.users(id) on delete cascade,
  purpose text not null check (purpose in ('login', 'setup')),
  setup_secret_encrypted text,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint auth_mfa_challenges_setup_secret_check check (
    (purpose = 'setup' and setup_secret_encrypted is not null)
    or (purpose = 'login' and setup_secret_encrypted is null)
  )
);

create index if not exists auth_mfa_challenges_user_active_idx
  on public.auth_mfa_challenges (user_id, expires_at desc)
  where consumed_at is null;

create index if not exists auth_mfa_challenges_expiry_idx
  on public.auth_mfa_challenges (expires_at)
  where consumed_at is null;

comment on table public.auth_mfa_challenges is
  'Short-lived, one-use MFA challenges. Only a hash of the opaque browser challenge is persisted.';
comment on column public.auth_mfa_challenges.setup_secret_encrypted is
  'Temporary TOTP setup secret encrypted by the application before persistence.';

alter table public.auth_mfa_challenges enable row level security;

revoke all on table public.auth_mfa_challenges from public, anon, authenticated;
grant select, insert, update, delete on table public.auth_mfa_challenges to service_role;

notify pgrst, 'reload schema';

commit;
