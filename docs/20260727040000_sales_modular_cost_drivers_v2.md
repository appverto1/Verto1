# Motor modular de custos por drivers e propriedade

Versão técnica: `20260727040000`  
Modelo de cálculo: `2026-07-27-v2`

## Escopo

Esta evolução é exclusiva do construtor modular. O simulador legado continua
usando `salesProfitability.ts` e todas as premissas históricas. A migration
`20260727030000_sales_modular_proposal_builder.sql` não foi alterada. A nova
migration apenas acrescenta configuração à versão do catálogo e ao modelo de
custo de cada item; não cria, apaga, renomeia ou republica os catálogos v1/v2.

## Causa raiz

O motor v1 somava os campos diretos do item e, depois, alocava todas as
categorias equivalentes de `sales_financial_assumption_sets`. Como não havia
propriedade explícita, o mesmo custo podia entrar duas vezes. Além disso,
storage/egress eram derivados somente de `storage_block`, e o custo de uso
genérico dependia da quantidade comercial do item, não dos drivers operacionais
de cada funcionalidade.

Na primeira versão desta entrega, `supportPatientCost = item_direct` ainda
permitia `supportCostPerPatientCents = null`, e `otherVariableCost` não possuía
campo direto próprio. A correção torna ambos contratos explícitos em UI,
TypeScript e SQL. Zero informado é custo válido; `null`, ausência, valor
negativo ou driver incompleto bloqueiam a publicação com
`PRICING_CATALOG_PUBLICATION_BLOCKED:COST_OR_DRIVER` na RPC.

## Fórmulas: antes e depois

### Antes

```text
custo_direto_item =
  fixo_item
  + custo_clinica_item
  + pacientes_esperados × custo_paciente_item
  + quantidade_comercial × custo_unidade_item
  + storage_block_gb × (custo_storage_gb + custo_egress_gb)
  + suporte
  + operação

custo_compartilhado = soma de todas as premissas gerais aplicáveis
```

Não existia uma regra que escolhesse uma única origem para categorias
equivalentes. O storage incluído em `clinical_core` não entrava no custo e o
egress era implicitamente igual ao volume armazenado.

### Depois

Para cada categoria versionada:

```text
owned_direct(categoria) =
  custo_do_item, se propriedade = item_direct
  0,             se propriedade = shared ou excluded

owned_shared(categoria) =
  premissa_geral, se propriedade = shared e houver item selecionado aplicável
  0,              se propriedade = item_direct ou excluded
```

Assim, a categoria entra por uma única origem. Um valor direto mantido em uma
categoria `shared` é ignorado pelo cálculo, mas gera “Possível custo duplicado”
para auditoria. A publicação exige justificativa explícita ou correção da
propriedade.

Para o Verto Clínica:

```text
storage_incluido_mb = limite_de_pacientes_da_faixa × includedStorageMbPerPatient
storage_incluido_gb = storage_incluido_mb ÷ 1024
storage_usado_gb = storage_incluido_gb × percentual_utilizacao
custo_storage = storage_usado_gb × storageCostPerGbCents
egress_estimado_gb = storage_usado_gb × expectedEgressMultiplier
custo_egress = egress_estimado_gb × egressCostPerGbCents
```

O parâmetro inicial versionado é 100 MB/paciente. O limite da faixa, e não os
pacientes atualmente usados, reserva a capacidade. Logo, até 10 pacientes
representa 1.000 MB e até 25 representa 2.500 MB.

Para notificações da Agenda:

```text
notificacoes =
  consultas × lembretes_por_consulta
  + notificacoes_internas
  + emails
  + web_push
  + mensagens_pagas_futuras

custo_notificacoes = notificacoes × notificationCostPerUnitCents
```

Para implantação por horas:

```text
horas = configuracao + treinamento + importacao
custo_implantacao = horas × custo_por_hora + custos_extraordinarios
```

No modo manual, `onboardingCostCents` substitui o cálculo por horas. O custo é
reconhecido uma única vez.

## Matriz inicial de propriedade

| Categoria | Propriedade inicial | Origem modular |
|---|---:|---|
| Paciente variável | `item_direct` | funcionalidade |
| Clínica variável | `item_direct` | funcionalidade |
| Armazenamento | `item_direct` | funcionalidade |
| Egress | `item_direct` | funcionalidade |
| Processamento | `item_direct` | funcionalidade |
| Notificações | `item_direct` | funcionalidade |
| Outros variáveis | `item_direct` | funcionalidade |
| Suporte por clínica | `item_direct` | funcionalidade |
| Suporte por paciente | `item_direct` | funcionalidade |
| Operação | `item_direct` | funcionalidade |
| Fixo mensal elegível | `shared` | premissas gerais |

Os componentes que já eram compartilhados continuam fora dessa matriz:

| Componente | Regra preservada |
|---|---|
| Stripe percentual | compartilhado por receita |
| Stripe fixo | compartilhado e atribuído ao pacote-base |
| Imposto sobre faturamento | compartilhado por receita |
| Inadimplência | compartilhada por receita |
| Depreciação | compartilhada abaixo do EBITDA |
| Despesas financeiras e demais despesas | compartilhadas abaixo do EBITDA |
| Imposto sobre lucro | compartilhado e alocado após EBITDA |

Qualquer uma das 11 categorias versionadas pode ser alterada para `shared`,
`item_direct` ou `excluded` em um novo rascunho. A mudança não afeta o legado.

## Matriz única de aplicabilidade

A mesma matriz canônica é consumida pelo formulário, validador do backend,
motor e testes TypeScript; a migration contém a função SQL equivalente
`sales_modular_cost_category_applies_v2`, coberta pelo teste transacional.
Categorias fora da matriz não são solicitadas nem contabilizadas.

| Item | Categorias mensais aplicáveis |
|---|---|
| `clinical_core` | paciente, clínica, storage, egress, outros variáveis, suporte/clínica, suporte/paciente, operação, fixo elegível |
| `appointments_communication` | paciente, clínica, notificações, outros variáveis, suporte/clínica, suporte/paciente, operação, fixo elegível |
| `financial_management` | clínica, processamento, outros variáveis, suporte/clínica, operação, fixo elegível |
| `insurance_tiss` | clínica, storage, egress, processamento, outros variáveis, suporte/clínica, operação, fixo elegível |
| `school_management` | paciente, clínica, storage, egress, processamento, notificações, outros variáveis, suporte/clínica, suporte/paciente, operação, fixo elegível |
| `additional_storage` | storage, egress e outros variáveis |
| `onboarding` | nenhuma categoria mensal; usa custo único manual ou horas + extraordinários |

Quando `supportPatientCost = item_direct`, os itens `clinical_core`,
`appointments_communication` e `school_management` exigem
`support_cost_per_patient_cents`. Quando `otherVariableCost = item_direct`,
todo item recorrente ativo ao qual a matriz se aplica exige
`other_variable_cost_cents`. Esses campos são categorias próprias e não
reutilizam custo genérico de uso, processamento ou operação.

## Drivers por funcionalidade

Cada datum guarda `value`, `source`, `sourceDetail`, `effectiveAt` e `version`.
As origens válidas são `actual`, `calculated`, `estimated`, `manual` e
`unavailable`. Ausência obrigatória permanece “Dados insuficientes”; nunca é
convertida em zero.

| Funcionalidade | Drivers versionados |
|---|---|
| Verto Clínica | sessões clínicas, sessões ABA, registros/tentativas ABA, documentos, capacidade de storage, utilização e egress |
| Agenda e Comunicação | consultas, lembretes/consulta, notificações internas, e-mails, web push e mensagens pagas futuras |
| Financeiro e Gestão | lançamentos, relatórios financeiros e processamentos recorrentes; custos fixos por clínica continuam possíveis |
| Convênios e TISS | guias, lotes, XML, documentos, processamento, storage e egress |
| Gestão Escolar | pacientes com vínculo escolar, reuniões, participantes, documentos, notificações, storage e egress |
| Armazenamento adicional | GB comprados, utilização esperada e multiplicador de egress |
| Implantação | horas de configuração, treinamento e importação, custo/hora e extraordinários; alternativa manual direta |

Os perfis `light`, `standard` e `intensive` são versionados no catálogo. A
utilização inicial explícita é 25%, 60% e 100%. O multiplicador de egress inicia
como indisponível para que o owner informe um critério real. O perfil `custom`
aceita overrides versionados na proposta.

## Resultado e reconciliação

Cada linha expõe receita, fixo direto, paciente, uso, storage, egress,
notificações, outros custos variáveis, suporte, operação, compartilhado
alocado, contribuição, EBITDA e lucro gerencial. Storage incluído, estimado em
uso e egress estimado são mostrados separadamente.

Todos os rateios monetários permanecem em centavos inteiros. O resíduo de cada
componente é atribuído deterministicamente ao pacote-base. Antes de retornar o
resultado, o motor verifica cada categoria e o consolidado:

```text
soma(campo de todas as linhas) = campo consolidado
```

`totalsReconciled` só é verdadeiro se receita, descontos, custos, contribuição,
EBITDA, despesas, imposto e lucro fecharem exatamente.

## Publicação segura

A publicação é validada no frontend, no backend e novamente na RPC
transacional. Ela é bloqueada por:

- item ativo sem modelo/custo obrigatório;
- driver obrigatório indisponível em qualquer perfil publicado;
- custo direto negativo;
- categoria `shared` com equivalente direto e sem justificativa;
- `clinical_core` sem modelo de storage incluído;
- item com storage sem critério de egress;
- simulação v2 persistida com `totalsReconciled = false`.

`sales_modular_cost_settings_valid_v2` exige exatamente as 11 propriedades de
ownership, sem ausências ou extras, e retorna `false` para tipos, números ou
`schemaVersion` inválidos. `requiredDrivers` é comparado como conjunto: a ordem
é livre, mas ausência, item extra e duplicação são rejeitados.

O alerta de duplicidade usa somente o modelo atual de cada item; versões antigas
de custo não bloqueiam indevidamente o rascunho atual.

## Persistência, snapshots e compatibilidade

- `modular_cost_settings` pertence à versão do catálogo;
- `driver_config` pertence à versão imutável do modelo de custo do item;
- a RPC v2 de clone copia ambos sem recriar o catálogo de origem;
- a RPC v2 de save preserva idempotência e permite rascunho incompleto;
- a RPC v2 de publish exige o modelo completo e inclui a configuração no
  `catalog_snapshot`;
- snapshots antigos não são atualizados ou recalculados;
- nenhum novo custo escreve na DRE realizada;
- Checkout modular continua falhando fechado antes da Stripe;
- Checkout, cupons, assinatura e simulador legados não foram alterados.

## Segurança e multi-tenant

Não foram criadas tabelas públicas nem políticas permissivas. Colunas e funções
internas permanecem no mesmo domínio comercial service-only da migration
anterior. As RPCs v2 têm `EXECUTE` revogado de `public`, `anon` e
`authenticated`; somente `service_role` recebe acesso. As rotas continuam
exigindo owner/Super Admin com MFA, validam UUIDs e recalculam o resultado no
backend. Nenhum preço, custo, driver resolvido ou total enviado pelo navegador é
aceito como resultado autoritativo.

## Performance e custo de banco

1. Não há N+1: itens, faixas e versões de custos são consultados em três lotes.
2. A tela completa do catálogo faz seis consultas principais: uma versão, três
   lotes em paralelo, lista de versões e relatório agregado. O modo compacto faz
   quatro.
3. Itens, faixas, custos e drivers são montados por mapas em memória.
4. A prévia e os cenários agressivos reutilizam o catálogo e as premissas já
   carregados; trocar perfil ou driver não faz fetch.
5. O estado é recarregado somente após save, clone ou publish; o snapshot é
   gravado no evento correto.
6. Não houve nova materialização; os snapshots existentes continuam sendo a
   fonte histórica e a view agregada continua sendo a fonte do relatório.
7. Cache, snapshots, RPCs e consultas permanecem no escopo owner/service-only;
   nenhuma otimização removeu MFA, validação ou isolamento.
8. Impacto esperado: zero consultas por item e uma consulta a menos na tela e
   no preflight de publicação em relação à primeira implementação v2.

## Aplicação manual

A migration `20260727030000` já aplicada não deve ser executada novamente nem
editada.

1. Confirme que o projeto Supabase selecionado é o ambiente correto.
2. No SQL Editor, revise e execute somente
   `supabase/migrations/20260727040000_sales_modular_cost_drivers_v2.sql`.
3. Execute
   `supabase/tests/20260727040000_sales_modular_cost_drivers_v2_test.sql`.
   O teste cria e publica temporariamente um clone por meio das RPCs v2 dentro
   de `BEGIN`/`ROLLBACK`; ao terminar, restaura o catálogo ativo original e não
   deixa dados de catálogo, snapshot, DRE ou Stripe alterados.
4. Execute as consultas de
   `supabase/verification/20260727040000_sales_modular_cost_drivers_v2_checks.sql`.
5. Confirme v1 ativo e “Catálogo comercial — custos iniciais” ainda em rascunho.
6. Não publique o catálogo v2 antes de preencher custos, drivers e critérios de
   egress reais.

Nenhum SQL deste pacote foi executado no Supabase real durante o desenvolvimento.

## GitHub Desktop — entrega direta na Main

1. Abra `C:\Users\kageo\Downloads\Verto1` no GitHub Desktop e confirme que
   **Current branch** é `Main`; não crie outra branch.
2. Em **Changes**, confirme que
   `20260727030000_sales_modular_proposal_builder.sql` não aparece e revise a
   migration `20260727040000`, o teste transacional e os arquivos do manifesto.
3. Use como resumo sugerido:
   `Corrige motor modular de custos por drivers e propriedade`.
4. Somente depois da revisão e da aplicação manual da migration no ambiente
   correto, faça **Commit to Main** e **Push origin** pelo GitHub Desktop.
5. Não habilite o Checkout modular nem publique o catálogo v2 até preencher
   custos, drivers e critérios reais e executar o teste SQL e as consultas de
   verificação.
