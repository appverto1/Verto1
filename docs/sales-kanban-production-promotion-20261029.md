# Kanban comercial — proposta seletiva para produção (29/10/2026)

> STATUS: PR de preparação. NÃO FAZER MERGE, NÃO FAZER DEPLOY, NÃO EXECUTAR MIGRAÇÕES OU CÓPIA DE DADOS sem aprovação explícita do responsável.

## Origem e destino
- Origem homologada: staging, commit `2095cdd205fdeda0c0d0c1d4f4e203f13632a671`.
- Destino: branch `main` a partir de `201b74a5a74d997cf015469ea881c0253b322680`, em PR de revisão.
- 11/11 smoke tests do Kanban aprovados pelo responsável em staging.
- Escopo da mudança: `CommercialKanban.tsx` homologado; adaptação pontual da navegação de `SuperAdminDashboard.tsx` sobre a versão de produção; 3 testes de regressão; este roteiro.
- SEM SQL, migrations, mudança de API/servidor, env vars, credenciais, Supabase Auth, pacientes, clínicas, financeiros ou sincronização de dados.

## Dependências verificadas
- `CommercialDashboard.tsx`, `CommercialScriptsPanel.tsx`, `CommercialAcquisitionPanel.tsx`, `services/salesProspectingRoutes.ts`, `services/salesScriptRoutes.ts`, `services/salesAcquisitionRoutes.ts`, `src/utils/salesProspectingCadence.ts`, `src/utils/salesKanbanFollowupVisuals.mjs` e `src/constants/salesCommercial.ts` têm blobs idênticos em main/staging na inspeção.
- Supabase projeto `Verto Produção`: migrations comerciais já registradas, tabelas comerciais e Kanban presentes com RLS habilitado; principais RPCs do Kanban `create_sales_kanban_opportunities_v1/v2`, `delete_sales_kanban_opportunity_v1`, `move_sales_kanban_lead_v1`, `order_sales_kanban_columns_v1`, `record_sales_prospecting_attempt_v1` e `save_sales_lead_acquisition_channels_v1` não concedem EXECUTE a `anon`/ `authenticated`, apenas a `service_role`.
- A variável `VITE_FEATURE_COMMERCIAL_PROSPECTING` não está definida no Railway de produção. Esta proposta preserva o Kanban atual de `main` sem introduzir dependência nova dessa variável.
- Dashboard do Railway: aplicação de produção acompanha `main` por deploy automático. **Merge = risco de deploy automático. Não mesclar antes da autorização.**

## Segurança e isolamento de dados
1. Não copiar cards ou registros da staging; produção mantém os próprios dados.
2. Não consultar, alterar nem excluir usuários de `auth.users`, dados clínicos, pacientes, clínicas, assinantes, planos, pagamentos ou identidades.
3. Exigir Super Admin e MFA em rotas existentes; manter idempotência e validações de backend.
4. Nenhuma chave sensível em `VITE_*` ou no frontend.
5. Antes do merge, confirmar backup/possibilidade de rollback do deploy e snapshot lógico aplicável. Não executar rollback de banco automaticamente.
6. Segurança pré-existente: o Advisor do Supabase marca tabelas comerciais RLS sem políticas como INFO (esperado para acesso somente server/service role); revisar grants antes de qualquer mudança futura do modelo de acesso. Não modificar RLS neste PR.

## Custo e CI
- Nenhum novo serviço, banco, replica, cron, build preview ou variável Railway.
- GitHub Actions deve manter teto US$ 0; não habilitar faturamento para liberar CI.
- Não criar ambiente de preview automaticamente. Se um job da PR criar preview pago, desativar preventivamente/avaliar antes do rollout.
- A comparação de código e testes estáticos de regressão foram preparados; **não alegar build/typecheck/npm test concluídos sem execução comprovada**.

## Aprovação e execução futura (NÃO EXECUTAR NESTE PR)
- [ ] Auditoria do diff final e verificação dos controles de deploy/PR previews.
- [ ] Executar `npm run typecheck`, `npm test` e `npm run build` em ambiente isolado que não acessa dados reais e que não gera cobranças não aprovadas.
- [ ] Obter autorização explícita para merge e deploy de produção.
- [ ] Observar deploy Railway `SUCCESS` no SHA aprovado, réplicas online, sem crash.
- [ ] Smoke autenticado da ficha/observações/canais/colunas/menu; não repetir criação de colunas com dados reais sem consentimento.
- [ ] Conferir isolamento e preservação dos dados de clientes, pacientes, clínicas e Auth.
- [ ] Em incidente, reverter o release de interface/servidor com SHA conhecido após avaliação e autorização; **não executar comandos destrutivos no banco**.

## Atenção adicional
- O domínio `api.appverto.com.br` foi identificado no serviço Railway de staging, enquanto `www.appverto.com.br` pertence ao app de produção. Não modificar DNS/domínios neste PR; validar topologia antes do go-live.
- As branches `main` e `staging` divergiram bastante. NÃO promover o histórico completo nem fazer merge amplo.
