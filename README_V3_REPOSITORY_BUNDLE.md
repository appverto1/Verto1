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

Em um ambiente novo, aplique as migrations em ordem cronológica. Em Produção, não reaplique manualmente migrations já executadas apenas porque elas estão neste pacote.

## Estrutura

- `supabase/migrations/`: migrations canônicas e hotfixes que devem permanecer no histórico do repositório.
- `supabase/verification/`: checks, readiness, canários, diagnósticos e attestations úteis; não fazem parte da sequência automática de migrations.
- `supabase/operations/history/production-canary/`: operações manuais históricas do primeiro rollout/canário; manter apenas para auditoria e referência, não como rotina operacional.
- `docs/operations/`: runbook do Control Center.
- `tests/`: regressões específicas desta etapa.
- `server.ts` e `src/components/...`: arquivos de código mais recentes desta etapa, incluindo o hotfix de `clinical_date` por timezone congelado.

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
