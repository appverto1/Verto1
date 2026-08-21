# SQLs V3 recomendados para retenção no repositório

## 1. `supabase/migrations/` — CANÔNICOS
Manter permanentemente e na ordem original. São parte do schema/contrato da aplicação.
Inclui a fundação ABA V3, Clinical Measurement Engine V3, hardening, shadow mirror, hotfix de projeção, `clinical_note_mentions` exigida pelo deploy atual e o controle operacional de cohorts.

## 2. `supabase/verification/` — VERIFICAÇÃO / FORENSE
Manter para smoke tests, readiness, segurança, paridade, diagnóstico de rollout e auditoria de incidentes.
Em geral são read-only; alguns canários explicitamente executam shadow mirror service-side depois de gates fail-closed. Ler o cabeçalho antes de executar.

## 3. `supabase/operations/history/production-canary/` — HISTÓRICO / RUNBOOK
Scripts usados na promoção e no primeiro canário real de Produção. Mantidos para auditoria e consulta.
**Não tratar como migrations genéricas.** Alguns têm IDs hard-coded do cohort DEMO e não devem ser executados em outro paciente/cliente sem adaptação e novo preflight.

## Arquivos propositalmente NÃO retidos
Versões superseded/defeituosas ou duplicadas, para reduzir risco de execução acidental:
- `20260821006200_clinical_measurement_v3_production_schema_promotion.sql` (monolítico; promoção real foi feita em 4 partes)
- `20260821006300_clinical_measurement_v3_production_cohort_candidates.sql` (assinatura antiga)
- `20260821006400_aba_v3_exact_production_canary_protocol_bootstrap.sql` (superseded pelo 06401)
- `20260821006500_aba_v3_exact_production_canary_rollout_enable.sql` (superseded)
- `20260821006600_clinical_measurement_v3_production_demo_final_canary.sql` (superseded pelo 06601)

## Regra operacional atual
Para rollout futuro, preferir o Control Center/RPC instalado por `20260821006700_aba_v3_operational_cohort_control.sql` em vez dos scripts hard-coded do primeiro canário.
