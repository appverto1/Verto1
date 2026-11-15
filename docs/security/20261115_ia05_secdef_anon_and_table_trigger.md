# IA-05 — revisão de SECURITY DEFINER e privilégios TRIGGER (Staging)

Data: 2026-11-15. Escopo: exclusivamente Supabase Staging e branch staging. Smoke humano deliberadamente adiado pelo solicitante.

## Diagnóstico real antes da mudança
- 10 funções SECURITY DEFINER executáveis por anon no schema public.
- Sete dessas funções não têm referência direta em políticas RLS cujo papel seja public/anon. Nenhuma das sete é referenciada por funções SECURITY INVOKER ou views segundo catálogo de Staging.
- Três exceções: can_access_clinic(uuid,uuid), can_manage_clinic(uuid,uuid) e is_platform_admin(uuid). Elas aparecem em 6, 7 e 3 políticas PUBLIC respectivamente, e ainda são necessárias para evitar erro nas avaliações de RLS anônimas. **Não revogar, renomear nem alterar sua assinatura sem revisar individualmente as políticas.**
- Essas três aceitam um identificador de ator (ou são invocadas com auth.uid()); diretamente chamadas como RPC com UUID escolhido pelo cliente, podem expor informações de associação ou papel. A revisão posterior deve eliminar oráculos por identidade arbitrária sem violar a semântica dos helpers de autorização interna.
- Da IA-04: 34 funções de gatilho SECURITY DEFINER preservadas, ligadas a 39 triggers instalados em 29 tabelas.
- 18 dessas tabelas, somando 26 dos 39 vínculos, concedem TRIGGER diretamente a anon e authenticated. O restante já estava restrito.
- No schema public, há outros grants TRIGGER fora do escopo da IA-04 (138 tabelas para anon e 158 para authenticated antes da IA-05). Não foram alterados em lote.

## Correção seletiva
Migração: `supabase/migrations/20261115222728_ia05_restrict_anon_helpers_and_table_trigger_grants.sql`.

Revoga EXECUTE de PUBLIC e anon em apenas sete funções: `is_admin_or_owner`, `is_platform_sales_admin`, `patient_file_current_actor_can_read_v1`, `school_actor_can_access_patient`, `school_actor_has_role`, `therapeutic_plan_version_current_actor_can_read_v1`, `therapeutic_program_row_actor_can_access_v1`.
Preserva EXECUTE explícito de authenticated e service_role; não muda corpos das funções, parâmetros, owners nem os relacionamentos.

Revoga somente TRIGGER de PUBLIC, anon e authenticated nas seguintes 18 tabelas:
`aba_behavior_events`, `aba_clinical_recommendation_audit_logs`, `aba_interval_summaries`, `aba_maintenance_probe_results`, `aba_maintenance_schedules`, `aba_regression_alerts`, `aba_sessions`, `aba_target_status_audit_logs`, `aba_targets`, `aba_trials`, `appointments`, `clinics`, `patient_files`, `patient_therapeutic_plans`, `payment_appointment_items`, `payment_audit_events`, `payment_transactions`, `payments`.

Verificações transacionais: baseline de 10 funções, assinatura/owner/grants, nenhuma dependência RLS pública/anon, nenhum consumidor SECURITY INVOKER ou view; tabela com owner postgres, gatilho SECURITY DEFINER instalado e grants esperados. Qualquer divergência provoca rollback integral. Depois verifica ACLs e privilégios de service_role.

Nenhuma alteração em SELECT/INSERT/UPDATE/DELETE, RLS, triggers existentes, registros clínicos, Stripe, autenticação ou código runtime. Sem requests adicionais de produto, polling, N+1, egress/storage extra.

## Evidência, validação e limites
- SQL de inventário: pg_proc, pg_namespace, pg_policies, pg_views, pg_trigger, pg_class, ACLs.
- CI: `tests/ia05SecdefAnonAndTableTriggerAcl.regression.test.mjs`, incluindo cenário PostgreSQL efêmero que comprova que o gatilho existente continua disparando após remover TRIGGER do papel de usuário.
- Staging: ACLs verificadas por SQL após aplicar migração. Smoke real de Salvar, F5, logout/login, clínicas, ABA, arquivos, financeiro e agenda permanece **pendente**.
- **Produção não tocada:** baseline e migrações diferentes. Promoção seletiva condicionada à homologação futura.
- IA-05 seguinte: revisar as três funções que aparecem em RLS pública, eliminar consultas diretas com actor UUID arbitrário onde comprovadamente inseguras, avaliar políticas PUBLIC com roles authenticated e grants TRIGGER adicionais, sem alterar fluxos inadvertidamente.
