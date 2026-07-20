const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

const HTML_ENTITY_TOKEN = /&(?:#(?:x[0-9a-f]+|\d+)|amp|apos|gt|lt|nbsp|quot);/gi;
const MAX_DECODE_PASSES = 2;

const decodeEntityToken = (token: string) => {
  const body = token.slice(1, -1);
  if (body.startsWith('#')) {
    const hexadecimal = body[1]?.toLowerCase() === 'x';
    const rawCodePoint = hexadecimal ? body.slice(2) : body.slice(1);
    const codePoint = Number.parseInt(rawCodePoint, hexadecimal ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return token;
    }
    return String.fromCodePoint(codePoint);
  }
  return NAMED_HTML_ENTITIES[body.toLowerCase()] ?? token;
};

/**
 * Decodes only HTML entity tokens and never interprets the result as markup.
 * Two passes cover legacy double-encoding without allowing unbounded transforms.
 */
export const decodeClinicalTextEntities = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  let decoded = String(value);
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    const next = decoded.replace(HTML_ENTITY_TOKEN, decodeEntityToken);
    if (next === decoded) break;
    decoded = next;
  }
  return decoded.replace(/\u00a0/g, ' ');
};

const CLINICAL_TEXT_FIELDS = new Set([
  'antecedent',
  'content',
  'criteria',
  'criterion',
  'description',
  'displayName',
  'display_name',
  'domainName',
  'domain_name',
  'environments',
  'errorCorrection',
  'error_correction',
  'expectedResponse',
  'expected_response',
  'frequency',
  'generalization',
  'instruction',
  'instructions',
  'intervention',
  'label',
  'maintenance',
  'materials',
  'message',
  'motive',
  'name',
  'nome',
  'note',
  'notes',
  'objective',
  'observation',
  'observations',
  'people',
  'programName',
  'program_name',
  'promptFading',
  'promptHierarchy',
  'prompt_fading',
  'prompt_hierarchy',
  'protocolTitle',
  'protocol_title',
  'rationale',
  'reason',
  'reinforcement',
  'responsibleNotes',
  'responsible_notes',
  'skillName',
  'skill_name',
  'stimuli',
  'summary',
  'targetName',
  'target_name',
  'text',
  'title',
  'titulo',
]);

const CLINICAL_TEXT_ARRAY_FIELDS = new Set([
  'targets',
  'suggestedTargets',
  'suggested_targets',
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
);

export const normalizeClinicalTextRecord = <T>(value: T, parentField = '', depth = 0): T => {
  if (depth > 10 || value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return (CLINICAL_TEXT_FIELDS.has(parentField) || CLINICAL_TEXT_ARRAY_FIELDS.has(parentField)
      ? decodeClinicalTextEntities(value)
      : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeClinicalTextRecord(item, parentField, depth + 1)) as T;
  }
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(Object.entries(value).map(([key, fieldValue]) => [
    key,
    normalizeClinicalTextRecord(fieldValue, key, depth + 1),
  ])) as T;
};
