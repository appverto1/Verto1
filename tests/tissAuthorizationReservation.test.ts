import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  checkCriticalSchema,
  classifyReservationSchemaProbe,
  isDeployEnvironment,
  TISS_AUTHORIZATION_RESERVATION_RPC,
  TISS_AUTHORIZATION_RESERVATION_SCHEMA_VERSION,
} from '../scripts/check-critical-schema.mjs';

const root = process.cwd();
const migrationCode = readFileSync(
  join(root, 'supabase/migrations/20260715120000_atomic_tiss_authorization_reservation.sql'),
  'utf8',
);
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const calendarCode = readFileSync(join(root, 'src/components/Calendar.tsx'), 'utf8');

function fakeClient(data: any, error: any = null) {
  return {
    rpc: async (name: string, payload: any) => {
      assert.equal(name, TISS_AUTHORIZATION_RESERVATION_RPC);
      assert.equal(payload.p_context.metadata.schema_probe, true);
      return { data, error };
    },
  } as any;
}

test('probe aceita somente a versao exata da RPC critica', async () => {
  const compatible = await checkCriticalSchema(fakeClient({
    compatible: true,
    schema_version: TISS_AUTHORIZATION_RESERVATION_SCHEMA_VERSION,
  }));
  assert.equal(compatible.compatible, true);

  const outdated = await checkCriticalSchema(fakeClient({ compatible: true, schema_version: 'legacy' }));
  assert.equal(outdated.compatible, false);
  assert.equal(outdated.reason, 'rpc_version_mismatch');
});

test('probe classifica RPC ausente, assinatura, permissao e versao antiga', async () => {
  assert.equal(classifyReservationSchemaProbe({ code: 'PGRST202' }).reason, 'rpc_missing_or_signature_mismatch');
  assert.equal(classifyReservationSchemaProbe({ code: '42883' }).reason, 'rpc_missing_or_signature_mismatch');
  assert.equal(
    classifyReservationSchemaProbe({
      code: '42501',
      message: 'permission denied for function reserve_tiss_authorization_billing_context',
    }).reason,
    'rpc_permission_mismatch',
  );
  assert.equal(classifyReservationSchemaProbe({ message: 'TISS_AUTHORIZATION_SCOPE_INVALID' }).reason, 'rpc_legacy_version');

  const missing = await checkCriticalSchema(fakeClient(null, { code: 'PGRST202' }));
  assert.equal(missing.compatible, false);
  assert.equal(missing.reason, 'rpc_missing_or_signature_mismatch');
});

test('ambientes de deploy exigem a verificacao de schema', () => {
  assert.equal(isDeployEnvironment({ NODE_ENV: 'production' } as any), true);
  assert.equal(isDeployEnvironment({ RAILWAY_ENVIRONMENT: 'production' } as any), true);
  assert.equal(isDeployEnvironment({ VERCEL_ENV: 'production' } as any), true);
  assert.equal(isDeployEnvironment({ NODE_ENV: 'development' } as any), false);

  assert.match(serverCode, /const isDeploy = isDeployEnvironment\(process\.env\)/);
  assert.match(serverCode, /if \(isDeploy\) await validateCriticalTissAuthorizationReservationSchema\(\)/);
  assert.match(serverCode, /const result = await checkCriticalSchema\(supabase\)/);
  assert.match(serverCode, /TISS_AUTHORIZATION_RESERVATION_SCHEMA_VERSION/);
});

test('migration e idempotente, aditiva e publica a assinatura esperada', () => {
  assert.match(migrationCode, /create index if not exists idx_appointment_billing_contexts_tiss_authorization/i);
  assert.match(migrationCode, /create index if not exists idx_appointment_tiss_pre_guides_authorization/i);
  assert.match(migrationCode, /create or replace function public\.reserve_tiss_authorization_billing_context/i);
  assert.match(migrationCode, /'schema_version', '20260715120000'/);
  assert.match(migrationCode, /notify pgrst, 'reload schema'/i);
  assert.doesNotMatch(migrationCode, /\bdrop\s+(table|column|function)\b/i);
  assert.doesNotMatch(migrationCode, /\btruncate\b/i);
});

test('reserva serializa por autorizacao e persiste contexto em uma transacao', () => {
  const authorizationLock = migrationCode.indexOf('from public.patient_payer_authorizations');
  const contextCount = migrationCode.indexOf('with commitment_candidates as');
  assert.ok(authorizationLock >= 0 && authorizationLock < contextCount);
  assert.match(migrationCode, /from public\.patient_payer_authorizations[\s\S]*for update/i);
  assert.match(migrationCode, /from public\.appointments[\s\S]*for update/i);
  assert.match(migrationCode, /from public\.appointment_billing_contexts context_row[\s\S]*for update/i);
  assert.match(migrationCode, /TISS_AUTHORIZATION_NO_AVAILABLE_BALANCE/);
  assert.match(migrationCode, /on conflict \(organization_id, appointment_id\) do update/i);
  assert.match(migrationCode, /'idempotent', v_idempotent/);
  assert.match(migrationCode, /expected_previous_authorization_id/);
});

test('RPC valida tenant, paciente, pagador, vigencia e procedimento', () => {
  assert.match(migrationCode, /organization_id = p_organization_id/);
  assert.match(migrationCode, /clinic_id = p_organization_id/);
  assert.match(migrationCode, /patient_id = p_patient_id/);
  assert.match(migrationCode, /TISS_AUTHORIZATION_PAYER_MISMATCH/);
  assert.match(migrationCode, /TISS_AUTHORIZATION_EXPIRED/);
  assert.match(migrationCode, /TISS_AUTHORIZATION_NOT_YET_VALID/);
  assert.match(migrationCode, /TISS_AUTHORIZATION_PROCEDURE_MISMATCH/);
  assert.match(migrationCode, /revoke all on function[\s\S]*from authenticated/i);
  assert.match(migrationCode, /grant execute on function[\s\S]*to service_role/i);
});

test('backend hidrata cadastro canonico e usa a RPC para autorizacao explicita', () => {
  const routeStart = serverCode.indexOf("app.patch('/api/appointments/:appointmentId/billing-context'");
  const routeEnd = serverCode.indexOf("app.post('/api/appointments/:appointmentId/required-documents", routeStart);
  const route = serverCode.slice(routeStart, routeEnd);
  assert.match(route, /authoritativeBillingSuggestion = effectiveFinancialContextType === 'INSURANCE'/);
  assert.match(route, /requestedInsuranceCardNumber \|\| sanitizeString\(authoritativeBillingSuggestion\?\.insuranceCardNumber/);
  assert.match(route, /requestedInsurancePlanName \|\| sanitizeString\(authoritativeBillingSuggestion\?\.insurancePlanName/);
  assert.match(route, /supabase\.rpc\('reserve_tiss_authorization_billing_context'/);
  assert.match(route, /TISS_AUTHORIZATION_RESERVATION_SCHEMA_UNAVAILABLE/);
  assert.match(route, /Nenhum dado da consulta foi alterado/);
  assert.match(route, /reservationIdempotent/);
  assert.match(route, /authorizationBalance/);
});

test('sugestao nao vira reserva e selecao explicita nao contorna a RPC', () => {
  const start = serverCode.indexOf('async function upsertInitialBillingContextFromAppointment');
  const end = serverCode.indexOf('async function syncAppointmentsTableFromClinicState', start);
  const initialContext = serverCode.slice(start, end);
  assert.match(initialContext, /requestedTissAuthorizationId/);
  assert.match(initialContext, /selectedTissAuthorization/);
  assert.match(initialContext, /patient_tiss_authorization_id: selectedTissAuthorization\?\.authorizationId/);
  assert.doesNotMatch(initialContext, /patient_tiss_authorization_id: suggestedTissAuthorization/);
  assert.match(initialContext, /if \(selectedTissAuthorization\?\.authorizationId\)[\s\S]*supabase\.rpc\('reserve_tiss_authorization_billing_context'/);
  assert.match(initialContext, /if \(requiresAtomicAuthorizationReservation\) throw error/);
});

test('modal mostra saldo numerico, preserva dados e bloqueia clique repetido', () => {
  assert.match(calendarCode, /billingSaveInFlightRef = useRef\(false\)/);
  assert.match(calendarCode, /if \(!appointmentId \|\| billingSaveInFlightRef\.current\) return false/);
  assert.match(calendarCode, /billingSaveInFlightRef\.current = true/);
  assert.match(calendarCode, /billingSaveInFlightRef\.current = false/);
  assert.match(calendarCode, /Os dados preenchidos foram preservados para uma nova tentativa/);
  assert.match(calendarCode, /Autorizadas/);
  assert.match(calendarCode, /Consumidas/);
  assert.match(calendarCode, /Reservadas/);
  assert.match(calendarCode, /Disponíveis/);
  assert.match(calendarCode, /Autorização aplicada/);
});
