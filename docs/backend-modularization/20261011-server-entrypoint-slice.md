# Server entrypoint direct extraction — isolated candidate

- Date: 2026-10-11. Baseline is first consolidated candidate PR #379 commit `19d78a278e1bb697ebbdf54262b5b870cb388f30`, derived from `staging` at `e78a05511dfd03b82d32d92d44f4231004d71a64`.
- Primary goal: remove code **directly** from the large `server.ts` while preserving route order, auth, logs, query and response.
- GitHub connector reports `server.ts` Git blob `b5460aa69d3cee3ff6ec96849f61537974007997` (4,761,919 bytes) but returns an empty content string. Prior upload attempts failed h2. Therefore do not guess handler bodies.
- First commit adds a branch-restricted GitHub Actions probe that uses a **real checkout** plus TypeScript AST to inventory the health and readiness handlers and small top-level helper declarations. No code is rewritten by the probe.
- A subsequent reversible extraction will be accepted only after verifying the exact source, scope and test contracts; needs CI tests. No merge, deploy or staging change.

## Applied extraction
- Original readiness route: 49 lines, at ~28647 in baseline. All original statement text preserved, with new lazy dependency accessor.
- Exact baseline Git SHA verified, unique AST route verified, replacement reversed byte-for-byte in memory before writing.
- Source wrote only server.ts and services/readyRouteHandler.ts; tests were committed to the feature branch before running.
- Need Node 20 focused tests, build, staging CI and no deployment before accepting.

## Verified direct reduction and disposable writer cleanup

- Isolated branch-only GitHub Actions writer run [38158873316](https://github.com/appverto1/Verto1/actions/runs/38158873316) successfully applied the AST extraction after exact SHA and byte-roundtrip checks, passed 13 mock-based tests and one structural regression, built the frontend, and committed ONLY to its feature branch.
- Original `server.ts`: 102,066 lines / 4,761,919 Git bytes (SHA `b5460aa69d3cee3ff6ec96849f61537974007997`). New `server.ts`: **102,028 lines** / **4,760,964 Git bytes** (SHA `a301111eac512996c2a019b728e080b9aa54b63a`), **38 lines and 955 bytes reduced**. This is actual branch reduction, **not yet staging integration**.
- The temporary writer workflow with `contents: write`, the probe and the single-use AST extraction script were removed from the candidate branch after execution. **No writer workflow should be merged into staging.**
- The standard staging CI was expanded with explicit `serverReadyRouteHandler.test.ts` and `serverReadyRouteExtraction.regression.test.mjs` runs, in addition to the ten batch-01 regression test files. Verify the last-commit CI before claiming joint success.
- This candidate is **stacked onto** the #379 consolidated base and must not be merged independently alongside its ancestor as a duplicate batch. All other modified source PR blobs retained. No deploy, no smoke, no staging or main mutation.
