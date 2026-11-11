import crypto from 'crypto';

// Parses the existing public lead request without DB access or notifications.
// These guards and their order are preserved from publicSalesLeadRoutes.ts.
export function parsePublicSalesLeadInput(req: any, deps: any) {
  const {
    sanitizeString,
    sanitizeEmail,
    normalizeSalesPhone,
    normalizeSalesInteger,
    SALES_PUBLIC_PAYLOAD_MAX_BYTES,
    SALES_ESTIMATED_ACTIVE_PATIENTS_MAX,
    SALES_ESTIMATED_PROFESSIONALS_MAX,
    SALES_CONTACT_CONSENT_VERSION,
    SALES_OPERATION_TYPES,
    SALES_PREFERRED_CONTACT_PERIODS,
    BRAZIL_STATE_CODES,
  } = deps;
      const contentLength = Number(req.headers?.["content-length"] || 0);
      const payloadBytes = Buffer.byteLength(
        JSON.stringify(req.body || {}),
        "utf8",
      );
      if (
        contentLength > SALES_PUBLIC_PAYLOAD_MAX_BYTES ||
        payloadBytes > SALES_PUBLIC_PAYLOAD_MAX_BYTES
      ) {
        return { ok: false as const, status: 413, error: "Payload comercial excede o limite permitido." };
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
        return { ok: false as const, status: 400, error: "Não foi possível validar o envio do formulário." };
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
        return { ok: false as const, status: 400, error: "Revise os campos e os limites de tamanho informados." };
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
      const rawPartnerCode = req.body?.partnerCode;
      const partnerCode = typeof rawPartnerCode === 'string'
        ? rawPartnerCode.toUpperCase() : '';
      const isInternalCode = /^VERTO-[A-F0-9]{18}$/.test(partnerCode);
      const isCouponCode = /^[A-Z0-9]{4,24}$/.test(partnerCode);
      if (rawPartnerCode !== undefined && (typeof rawPartnerCode !== 'string'
          || rawPartnerCode.length > 64
          || (partnerCode.length > 0 && !isInternalCode && !isCouponCode))) {
        return { ok: false as const, status: 400, error: 'Cupom inválido. Use de 4 a 24 letras ou números juntos, sem espaços, hífens ou símbolos. Ex.: FRATELLI10.' };
      }
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
        return { ok: false as const, status: 400, error: "Informe um nome e um WhatsApp válidos." };
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
        partnerCode,
      });
      const idempotencyKey =
        suppliedIdempotencyKey.length >= 12
          ? `public-sales:${suppliedIdempotencyKey}`
          : `public-sales:${crypto.createHash("sha256").update(deterministicPayload).digest("hex")}`;

      return { ok: true as const, input: {
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
        partnerCode,
        idempotencyKey,
      } };
}
