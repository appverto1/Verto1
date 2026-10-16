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

## Atomic reservation block (candidate, not deployed)

- Added canonical `reserve_group_sessions_v1` and `join_group_session_v1`.
  RPCs accept clinic/actor only from backend context, generate group/series IDs,
  resolve prices in PostgreSQL, and atomically write headers, participant links,
  appointments, billing contexts, financial snapshots/charges and operation keys.
- Shared clinic advisory lock now guards individual appointment writes against
  GROUP reservations. Group participant guards recheck all patient conflicts.
- Added explicit canonical work-schedule checks for periods, breaks, exceptions
  and allowed rooms. Null schedules preserve manual-calendar behavior.
- Both AT_SESSION and MONTHLY_SESSION engines use the reserved GROUP amount;
  individual branches remain present. Monthly amounts survive plan versioning.
- Booking fails closed when required financial persistence is unconfirmed.
- Added five operational migration candidates (05000 through 40000 on 20261016),
  including the discovered Staging dependency: unpaid forecasts require nullable
  `payments.payment_date` and optional `method`. Defaults/stored values remain;
  settled receipts still require those fields through a CHECK constraint.
- Real finance triggers are loaded in isolated PostgreSQL tests. Successful cases:
  per-patient charges, monthly amounts, canonical joining, capacity, work hours,
  transaction rollback, recurrence rollback, missing-trigger rollback, replay,
  tenant scope, forged IDs/prices, and an individual financial regression.
- Added a mandatory multi-connection PostgreSQL 17 CI service/test for actual
  advisory-lock contention, duplicate/distinct requests, GROUP↔individual races,
  final room place, price edit races and denied RPC calls. Local PGlite tests do
  not substitute for this check.
- Still outstanding: resource buffers/location policies audit; lifecycle RPCs;
  HTTP routes/permissions; calendar UI; migrations applied in Staging; deployment
  and authenticated F5/logout/login smoke. Do not merge or expose booking yet.

First checkpoint commit `42c3c1b8709e94f82fa2bff5802bb0e93a7cec77`:
GitHub Actions `38827815749` / job `116739289656` completed successfully.
