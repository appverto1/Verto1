import { readFileSync as readItem07Source } from 'node:fs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const checkoutCoreSource = readItem07Source('services/salesModularCheckoutCore.ts','utf8');
const publicCheckoutRouteSource = readItem07Source('services/publicSalesCheckoutRoutes.ts','utf8');

const sql=readFileSync('supabase/migrations/20261104200000_sales_stripe_webhook_monotonic_guard.sql','utf8');
const server=readFileSync('server.ts','utf8');
const assisted=readFileSync('services/salesAssistedStripeEventHandlers.ts','utf8');
const canonical=readFileSync('services/stripeCanonicalWebhookRoute.ts','utf8');
const link=sql.match(/CREATE OR REPLACE FUNCTION public\.guard_sales_checkout_terminal_pending_v1\(\)[\s\S]*?\$link_guard\$;/)?.[0] || '';

test('manual owner edits keep response representation, old webhook no-return writes cannot regress converted leads',()=>{
  const owner=server.split('"/api/owner/sales/leads/:leadId"')[1]?.split('app.get(')[0]||'';
  const unpaid=server.split('if (!paymentConfirmed) {')[1]?.split('return { paymentConfirmed: false, activationPrepared: false };')[0]||'';
  const unpaidLead=unpaid.split('.from("sales_leads")')[1]?.split('supabase.from("sales_lead_events")')[0]||'';
  assert.match(owner,/\.update\(patch\)[\s\S]*?\.select\(/);
  assert.match(owner,/checkPlatformAdmin/);
  assert.match(unpaidLead,/\.update\(\{ status: "payment_pending", updated_at: now \}\)/);
  assert.doesNotMatch(unpaidLead,/\.select\(/);
  assert.match(sql,/OLD.status::text = 'converted'/);
  assert.match(sql,/NEW.status::text = 'payment_pending'/);
  assert.match(sql,/current_setting\('request.method', true\) = 'PATCH'/);
  assert.match(sql,/current_setting\('request.headers', true\)/);
  assert.match(sql,/position\('return=representation' IN request_prefer\) = 0/);
  assert.match(sql,/BEFORE UPDATE OF status ON public.sales_leads/);
});

test('out-of-order unpaid checkout cannot erase completed, failed or expired Stripe link',()=>{
  assert.match(link,/OLD\.status IN \('completed', 'failed', 'expired'\)/);
  assert.match(link,/NEW\.status = 'payment_pending'/);
  assert.match(link,/RETURN NULL;/);
  assert.match(link,/RETURN NEW;/);
  assert.match(sql,/BEFORE UPDATE OF status ON public\.sales_checkout_links/);
  assert.match(assisted,/status: result\.paymentConfirmed \? "completed" : "payment_pending"/);
  assert.match(assisted,/payment_completed_at: result\.paymentConfirmed \? completedAt : null/);
  assert.match(assisted,/\.neq\("status", "completed"\)/);
});

test('migration is transactional, tightly scoped, security-invoker and read-free',()=>{
  assert.match(sql,/^BEGIN;/m);
  assert.match(sql,/COMMIT;\s*$/);
  assert.match(sql,/SET LOCAL lock_timeout = '5s'/);
  assert.match(sql,/SECURITY INVOKER/g);
  assert.equal((sql.match(/SECURITY INVOKER/g)||[]).length,2);
  assert.equal((sql.match(/CREATE TRIGGER/g)||[]).length,2);
  assert.equal((sql.match(/RETURN NULL;/g)||[]).length,2);
  // Comments document the existing .select() call; check executable SQL only.
  const executableSql = sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(executableSql,/\bALTER TABLE\b|\bUPDATE public\.|\bINSERT INTO\b|\bDELETE FROM\b|\bSELECT\b|\bGRANT\b|SECURITY DEFINER|pg_sleep/i);
});

test('existing Stripe signature, event-id deduplication, payment RPC, module isolation and idempotency remain unchanged',()=>{
  assert.match(canonical,/stripe\.webhooks\.constructEvent/);
  assert.match(canonical,/"\/api\/stripe\/webhook"/);
  assert.match(server,/async function reserveStripeWebhookEvent/);
  assert.match(server,/\.from\('stripe_webhook_events'\)/);
  assert.match(server,/if \(sanitizeString\(existing\.status, 40\) === 'processed'\) return false/);
  assert.match(server,/confirm_sales_assisted_checkout_payment/);
  assert.match(assisted,/checkout\.session\.async_payment_succeeded/);
  assert.match(server,/applyModularEntitlementsForOrganization/);
  assert.match(checkoutCoreSource,/MODULAR_CHECKOUT_IDEMPOTENCY_CONFLICT/);
  assert.match(checkoutCoreSource,/operationIdempotencyKey/);
});
