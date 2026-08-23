# Verto — V3 repository bundle

Pacote consolidado para manter no repositório após a implantação e validação da Clinical Measurement Engine V3 / ABA V3 em Produção.

## Regra mais importante: migrations são histórico imutável

Os arquivos em `supabase/migrations/` representam a sequência real relevante. Não substitua migrations já aplicadas por versões "corrigidas" com o mesmo timestamp.

Exemplos importantes:

- `20260821006700_aba_v3_operational_cohort_control.sql` permanece como migration original.
- `20260821006701_aba_v3_operational_snapshot_clock_hotfix.sql` corrige o relógio operacional depois dela.
- `20260821006802_aba_v3_target_protocol_autobootstrap.sql` permanece como migration original executada.
- `20260821006805_aba_v3_target_protocol_pgcrypto_schema_hotfix.sql` corrige a qualificação de `extensions.digest(...)` depois dela.
- `20260821006806_aba_v3_default_on_session_collection_plan_alignment.sql` alinha o preview/collection-plan à política default-on.
- `20260821006810_aba_v3_default_on_override_lifecycle.sql` formaliza `DEFAULT_INHERIT`, mantendo `false` como kill switch explícito e preservando a linhagem histórica dos overrides.

Em um ambiente novo, aplique as migrations em ordem cronológica. Em Produção, não reaplique manualmente migrations já executadas apenas porque elas estão neste pacote.

## Estrutura

- `supabase/migrations/`: migrations canônicas e hotfixes que devem permanecer no histórico do repositório.
- `supabase/verification/`: checks, readiness, canários, diagnósticos e attestations úteis; não fazem parte da sequência automática de migrations.
- `supabase/operations/history/production-canary/`: operações manuais históricas do primeiro rollout/canário; manter apenas para auditoria e referência, não como rotina operacional.
- `docs/operations/`: runbook do Control Center.
- `tests/`: regressões específicas desta etapa.
- `server.ts` e `src/components/...`: arquivos de código mais recentes desta etapa, incluindo o hotfix de `clinical_date` por timezone congelado.


## Fechamento operacional Default-On

Os artefatos finais do rollout ficam separados por responsabilidade:

- `supabase/migrations/20260821006810_aba_v3_default_on_override_lifecycle.sql`: schema/contrato estrutural reutilizável em qualquer ambiente.
- `supabase/verification/20260821006808_aba_v3_default_on_selected_session_attestation.sql`: attestation end-to-end da sessão selecionada.
- `supabase/operations/history/production-canary/20260821006811_aba_v3_retire_legacy_positive_canary_overrides.sql`: transição operacional histórica e específica dos dois overrides do canário; nunca deve rodar automaticamente em ambiente novo.
- `supabase/verification/20260821006812_aba_v3_default_on_pure_inherit_ui_binding_attestation.sql`: primeira versão read-only da atestação pure-inherit; preservada por histórico.
- `supabase/verification/20260823182500_aba_v3_default_on_pure_inherit_ui_binding_attestation_v2.sql`: gate read-only atual. Seleciona primeiro a sessão pós-retirement mais recente e depois verifica seu binding, evitando mascarar uma sessão nova sem binding com uma sessão antiga já vinculada.

O gate final esperado da versão `v2` é `PASS_PURE_DEFAULT_ON_FRESH_SESSION_BINDING`. A presença do arquivo no repositório não prova que o gate foi executado em Produção; o resultado operacional deve ser registrado separadamente.

## SQLs propositalmente não recuperados como canônicos

Versões quebradas/superseded do caminho de validação (por exemplo 06300, 06400 e 06600) não devem ser usadas como referência operacional. O pacote anterior já mantinha apenas as versões corrigidas relevantes, como 06301, 06401 e 06601.

## Política atual

- ABA V3: `V3_DEFAULT_ON` quando o alvo é semanticamente suportado e readiness está verde.
- V2: histórico, bindings já congelados, emergency bridge, semântica ainda não suportada, readiness blocker ou kill switch explícito.
- `false` explícito no rollout: kill switch.
- ausência de rollout: herda default-on se elegível/pronto.
- sessão já iniciada: nunca troca de engine no meio.
- dados V2 históricos: nunca reescritos retroativamente.

## Observação sobre o último teste

O attestation `06807` revelou um bug de `clinical_date`/timezone no código da aplicação, não uma migration faltante. A correção está nos arquivos de código e no regression test incluídos neste bundle. Não há migration SQL para esse hotfix.

## Expansão analítica canônica — Bloco 3

A migration `20260823184500_aba_v3_analytical_metric_expansion.sql` completa o read model analítico sem alterar fatos clínicos. Ela adiciona:

- habilidades: `FINAL_COMPLETION_ACCURACY_PERCENT` e `EFFECTIVE_TRIAL_COUNT`, preservando `PRIMARY_INDEPENDENCE_PERCENT`;
- comportamentos: `BEHAVIOR_DURATION_EPISODES` e `BEHAVIOR_DURATION_AVG`, preservando frequência, taxa/h, duração total e intervalos;
- `EFFECTIVE_TRIAL_COUNT` com direção `NO_DIRECTIONAL_JUDGMENT`, porque volume de coleta não é melhora clínica;
- média de duração calculada somente sobre episódios concluídos; episódios censurados/abertos não entram no denominador e sinalizam revisão na duração total/média;
- ordem semântica das métricas no RPC canônico.

A camada de apresentação agrupa percentuais, taxa/h e duração média usando numerador/denominador canônicos. Assim, duas sessões no mesmo dia não são combinadas por média simples quando possuem exposições diferentes.

O check read-only correspondente é `supabase/verification/20260823184600_aba_v3_analytical_metric_expansion_checks.sql`. O PASS esperado é `PASS_ABA_V3_ANALYTICAL_METRIC_EXPANSION`.
