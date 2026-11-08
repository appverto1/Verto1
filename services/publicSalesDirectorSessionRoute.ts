import type { Express, RequestHandler } from 'express';

// The public Checkout return is not proof of email ownership or chosen login
// method. Keep the legacy route fail-closed; use the verified email activation.
export interface PublicSalesDirectorSessionRouteDeps {
  supabase: Pick<import('@supabase/supabase-js').SupabaseClient, 'from' | 'auth'>;
  publicSalesPostPaymentLimiter: RequestHandler;
  sanitizeString: (value: unknown, maxLength?: number) => string;
  sanitizeEmail: (value: unknown) => string | null;
  isUuid: (value: string | null | undefined) => boolean;
  resolveSalesPostPaymentContextToken: (
    token: unknown, checkoutSessionId: string,
  ) => Promise<{ offerId: string; leadId: string } | null>;
  hashSalesOfferToken: (token: string) => string;
  deriveSalesActivationToken: (checkoutSessionId: string) => string;
  verifySalesDirectorContractAccess: (params: {
    offerId: string; userId: string; organizationId: string; stripeSubscriptionId: string;
  }) => Promise<unknown>;
}

export function registerPublicSalesDirectorSessionRoute(
  app: Express, deps: PublicSalesDirectorSessionRouteDeps,
): void {
  app.post(
    "/api/public/sales-offers/:token/director-session",
    deps.publicSalesPostPaymentLimiter,
    (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      return res.status(410).json({
        success: false,
        error: "SALES_DIRECTOR_EMAIL_ACTIVATION_REQUIRED",
        message: "Conclua seu primeiro acesso pelo link enviado ao e-mail contratual após o pagamento.",
      });
    },
  );
}
