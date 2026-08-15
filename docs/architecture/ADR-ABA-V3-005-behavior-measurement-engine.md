# ADR — ABA V3 PR5: motor de mensuração comportamental

## Decisão

Comportamentos de redução não reutilizam a semântica de trials. Frequência, taxa e duração possuem fatos próprios. Taxa usa exclusivamente tempo líquido observado do alvo, representado por `aba_behavior_observation_slices_v3`; duração da sessão nunca é fallback silencioso.

O papel do observador é congelado em `aba_behavior_collector_bindings_v3`. Cada segmento sessão + comportamento + contexto admite um único `PRIMARY`; observadores `RELIABILITY` podem coexistir e seus dados não entram no summary oficial do paciente.

Slices podem ser fragmentados por pausas. Overlap é proibido apenas dentro do mesmo collector binding, permitindo comportamentos simultâneos e IOA simultâneo. Conflitos de bulk devem ser isolados/quarentenados antes do insert canônico; não há merge clínico silencioso de ranges.

Cronômetros de observação esquecidos são limitados pelo encerramento da sessão. Episódios de duração cujo final verdadeiro não foi registrado são encerrados tecnicamente no limite da sessão como `is_censored = true`, `end_reason = SESSION_FINALIZATION` e `requires_review = true`.

Summaries são projeções server-side reconstruíveis. O raw efetivo continua sendo a autoridade.
