# VERTO — INVENTÁRIO VENDÁVEL CRÍTICO

**Criado:** 04/11/2026. **Ambiente:** exclusivamente staging. **Execução:** uma tarefa por comando do fundador, sem avançar automaticamente.
**Meta:** modularizar os fluxos críticos mantendo comportamento e segurança, depois realizar smoke autenticado por jornada.
**Fora do escopo:** módulos Escola e Convênio (não remover direitos existentes nem desligar funcionalidades de clientes reais).

## Bloco A — Aquisição e ativação da clínica (01–14)
| Nº | Entrega contratada | Situação deste roteiro |
|---|---|---|
| 01 | Cadastro no site → CRM Prospecção "Cadastro no site", sem F5; modularizar caminho | **IMPLEMENTADO, MERGEADO E DEPLOYADO EM STAGING (PR #581)**; smoke humano pendente para o bloco A |
| 02 | Cadastro manual e em lote de oportunidades | **MERGE E DEPLOY STAGING CONFIRMADOS (PR #582)**; smoke humano do bloco A pendente |
| 03 | CRM: movimentação de etapas, tentativas, canais, histórico | **IMPLEMENTADO, MERGEADO E DEPLOYADO EM STAGING (PRs #583 e #584)**; smoke humano do bloco A pendente |
| 04 | Construtor de proposta: módulos, preços, condições, snapshot | **PR #585 MERGEADA EM STAGING**; deploy/saúde precisam ser conferidos no SHA; smoke humano do Bloco A pendente |
| 05 | Link comercial: criar/copiar/preservar propostas anteriores | **PR #586 MERGEADA EM STAGING**; deploy/saúde do SHA precisam ser confirmados antes de concluir entrega técnica; smoke humano do Bloco A pendente |
| 06 | Link público: abrir sem login e apresentar proposta correta | Base de leitura anônima já integrada pelo PR #587; nova modularização visual extraída do PR #579 do Codex, com CI/merge/deploy do item 06 ainda por comprovar; smoke público do Bloco A pendente. **Acompanhar no [controle 01–14](./VERTO_MODULARIZACAO_CRITICA_01_14.md).** |
| 07 | Cartão Stripe em teste, confirmar pagamento | **PR #588 MERGEADA EM STAGING**; confirmar deploy no SHA a30415fa; pagamento de teste não executado; modo Stripe test permanece não confirmado |
| 08 | Boleto Stripe em teste, confirmar pagamento assíncrono | **PR #590 MERGEADA E DEPLOYADA EM STAGING** (SHA 0976f308); smoke Stripe TEST e ativação assíncrona pendentes |
| 09 | Webhooks/assinatura: idempotência, módulos, zero cobrança duplicada | **CORREÇÃO EM CI**: PR #592 mergeada e aplicada em staging; PR complementar com filtro atômico no webhook para lead convertido e remoção do trigger baseado em cabeçalhos (evita interferência no CRUD manual). CI, merge/deploy e smoke Stripe TEST pendentes |
| 10 | Pagamento → onboarding diretamente, sem checkout repetido | **CONTRATO JÁ IMPLEMENTADO; REGRESSÃO REFORÇADA EM PR STAGING**: retorno Stripe com reconciliação server-side, sessão de Diretor autenticada, onboarding de clínica já paga sem novo checkout. CI, merge/deploy e smoke Stripe TEST do Bloco A ainda exigem confirmação; sem alteração funcional ou cobrança. |
| 11 | Primeiro acesso do diretor por e-mail e senha | **CORREÇÃO PONTUAL EM REVISÃO STAGING**: ativação com senha forte, autenticação backend do Diretor e retomada de perfil parcial já existentes; corrigido feedback quando senha é persistida mas login falha antes de novo render React. Testes do fluxo, domínios de e-mail e segurança adicionados ao gate; CI, merge/deploy e smoke autenticado do Bloco A pendentes. Sem alteração de banco, Auth, cobrança ou permissões. |
| 12 | Primeiro acesso do diretor com Google | **CORREÇÃO PONTUAL EM REVISÃO STAGING**: OAuth Google para ativação comercial já existente; limpeza do contexto temporário no erro de início e recuperação de exceção no login pós-redirecionamento, mantendo conferência do contrato/identidade no backend e callback protegido. Regressões incluídas no gate; CI, merge/deploy e smoke autenticado do Bloco A pendentes. Confirmar Google e URL de retorno habilitados no Supabase staging antes do smoke; sem mudanças de banco, Stripe ou produção. |
| 13 | Cadastro/configurações da clínica, Salvar, persistir e mostrar sem F5 | **CORREÇÃO DE PERSISTÊNCIA EM REVISÃO STAGING**: Salvar configurações institucionais exige confirmação positiva da API autenticada, não considera fila offline como registro salvo, exibe sucesso/log somente após resposta e atualiza estado de clínica sem F5 pelo usuário confirmado do backend. Onboarding restaura tipo de atendimento salvo e prioriza dados confirmados. Mantido fluxo offline do perfil pessoal, autoridade do botão Salvar, RBAC/tenant e Stripe intactos; teste comportamental de rede/403 e regressões no gate. CI, merge/deploy e smoke autenticado do Bloco A ainda pendentes. |
| 14 | Tutorial inicial guiado e persistência por papel, inclusive novo login | **CORREÇÃO DE GUIA E PERSISTÊNCIA EM REVISÃO STAGING**: tutorial clínico existente permanece com balão único na Central de Ajuda, conclusão/reinício contextual e UI intactos; estado estável agora separado por usuário, clínica e papel, sem reiniciar ao mudar módulos, migrando chave local anterior. Faturista e paciente infantil/adulto passam a ter guia inicial contextual próprio e ação de rever, sem acesso a conteúdo administrativo ou alteração de permissões. Persiste após F5 e novo login **no mesmo navegador**; sincronização entre dispositivos não foi adicionada. Sem banco, Stripe ou requests extras; regressões de isolamentos, replay e retomada no gate. CI, merge/deploy e smoke humano de Bloco A pendentes. |

## Bloco B — Operação clínica (15–24)
| Nº | Entrega contratada |
|---|---|
| 15 | Convidar profissional |
| 16 | Aceitar convite com papel, especialidade, tenant e portal correto |
| 17 | Cadastrar/convidar paciente infantil e adulto |
| 18 | Portal e primeiro login do paciente correto |
| 19 | Anamnese infantil e adulta persistente |
| 20 | PTS/plano por especialidade e equipe, permitindo diretor também profissional habilitado |
| 21 | Sessão e metas do plano correto por especialidade |
| 22 | Agenda: criar, editar, repetir, restrições de profissionais/especialidades |
| 23 | Lembretes, confirmação, remarcação e cancelamento |
| 24 | Reflexo em financeiro, sem duplicidade/cross-clinic |

## Bloco C — Cards e portais (25–34)
| Nº | Entrega contratada |
|---|---|
| 25 | Card/portal infantil e Diário da Família |
| 26 | Card/portal adulto TEA |
| 27 | Card/portal adulto terapia convencional |
| 28 | Agendar, enviar, receber e concluir tarefas |
| 29 | Registrar humor e visualizar histórico de adulto |
| 30 | Anotações privadas, compartilhadas com equipe, compartilhadas com paciente |
| 31 | Arquivos: 100 MB grátis pretendidos; implementação atual 1 GB, preservar legados |
| 32 | Mensagens/colaboração por permissão |
| 33 | Rede de cuidado: convite externo, painel, compartilhamento, revogação |
| 34 | Histórico, gráficos, compartilhamento gráfico explícito no infantil, relatórios |

## Bloco D — Segurança e fechamento (35–38)
| Nº | Entrega contratada |
|---|---|
| 35 | Fidelidade 12 meses: salvar, publicar, aceite do diretor, consulta, revisão jurídica |
| 36 | Testes negativos: IDOR, roles, clínicas, duplicação, concorrência, persistência |
| 37 | Modularização complementar somente dos fluxos acima |
| 38 | Regressão total, custos, smoke aprovado e eventual promoção seletiva autorizada |

## Guardrails permanentes
- Uma tarefa por vez; aguardar próximo comando do fundador para prosseguir.
- Não marcar concluído/homologado por simples código, PR, CI, merge ou deploy. O fundador realizará smoke real depois do bloco 14; quando houver limite de capability, registrar explicitamente.
- Preservar comercial, links, onboarding, Stripe, módulos, pacientes, clínicas e histórico; correções funcionais separadas de refactors sempre que possível.
- Só o botão **Salvar** efetiva persistência clínica/cadastral. Depois de salvar: estado sem F5 e durabilidade após F5/relogin.
- Auth, permissões, clínica, especialidade e idempotência sempre validados no backend e RLS; não confiar em IDs do browser.
- Evitar N+1, leituras duplicadas, polling, egress e novos serviços. GitHub Actions US$ 0. Não alterar produção.
- Regra de arquivos de 100 MB ainda NÃO foi implementada: o estado atual é 1 GB no frontend/backend/banco.
- Não alterar/agendar automações sem autorização literal prevista em Guardrails.
