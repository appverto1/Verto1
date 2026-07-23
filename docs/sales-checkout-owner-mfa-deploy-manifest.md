# Manifesto de deploy: Checkout comercial e MFA do owner

Data: 23/07/2026

## Escopo

- aceitar no webhook o e-mail confirmado pelo Stripe Checkout quando o lead ainda nao possui e-mail;
- preservar o pagamento antes das etapas de provisionamento;
- manter retries idempotentes e colisoes de e-mail em revisao, sem merge automatico;
- exigir desafio TOTP para toda sessao `owner`, inclusive sessoes antigas e workspaces com papel derivado;
- oferecer bootstrap de MFA sem liberar o painel antes da validacao do primeiro codigo.
- persistir novos segredos TOTP cifrados e recifrar segredo legado somente depois de um codigo valido;
- revalidar uma unica vez as sessoes antigas contra o papel canonico antes de aplicar a politica atual.

## Endpoint Stripe canonico

O endpoint atualmente cadastrado na Stripe foi auditado, sem alteracoes:

`https://www.appverto.com.br/api/stripe/webhook`

Esse endpoint deve permanecer como o unico endpoint configurado para este fluxo. A rota legada
`/api/webhook/stripe` continua disponivel apenas para compatibilidade e delega ao mesmo processador;
a reserva por `event.id` impede efeitos duplicados.

Eventos comerciais tratados quando o vinculo com `sales_assisted_signup` e comprovado:

- `checkout.session.completed`;
- `checkout.session.expired`;
- `invoice.paid`;
- `invoice.payment_succeeded`;
- `invoice.payment_failed`;
- `customer.subscription.updated`;
- `customer.subscription.deleted`.

## Arquivos do pacote

- `server.ts`
- `package.json`
- `src/App.tsx`
- `src/components/LandingPage.tsx`
- `src/components/PublicSalesOffer.tsx`
- `supabase/migrations/20260723120000_sales_checkout_payment_reconciliation.sql`
- `supabase/migrations/20260723123000_owner_mfa_contract.sql`
- `tests/authLoginRecoveryFallback.test.ts`
- `tests/salesCheckoutProvisioning.test.ts`
- `tests/ownerMfaEnforcement.test.ts`
- `tests/salesAssistedSignup.test.ts`
- `docs/sales-checkout-owner-mfa-deploy-manifest.md`

O arquivo historico `supabase/migrations/20260722170000_sales_lead_minimal_capture.sql`
nao faz parte deste pacote e nao deve ser sobrescrito por este deploy.

## Ordem manual obrigatoria

1. Fazer backup do codigo e confirmar o alvo Supabase/Railway.
2. Aplicar manualmente no Supabase SQL Editor:
   `20260723120000_sales_checkout_payment_reconciliation.sql`.
3. Aplicar manualmente no Supabase SQL Editor:
   `20260723123000_owner_mfa_contract.sql`.
4. Confirmar que as duas migrations concluem sem erro; executa-las novamente deve ser inofensivo.
5. Publicar o codigo no Railway.
6. Nao cadastrar um segundo webhook Stripe. Manter a URL canonica acima e o secret ja associado a ela.
7. Testar primeiro com um lead novo sem e-mail e uma sessao Checkout de teste.
8. Encerrar sessoes antigas de owner por logout/login; o backend tambem bloqueia qualquer sessao sem `mfaVerified`.

## Variaveis existentes necessarias

Nenhum valor deve ser alterado ou exposto por este pacote. Antes do deploy, apenas confirme que o
servico ja possui:

- `STRIPE_SECRET_KEY`;
- `STRIPE_WEBHOOK_SECRET` do endpoint canonico;
- `SESSION_SECRET`;
- `DATA_ENCRYPTION_KEY` (preferencial para o segredo temporario do bootstrap MFA);
- configuracao Resend ja usada pelo produto.

## Validacao operacional

### Checkout

1. Capturar lead apenas com nome, WhatsApp e clinica opcional.
2. Criar Checkout e informar e-mail na Stripe.
3. Confirmar oferta `paid`, IDs Stripe e evento `payment_completed`.
4. Confirmar `pending_activations.email`, token armazenado apenas como hash e envio unico.
5. Reentregar o mesmo evento e confirmar ausencia de nova ativacao, assinatura ou e-mail.
6. Simular e-mail ja pertencente a outro lead e confirmar revisao sem merge ou perda do pagamento.

### MFA

1. Entrar como owner sem MFA e confirmar que apenas o bootstrap e exibido.
2. Validar o primeiro TOTP e confirmar sessao com `mfaVerified`.
3. Sair e entrar novamente; exigir senha e novo desafio TOTP.
4. Tentar acessar rota owner com sessao antiga e confirmar bloqueio.
5. Confirmar que usuarios clinicos nao-owner continuam no fluxo atual.
6. Confirmar que o perfil e os logs nunca retornam segredo TOTP, QR ou challenge em texto aberto.

## Rollback

As migrations sao aditivas. Em rollback do aplicativo, reverta somente o deploy de codigo; nao remova
colunas, desafios ou registros comerciais criados. Pagamentos confirmados e historicos devem permanecer
preservados para reconciliacao. Nao execute `DROP`, backfill reverso ou cancelamento automatico na Stripe.
