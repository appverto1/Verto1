# Gestão estruturada de escolas — correção pós-deploy 2026-07-25

## Cenário adotado

A migration `20260725220000_structured_school_management.sql` foi considerada já aplicada em produção. Ela permanece intacta. Todas as correções de tenant, RLS, grants, constraints e operações críticas foram adicionadas em `20260725234500_structured_school_management_hardening.sql`.

## Fonte de verdade

`school_organizations -> schools -> school_units -> patient_school_enrollments -> school_consents -> school_meetings`

A escola pertence à organização compartilhada. Vínculos, consentimentos, reuniões, documentos, tarefas derivadas e auditorias conservam a clínica operacional.

## Correções centrais

- Organização escolar separada da clínica e reutilizável por clínicas do mesmo proprietário.
- RLS explícita por catálogo, paciente, reunião, nota, documento, auditoria e fila de revisão.
- Escritas sensíveis removidas de `authenticated`; RPCs v2 executáveis apenas pelo backend `service_role`.
- Vínculo escolar transacional, com apenas um `PRIMARY_SCHOOL` atual e vínculos complementares simultâneos.
- Consentimentos versionados e append-only, com concessão, renovação, expiração e revogação.
- Reunião única em lote com validação de consentimento e conflito de profissionais.
- Ciclo de reunião, pacientes após criação, participantes, presença, ata, notas por paciente, documentos e tarefas canônicas.
- Listagem geral de pacientes com filtros escolares server-side e seleção em lote.
- Agenda unificada com consultas e compromissos escolares, filtros e workspace específico.
- Fila de migração com associação, criação, adiamento, descarte e decisão auditada.
- Idempotência com hash de payload e advisory locks nas operações críticas.

## RPCs v2

- `school_create_school_v2`
- `school_update_school_v2`
- `school_upsert_unit_v2`
- `school_upsert_contact_v2`
- `school_change_enrollment_v2`
- `school_end_enrollment_v2`
- `school_record_consent_v2`
- `create_school_meeting_batch_v2`
- `school_transition_meeting_v2`
- `school_modify_meeting_patients_v2`
- `school_upsert_participant_v2`
- `school_record_attendance_v2`
- `school_save_minutes_v2`
- `school_link_document_v2`
- `school_update_document_v2`
- `school_attach_referral_tasks_v2`
- `school_resolve_migration_review_v2`

## Integrações

- `CoordinatorDashboard.tsx`: filtros escolares na lista principal e criação de reunião com pacientes selecionados.
- `Calendar.tsx`: carrega `/api/calendar/events` e `/api/school-calendar-events` na mesma camada; compromissos escolares abrem `SchoolMeetingWorkspace`.
- `PatientSchoolInformation.tsx`: vínculo histórico, tipos de vínculo e consentimentos versionados.
- `SchoolsManagement.tsx`: catálogo, unidades, contatos, pacientes, reuniões, documentos, histórico e fila de revisão.
- `SchoolMeetingWorkspace.tsx`: transições, participantes, presença, pacientes, ata, notas individuais, tarefas e documentos.
- `services/schoolManagementRoutes.ts`: tenant resolvido pela sessão, paginação, validação em lote e ausência de query por card/paciente.

## Privacidade

A ata geral permanece em `school_meeting_minutes`. Notas individuais são versionadas em `school_meeting_patient_notes`. Recepção não recebe notas clínicas nem documentos específicos de paciente. Compartilhamento com escola exige visibilidade explícita e consentimento válido.

## Testes

- `tests/schoolManagement.test.mjs`: regressão estrutural de migration, RLS, grants, contratos, rotas e integrações frontend.
- `tests/schoolManagement.database.integration.test.mjs`: harness para PostgreSQL/Supabase real, aplicação da migration, RLS, grants e constraints. Exige `SCHOOL_TEST_DATABASE_URL`; cenários com atores e fixtures usam variáveis próprias.

## Limitações de validação deste ambiente

O projeto exige Node 20.x. O ambiente de execução fornecido utiliza Node 22.16.0. A instalação pelo registro npm interno retornou indisponibilidade e a tentativa pelo registro público não concluiu no limite disponível. Portanto, build/typecheck completos só podem ser declarados após execução no ambiente Node 20 com dependências instaladas.

## Preservação

Nenhum `DELETE` em massa, `TRUNCATE`, recriação destrutiva ou alteração da migration já aplicada foi utilizado. Pacientes, agenda clínica, ABA, PEI, Plano Terapêutico, documentos, tarefas, notificações, financeiro, Stripe, TISS e demais módulos foram preservados.

## Commit sugerido

`fix(schools): completar gestão escolar e integrações seguras`
