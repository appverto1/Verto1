# ADR — ABA V3 PR8: read models canônicos e fronteira Node

## Decisão

PR8 cria a camada de leitura V3 sem ativar coleta V3 e sem alterar a UI Legacy V2.

O browser não recebe `SELECT` direto nas tabelas ou views V3. A fronteira suportada é:

`browser -> Node autenticado/autorizado -> RPC service_role -> views/projeções V3`

Isso mantém a autorização clínica no backend e reduz a chance de um erro futuro no frontend se transformar em IDOR ou leitura cross-tenant.

## Read models

As views V3 expõem somente contexto de apresentação e projeções calculadas pelo servidor. Raw trials, raw behavior events, payloads offline e revisões não são enviados pelo read path padrão.

- `aba_session_target_read_v3`: DTT/NET canônico por sessão + target + fase;
- `aba_session_task_analysis_read_v3`: chaining categórico separado do DTT;
- `aba_session_behavior_read_v3`: somente summary oficial `PRIMARY`;
- `aba_session_interval_read_v3`: somente interval summary oficial `PRIMARY`;
- `aba_session_ioa_read_v3`: reliability/IOA separado do resultado clínico oficial;
- `aba_maintenance_probe_read_v3`: lifecycle, elegibilidade e revisão explícita;
- `aba_target_state_read_v3`: estado clínico V3 e critério publicado;
- `aba_session_target_binding_read_v3`: snapshot imutável de configuração usado pela futura UI V3.

Nenhum read model usa `independence_score` ou `response_score`. Prompts permanecem categorias/contagens (`prompt_step_counts` e `prompt_counts`).

## Registre 1x, leia várias

Três RPCs atendem os casos de leitura sem N+1 no Node:

- `get_aba_session_read_bundle_v3`: uma chamada retorna configuração + targets + task analysis + behaviors + intervals + IOA + probes da sessão;
- `get_aba_patient_overview_v3`: uma chamada retorna estados atuais e contadores pequenos de revisão;
- `get_aba_target_history_v3`: uma chamada retorna histórico limitado e temporalmente filtrado do target.

`get_aba_target_history_v3` aplica limite server-side de no máximo 180 registros por família e rejeita janelas acima de 366 dias. O endpoint não oferece full load irrestrito.

Índices adicionais são criados somente nas tabelas V3 de summaries que ainda não possuíam um caminho composto por tenant/paciente/sessão. Nenhuma tabela V2 é alterada.

## Defesa em profundidade

O Node exige feature flag, sessão autenticada, capability `aba.analytics.view` e escopo do paciente/sessão. As RPCs repetem a validação de `organization_id + patient_id + session/target`, mesmo sendo chamadas via `service_role`.

Views e RPCs são revogadas de `public`, `anon` e `authenticated`. Somente `service_role` recebe `SELECT/EXECUTE`.

O feature flag `FEATURE_ABA_V3_READ_API` é **false por padrão**. PR8 pode ser aplicado em staging/produção em modo dark sem tornar a V3 acessível pela interface.

## Semântica clínica preservada

- reliability/IOA não é somado a comportamento/intervalo oficial;
- `NULL` continua significando medida não avaliável, não zero;
- DTT e Task Analysis permanecem famílias separadas;
- cada ponto histórico preserva `phase_assignment_id` para que o PR10 faça segmentação de gráficos sem ligar fases diferentes;
- V2 e V3 não são fundidos em uma série clínica única.

## Limite intencional deste PR

PR8 não muda nenhum componente React e não corrige visualmente a tela Legacy V2 **Tipos de ajuda ABA**. Essa correção pertence ao PR9, quando a UI V3 passará a representar prompts categoricamente e a pontuação 0–100 deixará de ser apresentada como “pontuação de independência”.

PR8 também não ativa `allow_new_v3_sessions` nem `accept_v3_sync`.
