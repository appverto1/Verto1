# Manifesto — autoridade de membership nos vínculos profissionais

Data: 30/07/2026

## Escopo

Esta entrega cumulativa preserva as correções clínicas anteriores e elimina a
fonte de verdade conflitante entre `users.clinic_id`, `clinic_memberships` e
`patient_professional_links`.

O contrato canônico passa a ser:

- `users`: identidade básica do usuário;
- `clinic_memberships`: pertencimento, papel e status na clínica;
- `professional_profiles`: especialidade profissional vigente;
- `patient_professional_links`: vínculo clínico, permissões, vigência e
  snapshot histórico da especialidade.

`users.clinic_id` permanece legível para compatibilidade histórica, mas não é
autoridade em instalações onde `clinic_memberships` existe. A ausência do
schema canônico produz erro explícito de migration; não há fallback silencioso
em produção.

## Arquivos-fonte do ZIP

- `server.ts`
- `src/components/PatientProfessionalLinksPanel.tsx`
- `src/utils/routeSchemaFallbacks.ts`
- `src/utils/patientClinicalAccess.ts`
- `src/utils/patientProfessionalLinks.ts`
- `supabase/migrations/20260730010000_clinic_memberships_non_recursive_policies.sql`
- `supabase/migrations/20260730020000_patient_professional_links_membership_authority.sql`
- `tests/clinicalProfessionalLinksHistory.test.ts`

O ZIP contém somente esses oito arquivos, mantendo a estrutura de diretórios.
Não contém `node_modules`, `dist`, logs, credenciais, arquivos de ambiente ou
entregas anteriores.

## Causa raiz

A interface carregava profissionais por memberships ativas, enquanto GET,
POST e os RPCs ainda exigiam `users.clinic_id` e, em alguns pontos,
`users.role`. Um membro legítimo da Clínica B podia aparecer no seletor e ser
rejeitado se `users.clinic_id` estivesse nulo, antigo ou apontasse para a
Clínica A. O mesmo filtro tornava invisíveis vínculos ativos inconsistentes que
continuavam contando no banco.

## GET e composição dos vínculos

- `users` é consultada em lote somente pelos IDs dos vínculos e fornece
  identidade básica;
- memberships e perfis são carregados em lotes separados e fixos;
- não há filtro por `users.clinic_id` nem consulta por vínculo;
- vínculo ativo válido exige tenant do vínculo, membership therapist ativa na
  clínica do paciente e perfil com especialidade;
- vínculo inconsistente continua na resposta, no `activeCount` e pode ser
  encerrado pelo gestor;
- seus dados externos são sanitizados e o snapshot de especialidade do próprio
  vínculo é preservado;
- `integrityStatus`, `accessEnabled: false` e `canBeEnded: true` deixam a
  inconsistência explícita sem conceder acesso clínico.

## POST e acesso clínico

- o servidor confirma a existência do usuário, a membership therapist ativa na
  clínica canônica do paciente e a especialidade de
  `professional_profiles`;
- papel, clínica e especialidade enviados pelo navegador não são autoridade;
- coordenadores gerenciam pela membership ativa; owner/admin mantêm o acesso
  global já previsto;
- vínculo inconsistente nunca concede leitura ou escrita;
- `patients.therapist_id` só participa da compatibilidade quando o schema
  canônico estiver comprovadamente indisponível ou quando a evidência canônica
  válida permitir o comportamento legado controlado.

## RPCs e concorrência

A migration `20260730020000` substitui de modo compatível:

- `public.upsert_patient_professional_link_v1`;
- `public.end_patient_professional_link_v1`.

As assinaturas foram preservadas. Os RPCs:

- derivam organização e clínica do paciente;
- autorizam ator por owner/admin global ou coordinator membership ativa;
- autorizam profissional por therapist membership ativa;
- resolvem a especialidade em `professional_profiles`;
- preservam advisory locks, bloqueios de linha, limite de cinco, prevenção de
  duplicidade, vínculo principal e histórico;
- contam todos os vínculos ativos do paciente, inclusive inconsistentes;
- permitem ao gestor encerrar com segurança um vínculo inconsistente;
- não concedem leitura histórica ao profissional inconsistente encerrado;
- não alteram linhas existentes durante a aplicação da migration.

## Policies encontradas e hardening

O repositório continha:

- `clinic_memberships_access` no SQL legado
  `sql/workspace_onboarding_foundation.sql`;
- `patient_professional_links_tenant_select` e
  `patient_professional_links_tenant_write` na migration multidisciplinar;
- as quatro policies canônicas v2 introduzidas nesta entrega.

A migration `20260730010000`:

- audita nomes conhecidos e aborta diante de policy desconhecida;
- remove somente `clinic_memberships_access` e as quatro policies v2
  conhecidas;
- usa helpers `SECURITY DEFINER` que resolvem `auth.uid()` internamente;
- não aceita `p_actor_id` arbitrário de `authenticated`;
- mantém leitura própria, gestão por coordinator ativo e gestão global por
  owner/admin;
- impede autoinscrição e elevação de papel;
- é transacional e não recursiva.

A migration `20260730020000` substitui as policies diretas de
`patient_professional_links` para usar a mesma autoridade de membership. DML
direto por `authenticated` é revogado; escrita ocorre pelos RPCs validados.

Importante: `sql/workspace_onboarding_foundation.sql` não deve ser executado
novamente, pois contém a policy recursiva antiga.

## Segurança, persistência e performance

- tenant é derivado do paciente no backend e nos RPCs;
- não há `service_role` no frontend;
- vínculo inconsistente não autoriza prontuário;
- o encerramento preserva a linha e o histórico;
- nenhum vínculo foi apagado, convertido ou backfilled;
- o GET usa uma consulta de vínculos e três consultas em lote, quantidade fixa
  independentemente do número de profissionais;
- a interface reutiliza os dados já carregados e não introduz N+1;
- RLS, limite, duplicidade, vínculo principal e snapshots históricos foram
  preservados.

## Ordem manual

Após backup e validação em ambiente de teste:

1. aplicar manualmente
   `20260730010000_clinic_memberships_non_recursive_policies.sql`;
2. aplicar manualmente
   `20260730020000_patient_professional_links_membership_authority.sql`;
3. validar as policies e os RPCs conforme `ROTEIRO_MANUAL.md`;
4. somente depois publicar o código pelo GitHub Desktop.

Nenhum SQL foi executado nesta entrega.

## Fora do escopo preservado

Não houve alteração em `tasks`, agenda, ABA, comercial, Stripe, Checkout,
Railway, dados existentes ou migrations aplicadas. Não houve branch, commit,
push ou deploy.
