// Transporte exclusivo da captação pública de interesse comercial.
// O backend continua autoridade da validação, idempotência, antifraude e CRM.
export type PublicSalesInterestSubmission = {
  normalizedName: string;
  phone: string;
  clinicName: string;
  initialAcquisitionChannel: string;
  website: string;
  startedAt: number;
  idempotencyKey: string;
  partnerCode?: string;
};

export async function submitSalesInterest({
  normalizedName,
  phone,
  clinicName,
  initialAcquisitionChannel,
  website,
  startedAt,
  idempotencyKey,
  partnerCode,
}: PublicSalesInterestSubmission): Promise<{referralRecorded?: boolean; referralWarning?: string}> {
      const response = await fetch("/api/public/sales-leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        credentials: "include",
        body: JSON.stringify({
          name: normalizedName,
          phone,
          clinicName: clinicName.trim(),
          acquisitionChannel:
            initialAcquisitionChannel.trim() || "public_landing",
          source: "public_landing",
          website,
          formStartedAt: startedAt,
          ...(partnerCode ? { partnerCode } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success !== true) {
        throw new Error(
          data?.message ||
            data?.error ||
            "Não foi possível registrar seu interesse.",
        );
      }
      return { referralRecorded: data.referralRecorded, referralWarning: data.referralWarning };

}
