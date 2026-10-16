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

## Lifecycle, API and interface block (2026-10-16 continuation)

This section supersedes the earlier remaining-work lists for the local candidate.
Second published checkpoint: `cb55fc0f3f058da560842b0ba2652909cbcf7d46`;
GitHub Actions `38829529255`, job `116744835440`, all steps successful,
including real PostgreSQL 17 concurrent connections. PR #413 remains draft.
Fresh remote check: staging still `0b9f502219beeb23a13d41c4e3d5d7c53ee85543`,
PR head still `cb55fc0`, mergeable, no competing merge observed.

- Added atomic single-occurrence rescheduling, individual/whole-group cancellation,
  and backend-owned future-series cancellation. Existing IDs, frozen prices,
  canceled participant history, clinical records and paid receipts are preserved.
- Added no-show/authorized-reopen ledger synchronization and reserved room capacity
  protection. Buffer, work-period, break, exception, room and location policies
  are validated against canonical membership schedules inside the transaction.
- Added atomic clinic_state calendar projection through the existing CAS function,
  preserving individual events/protocols and section versions. Durable domain
  events are inserted in the same transaction, once per changed appointment.
- Added scoped HTTP list/detail/create/join/reschedule/cancel handlers with explicit
  capabilities, server actor/clinic, payload whitelists and idempotency keys.
- Calendar reads include canonical secondary GROUP professionals while retaining
  clinic/patient capability scope. Financial quote payloads are omitted.
- Added the group scheduling dialog: multiple patients/professionals, canonical
  price preview, capacity, weekly recurrence, list/detail, adding patients,
  rescheduling and cancellation with per-patient manual policy decisions.
  Failed network operations retain their action key and never enter an offline queue.
- Integrated successful batch results/events/section versions into existing agenda
  state. Added room capacity input and enabled collective financial-plan editing
  in the candidate release; deploy only after all 12 migrations are validated/applied.
- Corrected GROUP package dates, monthly competence and snapshots to use canonical
  clinic timezone. Individual branches retain their existing timezone behavior.

Validation on the local candidate: 30/30 dedicated group/financial/scheduling
regressions passed; typecheck and build passed; therapist scope and appointment
financial read regressions passed. Additional old static agenda regression fails
on a pre-existing navigation label assertion; local modularization parity requires
Git objects omitted from this sparse checkout. Neither test was weakened.
Remote full-tree CI remains required for the new candidate.

Still outstanding: exact-candidate full CI/concurrency; migration deployment to
Supabase Staging; controlled integration of complete PR #413; exact-commit Railway
health; authenticated HTTP/UI smoke with fictitious data; F5 and logout/login.
No group migration has been applied remotely at this checkpoint, and no group
release is live. Production remains untouched. Operational completion is not 100%.

## Remote execution checkpoint — do not duplicate (2026-10-16)

- Published lifecycle/API/UI commit: `cc5158320767e66d26c2af758e8027f321046c3e`.
- Complete GitHub CI **SUCCESS**: run `38920244587`, job `117038024410`.
  Includes all 30 dedicated regressions, actual concurrent PostgreSQL connections,
  production build, modularization/readiness regressions and pre-main ratchet.
- Added a further mounted React DOM regression with pinned `jsdom@26.1.0`:
  patient/team selection, separate GROUP amounts, detail duration/ledger amount,
  failure without optimistic success, same-key retry, and manual cancellation
  decisions keyed by patient (the actual RPC contract). Runs in the mandatory
  group suite; requires the next exact-head CI.

### Applied to Supabase STAGING only

History confirmed through `list_migrations`:

| Local SQL source | Remote migration version | Status |
| --- | --- | --- |
| 20261015162000_group_session_specialty_rates.sql | 20261016150342 | applied |
| 20261015171000_group_session_private_rate_authority.sql | 20261016150343 | applied |
| 20261015183500_group_financial_rate_atomic_update.sql | 20261016150345 | applied |
| 20261015211500_group_session_booking_ledger.sql and all later GROUP SQL | — | NOT applied |

The fourth `apply_migration` call repeatedly returned a connector transport error:
`McpServerError: Invalid or expired requestState` (`INVALID_ARGUMENT`, JSON-RPC
-32602, `reason: invalid_request_state`). A fresh `list_migrations` and
`to_regclass('public.group_session_bookings')` confirmed no partial fourth
migration. Read/write `execute_sql` still works. Do not substitute DDL through
`execute_sql`, weaken permissions, or merge/deploy UI against the incomplete schema.
Restore the connector execution path before retrying the unapplied migration.

### Isolated fictitious Staging data

- Clinic/owner `db03af60-8804-49f3-ba45-b47b67712077`, display name
  `HOMOLOGAÇÃO FICTÍCIA SESSÕES EM GRUPO`.
- A second isolated fictitious clinic exists for tenant-denial checks.
- Two fictitious therapist memberships (`Fonoaudiólogo`), two capacity-3 rooms,
  four patients, four ACTIVE PRIVATE plans: individual amounts 150/160/170/180 BRL,
  GROUP amounts 80/70/60/50 BRL; first two AT_SESSION, last two MONTHLY_SESSION.
- Canonical reconcile RPC persisted the four plans in Staging; aggregate SQL
  confirmed all four GROUP values. Authenticated HTTP login returned 200 and
  selected exactly the fictitious owner clinic. This is preparation, NOT group
  end-to-end acceptance. No actual group appointment/charge has been created remotely.
- Clinic `is_demo=true`, `billing_model='demo'`, playground, complimentary owner,
  no Stripe IDs, no real patient/contact data. Credentials/cookies remain outside
  the repository and must never be committed or printed.

### Railway and PR safety

- PR #413 remains open, draft, unmerged. Staging branch remains `0b9f502`.
- Candidate source was staged ONLY in Railway environment
  `bb3dd988-b80d-423e-9b95-e49fbb1243e4`, never accepted/deployed.
- Because migrations are blocked, its pending source was restored to
  `appverto1/Verto1@staging` with no pinned commit. The connector retains four
  cosmetic staged source assignments (staging→staging, same repo, null image/SHA),
  patch `dfafd0fb-3ce4-48ce-afe3-e2efac0b35ef`. Review/replace this pending source
  before the eventual deploy; no variables or other services were changed.
- Live service remains the previous baseline release. No group feature deploy,
  authenticated group HTTP/UI smoke, F5 or new-login acceptance is claimed.
- Production was neither modified nor deployed.

Next: recover Supabase migration execution; skip the three applied names; apply
remaining nine sources in filename order; verify privileges/triggers; stage exact
CI-green candidate in existing Railway Staging only; confirm terminal SUCCESS and
health; authenticated fictitious-clinic smoke for Save/reload, create/join,
individual↔GROUP conflict, tenant/permission denial, idempotency, cancellation,
reschedule/recurrence, financial snapshots and receipt preservation; browser F5
and logout/login; only then mark PR ready and merge into staging. Never production.

Additional live verification of the first three migrations: edited a fictitious
GROUP rate 8000→9500 cents, read it through the canonical resolver, confirmed
individual price remained 15000 cents, confirmed foreign-clinic lookup was denied,
and confirmed anon/authenticated cannot execute the editing RPC. Restored the
fixture GROUP price to 8000 cents. Mounted UI plus complete local suite: 31/31 pass.
