import assert from 'node:assert/strict';
import { filterFlatSelectColumnsForSchema as imported } from '../services/schemaSelectColumnFilter';
import { filterFlatSelectColumnsForSchema as legacyExport } from '../services/supabaseSchemaSelectGuard';

assert.strictEqual(legacyExport, imported, 'Existing named export must retain identical function identity');

const fixtures: Array<{ input: unknown; columns: string[]; expected: string }> = [
  { input: 'id,email,nonexistent,name', columns: ['id', 'email', 'name'], expected: 'id,email,name' },
  { input: ' id, email , nonexistent , name ', columns: ['id', 'email', 'name'], expected: 'id,email,name' },
  { input: 'foo,bar', columns: ['id'], expected: 'foo,bar' },
  { input: '*', columns: [], expected: '*' },
  { input: '   ', columns: ['id'], expected: '*' },
  { input: 'id,clinic:clinics(id,name)', columns: ['id'], expected: 'id,clinic:clinics(id,name)' },
  { input: 'id,email::text,missing', columns: ['id'], expected: 'id,email::text' },
  { input: 'id,json->key,missing', columns: ['id'], expected: 'id,json->key' },
  { input: 'id,alias:email,missing', columns: ['id'], expected: 'id,alias:email' },
  { input: 'id,id,id,missing', columns: ['id'], expected: 'id,id,id' },
  { input: 'id,,missing,,', columns: ['id'], expected: 'id' },
  { input: null, columns: [], expected: '*' },
  { input: undefined, columns: [], expected: '*' },
  { input: 'missing', columns: [], expected: 'missing' },
  { input: 'clinic_id,ClInIc_Id,missing', columns: ['clinic_id'], expected: 'clinic_id' },
  { input: '1stColumn,id,missing', columns: ['id'], expected: '1stColumn,id' },
  { input: 'id,foo(bar),missing', columns: ['id'], expected: 'id,foo(bar),missing' },
  { input: 'id,foo)bar,missing', columns: ['id'], expected: 'id,foo)bar,missing' },
];
for (const [index, fixture] of fixtures.entries()) {
  const allowed = new Set(fixture.columns);
  const before = new Set(allowed);
  assert.equal(imported(fixture.input, allowed), fixture.expected, `fixture ${index}`);
  assert.deepEqual(allowed, before, `available column set mutated in fixture ${index}`);
}

console.log('schemaSelectColumnFilter.test: PASS (18 fixtures)');
