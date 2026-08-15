# ADR-ABA-V3-002 — Resolver histórico e imutável por sessão + target

## Status
Accepted.

## Contexto
Um terapeuta pode abrir uma sessão antes de uma mudança de rollout e sincronizar
mais tarde. Avaliar feature flags no horário do sync produziria mid-session upgrade
e reinterpretaria uma sessão antiga com estado novo.

Também é necessário impedir que duas requisições concorrentes decidam versões
diferentes para o mesmo target da mesma sessão.

## Decisão

1. `decision_at = aba_sessions.started_at`.
2. Rollout é reconstruído pela trilha de eventos usando `effective_from`.
3. Rollout identity é imutável; mudança dos switches exige nova `effective_from`
   não retroativa.
4. A política inicial de piloto requer `CLINIC + PATIENT + (TARGET ou PROGRAM)`.
   `TARGET` prevalece sobre `PROGRAM`.
5. Um binding V3 exige `allow_new_v3_sessions=true` e `accept_v3_sync=true` em
   todos os gates aplicáveis.
6. O resolver é service-role only e não é exposto ao browser no PR2.
7. A resolução é serializada por advisory transaction lock no par sessão/target,
   com `UNIQUE(session_id, target_id)` como proteção definitiva.
8. Binding existente sempre vence e é retornado sem mutação.
9. `EMERGENCY_LEGACY_BRIDGE` é um episódio explicitamente auditado e não um
   rollback semântico de V3 para V2.

## Consequências

- sync tardio de uma sessão iniciada antes do rollout permanece V2;
- ativação no meio do atendimento só vale para sessões/bindings posteriores;
- backdating de gate é proibido;
- configuração incompleta de V3 falha fechada;
- nenhuma rota V2 precisa mudar neste PR.
