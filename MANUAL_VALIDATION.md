# Validação manual recomendada

## Preparação

Use um ambiente de homologação e uma clínica já existente, com nome, telefone e assinatura administrada pelo responsável.

## Cenário A — novo profissional convidado

1. Entre como coordenador.
2. Convide um profissional e selecione uma especialidade.
3. Confirme que o botão muda para `Convite enviado com sucesso.`.
4. Confirme que nenhuma referência a Resend, template, fallback ou contingência aparece.
5. Abra o convite em uma conta nova.
6. Conclua autenticação/senha.
7. Confirme que:
   - nome da clínica já aparece preenchido;
   - telefone/WhatsApp é o já cadastrado;
   - papel e especialidade estão preenchidos;
   - clínica e especialidade não podem ser alteradas;
   - não aparece “Nome da clínica pendente”.
8. Preencha nome, telefone, CPF, conselho, minicurrículo, foto e assinatura.
9. Configure dias, horários e duração.
10. Conclua.
11. Confirme entrada direta no painel permitido.
12. Confirme que nenhuma tela de plano, Stripe, trial, cartão ou pagamento apareceu.

## Cenário B — convite para usuário já existente

1. Convide um e-mail Auth já existente, mas sem membership na clínica-alvo.
2. Entre com esse usuário.
3. Confirme criação idempotente de uma única membership.
4. Atualize a página e faça logout/login.
5. Confirme que o vínculo permanece e o checkout não aparece.
6. Reabra o link do convite e confirme que não há duplicação.

## Cenário C — clínica sem acesso financeiro ativo

1. Use um profissional convidado vinculado a uma clínica bloqueada.
2. Confirme que o profissional não vê planos ou checkout.
3. Confirme que aparece somente o estado de acesso administrado pela clínica.
4. Confirme que uma chamada direta a `/api/billing/checkout` retorna 403 e `CLINIC_MEMBER_CHECKOUT_FORBIDDEN`.

## Cenário D — proprietário de nova clínica

1. Use o fluxo de proprietário/coordenador responsável por nova clínica.
2. Confirme que ainda pode preencher os dados da clínica.
3. Confirme que o botão `Continuar para o plano` permanece.
4. Confirme que o checkout e a estratégia comercial continuam funcionando somente nesse fluxo.

## Cenário E — convite inválido ou clínica removida

1. Abra um convite inválido/expirado ou remova a clínica apenas em homologação.
2. Confirme mensagem amigável.
3. Confirme que não é possível digitar uma nova `clinic_id`, alterar papel ou criar clínica substituta.
4. Verifique os detalhes técnicos somente nos logs.

## Observabilidade

Nos logs internos, confirme a permanência de:

- modo de entrega do e-mail;
- ID do provedor;
- template/fallback;
- `onboardingMode`;
- `clinic_id`;
- bloqueios de checkout.

Esses dados não devem aparecer na interface do cliente.
