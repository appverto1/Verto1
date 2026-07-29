# Roteiro manual — owner com MFA

Executar somente depois das migrations manuais e do pós-migration descritos no
manifesto, em ambiente local ou de teste e sem Stripe real.

## Pré-condições

- autenticar uma conta com papel `owner`;
- concluir a verificação MFA;
- usar catálogo e premissas de teste válidos;
- manter Checkout modular em modo mock/test;
- confirmar que não há dados clínicos reais no cenário comercial.

## Cenário estratégico

1. Abrir o construtor modular.
2. Informar 150 pacientes atuais e 150 esperados.
3. Selecionar a proposta personalizada.
4. Editar o preço por paciente e confirmar o total derivado.
5. Editar pelo total e confirmar o preço unitário derivado.
6. Selecionar módulos individualmente.
7. Remover e adicionar um módulo, verificando o recálculo imediato.
8. Aplicar gratuidade de seis meses à Gestão Escolar e Institucional.
9. Confirmar que o preço posterior permanece visível.
10. Salvar como rascunho sem aprovação.
11. Atualizar a página, reabrir o cenário e conferir persistência.
12. Confirmar todos os alertas comerciais, valores e margens.
13. Tentar gerar a proposta pública sem aprovação.
14. Confirmar o bloqueio com mensagem humana e sem código técnico legado.
15. Selecionar o tipo `Cliente-vitrine estratégico`.
16. Informar justificativa com pelo menos 20 caracteres.
17. Marcar a confirmação explícita.
18. Aprovar e salvar uma nova versão do cenário.
19. Gerar a proposta pública.
20. Confirmar que custos, margens, aprovação e justificativa não aparecem.
21. Inspecionar a resposta pública e confirmar a ausência de:
    `commercialExceptionApproval`, `commercialReview`, `justification`,
    custos e margens.
22. Conferir internamente que o snapshot congelou códigos, valores, usuário,
    data, versão de política e hash.

## Revalidação da aprovação

1. Duplicar o cenário aprovado.
2. Alterar preço, capacidade, drivers ou composição.
3. Confirmar que a aprovação anterior não é reutilizada.
4. Confirmar novo hash e nova necessidade de confirmação.
5. Salvar a cópia como rascunho sem alterar a política do catálogo.

## Bloqueios técnicos

Repetir o fluxo removendo, um por vez:

- preço por paciente;
- custo ou driver obrigatório;
- premissa que torne o denominador inválido;
- dependência de módulo;
- capacidade válida.

Confirmar que nenhum desses casos aceita exceção comercial.

## Permissões

- usuário que não seja owner: aprovação recusada;
- owner sem MFA: aprovação recusada;
- owner com justificativa curta: aprovação recusada;
- owner sem confirmação explícita: aprovação recusada.

## Schema pendente

Em banco descartável sem a coluna `profitability_policy`, chamar o endpoint
comercial e confirmar:

- HTTP 503;
- código `SALES_PROFITABILITY_POLICY_MIGRATION_PENDING`;
- mensagem de que a estrutura comercial precisa ser aplicada;
- ausência de stack, nome de tabela interno ou SQL na resposta.

Depois de aplicar a migration, testar um catálogo histórico com política `null`
e confirmar que ele é lido como histórico sem ativação silenciosa de política.

## Responsividade e acessibilidade

Validar o construtor em:

- desktop: 1440 px;
- tablet: 768 px;
- celular: 390 px.

Em cada largura, confirmar:

- ausência de overflow horizontal;
- textos completos;
- hierarquia clara dos alertas;
- campos e ação principal acessíveis por teclado;
- foco visível;
- checkbox com rótulo associado;
- áreas de toque confortáveis;
- mensagens de salvamento, erro e bloqueio;
- ausência de “EBITDA” no fluxo comercial.

## Preservação

Confirmar que:

- proposta histórica não mudou;
- política global não mudou;
- Checkout legado continua funcional;
- Checkout modular usa somente snapshot congelado;
- nenhuma assinatura ou pagamento real foi criado.

