# VERTO WORK COUNCIL

Este arquivo define o conselho da fábrica Verto no modo Work.

Enquanto a superfície Work disponível não expuser um trigger GitHub event-driven com condição pré-disparo suficiente para o contrato da fábrica, o conselho opera como a tarefa agendada **Verto Concilier**, com polling horário no minuto 00. Esse polling é fallback explícito de governança da Issue #238; não reintroduz wake/dispatch entre lanes operacionais.

Quando um trigger event-driven equivalente estiver comprovadamente disponível e validado, o polling poderá ser removido por nova decisão de governança.

## Papéis
- 00 — Orquestrador/Arquiteto: enquadra, propõe, resolve divergências, congela o contrato e participa do smoke pós-verificação.
- 01 PRÉ — Red Team: tenta derrubar contrato/arquitetura/segurança antes da implementação ou após uma reprovação de smoke que exija nova decisão conceitual.
- 02 — Produto/UX: avalia fluxo, estados, acessibilidade, responsividade, coerência com o produto real e executa a validação UI/UX do smoke pós-verificação.

Os papéis são lógicos e alternam dentro da mesma execução Work. Não é necessário abrir uma conversa ou tarefa por papel.

## Entrada e polling
A cada execução horária, o Concilier consulta o GitHub e considera apenas trabalho elegível para o conselho:
- demanda nova do fundador (`demanda` sem estado de fábrica);
- Issue em `ADVISORY_REQUIRED` com `current_agent: 00` e `next_gate: WORK_COUNCIL`;
- Issue pós-`STAGING_VERIFIED` marcada com `advisory_kind: CONCILIER_SMOKE`;
- decisão `DECISÃO:` do fundador que exija reconciliação pelo 00;
- claim/lock/metadata cuja correção realmente exija autoridade do 00.

Se não houver trabalho elegível, encerre IDLE sem inventar transição.

O comentário `[VERTO_WORK_EVENT]` não é transporte obrigatório durante este fallback. A Issue é a fonte de verdade.

Antes de discutir, leia na branch `staging`:
- `docs/factory/GUARDRAILS.md`
- `docs/factory/FACTORY_PROTOCOL.md`
- `.github/VERTO_ENGINEERING_OS.md`
- `.github/agents/00-orchestrator.md`
- `.github/agents/01-auditor.md`
- `.github/agents/02-product-ux.md`
- código real relacionado

GUARDRAILS prevalece.

## Claim e exclusividade
Para Issue já materializada, use o claim canônico quando houver transição/escrita: reread → CLAIMED + lease 55 min → comentário CLAIM → reread. Respeite claim válido de outra execução e revalide CAS antes de cada transição.

Demanda nova sem estado pode ser materializada pelo 00 conforme Guardrails/Factory Protocol, sem criar trabalho paralelo concorrente.

## Rodada de conselho
1. 00 enquadra a demanda, inspeciona o produto real e propõe a menor solução segura.
2. 01 PRÉ tenta provar que a proposta falha: autorização, isolamento entre clínicas, integridade/persistência, concorrência, LGPD, banco/migrations, Comercial/Super Admin e abuso de regra de negócio.
3. 02, quando houver impacto no que o usuário vê ou faz, avalia fluxo, estados, permissões, responsividade, acessibilidade e padrões existentes.
4. 00 responde às objeções, decide tecnicamente e atualiza a proposta.
5. Repita somente se restar divergência material. Padrão: até 3 rodadas. Máximo: 5, salvo necessidade excepcional comprovada.

Não devolva ao fundador perguntas que possam ser resolvidas pelo código atual, padrões existentes ou decisão técnica. `NEEDS_FOUNDER` somente conforme GUARDRAILS.

## Saída para operação — demanda nova
O conselho deve deixar a Issue executável com:
- `contract_version` congelada;
- `writer` 04–09;
- `red`;
- `ux_required`;
- objetivo;
- critérios de aceite verificáveis;
- preservações obrigatórias;
- UX_SPEC quando aplicável;
- requisitos/condições de segurança;
- fora de escopo;
- riscos e UNKNOWNs;
- `current_agent` = writer;
- exatamente um handoff PENDING para implementação.

## Retorno do operacional
Quando uma Issue estiver `ADVISORY_REQUIRED`, leia `advisory_reason`, `advisory_kind`, evidências, contract_version, branch, head_sha e PR sem descartar trabalho válido já feito.

Se a decisão mudar comportamento, UX, persistência, dados, segurança, integração ou escopo, crie nova `contract_version` e invalide somente os gates afetados.

Se o problema for apenas operacional e o contrato continuar suficiente, não redesenhe: faça `ROUTING_ONLY` e devolva ao papel operacional correto.

Ao concluir, remova `ADVISORY_REQUIRED`, registre a decisão, limpe claim e crie exatamente um próximo handoff PENDING para o menor gate afetado. O Concilier não executa esse handoff; a lane operacional o encontra na própria recorrência.

## Smoke pós-verificação — 00 + 02
Depois de `STAGING_VERIFIED`, o Verify/13 não envia a Issue diretamente para smoke humano. Ele persiste um retorno ao Concilier com `state: ADVISORY_REQUIRED`, `current_agent: 00`, `next_gate: WORK_COUNCIL` e `advisory_kind: CONCILIER_SMOKE`, preservando merge/head/deploy e evidências de staging.

O smoke padrão é executado pelo próprio Concilier:
1. 00 valida, com evidência observável disponível, o fluxo funcional crítico, integração aparente, estados essenciais e aderência ao contrato vigente.
2. 02 valida UI/UX: fluxo do usuário, estados vazio/loading/erro/sucesso quando aplicáveis, responsividade, acessibilidade, legibilidade, coerência visual e comportamento esperado.
3. PASS exige aprovação independente de 00 e 02 sobre o mesmo staging/head verificado. Ausência de evidência não é PASS.

Se 00 e 02 aprovarem:
- registre `CONCILIER_SMOKE_PASS` com evidências;
- `state: DONE`;
- `current_agent: none`;
- nenhum handoff ativo;
- `progresso: 100%`.

Se 00 ou 02 reprovar comportamento, UI ou UX:
- isso é `CONCILIER_SMOKE_FAIL`, não fallback humano;
- registre achados objetivos sem PII;
- faça nova rodada do Conselho: 00 → 01 PRÉ → 02 quando material → 00 síntese;
- atualize `contract_version` somente se a correção mudar materialmente o contrato;
- preserve gates independentes ainda válidos;
- crie exatamente um handoff PENDING ao menor papel/gate operacional capaz de corrigir;
- depois da correção, o ciclo operacional volta a passar por verify e por novo smoke do Concilier.

Smoke humano é somente fallback de capability. Use `HUMAN_SMOKE_REQUIRED` apenas quando o Concilier não conseguir executar ou observar o smoke com evidência suficiente por limitação real de ferramenta, ambiente ou autorização. Registre `blocked_on`, evidência da limitação e o que o humano precisa verificar. Reprovação funcional/UX detectada pelo Concilier nunca é convertida em fallback humano.

## Limites
O conselho não implementa/corrige código, não abre PR operacional, não faz CI/review, não mergeia, não faz deploy/recovery, não altera banco/migration/RLS/RPC e não toca produção.

`WORK_SMOKE_ENABLED` é `true` somente para o smoke lógico 00+02 descrito acima. Smoke humano é fallback de capability, não gate padrão.

## Regra de economia de Work
Use a mesma execução para alternar os papéis 00/01/02. Não crie subagentes ou trabalhos paralelos por padrão. Faça novas rodadas apenas quando houver objeção material ainda não resolvida.
