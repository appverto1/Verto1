/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ParseOption, XmlDocument, XsdValidator } from "libxml2-wasm";
import { xmlRegisterFsInputProviders } from "libxml2-wasm/lib/nodejs.mjs";
import type { TissOfficialIssue, TissXsdValidationResult } from "../../types";
import { assertSafeXmlForOfficialValidation, text } from "../../security";
import { COMMUNICATION_040300_MANIFEST } from "./manifest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMA_DIR = path.join(__dirname, "schemas");
const SCHEMA_ROOT_PATH = path.join(SCHEMA_DIR, COMMUNICATION_040300_MANIFEST.schemaRootFile);
const PARSE_OPTIONS =
  ParseOption.XML_PARSE_NONET |
  ParseOption.XML_PARSE_NO_XXE |
  ParseOption.XML_PARSE_NO_SYS_CATALOG |
  ParseOption.XML_PARSE_NOBLANKS;

let fsProviderRegistered = false;

function ensureFileInputProvider() {
  if (fsProviderRegistered) return;
  xmlRegisterFsInputProviders();
  fsProviderRegistered = true;
}

function issueFromError(error: any, fallbackCode: string): TissOfficialIssue[] {
  const details = Array.isArray(error?.details) ? error.details : [];
  if (details.length > 0) {
    return details.map((detail: any) => ({
      code: fallbackCode,
      message: text(detail?.message || error?.message || "Erro de validação XSD.", 1000),
      severity: "blocking",
      line: Number.isFinite(Number(detail?.line)) ? Number(detail.line) : null,
      column: Number.isFinite(Number(detail?.column)) ? Number(detail.column) : null,
      path: text(detail?.file || detail?.domain || "", 500) || undefined
    }));
  }
  return [{
    code: fallbackCode,
    message: text(error?.message || "Erro de validação XSD.", 1000),
    severity: "blocking"
  }];
}

export async function validateOfficialTissXml040300(xml: string): Promise<TissXsdValidationResult> {
  const validatedAt = new Date().toISOString();
  try {
    assertSafeXmlForOfficialValidation(xml);
  } catch (error: any) {
    return {
      status: "invalid",
      validatedAt,
      schemaRootFile: COMMUNICATION_040300_MANIFEST.schemaRootFile,
      errors: [{
        code: text(error?.message, 120) || "TISS_OFFICIAL_XML_UNSAFE",
        message: "O XML contém estrutura insegura ou excede os limites permitidos para validação.",
        severity: "blocking"
      }],
      warnings: []
    };
  }

  if (!fs.existsSync(SCHEMA_ROOT_PATH)) {
    return {
      status: "invalid",
      validatedAt,
      schemaRootFile: COMMUNICATION_040300_MANIFEST.schemaRootFile,
      errors: [{
        code: "TISS_OFFICIAL_SCHEMA_ROOT_MISSING",
        message: "XSD oficial raiz não encontrado no repositório.",
        severity: "blocking",
        path: SCHEMA_ROOT_PATH
      }],
      warnings: []
    };
  }

  ensureFileInputProvider();
  let schemaDoc: XmlDocument | null = null;
  let xmlDoc: XmlDocument | null = null;
  let validator: XsdValidator | null = null;
  try {
    schemaDoc = XmlDocument.fromBuffer(fs.readFileSync(SCHEMA_ROOT_PATH), {
      url: pathToFileURL(SCHEMA_ROOT_PATH).href,
      option: PARSE_OPTIONS
    });
    validator = XsdValidator.fromDoc(schemaDoc);
    xmlDoc = XmlDocument.fromBuffer(Buffer.from(xml, "utf8"), {
      option: PARSE_OPTIONS
    });
    validator.validate(xmlDoc);
    return {
      status: "valid",
      validatedAt,
      schemaRootFile: COMMUNICATION_040300_MANIFEST.schemaRootFile,
      errors: [],
      warnings: []
    };
  } catch (error: any) {
    return {
      status: "invalid",
      validatedAt,
      schemaRootFile: COMMUNICATION_040300_MANIFEST.schemaRootFile,
      errors: issueFromError(error, "TISS_OFFICIAL_XSD_VALIDATION_FAILED"),
      warnings: []
    };
  } finally {
    try { validator?.dispose(); } catch {}
    try { xmlDoc?.dispose(); } catch {}
    try { schemaDoc?.dispose(); } catch {}
  }
}
