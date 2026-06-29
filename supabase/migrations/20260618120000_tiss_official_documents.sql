-- Official assisted TISS SP/SADT XML documents.
-- Additive only. This creates validated, immutable official XML storage.
-- It does NOT transmit SOAP, create remittances, receive returns, process denials,
-- use certificates, perform mTLS, or integrate with payer portals.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.tiss_official_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  payer_id uuid not null references public.clinic_payers(id) on delete restrict,
  competence_month date not null,
  guide_type text not null default 'sp_sadt',
  document_type text not null default 'official_tiss_sp_sadt_xml',
  communication_version text not null,
  content_structure_version text not null,
  tuss_version text,
  schema_root_file text not null,
  schema_manifest_checksum text not null,
  batch_number text not null,
  status text not null default 'validated',
  xml_content text not null,
  xml_hash text not null,
  generated_from_pre_guide_ids uuid[] not null,
  idempotency_key text not null,
  validation_summary jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  guide_count integer not null default 0,
  total_amount_cents integer not null default 0,
  generated_by uuid references public.users(id) on delete set null,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tiss_official_documents_tenant_check check (organization_id = clinic_id),
  constraint tiss_official_documents_guide_type_check check (guide_type = 'sp_sadt'),
  constraint tiss_official_documents_type_check check (document_type = 'official_tiss_sp_sadt_xml'),
  constraint tiss_official_documents_status_check check (status in ('validated', 'cancelled')),
  constraint tiss_official_documents_count_check check (guide_count > 0 and guide_count <= 100),
  constraint tiss_official_documents_total_check check (total_amount_cents > 0),
  constraint tiss_official_documents_hash_check check (xml_hash ~ '^[a-f0-9]{64}$'),
  constraint tiss_official_documents_pre_guides_check check (cardinality(generated_from_pre_guide_ids) > 0)
);

create index if not exists idx_tiss_official_documents_period
  on public.tiss_official_documents (organization_id, competence_month desc, payer_id);
create index if not exists idx_tiss_official_documents_generated_at
  on public.tiss_official_documents (organization_id, generated_at desc);
create index if not exists idx_tiss_official_documents_hash
  on public.tiss_official_documents (organization_id, xml_hash);
create index if not exists idx_tiss_official_documents_pre_guides
  on public.tiss_official_documents using gin (generated_from_pre_guide_ids);
create unique index if not exists idx_tiss_official_documents_idempotency
  on public.tiss_official_documents (organization_id, idempotency_key);
create unique index if not exists idx_tiss_official_documents_batch
  on public.tiss_official_documents (organization_id, batch_number)
  where status = 'validated';

alter table public.tiss_official_documents enable row level security;

drop policy if exists tiss_official_documents_admin_read on public.tiss_official_documents;
create policy tiss_official_documents_admin_read on public.tiss_official_documents
for select to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      -- Legacy clinics created the clinic row with id = owner user id before clinic_id was consistently populated.
      and (u.clinic_id = tiss_official_documents.clinic_id or u.id = tiss_official_documents.clinic_id)
  )
);

revoke all on table public.tiss_official_documents from anon;
revoke insert, update, delete on table public.tiss_official_documents from authenticated;
grant select on table public.tiss_official_documents to authenticated;

create or replace function public.prevent_tiss_official_document_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'validated' and (
    new.organization_id is distinct from old.organization_id or
    new.clinic_id is distinct from old.clinic_id or
    new.payer_id is distinct from old.payer_id or
    new.competence_month is distinct from old.competence_month or
    new.guide_type is distinct from old.guide_type or
    new.document_type is distinct from old.document_type or
    new.communication_version is distinct from old.communication_version or
    new.content_structure_version is distinct from old.content_structure_version or
    new.tuss_version is distinct from old.tuss_version or
    new.schema_root_file is distinct from old.schema_root_file or
    new.schema_manifest_checksum is distinct from old.schema_manifest_checksum or
    new.batch_number is distinct from old.batch_number or
    new.xml_content is distinct from old.xml_content or
    new.xml_hash is distinct from old.xml_hash or
    new.generated_from_pre_guide_ids is distinct from old.generated_from_pre_guide_ids or
    new.idempotency_key is distinct from old.idempotency_key or
    new.validation_summary is distinct from old.validation_summary or
    new.metadata is distinct from old.metadata or
    new.guide_count is distinct from old.guide_count or
    new.total_amount_cents is distinct from old.total_amount_cents or
    new.generated_by is distinct from old.generated_by or
    new.generated_at is distinct from old.generated_at
  ) then
    raise exception 'Validated TISS official documents are immutable';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tiss_official_documents_immutable on public.tiss_official_documents;
create trigger trg_tiss_official_documents_immutable
before update on public.tiss_official_documents
for each row execute function public.prevent_tiss_official_document_mutation();

alter table public.tiss_revenue_cycle_events
  add column if not exists official_document_id uuid references public.tiss_official_documents(id) on delete set null;

alter table public.tiss_revenue_cycle_events
  drop constraint if exists tiss_revenue_cycle_events_type_check;
alter table public.tiss_revenue_cycle_events
  add constraint tiss_revenue_cycle_events_type_check check (
    event_type in (
      'PRE_GUIDE_MATERIALIZED',
      'PRE_GUIDE_VALIDATED',
      'PRE_GUIDE_READY_FOR_BILLING',
      'PRE_GUIDE_PENDING',
      'AUTHORIZATION_ATTACHED',
      'XML_DRAFT_GENERATED',
      'XML_DRAFT_VALIDATED',
      'XML_DRAFT_SUPERSEDED',
      'TISS_BILLING_BATCH_DRAFT_CREATED',
      'TISS_BILLING_BATCH_DRAFT_CANCELLED',
      'TISS_OFFICIAL_XML_GENERATED',
      'TISS_OFFICIAL_XML_XSD_VALIDATED',
      'MANUAL_OVERRIDE_APPLIED'
    )
  );

alter table public.tiss_revenue_cycle_events
  drop constraint if exists tiss_revenue_cycle_events_state_check;
alter table public.tiss_revenue_cycle_events
  add constraint tiss_revenue_cycle_events_state_check check (
    new_state in (
      'draft',
      'missing_data',
      'awaiting_authorization',
      'authorized',
      'in_execution',
      'ready_for_billing',
      'xml_draft_generated',
      'billing_batch_draft',
      'official_xml_validated',
      'sent',
      'processed',
      'paid',
      'denied',
      'partially_denied',
      'appealed'
    )
  );

create or replace function public.create_tiss_official_document(
  p_payer_id uuid,
  p_competence_month date,
  p_guide_type text,
  p_document_type text,
  p_communication_version text,
  p_content_structure_version text,
  p_tuss_version text,
  p_schema_root_file text,
  p_schema_manifest_checksum text,
  p_batch_number text,
  p_xml_content text,
  p_xml_hash text,
  p_generated_from_pre_guide_ids uuid[],
  p_idempotency_key text,
  p_validation_summary jsonb,
  p_metadata jsonb,
  p_guide_count integer,
  p_total_amount_cents integer,
  p_pre_guide_versions jsonb,
  p_generated_by uuid default null
)
returns public.tiss_official_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := coalesce(auth.uid(), p_generated_by);
  v_clinic_id uuid;
  v_role text;
  v_existing public.tiss_official_documents%rowtype;
  v_document public.tiss_official_documents%rowtype;
  v_pre_guide_count integer;
  v_distinct_payer_count integer;
  v_invalid_count integer;
  v_duplicate_count integer;
begin
  if v_user_id is null then
    raise exception 'TISS_OFFICIAL_USER_REQUIRED';
  end if;

  select coalesce(u.clinic_id, u.id), u.role
    into v_clinic_id, v_role
  from public.users u
  where u.id = v_user_id
  limit 1;

  if v_clinic_id is null or v_role not in ('owner', 'admin', 'coordinator') then
    raise exception 'TISS_OFFICIAL_FORBIDDEN';
  end if;

  if cardinality(p_generated_from_pre_guide_ids) < 1 or cardinality(p_generated_from_pre_guide_ids) > 100 then
    raise exception 'TISS_OFFICIAL_PRE_GUIDE_COUNT_INVALID';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 32 then
    raise exception 'TISS_OFFICIAL_IDEMPOTENCY_KEY_INVALID';
  end if;

  if jsonb_typeof(p_pre_guide_versions) <> 'object' then
    raise exception 'TISS_OFFICIAL_PRE_GUIDE_VERSIONS_INVALID';
  end if;

  if octet_length(convert_to(coalesce(p_xml_content, ''), 'UTF8')) > 6291456 then
    raise exception 'TISS_OFFICIAL_XML_TOO_LARGE';
  end if;

  if p_xml_hash <> encode(extensions.digest(p_xml_content::text, 'sha256'::text), 'hex') then
    raise exception 'TISS_OFFICIAL_XML_HASH_MISMATCH';
  end if;

  if not exists (
    select 1 from public.clinic_payers cp
    where cp.id = p_payer_id
      and cp.organization_id = v_clinic_id
  ) then
    raise exception 'TISS_OFFICIAL_PAYER_NOT_FOUND';
  end if;

  select
    d.id,
    d.organization_id,
    d.clinic_id,
    d.payer_id,
    d.competence_month,
    d.guide_type,
    d.document_type,
    d.communication_version,
    d.content_structure_version,
    d.tuss_version,
    d.schema_root_file,
    d.schema_manifest_checksum,
    d.batch_number,
    d.status,
    d.xml_content,
    d.xml_hash,
    d.generated_from_pre_guide_ids,
    d.idempotency_key,
    d.validation_summary,
    d.metadata,
    d.guide_count,
    d.total_amount_cents,
    d.generated_by,
    d.generated_at,
    d.created_at,
    d.updated_at
    into v_existing
  from public.tiss_official_documents d
  where d.organization_id = v_clinic_id
    and d.idempotency_key = p_idempotency_key
  limit 1;

  if v_existing.id is not null then
    return v_existing;
  end if;

  with selected as (
    select pg.id, pg.payer_id, pg.status, pg.validation_error_codes, pg.snapshot_data, pg.scheduled_start, pg.updated_at
    from public.appointment_tiss_pre_guides pg
    where pg.id = any(p_generated_from_pre_guide_ids)
      and pg.organization_id = v_clinic_id
    for update
  )
  select
    count(*)::integer,
    count(distinct payer_id)::integer,
    count(*) filter (
      where status <> 'valid'
        or coalesce(array_length(validation_error_codes, 1), 0) > 0
        or snapshot_data is null
        or payer_id <> p_payer_id
        or date_trunc('month', scheduled_start)::date <> date_trunc('month', p_competence_month)::date
        or not (p_pre_guide_versions ? selected.id::text)
        or selected.updated_at is distinct from (p_pre_guide_versions ->> selected.id::text)::timestamptz
    )::integer
    into v_pre_guide_count, v_distinct_payer_count, v_invalid_count
  from selected;

  if v_pre_guide_count <> cardinality(p_generated_from_pre_guide_ids) then
    raise exception 'TISS_OFFICIAL_PRE_GUIDE_SCOPE_MISMATCH';
  end if;

  if v_distinct_payer_count <> 1 or v_invalid_count > 0 then
    raise exception 'TISS_OFFICIAL_PRE_GUIDE_NOT_ELIGIBLE';
  end if;

  -- Recheck after row locks so concurrent calls with the same key return
  -- the document created by the winning transaction instead of duplicating it.
  select
    d.id,
    d.organization_id,
    d.clinic_id,
    d.payer_id,
    d.competence_month,
    d.guide_type,
    d.document_type,
    d.communication_version,
    d.content_structure_version,
    d.tuss_version,
    d.schema_root_file,
    d.schema_manifest_checksum,
    d.batch_number,
    d.status,
    d.xml_content,
    d.xml_hash,
    d.generated_from_pre_guide_ids,
    d.idempotency_key,
    d.validation_summary,
    d.metadata,
    d.guide_count,
    d.total_amount_cents,
    d.generated_by,
    d.generated_at,
    d.created_at,
    d.updated_at
    into v_existing
  from public.tiss_official_documents d
  where d.organization_id = v_clinic_id
    and d.idempotency_key = p_idempotency_key
  limit 1;

  if v_existing.id is not null then
    return v_existing;
  end if;

  select count(*)::integer
    into v_duplicate_count
  from public.tiss_official_documents d
  where d.organization_id = v_clinic_id
    and d.status = 'validated'
    and d.generated_from_pre_guide_ids && p_generated_from_pre_guide_ids;

  if v_duplicate_count > 0 then
    raise exception 'TISS_OFFICIAL_PRE_GUIDE_ALREADY_LINKED';
  end if;

  insert into public.tiss_official_documents (
    organization_id,
    clinic_id,
    payer_id,
    competence_month,
    guide_type,
    document_type,
    communication_version,
    content_structure_version,
    tuss_version,
    schema_root_file,
    schema_manifest_checksum,
    batch_number,
    status,
    xml_content,
    xml_hash,
    generated_from_pre_guide_ids,
    idempotency_key,
    validation_summary,
    metadata,
    guide_count,
    total_amount_cents,
    generated_by,
    generated_at
  ) values (
    v_clinic_id,
    v_clinic_id,
    p_payer_id,
    date_trunc('month', p_competence_month)::date,
    'sp_sadt',
    'official_tiss_sp_sadt_xml',
    p_communication_version,
    p_content_structure_version,
    p_tuss_version,
    p_schema_root_file,
    p_schema_manifest_checksum,
    p_batch_number,
    'validated',
    p_xml_content,
    p_xml_hash,
    p_generated_from_pre_guide_ids,
    p_idempotency_key,
    coalesce(p_validation_summary, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb),
    p_guide_count,
    p_total_amount_cents,
    v_user_id,
    now()
  )
  returning * into v_document;

  insert into public.tiss_revenue_cycle_events (
    organization_id,
    clinic_id,
    patient_id,
    appointment_id,
    pre_guide_id,
    official_document_id,
    payer_id,
    event_type,
    previous_state,
    new_state,
    reason,
    performed_by,
    performed_at,
    metadata
  )
  select
    v_clinic_id,
    v_clinic_id,
    pg.patient_id,
    pg.appointment_id,
    pg.id,
    v_document.id,
    p_payer_id,
    'TISS_OFFICIAL_XML_GENERATED',
    pg.revenue_cycle_state,
    'official_xml_validated',
    'XML TISS oficial gerado e validado contra o XSD. Nenhum dado foi enviado à operadora.',
    v_user_id,
    now(),
    jsonb_build_object(
      'officialDocumentId', v_document.id,
      'batchNumber', p_batch_number,
      'communicationVersion', p_communication_version,
      'contentStructureVersion', p_content_structure_version,
      'xmlHash', p_xml_hash,
      'guideCount', p_guide_count,
      'totalAmountCents', p_total_amount_cents,
      'notSentToPayer', true
    )
  from public.appointment_tiss_pre_guides pg
  where pg.organization_id = v_clinic_id
    and pg.id = any(p_generated_from_pre_guide_ids);

  update public.appointment_tiss_pre_guides pg
  set
    revenue_cycle_state = 'official_xml_validated',
    revenue_cycle_state_reason = 'XML TISS oficial validado contra XSD e armazenado. Nenhum dado foi enviado à operadora.',
    updated_at = now()
  where pg.organization_id = v_clinic_id
    and pg.id = any(p_generated_from_pre_guide_ids);

  insert into public.tiss_revenue_cycle_events (
    organization_id,
    clinic_id,
    official_document_id,
    payer_id,
    event_type,
    previous_state,
    new_state,
    reason,
    performed_by,
    performed_at,
    metadata
  ) values (
    v_clinic_id,
    v_clinic_id,
    v_document.id,
    p_payer_id,
    'TISS_OFFICIAL_XML_XSD_VALIDATED',
    'official_xml_validated',
    'official_xml_validated',
    'Validação XSD oficial concluída antes da persistência do documento.',
    v_user_id,
    now(),
    jsonb_build_object(
      'officialDocumentId', v_document.id,
      'schemaRootFile', p_schema_root_file,
      'schemaManifestChecksum', p_schema_manifest_checksum,
      'xmlHash', p_xml_hash,
      'guideCount', p_guide_count,
      'totalAmountCents', p_total_amount_cents,
      'notSentToPayer', true
    )
  );

  return v_document;
end;
$$;

revoke all on function public.create_tiss_official_document(
  uuid, date, text, text, text, text, text, text, text, text, text, text, uuid[], text, jsonb, jsonb, integer, integer, jsonb, uuid
) from public;
grant execute on function public.create_tiss_official_document(
  uuid, date, text, text, text, text, text, text, text, text, text, text, uuid[], text, jsonb, jsonb, integer, integer, jsonb, uuid
) to authenticated;
