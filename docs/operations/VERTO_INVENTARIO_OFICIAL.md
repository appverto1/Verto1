# Inventário oficial da Verto — staging

> **Documento oficial de acompanhamento do inventário.** Histórico consolidado em **09/10/2026**; painel corrente conferido em **23/10/2026** com base no inventário mestre de 08–09/10/2026 e na conferência dos PRs GitHub #333–#340. **Rastreio da governança:** [Issue #341](https://github.com/appverto1/Verto1/issues/341). **Ambiente:** staging; produção não foi alterada nesta conciliação.
>
> **Hierarquia de autoridade:** a **Issue GitHub** continua sendo fonte de verdade para requisitos, proprietário, `FACTORY_STATE`, claims, locks, gates e aceite, conforme `docs/factory/GUARDRAILS.md`. **Este arquivo é a fonte oficial única do INVENTÁRIO/visão de prioridades, progresso e links**. Em conflito, revalidar a Issue e a evidência real antes de editar este inventário. O histórico abaixo não reverte o registro atualizado do presente sumário.

## Painel corrente P0–P4 — 23/10/2026 (prevalece sobre histórico abaixo)

**Fonte conferida:** GitHub `staging`, CI dos PRs e Railway Verto-Staging. O deploy ativo `30897de2-430a-490f-afd0-8aa8495ea3ca` corresponde ao commit `877020e9cc47acedf4beb895ee66a018ac8fcfc3` (#479), status **SUCCESS**, 1/1 réplica online, nenhum alerta da aplicação ou falha recente. As correções de autorização (#478) e governança dos gráficos (#479) estão **implantadas**, com smoke autenticado ainda pendente. Merges anteriores fazem parte da história dessa branch, não são deployments simultaneamente ativos. **Produção não foi alterada.** As cores se referem à **funcionalidade específica**, não à integralidade de cada prioridade.

| Prioridade | Funcionalidade / item | Estado validado | Evidência / próximo gate |
|---|---|---|---|
| **P000** | Entrada do tutorial apenas no balão `?` | 🟢 **Smoke humano homologado (5/5)** | [#349](https://github.com/appverto1/Verto1/pull/349); entrada, F5 e relogin aprovados |
| **P0 — Infantil** | Categoria Infantil ao Salvar e F5 | 🟢 **Smoke limitado homologado** | Cadastro persistiu após F5; **não** homologa a sessão clínica completa |
| **P0 — Infantil** | Hidratação do perfil e proteção contra PATCH parcial indevido | 🟡 **Código publicado; smoke pendente** | [#467](https://github.com/appverto1/Verto1/pull/467) `02f970ce` e [#468](https://github.com/appverto1/Verto1/pull/468) `dc24db80`; ambos Railway SUCCESS; testar Infantil/Adulto ABA/Salvar/F5/API direta |
| **P0 — Infantil** | Abertura e persistência da sessão clínica após o cadastro | 🟡 **Smoke integrado pendente** | Corrigido fluxo de permissões; verificar ao vivo sem loop ou troca para coleta adulta |
| **P0 — Financeiro** | Plano por especialidade e profissional ativo | 🟡 **Publicado; smoke pendente** | [#450](https://github.com/appverto1/Verto1/pull/450) `83f068e4` + migração v3 Supabase Staging; preservar histórico e clínica |
| **P0 — Clínico** | Planos independentes e ativação pelo próprio especialista | 🟡 **Publicado; smoke pendente** | [#462](https://github.com/appverto1/Verto1/pull/462) e [#463](https://github.com/appverto1/Verto1/pull/463) |
| **P0 — Convites** | Onboarding profissional autenticado e upload | 🟡 **Publicado; smoke pendente** | [#464](https://github.com/appverto1/Verto1/pull/464) |
| **P0 — Gráficos** | Publicar somente gráfico infantil permitido, com revogação após vínculo encerrado | 🟡 **Publicado; smoke pendente** | Funcionalidade canônica [#440](https://github.com/appverto1/Verto1/pull/440); proteção adicional [#466](https://github.com/appverto1/Verto1/pull/466) `cf9e1538`; adulto permanece com bem-estar fixo |
| **P0 — Gráficos** | Identidade global condicional e delegação por caso entre clínicas | 🟡 **PR #479 mergeado; migrações Staging, CI e deploy SUCCESS; smoke pendente** | [#479](https://github.com/appverto1/Verto1/pull/479), merge `877020e9`; preserva seleção por clínica quando não há identidade global verificada (0/12 ativos vinculados), autoriza por caso e bloqueia publicação simultânea cross-clinic para identidades verificadas. [#429](https://github.com/appverto1/Verto1/pull/429) fechado sem merge |
| **P0 — Segurança** | Verificação de autorização clínica por identidade da sessão | 🟡 **PR #478 mergeado; migração Staging, CI e deploy SUCCESS; smoke pendente** | [#478](https://github.com/appverto1/Verto1/pull/478) / [Issue #477](https://github.com/appverto1/Verto1/issues/477); `anon` sem EXECUTE e papel `authenticated` somente consulta a própria identidade do JWT (RLS preservada); não confundir com smoke funcional |\n| **P0 — Ajuda** | Central de Ajuda: busca/expansão de resultados e progresso isolado por vínculo e papel | 🟡 **Publicado; smoke pendente** | [#470](https://github.com/appverto1/Verto1/pull/470) (`463a706d`) e [#471](https://github.com/appverto1/Verto1/pull/471) (`ce961280`) mergeados, Railway SUCCESS; testar busca, autorização, vínculo e F5 |
| **P0 — Agenda/sessões** | Início/finalização, timers, offline, permissões, especialidades e financeiro | 🟡 **Entregas técnicas; smoke do ciclo pendente** | Conferir itens individualmente; testes de papéis, persistência e isolamento cross-clinic |
| **P0 — Mobile** | Menu e cabeçalho nos papéis efetivamente testados | 🟢 **Smoke humano homologado no recorte testado** | [#437](https://github.com/appverto1/Verto1/pull/437) e [#438](https://github.com/appverto1/Verto1/pull/438); não extrapolar a todos papéis |
| **P1 — Cancelamento** | Cancelar automaticamente a partir de lembrete autêntico 24h | 🟡 **Publicado; smoke pendente** | [#457](https://github.com/appverto1/Verto1/pull/457) `f652071b` + RPC Staging; 12h exige aprovação |
| **P1 — Remarcação** | Pedir 3 opções, aceite da clínica, novo lembrete 24h/12h | 🟡 **Smoke integrado pendente** | Validar papéis de agenda, novo horário e deduplicação |
| **P1 — Relatório** | Rota GET de tempo por paciente (extração sem mudança funcional) | 🟡 **CI/merge/deploy concluídos; smoke pendente** | [#469](https://github.com/appverto1/Verto1/pull/469), merge `3a1fa5749128c1b8211f5831e94aae1228c39958` e Railway SUCCESS (posteriormente substituído). Não mergear [#394](https://github.com/appverto1/Verto1/pull/394) antigo por duplicação |
| **P1 — Backend** | Handler administrativo de status ABA V3: modularização sem mudança funcional | 🟡 **CI/merge/deploy concluídos; smoke pendente** | [#473](https://github.com/appverto1/Verto1/pull/473), merge `6aab7a92d04bbc170eda132c6f10b4e7e263d2d4`; CI `40032570162` SUCCESS e Railway `0ba40b46-0b95-4671-9fa7-542a66fb3027` SUCCESS. Preservados `requireAbaV3PreflightFeature` → `checkAuth` → `checkPlatformAdmin` e RPC; não mergear [#393](https://github.com/appverto1/Verto1/pull/393) antigo por duplicação. |
| **P1 — Backend** | Rota protegida de diagnóstico de schema de remarcação: extração sem mudança funcional | 🟡 **CI/merge/deploy concluídos; smoke autenticado pendente** | [#475](https://github.com/appverto1/Verto1/pull/475), merge `0300a8b25a9d99e5ec9dcadbb038c24e50f40c98`; CI `40038333823` SUCCESS (27 etapas), Railway `3bc36370-189f-448e-aa45-cee880690b0a` SUCCESS, 1/1 online. Preservados `checkAuth` → `checkPlatformAdmin` (Super Admin + MFA), formato JSON, cache de schema e TTL; teste 401/403/200. [#388](https://github.com/appverto1/Verto1/pull/388) antigo fechado sem merge por duplicação. |
| **P1 — Agenda** | Impedir agendamento em dias não habilitados pela clínica por validação server-side | 🟠 **Parcial — correção de remarcação em PR #481; CI/smoke pendentes** | [#481](https://github.com/appverto1/Verto1/pull/481) (DRAFT): jornada semanal configurada agora trata dia omitido como fechado nas sugestões e na validação da remarcação do portal; **criação/edição direta pela Agenda e persistência transacional ainda não auditadas/corrigidas**. Não confundir esta fatia com P1-11 concluído. |
| **P1 — Outros 28–44** | Notificações, repasses, dashboards e outros | ⚪ **Conciliação individual pendente** | Há entregas posteriores em vários itens; não interpretar como todos não implementados |
| **P2 — 41 itens** | Sessões em grupo, tarefas, relatórios, finanças e demais backlog | ⚪ **Conciliação individual pendente** | Há entregas posteriores ao inventário original; não classificar o grupo inteiro como vermelho |
| **P3 — 21 itens** | UX, configuração, menus, onboarding e comercial | ⚪ **Conciliação individual pendente** | Itens homologados parcialmente, como menu mobile, não conferem aceite geral |
| **P4 — 3 itens** | Escola, Convênios/TISS amplo e biblioteca/sugestões opcionais | ⏸️ **Pausado por decisão do fundador** | Não reativar sem solicitação expressa |

**Checkpoint técnico 24/10 — P1-11:** branch `fix/p1-11-portal-weekday-fail-closed-20261024`, [PR #481](https://github.com/appverto1/Verto1/pull/481) aberto em DRAFT para `staging`. Alteração mínima em `src/services/portalRescheduleAvailability.ts`: um dia omitido de uma jornada profissional explicitamente configurada deixa de receber fallback de 08h–18h; tanto as opções sugeridas quanto a validação da remarcação passam a tratá-lo como fechado. Teste dirigido novo em `tests/p1PortalRescheduleConfiguredWeekdays.regression.test.ts`, incluído no gate pré-main. **Status deste checkpoint: código proposto, CI do SHA final pendente; sem merge, deploy ou smoke comprovados.** O P1-11 permanece aberto para bloqueio server-side na criação/edição de sessões pela clínica, verificação de disponibilidade canônica e teste transacional. Produção intocada.

**Auditoria pré-smoke de 23/10 (horário de Brasília):** implementado guard de isolamento dos controles de gráfico ao trocar de paciente; dados de delegação e retornos assíncronos da sessão anterior não devem persistir no novo caso. [PR #480](https://github.com/appverto1/Verto1/pull/480) contém o hotfix; verificar o CI e o deploy associados ao SHA final antes do smoke, sem inferir homologação. O aviso de segurança `authenticated_security_definer_function_executable` ainda exige revisão técnica do contrato RLS, mesmo com a vinculação ao `auth.uid()`; não alterar permissões cegamente. O registro global e as delegações continuam sem dados: isso **não homologa** o cenário de identidade compartilhada entre duas clínicas.\n\n**Regra de estado:** 🟢 homologação humana real no recorte indicado; 🟡 código implantado, sem smoke completo; 🔴 implementação faltante confirmada ou não integrada; ⚪ não conciliado, **não necessariamente inexistente**; ⏸️ adiado intencionalmente. Não usar merge/CI como prova automática de persistência após F5. O botão **Salvar** continua autoridade exclusiva para alterações clínicas e cadastrais.

## Histórico de conciliação de 23/10/2026 — registro anterior (subordinado ao painel corrente acima)

> **Este painel registra um checkpoint anterior; o painel corrente P0–P4 acima prevalece em caso de divergência** com as linhas abaixo, inclusive o quadro conciliado em 09–21/10 e o histórico importado de 08–09/10. Indicadores verdes continuam reservados exclusivamente a smoke humano autenticado e confirmado; `CI SUCCESS`, merge e deploy `SUCCESS` por si só são **amarelos**. Evidências de correções posteriores devem ser acrescentadas por item, sem reescrever o histórico. Produção não foi alterada nessas entregas.

| Prioridade | Funcionalidade | Estado corrente | Evidência verificada / próxima ação |
|---|---|---|---|
| **P0-352 / Issue #352** | Planos financeiros vinculados a profissional clínico ativo e especialidade | 🟡 **PR #450 mergeado em staging; deploy SUCCESS; smoke pendente** | [PR #450](https://github.com/appverto1/Verto1/pull/450), merge `83f068e470ba0cda448054792edbd54942f2694a`, Railway `51ae6e87-e552-498f-9483-9e1849a0c20b` SUCCESS, Supabase Staging migração `patient_financial_plan_professional_binding_v3` instalada; grants da função v3 exclusivos `service_role`. Próximo smoke: profissional ativo correto → Salvar → F5/relogin, recusa de profissional revogado/de outra clínica e preservação de cobranças/histórico. |
| **P1-27** | Cancelamento automático a partir de lembrete **24h realmente enviado** | 🟡 **PR #457 mergeado em staging; deploy SUCCESS; smoke pendente** | [PR #457](https://github.com/appverto1/Verto1/pull/457), merge `f652071b438d4862f30c47151349866c54f7eec1`, Railway `9f68e6c5-cd14-41a6-b4d4-67caa0440f29` SUCCESS, Supabase Staging migração `portal_24h_reminder_atomic_cancellation_v1` aplicada com função acessível somente a `service_role`. A notificação deve pertencer ao destinatário autenticado, e 12h permanece sujeito à clínica. Próximo smoke: 24h/12h, outro destinatário/clínica, remarcação, replay, F5. PRs #451–#454 são alternativas **não integradas**; não fazer merge duplicado. |
| **P0 — planos por especialidade** | Planos independentes por especialidade; ativação de programas preparados | 🟡 **PRs #462 e #463 mergeados e implantados; smoke pendente** | Railway Staging registrou `SUCCESS` para merges #462 e #463, subsequentemente substituídos pelo deploy mais recente da mesma branch. Testar criação e ativação imediata pelo especialista com persistência F5, papéis e clínica corretos; não declarar homologação só pelo CI. |
| **P0 — onboarding profissional** | POST autenticado de conclusão do onboarding e upload | 🟡 **PR #464 mergeado e implantado; smoke pendente** | Merge `103820af6715dc271ccd4bc84c362fe1e715f11c`, Railway Staging `9ff2949a-9192-40ca-a108-a6bfa7dd6bf3` SUCCESS; fluxo de convite, papel, clínica e persistência requer validação humana. |
| **P0 — gráfico infantil / Issue #171** | Exibir apenas gráfico autorizado/publicado, mantendo bem-estar adulto | 🟠 **PR #429 ainda em Draft, não mergeado** | Não tratar como entregue. Auditar identidade global, delegação por caso, isolamento entre clínicas, histórico, migração, CI e gate do banco isolado antes de integrar. |
| **P000 — tutorial de entrada** | Apenas balão no botão de ajuda, sem tour automático | 🟢 **Smoke humano aprovado em 5/5** | PR #349 e confirmação do fundador (09/10/2026): entrada, posicionamento, fechar, F5 e logout/relogin. Este aceite não cobre todos os fluxos da Central de Ajuda. |
| **P000-S1 — categoria infantil** | Persistência de categoria Infantil | 🟢 **Salvar + F5 aprovados; sessão clínica separada ainda precisa validação** | Não usar o aceite de categoria para declarar o fluxo completo da sessão infantil homologado. |
| **P1/P0 remarcação** | Portal, aceite por papéis autorizados e lembretes 24h/12h | 🟡 **Código implantado em Staging; smoke integrado ainda pendente** | Validar paciente/responsável → solicitação de três horários → aceite por papéis de agenda → novos lembretes na agenda remarcada, sem aviso do ciclo anterior ou duplicidade. |

**Regra operacional de atualização:** preservar a autoridade do botão **Salvar** para persistência; evidenciar por funcionalidade branch, PR, commit de merge, deploy por SHA e smoke; consultar este inventário **sem bloquear trabalho por ausência de labels, agentes, locks ou burocracia de fábrica**. Nunca inferir permissões a partir do frontend. **Não promover estes estados a verde sem smoke real.**

## Estado histórico conciliado em 09–21/10/2026 (supersedido pelo painel de 23/10 acima)

**Referências verificadas:** base histórica `staging@f74d25f` (PR #340). Tutorial: PR #349, `739b5e2`, deploy `62a2b6a8-22a4-4892-b242-6f39ed90712b` (smoke humano PASS). Hotfix P000-350: PR #353, `staging@9aa7e990db87b39e88e1c968ce4e6d9f91e75747`, Railway `14ae180b-e24c-4ba7-afc5-333a5d16189c` SUCCESS; **SMOKE PENDENTE**. Merge, CI ou deploy não substituem homologação funcional.

| Prioridade | Item / recorte | Estado observado | Evidência e próximo gate |
|---|---|---|---|
| **P0 — PRÓXIMA CORREÇÃO PRIORITÁRIA (Issue #171)** | **Profissional compartilha um único gráfico clínico no portal infantil; remover os gráficos automáticos** | 🔴 **INCOMPLETO — código e smoke pendentes** | **Nova decisão do fundador, 21/10/2026:** no portal **infantil**, deixar de renderizar automaticamente `EvolutionBarChart` (evolução) e `CumulativeGrowthChart` (crescimento cumulativo). Somente visualização **explicitamente selecionada, publicada e autorizada** pelo profissional aparece ao paciente; se nenhuma, mostrar estado vazio. Permitir publicar/substituir/revogar com backend server-owned, seleção única por paciente/clínica, isolamento role/tenant, F5/relogin e testes negativos. **Preservar todos os gráficos profissionais.** No portal **adulto**, manter fixo o gráfico existente de bem-estar, sem condicioná-lo a publicação nem substituí-lo. [Issue #171](https://github.com/appverto1/Verto1/issues/171) contém contrato/branch históricos com trabalho parcial; decisões antigas de manter crescimento cumulativo infantil estão **revogadas**. **Próximo gate:** implementação controlada e CI; depois deploy e smoke humano um passo de cada vez. Produção intocada. |
| **SMOKE HOMOLOGADO — Menu profissional mobile** | Menu hambúrguer estável, cabeçalho com foto/nome/cargo/alternância de tema, permissões de agenda/remarcação da recepcionista | 🟢 **SMOKE HUMANO APROVADO NOS PAPÉIS TESTADOS — 21/10/2026** | [PR #437](https://github.com/appverto1/Verto1/pull/437), merge `d39a7c25`, Railway deploy `119ced85-cce0-4469-9f7f-45f565761be5` SUCCESS; [PR #438](https://github.com/appverto1/Verto1/pull/438), merge `ff83f276`, CI `39537575435` SUCCESS, Railway deploy `1a159b81-c476-429d-a9cd-fe8742b9ebb9` SUCCESS. Usuário confirmou no perfil **recepcionista** abertura estável, identidade/cargo, mudança de tema e persistência após reabrir/F5, além do fluxo de remarcação autorizado. Confirmou também organização do menu em **diretor e outros profissionais testados**; não presumir validação exaustiva de todos os papéis. Produção não alterada. |
| **P000** | Tutorial automático de entrada: **somente o balão no botão `?`**, sem os passos 2–7 | 🟢 **SMOKE HUMANO APROVADO — 5/5, somente recorte de entrada** | [PR #349](https://github.com/appverto1/Verto1/pull/349), merge `739b5e247a14c1d7fef7786cc2dd6b7241ee46b1`, Railway staging deploy `62a2b6a8-22a4-4892-b242-6f39ed90712b` SUCCESS. Testes aprovados pelo fundador em 09/10: desktop ao entrar; posicionamento/visibilidade mobile sem etapas extras; `Entendi`; F5; logout/relogin. Evidência na [Issue #285](https://github.com/appverto1/Verto1/issues/285). **Não** homologa Central de Ajuda Tema→Tópicos, busca, progresso do tutorial manual, roles/capabilities; manter P0-31/Issue aberta. Produção não autorizada. |
| **P000-S1** | Categoria infantil persiste, mas abertura do atendimento ainda não foi revalidada | 🔴 **SMOKE REPROVADO no passo 3; repetir após hotfix #350** | Salvar Infantil e F5: PASSOS 1 e 2 APROVADOS (smoke humano 09/10). Passo 3: FAIL anteriormente por loop de autorização. Hotfix PR #353 já implantado no Railway staging (`9aa7e990db87b39e88e1c968ce4e6d9f91e75747`), **não recebeu novo smoke**. Retestar sessão com profissional autorizado, negar outro profissional sem loop e verificar fluxo clínico infantil; PR #346 da persistência preservado. |
| **P000-PTS** | Erro 409 ao ativar PTS após salvar e sessão infantil sem alvos | 🟡 **Código mergeado; smoke autenticado pendente** | [PR #347](https://github.com/appverto1/Verto1/pull/347), merge `e5cf006083685fd7e7c31f242399864d8498ca43`. Próximo smoke: Salvar→Ativar sem F5, duplicidade, conflito em duas abas, campos opcionais, fluxo KIDS com/sem alvos; confirmar migração de staging e segurança por clínica antes de aceite. |
| **P000-350** | Loop de alerta ao vincular sessão a outro profissional | 🟡 **Hotfix no staging; smoke humano pendente** | [Issue #350](https://github.com/appverto1/Verto1/issues/350), [PR #353](https://github.com/appverto1/Verto1/pull/353), head `43d5fdf5b629027384a5e75dc07221c992ff9c2c`, CI `staging-gate` SUCCESS run `38002766298`, merge `9aa7e990db87b39e88e1c968ce4e6d9f91e75747`, Railway deploy `14ae180b-e24c-4ba7-afc5-333a5d16189c` SUCCESS, réplica online. Próximo gate: smoke de rejeição única/navegação normal, depois sessão autorizada; sem bypass de tenant/role/profissional. Produção intocada. |
| **P0-351** | Agenda: especialidades só de profissionais com vínculo clínico ativo na clínica | 🟡 **Staging técnico validado; smoke humano pendente** | [Issue #351](https://github.com/appverto1/Verto1/issues/351), [PR #354](https://github.com/appverto1/Verto1/pull/354), merge `9e99ab769344175393baf73108b4151a9384c341`; CI `38005958788` SUCCESS head `649d5e7`; Supabase Verto-Staging migração `clinic_schedulable_specialties_v1` SUCCESS, RPC e trigger ativos, anon sem EXECUTE, teste de rejeição sintética PASS; Railway `Staging` deployment `6e0ad1a2-437a-4463-b827-188d0eaa0896` **SUCCESS**, online 1/1 réplica, zero alertas/falhas recentes. **Ainda falta smoke humano**: clínica sem TO, com TO, edição/agenda semanal/F5/API. Produção não alterada. |
| **P0-352** | Plano financeiro: especialidade e profissional ativo obrigatórios para novo vínculo | 🟡 **PR #450 mergeado + deploy SUCCESS; smoke humano pendente em 23/10** | Evidência e roteiro atualizados no painel corrente acima; os registros anteriores deste item são históricos. |
| **P0** | 403 ao salvar plano financeiro do paciente | 🟡 Código mergeado; **smoke autenticado pendente** | [PR #334](https://github.com/appverto1/Verto1/pull/334) / merge `798ff6dc8e394a220e459f716186c51b047c0351`. Testar edição simples autorizada, persistência F5 e negação explícita de TISS sem capability. |
| **P0 1–20, 24–30** | Sessão, offline, permissões, ABA, anamnese, agenda, financeiro e gráficos | 🟡 Implementações/revisões previamente registradas em staging, **sem aceites completos** | Seguir evidência específica por número no histórico abaixo; reproduzir fluxos e provar permissões, isolamento, persistência e F5. Não traduzir CI em smoke. |
| **P0 21–23** | Solicitações/cancelamentos e lembretes de agenda | ⚪ A conciliar individualmente | Registros históricos não comprovam os três aceites ponta a ponta; validar comportamento e lembretes 24h/12h, recorrência/remarcação e deduplicação. |
| **P0 31** | Tutorial contextual e Central de Ajuda | 🔴 **Aceite inicial reprovado** | A decisão posterior do fundador **substitui apenas o onboarding automático** por um único balão no “?” (P000); manter tutorial manual, ajuda por Tema → Tópicos e filtros por permissão. [PR #333](https://github.com/appverto1/Verto1/pull/333) anterior não resolveu a entrada. |
| **P1 1–2** | Restaurar contexto após F5 e preferência de push por dispositivo | 🟡 Código mergeado, smoke pendente | [PR #334](https://github.com/appverto1/Verto1/pull/334). |
| **P1 3–7** | Push ponta a ponta, validação de perguntas, UX da anamnese | ⚪ Sem aceite confirmado | Revisar individualmente implementação e smoke; **não presumir entregue**. |
| **P1 8–10** | Editor e compartilhamento de anamnese, PDF | 🟡 Código de 8–9 mergeado; PDF 10 auditado, sem smoke | [PR #336](https://github.com/appverto1/Verto1/pull/336). Testar compartilhamento expresso, roles, PDF e clínica cruzada. |
| **P1 11** | Dias de agendamento não habilitados pela clínica | 🔴 **Backend/política clínica pendentes** | Não implementar só bloqueio visual: exige fonte canônica, validação server-side e testes de API/tenant. |
| **P1 12–17** | Gráficos por especialidade, alvos, PTS e hidratação de permissões | 🟡 Componentes auditados/ajustes mergeados; smoke pendente | [PR #336](https://github.com/appverto1/Verto1/pull/336) (12) e [PR #337](https://github.com/appverto1/Verto1/pull/337) (13–17); testar TO/Fono/adulto, F5 e papéis. |
| **P1 18–22** | Adultos, histórico, financeiro simples e TISS condicional | 🟡 Código/revisão mergeados; smoke pendente | [PR #338](https://github.com/appverto1/Verto1/pull/338) e [PR #339](https://github.com/appverto1/Verto1/pull/339). A paridade completa de histórico do adulto convencional continua não comprovada. |
| **P1 23–26** | Especialidade no agendamento, recepção, salas e status pendente | 🟡 Código mergeado, smoke pendente | [PR #340](https://github.com/appverto1/Verto1/pull/340), merge `f74d25f1976ca4c1790155b03d669a8f13a6e2e5`. Validar API direta, papéis, troca de clínica e tela. |
| **P1 27** | Cancelamento automático por lembrete confiável de 24h | 🟡 **PR #457 mergeado + deploy SUCCESS; smoke humano pendente em 23/10** | Evidência, restrição do lembrete de 12h e testes negativos no painel corrente; registros anteriores são históricos. |
| **P1 28–44** | Lembretes, notificações, repasses, relatórios e validações pendentes | ⚪ Pendente de conciliação caso a caso | Sem prova individual de entrega/aceite no inventário; conferir Issues/PRs e testes antes de selecionar implementação. |
| **P2 1–41 / P3 1–21** | Backlogs médio/baixo | ⚪ Em inventário, sem conciliação individual atual | Não interpretar falta de verificação como falha ou implementação. Seguir prioridade e evidência real. |
| **P4 1–3** | Escola, Convênios/TISS amplo, sugestões opcionais | ⏸️ Fora do escopo imediato por decisão do fundador | Não reativar módulos pelo inventário. Correção de acesso a TISS já licenciado não significa liberar comercialização do módulo. |

**Legenda:** 🔴 não implementado/reprovado; 🟠 código em branch sem entrega em staging; 🟡 código ou auditoria mergeados em staging aguardando smoke; 🟢 somente com smoke verificável no SHA implantado; ⚪ não conciliado/sem evidência suficiente; ⏸️ fora do escopo. Percentuais históricos são **estimativas** e não substituem evidência.

**Atenção operacional:** os registros anteriores de P1 1–2 como "pendente de conciliação" são anteriores ao PR #334; P1 23–26 descritos como "em PR" já constam mergeados pelo #340. O histórico integral foi mantido para rastreabilidade, sem promover estados sem smoke.

**Atualização de produto (21/10/2026):** o registro histórico **P1 38** ("gráfico no portal do paciente") foi promovido para **P0 — próxima correção prioritária**, reaproveitando a [Issue #171](https://github.com/appverto1/Verto1/issues/171). A UX histórica da #171 que mantinha `CumulativeGrowthChart` no portal infantil foi substituída pela decisão expressa do fundador: **retirar os dois gráficos automáticos infantis**. O gráfico fixo de bem-estar do **adulto permanece inalterado**. O histórico abaixo não altera esse direcionamento.

## Regra obrigatória de atualização por entrega para todos os agentes

1. **Antes de iniciar:** ler este arquivo no SHA vigente de `staging` **e** reler a Issue GitHub do item; aplicar ordem de prioridade, locks, claims, gate e `active_handoff` canônicos. Não iniciar item já concluído nem concorrer sobre a mesma Issue.
2. **Após cada entrega/gate:** persistir **imediatamente na Issue** `status / evidence / blocked_on / next_gate` e referências reais (branch, commit/head, PR, check CI, merge SHA, deploy Railway e smoke). Toda informação sem comprovação deve permanecer PENDENTE/UNKNOWN. Não atribuir porcentagens fictícias.
3. **Atualização do documento no GitHub:** incluir a alteração mínima do item neste inventário no PR já autorizado quando possível; quando a evidência surgir depois do merge (CI/deploy/smoke), abrir uma **atualização documental isolada por branch/PR para staging**, encaminhada ao papel competente de PR/CI/merge. A Issue registra o dado imediatamente até a atualização do arquivo ser mergeada. **Não escrever diretamente em staging/main para contornar gates.**
4. **Anti-concorrência:** na atualização de arquivo, fixar base/head, reler documento, aplicar **somente** o registro daquele item identificado por prioridade/número, revisar diff, validar CI e evitar sobrescrita de outros updates. Em caso de SHA drift, rebase/refresh; nunca force-push nem substituir o arquivo inteiro às cegas.
5. **Estado:** vermelho para pendência concreta, laranja para código só em branch, amarelo após entrega verificada no Git/staging com smoke faltando, verde após smoke provado no mesmo deployment/head. Manter histórico, inclusive falhas, e preservar status de tarefas não relacionadas.
6. **Entrega ao próximo agente:** informar link do commit/PR e SHA de `staging`, próximo gate/owner, smoke necessário, teste negativo de role/tenant e risco de custo Supabase/Railway. Nunca alegar documentação atualizada até merge da atualização documental.
7. **Segurança:** nada de PII/secrets, payloads clínicos completos ou dados reais nos arquivos. Produção não autorizada. `GUARDRAILS` e `FACTORY_PROTOCOL` prevalecem; este inventário **não substitui as Issues nem concede permissão de merge/deploy**.

## Histórico integral importado do inventário anterior

O conteúdo abaixo é o inventário fonte anterior preservado para **cobertura e rastreabilidade**. Contém diagnósticos datados, estados supersedidos pelo sumário acima e itens ainda sem reconciliação; não é uma segunda fila operacional.

---

# Verto — Inventário mestre de prioridades e pendências
**Data de conciliação:** 08/10/2026

## Execução automática — 09/10/2026 — P000 (registro parcial)

- **P000 — tutorial automático bloqueante no login:** 🟠 **correção de código preparada em branch, ainda não entregue em staging; smoke pendente**. Substituído o gatilho automático de `TutorialOverlay` por um balão não modal próximo ao botão `?`, dispensável, preservando tour manual e Central de Ajuda. Não declarar resolvido sem CI e smoke visual autenticado. **Progresso técnico estimado: 65%** (implementação em branch, sem PR/deploy/smoke).
- **Branch:** `fix/p000-help-hint-only-20261009`; **commit:** `c00b4eb8c56424aaba8e989e725e9c57438097a9`; **PR:** não criado — operação de criação bloqueada pelo controle de segurança da integração GitHub; **deploy:** não realizado. **Testes:** regressão estática atualizada no commit, CI ainda não executado. **Impacto:** somente apresentação inicial da ajuda e teste; sem alterações em Supabase, Railway, APIs, papéis, pacientes ou produção.
- **Commit Summary:** `fix(P000): replace automatic guided tour with Help-button hint`. **Bloqueio:** criar PR para staging, aguardar CI, realizar smoke desktop/mobile/F5; até lá manter P000 aberto.

## Execução automática — 09/10/2026 — conciliação das tarefas 2 e 3

### 2. P0 — erro 403 ao salvar plano financeiro de paciente
- **Estado:** 🟡 **código já mergeado em staging no PR #334**, antes desta execução; **smoke autenticado pendente**. Não duplicar correção já implementada. A alteração anterior separa os campos financeiros simples de eco implícito de dados TISS protegidos e preserva o bloqueio backend `PATIENT_INSURANCE_EDIT_CAPABILITY_REQUIRED` para mutações TISS explícitas.
- **Progresso:** ~80% técnico, sem validação funcional. **Branch/commit/PR:** entrega anterior PR #334, merge `798ff6dc8e394a220e459f716186c51b047c0351`; **novo commit:** nenhum; **deploy desta execução:** nenhum; **smoke:** não realizado (sem sessão autenticada).
- **Testes/evidência:** teste existente `tests/p0Financial403ScopeAndGraphs.regression.test.ts` inspecionado; não equivale a reproduzir PATCH 403 com clínica, papel e paciente reais de teste. **Bloqueio:** reproduzir alteração de cobrança particular por usuário autorizado e garantir 403 para TISS não autorizado, com F5/relogin. **Commit Summary:** nenhuma mudança necessária nesta rodada.

### 3. P1-27 — cancelamento automático pela notificação de 24h
- **Estado:** 🔴 **pendente de backend, não entregue**. O inventário e o PR #340 confirmam que o portal ainda registra `CANCEL_REQUESTED`; a origem confiável do lembrete de 24h não está vinculada ao pedido de cancelamento.
- **Progresso:** ~20% (análise e dependências identificadas, sem alteração de código). **Branch/commit/PR/deploy:** nenhum nesta tarefa.
- **Segurança e integridade:** há filas distintas `APPOINTMENT_REMINDER_24H` e `APPOINTMENT_REMINDER_12H` em `notification_jobs` e RPC transacional de aprovação de cancelamento restrita à clínica; não é seguro converter indiscriminadamente `CANCEL_REQUESTED` em cancelamento automático. Exige prova server-side do lembrete válido, paciente/organização/agendamento/ciclo de horário, idempotência, corrida com remarcação e auditoria; preservar solicitação de 12h.
- **Testes:** revisão estática de migrações e serviço de notificações; sem teste de integração ou smoke. **Bloqueio:** implementação backend de origem confiável e transação atômica, seguida de CI/staging/smoke. **Commit Summary:** nenhuma mudança aplicada para evitar bypass de cancelamento.

## Conciliação técnica — lote P1 23–27 (08/10/2026)

| P1 | Funcionalidade | Situação técnica | Smoke de aceite |
|---|---|---|---|
| **23** | Especialidade no agendamento derivada da equipe da clínica | 🟡 **Corrigido em código**: removida lista fixa que incluía ABA/eventos não clínicos; seleção simples e semanal agora usam especialidades canônicas de profissionais vinculados; histórico legado preservado como opção indisponível | Clínica de teste com Fono e TO, outra sem esses vínculos; conferir recarga F5, criação/edição e recorrência, negação backend de valores arbitrários |
| **24** | Recepção: card de sessão com somente ações administrativas de status | 🟡 **Corrigido no frontend**: oculta início/continuação, prontuário, relatório, gráficos, plano sugerido, sondagens, recomendações, fechamento e blocos financeiros; ações de status preservadas | Entrar como recepcionista com sessão real; verificar sem conteúdo clínico e tentativas diretas de API devem retornar 403; validar coordenador e terapeuta |
| **25** | Salas cadastradas aparecem ao abrir o agendamento | 🟡 **Corrigido em código**: leitura canônica de salas a cada abertura do modal, proteção contra respostas obsoletas e mensagem de erro, sem exigir visita a Configuração de Salas | Criar sala de teste; entrar diretamente em Agenda após F5; abrir o agendamento e encontrar sala; testar troca de clínica e falha de rede |
| **26** | Pendente não mostra “Sessão cancelada” | 🟡 **Corrigido em código**: status persistido `PENDING_CONFIRMATION` prevalece sobre fase/resumo `cancelled` obsoleto no painel de fechamento | Agendamento pendente com snapshot de fechamento obsoleto; verificar que não apresenta cancelada e que cancelamento real continua corretamente cancelado |
| **27** | Cancelamento automático na resposta ao lembrete de 24h | 🔴 **PENDENTE BACKEND**: rota atual do portal registra `CANCEL_REQUESTED`, sem comprovação de origem 24h e atualização transacional; não substituir solicitação por cancelamento automático indiscriminado | Identificar notificação 24h versus 12h no servidor e criar cancelamento idempotente por paciente/organização/appointment; cobrir concorrência, auditoria e F5; 12h deve continuar solicitação |

**Rastreabilidade:** branch `fix/p1-23-27-agenda-reception-20261008`, PR [#340](https://github.com/appverto1/Verto1/pull/340) **MERGEADO em staging** no commit `f74d25f1976ca4c1790155b03d669a8f13a6e2e5`. GitHub Staging CI [run 37867033868](https://github.com/appverto1/Verto1/actions/runs/37867033868) **SUCCESS** (typecheck, build, tutorial, regressões). Railway deploy `884f67f6-b94f-4b28-80ee-4d4cf3ce24fd`: BUILDING na primeira verificação, aguarda confirmação; status final adiante. Nenhum item verde: smoke autenticado pendente. Sem mudanças em banco ou produção. **P000 tutorial segue 🔴**.

## Regras
- **Arquivo fonte canônico:** `/Verto/Prioridades/Base-original-prioridades-2026-10-08.txt`. Os textos originais abaixo são reproduzidos **sem substituição**.
- Staging é a referência de produto, produção precisa convergir **sem alterar propostas, links, pacientes, contratos e históricos existentes**.
- Uma alteração mergeada **não** é automaticamente aprovada funcionalmente. `PENDENTE DE SMOKE` significa que falta provar com ação, efeito e F5, role/clinic/outro contexto.
- Sem evidência de implementação ou de teste, o estado é `A VERIFICAR`, e não `FALHOU` nem `CONCLUÍDO`.
- Escola e Convênios/TISS/TUSS permanecem fora do escopo imediato do arquivo fonte, a menos que o fundador redefina prioridade.
- Não usar identificadores numéricos de issues como títulos de tarefas nas discussões com o fundador.

## Conciliação técnica complementar — P1 tarefas 8–12 (08/10/2026)

**Base verificada:** repositório `appverto1/Verto1`, branch `staging`, merge por squash do [PR #336](https://github.com/appverto1/Verto1/pull/336), commit `b5b1550a96193434f95ba235e12e8690cdd1268d`. **Verto Staging CI #37849466255: SUCCESS** (Node 20, typecheck, build, gate pre-main). **Railway Verto-Staging DEPLOY SUCCESS:** `e006b1f0-da7a-40d6-a247-d646d560656d`, commit `b5b1550a96193434f95ba235e12e8690cdd1268d`. Produção não foi modificada.

| Item | Entrega / diagnóstico | Estado de aceite |
|---|---|---|
| **P1 8 — Editor da anamnese** | Corrigido gestor de modelos: impede preenchimento sem paciente e mantém o editor configurável. Regressão incluída no gate. | 🟡 Código mergeado, smoke pendente |
| **P1 9 — Compartilhamento da ficha** | Capability `clinical.anamnesis.view` removida do terapeuta comum e protegida contra grants indevidos; `canSupervise` preserva supervisor contextual. | 🟡 Ajuste mergeado; falta prova de compartilhamento expresso, documento/Download e API direta entre clínicas |
| **P1 10 — PDF final** | Revisado o gerador existente: logo, identificação da clínica, CNPJ, endereço, profissional, registro e assinatura; regressão de contrato. | 🟡 Auditado, falta ver PDF real e verificar personalização |
| **P1 11 — Dias proibidos na Agenda** | Não alterado: falta política canônica de dias de clínica no backend e contrato da criação; bloquear apenas no frontend seria contornável. | 🔴 Implementação pendente |
| **P1 12 — Barras por especialidade** | Confirmada estrutura comum de barras empilhadas e cinco domínios em `ClinicalPlanAnalyticsShell` usada por planos de especialidade. | 🟡 Auditado, falta cobertura funcional de todas especialidades e dados reais |

**Escopo preservado:** sem `server.ts`, migrações, alterações em banco, Supabase, Stripe, cobrança, pacientes ou produção. **Não promover para 🟢 sem smoke autenticado**, especialmente a regra de arquivos/compartilhamento da tarefa 9. A revisão de P1 10/12 não equivale a correção de falhas não reproduzidas. **P000 tutorial permanece vermelho e bloqueia o smoke geral.**

## Lote P1 — tarefas 13–17 (08/10/2026)

| P1 | Funcionalidade | Situação técnica | Smoke de aceite |
|---|---|---|---|
| **13** | Gráficos individuais por alvo nas especialidades | 🟡 Componente compartilhado existente, regressão no PR #337 | Expandir alvos TO/Fono e mais uma especialidade; validar escala, evidências e unidade após F5 |
| **14** | Consolidação multidisciplinar do PTS | 🟡 Alteração mínima para incluir planos explicitamente vinculados no PR #337 | PTS de teste com 2+ especialidades vinculadas, sem duplicidade ou dados de planos externos |
| **15** | Comportamentos interferentes TO e demais especialidades | 🟡 Associação sem planId somente com especialidade inequívoca, PR #337 | Coletar evento TO e confirmar no gráfico TO, não no Fono; verificar plano/organização e F5 |
| **16** | Visão geral da Fono | 🟡 Gráfico por domínios já existente e filtro comportamental reforçado no PR #337 | Fono: barras empilhadas gerais + detalhe por alvo, inclusive interferentes |
| **17** | 403/role de gráficos depois de F5 | 🟡 Bloqueio de consulta transitória durante restauração de capabilities, PR #337 | F5/relogin com profissional, coordenador e supervisor; API direta deve manter 403 para acessos proibidos |

**Rastreabilidade técnica:** PR [#337](https://github.com/appverto1/Verto1/pull/337) **mergeado em `staging`**, branch `fix/p1-13-17-clinical-charts-20261008`, squash `c413a45c779ee8ec18ecf7882484081f68a314aa`, CI [Verto Staging CI](https://github.com/appverto1/Verto1/actions/runs/37852244939) **SUCCESS** (Node 20, typecheck, build, pre-main), deployment Railway Staging `6b4fb926-2bee-4173-9701-d326ccd38243` **SUCCESS — commit c413a45c779ee8ec18ecf7882484081f68a314aa**. Escopo restrito ao painel de resultados, helper de proveniência, gate temporário de renderização e testes. Sem migrations, novas queries, SQL, Stripe ou alteração em produção. **Não promover a verde sem smoke autenticado.** O P1-17 é mitigação condicionada à restauração de capabilities, não prova de eliminação de 403. 

## P000 — Tutorial automático bloqueia a usabilidade no login (08/10/2026)

| Funcionalidade | Prioridade / estado | Correção exigida |
|---|---|---|
| **Ajuda inicial da Verto: exibir somente um pequeno balão ancorado ao botão “?” (Ajuda/Tutoriais)** | 🔴 **P000 — SMOKE VISUAL REPROVADO EM STAGING; CORREÇÃO NÃO IMPLEMENTADA** | Remover/desativar a apresentação **automática** do tour de várias etapas e seus quadrados/destaques sobre a tela após login; apresentar apenas um balão curto, discreto, alinhado **ao próprio botão “?”** na barra superior. O balão não pode ficar atrás de elementos, cortado, deslocado para a engrenagem ou fora da área visível. |

- **Reprodução observada no smoke:** após login, a tela **Visão geral** exibe a interface de tutorial com elementos visuais destacados que não correspondem ao botão/controle correto e um painel/balão parcialmente fora do viewport. Isso encobre ou atrapalha a interação e impede avançar com confiança ao smoke P0-01. **Evidência:** `Evidencias/P000-ajuda-inicial-tutorial-sobreposto-2026-10-08.png` (captura enviada em 08/10/2026).
- **Decisão de produto:** **não oferecer automaticamente um tutorial de 5 ou 7 passos ao entrar**. Mostrar **somente o balão indicativo do botão “?”**, sem sequência, sem retângulos de destaque em outros elementos, sem máscara/overlay bloqueante, sem deslocar os componentes existentes e sem rolagem horizontal. O balão serve para indicar onde acessar ajuda; não obriga o usuário a seguir um roteiro.
- **Interação esperada:** balão junto ao “?” sem impedir uso do dashboard; permitir dispensá-lo; clicar no “?” continua abrindo a Ajuda/Tutoriais existente. Manter **na central de ajuda** o menu hierárquico **Tema → Tópicos**, a navegação, busca, filtros por papel/capabilities e conteúdos já entregues. **Não** remover a central de ajuda, nem criar nova navegação automática.
- **Aceite / smoke P000:** entrar com conta de teste → conferir um único balão apontando corretamente para “?” e nenhum tour; verificar que barra superior, engrenagem e demais controles ficam visíveis/clicáveis; balão não deve cortar texto nem sair do viewport em desktop, mobile, zoom e após F5/relogin; dispensar o balão e abrir a central de ajuda via “?”; verificar que não reaparecem passos ou halos que bloqueiem a interface. Sem alteração de role, clínica ou dados por abrir/fechar ajuda.
- **Escopo mínimo:** alterar exclusivamente o gatilho e a apresentação **automática** de ajuda no login, preservando o catálogo de tutoriais, a hierarquia Tema → Tópicos, progresso já persistido, autorização, agenda, dados clínicos, Stripe e demais fluxos. **Não** substituir bibliotecas nem redesenhar telas.
- **Rastreabilidade:** a tentativa anterior de correção de popover/ajuda foi entregue pelo [PR #333](https://github.com/appverto1/Verto1/pull/333), posteriormente incluída no Staging do [PR #334](https://github.com/appverto1/Verto1/pull/334), mas **a evidência humana atual reprova o comportamento inicial**. É uma **escalada de prioridade do mesmo tutorial P0-31**, não uma funcionalidade independente nem prova de regressão da navegação Tema → Tópicos. **Ainda sem branch, commit, PR ou deploy da correção P000.**
- **Bloqueio de sequência:** concluir correção e aprovar o smoke P000 antes de continuar o smoke de ciclo da sessão P0-01 e dos demais P0, se a sobreposição continuar presente na entrada.

## Novo P0 — Atualização do plano financeiro de paciente bloqueada por 403 (08/10/2026)

| Funcionalidade | Estado atual | Próxima ação / validação |
|---|---|---|
| **Editar e salvar plano financeiro do paciente (modalidade de cobrança, faturamento, valor por sessão, vencimento e pagamento)** | 🔴 **PENDENTE DE CORREÇÃO — falha recorrente reportada; sem correção nem smoke comprovados** | Investigar o `PATCH /api/patients/:patientId` que responde **403 Forbidden** com `PATIENT_INSURANCE_EDIT_CAPABILITY_REQUIRED` quando o usuário autorizado tenta salvar alterações financeiras. Confirmar o papel efetivo e as capabilities de quem salva, autorização no backend e distinção entre financeiro simples e convênios; corrigir somente a autorização/rota/campo pertinente, sem eliminar proteção de acesso. |

- **Reprodução relatada:** abrir paciente existente → editar seu plano financeiro (ex.: Particular; faturamento mensal por sessões; valor por sessão; dia de vencimento; PIX) → **Salvar alterações**. A operação falha de forma recorrente; a interface exibe `PATIENT_INSURANCE_EDIT_CAPABILITY_REQUIRED` e não conclui o salvamento.
- **Evidência técnica (console):** `PATCH https://api.appverto.com.br/api/patients/[ID_PACIENTE_TESTE_REDACTED]` → `403 (Forbidden)`; stack em `updatePatient` (`index-CcktpkOo.js`) e `CoordinatorDashboard-BNt6EcOJ.js`. Captura: [erro na tela](Evidencias/P0-edicao-plano-financeiro-403-2026-10-08.png). O ID abaixo identifica o registro de **teste** reproduzido e não autoriza acesso fora da clínica autenticada.
- **Detalhes da requisição (Network, informados pelo usuário):**
  - **Request URL:** `https://api.appverto.com.br/api/patients/[ID_PACIENTE_TESTE_REDACTED]`
  - **Request method:** `PATCH`
  - **Status code:** `403 Forbidden`
  - **Remote address:** `69.46.46.15:443`
  - **Referrer policy:** `no-referrer`
  - **Request payload (trecho capturado; `recordPayload` apresentado parcialmente):**

    ```json
    {
      "name": "Paciente de teste",
      "email": null,
      "phone": "[DADO_REDACTED]",
      "birthDate": null,
      "birth_date": null,
      "address": {"logradouro": null, "numero": null, "complemento": null, "bairro": null, "cidade": null},
      "cpf": null,
      "group": "adulto",
      "guardian": null,
      "idempotencyKey": "PATCH:/api/patients/[ID_PACIENTE_TESTE_REDACTED]:[ID_PACIENTE_TESTE_REDACTED]:1791485127440:879ac5fd-794c-48b0-b229-1adc3869f47f",
      "panelType": "KIDS",
      "patientProfileType": "KIDS",
      "profileType": "KIDS",
      "recordPayload": {"workspace_id": "ff28d30d-2d5b-4775-a411-810c6c1465a7", "lastAnamnesisAt": null},
      "responsibleEmail": null,
      "responsibleRelationship": null,
      "rg": null,
      "type": "kids_tea"
    }
    ```

    **Observação:** os demais campos de `recordPayload` não foram fornecidos; o objeto acima é uma representação parcial da captura, não o corpo completo da requisição.
  - **Response body recebido:** `{"success":false,"error":"PATIENT_INSURANCE_EDIT_CAPABILITY_REQUIRED"}`.
- **Verificações adicionais para diagnóstico (sem presumir causa):** confirmar o papel/capability do coordenador no servidor; descobrir por que o `PATCH` de dados do paciente é acionado ao salvar um plano financeiro particular e quais campos do payload acionam a autorização de convênio; validar se `group: "adulto"` junto a `type: "kids_tea"` e `profileType`/`panelType`/`patientProfileType: "KIDS"` é coerente com o cadastro ou aponta outro problema de validação, sem alterar a tipagem de forma automática. Conferir repetição/idempotência e distinguir atualização financeira de alterações clínicas/cadastrais.
- **Hipótese a investigar (não confirmada):** o salvamento de campos do plano financeiro simples está exigindo indevidamente a capability de edição de convênio/seguro (`PATIENT_INSURANCE_EDIT_CAPABILITY_REQUIRED`) ou o papel adequado não está recebendo a autorização esperada. **Não presumir que todo 403 seja incorreto:** perfil efetivo e permissões devem ser verificados.
- **Critério de aceite / smoke:** papel explicitamente autorizado consegue alterar plano financeiro simples e obtém confirmação do servidor; novos valores permanecem após F5/relogin e são usados nos fluxos existentes. Perfil não autorizado continua recebendo 403; tentativa com outro `patientId`, outra clínica, mudança de role ou alteração de payload deve ser negada; edições de convênio/TISS/TUSS continuam sob suas próprias regras. Cobrir testes de regressão por papel/capability e isolamento entre clínicas.
- **Impacto:** bloqueio funcional da atualização financeira de paciente. **Escopo:** registrar pendência; nenhuma alteração de código, permissões, banco, Stripe, contratos ou produção nesta inclusão.

## Lote de correções P0 — primeiras três tarefas (08/10/2026)

| Funcionalidade | Estado atual | Smoke pendente |
|---|---|---|
| **Ciclo de vida da sessão: iniciar → persistir no servidor → associar agendamento → finalizar** | 🟡 **Implementado em staging, aguardando smoke** | Iniciar atendimento vinculado à Agenda, confirmar persistência após F5 e encerramento sem `SESSION_COMPLETION_NOT_FOUND`; em falha de rede/servidor não abrir sessão falsamente. |
| **Finalização de sessão sem bloqueios transitórios** | 🟡 **Código pronto em staging, aguardando smoke** | Encerrar com timer ativo e dados duráveis na fila, sem exigir encerramento manual; não esconder erro terminal nem perder coleta. |
| **Finalização automática dos timers** | 🟡 **Código pronto em staging, aguardando smoke** | Confirmar encerramento automático de duração, taxa, intervalo e cronômetros ABA Legacy/V3, com tempos e motivos corretos após F5. |

**Rastreamento técnico:** PR de staging `https://github.com/appverto1/Verto1/pull/326` (correção do vínculo + proteção dos testes de início, fechamento e timers). As implementações anteriores de fechamento e cronômetros foram mantidas. **Não declarar nenhuma tarefa verde antes de smoke humano.** Produção permanece fora de escopo deste lote.

## Lote de correções P0 — próximas duas tarefas (08/10/2026)

| Funcionalidade | Estado atual | Smoke pendente |
|---|---|---|
| **Preservar tentativas e reforçadores ao encerrar uma sessão offline** | 🟡 **Corrigido em staging / aguardando smoke** | Iniciar online, perder a internet durante a sessão, coletar tentativa/reforçador, encerrar sem falsa perda, verificar fila criptografada e dados após F5. |
| **Reenviar os registros ao voltar a conexão e finalizar por último** | 🟡 **Cálculo causal e teste de replay / aguardando smoke** | Restabelecer a internet, garantir tentativa + reforçador antes de encerramento e verificar que nada duplicou ou desapareceu após novo login. |

**Rastreamento:** PR de staging https://github.com/appverto1/Verto1/pull/327. O teste simulado de reconexão não substitui o smoke real com navegador autenticado. **Ambas permanecem amarelas até evidência humana.** Sem alteração de produção neste lote.

## Lote de correções P0 — próximas cinco tarefas (08/10/2026)

| Funcionalidade | Estado após revisão técnica | Smoke pendente |
|---|---|---|
| **Isolamento clínico TO/Fono por especialidade** | 🟡 **Implementado em staging; testes reforçados; aguardando smoke** | Iniciar TO e Fono para o mesmo paciente, conferir que somente programas da especialidade correta são mostrados e escritos, inclusive após F5. |
| **PEI ativo e plano de especialidade pausado** | 🟡 **Proteção adicional no início da sessão; aguardando smoke** | Abrir PEI com plano pausado, iniciar pelo painel do plano e pela Agenda; não carregar/reativar o plano pausado, nem trocar depois da abertura. |
| **ABA V3: resposta incorreta / sem resposta / sem oportunidade** | 🟡 **Rota autenticada e gravação `NO_OPPORTUNITY` integradas em staging; smoke pendente** | Testar sessão/target de outra clínica, papel negado, erro com trial coletado, F5/relogin e replay offline. Não declarar verde sem evidência. |
| **Protocolos: AFLS 0–4 e escalas específicas por item** | 🟡 **Código existente e regressões reforçadas; aguardando smoke** | Registrar pontuação 4 de AFLS, F5 e conferir gráfico profissional e portal; preservar escalas específicas de outros protocolos. |
| **Anamnese: não indicar sucesso antes do salvamento real** | 🟡 **Guarda de confirmação servidor reforçada; aguardando smoke** | Testar falha/offline/pendente e sucesso confirmado, F5 e persistência da ficha; botão e modal não podem fechar com gravação pendente. |

**Rastreamento técnico:** PR https://github.com/appverto1/Verto1/pull/328. Staging somente. Não declarar 100% para qualquer item até smoke real. A implementação completa do estado `NO_OPPORTUNITY` depende de endpoint autenticado; nenhuma alteração foi feita no banco de produção. Preservar links, contratos, pacientes e propostas existentes.

## Lote P0 — tarefas 11–15 (08/10/2026)

| Funcionalidade | Estado técnico auditado | Smoke pendente |
|---|---|---|
| **Anamnese não retorna a “Em análise” ao ser apenas aberta no portal** | 🟡 **Leitura em staging e regressão integrada no PR 329; aguardando smoke.** | Abrir anamnese revisada e enviada no portal do paciente, retornar, F5 e relogin; estado canônico deve permanecer inalterado, sem POST/PATCH de abertura. |
| **Profissional comum não opera anamnese sem supervisão** | 🟡 **Guarda de autorização corrigida em staging; aguardando smoke.** | Profissional comum sem `canSupervise`: sem ações e 403 na API direta; supervisor autorizado apenas no caso supervisionado; deny override respeitado. |
| **Matriz de permissões ponta a ponta** | 🟡 **Matriz e testes de papéis/overrides integrados em staging; aguardando smoke.** | Diretor, coordenador, supervisor, profissional e recepção, incluindo grants/denies, mudanças após F5 e acesso negado pela API. |
| **Supervisor apenas nos casos efetivamente supervisionados** | 🟡 **Escopo e regressões de vínculo revogado/cross-clinic integrados em staging; aguardando smoke.** | Supervisor com caso vinculado, não vinculado, vínculo inativo, clínica diferente e após troca de clínica/relogin. |
| **Convite de profissional já existente para segunda clínica** | 🟡 **Aceite atômico e regressão de conta preexistente integrados em staging; aguardando smoke.** | Profissional com Auth existente na clínica A aceita convite de B; mantém ambas memberships, portal profissional correto, sem duplicar conta, sem confiar em role/clinic enviados pelo navegador. |

**Rastreamento:** [PR de staging 329](https://github.com/appverto1/Verto1/pull/329), branch `fix/p0-anamnesis-role-supervision-invite-20261008`, head `e89c5c23e7c8fa1e5471c59fce265347be9517fb` e merge `2e0f5cda887be2521c2325f1bfb2f8623305bfe6`. Revisão inclui 1 guarda mínima de autorização e regressões; **CI Verto Staging aprovado (build, typecheck, pre-main), merge em staging confirmado; deploy Railway Staging **SUCCESS** (deployment `be8477b2-ada1-4527-9599-90f648c780c9`, commit `2e0f5cda887be2521c2325f1bfb2f8623305bfe6`)**. Nenhum smoke real foi executado; nenhuma dessas cinco está verde. Produção, dados históricos, Stripe, pacientes e contratos não foram alterados.

## Lote P0 — tarefas 16–20 (08/10/2026)

| Funcionalidade | Estado técnico auditado | Smoke / pendência |
|---|---|---|
| **Troca clínica A → B → A** | 🟡 **Fluxo canônico já implementado; regressão de reset de estado adicionada; aguardando smoke** | Alternar A→B→A, conferir papel/capabilities/pacientes, F5 e relogin com identidades sintéticas; conferir que contexto foi persistido no servidor, não decidido por cache local. |
| **401 por sessão expirada** | 🟡 **Correção do logout rápido implementada; aguardando smoke** | Simular 401 `SERVER_SESSION_REQUIRED` após segundo 401 confirmado; limpar UI e retornar à LP/login sem tentar sincronizar outbox com sessão vencida. Confirmar preservação da fila criptografada após novo login. |
| **Confirmação intermitente com 500** | 🟡 **Backend corrigido em staging; aguardando smoke autenticado** | Resposta de confirmação persistida não é anulada por erro posterior de notificação/auditoria; ambas falhas permanecem observáveis em log. Confirmar status durável após F5/relogin e verificar ausência de falso erro 500. |
| **Conflitos com sessões canceladas** | 🟡 **Backend com escopo autenticado corrigido em staging; aguardando smoke** | Cancelada libera paciente/profissional/sala, pedido pendente continua ocupando. API agora usa clínica/organização da sessão autenticada. Testar conflitos A→B, UI, F5 e acesso cruzado via API. |
| **404 na revalidação de três opções de remarcação** | 🟡 **Backend administrativo corrigido em staging; aguardando smoke** | Resolver consulta o agendamento persistido e valida clínica, organização e paciente sem confundir permissões de recepção com acesso ao prontuário. Testar as três opções e aprovação/recusa, isolamento entre clínicas e F5. |

**Rastreamento técnico:** [PR staging 330](https://github.com/appverto1/Verto1/pull/330), branch `fix/p0-context-auth-confirm-conflicts-reschedule-20261008`, merge commit `5c60d1a7504a73cb9304b274fad923ed359bf60b`. CI verde (Node 20, typecheck, build, pre-main) no SHA `07a349dd208f1532613d1cc33686112b4a2e41cb`. Deploy Railway Staging **SUCCESS** (deployment `437129ae-3d5e-4505-a651-22d48411ba10`, commit `5c60d1a7504a73cb9304b274fad923ed359bf60b`). A implementação revisa módulos menores e adiciona gate do lote. O patch do `server.ts` (~4,7 MB) não pôde ser gravado pela integração com GitHub devido a erro de transporte do upload; não simular sucesso. Nenhuma alteração em produção, Stripe, dados clínicos históricos ou cobrança. **Nenhuma tarefa verde sem smoke humano autenticado.**

## Lote P0 — finalização backend das tarefas 18–20 (08/10/2026)

| Tarefa | Estado técnico | Evidência necessária para 🟢 |
|---|---|---|
| **18 — Confirmação com erro 500** | 🟡 **Código servidor mergeado em staging / smoke pendente** | Confirmar pelo portal com notificação válida e obsoleta; status confirmado no banco, F5/relogin, sem falso erro após persistência. Validar advertências de auditoria sem encobrir falhas de escrita. |
| **19 — Conflitos e clínica autenticada** | 🟡 **Código servidor mergeado em staging / smoke pendente** | Agendamentos cancelados x cancelamento pendente para paciente, sala e profissional. Consultar conflito da clínica A com sessão de B; não vazar dados. |
| **20 — 404 na remarcação** | 🟡 **Código servidor mergeado em staging / smoke pendente** | Criar solicitação sintética com três opções e testar como recepção habilitada. Revalidar, aprovar/rejeitar e confirmar agenda após F5, com acesso de outra clínica negado. |

**Implementação:** [PR 331](https://github.com/appverto1/Verto1/pull/331), squash em staging `537a9624126bc05f243d4baa199eb69d236f4fdb`. CI Staging **SUCCESS** (typecheck ratchet, build e pre-main gate). Módulo pequeno `services/appointmentTenantGuards.ts` inicia a modularização gradual. Patch pontual gerado no arquivo legado `server.ts`; workflow temporário de aplicação removido. Sem mudanças em produção, banco de produção ou migrações. **Railway Staging: SUCCESS** — deploy `40f478a7-ed7d-4669-ba56-34473f9edef3` do commit `537a9624126bc05f243d4baa199eb69d236f4fdb` validado no ambiente de staging. **Não marcar 🟢 sem smoke autenticado.**

**Verificação complementar do PR #331 em 08/10/2026 (sem smoke autenticado):**
- **GitHub:** PR #331 efetivamente mergeado em `staging` (`537a9624126bc05f243d4baa199eb69d236f4fdb`); CI `Verto Staging CI` execução `37826679563`, job `staging-gate`, todos os passos concluídos com `success` (Node 20, typecheck, build e pre-main). O teste novo contém assertions de guardas e inspeção de código; não substitui validação HTTP/UI autenticada.
- **Railway:** projeto `Verto-Staging`, ambiente `staging`, deployment `40f478a7-ed7d-4669-ba56-34473f9edef3`, status `SUCCESS`, commit idêntico; backend iniciou em `localhost:8080` e nenhum redeploy foi necessário.
- **Telemetria da última hora consultada:** 249 requisições HTTP, **0 respostas 5xx**, 8 respostas 4xx. Métrica agregada, **não** demonstra que confirmações, conflitos e remarcações foram exercitados ou aprovados.
- **Alerta independente nos logs:** `[ActivePatientSync] persistent queue unavailable` durante `patient_patch`; não é evidência de falha nas tarefas 18–20 e **não foi corrigido neste lote**. Investigar separadamente antes de dar como íntegro o fluxo de sincronização de pacientes.
- **Estado final dos três P0:** 🟡 aguardando smoke em sessão autenticada com agendamentos e papéis sintéticos, teste de clínica A/B, efeito persistido após F5/relogin, confirmação com notificação inválida e fluxo completo de remarcação. **Não houve promoção para verde, alteração em produção nem nova mudança de código.**

## Lote P0 — revisão das tarefas 21–25 (08/10/2026)

| P0 | Funcionalidade | Situação técnica | Evidência necessária para 🟢 |
|---|---|---|---|
| **21** | **Cancelamento solicitado / erro de acesso** | 🟡 **Fluxo existente em staging + regressão no gate** | Solicitar cancelamento com paciente/responsável autorizado; verificar papéis e clínica A/B, resposta da API, estado persistido e F5. |
| **22** | **Lembretes 24h/12h após remarcação** | 🟡 **Guardas complementares no PR #332; smoke pendente** | Remarcar um agendamento de teste, provar que o antigo não recebe lembrete, conferir os novos 24h/12h e a gravação correta dos marcadores. |
| **23** | **Recorrências / envio duplicado** | 🟡 **Validação do ciclo idempotente no PR #332; smoke pendente** | Simular lembretes 24h e 12h simultâneos, concorrência e recorrências independentes, sem notificar horário antigo ou duas vezes para o mesmo ciclo. |
| **24** | **Painel da recepção carrega na primeira renderização** | 🟡 **Código existente + regressão no gate; smoke pendente** | Entrar diretamente como recepção com permissões limitadas; módulos autorizados aparecem sem F5, módulos negados não aparecem nem na API. |
| **25** | **Diário da Família persistente** | 🟡 **Código existente + regressão no gate; smoke pendente** | Publicar anotação/foto com paciente/responsável sintético; confirmar persistência em servidor após F5/relogin e isolamento por clínica/paciente. |

**Rastreamento da revisão 21–25:** [PR #332](https://github.com/appverto1/Verto1/pull/332), branch `fix/p0-21-25-reminders-integrity-20261008`, head `30c800b1093b927bb620555d28b82334dd7f484e`. A revisão dos P0 21, 24 e 25 confirmou regressões previamente integradas ao `pre-main`, sem alteração desnecessária nos respectivos fluxos. Para os P0 22–23, foram adicionados `services/appointmentReminderJobGuards.ts`, validação de tenant/horário já persistido no worker, testes sintéticos e migration aditiva `20261008194000_claimed_reminder_marker_guard_v1.sql`. A atualização de marcadores de envio usa uma RPC por lote, condicionada à clínica/paciente/agendamento/horário, substituindo updates sem condicionamento de ciclo. Não adiciona N+1, polling ou novo fluxo de notificação. **Teste do commit final:** SUCCESS — Verto Staging CI execução `37833471768` (Node 20, typecheck, build, pre-main). **Supabase Staging:** migration `p0_21_25_claimed_reminder_marker_guard_v1` aplicada com sucesso no projeto `Verto-Staging` (`irspungjhapqdbgqroyc`); função instalada, `EXECUTE` permitido somente ao `service_role` e teste de lote vazio com contexto válido retornou 0. **Railway Staging:** **SUCCESS** — deploy `fe84de5a-09fe-4bba-a433-a1bc990a834c` do commit `c686d0247463785e141f32671f02171859451c95`; backend iniciado e fila de notificações ativada. **Merge:** PR #332 mergeado por squash em `staging`, commit `c686d0247463785e141f32671f02171859451c95`. **Produção não alterada**. Corrida entre leitura e push externo permanece possível; teste de concorrência real ainda é necessário. Nenhum P0 fica verde sem smoke autenticado.

## Lote P0 — tarefa 8, tutorial e tarefas 26–28 (08/10/2026)

| P0 | Funcionalidade | Estado após correção técnica | Evidência pendente para 🟢 |
|---|---|---|---|
| **8** | **ABA V3: distinguir resposta incorreta, sem resposta e ausência de oportunidade** | 🟡 **Código de persistência seguro em staging; aguardando smoke** | Registrar `NO_OPPORTUNITY` em sessão V3 autenticada com alvo válido, verificar `aba_session_target_exposures_v3`, sem `aba_trials_v3` fictícia, F5/relogin, offline/replay, 409 com trial já existente, negação de outra clínica/paciente e de papel sem capability. Confirmar feature gate antes do smoke. |
| **Tutorial / P000** | **Ajuda automática no login desancorada; tour não desejado** | 🔴 **SMOKE VISUAL REPROVADO; P000 aberto, apesar do PR #333 mergeado** | Após login: apenas um balão curto, visível e alinhado ao botão “?”; sem tour multipasso/retângulos bloqueantes; central de ajuda Tema → Tópicos preservada e acessível ao clicar “?”. |
| **26** | **Envio duplicado de tarefa no duplo clique** | 🟡 **Trava síncrona adicional no frontend em staging; aguardando smoke** | Clique duplo e rápido sob latência; apenas uma requisição lógica e um registro, botão desativado e feedback adequado. |
| **27** | **Idempotência de conclusão de tarefas na API** | 🟡 **Contrato backend transacional existente, regressão mantida; aguardando smoke concorrente** | Retry, mesma chave, concorrência entre dispositivos, sem histórico nem tarefa duplicados; confirmação durável após F5/relogin e escopo entre clínicas. |
| **28** | **ABA Legacy mostra aplicações de avaliação, não intervenção** | 🟡 **Fonte existente preservada e regressão no gate; aguardando smoke** | Ver VB-MAPP, AFLS e ABLLS em paciente de teste; intervenções de planos/PTS não devem contaminar os gráficos ABA Legacy; conferir F5 e acesso por papel. |

**Rastreamento técnico:** [PR #333](https://github.com/appverto1/Verto1/pull/333), branch `fix/p0-08-tutorial-26-28-20261008`, CI do head final **SUCCESS — Verto Staging CI `37836533834` (head `c60c1d73174d521e43419c713e29b6eeaa0fccca`)**, merge em staging **SUCCESS — squash `7f2145ea60f3b1367c8dd1c676585e00e198c259`**, deploy Railway **SUCCESS — Railway Staging `1cbe7d18-3c6a-47fa-affe-d886989f1156` do commit `7f2145ea60f3b1367c8dd1c676585e00e198c259` (backend inicializado)**. A rota ABA V3 usa o mesmo gate/capability/escopo da coleta existente, com RPC `set_aba_session_target_exposure_v3` exclusiva do service role e estado idempotente por sessão/target; foi adicionada via patch de arquivo legado, com scripts e workflows temporários removidos. A ação continua sem fabricar trial e conserva o replay offline. O tutorial preserva filtro do catálogo por permissões e navega por temas; o backend financeiro, Stripe, permissões e produção não foram alterados. **Nenhum item deve ficar verde sem smoke autenticado.**

## Lote P0 29–30 + financeiro 403 + P1 1–2 (08/10/2026)

| Tarefa | Estado técnico | Smoke pendente |
|---|---|---|
| P0 29 — gráficos de Planos/PTS | 🟡 Implementação canônica existente e regressões preservadas; smoke pendente | Coletar em sessão vinculada ao plano, verificar gráfico por versão/sessão após F5, escopo correto. |
| P0 30 — permissões dos gráficos por papel | 🟡 Filtros ReBAC existentes e testes mantidos; smoke pendente | Diretor/coordenador/supervisor/profissional em duas clínicas, negando especialidade alheia. |
| P0 crítico — 403 no plano financeiro | 🟡 Correção frontend entregue; smoke pendente | Editar dados financeiros simples como papel autorizado, sem capability TISS; persistir após F5 e confirmar 403 em edição TISS não autorizada. |
| P1 1 — contexto após F5 | 🟡 Correção de restauração pós-hidratação entregue; smoke pendente | F5 nas telas de paciente/configurações e troca entre clínicas sem estado cruzado. |
| P1 2 — notificações por dispositivo | 🟡 Liga/desliga e unsubscribe com escopo autenticado entregues; smoke pendente | Ativar, desativar, F5/relogin, verificar endpoint e credencial de renovação, sem afetar outro usuário/dispositivo. |

**Rastreamento:** PR [#334](https://github.com/appverto1/Verto1/pull/334) mergeado por squash em `staging` no commit `798ff6dc8e394a220e459f716186c51b047c0351`. CI head `518791e332e46a3541246aab90e7635bd2c96cd3`: GitHub Actions `37841497154` SUCCESS. Railway Staging deploy `4a9a5022-2b9e-4959-8616-92ed47bb75b4`: SUCCESS no mesmo merge SHA. Sem produção e sem migration. Nenhum item verde antes de smoke autenticado. Correções no cliente não alteram proteção `patient.insurance.edit` do backend. Registros anteriores do inventário preservados.

## Itens do relatório enviado


### P0 — 31 itens do relatório

1. [CORREÇÃO CRÍTICA]* Ciclo de vida da sessão: revisar iniciar sessão → persistir sessão no servidor → associar appointment → finalizar. Foi observado SESSION_COMPLETION_NOT_FOUND com sessão criada apenas/localmente por ID semelhante a session-<patient>-<timestamp>.
   - **Estado em 08/10 (lote 01):** **🟡 IMPLEMENTADO EM STAGING / AGUARDANDO SMOKE**.

   - **Evidência/próxima ação:** Fluxo corrigido no PR de staging: vínculo com a Agenda só é aceito após ACK do servidor e confirmação de sessão, paciente e agendamento. Verificar iniciar → F5 → encerrar e falha de rede sem falsa abertura.

2. [CORREÇÃO]* Finalização de sessão: não deve existir bloqueio que impeça encerrar a sessão por timers, registros pendentes ou outros estados intermediários.
   - **Estado em 08/10 (lote 01):** **🟡 IMPLEMENTADO EM STAGING / AGUARDANDO SMOKE**.

   - **Evidência/próxima ação:** Implementação de encerramento existente preservada; gate conjunto das três tarefas. Smoke com registros transitórios e fila local protegida pendente.

3. [CORREÇÃO]* Timers: qualquer timer ativo deve ser finalizado automaticamente ao encerrar a sessão.
   - **Estado em 08/10 (lote 01):** **🟡 IMPLEMENTADO EM STAGING / AGUARDANDO SMOKE**.

   - **Evidência/próxima ação:** Regressões de timers Legacy/V3 existentes preservadas e verificadas no gate conjunto. Smoke de duração/taxa/intervalo e registro após F5 pendente.

4. [CORREÇÃO CRÍTICA]* Sincronização offline: tentativa não sincronizada nunca pode impedir o fechamento nem ser perdida. Deve permanecer na fila local e sincronizar quando a conexão voltar.
   - **Estado em 08/10 (lote 02):** **🟡 CÓDIGO CORRIGIDO EM STAGING / AGUARDANDO SMOKE FUNCIONAL**.

   - **Evidência/próxima ação:** Fila criptografada preservada, encerramento não ultrapassa nenhuma coleta pendente da mesma sessão (inclusive com timestamps fora de ordem); reforçadores duráveis podem aguardar reconexão, mas falha terminal bloqueia. Testar queda de internet com tentativas e reforçadores, F5/relogin, fila local e integridade pós-replay. PR de staging 327; não declarar 100% sem smoke real.

5. [PENDÊNCIA]* Offline real: testar uma sessão inteira com perda de conexão, criação de registros, encerramento, reconexão e sincronização posterior sem perda.
   - **Estado em 08/10 (lote 02):** **🟡 TESTE AUTOMATIZADO DE REPLAY + CÓDIGO EM STAGING / AGUARDANDO SMOKE REAL**.

   - **Evidência/próxima ação:** Teste sintético de rede indisponível, retry da tentativa, reenvio do reforçador por RPC autenticado, barreira causal e encerramento por último; próxima etapa é smoke autenticado no navegador com início online, interrupção, coleta offline, encerramento, retorno da internet, F5 e conferência de todos os dados no servidor. Iniciar uma sessão inteiramente sem internet NÃO foi habilitado, pois requer confirmação canônica no servidor; não afirmar smoke 100% antes dessa verificação.

6. [CORREÇÃO CRÍTICA]* Isolamento por especialidade: sessão de TO só deve carregar programas/alvos de TO; Fono apenas Fono; nenhuma especialidade pode coletar ou alterar dados operacionais de outra.
   - **Estado em 08/10 (lote 03):** **🟡 CÓDIGO EM STAGING / AGUARDANDO SMOKE**.

   - **Evidência/próxima ação:** Testes de isolamento TO/Fono e writers Legacy/V3 reforçados, incluindo plano por especialidade congelado e acesso entre clínicas. Smoke de duas especialidades pendente.

7. [CORREÇÃO CRÍTICA]* PEI versus plano por especialidade: se o PEI está ativo e o plano de especialidade está pausado, a sessão não pode carregar corretamente o PEI e depois trocar automaticamente para o plano pausado.
   - **Estado em 08/10 (lote 03):** **🟡 GUARDA DE PLANO PAUSADO IMPLEMENTADA / AGUARDANDO SMOKE**.

   - **Evidência/próxima ação:** O início direto pelo painel agora verifica no servidor o estado ativo do plano, permissão e correspondência com a Agenda; sessões sem plano ativo continuam usando somente o PEI. Revalidar após F5 e com plano pausado.

8. [CORREÇÃO ABA V3]* Resultado da tentativa: distinguir explicitamente resposta incorreta, sem resposta e situações em que não houve oportunidade de tentativa.
   - **Estado atualizado no lote 08 + tutorial + 26–28:** **🟡 PERSISTÊNCIA ABA V3 INTEGRADA EM STAGING / AGUARDANDO SMOKE**. O bloqueio original foi tratado no PR #333; manter evidência histórica abaixo.

   - **Evidência/próxima ação:** Interface separa resposta incorreta, ausência de resposta e ausência de oportunidade, sem inventar tentativa; ainda é necessário implementar rota com validação de escopo, função `set_aba_session_target_exposure_v3`, replay/offline e teste de persistência. Não promover como 100% pronta.

9. [CORREÇÃO CRÍTICA]* Escala de protocolos: respeitar a pontuação real definida por cada protocolo e por cada item. AFLS possui itens 0–4 e não pode ser limitado globalmente a 0–2.
   - **Estado em 08/10 (lote 03):** **🟡 CÓDIGO E TESTES AFLS 0–4 EM STAGING / AGUARDANDO SMOKE**.

   - **Evidência/próxima ação:** Relatório clínico e portal preservam pontuação não binária por item; catálogo possui tarefas 0–4. Regressões reforçadas; testar valores 2 e 4 nos dois painéis.

10. [CORREÇÃO CRÍTICA]* Falso sucesso ao salvar: não mostrar sucesso antes de a alteração estar efetivamente persistida. Foi observado caso em que alterações sumiram no primeiro F5.
   - **Estado em 08/10 (lote 03):** **🟡 CONFIRMAÇÃO DE PERSISTÊNCIA REFORÇADA / AGUARDANDO SMOKE**.

   - **Evidência/próxima ação:** Salvamento exige writer de paciente e confirmação definitiva tanto do paciente quanto da anamnese; resposta offline, queued ou pending não fecha modal nem declara sucesso. Testar F5 e falhas de rede.

11. [CORREÇÃO]* Estado da anamnese: simplesmente abrir a ficha pelo portal do paciente não pode fazer a anamnese voltar para “Em análise”.
   - **Estado em 08/10 (lote 04):** **🟡 IMPLEMENTADO EM STAGING / AGUARDANDO SMOKE**.

   - **Evidência/próxima ação:** Abertura usa leitura sem mutação no portal e rótulo prioriza REVIEWED; regressão técnica ampliada. Smoke com ficha revisada/enviada, F5 e relogin pendente.

12. [PERMISSÃO]* Profissional comum e anamnese: profissional sem papel de diretor, coordenador ou supervisor autorizado não deve ver ações operacionais de anamnese no prontuário.
   - **Estado em 08/10 (lote 04):** **🟡 GUARDA CORRIGIDA EM STAGING / AGUARDANDO SMOKE**.

   - **Evidência/próxima ação:** Corrigido override de `clinical.anamnesis.edit` que permitia terapeuta comum obter privilégio; manter supervisor contextual autenticado. Validar API direta e ações no prontuário com perfis sintéticos.

13. [PENDÊNCIA]* Matriz de permissões ponta a ponta: testar sistematicamente diretor, coordenador, supervisor, profissional e recepcionista, inclusive overrides de acesso.
   - **Estado em 08/10 (lote 04):** **🟡 REGRESSÕES EM STAGING / AGUARDANDO SMOKE**.

   - **Evidência/próxima ação:** Novos testes de permissões por papel, override de edição de anamnese e deny; smoke autenticado com cinco perfis e API direta continua obrigatório.

14. [PENDÊNCIA]* Supervisor: comprovar que a visão ampla existe somente nos casos efetivamente supervisionados.
   - **Estado em 08/10 (lote 04):** **🟡 ESCOPO E REGRESSÕES EM STAGING / AGUARDANDO SMOKE**.

   - **Evidência/próxima ação:** Testes adicionais negam paciente de outro caso, tenant divergente, supervisão revogada e membership inativa. Validar contra APIs com usuários reais de teste.

15. [PENDÊNCIA]* Profissional existente em segunda clínica: testar convite de profissional já cadastrado para outra clínica.
   - **Estado em 08/10 (lote 04):** **🟡 FLUXO E REGRESSÃO EM STAGING / AGUARDANDO SMOKE**.

   - **Evidência/próxima ação:** Aceite atômico usa uma identidade Auth e upsert por (user_id, clinic_id), sem excluir vínculos de outras clínicas; fixture sintética segura e smoke A→B ainda pendentes.

16. [PENDÊNCIA]* Troca A → B → A: validar que papéis, capabilities, pacientes e dados não vazam entre clínicas após troca, F5 e relogin.
   - **Estado em 08/10 (lote 05):** **🟡 FLUXO REVISADO EM STAGING / AGUARDANDO SMOKE**.

   - **Evidência/próxima ação:** Regressão de alternância A→B→A, acesso canônico no servidor e reset de UI adicionada; ainda falta teste real com duas clínicas, F5, relogin e API direta.

17. [CORREÇÃO DE AUTENTICAÇÃO]* Sessão expirada: ao receber 401 SERVER_SESSION_REQUIRED por expiração, fazer logout limpo e redirecionar para LP/login. Não deixar a Agenda vazia mostrando erro técnico.
   - **Estado em 08/10 (lote 05):** **🟡 LOGOUT RÁPIDO DE SESSÃO EXPIRADA / AGUARDANDO SMOKE**.

   - **Evidência/próxima ação:** Evento 401 confirmado passa a remover imediatamente UI protegida e evita sincronização offline/autolog com token vencido; continuar preservando outbox e testar LP/login, F5 e novo login.

18. [CORREÇÃO]* Confirmação da sessão: revisar erro 500 intermitente ao confirmar. Tratar indisponibilidade transitória e evitar exposição de erro bruto.
   - **Estado em 08/10 (lote 06):** **🟡 BACKEND CORRIGIDO EM STAGING / SMOKE PENDENTE**.

   - **Evidência/próxima ação:** O cliente reconcilia por leitura única sem repetir POST. O backend separa as falhas de notificação/auditoria do commit da confirmação e registra avisos. CI integrado no PR 331; confirmar via navegador autenticado, log e F5.

19. [CORREÇÃO]* Conflitos: sessões canceladas devem ser ignoradas na disponibilidade de paciente, profissional e sala.
   - **Estado em 08/10 (lote 06):** **🟡 REGRAS DE CONFLITO E TENANT CORRIGIDAS EM STAGING / SMOKE PENDENTE**.

   - **Evidência/próxima ação:** Regressões de paciente/profissional/sala: cancelada libera, cancelamento solicitado permanece ocupando. O backend obtém clínica/organização exclusivamente da sessão autenticada; testar IDOR, clínica A↔B e casos reais em staging.

20. [CORREÇÃO]* Reagendamento solicitado pelo paciente: corrigir 404 Sessão não encontrada na revalidação das três opções enviadas pelo paciente.
   - **Estado em 08/10 (lote 06):** **🟡 RESOLVER ADMINISTRATIVO CORRIGIDO EM STAGING / SMOKE PENDENTE**.

   - **Evidência/próxima ação:** Resolver administrativo compara clínica, organização e paciente persistidos sem exigir permissão clínica de prontuário para recepção habilitada; capacidade calendar.requests.manage permanece obrigatória. Fazer smoke das três opções, aprovação/recusa e testes de acesso cruzado.

21. [CORREÇÃO]* Cancelamento solicitado: corrigir “Sessão não encontrada para este acesso” em papéis/contextos onde a ação deveria ser permitida.
   - **Estado em 08/10:** **Implementação técnica em staging / smoke pendente**.

   - **Evidência/próxima ação:** Correção de ações do portal de agenda integrada em staging; smoke cancelamento pendente.

22. [CORREÇÃO]* Lembretes após remarcação: invalidar lembretes do horário antigo e recalcular os de 24h/12h para o novo horário.
   - **Estado em 08/10:** **Revisar / validar**.

   - **Evidência/próxima ação:** Após remarcação, novo agendamento e lembretes 24h/12h precisam smoke temporal.

23. [CORREÇÃO]* Recorrência/lembretes duplicados: revisar casos em que várias notificações chegam ao mesmo tempo. Não enviar lembrete duplicado ou fora da janela correta.
   - **Estado em 08/10:** **Revisar / validar**.

   - **Evidência/próxima ação:** Lembretes de recorrências permanecem item específico pendente no GitHub.

24. [CORREÇÃO]* Painel da recepção: módulos permitidos precisam carregar na primeira renderização, sem depender de F5.
   - **Estado em 08/10:** **Implementação técnica em staging / smoke pendente**.

   - **Evidência/próxima ação:** Correção de carregamento inicial da recepção integrada em staging; smoke pendente.

25. [CORREÇÃO CRÍTICA]* Diário da Família: registros enviados pelo responsável precisam persistir após F5/relogin.
   - **Estado em 08/10:** **Implementação técnica em staging / smoke pendente**.

   - **Evidência/próxima ação:** Correção de persistência do Diário da Família integrada em staging; smoke F5/relogin pendente.

26. [CORREÇÃO CRÍTICA]* Envio duplicado de tarefas: botão deve dar feedback imediato e impedir segundo clique enquanto processa.
   - **Estado em 08/10:** **Implementação técnica em staging / smoke pendente**.

   - **Evidência/próxima ação:** Idempotência backend integrada; proteção UI duplo clique requer prova de ponta a ponta.

27. [BACKEND]* Idempotência de tarefas: retry, latência ou clique repetido nunca podem criar a mesma tarefa múltiplas vezes.
   - **Estado em 08/10:** **Implementação técnica em staging / smoke pendente**.

   - **Evidência/próxima ação:** Idempotência backend integrada em staging; testes de retry/concorrência reais pendentes.

28. [CORREÇÃO DE DADOS]* ABA Legacy: deve refletir aplicações de protocolos de avaliação, como VB-MAPP, AFLS, ABLLS etc., e não dados de intervenção do plano individual.
   - **Estado em 08/10:** **Implementação técnica em staging / smoke pendente**.

   - **Evidência/próxima ação:** Correção de fonte ABA Legacy integrada em staging; smoke VB-MAPP/AFLS pendente.

29. [CORREÇÃO DE DADOS]* Planos e PTS: dados coletados nas sessões dos planos terapêuticos devem aparecer nos gráficos de Planos/PTS.
   - **Estado em 08/10:** **Implementação técnica em staging / smoke pendente**.

   - **Evidência/próxima ação:** Testes de integração de gráficos do PTS integrados; smoke longitudinal pendente.

30. [PERMISSÃO]* Gráficos por papel: diretor e coordenador veem todos; supervisor vê todos apenas nos casos que supervisiona; profissional comum vê somente a própria especialidade e pacientes em que atua.
   - **Estado em 08/10:** **Implementação técnica em staging / smoke pendente**.

   - **Evidência/próxima ação:** Permissões dos gráficos corrigidas em staging; smoke com papéis reais pendente.

31. [P0 — NOVA FUNCIONALIDADE, ESPECIFICAÇÃO ORIGINAL]* Tutorial guiado/contextual da Verto: implementar onboarding guiado dentro do sistema para ensinar o usuário a utilizar os principais fluxos conforme seu papel e os módulos disponíveis. O tutorial deve ser contextual, avançar passo a passo destacando elementos reais da interface, poder ser pulado, retomado e reiniciado posteriormente, e não deve ensinar funcionalidades às quais aquele papel não tem acesso.
   - **Estado atualizado em 08/10 — P000:** **🔴 SMOKE VISUAL REPROVADO NA ENTRADA; ALTERAR O COMPORTAMENTO AUTOMÁTICO**. O texto anterior registra a especificação histórica, **substituída na entrada do sistema** pela decisão de mostrar só um balão no botão “?”.

   - **Evidência/próxima ação:** Captura `Evidencias/P000-ajuda-inicial-tutorial-sobreposto-2026-10-08.png`. Corrigir P000 antes de repetir smoke da ajuda; preservar a central de tutoriais por tema/tópico e a filtragem de permissões.


### P0 — Tutorial guiado: falhas de navegação e posicionamento confirmadas (08/10/2026)

1. **🔴 Tutorial guiado — avisos cortados e menu lateral sem navegação hierárquica por tema e tópico.**
   - **Histórico do lote 08 + tutorial + 26–28:** **🟡 correção UX integrada em staging no PR #333**. **Estado atual após novo smoke visual:** **🔴 REPROVADO NA ENTRADA (P000)**. O requisito anterior de percorrer automaticamente sete passos está **substituído** pela decisão de apresentar apenas um balão ancorado ao botão “?”; manter a hierarquia Tema → Tópicos na central de ajuda.
   - **Falha A — popover cortado:** na Visão geral, o aviso do passo 1 de 7 ("Ajuda e tutoriais") ultrapassa a borda direita; texto e botão "Próximo" ficam parcialmente escondidos e surge rolagem horizontal indevida.
   - **Falha B — navegação por temas:** na página do tutorial, a coluna esquerda apresenta uma **lista extensa e plana de tópicos** com o nome do tema repetido em cada item; não há menu navegável em dois níveis **tema → tópicos do tema** como especificado. A lista segue por uma altura desproporcional, tornando difícil localizar, expandir/recolher um tema e alternar entre assuntos.
   - **Evidências:** `Evidencias/tutorial-passo-1-popover-cortado-2026-10-08.png` e `Evidencias/tutorial-menu-lateral-sem-hierarquia-2026-10-08.png` (capturas fornecidas pelo fundador). O ambiente exato precisa ser confirmado no smoke; não presumir deploy apenas pela imagem.
   - **Correção esperada para o popover:** reposicionar automaticamente dentro do viewport, com largura limitada; todo texto, "Pular tutorial", "Anterior" e "Próximo" acessíveis sem scroll horizontal, inclusive em mobile e com zoom.
   - **Correção esperada para o menu lateral:** navegação real e hierárquica **Tema → Tópicos**. Cada tema deve ser cabeçalho clicável com expandir/recolher; ao expandir, listar somente os tópicos daquele tema, com recuo e seleção visível. Manter tema do tópico atual expandido, navegar por clique/teclado sem perder progresso, contar progresso por tema quando disponível, rolagem vertical independente da lateral se necessário e adaptação mobile (menu recolhível). Preservar busca e filtragem por papel/capabilities.
   - **Critérios de aceite históricos:** conferir tema expandir/recolher, seleção de tópicos em diferentes temas, avanço/retorno dentro da central de ajuda, busca, persistência de conclusão após F5 e relogin, foco/teclado, papéis com menus distintos, desktop/mobile e ausência de overflow horizontal. **Não repetir tour de sete passos automaticamente:** na entrada vale o novo aceite P000 do balão único no botão “?”.
   - **Escopo e preservações:** mesmo P0 do tutorial, **não criar demanda duplicada**. Corrigir UX e navegação sem mexer em dados clínicos, pacientes, permissões de backend, contratos, propostas, links ou cobranças existentes.


### P1 — 44 itens do relatório

1. [CORREÇÃO]* Persistência da rota após F5: atualizar a página em configurações, anamnese ou outros módulos não deve jogar o usuário de volta para a home. Deve manter rota e contexto.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

2. [CORREÇÃO]* Preferência de notificações no dispositivo: caixa marcada = notificações ativas; desmarcada = desativadas naquele dispositivo. Persistir após F5/relogin.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

3. [CORREÇÃO]* Permissão do navegador: se o navegador bloqueou notificações, o Verto deve informar claramente e orientar o usuário, sem fingir que estão ativadas.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

4. [REVISÃO OBRIGATÓRIA]* Notificações push: revisar ponta a ponta ativação, registro do dispositivo, recebimento real, desativação e persistência.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

5. [REVISÃO TRANSVERSAL]* Todos os envios ao paciente: revisar criação, agendamento, fila, retry, entrega, persistência, leitura e deduplicação de:
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

6. [CORREÇÃO]* Pergunta incompleta: ao tentar salvar pergunta vazia ou inválida, mostrar claramente onde está o problema.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

7. [CORREÇÃO]* Nova ficha: deixar evidente que a nova anamnese é independente e não vai sobrescrever a anterior.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

8. [CORREÇÃO DE FLUXO]* Preenchimento: não permitir preencher a anamnese diretamente no editor de configuração; o preenchimento deve estar associado a um paciente.
   - **Estado técnico em 08/10:** **🟡 CORREÇÃO IMPLEMENTADA, CI APROVADA E MERGEADA EM STAGING; SMOKE AUTENTICADO PENDENTE. Gestor de modelos inicia somente na personalização; não envia preenchimento sem paciente. PR #336.**

9. [PERMISSÃO]* Compartilhamento da anamnese: profissional comum só deve acessar a ficha final como documento em Arquivos quando alguém autorizado compartilhar explicitamente.
   - **Estado técnico em 08/10:** **🟡 RESTRIÇÃO DE CAPABILITY MERGEADA EM STAGING, VALIDAÇÃO END-TO-END DE ARQUIVOS AINDA PENDENTE. Terapeuta comum não recebe leitura operacional de anamnese; overlay de supervisão preservado, grants comuns bloqueados. Compartilhamento explícito, download protegido e cross-clinic ainda exigem smoke/API. PR #336.**

10. [RELATÓRIO]* PDF da anamnese: revisar se o documento final possui logotipo da clínica, dados da clínica, dados profissionais e demais elementos de personalização.
   - **Estado técnico em 08/10:** **🟡 AUDITORIA ESTÁTICA EXECUTADA, SMOKE VISUAL PENDENTE. Gerador já utiliza logotipo, clínica/CNPJ/endereço, profissional/registro/assinatura; preservar integração. Sem mudança no gerador. PR #336 adiciona cobertura estática.**

11. [AGENDA/SESSÃO]* Dias não permitidos: se determinado dia, como domingo, não estiver habilitado para atendimento pela clínica, impedir o agendamento já na Agenda. Não permitir criar para depois falhar no atendimento.
   - **Estado técnico em 08/10:** **🔴 IMPLEMENTAÇÃO PENDENTE. Agenda ainda permite selecionar dia sem política clínica canônica comprovada; regra precisa existir no backend e prevenir API direta. Não criar apenas bloqueio de frontend nem inventar configuração de dias.**

12. [PADRONIZAÇÃO]* Gráfico geral por especialidade: todas as especialidades devem ter gráfico geral em barras empilhadas mostrando habilidades, comportamentos interferentes, maestria, manutenção e regressão/alertas.
   - **Estado técnico em 08/10:** **🟡 ESTRUTURA EXISTENTE AUDITADA, VALIDAÇÃO POR TODAS AS ESPECIALIDADES PENDENTE. ClinicalPlanAnalyticsShell já tem barras empilhadas e cinco domínios; falta confirmar entradas reais de TO, Fono, ABA, demais e F5. Sem mudança de dados/consulta. PR #336 adiciona cobertura estática.**

13. [PADRONIZAÇÃO]* Gráficos individuais por alvo: todas as especialidades devem possuir também os gráficos detalhados por alvo/evidência que hoje aparecem parcialmente na Fono.
   - **Estado técnico em 08/10:** **🟡 ESTRUTURA EXISTENTE REVISADA; REGRESSÃO ADICIONADA NA BRANCH #337. Todos os planos de especialidade reutilizam buildClinicalTargetGroups/SeriesChart, com gráfico clínico por alvo quando há evidência canônica; smoke por TO/Fono/outras especialidades pendente.**

14. [PTS]* Visão multidisciplinar: o PTS deve consolidar os mesmos indicadores considerando todas as especialidades vinculadas.
   - **Estado técnico em 08/10:** **🟡 AJUSTE DE CONSOLIDAÇÃO NO PR #337. Adicionadas séries canônicas dos planos explicitamente vinculados a objetivos do PTS, sem unir por coincidência de especialidade e com deduplicação por chave; validar com múltiplas especialidades e F5.**

15. [CORREÇÃO]* Comportamentos interferentes: eventos registrados durante as sessões devem aparecer corretamente no gráfico geral da respectiva especialidade. Em TO, por exemplo, foram registrados mas não apareceram.
   - **Estado técnico em 08/10:** **🟡 AJUSTE DE PROVENIÊNCIA NO PR #337. Eventos comportamentais sem plano/objetivo/programa são incluídos somente quando TODAS as observações indicam inequivocamente a especialidade correspondente. Não reatribuir origem desconhecida, misturada ou referenciada a outro plano. Smoke TO com dados de sessão é obrigatório.**

16. [CORREÇÃO]* Fono: além da visão por alvo, também deve possuir o gráfico geral da especialidade.
   - **Estado técnico em 08/10:** **🟡 COMPONENTE GERAL COMPARTILHADO REUTILIZADO, PR #337. Barras empilhadas por domínio continuam presentes para Fono, com comportamentos comprovadamente atribuídos a ela; verificar com dados reais, desktop/mobile, F5.**

17. [CORREÇÃO]* Gráficos após F5: profissional não pode perder autorização e receber “Seu acesso atual nesta clínica não permite esta ação” após atualizar a página.
   - **Estado técnico em 08/10:** **🟡 MITIGAÇÃO DE HIDRATAÇÃO DE PERMISSÕES NO PR #337. O frontend aguarda capabilities clínicas suficientes nos contextos em que elas são fornecidas antes de carregar gráficos; backend continua autoridade para role/tenant/paciente. Não afirmar resolução de qualquer 403 sem smoke autenticado em terapeuta/coordenador/supervisor, F5 e relogin.**

18. [REGRA DE PRODUTO]* Gráficos de adulto: pacientes adultos, TEA/ABA ou terapia convencional, devem usar principalmente gráficos de avaliação por protocolo, como o comparativo por domínio do VB-MAPP.
   - **Estado técnico em 08/10:** **🟡 ALTERAÇÃO NO PR #339: gráficos de avaliação por protocolo priorizados nos dois perfis adultos. Intervenção ABA permanece complementar e recolhida somente no perfil ADULT_ABA; adulto convencional não herda visualização ABA. Smoke por perfil e protocolo pendente.**.

19. [CORREÇÃO]* Histórico adulto: sessões realizadas devem aparecer na linha do tempo com data, profissional, duração, status e evolução associada.
   - **Estado técnico em 08/10:** **🟡 IMPLEMENTAÇÃO EXISTENTE AUDITADA NO PR #339: seção de sessões concluídas apresenta data, profissional, duração e evolução com link para relatório. Teste de regressão criado; smoke com sessões reais pendente. Sem alteração funcional no histórico.**.

20. [REGRA]* Adulto convencional: herda as mesmas correções estruturais do adulto TEA/ABA, exceto recursos estritamente específicos de ABA/protocolo.
   - **Estado técnico em 08/10:** **🟡 IMPLEMENTAÇÃO EXISTENTE AUDITADA + AJUSTE NO PR #339: adulto convencional mantém sessão/evolução e avaliação por protocolo, sem trazer painel de intervenção ABA. Teste de regressão criado. Smoke de navegação e permissões pendente.**.

21. [CORREÇÃO]* Financeiro simples no agendamento: se a clínica não possui módulo TISS/TUSS, o popup deve puxar apenas o Plano Financeiro simples do paciente.
   - **Estado técnico em 08/10:** **🟡 IMPLEMENTAÇÃO EXISTENTE AUDITADA NO PR #339: Plano Financeiro do paciente usa patient.demographics.edit, independente de insurance_tiss; contexto TISS na Agenda condicionado à licença. Verificar seleção do plano simples e payload com paciente real; nenhuma correção de backend alegada.**.

22. [REGRA]* TISS/TUSS condicional: guia, autorização, procedimento TUSS, pré-guia etc. só aparecem quando o módulo de convênios estiver realmente ativo.
   - **Estado técnico em 08/10:** **🟡 GUARDA EXISTENTE AUDITADA NO PR #339: campos operacionais de guia/autorização/TUSS condicionados a authorizationHydrated && hasModule("insurance_tiss"). Teste contra regressão adicionado; smoke módulo desligado/ligado pendente.**.

23. [CORREÇÃO]* Especialidade do agendamento: lista deve ser derivada das especialidades existentes na clínica/profissionais vinculados.
   - **Estado em 08/10 (lote P1 23–27):** **🟡 CÓDIGO EM PR #340: dropdown simples e semanal com especialidades dos profissionais vinculados; excluir ABA/eventos não clínicos; smoke pendente.**.

24. [PERMISSÃO]* Recepcionista: no card da sessão, recepção deve ter apenas ações administrativas de status; não deve ver Iniciar sessão, prontuário, plano sugerido, relatório ou gráficos.
   - **Estado em 08/10 (lote P1 23–27):** **🟡 CÓDIGO EM PR #340: esconder ações e conteúdo clínico/financeiro do card da recepção; acesso API direta e role seguem para smoke.**.

25. [CORREÇÃO]* Salas no agendamento: salas já cadastradas precisam aparecer imediatamente ao abrir o agendamento. Hoje só apareceram depois de abrir Configuração de salas.
   - **Estado em 08/10 (lote P1 23–27):** **🟡 CÓDIGO EM PR #340: busca canônica ao abrir modal, resposta com isolamento de sequência e erro explícito; smoke e troca de workspace pendentes.**.

26. [CORREÇÃO]* Estado pendente: sessão “Pendente” não pode mostrar bloco “Sessão cancelada”.
   - **Estado em 08/10 (lote P1 23–27):** **🟡 CÓDIGO EM PR #340: pending prevalece sobre fase/resumo de cancelamento obsoleto; smoke necessário.**.

27. [REGRA]* Cancelamento no lembrete de 24h: se o paciente cancelar pela notificação de 24h, o cancelamento deve ser automático.
   - **Estado em 08/10 (lote P1 23–27):** **🔴 PENDENTE DE IMPLEMENTAÇÃO BACKEND: portal responde CANCEL_REQUESTED e não cancelamento transacional vinculado à notificação 24h; requer comprovação da origem, isolamento e testes.**.

28. [REGRA]* Cancelamento no lembrete de 12h: pode gerar solicitação de cancelamento para aprovação/recusa da clínica.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

29. [REVISÃO]* Pontualidade 24h/12h: validar que os lembretes realmente chegam no horário previsto, sem atraso relevante.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

30. [CORREÇÃO]* Capabilities na recepção: frontend não deve chamar endpoints que o papel não pode acessar, como team.view ou clinical.anamnesis.view, gerando 403 desnecessário.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

31. [CORREÇÃO]* Repasse recorrente batch: ao marcar “Gerar pagamentos recorrentes”, corrigir o 403 Um dos profissionais não pertence à clínica atual para profissionais com membership válida.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

32. [CORREÇÃO]* Membership em repasses: garantir consistência entre profissionais oferecidos no seletor, membership ativa e validação server-side da clínica atual.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

33. [CORREÇÃO/RELATÓRIO]* Produção: relatórios devem funcionar por profissional e por paciente, usando sessões e valores efetivamente registrados.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

34. [CORREÇÃO/RELATÓRIO]* Faturamento: previsto, realizado, a receber e inadimplência precisam refletir os dados reais.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

35. [REVISÃO]* Estrelinhas/recompensas: validar gravação e persistência após F5/relogin e novo acesso.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

36. [PENDÊNCIA/REVISÃO]* Relatório clínico personalizado: validar geração do documento com logotipo da clínica, dados do profissional, assinatura e período selecionado.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

37. [PENDÊNCIA]* Gráfico escolhido no relatório: confirmar que o gráfico que o profissional seleciona para relatório/evolução é realmente o utilizado no PDF/documento final.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

38. [PENDÊNCIA]* Gráfico no portal do paciente: confirmar que a seleção feita pelo profissional realmente controla qual gráfico fica visível ao paciente.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

39. [PENDÊNCIA]* Nota compartilhada: confirmar que uma anotação marcada como compartilhada chega exatamente à área correta do portal do paciente.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

40. [PENDÊNCIA]* Lembretes reais 24h/12h: executar teste temporal real de sessão normal, recorrente e remarcada.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

41. [PENDÊNCIA]* Notificação do dispositivo: testar marcada → recebe; desmarcada → para de receber; F5/relogin mantém estado.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

42. [PENDÊNCIA]* Relatórios financeiros com dados reais: validar produção, recebimento, atraso, repasses e faturamento com casos completos.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

43. [PENDÊNCIA]* Gráficos após correções: repetir smoke de PTS, Fono, TO, demais especialidades e adulto após implementação.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

44. [PENDÊNCIA]* Adulto convencional: atualmente estamos tratando as correções do adulto TEA/ABA como equivalentes, mas ainda vale executar um smoke reduzido depois das correções para confirmar.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.


### P2 — 41 itens do relatório

1. [CORREÇÃO]* Precificação por faixas de pacientes: eliminar quedas bruscas de preço por paciente nas mudanças de faixa, como 10→11 ou 20→21 pacientes. O desconto deve ser progressivo e calculado sobre o pacote total de módulos contratados.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

2. [CORREÇÃO]* Margem comercial consolidada: corrigir situações em que os módulos apresentam margem saudável individualmente, mas o “Resumo comercial” informa margem abaixo da meta.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

3. [CORREÇÃO]* Fotos/avatares: fotos de profissionais precisam carregar rapidamente e de forma consistente em perfil, menu da engrenagem, equipe, Agenda e seletores. Hoje às vezes demoram ou ficam apenas com iniciais.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

4. [REDESIGN]* Home dos profissionais: depois dos cards principais e da Agenda, a tela inicial deve terminar. Não deixar funcionalidades administrativas abaixo da Agenda.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

5. [ORGANIZAÇÃO]* Salas: configuração e gestão de salas ficam em Configurações, não na home.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

6. [PERMISSÃO]* Gestão de equipe: convites e gerenciamento de profissionais ficam em Configurações e apenas para diretor/coordenador.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

7. [COMERCIAL]* Mensalidade modular: preparar a arquitetura para mensalidade composta por módulos contratados, número de pacientes faturáveis e consumos variáveis adicionais.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

8. [COMERCIAL]* Franquia de Arquivos: reduzir o armazenamento gratuito de 1 GB para 100 MB por paciente.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

9. [NOVA FUNCIONALIDADE]* Upgrade por paciente: permitir expansão específica para 500 MB, 1 GB ou outras faixas futuras, com cobrança adicional por paciente.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

10. [NOVA FUNCIONALIDADE]* Aniversariantes: criar área de gestão mostrando os pacientes aniversariantes.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

11. [NOVA FUNCIONALIDADE]* Configuração de aniversário: engrenagem para configurar mensagem padrão e selecionar quais pacientes receberão o envio automático.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

12. [NOVA FUNCIONALIDADE]* Desativação de aniversário: a clínica deve conseguir desativar completamente os envios.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

13. [EXPERIÊNCIA]* Aniversário no portal: ao abrir a mensagem, o paciente deve receber uma experiência visual especial com confete e mensagem personalizada da clínica.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

14. [COMERCIAL]* Cobrança por mensagem de aniversário: informar o preço por envio antes da ativação e contabilizar os envios na mensalidade. Valor será definido depois.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

15. [CORREÇÃO]* Sino de notificações: cada notificação deve ter “Marcar como lida”, reduzindo imediatamente o contador.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

16. [MELHORIA]* Notificações: disponibilizar também “Marcar todas como lidas”.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

17. [PERMISSÃO]* Avisos para recepção: permitir que a clínica conceda a recepcionista/assistente a capability específica de emitir comunicados administrativos, sem ampliar acesso clínico.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

18. [CORREÇÃO]* Adulto não deve usar gráficos infantis: remover da experiência adulta a estrutura de gráficos de intervenção/PTS infantil, salvo quando alguma funcionalidade for explicitamente necessária.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

19. [CORREÇÃO]* Sessão adulta: remover do encerramento o bloco técnico com “Tentativas”, “Comportamentos”, “Sincronização” e “Prontuário”.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

20. [UX CLÍNICA]* Sessão adulta: priorizar evolução/observações, intercorrências, condutas, tarefas, próximos passos e encerramento.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

21. [NOVA FUNCIONALIDADE]* Agendamento em grupo: opção “Sessão em grupo” permitindo múltiplos pacientes no mesmo evento.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

22. [NOVA FUNCIONALIDADE]* Grupo com múltiplos profissionais: permitir um ou mais profissionais na mesma sessão.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

23. [NOVA FUNCIONALIDADE]* Grupo na mesma sala: todos os participantes do mesmo grupo podem compartilhar sala/horário sem gerar conflito interno.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

24. [REGRA DE CONFLITO]* Grupo: flexibilizar conflito somente dentro do próprio evento em grupo. Outros agendamentos independentes continuam protegidos.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

25. [FINANCEIRO]* Valor de sessão em grupo: permitir preço específico por sessão em grupo no plano financeiro do paciente.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

26. [REGRA]* ABA não é especialidade: remover ABA da lista de especialidades clínicas.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

27. [REGRA]* Eventos não clínicos: Supervisão, Reunião interdisciplinar, Orientação familiar e equivalentes não devem aparecer no agendamento exclusivo de pacientes.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

28. [UX]* Ações de status: concentrar “Confirmar sessão”, “Remarcar sessão” e “Cancelar sessão” dentro de “Ações de status”.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

29. [UX]* Remover duplicidade de botões: não deixar Remarcar/Cancelar simultaneamente dentro e fora do menu.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

30. [UX]* Cancelamento pendente: destacar o agendamento na Agenda, incluindo nome em vermelho, quando houver solicitação aguardando ação.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

31. [UX/FLUXO]* Repasse pago: “Pago” não deve ser simplesmente uma opção manual de dropdown. O pagamento deve ser registrado por uma ação apropriada, idealmente com comprovante anexado.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

32. [FLUXO]* Estados de repasse: estruturar claramente o ciclo calculado → aguardando → pronto para repasse → comprovante/pagamento → pago.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

33. [NOVA FUNCIONALIDADE]* Vencimento em dias úteis: permitir recorrência baseada em número/dias úteis, com cálculo automático das próximas datas.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

34. [MELHORIA]* Dashboard financeiro — repasses: mostrar previsto, pago, pendente, atrasado, próximo a vencer e profissionais envolvidos.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

35. [MELHORIA]* Dashboard financeiro — inadimplência: detalhar quantidade, valor, paciente/pagador, vencimento e dias em atraso.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

36. [PORTAL DO PACIENTE]* Relatório mensal: total de tempo efetivamente realizado em sessões no mês deve aparecer em “Relatório” no menu hambúrguer do paciente.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

37. [MELHORIA]* Aba própria “Diário da Família”: separar esses registros da timeline técnica de sessão para não se perderem no histórico.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

38. [NOVA FUNCIONALIDADE]* CRUD de tarefas agendadas: profissional deve poder visualizar, editar e excluir um envio futuro.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

39. [REGRA]* Edição de tarefa: editar deve atualizar o agendamento existente, e não criar uma cópia.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

40. [REGRA]* Exclusão de tarefa: excluir precisa cancelar efetivamente o disparo futuro.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

41. [PENDÊNCIA]* Funcionalidades novas: Agendamento em grupo, upgrade de armazenamento, mensagens de aniversário e CRUD de tarefas precisam de smoke próprio depois de implementados.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.


### P3 — 21 itens do relatório

1. [MELHORIA COMERCIAL]* Revisão da proposta antes do Stripe: manter módulos e benefícios visíveis, mas ocultar o valor mensal individual de cada módulo. Mostrar ao cliente principalmente o valor consolidado do pacote.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

2. [ORGANIZAÇÃO]* Configurações específicas de módulos: configurações de convênios, TISS/TUSS, operadoras, autorizações etc. devem ficar dentro do respectivo módulo, e não misturadas genericamente em “Dados da clínica”.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

3. [UX]* Salvamento nas configurações: reduzir os vários botões de “Salvar” redundantes e tornar claro qual seção cada ação salva.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

4. [UX]* Feedback de salvamento: preferencialmente mostrar a confirmação diretamente no próprio botão de salvar, e não depender apenas de toast.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

5. [UX GLOBAL]* Calendários: mostrar Outubro 2026, e não 10/2026, em mini calendário, calendário principal e demais calendários do sistema.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

6. [CORREÇÃO/COMERCIAL]* Marketplace “Módulos e Recursos”: remover o popup cortado no topo. Abrir modal centralizado, responsivo e comercialmente persuasivo, apresentando benefícios dos módulos e o acréscimo estimado/promocional na mensalidade. Valores ficam para definição posterior.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

7. [CORREÇÃO]* Menu lateral: eliminar totalmente o scroll horizontal.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

8. [RESPONSIVIDADE]* Cabeçalho mobile: reduzir a quantidade de ícones expostos. Manter prioritariamente hambúrguer e sino; tema, ajuda, configurações e demais opções secundárias devem ir para o hambúrguer.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

9. [UX]* Consumo de armazenamento: mostrar claramente quanto aquele paciente está usando, por exemplo, 72 MB de 100 MB utilizados.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

10. [UX]* Rascunho da anamnese: trocar o prompt nativo do navegador por modal visual integrado ao Verto.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

11. [MELHORIA]* Reordenar seções: permitir alterar a ordem de grupos/seções da ficha.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

12. [MELHORIA]* Template padrão: permitir iniciar novamente pelo modelo padrão oferecido na primeira ficha.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

13. [MELHORIA]* Duplicar ficha: permitir criar uma cópia de uma anamnese existente.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

14. [CORREÇÃO]* Cargo/função: quando essa informação já é conhecida pelo convite/onboarding, deve chegar preenchida no perfil profissional.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

15. [UX]* Disponibilidade no onboarding: manter onboarding simples, mas informar que horários específicos por dia poderão ser personalizados depois nas Configurações de disponibilidade.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

16. [UX]* Cabeçalho do PTS: mover “Voltar aos planos” para o canto superior esquerdo como navegação/seta. Deixar ações clínicas à direita.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

17. [UX]* Botão duplicado: remover o “Registrar repasse” duplicado do topo e manter apenas o botão dentro do bloco principal.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

18. [CORREÇÃO]* Visualização de imagens: imagens enviadas pelo paciente devem abrir ajustadas ao modal, preservando proporção, e não com zoom excessivo.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

19. [UX]* Menu do paciente: consolidar “Perfil” e “Configurações” quando representarem funções redundantes.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

20. [UX]* Popup de confirmação de tarefa: modal deve ser centralizado no viewport, não no tamanho total da página. Nenhum scroll deve ser necessário para fechar.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.

21. [UX]* Remover selo “Atrasada”: tarefas ainda disponíveis ao paciente não devem carregar esse rótulo punitivo.
   - **Estado em 08/10:** **Pendente de conciliação individual com GitHub e smoke; NÃO declarar concluído**.


### P4 — 3 itens do relatório

1. [PRODUTO]* Módulo Escola: manter existente, porém inativo por tempo indeterminado, fora da comercialização e no backlog.
   - **Estado em 08/10:** **Fora do escopo imediato (por decisão do fundador)**.

2. [PRODUTO]* Convênios/TISS/TUSS/lotes: manter fora do escopo atual desta rodada. Ainda não está comercialmente pronto.
   - **Estado em 08/10:** **Fora do escopo imediato (por decisão do fundador)**.

3. [OPCIONAL/IA-PRODUTO]* Biblioteca terapêutica por especialidade: melhorar sugestões para que sejam específicas da especialidade, evitando recomendações irrelevantes. Você havia pedido para não colocar isso como correção obrigatória do dev, então permanece separado.
   - **Estado em 08/10:** **Fora do escopo imediato (por decisão do fundador)**.


## Demandas adicionais encontradas fora do checklist

- **Carência automática de sete dias por inadimplência/trial** — P0 a discutir. GitHub: implementação canônica ainda incompleta; proteger clínica saudável quando outra estiver inadimplente.

- **Histórico clínico e Relatórios de pacientes adultos** — P0 a discutir. Migração estrutural aplicada; smoke autenticado de histórico/relatórios e compartilhamento continua pendente.

- **Convites profissionais com conta preexistente e roteamento correto de portais** — P0 a discutir. Testes backend integrados; falta fixture sintética e smoke de múltiplas clínicas.

- **Integridade de webhooks Stripe e reconciliação de eventos** — P0 a discutir. Foram observados 27 HTTP 500 históricos em staging; versão atual não foi comprovada com evento legítimo.

- **Links existentes, propostas históricas e preço congelado** — P0 a discutir. Correções de cobrança exata entregues; comparar ponta a ponta links existentes e proteger contra reprecificação/cancelamento.

- **Boleto de assinatura, ativação por senha/Google e entrega de e-mail** — P0/P1 a discutir. Discussões anteriores indicam fluxo de boleto e Google com re-smoke pendente; verificar produção contra staging.

- **Acesso clínico por papel, isolamento de dados entre clínicas e branding de notificações** — P0/P1 a discutir. Há testes unitários e entregas parciais; necessitam validação clínica real e autorização tenant-scoped.

- **Saúde operacional do Comercial e histórico de faturamento Stripe** — P0/P1 a discutir. Separar erros de webhook proteção de mismatch de evento legítimo; sem validar pagamentos reais pelo cliente.

- **Compra segura de módulos e upgrade na assinatura existente** — P1 a discutir. Código em staging, smoke do checkout/entitlement/webhook ainda pendente.

- **Cancelamento direto na Stripe suspender clínica corretamente** — P1 a discutir. Implementado em staging, teste funcional de webhook e isolamento por clínica pendente.

- **Comunicação interna entre faturista e clínica multi-clínica** — P1 a discutir. Integrada em staging, smoke com identidades sintéticas pendente; conflito com P4 módulo Convênios/TISS pausado.

- **Economia de requests, logs Supabase e retries de schema** — P1 a discutir. Correção técnica validada em staging; smoke de perfis e custo de uso pendente.

- **CI rígido, workflow de validação e Factory de recuperação** — P1 a discutir. PRs/workflows abertos e validações finais ainda pendentes; infraestrutura de qualidade.

- **Fixture de dados sintéticos para smoke E2E no SHA implantado** — P1 a discutir. Pendência não resolvida que dificulta certificar convites, faturista, portal, relatórios.

- **Paridade funcional completa produção ↔ staging** — A priorizar. Comercial e configurações financeiras atualizados, mas outras áreas/schema divergem; sincronização controlada com preservação de dados.

- **Tutorial ligado às contas reais, suporte por tópico concluído e WhatsApp** — A priorizar. Protótipo editorial separado apresenta integração e regras de desbloqueio de suporte pendentes.

- **Formulário de motivo de cancelamento, recorrência expandida, desconto/cortesia/estorno** — A priorizar. Explicitamente em OFF por decisão 06/10; retomada depende de confirmação de escopo.

- **PDF de relatório de atendimento e prévia de PDF de progresso** — A priorizar. Coleta de tutorial encontrou PDF desabilitado ou prévia não observada; validar antes de classificar regressão.

- **Relatórios administrativos de Produção e Faturamento** — A priorizar. Erro interno observado durante tutorial; problema não é a mesma coisa que gráfico de avaliação.

- **Financeiro de pacientes: erro intermitente após navegação** — A priorizar. Observado ao sair de Lotes XML; revalidar pelo financeiro simples sem reativar Convênios.

- **Seletores de gráficos, hora final em ISO e legibilidade financeira** — A priorizar. Defeitos visuais coletados no tutorial, ainda não localizados como correção aprovada.

- **Edição/revisão de programa usando nomes de campos técnicos e IDs** — A priorizar. UX confusa no resumo da edição de programas; salvamento ainda não testado.

- **Separar margem de contribuição de custo direto da margem corporativa com infraestrutura compartilhada** — Futuro. Discussão de hoje; usuário adiou deliberadamente a implementação.

- **Refatoração gradual de server.ts por domínios** — Futuro. Pedido anterior; após estabilização urgente, sem refactor em P0.


## Evidências adicionais por origem
- Código/PRs recentes de staging integrados: finalização, timers, offline, isolamento de especialidade, protocolos, anamnese, papéis, autenticação, tarefas, Agenda, recepção, diário, ABA Legacy, gráficos, tutorial e cálculo comercial.
- Comercial em produção: promoção isolada de cobrança exata/Essencial e premissas financeiras; preservar históricos via snapshots.
- Backlog GitHub ainda aberto: carência financeira; histórico adulto (schema recuperado, smoke pendente); convites multi-clínica; comunicação com faturista; compra de módulos; cancelamento Stripe; otimização logs; CI, runner e fixture de teste.
- Materiais complementares na Biblioteca: `Verto-Correcoes-Futuras-Tutorial.md`, `Verto-Tutorial-Papeis-e-Progresso.md`, `Verto-Tutorial-Pendencias-Off.md`.


## Atualização do lote P1 18–22 — 08/10/2026
- PR [#339](https://github.com/appverto1/Verto1/pull/339), branch `fix/p1-18-22-adult-charts-financial-20261008`.
- P1-18 e P1-20: ajuste funcional de prioridade dos gráficos adultos. P1-19, P1-21 e P1-22: implementação existente auditada, teste de regressão acrescentado; ainda sem smoke autenticado.
- CI **SUCCESS** (run 37861619129), PR #339 **MERGEADO** no staging SHA `0a75d6bf53da50507af39e2222c24ac03a39a190`. Deploy Railway `a347099b-6488-4512-9ef4-8c4b9473a9dd` **SUCCESS**, confirmado no commit `0a75d6bf53da50507af39e2222c24ac03a39a190` (staging). Todos os itens seguem **amarelos** por falta de smoke. Não declarar verde sem evidência. P000 permanece urgente.

## Registro de entrega — P1 23–27
- PR [#340](https://github.com/appverto1/Verto1/pull/340), merge por squash em `staging`: `f74d25f1976ca4c1790155b03d669a8f13a6e2e5`.
- GitHub Actions `37867033868`: **SUCCESS**. O pre-main gate contém `tests/p1AgendaReceptionRoomStatus.regression.test.mjs` e verifica explicitamente a permanência da solicitação no backend da P1-27.
- P1 23–26: código mergeado, **🟡 aguardam smoke autenticado** por papel e clínica.
- P1 27: **🔴 não implementada no backend**. Sem declarar cancelamento automático de 24h nem inferir a origem da notificação.
- Produção não modificada. P000 do tutorial continua 🔴 conforme evidência humana.
