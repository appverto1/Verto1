# Validação manual

## Cenário principal — profissional muda de clínica

1. Use um profissional com conta Auth confirmada.
2. Desvincule-o da clínica antiga.
3. Confirme que a conta continua existindo em Authentication > Users.
4. Envie um convite novo pela clínica atual.
5. Confira no Resend que o link começa por:
   `https://appverto.com.br/?auth_action=activate`
6. Confirme que o link inclui um `invitation_id` novo e `invite_mode=existing`.
7. Abra o link.
8. Confirme que não ocorre HTTP 404.
9. Entre com a senha atual ou com a mesma conta Google.
10. Confirme que:
    - o UUID Auth não mudou;
    - a membership da nova clínica ficou ativa;
    - a clínica atual da sessão é a clínica que enviou o convite;
    - não foi criada uma segunda conta;
    - não aparece fluxo de nova senha;
    - não aparece plano ou pagamento.

## Idempotência

1. Reabra o mesmo convite depois de ele ter sido aceito.
2. Enquanto a membership estiver ativa, confirme que não há duplicação.
3. Desvincule novamente o profissional.
4. Abra o link antigo.
5. Confirme erro amigável informando que o convite já foi utilizado.
6. Envie um convite novo e confirme que somente o novo link reativa o vínculo.

## Usuário novo

1. Convide um e-mail nunca cadastrado.
2. Confirme `invite_mode=new`.
3. Conclua a ativação e definição de senha.
4. Confirme que o onboarding de profissional convidado permanece sem checkout.

## Google

1. Use uma conta já cadastrada com Google.
2. Abra o convite novo.
3. Entre com a mesma conta Google.
4. Confirme que o `invitation_id` é preservado durante o redirecionamento.
5. Confirme o vínculo com a clínica convidante.

## Logs esperados

Os logs podem registrar convite, membership e workspace, mas a interface deve continuar sem detalhes técnicos de Resend ou Supabase.
