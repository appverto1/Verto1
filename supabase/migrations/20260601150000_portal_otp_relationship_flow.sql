-- Portal relationship confirmation login by one-time code.
-- Additive/idempotent: relationship tokens locate requests, OTP authenticates the portal user.

create extension if not exists pgcrypto;

create table if not exists public.otp_challenges (
  key text primary key,
  channel text not null default 'email',
  purpose text not null,
  identifier text not null,
  user_id uuid,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.otp_challenges
  add column if not exists key text,
  add column if not exists channel text not null default 'email',
  add column if not exists purpose text,
  add column if not exists identifier text,
  add column if not exists user_id uuid,
  add column if not exists code_hash text,
  add column if not exists expires_at timestamptz,
  add column if not exists attempts integer not null default 0,
  add column if not exists consumed boolean not null default false,
  add column if not exists created_at timestamptz not null default now();

alter table public.otp_challenges
  drop constraint if exists otp_challenges_purpose_check;

alter table public.otp_challenges
  add constraint otp_challenges_purpose_check
  check (purpose in ('password_recovery', 'phone_verification', 'portal_login'));

create index if not exists idx_otp_challenges_identifier_purpose
  on public.otp_challenges (identifier, purpose, consumed, expires_at desc);

alter table public.otp_challenges enable row level security;

drop policy if exists otp_challenges_service_only on public.otp_challenges;
create policy otp_challenges_service_only
on public.otp_challenges
for all
using (false)
with check (false);

alter table if exists public.patient_relationship_confirmations
  add column if not exists relationship_token_version integer not null default 1,
  add column if not exists portal_login_required boolean not null default true,
  add column if not exists history_authorized_at timestamptz,
  add column if not exists history_authorized_by uuid;

create index if not exists idx_relationship_confirmations_pending_email
  on public.patient_relationship_confirmations (email_normalized, status, expires_at desc)
  where status = 'PENDING';

