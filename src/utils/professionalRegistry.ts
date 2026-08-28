export const PROFESSIONAL_COUNCIL_MAX_LENGTH = 48;
export const PROFESSIONAL_REGISTRY_MAX_LENGTH = 80;

const stripUnsafeControlCharacters = (value: unknown) =>
  String(value ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();

const PROFESSIONAL_IDENTIFIER_PATTERN = /^[\p{L}\p{M}\p{N} .,/\\_#:+()\-]*$/u;

const cleanProfessionalIdentifier = (value: unknown, maxLength: number) => {
  const normalized = stripUnsafeControlCharacters(value).slice(0, maxLength);
  return PROFESSIONAL_IDENTIFIER_PATTERN.test(normalized) ? normalized : normalized.replace(/[^\p{L}\p{M}\p{N} .,/\\_#:+()\-]/gu, '');
};

export const PROFESSIONAL_COUNCIL_OPTIONS = [
  { value: 'CRP', label: 'CRP · Psicologia' },
  { value: 'CREFITO', label: 'CREFITO · Fisioterapia / Terapia Ocupacional' },
  { value: 'CRFa', label: 'CRFa · Fonoaudiologia' },
  { value: 'CRM', label: 'CRM · Medicina' },
  { value: 'COREN', label: 'COREN · Enfermagem' },
  { value: 'CRN', label: 'CRN / CR Nutri · Nutrição' },
  { value: 'CRBM', label: 'CRBM · Biomedicina' },
  { value: 'CRTR', label: 'CRTR · Técnicos/Tecnólogos em Radiologia' },
  { value: 'MEC / Registro profissional', label: 'MEC / Registro profissional' },
  { value: 'Sem conselho / Outro registro', label: 'Sem conselho / Outro registro' },
] as const;

export const formatProfessionalCouncil = (value: unknown): string =>
  cleanProfessionalIdentifier(value, PROFESSIONAL_COUNCIL_MAX_LENGTH);

export const normalizeProfessionalCouncil = (value: unknown): string =>
  formatProfessionalCouncil(value);

export const formatProfessionalRegistry = (value: unknown, _council?: unknown): string =>
  cleanProfessionalIdentifier(value, PROFESSIONAL_REGISTRY_MAX_LENGTH);

export const normalizeProfessionalRegistry = (value: unknown, council?: unknown): string =>
  formatProfessionalRegistry(value, council);

export const isProfessionalRegistryValid = (value: unknown): boolean => {
  const raw = stripUnsafeControlCharacters(value);
  if (!raw) return true;
  return raw.length <= PROFESSIONAL_REGISTRY_MAX_LENGTH && PROFESSIONAL_IDENTIFIER_PATTERN.test(raw);
};

export const isNoFormalCouncil = (value: unknown): boolean => {
  const normalized = stripUnsafeControlCharacters(value)
    .toLocaleLowerCase('pt-BR')
    .replace(/[._/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized === 'sem conselho' || normalized.includes('sem conselho') || normalized.includes('outro registro');
};

const councilKey = (value: unknown) =>
  formatProfessionalCouncil(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

export const getProfessionalRegistryPlaceholder = (council: unknown, specialty?: unknown): string => {
  const key = councilKey(council);
  const specialtyKey = stripUnsafeControlCharacters(specialty).toLocaleLowerCase('pt-BR');
  if (key.startsWith('CRP') || specialtyKey.includes('psic')) return 'Ex.: 06/123456, 12345-P';
  if (key.startsWith('CREFITO') || specialtyKey.includes('ocupacional') || specialtyKey.includes('fisioter')) return 'Ex.: 12345-TO, 1234-F';
  if (key.startsWith('CRFA') || specialtyKey.includes('fono')) return 'Ex.: 12345, 12345-F';
  if (key.startsWith('CRM')) return 'Ex.: 123456, 123456-P';
  if (key.startsWith('COREN')) return 'Ex.: 123456-ENF';
  if (key.startsWith('CRN')) return 'Ex.: 12345, 12345-N';
  if (key.startsWith('CRBM')) return 'Ex.: 12345, 12345-BM';
  if (key.startsWith('CRTR')) return 'Ex.: 12345-T, 12345-TR';
  if (key.startsWith('MECREGISTROPROFISSIONAL')) return 'Ex.: diploma 000123/2026 ou registro profissional';
  if (isNoFormalCouncil(council)) return 'Diploma, registro docente ou outra identificação';
  return 'Letras e números; hífen e barra são aceitos';
};

export const getProfessionalRegistryGuidance = (council: unknown): string => {
  const key = councilKey(council);
  if (key.startsWith('CRP')) return 'Aceita variações como CRP, CRP-SP ou CRP 06 e registros alfanuméricos.';
  if (key.startsWith('CREFITO')) return 'Aceita CREFITO ou CREFITO-3 e registros como 12345-TO ou 1234-F.';
  if (key.startsWith('MECREGISTROPROFISSIONAL')) return 'Use o número do diploma, registro profissional ou outra identificação vinculada à formação. Sem máscara rígida.';
  if (isNoFormalCouncil(council)) return 'Use diploma, registro docente, identificação institucional ou outro registro aplicável. Sem máscara rígida.';
  return 'O formato é flexível: letras, números, espaços, hífens, barras, pontos e sufixos profissionais são aceitos.';
};
