# PAR-FIN-01 — Prazo progressivo 6/9/12 meses (Staging, 2026-11-16)

## Escopo homologável
- Indicações comerciais para assinaturas da própria Verto, não contratos do marketplace.
- 10% permanece **potencial**, sem autorização de payout/PIX.
- 0–2 clientes qualificados ativos: 6 meses; 3–5: 9; 6+: 12.
- Qualificação: duas faturas mensais distintas, BRL, receita positiva, status paid, assinatura válida. A indicação que alcança o limiar já ganha o prazo superior.
- Prazo individual gravado ao qualificar; início retroativo ao primeiro pagamento mensal elegível e término em meses corridos. Não é reduzido ao cair de nível ou pelo cancelamento de outras clínicas.
- Nível para futuras indicações depende da carteira de clientes qualificados dos últimos 12 meses, com 30 dias de tolerância ao cancelamento, atraso ou expiração da janela. A tolerância não cria comissão sem pagamento.
- Cancelamentos deixam de contar após a carência; clientes remanescentes preservam seus direitos. Reembolsos/disputas continuam sujeitos à futura conciliação financeira, ainda sem repasse.
- Portal de parceiro exibe nível e prazos por indicação. Não há saldo financeiro nesta entrega.

## Migração e integridade
- Fonte versionada: `supabase/migrations/20261116164217_partner_tiered_commissions_v1.sql`.
- Supabase **Staging**: aplicada sob a versão **20261116165505**, nome `partner_tiered_commissions_v1_20261116`; não repetir a aplicação em Staging por outro número de versão.
- Tabela `verto_partner_referral_terms` com chave primária por indicação, RLS, escrita apenas pelo fluxo servidor; funções `SECURITY INVOKER` e execução restrita a `service_role`.
- Trigger de fatura/assinatura apenas realiza concessão se houver dois pagamentos mensais confirmados. Bloqueio transacional por parceiro; `ON CONFLICT DO NOTHING` assegura idempotência.
- Não modifica Stripe, webhooks, checkout, roles, clínicas, pacientes ou operações de Salvar.
- Para produção, **conciliar primeiro** o histórico real de migrações/ACL; não executar `supabase db push` cegamente.

## Validação realizada
- SQL da migração validado com transação e rollback antes da aplicação.
- Smoke SQL transacional com 8 leads fictícios e rollback: primeira fatura não qualifica; 3ª conversão = 9 meses; 6ª/7ª = 12; cancelamento de cinco clientes → tolerância 30 dias → nível cai; 8ª conversão = 9; prazo da 6ª permanece 12.
- Após rollback: zero parceiros, faturas ou prazos fictícios persistidos.
- As funções de RPC aceitam somente `service_role`; `anon` e `authenticated` sem SELECT ou EXECUTE.
- Testes Node 20 para isolamento/portal/aprovação/cupons e regressão da política; build Vite.
- O typecheck geral ainda apresenta dez erros preexistentes nos componentes comerciais, sem novo erro desse escopo.

## Fora do escopo
- Livro financeiro de comissões, estornos Stripe, revisão jurídica/fiscal, repasses e regras para faturas anuais.
- Merge/deploy em Main.
