import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildAppointmentClosureOperationalView,
  evaluateAppointmentClosureReadiness
} from '../src/services/closureReadinessEngine';

const now = '2026-05-28T12:00:00.000Z';

const baseInput = {
  organizationId: 'org-1',
  appointmentId: 'appt-1',
  abaSessionId: 'session-1',
  patientId: 'patient-1',
  now,
  appointment: {
    id: 'appt-1',
    patient_id: 'patient-1',
    therapist_id: 'professional-1',
    service_type: 'ABA',
    status: 'completed',
    scheduled_start_at: '2026-05-28T09:00:00.000Z',
    scheduled_end_at: '2026-05-28T09:45:00.000Z',
    scheduled_duration_minutes: 45,
    actual_start_at: '2026-05-28T09:00:00.000Z',
    actual_end_at: '2026-05-28T09:45:00.000Z',
    actual_duration_minutes: 45,
    payer_id: 'payer-amil',
    payer_name_snapshot: 'Amil',
    location_type: 'clinica',
    room_name: 'Sala 1',
    updated_at: '2026-05-28T10:00:00.000Z'
  },
  abaSession: {
    id: 'session-1',
    status: 'completed',
    therapist_id: 'professional-1',
    updated_at: '2026-05-28T10:00:00.000Z'
  },
  sessionSummary: {
    session_id: 'session-1',
    session_note: 'Evolução preenchida.',
    duration_seconds: 2700,
    updated_at: '2026-05-28T10:05:00.000Z'
  },
  signature: true,
  patient: { id: 'patient-1', insuranceType: 'particular' },
  professional: { id: 'professional-1' }
};

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('sessão concluída com tudo presente vira READY', () => {
  const result = evaluateAppointmentClosureReadiness(baseInput);
  assert.equal(result.readinessStatus, 'READY');
  assert.equal(result.blockingIssuesCount, 0);
  const payerCheck = result.checklist.find((item) => item.key === 'payer_linked');
  assert.equal(payerCheck?.status, 'PASSED');
  assert.equal(payerCheck?.evidence?.present, true);
});

test('sem assinatura obrigatória vira PENDING', () => {
  const result = evaluateAppointmentClosureReadiness({ ...baseInput, signature: false });
  assert.equal(result.readinessStatus, 'PENDING');
  assert.ok(result.summary.mainIssues.some((message) => message.includes('Assinatura')));
});

test('sem relatório obrigatório vira PENDING', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    sessionSummary: { ...baseInput.sessionSummary, session_note: '' }
  });
  assert.equal(result.readinessStatus, 'PENDING');
  assert.ok(result.checklist.some((item) => item.key === 'report_present' && item.status === 'FAILED'));
});

test('duração real abaixo do planejado vira WARNING', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: {
      ...baseInput.appointment,
      actual_end_at: '2026-05-28T09:32:00.000Z',
      actual_duration_minutes: 32
    }
  });
  assert.equal(result.readinessStatus, 'WARNING');
  assert.ok(result.warningIssuesCount > 0);
});

test('cancelada vira NOT_BILLABLE', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: { ...baseInput.appointment, status: 'canceled' }
  });
  assert.equal(result.readinessStatus, 'NOT_BILLABLE');
});

test('futura vira DRAFT', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: {
      ...baseInput.appointment,
      status: 'scheduled',
      scheduled_start_at: '2026-05-29T09:00:00.000Z',
      scheduled_end_at: '2026-05-29T09:45:00.000Z',
      actual_start_at: null,
      actual_end_at: null,
      actual_duration_minutes: null
    },
    abaSession: null,
    sessionSummary: null,
    signature: null
  });
  assert.equal(result.readinessStatus, 'DRAFT');
  assert.equal(result.phase, 'scheduled_pre_session');
  assert.equal(result.phaseSummary.message, 'Pronto para receber o paciente.');
  assert.equal(result.blockingIssuesCount, 0);
  assert.equal(
    result.checklist.find((item) => item.key === 'report_present')?.operationalStatus,
    'future_check'
  );
  assert.equal(
    result.checklist.find((item) => item.key === 'signature_present')?.operationalStatus,
    'future_check'
  );
  assert.equal(
    result.checklist.find((item) => item.key === 'actual_duration_registered')?.operationalStatus,
    'future_check'
  );
});

test('futura sem autorização exigida mostra apenas pendência pré-sessão acionável', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: {
      ...baseInput.appointment,
      status: 'scheduled',
      scheduled_start_at: '2026-05-29T09:00:00.000Z',
      scheduled_end_at: '2026-05-29T09:45:00.000Z',
      actual_start_at: null,
      actual_end_at: null,
      actual_duration_minutes: null,
      authorization_code: ''
    },
    abaSession: null,
    sessionSummary: null,
    signature: null,
    requirements: {
      requireAuthorization: true
    }
  });
  const authorization = result.checklist.find((item) => item.key === 'payer_authorization_required');
  assert.equal(result.phase, 'scheduled_pre_session');
  assert.equal(result.blockingIssuesCount, 1);
  assert.equal(authorization?.section, 'preSession');
  assert.equal(authorization?.operationalStatus, 'blocking_now');
  assert.equal(authorization?.message, 'Autorização do convênio pendente para esta consulta.');
  assert.ok(result.summary.mainIssues.includes('Autorização do convênio pendente para esta consulta.'));
  assert.ok(!result.summary.mainIssues.some((message) => /relatório|assinatura|duração real/i.test(message)));
});

test('guia exigida para Pré-guia não vira ruído antes da sessão', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: {
      ...baseInput.appointment,
      status: 'scheduled',
      scheduled_start_at: '2026-05-29T09:00:00.000Z',
      scheduled_end_at: '2026-05-29T09:45:00.000Z',
      actual_start_at: null,
      actual_end_at: null,
      actual_duration_minutes: null,
      guide_number: ''
    },
    abaSession: null,
    sessionSummary: null,
    signature: null,
    requirements: {
      requireGuide: true
    }
  });
  const guide = result.checklist.find((item) => item.key === 'payer_guide_required');
  assert.equal(guide?.section, 'tissBilling');
  assert.equal(guide?.operationalStatus, 'future_check');
  assert.equal(guide?.message, 'Guia será conferida na Pré-guia TISS após a sessão.');
  assert.equal(result.blockingIssuesCount, 0);
});

test('guia configurada como obrigatória antes da sessão vira pendência pré-sessão', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: {
      ...baseInput.appointment,
      status: 'scheduled',
      scheduled_start_at: '2026-05-29T09:00:00.000Z',
      scheduled_end_at: '2026-05-29T09:45:00.000Z',
      actual_start_at: null,
      actual_end_at: null,
      actual_duration_minutes: null,
      guide_number: ''
    },
    abaSession: null,
    sessionSummary: null,
    signature: null,
    requirements: {
      requireGuide: true,
      requireGuideBeforeSession: true
    }
  });
  const guide = result.checklist.find((item) => item.key === 'payer_guide_required');
  assert.equal(guide?.section, 'preSession');
  assert.equal(guide?.operationalStatus, 'blocking_now');
  assert.equal(guide?.message, 'Número da guia pendente antes do atendimento.');
  assert.equal(result.blockingIssuesCount, 1);
});

test('guia preenchida não aprova autorização pendente', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: {
      ...baseInput.appointment,
      status: 'scheduled',
      scheduled_start_at: '2026-05-29T09:00:00.000Z',
      scheduled_end_at: '2026-05-29T09:45:00.000Z',
      actual_start_at: null,
      actual_end_at: null,
      actual_duration_minutes: null,
      authorization_code: '',
      guide_number: 'GUIA-123'
    },
    abaSession: null,
    sessionSummary: null,
    signature: null,
    requirements: {
      requireAuthorization: true,
      requireGuide: true
    }
  });
  const authorization = result.checklist.find((item) => item.key === 'payer_authorization_required');
  const guide = result.checklist.find((item) => item.key === 'payer_guide_required');
  assert.equal(authorization?.status, 'FAILED');
  assert.equal(authorization?.operationalStatus, 'blocking_now');
  assert.equal(guide?.status, 'PASSED');
  assert.equal(guide?.operationalStatus, 'passed');
  assert.equal(result.blockingIssuesCount, 1);
  assert.ok(result.sections.tissBilling.some((item) => item.key === 'payer_authorization_required' && item.status === 'FAILED'));
  assert.ok(result.sections.tissBilling.some((item) => item.key === 'payer_guide_required' && item.status === 'PASSED'));
  assert.ok(!result.checklist.some((item) => item.key === 'authorization_linked'));
});

test('autorização preenchida não aprova guia pendente', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: {
      ...baseInput.appointment,
      status: 'scheduled',
      scheduled_start_at: '2026-05-29T09:00:00.000Z',
      scheduled_end_at: '2026-05-29T09:45:00.000Z',
      actual_start_at: null,
      actual_end_at: null,
      actual_duration_minutes: null,
      authorization_code: 'AUT-456',
      guide_number: ''
    },
    abaSession: null,
    sessionSummary: null,
    signature: null,
    requirements: {
      requireAuthorization: true,
      requireGuide: true
    }
  });
  const authorization = result.checklist.find((item) => item.key === 'payer_authorization_required');
  const guide = result.checklist.find((item) => item.key === 'payer_guide_required');
  assert.equal(authorization?.status, 'PASSED');
  assert.equal(authorization?.operationalStatus, 'passed');
  assert.equal(guide?.status, 'FAILED');
  assert.equal(guide?.operationalStatus, 'future_check');
  assert.equal(result.blockingIssuesCount, 0);
});

test('guia e autorização preenchidas são aprovadas separadamente', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: {
      ...baseInput.appointment,
      authorization_number: 'AUT-789',
      tiss_guide_number: 'GUIA-789'
    },
    requirements: {
      requireAuthorization: true,
      requireGuide: true
    }
  });
  assert.equal(result.checklist.find((item) => item.key === 'payer_authorization_required')?.status, 'PASSED');
  assert.equal(result.checklist.find((item) => item.key === 'payer_guide_required')?.status, 'PASSED');
  assert.ok(!result.checklist.some((item) => item.key === 'authorization_linked'));
});

test('guia e autorização ausentes permanecem itens independentes', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: {
      ...baseInput.appointment,
      status: 'scheduled',
      scheduled_start_at: '2026-05-29T09:00:00.000Z',
      scheduled_end_at: '2026-05-29T09:45:00.000Z',
      actual_start_at: null,
      actual_end_at: null,
      actual_duration_minutes: null,
      authorization_code: '',
      guide_number: ''
    },
    abaSession: null,
    sessionSummary: null,
    signature: null,
    requirements: {
      requireAuthorization: true,
      requireGuide: true
    }
  });
  const authorization = result.checklist.find((item) => item.key === 'payer_authorization_required');
  const guide = result.checklist.find((item) => item.key === 'payer_guide_required');
  assert.equal(authorization?.operationalStatus, 'blocking_now');
  assert.equal(guide?.operationalStatus, 'future_check');
  assert.equal(result.blockingIssuesCount, 1);
  assert.ok(!result.checklist.some((item) => /Guia\/autorização vinculada/i.test(item.label)));
});

test('sessão em aberto não conta relatório assinatura ou duração como pendência', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: {
      ...baseInput.appointment,
      status: 'in_progress',
      actual_start_at: '2026-05-28T11:50:00.000Z',
      actual_end_at: null,
      actual_duration_minutes: null
    },
    abaSession: { ...baseInput.abaSession, status: 'active' },
    sessionSummary: null,
    signature: null
  });
  assert.equal(result.phase, 'in_session');
  assert.equal(result.phaseSummary.title, 'Sessão em aberto');
  assert.equal(result.blockingIssuesCount, 0);
  for (const key of ['report_present', 'signature_present', 'actual_duration_registered']) {
    assert.equal(result.checklist.find((item) => item.key === key)?.operationalStatus, 'future_check');
  }
});

test('sessão concluída avalia fechamento e depois separa bloqueios TISS', () => {
  const pendingClosure = evaluateAppointmentClosureReadiness({
    ...baseInput,
    sessionSummary: { ...baseInput.sessionSummary, session_note: '' },
    signature: false
  });
  assert.equal(pendingClosure.phase, 'completed_pending_closure');
  assert.ok(pendingClosure.sections.postSession.some((item) => item.key === 'report_present' && item.operationalStatus === 'blocking_now'));

  const pendingTiss = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: { ...baseInput.appointment, guide_number: '' },
    requirements: { requireGuide: true }
  });
  assert.equal(pendingTiss.phase, 'prefacturing_blocked');
  assert.equal(pendingTiss.phaseSummary.title, 'Faturamento TISS');
  assert.ok(pendingTiss.sections.tissBilling.some((item) => item.key === 'payer_guide_required' && item.operationalStatus === 'blocking_now'));
});

test('consulta cancelada tem prioridade e não expõe fechamento ou faturamento', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: {
      ...baseInput.appointment,
      status: 'cancelled'
    }
  });
  assert.equal(result.phase, 'cancelled');
  assert.equal(result.readinessStatus, 'NOT_BILLABLE');
  assert.equal(result.phaseSummary.title, 'Consulta cancelada');
  assert.equal(result.phaseSummary.actionableCount, 0);
  assert.deepEqual(result.sections.preSession, []);
  assert.deepEqual(result.sections.postSession, []);
  assert.deepEqual(result.sections.tissBilling, []);

  const legacyView = buildAppointmentClosureOperationalView(result.checklist, 'cancelled');
  assert.equal(legacyView.phase, 'cancelled');
  assert.deepEqual(legacyView.sections.postSession, []);
  assert.deepEqual(legacyView.sections.tissBilling, []);
});

test('checklist legado é classificado em memória sem exigir escrita no GET', () => {
  const view = buildAppointmentClosureOperationalView([
    {
      key: 'report_present',
      label: 'Relatório/evolução presente',
      status: 'FAILED',
      required: true,
      severity: 'CRITICAL',
      message: 'Relatório pendente.',
      evidence: {}
    },
    {
      key: 'professional_linked',
      label: 'Profissional vinculado',
      status: 'PASSED',
      required: true,
      severity: 'HIGH',
      message: 'Profissional vinculado.',
      evidence: {}
    }
  ], 'scheduled_pre_session');
  assert.equal(view.phase, 'scheduled_pre_session');
  assert.equal(view.sections.postSession[0]?.operationalStatus, 'future_check');
  assert.equal(view.phaseSummary.actionableCount, 0);
});

test('sem profissional vira PENDING', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: { ...baseInput.appointment, therapist_id: null },
    abaSession: { ...baseInput.abaSession, therapist_id: null },
    professional: null
  });
  assert.equal(result.readinessStatus, 'PENDING');
});

test('registro profissional válido do responsável satisfaz exigência do pagador', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    professional: {
      id: 'professional-1',
      name: 'Terapeuta Mateus',
      council_number: '12/3456'
    },
    requirements: {
      requireProfessionalRegistry: true
    }
  });
  const registryCheck = result.checklist.find(
    (item) => item.key === 'payer_professional_registry',
  );
  assert.equal(registryCheck?.status, 'PASSED');
  assert.equal(registryCheck?.message, 'Registro profissional presente.');
});

test('registro ausente identifica o profissional responsável real', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    professional: {
      id: 'professional-1',
      name: 'Terapeuta Mateus'
    },
    requirements: {
      requireProfessionalRegistry: true
    }
  });
  const registryCheck = result.checklist.find(
    (item) => item.key === 'payer_professional_registry',
  );
  assert.equal(registryCheck?.status, 'FAILED');
  assert.equal(
    registryCheck?.message,
    'O profissional responsável Terapeuta Mateus precisa ter registro profissional cadastrado para este pagador.',
  );
});

test('profissional ausente gera pendência específica sem usar Equipe', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: { ...baseInput.appointment, therapist_id: null },
    abaSession: { ...baseInput.abaSession, therapist_id: null },
    professional: null,
    requirements: {
      requireProfessionalRegistry: true
    }
  });
  const registryCheck = result.checklist.find(
    (item) => item.key === 'payer_professional_registry',
  );
  assert.equal(
    registryCheck?.message,
    'Defina um profissional responsável para validar o registro exigido pelo pagador.',
  );
  assert.doesNotMatch(String(registryCheck?.message || ''), /Equipe/);
});

test('sem paciente não passa como READY', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    patientId: null,
    appointment: { ...baseInput.appointment, patient_id: null },
    abaSession: { ...baseInput.abaSession, patient_id: null },
    patient: null
  });
  assert.notEqual(result.readinessStatus, 'READY');
});

test('payer_id real é a única verdade para convênio vinculado', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: { ...baseInput.appointment, payer_id: 'payer-real', payer_name_snapshot: 'Amil' },
    requirements: { payerId: 'payer-real', payerName: 'Amil' }
  });
  const payerCheck = result.checklist.find((item) => item.key === 'payer_linked');
  assert.equal(payerCheck?.status, 'PASSED');
  assert.equal(payerCheck?.message, 'Pagador Amil aplicado ao atendimento.');
  assert.equal(payerCheck?.evidence?.present, true);
  assert.equal(payerCheck?.evidence?.suggested, false);
});

test('billing aplicado com autorização TISS vigente alinha pagador guia e autorização no checklist', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: {
      ...baseInput.appointment,
      status: 'scheduled',
      scheduled_start_at: '2026-06-26T12:00:00.000Z',
      scheduled_end_at: '2026-06-26T12:30:00.000Z',
      actual_start_at: null,
      actual_end_at: null,
      actual_duration_minutes: null,
      payer_id: 'payer-amil',
      payer_name_snapshot: 'Amil',
      insurance_plan_name: 'Platinum',
      insurance_card_number: '123456789',
      guide_number: '12345679',
      authorization_code: '123456789',
      patient_tiss_authorization_id: 'auth-tiss-1'
    },
    abaSession: null,
    sessionSummary: null,
    signature: null,
    requirements: {
      payerId: 'payer-amil',
      payerName: 'Amil',
      requireAuthorization: true,
      requireGuide: true
    }
  });
  const payerCheck = result.checklist.find((item) => item.key === 'payer_linked');
  const authorization = result.checklist.find((item) => item.key === 'payer_authorization_required');
  const guide = result.checklist.find((item) => item.key === 'payer_guide_required');
  assert.equal(payerCheck?.status, 'PASSED');
  assert.equal(payerCheck?.message, 'Pagador Amil aplicado ao atendimento.');
  assert.equal(payerCheck?.evidence?.present, true);
  assert.equal(payerCheck?.evidence?.suggested, false);
  assert.doesNotMatch(String(payerCheck?.message || ''), /Ainda não aplicado/);
  assert.equal(authorization?.status, 'PASSED');
  assert.equal(authorization?.message, 'Autorização 123456789 informada.');
  assert.equal(authorization?.evidence?.authorizationCode, '123456789');
  assert.equal(guide?.status, 'PASSED');
  assert.equal(guide?.message, 'Guia 12345679 informada.');
  assert.equal(guide?.evidence?.guideNumber, '12345679');
  assert.equal(result.sections.preSession.some((item) => item.key === 'payer_linked' && item.operationalStatus !== 'passed'), false);
});

test('pagador sugerido pelo plano financeiro não vira convênio vinculado', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: { ...baseInput.appointment, payer_id: null, payer_name_snapshot: 'Amil' },
    requirements: { payerName: 'Amil' }
  });
  const payerCheck = result.checklist.find((item) => item.key === 'payer_linked');
  assert.equal(result.readinessStatus, 'PENDING');
  assert.equal(payerCheck?.status, 'FAILED');
  assert.equal(payerCheck?.message, 'Pagador sugerido pelo plano financeiro: Amil. Ainda não aplicado ao atendimento.');
  assert.equal(payerCheck?.evidence?.present, false);
  assert.equal(payerCheck?.evidence?.suggested, true);
  assert.equal(payerCheck?.evidence?.suggestedPayerName, 'Amil');
});

test('sem payer_id e sem sugestão mantém convênio pendente sem fallback visual', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: { ...baseInput.appointment, payer_id: null, payer_name_snapshot: null },
    requirements: {}
  });
  const payerCheck = result.checklist.find((item) => item.key === 'payer_linked');
  assert.equal(result.readinessStatus, 'PENDING');
  assert.equal(payerCheck?.status, 'FAILED');
  assert.equal(payerCheck?.message, 'Pagador não configurado para esta conferência.');
  assert.equal(payerCheck?.evidence?.present, false);
  assert.equal(payerCheck?.evidence?.suggested, false);
});

test('contexto particular explicito satisfaz checklist sem payer_id', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: {
      ...baseInput.appointment,
      payer_id: null,
      payer_name_snapshot: null,
      payer_type: 'PRIVATE',
      financial_context_type: 'PRIVATE'
    },
    requirements: {}
  });
  const payerCheck = result.checklist.find((item) => item.key === 'payer_linked');
  assert.equal(result.readinessStatus, 'READY');
  assert.equal(payerCheck?.status, 'PASSED');
  assert.equal(payerCheck?.required, false);
  assert.equal(payerCheck?.evidence?.present, true);
  assert.equal(payerCheck?.evidence?.financialContextType, 'PRIVATE');
});

test('sem cobrança explicito vira não faturável sem exigir payer_id', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: {
      ...baseInput.appointment,
      payer_id: null,
      payer_name_snapshot: null,
      payer_type: 'NO_CHARGE',
      financial_context_type: 'NO_CHARGE'
    },
    requirements: {}
  });
  const payerCheck = result.checklist.find((item) => item.key === 'payer_linked');
  assert.equal(result.readinessStatus, 'NOT_BILLABLE');
  assert.equal(payerCheck?.status, 'PASSED');
  assert.equal(payerCheck?.evidence?.financialContextType, 'NO_CHARGE');
});

test('context hash evita recalcular sem mudança', () => {
  const first = evaluateAppointmentClosureReadiness(baseInput);
  const second = evaluateAppointmentClosureReadiness({ ...baseInput });
  const changed = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: { ...baseInput.appointment, updated_at: '2026-05-28T10:20:00.000Z' }
  });
  assert.equal(first.contextHash, second.contextHash);
  assert.notEqual(first.contextHash, changed.contextHash);
});

test('arquivos críticos não usam select star no módulo de fechamento', () => {
  const root = process.cwd();
  const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
  assert.doesNotMatch(serverCode, /\/api\/closure[\s\S]{0,9000}\.select\('\*'\)/);
});

let passed = 0;
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
    console.log(`ok - ${item.name}`);
  } catch (error) {
    console.error(`not ok - ${item.name}`);
    throw error;
  }
}

console.log(`${passed}/${tests.length} closure readiness tests passed`);
