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
| 06 | Link público: abrir sem login e apresentar proposta correta | **PR #587 MERGEADA EM STAGING**; deploy/saúde ainda aguardam confirmação no SHA; smoke do Bloco A pendente |
| 07 | Cartão Stripe em teste, confirmar pagamento | **PR #588 MERGEADA EM STAGING**; confirmar deploy no SHA a30415fa; pagamento de teste não executado; modo Stripe test permanece não confirmado |
| 08 | Boleto Stripe em teste, confirmar pagamento assíncrono | **PR #590 MERGEADA E DEPLOYADA EM STAGING** (SHA 0976f308); smoke Stripe TEST e ativação assíncrona pendentes |
| 09 | Webhooks/assinatura: idempotência, módulos, zero cobrança duplicada | **IMPLEMENTAÇÃO EM REVISÃO**: duas guardas atômicas de banco para webhooks Stripe atrasados, preservando edição manual de leads; testes de PostgreSQL isolado no CI; CI, merge, migração staging, deploy e smoke Stripe TEST pendentes. server.ts inalterado. |
| 10 | Pagamento → onboarding diretamente, sem checkout repetido | PENDENTE DE COMANDO |
| 11 | Primeiro acesso do diretor por e-mail e senha | PENDENTE DE COMANDO |
| 12 | Primeiro acesso do diretor com Google | PENDENTE DE COMANDO |
| 13 | Cadastro/configurações da clínica, Salvar, persistir e mostrar sem F5 | PENDENTE DE COMANDO |
| 14 | Tutorial inicial guiado e persistência por papel, inclusive novo login | PENDENTE DE COMANDO |

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
