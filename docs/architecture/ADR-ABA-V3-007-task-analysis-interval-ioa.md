# ADR — ABA V3 PR7: Task Analysis, intervalos e IOA

## Decisão

PR7 adiciona três famílias que não devem ser comprimidas no motor de trials DTT: análise de tarefas, amostragem por intervalos e concordância interobservadores.

### Task Analysis

`aba_task_analysis_step_definitions_v3` congela a cadeia de passos dentro de uma `collection_definition_version_id`. Alterar a cadeia exige uma nova versão de coleta; dados antigos nunca mudam de significado.

Cada oportunidade de chaining é um `aba_task_analysis_runs_v3`. Os resultados ficam em `aba_task_analysis_step_results_v3`, uma linha por passo observado. O envelope não duplica resultado clínico. Os códigos são categóricos (`INDEPENDENT`, `PROMPTED`, `INCORRECT`, `NO_RESPONSE`, `NOT_APPLICABLE`, `NOT_OBSERVED`) e não existe score ponderado de prompt.

A projeção `aba_session_task_analysis_summaries_v3` calcula porcentagem de passos independentes somente sobre passos elegíveis observados. `NOT_APPLICABLE` e `NOT_OBSERVED` não entram no denominador. Correções são append-only por `aba_task_analysis_run_revisions_v3`; o raw original permanece preservado.

Task Analysis não é avaliada pelo summary DTT genérico do PR4. PR7 mantém o summary próprio separado para impedir que critérios de trial sejam aplicados acidentalmente a chaining.

### Intervalos

`aba_interval_runs_v3` define um relógio canônico e um método: `PARTIAL_INTERVAL`, `WHOLE_INTERVAL` ou `MOMENTARY_TIME_SAMPLING`. O coletor primário é congelado no início do run.

`aba_interval_observations_v3` armazena uma observação categórica por célula de intervalo/coletor. `NOT_OBSERVED` é explícito e fica fora do denominador. Para MTS, o `sample_at` é derivado do grid server-side; o browser não escolhe um instante arbitrário.

A RPC bulk isola conflitos de idempotência/célula em `aba_sync_quarantine_v3` e continua gravando observações válidas do mesmo lote. Uma retificação não edita o raw: usa `aba_interval_observation_revisions_v3`. Uma nova observação pode ocupar a célula depois que a antiga foi VOID; RESTORE é bloqueado se já houver outra observação efetiva naquela célula.

No fechamento da sessão, runs ainda `OPEN` viram `COMPLETE` quando o primário registrou todos os intervalos planejados; caso contrário viram `PARTIAL`. Nenhum run fica aberto indefinidamente.

### IOA

Dados do `RELIABILITY` nunca são somados ao summary oficial do paciente. `aba_ioa_summaries_v3` é uma projeção separada.

Métodos iniciais explícitos:

- frequência: `TOTAL_COUNT`;
- duração: `TOTAL_DURATION`;
- intervalos: `INTERVAL_BY_INTERVAL`.

Total count/duration só produzem score quando PRIMARY e RELIABILITY possuem a mesma janela ativa de observação. Janelas desalinhadas geram `requires_review` e `ioa_percent = NULL`, em vez de uma porcentagem enganosa. Episódios de duração censurados/abertos também impedem score de duração.

Interval-by-interval compara somente intervalos observados por ambos e usa `agreements / comparable_units`.

## Dark rollout

Todas as tabelas permanecem fail-closed para `anon` e `authenticated`. Escritas suportadas são exclusivamente RPCs `SECURITY DEFINER`; `service_role` recebe leitura das estruturas e execução das RPCs.

PR7 não altera ABA Legacy V2, não ativa `allow_new_v3_sessions` e não altera frontend.

A tela V2 **Tipos de ajuda ABA** continua temporariamente intacta neste PR. A remoção da pontuação 0–100 e da linguagem de “pontuação de independência” pertence ao PR9, quando a interface V3 passar a consumir a semântica categórica nova. Até lá, a UI antiga continua identificada como Legacy V2 e não será usada para cálculo V3.
