# Entrega — novo convite com reutilização do mesmo acesso

## Problema observado

O convite gerava uma URL como:

`https://appverto.com.br/ativar?role=coordinator&email=...`

No domínio publicado, o acesso direto a `/ativar` retornou HTTP 404 antes de a aplicação React ser carregada.

Além disso, contas Auth já confirmadas ainda passavam por uma tentativa de link `signup`. Quando o usuário já existia, o Supabase rejeitava a criação de uma nova conta e o sistema caía no link genérico de ativação. O login também só aceitava automaticamente um convite quando o usuário não possuía nenhum workspace, o que não atendia a mudança de uma clínica para outra.

## Correções

### 1. Link compatível com a hospedagem pública

Novos convites usam a raiz da SPA:

`/?auth_action=activate&role=coordinator&email=...&invitation_id=...&invite_mode=...`

Assim, o servidor público precisa entregar apenas `/`, evitando depender de rewrite para `/ativar`.

Links antigos em `/ativar` continuam reconhecidos pelo frontend, mas mensagens já enviadas com a URL quebrada não são alteradas retroativamente.

### 2. Reutilização da conta existente

Quando o e-mail já pertence a uma conta Auth confirmada:

- não é criada uma segunda conta;
- não é solicitado cadastro de nova senha;
- o e-mail leva a uma tela de entrada com a senha atual ou Google;
- o mesmo UUID Auth é preservado;
- o convite exato é enviado ao backend durante o login.

Para usuário novo ou ainda não confirmado, o fluxo existente de ativação e definição de senha continua disponível.

### 3. Vínculo com a nova clínica

O backend valida:

- UUID do convite;
- e-mail autenticado;
- status do convite;
- papel permitido;
- clínica registrada no convite.

Depois:

- faz upsert idempotente da membership na clínica que enviou o novo convite;
- marca o convite como aceito;
- atualiza o contexto atual do usuário;
- prioriza a clínica convidante como workspace da sessão;
- preserva a mesma identidade Auth.

Outras memberships legítimas não são removidas de forma indiscriminada. A desvinculação continua inativando somente a membership da clínica correspondente.

### 4. Proteção contra reativação por link antigo

Um convite já aceito só pode ser reutilizado idempotentemente enquanto a membership correspondente permanece ativa.

Se o profissional foi desvinculado e abrir um link antigo já utilizado, o backend retorna erro controlado:

`CLINIC_INVITATION_ALREADY_USED`

Dessa forma, um link antigo não consegue restaurar uma membership inativada. A nova clínica deve emitir um convite novo, que cria um novo `invitation_id`.

## Arquivos alterados

- `server.ts`
- `src/App.tsx`
- `src/components/ActivationAccess.tsx`
- `src/lib/supabase.ts`
- `tests/clinicReinviteAccess.test.ts` — novo

## Contrato do novo link

Exemplo conceitual:

```text
https://appverto.com.br/
  ?auth_action=activate
  &role=coordinator
  &email=profissional%40exemplo.com
  &invitation_id=<uuid-do-novo-convite>
  &invite_mode=existing
```

Para contas novas, `invite_mode=new`.

## Banco e migrations

Nenhuma migration ou alteração de schema foi criada.

## Observação importante

O e-mail que já foi enviado com `/ativar?...` continuará levando ao 404. Depois de aplicar e publicar esta correção, é necessário reenviar um convite novo. O novo envio terá outro UUID de convite e a URL pela raiz da aplicação.
