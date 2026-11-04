import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const sql=readFileSync('supabase/migrations/20261104200000_sales_stripe_webhook_monotonic_guard.sql','utf8');
const server=readFileSync('server.ts','utf8');
const lead=sql.match(/CREATE OR REPLACE FUNCTION public\.guard_sales_converted_pending_v1\(\)[\s\S]*?\$lead_guard\$;/)?.[0] || '';
const link=sql.match(/CREATE OR REPLACE FUNCTION public\.guard_sales_checkout_terminal_pending_v1\(\)[\s\S]*?\$link_guard\$;/)?.[0] || '';

test('late pending Stripe event cannot demote a converted lead in the database',()=>{
  assert.match(lead,/OLD\.status::text = 'converted' AND NEW\.status::text = 'payment_pending'/);
  assert.match(lead,/RETURN NULL;/);
  assert.match(lead,/RETURN NEW;/);
  assert.match(sql,/BEFORE UPDATE OF status ON public\.sales_leads/);
  assert.match(server,/if \(!paymentConfirmed\) \{/);
  assert.match(server,/\.update\(\{ status: "payment_pending", updated_at: now \}\)/);
});

test('out-of-order unpaid checkout cannot erase completed, failed or expired Stripe link',()=>{
  assert.match(link,/OLD\.status IN \('completed', 'failed', 'expired'\)/);
  assert.match(link,/NEW\.status = 'payment_pending'/);
  assert.match(link,/RETURN NULL;/);
  assert.match(link,/RETURN NEW;/);
  assert.match(sql,/BEFORE UPDATE OF status ON public\.sales_checkout_links/);
  assert.match(server,/status: result\.paymentConfirmed \? "completed" : "payment_pending"/);
  assert.match(server,/payment_completed_at: result\.paymentConfirmed \? completedAt : null/);
  assert.match(server,/\.neq\("status", "completed"\)/);
});

test('migration is transactional, tightly scoped, security-invoker and read-free',()=>{
  assert.match(sql,/^BEGIN;/m);
  assert.match(sql,/COMMIT;\s*$/);
  assert.match(sql,/SET LOCAL lock_timeout = '5s'/);
  assert.match(sql,/SECURITY INVOKER/g);
  assert.equal((sql.match(/SECURITY INVOKER/g)||[]).length,2);
  assert.equal((sql.match(/CREATE TRIGGER/g)||[]).length,2);
  assert.equal((sql.match(/RETURN NULL;/g)||[]).length,2);
  assert.doesNotMatch(sql,/\bALTER TABLE\b|\bUPDATE public\.|\bINSERT INTO\b|\bDELETE FROM\b|\bSELECT\b|\bGRANT\b|SECURITY DEFINER|pg_sleep/i);
});

test('existing Stripe signature, event-id deduplication, payment RPC, module isolation and idempotency remain unchanged',()=>{
  assert.match(server,/stripe\.webhooks\.constructEvent/);
  assert.match(server,/async function reserveStripeWebhookEvent/);
  assert.match(server,/\.from\('stripe_webhook_events'\)/);
  assert.match(server,/if \(sanitizeString\(existing\.status, 40\) === 'processed'\) return false/);
  assert.match(server,/confirm_sales_assisted_checkout_payment/);
  assert.match(server,/checkout\.session\.async_payment_succeeded/);
  assert.match(server,/applyModularEntitlementsForOrganization/);
  assert.match(server,/MODULAR_CHECKOUT_IDEMPOTENCY_CONFLICT/);
  assert.match(server,/operationIdempotencyKey/);
});
