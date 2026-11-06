import crypto from 'crypto';
import express, { type Express } from 'express';
import type Stripe from 'stripe';
import type { Resend } from 'resend';

interface LegacySalesActivationStripeWebhookDeps {
  getStripe: () => Stripe;
  getResend: () => Resend;
  supabase: { from: (table: string) => any };
  sanitizeString: (value: unknown, max?: number) => string;
  sanitizeEmail: (value: unknown) => string | null;
  maskEmail: (value: unknown) => string;
  OFFICIAL_FROM_NOREPLY: string;
  buildPostPaymentActivationEmail: (token: string) => string;
  isSalesAssistedStripeEvent: (stripe: Stripe, event: Stripe.Event) => Promise<boolean>;
  reserveStripeWebhookEvent: (event: Stripe.Event) => Promise<boolean>;
  processSalesAssistedStripeEvent: (stripe: Stripe, event: Stripe.Event) => Promise<{
    handled: boolean;
    result?: Record<string, any>;
  }>;
  markStripeWebhookEventStatus: (event: Stripe.Event, status: 'processed' | 'failed', error?: string | null) => Promise<void>;
}

export function registerLegacySalesActivationStripeWebhookRoute(
  app: Express,
  deps: LegacySalesActivationStripeWebhookDeps,
): void {
  const {
    getStripe, getResend, supabase, sanitizeString, sanitizeEmail, maskEmail,
    OFFICIAL_FROM_NOREPLY, buildPostPaymentActivationEmail,
    isSalesAssistedStripeEvent, reserveStripeWebhookEvent,
    processSalesAssistedStripeEvent, markStripeWebhookEventStatus,
  } = deps;

  // Stripe Payment Link activation webhook - MUST BE BEFORE express.json()
  app.post(
    "/api/webhook/stripe",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      const sig = req.headers["stripe-signature"];
      let event: Stripe.Event;

      try {
        const stripe = getStripe();
        if (!process.env.STRIPE_WEBHOOK_SECRET) {
          throw new Error("STRIPE_WEBHOOK_SECRET is required");
        }
        event = stripe.webhooks.constructEvent(
          req.body,
          sig as string,
          process.env.STRIPE_WEBHOOK_SECRET,
        );
      } catch (err: any) {
        console.error(
          "[Stripe Activation Webhook] Signature verification failed:",
          err?.message || String(err),
        );
        return res
          .status(400)
          .send(`Webhook Error: ${err?.message || String(err)}`);
      }

      try {
        const stripe = getStripe();
        const salesAssisted = await isSalesAssistedStripeEvent(stripe, event);
        if (event.type !== "checkout.session.completed" && !salesAssisted) {
          return res.json({ received: true, ignored: true });
        }
        if (!(await reserveStripeWebhookEvent(event))) {
          return res.json({ received: true, duplicate: true });
        }

        if (salesAssisted) {
          const processed = await processSalesAssistedStripeEvent(stripe, event);
          await markStripeWebhookEventStatus(event, "processed");
          return res.json({
            success: true,
            received: true,
            ...(processed.result || {}),
          });
        }

        const session = event.data.object as Stripe.Checkout.Session;

        const customerEmail = sanitizeEmail(
          session.customer_details?.email || session.customer_email,
        );
        if (!customerEmail) {
          console.error(
            "[Stripe Activation Webhook] checkout.session.completed sem e-mail de cliente.",
            {
              sessionId: sanitizeString(session.id, 200),
            },
          );
          return res
            .status(400)
            .json({
              success: false,
              error: "E-mail do cliente não encontrado na sessão.",
            });
        }

        const token = crypto.randomUUID();
        const { error } = await supabase
          .from("pending_activations")
          .insert([{ email: customerEmail, token, used: false }]);
        if (error) throw error;

        try {
          const resend = getResend();
          const from =
            sanitizeString(process.env.RESEND_FROM_EMAIL || "", 320) ||
            OFFICIAL_FROM_NOREPLY;
          const emailResult = await resend.emails.send({
            from,
            to: customerEmail,
            subject: "Bem-vindo à Verto: crie sua conta",
            html: buildPostPaymentActivationEmail(token),
          });
          if (emailResult.error) {
            throw new Error(
              String(
                emailResult.error.message || JSON.stringify(emailResult.error),
              ),
            );
          }
        } catch (emailError: any) {
          console.error(
            "[Stripe Activation Webhook] Falha ao enviar e-mail de ativação via Resend:",
            {
              email: maskEmail(customerEmail),
              message: emailError?.message || String(emailError),
            },
          );
        }

        await markStripeWebhookEventStatus(event, "processed");
        return res.json({ success: true, received: true });
      } catch (webhookError: any) {
        await markStripeWebhookEventStatus(
          event,
          "failed",
          sanitizeString(webhookError?.code || webhookError?.message, 120),
        );
        console.error(
          "[Stripe Activation Webhook] Erro ao processar ativação:",
          {
            message: webhookError?.message || String(webhookError),
          },
        );
        return res
          .status(500)
          .json({ success: false, error: "Erro ao processar webhook." });
      }
    },
  );

}
