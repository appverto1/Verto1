# Comercial e onboarding: isolamento de apresentação (03/11/2026)

Esta entrega extrai lógica pura dos fluxos atuais para módulos dedicados, sem tocar em contratos, tokens, Stripe, Supabase, RLS, convites, clínica, sessão, banco de dados ou persistência.

- `src/utils/salesPostPaymentState.mjs`: interpreta status pós-pagamento e backoff de rate limit preservando a precedência atual (review_required, account_activated, director_ready, provisioning, payment_confirmed, pending).
- `src/utils/professionalOnboardingFormatting.mjs`: formatação de documentos, telefone, CEP e data, sem autoridade de identidade, perfil ou permissões.
- `PublicSalesOffer.tsx` e `ProfessionalOnboarding.tsx` passam a usar esses módulos sem alterar o contrato das chamadas ao backend.
- Teste automatizado de regressão com formato e estados nos dois módulos.

## Limite técnico restante

Os controladores centrais de oferta pública, checkout/Stripe, primeiro acesso e contexto autoritativo de onboarding continuam em `server.ts`. Não seria correto afirmar que a modularização backend foi concluída. O arquivo atual tem cerca de 4,35 MB e a conexão de escrita do GitHub recusa substituí-lo por inteiro. Os dois módulos do backend foram estudados, mas não são escritos nem integrados neste PR, para não criar código morto nem arriscar a ativação.

## Homologação manual recomendada em staging

Cadastro no site → Prospecção no topo; oferta pública e aceite; checkout e retorno; pagamento confirmado → Diretor → onboarding; convite de profissional → portal profissional e especialidade; convite de paciente → portal paciente; refresh/logout/login, sem F5; checar rate limit sem cobrança duplicada.
