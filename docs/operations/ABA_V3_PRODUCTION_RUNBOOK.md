# ABA V3 — Runbook de Produção Default-On

**Estado atual:** `V3_DEFAULT_ON` para alvos semanticamente suportados e com readiness verde.  
**Última consolidação:** 2026-08-23  
**Operação normal:** `DEFAULT_INHERIT`; enrollment positivo não é requisito.

## Objetivo

Manter a ABA V3 operável em Produção sem criar rotina manual diária, semanal ou mensal. A saúde é consultada **sob demanda** após deploy/migration relevante, durante investigação de incidente ou antes/depois de uma alteração explícita do control plane.

## Invariantes de Produção

1. Ausência de override ativo significa herdar `V3_DEFAULT_ON` quando o alvo é elegível e está pronto.
2. `false` explícito permanece kill switch; não é o estado normal de um alvo saudável.
3. Sessão + alvo recebe binding imutável. Mudanças posteriores de rollout não reescrevem a decisão da sessão já iniciada.
4. O primeiro acesso explícito a um alvo planejado como V3 pode materializar o binding, mas **não grava trial, comportamento ou resultado clínico**.
5. Uma ação clínica V3 não cai silenciosamente para writer Legacy depois de falha do V3.
6. Legacy V2 permanece histórico/compatibilidade para bindings antigos, semântica ainda não suportada, emergency bridge ou kill switch explícito.
7. Dados V2 e V3 não são unidos em uma única autoridade matemática.
8. ABC permanece Legacy V2 até existir um contrato V3 próprio; a ausência de ABC não bloqueia o encerramento da sessão.

## Saúde operacional no Super Admin

A tela **Super Admin → Rollout ABA V3** possui o card **Saúde da V3 em produção**. A leitura usa uma única RPC service-role e não altera nenhum dado.

O snapshot global padrão usa os últimos 7 dias para os bindings e expõe:

- bindings recentes V3 / total e razão observada;
- bindings Legacy V2 / emergency bridge por motivo de fallback;
- itens `OPEN` e `READY_FOR_RETRY` em `aba_sync_quarantine_v3`;
- fila de projeções `PENDING`, `PROCESSING` e `FAILED`;
- overrides positivos ainda ativos;
- kill switches explícitos ativos;
- sinal impossível de autoridade mista: mesmo `session_id + target_id` com fatos V2 e V3;
- resultado do security preflight CMV3.

O endpoint é somente para platform admin, depende da feature de preflight e responde `Cache-Control: private, no-store`. O browser não possui `EXECUTE` direto na RPC.

### Interpretação do gate

- `PASS_ABA_V3_PRODUCTION_HEALTH`: nenhuma condição bloqueante/degradada detectada.
- `DEGRADED_ABA_V3_SYNC_QUARANTINE`: há sync em quarentena aguardando resolução/retry.
- `DEGRADED_ABA_V3_PROJECTION_FAILURES`: há projeções em `FAILED`.
- `BLOCKED_ABA_V3_MIXED_AUTHORITY`: existe sessão+alvo recente com escrita V2 e V3; investigar antes de qualquer expansão/retirada de V2.
- `BLOCKED_ABA_V3_SECURITY_PREFLIGHT`: o preflight de segurança não está verde.

Overrides positivos e kill switches aparecem como warnings/control-plane state. Um kill switch pode ser deliberado e, isoladamente, não significa corrupção clínica.

## Quando consultar

Não existe frequência obrigatória. Consulte quando houver uma razão operacional concreta:

1. após migration/deploy que altere V3;
2. após erro clínico, sync ou gráfico reportado;
3. antes/depois de criar ou retirar kill switch;
4. antes de decidir reduzir dependência do V2.

## Default-Inherit e kill switch

O modo normal é **DEFAULT_INHERIT**. Não crie CLINIC/PATIENT/PROGRAM/TARGET positivos apenas para “habilitar” V3.

Para interromper novas sessões V3 de um alvo específico, use a superfície auditada do Control Center durante uma janela curta com `FEATURE_ABA_V3_ROLLOUT_ADMIN=true`. A mudança não converte sessões já abertas.

Para retornar o alvo ao comportamento padrão, retire o override explícito e volte a `DEFAULT_INHERIT`. Não apague linhas históricas de rollout.

## Sync e rollback

Se precisar interromper novas sessões V3:

1. bloqueie novas sessões no escopo desejado;
2. mantenha sync V3 disponível para bindings já congelados e fatos offline legítimos;
3. confira drain/quarentena;
4. somente restrinja sync se o escopo estiver drenado;
5. se surgir fato offline tardio, reabra somente o sync necessário, sem reabrir novas sessões V3.

Nunca reescreva facts, bindings ou histórico V2/V3 para “simplificar” rollback.

## Gates de fechamento já definidos

- Default-On pure inherit: `PASS_PURE_DEFAULT_ON_FRESH_SESSION_BINDING`.
- Métricas analíticas: `PASS_ABA_V3_ANALYTICAL_METRIC_EXPANSION`.
- Bundle analítico: `PASS_ABA_V3_SIMPLIFIED_ANALYTICS_READS`.
- Writer Planos/PTS: `PASS_CMV3_PLAN_WRITER_UI_CONVERGENCE`.
- Observabilidade de Produção: `PASS_ABA_V3_PRODUCTION_OBSERVABILITY` para instalação/ACL da superfície de saúde; o `live_health.gate` representa o estado operacional do momento.

Todos os checks em `supabase/verification/` são read-only salvo indicação explícita em seu próprio cabeçalho.

## Critério para retirar V2

V2 **não deve ser removido apenas porque V3 está Default-On**. A retirada é uma decisão separada e futura. Antes dela, exigir ao menos:

- autoridade mista recente = 0;
- fallback V2 conhecido e explicado;
- quarentena sem backlog persistente;
- fila de projeções sem falhas persistentes;
- nenhuma semântica necessária dependendo exclusivamente de V2;
- compatibilidade histórica preservada sem backfill inventado.

Até essa decisão, V2 é uma camada histórica/compatibilidade e não deve ser reescrito nem apagado.
