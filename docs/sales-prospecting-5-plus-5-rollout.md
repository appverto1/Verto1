# Verto — Prospeção comercial 5+5 (27/10/2026)

## Contrato validado com o responsável comercial

- Registrar até cinco chamadas telefônicas convencionais e cinco chamadas pelo WhatsApp, em qualquer ordem.
- Cada clique registra canal, resultado e horário do servidor; chamadas sem conversa com o decisor não são sucesso.
- Conversa por ligação com o decisor é sucesso de contato mesmo que não compre.
- Décima ligação sem contato efetivo move automaticamente de **Novo** para **Perdido** com horário auditável, sem perder cliente convertido ou lead que já tem histórico de contato.
- Mudança manual de status para **Perdido** registra data/hora; resposta a mensagem WhatsApp não conta como conversa telefônica.
- O Kanban permite arrastar, tem colunas horizontais e atualiza imediatamente sem exigir F5.
- Métricas privadas: chamadas, contatos efetivos, conversões de conversa por lead, canal, dia da semana e horário (BRT).

## Implementação modular na branch de trabalho

- `services/salesProspectingRoutes.ts`: rotas protegidas por `checkAuth` e `checkPlatformAdmin`, reutilizando MFA do painel.
- `src/components/CommercialKanban.tsx`: progresso 0–10 por lead, botões de ligação, movimentação entre colunas.
- `src/components/CommercialDashboard.tsx`: métricas derivadas dos registros de ligação.
- `supabase/migrations/20261027143000_sales_prospecting_attempts_v1.sql`: operações atômicas, idempotência, histórico, horários e bloqueio de clientes convertidos.
- `tests/salesProspectingKanban.regression.test.mjs`: verificações de invariantes e bloqueio de rollout sem registro das rotas.
- `src/components/SuperAdminDashboard.tsx`: componente acessível na aba Comercial somente com `VITE_FEATURE_COMMERCIAL_PROSPECTING=true`.

## Impedimentos para merge seguro

1. As novas rotas **ainda não foram registradas** em `server.ts`. O arquivo existente tem ~4,35 MB e excedeu o limite de escrita do conector do GitHub. O utilitário `node scripts/integrate-sales-prospecting-routes.mjs` faz só o import e o registro, localmente, sob revisão de diff. Este script não é executado pelo aplicativo nem pelo Railway.
2. Não há resultados dos testes de build/TypeScript nem testes de RPC no banco do staging; não afirmar que passou.
3. A migração ainda precisa ser aplicada ao banco **Verto-Staging**, nunca em produção sem rollout próprio.
4. Testar autenticação+MFA, tentativas concorrentes, idempotência, 5+5, décima falha, conversa com decisor, mudança manual para perdido e atualização sem F5.
5. Habilitar a flag somente no Railway staging depois de servidor e banco estarem prontos, confirmar deployment SUCCESS + SHA e teste autenticado.

**Não promover produção ou criar PR de entrega enquanto estes passos não estiverem concluídos.**

## Escopo não implementado nesta etapa

Importação em lote de contatos, resposta a mensagens WhatsApp, relatório completo de sequências e compromissos/reuniões com notificações e integração comercial-orçamentos são itens adicionais do CRM; não simular que estejam entregues pela lógica 5+5.
