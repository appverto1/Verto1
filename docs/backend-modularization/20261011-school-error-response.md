# Backend modularization — school error response

- Date: 2026-10-11.
- Baseline: `staging` at `e78a05511dfd03b82d32d92d44f4231004d71a64`; source `services/schoolManagementRoutes.ts`.
- Slice: move the original school-management error-to-HTTP mapping into `services/schoolErrorResponse.ts`, preserving all branches, error messages, status codes and logging. The original formatter is reproduced verbatim inside a factory receiving the existing `sanitizeString` dependency.
- `registerSchoolManagementRoutes` retains the same route definitions, authentication middleware, closure lifetime, Supabase access, writes, query shapes, idempotency and tenant scoping. No `server.ts` modification.
- Scope: `services/schoolManagementRoutes.ts`, `services/schoolErrorResponse.ts`, `tests/schoolErrorResponse.test.ts`, this checkpoint. No database migration, deployment or production change.
- Equivalence check: exact in-memory reverse replacement of the original source after extraction. Focused tests exercise 13 error paths including conflicts, consent, forbidden, missing record, validation and fallback. Local Node v22 type-strip smoke passed; isolated `tsc --noEmit` for helper passed. Full Node 20 repo checks and staging CI must run before merge.
- PR: [#389](https://github.com/appverto1/Verto1/pull/389) opened against `staging`; original implementation commit `7c13a8672dde7095d474ab23616bbeb3adaa0c04`. Merge: not performed. Deploy: not performed. CI (Node 20): started, result not yet confirmed at checkpoint update. Verify the current PR head, checks and mergeability before the next run; never duplicate this extraction.
- Next: validate the resulting branch/PR checks and continue with a separate, non-overlapping entrypoint slice. Direct rewriting of the 4.76-MB `server.ts` via GitHub blob upload failed with h2 transport error in this execution; no replacement was written.
