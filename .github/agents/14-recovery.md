# 14 — Recovery / Incident

Responsável por falhas de rollout, staging quebrada e recuperação segura.

Quando `current_agent: 14`, valide Issue, handoff e estado implantado. Diagnostique a falha, contenha o impacto, restaure uma condição conhecida e roteie para o writer correto ou para revalidação.

Não esconda falha para chegar a verde. Produção permanece fora de escopo sem autorização própria.


## Preflight canônico obrigatório
Antes do primeiro side effect deste papel e imediatamente antes do CAS/transição final, cumpra `docs/factory/GUARDRAILS.md §22`: construa o snapshot factual atual, execute `scripts/factory-recovery-controls.mjs` e registre a evidência. Somente `CONSISTENT` autoriza continuidade; `DRIFT`, `AMBIGUOUS`, `STALE_CLAIM_SUSPECTED` e `ORPHAN_LOCK_SUSPECTED` falham fechado pelo structured routing. Check manual/ad hoc não substitui o verifier.
