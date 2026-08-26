export const DEFAULT_CLINIC_TIME_ZONE = 'America/Sao_Paulo';

export const BRAZIL_CLINIC_TIME_ZONE_OPTIONS = [
  { value: 'America/Sao_Paulo', label: 'Brasília / São Paulo (UTC−3)' },
  { value: 'America/Campo_Grande', label: 'Mato Grosso do Sul (UTC−4)' },
  { value: 'America/Cuiaba', label: 'Mato Grosso (UTC−4)' },
  { value: 'America/Manaus', label: 'Amazonas — Manaus (UTC−4)' },
  { value: 'America/Eirunepe', label: 'Amazonas — oeste (UTC−5)' },
  { value: 'America/Rio_Branco', label: 'Acre (UTC−5)' },
  { value: 'America/Porto_Velho', label: 'Rondônia (UTC−4)' },
  { value: 'America/Boa_Vista', label: 'Roraima (UTC−4)' },
  { value: 'America/Belem', label: 'Pará / Amapá (UTC−3)' },
  { value: 'America/Santarem', label: 'Pará — oeste (UTC−3)' },
  { value: 'America/Bahia', label: 'Bahia (UTC−3)' },
  { value: 'America/Fortaleza', label: 'CE / MA / PI / RN / PB (UTC−3)' },
  { value: 'America/Recife', label: 'Pernambuco (UTC−3)' },
  { value: 'America/Maceio', label: 'AL / SE (UTC−3)' },
  { value: 'America/Araguaina', label: 'Tocantins (UTC−3)' },
] as const;

const BRAZIL_STATE_TIME_ZONE: Record<string, string> = {
  AC: 'America/Rio_Branco',
  AL: 'America/Maceio',
  AP: 'America/Belem',
  AM: 'America/Manaus',
  BA: 'America/Bahia',
  CE: 'America/Fortaleza',
  DF: 'America/Sao_Paulo',
  ES: 'America/Sao_Paulo',
  GO: 'America/Sao_Paulo',
  MA: 'America/Fortaleza',
  MT: 'America/Cuiaba',
  MS: 'America/Campo_Grande',
  MG: 'America/Sao_Paulo',
  PA: 'America/Belem',
  PB: 'America/Fortaleza',
  PR: 'America/Sao_Paulo',
  PE: 'America/Recife',
  PI: 'America/Fortaleza',
  RJ: 'America/Sao_Paulo',
  RN: 'America/Fortaleza',
  RS: 'America/Sao_Paulo',
  RO: 'America/Porto_Velho',
  RR: 'America/Boa_Vista',
  SC: 'America/Sao_Paulo',
  SP: 'America/Sao_Paulo',
  SE: 'America/Maceio',
  TO: 'America/Araguaina',
};

export const isValidIanaTimeZone = (value: unknown): boolean => {
  const candidate = String(value || '').trim();
  if (!candidate || candidate.length > 80) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
};

export const inferBrazilClinicTimeZoneFromState = (state: unknown): string => {
  const normalizedState = String(state || '').trim().toUpperCase().slice(0, 2);
  return BRAZIL_STATE_TIME_ZONE[normalizedState] || DEFAULT_CLINIC_TIME_ZONE;
};

export const resolveClinicTimeZone = (input?: {
  timeZone?: unknown;
  state?: unknown;
  fallback?: unknown;
}): string => {
  const explicit = String(input?.timeZone || '').trim();
  if (isValidIanaTimeZone(explicit)) return explicit;

  const inferred = inferBrazilClinicTimeZoneFromState(input?.state);
  if (isValidIanaTimeZone(inferred)) return inferred;

  const fallback = String(input?.fallback || '').trim();
  if (isValidIanaTimeZone(fallback)) return fallback;
  return DEFAULT_CLINIC_TIME_ZONE;
};
