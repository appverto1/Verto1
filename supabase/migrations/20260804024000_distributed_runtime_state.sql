-- Verto — Fase 2 de estabilização
-- Estado distribuído para sessão ativa, rate limits e leases de jobs.

begin;

create table if not exists public.runtime_active_sessions (
  user_id text primary key,
  token_hash text not null check (length(token_hash) = 64),
  issued_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  updated_at timestamptz not null default now()
);

alter table public.runtime_active_sessions
  add column if not exists revoked_at timestamptz null;

create index if not exists runtime_active_sessions_expires_at_idx
  on public.runtime_active_sessions (expires_at);

create table if not exists public.runtime_rate_limits (
  scope text not null,
  key_hash text not null check (length(key_hash) = 64),
  total_hits integer not null default 0 check (total_hits >= 0),
  reset_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash)
);

create index if not exists runtime_rate_limits_reset_at_idx
  on public.runtime_rate_limits (reset_at);

create table if not exists public.runtime_job_leases (
  job_key text primary key,
  owner_id text not null,
  acquired_at timestamptz not null default now(),
  lease_until timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists runtime_job_leases_lease_until_idx
  on public.runtime_job_leases (lease_until);

alter table public.runtime_active_sessions enable row level security;
alter table public.runtime_rate_limits enable row level security;
alter table public.runtime_job_leases enable row level security;

revoke all on table public.runtime_active_sessions from public, anon, authenticated;
revoke all on table public.runtime_rate_limits from public, anon, authenticated;
revoke all on table public.runtime_job_leases from public, anon, authenticated;

grant select, insert, update, delete on table public.runtime_active_sessions to service_role;
grant select, insert, update, delete on table public.runtime_rate_limits to service_role;
grant select, insert, update, delete on table public.runtime_job_leases to service_role;

comment on table public.runtime_active_sessions is
  'Sessão ativa autoritativa por usuário. Armazena somente hash do token.';
comment on table public.runtime_rate_limits is
  'Contadores distribuídos dos limitadores HTTP, sem armazenar IP, e-mail ou telefone em texto claro.';
comment on table public.runtime_job_leases is
  'Leases distribuídos para impedir execução concorrente de crons e jobs entre réplicas.';

commit;
