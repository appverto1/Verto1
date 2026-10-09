# P000 — Incidente bloqueante: sessão infantil sem coleta infantil / PTS
**Aberto:** 09/10/2026 · **Ambiente:** Staging · **Prioridade:** P000 · **Proprietário de aceite:** equipe clínica

## Relato
Na Agenda da Verto, iniciar uma sessão com paciente infantil falha ou inicia coleta inadequada, sem as interativas e metas do PTS/planos por especialidade previamente cadastrados. Não homologar o fluxo até smoke real com paciente e terapeuta de teste.

## Diagnóstico no código
1. A Agenda chamava `handleConfirmSessionStart({ durationMinutes, openSessionMode:true })` diretamente, contornando `requestSessionStart`, a validação autoritativa de plano por especialidade, acesso e contexto PTS. Resultado possível: aba session sem `therapeutic_plan_id`, carregamento da coleta legada, ausência das metas do plano.
2. Identificação de perfil não reconhecia `panelType` / `panel_type` legados. Idades nulas/vazias eram interpretadas como zero. Um `ADULT` padrão coexistente com categoria infantil podia direcionar ao perfil adulto.

## Correção do PR #345
- Agenda infantil agora chama o **mesmo preflight do botão Iniciar do plano**; uma sessão não é gravada antes da escolha/validação de um plano ativo da especialidade do agendamento e da confirmação do usuário.
- Mais de um plano elegível: exigir escolha explícita. Há planos ativos, mas sem equivalência de especialidade: bloquear e informar o operador em vez de abrir coleta sem vínculo. Falha na resposta canônica `planScopes`: bloquear, não iniciar sessão.
- Isolamento de sessão já confirmado por ID do plano no ACK do servidor; não agregar planos de especialidades diferentes.
- Corrigir classificação por aliases do perfil infantil, sem confundir idade nula com zero, preservando o perfil adulto real.
- Regressões `tests/p000PediatricSessionRoute.regression.test.mjs` executadas pelo `scripts/pre-main-gate.mjs`.

## Invariantes de produto — regressões sempre proibidas
1. Paciente `KIDS` nunca recebe tela de sessão convencional de adulto por erro de classificação, falta de dados ou plano; não alterar silenciosamente o tipo de paciente.
2. Abertura pela Agenda e pelo PTS deve escolher o mesmo escopo por clínica, paciente, profissional, plano ativo e especialidade; nunca iniciar sem confirmação de contexto quando o paciente possui planos por especialidade.
3. Criar sessão e iniciar coleta só após ACK persistido do servidor e verificação do `therapeutic_plan_id`.
4. A coleta infantil deve disponibilizar alvos do plano, tentativas e medições, reforçadores e elementos interativos, manutenções e comportamentos interferentes, respeitando permissões.
5. Mesmo após F5, voltar à Agenda ou alternar clínicas, preservar isolamento de paciente e plano; falhas não podem apagar PTS/PEI ou abrir coleta de outra especialidade.

## Smoke obrigatório antes de 🟢
- Terapeuta em clínica de teste com paciente `KIDS`; PTS com Fono e TO, cada qual com alvos, tentativas, reforço e comportamentos; iniciar pela Agenda e pelo plano.
- Confirmar plano vinculado no backend, visual correto da coleta infantil, registro de tentativa, persistência, F5 e reentrada.
- Rejeitar plano pausado, especialidade diferente, múltiplos planos sem escolha, usuário sem permissão, paciente de outra clínica; preservar dados.
- Controlar regressão para `ADULT_ABA`, `ADULT_CONVENTIONAL`, legados `panel_type` e perfis sem idade.
- Inspecionar Network, logs do servidor e ausência de erros na inicialização. A CI **não substitui** esse smoke.

**Código:** PR [#345](https://github.com/appverto1/Verto1/pull/345), branch `fix/p000-kids-session-plan-routing-20261009`.
**Estado de aceite:** 🟡 Correção proposta, smoke autenticado pendente. **Não liberar produção** sem aceite.

## P000 complementar — Categoria etária não persiste após clicar em Salvar

**Evidência (09/10/2026):** no modal "Editar Cadastro de Paciente", a seleção "Faixa etária / categoria" voltava para "Adulto" depois do salvamento; a sessão em seguida abria o coletor adulto. Mesmo sem data de nascimento, a seleção clínica explícita deve sobreviver ao reload.

**Causa no código:** o campo era persistido no banco como `patients.patient_group`, mas `handleEditPatient` reabria apenas `patient.group || 'adulto'`; a troca do `grupo` não atualizava `patientProfileType`, que permanecia `ADULT`. O resolutor de sessão também ignorava `patient_group`.

**Correção proposta:** o cadastro reidrata a categoria canônica `patient_group`; selecionar infantil/adolescente envia `KIDS` em `patient_profile_type`, `panel_type` e tipo de portal, sem converter adultos ABA indevidamente. Um Salvar de categoria exige ACK do backend e uma consulta autenticada, sem cache e restrita a 1 paciente, verificando o valor e o perfil antes de informar sucesso/fechar a janela. Falhas não confirmadas interrompem o sucesso; múltiplos cliques simultâneos não criam edições concorrentes. O backend existente exige `patient.demographics.edit`, escopo de clínica, CAS e idempotência na RPC; nenhum mecanismo de autenticação/RLS foi relaxado.

**Invariantes:** (1) o clique em Salvar é a única autoridade de gravação; (2) `infantil`/`adolescente` nunca reabrem como `adulto`; (3) confirmação no servidor, e não IndexedDB, define sucesso; (4) `ADULT_ABA` e pacientes idosos/adultos preservam seus fluxos; (5) não mover clínicas, editar PTS/PEI/financeiro nem mudar outro cadastro; (6) sem retry automático que produza overwrite após conflito.

**Regressão automatizada:** `tests/p000PatientCategoryPersistence.regression.test.mjs`, incluída no gate `scripts/pre-main-gate.mjs`. Os testes verificam aliases, roteamento infantil, respeito ao adulto ABA e contratos de ACK/readback; não são substitutos da persistência em banco real.

**Smoke obrigatório, com dados fictícios em staging:** abrir paciente de teste sem data de nascimento, selecionar Infantil, Salvar; confirmar PATCH e GET de confirmação com `patient_group=infantil` e `patient_profile_type=KIDS`; fechar/reabrir, F5, novo login e nova sessão via Agenda/PTS. Repetir Salvar e testar cliques rápidos; depois mudar explicitamente para Adulto e confirmar a reversão. Repetir com Adolescente, Idoso e adulto ABA; testar falta de permissão, clínica diferente, servidor indisponível/conflito, e garantir que erro não mostre sucesso. **Estado:** aguardando CI e smoke autenticado antes de produção.
