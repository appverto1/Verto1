# Épico 12 - Gráficos Clínicos Summary-Driven

Data: 2026-05-25

## Auditoria dos gráficos existentes

| Gráfico / painel | Arquivo / componente | Rota/API usada | Tabelas consultadas | Summary ou query bruta | Limit/date range | Agregação | Risco egress | Recomendação |
|---|---|---|---|---|---|---|---|---|
| Comparativo de desempenho | `src/components/Charts.tsx` via `PatientDetailView` | Dados já carregados do prontuário | `history`, protocolos locais | Query bruta indireta de histórico | `dataService.getPatientHistory` usa `limit=20`; filtros locais por data | Front | Médio | Manter por ora como não ABA; criar épico para snapshots por protocolo não ABA. |
| Evolução por domínio | `src/components/Charts.tsx` via `PatientDetailView` e `PatientDashboard` | Dados já carregados do prontuário | `history`, `tasks`/protocolos | Query bruta indireta | Limitado por endpoints de histórico/tarefas | Front | Médio | Não migrado neste épico; documentado como legado não ABA. |
| Radar individual por domínio | `src/components/RadarDomainAssessmentChart.tsx` | Props do prontuário/coordenador | `history`, protocolos | Query bruta indireta | Sem date range próprio no componente | Front | Médio | Criar summary não ABA por domínio em épico próprio. |
| Crescimento cumulativo | `src/components/CumulativeGrowthChart.tsx` | Props do prontuário/paciente | `history`, protocolos | Query bruta indireta | Sem date range próprio no componente | Front | Médio | Criar snapshot de habilidades dominadas por paciente em épico próprio. |
| Status das habilidades por domínio | `src/components/StackedDomainStatusChart.tsx` | Props do dashboard coordenador | `history`, `patients`, protocolos | Query bruta indireta | Sem date range próprio no componente | Front | Médio | Criar agregação backend por protocolo/domínio. |
| Relatório PDF de progresso | `src/components/ProgressReportPDFLayout.tsx` | Dados preparados no front | `history`, protocolos | Query bruta indireta | Período escolhido no relatório | Front | Baixo/Médio | Mantido; PDF fora do escopo deste épico. |
| DRE admin | `src/components/AdminDashboard.tsx` | `/api/admin/dre` | Views/consultas financeiras | Summary/view | Endpoint com payload agregado | Backend | Baixo | Sem ação. |
| DRE coordenador | `src/components/CoordinatorDashboard.tsx` | `/api/payments`, estado financeiro | `payments` | Query bruta paginada/limitada | Endpoints com limit | Front/backend | Médio | Não ABA; abrir épico financeiro se precisar consolidar views. |
| Owner financial charts | `src/components/SuperAdminDashboard.tsx` | `/api/owner/dre` | `vw_owner_dre_*` | Summary/view | `limit(12/20)` | Backend | Baixo | Sem ação. |
| Gráficos ABA clínicos | Novo `src/components/AbaClinicalChartsPanel.tsx` | `/api/aba/patients/:patientId/charts/*` | `aba_session_metric_snapshots`, summaries ABA | Summary-driven | `dateFrom/dateTo`, `limit`, filtros | Backend | Baixo | Implementado neste épico. |

## Gráficos ABA migrados/criados

- `GET /api/aba/patients/:patientId/charts/targets`
- `GET /api/aba/patients/:patientId/charts/behaviors`
- `GET /api/aba/patients/:patientId/charts/mastery`
- `GET /api/aba/patients/:patientId/charts/maintenance`
- `GET /api/aba/patients/:patientId/charts/session-changes`
- `GET /api/aba/patients/:patientId/charts/overview`
- `POST /api/aba/patients/:patientId/charts/annotations`

Todos usam seleção explícita, escopo por `organization_id`/`clinic_id`/`patient_id`, filtros de período e limite de pontos. Não usam realtime nem retornam eventos brutos em massa.

## Queries brutas removidas/evitadas

- Os gráficos ABA novos não consultam `aba_trials`, `aba_behavior_events` ou `aba_interval_records` para renderização.
- O endpoint de comportamentos consulta `aba_behavior_daily_summaries` e usa `aba_session_metric_snapshots` quando há deltas por sessão.
- O endpoint de targets usa `aba_session_metric_snapshots`, gerado a partir de `aba_target_live_summaries` e `aba_session_summaries`.
- Maestria e manutenção usam `aba_mastery_evaluations`, `aba_maintenance_*`, `aba_regression_alerts` e snapshots.

## Tabelas novas

- `aba_session_metric_snapshots`
- `aba_graph_annotations`

## Como a detecção de mudança funciona

Ao salvar `aba_session_summaries`, o servidor chama `buildSessionMetricSnapshots(sessionId)`.

O motor compara a sessão encerrada com a sessão anterior válida do mesmo paciente:

- targets: acurácia, independência e número de tentativas;
- comportamento: frequência, duração total, duração média e ocorrência por intervalo;
- maestria: status atual contra status anterior;
- manutenção: `MAINTAINED`, `WATCH` e `REGRESSION_RISK`.

Direcionalidade:

- `HIGHER_IS_BETTER`: targets de aquisição;
- `LOWER_IS_BETTER`: frequência/duração/intervalo de comportamentos de redução;
- `STATUS_BASED`: maestria, manutenção e regressão.

Thresholds iniciais:

- menos de 5%: estável;
- 10% ou mais: mudança relevante;
- `READY_FOR_REVIEW`: mudança clinicamente significativa;
- `REGRESSION_RISK`: sinal de regressão.

## Pendências

- Migrar gráficos não ABA baseados em `history`/protocolos para summaries próprias.
- Criar views clínicas não ABA por domínio/protocolo para `RadarDomainAssessmentChart`, `CumulativeGrowthChart` e `StackedDomainStatusChart`.
- Permitir configuração dos thresholds por clínica em tabela própria.
- Expandir anotações com edição/remoção e renderização avançada por linha de condição no eixo X.
