# Validacao operacional - ABA V2 summary-driven

Data: 2026-05-25

## Objetivo

Validar que as telas ABA V2 deixaram de depender de leituras brutas amplas do Supabase e passaram a usar resumos, eventos recentes limitados e atualizacao local apos escrita.

## Resultado executivo

Status: aprovado para reducao de egress no escopo ABA V2.

- Nao ha realtime ABA ativo por padrao.
- As listas ABA usam selecao explicita de colunas, escopo por paciente/sessao/clinica e paginacao.
- A abertura do prontuario usa `aba_patient_aba_summaries` mais listas recentes de 10 itens.
- A abertura da sessao usa `aba_session_live_summaries` e historico recente limitado a 20 eventos.
- Acoes clinicas escrevem o evento bruto e deixam os summaries serem atualizados por triggers/functions SQL.
- Apos inserts, a UI atualiza estado local e nao refaz fetch completo de tabelas ABA.
- O relatorio tenta ler `aba_session_summaries` persistido antes de usar o resumo local.

## Chamadas ao abrir prontuario ABA

Arquivo: `src/components/PatientDetailView.tsx`

Ao carregar o painel ABA, `loadAbaRecords` faz:

- `getPatientAbaSummary(patient.id)`
  - tabela: `aba_patient_aba_summaries`
  - tipo: detalhe, 1 linha esperada
- `getAbaSessions(patient.id, { page: 1, pageSize: 10 })`
  - tabela: `aba_sessions`
  - lista paginada
- `getAbaTrials(patient.id, { page: 1, pageSize: 10 })`
  - tabela: `aba_trials`
  - lista paginada
- `getAbaBehaviorEvents(patient.id, { page: 1, pageSize: 10 })`
  - tabela: `aba_behavior_events`
  - lista paginada
- `getAbaMasteryEvaluations(patient.id, { page: 1, pageSize: 10 })`
  - tabela: `aba_mastery_evaluations`
  - lista paginada

Confirmacoes:

- Nao busca todos os eventos de comportamento.
- Nao busca todas as tentativas.
- Nao ha `select('*')` nas listas ABA.
- O refresh manual do painel ABA repete apenas as mesmas leituras limitadas.

## Chamadas ao abrir sessao ABA

Arquivo: `src/components/SessionMode.tsx`

Ao abrir uma sessao ativa:

- `getSessionLiveSummary(sessionId)`
  - tabela: `aba_session_live_summaries`
  - tipo: detalhe, 1 linha esperada
- `getRecentSessionEvents(sessionId, 20)`
  - tabelas: `aba_trials`, `aba_behavior_events`, `aba_mastery_evaluations`
  - limite: 20 por consulta no backend e retorno final limitado a 20 eventos

Confirmacoes:

- Historico visivel e limitado a 20 por padrao.
- O estado local guarda no maximo 40 registros para conveniencia offline/local.
- Contadores principais usam `sessionLiveSummary` quando disponivel e estado local apenas como fallback imediato.
- Nenhum `useEffect` depende de `records` para refazer fetch ABA.
- Inserts nao disparam `getRecentSessionEvents` nem recarregam listas completas.

## Fluxo de registro

| Acao | Escrita bruta | Summary atualizado por SQL | UI apos acao | Refetch amplo |
| --- | --- | --- | --- | --- |
| Tentativa independente | `saveAbaTrial` -> `aba_trials` | trigger `aba_summary_after_trial_insert` | estado local/historico da sessao | nao |
| Tentativa com ajuda | `saveAbaTrial` -> `aba_trials` | trigger `aba_summary_after_trial_insert` | estado local/historico da sessao | nao |
| Erro | `saveAbaTrial` -> `aba_trials` | trigger `aba_summary_after_trial_insert` | estado local/historico da sessao | nao |
| Frequencia | `saveAbaBehaviorEvent` -> `aba_behavior_events` | trigger `aba_summary_after_behavior_insert` | estado local/historico da sessao | nao |
| Inicio de duracao | `saveAbaBehaviorEvent` -> `aba_behavior_events` status `IN_PROGRESS` | trigger incrementa `open_duration_count` | estado local/open duration | nao |
| Encerramento de duracao | `saveAbaBehaviorEvent` upsert -> `aba_behavior_events` status `COMPLETED` | trigger decrementa aberto e agrega duracao diaria | estado local atualizado | nao |
| Intervalo SIM/NAO | `saveAbaIntervalRecord` -> `aba_interval_records` | registro bruto/auditoria | estado local da coleta | nao |
| Finalizacao de intervalo | `saveAbaIntervalSummary` -> `aba_interval_summaries` | trigger atualiza live/daily/patient summaries | estado local e toast | nao |
| Encerramento de sessao | `saveAbaSessionSummary` e `updateAbaSession` | trigger de sessao completed consolida summary se necessario | tela de resumo/relatorio | nao |

## Relatorio

Arquivo: `src/components/SessionMode.tsx`

- O botao "Ver relatorio" chama `getSessionReport(sessionId)`.
- O endpoint le `aba_session_summaries` com selecao explicita.
- Se o resumo persistido estiver indisponivel, a UI usa o `postClosureSummary` local como fallback.
- Eventos brutos remotos nao sao buscados para abrir o relatorio.
- Detalhes exibidos no relatorio atual usam `sourceRecords` locais; uma lista remota detalhada futura deve usar paginacao.

## useEffect e loops

Pontos auditados:

- `PatientDetailView`: `loadAbaRecords` depende de `patient.id`, perfil, flag e refresh manual. Ele altera estados de ABA, mas nao depende desses estados, entao nao entra em loop.
- `SessionMode`: `loadLiveSummary` depende de `sessionId` e `sessionCompleted`.
- `SessionMode`: `loadRecentSessionEvents` depende de hidratacao da sessao, `sessionId` e `sessionCompleted`; ele altera `records`, mas nao depende de `records`.
- Timers de sessao/intervalo sao locais (`setInterval` para relogio/timer) e nao chamam Supabase.
- Persistencia em `localStorage` depende de estado local e nao faz rede.

## Realtime

- Nao existem subscriptions em tabelas ABA.
- A subscription existente e somente `patient_logs`, filtrada por `patient_id`.
- O cleanup usa `supabase.removeChannel(channel)`.
- `patient_logs` nao dispara refetch ABA.

## Logs de desenvolvimento

Arquivo: `src/services/dataService.ts`

Foi adicionada telemetria dev-only em `fetchClinical`:

- helper chamado;
- tabela;
- operacao;
- limit/pageSize;
- linhas retornadas;
- tamanho aproximado da resposta em bytes;
- status HTTP;
- endpoint.

Formato:

```text
[egress-query] {
  helper,
  table,
  operation,
  limit,
  rows,
  approxBytes,
  status,
  endpoint
}
```

Esses logs so rodam com `import.meta.env.DEV` e usam `response.clone()`, sem consumir a resposta original.

## Queries removidas ou otimizadas

- Prontuario deixou de depender de agregacoes front-end sobre listas grandes e passou a ler `aba_patient_aba_summaries`.
- Sessao ativa passou a ler `aba_session_live_summaries`.
- Historico da sessao usa `recent-session-events` com limite 20.
- Relatorio usa `aba_session_summaries`.
- Listas ABA usam `page/pageSize`, `range`, `order`, filtros por paciente/sessao/clinica e selecao explicita.
- Realtime ABA permanece fora do fluxo padrao.

## Riscos restantes

- Ainda existem `select('*')` em areas nao ABA do servidor. Eles nao fazem parte do fluxo ABA V2 validado aqui, mas seguem como risco geral de egress do produto.
- O prontuario ainda carrega quatro listas recentes alem do patient summary para compor a linha do tempo curta. O limite atual e 10, aceitavel, mas pode virar uma unica endpoint agregada se o uso crescer.
- Os summaries dependem das triggers aplicadas corretamente no banco. Em deploy, validar que a migration `20260525123000_aba_v2_summary_driven.sql` foi aplicada sem erro.
- Logs dev-only medem tamanho aproximado da resposta HTTP recebida no cliente; nao substituem metricas reais do painel Supabase.

## Comandos de validacao

- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run test:aba-summary-driven`
- `npm.cmd run test:aba-marco1`

