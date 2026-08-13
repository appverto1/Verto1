export type StripeEnvironment = 'test' | 'live';

export class StripeEnvironmentConfigurationError extends Error {
  code = 'STRIPE_ENVIRONMENT_CONFIGURATION_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'StripeEnvironmentConfigurationError';
  }
}

export function resolveStripeEnvironment(
  rawEnvironment = process.env.STRIPE_ENVIRONMENT,
): StripeEnvironment {
  const value = String(rawEnvironment || '').trim().toLowerCase();
  if (value === 'test' || value === 'live') return value;
  throw new StripeEnvironmentConfigurationError(
    'STRIPE_ENVIRONMENT deve ser explicitamente test ou live.',
  );
}

export function validateStripeSecretForEnvironment(
  environment: StripeEnvironment,
  rawSecret = process.env.STRIPE_SECRET_KEY,
): string {
  const secret = String(rawSecret || '').trim();
  const expectedPrefixes = environment === 'live'
    ? ['sk_live_', 'rk_live_']
    : ['sk_test_', 'rk_test_'];
  const oppositePrefixes = environment === 'live'
    ? ['sk_test_', 'rk_test_']
    : ['sk_live_', 'rk_live_'];

  if (!secret || oppositePrefixes.some((prefix) => secret.startsWith(prefix))) {
    throw new StripeEnvironmentConfigurationError(
      `A credencial Stripe não corresponde ao ambiente ${environment}.`,
    );
  }
  if (!expectedPrefixes.some((prefix) => secret.startsWith(prefix))) {
    throw new StripeEnvironmentConfigurationError(
      `A credencial Stripe do ambiente ${environment} deve usar uma chave secreta ou restrita compatível.`,
    );
  }
  return secret;
}

export function resolveValidatedStripeEnvironment(
  env: Pick<NodeJS.ProcessEnv, 'STRIPE_ENVIRONMENT' | 'STRIPE_SECRET_KEY'> = process.env,
) {
  const environment = resolveStripeEnvironment(env.STRIPE_ENVIRONMENT);
  const secret = validateStripeSecretForEnvironment(
    environment,
    env.STRIPE_SECRET_KEY,
  );
  return { environment, secret } as const;
}
