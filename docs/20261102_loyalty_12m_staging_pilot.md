# Fidelidade Verto — MVP de staging (02/11/2026)

## Contrato de produto aprovado
- Prazo: **12 meses**, por clínica/organização, sem retroatividade.
- Rescisão antecipada: **multa proporcional somente após parecer jurídico**.
- Clientes já pagantes: elegíveis **sem novo Checkout e sem substituir a assinatura existente**.
- Nada em staging altera cobranças, renovações, Stripe, clínicas, pacientes, prontuários, permissões ou dados de produção.
- A regra **não** bloqueia cancelamento e **não** suspende acesso; o mecanismo existente de billing continua autoritativo.

## Entrega deste PR (MVP 1: minuta não vinculante)
- Super Admin > Clientes e Lucro: quadro de clínicas com assinatura ativa **e pagamento confirmado no ledger**; botão "Preparar minuta".
- Backend autenticado + autorização de Super Admin e MFA, incluindo barreira explícita de staging.
- Postgres: `organization_loyalty_drafts` isolada, somente **draft**, 12 meses, revisão jurídica pendente, uma minuta por organização e vínculo à assinatura identificada no servidor.
- RPC única atômica, idempotente e service-role-only; sem update em `organization_billing_contracts`, `organization_billing_access_state`, `clinics` ou objetos Stripe.
- Sem aceite, data de vigência, multa calculada, fatura ou obrigação contratual emitida nesta etapa.

## Barras de segurança de ambiente
Servidor precisa simultaneamente:
- `VERTO_LOYALTY_STAGING_ENABLED=true`
- `VERTO_DEPLOYMENT_ENV=staging`
- `SUPABASE_EXPECTED_PROJECT_REF=irspungjhapqdbgqroyc` (projeto Verto-Staging validado)
Build frontend: `VITE_FEATURE_LOYALTY_STAGING=true`.
Qualquer outra combinação => endpoints respondem 404. Em produção os flags permanecem desabilitados.

## Não incluído / gates futuros
1. Jurídico deve definir o percentual ou base da penalidade, fórmula proporcional, eventos que excluem multa, forma de notificação, prazo de arrependimento quando aplicável, tratamento de mudanças de plano e redação do termo aditivo.
2. Implementar aceite **pelo representante autorizado da própria clínica**, com versão e hash do texto, evidências de consentimento e data de entrada em vigor; nunca registrar aceite por simples seleção do Super Admin.
3. Somente após gates 1 e 2 permitir status ativo e computar intervalo de 12 meses a partir da data de aceite/eficácia.
4. Simulação financeira informativa; nunca criar cobrança automática na Stripe sem outro escopo e autorização.
5. Validar comportamento de cancelamento antecipado sem interferir no mecanismo atual de suspensão de assinaturas.

## Critérios de teste em staging
1. Super Admin com MFA abre Clientes e Lucro; clínicas elegíveis aparecem sem pacientes/PII.
2. Criar minuta para clínica pagante de teste; botão muda imediatamente para "Minuta salva"; atualizar página e confirmar persistência.
3. Repetir POST sequencial e simultâneo: mesmo registro, nenhum duplicado.
4. Acesso sem login/sem MFA/não Super Admin: 401/403; produção ou flag ausente: 404 (após autorização).
5. ID de outra clínica, UUID malformado, campos inesperados e assinatura cancelada/sem pagamento: recusar criação.
6. Confirmar `draft`, `pending_review` e 12 meses no banco; nenhuma alteração de status de assinatura, de acesso, de módulos ou de faturamento.
7. Verificar que não há novos processos/cron, polling, Realtime, requisições clínicas ou chamadas Stripe.

## Rollout
Branch -> PR para staging -> review/diff/testes -> migração apenas Verto-Staging -> build/deploy staging **somente quando seguro e autorizado pelo fluxo** -> smoke humano, um passo de cada vez.
Produção fica intocada; este PR **não é um contrato de fidelidade ativado**.
