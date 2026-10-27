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

## Integração (sem editar `server.ts`)

As rotas foram montadas na inicialização do módulo já registrado
`services/helpCenterRoutes.ts`, com import explícito de
`services/salesProspectingRoutes.ts`. Esse encaixe é temporário, mas mantém a
lógica do CRM isolada; não há middleware de autorização fraco ou endpoint público.
A rota revalida `platform_admins.active=true` no banco e MFA TOTP na sessão.
Não é necessária a execução de um script no `server.ts` gigante.

## Gates para staging

1. Revisar migration e executar **somente** no Supabase `Verto-Staging`, conferindo `sales_prospecting_attempts`, RLS e RPCs.
2. Executar o teste `node --test tests/salesProspectingKanban.regression.test.mjs`, build, TypeScript e regressões pertinentes sem ativar GitHub Actions pago.
3. Confirmar que o backend recebe `/api/owner/sales/prospecting/attempts` e nega acesso a não administradores, sessões sem MFA, além de bloquear tentativas fora da cota.
4. Merge em `staging`, Railway deploy SUCCESS com SHA correto; se a API estiver íntegra, habilitar `VITE_FEATURE_COMMERCIAL_PROSPECTING=true` no staging e executar smoke autenticado.
5. Produção não é parte deste rollout.

## Escopo não implementado nesta etapa

Importação em lote de contatos, resposta a mensagens WhatsApp, relatório completo de sequências e compromissos/reuniões com notificações e integração comercial-orçamentos são itens adicionais do CRM; não simular que estejam entregues pela lógica 5+5.
