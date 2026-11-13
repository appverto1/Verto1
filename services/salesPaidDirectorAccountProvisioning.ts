import type Stripe from 'stripe';
// Item 10: statements preserved exactly from paid-Director backend in staging.
export function createSalesPaidDirectorAccountProvisioning(deps: Record<string, any>) {
  const { ACTIVE_PATIENT_BILLING_MODEL, applyModularEntitlementsForOrganization, cleanObject, ensureClinicAndMembershipForCoordinator, extractMissingColumnName, fetchProfileWithSchemaFallback, findAuthUserByEmail, getStripe, insertUserProfileWithSchemaFallback, isMissingRelationError, isUuid, maskEmail, patchTableSafely, provisionModularCapacityBillingContract, sanitizeEmail, sanitizeString, stripeSubscriptionToEntitlementStatus, supabase, verifySalesDirectorContractAccess } = deps;
  // ITEM10_SOURCE_BEGIN
  async function provisionPaidSalesDirectorAccount(params: {
    email: string;
    offerId: string;
    leadId: string;
    checkoutSessionId: string;
    leadName?: string | null;
    clinicName?: string | null;
  }): Promise<{ userId: string; clinicId: string }> {
    const email = sanitizeEmail(params.email);
    const offerId = sanitizeString(params.offerId, 120);
    const leadId = sanitizeString(params.leadId, 120);
    const checkoutSessionId = sanitizeString(params.checkoutSessionId, 200);
    if (!email || !isUuid(offerId) || !isUuid(leadId) || !checkoutSessionId) {
      throw new Error("SALES_DIRECTOR_PROVISIONING_INPUT_INVALID");
    }

    let authUser = await findAuthUserByEmail(email);
    const ownerName = sanitizeString(params.leadName, 180) || email.split("@")[0];
    if (!authUser?.id) {
      const { data: createdUser, error: createError } =
        await supabase.auth.admin.createUser({
          email,
          email_confirm: true,
          // Server-owned marker for matching concurrent paid Checkout creates.
          // raw_user_meta_data is user-editable and MUST NOT authorize reuse.
          app_metadata: { sales_activation_offer_id: offerId },
          user_metadata: {
            full_name: ownerName,
            sales_activation_offer_id: offerId,
            sales_checkout_session_id: checkoutSessionId,
            sales_paid_director: true,
            first_login_completed: false,
          },
        });
      if (createError) {
        const normalized = sanitizeString(createError.message, 240).toLowerCase();
        const isKnownDuplicate = normalized.includes("already") || normalized.includes("duplicate")
          || sanitizeString((createError as any).code, 20) === "23505";
        // GoTrue can report an email UNIQUE violation as a generic HTTP 500
        // "Database error creating new user" instead of "already registered".
        // This message can also describe unrelated DB failures: only recover
        // after reading the exact persisted Auth identity. Never create a new
        // clinic from an unverified or unrelated user.
        const isAmbiguousAuthCreateError = normalized === "database error creating new user";
        if (!isKnownDuplicate && !isAmbiguousAuthCreateError) throw createError;
        authUser = await findAuthUserByEmail(email);
        if (!authUser?.id || sanitizeEmail(authUser.email) !== email) throw createError;
        if (isAmbiguousAuthCreateError
          && sanitizeString(authUser?.app_metadata?.sales_activation_offer_id, 120) !== offerId) {
          const conflict = new Error("SALES_DIRECTOR_EXISTING_ACCOUNT_REVIEW_REQUIRED");
          (conflict as any).code = "SALES_DIRECTOR_EXISTING_ACCOUNT_REVIEW_REQUIRED";
          throw conflict;
        }
      } else {
        authUser = createdUser?.user || null;
      }
    }
    if (!authUser?.id) throw new Error("SALES_AUTH_USER_NOT_CREATED");

    const existingProfile = await fetchProfileWithSchemaFallback({
      supabase,
      userId: authUser.id,
      logger: console,
    });
    if (existingProfile.error) throw existingProfile.error;
    const existingMetadataOfferId = sanitizeString(
      authUser?.user_metadata?.sales_activation_offer_id,
      120,
    );
    // Replayed Stripe events must not overwrite the server-owned onboarding
    // record. Existing profile fields are preserved below, without relying on
    // browser-editable user metadata.
    const { data: activeMembershipRows, error: activeMembershipError } = await supabase
      .from("clinic_memberships")
      .select("clinic_id,role,status")
      .eq("user_id", authUser.id)
      .eq("status", "active")
      .limit(20);
    if (activeMembershipError) throw activeMembershipError;
    const activeMemberships = Array.isArray(activeMembershipRows) ? activeMembershipRows : [];
    const membershipsCompatible = activeMemberships.every((membership: any) => {
      const membershipClinicId = sanitizeString(membership?.clinic_id, 120);
      const membershipRole = sanitizeString(membership?.role, 40).toLowerCase();
      return membershipClinicId === authUser.id
        && ["director", "coordinator"].includes(membershipRole);
    });
    if (!membershipsCompatible) {
      const conflict = new Error("SALES_DIRECTOR_EXISTING_ACCOUNT_REVIEW_REQUIRED");
      (conflict as any).code = "SALES_DIRECTOR_EXISTING_ACCOUNT_REVIEW_REQUIRED";
      throw conflict;
    }
    if (existingProfile.data) {
      const profile = existingProfile.data as any;
      const profileEmail = sanitizeEmail(profile.email);
      const profileClinicId = sanitizeString(profile.clinic_id, 120);
      const profileRole = sanitizeString(profile.role, 40).toLowerCase();
      const samePartialCommercialAccount =
        profileEmail === email
        && (!profileClinicId || profileClinicId === authUser.id)
        && ["director", "coordinator"].includes(profileRole)
        && (!existingMetadataOfferId || existingMetadataOfferId === offerId);
      if (!samePartialCommercialAccount) {
        const conflict = new Error("SALES_DIRECTOR_EXISTING_ACCOUNT_REVIEW_REQUIRED");
        (conflict as any).code = "SALES_DIRECTOR_EXISTING_ACCOUNT_REVIEW_REQUIRED";
        throw conflict;
      }
    } else if (existingMetadataOfferId && existingMetadataOfferId !== offerId) {
      const conflict = new Error("SALES_DIRECTOR_EXISTING_ACCOUNT_REVIEW_REQUIRED");
      (conflict as any).code = "SALES_DIRECTOR_EXISTING_ACCOUNT_REVIEW_REQUIRED";
      throw conflict;
    }

    const { data: updatedAuthUser, error: updateAuthError } =
      await supabase.auth.admin.updateUserById(authUser.id, {
        email_confirm: true,
        user_metadata: {
          ...(authUser.user_metadata || {}),
          full_name: ownerName,
          sales_activation_offer_id: offerId,
          sales_checkout_session_id: checkoutSessionId,
          sales_paid_director: true,
        },
      });
    if (updateAuthError) throw updateAuthError;
    authUser = updatedAuthUser?.user || authUser;

    const profileResult = await fetchProfileWithSchemaFallback({
      supabase,
      userId: authUser.id,
      logger: console,
    });
    if (profileResult.error) throw profileResult.error;
    if (profileResult.data) {
      const profile = profileResult.data as any;
      if (
        sanitizeEmail(profile.email) !== email
        || (sanitizeString(profile.clinic_id, 120) && sanitizeString(profile.clinic_id, 120) !== authUser.id)
      ) {
        const conflict = new Error("SALES_ACTIVATION_PROFILE_SCOPE_MISMATCH");
        (conflict as any).code = "SALES_ACTIVATION_PROFILE_SCOPE_MISMATCH";
        throw conflict;
      }
      // The clinical/cadastral Save operation is authoritative. On webhook
      // replays do not overwrite an existing name, billing state or onboarding
      // progress, even if a Save races with Stripe reconciliation.
      let updates: Record<string, any> = cleanObject({
        email,
        role: "director",
        clinic_id: authUser.id,
        updated_at: new Date().toISOString(),
      });
      while (Object.keys(updates).length > 0) {
        const updateResult = await supabase.from("users").update(updates).eq("id", authUser.id);
        if (!updateResult.error) break;
        const missingColumn = extractMissingColumnName(updateResult.error);
        if (missingColumn && missingColumn in updates && !["email", "name", "role", "clinic_id"].includes(missingColumn)) {
          delete updates[missingColumn];
          continue;
        }
        throw updateResult.error;
      }
    } else {
      const insertResult = await insertUserProfileWithSchemaFallback({
        id: authUser.id,
        email,
        name: ownerName,
        role: "director",
        clinic_id: authUser.id,
        subscription_status: "active",
        first_login_completed: false,
        created_at: new Date().toISOString(),
      });
      if (insertResult.error) throw insertResult.error;
    }

    await ensureClinicAndMembershipForCoordinator(authUser.id, "director");
    const clinicName = sanitizeString(params.clinicName, 180);
    if (clinicName && !existingProfile.data) {
      await patchTableSafely("clinics", { column: "id", value: authUser.id }, {
        name: clinicName,
        updated_at: new Date().toISOString(),
      });
    }

    const [clinicCheck, membershipCheck] = await Promise.all([
      supabase.from("clinics").select("id").eq("id", authUser.id).maybeSingle(),
      supabase
        .from("clinic_memberships")
        .select("user_id,clinic_id,role,status")
        .eq("user_id", authUser.id)
        .eq("clinic_id", authUser.id)
        .eq("status", "active")
        .maybeSingle(),
    ]);
    if (
      clinicCheck.error
      || !clinicCheck.data
      || membershipCheck.error
      || !membershipCheck.data
      || sanitizeString((membershipCheck.data as any).role, 40).toLowerCase() !== "director"
    ) {
      throw new Error("SALES_ACTIVATION_WORKSPACE_PROVISIONING_FAILED");
    }

    await finalizeSalesActivationForUser({
      email,
      userId: authUser.id,
      clinicId: authUser.id,
      offerId,
      leadId,
      checkoutSessionId,
      requireActivationRecord: false,
    });

    const { error: metadataError } = await supabase.auth.admin.updateUserById(authUser.id, {
      user_metadata: {
        ...(authUser.user_metadata || {}),
        full_name: ownerName,
        sales_activation_offer_id: offerId,
        sales_checkout_session_id: checkoutSessionId,
        sales_paid_director: true,
      },
    });
    if (metadataError) throw metadataError;

    return { userId: authUser.id, clinicId: authUser.id };
  }

  async function finalizeSalesActivationForUser(params: {
    email: string;
    userId: string;
    clinicId: string;
    offerId: string;
    leadId: string;
    checkoutSessionId: string;
    requireActivationRecord?: boolean;
  }) {
    const normalizedEmail = sanitizeEmail(params.email);
    const offerId = sanitizeString(params.offerId, 120);
    const leadId = sanitizeString(params.leadId, 120);
    const checkoutSessionId = sanitizeString(params.checkoutSessionId, 200);
    if (
      !normalizedEmail
      || !isUuid(params.userId)
      || !isUuid(params.clinicId)
      || !isUuid(offerId)
      || !isUuid(leadId)
      || !checkoutSessionId
    ) {
      return;
    }

    let modularContract = false;
    try {
      const requireActivationRecord = params.requireActivationRecord !== false;
      const activationLookup = requireActivationRecord
        ? supabase
            .from("pending_activations")
            .select("id,used,expires_at")
            .eq("email", normalizedEmail)
            .eq("source", "sales_assisted_signup")
            .eq("sales_offer_id", offerId)
            .eq("sales_lead_id", leadId)
            .eq("stripe_checkout_session_id", checkoutSessionId)
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const [leadResult, offerResult, activationResult] = await Promise.all([
        supabase
          .from("sales_leads")
          .select("id,normalized_email,deleted_at,converted_clinic_id")
          .eq("id", leadId)
          .is("deleted_at", null)
          .maybeSingle(),
        supabase
          .from("sales_offers")
          .select("id,lead_id,status,stripe_checkout_session_id,stripe_subscription_id,offer_type,modular_snapshot,simulation_snapshot")
          .eq("id", offerId)
          .eq("lead_id", leadId)
          .eq("status", "paid")
          .eq("stripe_checkout_session_id", checkoutSessionId)
          .maybeSingle(),
        activationLookup,
      ]);
      const readError = [leadResult, offerResult, activationResult].find(
        (result: any) => result?.error,
      )?.error;
      if (readError) throw readError;
      if (!leadResult.data || !offerResult.data || (requireActivationRecord && !activationResult.data))
        return;
      modularContract = sanitizeString(offerResult.data.offer_type, 30) === "modular";
      const activationExpired = activationResult.data?.expires_at
        ? new Date(activationResult.data.expires_at).getTime() <= Date.now()
        : false;
      if (activationExpired && activationResult.data?.used !== true) {
        throw new Error("SALES_ACTIVATION_EXPIRED");
      }

      const now = new Date().toISOString();
      const conversionKey = `activation-completed:${leadId}:${params.userId}`;

      // Stripe can deliver a paid Checkout webhook before the subscription is
      // active. Verify the persisted subscription BEFORE converting the lead or
      // creating tenant entitlements. A later webhook replay can safely retry.
      const subscriptionId = modularContract
        ? sanitizeString(offerResult.data.stripe_subscription_id, 200)
        : "";
      if (modularContract && !subscriptionId) {
        throw new Error("SALES_SUBSCRIPTION_LINKAGE_MISSING");
      }
      const subscription = modularContract
        ? await getStripe().subscriptions.retrieve(subscriptionId)
        : null;
      const entitlementStatus = subscription
        ? stripeSubscriptionToEntitlementStatus(subscription.status)
        : null;
      if (modularContract && !["active", "trial", "grace"].includes(entitlementStatus || "")) {
        throw new Error("SALES_SUBSCRIPTION_NOT_ACTIVE");
      }

      // Persist the canonical tenant relationship first. The entitlement RPC
      // validates this relationship itself, preventing an offer from activating
      // modules in another clinic. This update is idempotent on retries.
      const [leadUpdate, discountUpdate] = await Promise.all([
        supabase
          .from("sales_leads")
          .update({
            status: "converted",
            converted_user_id: params.userId,
            converted_clinic_id: params.clinicId,
            updated_at: now,
          })
          .eq("id", leadId)
          .is("deleted_at", null),
        supabase
          .from("sales_subscription_discounts")
          .update({
            user_id: params.userId,
            clinic_id: params.clinicId,
            updated_at: now,
          })
          .eq("offer_id", offerId)
          .eq("lead_id", leadId),
      ]);
      if (leadUpdate.error || discountUpdate.error) {
        throw leadUpdate.error || discountUpdate.error;
      }

      if (modularContract) {
        // Both values were checked before any tenant or lead write above.
        if (!subscription || !entitlementStatus) {
          throw new Error("SALES_SUBSCRIPTION_NOT_ACTIVE");
        }
        await applyModularEntitlementsForOrganization({
          offerId,
          organizationId: params.clinicId,
          stripeSubscriptionId: subscriptionId,
          stripeEventId: `activation:${checkoutSessionId}:${subscriptionId}`,
          stripeEventCreatedAt: new Date().toISOString(),
          status: entitlementStatus,
        });
        await provisionModularCapacityBillingContract({
          offer: offerResult.data,
          organizationId: params.clinicId,
          stripeSubscriptionId: subscriptionId,
        });
        const clinicSubscriptionStatus =
          sanitizeString(subscription.status, 40).toLowerCase() === "trialing"
            ? "trialing"
            : sanitizeString(subscription.status, 40).toLowerCase() === "active"
              ? "active"
              : sanitizeString(subscription.status, 40).toLowerCase() === "past_due"
                ? "past_due"
                : "subscription_pending";
        await Promise.all([
          patchTableSafely("clinics", { column: "id", value: params.clinicId }, {
            subscription_status: clinicSubscriptionStatus,
            billing_model: ACTIVE_PATIENT_BILLING_MODEL,
            stripe_subscription_id: subscriptionId,
            updated_at: now,
          }),
          patchTableSafely("users", { column: "id", value: params.userId }, {
            subscription_status: clinicSubscriptionStatus,
            billing_model: ACTIVE_PATIENT_BILLING_MODEL,
            updated_at: now,
          }),
        ]);
        await verifySalesDirectorContractAccess({
          offerId,
          userId: params.userId,
          organizationId: params.clinicId,
          stripeSubscriptionId: subscriptionId,
        });
      }

      const activationUpdate = activationResult.data?.id
        ? await supabase
            .from("pending_activations")
            .update({ used: true })
            .eq("id", activationResult.data.id)
            .eq("used", false)
        : { error: null };
      const [eventUpdate, offerCompletionUpdate] = await Promise.all([
        supabase.from("sales_lead_events").upsert(
          [
            {
              lead_id: leadId,
              event_type: "activation_completed",
              actor_user_id: params.userId,
              metadata: {
                offer_id: offerId,
                clinic_id: params.clinicId,
                checkout_session_id: checkoutSessionId,
                modular_contract: modularContract,
                activation_channel: requireActivationRecord ? "legacy_activation" : "stripe_payment",
              },
              idempotency_key: conversionKey,
              created_at: now,
            },
          ],
          { onConflict: "idempotency_key", ignoreDuplicates: true },
        ),
        supabase
          .from("sales_offers")
          .update({
            provisioning_status: "completed",
            provisioning_error_code: null,
            provisioning_updated_at: now,
            updated_at: now,
          })
          .eq("id", offerId)
          .eq("lead_id", leadId)
          .eq("status", "paid"),
      ]);
      if (activationUpdate.error || eventUpdate.error || offerCompletionUpdate.error) {
        throw activationUpdate.error || eventUpdate.error || offerCompletionUpdate.error;
      }
    } catch (error: any) {
      if (isMissingRelationError(error)) {
        console.warn(
          "[Sales Activation] Estrutura comercial ainda não aplicada; ativação modular permanece bloqueada até o schema existir.",
        );
        if (modularContract) throw error;
        return;
      }
      console.error("[Sales Activation] Falha ao concluir vínculo comercial:", {
        email: maskEmail(normalizedEmail),
        userId: sanitizeString(params.userId, 120),
        offerId,
        leadId,
        message: sanitizeString(error?.message || String(error), 240),
      });
      // New modular contracts must never fall back to legacy_full when their
      // entitlement provisioning fails. Bubble the error so login/activation
      // can retry instead of exposing the clinic workspace with broad access.
      if (modularContract) throw error;
    }
  }

  // ITEM10_SOURCE_END
  return { provisionPaidSalesDirectorAccount, finalizeSalesActivationForUser };
}
