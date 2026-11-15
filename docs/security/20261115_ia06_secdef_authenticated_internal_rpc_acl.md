# IA-06 — primeira restrição seletiva de SECURITY DEFINER para authenticated

Data: 15/11/2026 · Banco: Verto-Staging · Código: staging · Produção: não alterada.

## Inventário real e risco demonstrável
O Security Advisor apresentava **48** funções SECURITY DEFINER executáveis por authenticated em public: **47 funções diretamente invocáveis, 1 trigger já instalado**. Uma autorização genérica de EXECUTE dá acesso RPC direto a funções SECURITY DEFINER com privilégios do proprietário `postgres`, sem a RLS da tabela para a lógica interna.

A análise de `pg_proc`, `pg_policies`, `pg_views` e `pg_trigger` demonstrou quatro funções cuja execução direta é desnecessária para a aplicação, pois todos os consumidores encontrados são outras funções SECURITY DEFINER e nenhuma delas é referenciada por RLS, views ou funções SECURITY INVOKER:

| Função | Consumidores SECDEF | Risco de chamada direta |
| --- | ---: | --- |
| `school_consent_current_status` | 5 | Consulta status de consentimento escolar por IDs arbitrários, sem validar `auth.uid()` |
| `school_actor_has_role` | 18 | Permite testar permissões de outro ator/clínica usando parâmetros arbitrários |
| `school_actor_can_access_patient` | 9 | Permite inferir se outro ator alcança um determinado paciente |
| `patient_case_team_actor_can_manage_v1` | 3 | Permite inferir gestão de caso por outro ator/paciente/clínica |

O quinto alvo é `guard_clinic_timezone_v1()`, função `RETURNS trigger` de validação do fuso horário. Possui um vínculo de trigger instalado, nenhum consumidor RLS, e não precisa de EXECUTE direto de authenticated para disparar em DML.

A migração histórica `20260818101500_patient_case_team_supervision_member_management_v2.sql` já havia revogado `authenticated` no helper de gestão de caso; o ACL atual foi reaberto posteriormente e esta correção restabelece a intenção de menor privilégio.

## Mudança mínima
Migração `supabase/migrations/20261115230206_ia06_restrict_internal_authenticated_secdef_helpers.sql` aplicada ao Supabase Staging.
- Preflight transacional: baseline 47 RPCs + 1 trigger, assinaturas, hashes da definição atual, ACLs, proprietário, consumidores internos, ausência de dependências RLS/views/invoker e vínculo de trigger.
- Revoga somente EXECUTE de `PUBLIC`, `anon` e `authenticated` nos cinco alvos identificados. Preserva EXECUTE de `service_role` e proprietário.
- Pós-verificação: 43 funções SECDEF executáveis por authenticated (43 diretas e 0 gatilhos), 0 por anon e 5/5 alvo protegidos.
- Não modifica definição de função, vínculos de trigger, DML das tabelas, políticas RLS, Stripe, clínica, convites, pacientes, dados ou UX. Nenhuma query adicional em fluxos de usuário.

## Testes
`tests/ia06InternalAuthenticatedSecdefAcl.regression.test.mjs` e PostgreSQL efêmero no CI demonstram que a chamada direta perde EXECUTE (SQLSTATE 42501) enquanto uma função SECURITY DEFINER que chama o helper internamente continua executando. Isso é um teste do mecanismo Postgres, não substitui os smokes clínicos reais.

## Pendências
- **43** funções SECDEF ainda acessíveis por authenticated requerem avaliação individual, inclusive `can_access_clinic`, `can_manage_clinic`, `is_platform_admin` e `school_actor_effective_role`, que têm dependências RLS; não revogar em massa.
- Identificar e corrigir possível enumeração por `p_actor_id` e `target_user` sem trocar a semântica das políticas RLS e dos perfis.
- Smoke real Salvar/F5/logout/login/isolamento de clínica adiado conforme pedido; produção não foi tocada.
