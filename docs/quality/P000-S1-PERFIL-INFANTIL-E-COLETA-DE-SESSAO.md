# P000-S1 — Coleta infantil abre painel adulto / categoria não persiste

**Prioridade:** P000 — bloqueante de atendimento infantil.
**Registro:** 09/10/2026; Staging. **Aceite:** 🔴 até smoke autenticado, ainda que o código esteja pronto.

## Reprodução e causa confirmada no código
O fundador informou que a sessão de criança falha ao iniciar ou apresenta a coleta convencional adulta mesmo com PTS e planos por especialidade configurados. No cadastro existem dois campos separados: Faixa etária/categoria (grupo/patient_group: infantil, adolescente, adulto, idoso) e Tipo de portal (patientProfileType/patient_profile_type: KIDS, ABA, ADULT). Antes do hotfix, mudar a categoria não sincronizava o tipo; ADULT persistia ou era restaurado após F5 e a coleta seguia para o fluxo adulto. A atualização também podia retornar êxito offline-first antes de confirmação do servidor.

## Solução de cliente implementada
- Shared resolver: infantil/adolescente ganha precedência conservadora sobre ADULT legado, direcionando para Kids; ADULT_ABA e ADULT_CONVENTIONAL seguem separados.
- Formulário: sincronização bidirecional entre categoria e portal, leitura de patient_group e patient_profile_type ao editar e salvamento coerente de group/KIDS/kids_tea.
- App: hidratação e snapshot de anamnese consideram patient_group; estado local recebe o mesmo tipo coerente.
- DataService: mudança de tipo/categoria exige ACK do servidor; não aceitar uma operação offline pendente como salvamento confirmado.
- Regressões automatizadas abrangem as combinações conflitantes, o início de sessão e o contrato de persistência.

## Risco residual do backend — NÃO ENCERRAR SEM AUDITAR
O helper buildPatientProfileTypeFields de server.ts atribui ADULT como padrão quando outros PATCHes demográficos omitem explicitamente o perfil. É necessário proteger o PATCH parcial para não converter inadvertidamente KIDS em ADULT. O arquivo backend é grande e a correção precisa de revisão dedicada, regressão de mutação parcial e teste autenticado. O hotfix frontend NÃO equivale a correção comprovada desse risco.

## Smoke obrigatório P000-S1
1. Editar paciente de teste para Infantil; salvar; F5; reabrir; verificar faixa e portal Kids e valores reais da API (patient_group=infantil, patient_profile_type=KIDS, type=kids_tea). Repetir para Adolescente.
2. Iniciar sessão pela Agenda e diretamente pelo plano de especialidade, paciente com PTS e dois planos, e confirmar que a coleta interativa infantil recebe os alvos corretos. Nunca cair na coleta convencional adulta.
3. Garantir vínculo do mesmo patientId, clinicId, appointmentId, therapeuticPlanId e especialidade, sem cruzamento entre profissionais/clínicas; o servidor deve negar acessos não autorizados.
4. Registrar tentativa de treino, frequência/intervalo e comportamento; finalizar, atualizar a página e consultar histórico, sem perda nem duplicação de dados ou alteração do PTS e PEI.
5. Validar Adulto ABA e Adulto convencional para garantir que mantêm seus tipos. Forçar offline e HTTP 403/409/5xx no salvamento do perfil: não exibir sucesso falso. PATCH apenas de telefone não pode alterar tipo Kids.

## Rastreabilidade
Branch hotfix/p000-infant-profile-session-persistence-20261009. Preencher PR, CI, SHA, deploy e evidência de smoke reais; nenhuma marcação verde por inferência. Produção não deve ser alterada sem aceite.
