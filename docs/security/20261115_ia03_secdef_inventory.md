# IA-03 — revisão seletiva de SECURITY DEFINER (15/11/2026)

## Escopo / evidência do banco

Inventário somente de funções em `public` com `prosecdef=true` e
`has_function_privilege('anon', oid, 'EXECUTE')`. Consulta direta ao
catálogo `pg_proc`, `pg_namespace`, `pg_policies` e fontes `prosrc` dos
projetos Supabase Verto-Staging e Verto Produção.

| Ambiente | Antes | Gatilhos/event triggers | Diretamente invocáveis | Após IA-03 |
| --- | ---: | ---: | ---: | ---: |
| Staging | 55 | 34 | 21 | **44** (34 gatilhos, 10 diretas) |
| Produção | 55 | 35 | 20 | **55** (sem alteração) |

A diferença entre ambientes não deve ser mascarada: há helpers presentes
somente em Staging ou com implementação/ACL diferentes em produção.

## IA-03 — correção aplicada em Staging

Migração `20261115040709_ia03_privileged_direct_rpc_execute_lockdown.sql`.
Foco estrito nas **11** funções diretamente invocáveis de escrita ou
operação interna explicitamente enumeradas na migração:

- Consolidação clínica: `aba_refresh_patient_maintenance_summary`,
  `aba_upsert_behavior_daily_duration`;
- Faturamento: `enqueue_active_patient_billing_sync`,
  `complete_active_patient_billing_sync_job`,
  `fail_active_patient_billing_sync_job`,
  `reconcile_active_patient_billing_sync_queue`;
- TISS: `create_tiss_official_document`;
- Escola: `school_assert_professional_availability`,
  `school_audit_append`, `school_idempotency_existing`,
  `school_idempotency_store`.

**Antes de alterar:** nenhuma das 11 aparecia em políticas RLS;
as referências a essas funções dentro de outras funções PG eram exclusivamente
executadas por funções `SECURITY DEFINER` (ou gatilhos) e não por invocadores
`SECURITY INVOKER`. O código interno encontrado exigia autorização por
contexto de backend/dono; não foi validada interação autenticada de ponta a
ponta nesta auditoria.

**Mudança mínima:** revogar `EXECUTE` de `PUBLIC`, `anon` e
`authenticated` e confirmar `EXECUTE` para `service_role`, sem alterar
corpos de função, RLS, triggers, esquema, tabelas, dados ou API.

**Verificação real pós-migração:** 11/11 sem `EXECUTE` para `anon`
e `authenticated`, e com `EXECUTE` para `service_role`.
O número de funções ainda executáveis por `anon` caiu de 55 para 44.
Essa verificação de ACL não equivale a um smoke funcional da aplicação.

## Pendências e limites da avaliação

1. **10 funções diretas restantes em Staging** incluem helpers de papel/
   acesso a clínicas, arquivos e leituras terapêuticas. Muitas são usadas em
   políticas RLS, portanto **não revogar em massa**; revisar, uma a uma,
   validação do ator, possibilidade de enumeração e dependências reais.
2. **34 gatilhos** com permissão EXECUTE no catálogo permanecem. Funções
   `RETURNS trigger` não podem ser invocadas como RPCs comuns, mas o
   EXECUTE no catálogo merece análise futura para reduzir falsos positivos
   dos advisories sem comprometer execução interna.
3. **Produção permanece intocada**. Antes de qualquer promoção, homologar
   em Staging uma gravação clínica ABA (duração/gráfico), sincronização de
   paciente ativo/faturamento e caminhos TISS/escola disponíveis, inclusive
   isolamentos cross-clinic e F5/logout/login quando aplicável.
4. Não foi realizada prova de exploração direta, nem alteração do runtime
   PostgREST ou `trust proxy`. São itens separados do inventário.
5. CI estrutural `tests/ia03PrivilegedDirectRpcAcl.regression.test.mjs`
   verifica o conjunto restrito, preservação de funções RLS e a política de
   grants; conferência de privilégios de banco realizada por SQL no projeto
   Staging.

## Risco de regressão e rollback

A migração é *somente ACL*. Em caso de consumidor legítimo não autorizado,
investigar primeiro qual credencial efetivamente chama a RPC. **Não** conceder
`EXECUTE` amplamente a `PUBLIC` ou `anon` como contorno automático.
Restaurar privilégios somente de função e papel específicos, após aprovação
de segurança e comprovação da necessidade, preservando isolamento tenant.

**Critério de encerramento:** CI, merge, deploy Staging por SHA e smoke real
de rotas relevantes. Produção depende de promoção seletiva posterior.
