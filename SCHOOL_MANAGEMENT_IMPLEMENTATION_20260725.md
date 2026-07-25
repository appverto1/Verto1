# Cadastro e gestão estruturada de escolas — implementação 2026-07-25

## Diagnóstico anterior

O projeto possuía apenas referências textuais a escola na anamnese (`nomeEscola`) e o tipo de local `escola` no agendamento. Não existiam instituição canônica, unidade, contato escolar, vínculo histórico, consentimento, reunião em lote, ata escolar ou filtro server-side por escola.

## Arquitetura implementada

Fonte de verdade única:

`schools -> school_units -> patient_school_enrollments -> school_consents -> school_meetings`

Reuniões em lote usam uma única linha em `school_meetings` e relações em `school_meeting_patients`. A ata geral é armazenada em `school_meeting_minutes`; conteúdo específico permanece em `school_meeting_patient_notes`, isolado por paciente e visibilidade.

## Tabelas

- `schools`
- `school_units`
- `school_contacts`
- `patient_school_enrollments`
- `school_consents`
- `school_meetings`
- `school_meeting_patients`
- `school_meeting_participants`
- `school_meeting_minutes`
- `school_meeting_patient_notes`
- `school_document_links`
- `school_audit_events`
- `school_migration_review_queue`
- `school_idempotency_records`

## RPC

`public.create_school_meeting_batch`: valida autenticação, tenant, escola, unidade e todos os pacientes em lote; cria uma reunião, relaciona pacientes, congela o snapshot de consentimentos, registra auditoria e persiste resposta idempotente na mesma transação.

## APIs

- `GET /api/schools`
- `GET /api/schools/autocomplete`
- `POST /api/schools`
- `PATCH /api/schools/:schoolId`
- `GET /api/schools/:schoolId`
- `POST /api/schools/:schoolId/units`
- `POST /api/schools/:schoolId/contacts`
- `GET /api/patients/:patientId/school-enrollments`
- `POST /api/patients/:patientId/school-enrollments`
- `POST /api/patients/:patientId/school-consents`
- `GET /api/schools/patients/search`
- `GET /api/school-meetings`
- `POST /api/school-meetings/batch`
- `PATCH /api/school-meetings/:meetingId`
- `PUT /api/school-meetings/:meetingId/minutes`
- `GET /api/school-calendar-events`
- `GET /api/schools/:schoolId/indicators`

## UI

- Nova área **Escolas** no painel do coordenador.
- Listagem paginada, busca, rede e tipo.
- Cadastro com detecção de possível duplicidade.
- Detalhe com resumo, pacientes, contatos, reuniões, documentos e histórico.
- Filtros de pacientes por unidade, série, turma e turno.
- Seleção em lote e criação de uma única reunião.
- Nova aba **Escola** no prontuário, com vínculo atual, troca de escola e histórico.
- Layout responsivo sem `window.location.reload` ou `dangerouslySetInnerHTML`.

## Deduplicação

Prioriza CNPJ e INEP; sem esses identificadores usa nome normalizado + cidade + UF. Correspondências são apresentadas para decisão humana. O cadastro só prossegue como nova instituição mediante confirmação explícita.

A normalização server-side usa Unicode NFC, `unaccent`, caixa, pontuação, espaços e termos institucionais auxiliares. Unidades permanecem separadas e nunca são mescladas apenas pelo nome.

## Migração legada

Quando `patients.school_name`, `patients.school` ou `patients.educational_institution` existir, o texto original é preservado e inserido em `school_migration_review_queue`. A migration não inventa cidade/unidade e não altera o campo antigo.

## Segurança

- RLS habilitada em todas as novas tabelas.
- Escopo por `organization_id` e clínica resolvida pela sessão.
- IDs do payload são revalidados no backend.
- Escrita de catálogo restrita a owner/admin/coordinator/receptionist.
- RPC `SECURITY DEFINER` fixa `search_path`, exige `auth.uid()` e não possui grant para `anon`.
- Exclusão física revogada; arquivamento preserva histórico.
- Auditoria append-only e idempotente.

## Performance

- Escolas: uma consulta paginada principal e quatro agregações em lote paralelas.
- Detalhe: seis consultas limitadas em paralelo, mais uma busca em lote de pacientes.
- Pacientes por escola: uma consulta paginada de vínculos, uma consulta `IN` de pacientes e duas consultas paralelas de consentimentos/reuniões.
- Reunião: validação e inserts em uma RPC, sem query SQL por paciente.
- Nenhuma consulta por card.

## Arquivos alterados/adicionados

- `server.ts`
- `src/services/dataService.ts`
- `src/components/CoordinatorDashboard.tsx`
- `src/components/PatientDetailView.tsx`
- `src/components/SchoolsManagement.tsx`
- `src/components/PatientSchoolInformation.tsx`
- `supabase/migrations/20260725220000_structured_school_management.sql`
- `tests/schoolManagement.test.mjs`
- `SCHOOL_MANAGEMENT_IMPLEMENTATION_20260725.md`

## Testes

Executado com sucesso:

`node tests/schoolManagement.test.mjs`

Valida tabelas, RPC, grants, ausência de DELETE/TRUNCATE, rotas, serviços, integração da navegação, integração do prontuário, reunião única e ausência de reload/HTML inseguro.

O typecheck completo não pôde ser concluído porque o ZIP não continha dependências instaladas e `npm ci` não terminou no ambiente. O projeto declara Node 20.x; o ambiente disponível executava Node 22.16.0. Após correção das assinaturas do `dataService`, o TypeScript não apontou erros nos blocos novos além da ausência dos módulos externos do projeto.

## Roteiro manual

1. Aplicar a migration no Supabase.
2. Entrar como coordenador/administrador.
3. Abrir Atendimento > Escolas.
4. Cadastrar uma escola e testar possível duplicidade.
5. Abrir a escola, filtrar pacientes e criar reunião em lote.
6. Abrir um prontuário > Escola e criar/trocar vínculo.
7. Confirmar histórico anterior preservado.
8. Consultar `/api/school-calendar-events` ou a agenda integrada pelo contrato para reuniões escolares.
9. Registrar consentimento e ata; confirmar separação de nota individual.
10. Executar as consultas somente leitura ao final da migration.

## Preservação

Nenhum registro existente foi apagado. Financeiro, Stripe, ABA, Plano Terapêutico, TISS, leads, faturamento, remarcações e demais módulos não foram alterados estruturalmente.

## Commit sugerido

`feat(schools): add structured school registry, enrollments and batch meetings`
