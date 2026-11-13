# Commercial / Super Admin — Invariants Inventory

Status: implementation evidence for Issue #231 contract v4.

This inventory documents current product surfaces that must not regress when CI or unrelated product work changes. It is evidence-oriented: every invariant points to current code/routes and states how to verify it. It does not create new product behavior, authorization, billing authority, or operational policy.

## Verification classes

- **STATIC** — inspect the referenced implementation and route wiring.
- **EXISTING_TEST** — run the named existing automated test(s).
- **STAGING_SMOKE** — validate the real staging surface with synthetic/non-sensitive data after the candidate is deployed.
- A listed check is not a claim that CI currently proves the runtime behavior; runtime-only claims remain subject to the relevant Quality/Verify gates.

## Invariants

### COM-001 — Super Admin entry and owner authorization

Surface: Super Admin dashboard entry and owner-only API family.

Current behavior: the privileged dashboard is `src/components/SuperAdminDashboard.tsx`; owner/commercial operations are served through `/api/owner/*` and selected `/api/admin/*` routes. Privileged UI visibility must never be treated as authorization; the server-side authorization path remains authoritative.

Sources: `src/components/SuperAdminDashboard.tsx`, `server.ts`, `tests/authorizationRuntime.test.ts`, `tests/ownerMfaEnforcement.test.ts`.

Como verificar: STATIC — confirm privileged routes retain their server authorization middleware/guards and that ordinary clinic-role capability overrides cannot manufacture platform Super Admin authority; EXISTING_TEST — run the authorization and owner-MFA tests; STAGING_SMOKE — verify an authorized owner can enter while a non-owner synthetic account cannot access privileged owner routes.

### COM-002 — Super Admin navigation remains intact

Surface: sidebar tabs in `SuperAdminDashboard`.

Current behavior: the dashboard exposes Resumo, DRE e EBITDA, Clientes e Lucro, Comercial, Configurações financeiras, Ambientes Demo, Protocolos, and Rollout ABA V3 through the local `activeTab` state.

Sources: `src/components/SuperAdminDashboard.tsx`.

Como verificar: STATIC — confirm the eight current tabs and their `activeTab` targets remain wired; STAGING_SMOKE — keyboard-navigate all tabs and confirm each renders its existing surface without cross-tenant clinic data leakage.

### COM-003 — Financial summary and DRE/EBITDA

Surface: Resumo and DRE e EBITDA tabs.

Current behavior: dashboard data loads through `/api/owner/stats` and `/api/owner/financial-overview`; overview displays Receita Líquida, Margem de Contribuição, EBITDA, Inadimplência and Clientes Pagantes, with the financial tab consuming the same owner financial projection.

Sources: `src/components/SuperAdminDashboard.tsx`, `server.ts`, `sql/supabase_super_admin_financial.sql`.

Como verificar: STATIC — confirm the owner endpoints and financial field mapping remain present and no client-side calculation becomes a new financial authority; STAGING_SMOKE — with synthetic staging data, open Resumo and DRE e EBITDA and confirm both load without exposing another tenant's clinical records.

### COM-004 — Clients, trials and financial search

Surface: Clientes e Lucro.

Current behavior: customer inventory is loaded from `/api/owner/clients`; visible subscription states include active, trialing, complimentary, cancelled and delinquent-style fallback states, and the dashboard keeps local search/filter presentation separate from server authority.

Sources: `src/components/SuperAdminDashboard.tsx`, `server.ts`.

Como verificar: STATIC — confirm `/api/owner/clients` remains the data source and status rendering does not mutate subscription state; STAGING_SMOKE — search synthetic clients and verify active/trial/complimentary/cancelled representations without using production identities or data.

### COM-005 — Complimentary access remains explicit and privileged

Surface: Acesso cortesia inside Clientes e Lucro.

Current behavior: the dashboard requires explicit confirmation and calls `POST /api/admin/grant-complimentary-plan`; the surface describes a zero-price complimentary plan and does not create a second client-side billing authority.

Sources: `src/components/SuperAdminDashboard.tsx`, `server.ts`.

Como verificar: STATIC — confirm the mutation still targets `/api/admin/grant-complimentary-plan`, is server-authorized, and no ordinary clinic user can invoke it; STAGING_SMOKE — only with a synthetic staging account, confirm the authorized flow and verify an unauthorized role is rejected server-side.

### COM-006 — Customer access recovery does not create new billing

Surface: customer first-access recovery.

Current behavior: resend uses `POST /api/owner/sales/offers/:offerId/resend-activation`; link generation uses `POST /api/owner/users/:userId/access-link`; access-email correction uses `PATCH /api/owner/users/:userId/access-email`. The UI explicitly treats recovery as access repair, not a new charge.

Sources: `src/components/SuperAdminDashboard.tsx`, `server.ts`, `tests/ownerAccessEmailChange.test.mjs`, `tests/salesAssistedSignup.test.ts`.

Como verificar: STATIC — confirm recovery routes preserve owner authorization, offer/user binding and no new subscription/charge side effect; EXISTING_TEST — run access-email and assisted-signup regressions; STAGING_SMOKE — use only synthetic staging identities and never copy activation links into evidence.

### COM-007 — Commercial lead funnel remains owner-scoped

Surface: Comercial / leads.

Current behavior: the dashboard loads `/api/owner/sales/leads?page=1&pageSize=100` and updates a lead through `/api/owner/sales/leads/:leadId`; profitability simulation is opened from the selected lead rather than from an unrestricted tenant identifier.

Sources: `src/components/SuperAdminDashboard.tsx`, `server.ts`, `tests/salesAssistedSignup.test.ts`.

Como verificar: STATIC — confirm list/update routes retain owner authorization and server-side record binding; EXISTING_TEST — run assisted-sales coverage; STAGING_SMOKE — move a synthetic lead through currently supported states and verify a non-owner cannot access the owner lead API.

### COM-008 — Profitability simulation remains advisory until authoritative offer creation

Surface: `SalesProfitabilitySimulator`.

Current behavior: profitability simulation uses server-backed inputs and creates/reuses an offer through `POST /api/owner/sales/offers` with an idempotency key. Simulation alone must not grant access, mutate entitlement or create a second billing authority.

Sources: `src/components/SalesProfitabilitySimulator.tsx`, `server.ts`, `tests/salesProfitability.test.ts`, `tests/salesProfitabilityFlow.test.ts`.

Como verificar: STATIC — confirm offer creation remains server-owned and idempotent; EXISTING_TEST — run profitability and profitability-flow tests; STAGING_SMOKE — simulate with synthetic data and confirm no entitlement changes before the authoritative offer/checkout path completes.

### COM-009 — Modular proposal, offer acceptance and checkout remain one commercial chain

Surface: modular proposal builder and checkout.

Current behavior: `src/components/SalesModularProposalBuilder.tsx` creates offers through `/api/owner/sales/offers` and reads modular checkout through `/api/owner/sales/offers/:offerId/modular-checkout`; server tests also cover accept/checkout/expire/email route boundaries. Offer, checkout, subscription and entitlement must not split into competing authorities.

Sources: `src/components/SalesModularProposalBuilder.tsx`, `server.ts`, `tests/salesModularProposal.test.ts`, `tests/salesModularProposalFlow.test.ts`, `tests/salesModularStripeAssisted.test.ts`, `tests/goLiveHardening.test.mjs`.

Como verificar: STATIC — confirm offer/checkout routes remain server-owned, tied to the selected offer, and preserve idempotency/fail-closed behavior; EXISTING_TEST — run modular proposal, flow, Stripe-assisted and go-live hardening tests; STAGING_SMOKE — use Stripe staging/test-mode only and confirm incomplete/failed checkout does not grant access.

### COM-010 — Financial assumptions are versioned server-owned inputs

Surface: Configurações financeiras / `SalesFinancialAssumptionsPanel`.

Current behavior: active assumptions load from `GET /api/owner/sales/profitability-assumptions`; a new version is persisted by `POST` to the same route. The panel distinguishes actual/calculated/estimated/manual/unavailable sources.

Sources: `src/components/SalesFinancialAssumptionsPanel.tsx`, `server.ts`, `tests/salesFinancialAssumptionsInput.test.ts`.

Como verificar: STATIC — confirm reads/writes remain owner-authorized and new versions do not overwrite history silently; EXISTING_TEST — run the financial-assumptions input test; STAGING_SMOKE — with synthetic values, create a staging version and confirm source labels/history without using production financial values.

### COM-011 — Price catalog publication remains explicit and idempotent

Surface: `SalesPricingCatalogPanel` inside financial settings.

Current behavior: catalogs load from `/api/owner/sales/pricing-catalogs`; cloning uses `/clone`; draft mutation uses `PATCH /api/owner/sales/pricing-catalogs/:id`; publication uses `POST /api/owner/sales/pricing-catalogs/:id/publish`. Mutations carry `X-Idempotency-Key`.

Sources: `src/components/SalesPricingCatalogPanel.tsx`, `server.ts`, `tests/salesModularEconomics.test.ts`, `tests/salesCapacityPolicyVersioning.test.ts`.

Como verificar: STATIC — confirm catalog mutations preserve owner authorization, draft/version boundaries and idempotency keys; EXISTING_TEST — run modular-economics and capacity-versioning coverage; STAGING_SMOKE — publish only synthetic/non-production catalog data when the contract for that change explicitly authorizes it.

### COM-012 — Demo environments remain isolated from production and ordinary tenants

Surface: Ambientes Demo.

Current behavior: the dashboard loads `/api/admin/demo/sandboxes`; operational setup uses `/api/admin/demo/bootstrap-operational`; playground reset uses `/api/admin/demo/playground/reset`; shared demo password rotation uses `/api/admin/demo/shared-user/rotate-password`.

Sources: `src/components/SuperAdminDashboard.tsx`, `server.ts`, `tests/demoSandbox.test.ts`.

Como verificar: STATIC — confirm all demo mutations remain privileged and target demo-scoped records only; EXISTING_TEST — run demo sandbox coverage; STAGING_SMOKE — operate only staging demo fixtures, confirm reset never touches a normal clinic, and never persist/share a demo password in evidence.

### COM-013 — Protocol governance remains an explicit Super Admin surface

Surface: Protocolos.

Current behavior: the dashboard maintains protocol request review plus the canonical editor catalog (including AFLS and VB-MAPP levels) in the privileged Protocolos tab. Approval/rejection/access operations must remain explicitly privileged; catalog UI must not become a tenant-global write bypass.

Sources: `src/components/SuperAdminDashboard.tsx`, canonical protocol constants under `src/constants/`, `server.ts`.

Como verificar: STATIC — inspect protocol request routes and confirm privileged authorization plus explicit target binding; STAGING_SMOKE — use a synthetic protocol request and verify an ordinary clinic role cannot approve, reject, scan or change protocol access.

### COM-014 — ABA V3 rollout control remains privileged and reversible

Surface: Rollout ABA V3 / `AbaV3RolloutControlCenter`.

Current behavior: rollout controls are rendered only through the Super Admin dashboard surface and are operational controls, not ordinary clinic settings. Rollout state must remain server-authorized, auditable and isolated from unrelated tenant configuration.

Sources: `src/components/AbaV3RolloutControlCenter.tsx`, `src/components/SuperAdminDashboard.tsx`, `server.ts`.

Como verificar: STATIC — confirm rollout mutations retain privileged server authorization and explicit clinic/scope binding; STAGING_SMOKE — change only a synthetic staging rollout target when separately authorized, verify reversibility, and confirm unrelated clinics are unchanged.

## CI relationship

The strict workflow in `.github/workflows/ci.yml` is intentionally additive. It does not replace `.github/workflows/staging-ci.yml`, does not change `CI_REAL_ATIVO: SIM`, and does not claim that every invariant above is automatically covered. Existing tests are executed through the repository's current `npm test` / `check:pre-main` commands; runtime-only Commercial/Super Admin checks remain explicit Quality or staging-smoke evidence.

## Evidence hygiene

Do not put patient/clinic PII, clinical content, credentials, activation links, session tokens, Stripe secrets, production values, or copied production records in CI logs, this inventory, PR comments or screenshots. Synthetic staging evidence only.
