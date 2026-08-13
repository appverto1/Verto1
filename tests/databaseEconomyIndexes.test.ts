import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20260813150000_database_economy_indexes.sql',
  'utf8',
);

assert.match(sql, /^\s*--[\s\S]*?\bbegin\s*;/i, 'a migration precisa ser atomica');
assert.match(sql, /\bcommit\s*;/i, 'a migration precisa concluir a transacao');
const migrationSetup = sql.slice(0, sql.indexOf('create or replace function public.apply_financial_series_update_v1'));
const setupWithoutTechnicalRetention = migrationSetup.replace(
  /create or replace function public\.cleanup_financial_series_mutation_requests_v1[\s\S]*?\n\$\$;/i,
  '',
);
assert.doesNotMatch(setupWithoutTechnicalRetention, /\b(update|insert|delete|truncate)\s+(?:from\s+|into\s+)?public\./i,
  'indices de economia nao podem reescrever dados de negocio');
assert.match(migrationSetup, /cleanup_financial_series_mutation_requests_v1[\s\S]*delete from public\.financial_series_mutation_requests/i,
  'o ledger tecnico de idempotencia precisa de retencao limitada');
assert.match(sql, /appointments_auto_no_show_due_idx[\s\S]*coalesce\(scheduled_start_at, scheduled_at\)/i,
  'o indice deve acompanhar a expressao usada pelo scanner de no-show');
const noShowIndexSetup = sql.slice(0, sql.indexOf('appointments_auto_no_show_due_idx'));
for (const column of [
  'id',
  'scheduled_start_at',
  'scheduled_at',
  'no_show_classified_at',
  'deleted_at',
  'is_active',
  'actual_start_at',
  'no_show_review_required_at',
  'active_aba_session_id',
  'status',
]) {
  assert.match(
    noShowIndexSetup,
    new RegExp(`table_name = 'appointments' and column_name = '${column}'`, 'i'),
    `o indice de no-show deve verificar a existencia de ${column} antes do DDL`,
  );
}
assert.match(sql, /school_consents_current_status_expiry_idx[\s\S]*organization_id, status, expires_at, patient_id/i);
assert.match(sql, /users_email_lookup_idx[\s\S]*public\.users \(email\)/i,
  'a resolucao canonica por email precisa de indice exato');
assert.match(sql, /school_meeting_participants_professional_active_idx/i);
assert.match(sql, /school_meetings_clinic_schedule_idx/i);
assert.match(sql, /professional_payments_recurrence_group_idx/i,
  'o batch de repasses precisa de contrato recorrente versionado e indexado');
assert.match(sql, /financial_series_mutation_requests/i,
  'retries de alteracao em lote precisam de ledger idempotente duravel');
assert.match(sql, /pg_advisory_xact_lock/i,
  'requisicoes concorrentes da mesma chave precisam ser serializadas');
assert.match(sql, /apply_financial_series_update_v1/i,
  'validacao, update e registro idempotente devem ocorrer na mesma transacao');
assert.match(sql, /p_row_ids text\[\]/i,
  'ids financeiros precisam respeitar o contrato legado text da producao');
assert.equal((sql.match(/target\.id::text = any\(p_row_ids\)/g) || []).length, 2,
  'payments e professional_payments precisam comparar ids sem operador uuid=text');
assert.match(sql, /get_patient_finance_ledger_children_v1\([\s\S]*p_organization_id uuid[\s\S]*p_payment_ids text\[\]/i,
  'os filhos do ledger precisam ser lidos em uma RPC tenant-scoped sem URL gigante');
for (const indexName of [
  'payment_appointment_items_ledger_read_idx',
  'payment_transactions_ledger_read_idx',
  'payment_audit_events_ledger_read_idx',
]) {
  assert.match(sql, new RegExp(indexName), `indice ausente: ${indexName}`);
}
const ledgerChildrenRpc = sql.slice(sql.indexOf('create or replace function public.get_patient_finance_ledger_children_v1'));
for (const table of ['payment_appointment_items', 'payment_transactions', 'payment_audit_events']) {
  assert.match(ledgerChildrenRpc, new RegExp(`from public\\.${table}`));
}
assert.equal(
  (ledgerChildrenRpc.match(/organization_id = p_organization_id/g) || []).length,
  3,
  'cada colecao filha precisa permanecer restrita ao tenant',
);
assert.equal(
  (ledgerChildrenRpc.match(/limit greatest\(1, least\(coalesce\(p_limit, 1000\), 1000\)\)/g) || []).length,
  3,
  'cada colecao deve ter limite global e fixo de 1000',
);
assert.doesNotMatch(ledgerChildrenRpc, /\n\s*tx\.(?:proof_url|receipt_url)\s*,/,
  'o ledger nao deve transferir binarios; apenas indicadores de existencia');
assert.match(ledgerChildrenRpc, /as has_proof/);
assert.match(ledgerChildrenRpc, /as has_receipt/);
assert.match(ledgerChildrenRpc, /revoke all on function public\.get_patient_finance_ledger_children_v1[\s\S]*authenticated/i,
  'a RPC security definer nao pode ser exposta ao navegador');
const legacyDueRpc = sql.slice(sql.indexOf('create or replace function public.get_legacy_due_appointments_v1'));
assert.match(legacyDueRpc, /jsonb_array_elements\(state_row\.appointments\)/,
  'o legado deve ser filtrado dentro do banco em vez de transferir blobs completos');
assert.match(legacyDueRpc, /scheduled_value >= p_window_start and scheduled_value < p_window_end/);
assert.match(legacyDueRpc, /scheduled_value is null and nullif\(trim\(appointment_row->>'scheduledAt'\)/,
  'scheduledAt valido deve sobreviver a scheduled_at vazio ou invalido');
assert.match(legacyDueRpc, /grant execute on function public\.get_legacy_due_appointments_v1[\s\S]*to service_role/i);
assert.match(legacyDueRpc, /revoke all on function public\.get_legacy_due_appointments_v1[\s\S]*authenticated/i,
  'o acesso ao espelho legado deve permanecer somente no backend');
const routeCapabilitiesRpc = sql.slice(sql.indexOf('create or replace function public.get_verto_route_schema_capabilities'));
assert.match(routeCapabilitiesRpc, /information_schema\.columns[\s\S]*table_name = 'tasks'/i,
  'o backend deve descobrir o contrato de tasks em uma leitura de capacidades');
assert.match(routeCapabilitiesRpc, /'patients'[\s\S]*table_name = 'patients'/i,
  'o catalogo compartilhado deve evitar adicionar um probe extra às listagens de pacientes');
for (const column of ['color', 'completed', 'is_daily_reminder', 'linked_task', 'scheduled_at', 'pro_score']) {
  assert.match(routeCapabilitiesRpc, new RegExp(`\\('${column}'`),
    `a capacidade de tasks precisa declarar ${column}`);
}
assert.match(routeCapabilitiesRpc, /revoke all on function public\.get_verto_route_schema_capabilities\(\)[\s\S]*authenticated/i,
  'o catalogo de schema deve permanecer somente no backend');
assert.match(routeCapabilitiesRpc, /grant execute on function public\.get_verto_route_schema_capabilities\(\)[\s\S]*to service_role/i);
assert.match(sql, /notify\s+pgrst\s*,\s*'reload schema'/i,
  'novas colunas precisam atualizar o cache de schema somente depois do commit');

console.log('databaseEconomyIndexes.test.ts: OK');
