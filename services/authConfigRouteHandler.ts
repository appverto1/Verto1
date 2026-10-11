import type { RequestHandler } from 'express';

type Deps = {
  getAuthRedirectUrl: () => string;
  getRecoveryRedirectUrl: () => string;
  sanitizeString: (value: any, maxLength?: number) => string;
};

export function createAuthConfigHandler(deps: Deps): RequestHandler {
  const { getAuthRedirectUrl, getRecoveryRedirectUrl, sanitizeString } = deps;
  return (_req, res) => {
    try {
      res.json({
        success: true,
        authRedirectUrl: getAuthRedirectUrl(),
        recoveryRedirectUrl: getRecoveryRedirectUrl(),
        productionBaseUrl: sanitizeString(process.env.VERTO_APP_BASE_URL || process.env.APP_BASE_URL || '', 500)
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Configuração de Auth indisponível.' });
    }
  };
}
