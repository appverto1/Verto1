# VERTO WORK COUNCIL

Este arquivo define o conselho da fábrica Verto no modo Work. Ele não é uma lane agendada e não faz polling.

## Papéis
- 00 — Orquestrador/Arquiteto: enquadra, propõe, resolve divergências e congela o contrato.
- 01 PRÉ — Red Team: tenta derrubar contrato/arquitetura/segurança antes da implementação.
- 02 — Produto/UX: avalia fluxo, estados, acessibilidade, responsividade e coerência com o produto real.

Os papéis são lógicos e podem alternar dentro da mesma conversa Work. Não é necessário abrir uma conversa por papel.

## Entrada
O Work recebe uma demanda nova do fundador OU uma Issue em `ADVISORY_REQUIRED`.

Antes de discutir, leia na branch `staging`:
- `docs/factory/GUARDRAILS.md`
- `docs/factory/FACTORY_PROTOCOL.md`
- `.github/VERTO_ENGINEERING_OS.md`
- `.github/agents/00-orchestrator.md`
- `.github/agents/01-auditor.md`
- `.github/agents/02-product-ux.md`
- código real relacionado

GUARDRAILS prevalece.

## Rodada de conselho
1. 00 enquadra a demanda, inspeciona o produto real e propõe a menor solução segura.
2. 01 PRÉ tenta provar que a proposta falha: autorização, isolamento entre clínicas, integridade/persistência, concorrência, LGPD, banco/migrations, Comercial/Super Admin e abuso de regra de negócio.
3. 02, quando houver impacto no que o usuário vê ou faz, avalia fluxo, estados, permissões, responsividade, acessibilidade e padrões existentes.
4. 00 responde às objeções, decide tecnicamente e atualiza a proposta.
5. Repita somente se restar divergência material. Padrão: até 3 rodadas. Máximo: 5, salvo necessidade excepcional comprovada.

Não devolva ao fundador perguntas que possam ser resolvidas pelo código atual, padrões existentes ou decisão técnica. `NEEDS_FOUNDER` somente conforme GUARDRAILS.

## Saída para operação
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

O conselho não implementa código, não abre PR, não faz CI/review, não mergeia e não faz deploy.

## Retorno do operacional
Quando uma Issue estiver `ADVISORY_REQUIRED`, leia `advisory_reason`, evidências, contract_version, branch, head_sha e PR sem descartar trabalho válido já feito.

Se a decisão mudar comportamento, UX, persistência, dados, segurança, integração ou escopo, crie nova `contract_version` e invalide somente os gates afetados.

Se o problema for apenas operacional e o contrato continuar suficiente, não redesenhe: devolva ao papel operacional correto.

Ao concluir, remova `ADVISORY_REQUIRED`, registre a decisão e crie exatamente um próximo handoff.

## Regra de economia de Work
Use a conversa principal para alternar os papéis 00/01/02. Não crie subagentes ou trabalhos paralelos por padrão. Faça novas rodadas apenas quando houver objeção material ainda não resolvida.
