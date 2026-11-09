import assert from 'node:assert/strict';
import { createPeiAssessmentPlanHandlers } from '../services/peiAssessmentPlanRoutes';

const clinicId = '11111111-1111-4111-8111-111111111111';
const patientId = '22222222-2222-4222-8222-222222222222';
const planId = '33333333-3333-4333-8333-333333333333';
const actorId = '44444444-4444-4444-8444-444444444444';
const otherId = '55555555-5555-4555-8555-555555555555';
const protocol = {
  id: 'eval-1', category: 'evaluation', title: 'Protocolo autorizado',
  data: [{ id: 'domain-1', name: 'Domínio', skills: [
    { id: 'skill-1', name: 'Item 1', criteria: 'Critério oficial' },
  ] }],
};
const plan = {
  id: planId, clinic_id: clinicId, patient_id: patientId,
  specialty: 'Fonoaudiologia', responsible_professional_id: actorId,
  protocol_id: 'eval-1', protocol_snapshot: protocol, content: { goals: [] },
  status: 'draft', title: 'Avaliação', revision: 1,
};
let memberRole = 'director';
let memberSpecialty = 'Fonoaudiologia';
let activeLink = true;
let activePatient = true;
let linkWrite = true;
let isSupervisor = false;
let rpcName = '';
let writeCalls = 0;
let conflict = false;
let stored: any = plan;
const uuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(String(v));

const supabase: any = {
  from(name: string) {
    const filters: Record<string, any> = {};
    const q: any = {
      select() { return q; },
      eq(field: string, value: any) { filters[field] = value; return q; },
      is(field: string, value: any) { filters[field] = value; return q; },
      order() { return q; },
      limit() { return q; },
      async maybeSingle() {
        if (name === 'patients') {
          return { data: activePatient && filters.id === patientId && filters.clinic_id === clinicId
            ? { id: patientId } : null, error: null };
        }
        if (name === 'clinic_memberships') {
          return { data: memberRole && filters.user_id === actorId && filters.clinic_id === clinicId
            ? { role: memberRole, specialty: memberSpecialty, can_supervise: isSupervisor } : null, error: null };
        }
        if (name === 'patient_pei_assessment_plans_v1') {
          return { data: stored && filters.id === planId && filters.clinic_id === clinicId &&
            filters.patient_id === patientId ? stored : null, error: null };
        }
        throw new Error('Unexpected maybeSingle table ' + name);
      },
      then(resolve: (arg: any) => any) {
        let data: any[] = [];
        if (name === 'patient_professional_links' && activeLink && filters.professional_id === actorId && filters.clinic_id === clinicId) {
          data = [{
            specialty: memberSpecialty, permissions: { read: true, write: linkWrite },
            case_role: isSupervisor ? 'supervisor' : 'member',
          }];
        }
        if (name === 'patient_pei_assessment_plans_v1') data = [stored].filter(Boolean);
        if (name === 'patient_pei_assessment_plan_versions_v1') data = [{ revision: 1, event_kind: 'create', created_at: '2026-11-09T00:00:00.000Z' }];
        return resolve({ data, error: null });
      },
    };
    return q;
  },
  async rpc(name: string, params: any) {
    rpcName = name;
    if (name === 'get_clinic_pei_evaluation_protocol_v1') {
      return { data: params.p_protocol_id === 'eval-1' ? protocol : null, error: null };
    }
    if (name === 'write_patient_pei_assessment_plan_v1') {
      writeCalls++;
      if (conflict) return { data: null, error: { message: 'PEI_REVISION_CONFLICT' } };
      return { data: { ...plan, title: params.p_title, revision: params.p_expected_revision ? 2 : 1 }, error: null };
    }
    throw new Error('Unexpected RPC ' + name);
  },
};
const handlers = createPeiAssessmentPlanHandlers(() => ({
  supabase, currentClinicId: (user: any) => user.clinicId,
  sanitizeString: (value: any, size = 120) => String(value ?? '').trim().slice(0, size),
  isUuid: uuid, enforcePayloadLimit: () => true,
  sendRouteDbError: (_res: any, _route: string, error: any) => { throw error; },
}));
const request = (method: string, overrides: any = {}) => ({
  session: { user: { id: actorId, clinicId } },
  resolvedPatientId: patientId,
  params: { patientId, planId }, method, body: {}, ...overrides,
});
const response = () => {
  const state: any = { statusCode: 200, payload: null };
  return {
    state,
    status(code: number) { state.statusCode = code; return this; },
    json(payload: any) { state.payload = payload; return this; },
  };
};

async function test() {
  let res = response();
  await handlers.list(request('GET'), res);
  assert.equal(res.state.statusCode, 200);
  assert.equal(res.state.payload.data.length, 1);

  res = response();
  await handlers.detail(request('GET'), res);
  assert.equal(res.state.payload.canEdit, true);
  assert.equal(res.state.payload.history.length, 1);

  res = response();
  await handlers.create(request('POST', { body: {
    specialty: 'Fonoaudiologia', responsibleProfessionalId: actorId,
    protocolId: 'eval-1', idempotencyKey: 'create-key-123',
    title: 'Avaliação inicial',
  } }), res);
  assert.equal(res.state.statusCode, 201);
  assert.equal(rpcName, 'write_patient_pei_assessment_plan_v1');

  res = response();
  await handlers.write(request('PATCH', { body: {
    title: 'Versão 2', expectedRevision: 1, action: 'save',
    content: { goals: [{ id: 'goal1', domainId: 'domain-1', sourceSkillId: 'skill-1',
      title: 'Avaliar', objective: 'Observar', criteria: 'Critério do plano', status: 'pending', targets: [] }] },
  } }), res);
  assert.equal(res.state.statusCode, 200);
  const authorizedWrites = writeCalls;

  // Editable target criteria are plan fields; oversized values never reach the DB.
  res = response();
  await handlers.write(request('PATCH', { body: {
    title: 'Alvo com critério', expectedRevision: 1, action: 'save',
    content: { goals: [{
      id: 'goal1', domainId: 'domain-1', sourceSkillId: 'skill-1',
      title: 'Avaliar', objective: 'Observar', criteria: 'Critério do plano',
      targets: [{ id: 'target1', name: 'Alvo', instruction: 'Observar', criteria: 'Acertar 3 de 4 itens',
        observation: '', status: 'in_progress' }],
    }] },
  } }), res);
  assert.equal(res.state.statusCode, 200);
  assert.equal(writeCalls, authorizedWrites + 1);

  res = response();
  await handlers.write(request('PATCH', { body: {
    title: 'Critério longo', expectedRevision: 1, action: 'save',
    content: { goals: [{
      id: 'goal1', domainId: 'domain-1', sourceSkillId: 'skill-1',
      title: 'Avaliar', objective: 'Observar', criteria: '',
      targets: [{ id: 'target1', name: 'Alvo', criteria: 'x'.repeat(1201), status: 'pending' }],
    }] },
  } }), res);
  assert.equal(res.state.statusCode, 422, 'oversized target criterion blocked');
  const testedWrites = writeCalls;
  assert.equal(testedWrites, authorizedWrites + 1);

  res = response();
  await handlers.write(request('PATCH', { body: {
    title: 'Tentativa de falsificar protocolo', expectedRevision: 1, action: 'save',
    content: { goals: [{ id: 'goal1', domainId: 'domain-1', sourceSkillId: 'forged',
      title: 'Avaliar', objective: '', criteria: '', status: 'pending', targets: [] }] },
  } }), res);
  assert.equal(res.state.statusCode, 422, 'forged skill must fail');
  assert.equal(writeCalls, testedWrites);

  memberRole = 'therapist'; memberSpecialty = 'Outra especialidade';
  res = response(); await handlers.detail(request('GET'), res);
  assert.equal(res.state.statusCode, 404, 'wrong-specialty therapist cannot see plan');
  res = response(); await handlers.write(request('PATCH', { body: {
    title: 'Tentativa de edição', expectedRevision: 1, action: 'save', content: { goals: [] },
  } }), res);
  assert.equal(res.state.statusCode, 404);
  assert.equal(writeCalls, testedWrites);

  memberRole = ''; memberSpecialty = 'Fonoaudiologia';
  res = response(); await handlers.list(request('GET'), res);
  assert.equal(res.state.statusCode, 403, 'active clinic membership required');
  memberRole = 'therapist'; activePatient = false;
  res = response(); await handlers.list(request('GET'), res);
  assert.equal(res.state.statusCode, 403, 'patient cannot be accessed in another clinic');
  activePatient = true;

  memberRole = 'supervisor'; isSupervisor = true; linkWrite = true;
  res = response(); await handlers.detail(request('GET'), res);
  assert.equal(res.state.payload.canEdit, true, 'linked case supervisor may manage evaluation');
  linkWrite = false;
  res = response(); await handlers.detail(request('GET'), res);
  assert.equal(res.state.payload.canEdit, false, 'readonly case supervisor cannot change plan');

  memberRole = 'director'; isSupervisor = false; linkWrite = true;
  conflict = true; res = response();
  await handlers.write(request('PATCH', { body: {
    title: 'Versão concorrente', expectedRevision: 1, action: 'save', content: { goals: [] },
  } }), res);
  assert.equal(res.state.statusCode, 409, 'concurrent save must report conflict');
  conflict = false;

  res = response();
  await handlers.detail(request('GET', { params: { patientId: otherId, planId: otherId } }), res);
  assert.equal(res.state.statusCode, 404, 'cross-patient plan IDOR denied');
  assert.ok(writeCalls >= 1);
}
await test();
console.log('peiAssessmentPlanRoutes.test.ts: PASS');
