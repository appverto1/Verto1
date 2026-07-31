# Resultados das validações

## Aprovado

- Transpilação sintática dos cinco arquivos alterados.
- `clinicReinviteAccess.test.ts`
- `clinicInvitationDelivery.test.ts`
- `invitedProfessionalOnboarding.test.ts`
- `clinicMembershipAuthority.test.ts`
- `security.regression.test.mjs`
- `ownerMfaEnforcement.test.ts`
- `billing.test.ts`
- Verificação de imports do runtime Docker — 65 arquivos.
- Verificação de whitespace nos cinco arquivos.

Resultado dos testes focados: **7 aprovados, 0 falhas**.

## Suíte auxiliar

Foram iniciados 28 arquivos de teste:

- 26 passaram;
- 2 não iniciaram por módulos ausentes:
  - `@supabase/supabase-js`;
  - `react`.

Esses dois casos não chegaram às asserções e decorrem da instalação incompleta do ambiente.

## Build oficial

Não foi possível aprovar `npm run build`. O `npm ci` anterior foi interrompido porque o registry interno retornou HTTP 404 para `yallist-3.1.1.tgz`; consequentemente, `vite` não está instalado no ambiente.

## Não executado

- deploy;
- commit ou push;
- SQL ou migration;
- Railway;
- Supabase real;
- Resend real;
- teste E2E em navegador.
