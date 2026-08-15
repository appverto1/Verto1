# ABA V3 — Runbook do primeiro piloto

## Objetivo

Ativar um único cohort de forma auditável, reversível e sem mudar o comportamento das sessões Legacy V2 fora do escopo escolhido.

## Estado inicial obrigatório

- `FEATURE_ABA_V3_READ_API=false`
- `FEATURE_ABA_V3_COLLECTION_API=false`
- `FEATURE_ABA_V3_PREFLIGHT_API=false`
- `FEATURE_ABA_V3_ROLLOUT_ADMIN=false`
- `VITE_FEATURE_ABA_V3_UI=false`
- nenhuma linha de rollout com `allow_new_v3_sessions=true` ou `accept_v3_sync=true`

## Fase 1 — preflight dark

1. Aplicar PR11 no banco e no app.
2. Habilitar apenas `FEATURE_ABA_V3_READ_API=true` e `FEATURE_ABA_V3_PREFLIGHT_API=true`.
3. Manter coleta, UI e rollout-admin desligados.
4. Rodar `npm run smoke:aba-v3-preproduction` com organização, paciente e target exatos.
5. O smoke deve ser somente leitura, retornar readiness e `drained=true` e não alterar rollout.

## Fase 2 — preparar runtime sem cohort

1. Habilitar `FEATURE_ABA_V3_COLLECTION_API=true` e `VITE_FEATURE_ABA_V3_UI=true`.
2. Manter `FEATURE_ABA_V3_ROLLOUT_ADMIN=false`.
3. Confirmar uma sessão Legacy fora do piloto: o plano deve retornar `LEGACY_V2`; nenhum binding V3 deve ser criado por simples renderização ou clique Legacy.
4. Confirmar que a configuração global de “Tipos de ajuda ABA” mantém os campos de compatibilidade V2 enquanto `FEATURE_ABA_V2` continuar habilitada; esses scores não entram na coleta V3.
5. Confirmar que ABC continua Legacy V2.

## Fase 3 — abrir cohort

A mutação é permitida somente para platform admin com MFA e somente durante uma janela operacional curta:

1. Habilitar temporariamente `FEATURE_ABA_V3_ROLLOUT_ADMIN=true`.
2. Executar readiness do target imediatamente antes da mutação.
3. Ativar hierarquia necessária: `CLINIC`, `PATIENT` e `TARGET`/`PROGRAM`, sempre com `allow_new_v3_sessions=true` **e** `accept_v3_sync=true`.
4. Usar `expected_state_version` em toda atualização já existente.
5. Desabilitar `FEATURE_ABA_V3_ROLLOUT_ADMIN` após a operação.

Nenhuma sessão iniciada antes do `effective_from` muda de modelo retroativamente: a decisão usa `session.started_at`.

## Rollback seguro

1. Reabrir temporariamente a flag de rollout-admin.
2. No escopo enrolado, aplicar `allow_new_v3_sessions=false` e manter `accept_v3_sync=true`.
3. Desligar rollout-admin novamente.
4. Consultar `drain-status` até `drained=true`; resolver quarentena antes de prosseguir.
5. Reabrir rollout-admin e aplicar `allow_new_v3_sessions=false`, `accept_v3_sync=false`.
6. Consultar `drain-status` novamente imediatamente após a mudança. Se surgir qualquer fato tardio/offline não drenado, reabilitar **somente** `accept_v3_sync=true` com `allow_new_v3_sessions=false`, processar a pendência e repetir a drenagem. Esse estado de recuperação não depende de UI/coleta estarem ligadas.
7. Desligar rollout-admin somente após a segunda verificação retornar `drained=true`.

Nunca desligar sync antes da drenagem. Durante rollback, `allow_new_v3_sessions=false` faz novas sessões não vinculadas permanecerem no Legacy V2, enquanto bindings V3 já congelados continuam V3 até finalizar. Dados V3 históricos, bindings e revisões permanecem preservados.
