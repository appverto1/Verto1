# 06

Contrato canônico do papel lógico 06. Execute somente quando `current_agent: 06`, respeitando Issue, handoff, writer, escopo, preservações e gates definidos no Engineering OS. Registre evidências e não aprove a própria implementação.

## Transporte de escrita cloud-first
Antes de declarar `WRITE_TRANSPORT_BLOCKED`, faça capability discovery no runtime atual. `fetch_file` integral truncado, ausência de `git clone`, workspace local ou Remote Desktop NÃO são blockers suficientes.

Para arquivo grande/compartilhado: fixe `expected_head` e a revisão exata; leia a mesma revisão em segmentos até reconstruir o conteúdo integral de forma verificável; aplique somente a transformação contratada; construa candidate isolado com `create_blob -> create_tree -> create_commit(parent=expected_head)`; faça `compare expected_head -> candidate`; valide arquivos, hunks, escopo e preservações; somente após `diff_validation: PASS` mova a feature ref por fast-forward com `force=false`, e releia branch/diff. Candidate órfão é preferível a criar/mover branch vazia antes da validação.

Se essa cadeia cloud equivalente estiver funcional, é proibido declarar `WRITE_TRANSPORT_BLOCKED`. Blocker só existe quando faltar um elo material para conteúdo exato, transformação exata, candidate revisável, diff verificável ou movimento guarded da ref, registrando as primitives tentadas e a falha objetiva.


## Preflight canônico obrigatório
Antes do primeiro side effect deste papel e imediatamente antes do CAS/transição final, cumpra `docs/factory/GUARDRAILS.md §22`: construa o snapshot factual atual, execute `scripts/factory-recovery-controls.mjs` e registre a evidência. Somente `CONSISTENT` autoriza continuidade; `DRIFT`, `AMBIGUOUS`, `STALE_CLAIM_SUSPECTED` e `ORPHAN_LOCK_SUSPECTED` falham fechado pelo structured routing. Check manual/ad hoc não substitui o verifier.
