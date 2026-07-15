export type TissOfficialIssueSeverity = "blocking" | "warning";

export type TissOfficialIssue = {
  code: string;
  message: string;
  severity: TissOfficialIssueSeverity;
  entity?: string;
  field?: string;
  path?: string;
  preGuideId?: string | null;
  line?: number | null;
  column?: number | null;
};

export type TissXsdValidationResult = {
  status: "valid" | "invalid";
  validatedAt: string;
  schemaRootFile: string;
  errors: TissOfficialIssue[];
  warnings: TissOfficialIssue[];
};

export type OfficialTissDocumentInput = {
  preGuides: any[];
  payerId: string;
  competenceMonth: string;
  batchNumber: string;
  generatedAt?: string;
  timeZone?: string;
  generatedBy?: string | null;
  communicationVersion?: string | null;
  contentStructureVersion?: string | null;
  tussVersion?: string | null;
};

export type OfficialTissCanonicalGuide = {
  preGuideId: string;
  appointmentId: string;
  patientId: string;
  guideNumber: string;
  scheduledStart: string;
  scheduledEnd: string;
  totalAmountCents: number;
};

export type OfficialTissCanonicalPayload = {
  communicationVersion: string;
  contentStructureVersion: string;
  tussVersion: string;
  competenceMonth: string;
  generatedAt: string;
  timeZone: string;
  batchNumber: string;
  payerId: string;
  guideType: "sp_sadt";
  guideCount: number;
  totalAmountCents: number;
  guides: OfficialTissCanonicalGuide[];
};

export type GeneratedOfficialTissDocument =
  | {
      ok: true;
      xml: string;
      xmlHash: string;
      epilogueHash: string;
      payload: OfficialTissCanonicalPayload;
      preGuideIds: string[];
      guideCount: number;
      totalAmountCents: number;
      batchNumber: string;
      communicationVersion: string;
      contentStructureVersion: string;
      tussVersion: string;
      schemaRootFile: string;
      schemaManifestChecksum: string;
      validationSummary: Record<string, any>;
    }
  | {
      ok: false;
      code: string;
      message: string;
      issues: TissOfficialIssue[];
    };

export interface TissXmlGenerationStrategy {
  communicationVersion: string;
  contentStructureVersion: string;
  generate(input: OfficialTissDocumentInput): GeneratedOfficialTissDocument;
  validate(xml: string): Promise<TissXsdValidationResult>;
}
