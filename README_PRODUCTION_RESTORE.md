# Production restore package

This package is a COMPLETE repository snapshot, not a changes-only bundle.
It is based on the latest full repository used for the ABA V3 clinical-date/timezone hotfix and includes the consolidated V3 production baseline through Blocks 1–7: Default-On pure-inherit binding, canonical analytical metric expansion, bounded multi-target analytics, Plan/PTS canonical writer convergence, patient-scoped cache consistency and the service-role production health snapshot. 06810 remains the canonical Default-On override lifecycle migration, 06811 remains historical production operation only, and the pilot runbook is superseded operationally by docs/operations/ABA_V3_PRODUCTION_RUNBOOK.md.

Use this package to restore the repository tree after the prior merge-only bundle caused missing local modules at runtime.

Important:
- Do not rerun already-applied Supabase migrations merely because they are present in the repository.
- Keep the existing Railway environment variables.
- This package contains `services/clinicalMeasurementV3Routes.ts` and `src/constants/featureMetadata.ts` plus the full local dependency closure required by `server.ts`.
