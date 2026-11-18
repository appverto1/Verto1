# Release PASS Staging → Main — baseline de 16/11/2026

> **Status:** preparação em draft, sem autorização de merge automático; **sem migração/deploy no contexto deste documento**.
> **Issue de rastreabilidade:** [#766](https://github.com/appverto1/Verto1/issues/766).
> **Objetivo:** promover somente funcionalidades homologadas pelo fundador como PASS em staging, mantendo todos os hotfixes, dados, permissões e comportamentos existentes em main.

## 1. SHAs fixados para a triagem

| Ref | SHA |
| --- | --- |
| Main, base da release | `251ef298d8b543cb832659325ca71e4e3f8c89e2` |
| Staging, snapshot para evidências | `476f928c6e3ae4d84193c7e77b87f0103bac8583` |
| Merge base | `e78a05511dfd03b82d32d92d44f4231004d71a64` |
| Diferença (GitHub compare) | Staging +1.159 / Main +73 |

Contagem direta de Git trees desses SHAs:

| Área | Só staging | Só main | Caminhos presentes nos dois com conteúdo diferente |
| --- | ---: | ---: | ---: |
| `services/` | 18 | 0 | 24 |
| `src/` | 47 | 0 | 51 |
| `supabase/` | 64 | 27 | 0 |

Esses números são **diferenças de arquivos, não de funcionalidades nem de esquemas efetivos**. O GitHub compare é truncado a 300 arquivos; não usá-lo como inventário completo do diff.

## 2. Matriz inicial de promoção baseada em aceite humano

| Pacote | Evidência humana disponível | Estado de conciliação |
| --- | --- | --- |
| Comercial Smoke 01, 02, 04, 05 e 06 | Etapas 1–5 PASS relatadas | Parte já presente em Main: #669, #670, #753. Exige mapeamento de funcionalidades/SHAs para verificar lacunas. |
| Comercial Smoke 07 | PASS de abandono/retomada no Stripe TEST, **não** pagamento confirmado | Comparar comportamento com Main sem acionar pagamentos reais |
| Comercial Smoke 08 | PASS de boleto pendente, **não** liquidação | Preservar bloqueio de acesso até webhook confirmado |
| Comercial Smoke 10 e 11 | Fluxo declarado PASS; sem evidência de todas as etapas na consolidação | Identificar passos específicos e SHA antes de promover |
| Google OAuth Diretor pago | PASS posterior explícito | **Já promovido** em Main #752; não retransplantar |
| Gráficos por especialidade | PASS explícito | **Já promovido** em Main #750; manter restrição PTS a diretores, coordenadores e supervisores |
| Stripe: bloqueios, cartão/boleto, webhooks, isolamento, persistência | 5 testes aprovados pelo fundador em 15/11 | Proteção de provisionamento já promovida em Main #755; conferir paridade e cobertura antes de ampliar |
| Parcerias Smoke 00–02, aprovação e indicação | PASS relatados em escopo específico | Main não possui arquivos de portal de parcerias que existem em Staging; requer pacote integrado (API, RLS, OAuth, e-mail, cupom, UI), sem promover abas novas ainda não homologadas |
| Modularizações M13–M16 | Validação técnica registrada | Não equivalem a smoke funcional integral; tratar como dependências de codegen/build, não PASS humano automático |

### Escopos **não autorizados** só por estarem em Staging

- Comercial Smoke 03 e 09 parcialmente aprovados; 13 e 14 sem PASS integral recuperado. O PASS tardio do Google corrige especificamente o bloqueio do Google, não prova automaticamente todos os passos dos Smokes 13/14.
- ABA CRUD de comportamentos (#745), cabeçalho/duração (#746), Drive de 100 MB/1 GB (#742), financeiro novo (#738) e apresentações de Marketplace (#734–#736): solicitação ou merge **não** é homologação PASS.
- Bugs conhecidos sem fechamento de smoke: ABA offline (#707), gráficos Fono (#705), `POST /collection-plan` (#703), comportamento de rolagem (#702), cancelamento de agenda (#706).
- IA-03/IA-04/IA-05/IA-06 em Staging: os patches de schema/RLS exigem compatibilidade com Main e não devem ser copiados por ordem temporal sem análise; Main já tem correções próprias #762/#764.

## 3. Preservações obrigatórias de Main

- #688/#690: recuperação de falhas transitórias `PGRST002`/`PGRST003` sem desligar API nem bypass.
- #689: falha em lease distribuído não pode derrubar Node.
- #668: escrita ABA confirma persistência antes de sucesso.
- #714: atualizar gráfico somente após finalização confirmada.
- #750–#755: especialidade, Google PKCE, lead/proposta, pagamento Stripe e provisionamento.
- #762 e #764: `anon` não executa funções privilegiadas, `TRIGGER` comum revogado, acesso clínico requer membership e identidade autorizada; preserve Super Admin.
- #669/#670: promoções antigas de agenda/financeiro e ativação paga, com históricos de migração específicos de produção.

**Nunca** copiar `supabase/migrations` em lote: os arquivos `promote_*.sql` e `supabase/operations/promotion_staging_sources` de Main podem incorporar migrações de Staging sob outro nome. Comparar objetos efetivos, RLS, GRANT, constraints e conteúdo antes de criar migração de reconciliação.

## 4. Critério de aceite para cada lote de código

1. Evidência PASS humano e snapshot de Staging correspondente identificados; PR difere apenas no escopo.
2. Mapear `src`, `services`, testes, migrations e contratos de API envolvidos; comparar com Main inclusive hotfixes exclusivos.
3. Checks locais/CI aplicáveis: build Node 20/TypeScript, regressões do pacote, secret scanning, pre-main gate, RPC/RLS/tenant-IDOR, race e idempotência.
4. Checagem de migração transacional/dry-run e pré/pós-check com rollback viável; nunca copiar dados de cliente entre bancos.
5. Testes de login/Google/senha, convites, vínculo ativo/revogado, Stripe TEST, boleto pendente, webhooks fora de ordem, portais e Salvar → F5 → logout/login conforme o risco real do lote.
6. Diff revisado, heads reconfirmados (sem SHA drift), PR não draft aprovado; deploy Railway com Supabase esperado por ambiente e smoke pós-deploy, um passo por vez.
7. Registrar custo estimado Supabase/Railway (requests, egress, storage, retries), anomalias e rollback.

## 5. Estado desta tranche

A branch desta proposta é baseada **em Main**, para preservar os 73 commits exclusivos da produção. Este documento não é um pacote funcional, não altera schema nem ambientes, e não deve ser confundido com o deploy das funcionalidades aprovadas.

**Próxima etapa técnica:** reconciliar componentes comerciais/Parcerias não presentes em Main com o subconjunto exato já homologado e suas dependências, em PRs de código separados e comprováveis. Qualquer componente com aprovação incompleta permanece em Staging.
