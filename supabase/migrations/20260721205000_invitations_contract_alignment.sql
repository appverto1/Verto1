-- Align the invitation audit fields already used by the current backend.
-- Existing invitations remain untouched except for a safe updated_at fallback.

do $$
begin
  if to_regclass('public.invitations') is null then
    raise notice 'public.invitations is absent; invitation contract alignment skipped.';
    return;
  end if;

  alter table public.invitations
    add column if not exists clinic_name text,
    add column if not exists invited_by text,
    add column if not exists updated_at timestamptz,
    add column if not exists accepted_at timestamptz,
    add column if not exists canceled_at timestamptz,
    add column if not exists canceled_by text;

  update public.invitations
     set updated_at = coalesce(updated_at, created_at, now())
   where updated_at is null;

  alter table public.invitations
    alter column updated_at set default now();

  create index if not exists idx_invitations_clinic_status_created
    on public.invitations(clinic_id, status, created_at desc);
end;
$$;

notify pgrst, 'reload schema';

-- Rollback: drop only idx_invitations_clinic_status_created. Preserve the audit
-- columns because they may already contain acceptance or cancellation history.
