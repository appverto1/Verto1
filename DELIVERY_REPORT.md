# Relatório de entrega — especialidades, PTS e convites Resend

Data: 30/07/2026
Base: `Verto(25).zip`

## Escopo preservado

A implementação já existente de especialidades clínicas, planos da especialidade, Projeto Terapêutico Singular (PTS), autoridade por membership, acesso histórico e snapshots não foi reescrita nem revertida. Nenhuma migration, RLS, dado clínico, Stripe, Checkout, Subscription Schedule ou Railway foi alterado.

## Causa confirmada dos convites

O convite era persistido antes do envio do e-mail. Quando o Resend falhava, o backend ainda devolvia `success: true` junto de `invitationEmailSent: false`. As telas verificavam somente `success` e exibiam confirmação, embora o provedor não tivesse aceitado o e-mail.

Além disso, a rota de convite fixava `Verto <naoresponda@appverto.com.br>` e não respeitava `RESEND_FROM_EMAIL`. Isso podia provocar rejeição quando o domínio ou subdomínio verificado no Resend era diferente do remetente fixo.

## Correções implementadas

1. O convite continua persistido como pendente antes do envio, preservando recuperação e reenvio.
2. Se o Resend não aceitar o e-mail, a API devolve HTTP 502 com:
   - `success: false`;
   - `code: CLINIC_INVITATION_EMAIL_SEND_FAILED`;
   - `invitationPersisted: true`;
   - `invitationEmailSent: false`;
   - erro operacional seguro, sem API key ou stack.
3. A rota de convite usa `RESEND_FROM_EMAIL`, mantendo o remetente oficial somente como fallback.
4. Chamadas HTTP diretas ao Resend enviam `User-Agent`, além de `Authorization` e `Content-Type`.
5. O envio retorna e registra:
   - ID da mensagem aceito pelo Resend;
   - modo `template`, `html` ou `html_fallback`;
   - ID/alias do template;
   - uso de fallback;
   - código de falha operacional.
6. Quando o template remoto é rejeitado, o HTML local personalizado é tentado como contingência. A interface informa que o fallback foi usado.
7. O template profissional recebe `nome` e `link_ativacao`. O HTML local também inclui papel e clínica com escape de HTML.
8. `TeamManagement` e `InvitationModal` não aceitam mais `success: true` quando `invitationEmailSent === false`, protegendo inclusive contra resposta de backend antigo durante uma atualização gradual.
9. Em falha parcial, a gestão recarrega os convites pendentes para permitir reenvio.
10. O erro de log da rota foi corrigido de `/api/tasks/:patientId` para `/api/clinic/invite`.
11. Foi adicionado `npm run check:resend`, que consulta sem enviar mensagens:
    - domínio do remetente e capacidade de envio;
    - existência e publicação do template profissional;
    - variáveis obrigatórias `nome` e `link_ativacao`.

## Arquivos de projeto alterados

- `.env.example`
- `package.json`
- `server.ts`
- `scripts/check-resend-configuration.mjs`
- `src/components/InvitationModal.tsx`
- `src/components/TeamManagement.tsx`
- `src/services/dataService.ts`
- `tests/clinicInvitationDelivery.test.ts`

Os hashes before/after estão em `MANIFEST.json`, e o diff integral está em `CHANGES.diff`.

## Verificação real do Resend

O ZIP não contém `RESEND_API_KEY`, `RESEND_FROM_EMAIL` ou a configuração real do template, corretamente. Por isso, nenhuma chamada autenticada ou envio real foi executado deste ambiente.

O comando `npm run check:resend` foi validado no estado sem credenciais: encerrou com exit code 2 e informou somente as variáveis ausentes, sem tentar enviar e-mail e sem expor segredo.

Para verificar domínio e template no ambiente real, a API key usada pelo diagnóstico precisa poder consultar domínios e templates. Uma chave restrita apenas a envio pode enviar convites normalmente, mas não consegue executar essas consultas administrativas.
