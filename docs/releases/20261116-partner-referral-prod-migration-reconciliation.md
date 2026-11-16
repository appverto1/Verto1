# Partner referral — production migration reconciliation (2026-11-16)

## Scope
First code-only production promotion of the Staging-approved opt-in partner referral attribution. The canonical public lead Save endpoint remains the authority for persistence. Partner portal, marketplace, external authentication and Stripe/webhook code are not modified.

## Database objects already applied
Supabase projects checked read-only:
- Production: `vtzuorydrcueqltntpcm`
- Staging: `irspungjhapqdbgqroyc`

Production migration history contains the following successfully applied migrations under **production-specific versions**, not the chronological Staging source versions:
- `20261116131230 verto_partnerships_foundation_v1_prod_20261116`
- `20261116131239 verto_partner_referral_coupon_v1_prod_20261116`
- `20261116131245 verto_partner_coupon_compact_format_v1_prod_20261116`
- `20261116131253 verto_partner_referral_crm_reporting_v1_prod_20261116`

The four Staging SQL files are deliberately **not** introduced into `supabase/migrations` on Main in this release. Replaying older SQL under different versions would attempt duplicate constraint creation. The canonical Staging migration sources remain accessible in the staging branch at the same four filenames.

## Live preflight results
- Both projects have `public.verto_partner_accounts` and `public.verto_partner_referrals` with RLS enabled.
- `anon` and `authenticated` lack SELECT/INSERT access to both tables; `service_role` retains necessary privileges.
- `verto_claim_partner_referral_v1(uuid,text,text)`, `verto_partner_referral_overview_v1`, and `verto_owner_partner_referral_summary_v1` have identical `pg_get_functiondef` MD5 hashes across both projects: `925f927ee86d76f486266eeea3612c1d`, `745cd2607e28b20586d344485416272a`, and `724e38eff98deb31b425f0b89bf24202`.
- All three are `SECURITY INVOKER`, denied to `anon`/`authenticated`, and executable by `service_role`.
- Alias and entered-code CHECK constraints exist in both projects and match regex requirements; no data copy or clinical DML occurred in this inspection.

## Deployment gate
- Code PR should include only `services/publicSalesLeadInput.ts`, `services/publicSalesLeadRoutes.ts`, workflow and regression tests; plus this audit note.
- Run Node 20 build, lead/referral behavior regressions, RLS/ACL checks, CI and deploy on Main with its existing production Supabase.
- Post deploy: health, HTTP errors, no extra referral queries for ordinary leads, no role/clinic access leaks, and exact Railway commit.
- This release does **not** mark the portal/marketplace or the full Staging↔Main reconciliation complete.

**Safety:** do not run `supabase db push` blindly with Staging migrations or reapply these four SQL scripts in production. Compare actual migration histories and database objects first.
