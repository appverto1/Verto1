export type PasswordRecoveryUrlState = {
  recoveryToken: string;
  sanitizedRelativeUrl: string;
  hadRecoveryToken: boolean;
};

const MAX_RECOVERY_TOKEN_LENGTH = 4096;

export const extractPasswordRecoveryUrlState = (href: string): PasswordRecoveryUrlState => {
  try {
    const url = new URL(String(href || ''));
    const originalHash = url.hash;
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    const rawToken = String(
      hashParams.get('recovery_token') || url.searchParams.get('recovery_token') || '',
    ).trim();
    const hadHashRecoveryToken = hashParams.has('recovery_token');
    const hadRecoveryToken =
      hadHashRecoveryToken || url.searchParams.has('recovery_token');
    hashParams.delete('recovery_token');
    url.searchParams.delete('recovery_token');
    url.hash = hadHashRecoveryToken
      ? (hashParams.toString() ? `#${hashParams.toString()}` : '')
      : originalHash;

    return {
      recoveryToken: rawToken.length <= MAX_RECOVERY_TOKEN_LENGTH ? rawToken : '',
      sanitizedRelativeUrl: `${url.pathname}${url.search}${url.hash}`,
      hadRecoveryToken,
    };
  } catch {
    return {
      recoveryToken: '',
      sanitizedRelativeUrl: '/',
      hadRecoveryToken: false,
    };
  }
};
