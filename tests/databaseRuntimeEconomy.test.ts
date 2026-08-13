import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findPushSubscriptionsForRecipients } from '../services/pushNotificationService';

const cronSource = readFileSync('services/cronService.ts', 'utf8');
const pushSource = readFileSync('services/pushNotificationService.ts', 'utf8');
const serverSource = readFileSync('server.ts', 'utf8');
const coordinatorSource = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');

const runtimeSourceFiles = (root: string): string[] => readdirSync(root).flatMap((entry) => {
  const file = join(root, entry);
  if (statSync(file).isDirectory()) return runtimeSourceFiles(file);
  return /\.(?:ts|tsx|js|mjs)$/.test(file) ? [file] : [];
});

for (const file of ['server.ts', ...runtimeSourceFiles('services'), ...runtimeSourceFiles('src')]) {
  const source = readFileSync(file, 'utf8');
  assert.doesNotMatch(
    source,
    /\.select\(\s*(['"])\*\1\s*\)/,
    `${file} voltou a buscar todas as colunas em uma leitura de runtime.`,
  );
}

const section = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `inicio ausente: ${start}`);
  assert.ok(endIndex > startIndex, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

// A tabela canonica e consultada uma vez. Durante a transicao sem perda, o
// legado tambem e consultado, mas por uma RPC que devolve somente a janela e
// nao transfere o JSON historico inteiro de cada clinica.
const reminderLoad = section(
  cronSource,
  'async function fetchReminderAppointments(',
  'async function persistPortalReminder(',
);
assert.match(reminderLoad, /const tableResult = await fetchAppointmentsTable\(/);
assert.match(reminderLoad, /const clinicAppointments = await fetchClinicStateAppointments\(/);
assert.doesNotMatch(reminderLoad, /if \(tableAppointments\.size === 0\)[\s\S]*fetchClinicStateAppointments/);
assert.equal((reminderLoad.match(/fetchClinicStateAppointments\(/g) || []).length, 1);
const legacyReminderLoader = section(
  cronSource,
  'async function fetchClinicStateAppointments(',
  'async function hydrateReminderAppointmentPatients(',
);
assert.match(legacyReminderLoader, /rpc\('get_legacy_due_appointments_v1'/);
assert.match(legacyReminderLoader, /p_window_start: queryScheduledStartUtc\.toISOString\(\)/);
assert.match(legacyReminderLoader, /p_window_end: queryScheduledEndUtc\.toISOString\(\)/);
assert.match(legacyReminderLoader, /p_after_clinic_id: afterClinicId/);
assert.match(legacyReminderLoader, /p_after_ordinality: afterOrdinality/);
assert.match(legacyReminderLoader, /for \(let page = 0; page < maxPages; page \+= 1\)/,
  'o espelho legado precisa paginar para nao perder lembretes alem do primeiro lote');
assert.match(legacyReminderLoader, /seenCursors\.has\(cursorKey\)/,
  'cursor repetido precisa interromper a paginacao de forma controlada');
assert.match(legacyReminderLoader, /RPC legado compacto indisponivel; usando leitura compativel/);
assert.match(legacyReminderLoader, /\.range\(from, from \+ pageSize - 1\)/,
  'o fallback de rolling deploy tambem precisa paginar clinic_state');
assert.match(legacyReminderLoader, /const legacyBlobFallbackMaxPages = 4/,
  'falha da RPC compacta nao pode liberar uma varredura ilimitada de blobs historicos');
const reminderPatientHydration = section(
  cronSource,
  'async function hydrateReminderAppointmentPatients(',
  'async function fetchReminderAppointments(',
);
assert.match(reminderPatientHydration, /patientIdsToHydrate\.length; index \+= 100/,
  'ids de pacientes precisam ser divididos para nao estourar a URL do PostgREST');
assert.match(reminderPatientHydration, /patientChunks\.slice\(index, index \+ 4\)/,
  'a hidratacao deve usar concorrencia limitada em vez de fan-out irrestrito');

// O cron resolve as subscriptions antes do loop de envio e passa o lote pronto
// para que cada consulta nao repita queries de patient/user/email.
const reminderJob = section(
  cronSource,
  'async function runAppointmentReminderJob(',
  'export function startAppointmentReminderCron(',
);
const preloadIndex = reminderJob.indexOf('findPushSubscriptionsForRecipients({');
const sendLoopIndex = reminderJob.indexOf('for (const { appointment, dueReminder, dedupeKey } of dueAppointments)');
assert.ok(preloadIndex >= 0 && sendLoopIndex > preloadIndex);
assert.match(reminderJob, /preloadedSubscriptions: subscriptionBatch\.complete/);
assert.match(reminderJob, /try \{[\s\S]*findPushSubscriptionsForRecipients\([\s\S]*catch \(subscriptionError/,
  'falha no preload precisa preservar o lookup individual e o retry dos lembretes');
assert.match(pushSource, /params\.preloadedSubscriptions !== undefined[\s\S]*findPushSubscriptionsForPatient/);

// A distribuicao do lote preserva prioridade patient_id -> user_id -> email,
// tenant no fallback por email e compatibilidade case-insensitive historica.
const clinicId = '10000000-0000-4000-8000-000000000001';
const patientA = '10000000-0000-4000-8000-000000000002';
const patientB = '10000000-0000-4000-8000-000000000003';
const patientC = '10000000-0000-4000-8000-000000000004';
const calls: Array<{ operation: string; column?: string; values?: string[]; filter?: string }> = [];

class PushQueryMock {
  private operation = '';
  private column = '';

  select() {
    return this;
  }

  in(column: string, values: string[]) {
    this.operation = 'in';
    this.column = column;
    calls.push({ operation: 'in', column, values: [...values] });
    return this;
  }

  or(filter: string) {
    this.operation = 'or';
    calls.push({ operation: 'or', filter });
    return this;
  }

  limit() {
    return this;
  }

  order() {
    return this;
  }

  range() {
    return this;
  }

  then(resolve: (value: any) => void) {
    const base = { p256dh: 'key', auth: 'auth', clinic_id: clinicId };
    if (this.operation === 'in' && this.column === 'patient_id') {
      return resolve({ data: [{ ...base, endpoint: 'https://push/a', patient_id: patientA }], error: null });
    }
    if (this.operation === 'in' && this.column === 'user_id') {
      return resolve({ data: [{ ...base, endpoint: 'https://push/b', user_id: patientB }], error: null });
    }
    if (this.operation === 'or') {
      return resolve({
        data: [{ ...base, endpoint: 'https://push/c', user_email: 'PACIENTE.C@EXAMPLE.COM' }],
        error: null,
      });
    }
    return resolve({ data: [], error: null });
  }
}

const batch = await findPushSubscriptionsForRecipients({
  supabase: {
    from(table: string) {
      assert.equal(table, 'push_subscriptions');
      return new PushQueryMock();
    },
  },
  recipients: [
    { key: 'a', patientIds: [patientA], clinicId },
    { key: 'b', patientIds: [patientB], clinicId },
    { key: 'c', patientIds: [patientC], patientEmail: 'paciente.c@example.com', clinicId },
  ],
});
assert.match(pushSource, /\.range\(from, from \+ 499\)/,
  'subscriptions em lote precisam paginar para nao truncar destinatarios');
assert.equal(batch.complete, true);
assert.equal(batch.subscriptionsByRecipientKey.get('a')?.[0]?.subscription.endpoint, 'https://push/a');
assert.equal(batch.subscriptionsByRecipientKey.get('b')?.[0]?.subscription.endpoint, 'https://push/b');
assert.equal(batch.subscriptionsByRecipientKey.get('c')?.[0]?.subscription.endpoint, 'https://push/c');
assert.deepEqual(calls.map((call) => call.column || call.operation), ['patient_id', 'user_id', 'or']);
assert.match(calls[2]?.filter || '', /user_email\.ilike\./);

// Listagens assinam caminhos em lote por bucket. Assinaturas unitarias ficam
// restritas a operacoes pontuais de escrita/download e nao ao GET da lista.
const legacyFiles = section(
  serverSource,
  'const buildPatientFilesFromPayload = async',
  "app.get('/api/patient-files/:patientId'",
);
const patientFilesRoute = section(
  serverSource,
  "app.get('/api/patient-files/:patientId'",
  "app.post('/api/patient-files/:patientId'",
);
for (const source of [legacyFiles, patientFilesRoute]) {
  assert.match(source, /\.createSignedUrls\(/);
  assert.doesNotMatch(source, /\.createSignedUrl\(/);
}

// O ledger le primeiro as cobrancas visiveis e busca todos os filhos em uma
// unica RPC tenant-scoped. O limite global nao depende de chunks e os IDs nao
// sao enviados pela URL do PostgREST.
const ledgerRoute = section(
  serverSource,
  "app.get('/api/patient-finance/ledger'",
  "app.post('/api/patient-finance/charges'",
);
assert.match(ledgerRoute, /const chargesResult = await supabase[\s\S]*const visibleChargeIds/);
assert.match(ledgerRoute, /\.rpc\('get_patient_finance_ledger_children_v1',[\s\S]*p_organization_id: organizationId/);
assert.match(ledgerRoute, /p_payment_ids: visibleChargeIds/);
assert.match(ledgerRoute, /p_limit: 1000/);
assert.doesNotMatch(ledgerRoute, /chargeIdChunks|readLedgerRowsForChargeIds|\.in\('payment_id'/,
  'o custo do ledger nao pode crescer por chunk nem serializar centenas de IDs na URL');
assert.match(ledgerRoute, /visibleChargeIds\.length > 0[\s\S]*emptyRelatedResult\(\)/);
assert.match(ledgerRoute, /\(visibleChargeIds\.length > 0 \? 1 : 0\)/,
  'o contador diagnostico deve contabilizar uma unica leitura dos filhos');
assert.doesNotMatch(ledgerRoute, /PATIENT_FINANCE_TRANSACTION_SELECT[\s\S]*proof_url/,
  'a listagem do ledger nao pode transportar comprovantes inline');

const financeDocumentRoute = section(
  serverSource,
  "app.get('/api/patient-finance/transactions/:transactionId/document'",
  "app.post('/api/patient-finance/charges'",
);
assert.match(financeDocumentRoute, /requireClinicCapability\('finance\.payments\.view'\)/);
assert.match(financeDocumentRoute, /\.eq\('organization_id', organizationId\)/,
  'o documento sob demanda deve continuar isolado pelo tenant da sessao');
assert.match(financeDocumentRoute, /\.select\('id,organization_id,proof_url/,
  'o binario so deve ser lido no endpoint pontual');

const patientFinanceUi = readFileSync('src/components/PatientFinanceWorkspace.tsx', 'utf8');
assert.match(patientFinanceUi, /getPatientFinanceTransactionDocument\(transactionId, kind\)/);
assert.doesNotMatch(patientFinanceUi, /href=\{transaction\.(?:proof_url|receipt_url)\}/,
  'a tela deve pedir somente o documento aberto pelo usuario');
assert.match(patientFinanceUi, /setLedger\(emptyLedger\)[\s\S]*?\}, \[month, workspaceScopeKey\]\);/,
  'trocar de clinica precisa limpar e recarregar o ledger, mesmo mantendo a mesma competencia');
assert.match(coordinatorSource, /key=\{`patient-finance:\$\{workspaceScopeKey\}`\}[\s\S]*?workspaceScopeKey=\{workspaceScopeKey\}/,
  'o workspace financeiro nao pode reutilizar estado do tenant anterior');

console.log('databaseRuntimeEconomy.test.ts: ok');
