# Fórmulas e política

## Preço mínimo

```text
denominador =
1
- margem EBITDA alvo
- Stripe percentual
- inadimplência
- imposto sobre faturamento

preço mínimo =
(custo fixo alocado + custo direto + taxa fixa de cobrança)
/ denominador
```

O denominador deve ser maior que zero. Custo ou premissa indisponível permanece `null` e bloqueia o cálculo; nunca é convertido em zero.

## Alocação

| Componente | Verto Clínica | Módulo adicional |
|---|---:|---:|
| Infraestrutura compartilhada | uma vez | não |
| Operação-base | uma vez | não |
| Suporte-base | uma vez | não |
| Segurança e autenticação | uma vez | não |
| Custos fixos elegíveis | uma vez | não |
| Reserva operacional por clínica | uma vez | não |
| Taxa fixa de cobrança | uma vez | não |
| Custo direto/variável | próprio | próprio |
| Armazenamento/egress/processamento incremental | próprio | próprio |
| Stripe percentual, inadimplência e imposto | sobre receita | sobre receita |

## Margens

```text
margem EBITDA da clínica =
(receita recorrente - custo EBITDA total) / receita recorrente

margem incremental do módulo =
(receita do módulo - custos incrementais do módulo) / receita do módulo
```

Um módulo aumenta a margem consolidada se, e somente se, sua margem incremental for superior à margem consolidada anterior.

## Pisos versionados

| Regra | Margem |
|---|---:|
| Piso absoluto da clínica | 60% |
| Meta recorrente/pós-promoção | 70% |
| Piso incremental dos módulos | 75% |
| Meta incremental dos módulos | 80% |
| Piso de capacidade e excedentes | 75% |

Classificação dos módulos:

- saudável: 80% ou mais;
- aceitável: 75% a 79,99%;
- atenção: 70% a 74,99%;
- bloqueado: abaixo de 70%, salvo promoção temporária consolidada autorizável.

## Expansão

Cada política de excedente registra item, driver, franquia, tamanho do bloco, preço, origem, fonte, vigência e versão.

```text
unidades excedentes = max(driver - franquia, 0)
blocos = ceil(unidades excedentes / unidades por bloco)
receita adicional = blocos × preço por bloco
margem incremental = (receita adicional - custo incremental) / receita adicional
```

Drivers:

- Agenda e Comunicação: sessões agendadas;
- Financeiro e Gestão: lançamentos;
- Convênios e TISS: guias;
- Gestão Escolar: pacientes com vínculo escolar;
- Armazenamento: GB estimados em uso.

Políticas não aprovadas ficam explicitamente desabilitadas/indisponíveis. Nenhum número é inventado.
