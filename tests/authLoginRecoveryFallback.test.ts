import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PROFILE_SELECT,
  fetchProfileByEmailWithSchemaFallback
} from '../src/utils/routeSchemaFallbacks.ts';

type FakeResult = { data?: any[] | Record<string, any> | null; error?: any | null };

class FakeQuery {
  table: string;
  selectColumns = '';
  filters: Array<{ op: string; column?: string; value?: any }> = [];

  constructor(private client: FakeSupabase, table: string) {
    this.table = table;
  }

  select(columns: string) {
    this.selectColumns = columns;
    return this;
  }

  ilike(column: string, value: any) {
    this.filters.push({ op: 'ilike', column, value });
    return this;
  }

  order(column: string, value: any) {
    this.filters.push({ op: 'order', column, value });
    return this;
  }

  limit(value: number) {
    this.filters.push({ op: 'limit', value });
    return this;
  }

  maybeSingle() {
    this.filters.push({ op: 'maybeSingle' });
    return this;
  }

  then(resolve: (value: FakeResult) => any, reject: (reason: any) => any) {
    return Promise.resolve(this.client.resolve(this)).then(resolve, reject);
  }
}

class FakeSupabase {
  calls: FakeQuery[] = [];
  private responsesByTable: Record<string, FakeResult[]>;

  constructor(responsesByTable: Record<string, FakeResult[]>) {
    this.responsesByTable = responsesByTable;
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }

  resolve(query: FakeQuery): FakeResult {
    this.calls.push(query);
    const queue = this.responsesByTable[query.table] || [];
    return queue.shift() || { data: null, error: null };
  }
}

const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push({ name, fn });
const silentLogger = { warn() {} };

test('/api/auth/login profile lookup by email removes optional missing column', async () => {
  const supabase = new FakeSupabase({
    users: [
      {
        data: null,
        error: {
          code: 'PGRST204',
          message: "Could not find the 'phone_verified_at' column of 'users' in the schema cache"
        }
      },
      { data: { id: 'user-1', email: 'owner@example.com', role: 'owner' }, error: null }
    ]
  });

  const result = await fetchProfileByEmailWithSchemaFallback({
    supabase,
    email: 'OWNER@example.com',
    logger: silentLogger
  });

  assert.equal(result.error, null);
  assert.equal((result.data as any).id, 'user-1');
  assert.equal(supabase.calls[0].selectColumns, PROFILE_SELECT);
  assert.ok(!supabase.calls[1].selectColumns.includes('phone_verified_at'));
  assert.equal(supabase.calls[1].filters.find((filter) => filter.op === 'ilike')?.value, 'owner@example.com');
});

test('/api/auth/login profile lookup by email removes missing created_at order', async () => {
  const supabase = new FakeSupabase({
    users: [
      {
        data: null,
        error: {
          code: '42703',
          message: 'column users.created_at does not exist'
        }
      },
      { data: { id: 'user-1', email: 'owner@example.com', role: 'owner' }, error: null }
    ]
  });

  const result = await fetchProfileByEmailWithSchemaFallback({
    supabase,
    email: 'owner@example.com',
    logger: silentLogger
  });

  assert.equal(result.error, null);
  assert.equal((result.data as any).id, 'user-1');
  assert.ok(supabase.calls[0].filters.some((filter) => filter.op === 'order' && filter.column === 'created_at'));
  assert.ok(!supabase.calls[1].filters.some((filter) => filter.op === 'order' && filter.column === 'created_at'));
});

test('/api/auth/password/recovery OTP select uses identifier column', () => {
  const serverSource = fs.readFileSync(path.resolve('server.ts'), 'utf8');
  const otpSelectMatch = serverSource.match(/const OTP_CHALLENGE_SELECT = \[[\s\S]*?\]\.join\(','\);/);
  assert.ok(otpSelectMatch, 'OTP_CHALLENGE_SELECT block should exist');
  const otpSelect = otpSelectMatch[0];

  assert.ok(otpSelect.includes("'identifier'"));
  assert.ok(!otpSelect.includes('identifier_hash'));
});

test('/api/auth/login no longer uses broad profile select directly inside login handler', () => {
  const serverSource = fs.readFileSync(path.resolve('server.ts'), 'utf8');
  const loginBlock = serverSource.match(/app\.post\('\/api\/auth\/login'[\s\S]*?app\.post\('\/api\/auth\/logout'/)?.[0] || '';

  assert.ok(loginBlock.includes('fetchProfileWithSchemaFallback'));
  assert.ok(loginBlock.includes('fetchProfileByEmailWithSchemaFallback'));
  assert.ok(!loginBlock.includes('select(USER_PROFILE_SELECT)'));
});

for (const { name, fn } of tests) {
  await fn();
  console.log(`[ok] ${name}`);
}
