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

1. Aplicar PR12 no banco e no app (PR12 pressupõe PR11 já aplicado).
2. Habilitar apenas `FEATURE_ABA_V3_READ_API=true` e `FEATURE_ABA_V3_PREFLIGHT_API=true`.
3. Manter coleta, UI e rollout-admin desligados.
4. Escolher um paciente de staging sem sessão clínica ativa durante a janela do smoke.
5. Rodar `npm run smoke:aba-v3-preproduction` com organização, paciente e target exatos.
6. O script coleta `preflight-snapshot` antes e depois das leituras e exige o mesmo `scope_fingerprint`.
7. O smoke deve retornar `darkPreflightProfile=true`, `rollout_dark=true`, readiness, `drained=true` e fingerprint idêntico antes/depois.
8. Qualquer diferença de fingerprint é **falha de segurança**: não abrir rollout até identificar a mutação concorrente ou indevida.

### Evidência obrigatória do PR12

O endpoint `GET /api/aba/v3/admin/preflight-snapshot` é restrito a platform admin com MFA e à flag `FEATURE_ABA_V3_PREFLIGHT_API`. Ele executa somente a RPC `get_aba_v3_preflight_scope_snapshot`, que agrega contadores/versões/timestamps canônicos do paciente em uma leitura fixa, sem loop por target e sem writer.

Para aprovar o preflight dark, registrar no ticket/deploy log:

- fingerprint antes;
- fingerprint depois;
- `match=true`;
- `rollout_dark=true`;
- `darkPreflightProfile=true`;
- `drained=true`;
- blockers do readiness (devem estar vazios para o target que será candidato ao piloto).

A assinatura é uma evidência operacional de não-mutação durante o smoke, não substitui backup, auditoria de banco ou controles transacionais dos writers V3.

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
