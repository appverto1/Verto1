# ADR-ABA-V3-004 — Summaries canônicos e reconciliação server-side

## Status
Accepted.

## Contexto
A persistência raw do PR3 é append-only, suporta complex trials e revisões auditadas. O próximo passo precisa oferecer leitura econômica para gráficos sem transformar cache em segunda fonte de verdade, sem aceitar percentuais calculados pelo browser e sem criar lock da sessão inteira quando um único target é retificado.

## Decisão

1. Todo envelope `aba_trials_v3` precisa possuir ao menos um step antes do commit; um constraint trigger diferido impede trials órfãos mesmo em escrita privilegiada/manual.
2. `aba_session_target_summaries_v3` é uma projeção rebuildable, nunca a autoridade clínica.
3. A granularidade é `session_id + target_id + target_phase_assignment_id`; fases diferentes da mesma sessão nunca compartilham a mesma linha.
4. O raw efetivo é definido pela última revisão não-`ANNOTATE`: sem revisão/`RESTORE` permanece efetivo; `VOID`, `CORRECT` e `SUPERSEDE` retiram o envelope original da projeção.
5. Cada trial contribui no máximo uma vez para `eligible_independent_opportunity_count`, porque existe no máximo um step `PRIMARY_INDEPENDENT` por trial.
6. Quando não existe oportunidade independente elegível, `primary_independence_percent` é `NULL`, nunca `0%`.
7. Respostas de suporte/correção não entram no numerador de independência; conclusão após suporte é mantida como contagem separada. Prompts complexos são agregados como `prompt_step_counts` (contagem objetiva de steps), não como uma falsa distribuição percentual por trial.
8. `compute_aba_session_target_summary_projection_v3(...)` é a única implementação matemática e é reutilizada por recompute e verifier.
9. `recompute_aba_session_target_summary_v3(...)` serializa somente `session + target + phase` e faz upsert idempotente da projeção.
10. Inserção bulk de steps usa trigger **statement-level** com transition table; a reconciliação é por segmentos distintos afetados, não uma execução por trial.
11. `VOID`/`RESTORE`/`CORRECT`/`SUPERSEDE` recalculam o segmento afetado na mesma transação da revisão. `ANNOTATE` não força recompute porque não muda a projeção clínica.
12. Correções `CORRECT`/`SUPERSEDE` devem usar `record_aba_trial_correction_v3(...)`, que persiste replacement + revisão na mesma transação; nenhum estado intermediário com os dois envelopes fica visível.
13. `source_projection_hash` identifica deterministicamente o conjunto raw efetivo + última revisão clínica. `verify_aba_session_target_summary_v3(...)` compara o cache persistido contra recompute sem mutar dados.
14. O browser não recebe acesso direto à tabela nem às RPCs. `service_role` lê a projeção e executa as funções; não recebe DML direto no summary.
15. PR4 não altera nenhuma tabela ABA V2, não mistura métricas V2/V3 e não liga `allow_new_v3_sessions`.

## Consequências

- gráficos futuros leem uma linha pequena por target/fase, não milhares de steps;
- uma retificação de um target não bloqueia summaries de outros targets da sessão;
- complex trials não inflam o denominador de independência;
- errorless sem oportunidade primária resulta em independência `N/A`;
- qualquer divergência entre raw e cache pode ser detectada por hash/recompute;
- o summary pode ser apagado/reconstruído tecnicamente sem perda clínica, porque o raw efetivo continua sendo a autoridade.
