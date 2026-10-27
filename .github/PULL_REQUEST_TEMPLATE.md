# Verto Engineering PR Gate

## Task dossier
- Issue/spec:
- Classification: 🟢 / 🟡 / 🔴
- Principal writer:
- `GLOBAL_WRITE_LOCK`: INACTIVE / ACTIVE
- `lock_owner_issue`: none / #<n>
- `lock_owner_writer`: none / 04 / 05 / 06 / 07 / 08 / 09
- `lock_base_sha`: null / <staging SHA>
- `lock_scope`: NONE / PRODUCT_STAGING
- `lock_acquired_at`: null / timestamp
- `lock_release_gate`: none / STAGING_VERIFIED
- Locked base SHA:
- Branch head SHA:

> With `GLOBAL_WRITE_LOCK=ACTIVE`, only the owner Issue may write/merge product against staging. Other product merges are blocked until the owner reaches `STAGING_VERIFIED`. Unexpected staging drift against `lock_base_sha` => `SHA_DRIFT`; do not merge. Exception requires explicit `founder_preempt=true`, formal pause, refreshed lock_base_sha and revalidation.

## Queue / execution state
- `priority`: P000 / P00 / P0 / P1 / P2 / P3
- `priority_rank`: 10 / 50 / 100 / 200 / 300 / 400
- `queue_mode`: NEW / CONTINUATION / REWORK
- `flow_status`: QUEUED / ACTIVE / WAITING_EXTERNAL / SMOKE_READY
- `founder_preempt`: false / true
- `active_handoff`:
- `handoff_status`: PENDING / CLAIMED / DONE / FAILED
- `attempt`:

## Work package / correction block
- `work_package`: `<DOMAIN>-<YYYYMMDD>-<SEQ>` / `NONE`
- `scope_group`:
- `block_mode`: BATCH / SINGLE
- `block_status`: COLLECTING / READY / ACTIVE / REWORK / WAITING_EXTERNAL / SMOKE_READY
- `contract_version`:
- Item results / evidence:

> `COLLECTING` is not executable. If one item fails, the block returns to REWORK and only affected impacts are revalidated; healthy work is preserved unless dependency analysis requires otherwise.

## Scope contract
- Authorized scope:
- Explicitly prohibited scope:
- Why every changed file is necessary:

## Changed files
- [ ] Every changed file is listed and justified.
- [ ] No unrelated refactor/rewrite was introduced.
- [ ] Existing state/cache/persistence contracts remain intact unless explicitly authorized.
- [ ] Commercial/Super Admin remains intact.

## Functional validation
- Targeted tests:
- `npm ci`:
- Typecheck:
- Build:
- `npm run check:pre-main`:
- Relevant regression tests:
- Proven pre-existing unrelated failures:

## Persistence / history
- [ ] No destructive replacement of historical data.
- [ ] Idempotence checked where applicable.
- [ ] Existing clinical/financial history remains addressable.
- [ ] Repeated save/reload/relogin behavior checked where applicable.

## Database / Supabase
- Migration: `none` / describe
- RLS impact: `none` / describe
- Atomicity/transaction impact: `none` / describe
- Advisor results: `n/a` / describe
- [ ] No secret/service-role value was added to source code.
- [ ] Queries select only necessary columns and avoid N+1/full-load regressions.

## Reviewer — 03
Reviewer compares the actual diff against `SPEC_APPROVED`.
- Review result: `REVIEW_PASS` / blocking state
- Scope preservation:
- Security verdict:
- Persistence/history verdict:
- Performance verdict:
- Commercial/Super Admin verdict:

## CI / validação alternativa — 10 (Guardrails §11)
- Modo: `CI_PASS` (GitHub) / `CI_ALTERNATIVE_PASS` (executor independente) / bloqueado
- Workflow/run ou executor externo e endereço da evidência:
- Validated base SHA / head SHA / checkout SHA:
- Comandos, suíte obrigatória, resultado, logs higienizados e SHA-256 dos logs:
- Executor e revisor independentes; revisão do diff:
- Testes não aplicáveis, com justificativa específica:
- `lock_base_sha` vs current staging HEAD quando aplicável:
- Resultado: `CI_PASS` / `CI_ALTERNATIVE_PASS` / blocking state

## PR Engineer — 11
- [ ] PR metadata matches the Issue contract.
- [ ] Changed-file justification is complete.
- [ ] Commit/release summary is complete.
- Result: `PR_READY` / blocking state

## Merge Gatekeeper — 12
Immediately before merge:
- [ ] Expected PR head SHA revalidated.
- [ ] Base drift checked.
- [ ] If `GLOBAL_WRITE_LOCK=ACTIVE`, this PR belongs to `lock_owner_issue`.
- [ ] If `GLOBAL_WRITE_LOCK=ACTIVE`, current staging HEAD still matches the expected lock/base contract or drift was formally refreshed and revalidated.
- [ ] Validação no SHA exato: `CI_PASS` ou `CI_ALTERNATIVE_PASS` com prova aprovada; sem bypass de proteções GitHub.
- [ ] `REVIEW_PASS` is recorded.
- [ ] Issue is in a merge-eligible state.

If required checks are failing/pending, if staging has unexpected `SHA_DRIFT`, or if another Issue owns the active global lock, do not merge even if GitHub technically allows it.

## Rollout — 13
After merge to `staging`:
- [ ] Railway deployment matches merged staging SHA.
- [ ] Build/runtime/HTTP health checked.
- [ ] Supabase staging/advisors checked after applicable database changes.
- [ ] Failures are routed to 14 — Recovery/Incident.
- [ ] If this Issue owns an active global lock, release it only after `STAGING_VERIFIED`.
- Result: `STAGING_VERIFIED` / blocking state

## Lane handoff integrity
- [ ] Every prior handoff is conclusively `DONE` or `FAILED` before another role runs.
- [ ] Claims use the 55-minute TTL and stale claims record `STALE_CLAIM_RECOVERED` before recovery.
- [ ] W roles are only 04–09; Q roles are only 03 and 10–14.
- [ ] Chained W/Q execution re-read the Issue/OS and loaded the new role contract before a new claim.
- [ ] Queue drain between Issues was sequential; no overlapping writers touched conflicting surfaces.

## Smoke handoff
- Highest automatic state: `SMOKE_READY`.
- Exactly one first smoke-test step is prepared for the founder.
- Production is forbidden in the default autonomous flow.

## Commit / release summary
Provide the final summary suitable for commit/release history here.
