import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  filterFlatSelectColumnsForSchema,
  installStagingSupabaseSchemaSelectGuard,
  installSupabaseSchemaSelectGuard,
} from '../services/supabaseSchemaSelectGuard.ts';

const availableUsers = new Set(['id', 'email', 'name', 'role', 'clinic_id', 'profile_picture']);
assert.equal(
  filterFlatSelectColumnsForSchema('id,email,profile_picture_path,name', availableUsers),
  'id,email,name',
  'missing plain columns must be removed before the first PostgREST request',
);
assert.equal(
  filterFlatSelectColumnsForSchema('id,clinic:clinics(id,name)', availableUsers),
  'id,clinic:clinics(id,name)',
  'relationship/nested selects must not be rewritten by the conservative guard',
);
assert.equal(
  filterFlatSelectColumnsForSchema('*', availableUsers),
  '*',
  'wildcard semantics must never be silently changed',
);
assert.equal(
  filterFlatSelectColumnsForSchema('profile_picture_path', availableUsers),
  'profile_picture_path',
  'an all-missing selection fails visibly instead of becoming an invalid empty select',
);

class FakeClient {
  supabaseUrl: string;
  calls: Array<{ table: string; select: string; options: any }> = [];

  constructor(url: string) {
    this.supabaseUrl = url;
  }

  from(table: string) {
    const client = this;
    return {
      select(columns = '*', options?: any) {
        client.calls.push({ table, select: columns, options });
        return { table, columns, options, error: null };
      },
    };
  }
}

const stagingUrl = 'https://staging-example.supabase.co';
const catalog = {
  schemaVersion: 2,
  users: { columns: { id: true, email: true, name: true, role: true, clinic_id: true, profile_picture: true } },
  clinics: { columns: { id: true, name: true, owner_user_id: true, phone_commercial: true } },
  appointments: { columns: { id: true, clinic_id: true, patient_id: true, scheduled_at: true, status: true } },
};

const install = installSupabaseSchemaSelectGuard({
  clientPrototype: FakeClient.prototype,
  targetSupabaseUrl: stagingUrl,
  catalog,
});
assert.equal(install.installed, true);
assert.deepEqual(new Set(install.guardedTables), new Set(['users', 'clinics', 'appointments']));

const stagingClient = new FakeClient(stagingUrl);
stagingClient.from('users').select('id,email,profile_picture_path,name');
assert.equal(stagingClient.calls.length, 1);
assert.equal(stagingClient.calls[0].select, 'id,email,name');

stagingClient.from('clinics').select('id,name,legal_name,owner_user_id,display_name');
assert.equal(stagingClient.calls[1].select, 'id,name,owner_user_id');

stagingClient.from('appointments').select('id,clinic_id,patient_id,patient_name,scheduled_at,date,time,recurrence_group_id');
assert.equal(stagingClient.calls[2].select, 'id,clinic_id,patient_id,scheduled_at');

stagingClient.from('appointments').select('id,patient:patients(id,name)');
assert.equal(stagingClient.calls[3].select, 'id,patient:patients(id,name)');

const productionClient = new FakeClient('https://production-example.supabase.co');
productionClient.from('users').select('id,email,profile_picture_path,name');
assert.equal(
  productionClient.calls[0].select,
  'id,email,profile_picture_path,name',
  'the staging guard must not rewrite a different Supabase project',
);

class StartupClient extends FakeClient {}
let catalogRpcCalls = 0;
let catalogClientFactoryCalls = 0;
const fakeCreateCatalogClient = (() => {
  catalogClientFactoryCalls += 1;
  return {
    rpc: async (name: string) => {
      assert.equal(name, 'get_verto_route_schema_capabilities');
      catalogRpcCalls += 1;
      return { data: catalog, error: null };
    },
  };
}) as any;

const startupInstall = await installStagingSupabaseSchemaSelectGuard({
  deploymentEnv: 'staging',
  env: {
    SUPABASE_URL: stagingUrl,
    SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key',
  },
  clientPrototype: StartupClient.prototype,
  createCatalogClient: fakeCreateCatalogClient,
});
assert.equal(startupInstall.installed, true);
assert.equal(startupInstall.reason, 'catalog');
assert.equal(catalogClientFactoryCalls, 1);
assert.equal(catalogRpcCalls, 1, 'schema catalog must be read once at startup, not once per request');

const startupClient = new StartupClient(stagingUrl);
startupClient.from('users').select('id,email,council,council_number,specialties,name');
assert.equal(startupClient.calls[0].select, 'id,email,name');

let productionFactoryCalls = 0;
const productionInstall = await installStagingSupabaseSchemaSelectGuard({
  deploymentEnv: 'production',
  env: {
    SUPABASE_URL: 'https://production-example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'unused',
  },
  clientPrototype: class AnotherClient {}.prototype,
  createCatalogClient: (() => {
    productionFactoryCalls += 1;
    throw new Error('must not run');
  }) as any,
});
assert.equal(productionInstall.installed, false);
assert.equal(productionInstall.reason, 'environment');
assert.equal(productionFactoryCalls, 0, 'production must not even load the staging catalog guard');

const backgroundWorkerModeSource = fs.readFileSync('services/backgroundWorkerMode.ts', 'utf8');
const migrationSource = fs.readFileSync('supabase/migrations/20260926022214_route_schema_capabilities_v2.sql', 'utf8');
assert.match(backgroundWorkerModeSource, /installStagingSupabaseSchemaSelectGuard/);
assert.match(backgroundWorkerModeSource, /await installStagingSupabaseSchemaSelectGuard/);
assert.match(migrationSource, /'users', jsonb_build_object/);
assert.match(migrationSource, /'clinics', jsonb_build_object/);
assert.match(migrationSource, /'appointments', jsonb_build_object/);
assert.match(migrationSource, /revoke all on function public\.get_verto_route_schema_capabilities\(\)[\s\S]*authenticated/);
assert.match(migrationSource, /grant execute on function public\.get_verto_route_schema_capabilities\(\)[\s\S]*service_role/);

console.log('supabaseSchemaSelectGuard.test.ts: OK');
