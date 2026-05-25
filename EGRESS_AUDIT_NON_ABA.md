# Auditoria Global de Egress Fora da ABA V2

Data: 2026-05-25

## Escopo

Auditoria de consultas Supabase fora do fluxo ABA V2, com foco em:

- `select('*')`;
- listas sem `limit`;
- filtros por escopo clinico/paciente quando aplicavel;
- realtime/polling;
- `useEffect` com risco de refetch em loop.

## Resultado Executivo

- `select('*')` removido de `server.ts` e da probe de protocolo em `src/services/dataService.ts`.
- Mutacoes que retornavam linha completa via `.select()` foram convertidas para selecoes explicitas nas rotas revisadas.
- Listas criticas receberam limites no servidor: logs do paciente, arquivos do paciente, agenda recorrente, financeiro e clientes/admin.
- `npm run lint` passou.
- `npm run build` passou.

## Correcoes Aplicadas

| Risco | Area | Tabela/rota | Correcao |
| --- | --- | --- | --- |
| Alto | Prontuario/lista frequente | `patients` em `/api/patients` | `PATIENT_LIST_SELECT`, filtros existentes preservados, `limit` mantido |
| Alto | Historico/prontuario | `history` | `HISTORY_SELECT`, limites existentes preservados |
| Alto | Notas/prontuario | `notes` | `NOTE_SELECT` e fallback `NOTE_LEGACY_SELECT` sem `visibility` |
| Alto | Portal/tarefas | `tasks`, `assigned_tasks` | `TASK_SELECT`, `ASSIGNED_TASK_SELECT`, limites preservados |
| Alto | Logs do paciente | `patient_logs`, fallback `history` | `PATIENT_LOG_SELECT`, `HISTORY_SELECT`, `limit` 50/100 |
| Alto | Financeiro | `payments`, `professional_payments`, `clinic_financial_entries` | selecoes explicitas e `limit` 100/200 |
| Medio | Arquivos do paciente | `patient_files` | selecao explicita e `limit` 50/100 |
| Medio | Agenda | `appointments` | `APPOINTMENT_SELECT`; recorrencias limitadas a 200 |
| Medio | Admin/owner | `users`, views financeiras | selecoes explicitas, counts por `id`, limites em listas |
| Medio | Protocolos | `protocol_import_requests`, `verto_canonical_protocols` | selecoes explicitas; limites existentes preservados |
| Baixo | Auth/convites/OTP | `users`, `invitations`, `otp_challenges` | selecoes explicitas em detalhes e fluxos de login |

## Realtime, Polling e useEffect

- Realtime fora ABA encontrado apenas em `dataService.subscribeToPatientLogs`.
- A subscription esta filtrada por `patient_id`, tem cleanup com `removeChannel` e nao estava sendo usada por nenhum componente no momento da auditoria.
- Pollings encontrados sao locais/UX:
  - timers de relogio/sessao em `PatientDashboard`, `PatientDetailView`, `SessionMode`, `CoordinatorDashboard`;
  - tarefas internas do servidor via `setInterval`.
- Nao foi identificado loop obvio de Supabase por `useEffect` dependendo do mesmo estado que altera. O carregamento do portal do paciente tem trava de execucao e intervalo minimo de 5 minutos.

## Pendencias e Riscos Residuais

- O endpoint `/api/owner/leads/recovery` ainda pode retornar ate 1000 usuarios e ate 5000 logs; e area owner/eventual, mas deve ser paginado antes de escala real.
- Algumas selecoes explicitas incluem colunas opcionais de migracoes recentes. Build passou, mas a validacao final em producao deve observar erros de schema cache/coluna ausente.
- `patient_files` ainda gera signed URL por arquivo retornado; agora limitado, mas thumbnails/cache devem ser avaliados se storage egress crescer.

## Validacao

- `rg "select('\\*|\\.select\\(\\)" server.ts src` nao encontrou `select('*')` operacional nem `.select()` sem colunas; restou apenas texto de warning dev.
- `npm run lint`: passou.
- `npm run build`: passou, com avisos existentes de CSS import/chunk size.
