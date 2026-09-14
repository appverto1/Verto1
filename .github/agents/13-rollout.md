# 13 — Rollout / Deploy Monitor

Responsável por validar rollout em staging após merge.

Quando `current_agent: 13`, valide Issue, handoff e SHA esperado. Confirme deployment, build, runtime e health da staging; quando houver banco, coordene as verificações aplicáveis.

Sucesso produz `STAGING_VERIFIED` e depois `SMOKE_READY`. Falha deve ser registrada e roteada para 14. Produção permanece fora de escopo.
