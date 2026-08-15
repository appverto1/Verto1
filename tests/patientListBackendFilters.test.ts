import assert from 'node:assert/strict';
import { PostgrestClient } from '@supabase/postgrest-js';
import { fetchPatientsWithSchemaFallback } from '../src/utils/routeSchemaFallbacks';

const clinicId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const requestedUrls: string[] = [];
const rows = [
  { id: 'active', status: 'active', is_active: true, deleted_at: null, clinic_id: clinicId },
  { id: 'active-null', status: 'active', is_active: null, deleted_at: null, clinic_id: clinicId },
  { id: 'pending-null', status: 'PENDING_ANAMNESIS', is_active: null, deleted_at: null, clinic_id: clinicId },
  { id: 'legacy-null-flags', status: null, is_active: null, deleted_at: null, clinic_id: clinicId },
  { id: 'inactive-false', status: 'ACTIVE', is_active: false, deleted_at: null, clinic_id: clinicId },
  { id: 'deleted-at', status: 'ACTIVE', is_active: true, deleted_at: '2026-08-01T00:00:00.000Z', clinic_id: clinicId },
  { id: 'deleted-upper', status: 'DELETED', is_active: true, deleted_at: null, clinic_id: clinicId },
  { id: 'deleted-lower', status: 'deleted', is_active: true, deleted_at: null, clinic_id: clinicId },
  { id: 'archived-upper', status: 'ARCHIVED', is_active: true, deleted_at: null, clinic_id: clinicId },
  { id: 'archived-lower', status: 'archived', is_active: true, deleted_at: null, clinic_id: clinicId },
  { id: 'other-clinic', status: 'ACTIVE', is_active: true, deleted_at: null, clinic_id: '33333333-3333-4333-8333-333333333333' },
];

const applyPatientListFilters = (requestUrl: URL) => {
  let filtered = [...rows];
  const requestedClinicId = requestUrl.searchParams.get('clinic_id')?.replace(/^eq\./, '');
  if (requestedClinicId) filtered = filtered.filter((patient) => patient.clinic_id === requestedClinicId);
  if (requestUrl.searchParams.get('deleted_at') === 'is.null') {
    filtered = filtered.filter((patient) => patient.deleted_at == null);
  }
  const orFilters = requestUrl.searchParams.getAll('or');
  if (orFilters.includes('(is_active.eq.true,is_active.is.null)')) {
    filtered = filtered.filter((patient) => patient.is_active === true || patient.is_active == null);
  }
  if (orFilters.includes('(status.is.null,and(status.not.ilike.ARCHIVED,status.not.ilike.DELETED))')) {
    filtered = filtered.filter((patient) => {
      const status = String(patient.status || '').trim().toUpperCase();
      return !status || (status !== 'ARCHIVED' && status !== 'DELETED');
    });
  }
  return filtered;
};

const postgrest = new PostgrestClient('https://verto.test/rest/v1', {
  fetch: async (input) => {
    const requestUrl = new URL(String(input));
    requestedUrls.push(requestUrl.toString());
    return new Response(JSON.stringify(applyPatientListFilters(requestUrl)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
});

const result = await fetchPatientsWithSchemaFallback({
  supabase: { from: postgrest.from.bind(postgrest) },
  role: 'coordinator',
  userId,
  clinicId,
  limit: 200,
  selectColumns: ['id', 'status', 'clinic_id', 'is_active', 'deleted_at', 'created_at'],
});

assert.equal(result.error, null);
assert.deepEqual(
  result.data?.map((patient: any) => patient.id),
  ['active', 'active-null', 'pending-null', 'legacy-null-flags'],
  'active/PENDING com is_active NULL devem aparecer; false, deleted_at e DELETED/ARCHIVED devem sair',
);
assert.equal(requestedUrls.length, 1, 'a listagem deve emitir uma única consulta de pacientes');

const requestUrl = new URL(requestedUrls[0]);
assert.equal(requestUrl.searchParams.get('clinic_id'), `eq.${clinicId}`, 'tenant deve continuar obrigatório');
assert.equal(requestUrl.searchParams.get('deleted_at'), 'is.null', 'remoção por data deve continuar no banco');
assert.deepEqual(
  requestUrl.searchParams.getAll('or'),
  [
    '(is_active.eq.true,is_active.is.null)',
    '(status.is.null,and(status.not.ilike.ARCHIVED,status.not.ilike.DELETED))',
  ],
  'NULL histórico deve permanecer visível e status removidos devem continuar excluídos',
);
assert.equal(
  requestUrl.searchParams.has('is_active'),
  false,
  'is_active=true não pode eliminar pacientes cujo flag histórico é NULL',
);

console.log('patientListBackendFilters.test.ts: OK');
