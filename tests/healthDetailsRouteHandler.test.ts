import assert from 'node:assert/strict';
import { createHealthDetailsHandler } from '../services/healthDetailsRouteHandler';

type Deps = Parameters<typeof createHealthDetailsHandler>[0];
const invoke = async (deps: Deps) => {
  let status = 200;
  let payload: any = null;
  const res = {
    status(code: number) { status = code; return this; },
    json(value: unknown) { payload = value; return this; },
  };
  await createHealthDetailsHandler(deps)({}, res);
  return { status, payload };
};
let reads = 0, stripeCalls = 0, releases = 0;
const prod = await invoke({
  isProd: true,
  deploymentReleaseId: () => { releases++; return 'secret-release'; },
  supabase: { from: () => { reads++; throw Error('must not query'); } },
  getStripe: () => { stripeCalls++; throw Error('must not call'); },
});
assert.deepEqual(prod, { status: 404, payload: { error: 'Not found' } });
assert.equal(reads, 0); assert.equal(stripeCalls, 0); assert.equal(releases, 0);

const queries: unknown[][] = [];
const ok = await invoke({
  isProd: false,
  deploymentReleaseId: () => { releases++; return 'release'; },
  supabase: { from: (table: string) => {
    reads++;
    assert.equal(table, 'users');
    return { select: async (columns: string, options: unknown) => {
      queries.push([columns, options]);
      return { error: null };
    } };
  } },
  getStripe: () => { stripeCalls++; return {}; },
});
assert.equal(ok.status, 200);
assert.equal(ok.payload.release, 'release');
assert.equal(ok.payload.supabase, 'ok');
assert.equal(ok.payload.stripe, 'ok');
assert.deepEqual(ok.payload.env, {
  NODE_ENV: process.env.NODE_ENV,
  HAS_SUPABASE_URL: !!process.env.SUPABASE_URL,
  HAS_SUPABASE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  HAS_STRIPE_KEY: !!process.env.STRIPE_SECRET_KEY,
  HAS_DATABASE_URL: !!process.env.DATABASE_URL,
});
assert.deepEqual(queries, [['count', { count: 'exact', head: true }]]);
assert.equal(reads, 1); assert.equal(stripeCalls, 1); assert.equal(releases, 1);

const errors = await invoke({
  isProd: false,
  deploymentReleaseId: () => undefined,
  supabase: { from: () => ({ select: async () => ({ error: { message: 'unavailable' } }) }) },
  getStripe: () => { throw Error('stripe unavailable'); },
});
assert.equal(errors.status, 200);
assert.equal(errors.payload.supabase, 'error: unavailable');
assert.equal(errors.payload.stripe, 'error: stripe unavailable');
const exceptions = await invoke({
  isProd: false,
  deploymentReleaseId: () => undefined,
  supabase: { from: () => { throw Error('db exception'); } },
  getStripe: () => { throw Error('stripe exception'); },
});
assert.equal(exceptions.status, 200);
assert.equal(exceptions.payload.supabase, 'exception: db exception');
assert.equal(exceptions.payload.stripe, 'error: stripe exception');
console.log('healthDetailsRouteHandler: PASS (404 prod gate, dev response, query/Stripe errors)');
