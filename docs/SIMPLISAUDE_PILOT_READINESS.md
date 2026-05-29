# Simpli Saude Pilot Readiness

Este documento fecha o marco interno de preparacao para uma demonstracao ou piloto com a Simpli Saude. O foco e estabilidade, seguranca, dados ficticios e um roteiro operacional claro. Nao faz parte deste marco implementar TISS/TUSS, XML, envio para operadora, painel dedicado Simpli Saude ou integracao externa de faturamento.

## Fluxo demonstravel

1. Criar ou selecionar a clinica ficticia `Clinica Demo Verto`.
2. Criar profissional demo, sala demo, paciente demo e responsavel demo.
3. Criar pagador demo e regras por pagador para ABA.
4. Agendar consulta na agenda clinica.
5. Confirmar consulta pelo portal do responsavel.
6. Iniciar sessao ABA vinculada a consulta.
7. Encerrar sessao e gerar resumo/relatorio.
8. Registrar aceite/assinatura do responsavel.
9. Abrir a Central de Fechamento Operacional.
10. Validar checklist anti-glosa e pendencias.
11. Abrir a Conferencia Mensal.
12. Exportar CSV operacional seguro.
13. Conferir audit logs das acoes sensiveis.

## Rotas e telas envolvidas

- Agenda clinica: tela `Calendar`, rotas `GET /api/calendar/events`, `GET /api/calendar/events/:eventId/detail` e `POST /api/calendar/events/check-conflicts`.
- Portal do responsavel: tela `PatientDashboard`, rotas `GET /api/portal/appointments`, `POST /api/portal/appointments/:appointmentId/confirm`, `POST /api/portal/appointments/:appointmentId/request-reschedule`, `POST /api/portal/appointments/:appointmentId/request-cancel` e `POST /api/portal/sessions/:sessionId/sign`.
- Sessao ABA: tela `SessionMode`, rotas `POST /api/aba/sessions`, `PATCH /api/aba/sessions/:sessionId`, `POST /api/aba/session-summaries` e consultas ABA paginadas.
- Pagadores e regras: tela `PayerRequirementsPanel`, rotas `GET/POST/PATCH /api/admin/payers`, `GET/POST /api/admin/payers/:payerId/requirements`, `PATCH /api/admin/payer-requirements/:requirementId` e `PATCH /api/appointments/:appointmentId/billing-context`.
- Fechamento operacional: tela `OperationalClosureCenter`, rotas `GET /api/closure/appointments`, `GET /api/closure/appointments/:appointmentId`, `POST /api/closure/appointments/:appointmentId/revalidate` e `PATCH /api/closure/appointments/:appointmentId/override`.
- Conferencia mensal: tela `MonthlyConferenceCenter`, rotas `GET /api/conference/monthly`, sumarios por paciente/profissional/pagador/especialidade, detalhe da sessao e `POST /api/conference/monthly/export`.

## Dados minimos

- Clinica: `Clinica Demo Verto`, marcada como demo.
- Salas: `Sala 1 - ABA` e uma sala multidisciplinar opcional.
- Profissionais: pelo menos um terapeuta ABA e um coordenador.
- Pacientes: pelo menos um paciente ficticio com responsavel ficticio.
- Pagadores: `Convenio Exemplo - DEMO Verto` e, se necessario, particular.
- Regras: assinatura, relatorio, duracao real, guia, autorizacao, registro profissional e documento do paciente conforme o roteiro.
- Consultas: uma pronta, uma com assinatura pendente, uma com relatorio pendente, uma com duracao divergente, uma remarcada/solicitada e uma cancelada.
- Sessoes: sessoes ABA concluidas com resumo persistido e uma sessao com pendencia controlada.
- Assinaturas: pelo menos um aceite digital de responsavel.
- Fechamento: checks persistidos em `appointment_closure_checks`.
- Conferencia/exportacao: linhas de conferencia e audit log de exportacao.

## Contas e roles

- `owner` ou `admin`: acesso amplo para validar configuracao, seguranca e dados demo.
- `coordinator`: fluxo principal da apresentacao, pagadores, fechamento, conferencia e exportacao.
- `therapist`: agenda e sessao ABA dentro da clinica e do paciente permitido.
- `responsible`/`patient`: portal de consultas e assinatura apenas do proprio paciente.

## O que esta pronto para demonstrar

- Agenda clinica com status, confirmacao, remarcacao e cancelamento.
- Sessao ABA V2 com coleta, resumo e relatorio operacional.
- Assinatura/aceite do responsavel com audit log.
- Central de Fechamento Operacional com checklist e pendencias.
- Regras por pagador e documentos obrigatorios.
- Conferencia mensal com agrupamentos e exportacao CSV segura.
- Mascaramento de IDs tecnicos e mensagens humanas no front comum.
- RLS nas tabelas novas de assinatura, fechamento, pagadores, documentos, conferencia e exportacao.

## Fora de escopo neste marco

- TISS/TUSS completo.
- XML de faturamento.
- Envio para operadora.
- Painel dedicado para Simpli Saude.
- Integracao externa com faturamento.
- Novas features grandes.

## Dados demo

O seed e manual e seguro por padrao:

```bash
ALLOW_DEMO_SEED=true node scripts/seed-simplisaude-demo.mjs --confirm-demo-seed
```

Para remover os dados demo criados pelo script:

```bash
ALLOW_DEMO_SEED=true node scripts/seed-simplisaude-demo.mjs --cleanup --confirm-demo-seed
```

O script usa somente nomes, e-mails `.test` e identificadores marcados como `DEMO:SIMPLISAUDE`. Ele nao deve ser executado automaticamente em producao.

## Checklist rapido antes da reuniao

- `npm run lint` passa.
- `npm run build` passa.
- `npm run test:security` passa.
- `npm run test:pilot-security` passa.
- `npm run test:simplisaude-pilot-smoke` passa.
- Login admin/coordinator funciona.
- Agenda carrega sem 500 no Network.
- Confirmacao, remarcacao e cancelamento funcionam no portal.
- Sessao ABA inicia, encerra e gera resumo.
- Assinatura do responsavel registra aceite.
- Fechamento mostra READY/PENDING/WARNING de forma clara.
- Conferencia mensal abre e filtra por periodo.
- Exportacao CSV respeita filtros e nao mostra IDs tecnicos por padrao.
- Front comum nao mostra UUID, `patient_id`, `professional_id`, `clinic_id`, `organization_id`, `appointment_id`, `session_id`, Supabase, Railway, PostgREST ou schema cache.

## Smoke manual complementar

1. Entrar como coordinator da clinica demo.
2. Abrir Agenda e confirmar que existem consultas demo em estados diferentes.
3. Abrir detalhe de uma consulta confirmada.
4. Entrar no fluxo ABA, iniciar e encerrar sessao.
5. Gerar/visualizar resumo da sessao.
6. Entrar como responsavel demo e assinar a sessao concluida.
7. Voltar como coordinator e revalidar fechamento.
8. Conferir checklist: assinatura, relatorio, duracao, guia/autorizacao/documento.
9. Abrir Conferencia Mensal e aplicar filtros por pagador e pendencia.
10. Exportar CSV e conferir campos operacionais.
11. Confirmar audit logs: confirmacao, solicitacao/decisao de remarcacao/cancelamento, assinatura, revalidacao, override/documento dispensado e exportacao.

## Pontos de atencao para apresentacao

- Usar somente a clinica demo e dados ficticios.
- Evitar navegar para areas financeiras externas ao roteiro.
- Explicar que TISS/TUSS/XML/envio para operadora estao fora do escopo deste piloto.
- Mostrar as pendencias como controle operacional, nao como erro do sistema.
- Manter a conferencia mensal em periodo curto para payload leve.
- Em telas clinicas com painel ativo e controles proprios, confirmar que o dock nao cobre controles da sessao.

## Criterios de aceite do marco

- Fluxo demo completo documentado.
- Seed demo manual existe, e tambem cleanup.
- Rotas sensiveis exigem autenticacao e roles.
- Filtros multi-tenant usam `organization_id`/`clinic_id`.
- IDOR por appointment, patient e payer e bloqueado por escopo.
- RLS existe nas tabelas novas.
- Nao ha `select('*')` nas areas novas do piloto.
- Exportacao usa whitelist operacional e audit log `EXPORT_GENERATED`.
- Erros retornados ao front sao humanos.
- Dados clinicos sensiveis, assinatura bruta, cookies e tokens nao entram em logs.
- Nada quebra ABA V2, Agenda ou login.
