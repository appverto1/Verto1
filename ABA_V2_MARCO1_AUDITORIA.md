# Auditoria Tecnica - ABA V2 Marco 1

Data: 2026-05-25

## Escopo

Auditoria e consolidacao dos epicos:

- 0. Blindagem de evolucao
- 1. Nucleo de dados ABA
- 2. Sessao ABA ativa
- 3. Tentativas DTT/NET/Probe
- 5. Evento comportamental inteligente
- 6. Frequencia e duracao
- 7. Intervalo parcial
- 8. ABC basico
- 9. Encerramento e relatorio basico
- 13. Sync/offline minimo

Nao foram adicionados graficos, assinatura, convenio, portal familiar ou motor avancado de maestria.

## Status Por Epico

### 0. Blindagem De Evolucao

Status: consolidado para Marco 1.

UI pronta:
- `SessionMode` so renderiza quando `aba_v2` esta habilitada.
- `PatientDetailView` abre `SessionMode` somente com `abaV2Enabled && isSessionModeOpen`.

Estado local:
- Feature flag centralizada em `src/utils/featureFlags.ts`.
- Estado ativo da sessao ABA e coleta por intervalo continua isolado no fluxo ABA V2.

Persistencia real:
- `dataService` bloqueia writes ABA V2 com `aba_v2=false`.
- API bloqueia rotas ABA V2 via `requireAbaV2Feature`.

Testes existentes:
- `tests/security.regression.test.mjs`
- `tests/abaSessionSummary.test.ts`
- `tests/abaMarco1Audit.test.ts`

Pendencias:
- Checklist manual obrigatorio antes de producao: validar `aba_v2=false` em ambiente de preview com um paciente realista e confirmar que o fluxo legado continua abrindo sem `SessionMode`.

### 1. Nucleo De Dados ABA

Status: consolidado com migration aditiva.

Tabelas confirmadas:
- `aba_sessions`
- `aba_programs`
- `aba_targets`
- `aba_prompt_levels`
- `aba_trials`
- `aba_behavior_definitions`
- `aba_behavior_events`
- `aba_interval_records`
- `aba_interval_summaries`
- `aba_abc_events`
- `aba_session_summaries`

Migrations:
- As migrations ABA usam `create table if not exists`, `add column if not exists`, indices e RLS.
- Nao foi encontrado `drop column`, `drop table`, `rename column` ou `rename to` em migration ABA.
- Nova migration aditiva: `supabase/migrations/20260525110000_aba_v2_marco1_integrity.sql`.

Pendencias:
- Aplicar a nova migration no ambiente remoto antes do proximo deploy de producao.

### 2. Sessao ABA Ativa

Status: implementado.

UI pronta:
- Inicio de sessao ativa em `PatientDetailView`.
- Sessao fullscreen em `SessionMode`.
- Encerramento abre pre-resumo com bloqueios e avisos.

Estado local:
- `activeSession` persiste no estado do paciente.
- Estado auxiliar local em `verto.aba_session_state:{patientId}:{sessionId}`.

Persistencia real:
- Inicio salva em `aba_sessions`.
- Encerramento atualiza `aba_sessions`.
- `SessionSummary` salva em `aba_session_summaries`.

Pendencias:
- Validar em staging se o servidor remoto ja possui todas as colunas aditivas de `aba_session_summaries`.

### 3. Tentativas DTT/NET/Probe

Status: implementado.

UI pronta:
- Botoes Independente, Com ajuda e Erro.
- Prompt obrigatorio quando ha ajuda.
- Tipos DTT, NET, Cold Probe, Baseline Probe e Maintenance Probe.

Estado local:
- Historico de tentativa entra em `records`.
- `syncStatus` local/syncing/synced/error aparece no historico.

Persistencia real:
- `App.tsx` grava tentativa estruturada em `dataService.saveAbaTrial`.
- API grava em `aba_trials`.
- Payload inclui `patientId`, `sessionId`, `therapistId`, `clinicId`, prompt canonico, score, correct, independent, source e timestamp.

Testes:
- Calculo de acuracia e independencia em `abaSessionSummary.test.ts` e `abaMarco1Audit.test.ts`.

Pendencias:
- Nenhuma critica para Marco 1.

### 5. Evento Comportamental Inteligente

Status: implementado.

UI pronta:
- Registro rapido de comportamento.
- Seletores de local e severidade.
- Historico com edicao e indicadores de sync.

Estado local:
- Eventos entram em `records`.
- Eventos de duracao em andamento entram em `openDurations`.

Persistencia real:
- Frequencia, duracao, intervalo e ABC passam por `dataService`.
- API grava em `aba_behavior_events`, `aba_interval_records`, `aba_interval_summaries` e `aba_abc_events`.

Pendencias:
- Eventos cancelados por intervalo mantem auditoria; se no futuro o relatorio server-side recalcular direto de registros brutos, deve considerar `cancel-audit`/`collection_status=CANCELLED`.

### 6. Frequencia E Duracao

Status: implementado.

UI pronta:
- Frequencia +1.
- Duracao iniciar/encerrar.
- Dock indica duracao ativa.

Estado local:
- Duracao em andamento fica em `openDurations`.
- Encerrar duracao atualiza o mesmo evento.

Persistencia real:
- Iniciar duracao salva `IN_PROGRESS`.
- Encerrar duracao salva `COMPLETED` com `durationSeconds`.
- Frequencia salva `countDelta`.

Testes:
- Total, media e maior episodio em `abaSessionSummary.test.ts` e `abaMarco1Audit.test.ts`.
- Dock em `abaClinicalDock.test.ts`.

Pendencias:
- Nenhuma critica para Marco 1.

### 7. Intervalo Parcial

Status: consolidado.

UI pronta:
- RUNNING: painel com Pausar, Finalizar agora e Opcoes.
- AWAITING_RESPONSE: SIM/NAO priorizados e dock oculto.
- PAUSED: Retomar, Finalizar agora e Cancelar dentro do painel.

Estado local:
- Timer, pausa, retomada, respostas anteriores e resumo parcial preservados.
- Padding inferior dinamico considera dock e safe-area.

Persistencia real:
- Inicio de coleta salva lifecycle em `aba_interval_records`.
- Pausa salva lifecycle `PAUSED`.
- Retomada salva lifecycle `RUNNING`.
- SIM/NAO salva intervalo respondido em `aba_interval_records`.
- Finalizacao parcial/completa salva aggregate em `aba_interval_summaries`.
- Cancelamento salva audit em `aba_interval_summaries` com `CANCELLED`.

Testes:
- `abaIntervalLifecycle.test.ts`
- `abaMarco1Audit.test.ts`

Pendencias:
- Teste visual manual em devices 360x800, 390x844 e 414x896 continua obrigatorio antes de producao.

### 8. ABC Basico

Status: implementado com guard reforcado.

UI pronta:
- Modal ABC com antecedente, consequencia, local, severidade e nota.
- Edicao/complemento de ABC em registros existentes.

Estado local:
- ABC entra no historico como comportamento.

Persistencia real:
- `dataService.saveAbaAbcEvent`.
- API grava em `aba_abc_events`.
- API agora valida sessao concluida e so permite complemento pos-encerramento se o payload marcar complemento clinico autorizado.

Pendencias:
- Definir politica de produto para quais complementos pos-encerramento devem existir fora de nota da sessao e ABC.

### 9. Encerramento E Relatorio Basico

Status: implementado e ajustado.

UI pronta:
- Pre-resumo de encerramento.
- Bloqueios e avisos.
- Tela pos-encerramento.
- Ver relatorio.

Estado local:
- `sessionClosureSummary` calcula preview.
- `postClosureSummary` passa a ser preenchido apos retorno de `saveAbaSessionSummary`, com fallback de erro.

Persistencia real:
- `aba_session_summaries` recebe resumo clinico.
- `aba_sessions` recebe status `COMPLETED`.
- Complemento de nota resalva `SessionSummary`.

Pendencias:
- PDF/exportacao segue fora do Marco 1.

### 13. Sync/Offline Minimo

Status: implementado.

UI pronta:
- Historico mostra local/syncing/synced/error.
- Toast avisa sucesso/offline/erro.

Estado local:
- `saveOfflineFirst` salva local antes de tentar servidor.
- Cache local criptografado continua sendo usado.

Persistencia real:
- Todos os writes ABA passam por `saveOfflineFirst`.
- `buildAbaIntegrityFields` normaliza `clinicId`, `organizationId`, `source`, `createdAt`, `raw_payload` e `syncStatus` para os payloads ABA.

Pendencias:
- Testar fila offline em navegador real com rede derrubada e posterior sincronizacao.

## Persistencia Por Acao

- Iniciar sessao: `aba_sessions`.
- Tentativa independente: `aba_trials`.
- Tentativa com ajuda: `aba_trials`.
- Erro: `aba_trials`.
- Frequencia: `aba_behavior_events`.
- Iniciar duracao: `aba_behavior_events` com `IN_PROGRESS`.
- Encerrar duracao: `aba_behavior_events` com `COMPLETED`.
- Iniciar intervalo parcial: lifecycle em `aba_interval_records`.
- Responder SIM/NAO: `aba_interval_records`.
- Pausar intervalo: lifecycle em `aba_interval_records`.
- Retomar intervalo: lifecycle em `aba_interval_records`.
- Finalizar intervalo antecipadamente: `aba_interval_summaries` com `PARTIALLY_COMPLETED`.
- Cancelar intervalo: audit em `aba_interval_summaries` com `CANCELLED`.
- Salvar ABC: `aba_abc_events`.
- Encerrar sessao: `aba_sessions`.
- Salvar SessionSummary: `aba_session_summaries`.

## Integridade De Dados

Campos consolidados:
- `clinicId`/`clinic_id` ou equivalente de organizacao nos payloads.
- `patientId`/`patient_id`.
- `sessionId`/`session_id`.
- `therapistId`/`therapist_id`.
- `occurredAt`, `startedAt`, `interval_started_at` ou `createdAt`, conforme tabela.
- `createdAt`/`created_at`.
- `syncStatus`/`sync_status`.
- `source` como `verto_web` e tambem em `raw_payload` quando aplicavel.

Nova migration adiciona `source` nas tabelas clinicas ABA que ainda nao tinham e `occurred_at` em `aba_abc_events`.

## Checklist Manual Mobile

Executar em 360x800, 390x844 e 414x896:

- Iniciar sessao ABA V2.
- Registrar tentativa independente.
- Registrar tentativa com ajuda e selecionar prompt.
- Registrar erro.
- Usar dock clinico com Agressao +1.
- Abrir Mais e registrar comportamento.
- Iniciar duracao pelo dock e encerrar.
- Confirmar badge/estado de duracao ativa.
- Iniciar coleta por intervalo parcial.
- Confirmar RUNNING com Pausar, Finalizar agora e Opcoes visiveis.
- Entrar em AWAITING_RESPONSE e confirmar SIM/NAO sem overlap.
- Pausar coleta e confirmar Retomar, Finalizar agora e Cancelar acima do dock.
- Retomar coleta.
- Finalizar agora com 0 intervalos e confirmar fluxo de cancelamento.
- Finalizar agora com 1+ intervalos e conferir resumo parcial.
- Cancelar coleta e confirmar que nao aparece no resumo principal.
- Abrir modo foco e repetir dock/coleta.
- Confirmar toasts sem cobrir controles criticos.
- Confirmar que nao ha overflow horizontal.

Checklist `aba_v2=false`:

- Definir `VITE_FEATURE_ABA_V2=false` ou override equivalente.
- Abrir prontuario do paciente.
- Confirmar que `SessionMode` nao abre.
- Confirmar que fluxos legados de historico/tarefas/notas continuam iguais.
- Confirmar que endpoints `/api/aba/*` retornam feature desabilitada no backend.

## Arquivos Alterados

- `package.json`
- `server.ts`
- `src/App.tsx`
- `src/components/PatientDetailView.tsx`
- `src/components/SessionMode.tsx`
- `src/services/dataService.ts`
- `src/utils/abaSessionSummary.ts`
- `tests/security.regression.test.mjs`
- `tests/abaMarco1Audit.test.ts`
- `supabase/migrations/20260525110000_aba_v2_marco1_integrity.sql`

## Testes

Novos:
- `npm run test:aba-marco1`

Existentes usados na auditoria:
- `npm run test:security`
- `npm run test:aba-session-summary`
- `npm run test:aba-interval-lifecycle`
- `npm run test:aba-clinical-dock`
- `npm run test:aba-session-feedback`
- `npm run lint`
- `npm run build`

## Pendencias Criticas Antes De Producao

- Aplicar migrations Supabase em staging/producao antes do deploy que envia `source` e `occurred_at`.
- Rodar checklist manual mobile completo em devices pequenos.
- Validar `aba_v2=false` em build/preview com variavel real de ambiente.
- Validar offline real: registrar dados sem rede, religar rede e confirmar sync.

## Proximos Passos Recomendados

1. Congelar Marco 1 apos migrations e checklist mobile.
2. Criar seeds/dados de QA para sessao ABA V2.
3. Antes de graficos, garantir leitura server-side de `aba_session_summaries`.
4. So depois avancar para assinatura, convenio, portal familiar ou maestria avancada.

## Riscos Residuais

- Relatorio atual e basico; PDF/exportacao ainda nao faz parte do Marco 1.
- O ciclo de cancelamento grava auditoria, mas consumidores futuros que leiam registros brutos precisam respeitar `collection_status=CANCELLED`.
- A validacao visual mobile depende de teste manual em viewport real, apesar dos guards automatizados de layout/estado.
