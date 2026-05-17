-- Create unique constraint: One photo per patient per day
-- Safe to run multiple times.

CREATE UNIQUE INDEX IF NOT EXISTS history_one_photo_per_day 
ON public.history (patient_id, date_group) 
WHERE type = 'photo' AND deleted_at IS NULL;

-- Validation query to detect violations:
-- SELECT patient_id, date_group, COUNT(*) FROM history 
-- WHERE type = 'photo' AND deleted_at IS NULL 
-- GROUP BY patient_id, date_group HAVING COUNT(*) > 1;
