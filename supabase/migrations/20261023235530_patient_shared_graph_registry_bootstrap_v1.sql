-- Reconcile objects already provisioned in Staging by the unmerged #429
-- migration. This small, idempotent bootstrap is needed for a clean future
-- deployment; it does not publish, link, or copy patient data.
create schema if not exists verto_internal_graph;
revoke all on schema verto_internal_graph from public,anon,authenticated;

create table if not exists public.patient_shared_graph_publications (
 global_patient_identity_id uuid primary key,
 clinic_id uuid not null references public.clinics(id),
 patient_id uuid not null references public.patients(id),
 graph_type text not null,
 graph_key text not null default '',
 status text not null default 'INACTIVE'
   check (status in ('ACTIVE','INACTIVE')),
 version bigint not null default 0 check (version>=0),
 published_by uuid,
 published_at timestamptz,
 updated_at timestamptz not null default now()
);
create index if not exists patient_shared_graph_publications_owner_idx
 on public.patient_shared_graph_publications(clinic_id,patient_id)
 where status='ACTIVE';
alter table public.patient_shared_graph_publications enable row level security;
revoke all on public.patient_shared_graph_publications from public,anon,authenticated;
grant select,insert,update,delete on public.patient_shared_graph_publications to service_role;

create table if not exists public.patient_shared_graph_delegations (
 patient_id uuid not null references public.patients(id),
 clinic_id uuid not null references public.clinics(id),
 professional_user_id uuid not null,
 granted_by uuid not null,
 granted_at timestamptz not null default now(),
 revoked_at timestamptz,
 revoked_by uuid,
 primary key(patient_id,clinic_id,professional_user_id)
);
create index if not exists patient_shared_graph_delegations_professional_idx
 on public.patient_shared_graph_delegations(professional_user_id,clinic_id,patient_id)
 where revoked_at is null;
alter table public.patient_shared_graph_delegations enable row level security;
revoke all on public.patient_shared_graph_delegations from public,anon,authenticated;
grant select,insert,update,delete on public.patient_shared_graph_delegations to service_role;

create table if not exists public.patient_shared_graph_audit (
 id bigint generated always as identity primary key,
 global_patient_identity_id uuid not null,
 clinic_id uuid not null,
 patient_id uuid not null,
 actor_id uuid,
 action text not null check(action in ('PUBLISH','REPLACE','DISABLE','AUTO_DISABLE','DELEGATE','REVOKE')),
 old_graph_type text,
 old_graph_key text,
 new_graph_type text,
 new_graph_key text,
 created_at timestamptz not null default now()
);
create index if not exists patient_shared_graph_audit_subject_idx
 on public.patient_shared_graph_audit(global_patient_identity_id,created_at desc);
alter table public.patient_shared_graph_audit enable row level security;
revoke all on public.patient_shared_graph_audit from public,anon,authenticated;
grant select,insert on public.patient_shared_graph_audit to service_role;
