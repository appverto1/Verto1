import assert from 'node:assert/strict';
import {
  INVITATION_LEGACY_SELECT,
  INVITATION_SELECT,
  PATIENT_LIST_LEGACY_SELECT,
  PATIENT_LIST_SELECT,
  clearRouteSchemaCapabilityCache,
  extractMissingColumnNameFromSupabaseError,
  fetchClinicInvitationsWithSchemaFallback,
  fetchClinicMembershipHistoryWithSchemaFallback,
  fetchPatientsWithSchemaFallback
} from '../src/utils/routeSchemaFallbacks.ts';

type FakeResult = { data?: any[] | null; error?: any | null };

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

  eq(column: string, value: any) {
    this.filters.push({ op: 'eq', column, value });
    return this;
  }

  neq(column: string, value: any) {
    this.filters.push({ op: 'neq', column, value });
    return this;
  }

  is(column: string, value: any) {
    this.filters.push({ op: 'is', column, value });
    return this;
  }

  or(value: string) {
    this.filters.push({ op: 'or', value });
    return this;
  }

  in(column: string, value: any[]) {
    this.filters.push({ op: 'in', column, value });
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
    return queue.shift() || { data: [], error: null };
  }
}

class CapabilityAwareFakeSupabase extends FakeSupabase {
  rpcCalls: string[] = [];

  async rpc(name: string) {
    this.rpcCalls.push(name);
    return {
      data: {
        patients: {
          columns: {
            profile_picture: false,
            profile_picture_path: false,
            professional_id: false
          }
        }
      },
      error: null
    };
  }
}

const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push({ name, fn });
const silentLogger = { warn() {} };

test('missing column parser supports Postgres and PostgREST schema cache messages', () => {
  assert.equal(
    extractMissingColumnNameFromSupabaseError({ message: 'column patients.professional_id does not exist' }),
    'professional_id'
  );
  assert.equal(
    extractMissingColumnNameFromSupabaseError({
      message: "Could not find the 'required_onboarding_fields' column of 'invitations' in the schema cache"
    }),
    'required_onboarding_fields'
  );
});

test('/api/patients keeps explicit current and legacy selects', () => {
  assert.ok(PATIENT_LIST_SELECT.includes('professional_id'));
  assert.ok(PATIENT_LIST_SELECT.includes('cpf'));
  assert.ok(!PATIENT_LIST_LEGACY_SELECT.includes('professional_id'));
  assert.ok(!PATIENT_LIST_LEGACY_SELECT.includes('cpf'));
});

test('/api/patients returns data with current explicit select', async () => {
  const supabase = new FakeSupabase({
    patients: [{ data: [{ id: 'patient-1', name: 'Paciente' }], error: null }]
  });

  const result = await fetchPatientsWithSchemaFallback({
    supabase,
    role: 'coordinator',
    userId: 'user-1',
    clinicId: 'clinic-1',
    limit: 200,
    logger: silentLogger
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, [{ id: 'patient-1', name: 'Paciente' }]);
  assert.equal(supabase.calls[0].selectColumns, PATIENT_LIST_SELECT);
});

test('/api/patients returns 200-equivalent fallback when professional_id is absent', async () => {
  const supabase = new FakeSupabase({
    patients: [
      { data: null, error: { code: '42703', message: 'column patients.professional_id does not exist' } },
      { data: [{ id: 'patient-legacy', name: 'Paciente legado' }], error: null }
    ]
  });

  const result = await fetchPatientsWithSchemaFallback({
    supabase,
    role: 'therapist',
    userId: 'therapist-1',
    clinicId: 'clinic-1',
    limit: 200,
    logger: silentLogger
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, [{ id: 'patient-legacy', name: 'Paciente legado' }]);
  assert.match(supabase.calls[0].filters.find((item) => item.op === 'or')?.value || '', /professional_id/);
  assert.ok(!supabase.calls[1].selectColumns.includes('professional_id'));
  assert.equal(supabase.calls[1].filters.some((item) => item.op === 'eq' && item.column === 'therapist_id'), true);
});

test('/api/patients caches missing optional columns and avoids repeating the fallback chain', async () => {
  const warnings: any[] = [];
  const logger = { warn: (...args: any[]) => warnings.push(args) };
  const supabase = new FakeSupabase({
    patients: [
      { data: null, error: { code: '42703', message: 'column patients.profile_picture does not exist' } },
      { data: null, error: { code: '42703', message: 'column patients.profile_picture_path does not exist' } },
      { data: null, error: { code: '42703', message: 'column patients.professional_id does not exist' } },
      { data: [{ id: 'patient-legacy-1' }], error: null },
      { data: [{ id: 'patient-legacy-2' }], error: null }
    ]
  });
  clearRouteSchemaCapabilityCache(supabase);

  const first = await fetchPatientsWithSchemaFallback({
    supabase,
    role: 'therapist',
    userId: 'therapist-1',
    clinicId: 'clinic-1',
    limit: 200,
    logger
  });
  const second = await fetchPatientsWithSchemaFallback({
    supabase,
    role: 'therapist',
    userId: 'therapist-1',
    clinicId: 'clinic-1',
    limit: 200,
    logger
  });

  assert.equal(first.data?.[0]?.id, 'patient-legacy-1');
  assert.equal(second.data?.[0]?.id, 'patient-legacy-2');
  assert.equal(supabase.calls.length, 5);
  assert.ok(!supabase.calls[4].selectColumns.includes('profile_picture'));
  assert.ok(!supabase.calls[4].selectColumns.includes('profile_picture_path'));
  assert.ok(!supabase.calls[4].selectColumns.includes('professional_id'));
  assert.equal(supabase.calls[4].filters.some((item) => item.op === 'eq' && item.column === 'therapist_id'), true);
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0][1].missingColumns, ['professional_id', 'profile_picture', 'profile_picture_path']);
});

test('/api/patients uses catalog capabilities before its first SELECT', async () => {
  const supabase = new CapabilityAwareFakeSupabase({
    patients: [
      { data: [{ id: 'patient-legacy-1' }], error: null },
      { data: [{ id: 'patient-legacy-2' }], error: null }
    ]
  });
  clearRouteSchemaCapabilityCache(supabase);

  const first = await fetchPatientsWithSchemaFallback({
    supabase,
    role: 'therapist',
    userId: 'therapist-1',
    clinicId: 'clinic-1',
    limit: 200,
    logger: silentLogger
  });
  const second = await fetchPatientsWithSchemaFallback({
    supabase,
    role: 'therapist',
    userId: 'therapist-1',
    clinicId: 'clinic-1',
    limit: 200,
    logger: silentLogger
  });

  assert.equal(first.data?.[0]?.id, 'patient-legacy-1');
  assert.equal(second.data?.[0]?.id, 'patient-legacy-2');
  assert.deepEqual(supabase.rpcCalls, ['get_verto_route_schema_capabilities']);
  assert.equal(supabase.calls.length, 2);
  assert.ok(!supabase.calls[0].selectColumns.includes('profile_picture'));
  assert.ok(!supabase.calls[0].selectColumns.includes('profile_picture_path'));
  assert.ok(!supabase.calls[0].selectColumns.includes('professional_id'));
  assert.equal(
    supabase.calls[0].filters.some((item) => item.op === 'eq' && item.column === 'therapist_id'),
    true
  );
});

test('/api/patients returns an empty list without breaking', async () => {
  const supabase = new FakeSupabase({
    patients: [{ data: [], error: null }]
  });

  const result = await fetchPatientsWithSchemaFallback({
    supabase,
    role: 'admin',
    userId: 'admin-1',
    clinicId: null,
    limit: 200,
    logger: silentLogger
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, []);
});

test('/api/clinic/invitations keeps explicit current and legacy selects', () => {
  assert.ok(INVITATION_SELECT.includes('required_onboarding_fields'));
  assert.ok(INVITATION_SELECT.includes('canceled_at'));
  assert.ok(!INVITATION_LEGACY_SELECT.includes('required_onboarding_fields'));
  assert.ok(!INVITATION_LEGACY_SELECT.includes('canceled_at'));
});

test('/api/clinic/invitations returns data with current explicit select', async () => {
  const supabase = new FakeSupabase({
    invitations: [{ data: [{ id: 'invite-1', email: 'a@example.com' }], error: null }]
  });

  const result = await fetchClinicInvitationsWithSchemaFallback({
    supabase,
    clinicId: 'clinic-1',
    logger: silentLogger
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, [{ id: 'invite-1', email: 'a@example.com' }]);
  assert.equal(supabase.calls[0].selectColumns, INVITATION_SELECT);
});

test('/api/clinic/invitations returns 200-equivalent fallback when optional invitation columns are absent', async () => {
  const supabase = new FakeSupabase({
    invitations: [
      {
        data: null,
        error: {
          code: 'PGRST204',
          message: "Could not find the 'required_onboarding_fields' column of 'invitations' in the schema cache"
        }
      },
      { data: [], error: null }
    ]
  });

  const result = await fetchClinicInvitationsWithSchemaFallback({
    supabase,
    clinicId: 'clinic-1',
    logger: silentLogger
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, []);
  assert.ok(!supabase.calls[1].selectColumns.includes('required_onboarding_fields'));
});



test('/api/clinic/invitations reutiliza colunas ausentes sem repetir fallback a cada request', async () => {
  const supabase = new FakeSupabase({
    invitations: [
      {
        data: null,
        error: {
          code: '42703',
          message: 'column invitations.accepted_at does not exist'
        }
      },
      { data: [{ id: 'invite-legacy-1' }], error: null },
      { data: [{ id: 'invite-legacy-2' }], error: null }
    ]
  });
  clearRouteSchemaCapabilityCache(supabase);

  const first = await fetchClinicInvitationsWithSchemaFallback({
    supabase,
    clinicId: 'clinic-1',
    logger: silentLogger
  });
  const second = await fetchClinicInvitationsWithSchemaFallback({
    supabase,
    clinicId: 'clinic-1',
    logger: silentLogger
  });

  assert.equal(first.data?.[0]?.id, 'invite-legacy-1');
  assert.equal(second.data?.[0]?.id, 'invite-legacy-2');
  assert.equal(supabase.calls.length, 3);
  assert.ok(!supabase.calls[2].selectColumns.includes('accepted_at'));
});

test('/api/clinic/invitations membership history degrades to empty list without 500', async () => {
  const supabase = new FakeSupabase({
    clinic_memberships: [
      {
        data: null,
        error: {
          code: 'PGRST200',
          message: "Could not find a relationship between 'clinic_memberships' and 'users' in the schema cache"
        }
      },
      {
        data: null,
        error: {
          code: '42P01',
          message: 'relation "clinic_memberships" does not exist'
        }
      }
    ]
  });

  const result = await fetchClinicMembershipHistoryWithSchemaFallback({
    supabase,
    clinicId: 'clinic-1',
    logger: silentLogger
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, []);
});

for (const item of tests) {
  await item.fn();
  console.log(`[ok] ${item.name}`);
}
