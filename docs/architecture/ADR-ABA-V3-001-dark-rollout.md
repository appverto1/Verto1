# ADR-ABA-V3-001 — Dark rollout, bindings imutáveis e convivência V2/V3

## Status
Accepted.

## Contexto
A Verto possui dados ABA V2 reais cuja semântica não contém informação suficiente para reconstruir com segurança oportunidades independentes, cadeias intra-trial, tempo ativo de observação ou versão exata do protocolo. Converter esses dados retrospectivamente fabricaria informação clínica.

Ao mesmo tempo, sessões podem permanecer abertas/offline enquanto gates de produto mudam, e um rollback de interface não pode provocar perda dos pacotes V3 ainda não sincronizados.

## Decisão

1. V2 permanece intacta e legível.
2. V3 nasce em tabelas aditivas.
3. O modelo de mensuração é congelado por `(session_id, target_id)` em binding imutável.
4. Fase clínica e versão de coleta são entidades independentes.
5. `allow_new_v3_sessions` e `accept_v3_sync` são gates distintos.
6. Gates nascem `false` e não existe ativação implícita em migration.
7. O servidor continuará aceitando sync V3 legítimo mesmo se novas sessões V3 forem temporariamente bloqueadas.
8. Rollback operacional não remove schema nem reinterpreta histórico.
9. A exceção de continuidade assistencial será um `EMERGENCY_LEGACY_BRIDGE` auditado, nunca uma mutação silenciosa do target V3 para V2.

## Consequências

- mais tabelas e código durante o período de convivência;
- fronteira semântica explícita entre V2 e V3;
- risco muito menor de corrupção histórica;
- rollout reversível no produto sem rollback destrutivo do banco;
- testes de mid-session upgrade e sync offline tornam-se obrigatórios antes do piloto.
