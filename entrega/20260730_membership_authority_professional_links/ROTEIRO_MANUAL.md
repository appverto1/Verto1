# Roteiro manual — memberships e vínculos profissionais

Executar somente em ambiente local ou de teste, sem dados clínicos reais,
depois das duas migrations manuais e antes do deploy.

## Pré-condições

- backup validado;
- sessão de coordinator com membership ativa;
- sessão owner/admin para o caso global;
- dois profissionais therapist na mesma clínica:
  - um com `users.clinic_id` nulo ou legado;
  - outro com membership inativa para o cenário negativo;
- `professional_profiles.specialty` preenchida no profissional elegível;
- um paciente da clínica de teste.

## Policies

1. Aplicar manualmente a migration `20260730010000`.
2. Confirmar que existem somente:
   - `clinic_memberships_select_v2`;
   - `clinic_memberships_insert_v2`;
   - `clinic_memberships_update_v2`;
   - `clinic_memberships_delete_v2`.
3. Confirmar que `clinic_memberships_access` não existe.
4. Com therapist, confirmar leitura da própria membership e negação de
   autoinscrição/elevação.
5. Com coordinator ativo, confirmar gestão somente da clínica de sua
   membership.
6. Com owner/admin, confirmar a gestão global prevista.

## RPCs e Equipe do caso

1. Aplicar manualmente a migration `20260730020000`.
2. Abrir o paciente e a seção “Equipe do caso”.
3. Confirmar uma carga de vínculos e cargas em lote de users, memberships e
   perfis; não deve existir fetch por profissional.
4. Selecionar o therapist com membership ativa e `users.clinic_id` nulo.
5. Confirmar que a especialidade vem do cadastro e é somente leitura.
6. Salvar o vínculo.
7. Atualizar a página, sair, entrar novamente e confirmar persistência.
8. Confirmar que o vínculo concede apenas as permissões explicitamente
   registradas.
9. Tentar selecionar coordinator ou membro sem especialidade e confirmar que
   não aparece como elegível.
10. Tentar chamar o POST com role, clinicId ou specialty adulterados e
    confirmar que o servidor ignora esses valores como autoridade.

## Vínculo inconsistente

Em dado de teste controlado:

1. deixar inativa a membership de um profissional já vinculado;
2. recarregar “Equipe do caso” como coordinator;
3. confirmar que o vínculo permanece visível;
4. confirmar o aviso de cadastro inconsistente;
5. confirmar que ele continua no contador de ativos;
6. confirmar que não concede leitura nem escrita clínica;
7. encerrar o vínculo;
8. atualizar a página e confirmar o status encerrado e o histórico preservado;
9. confirmar que não foi criada autorização histórica para o profissional
   inconsistente.

## Isolamento de tenant e IDOR

1. Tentar vincular profissional cuja membership ativa pertence somente a outra
   clínica.
2. Confirmar negação sem exposição de perfil ou especialidade.
3. Tentar encerrar vínculo de paciente de outra clínica.
4. Confirmar negação e ausência de alteração.
5. Confirmar que um owner/admin autorizado continua operando pelo fluxo global
   previsto.

## Concorrência e limites

1. Criar cinco vínculos ativos e confirmar o limite.
2. Tentar o sexto vínculo e confirmar a recusa.
3. Tentar duplicar profissional ativo e confirmar a recusa.
4. Trocar o principal e confirmar somente um principal ativo.
5. Repetir solicitações concorrentes de inclusão/encerramento em ambiente de
   teste e confirmar consistência dos locks.

## UI, acessibilidade e responsividade

Validar em desktop, tablet e celular:

- vínculo válido e inconsistente distinguíveis sem depender apenas de cor;
- texto completo, sem overflow;
- botão de encerrar disponível somente a gestor autorizado;
- confirmação e estados de carregamento/erro;
- navegação por teclado e foco visível;
- especialidade somente leitura;
- nenhuma informação de outro tenant.

## Regressão

Confirmar que:

- `patients.therapist_id` histórico permanece legível;
- vínculos encerrados continuam visíveis no histórico;
- prontuário respeita read/write;
- nenhuma tarefa, agenda, ABA, proposta, Stripe ou Checkout foi alterado;
- nenhuma query cresce linearmente com a quantidade de profissionais.
