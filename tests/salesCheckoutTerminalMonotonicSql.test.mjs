import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
try {
  await db.exec('create table public.sales_checkout_links (id integer primary key, status text, marker text)');
  await db.exec(readFileSync('supabase/migrations/20261109115958_sales_checkout_terminal_monotonic_guard.sql', 'utf8'));
  for (const status of ['completed', 'failed', 'expired']) {
    await db.query('insert into public.sales_checkout_links values ($1,$2,$3)', [1, status, 'original']);
    await db.query("update public.sales_checkout_links set status='payment_pending', marker='stale' where id=1");
    const result = await db.query('select status, marker from public.sales_checkout_links where id=1');
    assert.deepEqual(result.rows[0], { status, marker: 'original' });
    await db.query('delete from public.sales_checkout_links where id=1');
  }
  await db.exec("insert into public.sales_checkout_links values (2, 'created', 'original')");
  await db.exec("update public.sales_checkout_links set status='payment_pending' where id=2");
  assert.equal((await db.query('select status from public.sales_checkout_links where id=2')).rows[0].status, 'payment_pending');
  await db.exec("update public.sales_checkout_links set status='completed' where id=2");
  assert.equal((await db.query('select status from public.sales_checkout_links where id=2')).rows[0].status, 'completed');
} finally {
  await db.close();
}
