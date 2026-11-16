# Conciliação de bancos antes dos smokes — 16/11/2026

## Objetivo e limites

Conferir os esquemas reais dos projetos Supabase **Verto Produção** e **Verto-Staging**, ligando diferenças à integração `main → staging` e separando migrações seguras de divergências que exigem homologação. Não usar `db push` integral, não clonar bancos, não copiar dados clínicos/comerciais, não apagar históricos de importação do CRM. Um merge Git não executa migrações nos projetos de banco.

**Escopo da fotografia:** catálogos PostgreSQL dos schemas `public` e `storage`, mais event triggers relevantes, buckets e ledger de migrações. Não representa homologação de fluxos em navegador nem garante equivalência semântica de funções, RLS ou RPC.

## Fotografia estrutural pré-hardening

| Recurso | Produção | Staging | Diferença |
|---|---:|---:|---|
| Tabelas físicas no schema public | 355 | 376 | 2 só em Produção; 23 só em Staging |
| Objetos de tipo tabela/view/materialized em public+storage | 392 | 413 | 2 exclusivos de Produção; 23 de Staging |
| Colunas em public+storage | 6.457 | 6.683 | 18 de tabelas históricas de Produção; 244 exclusivas de Staging; uma definição divergente |
| Constraints no catálogo | 2.578 | 2.715 | 9 exclusivas de Produção; 146 de Staging; 18 definições diferentes |
| Índices no catálogo | 1.404 | 1.447 | 20 exclusivos de Produção; 63 de Staging; 2 definições diferentes |
| Políticas RLS | 251 | 261 | 10 só em Staging; 83 políticas homônimas com definições distintas |
| Triggers de tabelas (não internos) | 292 | 301 | 2 só em Produção; 11 só em Staging |
| Funções comuns por assinatura | 845 | 871 | 7 só em Produção; 33 só em Staging; 66 assinaturas comuns com definição diferente |
| Buckets storage | 5 privados | 5 privados | Nenhuma diferença de nome/visibilidade |
| Tabelas físicas public sem RLS | 0 | 0 | Sem ausência de RLS identificada |
| Main exclusivamente à frente de Staging | 0 commits | — | O histórico de Main já está em Staging |

Contagens de diferenças são de **objetos de catálogo**, não de funcionalidades nem de migrações obrigatoriamente pendentes. Diferenças de formatação e constraints `NOT VALID` também afetam fingerprints e precisam de avaliação semântica.

## Estruturas que são exclusivamente de Produção

- `sales_crm_import_actor_refs` e `sales_crm_import_lead_map`: rastreabilidade histórica de importação CRM. Mantê-las exclusivamente em Produção, com dados preservados. Não copiar para Staging.
- 2 triggers em `activity_logs` para validar referência de usuário; Staging usa FK para `auth.users`, mas Produção possui 12 referências históricas sem usuário (auditoria anterior). Não criar FK em Produção sem resolver preservação do histórico.
- `ensure_rls` (event trigger `ddl_command_end`), com função `rls_auto_enable()`, só em Produção. Todas as tabelas físicas public tinham RLS ativo em ambos os bancos. Avaliar adoção controlada; não instalar gatilhos DDL cegamente.
- Rotinas antigas de notificações sem parâmetro `deployment_env`; o código atual usa rotinas com ambiente. Verificar consumidores antes de remover ou copiar.
- Unicidade global legada em `notification_jobs.idempotency_key` e `clinic_announcements(clinic_id, idempotency_key)`; Staging possui isolamento por `deployment_env`. **Não restaurar a unicidade global em Staging** sem avaliar a semântica por ambiente.
- Índices legados de notificações e push; não excluir sem verificar planos e consumidores.

## Estruturas que são exclusivamente de Staging: 23 tabelas

**Clínico/assistencial:** `aba_session_continuation_operations_v1`, `patient_pei_assessment_plans_v1`, `patient_pei_assessment_plan_versions_v1`, `patient_shared_chart_selections`, `patient_shared_chart_delegation_audit`, `patient_shared_graph_publications`, `patient_shared_graph_delegations`, `patient_shared_graph_audit`.

**Identidade e tutoriais:** `iam_persona_access_bindings_v1`, `help_tutorial_role_progress_v2`.

**Financeiro/comercial:** `organization_billing_access_events`, `organization_monthly_billable_patient_snapshots`, `organization_loyalty_drafts`, `platform_dre_cost_rules`, `sales_card_checkout_handoffs`.

**Campanhas:** `commercial_campaigns`, `commercial_campaign_versions`, `commercial_campaign_targets`, `commercial_campaign_exposures`, `commercial_campaign_events`.

**Embaixadores:** `ambassador_partners`, `ambassador_referrals`, `ambassador_commission_entries`.

Essas tabelas têm dependências com novas funções, índices, policies e/ou triggers. Não criar o conjunto inteiro diretamente em Produção antes de identificar contrato de código, migrações efetivas, autorização por papel/clínica, impactos nos dados ativos e validações automatizadas. Alguns triggers de Staging estão em tabelas **que já existem** em Produção (`users`, `appointments`, `aba_sessions`, `patients`, `platform_billing_invoice_ledger`, `verto_partner_referrals`); portanto, a promoção não seria inerte.

**Quatro colunas adicionais em tabelas já comuns:** `aba_sessions.effective_end_at`, `notes.score`, `patient_file_storage_usage.quota_bytes` (default 104857600), `sales_offers.settled_payment_method`.

## Divergências de contratos que não devem ser copiadas automaticamente

- `push_subscriptions`: PK `endpoint` em Produção, `id` (NOT NULL) em Staging.
- `platform_admins.user_id`: FK para `auth.users` em Produção e para `public.users` em Staging.
- `idx_clinic_rooms_unique_active_name`: escopos de unicidade distintos (organização/clínica versus clínica).
- `aba_user_session_preferences`: limite de atalhos em array `<=6` Produção, `<=200` Staging; não reduzir o limite sem entender a UX de fixados.
- `organization_billing_contracts.billing_model`: Produção aceita somente `modular_capacity_v1`, Staging também aceita `v2`.
- TISS: tipagem de eventos mais recente em Staging.
- Algumas constraints de Produção estão `NOT VALID`; Staging tem as mesmas validadas. Não impor em Produção sem preflight de dados e impacto de lock.
- 83 políticas RLS homônimas diferentes; 14 alteram destinatário `PUBLIC` → `authenticated` em Staging, 69 alteram condições. Não espelhar RLS por nome: verificar permissões reais, tenant isolation, permissões de paciente/profissional e bypass por IDs.

## Conciliações executadas em Staging nesta etapa

1. O guard de consentimento CRM previamente aplicado, migração `20261116205810`, permanece válido e não altera dados.
2. Migração `20261116211933 staging_reconcile_public_admin_table_grants_v1`: revoga apenas `TRUNCATE`, `REFERENCES` e `TRIGGER` concedidos a `anon`/`authenticated` em tabelas físicas public existentes.
3. Migração `20261116212028 staging_reconcile_financial_view_admin_grants_v1`: aplica as mesmas revogações à view `patient_financial_appointment_summaries`, única remanescente detectada.

**Pré-condição e validação:** antes da revogação, Staging concedia `TRUNCATE` a `anon` em 139 tabelas e `authenticated` em 159; Produção concedia a 191 e 195, respectivamente. Depois, a consulta ao catálogo em Staging retornou **zero** `TRUNCATE`, `REFERENCES` e `TRIGGER` para esses dois papéis no schema público. RLS continua habilitada nas 376 tabelas físicas public; o total de leads permaneceu em 4 e a constraint de consentimento validada. Nenhum `DELETE`, `INSERT`, `UPDATE`, `TRUNCATE` ou cópia de dados foi executado.

A documentação dessa alteração **não autoriza execução automática em Produção**. O mesmo hardening em Produção exige revisão de possíveis consumidores externos e verificações de regressão. Roles `service_role` e `postgres` foram preservados em Staging.

## Sequência de liberação antes de smokes manuais

1. Validar o CI e a revisão das migrações de ACL; manter Staging funcional.
2. Concluir análise de possíveis consumidores de privilégios administrativos em Produção.
3. Preparar e executar, após verificação de compatibilidade, migração seletiva de segurança em Produção, sem tocar em dados.
4. Para módulos novos: garantir cobertura automatizada, contrato SQL/RLS/índices/triggers e compatibilidade de versão antes de qualquer promoção. Os 23 módulos/tabelas não estão automaticamente homologados.
5. **Só depois da conciliação segura dos componentes aprovados** executar smokes manuais por módulo; não tratar CI como equivalente ao smoke.

**Proibido:** `supabase db push` integral, drop/recreate indiscriminado, copiar auth.users/roles/clientes entre bancos, reset de staging/produção, forçar migração que falhe no preflight, editar/trocar autoria do `Salvar` ou aplicar um único esquema de permissões sem checar o acesso por portal.
