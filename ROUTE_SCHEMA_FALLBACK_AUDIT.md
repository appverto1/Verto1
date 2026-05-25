# Auditoria preventiva de rotas GET criticas

Data: 2026-05-25

## Escopo

Varredura feita apos a remocao de `select('*')`, com foco em rotas GET usadas no carregamento inicial do painel, lista de pacientes, prontuario, dashboards administrativos e ABA V2. A regra mantida foi selecao explicita, sem `select('*')`, com fallback por coluna opcional quando a rota e sensivel a diferenca de schema/cache do Supabase.

Observacoes:

- Nao existe rota `GET /api/patients/:id` em `server.ts`; `PATCH /api/patients/:id` e `DELETE /api/patients/:id` existem, mas nao fazem parte do carregamento inicial GET.
- Nao foi encontrada rota `GET /api/coordinator/*` dedicada; o dashboard coordenador usa rotas compartilhadas como `/api/patients`, `/api/clinic/state`, `/api/history/:patientId`, `/api/tasks/:patientId` e financeiro.
- Nao foi encontrada rota `GET /api/protocols`; protocolos da clinica sao carregados via `/api/clinic/state`, e o portal paciente usa `/api/patient/self/protocols`.
- ABA V2 foi auditado sem alteracao de logica clinica.

## GETs de carregamento inicial

Painel principal/lista de pacientes:

- `GET /api/profile/:userId`
- `GET /api/clinic/state`
- `GET /api/clinic/anamnesis-template`
- `GET /api/patients?limit=200`
- `GET /api/clinic/invitations`

Prontuario do paciente:

- `GET /api/notes/:patientId?limit=20`
- `GET /api/history/:patientId?limit=20`
- `GET /api/tasks/:patientId?limit=20`
- `GET /api/assigned-tasks/:patientId?limit=20`
- `GET /api/patient-records/:patientId`
- `GET /api/patient-anamnesis/:patientId?limit=20`
- `GET /api/patient-files/:patientId`
- `GET /api/patient-logs/:patientId`

Dashboard admin/owner:

- `GET /api/admin/stats`
- `GET /api/admin/clients`
- `GET /api/admin/dre`
- `GET /api/admin/protocol-import-requests`
- `GET /api/admin/verto-protocols`
- `GET /api/owner/stats`
- `GET /api/owner/clients`
- `GET /api/owner/financial-overview`
- `GET /api/owner/financial-feature-surveys`
- `GET /api/owner/leads/recovery`
- `GET /api/payments`
- `GET /api/financial/professional-payments`
- `GET /api/financial/entries`

ABA V2:

- `GET /api/aba/session-live-summaries/:sessionId`
- `GET /api/aba/session-reports/:sessionId`
- `GET /api/aba/recent-session-events/:sessionId`
- `GET /api/aba/patient-summary/:patientId`
- `GET /api/aba/maintenance-overview/:patientId`
- `GET /api/aba/patients/:patientId/charts/targets`
- `GET /api/aba/patients/:patientId/charts/behaviors`
- `GET /api/aba/patients/:patientId/charts/mastery`
- `GET /api/aba/patients/:patientId/charts/maintenance`
- `GET /api/aba/patients/:patientId/charts/session-changes`
- `GET /api/aba/patients/:patientId/charts/overview`
- `GET /api/aba/sessions/:patientId`
- `GET /api/aba/trials/:patientId`
- `GET /api/aba/behavior-events/:patientId`
- `GET /api/aba/mastery-evaluations/:patientId`

## Tabela de auditoria

| Rota | Arquivo/linha | Tabela principal | Select atual | Fallback existente | Risco | Acao |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/patients` | `server.ts:9993` | `patients` | `PATIENT_LIST_SELECT` | `fetchPatientsWithSchemaFallback`, remove `professional_id`, `is_active`, `deleted_at`, etc. | Baixo | Ja corrigido anteriormente. |
| `/api/clinic/invitations` | `server.ts:7656` | `invitations`, `clinic_memberships`, `users` | `INVITATION_SELECT` | `fetchClinicInvitationsWithSchemaFallback` e fallback de historico de membros. | Baixo | Ja corrigido anteriormente. |
| `/api/profile/:userId` | `server.ts:12777` | `users`, `professional_profiles` | `PROFILE_SELECT`, `PROFESSIONAL_PROFILE_SELECT` | `fetchProfileWithSchemaFallback` e `fetchProfessionalProfileWithSchemaFallback`. | Baixo | Ja corrigido anteriormente. |
| `/api/notes/:patientId` | `server.ts:11249` | `notes`, `patients` | `NOTE_SELECT` | `fetchNotesWithSchemaFallback`, remove colunas opcionais e filtros legados. | Baixo | Ja corrigido anteriormente. |
| `/api/clinic/state` | `server.ts:8109` | `clinic_state` | `CLINIC_STATE_SELECT` | `fetchClinicStateWithSchemaFallback`, remove `specialty_settings`/`updated_at`; fallback de tabela ausente. | Baixo | Corrigido nesta rodada. |
| `/api/clinic/anamnesis-template` | `server.ts:8021` | `clinic_anamnesis_templates` | `CLINIC_ANAMNESIS_TEMPLATE_SELECT` | `fetchClinicAnamnesisTemplateWithSchemaFallback`, remove `updated_at`; fallback para template default. | Baixo | Corrigido nesta rodada. |
| `/api/history/:patientId` | `server.ts:11563` | `history`, `patients` | `HISTORY_SELECT` | `fetchHistoryWithSchemaFallback`; remove colunas opcionais e filtros `is_active`/`deleted_at`; busca por email vira `[]` se `patient_email` nao existir. | Baixo | Corrigido nesta rodada. |
| `/api/history/email/:email` | `server.ts:11649` | `history` | `HISTORY_SELECT` | Mesmo helper de historico com escopo por `patient_id` quando necessario. | Baixo | Corrigido nesta rodada. |
| `/api/tasks/:patientId` | `server.ts:13121` | `tasks`, `patients` | `TASK_SELECT` | `fetchTasksWithSchemaFallback`; busca auxiliar por email vira `[]` se `patient_email` nao existir. | Baixo | Corrigido nesta rodada. |
| `/api/tasks/email/:email` | `server.ts:13177` | `tasks` | `TASK_SELECT` | Mesmo helper de tarefas, com `limit`. | Baixo | Corrigido nesta rodada. |
| `/api/assigned-tasks/:patientId` | `server.ts:13658` | `assigned_tasks` | `ASSIGNED_TASK_SELECT` | `fetchAssignedTasksWithSchemaFallback`; remove `clinic_id` e colunas recentes; tabela ausente retorna `[]`. | Baixo | Corrigido nesta rodada. |
| `/api/patient-records/:patientId` | `server.ts:11039` | `patient_records` | `PATIENT_RECORD_SELECT` | `fetchPatientRecordWithSchemaFallback`; remove `payload_preview`, `pseudonym_id`, `clinic_id`, `updated_at`; tabela ausente retorna `null`. | Baixo | Corrigido nesta rodada. |
| `/api/patient-anamnesis/:patientId` | `server.ts:9222` | `patient_anamnesis_submissions` | `PATIENT_ANAMNESIS_SELECT` | `fetchPatientAnamnesisWithSchemaFallback`; remove `patient_file_id`, `template_version`, `profile_type`, etc.; tabela ausente retorna `[]`. | Baixo | Corrigido nesta rodada. |
| `/api/patient-files/:patientId` | `server.ts:10575` | `patient_files` | `PATIENT_FILE_SELECT` | `fetchPatientFilesWithSchemaFallback`; remove `metadata`, `source`, `file_size_bytes`, `clinic_id`; tabela ausente usa payload do prontuario. | Baixo | Corrigido nesta rodada. |
| `/api/patient-logs/:patientId` | `server.ts:12076` | `patient_logs`, `history` | `PATIENT_LOG_SELECT`, `HISTORY_SELECT` | `fetchPatientLogsWithSchemaFallback`; se a tabela/filtro falhar, cai para historico com fallback. | Baixo | Corrigido nesta rodada. |
| `/api/payments` | `server.ts:17131` | `payments` | `PAYMENT_SELECT` | `fetchPaymentsWithSchemaFallback`; remove colunas recentes de recibo/recorrencia/escopo financeiro. | Baixo | Corrigido nesta rodada. |
| `/api/financial/professional-payments` | `server.ts:17300` | `professional_payments` | `PROFESSIONAL_PAYMENT_SELECT` | `fetchProfessionalPaymentsWithSchemaFallback`; remove colunas recentes e troca ordenacao para `payment_date` se `due_date` faltar. | Baixo | Corrigido nesta rodada. |
| `/api/financial/entries` | `server.ts:17438` | `clinic_financial_entries` | `FINANCIAL_ENTRY_SELECT` | `fetchFinancialEntriesWithSchemaFallback`; tabela ausente segue retornando `[]`. | Baixo | Corrigido nesta rodada. |
| `/api/patient/self/protocols` | `server.ts:11912` | `clinic_state` | literal `clinic_id, protocols, updated_at` | Fallback parcial para tabela ausente; sem fallback por coluna opcional. | Medio | Pendente: adicionar helper se portal paciente virar area critica de producao. |
| `/api/appointments/:appointmentId/confirmation` | `server.ts:8602` | `appointments` | `APPOINTMENT_SELECT` | Sem fallback por coluna opcional; endpoint de item unico. | Baixo | Monitorar; nao e rota de painel inicial. |
| `/api/admin/stats` | `server.ts:17840` | agregacoes administrativas | selects explicitos/agregacoes | Fallbacks locais variam por bloco. | Medio | Documentado; sem mudanca nesta rodada para evitar ampliar escopo admin. |
| `/api/admin/clients` | `server.ts:17879` | `users`/clientes | selects explicitos | Sem fallback centralizado por coluna opcional. | Medio | Pendente preventivo. |
| `/api/admin/dre` | `server.ts:19020` | views financeiras | `OWNER_*_SELECT` | `Promise.allSettled`/fallbacks parciais em views. | Medio | Pendente: helper para views se schema das views mudar. |
| `/api/admin/protocol-import-requests` | `server.ts:18452` | `protocol_import_requests` | `PROTOCOL_IMPORT_REQUEST_SELECT` | Tabela ausente tratada em blocos relacionados. | Baixo/medio | Pendente baixo; rota superadmin. |
| `/api/admin/verto-protocols` | `server.ts:18872` | `verto_canonical_protocols` | `CANONICAL_PROTOCOL_SELECT` | Fallback para `[]` quando tabela indisponivel. | Baixo | Sem acao agora. |
| `/api/owner/stats` | `server.ts:17533` | `users`, metricas | selects explicitos/agregacoes | Sem fallback centralizado; rota owner. | Medio | Pendente preventivo. |
| `/api/owner/clients` | `server.ts:17554` | `users` | selects explicitos | Sem fallback centralizado; rota owner. | Medio | Pendente preventivo. |
| `/api/owner/financial-overview` | `server.ts:17569` | views `vw_owner_*` | `OWNER_*_SELECT` | Uso de views com limites; fallback parcial. | Medio | Pendente preventivo para views. |
| ABA V2 sessoes/relatorios/graficos/summaries/maestria | `server.ts:15637-17106` | `aba_*` | `ABA_*_SELECT` | Usa selecoes explicitas e `limit`/`range`; sem fallback por coluna opcional em cada constante. | Medio | Nao alterado por restricao de nao mudar logica clinica ABA; pendente smoke/fallback especifico ABA. |

## Acao tecnica aplicada

- Centralizada a remocao de colunas opcionais em `src/utils/routeSchemaFallbacks.ts` com helper comum para listas e detalhes.
- Mantidas selecoes explicitas: `HISTORY_SELECT`, `TASK_SELECT`, `ASSIGNED_TASK_SELECT`, `PATIENT_LOG_SELECT`, `PATIENT_FILE_SELECT`, `PATIENT_RECORD_SELECT`, `PATIENT_ANAMNESIS_SELECT`, `CLINIC_STATE_SELECT`, `PAYMENT_SELECT`, `PROFESSIONAL_PAYMENT_SELECT`, `FINANCIAL_ENTRY_SELECT`.
- Nenhum `select('*')` operacional foi reintroduzido.
- Smoke test novo: `npm run test:route-schema-fallbacks`.
