# Sincronizacao silenciosa de pacientes ativos

## Escopo

Este pacote sincroniza silenciosamente a quantidade canonica de pacientes ativos
com o adicional Stripe. A alteracao sempre usa `proration_behavior: 'none'`,
entra no proximo ciclo e nao exige confirmacao manual de upgrade.

Tambem registra marcos de crescimento por clinica em 10, 20, 30, 40, 50 e
multiplos seguintes. Cada marco e persistido uma unica vez; uma mutacao que
cruzar mais de um marco retorna somente o maior novo marco.

## SQL manual (primeiro passo)

Aplicar manualmente no Supabase, uma unica vez:

`supabase/migrations/20260723150000_active_patient_silent_sync_growth_milestones.sql`

A migration e aditiva e idempotente. Ela cria a fila persistente, a tabela de
marcos, RPCs de enqueue/claim/complete/fail/reconciliation, grants apenas para
`service_role` e recarrega o schema do PostgREST. Nao execute migrations de
Checkout/MFA neste pacote.

## Arquivos do pacote

- `server.ts`
- `services/stripeService.ts`
- `src/App.tsx`
- `src/components/CoordinatorDashboard.tsx`
- `src/components/PatientDetailView.tsx`
- `tests/billing.test.ts`
- `supabase/migrations/20260723150000_active_patient_silent_sync_growth_milestones.sql`
- este manifesto

## Aplicacao pelo GitHub Desktop na branch Main

1. Abra o repositorio Verto no GitHub Desktop e confirme que a branch atual e `Main`.
2. Copie somente os arquivos listados acima, preservando as pastas.
3. Aplique o SQL manual no Supabase e confirme que terminou sem erro.
4. Revise no GitHub Desktop que nao foram incluidos arquivos de Checkout/MFA ou artefatos anteriores.
5. Rode `npm.cmd run lint`, `npm.cmd run test:billing`, `npm.cmd run build` e `npm.cmd run check:docker-runtime-imports`.
6. Faca o commit e o push usando o GitHub Desktop. O deploy normal da Main publica o backend que processa a fila.

## Validacao manual apos deploy

1. Ative ou inative um paciente e confirme que a operacao clinica conclui sem popup de upgrade.
2. Confirme em Stripe que a quantidade do item adicional foi atualizada com prorata desabilitada.
3. Simule indisponibilidade temporaria de Stripe e confirme a linha em retry na fila; o paciente deve continuar salvo.
4. Reative a conectividade e use a rota administrativa de reconciliacao, se necessario. A fila deve concluir sem duplicar ajuste.
5. Cruze 10 pacientes ativos e confirme uma unica mensagem: `Parabéns! Sua clínica está crescendo.`
6. Atualize, saia e entre novamente. O mesmo marco nao deve reaparecer.

## Rollback

O rollback de codigo deve ser feito pelo fluxo habitual do GitHub Desktop. Nao
remova as tabelas da migration: elas mantem auditoria e retries pendentes. Com o
codigo anterior, a fila permanece inerte e os dados existentes sao preservados.
