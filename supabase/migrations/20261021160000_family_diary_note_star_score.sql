-- Preserve historical family notes and their original authored text.
-- NULL means the legacy score did not exist; new awards persist 0/1 online.
-- No data rewrite, no new index, no polling and no table replacement.
begin;
alter table public.notes add column if not exists score integer null;
comment on column public.notes.score is 'Optional clinical score; family diary awards are restricted to 0 or 1 by the authenticated backend.';
commit;
