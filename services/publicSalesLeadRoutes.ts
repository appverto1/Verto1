import crypto from 'crypto';

// Extraction-only: existing backend middleware and RPC remain authoritative.
export function registerPublicSalesLeadRoute(app: any, deps: any): void {
  const {
    supabase,
    publicSalesLeadIpLimiter,
    publicSalesLeadIdentityLimiter,
    sanitizeString,
    sanitizeEmail,
    normalizeSalesPhone,
    normalizeSalesInteger,
    isUuid,
    isMissingRelationError,
    notifySalesOwnerForLead,
    SALES_PUBLIC_PAYLOAD_MAX_BYTES,
    SALES_ESTIMATED_ACTIVE_PATIENTS_MAX,
    SALES_ESTIMATED_PROFESSIONALS_MAX,
    SALES_CONTACT_CONSENT_VERSION,
    SALES_OPERATION_TYPES,
    SALES_PREFERRED_CONTACT_PERIODS,
    BRAZIL_STATE_CODES,
  } = deps;

  app.post(
    "/api/public/sales-leads",
    publicSalesLeadIpLimiter,
    publicSalesLeadIdentityLimiter,
    async (req: any, res: any) => {
      const contentLength = Number(req.headers?.["content-length"] || 0);
      const payloadBytes = Buffer.byteLength(
        JSON.stringify(req.body || {}),
        "utf8",
      );
      if (
        contentLength > SALES_PUBLIC_PAYLOAD_MAX_BYTES ||
        payloadBytes > SALES_PUBLIC_PAYLOAD_MAX_BYTES
      ) {
        return res.status(413).json({
          success: false,
          error: "Payload comercial excede o limite permitido.",
        });
      }

      const honeypot = sanitizeString(req.body?.website, 200);
      const formStartedAt = Number(req.body?.formStartedAt || 0);
      const elapsedMs = Date.now() - formStartedAt;
      if (
        honeypot ||
        !Number.isFinite(formStartedAt) ||
        elapsedMs < 700 ||
        elapsedMs > 24 * 60 * 60 * 1000
      ) {
        return res.status(400).json({
          success: false,
          error: "Não foi possível validar o envio do formulário.",
        });
      }

      const rawName =
        typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const rawEmail =
        typeof req.body?.email === "string" ? req.body.email.trim() : "";
      const rawRegistry =
        typeof req.body?.professionalRegistry === "string"
          ? req.body.professionalRegistry.trim()
          : "";
      const rawClinicName =
        typeof req.body?.clinicName === "string"
          ? req.body.clinicName.trim()
          : "";
      const rawCity =
        typeof req.body?.city === "string" ? req.body.city.trim() : "";
      const rawNotes =
        typeof req.body?.notes === "string" ? req.body.notes.trim() : "";
      if (
        rawName.length < 2 ||
        rawName.length > 180 ||
        rawEmail.length > 254 ||
        rawRegistry.length > 80 ||
        (rawClinicName.length > 0 && rawClinicName.length < 2) ||
        rawClinicName.length > 180 ||
        (rawCity.length > 0 && rawCity.length < 2) ||
        rawCity.length > 120 ||
        rawNotes.length > 1500
      ) {
        return res.status(400).json({
          success: false,
          error: "Revise os campos e os limites de tamanho informados.",
        });
      }

      const name = sanitizeString(rawName, 180);
      const email = sanitizeEmail(rawEmail);
      const normalizedPhone = normalizeSalesPhone(
        req.body?.phone || req.body?.whatsapp,
      );
      const phone = normalizedPhone ? `+${normalizedPhone}` : null;
      const professionalRegistry = sanitizeString(rawRegistry, 80);
      const clinicName = sanitizeString(rawClinicName, 180);
      const city = sanitizeString(rawCity, 120);
      const state = sanitizeString(req.body?.state, 2).toUpperCase();
      const requestedOperationType = sanitizeString(
        req.body?.operationType,
        60,
      );
      const operationType = SALES_OPERATION_TYPES.has(requestedOperationType)
        ? requestedOperationType
        : clinicName
          ? "clinic"
          : "independent_professional";
      const acquisitionChannel =
        sanitizeString(req.body?.acquisitionChannel, 120) || "public_landing";
      const jobTitle = sanitizeString(req.body?.jobTitle, 120);
      const preferredContactPeriod = sanitizeString(
        req.body?.preferredContactPeriod,
        30,
      );
      const notes = sanitizeString(rawNotes, 1500);
      const estimatedActivePatients = normalizeSalesInteger(
        req.body?.estimatedActivePatients,
        SALES_ESTIMATED_ACTIVE_PATIENTS_MAX,
        false,
      );
      const estimatedProfessionals = normalizeSalesInteger(
        req.body?.estimatedProfessionals,
        SALES_ESTIMATED_PROFESSIONALS_MAX,
        false,
      );
      const consentVersion = SALES_CONTACT_CONSENT_VERSION;
      const consentPurpose = "sales_contact";
      const requestedSource = sanitizeString(req.body?.source, 80);
      const source = ["public_landing", "google_interest"].includes(
        requestedSource,
      )
        ? requestedSource
        : "public_landing";

      if (
        !name ||
        !normalizedPhone ||
        (rawEmail && !email) ||
        (state && !BRAZIL_STATE_CODES.has(state)) ||
        !SALES_PREFERRED_CONTACT_PERIODS.has(preferredContactPeriod) ||
        (req.body?.estimatedActivePatients !== "" &&
          req.body?.estimatedActivePatients != null &&
          estimatedActivePatients === null) ||
        (req.body?.estimatedProfessionals !== "" &&
          req.body?.estimatedProfessionals != null &&
          estimatedProfessionals === null)
      ) {
        return res.status(400).json({
          success: false,
          error: "Informe um nome e um WhatsApp válidos.",
        });
      }

      const suppliedIdempotencyKey = sanitizeString(
        req.headers?.["x-idempotency-key"] || req.body?.idempotencyKey,
        240,
      );
      const deterministicPayload = JSON.stringify({
        email,
        normalizedPhone,
        name,
        clinicName,
        city,
        state,
        estimatedActivePatients,
        estimatedProfessionals,
        operationType,
        acquisitionChannel,
        source,
      });
      const idempotencyKey =
        suppliedIdempotencyKey.length >= 12
          ? `public-sales:${suppliedIdempotencyKey}`
          : `public-sales:${crypto.createHash("sha256").update(deterministicPayload).digest("hex")}`;

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
        console.error("[Sales Leads] Falha ao persistir lead:", {
          code: sanitizeString(error?.code, 80),
          message: sanitizeString(errorMessage || String(error), 240),
        });
        return res
          .status(missingSchema ? 503 : identityConflict ? 409 : 500)
          .json({
            success: false,
            error: missingSchema
              ? "Estrutura comercial ainda não aplicada no banco."
              : identityConflict
                ? "Os dados informados já estão associados a contatos comerciais diferentes. Fale com a equipe da Verto para atualizar o cadastro."
                : "Não foi possível registrar seu interesse agora.",
          });
      }
    },
  );

}
