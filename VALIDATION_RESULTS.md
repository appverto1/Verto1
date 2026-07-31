# Resultados das validações

## Aprovado

- Transpilação sintática dos oito arquivos alterados.
- `clinicInvitationDelivery.test.ts`
- `invitedProfessionalOnboarding.test.ts`
- `clinicMembershipAuthority.test.ts`
- `clinicalSpecialtiesFrontend.test.ts`
- `clinicalSpecialtyTherapeuticPlans.test.ts`
- `billing.test.ts`
- `salesModularStripeAssisted.test.ts`
- `ownerMfaEnforcement.test.ts`
- `salesCheckoutProvisioning.test.ts`
- `security.regression.test.mjs`
- `scripts/check-docker-runtime-imports.mjs` — 65 arquivos cobertos.
- `git diff --no-index --check` nos arquivos alterados.

## Bloqueado pelo ambiente

### `npm ci`

Exit code 1.

O registry interno retornou HTTP 404 para:

`yallist-3.1.1.tgz`

Também houve aviso de engine: o projeto declara Node 20.x e o ambiente disponibiliza Node 22.16.0.

### `npm run build`

Exit code 127: `vite: not found`, consequência da instalação interrompida.

### `npm test`

Exit code 1: o runner tentou iniciar `tsx`, indisponível após a instalação interrompida.

### `npm run typecheck` e `npm run lint`

Exit code 2: `vite/client` não encontrado, consequência da ausência de `node_modules`.

## Escopo não executado

- deploy;
- commit/push;
- Railway;
- SQL;
- Supabase real;
- Stripe real;
- Resend real;
- teste E2E em navegador.
