import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runTissPipelineForAppointment,
  runTissPipelineForAppointments,
  tissPipelineSourceForReason
} from '../src/services/tissRevenuePipelineOrchestrator';

const appointmentId = '11111111-1111-4111-8111-111111111111';

test('pipeline traduz motivo operacional para source auditável', () => {
  assert.equal(tissPipelineSourceForReason('appointment_created'), 'tiss_pipeline_appointment_created');
  assert.equal(tissPipelineSourceForReason('appointment_updated'), 'tiss_pipeline_appointment_updated');
  assert.equal(tissPipelineSourceForReason('session_completed'), 'tiss_pipeline_session_completed');
  assert.equal(tissPipelineSourceForReason('authorization_changed'), 'tiss_pipeline_authorization_changed');
  assert.equal(tissPipelineSourceForReason('tuss_mapping_changed'), 'tiss_pipeline_tuss_mapping_changed');
  assert.equal(tissPipelineSourceForReason('price_changed'), 'tiss_pipeline_price_changed');
});

test('pipeline executa revalidação idempotente por appointment em best effort', async () => {
  const calls: any[] = [];
  const result = await runTissPipelineForAppointment({
    appointmentId,
    user: { id: 'user-1' },
    reason: 'appointment_created',
    mode: 'best_effort',
    overwriteExplicitContext: true,
    revalidateAppointment: async (params) => {
      calls.push(params);
      return { ok: true, tissPreGuideResult: { ok: true, status: 'valid' } };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'tiss_pipeline_appointment_created');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].appointmentId, appointmentId);
  assert.equal(calls[0].overwriteExplicitContext, true);
  assert.equal(calls[0].forceClosure, true);
});

test('best effort não quebra fluxo principal quando a revalidação falha', async () => {
  const warnings: any[] = [];
  const result = await runTissPipelineForAppointment({
    appointmentId,
    user: { id: 'user-1' },
    reason: 'session_completed',
    mode: 'best_effort',
    logger: { warn: (...args: any[]) => warnings.push(args) },
    revalidateAppointment: async () => {
      throw new Error('schema indisponível');
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.source, 'tiss_pipeline_session_completed');
  assert.match(String(result.error), /schema indisponível/);
  assert.equal(warnings.length, 1);
});

test('pipeline em lote deduplica appointments e limita concorrência', async () => {
  const calls: string[] = [];
  const results = await runTissPipelineForAppointments({
    appointmentIds: [appointmentId, appointmentId, '22222222-2222-4222-8222-222222222222'],
    user: { id: 'user-1' },
    reason: 'authorization_changed',
    concurrency: 1,
    revalidateAppointment: async ({ appointmentId }) => {
      calls.push(appointmentId);
      return { ok: true };
    }
  });

  assert.deepEqual(calls, [appointmentId, '22222222-2222-4222-8222-222222222222']);
  assert.equal(results.length, 2);
  assert.ok(results.every((item) => item.source === 'tiss_pipeline_authorization_changed'));
});
