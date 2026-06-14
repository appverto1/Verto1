-- Refresh PostgREST metadata after the additive Pre-guia TISS migration.
-- This migration creates no data and performs no backfill.
notify pgrst, 'reload schema';
