# Fluxo de Maintenance Probe

## Auditoria do fluxo atual

- O schedule de manutencao pode ser criado pelo endpoint `POST /api/aba/targets/:targetId/maintenance-schedules`, pela acao de proxima sessao ou pelo endpoint de avaliacao de maestria quando ha aprovacao explicita do supervisor.
- A criacao automatica acontece somente no aceite/aprovacao de maestria (`MASTERED_APPROVED`, `mastered` ou flag de aprovacao no payload). O fechamento normal de sessao apenas avalia maestria e sugere estados; ele nao promove target sozinho.
- A mudanca para `MAINTENANCE` agora ocorre no fluxo explicito de aprovacao de maestria e grava auditoria em `aba_target_status_audit_logs`.
- Antes da correcao, a UI podia mostrar "Sem proximo maintenance probe" quando o target estava em manutencao mas nao havia schedule ativo, quando a agenda nao tinha sessao dentro da janela 7/14/30/60, ou quando o probe estava sem `appointment_id`.

## Fluxo corrigido

1. Supervisor aprova maestria de um target.
2. O target entra em `MAINTENANCE` com auditoria.
3. O sistema cria schedules 7/14/30/60 como marcos clinicos, procurando a sessao futura mais proxima dentro da janela tolerada.
4. Se houver consulta na janela, o schedule recebe `appointment_id` e aparece na agenda como flag leve.
5. Se nao houver consulta, o schedule fica `UNSCHEDULED`/pendente e a sessao ABA mostra o CTA para agendar.
6. Ao iniciar uma sessao da agenda, a sessao carrega probes vinculados ao `appointment_id`, vencidos e sem sessao vinculada.
7. O terapeuta escolhe explicitamente "Usar Maintenance Probe"; DTT/NET nao viram probe automaticamente.
8. Ao registrar tentativa do tipo `maintenance_probe`, o resumo cria `aba_maintenance_probe_results`, vincula o schedule adequado, marca o schedule como `COMPLETED` e avalia `MAINTAINED`, `WATCH` ou `REGRESSION_RISK`.
9. Alertas de regressao continuam sinalizadores/auditoria para revisao humana. O sistema nao confirma regressao nem altera plano automaticamente.

