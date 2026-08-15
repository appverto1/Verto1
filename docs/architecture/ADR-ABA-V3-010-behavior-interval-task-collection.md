# ADR — ABA V3 PR9B: comportamento, intervalos e Task Analysis

## Decisão

PR9B completa a superfície de coleta V3 que o PR9A deixou explicitamente bloqueada. Comportamento, interval recording e Task Analysis passam a ter writers próprios e nunca são redirecionados para tabelas Legacy quando a decisão clínica é V3.

A migration e as rotas permanecem dark. Nenhuma linha de rollout é criada ou alterada.

## Identidade comportamento -> target

A Verto não pode inferir identidade clínica por texto. `aba_behavior_definitions.id` é o identificador canônico do comportamento e `aba_targets.id` é o identificador canônico do target. A relação é uma entidade explícita em `aba_behavior_target_bindings_v3`.

Somente owner/admin/director/coordinator pode criar ou arquivar o vínculo. Há no máximo um vínculo `ACTIVE` por paciente + comportamento. Corrigir um vínculo exige `ARCHIVED` com ator, timestamp e motivo; o registro anterior é preservado e sua identidade não pode ser atualizada ou apagada.

A primeira resolução de cada `session + behavior` é congelada em `aba_session_behavior_collection_bindings_v3`, inclusive quando a decisão é `LEGACY_V2` por ausência de mapeamento. Por isso um novo vínculo afeta somente sessões futuras. Uma sessão em andamento não muda de target/modelo por alteração de configuração e um `aba_session_target_measurement_bindings` já criado nunca é reescrito.

Comportamento sem vínculo explícito continua Legacy V2. Não existe comparação de nomes, slug fuzzy, fallback de target ou backfill automático.

## Comportamentos

A UI usa o catálogo canônico do paciente, carregado em lote e mantido no estado da sessão. Frequência, rate e duração usam a superfície V3 do PR5:

- frequência/rate occurrence -> evento append-only;
- duração -> episódio com START/STOP idempotentes;
- rate -> observation slice explícito como denominador;
- somente collector `PRIMARY` alimenta a projeção clínica oficial.

Ações incompatíveis com `measurement_type` são recusadas no banco. Um PRIMARY concorrente para o mesmo segmento é recusado.

ABC não é convertido. Enquanto não houver um modelo ABC V3 próprio, um comportamento resolvido como V3 recebe bloqueio explícito para ABC. Persistir esse dado na tabela V2 seria mistura semântica e é proibido.

## Intervalos

Run creation é server-confirmed e produz o UUID canônico antes de a UI depender dele. Observações reutilizam o bulk/idempotência do PR7 e a finalização reutiliza `finalize_aba_interval_run_v3`.

A UI não grava lifecycle/summaries V2 em paralelo. Pausa V2 é bloqueada para V3 porque uma grade fixa não pode remover tempo do denominador sem uma nova definição clínica/versionada. `NOT_OBSERVED` permanece um resultado explícito.

## Task Analysis

Targets `task_analysis` deixam de ser rejeitados pela resolução de binding e passam por uma rota própria. A definição vem de `aba_task_analysis_step_definitions_v3` ligada ao `collection_definition_version_id` congelado no binding.

Uma travessia é persistida como um run atômico. Resultados são categóricos; `PROMPTED` exige prompt ativo/show-in-session do tenant. Scores 0–100 não fazem parte da API nem da matemática V3.

## Persistência e concorrência

Eventos mutacionais reaproveitam o outbox `aba_v3`, que preserva ordem causal e bloqueia overtaking de uma mutação posterior da mesma entidade quando a anterior não foi resolvida. Chaves de cliente tornam retries idempotentes.

Ações estruturais que precisam retornar identidade server-side, principalmente criação de interval run, não fingem sucesso offline: a UI só abre o estado dependente depois de receber o ID canônico.

## Segurança

A fronteira suportada permanece:

`browser -> Node -> RPC service_role -> tabelas V3`

Cada rota exige feature flag, sessão autenticada, capability, escopo do paciente e da sessão e limite de payload. Novas tabelas têm RLS habilitado e `anon/authenticated` não recebem acesso direto. RPCs `SECURITY DEFINER` usam `search_path` fixo e validam tenant/ator novamente.

## Imutabilidade da UI

Registros V3 não usam os botões Legacy de editar/apagar. A interface mostra estado imutável e futuras correções devem passar por eventos de revisão V3. Isso evita que uma ação antiga faça hard update/hard delete em fatos clínicos novos.

## Rollout

As três flags continuam `false` por padrão:

- `FEATURE_ABA_V3_READ_API=false`;
- `FEATURE_ABA_V3_COLLECTION_API=false`;
- `VITE_FEATURE_ABA_V3_UI=false`.

PR10 adicionará gráficos segmentados, configuração do piloto e smoke/gates de rollout. Produção não é habilitada pelo PR9B.
