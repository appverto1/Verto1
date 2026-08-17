# ADR — ABA V3 PR6: probes, fechamento de sessão e FSM clínica

## Decisão

PR6 separa três conceitos que não podem ser confundidos: lifecycle da sonda, elegibilidade matemática da sonda e estado clínico do alvo.

Uma sonda de manutenção possui lifecycle `OPEN | COMPLETE | INCOMPLETE | CANCELLED`. Somente `COMPLETE + ELIGIBLE` produz `PASSED` ou `BELOW_CRITERION`. Uma sonda encerrada com amostra insuficiente é `INCOMPLETE + INELIGIBLE + NOT_EVALUATED`; ela nunca equivale a falha e não participa do contador de alerta. Se um trial ligado a uma probe já encerrada for retificado, a evidência passa a `STALE_REVIEW_REQUIRED` e deixa de contribuir para alertas consecutivos; o sistema não reescreve silenciosamente uma decisão clínica histórica.

O critério utilizado é congelado em `aba_mastery_criterion_versions_v3`. Não existe limiar implícito de 80%. Maestria automática só é avaliada quando o critério publicado contém explicitamente mínimo de oportunidades, threshold e número de sessões consecutivas.

A FSM V3 usa estados objetivos: `ACQUISITION`, `MASTERY_CRITERIA_MET`, `MASTERED`, `MAINTENANCE`, `MAINTENANCE_ALERT`, `REACQUISITION`, `PAUSED`, `DISCONTINUED`. O servidor pode fazer somente duas transições automáticas: aquisição/reaquisição -> critério atingido; manutenção -> alerta de manutenção. `MASTERY_CRITERIA_MET -> MASTERED` e `MAINTENANCE_ALERT -> REACQUISITION` exigem decisão humana auditada.

A inicialização da FSM é explícita. Estado V2 nunca é inferido/backfilled para V3.

## Fechamento

`finalize_aba_session_measurements_v3(...)` fecha timers comportamentais, converte exposures pendentes em `NOT_COLLECTED`, encerra todas as probes `OPEN`, reconcilia summaries por target/fase e só então avalia a FSM.

`complete_aba_session_v3(...)` é um wrapper server-only para o futuro PR9: chama `complete_aba_session_atomic_v1(...)` e a finalização V3 na mesma transação PostgreSQL. O parâmetro `p_legacy_v2_summary` existe apenas para preservar sessões híbridas durante o rollout e nunca alimenta cálculo V3.

PR6 não altera rotas/frontend e não ativa nenhum gate V3.
