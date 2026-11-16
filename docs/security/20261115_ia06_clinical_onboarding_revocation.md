# IA-06 — isolamento clínico, autorização de onboarding e revogação de profissionais

Data: 15/11/2026 (migrations carimbadas pelo Supabase em 16/11/2026 UTC). Somente Staging; produção intacta.

## Evidências
Auditoria de código e catálogos Supabase Staging/produção confirmou:
1. `therapeutic_plan_current_actor_can_access_v1`: `public.users.role IN ('owner','admin')` autorizava sem verificar a clínica do paciente. A função alimenta 8 referências de política RLS sobre 4 tabelas clínicas com SELECT/INSERT/UPDATE (sem policies RESTRICTIVE).
2. `ack_onboarding_response_v1`: verificava o papel global `users.owner/admin` antes de atualizar qualquer resposta pelo ID. A confirmação administrativa é reservada à plataforma: `is_platform_admin(p_actor_id)`.
3. `submit_onboarding_response_v1`: poderia devolver uma resposta de onboarding pela chave de idempotência **antes** de checar permissão; também aceitava replay de chave de outro usuário. O handler de colisão repetia a leitura sem escopo.
4. `school_rls_meeting_access`, `school_rls_org_access`, `school_rls_patient_access`: associações escolares de profissional sem vínculo ativo e fallback de papéis legados em `public.users`.
5. `patient_file_actor_has_patient_access_v1` e `patient_file_current_actor_can_read_v1`: vínculo anterior de terapeuta, autor do upload ou participante da equipe podia manter acesso. Políticas `patient_files_insert/update/delete` aceitavam global `owner/admin` para outras clínicas.

## Correção mínima
- `supabase/migrations/20261116000857_ia06_clinical_tenant_and_onboarding_authorization_guards.sql`: adiciona escopo de clínica ao ramo admin/owner na função terapêutica; requer plataforma administrativa para ACK; valida autorização da clínica **antes de qualquer replay**, e vincula retorno da chave ao ator e à clínica.
- `supabase/migrations/20261116001203_ia06_restrict_revoked_clinic_school_and_patient_file_access.sql`: exige vínculo ativo de participante em reuniões escolares; elimina fallback escolar baseado só em users; exige vínculo ativo para acesso da equipe a arquivos; preserva responsável legal e grants explícitos; usa `ALTER POLICY` apenas nas 3 políticas de INSERT/UPDATE/DELETE de `patient_files` para vincular o administrador à clínica e garantir coerência `patient_id/clinic_id`.
- Ambas as migrações têm checagens de assinatura/hash/policies do catálogo, transação e postcheck. Nenhum SELECT/INSERT/UPDATE/DELETE nos dados reais, nenhum trigger novo, nenhum cambio de permissão EXECUTE/role e nenhuma mudança de frontend, Stripe ou onboarding comercial.
- **Preservação de dados:** nenhuma linha clínica/cadastral modificada. Botão Salvar continua como única ação de persistência do frontend. Nenhuma query extra ou polling de aplicação foi introduzida.

## Testes
`tests/ia06ClinicalOnboardingRevocation.regression.test.mjs` executa as definições SQL versionadas num PostgreSQL efêmero para dois tenants, plataforma admin, replay pelo mesmo/diferente ator, profissional revogado mas ainda constando como participante escolar/autor de arquivo/vínculo, responsável legal e grants explícitos, além de INSERT cross-clinic de arquivos.
Postchecks do Supabase Staging: 3 funções críticas ajustadas; 5 helpers de revogação; 3 políticas de arquivos vinculadas à clínica; 43 SECDEF ainda executáveis por authenticated e **0 por anon**.

## Residuais e homologação
- **Produção** segue vulnerável até promoção seletiva das correções após avaliação do seu schema específico. O catálogo de produção é distinto (90 funções SECDEF authenticated na auditoria).
- Análises ainda necessárias para restrições por status de papel em permissões de arquivos `SELECTED` e acesso de responsáveis legais, além de revisão das outras funções SECDEF não modificadas.
- Smoke manual real via login/Salvar/F5/logout/login/isolamento de clínicas **adiado** conforme decisão do usuário. A simulação PostgreSQL e SQL no catálogo não substituem teste de aplicação.


## Bloqueio da manipulação de identidade por clientes autenticados
A auditoria adicional revelou que `public.users` tinha grant UPDATE **sobre a tabela inteira** para authenticated, e a política `users_update_self_or_admin` só validava o ID da linha. Isso permitia que um usuário atualizasse seu próprio `role`, `clinic_id`, acesso financeiro, Stripe, modo demo, tipo de portal, onboarding e MFA, contornando outras checagens de autorização.

Migração `supabase/migrations/20261116002542_ia06_block_authenticated_users_role_clinic_payment_mfa_mutation.sql` instalou somente o trigger `trg_users_privileged_fields_guard_v1` e a função SECURITY INVOKER `users_privileged_field_update_guard_v1()`, sem grants de EXECUTE a anon/authenticated. Bloqueia alterações de 38 campos privilegiados iniciadas de `anon`/`authenticated` pelo contexto PostgREST/role SQL; preserva nome, foto, idade, updated_at e processos autorizados de backend/service_role. Nenhum dado foi alterado.

Regressão adicionada: `tests/ia06UsersPrivilegedFields.regression.test.mjs` usa PostgreSQL isolado para provar que a edição de perfil é permitida e que role/clinic/Stripe/MFA não podem ser adulterados por uma sessão comum. A migração tem preflight para RLS, grants, triggers e colunas, postchecks transacionais, sem dependência de dados reais.
