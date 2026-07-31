# Entrega — onboarding de profissionais convidados

## Resultado

Foram corrigidos os três problemas solicitados no fluxo de convite, ativação e primeiro acesso de profissionais:

1. A confirmação de convite agora é genérica e aparece no próprio botão.
2. A clínica e a especialidade do profissional convidado são resolvidas pelo backend e exibidas como vínculo existente.
3. Profissionais convidados não entram no fluxo de plano, trial, Stripe, checkout ou pagamento.

Nenhum deploy, SQL, alteração no Railway, commit, push ou migration foi executado.

## Causas-raiz

### 1. Detalhes técnicos na confirmação

A interface reutilizava a mensagem devolvida pelo backend. Como essa mensagem descrevia template, fallback e Resend, informações internas eram apresentadas ao cliente.

Correção:

- o botão passa a mostrar somente `Convite enviado com sucesso.`;
- sucesso exige `success === true` e `invitationEmailSent !== false`;
- falha parcial usa mensagem amigável;
- dados do provedor continuam somente nos logs e na auditoria;
- a resposta pública de sucesso não inclui o objeto técnico de entrega.

### 2. Profissional tratado como criador da clínica

O onboarding reutilizava o mesmo formulário para proprietário e membro convidado. Nome, telefone, especialidade e identidade da clínica podiam vir do estado local ou do corpo enviado pelo navegador.

Correção:

- criação do contexto centralizado no backend;
- `clinic_id`, papel e especialidade vêm de `clinic_memberships` e do convite;
- os dados da clínica são consultados no servidor;
- o contexto é reconstruído no login, `/api/auth/me` e troca de workspace;
- o profissional vê a clínica e a especialidade em modo somente leitura;
- campos de clínica enviados por membros são ignorados;
- somente o onboarding de proprietário pode atualizar ou provisionar uma clínica;
- clínica ausente para um membro gera erro controlado, sem criar uma substituta.

### 3. Profissional enviado ao plano e pagamento

A decisão de cobrança dependia principalmente do papel e do status de assinatura presente no usuário, sem um modo explícito que diferenciasse proprietário de membro.

Correção:

- a sessão recebe `onboardingContext`;
- membros convidados recebem `requiresPayment: false`;
- o frontend nunca renderiza o checkout para esses modos;
- o backend bloqueia diretamente `/api/billing/checkout` com `CLINIC_MEMBER_CHECKOUT_FORBIDDEN`;
- o bloqueio ocorre antes da inicialização do Stripe;
- o onboarding do proprietário e a contratação comercial existente foram preservados;
- se a clínica ainda não tiver liberação financeira, o membro vê somente um estado de acesso administrado pela clínica, nunca um checkout próprio.

## Novo critério de roteamento

O backend resolve um dos seguintes modos:

- `invited_professional`: membership ativa com origem em convite;
- `clinic_member`: membership ativa de membro que não é proprietário;
- `clinic_owner`: proprietário ou coordenador no fluxo de criação/ativação da própria clínica;
- `standard`: perfil fora desse fluxo;
- `invalid`: vínculo inconsistente ou clínica ausente para um membro.

O frontend usa esse contexto apenas depois de recebê-lo do servidor.

## Contratos alterados

### `GET /api/onboarding/context`

Retorna o contexto autoritativo:

```json
{
  "success": true,
  "data": {
    "onboardingMode": "invited_professional",
    "requiresPayment": false,
    "canAccessDashboard": true,
    "canEditClinic": false,
    "clinic": {
      "id": "uuid",
      "name": "Clínica",
      "phone": null,
      "whatsapp": null,
      "logoUrl": null
    },
    "membership": {
      "role": "therapist",
      "specialty": "Fonoaudiólogo"
    }
  }
}
```

### Sessão e autenticação

`POST /api/auth/login`, `GET /api/auth/me`, aceite de convite e seleção de workspace passam a devolver a sessão hidratada com `onboardingContext`.

### `POST /api/profile/:userId/complete-onboarding`

Para `invited_professional` e `clinic_member`:

- aceita somente dados do próprio profissional e agenda;
- ignora identidade e dados editáveis da clínica enviados pelo navegador;
- usa clínica, papel e especialidade resolvidos pelo servidor;
- não altera assinatura, cobrança ou status financeiro da clínica;
- marca `first_login_completed` somente depois de persistir o perfil e as configurações;
- retorna `MEMBER_READY`.

### `POST /api/billing/checkout`

Membros convidados recebem HTTP 403 com:

```json
{
  "success": false,
  "code": "CLINIC_MEMBER_CHECKOUT_FORBIDDEN"
}
```

### `POST /api/clinic/invite`

Sucesso público:

```json
{
  "success": true,
  "invitationEmailSent": true,
  "message": "Convite enviado com sucesso."
}
```

Falha parcial:

```json
{
  "success": false,
  "invitationPersisted": true,
  "invitationEmailSent": false,
  "message": "O convite foi registrado, mas não foi possível enviar o e-mail. Tente reenviar."
}
```

## Onboarding do membro convidado

O fluxo possui:

1. dados pessoais e profissionais;
2. foto, assinatura, conselho, número e minicurrículo;
3. duração e disponibilidade semanal;
4. confirmação somente leitura da clínica, papel e especialidade;
5. conclusão e entrada no painel permitido pela membership.

Não há etapa de plano, cartão, trial, assinatura da plataforma ou pagamento.

## Banco e migrations

Nenhuma migration foi criada. O schema existente já oferece:

- `invitations`;
- `clinic_memberships`;
- `users`;
- `clinics`;
- `professional_profiles`;
- metadados para a agenda profissional.

## Arquivos alterados

- `server.ts`
- `src/App.tsx`
- `src/components/InvitationModal.tsx`
- `src/components/ProfessionalOnboarding.tsx`
- `src/components/TeamManagement.tsx`
- `src/services/dataService.ts`
- `tests/clinicInvitationDelivery.test.ts`
- `tests/invitedProfessionalOnboarding.test.ts` — novo

## Limitações da validação

Não foi possível concluir os comandos oficiais de instalação, build, typecheck, lint e suíte completa porque o registry interno retornou HTTP 404 para `yallist-3.1.1.tgz`. Sem a instalação, `vite`, `tsx` e `vite/client` não ficaram disponíveis localmente.

Foram executados com sucesso:

- transpilação sintática dos oito arquivos;
- dez testes focados/regressivos;
- regressão de segurança;
- verificação de imports do runtime Docker;
- verificação de whitespace.

Não houve teste real contra Supabase, Resend, Stripe ou navegador nesta sessão.
