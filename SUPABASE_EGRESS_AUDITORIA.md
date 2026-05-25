# Auditoria urgente de egress Supabase - Verto

Data: 2026-05-25

## Resumo executivo

O consumo anormal de egress tinha dois vetores de alto risco no front-end e varios endpoints clinicos sem paginacao efetiva:

- Portal do paciente fazia refresh completo a cada 15 segundos.
- Painel ABA do prontuario refazia listas ABA completas sempre que a sessao registrava novo item.
- Endpoints de historico, notas, tarefas, tarefas atribuidas, anamnese e ABA aceitavam leituras grandes ou retornavam linhas completas.
- Historico assinava URLs de Storage para todos os itens carregados, ampliando trafego em listas grandes.

As correcoes aplicadas reduzem leituras repetitivas, colocam limites em listas clinicas e evitam payloads ABA completos em consultas recentes.

## Arquivos suspeitos auditados

- `src/App.tsx`
  - Achado: `fetchPatientScopedData` rodava em `setInterval(..., 15_000)` para paciente.
  - Risco: alto, pois dispara varias rotas que consultam Supabase repetidamente.
  - Correcao: removido polling fixo; agora carrega uma vez e atualiza em `focus`/`visibilitychange` com throttle minimo de 5 minutos.

- `src/components/PatientDetailView.tsx`
  - Achado: carregamento ABA dependia de `activeSession?.recordCount`, gerando refetch de sessoes/tentativas/eventos/maestria apos cada registro.
  - Risco: alto em sessao ABA ativa.
  - Correcao: removida dependencia do contador; painel usa limite recente de 20 e atualiza apenas por paciente, feature flag ou refresh manual.

- `src/services/dataService.ts`
  - Achado: chamadas de listas nao informavam limite e a hidratacao do workspace carregava listas por paciente sem paginacao explicita.
  - Risco: alto em clinicas com muitos pacientes e historicos.
  - Correcao: criado `endpointWithLimit`; listas clinicas usam `limit=20`; pacientes usam `limit=200`; ABA usa limite normalizado 20/max 50.

- `server.ts`
  - Achado: endpoints clinicos e ABA sem limite baixo ou com `limit(200/500)`; leituras ABA usavam `select('*')`; writes ABA retornavam linha completa.
  - Risco: alto no Marco 1 ABA e medio em prontuario.
  - Correcao: criado `parseBoundedListLimit`; endpoints recentes limitados; ABA GET usa selecao explicita de colunas; writes ABA retornam apenas `id`.

- `tests/security.regression.test.mjs`
  - Ajustado para validar os getters ABA paginados.

## Consultas corrigidas

- `GET /api/patients`
  - Antes: lista ativa sem `limit`.
  - Agora: `limit` default 200, max 500, ordenado por `created_at`.

- `GET /api/notes/:patientId` e `GET /api/notes/email/:email`
  - Antes: sem limite.
  - Agora: default 20, max 50, com slice final apos merge/dedupe.

- `GET /api/history/:patientId`, `GET /api/history/email/:email`, `GET /api/patient/self/history`
  - Antes: sem limite efetivo e assinatura de Storage para todos os itens.
  - Agora: default 20, max 50, merge/dedupe limitado antes de assinar URLs.

- `GET /api/tasks/:patientId`, `GET /api/tasks/email/:email`, `GET /api/patient/self/tasks`
  - Antes: sem limite.
  - Agora: default 20, max 50.

- `GET /api/assigned-tasks/:patientId`, `GET /api/patient/self/assigned-tasks`
  - Antes: sem limite.
  - Agora: default 20, max 50, incluindo fallback legacy de `tasks`.

- `GET /api/patient-anamnesis/:patientId`
  - Antes: `limit(200)`.
  - Agora: default 20, max 50.

- ABA V2:
  - `GET /api/aba/sessions/:patientId`: default 20, max 50, colunas explicitas.
  - `GET /api/aba/trials/:patientId`: default 20, max 50, colunas explicitas.
  - `GET /api/aba/behavior-events/:patientId`: default 20, max 50, colunas explicitas.
  - `GET /api/aba/mastery-evaluations/:patientId`: default 20, max 50, colunas explicitas.
  - `writeAbaRowWithSchemaFallback`: `select('id')` em vez de `select('*')`.
  - `PATCH /api/aba/sessions/:sessionId`: retorno com colunas minimas.

## Realtime, auth e Storage

- Realtime:
  - Apenas `src/services/dataService.ts` usa `postgres_changes`, em `patient_logs`.
  - A subscription tem filtro `patient_id=eq...`.
  - Cleanup usa `supabase.removeChannel(channel)`.
  - Nao foi encontrado realtime ABA nem realtime sem filtro em tabela grande.

- Auth listeners:
  - `src/App.tsx` usa `onAuthStateChange`.
  - Ha cleanup via unsubscribe.

- Storage:
  - Storage aparece em geracao de signed URLs, principalmente historico e midias de perfil.
  - O risco maior era historico assinar muitas URLs apos query sem limite.
  - Corrigido ao limitar historico antes de assinar URLs.

## Service role

Nao foi encontrada `SUPABASE_SERVICE_ROLE_KEY` no front-end (`src`).

Ocorrencias validas:
- `.env.example`
- `server.ts`
- scripts administrativos em `scripts/`

Nenhuma chave hardcoded foi encontrada no front-end.

## Riscos residuais

- `hydrateWorkspaceState` ainda busca `patient_records` uma vez por paciente para preservar PEI/anamnese/links clinicos. Isso pode consumir egress se `payload_encrypted` for grande e houver muitos pacientes. Nao alterei para lazy-load porque isso mudaria a disponibilidade inicial de dados clinicos. Proxima correcao recomendada: criar resumo/preview clinico aditivo para PEI/anamnese minima ou lazy-load por paciente aberto.
- Ainda existem `select('*')` em rotas de detalhe, writes com fallback de schema, financeiro/owner e areas antigas. Os fluxos clinicos recentes e ABA foram limitados agora; uma segunda passada deve trocar os `select('*')` restantes por colunas explicitas por dominio.
- `clinic_state` armazena `appointments` e `protocols` em JSON. Ja e uma linha por clinica, mas pode crescer. Recomendado monitorar tamanho medio de resposta e considerar separar protocolos em tabela paginada.

## Validacao

- `npm.cmd run lint`: passou.
- `npm.cmd run build`: passou.
- `npm.cmd run test:security`: passou, 19/19.
- `npm.cmd run test:aba-marco1`: passou.

## Proximos passos recomendados

1. No Supabase dashboard, monitorar egress por rota/tabela apos deploy, especialmente `history`, `patient_records`, `clinic_state` e `aba_*`.
2. Adicionar logs de tamanho de resposta por endpoint critico no backend por 24-48h.
3. Implementar lazy-load ou preview clinico para `patient_records`.
4. Substituir `select('*')` restantes por colunas explicitas, com prioridade para rotas de lista.
5. Criar alerta operacional quando egress diario ultrapassar um limite esperado.
