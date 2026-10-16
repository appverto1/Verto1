# Reminder value normalization extraction — 2026-10-15

Baseline staging: `43a4d5ee3540072c2daa701cd381f321a7b38111`.

The helper group containing UUID validation, text/email sanitation, missing-column parsing, logo path/URL validation, generic clinic naming, and active appointment status validation was moved from `services/cronService.ts` to `services/reminderValueNormalization.ts`. The function bodies are literal source copies (only previously private functions gained `export`); imported public functions are re-exported through the previous service to retain compatibility. The original `cronService.ts` source is exactly reconstructable from the change.

No cron schedule, query, API, notification dispatch, persistence, database schema, tenant guard, business logic, deployment, Stripe or Resend change. Existing tests and a dedicated source-parity/value-regression test run in the pre-main regression gate. CI and live staging smoke must be separately verified before merge.

The full 4.6-MB `server.ts` cannot safely be replaced through the available GitHub connector in this execution: attempted large-blob writes failed/timed out. No unverified partial replacement was merged or deployed.
