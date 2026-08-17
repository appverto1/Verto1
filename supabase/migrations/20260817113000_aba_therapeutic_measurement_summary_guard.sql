-- Prevent therapeutic-program measurements (duration, latency, frequency, etc.)
-- stored in aba_trials.raw_payload from being interpreted by the legacy
-- DTT/NET trial summary trigger as incorrect/prompted teaching trials.
--
-- The raw measurement remains immutable clinical evidence in aba_trials and is
-- consumed by the mastery engine. Only the legacy summary trigger is skipped.

drop trigger if exists trg_aba_summary_after_trial_insert on public.aba_trials;

create trigger trg_aba_summary_after_trial_insert
after insert on public.aba_trials
for each row
when (
  lower(coalesce(new.raw_payload ->> 'source', '')) <> 'therapeutic_program_measurement'
  and lower(coalesce(new.raw_payload ->> 'therapeuticMeasurement', 'false')) <> 'true'
  and lower(coalesce(new.raw_payload ->> 'therapeutic_measurement', 'false')) <> 'true'
)
execute function public.aba_summary_after_trial_insert();
