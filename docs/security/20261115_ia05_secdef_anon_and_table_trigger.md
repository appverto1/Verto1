# IA-05 — revisão de SECURITY DEFINER e privilégios TRIGGER (Staging)

Data: 2026-11-15. Escopo: exclusivamente Supabase Staging e branch staging. Smoke humano deliberadamente adiado pelo solicitante.

## Diagnóstico real antes da mudança
- 10 funções SECURITY DEFINER executáveis por anon no schema public.
- Sete dessas funções não têm referência direta em políticas RLS cujo papel seja public/anon. Nenhuma das sete é referenciada por funções SECURITY INVOKER ou views segundo catálogo de Staging.
- Três funções adicionais — can_access_clinic(uuid,uuid), can_manage_clinic(uuid,uuid) e is_platform_admin(uuid) — participavam de 15 políticas RLS PUBLIC (6, 7 e 3 ocorrências). A segunda migração restringiu **somente as roles** dessas 15 políticas para authenticated, preservando seus comandos e expressões USING/WITH CHECK com fingerprint MD5. Como todas utilizavam auth.uid() e não autorizavam anon, essa alteração remove a dependência de execução anônima sem conceder acesso novo.
- Essas três aceitam identificador de ator e permanecem executáveis por authenticated para servir RLS. Podem constituir oráculos de associação ou papel quando chamadas diretamente com UUID de terceiro; essa exposição autenticada exige revisão de contrato e solução própria, sem bloquear queries RLS.
- Da IA-04: 34 funções de gatilho SECURITY DEFINER preservadas, ligadas a 39 triggers instalados em 29 tabelas.
- 18 dessas tabelas, somando 26 dos 39 vínculos, concedem TRIGGER diretamente a anon e authenticated. O restante já estava restrito.
- No schema public, há outros grants TRIGGER fora do escopo da IA-04 (138 tabelas para anon e 158 para authenticated antes da IA-05). Não foram alterados em lote.

## Correção seletiva
Migração: `supabase/migrations/20261115222728_ia05_restrict_anon_helpers_and_table_trigger_grants.sql`.

Revoga EXECUTE de PUBLIC e anon em apenas sete funções: `is_admin_or_owner`, `is_platform_sales_admin`, `patient_file_current_actor_can_read_v1`, `school_actor_can_access_patient`, `school_actor_has_role`, `therapeutic_plan_version_current_actor_can_read_v1`, `therapeutic_program_row_actor_can_access_v1`.
Preserva EXECUTE explícito de authenticated e service_role; não muda corpos das funções, parâmetros, owners nem os relacionamentos.

Na primeira migração, revoga somente TRIGGER de PUBLIC, anon e authenticated nas seguintes 18 tabelas:
`aba_behavior_events`, `aba_clinical_recommendation_audit_logs`, `aba_interval_summaries`, `aba_maintenance_probe_results`, `aba_maintenance_schedules`, `aba_regression_alerts`, `aba_sessions`, `aba_target_status_audit_logs`, `aba_targets`, `aba_trials`, `appointments`, `clinics`, `patient_files`, `patient_therapeutic_plans`, `payment_appointment_items`, `payment_audit_events`, `payment_transactions`, `payments`.

Verificações transacionais: baseline de 10 funções, assinatura/owner/grants, nenhuma dependência RLS pública/anon, nenhum consumidor SECURITY INVOKER ou view; tabela com owner postgres, gatilho SECURITY DEFINER instalado e grants esperados. Qualquer divergência provoca rollback integral. Depois verifica ACLs e privilégios de service_role.

Nenhuma alteração em SELECT/INSERT/UPDATE/DELETE, RLS, triggers existentes, registros clínicos, Stripe, autenticação ou código runtime. Sem requests adicionais de produto, polling, N+1, egress/storage extra.

## Evidência, validação e limites
- SQL de inventário: pg_proc, pg_namespace, pg_policies, pg_views, pg_trigger, pg_class, ACLs.
- CI: `tests/ia05SecdefAnonAndTableTriggerAcl.regression.test.mjs`, incluindo cenário PostgreSQL efêmero que comprova que o gatilho existente continua disparando após remover TRIGGER do papel de usuário.
- Staging: ACLs verificadas por SQL após aplicar migração. Smoke real de Salvar, F5, logout/login, clínicas, ABA, arquivos, financeiro e agenda permanece **pendente**.
- **Produção não tocada:** baseline e migrações diferentes. Promoção seletiva condicionada à homologação futura.
- IA-05 seguinte: revisar as três funções que aparecem em RLS pública, eliminar consultas diretas com actor UUID arbitrário onde comprovadamente inseguras, avaliar políticas PUBLIC com roles authenticated e grants TRIGGER adicionais, sem alterar fluxos inadvertidamente.

## Segunda migração — 3 funções e 15 políticas RLS
Migração: `supabase/migrations/20261115223227_ia05_scope_public_policies_to_authenticated.sql`.
- No catálogo Staging, eram as três últimas funções SECURITY DEFINER com EXECUTE de anon.
- 15 políticas existentes tinham TO PUBLIC e condições que exigiam auth.uid(); para o papel anon não eram permissivas.
- Alteração estrita: apenas `ALTER POLICY ... TO authenticated` nas 15 políticas listadas e validadas individualmente por hash de USING/WITH CHECK; `REVOKE EXECUTE ... FROM PUBLIC, anon` em can_access_clinic, can_manage_clinic e is_platform_admin. Roles authenticated e service_role seguem com EXECUTE.
- Sem alteração nos predicados, em outros grants de tabela, em dados, em trigger, em código runtime ou em fluxos Stripe.
- Verificar em Staging: 0/10 funções remanescentes executáveis por anon, 15/15 políticas só para authenticated e hashes íntegros.
- Smoke real continua adiado, assim como promoção à produção.
