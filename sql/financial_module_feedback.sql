create table if not exists public.financial_module_feedback (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  user_id uuid not null,
  user_email text,
  selected_features text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, user_id)
);

alter table public.financial_module_feedback enable row level security;

drop policy if exists "financial_feedback_owner_read" on public.financial_module_feedback;
create policy "financial_feedback_owner_read"
on public.financial_module_feedback
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'owner'
  )
);

drop policy if exists "financial_feedback_workspace_read" on public.financial_module_feedback;
create policy "financial_feedback_workspace_read"
on public.financial_module_feedback
for select
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.clinic_id = financial_module_feedback.clinic_id
      and u.role in ('coordinator', 'admin', 'receptionist', 'therapist')
  )
);

drop policy if exists "financial_feedback_workspace_write" on public.financial_module_feedback;
create policy "financial_feedback_workspace_write"
on public.financial_module_feedback
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.clinic_id = financial_module_feedback.clinic_id
      and u.role in ('coordinator', 'admin', 'receptionist', 'therapist')
  )
);

drop policy if exists "financial_feedback_workspace_update" on public.financial_module_feedback;
create policy "financial_feedback_workspace_update"
on public.financial_module_feedback
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

