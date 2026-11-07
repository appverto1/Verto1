import express, { type Express } from 'express';
import type Stripe from 'stripe';

type BillingStatus = 'active' | 'pending' | 'delinquent' | 'canceled';
type BillingIdentity = {
  clinicId?: string | null;
  userId?: string | null;
  email?: string | null;
};
type SubscriptionReference = BillingIdentity & {
  subscriptionId?: string | null;
  subscriptionItemId?: string | null;
  customerId?: string | null;
  priceId?: string | null;
  activePatientCount?: number | null;
  activePatientLimit?: number | null;
  billingSyncStatus?: string | null;
  billingSyncError?: string | null;
  status?: string | null;
};

export interface StripeCanonicalWebhookDeps {
  getStripe: () => Stripe;
  reserveStripeWebhookEvent: (event: Stripe.Event) => Promise<boolean>;
  processSalesAssistedStripeEvent: (
    stripe: Stripe, event: Stripe.Event,
  ) => Promise<{ handled: boolean; result?: Record<string, any> }>;
  markStripeWebhookEventStatus: (
    event: Stripe.Event, state: 'processed' | 'failed', errorCode?: string | null,
  ) => Promise<void>;
  sanitizeString: (value: unknown, maxLength?: number) => string;
  sanitizeEmail: (value: unknown) => string | null;
  maskEmail: (value: unknown) => string;
  checkoutSessionUsesActivePatientPrice: (stripe: Stripe, session: Stripe.Checkout.Session) => Promise<boolean>;
  ACTIVE_PATIENT_BILLING_MODEL: string;
  updateClinicSubscriptionStatus: (params: BillingIdentity & { status: BillingStatus }) => Promise<unknown>;
  resolveActivePatientPriceId: () => string;
  queueActivePatientSync: (clinicId: string | null | undefined, reason: string) => Promise<unknown>;
  persistStripeCustomerReference: (params: BillingIdentity & { customerId: string }) => Promise<unknown>;
  persistStripeSubscriptionReference: (params: SubscriptionReference) => Promise<unknown>;
  supabase: {
    from: (table: string) => any;
    auth: { admin: { getUserById: (id: string) => Promise<any> } };
  };
  generateSupabaseActionLink: (params: {
    type: 'signup' | 'recovery'; email: string; redirectTo: string;
  }) => Promise<string | null>;
  getActivationRedirectUrl: (role?: unknown, email?: unknown) => string;
  buildActivationEmailTemplate: (params: any) => { subject: string; html: string };
  sendTransactionalEmailSafe: (params: any) => Promise<boolean>;
  OFFICIAL_FROM_CONTACT: string;
  OFFICIAL_TRANSACTIONAL_REPLY_TO: string;
  trackProfessionalSignupCheckoutCancellation: (params: {
    userId?: string | null;
    email?: string | null;
    planName?: string | null;
    checkoutSessionId?: string | null;
    source?: string | null;
  }) => Promise<unknown>;
  isUuid: (value: string | null | undefined) => boolean;
  markClinicPaymentFailed: (params: BillingIdentity & { invoiceId?: string | null }) => Promise<unknown>;
  clearClinicPaymentFailure: (params: BillingIdentity) => Promise<unknown>;
  normalizeSubscriptionStatusFromStripe: (status: string) => BillingStatus;
  syncSalesSubscriptionDiscount: (subscription: Stripe.Subscription) => Promise<unknown>;
  syncStripeBillingPlanSnapshots: (reason?: string) => Promise<unknown>;
}

export function registerStripeCanonicalWebhookRoute(
  app: Express,
  deps: StripeCanonicalWebhookDeps,
): void {
  const {
    getStripe, reserveStripeWebhookEvent, processSalesAssistedStripeEvent,
    markStripeWebhookEventStatus, sanitizeString, sanitizeEmail, maskEmail,
    checkoutSessionUsesActivePatientPrice, ACTIVE_PATIENT_BILLING_MODEL,
    updateClinicSubscriptionStatus, resolveActivePatientPriceId,
    queueActivePatientSync, persistStripeCustomerReference,
    persistStripeSubscriptionReference, supabase, generateSupabaseActionLink,
    getActivationRedirectUrl, buildActivationEmailTemplate,
    sendTransactionalEmailSafe, OFFICIAL_FROM_CONTACT,
    OFFICIAL_TRANSACTIONAL_REPLY_TO, trackProfessionalSignupCheckoutCancellation,
    isUuid, markClinicPaymentFailed, clearClinicPaymentFailure,
    normalizeSubscriptionStatusFromStripe, syncSalesSubscriptionDiscount,
    syncStripeBillingPlanSnapshots,
  } = deps;

  // Stripe Webhook - MUST BE BEFORE express.json()
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      const sig = req.headers["stripe-signature"];
      let event;

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
        console.error("Webhook signature verification failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      try {
        const stripe = getStripe();
        if (!(await reserveStripeWebhookEvent(event))) {
          return res.json({ received: true, duplicate: true });
        }
        const salesAssisted = await processSalesAssistedStripeEvent(
          stripe,
          event,
        );
        if (salesAssisted.handled) {
          await markStripeWebhookEventStatus(event, "processed");
          return res.json({
            received: true,
            success: true,
            ...(salesAssisted.result || {}),
          });
        }
        switch (event.type) {
          case "checkout.session.completed": {
            const session = event.data.object as Stripe.Checkout.Session;
            const userId = sanitizeString(
              (session.metadata as any)?.userId,
              120,
            );
            const clinicId = sanitizeString(
              (session.metadata as any)?.clinicId,
              120,
            );
            const flowType = sanitizeString(
              (session.metadata as any)?.flowType,
              80,
            );
            const customerEmail = sanitizeEmail(
              session.customer_details?.email || session.customer_email,
            );
            const stripeCustomerId = sanitizeString(
              String(session.customer || ""),
              200,
            );

            if (!flowType && !userId) {
              const usesActivePatientPrice =
                await checkoutSessionUsesActivePatientPrice(stripe, session);
              console.warn(
                "[Stripe Webhook] Checkout sem metadata de clinica/usuario nao provisiona acesso automaticamente.",
                {
                  sessionId: sanitizeString(session.id, 200),
                  email: customerEmail ? maskEmail(customerEmail) : null,
                  billingModel: usesActivePatientPrice
                    ? ACTIVE_PATIENT_BILLING_MODEL
                    : "unknown_or_legacy",
                },
              );
              break;
            }

            await updateClinicSubscriptionStatus({
              clinicId,
              userId,
              email: customerEmail,
              status: "active",
            });

            const activePatientPriceId = resolveActivePatientPriceId();
            if (clinicId && activePatientPriceId) {
              queueActivePatientSync(clinicId, "checkout.session.completed");
            }

            if (stripeCustomerId) {
              await persistStripeCustomerReference({
                customerId: stripeCustomerId,
                email: customerEmail,
                userId,
                clinicId,
              });
            }

            if (session.subscription) {
              try {
                const subscriptionId = sanitizeString(
                  String(session.subscription),
                  120,
                );
                if (subscriptionId) {
                  const subscription = await stripe.subscriptions.update(
                    subscriptionId,
                    {
                      metadata: {
                        ...(userId ? { userId } : {}),
                        ...(clinicId ? { clinicId } : {}),
                        billingModel: ACTIVE_PATIENT_BILLING_MODEL,
                      },
                      expand: ["items.data.price"],
                    } as any,
                  );
                  const activePatientPriceId = resolveActivePatientPriceId();
                  const subscriptionItem = activePatientPriceId
                    ? subscription.items.data.find(
                        (item) =>
                          sanitizeString((item.price as any)?.id, 120) ===
                          activePatientPriceId,
                      )
                    : subscription.items.data[0];
                  const subscriptionItemPriceId =
                    sanitizeString((subscriptionItem?.price as any)?.id, 120) ||
                    activePatientPriceId;
                  await persistStripeSubscriptionReference({
                    subscriptionId,
                    subscriptionItemId: sanitizeString(
                      subscriptionItem?.id,
                      120,
                    ),
                    customerId: stripeCustomerId,
                    priceId: subscriptionItemPriceId,
                    activePatientLimit:
                      Number((subscriptionItem as any)?.quantity || 0) || null,
                    email: customerEmail,
                    userId,
                    clinicId,
                    status: subscription.status,
                  });
                  if (
                    clinicId &&
                    subscriptionItemPriceId &&
                    !activePatientPriceId
                  ) {
                    queueActivePatientSync(
                      clinicId,
                      "checkout.session.completed",
                    );
                  }
                }
              } catch (metadataError: any) {
                console.error(
                  "[Stripe Webhook] Falha ao atualizar metadata da subscription:",
                  {
                    message: metadataError?.message || String(metadataError),
                  },
                );
              }
            }

            // Fluxo de onboarding profissional: ativação só após pagamento confirmado.
            if (
              flowType === "professional_signup" &&
              (userId || customerEmail)
            ) {
              try {
                let effectiveUserId = userId;
                let effectiveEmail = customerEmail;
                let profile: any = null;

                if (effectiveUserId) {
                  const { data: profileByUser } = await supabase
                    .from("users")
                    .select("id, email, name, role")
                    .eq("id", effectiveUserId)
                    .maybeSingle();
                  profile = profileByUser || null;
                }

                if (!profile && effectiveEmail) {
                  const { data: profileByEmail } = await supabase
                    .from("users")
                    .select("id, email, name, role")
                    .eq("email", effectiveEmail)
                    .maybeSingle();
                  profile = profileByEmail || null;
                }

                if (profile?.id) {
                  effectiveUserId = sanitizeString(profile.id, 120);
                  effectiveEmail =
                    sanitizeEmail(profile.email) || effectiveEmail;
                  await supabase
                    .from("users")
                    .update({
                      subscription_status: "active",
                      billing_model: ACTIVE_PATIENT_BILLING_MODEL,
                      updated_at: new Date().toISOString(),
                    })
                    .eq("id", effectiveUserId);
                }

                if (effectiveUserId) {
                  const { data: authData, error: authError } =
                    await supabase.auth.admin.getUserById(effectiveUserId);
                  if (!authError) {
                    const authUser = authData?.user;
                    const isEmailConfirmed = Boolean(
                      (authUser as any)?.email_confirmed_at ||
                      (authUser as any)?.confirmed_at,
                    );
                    const authEmail = sanitizeEmail(authUser?.email);
                    const targetEmail = authEmail || effectiveEmail;

                    if (!isEmailConfirmed && targetEmail) {
                      const activationLink =
                        (await generateSupabaseActionLink({
                          type: "signup",
                          email: targetEmail,
                          redirectTo: getActivationRedirectUrl(
                            "coordinator",
                            targetEmail,
                          ),
                        })) ||
                        getActivationRedirectUrl("coordinator", targetEmail);

                      const activationEmail = buildActivationEmailTemplate({
                        nome: sanitizeString(
                          profile?.name ||
                            authUser?.user_metadata?.full_name ||
                            targetEmail.split("@")[0],
                          180,
                        ),
                        link_ativacao: activationLink,
                        perfil: "professional",
                      });

                      await sendTransactionalEmailSafe({
                        to: targetEmail,
                        subject: activationEmail.subject,
                        html: activationEmail.html,
                        context: "professional_signup_after_payment",
                        from: OFFICIAL_FROM_CONTACT,
                        replyTo: OFFICIAL_TRANSACTIONAL_REPLY_TO,
                        templateKind: "welcome_professional",
                        templateData: {
                          nome: sanitizeString(
                            profile?.name ||
                              authUser?.user_metadata?.full_name ||
                              targetEmail.split("@")[0],
                            180,
                          ),
                          link_ativacao: activationLink,
                        },
                        metadata: {
                          userId: effectiveUserId,
                          email: maskEmail(targetEmail),
                        },
                      });
                    }
                  }
                }
              } catch (postPaymentEmailError: any) {
                console.error(
                  "[Stripe Webhook] Falha ao enviar ativação pós-pagamento:",
                  {
                    message:
                      postPaymentEmailError?.message ||
                      String(postPaymentEmailError),
                  },
                );
              }
            }
            break;
          }
          case "checkout.session.expired": {
            const session = event.data.object as Stripe.Checkout.Session;
            const flowType = sanitizeString(
              (session.metadata as any)?.flowType,
              80,
            );
            if (flowType === "professional_signup") {
              await trackProfessionalSignupCheckoutCancellation({
                userId:
                  sanitizeString((session.metadata as any)?.userId, 120) ||
                  null,
                email:
                  sanitizeEmail(
                    session.customer_details?.email || session.customer_email,
                  ) || null,
                planName:
                  sanitizeString((session.metadata as any)?.planName, 80) ||
                  null,
                checkoutSessionId: sanitizeString(session.id, 200) || null,
                source: "stripe_checkout_session_expired",
              });
            }
            if (flowType === "sales_assisted_signup") {
              const offerId = sanitizeString(
                (session.metadata as any)?.offerId,
                120,
              );
              const leadId = sanitizeString(
                (session.metadata as any)?.leadId,
                120,
              );
              if (isUuid(offerId) && isUuid(leadId)) {
                await Promise.all([
                  supabase
                    .from("sales_offers")
                    .update({
                      status: "expired",
                      updated_at: new Date().toISOString(),
                    })
                    .eq("id", offerId)
                    .eq("lead_id", leadId),
                  supabase.from("sales_lead_events").insert([
                    {
                      lead_id: leadId,
                      event_type: "checkout_expired",
                      metadata: {
                        offer_id: offerId,
                        checkout_session_id: session.id,
                      },
                      idempotency_key: `checkout-expired:${session.id}`,
                    },
                  ]),
                ]);
              }
            }
            break;
          }
          case "invoice.payment_failed": {
            const invoice = event.data.object as Stripe.Invoice;
            const subscriptionId = sanitizeString(
              String((invoice as any).subscription || ""),
              120,
            );
            const customerEmail = sanitizeEmail(invoice.customer_email);
            let clinicId = "";
            let userId = "";
            if (subscriptionId) {
              const subscription =
                await stripe.subscriptions.retrieve(subscriptionId);
              clinicId = sanitizeString(
                (subscription.metadata as any)?.clinicId,
                120,
              );
              userId = sanitizeString(
                (subscription.metadata as any)?.userId,
                120,
              );
            }
            await updateClinicSubscriptionStatus({
              clinicId,
              userId,
              email: customerEmail,
              status: "delinquent",
            });
            await markClinicPaymentFailed({
              clinicId,
              userId,
              email: customerEmail,
              invoiceId: sanitizeString(invoice.id, 200),
            });
            break;
          }
          case "invoice.upcoming": {
            const invoice = event.data.object as Stripe.Invoice;
            const subscriptionId = sanitizeString(
              String((invoice as any).subscription || ""),
              120,
            );
            if (subscriptionId) {
              const nextBillingTimestamp = Number(
                (invoice as any).next_payment_attempt || 0,
              );
              await supabase
                .from("sales_subscription_discounts")
                .update({
                  estimated_next_invoice_amount_cents: Number(
                    (invoice as any).amount_due || 0,
                  ),
                  next_billing_at:
                    nextBillingTimestamp > 0
                      ? new Date(nextBillingTimestamp * 1000).toISOString()
                      : null,
                  updated_at: new Date().toISOString(),
                })
                .eq("stripe_subscription_id", subscriptionId);
            }
            break;
          }
          case "invoice.created":
          case "invoice.finalized": {
            const invoice = event.data.object as Stripe.Invoice;
            const subscriptionId = sanitizeString(
              String((invoice as any).subscription || ""),
              120,
            );
            const customerEmail = sanitizeEmail(invoice.customer_email);
            let clinicId = "";
            let userId = "";
            if (subscriptionId) {
              const subscription =
                await stripe.subscriptions.retrieve(subscriptionId);
              clinicId = sanitizeString(
                (subscription.metadata as any)?.clinicId,
                120,
              );
              userId = sanitizeString(
                (subscription.metadata as any)?.userId,
                120,
              );
            }
            console.log("[Stripe Webhook] Fatura criada.", {
              invoiceId: sanitizeString(invoice.id, 200),
              subscriptionId,
              clinicId,
              userId,
              email: customerEmail ? maskEmail(customerEmail) : null,
              amountDue: Number((invoice as any).amount_due || 0),
              currency: sanitizeString((invoice as any).currency, 20),
            });
            if (clinicId || userId || customerEmail) {
              await persistStripeSubscriptionReference({
                subscriptionId,
                customerId: sanitizeString(
                  String((invoice as any).customer || ""),
                  200,
                ),
                email: customerEmail,
                userId,
                clinicId,
                status: "pending",
              });
            }
            break;
          }
          case "invoice.paid":
          case "invoice.payment_succeeded": {
            const invoice = event.data.object as Stripe.Invoice;
            const subscriptionId = sanitizeString(
              String((invoice as any).subscription || ""),
              120,
            );
            const customerEmail = sanitizeEmail(invoice.customer_email);
            let clinicId = "";
            let userId = "";
            if (subscriptionId) {
              const subscription = await stripe.subscriptions.retrieve(
                subscriptionId,
                { expand: ["items.data.price"] },
              );
              clinicId = sanitizeString(
                (subscription.metadata as any)?.clinicId,
                120,
              );
              userId = sanitizeString(
                (subscription.metadata as any)?.userId,
                120,
              );
              const activePatientPriceId = resolveActivePatientPriceId();
              const subscriptionItem = activePatientPriceId
                ? subscription.items.data.find(
                    (item) =>
                      sanitizeString((item.price as any)?.id, 120) ===
                      activePatientPriceId,
                  )
                : subscription.items.data[0];
              const subscriptionItemPriceId =
                sanitizeString((subscriptionItem?.price as any)?.id, 120) ||
                activePatientPriceId;
              await persistStripeSubscriptionReference({
                subscriptionId,
                subscriptionItemId: sanitizeString(subscriptionItem?.id, 120),
                customerId: sanitizeString(
                  String(
                    (invoice as any).customer || subscription.customer || "",
                  ),
                  200,
                ),
                priceId: subscriptionItemPriceId,
                activePatientLimit:
                  Number((subscriptionItem as any)?.quantity || 0) || null,
                email: customerEmail,
                userId,
                clinicId,
                status: subscription.status,
              });
            }
            await updateClinicSubscriptionStatus({
              clinicId,
              userId,
              email: customerEmail,
              status: "active",
            });
            await clearClinicPaymentFailure({
              clinicId,
              userId,
              email: customerEmail,
            });
            break;
          }
          case "customer.subscription.created":
          case "customer.subscription.updated":
          case "customer.subscription.deleted": {
            const subscription = event.data.object as Stripe.Subscription;
            const clinicId = sanitizeString(
              (subscription.metadata as any)?.clinicId,
              120,
            );
            const userId = sanitizeString(
              (subscription.metadata as any)?.userId,
              120,
            );
            const mappedStatus = normalizeSubscriptionStatusFromStripe(
              subscription.status,
            );
            const activePatientPriceId = resolveActivePatientPriceId();
            const subscriptionItem = activePatientPriceId
              ? subscription.items.data.find(
                  (item) =>
                    sanitizeString((item.price as any)?.id, 120) ===
                    activePatientPriceId,
                )
              : subscription.items.data[0];
            const subscriptionItemPriceId =
              sanitizeString((subscriptionItem?.price as any)?.id, 120) ||
              activePatientPriceId;
            await persistStripeSubscriptionReference({
              subscriptionId: subscription.id,
              subscriptionItemId: sanitizeString(subscriptionItem?.id, 120),
              customerId: sanitizeString(
                String(subscription.customer || ""),
                200,
              ),
              priceId: subscriptionItemPriceId,
              activePatientLimit:
                Number((subscriptionItem as any)?.quantity || 0) || null,
              userId,
              clinicId,
              status: subscription.status,
            });
            await updateClinicSubscriptionStatus({
              clinicId,
              userId,
              status: mappedStatus,
            });
            await syncSalesSubscriptionDiscount(subscription);
            break;
          }
          case "product.created":
          case "product.updated":
          case "product.deleted":
          case "price.created":
          case "price.updated":
          case "price.deleted": {
            await syncStripeBillingPlanSnapshots(`webhook:${event.type}`);
            break;
          }
          default:
            break;
        }
        await markStripeWebhookEventStatus(event, "processed");
      } catch (webhookProcessingError: any) {
        await markStripeWebhookEventStatus(
          event,
          "failed",
          sanitizeString(
            webhookProcessingError?.code || webhookProcessingError?.message,
            120,
          ),
        );
        console.error("[Stripe Webhook] Erro ao processar evento:", {
          type: event?.type,
          message:
            webhookProcessingError?.message || String(webhookProcessingError),
        });
        return res.status(500).json({
          received: false,
          error: "STRIPE_WEBHOOK_PROCESSING_FAILED",
        });
      }

      return res.json({ received: true });
    },
  );

}
