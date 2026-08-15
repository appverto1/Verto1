# ADR-ABA-V3-003 — Persistência V3 e sync offline resiliente

## Status
Accepted.

## Contexto
A primeira escrita clínica V3 precisa preservar cadeias intra-trial, sobreviver a retry/offline e nunca reinterpretar um evento antigo com configuração atual. Um erro isolado de sincronização não pode apagar o restante do lote, mas violações cross-tenant precisam falhar fechadas.

## Decisão

1. `aba_trials_v3` é somente o envelope imutável do trial.
2. `aba_trial_steps_v3` é a fonte relacional ordenada do desfecho intra-trial.
3. Cada trial possui no máximo uma oportunidade `PRIMARY_INDEPENDENT` por índice único parcial.
4. Idempotência do envelope é `UNIQUE (organization_id, client_event_id)`; steps usam `UNIQUE (trial_id, sequence_no)` e chave opcional do dispositivo.
5. O bulk ingest aceita até 500 trials por chamada e processa bindings apenas por pares distintos `session_id + target_id`.
6. O binding precisa ser `V3` e a versão do evento precisa ser exatamente a versão congelada no binding.
7. Fase é validada pelo `occurred_at` contra a janela histórica `[effective_from, effective_until)`; fase encerrada no horário do sync continua válida para evento antigo.
8. Versão original marcada `DEPRECATED/ARCHIVED` depois da coleta continua ingerível e recebe `protocol_version_deprecated_at_sync=true`.
9. Versão inexistente, fase ausente/incompatível, sessão ainda ausente e conflitos idempotentes são preservados em `aba_sync_quarantine_v3`.
10. Cross-tenant conhecido não é quarentena: aborta a operação com erro de escopo.
11. A quarentena não oferece De/Para. Uma versão faltante só pode ser reprocessada quando o UUID original existir no servidor.
12. A chegada de um trial válido promove uma exposição para `COLLECTED` apenas uma vez por sessão + target e preserva a transição anterior em auditoria.
13. Trials, steps, revisões e trilhas de auditoria são append-only; não existe hard delete.
14. PR3 não calcula summaries e não expõe qualquer writer ao browser.

## Consequências

- retry depois de timeout é seguro;
- complex trials nunca ficam parcialmente gravados;
- 10 trials offline do mesmo target geram no máximo uma transição efetiva de exposure para `COLLECTED`;
- dados que o servidor ainda não consegue interpretar ficam preservados sem serem fabricados;
- V2 permanece intacta e todo o PR3 continua dark/service-role only.
