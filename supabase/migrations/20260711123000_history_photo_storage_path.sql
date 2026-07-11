-- Caminho duravel para fotos privadas do Diario da Familia.
-- A URL assinada continua legada/compatível, mas nao e mais a fonte de verdade.
alter table if exists public.history
  add column if not exists image_path text;

comment on column public.history.image_path is
  'Caminho duravel no bucket privado patient-photos; URLs assinadas sao resolvidas somente na leitura.';

create index if not exists history_active_photo_image_path_idx
  on public.history (image_path)
  where image_path is not null and is_active = true and deleted_at is null;
