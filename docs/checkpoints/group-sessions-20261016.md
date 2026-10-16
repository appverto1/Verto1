# Group sessions — continuation checkpoint

## Source of truth

- Continue PR #413, branch `feat/staging-group-sessions-specialty-pricing-20261015`.
- Previous head: `0c064d618c3604395d8c3b98f4b0612184855d30`.
- Staging baseline: `0b9f502219beeb23a13d41c4e3d5d7c53ee85543` (PR #417).
- PRs #414–417 and their backend extractions are preserved. The only overlapping
  file requiring combination is `scripts/pre-main-gate.mjs`; retain all tests.
- Production is outside the authorized scope. Do not merge this PR while incomplete.

## Financial persistence block

- The existing Save flow now maps `groupAmountCents` to `group_amount_cents`.
- Canonical patient-plan reads include the column; generic payer authorization
  equality also accounts for it. Existing individual amounts are unchanged.
- Legacy requests that omit collective prices leave the SQL field absent, so
  reconciliation preserves a previously stored group rate.
- The unapplied reconciliation migration now treats GROUP participant references
  as historical references, including monthly reservations without payment items.
  Editing versions the plan; removal ends it rather than deleting its history.
- The UI flag remains false until remote persistence and the complete feature pass.
- Reused all 41 PR foundation files. No remote migrations have been applied.

## Validation

- `npm run typecheck`: passed on the local candidate.
- `npm run build`: passed on the local candidate.
- `node scripts/group-sessions-regressions.mjs`: dedicated suite, run in CI as a
  mandatory step independently of the existing baseline regression ratchet.
- `groupFinancialPlanPersistence.test.ts` executes the actual backend mapper:
  Save, canonical reload, resave, independent rates, zero and legacy omission.
- `groupSessionPostgres.test.mjs` runs all five PR migrations in PostgreSQL 17
  (PGlite), plus actual RPCs for history, stale writes, retries, no fallback,
  clinic isolation and anon/authenticated privilege denial.
- SQL fixtures contain definitions only, no real records or credentials. The
  schema fixture retains columns, defaults, primary/unique/check constraints;
  it omits pre-existing FKs, indexes, RLS policies and triggers. Feature migrations
  create their own actual constraints/triggers. This is not full financial,
  concurrency, authenticated HTTP or deployed smoke coverage.
- Local runtime: Node 24; required GitHub CI runtime: Node 20.

## Remaining required implementation

1. Atomic create/join RPC: backend UUID, idempotency, capacity, all patients/team,
   canonical prices, all appointments, financial context/snapshots in one transaction.
2. Individual and GROUP writers must share the same clinic slot lock; validate
   collisions inside the transaction, including secondary professionals and patients.
3. Respect professional availability, calendar rules, clinic timezone and resources.
4. GROUP pricing must connect to both existing AT_SESSION and MONTHLY_SESSION
   engines. Current individual resolver and monthly unit price still use individual
   values. Never expose booking with this unresolved.
5. Atomic lifecycle operations: cancellation, rescheduling, recurrence, no-show,
   settled-payment preservation and individual participant actions.
6. Calendar UI: modality, multiple patients/professionals, rates, create/join,
   detail/edit/cancel and refresh after successful durable persistence.
7. Review and apply the five migrations plus operational migrations to Staging
   only after dependency/security validation; none is assumed applied.
8. Actual concurrent-connection tests, HTTP permission/tenant tests, regressions,
   exact-head CI, controlled merge, Railway deploy, authenticated smoke, F5 and
   logout/login. Create fictitious test data rather than using real patients.

## Verified environment

- Supabase Staging: `irspungjhapqdbgqroyc`; PostgreSQL 17.6.
- Railway project: `e9712be6-e075-47bb-a006-b5991fd38c88`.
- Environment: `bb3dd988-b80d-423e-9b95-e49fbb1243e4` (`staging`).
- Service: `55de13c3-3e54-4668-b32a-5d8ba96bc2b0` (`Staging`), source `staging`.
- API health on `https://api.appverto.com.br/api/health`: HTTP 200 before changes.
- Railway OAuth lists variable names with values redacted. Do not recreate sealed
  variables or assume credentials are readable. GitHub connector supports large
  UTF-8 blobs; the large server.ts is not a blocker.

No operational completion percentage is claimed: the end-to-end acceptance
criteria are not yet satisfied and no GROUP feature deploy has occurred.
