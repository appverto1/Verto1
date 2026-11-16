# Parcerias — conciliação completa Staging → Main (2026-11-16)

## Escopo entregue no PR #783
Promove inscrições públicas pelo portal /parcerias com aprovação e e-mail, login independente por senha/Google,
cupons, aquisição dos leads pelo fluxo público canônico, relatórios ao Super Admin, marketplace,
avaliações e armazenamento privado de logo. Inclui medalhas Bronze/Prata/Ouro e prazo individual 6/9/12.
Preserva login clínico, identidade, roles, clínicas, Stripe, webhooks, onboarding comercial e operações Salvar.
As comissões continuam **apenas potenciais**; não há saldo autorizado nem repasse/PIX automático.

## Ledger Supabase produção — NÃO reaplicar migrações

O núcleo base já existia em produção antes deste PR, em versões diferentes dos arquivos de origem:

| Source Staging | Migração já executada em produção |
| --- | --- |
| `20261110160000_verto_partnerships_foundation_v1.sql` | `20261116131230 verto_partnerships_foundation_v1_prod_20261116` |
| `20261111154000_verto_partner_referral_coupon_v1.sql` | `20261116131239 verto_partner_referral_coupon_v1_prod_20261116` |
| `20261111190000_verto_partner_coupon_compact_format_v1.sql` | `20261116131245 verto_partner_coupon_compact_format_v1_prod_20261116` |
| `20261111203000_verto_partner_referral_crm_reporting_v1.sql` | `20261116131253 verto_partner_referral_crm_reporting_v1_prod_20261116` |

Migrações adicionais validadas em transação com rollback e **aplicadas em produção** em ordem:

| Source versionado no PR | Ledger aplicado em produção |
| --- | --- |
| `20261111110000_verto_partner_marketplace_v1.sql` | `20261116174446 prod_partner_marketplace_v1_20261116` |
| `20261111195607_partner_access_reviews_media_v2_20261111.sql` | `20261116174506 prod_partner_access_reviews_media_v2_20261116` |
| `20261113190239_partner_marketplace_review_summaries_v1.sql` | `20261116174509 prod_partner_marketplace_review_summaries_v1_20261116` |
| `20261113200000_partner_marketplace_five_reviews_v1.sql` | `20261116174512 prod_partner_marketplace_five_reviews_v1_20261116` |
| `20261116164217_partner_tiered_commissions_v1.sql` | `20261116174517 prod_partner_tiered_commissions_v1_20261116` |

Não executar `supabase db push` nem aplicar os mesmos SQLs com novos timestamps: conciliar
a tabela de migrações e o esquema real em vez de reproduzir grants/constraints/triggers.

## Validações de produção (antes do deploy)
- Migrações SQL executadas em transação com ROLLBACK: passaram sem persistir estruturas de teste.
- Após aplicação: quatro tabelas novas com RLS ativo; `anon` sem SELECT em termos,
  `authenticated` sem INSERT na tabela de termos e sem EXECUTE no RPC privilegiado;
  `service_role` com EXECUTE; bucket privado `verto-partner-images`; reviews limitadas a cinco;
  dois gatilhos de prazo ativos (não criam cobranças ou pagamentos).
- Contagens após aplicação: zero parceiros, zero indicações e zero prazos gravados na produção,
  sem apagar clientes/assinaturas existentes.
- GitHub Actions no PR #783: Node 20, lead público, Stripe/Diretor, Google OAuth,
  módulos clínicos e suíte específica de Parcerias (consultar checks do PR para resultados finais).
- Staging PRs #781 e #782 homologaram apresentação e registro explícito das APIs.

## Limitações
- Contratos e repasses de comissões, Stripe refunds/chargebacks e faturas anuais não estão
  implementados como mecanismo de pagamento. O portal informa potencial, não saldo disponível.
- Validar operacionalmente em produção: formulário de interesse → aprovação Super Admin →
  convite Resend → login e-mail/Google → cupom → lead único no Kanban (sem duplicidade).
- Se houver uma falha na ativação do parceiro, corrigir pontualmente; não alterar Stripe nem provisionamento clínico.
