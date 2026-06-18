/// <reference types="node" />

import crypto from "node:crypto";

export const OFFICIAL_TISS_MAX_XML_BYTES = 6 * 1024 * 1024;

export function text(value: unknown, maxLength = 5000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function onlyDigits(value: unknown, maxLength = 80) {
  return text(value, maxLength).replace(/\D/g, "").slice(0, maxLength);
}

export function escapeXml(value: unknown) {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function sha256Hex(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function decodeXmlText(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function calculateTissEpilogueHash(xml: string) {
  const epilogueIndex = xml.indexOf("<ans:epilogo>");
  const transactionXml = epilogueIndex >= 0 ? xml.slice(0, epilogueIndex) : xml;
  const values = Array.from(transactionXml.matchAll(/>([^<]+)</g))
    .map((match) => match[1].trim())
    .filter(Boolean)
    .map(decodeXmlText);
  const concatenated = values.join("");
  if (Array.from(concatenated).some((character) => character.codePointAt(0)! > 255)) {
    throw new Error("TISS_OFFICIAL_HASH_TEXT_NOT_ISO_8859_1");
  }
  return crypto.createHash("md5").update(Buffer.from(concatenated, "latin1")).digest("hex");
}

export function canonicalJson(value: unknown): string {
  const normalize = (input: any): any => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") {
      return Object.keys(input)
        .sort()
        .reduce((acc: Record<string, any>, key) => {
          acc[key] = normalize(input[key]);
          return acc;
        }, {});
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

export function assertSafeXmlForOfficialValidation(xml: string) {
  const source = text(xml, OFFICIAL_TISS_MAX_XML_BYTES + 1);
  const byteLength = Buffer.byteLength(source, "utf8");
  if (!source) {
    throw new Error("XML_EMPTY");
  }
  if (byteLength > OFFICIAL_TISS_MAX_XML_BYTES) {
    throw new Error("XML_TOO_LARGE");
  }
  if (/<!DOCTYPE/i.test(source) || /<!ENTITY/i.test(source)) {
    throw new Error("XML_DTD_OR_ENTITY_BLOCKED");
  }
  if (/SYSTEM\s+["']|PUBLIC\s+["']/i.test(source)) {
    throw new Error("XML_EXTERNAL_REFERENCE_BLOCKED");
  }
}

export function formatMoneyFromCents(cents: number) {
  const normalized = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  const sign = normalized < 0 ? "-" : "";
  const abs = Math.abs(normalized);
  const reais = Math.trunc(abs / 100);
  const centavos = String(abs % 100).padStart(2, "0");
  return `${sign}${reais}.${centavos}`;
}

export function sanitizeOfficialXmlFilePart(value: unknown) {
  return text(value, 80)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "operadora";
}

export function monthKey(value: unknown) {
  const raw = text(value, 40);
  const match = raw.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : "";
}
