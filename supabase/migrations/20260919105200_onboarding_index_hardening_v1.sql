-- Verto #211 follow-up: FK coverage and non-overlapping idempotency index order.

begin;

drop index if exists public.onboarding_responses_publication_idempotency_uidx;
create unique index if not exists onboarding_responses_idempotency_publication_uidx
  on public.onboarding_responses(idempotency_key, publication_id);

create index if not exists onboarding_templates_created_by_idx on public.onboarding_templates(created_by);
create index if not exists onboarding_templates_updated_by_idx on public.onboarding_templates(updated_by);
create index if not exists onboarding_publications_published_by_idx on public.onboarding_publications(published_by);
create index if not exists onboarding_slots_created_by_idx on public.onboarding_slots(created_by);
create index if not exists onboarding_responses_previous_response_idx on public.onboarding_responses(previous_response_id) where previous_response_id is not null;
create index if not exists onboarding_responses_responded_by_idx on public.onboarding_responses(responded_by);
create index if not exists onboarding_responses_admin_ack_by_idx on public.onboarding_responses(admin_ack_by) where admin_ack_by is not null;

commit;
