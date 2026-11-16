/**
 * Coordinates a deliberate email/password login with the Supabase auth callback
 * in the *same browser tab*. This is never proof of identity or authorization:
 * /api/auth/login remains the only authority for a portal and clinic context.
 *
 * The Supabase user can have both email and Google identities. Its persistent
 * app_metadata.provider is not the method used for the current SIGNED_IN event.
 */
let passwordSignInPending = false;
let passwordSignInAccessToken: string | null = null;

export function beginExplicitPasswordSignIn(): void {
  passwordSignInPending = true;
  passwordSignInAccessToken = null;
}

export function rememberExplicitPasswordSession(accessToken: unknown): void {
  if (!passwordSignInPending || typeof accessToken !== 'string' || !accessToken.trim()) return;
  // Memory-only marker. Never send it to logs, storage, or another tab.
  passwordSignInAccessToken = accessToken;
}

export function finishExplicitPasswordSignIn(sessionWasIssued: boolean): void {
  passwordSignInPending = false;
  if (!sessionWasIssued) passwordSignInAccessToken = null;
}

export function isExplicitPasswordSignInInProgress(): boolean {
  return passwordSignInPending;
}

export function isExplicitPasswordSignInEvent(accessToken: unknown): boolean {
  if (passwordSignInPending) return true;
  return typeof accessToken === 'string' && Boolean(
    passwordSignInAccessToken && accessToken === passwordSignInAccessToken
  );
}
