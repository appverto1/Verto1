export type TherapeuticTemplatePrivacyResult = {
  sanitized: Record<string, unknown>;
  warnings: string[];
  redacted: boolean;
};

const IDENTIFIER_PATTERNS: Array<[string, RegExp]> = [
  ['CPF', /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g],
  ['e-mail', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ['telefone', /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/g],
  ['data de nascimento', /\b(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])\/\d{4}\b/g],
  ['identificador', /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi]
];

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function sanitizeTherapeuticTemplateContent(
  source: Record<string, unknown>,
  patientName?: string | null
): TherapeuticTemplatePrivacyResult {
  const warnings = new Set<string>();
  const patientPattern = String(patientName || '').trim().length >= 3
    ? new RegExp(`\\b${escapeRegExp(String(patientName).trim())}\\b`, 'gi')
    : null;
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      let text = value;
      if (patientPattern?.test(text)) {
        warnings.add('nome do paciente');
        patientPattern.lastIndex = 0;
        text = text.replace(patientPattern, '[dado removido]');
      }
      for (const [label, pattern] of IDENTIFIER_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(text)) warnings.add(label);
        pattern.lastIndex = 0;
        text = text.replace(pattern, '[dado removido]');
      }
      return text;
    }
    if (Array.isArray(value)) return value.slice(0, 200).map(walk);
    if (value && typeof value === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (/^(?:patient(?:id|_id|name)?|paciente(?:id|_id|nome)?|cpf|birth(?:date|_date)?|dateofbirth|date_of_birth|data_?de_?nascimento|responsible|responsavel|responsável|guardian|responsaveis|responsáveis|attachment(?:url|_url|s)?|anexo(?:s|url|_url)?|result(?:s)?|resultado(?:s)?|score(?:s)?|pontuacao|pontuação|(?:individual|private|patient|clinical)?_?notes?|notas?(?:_?individuais)?)$/i.test(key)) {
          warnings.add('campo individual não reutilizável');
          continue;
        }
        output[key] = walk(nested);
      }
      return output;
    }
    return value;
  };
  const sanitized = walk(source) as Record<string, unknown>;
  return {
    sanitized,
    warnings: [...warnings],
    redacted: warnings.size > 0
  };
}
