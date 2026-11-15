# IA-06 — prevenção de enumeração por ID arbitrário em quatro helpers RLS

Data: 15/11/2026. Banco: Supabase Staging. Produção: intocada. Testes manuais: adiados.

## Achado
As funções `can_access_clinic(uuid,uuid)`, `can_manage_clinic(uuid,uuid)`, `is_platform_admin(uuid)` e `school_actor_effective_role(uuid,uuid)` tinham EXECUTE permitido a authenticated, porém aceitavam `target_user` / `p_actor_id` arbitrário sem conferir `auth.uid()`. Isso permitia consultas diretas para enumerar associações, atribuições e papéis de outros usuários, apesar de as políticas RLS usarem `auth.uid()`.

Levantamento de Staging via catálogo PostgreSQL: 50, 71, 12 e 6 políticas RLS respectivamente (139 entradas). Em todas, a chamada do helper usa `auth.uid()` no argumento do ator. `is_platform_admin` possui cinco consumidores em funções SECURITY DEFINER; `school_actor_effective_role`, quatro. Não há consumidores diretos SECURITY INVOKER ou em views.

## Correção mínima
Migração `supabase/migrations/20261115233141_ia06_bind_secdef_role_queries_to_session_actor.sql`: mesma assinatura, retorno, proprietário, `SECURITY DEFINER`, `search_path`, privilégios EXECUTE, sem modificação de tabela, RLS, frontend ou fluxo clínico.

Cada helper somente aceita consulta com `target_user/p_actor_id = auth.uid()` e usuário de sessão não nulo. A exceção explícita é a chamada autenticada do backend sob a role JWT `service_role` verificada por PostgREST, necessária para consumidores internos que informam o ID de um ator em nome da aplicação. Não confundir contexto `service_role` com uma propriedade manipulável do frontend.

O preflight confere 43 funções SECDEF ainda executáveis por authenticated, quatro hashes exatos de definição, proprietários, grants, quantidade e formato das 139 dependências RLS, chamadas internas e ausência de consumidores invoker/view. Em divergência, a migração falha dentro da transação. O postcheck valida que os grants continuam como antes e a guarda foi adicionada.

## Verificação
- SQL executado no Staging com contexto JWT simulado contra registros reais: acesso à própria clínica/papel, rejeição de IDs de terceiros para associação/gestão/admin/papel e manutenção da chamada `service_role`; sem alteração de dados.
- CI adiciona `tests/ia06SelfActorSecdefRls.regression.test.mjs`, executa as definições efetivas da migração num PostgreSQL efêmero, com dois atores, duas clínicas, RLS de exemplo, tentativa de ID falso, cenário de sessão ausente e caminho de serviço.
- O contador de alertas SECDEF authenticated pode permanecer em 43: este lote corrige o contrato das quatro funções, não remove EXECUTE, pois elas são indispensáveis à RLS.
- Não representa teste autenticado fim a fim pela API PostgREST. Smoke completo Salvar/F5/logout/login/isolamento de clínica foi adiado pelo usuário.

## Riscos residuais
Outras funções SECURITY DEFINER expostas a authenticated requerem revisão de IDOR, claims, papéis e autorização; uma role JWT service_role jamais pode ser fornecida pelo cliente. Funções escolares internas que aceitam ator arbitrário já estão sem EXECUTE de authenticated desde a IA-06 anterior. Produção não deve receber as migrações até a homologação real.
