# ADR — ABA V3 PR9A: tentativas categóricas, binding imutável e fronteira Node

## Decisão

PR9A introduz a primeira UI de tentativas V3 sem substituir a coleta Legacy V2 e sem ativar rollout por padrão.

A decisão do modelo clínico não pertence ao React. Para cada `session + target`, a UI solicita uma única vez o binding ao Node, armazena essa decisão em cache durante a sessão e respeita o snapshot imutável retornado pelo PR2. Um target ligado a `LEGACY_V2` continua no fluxo existente; um target ligado a `V3` usa exclusivamente a nova escrita V3.

Se o binding ainda não foi obtido e a resolução falhar, a UI bloqueia a tentativa. Não existe fallback silencioso de V3 para V2.

## Semântica da tentativa V3

A UI envia intenção clínica mínima, nunca matemática derivada pelo browser:

- `INDEPENDENT_CORRECT`;
- `INDEPENDENT_INCORRECT`;
- `NO_RESPONSE`;
- `PROMPTED_CORRECT` + tipo de ajuda persistido.

O Node transforma essa intenção em steps V3 canônicos. `PROMPTED_CORRECT` vira suporte categórico e não cria oportunidade independente artificial. `INDEPENDENT_CORRECT`, `INDEPENDENT_INCORRECT` e `NO_RESPONSE` formam a oportunidade independente explícita.

`independence_score`, `response_score` e qualquer peso 0–100 de prompt não são enviados à persistência V3.

## Tipos de ajuda

Quando `VITE_FEATURE_ABA_V3_UI` está ativo, a interface apresenta ajuda como categoria clínica: nome, categoria e ordem de intrusividade. A pontuação 0–100 e o toggle “conta como independente” deixam de aparecer na experiência V3.

Durante coexistência com V2 ativo, a criação de novos tipos de ajuda fica bloqueada pela UI V3. Isso evita inventar um score Legacy obrigatório para um conceito novo que nasceu categórico. Tipos existentes continuam editáveis sem reescrever seus campos históricos V2.

## Fronteira de segurança

A escrita suportada é:

`browser -> Node autenticado/autorizado -> RPC service_role -> motor V3`

O browser não chama RPCs V3 diretamente. O endpoint Node exige feature flag, autenticação, capability `aba.trial.record`, escopo do paciente, escopo da sessão e limite estrito de payload. O Node monta os steps e faz **uma única RPC transacional por tentativa**; dentro dela o banco resolve/revalida o binding e injeta os IDs imutáveis de versão/fase. Payloads do browser não podem fornecer `steps`, IDs de versão/fase ou scores como autoridade.

O tipo de ajuda usado em `PROMPTED_CORRECT` é relido no banco por `organization_id` e apenas colunas essenciais. Um prompt inativo, inexistente ou fora do tenant não é aceito.

## Persistência offline e idempotência

A tentativa recebe `client_event_id` e usa o outbox já existente (`aba_v3`). O retry usa o mesmo envelope clínico e o motor PR3 continua sendo a autoridade de idempotência/quarentena.

Para `MAINTENANCE_PROBE`, PR9A adiciona `record_aba_trial_action_v3(...)`, uma RPC transacional pequena que compõe:

1. `record_aba_trial_v3(...)`;
2. `open_aba_maintenance_probe_v3(...)`;
3. vínculo da tentativa à probe.

Tentativa e vínculo não podem ficar parcialmente confirmados. Em replay após o fechamento da sessão, um vínculo já existente é reconhecido sem tentar reabrir ou mutar a probe finalizada.

## Encerramento híbrido

Quando a collection API V3 está habilitada, o endpoint de encerramento passa a chamar `complete_aba_session_v3(...)`. Essa RPC já compõe o encerramento Legacy V2 com a finalização V3 na mesma transação. Com a flag desligada, o servidor continua chamando exatamente `complete_aba_session_atomic_v1(...)`.

Assim, ativar o código PR9A não muda o comportamento atual até que a flag seja explicitamente ligada.

## Resumo local

Sessões puramente V2 mantêm exatamente o cálculo Legacy existente, inclusive snapshots ponderados quando presentes. Se houver trial V3 no resumo local, scores 0–100 deixam de ser combinados com a semântica categórica. O denominador V3 usa somente oportunidades independentes explícitas; `PROMPTED_CORRECT` não o infla.

O read model oficial do servidor continua sendo a autoridade clínica. PR10 usará os históricos V3 para gráficos segmentados por fase.


## Limite deliberado do PR9A

A UI/writer desta etapa suporta **somente** targets `dtt`, `net` e `probe`. O endpoint de resolução consulta apenas `id,target_type` uma vez antes de criar o binding imutável; `behavior` e `task_analysis` recebem `ABA_V3_UI_MEASUREMENT_NOT_READY`. A RPC `record_aba_trial_action_v3` repete a checagem no banco para impedir bypass do Node.

Esse bloqueio é intencional: os controles atuais de comportamento/intervalo ainda são Legacy e não representam corretamente `aba_behavior_definitions`, contextos, coletores, runs de intervalo ou steps versionados de task analysis V3. Não existe fallback silencioso dessas famílias para V2. As flags permanecem desligadas até o PR9B fechar essas superfícies.

## Feature flags e rollout

PR9A adiciona/usa três gates independentes, todos dark por padrão:

- `FEATURE_ABA_V3_READ_API=false`;
- `FEATURE_ABA_V3_COLLECTION_API=false`;
- `VITE_FEATURE_ABA_V3_UI=false`.

A migration PR9A não cria nem altera linhas de rollout e não habilita novas sessões V3.
