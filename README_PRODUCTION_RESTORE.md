# Production restore package

This package is a COMPLETE repository snapshot, not a changes-only bundle.
It is based on the latest full repository used for the ABA V3 clinical-date/timezone hotfix and includes the latest V3 SQL/docs/test artifacts through 06807.

Use this package to restore the repository tree after the prior merge-only bundle caused missing local modules at runtime.

Important:
- Do not rerun already-applied Supabase migrations merely because they are present in the repository.
- Keep the existing Railway environment variables.
- This package contains `services/clinicalMeasurementV3Routes.ts` and `src/constants/featureMetadata.ts` plus the full local dependency closure required by `server.ts`.
