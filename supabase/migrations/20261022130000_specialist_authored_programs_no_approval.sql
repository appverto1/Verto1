-- P1: specialty programs authored by their responsible specialist do not need a
-- second administrative approval to become usable in sessions.
-- Existing backend already creates new eligible programs directly as 'teaching'.
-- Reconcile ONLY legacy 'awaiting_approval' records that still qualify today.
-- No global status rewrite; all conditions are checked against current DB scope.
-- Use the pre-existing versioned RPC to keep clinical versions, activation
-- metadata and audit events consistent. Does not modify PTS or draft plans.
do $$
declare
  candidate record;
  result jsonb;
begin
  for candidate in
    select
      p.id::text as program_id,
      p.organization_id::text as organization_id,
      p.patient_id::uuid as patient_id,
      p.version::integer as program_version,
      t.responsible_professional_id::text as specialist_id
    from public.aba_programs p
    join public.patient_therapeutic_plans t
      on t.id::text = p.therapeutic_plan_id::text
      and t.organization_id::text = p.organization_id::text
      and t.patient_id::text = p.patient_id::text
    where p.status = 'awaiting_approval'
      and t.mode = 'specialty'
      and t.status = 'active'
      -- This is a specialist-authored program, not a manager's review queue.
      and p.created_by::text = t.responsible_professional_id::text
      and exists (
        select 1 from public.clinic_memberships cm
        where cm.clinic_id::text = t.clinic_id::text
          and cm.user_id::text = t.responsible_professional_id::text
          and cm.role = 'therapist'
          and cm.status = 'active'
          and lower(btrim(coalesce(cm.specialty,''))) = lower(btrim(coalesce(t.specialty,'')))
      )
      and exists (
        select 1 from public.patient_professional_links link
        where link.organization_id::text = t.organization_id::text
          and link.patient_id::text = t.patient_id::text
          and link.professional_id::text = t.responsible_professional_id::text
          and link.status = 'active'
          and coalesce((link.permissions->>'write')::boolean,true)
      )
    order by p.id
    for update of p
  loop
    result := public.update_therapeutic_program_status(
      candidate.organization_id,
      candidate.patient_id,
      candidate.program_id,
      'teaching',
      candidate.program_version,
      'Ativação de programa da própria especialidade sem aprovação administrativa',
      'specialist-self-authored-activation:' || candidate.program_id || ':' || candidate.program_version::text,
      candidate.specialist_id
    );
    if coalesce(result->>'status','') <> 'teaching' then
      raise exception 'SPECIALIST_LEGACY_ACTIVATION_NOT_CONFIRMED';
    end if;
  end loop;
end;
$$;
