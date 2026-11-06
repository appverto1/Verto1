import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Local, isolated PostgreSQL: no credentials, network or customer data.
test('late unpaid webhooks cannot demote converted leads or terminal checkout links; owner manual status remains editable', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE TABLE public.sales_leads (id integer PRIMARY KEY, status text NOT NULL);"+
      "CREATE TABLE public.sales_checkout_links (id integer PRIMARY KEY, status text NOT NULL, payment_completed_at timestamptz);"
    );
    const migration = readFileSync('supabase/migrations/20261104202545_sales_stripe_webhook_monotonic_guard_v1.sql','utf8');
    await db.exec(migration);
    await db.exec(
      "INSERT INTO public.sales_leads VALUES (1, 'converted');"+
      "INSERT INTO public.sales_checkout_links VALUES (1,'completed','2026-11-04T18:00:00Z'),(2,'failed',NULL),(3,'expired',NULL),(4,'payment_pending',NULL);"
    );
    const leadStatus = async () => (await db.query("SELECT status FROM public.sales_leads WHERE id=1")).rows[0].status;

    // Simulate backend service-role PostgREST update without .select().
    await db.exec([
      "BEGIN;",
      "SELECT set_config('request.method','PATCH',true);",
      "SELECT set_config('request.headers','{\"prefer\":\"return=minimal\"}',true);",
      "UPDATE public.sales_leads SET status='payment_pending' WHERE id=1;",
      "COMMIT;"
    ].join("\n"));
    assert.equal(await leadStatus(),'converted','late unpaid webhook must not demote converted lead');

    // Owner PATCH route chains .select(), PostgREST returns representation.
    await db.exec([
      "BEGIN;",
      "SELECT set_config('request.method','PATCH',true);",
      "SELECT set_config('request.headers','{\"prefer\":\"return=representation\"}',true);",
      "UPDATE public.sales_leads SET status='payment_pending' WHERE id=1;",
      "COMMIT;"
    ].join("\n"));
    assert.equal(await leadStatus(),'payment_pending','owner must retain manual edit capability');

    // Direct SQL maintenance is not an HTTP PATCH and remains unaffected.
    await db.exec("UPDATE public.sales_leads SET status='converted' WHERE id=1;");
    assert.equal(await leadStatus(),'converted');

    // Late unpaid session event must preserve terminal links and timestamp.
    await db.exec("UPDATE public.sales_checkout_links SET status='payment_pending',payment_completed_at=NULL WHERE id IN (1,2,3);");
    const links=(await db.query("SELECT id,status,payment_completed_at IS NOT NULL AS paid_at FROM public.sales_checkout_links ORDER BY id")).rows;
    assert.deepEqual(links.map(x=>[x.id,x.status,x.paid_at]),[
      [1,'completed',true],[2,'failed',false],[3,'expired',false],[4,'payment_pending',false]
    ]);
    await db.exec("UPDATE public.sales_checkout_links SET status='completed' WHERE id=4;");
    assert.equal((await db.query("SELECT status FROM public.sales_checkout_links WHERE id=4")).rows[0].status,'completed');
  } finally {
    await db.close();
  }
});
