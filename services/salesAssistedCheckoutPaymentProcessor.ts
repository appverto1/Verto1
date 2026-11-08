import type Stripe from 'stripe';
import crypto from 'crypto';
// Item 09: Stripe paid; original audited statements retained unchanged.
export const createSalesAssistedCheckoutPaymentProcessor = (deps: Record<string, any>) => {
  const { buildSalesModuleSetHash, isUuid, persistActivityLog, preparePaidDirectorSessionBootstrap, prepareSalesActivationAccess, provisionPaidSalesDirectorAccount, resolveStripeEnvironment, sanitizeEmail, sanitizeString, supabase, syncSalesSubscriptionDiscount, validateStripeSecretForEnvironment } = deps;
  // ITEM09_SOURCE_BEGIN
  const processSalesAssistedCheckoutCompleted = async (
    stripe: Stripe,
    session: Stripe.Checkout.Session,
    _options: { sendActivationEmail?: boolean } = {},
  ) => {
    const metadata = (session.metadata || {}) as Record<string, string>;
    if (sanitizeString(metadata.flowType, 80) === "sales_modular_assisted") {
      const stripeEnvironment = resolveStripeEnvironment();
      validateStripeSecretForEnvironment(stripeEnvironment);
      if (sanitizeString(metadata.environment, 20) !== stripeEnvironment) {
        throw new Error("MODULAR_CHECKOUT_ENVIRONMENT_MISMATCH");
      }
    }
    const offerId = sanitizeString(metadata.offerId, 120);
    const leadId = sanitizeString(metadata.leadId, 120);
    if (!isUuid(offerId) || !isUuid(leadId)) {
      throw new Error("SALES_CHECKOUT_METADATA_INVALID");
    }

    const stripeObservedCustomerEmail = sanitizeEmail(
      session.customer_details?.email || session.customer_email,
    );

    const subscriptionId = sanitizeString(
      String(session.subscription || ""),
      200,
    );
    const customerId = sanitizeString(String(session.customer || ""), 200);
    const paymentStatus = sanitizeString(
      session.payment_status,
      40,
    ).toLowerCase();
    const now = new Date().toISOString();

    const [
      { data: offer, error: offerError },
      { data: lead, error: leadError },
    ] = await Promise.all([
      supabase
        .from("sales_offers")
        .select("id,lead_id,status,revoked_at,expires_at,offer_type,contract_email")
        .eq("id", offerId)
        .eq("lead_id", leadId)
        .maybeSingle(),
      supabase
        .from("sales_leads")
        .select("id,name,email,normalized_email,clinic_name,deleted_at")
        .eq("id", leadId)
        .is("deleted_at", null)
        .maybeSingle(),
    ]);
    if (offerError || !offer) {
      throw offerError || new Error("SALES_OFFER_NOT_FOUND");
    }
    if (leadError || !lead) {
      throw leadError || new Error("SALES_LEAD_NOT_FOUND");
    }
    const isModularSalesFlow = sanitizeString(metadata.flowType, 80) === "sales_modular_assisted";
    let paymentIdentityEmail = stripeObservedCustomerEmail;
    if (isModularSalesFlow) {
      const { data: frozenModuleItems, error: frozenModuleError } = await supabase
        .from("sales_offer_items")
        .select("item_key")
        .eq("offer_id", offerId);
      if (frozenModuleError) throw frozenModuleError;
      const expectedModuleSetHash = buildSalesModuleSetHash(
        offerId,
        sanitizeString(metadata.requestHash, 64),
        (frozenModuleItems || []).map((item: any) => sanitizeString(item?.item_key, 80)),
      );
      if (sanitizeString(metadata.moduleSetHash, 64) !== expectedModuleSetHash) {
        throw new Error("MODULAR_CHECKOUT_RECONCILIATION_FAILED");
      }
      const frozenContractEmail = sanitizeEmail((offer as any).contract_email);
      const expectedContractEmailHash = frozenContractEmail
        ? crypto.createHash("sha256").update(frozenContractEmail).digest("hex")
        : "";
      if (
        !frozenContractEmail
        || sanitizeString(metadata.contractEmailHash, 64) !== expectedContractEmailHash
      ) {
        throw new Error("MODULAR_CHECKOUT_RECONCILIATION_FAILED");
      }
      // The contracting identity was frozen by Verto before Checkout and is
      // independently bound to this Stripe Session through contractEmailHash.
      // customer_details.email is a billing/payer contact and may differ (for
      // example when Stripe Link is used). It must never replace the Director
      // identity or force a legitimate modular payment into manual review.
      paymentIdentityEmail = frozenContractEmail;
    }
    if (!paymentIdentityEmail) throw new Error("SALES_CHECKOUT_EMAIL_MISSING");
    let subscription: Stripe.Subscription | null = null;
    // A zero-value invoice (including a trial Checkout) can be marked "paid"
    // by Stripe without collecting money. Only a positive, settled Checkout
    // may provision a paid Director; boleto remains pending until settlement.
    const paidAmountCents = Number(session.amount_total);
    const paymentConfirmed =
      paymentStatus === "paid" &&
      Number.isSafeInteger(paidAmountCents) &&
      paidAmountCents > 0;

    if (!paymentConfirmed) {
      const pendingResults = await Promise.all([
        supabase
          .from("sales_offers")
          .update({
            status: "payment_pending",
            stripe_customer_id: customerId || null,
            stripe_checkout_session_id: session.id,
            stripe_subscription_id: subscriptionId || null,
            updated_at: now,
          })
          .eq("id", offerId)
          .eq("lead_id", leadId)
          .neq("status", "paid"),
        supabase
          .from("sales_leads")
          .update({ status: "payment_pending", updated_at: now })
          .eq("id", leadId)
          .is("deleted_at", null)
          // Old unpaid webhook must not demote an already converted clinic.
          .neq("status", "converted"),
        supabase.from("sales_lead_events").upsert(
          [
            {
              lead_id: leadId,
              event_type: "checkout_opened",
              metadata: {
                offer_id: offerId,
                checkout_session_id: session.id,
                payment_status: paymentStatus || "unknown",
              },
              idempotency_key: `checkout-payment-pending:${session.id}`,
            },
          ],
          { onConflict: "idempotency_key", ignoreDuplicates: true },
        ),
      ]);
      const pendingError = pendingResults.find(
        (result: any) => result?.error,
      )?.error;
      if (pendingError) throw pendingError;
      if (subscription) {
        try {
          await syncSalesSubscriptionDiscount(subscription);
        } catch (discountError: any) {
          console.warn("[Sales Checkout] Checkout pendente preservado; sincronizacao de desconto adiada.", {
            offerId,
            leadId,
            message: sanitizeString(discountError?.message || String(discountError), 200),
          });
        }
      }
      return { paymentConfirmed: false, activationPrepared: false };
    }

    const { data: paymentConfirmation, error: paymentConfirmationError } =
      await supabase.rpc("confirm_sales_assisted_checkout_payment", {
        p_offer_id: offerId,
        p_lead_id: leadId,
        p_checkout_session_id: session.id,
        p_customer_email: paymentIdentityEmail,
        p_stripe_customer_id: customerId || null,
        p_stripe_subscription_id: subscriptionId || null,
        p_payment_status: paymentStatus || "paid",
        p_idempotency_key: `payment-completed:${session.id}`,
      });
    if (paymentConfirmationError) throw paymentConfirmationError;

    if (!subscription && subscriptionId) {
      try {
        subscription = await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ["discounts", "items.data.price"],
        } as any);
      } catch (subscriptionError: any) {
        console.warn("[Sales Checkout] Pagamento persistido; leitura da assinatura sera retomada por webhook/retry.", {
          offerId,
          leadId,
          message: sanitizeString(subscriptionError?.message || String(subscriptionError), 200),
        });
      }
    }

    const paymentState =
      paymentConfirmation && typeof paymentConfirmation === "object"
        ? (paymentConfirmation as Record<string, any>)
        : {};
    const emailState = sanitizeString(paymentState.email_state, 40);
    const reviewRequired = paymentState.review_required === true;

    if (emailState === "mismatch" || reviewRequired) {
      console.error("[Sales Checkout] Pagamento confirmado exige revisao de identidade.", {
        leadId,
        offerId,
        checkoutSessionId: sanitizeString(session.id, 200),
        reason: emailState === "mismatch" ? "checkout_email_mismatch" : "offer_state_review",
      });
      const ownerId = sanitizeString(process.env.SALES_OWNER_USER_ID, 120);
      if (isUuid(ownerId)) {
        await persistActivityLog({
          userId: ownerId,
          title: "Pagamento comercial requer revisao",
          content: "O pagamento foi confirmado, mas a identidade comercial precisa de revisao antes da ativacao.",
          type: "sales",
          action: "sales_checkout_identity_review_required",
          payload: { leadId, offerId, checkoutSessionId: session.id },
        });
      }
      if (subscription) {
        try {
          await syncSalesSubscriptionDiscount(subscription);
        } catch (discountError: any) {
          console.warn("[Sales Checkout] Pagamento em revisao preservado; sincronizacao de desconto pendente.", {
            offerId,
            leadId,
            message: sanitizeString(discountError?.message || String(discountError), 200),
          });
        }
      }
      return {
        paymentConfirmed: true,
        activationPrepared: false,
        reviewRequired: true,
      };
    }

    if (emailState === "collision") {
      console.warn("[Sales Checkout] E-mail do Checkout pertence a outro lead; ativacao preservada sem merge.", {
        leadId,
        offerId,
        checkoutSessionId: sanitizeString(session.id, 200),
      });
    }

    const directorEmail =
      sanitizeString((offer as any).offer_type, 30) === "modular"
        ? sanitizeEmail((offer as any).contract_email)
        : paymentIdentityEmail;
    if (!directorEmail) {
      throw new Error("SALES_DIRECTOR_EMAIL_MISSING");
    }

    let directorProvisioning: { userId: string; clinicId: string };
    try {
      directorProvisioning = await provisionPaidSalesDirectorAccount({
        email: directorEmail,
        offerId,
        leadId,
        checkoutSessionId: session.id,
        leadName: lead.name,
        clinicName: lead.clinic_name,
      });
    } catch (provisioningError: any) {
      const provisioningCode = sanitizeString(
        provisioningError?.code || provisioningError?.message,
        120,
      );
      if ([
        "SALES_DIRECTOR_EXISTING_ACCOUNT_REVIEW_REQUIRED",
        "SALES_ACTIVATION_PROFILE_SCOPE_MISMATCH",
      ].includes(provisioningCode)) {
        await supabase
          .from("sales_offers")
          .update({
            provisioning_status: "review_required",
            provisioning_error_code: provisioningCode,
            provisioning_updated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", offerId)
          .eq("lead_id", leadId)
          .eq("status", "paid");
        return {
          paymentConfirmed: true,
          accountActivated: false,
          directorSessionReady: false,
          reviewRequired: true,
        };
      }
      throw provisioningError;
    }

    const bootstrap = await preparePaidDirectorSessionBootstrap({
      offerId,
      leadId,
      checkoutSessionId: session.id,
      email: directorEmail,
    });

    // Both card and boleto use the same verified email-first activation.
    // The Checkout return URL never authorizes a Director session.
    const activationEmail = await prepareSalesActivationAccess({
          offerId,
          leadId,
          checkoutSessionId: session.id,
          email: directorEmail,
          clinicLabel:
            sanitizeString(lead.clinic_name || lead.name, 180) || null,
          attemptEmail: true,
          // For delayed payment methods (for example boleto), the Director and
          // contracted modules are already provisioned before this message is sent.
          // The e-mail is only a durable first-access path, so it must never move
          // provisioning_status backwards from the completed state.
          preserveProvisioningStatus: true,
        });

    if (subscription) {
      try {
        await syncSalesSubscriptionDiscount(subscription);
      } catch (discountError: any) {
        console.warn("[Sales Checkout] Pagamento e acesso do Diretor preservados; sincronizacao de desconto pendente.", {
          offerId,
          leadId,
          message: sanitizeString(discountError?.message || String(discountError), 200),
        });
      }
    }

    return {
      paymentConfirmed: true,
      accountActivated: true,
      directorSessionReady: bootstrap.bootstrapReady,
      sessionClaimed: bootstrap.sessionClaimed,
      directorUserId: directorProvisioning.userId,
      directorClinicId: directorProvisioning.clinicId,
      activationPrepared: Boolean(activationEmail?.activationReady),
      activationEmailSent: Boolean(activationEmail?.activationEmailSent),
      activationPath: activationEmail?.activationPath || null,
      emailErrorCode: activationEmail?.emailErrorCode || null,
    };
  };

  // ITEM09_SOURCE_END
  return { processSalesAssistedCheckoutCompleted };
};
