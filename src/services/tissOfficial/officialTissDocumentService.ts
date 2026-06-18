import type {
  GeneratedOfficialTissDocument,
  OfficialTissDocumentInput,
  TissOfficialIssue,
  TissXsdValidationResult
} from "./types";
import { canonicalJson, monthKey, sha256Hex, text } from "./security";
import { getTissOfficialStrategy } from "./strategyRegistry";

export type OfficialTissDocumentBuildResult =
  | {
      ok: true;
      generated: Extract<GeneratedOfficialTissDocument, { ok: true }>;
      xsdValidation: TissXsdValidationResult;
      idempotencyKey: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
      issues: TissOfficialIssue[];
      xsdValidation?: TissXsdValidationResult;
    };

export function buildOfficialTissIdempotencyKey(input: OfficialTissDocumentInput) {
  const orderedPreGuides = [...(input.preGuides || [])]
    .map((row: any) => ({
      id: text(row?.id, 120),
      updatedAt: text(row?.updatedAt || row?.updated_at || row?.lastValidatedAt || row?.last_validated_at, 80),
      status: text(row?.status, 40),
      totalAmountCents: Number(row?.totalAmountCents ?? row?.total_amount_cents ?? 0) || 0,
      snapshotHash: sha256Hex(canonicalJson(row?.snapshot || row?.snapshot_data || {}))
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return sha256Hex(canonicalJson({
    scope: "tiss_official_document",
    payerId: text(input.payerId, 120),
    competenceMonth: monthKey(input.competenceMonth),
    communicationVersion: text(input.communicationVersion, 20),
    contentStructureVersion: text(input.contentStructureVersion, 20),
    preGuides: orderedPreGuides
  }));
}

export function deriveOfficialTissBatchNumber(idempotencyKey: string) {
  const prefix = text(idempotencyKey, 64).slice(0, 15);
  if (!/^[a-f0-9]+$/i.test(prefix)) return "";
  return (BigInt(`0x${prefix}`) % 1_000_000_000_000n).toString().padStart(12, "0");
}

export async function generateAndValidateOfficialTissDocument(input: OfficialTissDocumentInput): Promise<OfficialTissDocumentBuildResult> {
  const strategy = getTissOfficialStrategy(input.communicationVersion);
  const generated = strategy.generate(input);
  if (generated.ok === false) {
    const failed = generated as Extract<GeneratedOfficialTissDocument, { ok: false }>;
    return {
      ok: false,
      code: failed.code,
      message: failed.message,
      issues: failed.issues
    };
  }
  const xsdValidation = await strategy.validate(generated.xml);
  if (xsdValidation.status !== "valid") {
    return {
      ok: false,
      code: "TISS_OFFICIAL_XSD_VALIDATION_FAILED",
      message: "O XML TISS oficial gerado não passou na validação XSD oficial.",
      issues: xsdValidation.errors,
      xsdValidation
    };
  }
  return {
    ok: true,
    generated: {
      ...generated,
      validationSummary: {
        ...generated.validationSummary,
        xsdValidation,
        technicalValidation: {
          status: "valid",
          validatedAt: xsdValidation.validatedAt,
          errors: [],
          warnings: xsdValidation.warnings
        }
      }
    },
    xsdValidation,
    idempotencyKey: buildOfficialTissIdempotencyKey(input)
  };
}
