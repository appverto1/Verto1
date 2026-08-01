# Entrega — convites profissionais e identidade de notificações

Data: 01/08/2026  
Base: `main` em `c8d2154`  
Migration nova: não necessária. Nenhum SQL foi executado.

## Escopo entregue

- Convite posterior usa a rota pública da SPA com `auth_action=accept_invitation` e somente `invitation_id`.
- O login de uma conta já existente não descobre nem aceita convites pendentes apenas pelo e-mail.
- O aceite explícito é autenticado, server-side, idempotente e continua usando `accept_clinic_invitation_v1`.
- O endpoint de aceite pode concluir a membership mesmo quando o workspace anterior está bloqueado por cobrança; autenticação, e-mail verificado e a RPC continuam obrigatórios.
- A tela curta de aceite exibe somente o contexto devolvido pelo servidor e só entra na nova clínica depois da confirmação.
- Dados globais do perfil não sobrescrevem o contexto do workspace/membership da nova clínica.
- A imagem de lembrete agendado é resolvida apenas a partir da clínica do atendimento no servidor; o ícone e o badge continuam sendo da Verto.

## Arquivos no ZIP

1. `server.ts`
2. `services/cronService.ts`
3. `src/App.tsx`
4. `src/components/ActivationAccess.tsx`
5. `src/components/ClinicInvitationAcceptance.tsx`
6. `src/services/dataService.ts`
7. `tests/clinicReinviteAccess.test.ts`
8. `tests/invitedProfessionalOnboarding.test.ts`
9. `tests/notificationBranding.test.ts`

## Pré-requisito de banco

Esta entrega não cria nem altera migration. A migration já existente
`supabase/migrations/20260731193000_atomic_clinic_invitation_acceptance.sql`
precisa estar aplicada antes do deploy, pois ela fornece a RPC atômica usada
para o aceite. Não a executei nem a editei.

## Verificações executadas

| Comando | Resultado |
|---|---|
| `npm.cmd ci` | exit 0 |
| testes focados de convite/onboarding/notificação | exit 0 |
| `npm.cmd run typecheck` | exit 0 |
| `npm.cmd test` | exit 0 — 29 arquivos |
| `npm.cmd run build` | exit 0 |
| `npm.cmd run check:docker-runtime-imports` | exit 0 |
| `npm.cmd run test:security` | exit 0 |
| `npm.cmd run lint` | exit 0 |
| `git diff --check` | exit 0 |

O build reportou apenas os avisos existentes de chunk grande e de importação
mista de `dataService`; não houve falha de compilação.

## Conteúdo dos artefatos

- `HASHES.sha256`: hash antes/depois dos arquivos de código e testes.
- `diff/`: diff integral, separado por arquivo, dos nove arquivos de código/teste.
- `verto_clinic_invitation_notification_identity_20260801.zip`: somente os nove arquivos acima, mantendo a estrutura de pastas.
