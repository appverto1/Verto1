import { parsePublicSalesLeadInput } from './publicSalesLeadInput';

// Extraction-only: existing backend middleware and RPC remain authoritative.
export function registerPublicSalesLeadRoute(app: any, deps: any): void {
  const {
    supabase,
    publicSalesLeadIpLimiter,
    publicSalesLeadIdentityLimiter,
    sanitizeString,
    isUuid,
    isMissingRelationError,
    notifySalesOwnerForLead,
  } = deps;

  app.post(
    "/api/public/sales-leads",
    publicSalesLeadIpLimiter,
    publicSalesLeadIdentityLimiter,
    async (req: any, res: any) => {
      const parsed = parsePublicSalesLeadInput(req, deps);
      if (!parsed.ok) {
        return res.status(parsed.status).json({ success: false, error: parsed.error });
      }
      const {
        name,
        email,
        normalizedPhone,
        phone,
        professionalRegistry,
        clinicName,
        city,
        state,
        estimatedActivePatients,
        estimatedProfessionals,
        operationType,
        acquisitionChannel,
        jobTitle,
        preferredContactPeriod,
        notes,
        consentVersion,
        consentPurpose,
        source,
        idempotencyKey,
        partnerCode,
      } = parsed.input;

      try {
        const { data, error } = await supabase.rpc("upsert_public_sales_lead", {
          p_name: name,
          p_email: email || null,
          p_normalized_email: email || null,
          p_phone: phone,
          p_normalized_phone: normalizedPhone,
          p_professional_registry: professionalRegistry,
          p_clinic_name: clinicName,
          p_city: city,
          p_state: state,
          p_estimated_active_patients: estimatedActivePatients,
          p_estimated_professionals: estimatedProfessionals,
          p_operation_type: operationType,
          p_acquisition_channel: acquisitionChannel,
          p_job_title: jobTitle || "",
          p_preferred_contact_period: preferredContactPeriod || "",
          p_notes: notes || "",
          p_consent_version: consentVersion,
          p_consent_origin: source,
          p_consent_purpose: consentPurpose,
          p_source: source,
          p_idempotency_key: idempotencyKey,
        });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        const leadId = sanitizeString(row?.lead_id, 120);
        const eventCreated = Boolean(row?.event_created);
        if (!isUuid(leadId)) throw new Error("SALES_LEAD_ID_MISSING");

        // Optional attribution. The lead write above remains the authoritative
        // save; a partner code cannot overwrite or reassign existing customers.
        // This adds NO query for ordinary traffic without a partner code.
        let referralRecorded: boolean | null = null;
        if (partnerCode) {
          try {
            const attribution = await supabase.rpc('verto_claim_partner_referral_v1', {
              p_lead_id: leadId, p_referral_code: partnerCode,
              p_idempotency_key: idempotencyKey,
            });
            if (attribution.error) throw attribution.error;
            referralRecorded = attribution.data === true;
          } catch (referralError: any) {
            referralRecorded = false;
            console.warn('[Partnerships] Atribuição de indicação indisponível.', {
              code: sanitizeString(referralError?.code, 40) || 'unavailable',
            });
          }
        }

        if (eventCreated) {
          void notifySalesOwnerForLead({
            leadId,
            name,
            email,
            phone: phone || normalizedPhone,
            clinicName,
            estimatedActivePatients,
            acquisitionChannel,
            createdAt: new Date().toISOString(),
            idempotencyKey,
          }).catch((notificationError: any) => {
            console.warn(
              "[Sales Leads] Notificação comercial falhou sem perder o lead:",
              {
                leadId,
                message: sanitizeString(
                  notificationError?.message || String(notificationError),
                  240,
                ),
              },
            );
          });
        }

        return res.status(201).json({
          success: true,
          ...(partnerCode ? { referralRecorded, referralWarning: referralRecorded === false ? "Código de indicação não confirmado. O cadastro foi recebido." : null } : {}),
          message:
            "Recebemos seu interesse na Verto. Entraremos em contato para conhecer sua operação e apresentar a plataforma.",
        });
      } catch (error: any) {
        const errorMessage = String(error?.message || "");
        const missingSchema =
          isMissingRelationError(error) ||
          errorMessage.includes("upsert_public_sales_lead");
        const identityConflict = errorMessage.includes(
          "SALES_LEAD_IDENTITY_CONFLICT",
        );
        const existingCustomer = errorMessage.includes(
          "SALES_LEAD_ALREADY_CUSTOMER",
        );
        console.error("[Sales Leads] Falha ao persistir lead:", {
          code: sanitizeString(error?.code, 80),
          message: sanitizeString(errorMessage || String(error), 240),
        });
        return res
          .status(missingSchema ? 503 : identityConflict || existingCustomer ? 409 : 500)
          .json({
            success: false,
            error: missingSchema
              ? "Estrutura comercial ainda não aplicada no banco."
              : identityConflict || existingCustomer
                ? "Não foi possível concluir este cadastro pelo formulário. Confira os dados ou fale com a equipe da Verto."
                : "Não foi possível registrar seu interesse agora.",
          });
      }
    },
  );

}
