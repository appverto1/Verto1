import type Stripe from 'stripe';
// Item 10: statements preserved exactly from paid-Director backend in staging.
export function createSalesDirectorContractAccess(deps: Record<string, any>) {
  const { SALES_CUSTOMER_FACING_MODULE_ITEM_KEYS, sanitizeString, supabase } = deps;
  // ITEM10_SOURCE_BEGIN
  const verifySalesDirectorContractAccess = async (params: {
    offerId: string;
    userId: string;
    organizationId: string;
    stripeSubscriptionId: string;
  }) => {
    const [profileResult, membershipResult, accessProfileResult, offerItemsResult, entitlementResult] =
      await Promise.all([
        supabase
          .from("users")
          .select("id,role,clinic_id")
          .eq("id", params.userId)
          .maybeSingle(),
        supabase
          .from("clinic_memberships")
          .select("user_id,clinic_id,role,status")
          .eq("user_id", params.userId)
          .eq("clinic_id", params.organizationId)
          .eq("status", "active")
          .maybeSingle(),
        supabase
          .from("organization_module_access_profiles")
          .select("organization_id,mode,source_offer_id,stripe_subscription_id")
          .eq("organization_id", params.organizationId)
          .maybeSingle(),
        supabase
          .from("sales_offer_items")
          .select("item_key")
          .eq("offer_id", params.offerId)
          .in("item_key", Array.from(SALES_CUSTOMER_FACING_MODULE_ITEM_KEYS)),
        supabase
          .from("organization_module_entitlements")
          .select("module_key,status,source_offer_id,stripe_subscription_id")
          .eq("organization_id", params.organizationId)
          .in("status", ["active", "trial", "grace"]),
      ]);
    const readError = [
      profileResult,
      membershipResult,
      accessProfileResult,
      offerItemsResult,
      entitlementResult,
    ].find((result: any) => result?.error)?.error;
    if (readError) throw readError;

    const expectedModules = Array.from(new Set(
      (offerItemsResult.data || [])
        .map((row: any) => sanitizeString(row.item_key, 80))
        .filter((itemKey: string) => SALES_CUSTOMER_FACING_MODULE_ITEM_KEYS.has(itemKey)),
    )).sort();
    const activeEntitlementRows = (entitlementResult.data || []).filter((row: any) =>
      SALES_CUSTOMER_FACING_MODULE_ITEM_KEYS.has(
        sanitizeString(row.module_key, 80),
      ),
    );
    const effectiveModules = Array.from(new Set(
      activeEntitlementRows
        .map((row: any) => sanitizeString(row.module_key, 80))
        .filter(Boolean),
    )).sort();
    const everyActiveModuleComesFromContract = activeEntitlementRows.every(
      (row: any) =>
        sanitizeString(row.source_offer_id, 120) === params.offerId &&
        sanitizeString(row.stripe_subscription_id, 200) ===
          params.stripeSubscriptionId,
    );
    const exactModules =
      expectedModules.length > 0 &&
      everyActiveModuleComesFromContract &&
      expectedModules.length === effectiveModules.length &&
      expectedModules.every((moduleKey, index) => moduleKey === effectiveModules[index]);
    const profile = profileResult.data as any;
    const membership = membershipResult.data as any;
    const accessProfile = accessProfileResult.data as any;
    const validDirector =
      profile &&
      sanitizeString(profile.role, 40).toLowerCase() === "director" &&
      sanitizeString(profile.clinic_id, 120) === params.organizationId &&
      membership &&
      sanitizeString(membership.role, 40).toLowerCase() === "director" &&
      sanitizeString(membership.status, 40).toLowerCase() === "active";
    const validContractScope =
      accessProfile &&
      sanitizeString(accessProfile.mode, 40) === "contract" &&
      sanitizeString(accessProfile.source_offer_id, 120) === params.offerId &&
      sanitizeString(accessProfile.stripe_subscription_id, 200) ===
        params.stripeSubscriptionId;

    if (!validDirector || !validContractScope || !exactModules) {
      console.error("[Sales Activation] Director/module verification failed.", {
        offerId: sanitizeString(params.offerId, 120),
        organizationId: sanitizeString(params.organizationId, 120),
        validDirector,
        validContractScope,
        expectedModules,
        effectiveModules,
        everyActiveModuleComesFromContract,
      });
      const verificationError = new Error(
        "SALES_DIRECTOR_ENTITLEMENT_VERIFICATION_FAILED",
      );
      (verificationError as any).code =
        "SALES_DIRECTOR_ENTITLEMENT_VERIFICATION_FAILED";
      throw verificationError;
    }

    return { modules: effectiveModules };
  };

  // ITEM10_SOURCE_END
  return { verifySalesDirectorContractAccess };
}
