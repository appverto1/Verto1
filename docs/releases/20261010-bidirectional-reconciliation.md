# Bidirectional main/staging reconciliation — Issue #366

The founder authorized promotion and bidirectional reconciliation in the conversation of 10 October 2026. Preserve functioning clinical, authentication, integration, invitation, boleto/payment/access and commercial flows in both environments.

## Preserved baselines and history

- main: `a6236a5e0817dc57037dc450307b15045ba209af`, archived at `archive/main-before-reconcile-20261010`.
- staging: `54b09202c31c96e71736c71ee8aafdb8b2db97b1`, archived at `archive/staging-before-reconcile-20261010`.
- Common ancestor: `d7ca9012b5d66cacc56b0db3e2e047a7d8e68888`.
- Reviewed merge candidate: `da3e575783ccd5580604fa8de99872173eb89e5b`, with both baseline commits as parents.
- PR #367 merged to staging: `7a8c2df1a57b78640804d36de8e54b5fb190e0a1`.

The merge preserves ancestry. Twenty paths had changes on both sides; clean three-way merges and explicit conflict review retained staging features and the production fixes. Twenty-one paths differ from the archived staging tree. Commercial compatibility is versioned: historical capacity offers keep their original calculation/selector; exact offers use active patient quantities and 50-patient capacity bands. No historical proposal becomes exact billing implicitly.

## Executed validation

- GitHub Node20 staging-gate: run `38062200785`, job `114242557316`, success.
- GitHub reconciliation-gate: run `38062200843`, job `114242557394`, success.
- 77 strict clinical/financial/commercial regression files passed.
- Complete inventory: 373/431 test files passed on Node20. The remaining 58 failures were also present on the archived staging source; no newly failing file was introduced. This is a regression comparison, not a claim that the entire historical suite is clean.
- Typecheck clean, frontend production build, complete server dependency parse, and Docker imports (110 files) passed.
- Staging Railway deployment `6f7bb072-d9bc-4231-877f-894c0f949c8f`: SUCCESS at merged SHA.
- Staging HTTP `/api/ready` and `/api/health`: 200 and release `7a8c2df1a57b`; root and `/ajuda`: 200.

## Additive database reconciliation

The versioned migration `20261010153000_bidirectional_runtime_schema_union.sql` captures only runtime dependencies from verified staging metadata: 19 tables, 43 columns and 74 required function signatures. It preserves 674 existing production function definitions, including financial history protections, director compatibility and legacy RPC overloads. Existing-table CHECK/FK additions remain NOT VALID until historical rows have been explicitly assessed; historical V3 bindings retain their legacy status.

A second additive migration preserves staging chart metric ordering and the neutral interpretation of effective trial counts. The production measurement writer keeps its existing event-time semantics.

This adds schemas and routines; no staging records are copied to production. Patient, financial, appointment, session, invitation and protocol history remain in their original project. New client table privileges are limited to the required DML actions; anon/authenticated receive no TRUNCATE authority.

The migration was applied idempotently to staging on 11 October 2026. The committed SQL verification checks required structures, RLS, sensitive RPC grants, trusted deployment namespaces and denial probes. All passed in staging.

## Production rollout and compatibility

Production requires `VERTO_DEPLOYMENT_ENV=production`, with its existing production base URL and Supabase project binding preserved. The temporary production-only namespace bridge permits the previous main release's trusted service-role client while Railway switches versions; anonymous and authenticated browser callers still cannot establish a trusted namespace. After the new production SHA is healthy, execute the finalize operation to restore the same strict namespace routine used in staging.

Production operations are explicit files under `supabase/operations`; they must never run against staging. Existing legacy RPC signatures remain available. The production preflight found no notification rows or approved protocol requests requiring historical backfill, but the bridge handles any production notification created before the switch without moving records between projects.

## Remaining evidence

Production schema application, production PR/CI/merge/deployment and final branch synchronization are pending at document creation. Record their exact SHAs and results in Issue #366 and the final PR. Authenticated interactive smoke and a new real boleto/payment have not been executed in this reconciliation; prior founder validation and the strict regressions are distinct evidence. Do not report them as new manual validation.
