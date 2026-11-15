# IA-04 — privilégios de execução em gatilhos SECURITY DEFINER

**Data:** 15/11/2026 · **Escopo:** Staging apenas · **Origem:** inventário IA-03 e auditoria direta de `pg_proc`, `pg_trigger`, `pg_policies`, ACLs.

## Descoberta

Após a IA-03, Staging tinha **44 funções `SECURITY DEFINER` executáveis por `anon`**:
- **34** retornam `trigger` e já estão associadas a **39 vínculos de gatilhos** em tabelas.
- **10** são funções diretas, relacionadas a escopo de clínica, papéis, acesso a arquivos, escola e planos terapêuticos.
- Nenhuma das 34 funções de gatilho aparece por nome em expressões de políticas RLS.
- Os 34 corpos de função são de proprietário `postgres`, e todos têm ao menos um vínculo de gatilho instalado.
- Em **26 dos 39 vínculos**, `anon` e `authenticated` apresentam permissão `TRIGGER` sobre a tabela correspondente (via ACL atual). Isso exige revisão separada das permissões das tabelas: revogar o `EXECUTE` desnecessário da função limita um pré-requisito de `CREATE TRIGGER`, mas **não equivale a corrigir todas as permissões de DDL/tabelas**.

As dez funções diretas **não** são incluídas nesta mudança: cinco são utilizadas em diversas políticas RLS; outras possuem consumidores e validações de identidade/escopo próprios. Revogá-las em lote pode impedir acesso legítimo ou alterar políticas de autorização.

## Mudança limitada e verificável

Migração: `20261115043156_ia04_secdef_trigger_execute_lockdown.sql`.

- Lista explícita de 34 nomes, sem seleção dinâmica de funções desconhecidas.
- Preflight valida baseline de 34 funções; unicidade, `SECURITY DEFINER`, retorno `trigger`, proprietário `postgres`, vínculo no `pg_trigger` e ausência de referências nominais em `pg_policies`.
- Revoga apenas `EXECUTE` das **34 funções** para `PUBLIC`, `anon` e `authenticated`; preserva `EXECUTE` de `service_role` e o proprietário.
- Não executa alteração de tabelas, conteúdo de funções, gatilhos instalados, RLS, APIs, dados clínicos ou financeiro.

**Comportamento PostgreSQL:** `CREATE TRIGGER` requer permissão `EXECUTE` no momento de criação; a vinculação já instalada em `pg_trigger` continua existindo e disparando. A regressão da IA-04 demonstra isso com uma tabela de teste criada e removida numa transação no PostgreSQL **efêmero do CI**. Essa prova não substitui smoke autenticado dos fluxos reais.

Fontes técnicas: [PostgreSQL CREATE TRIGGER](https://www.postgresql.org/docs/current/sql-createtrigger.html) e [PostgreSQL trigger behavior](https://www.postgresql.org/docs/current/trigger-definition.html).

## Testes

- `tests/ia04SecdefTriggerAcl.regression.test.mjs`: lista exata, guards e proibição de mudanças de dados/esquema além da ACL.
- Gate CI `staging-ci.yml`: cria role e tabela temporárias **dentro de transação descartada** no PostgreSQL de CI; confirma que a role sem `EXECUTE` direto na função ainda dispara um gatilho previamente criado.
- **Pós-migração Staging comprovado por SQL:** 34/34 gatilhos alvo sem `EXECUTE` para `anon` e `authenticated`, 34/34 com `EXECUTE` para `service_role`, **39** vínculos `pg_trigger` preservados. Supabase Security Advisor: avisos `anon_security_definer_function_executable` **44 → 10**; `authenticated_security_definer_function_executable` **82 → 48**. O SQL não modifica políticas RLS ou registros. Migração aplicada no histórico real como `20261115043156`.

## Limites e próximos passos

- **Produção não muda:** o catálogo de produção tem 35 funções desse tipo e deve ser reconciliado individualmente antes de promoção seletiva.
- Não foram executadas gravações clínicas nem pagamentos reais nesta auditoria. Testes em Staging: sessão ABA com Salvar/F5, arquivos do paciente, faturamento/Stripe e agenda (com verificação de erros de trigger, isolamento de clínica).
- Próximo lote de segurança: auditar **10 funções diretas** quanto a ator fornecido por parâmetro, `auth.uid()`, enumeração e dependências de RLS; revisar os grants `TRIGGER` nas tabelas em escopo. Não alterar permissões usadas por políticas sem substituição com testes comprovados.
- Não classificar "10 alertas" como "10 vulnerabilidades"; classificação e explorabilidade dependem dos contratos reais.
