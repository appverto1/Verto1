# Roteiro manual de validação

## 1. Substituição

Copie somente os oito arquivos de projeto do ZIP, preservando a estrutura de pastas.

## 2. Configuração no Railway

Confirme as variáveis sem colar valores em logs ou commits:

```text
RESEND_API_KEY
RESEND_FROM_EMAIL
RESEND_TEMPLATE_WELCOME_PROFESSIONAL_ID
```

`RESEND_FROM_EMAIL` deve usar exatamente o domínio ou subdomínio verificado no Resend, por exemplo:

```text
Verto <naoresponda@subdominio-verificado.appverto.com.br>
```

O template indicado deve estar publicado e declarar exatamente:

```text
nome
link_ativacao
```

## 3. Diagnóstico sem envio

No worktree completo e com uma API key que permita consultar domínios e templates:

```powershell
npm run check:resend
```

Resultado esperado:

- exit code 0;
- `ok: true`;
- domínio `verified`;
- capacidade de envio `enabled`;
- template `published`;
- variáveis `nome` e `link_ativacao`.

Se a chave for restrita apenas a envio, o diagnóstico administrativo pode falhar embora os e-mails sejam aceitos. Nesse caso, execute o diagnóstico com uma chave temporária de acesso completo e depois remova-a.

## 4. Validação do convite

1. Entre como coordenador.
2. Convide um profissional com uma das especialidades canônicas.
3. Verifique a resposta na interface.
4. Confirme que o convite aparece em “Convites pendentes”.
5. No Resend, confirme o registro pelo ID da mensagem gravado no log de atividade.
6. Confirme `deliveryMode`:
   - `template`: template personalizado aceito;
   - `html_fallback`: template rejeitado, HTML local enviado;
   - `html`: nenhum template configurado.
7. Abra o e-mail e confira nome e link de ativação.

## 5. Teste de falha controlada

Em ambiente de homologação, configure temporariamente um remetente não verificado ou template inválido.

Resultado esperado:

- convite permanece pendente;
- interface não mostra sucesso falso;
- API retorna HTTP 502 e `CLINIC_INVITATION_EMAIL_SEND_FAILED`;
- botão “Reenviar” permanece utilizável;
- nenhum segredo ou stack aparece na resposta.

## 6. Entrega versus caixa de entrada

A aceitação da API do Resend não garante a aba principal da caixa de entrada. Verifique também o evento final no Resend e, no destinatário, spam, promoções, quarentena corporativa e filtros pessoais.
