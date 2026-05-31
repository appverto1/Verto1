export type AnamnesisProfileType = 'adult' | 'child';

export type AnamnesisQuestionType =
  | 'dissertativa'
  | 'multipla_escolha'
  | 'multipla_selecao'
  | 'data'
  | 'numero'
  | 'telefone'
  | 'sim_nao';

export interface AnamnesisSection {
  id: string;
  title: string;
  order: number;
  active: boolean;
}

export interface AnamnesisQuestion {
  id: string;
  sectionId: string;
  label: string;
  type: AnamnesisQuestionType;
  options?: string[];
  required: boolean;
  active: boolean;
  order: number;
}

export interface AnamnesisProfileTemplate {
  sections: AnamnesisSection[];
  questions: AnamnesisQuestion[];
}

export interface AnamnesisTemplate {
  version: number;
  profileType?: AnamnesisProfileType;
  profiles: Record<AnamnesisProfileType, AnamnesisProfileTemplate>;
  updatedAt?: string | null;
}

const COMMON_SECTIONS: AnamnesisSection[] = [
  { id: 'identificacao', title: 'Identificacao', order: 1, active: true },
  { id: 'cadastro_operacional', title: 'Cadastro Operacional (MVP)', order: 2, active: true },
  { id: 'responsavel_legal', title: 'Responsavel Legal (menor de idade)', order: 3, active: true },
  { id: 'personalizadas', title: 'Perguntas Personalizadas', order: 99, active: true }
];

const COMMON_QUESTIONS: AnamnesisQuestion[] = [
  { id: 'nome', sectionId: 'identificacao', label: 'Nome completo', type: 'dissertativa', required: true, active: true, order: 1 },
  { id: 'email', sectionId: 'identificacao', label: 'E-mail do paciente', type: 'dissertativa', required: false, active: true, order: 2 },
  { id: 'dataNascimento', sectionId: 'identificacao', label: 'Nascimento', type: 'data', required: false, active: true, order: 3 },
  { id: 'idade', sectionId: 'identificacao', label: 'Idade', type: 'numero', required: false, active: true, order: 4 },
  { id: 'genero', sectionId: 'identificacao', label: 'Genero', type: 'multipla_escolha', options: ['Feminino', 'Masculino', 'Nao-binario', 'Prefere nao informar'], required: false, active: true, order: 5 },
  { id: 'nomeSocial', sectionId: 'cadastro_operacional', label: 'Nome social', type: 'dissertativa', required: false, active: true, order: 1 },
  { id: 'telefone', sectionId: 'cadastro_operacional', label: 'Telefone', type: 'telefone', required: false, active: true, order: 2 },
  { id: 'grupo', sectionId: 'cadastro_operacional', label: 'Grupo', type: 'multipla_escolha', options: ['Infantil', 'Adolescente', 'Adulto', 'Idoso'], required: false, active: true, order: 3 },
  { id: 'convenioTipo', sectionId: 'cadastro_operacional', label: 'Convenio ou particular', type: 'multipla_escolha', options: ['Particular', 'Convenio'], required: false, active: true, order: 4 },
  { id: 'convenioNome', sectionId: 'cadastro_operacional', label: 'Convenio', type: 'dissertativa', required: false, active: true, order: 5 },
  { id: 'convenioCarteirinha', sectionId: 'cadastro_operacional', label: 'Numero da carteirinha', type: 'dissertativa', required: false, active: true, order: 6 },
  { id: 'comoConheceu', sectionId: 'cadastro_operacional', label: 'Como conheceu a clinica', type: 'multipla_escolha', options: ['Google', 'Indicacao', 'Email', 'WhatsApp', 'Rede social', 'Evento', 'Convenio', 'Outro'], required: false, active: true, order: 7 },
  { id: 'rg', sectionId: 'cadastro_operacional', label: 'RG', type: 'dissertativa', required: false, active: true, order: 8 },
  { id: 'cpf', sectionId: 'cadastro_operacional', label: 'CPF', type: 'dissertativa', required: false, active: true, order: 9 },
  { id: 'cep', sectionId: 'cadastro_operacional', label: 'CEP', type: 'dissertativa', required: false, active: true, order: 10 },
  { id: 'logradouro', sectionId: 'cadastro_operacional', label: 'Logradouro', type: 'dissertativa', required: false, active: true, order: 11 },
  { id: 'numero', sectionId: 'cadastro_operacional', label: 'Numero', type: 'dissertativa', required: false, active: true, order: 12 },
  { id: 'complemento', sectionId: 'cadastro_operacional', label: 'Complemento', type: 'dissertativa', required: false, active: true, order: 13 },
  { id: 'bairro', sectionId: 'cadastro_operacional', label: 'Bairro', type: 'dissertativa', required: false, active: true, order: 14 },
  { id: 'cidade', sectionId: 'cadastro_operacional', label: 'Cidade', type: 'dissertativa', required: false, active: true, order: 15 },
  { id: 'outrasInformacoes', sectionId: 'cadastro_operacional', label: 'Outras informacoes', type: 'dissertativa', required: false, active: true, order: 16 },
  { id: 'menorDeIdade', sectionId: 'responsavel_legal', label: 'Paciente menor de idade?', type: 'sim_nao', required: false, active: true, order: 1 },
  { id: 'responsavelNome', sectionId: 'responsavel_legal', label: 'Nome do responsavel', type: 'dissertativa', required: false, active: true, order: 2 },
  { id: 'responsavelDataNascimento', sectionId: 'responsavel_legal', label: 'Nascimento do responsavel', type: 'data', required: false, active: true, order: 3 },
  { id: 'responsavelCpf', sectionId: 'responsavel_legal', label: 'CPF do responsavel', type: 'dissertativa', required: false, active: true, order: 4 },
  { id: 'responsavelTelefone', sectionId: 'responsavel_legal', label: 'Telefone do responsavel', type: 'telefone', required: false, active: true, order: 5 },
  { id: 'responsavelEmail', sectionId: 'responsavel_legal', label: 'E-mail do responsavel', type: 'dissertativa', required: false, active: true, order: 6 },
  { id: 'responsavelRelacao', sectionId: 'responsavel_legal', label: 'Relacao com o paciente', type: 'dissertativa', required: false, active: true, order: 7 }
];

const ADULT_SECTIONS: AnamnesisSection[] = [
  { id: 'historia_clinica', title: 'Historia Atual e Motivo da Consulta', order: 10, active: true },
  { id: 'familia_ambiente', title: 'Familia e Ambiente', order: 11, active: true },
  { id: 'saude_rotina', title: 'Saude, Habitos e Rotina', order: 12, active: true },
  { id: 'processos_previos', title: 'Processos Terapeuticos Previos', order: 13, active: true }
];

const ADULT_QUESTIONS: AnamnesisQuestion[] = [
  { id: 'estadoCivil', sectionId: 'historia_clinica', label: 'Estado civil', type: 'multipla_escolha', options: ['Solteiro(a)', 'Casado(a)', 'Divorciado(a)', 'Uniao estavel', 'Outro'], required: false, active: true, order: 1 },
  { id: 'profissao', sectionId: 'historia_clinica', label: 'Profissao', type: 'dissertativa', required: false, active: true, order: 2 },
  { id: 'motivoConsulta', sectionId: 'historia_clinica', label: 'Motivo da consulta', type: 'dissertativa', required: true, active: true, order: 3 },
  { id: 'iniciativaTratamento', sectionId: 'historia_clinica', label: 'Iniciativa do tratamento', type: 'dissertativa', required: false, active: true, order: 4 },
  { id: 'expectativa', sectionId: 'historia_clinica', label: 'Expectativa com o processo terapeutico', type: 'dissertativa', required: false, active: true, order: 5 },
  { id: 'familiaConstituicao', sectionId: 'familia_ambiente', label: 'Constituicao familiar', type: 'dissertativa', required: false, active: true, order: 1 },
  { id: 'familiaClima', sectionId: 'familia_ambiente', label: 'Clima familiar atual', type: 'dissertativa', required: false, active: true, order: 2 },
  { id: 'vidaSocialGeral', sectionId: 'familia_ambiente', label: 'Como descreve a vida social', type: 'dissertativa', required: false, active: true, order: 3 },
  { id: 'dificuldadesSociais', sectionId: 'familia_ambiente', label: 'Dificuldades sociais percebidas', type: 'dissertativa', required: false, active: true, order: 4 },
  { id: 'sonoSonho', sectionId: 'saude_rotina', label: 'Qualidade do sono', type: 'dissertativa', required: false, active: true, order: 1 },
  { id: 'alimentacao', sectionId: 'saude_rotina', label: 'Alimentacao', type: 'dissertativa', required: false, active: true, order: 2 },
  { id: 'exercicio', sectionId: 'saude_rotina', label: 'Atividade fisica', type: 'dissertativa', required: false, active: true, order: 3 },
  { id: 'habitosNocivos', sectionId: 'saude_rotina', label: 'Habitos nocivos', type: 'dissertativa', required: false, active: true, order: 4 },
  { id: 'previoTipo', sectionId: 'processos_previos', label: 'Tipo de tratamento anterior', type: 'dissertativa', required: false, active: true, order: 1 },
  { id: 'previoDuracao', sectionId: 'processos_previos', label: 'Duracao do tratamento anterior', type: 'dissertativa', required: false, active: true, order: 2 },
  { id: 'previoMotivo', sectionId: 'processos_previos', label: 'Motivo da consulta anterior', type: 'dissertativa', required: false, active: true, order: 3 },
  { id: 'previoInterrupcao', sectionId: 'processos_previos', label: 'Motivo da interrupcao anterior', type: 'dissertativa', required: false, active: true, order: 4 }
];

const CHILD_SECTIONS: AnamnesisSection[] = [
  { id: 'escola', title: 'Escola e Aprendizagem', order: 10, active: true },
  { id: 'desenvolvimento', title: 'Desenvolvimento e Comportamento', order: 11, active: true },
  { id: 'saude_geral', title: 'Saude e Acompanhamentos', order: 12, active: true },
  { id: 'contexto_familiar', title: 'Contexto Familiar', order: 13, active: true }
];

const CHILD_QUESTIONS: AnamnesisQuestion[] = [
  { id: 'nomeEscola', sectionId: 'escola', label: 'Nome da escola', type: 'dissertativa', required: false, active: true, order: 1 },
  { id: 'tipoEscola', sectionId: 'escola', label: 'Tipo de escola', type: 'multipla_escolha', options: ['Publica', 'Privada', 'Mista'], required: false, active: true, order: 2 },
  { id: 'serie', sectionId: 'escola', label: 'Serie', type: 'dissertativa', required: false, active: true, order: 3 },
  { id: 'desenvolvimentoGestacional', sectionId: 'desenvolvimento', label: 'Resumo do desenvolvimento gestacional', type: 'dissertativa', required: false, active: true, order: 1 },
  { id: 'desenvolvimentoSocial', sectionId: 'desenvolvimento', label: 'Desenvolvimento social', type: 'dissertativa', required: false, active: true, order: 2 },
  { id: 'estereotipias', sectionId: 'desenvolvimento', label: 'Estereotipias observadas', type: 'dissertativa', required: false, active: true, order: 3 },
  { id: 'sensibilidades', sectionId: 'desenvolvimento', label: 'Sensibilidades sensoriais', type: 'dissertativa', required: false, active: true, order: 4 },
  { id: 'dificuldadesHabilidades', sectionId: 'desenvolvimento', label: 'Dificuldades e habilidades', type: 'dissertativa', required: false, active: true, order: 5 },
  { id: 'temDiagnostico', sectionId: 'saude_geral', label: 'Ja possui diagnostico?', type: 'sim_nao', required: false, active: true, order: 1 },
  { id: 'diagnosticoQual', sectionId: 'saude_geral', label: 'Qual diagnostico', type: 'dissertativa', required: false, active: true, order: 2 },
  { id: 'acompanhamentoMedico', sectionId: 'saude_geral', label: 'Acompanhamento medico atual', type: 'dissertativa', required: false, active: true, order: 3 },
  { id: 'medicacaoAtual', sectionId: 'saude_geral', label: 'Medicacao atual', type: 'dissertativa', required: false, active: true, order: 4 },
  { id: 'acompanhamentoMultidisciplinar', sectionId: 'saude_geral', label: 'Acompanhamento multidisciplinar', type: 'dissertativa', required: false, active: true, order: 5 },
  { id: 'nomeMae', sectionId: 'contexto_familiar', label: 'Nome da mae', type: 'dissertativa', required: false, active: true, order: 1 },
  { id: 'nomePaiBiologico', sectionId: 'contexto_familiar', label: 'Nome do pai', type: 'dissertativa', required: false, active: true, order: 2 },
  { id: 'irmaosIdade', sectionId: 'contexto_familiar', label: 'Irmaos e idades', type: 'dissertativa', required: false, active: true, order: 3 },
  { id: 'estadoCivilPais', sectionId: 'contexto_familiar', label: 'Estado civil dos pais', type: 'dissertativa', required: false, active: true, order: 4 },
  { id: 'pessoasMoramCrianca', sectionId: 'contexto_familiar', label: 'Quem mora com a crianca', type: 'dissertativa', required: false, active: true, order: 5 }
];

export const DEFAULT_ANAMNESIS_TEMPLATE: AnamnesisTemplate = {
  version: 1,
  profiles: {
    adult: {
      sections: [...COMMON_SECTIONS, ...ADULT_SECTIONS],
      questions: [...COMMON_QUESTIONS, ...ADULT_QUESTIONS]
    },
    child: {
      sections: [...COMMON_SECTIONS, ...CHILD_SECTIONS],
      questions: [...COMMON_QUESTIONS, ...CHILD_QUESTIONS]
    }
  }
};

const allowedTypes: AnamnesisQuestionType[] = ['dissertativa', 'multipla_escolha', 'multipla_selecao', 'data', 'numero', 'telefone', 'sim_nao'];

const asText = (value: unknown, max = 240): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const asBool = (value: unknown, fallback = true): boolean => (typeof value === 'boolean' ? value : fallback);
const asInt = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
};

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function normalizeQuestion(raw: any, fallback: AnamnesisQuestion, order: number): AnamnesisQuestion {
  const typeRaw = asText(raw?.type, 40) as AnamnesisQuestionType;
  const type = allowedTypes.includes(typeRaw) ? typeRaw : fallback.type;
  const options = Array.isArray(raw?.options) ? raw.options.map((opt: any) => asText(opt, 120)).filter(Boolean).slice(0, 30) : [];

  return {
    id: asText(raw?.id, 120) || fallback.id,
    sectionId: asText(raw?.sectionId, 120) || fallback.sectionId,
    label: asText(raw?.label, 240) || fallback.label,
    type,
    options: type === 'multipla_escolha' || type === 'multipla_selecao' ? (options.length ? options : (fallback.options || [])) : undefined,
    required: asBool(raw?.required, fallback.required),
    active: asBool(raw?.active, fallback.active),
    order: asInt(raw?.order, order)
  };
}

function normalizeProfile(rawProfile: any, fallbackProfile: AnamnesisProfileTemplate): AnamnesisProfileTemplate {
  const fallbackSections = deepClone(fallbackProfile.sections).sort((a, b) => a.order - b.order);
  const fallbackQuestions = deepClone(fallbackProfile.questions).sort((a, b) => a.order - b.order);

  const sectionsInput = Array.isArray(rawProfile?.sections) ? rawProfile.sections : fallbackSections;
  const sections = sectionsInput
    .map((section: any, index: number) => ({
      id: asText(section?.id, 120) || `section_${index + 1}`,
      title: asText(section?.title, 220) || `Seção ${index + 1}`,
      order: asInt(section?.order, index + 1),
      active: asBool(section?.active, true)
    }))
    .filter((section: AnamnesisSection) => section.id && section.title);

  const sectionIds = new Set(sections.map((section: AnamnesisSection) => section.id));
  const fallbackMap = new Map(fallbackQuestions.map((question) => [question.id, question]));

  const questionsInput = Array.isArray(rawProfile?.questions) ? rawProfile.questions : fallbackQuestions;
  const normalizedQuestions = questionsInput
    .map((question: any, index: number) => {
      const fallback = fallbackMap.get(asText(question?.id, 120)) || fallbackQuestions[index % fallbackQuestions.length];
      return normalizeQuestion(question, fallback, index + 1);
    })
    .filter((question: AnamnesisQuestion) => question.id && sectionIds.has(question.sectionId));

  return {
    sections: sections.sort((a, b) => a.order - b.order),
    questions: normalizedQuestions.sort((a, b) => a.order - b.order)
  };
}

function migrateLegacyTemplate(input: any): Partial<AnamnesisTemplate> {
  const looksLegacy = Array.isArray(input?.hiddenFields) || Array.isArray(input?.customQuestions);
  if (!looksLegacy) return {};

  const draft = deepClone(DEFAULT_ANAMNESIS_TEMPLATE);
  const hiddenSet = new Set(Array.isArray(input?.hiddenFields) ? input.hiddenFields : []);
  const deletedSet = new Set(Array.isArray(input?.deletedFields) ? input.deletedFields : []);
  const customQuestions = Array.isArray(input?.customQuestions) ? input.customQuestions : [];

  (['adult', 'child'] as AnamnesisProfileType[]).forEach((profileType) => {
    const profile = draft.profiles[profileType];
    profile.questions = profile.questions.map((question) => ({
      ...question,
      active: !(hiddenSet.has(question.id) || deletedSet.has(question.id))
    }));

    const extras = customQuestions
      .filter((q: any) => (q?.appliesTo || 'both') === 'both' || q?.appliesTo === profileType)
      .map((q: any, index: number): AnamnesisQuestion => ({
        id: asText(q?.id, 120) || `custom_${Date.now()}_${index}`,
        sectionId: 'personalizadas',
        label: asText(q?.label, 240) || `Pergunta personalizada ${index + 1}`,
        type: (allowedTypes.includes(asText(q?.type, 40) as AnamnesisQuestionType)
          ? asText(q?.type, 40)
          : 'dissertativa') as AnamnesisQuestionType,
        options: Array.isArray(q?.options) ? q.options.map((opt: any) => asText(opt, 120)).filter(Boolean).slice(0, 30) : [],
        required: Boolean(q?.required),
        active: q?.active !== false,
        order: 900 + index
      }));

    profile.questions.push(...extras);
  });

  return draft;
}

export function getDefaultAnamnesisTemplate(): AnamnesisTemplate {
  return deepClone(DEFAULT_ANAMNESIS_TEMPLATE);
}

export function normalizeAnamnesisTemplate(input: any): AnamnesisTemplate {
  const fallback = getDefaultAnamnesisTemplate();
  const migrated = migrateLegacyTemplate(input);
  const source = { ...fallback, ...migrated, ...(input || {}) };
  const adult = normalizeProfile(source?.profiles?.adult, fallback.profiles.adult);
  const child = normalizeProfile(source?.profiles?.child, fallback.profiles.child);

  return {
    version: Math.max(1, asInt(source?.version, 1)),
    profileType: source?.profileType === 'child' ? 'child' : 'adult',
    profiles: {
      adult,
      child
    },
    updatedAt: asText(source?.updatedAt, 80) || null
  };
}

export function getProfileTemplate(template: AnamnesisTemplate, profileType: AnamnesisProfileType): AnamnesisProfileTemplate {
  return template.profiles[profileType];
}

export function buildQuestionLabelMap(template: AnamnesisTemplate): Record<string, string> {
  const map: Record<string, string> = {};
  (['adult', 'child'] as AnamnesisProfileType[]).forEach((profile) => {
    template.profiles[profile].questions.forEach((question) => {
      if (!map[question.id]) map[question.id] = question.label;
    });
  });
  return map;
}
