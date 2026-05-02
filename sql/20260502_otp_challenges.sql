-- OTP challenges for transactional password recovery flow
-- Run in Supabase SQL editor (production + staging)

create table if not exists public.otp_challenges (
  key text primary key,
  channel text not null check (channel in ('email')),
  purpose text not null check (purpose in ('password_recovery', 'phone_verification')),
  identifier text not null,
  user_id uuid null references auth.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_otp_challenges_identifier_purpose
  on public.otp_challenges (identifier, purpose);

create index if not exists idx_otp_challenges_expires_at
  on public.otp_challenges (expires_at);

create index if not exists idx_otp_challenges_consumed
  on public.otp_challenges (consumed);

create or replace function public.touch_otp_challenges_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_otp_challenges_updated_at on public.otp_challenges;
create trigger trg_touch_otp_challenges_updated_at
before update on public.otp_challenges
for each row
execute function public.touch_otp_challenges_updated_at();

-- Optional hygiene cleanup (run periodically with pg_cron if desired):
-- delete from public.otp_challenges where consumed = true or expires_at < now();
