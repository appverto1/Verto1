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
