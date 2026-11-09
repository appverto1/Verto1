# Verto — promoção seletiva para main: proposta → checkout → pagamento → ativação → onboarding

**Registro:** 2026-11-08 · **Destino:** `main` / Verto Produção · **Estado:** BLOQUEADO — sem mudança funcional ou deploy autorizável até integrar e testar.

## Evidências de baseline

| Item | Origem de verdade |
|---|---|
| `main` antes da integração | `1c5b7c8e1fa3593d2744d6d88f9cfcebd541d757` |
| `staging` comercial inspecionado | `b3e4bacabfef91df9735d40b513c70a360fb2a40` (#665) |
| Divergência | staging 926 commits adiante; main 36 commits exclusivos; NÃO efetuar merge global |
| Railway produção | último deploy SUCCESS de `main`, SHA `1c5b7c8` |
| Railway staging | web/cron SUCCESS em `b3e4bac` |
| PRs homologação | #663 remove trial + e-mail de ativação; #664 proteção lead cliente e e-mail de proposta; #665 cartão imediatamente e boleto por e-mail |

## Escopo autorizado — preservar tudo fora dele

Transplantar somente as responsabilidades do bloco comercial: cadastro público e card de prospecção (quando necessário); construtor de propostas e identidade contratual versionada; visualização e aceite públicos; link/Checkout Stripe; assinatura, webhook e conciliação idempotente; ativação segura de Diretor com senha ou Google; primeiro onboarding e Salvar autoritativo; UX de retorno e tutorial inicial.

NÃO substituir `src/App.tsx`, `server.ts`, `CommercialKanban.tsx`, workflows, crons, estruturas clínicas, permissões nem migrations em bloco. Comparar e portar *apenas hunks* essenciais. Preservar os 36 commits de `main`, sobretudo hotfixes de Auth, Kanban, portais, profissionais e operação.

**Dependências constatadas:** 56 caminhos comerciais diferem em staging (51 adicionados e 5 modificados), com handlers de pagamento/ativação novos que não existem em `main`. O `server.ts` de `main` ainda contém rotas monolíticas e o `PublicSalesOffer.tsx` de produção abre automaticamente uma sessão de Diretor após Checkout; a versão nova utiliza ativação sem sessão privilegiada automática. Copiar arquivos sem reconciliar wiring e imports resultaria em endpoints duplicados ou ausentes.

## Pré-requisitos do banco

Staging contém `sales_offers.settled_payment_method`, **produção não**. O caminho #665 confere Stripe Invoice Payment → PaymentIntent `succeeded` → método efetivo, nunca `session.payment_method_types` (apenas opções ofertadas). Precisa revisar e promover seletivamente migrations de `sales_card_browser_handoff_v1`, `sales_stripe_webhook_monotonic_guard_v1` e `sales_website_existing_customer_guard_20261108`, com controle de idempotência, permissões, RLS, locks e privilégios. Produção já possui migrations Kanban equivalentes com nomes diferentes; não reaplicar nem reescrever dados para alinhar histórico.

Verificar backup/rollback e ausência de regressões **antes** de qualquer SQL de produção. Não tocar em dados clínicos, usuários, históricos, assinaturas em vigor ou Stripe LIVE durante homologação.

## Critérios de gate para merge e deploy

1. Integração seletiva dos módulos/handlers comerciais em branch derivada de `main`, *sem* divergências de runtime, imports ou rotas duplicadas.
2. Revisão dos contratos `sales_offers`, `sales_checkout_links`, `pending_activations`, sessão Auth, RLS e tenant; identidade de Diretor validada no servidor; sem IDOR, replay nem escalada.
3. `npm ci`, TypeScript, build, `scripts/pre-main-gate.mjs` e regressões específicas: trial/zero-payment, oferta/versionamento, boleto pendente/pago, cartão imediato, callback Google com e-mail correto, senha, webhook duplicado, Salvar/F5/logout/login, isolamento.
4. Nenhuma cobrança real de teste: executar apenas no Stripe TEST de staging; confirmar eventos idempotentes, e-mail Resend de boleto, não habilitar trial.
5. Exibir diff, resultado de gates, custos e checklist antes de merge em `main`. Preservar gasto GitHub Actions US$0 e não criar recursos Railway.
6. Depois de merge, conferir deploy em Railway produção pelo SHA exato e iniciar smoke funcional **um passo por vez**, sem executar pagamento real nem alterar clientes reais. Primeiro confirmar proposta/link e somente então testes autorizados.

## Critérios funcionais

- **Cartão liquidado:** configurar Google ou senha *imediatamente*, sem e-mail como pré-requisito; não confiar na URL de retorno como autenticação; token de ativação efêmero e de uso único, clínica e contrato verificados no backend.
- **Boleto emitido:** acesso bloqueado enquanto pendente. Após confirmação financeira da Stripe, envio de um e-mail de ativação; token não exposto na resposta pública.
- **Zero trial:** sem período grátis em proposta nem checkout, sem retrocobrança de contratos históricos; primeira fatura positiva comprovada.
- **Identidade e fluxo:** conta Google precisa coincidir com e-mail contratual (o smoke anterior apresentou divergência entre endereços); vincular ao único Diretor correto e não criar perfil clínico com papel errado.
- **Persistência:** Salvar continua autoridade para dados clínicos e cadastrais; reprocessamento Stripe não reescreve perfil ou clínica.
- **Isolamento:** zero alterações no estado e nos prontuários de clientes reais.

## Resultado desta inspeção

Nenhum arquivo funcional foi transposto nesta branch. **Bloqueado para merge/deploy** por divergência de módulos, wiring do monólito, migration obrigatória ausente em produção e ausência dos testes integrados no candidato. Este documento é apenas um guardrail de release; não constitui aprovação funcional.
