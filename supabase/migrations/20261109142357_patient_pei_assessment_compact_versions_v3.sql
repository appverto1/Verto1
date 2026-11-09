-- One immutable source protocol per plan; revisions store only mutable content.
-- This prevents duplicating potentially large licensed protocol payloads on
-- every Save. The plan is never hard-deleted while historical revisions exist.
create or replace function public.compact_pei_assessment_version_snapshot_v1()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $body$
begin
  new.snapshot := jsonb_build_object(
    'id', new.snapshot->'id',
    'clinic_id', new.snapshot->'clinic_id',
    'patient_id', new.snapshot->'patient_id',
    'specialty', new.snapshot->'specialty',
    'responsible_professional_id', new.snapshot->'responsible_professional_id',
    'protocol_id', new.snapshot->'protocol_id',
    'title', new.snapshot->'title',
    'content', new.snapshot->'content',
    'status', new.snapshot->'status',
    'revision', new.snapshot->'revision',
    'updated_by', new.snapshot->'updated_by',
    'updated_at', new.snapshot->'updated_at'
  );
  return new;
end;
$body$;
revoke all on function public.compact_pei_assessment_version_snapshot_v1() from public, anon, authenticated;
grant execute on function public.compact_pei_assessment_version_snapshot_v1() to service_role;
drop trigger if exists compact_pei_assessment_version_snapshot_v1 on public.patient_pei_assessment_plan_versions_v1;
create trigger compact_pei_assessment_version_snapshot_v1
before insert on public.patient_pei_assessment_plan_versions_v1
for each row execute function public.compact_pei_assessment_version_snapshot_v1();
