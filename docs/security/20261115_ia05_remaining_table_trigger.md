# IA-05 — complemento de privilégios TRIGGER no schema public (Staging)

Data: 2026-11-15. Escopo exclusivo Staging. Parte complementar do PR #756.

## Antes da mudança
- IA-05 original já bloqueou RPC anônima nas 10 funções SECURITY DEFINER e removeu TRIGGER nas 18 tabelas mais diretamente relacionadas aos 34 gatilhos da IA-04.
- Inventário completo posterior identificou, entre 374 tabelas comuns/particionadas de public, outras **120 com TRIGGER acessível a anon** e **140 a authenticated** (todas com proprietário postgres).
- O uso efetivo de TRIGGER é necessário para CREATE TRIGGER, **não para disparar triggers já instalados durante INSERT/UPDATE/DELETE**. Nenhuma função de aplicação SECURITY INVOKER com CREATE TRIGGER foi encontrada; a única string de CREATE TRIGGER vinha de extensions.pgrst_ddl_watch(), um gatilho de DDL da infraestrutura.
- Default ACL do role postgres para novas tabelas em public também concedia TRIGGER a anon e authenticated; o default ACL do supabase_admin é administrado separadamente, não alterável por postgres (pg_has_role MEMBER = false).

## Escopo da migração
`supabase/migrations/20261115224110_ia05_remaining_public_table_trigger_grants_and_postgres_defaults.sql`
- Revogar exclusivamente TRIGGER de PUBLIC, anon e authenticated nas tabelas restantes com esses privilégios.
- Rejeitar desvio do catálogo esperado, proprietários desconhecidos, mudança no acesso service_role ou em quantidade de gatilhos instalados, com rollback total.
- Revogar exclusivamente TRIGGER do **default ACL de postgres** para futuras tabelas em public.
- Não alterar ACLs SELECT/INSERT/UPDATE/DELETE, RLS, funções, triggers existentes, dados, API, portais, clínicas ou Stripe.
- Custo: apenas alterações pontuais e transacionais no catálogo PostgreSQL. Nenhuma consulta adicional introduzida nas requisições de usuários.

## Validação e residual
CI com `tests/ia05RemainingTableTriggerGrants.regression.test.mjs` e PostgreSQL efêmero valida privilégios de novas tabelas; validação SQL após aplicação deve mostrar 0 concessões de TRIGGER para anon/authenticated nas 374 tabelas de public e preservar os vínculos de trigger.
**Ainda pendente:** default ACL de tabelas criadas por supabase_admin; exige execução por papel apropriado (não elevar postgres, não usar bypass improvisado). Outras classes de objetos e SECURITY DEFINER para authenticated devem ser auditados por risco específico.
Smoke autenticado manual e promoção à produção permanecem adiados por decisão do usuário.