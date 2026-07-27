import 'dotenv/config';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const TAG = 'DEMO:SIMPLISAUDE';
const args = new Set(process.argv.slice(2));
const cleanupOnly = args.has('--cleanup') || args.has('--remove-demo-data');
const confirmed = args.has('--confirm-demo-seed');
const allowSeed = String(process.env.ALLOW_DEMO_SEED || '').toLowerCase() === 'true';
const productionish =
  String(process.env.NODE_ENV || '').toLowerCase() === 'production' ||
  Boolean(process.env.RAILWAY_ENVIRONMENT) ||
  String(process.env.VERCEL_ENV || '').toLowerCase() === 'production' ||
  String(process.env.DEPLOY_ENV || '').toLowerCase() === 'production';
const allowProduction =
  String(process.env.ALLOW_DEMO_SEED_PRODUCTION || '').toLowerCase() === 'true' &&
  args.has('--i-understand-production-risk');

if (!allowSeed || !confirmed) {
  console.error([
    'Seed demo bloqueado.',
    'Use exatamente: ALLOW_DEMO_SEED=true node scripts/seed-simplisaude-demo.mjs --confirm-demo-seed',
    'Cleanup: ALLOW_DEMO_SEED=true node scripts/seed-simplisaude-demo.mjs --cleanup --confirm-demo-seed'
  ].join('\n'));
  process.exit(1);
}

if (productionish && !allowProduction) {
  console.error([
    'Seed demo bloqueado em ambiente de producao/deploy.',
    'Para um ambiente descartavel explicitamente aprovado, adicione ALLOW_DEMO_SEED_PRODUCTION=true --i-understand-production-risk.'
  ].join('\n'));
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const IDS = {
  clinic: '11111111-1111-4111-8111-111111111111',
  coordinator: '22222222-2222-4222-8222-222222222222',
  therapist: '33333333-3333-4333-8333-333333333333',
  responsible: '44444444-4444-4444-8444-444444444444',
  patientPedro: '55555555-5555-4555-8555-555555555555',
  patientLia: '66666666-6666-4666-8666-666666666666',
  payer: '77777777-7777-4777-8777-777777777777',
  roomAba: '88888888-8888-4888-8888-888888888888',
  roomMulti: '99999999-9999-4999-8999-999999999999',
  reqAba: '10101010-1010-4010-8010-101010101010',
  apptReady: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  apptSignaturePending: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  apptReportPending: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  apptDurationWarning: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  apptReschedule: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
  apptCancelled: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
  actionReschedule: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  signatureReady: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  docGuidePending: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
  docAuthPending: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
  exportAudit: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
};

const SESSION_IDS = {
  ready: 'demo-simplisaude-session-ready',
  signaturePending: 'demo-simplisaude-session-signature-pending',
  reportPending: 'demo-simplisaude-session-report-pending',
  durationWarning: 'demo-simplisaude-session-duration-warning'
};

const nowIso = () => new Date().toISOString();
const at = (day, hour, minute = 0) =>
  new Date(Date.UTC(2026, 4, day, hour, minute, 0)).toISOString();
const addMinutes = (iso, minutes) => new Date(new Date(iso).getTime() + minutes * 60000).toISOString();

function cleanObject(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function extractMissingColumnName(error) {
  const text = String(error?.message || error?.details || error?.hint || '');
  return (
    text.match(/Could not find the '([^']+)' column/i)?.[1] ||
    text.match(/column "([^"]+)" of relation/i)?.[1] ||
    text.match(/column "([^"]+)" does not exist/i)?.[1] ||
    text.match(/'([^']+)' column of '([^']+)'/i)?.[1] ||
    null
  );
}

function isMissingTableError(error) {
  const text = String(error?.message || error?.details || '');
  return /relation .* does not exist|schema cache|Could not find the table/i.test(text);
}

async function upsertRows(table, rows, { onConflict = 'id', select = false } = {}) {
  let pending = rows.map(cleanObject);
  while (pending.length > 0) {
    let query = supabase.from(table).upsert(pending, { onConflict });
    if (select) query = query.select('*');
    const { data, error } = await query;
    if (!error) {
      console.log(`[demo-seed] ${table}: ${pending.length} row(s) upserted.`);
      return data || [];
    }

    const missingColumn = extractMissingColumnName(error);
    if (missingColumn && pending.some((row) => Object.prototype.hasOwnProperty.call(row, missingColumn))) {
      pending = pending.map((row) => {
        const next = { ...row };
        delete next[missingColumn];
        return next;
      });
      console.warn(`[demo-seed] ${table}: coluna ausente ignorada (${missingColumn}).`);
      continue;
    }

    throw error;
  }
  return [];
}

async function updateRows(table, patch, eqColumn, eqValue) {
  let pending = cleanObject(patch);
  while (Object.keys(pending).length > 0) {
    const { error } = await supabase.from(table).update(pending).eq(eqColumn, eqValue);
    if (!error) return;
    const missingColumn = extractMissingColumnName(error);
    if (missingColumn && Object.prototype.hasOwnProperty.call(pending, missingColumn)) {
      delete pending[missingColumn];
      console.warn(`[demo-seed] ${table}: coluna ausente ignorada no update (${missingColumn}).`);
      continue;
    }
    throw error;
  }
}

async function deleteWhereIn(table, column, values) {
  const safeValues = values.filter(Boolean);
  if (safeValues.length === 0) return;
  const { error } = await supabase.from(table).delete().in(column, safeValues);
  if (error) {
    if (isMissingTableError(error)) {
      console.warn(`[demo-seed] ${table}: tabela ausente, cleanup ignorado.`);
      return;
    }
    throw error;
  }
  console.log(`[demo-seed] ${table}: cleanup por ${column}.`);
}

async function removeDemoData() {
  await deleteWhereIn('operational_closure_exports', 'organization_id', [IDS.clinic]);
  await deleteWhereIn('appointment_closure_audit_logs', 'organization_id', [IDS.clinic]);
  await deleteWhereIn('appointment_closure_checks', 'organization_id', [IDS.clinic]);
  await deleteWhereIn('appointment_required_documents', 'organization_id', [IDS.clinic]);
  await deleteWhereIn('appointment_billing_contexts', 'organization_id', [IDS.clinic]);
  await deleteWhereIn('payer_requirement_audit_logs', 'organization_id', [IDS.clinic]);
  await deleteWhereIn('clinic_payer_requirements', 'organization_id', [IDS.clinic]);
  await deleteWhereIn('clinic_payers', 'organization_id', [IDS.clinic]);
  await deleteWhereIn('appointment_status_audit_logs', 'organization_id', [IDS.clinic]);
  await deleteWhereIn('appointment_action_requests', 'organization_id', [IDS.clinic]);
  await deleteWhereIn('session_signatures', 'organization_id', [IDS.clinic]);
  await deleteWhereIn('aba_session_summaries', 'session_id', Object.values(SESSION_IDS));
  await deleteWhereIn('aba_sessions', 'id', Object.values(SESSION_IDS));
  await deleteWhereIn('appointment_professionals', 'appointment_id', [
    IDS.apptReady,
    IDS.apptSignaturePending,
    IDS.apptReportPending,
    IDS.apptDurationWarning,
    IDS.apptReschedule,
    IDS.apptCancelled
  ]);
  await deleteWhereIn('appointments', 'id', [
    IDS.apptReady,
    IDS.apptSignaturePending,
    IDS.apptReportPending,
    IDS.apptDurationWarning,
    IDS.apptReschedule,
    IDS.apptCancelled
  ]);
  await deleteWhereIn('clinic_rooms', 'id', [IDS.roomAba, IDS.roomMulti]);
  await deleteWhereIn('patients', 'id', [IDS.patientPedro, IDS.patientLia]);
  await deleteWhereIn('clinic_memberships', 'clinic_id', [IDS.clinic]);
  await deleteWhereIn('users', 'id', [IDS.coordinator, IDS.therapist, IDS.responsible]);
  await deleteWhereIn('clinics', 'id', [IDS.clinic]);
}

function appointmentRow({ id, patientId, patientName, status, day, hour, duration, actualDuration, roomId, roomName, notes }) {
  const scheduledStart = at(day, hour);
  const scheduledEnd = addMinutes(scheduledStart, duration);
  const actualStart = actualDuration ? scheduledStart : null;
  const actualEnd = actualDuration ? addMinutes(scheduledStart, actualDuration) : null;
  return cleanObject({
    id,
    clinic_id: IDS.clinic,
    organization_id: IDS.clinic,
    patient_id: patientId,
    therapist_id: IDS.therapist,
    scheduled_at: scheduledStart,
    scheduled_start_at: scheduledStart,
    scheduled_end_at: scheduledEnd,
    scheduled_duration_minutes: duration,
    duration_minutes: duration,
    actual_start_at: actualStart,
    actual_end_at: actualEnd,
    actual_duration_minutes: actualDuration || null,
    status,
    notes: `${TAG} ${notes}`,
    patient_email: patientId === IDS.patientPedro ? 'pedro.almeida.demo@verto.test' : 'lia.martins.demo@verto.test',
    patient_name: patientName,
    therapist_name: 'Ana Ribeiro',
    room_id: roomId,
    room_name: roomName,
    location_type: 'clinica',
    service_type: 'ABA',
    confirmed_at: ['CONFIRMED', 'COMPLETED'].includes(status) ? addMinutes(scheduledStart, -1440) : null,
    confirmed_by: IDS.responsible,
    confirmed_by_role: 'responsible',
    source_payload: {
      demo: true,
      tag: TAG,
      roteiro: 'piloto-simplisaude'
    },
    created_at: nowIso(),
    updated_at: nowIso()
  });
}

function closureChecklist({ signature = true, report = true, duration = true, guide = true, authorization = true }) {
  return [
    { key: 'appointment_completed', label: 'Sessão concluida', status: 'PASSED' },
    { key: 'signature_present', label: 'Assinatura do responsavel', status: signature ? 'PASSED' : 'FAILED' },
    { key: 'report_present', label: 'Relatorio da sessao', status: report ? 'PASSED' : 'FAILED' },
    { key: 'actual_duration_present', label: 'Duracao realizada', status: duration ? 'PASSED' : 'WARNING' },
    { key: 'payer_guide_required', label: 'Guia do pagador', status: guide ? 'PASSED' : 'FAILED' },
    { key: 'payer_authorization_required', label: 'Autorizacao do pagador', status: authorization ? 'PASSED' : 'FAILED' }
  ];
}

function closureRow({ appointmentId, sessionId, patientId, professionalId = IDS.therapist, status, scheduledStart, minutes, actualMinutes, issues, checklist, docs = 0 }) {
  const hash = crypto
    .createHash('sha256')
    .update(`${TAG}:${appointmentId}:${status}:${issues.join('|')}`)
    .digest('hex');
  return {
    id: crypto.randomUUID(),
    organization_id: IDS.clinic,
    appointment_id: appointmentId,
    aba_session_id: sessionId,
    patient_id: patientId,
    professional_id: professionalId,
    service_type: 'ABA',
    readiness_status: status,
    checklist,
    blocking_issues_count: status === 'PENDING' ? Math.max(1, issues.length) : 0,
    warning_issues_count: status === 'WARNING' ? Math.max(1, issues.length) : 0,
    missing_required_count: status === 'PENDING' ? Math.max(1, issues.length) : 0,
    scheduled_start: scheduledStart,
    scheduled_end: addMinutes(scheduledStart, minutes),
    actual_start: actualMinutes ? scheduledStart : null,
    actual_end: actualMinutes ? addMinutes(scheduledStart, actualMinutes) : null,
    scheduled_minutes: minutes,
    actual_minutes: actualMinutes || null,
    main_issues: issues,
    payer_id: IDS.payer,
    payer_name_snapshot: 'Convenio Exemplo - DEMO Verto',
    guide_number: issues.some((item) => /Guia/.test(item)) ? null : 'GUIA-DEMO-001',
    authorization_code: issues.some((item) => /Autorizacao/.test(item)) ? null : 'AUTH-DEMO-001',
    applied_payer_requirement_id: IDS.reqAba,
    payer_requirement_source: 'SPECIFIC',
    required_document_pending_count: docs,
    context_hash: hash,
    generated_by: IDS.coordinator,
    generated_at: nowIso(),
    updated_at: nowIso()
  };
}

async function seedDemoData() {
  await removeDemoData();

  await upsertRows('clinics', [{
    id: IDS.clinic,
    name: 'Clinica Demo Verto',
    specialty: 'ABA e equipe multidisciplinar',
    phone_commercial: '+55 11 90000-0000',
    address: { demo: true, tag: TAG, cidade: 'Sao Paulo', uf: 'SP' },
    created_at: nowIso(),
    updated_at: nowIso()
  }]);

  await upsertRows('users', [
    {
      id: IDS.coordinator,
      email: 'coordenacao.demo@verto.test',
      name: 'Carla Menezes',
      role: 'coordinator',
      type: 'professional',
      clinic_id: IDS.clinic,
      status: 'active',
      created_at: nowIso()
    },
    {
      id: IDS.therapist,
      email: 'ana.ribeiro.demo@verto.test',
      name: 'Ana Ribeiro',
      role: 'therapist',
      type: 'professional',
      clinic_id: IDS.clinic,
      specialty: 'ABA',
      status: 'active',
      created_at: nowIso()
    },
    {
      id: IDS.responsible,
      email: 'mariana.almeida.demo@verto.test',
      name: 'Mariana Almeida',
      role: 'patient',
      type: 'responsible',
      clinic_id: IDS.clinic,
      status: 'active',
      created_at: nowIso()
    }
  ]);

  await updateRows('clinics', { owner_user_id: IDS.coordinator }, 'id', IDS.clinic);

  await upsertRows('clinic_memberships', [
    { id: crypto.randomUUID(), user_id: IDS.coordinator, clinic_id: IDS.clinic, role: 'coordinator', status: 'active' },
    { id: crypto.randomUUID(), user_id: IDS.therapist, clinic_id: IDS.clinic, role: 'therapist', status: 'active' }
  ]);

  await upsertRows('professional_profiles', [
    {
      user_id: IDS.therapist,
      full_name: 'Ana Ribeiro',
      clinic_name: 'Clinica Demo Verto',
      specialty: 'ABA',
      council: 'CRP',
      council_number: 'DEMO-0001',
      requires_onboarding: false,
      metadata: { demo: true, tag: TAG },
      created_at: nowIso(),
      updated_at: nowIso()
    }
  ], { onConflict: 'user_id' });

  await upsertRows('patients', [
    {
      id: IDS.patientPedro,
      name: 'Pedro Almeida',
      email: 'pedro.almeida.demo@verto.test',
      status: 'active',
      type: 'child',
      age: 8,
      diagnosis: `${TAG} perfil ficticio para demonstracao ABA`,
      clinic_id: IDS.clinic,
      therapist_id: IDS.therapist,
      responsible_name: 'Mariana Almeida',
      created_at: nowIso()
    },
    {
      id: IDS.patientLia,
      name: 'Lia Martins',
      email: 'lia.martins.demo@verto.test',
      status: 'active',
      type: 'child',
      age: 6,
      diagnosis: `${TAG} perfil ficticio multidisciplinar`,
      clinic_id: IDS.clinic,
      therapist_id: IDS.therapist,
      responsible_name: 'Roberta Martins',
      created_at: nowIso()
    }
  ]);

  await upsertRows('clinic_rooms', [
    {
      id: IDS.roomAba,
      organization_id: IDS.clinic,
      clinic_id: IDS.clinic,
      name: 'Sala 1 - ABA',
      specialties: 'ABA',
      description: `${TAG} sala demo para coleta ABA`,
      capacity: 3,
      is_active: true
    },
    {
      id: IDS.roomMulti,
      organization_id: IDS.clinic,
      clinic_id: IDS.clinic,
      name: 'Sala 2 - Multidisciplinar',
      specialties: 'Fonoaudiologia, Terapia Ocupacional',
      description: `${TAG} sala demo multidisciplinar`,
      capacity: 4,
      is_active: true
    }
  ]);

  await upsertRows('clinic_payers', [{
    id: IDS.payer,
    organization_id: IDS.clinic,
    name: 'Convenio Exemplo - DEMO Verto',
    payer_type: 'INSURANCE',
    status: 'ACTIVE',
    notes: `${TAG} pagador ficticio para piloto. Nao representa operadora real.`,
    created_by: IDS.coordinator,
    created_at: nowIso(),
    updated_at: nowIso()
  }]);

  await upsertRows('clinic_payer_requirements', [{
    id: IDS.reqAba,
    organization_id: IDS.clinic,
    payer_id: IDS.payer,
    service_type: 'ABA',
    require_signature: true,
    require_report: true,
    require_actual_duration: true,
    require_authorization: true,
    require_guide: true,
    require_professional_registry: true,
    require_patient_document: true,
    min_duration_minutes: 40,
    max_duration_variance_minutes: 10,
    allow_manual_override: true,
    is_active: true,
    created_by: IDS.coordinator,
    created_at: nowIso(),
    updated_at: nowIso()
  }]);

  const appointments = [
    appointmentRow({ id: IDS.apptReady, patientId: IDS.patientPedro, patientName: 'Pedro Almeida', status: 'COMPLETED', day: 4, hour: 12, duration: 45, actualDuration: 45, roomId: IDS.roomAba, roomName: 'Sala 1 - ABA', notes: 'sessao pronta para conferencia' }),
    appointmentRow({ id: IDS.apptSignaturePending, patientId: IDS.patientPedro, patientName: 'Pedro Almeida', status: 'COMPLETED', day: 5, hour: 13, duration: 45, actualDuration: 45, roomId: IDS.roomAba, roomName: 'Sala 1 - ABA', notes: 'sessao com assinatura pendente' }),
    appointmentRow({ id: IDS.apptReportPending, patientId: IDS.patientPedro, patientName: 'Pedro Almeida', status: 'COMPLETED', day: 6, hour: 12, duration: 45, actualDuration: 45, roomId: IDS.roomAba, roomName: 'Sala 1 - ABA', notes: 'sessao com relatorio pendente' }),
    appointmentRow({ id: IDS.apptDurationWarning, patientId: IDS.patientLia, patientName: 'Lia Martins', status: 'COMPLETED', day: 7, hour: 14, duration: 60, actualDuration: 35, roomId: IDS.roomMulti, roomName: 'Sala 2 - Multidisciplinar', notes: 'sessao com duracao divergente' }),
    appointmentRow({ id: IDS.apptReschedule, patientId: IDS.patientPedro, patientName: 'Pedro Almeida', status: 'RESCHEDULE_REQUESTED', day: 8, hour: 12, duration: 45, actualDuration: null, roomId: IDS.roomAba, roomName: 'Sala 1 - ABA', notes: 'responsavel solicitou remarcacao' }),
    appointmentRow({ id: IDS.apptCancelled, patientId: IDS.patientLia, patientName: 'Lia Martins', status: 'CANCELLED', day: 9, hour: 14, duration: 60, actualDuration: null, roomId: IDS.roomMulti, roomName: 'Sala 2 - Multidisciplinar', notes: 'sessão cancelada demo' })
  ];
  await upsertRows('appointments', appointments);

  await upsertRows('appointment_professionals', appointments.map((appointment) => ({
    id: crypto.randomUUID(),
    organization_id: IDS.clinic,
    clinic_id: IDS.clinic,
    appointment_id: appointment.id,
    professional_id: IDS.therapist,
    professional_name: 'Ana Ribeiro',
    role: 'therapist'
  })));

  const sessionRows = [
    { id: SESSION_IDS.ready, appointment_id: IDS.apptReady, patient_id: IDS.patientPedro, started_at: at(4, 12), ended_at: addMinutes(at(4, 12), 45), duration_minutes: 45, duration_seconds: 2700, notes: `${TAG} sessao pronta` },
    { id: SESSION_IDS.signaturePending, appointment_id: IDS.apptSignaturePending, patient_id: IDS.patientPedro, started_at: at(5, 13), ended_at: addMinutes(at(5, 13), 45), duration_minutes: 45, duration_seconds: 2700, notes: `${TAG} assinatura pendente` },
    { id: SESSION_IDS.reportPending, appointment_id: IDS.apptReportPending, patient_id: IDS.patientPedro, started_at: at(6, 12), ended_at: addMinutes(at(6, 12), 45), duration_minutes: 45, duration_seconds: 2700, notes: '' },
    { id: SESSION_IDS.durationWarning, appointment_id: IDS.apptDurationWarning, patient_id: IDS.patientLia, started_at: at(7, 14), ended_at: addMinutes(at(7, 14), 35), duration_minutes: 35, duration_seconds: 2100, notes: `${TAG} duracao divergente` }
  ].map((row) => ({
    ...row,
    clinic_id: IDS.clinic,
    organization_id: IDS.clinic,
    patient_name: row.patient_id === IDS.patientPedro ? 'Pedro Almeida' : 'Lia Martins',
    therapist_id: IDS.therapist,
    source: 'verto_demo_seed',
    status: 'completed',
    actual_start_at: row.started_at,
    actual_end_at: row.ended_at,
    actual_duration_minutes: row.duration_minutes,
    scheduled_start_at: row.started_at,
    scheduled_end_at: addMinutes(row.started_at, row.duration_minutes),
    scheduled_duration_minutes: row.duration_minutes,
    room_id: row.appointment_id === IDS.apptDurationWarning ? IDS.roomMulti : IDS.roomAba,
    room_name: row.appointment_id === IDS.apptDurationWarning ? 'Sala 2 - Multidisciplinar' : 'Sala 1 - ABA',
    location_type: 'clinica',
    record_count: 12,
    sync_status: 'synced',
    created_by: IDS.therapist,
    created_at: nowIso(),
    updated_at: nowIso()
  }));
  await upsertRows('aba_sessions', sessionRows);

  await upsertRows('aba_session_summaries', sessionRows.map((session) => ({
    id: `${session.id}-summary`,
    clinic_id: IDS.clinic,
    session_id: session.id,
    patient_id: session.patient_id,
    therapist_id: IDS.therapist,
    started_at: session.started_at,
    ended_at: session.ended_at,
    duration_seconds: session.duration_seconds,
    total_trials: 18,
    independent_trials: 12,
    prompted_trials: 4,
    error_trials: 2,
    accuracy_percent: 78,
    independence_percent: 67,
    total_behavior_events: 2,
    pending_items: session.id === SESSION_IDS.reportPending ? ['Relatorio pendente'] : [],
    session_note: session.id === SESSION_IDS.reportPending ? '' : `${TAG} resumo clinico ficticio preenchido para demonstracao.`,
    sync_status: 'synced',
    summary_payload: { demo: true, tag: TAG, sessionNote: session.id === SESSION_IDS.reportPending ? '' : 'Resumo demo preenchido.' },
    created_at: nowIso()
  })));

  await upsertRows('session_signatures', [{
    id: IDS.signatureReady,
    organization_id: IDS.clinic,
    patient_id: IDS.patientPedro,
    appointment_id: IDS.apptReady,
    aba_session_id: SESSION_IDS.ready,
    signed_by_user_id: IDS.responsible,
    signed_by_name: 'Mariana Almeida',
    signed_by_role: 'responsible',
    signature_type: 'DIGITAL_ACCEPTANCE',
    signature_hash: crypto.createHash('sha256').update(`${TAG}:signature-ready`).digest('hex'),
    ip_hash: crypto.createHash('sha256').update(`${TAG}:ip`).digest('hex'),
    user_agent_hash: crypto.createHash('sha256').update(`${TAG}:ua`).digest('hex'),
    consent_text_version: 'demo-v1',
    consent_text: 'Aceite digital ficticio para demonstracao.',
    signed_at: addMinutes(at(4, 12), 55),
    status: 'SIGNED',
    metadata: { demo: true, tag: TAG },
    created_at: nowIso(),
    updated_at: nowIso()
  }]);

  await upsertRows('appointment_action_requests', [{
    id: IDS.actionReschedule,
    organization_id: IDS.clinic,
    appointment_id: IDS.apptReschedule,
    patient_id: IDS.patientPedro,
    requested_by: IDS.responsible,
    request_type: 'RESCHEDULE',
    status: 'PENDING',
    requested_start: at(12, 12),
    requested_end: addMinutes(at(12, 12), 45),
    reason: `${TAG} responsavel pediu novo horario ficticio`,
    note: 'Preferencia por periodo da tarde.',
    created_at: nowIso(),
    updated_at: nowIso()
  }]);

  await upsertRows('appointment_billing_contexts', appointments.map((appointment) => ({
    id: crypto.randomUUID(),
    organization_id: IDS.clinic,
    appointment_id: appointment.id,
    patient_id: appointment.patient_id,
    payer_id: IDS.payer,
    payer_name_snapshot: 'Convenio Exemplo - DEMO Verto',
    service_type: 'ABA',
    authorization_code: appointment.id === IDS.apptReportPending ? null : 'AUTH-DEMO-001',
    guide_number: appointment.id === IDS.apptSignaturePending ? null : 'GUIA-DEMO-001',
    procedure_code: 'ABA-DEMO',
    notes: `${TAG} contexto operacional ficticio`,
    created_at: nowIso(),
    updated_at: nowIso()
  })), { onConflict: 'organization_id,appointment_id' });

  await upsertRows('appointment_required_documents', [
    {
      id: IDS.docGuidePending,
      organization_id: IDS.clinic,
      appointment_id: IDS.apptSignaturePending,
      patient_id: IDS.patientPedro,
      document_type: 'GUIDE',
      status: 'PENDING',
      required_by_payer_id: IDS.payer,
      required_for_service_type: 'ABA',
      created_at: nowIso(),
      updated_at: nowIso()
    },
    {
      id: IDS.docAuthPending,
      organization_id: IDS.clinic,
      appointment_id: IDS.apptReportPending,
      patient_id: IDS.patientPedro,
      document_type: 'AUTHORIZATION',
      status: 'PENDING',
      required_by_payer_id: IDS.payer,
      required_for_service_type: 'ABA',
      created_at: nowIso(),
      updated_at: nowIso()
    }
  ]);

  await upsertRows('appointment_status_audit_logs', [
    { id: crypto.randomUUID(), organization_id: IDS.clinic, appointment_id: IDS.apptReady, patient_id: IDS.patientPedro, action: 'CONFIRMED_BY_RESPONSIBLE', previous_status: 'SCHEDULED', new_status: 'CONFIRMED', performed_by: IDS.responsible, performed_by_role: 'responsible', metadata: { demo: true, tag: TAG } },
    { id: crypto.randomUUID(), organization_id: IDS.clinic, appointment_id: IDS.apptReady, patient_id: IDS.patientPedro, action: 'SIGNATURE_CREATED', previous_status: 'COMPLETED', new_status: 'COMPLETED', performed_by: IDS.responsible, performed_by_role: 'responsible', metadata: { demo: true, tag: TAG } },
    { id: crypto.randomUUID(), organization_id: IDS.clinic, appointment_id: IDS.apptReschedule, patient_id: IDS.patientPedro, action: 'RESCHEDULE_REQUESTED', previous_status: 'CONFIRMED', new_status: 'RESCHEDULE_REQUESTED', performed_by: IDS.responsible, performed_by_role: 'responsible', metadata: { demo: true, tag: TAG } }
  ]);

  const closureRows = [
    closureRow({ appointmentId: IDS.apptReady, sessionId: SESSION_IDS.ready, patientId: IDS.patientPedro, status: 'READY', scheduledStart: at(4, 12), minutes: 45, actualMinutes: 45, issues: [], checklist: closureChecklist({}) }),
    closureRow({ appointmentId: IDS.apptSignaturePending, sessionId: SESSION_IDS.signaturePending, patientId: IDS.patientPedro, status: 'PENDING', scheduledStart: at(5, 13), minutes: 45, actualMinutes: 45, issues: ['Assinatura pendente para fechamento da sessao.', 'Guia obrigatoria pendente.'], checklist: closureChecklist({ signature: false, guide: false }), docs: 1 }),
    closureRow({ appointmentId: IDS.apptReportPending, sessionId: SESSION_IDS.reportPending, patientId: IDS.patientPedro, status: 'PENDING', scheduledStart: at(6, 12), minutes: 45, actualMinutes: 45, issues: ['Relatorio da sessao ainda nao foi preenchido.', 'Autorizacao obrigatoria pendente.'], checklist: closureChecklist({ report: false, authorization: false }), docs: 1 }),
    closureRow({ appointmentId: IDS.apptDurationWarning, sessionId: SESSION_IDS.durationWarning, patientId: IDS.patientLia, status: 'WARNING', scheduledStart: at(7, 14), minutes: 60, actualMinutes: 35, issues: ['Duracao real divergente do planejado.'], checklist: closureChecklist({ duration: false }) }),
    closureRow({ appointmentId: IDS.apptCancelled, sessionId: null, patientId: IDS.patientLia, status: 'NOT_BILLABLE', scheduledStart: at(9, 14), minutes: 60, actualMinutes: null, issues: ['Sessão cancelada.'], checklist: [{ key: 'appointment_cancelled', label: 'Sessão cancelada', status: 'NOT_APPLICABLE' }] })
  ];
  await upsertRows('appointment_closure_checks', closureRows, { onConflict: 'organization_id,appointment_id' });

  await upsertRows('appointment_closure_audit_logs', [
    { id: crypto.randomUUID(), organization_id: IDS.clinic, appointment_id: IDS.apptReady, aba_session_id: SESSION_IDS.ready, patient_id: IDS.patientPedro, action: 'CHECK_GENERATED', previous_status: null, new_status: 'READY', performed_by: IDS.coordinator, metadata: { demo: true, tag: TAG } },
    { id: crypto.randomUUID(), organization_id: IDS.clinic, appointment_id: IDS.apptSignaturePending, aba_session_id: SESSION_IDS.signaturePending, patient_id: IDS.patientPedro, action: 'CHECK_GENERATED', previous_status: null, new_status: 'PENDING', performed_by: IDS.coordinator, metadata: { demo: true, tag: TAG } },
    { id: crypto.randomUUID(), organization_id: IDS.clinic, action: 'EXPORT_GENERATED', performed_by: IDS.coordinator, metadata: { demo: true, tag: TAG, exportType: 'sessions', rowCount: 5 } }
  ]);

  await upsertRows('operational_closure_exports', [{
    id: IDS.exportAudit,
    organization_id: IDS.clinic,
    export_type: 'sessions',
    filters: { demo: true, tag: TAG, from: at(1, 0), to: at(31, 23, 59) },
    generated_by: IDS.coordinator,
    generated_at: nowIso(),
    row_count: closureRows.length,
    status: 'GENERATED',
    metadata: { demo: true, tag: TAG }
  }]);

  console.log('\nDemo Simpli Saude criada com sucesso.');
  console.log(`Clinica: ${IDS.clinic} - Clinica Demo Verto`);
  console.log('Use uma conta real vinculada a clinica ou ajuste membership/auth conforme seu ambiente local.');
}

try {
  if (cleanupOnly) {
    await removeDemoData();
    console.log('\nDados demo Simpli Saude removidos.');
  } else {
    await seedDemoData();
  }
} catch (error) {
  console.error('[demo-seed] Falha:', error?.message || error);
  process.exit(1);
}
