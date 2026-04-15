import React, { useState, useEffect, useRef } from 'react';
import { X, Baby, UserPlus, FileText, User, ChevronDown, Phone, Eye, Briefcase, Heart, Check, ShoppingBag, Rocket, ClipboardList } from 'lucide-react';

interface CustomQuestion {
  id: string;
  label: string;
  type: 'dissertativa' | 'multipla_escolha' | 'multipla_selecao';
  options: string[];
  active: boolean;
  required: boolean;
  appliesTo: 'adult' | 'child' | 'both';
}

interface AnamnesisTemplate {
  hiddenFields: string[];
  deletedFields?: string[];
  customQuestions: CustomQuestion[];
}

export const AnamnesisModal = ({
  isOpen,
  onClose,
  initialData,
  onSave,
  mode = 'create',
  template,
  onTemplateSave,
  canEditTemplate = false
}: any) => { 
  const insuranceOptions = [
    "Particular",
    "Unimed",
    "Amil",
    "Bradesco SaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºde",
    "SulAmÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©rica",
    "Hapvida",
    "NotreDame IntermÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©dica",
    "Care Plus",
    "Omint",
    "Porto Seguro SaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºde",
    "Golden Cross",
    "Seguros Unimed",
    "Samp",
    "SÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o CristÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³vÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o SaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºde",
    "CASSI",
    "Geap",
    "IPSEMG",
    "Cabesp",
    "Afresp",
    "Outro"
  ];

  const operationalDefaults = {
    nomeSocial: "",
    convenioTipo: "particular",
    convenioNome: "",
    convenioCarteirinha: "",
    grupo: "",
    comoConheceu: "",
    rg: "",
    cpf: "",
    cep: "",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    outrasInformacoes: "",
    menorDeIdade: false,
    responsavelNome: "",
    responsavelDataNascimento: "",
    responsavelCpf: "",
    responsavelTelefone: ""
  };

  const defaultData = { 
    nome: "", email: "", dataNascimento: "", idade: "", genero: "", estadoCivil: "", profissao: "", religiao: "", endereco: "", telefone: "", pessoaReferencia: "", telefoneReferencia: "", familiaHabita: "", familiaConstituicao: "", familiaClima: "", paiDados: "", paiRelacaoPassada: "", paiRelacaoAtual: "", maeDados: "", maeRelacaoPassada: "", maeRelacaoAtual: "", irmaosDados: "", irmaosRelacaoPassada: "", irmaosRelacaoAtual: "", parDados: "", parRelacaoPassada: "", parRelacaoAtual: "", filhosDados: "", filhosRelacaoPassada: "", filhosRelacaoAtual: "", outrosDados: "", outrosRelacaoPassada: "", outrosRelacaoAtual: "", relacoesProfissionais: "", relacoesAfetivas: "", relacoesSignificativas: "", vidaSocialGeral: "", dificuldadesSociais: "", grauInstrucao: "", descProfissional: "", dificuldadesLaborais: "", situacaoEconomica: "", dependenciaEconomica: "", alimentacao: "", sonoSonho: "", limpezaHigiene: "", exercicio: "", controleMedico: "", habitosNocivos: "", outrosTratamentos: "", contatoProfSaude: "", interesses: "", disponibilidadeTempo: "", empregoTempoLivre: "", interessesPotenciais: "", atividadesIndividuais: "", atividadesGrupais: "", motivoConsulta: "", iniciativaTratamento: "", referenciaTerapeuta: "", expectativa: "", previoTipo: "", previoDuracao: "", previoMotivo: "", previoInterrupcao: "",
    // CrianÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§a Script Fields
    dataHoje: new Date().toISOString().split('T')[0],
    profissional: "Dra. RaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­sa",
    crp: "06/123456",
    nomeEscola: "",
    tipoEscola: "",
    serie: "",
    nomeMae: "",
    nomePaiBiologico: "",
    irmaosIdade: "",
    estadoCivilPais: "",
    idadeSeparacao: "",
    pessoasMoramCrianca: "",
    temDiagnostico: "NÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o",
    diagnosticoQual: "",
    acompanhamentoMedico: "",
    medicacaoAtual: "",
    acompanhamentoMultidisciplinar: "",
    desenvolvimentoGestacional: "",
    comportamentoSono: "",
    comportamentoAlimentacao: "",
    desenvolvimentoSocial: "",
    estereotipias: "",
    sensibilidades: "",
    dificuldadesHabilidades: "",
    historicoMedicoCrianca: "",
    historicoMedicoFamilia: "",
    interessesReforcadores: "",
    ...operationalDefaults
  }; 
  
  const [formType, setFormType] = useState('adult'); 
  const [formData, setFormData] = useState<any>(defaultData); 
  const [scheduleImmediate, setScheduleImmediate] = useState(false); 
  const [registerDate, setRegisterDate] = useState(""); 
  const [registerTime, setRegisterTime] = useState(""); 
  const [consultationApproach, setConsultationApproach] = useState(""); 
  const [consultationRoom, setConsultationRoom] = useState(""); 
  const [consultationProfessional, setConsultationProfessional] = useState("Dra. RaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­sa");
  const defaultTemplateState: AnamnesisTemplate = { hiddenFields: [], deletedFields: [], customQuestions: [] };
  const fixedQuestionCatalog: Array<{ key: string; label: string }> = [
    { key: "nome", label: "Nome completo" },
    { key: "nomeSocial", label: "Nome social" },
    { key: "telefone", label: "Telefone" },
    { key: "dataNascimento", label: "Data de nascimento" },
    { key: "genero", label: "GÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªnero" },
    { key: "convenioTipo", label: "ConvÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªnio ou particular" },
    { key: "convenioNome", label: "ConvÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªnio" },
    { key: "convenioCarteirinha", label: "NÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºmero da carteirinha" },
    { key: "grupo", label: "Grupo" },
    { key: "comoConheceu", label: "Como conheceu a clÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­nica" },
    { key: "rg", label: "RG" },
    { key: "cpf", label: "CPF" },
    { key: "cep", label: "CEP" },
    { key: "logradouro", label: "Logradouro" },
    { key: "numero", label: "NÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºmero" },
    { key: "complemento", label: "Complemento" },
    { key: "bairro", label: "Bairro" },
    { key: "cidade", label: "Cidade" },
    { key: "outrasInformacoes", label: "Outras informaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âµes" },
    { key: "menorDeIdade", label: "Paciente menor de idade" },
    { key: "responsavelNome", label: "Nome do responsÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡vel" },
    { key: "responsavelDataNascimento", label: "Nascimento do responsÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡vel" },
    { key: "responsavelCpf", label: "CPF do responsÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡vel" },
    { key: "responsavelTelefone", label: "Telefone do responsÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡vel" },
    { key: "section_familia_ambiente", label: "SeÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o: FamÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­lia e Ambiente" },
    { key: "section_relacoes_sociais", label: "SeÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o: RelaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âµes Sociais" },
    { key: "section_profissional", label: "SeÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o: Profissional" },
    { key: "section_saude_higiene", label: "SeÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o: SaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºde e Higiene Pessoal" },
    { key: "section_hobbies_tempo_livre", label: "SeÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o: Hobbies e Tempo Livre" },
    { key: "section_desenvolvimento_pessoal", label: "SeÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o: Desenvolvimento Pessoal" },
    { key: "section_historia_motivo", label: "SeÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o: HistÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³ria Atual e Motivo da Consulta" },
    { key: "section_processos_previos", label: "SeÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o: Processos TerapÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªuticos PrÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©vios" }
  ];
  const [templateState, setTemplateState] = useState<AnamnesisTemplate>(defaultTemplateState);
  const [selectedFixedFields, setSelectedFixedFields] = useState<string[]>([]);
  const [newQuestionLabel, setNewQuestionLabel] = useState("");
  const [newQuestionType, setNewQuestionType] = useState<'dissertativa' | 'multipla_escolha' | 'multipla_selecao'>('dissertativa');
  const [newQuestionOptions, setNewQuestionOptions] = useState("");
  const [newQuestionAppliesTo, setNewQuestionAppliesTo] = useState<'adult' | 'child' | 'both'>('both'); 
  const modalContentRef = useRef<HTMLDivElement>(null);
  const decodeLatin1ToUtf8 = (input: string) => {
    try {
      const bytes = Uint8Array.from(Array.from(input).map((char) => char.charCodeAt(0) & 0xff));
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch {
      return input;
    }
  };

  const repairMojibakeText = (value: string) => {
    let output = String(value || "");
    if (!output) return "";

    for (let i = 0; i < 4; i++) {
      if (!/[ÃÂâï]/.test(output)) break;
      const decoded = decodeLatin1ToUtf8(output);
      if (!decoded || decoded === output) break;
      output = decoded;
    }

    return output
      .replaceAll("Ã¡", "á")
      .replaceAll("Ãà", "à")
      .replaceAll("Ã¢", "â")
      .replaceAll("Ãã", "ã")
      .replaceAll("Ãé", "é")
      .replaceAll("Ãê", "ê")
      .replaceAll("Ãí", "í")
      .replaceAll("Ãó", "ó")
      .replaceAll("Ãô", "ô")
      .replaceAll("Ãõ", "õ")
      .replaceAll("Ãú", "ú")
      .replaceAll("Ãç", "ç")
      .replaceAll("ÃÁ", "Á")
      .replaceAll("ÃÉ", "É")
      .replaceAll("ÃÍ", "Í")
      .replaceAll("ÃÓ", "Ó")
      .replaceAll("ÃÚ", "Ú")
      .replaceAll("ÃÇ", "Ç")
      .replaceAll("Â", "")
      .replaceAll("�", "");
  };

useEffect(() => { 
    if (isOpen) { 
      if (initialData) { setFormData({ ...defaultData, ...initialData }); } 
      else { setFormData(defaultData); } 
      setScheduleImmediate(false); setRegisterDate(""); setRegisterTime(""); 
    } 
  }, [isOpen, initialData]); 

  useEffect(() => {
    setTemplateState({
      hiddenFields: Array.isArray(template?.hiddenFields) ? template.hiddenFields : [],
      deletedFields: Array.isArray(template?.deletedFields) ? template.deletedFields : [],
      customQuestions: Array.isArray(template?.customQuestions) ? template.customQuestions : []
    });
    setSelectedFixedFields([]);
  }, [template]);

  useEffect(() => {
    if (!isOpen) return;
    const fieldLabelMap: Record<string, string> = {
      nome: "Nome Completo",
      nomeSocial: "Nome Social",
      telefone: "Telefone",
      genero: "Genero",
      convenioNome: "Convenio",
      convenioCarteirinha: "Carteirinha",
      rg: "RG",
      cpf: "CPF",
      responsavelNome: "Nome do responsavel",
      responsavelCpf: "CPF do responsavel"
    };

    const normalize = (txt: string) =>
      txt
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();

    Object.entries(fieldLabelMap).forEach(([field, label]) => {
      const needle = normalize(label);
      document.querySelectorAll("label").forEach((el) => {
        const text = normalize((el.textContent || "").replace(/\s+/g, " "));
        if (!text.includes(needle)) return;
        const wrapper = el.closest("div");
        if (!wrapper) return;
        wrapper.setAttribute("data-anamnesis-field", field);
        wrapper.setAttribute("style", templateState.hiddenFields.includes(field) ? "display:none;" : "display:block;");
      });
    });
  }, [templateState, isOpen, formType]);

  useEffect(() => {
    if (!isOpen || !modalContentRef.current) return;
    const root = modalContentRef.current;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let currentNode = walker.nextNode();
    while (currentNode) {
      const textNode = currentNode as Text;
      const original = textNode.nodeValue || "";
      const repaired = repairMojibakeText(original);
      if (repaired !== original) {
        textNode.nodeValue = repaired;
      }
      currentNode = walker.nextNode();
    }

    root.querySelectorAll<HTMLElement>("*").forEach((element) => {
      const placeholder = element.getAttribute("placeholder");
      if (placeholder) element.setAttribute("placeholder", repairMojibakeText(placeholder));
      const title = element.getAttribute("title");
      if (title) element.setAttribute("title", repairMojibakeText(title));
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel) element.setAttribute("aria-label", repairMojibakeText(ariaLabel));
    });
  }, [isOpen, formType, templateState]);

  const handleChange = (field: string, value: any) => { 
    setFormData((prev: any) => {
      const newData = { ...prev, [field]: value };
      
      if (field === 'dataNascimento' && value) {
        const birthDate = new Date(value);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
          age--;
        }
        if (age >= 0) {
          newData.idade = age.toString();
        }
      }
      
      return newData;
    }); 
  }; 
  const isFieldDeleted = (field: string) => Boolean(templateState.deletedFields?.includes(field));
  const isFieldActive = (field: string) => !templateState.hiddenFields.includes(field) && !isFieldDeleted(field);
  const relationshipEntities = ['Pai', 'Mae', 'Irmaos', 'Par', 'Filhos', 'Outros Membros Significativos'];
  const visibleRelationshipEntities = relationshipEntities.filter((entity) => {
    if (entity === 'Filhos') return isFieldActive('filhosDados');
    if (entity === 'Outros Membros Significativos') return isFieldActive('outrosDados');
    return true;
  });

  const toggleFixedFieldSelection = (field: string) => {
    setSelectedFixedFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  };

  const applyFixedFieldAction = (action: "inactivate" | "exclude" | "restore") => {
    if (selectedFixedFields.length === 0) return;
    setTemplateState((prev) => {
      const deleted = new Set(prev.deletedFields || []);
      const hidden = new Set(prev.hiddenFields || []);
      selectedFixedFields.forEach((field) => {
        if (action === "inactivate") {
          hidden.add(field);
          deleted.delete(field);
        }
        if (action === "exclude") {
          hidden.add(field);
          deleted.add(field);
        }
        if (action === "restore") {
          hidden.delete(field);
          deleted.delete(field);
        }
      });
      return {
        ...prev,
        hiddenFields: Array.from(hidden),
        deletedFields: Array.from(deleted)
      };
    });
    setSelectedFixedFields([]);
  };

  const handleAddCustomQuestion = () => {
    if (!newQuestionLabel.trim()) return;
    const options = newQuestionOptions
      .split(",")
      .map((opt) => opt.trim())
      .filter(Boolean);

    const question: CustomQuestion = {
      id: `cq_${Date.now()}`,
      label: newQuestionLabel.trim(),
      type: newQuestionType,
      options: newQuestionType === "dissertativa" ? [] : options,
      active: true,
      required: false,
      appliesTo: newQuestionAppliesTo
    };

    setTemplateState((prev) => ({ ...prev, customQuestions: [...prev.customQuestions, question] }));
    setNewQuestionLabel("");
    setNewQuestionType("dissertativa");
    setNewQuestionOptions("");
    setNewQuestionAppliesTo("both");
  };

  const removeCustomQuestion = (id: string) => {
    setTemplateState((prev) => ({ ...prev, customQuestions: prev.customQuestions.filter((q) => q.id !== id) }));
  };

  const toggleCustomQuestionActive = (id: string) => {
    setTemplateState((prev) => ({
      ...prev,
      customQuestions: prev.customQuestions.map((q) => q.id === id ? { ...q, active: !q.active } : q)
    }));
  };

  const updateCustomQuestion = (id: string, updates: Partial<CustomQuestion>) => {
    setTemplateState((prev) => ({
      ...prev,
      customQuestions: prev.customQuestions.map((q) => {
        if (q.id !== id) return q;
        const next = { ...q, ...updates };
        if (next.type === 'dissertativa') {
          next.options = [];
        } else if (!Array.isArray(next.options)) {
          next.options = [];
        }
        return next;
      })
    }));
  };

  const saveTemplate = async () => {
    if (!onTemplateSave) return;
    await onTemplateSave(templateState);
    alert("Template de anamnese salvo para a clÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­nica.");
  };

  const handleSubmit = () => { 
    const payload = { ...formData, formType, anamnesisTemplateVersion: templateState, ...(mode === 'create' && scheduleImmediate ? { scheduleImmediate, date: registerDate, time: registerTime, approach: consultationApproach, room: consultationRoom, professional: consultationProfessional } : {}) }; 
    onSave(payload); onClose(); 
  }; 

  if (!isOpen) return null; 

  return ( 
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}> 
      <div ref={modalContentRef} className="bg-white w-full max-w-4xl rounded-[32px] p-8 shadow-2xl animate-pop relative max-h-[90vh] overflow-y-auto custom-scrollbar" onClick={e => e.stopPropagation()}> 
        <div className="absolute top-6 right-6 flex items-center gap-3">
          <div className="bg-gray-100 p-1 rounded-xl flex gap-1">
            <button onClick={() => setFormType('adult')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${formType === 'adult' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400'}`}>Adulto</button>
            <button onClick={() => setFormType('child')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${formType === 'child' ? 'bg-white text-[#7a32fc] shadow-sm' : 'text-gray-400'}`}>CrianÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â§a</button>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-red-500 transition-colors p-2"><X size={24}/></button> 
        </div>

        <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2"> 
          <div className="p-2 bg-[#7a32fc]/10 rounded-xl text-[#7a32fc]">{formType === 'child' ? <Baby size={24}/> : (mode === 'create' ? <UserPlus size={24} /> : <FileText size={24}/>)}</div> 
          {mode === 'create' ? `ProntuÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡rio de AdmissÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â£o (${formType === 'child' ? 'CrianÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â§a' : 'Adulto'})` : `Editar Ficha (${formType === 'child' ? 'CrianÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â§a' : 'Adulto'})`} 
        </h2> 

        {canEditTemplate && (
          <details className="mb-4 bg-white border border-[#7a32fc]/20 rounded-2xl overflow-hidden group">
            <summary className="p-4 cursor-pointer font-bold text-[#7a32fc] flex justify-between items-center group-open:bg-[#F4F7FE] transition-colors">
              PersonalizaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o da Ficha da ClÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­nica
              <ChevronDown className="group-open:rotate-180 transition-transform text-[#7a32fc]" size={20}/>
            </summary>
            <div className="p-4 border-t border-[#7a32fc]/10 space-y-4">
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-600 uppercase tracking-wider">Perguntas fixas (selecione para gerenciar)</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  {fixedQuestionCatalog.map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2 border border-gray-200">
                      <input
                        type="checkbox"
                        checked={selectedFixedFields.includes(key)}
                        onChange={() => toggleFixedFieldSelection(key)}
                      />
                      <span className="font-semibold text-gray-700">{label}</span>
                      <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        isFieldDeleted(key)
                          ? "bg-red-100 text-red-600"
                          : isFieldActive(key)
                            ? "bg-green-100 text-green-600"
                            : "bg-yellow-100 text-yellow-700"
                      }`}>
                        {isFieldDeleted(key) ? "EXCLUÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¯ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¿ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â½DA" : isFieldActive(key) ? "ATIVA" : "INATIVA"}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <button type="button" onClick={() => applyFixedFieldAction("inactivate")} className="bg-yellow-100 text-yellow-800 rounded-xl py-2 text-[11px] font-bold uppercase tracking-wider">Inativar selecionadas</button>
                  <button type="button" onClick={() => applyFixedFieldAction("exclude")} className="bg-red-100 text-red-700 rounded-xl py-2 text-[11px] font-bold uppercase tracking-wider">Excluir selecionadas</button>
                  <button type="button" onClick={() => applyFixedFieldAction("restore")} className="bg-green-100 text-green-700 rounded-xl py-2 text-[11px] font-bold uppercase tracking-wider">Restaurar selecionadas</button>
                  <button
                    type="button"
                    onClick={() => {
                      setTemplateState(defaultTemplateState);
                      setSelectedFixedFields([]);
                    }}
                    className="bg-[#F4F7FE] text-[#7a32fc] rounded-xl py-2 text-[11px] font-bold uppercase tracking-wider"
                  >
                    ? Restaurar ficha original
                  </button>
                </div>
              </div>

              <div className="bg-gray-50 rounded-2xl border border-gray-200 p-3 space-y-3">
                <p className="text-xs font-bold text-gray-600 uppercase tracking-wider">Adicionar pergunta personalizada</p>
                <input type="text" value={newQuestionLabel} onChange={(e) => setNewQuestionLabel(e.target.value)} placeholder="Pergunta" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <select value={newQuestionType} onChange={(e) => setNewQuestionType(e.target.value as any)} className="bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none">
                    <option value="dissertativa">Dissertativa</option>
                    <option value="multipla_escolha">MÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºltipla escolha (1)</option>
                    <option value="multipla_selecao">MÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºltipla seleÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o</option>
                  </select>
                  <select value={newQuestionAppliesTo} onChange={(e) => setNewQuestionAppliesTo(e.target.value as any)} className="bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none">
                    <option value="both">Adulto e CrianÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§a</option>
                    <option value="adult">SÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³ Adulto</option>
                    <option value="child">SÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³ CrianÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§a</option>
                  </select>
                  <button type="button" onClick={handleAddCustomQuestion} className="bg-[#7a32fc] text-white rounded-xl font-bold text-xs uppercase tracking-wider">Adicionar</button>
                </div>
                {newQuestionType !== "dissertativa" && (
                  <input type="text" value={newQuestionOptions} onChange={(e) => setNewQuestionOptions(e.target.value)} placeholder="OpÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âµes separadas por vÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­rgula" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none" />
                )}
              </div>

              {templateState.customQuestions.length > 0 && (
                <div className="space-y-2">
                  {templateState.customQuestions.map((q) => (
                    <div key={q.id} className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={q.label}
                          onChange={(e) => updateCustomQuestion(q.id, { label: e.target.value })}
                          className="bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none"
                          placeholder="Pergunta"
                        />
                        <select
                          value={q.type}
                          onChange={(e) => updateCustomQuestion(q.id, { type: e.target.value as CustomQuestion["type"] })}
                          className="bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none"
                        >
                          <option value="dissertativa">Dissertativa</option>
                          <option value="multipla_escolha">MÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºltipla escolha (1)</option>
                          <option value="multipla_selecao">MÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºltipla seleÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o</option>
                        </select>
                        <select
                          value={q.appliesTo}
                          onChange={(e) => updateCustomQuestion(q.id, { appliesTo: e.target.value as CustomQuestion["appliesTo"] })}
                          className="bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none"
                        >
                          <option value="both">Adulto e CrianÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§a</option>
                          <option value="adult">SÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³ Adulto</option>
                          <option value="child">SÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³ CrianÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§a</option>
                        </select>
                        <label className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold text-gray-700">
                          <input
                            type="checkbox"
                            checked={Boolean(q.required)}
                            onChange={(e) => updateCustomQuestion(q.id, { required: e.target.checked })}
                          />
                          ObrigatÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³ria
                        </label>
                      </div>
                      {q.type !== "dissertativa" && (
                        <input
                          type="text"
                          value={q.options.join(", ")}
                          onChange={(e) =>
                            updateCustomQuestion(q.id, {
                              options: e.target.value
                                .split(",")
                                .map((opt) => opt.trim())
                                .filter(Boolean),
                            })
                          }
                          className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none"
                          placeholder="OpÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âµes separadas por vÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­rgula"
                        />
                      )}
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => toggleCustomQuestionActive(q.id)} className={`px-2 py-1 rounded-lg text-[10px] font-bold ${q.active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                          {q.active ? "ATIVA" : "INATIVA"}
                        </button>
                        <button type="button" onClick={() => removeCustomQuestion(q.id)} className="px-2 py-1 rounded-lg text-[10px] font-bold bg-red-100 text-red-600">
                          Remover
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button type="button" onClick={saveTemplate} className="w-full bg-[#7a32fc] text-white rounded-xl py-2 text-xs font-bold uppercase tracking-wider">
                Salvar PersonalizaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o da ClÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­nica
              </button>
            </div>
          </details>
        )}

        <div className="space-y-4"> 
          <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200"> 
            <h3 className="text-sm font-bold text-[#7a32fc] uppercase tracking-wider mb-4 flex items-center gap-2"><User size={16} /> IdentificaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o</h3> 
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4"> 
              {isFieldActive('nome') && <div className="md:col-span-2"><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Nome Completo</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.nome} onChange={e => handleChange('nome', e.target.value)} /></div>} 
              <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. E-mail do Paciente</label><input type="email" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" placeholder="paciente@email.com" value={formData.email} onChange={e => handleChange('email', e.target.value)} /></div>
              <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. Nascimento</label><input type="date" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.dataNascimento} onChange={e => handleChange('dataNascimento', e.target.value)} /></div> 
              <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">4. Idade</label><input type="number" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.idade} onChange={e => handleChange('idade', e.target.value)} /></div> 
              {isFieldActive('genero') && <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">5. GÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªnero</label><select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.genero} onChange={e => handleChange('genero', e.target.value)}><option value="">Selecione...</option><option value="Masculino">Masculino</option><option value="Feminino">Feminino</option><option value="Outro">Outro</option></select></div>} 
              {formType === 'child' && (
                <React.Fragment>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Data de Hoje</label><input type="date" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.dataHoje} onChange={e => handleChange('dataHoje', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Profissional</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.profissional} onChange={e => handleChange('profissional', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">CRP</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.crp} onChange={e => handleChange('crp', e.target.value)} /></div>
                </React.Fragment>
              )}
              <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">6. ReligiÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.religiao} onChange={e => handleChange('religiao', e.target.value)} /></div>
              {formType === 'adult' ? (
                <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">7. Estado Civil</label><select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.estadoCivil} onChange={e => handleChange('estadoCivil', e.target.value)}><option value="">Selecione...</option><option value="Solteiro(a)">Solteiro(a)</option><option value="Casado(a)">Casado(a)</option><option value="Divorciado(a)">Divorciado(a)</option><option value="ViÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºvo(a)">ViÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºvo(a)</option></select></div>
              ) : (
                <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">7. SÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©rie</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.serie} onChange={e => handleChange('serie', e.target.value)} placeholder="Ex: 2ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âº ano Fundamental" /></div>
              )}
              <div className="md:col-span-1"><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">{formType === 'child' ? '8. Nome da MÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£e' : '8. ProfissÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o'}</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formType === 'child' ? formData.nomeMae : formData.profissao} onChange={e => handleChange(formType === 'child' ? 'nomeMae' : 'profissao', e.target.value)} /></div> 
            </div> 
          </div>

          <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
            <h3 className="text-sm font-bold text-[#7a32fc] uppercase tracking-wider mb-4 flex items-center gap-2">
              <Phone size={16} /> Cadastro Operacional (MVP)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nome Social</label>
                <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.nomeSocial} onChange={e => handleChange('nomeSocial', e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Telefone</label>
                <input type="tel" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.telefone} onChange={e => handleChange('telefone', e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Grupo</label>
                <select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.grupo} onChange={e => handleChange('grupo', e.target.value)}>
                  <option value="">Selecione...</option>
                  <option value="infantil">Infantil</option>
                  <option value="adolescente">Adolescente</option>
                  <option value="adulto">Adulto</option>
                  <option value="idoso">Idoso</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">ConvÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªnio ou Particular</label>
                <select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.convenioTipo} onChange={e => handleChange('convenioTipo', e.target.value)}>
                  <option value="particular">Particular</option>
                  <option value="convenio">ConvÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªnio</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">ConvÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªnio</label>
                <select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.convenioNome} onChange={e => handleChange('convenioNome', e.target.value)}>
                  <option value="">Selecione...</option>
                  {insuranceOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">NÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âº Carteirinha (ConvÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªnio)</label>
                <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.convenioCarteirinha} onChange={e => handleChange('convenioCarteirinha', e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Como conheceu a clÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­nica</label>
                <select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.comoConheceu} onChange={e => handleChange('comoConheceu', e.target.value)}>
                  <option value="">Selecione...</option>
                  <option value="Google">Google</option>
                  <option value="IndicaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o">IndicaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o</option>
                  <option value="Email">Email</option>
                  <option value="WhatsApp">WhatsApp</option>
                  <option value="Rede Social">Rede Social</option>
                  <option value="Evento">Evento</option>
                  <option value="ConvÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªnio">ConvÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªnio</option>
                  <option value="Outro">Outro</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">RG</label>
                <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.rg} onChange={e => handleChange('rg', e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">CPF</label>
                <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.cpf} onChange={e => handleChange('cpf', e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">CEP</label>
                <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.cep} onChange={e => handleChange('cep', e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Logradouro</label>
                <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.logradouro} onChange={e => handleChange('logradouro', e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">NÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºmero</label>
                <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.numero} onChange={e => handleChange('numero', e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Complemento</label>
                <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.complemento} onChange={e => handleChange('complemento', e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Bairro</label>
                <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.bairro} onChange={e => handleChange('bairro', e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Cidade</label>
                <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.cidade} onChange={e => handleChange('cidade', e.target.value)} />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Outras informaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âµes</label>
                <textarea className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc] resize-none" rows={3} value={formData.outrasInformacoes} onChange={e => handleChange('outrasInformacoes', e.target.value)} />
              </div>
              <div className="md:col-span-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={Boolean(formData.menorDeIdade)} onChange={e => handleChange('menorDeIdade', e.target.checked)} />
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Paciente menor de idade</span>
                </label>
              </div>
              {formData.menorDeIdade && (
                <React.Fragment>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nome do responsÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡vel</label>
                    <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.responsavelNome} onChange={e => handleChange('responsavelNome', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nascimento do responsÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡vel</label>
                    <input type="date" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.responsavelDataNascimento} onChange={e => handleChange('responsavelDataNascimento', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">CPF do responsÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡vel</label>
                    <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.responsavelCpf} onChange={e => handleChange('responsavelCpf', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Telefone do responsÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡vel</label>
                    <input type="tel" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.responsavelTelefone} onChange={e => handleChange('responsavelTelefone', e.target.value)} />
                  </div>
                </React.Fragment>
              )}
            </div>
          </div>

          {templateState.customQuestions.filter((q) => q.active && (q.appliesTo === 'both' || q.appliesTo === formType)).length > 0 && (
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
              <h3 className="text-sm font-bold text-[#7a32fc] uppercase tracking-wider mb-4 flex items-center gap-2">
                <ClipboardList size={16} /> Perguntas Personalizadas da ClÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­nica
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {templateState.customQuestions
                  .filter((q) => q.active && (q.appliesTo === 'both' || q.appliesTo === formType))
                  .map((q) => (
                    <div key={q.id} className="md:col-span-2">
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">{q.label}</label>
                      {q.type === 'dissertativa' && (
                        <textarea
                          className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc] resize-none"
                          rows={3}
                          value={formData[`custom_${q.id}`] || ""}
                          onChange={(e) => handleChange(`custom_${q.id}`, e.target.value)}
                        />
                      )}
                      {q.type === 'multipla_escolha' && (
                        <select
                          className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]"
                          value={formData[`custom_${q.id}`] || ""}
                          onChange={(e) => handleChange(`custom_${q.id}`, e.target.value)}
                        >
                          <option value="">Selecione...</option>
                          {q.options.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      )}
                      {q.type === 'multipla_selecao' && (
                        <div className="grid grid-cols-2 gap-2">
                          {q.options.map((opt) => {
                            const current = Array.isArray(formData[`custom_${q.id}`]) ? formData[`custom_${q.id}`] : [];
                            const checked = current.includes(opt);
                            return (
                              <label key={opt} className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold text-gray-600">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = e.target.checked ? [...current, opt] : current.filter((c: string) => c !== opt);
                                    handleChange(`custom_${q.id}`, next);
                                  }}
                                />
                                {opt}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {formType === 'child' ? (
            <React.Fragment>
              <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
                <h3 className="text-sm font-bold text-[#7a32fc] uppercase tracking-wider mb-4 flex items-center gap-2"><UserPlus size={16} /> FamÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­lia e Contato</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Telefone de Contato</label><input type="tel" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" placeholder="(00) 00000-0000" value={formData.telefone} onChange={e => handleChange('telefone', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">EndereÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§o</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.endereco} onChange={e => handleChange('endereco', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nome do Pai BiolÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³gico</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.nomePaiBiologico} onChange={e => handleChange('nomePaiBiologico', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nome de IrmÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£os e Idade</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.irmaosIdade} onChange={e => handleChange('irmaosIdade', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Estado Civil dos Pais BiolÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³gicos</label><select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.estadoCivilPais} onChange={e => handleChange('estadoCivilPais', e.target.value)}><option value="">Selecione...</option><option value="Casados">Casados</option><option value="Separados">Separados</option><option value="Divorciados">Divorciados</option><option value="Outro">Outro</option></select></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Se separados: Idade da crianÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§a na ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©poca</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.idadeSeparacao} onChange={e => handleChange('idadeSeparacao', e.target.value)} /></div>
                  <div className="md:col-span-2"><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Pessoas que atualmente moram com a crianÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§a</label><textarea className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc] resize-none" rows={2} value={formData.pessoasMoramCrianca} onChange={e => handleChange('pessoasMoramCrianca', e.target.value)}></textarea></div>
                </div>
              </div>

              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group" open>
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors">DiagnÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³stico e MedicaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o<ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-4 border-t border-gray-100">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">A crianÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§a jÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ tem algum diagnÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³stico?</label><select className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-xs outline-none" value={formData.temDiagnostico} onChange={e => handleChange('temDiagnostico', e.target.value)}><option value="NÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o">NÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o</option><option value="Sim">Sim</option></select></div>
                    {formData.temDiagnostico === 'Sim' && <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Qual?</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-xs outline-none" value={formData.diagnosticoQual} onChange={e => handleChange('diagnosticoQual', e.target.value)} /></div>}
                  </div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">EstÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ sendo acompanhada por algum mÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©dico? Qual?</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-xs outline-none" value={formData.acompanhamentoMedico} onChange={e => handleChange('acompanhamentoMedico', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">MEDICAÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢O ATUAL (MedicaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o, Para que, Dosagem, Quando iniciou)</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={3} value={formData.medicacaoAtual} onChange={e => handleChange('medicacaoAtual', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">ACOMPANHAMENTO MULTIDISCIPLINAR (Especialidade, FrequÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªncia, Quando iniciou)</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={3} value={formData.acompanhamentoMultidisciplinar} onChange={e => handleChange('acompanhamentoMultidisciplinar', e.target.value)}></textarea></div>
                </div>
              </details>

              {isFieldActive('section_familia_ambiente') && (
              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors">Desenvolvimento e Comportamento<ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-4 border-t border-gray-100">
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">DESENVOLVIMENTO GESTACIONAL</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={3} value={formData.desenvolvimentoGestacional} onChange={e => handleChange('desenvolvimentoGestacional', e.target.value)}></textarea></div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Sono</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.comportamentoSono} onChange={e => handleChange('comportamentoSono', e.target.value)}></textarea></div>
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">AlimentaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.comportamentoAlimentacao} onChange={e => handleChange('comportamentoAlimentacao', e.target.value)}></textarea></div>
                  </div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Desenvolvimento Social</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.desenvolvimentoSocial} onChange={e => handleChange('desenvolvimentoSocial', e.target.value)}></textarea></div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Estereotipias</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.estereotipias} onChange={e => handleChange('estereotipias', e.target.value)}></textarea></div>
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Sensibilidades</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.sensibilidades} onChange={e => handleChange('sensibilidades', e.target.value)}></textarea></div>
                  </div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Descreva dificuldades e habilidades que seu filho possui</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={3} value={formData.dificuldadesHabilidades} onChange={e => handleChange('dificuldadesHabilidades', e.target.value)}></textarea></div>
                </div>
              </details>
              )}

              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors">Escolaridade e HistÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³rico MÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©dico<ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-4 border-t border-gray-100">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nome da Escola</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-xs outline-none" value={formData.nomeEscola} onChange={e => handleChange('nomeEscola', e.target.value)} /></div>
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Tipo de Escola</label><select className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-xs outline-none" value={formData.tipoEscola} onChange={e => handleChange('tipoEscola', e.target.value)}><option value="">Selecione...</option><option value="Particular">Particular</option><option value="Municipal">Municipal</option><option value="Estadual">Estadual</option><option value="Outra">Outra</option></select></div>
                  </div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">HISTÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“RICO MÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â°DICO da crianÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§a</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={3} value={formData.historicoMedicoCrianca} onChange={e => handleChange('historicoMedicoCrianca', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">HISTÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“RICO MÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â°DICO da famÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­lia</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={3} value={formData.historicoMedicoFamilia} onChange={e => handleChange('historicoMedicoFamilia', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Lista de interesses e possÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­veis reforÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§adores</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={3} value={formData.interessesReforcadores} onChange={e => handleChange('interessesReforcadores', e.target.value)}></textarea></div>
                </div>
              </details>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
                <h3 className="text-sm font-bold text-[#7a32fc] uppercase tracking-wider mb-4 flex items-center gap-2"><Phone size={16} /> Contatos</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2"><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. EndereÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§o Domiciliar</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" placeholder="EndereÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§o completo" value={formData.endereco} onChange={e => handleChange('endereco', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. Telefone para Contato</label><input type="tel" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" placeholder="(00) 00000-0000" value={formData.telefone} onChange={e => handleChange('telefone', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. Pessoa de ReferÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªncia</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" placeholder="Nome do contato" value={formData.pessoaReferencia} onChange={e => handleChange('pessoaReferencia', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">4. Telefone de ReferÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªncia</label><input type="tel" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" placeholder="(00) 00000-0000" value={formData.telefoneReferencia} onChange={e => handleChange('telefoneReferencia', e.target.value)} /></div>
                </div>
              </div> 
              <h3 className="text-sm font-bold text-[#7a32fc] uppercase tracking-wider mt-6 mb-2 flex items-center gap-2"><Eye size={16} /> ObservaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o por ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âreas</h3> 
              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors">FamÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­lia & Ambiente<ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-3 border-t border-gray-100">
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Pessoas com quem habita</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.familiaHabita} onChange={e => handleChange('familiaHabita', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. Constitution da famÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­lia (Passado/Atualidade)</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.familiaConstituicao} onChange={e => handleChange('familiaConstituicao', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. Clima e atmosfera familiar</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.familiaClima} onChange={e => handleChange('familiaClima', e.target.value)}></textarea></div>
                </div>
              </details>
              {visibleRelationshipEntities.map((entity, idx) => { 
                const prefix = entity.toLowerCase().split(' ')[0].normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 
                return ( 
                  <details key={idx} className="bg-white border border-gray-200 rounded-xl overflow-hidden group"> 
                    <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors">{entity}<ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary> 
                    <div className="p-4 space-y-3 border-t border-gray-100"> 
                      <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Dados pessoais</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData[`${prefix}Dados`] || ''} onChange={e => handleChange(`${prefix}Dados`, e.target.value)} /></div> 
                      <div className="grid grid-cols-2 gap-3"> 
                        <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. RelaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o Passada</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData[`${prefix}RelacaoPassada`] || ''} onChange={e => handleChange(`${prefix}RelacaoPassada`, e.target.value)}></textarea></div> 
                        <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. RelaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o Atual</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData[`${prefix}RelacaoAtual`] || ''} onChange={e => handleChange(`${prefix}RelacaoAtual`, e.target.value)}></textarea></div> 
                      </div> 
                    </div> 
                  </details> 
                ); 
              })} 
              {isFieldActive('section_relacoes_sociais') && (
              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors">RelaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âµes Sociais<ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-3 border-t border-gray-100">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. RelaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âµes Profissionais</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.relacoesProfissionais} onChange={e => handleChange('relacoesProfissionais', e.target.value)}></textarea></div>
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. RelaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âµes Afetivas</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.relacoesAfetivas} onChange={e => handleChange('relacoesAfetivas', e.target.value)}></textarea></div>
                  </div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. RelaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âµes Significativas (Passado/Atual)</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.relacoesSignificativas} onChange={e => handleChange('relacoesSignificativas', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">4. DescriÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o Geral Vida Social Atual</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.vidaSocialGeral} onChange={e => handleChange('vidaSocialGeral', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">5. Dificuldades Atuais na Vida Social</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.dificuldadesSociais} onChange={e => handleChange('dificuldadesSociais', e.target.value)}></textarea></div>
                </div>
              </details>
              )}
              {isFieldActive('section_profissional') && (
              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors"><div className="flex items-center gap-2"><Briefcase size={16} /> Profissional</div><ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-3 border-t border-gray-100">
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Grau de InstruÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.grauInstrucao} onChange={e => handleChange('grauInstrucao', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. DescriÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o da ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Ârea Profissional</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.descProfissional} onChange={e => handleChange('descProfissional', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. Dificuldades Atuais na ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Ârea Laboral</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.dificuldadesLaborais} onChange={e => handleChange('dificuldadesLaborais', e.target.value)}></textarea></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">4. SituaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o EconÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â´mica</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.situacaoEconomica} onChange={e => handleChange('situacaoEconomica', e.target.value)} /></div>
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">5. DependÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªncia EconÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â´mica</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.dependenciaEconomica} onChange={e => handleChange('dependenciaEconomica', e.target.value)} /></div>
                  </div>
                </div>
              </details>
              )}
              {isFieldActive('section_saude_higiene') && (
              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors"><div className="flex items-center gap-2"><Heart size={16} /> SaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºde e Higiene Pessoal</div><ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-3 border-t border-gray-100">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. AlimentaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.alimentacao} onChange={e => handleChange('alimentacao', e.target.value)} /></div>
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. Sono e Sonho</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.sonoSonho} onChange={e => handleChange('sonoSonho', e.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. Limpeza e Higiene</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.limpezaHigiene} onChange={e => handleChange('limpezaHigiene', e.target.value)} /></div>
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">4. ExercÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­cio FÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­sico</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.exercicio} onChange={e => handleChange('exercicio', e.target.value)} /></div>
                  </div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">5. Controle MÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©dico e Tratamentos</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.controleMedico} onChange={e => handleChange('controleMedico', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">6. HÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡bitos Nocivos</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.habitosNocivos} onChange={e => handleChange('habitosNocivos', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">7. Demais tratamentos de saÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºde</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.outrosTratamentos} onChange={e => handleChange('outrosTratamentos', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">8. Contato profissionais de saÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºde</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.contatoProfSaude} onChange={e => handleChange('contatoProfSaude', e.target.value)} /></div>
                </div>
              </details>
              )}

              {isFieldActive('section_hobbies_tempo_livre') && (
              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors"><div className="flex items-center gap-2"><ShoppingBag size={16} /> Hobbies e Tempo Livre</div><ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-3 border-t border-gray-100">
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Interesses e afinidades passados e atuais</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.interesses} onChange={e => handleChange('interesses', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. Disponibilidade e tempo livre semanal</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.disponibilidadeTempo} onChange={e => handleChange('disponibilidadeTempo', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. Emprego positivo e negativo do tempo livre</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.empregoTempoLivre} onChange={e => handleChange('empregoTempoLivre', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">4. Interesses potenciais</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.interessesPotenciais} onChange={e => handleChange('interessesPotenciais', e.target.value)} /></div>
                </div>
              </details>
              )}

              {isFieldActive('section_desenvolvimento_pessoal') && (
              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors"><div className="flex items-center gap-2"><Rocket size={16} /> Desenvolvimento Pessoal</div><ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-3 border-t border-gray-100">
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Atividades individuais de desenvolvimento pessoal (Passado/Atual)</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.atividadesIndividuais} onChange={e => handleChange('atividadesIndividuais', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. Atividades grupais de desenvolvimento pessoal (Passado/Atual)</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.atividadesGrupais} onChange={e => handleChange('atividadesGrupais', e.target.value)}></textarea></div>
                </div>
              </details>
              )}

              {isFieldActive('section_historia_motivo') && (
              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors"><div className="flex items-center gap-2"><ClipboardList size={16} /> HistÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³ria Atual e Motivo da Consulta</div><ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-3 border-t border-gray-100">
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Motivo de Consulta</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.motivoConsulta} onChange={e => handleChange('motivoConsulta', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. Iniciativa do Tratamento</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.iniciativaTratamento} onChange={e => handleChange('iniciativaTratamento', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. ReferÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªncia do terapeuta e motivo de eleiÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.referenciaTerapeuta} onChange={e => handleChange('referenciaTerapeuta', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">4. Expectativa do paciente quanto ao processo terapÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªutico</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.expectativa} onChange={e => handleChange('expectativa', e.target.value)}></textarea></div>
                </div>
              </details>
              )}

              {isFieldActive('section_processos_previos') && (
              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors"><div className="flex items-center gap-2"><FileText size={16} /> Processos TerapÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªuticos PrÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©vios</div><ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-3 border-t border-gray-100">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Tipo de Tratamento</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.previoTipo} onChange={e => handleChange('previoTipo', e.target.value)} /></div>
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. DuraÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.previoDuracao} onChange={e => handleChange('previoDuracao', e.target.value)} /></div>
                  </div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. Motivo da Consulta (Anterior)</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.previoMotivo} onChange={e => handleChange('previoMotivo', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">4. Motivo de InterrupÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.previoInterrupcao} onChange={e => handleChange('previoInterrupcao', e.target.value)}></textarea></div>
                </div>
              </details>
              )}
            </React.Fragment>
          )}

          {mode === 'create' && (
            <div className="pt-4 border-t border-gray-100">
              <label className="flex items-center gap-3 cursor-pointer mb-4">
                <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-colors ${scheduleImmediate ? 'bg-[#7a32fc] border-[#7a32fc] text-white' : 'border-gray-300 bg-white'}`}>{scheduleImmediate && <Check size={16} />}</div>
                <input type="checkbox" className="hidden" checked={scheduleImmediate} onChange={() => setScheduleImmediate(!scheduleImmediate)} />
                <span className="text-sm font-bold text-gray-600">Agendar Primeira Consulta Agora</span>
              </label>
              {scheduleImmediate && (
                <div className="bg-[#F4F7FE] p-4 rounded-2xl border border-blue-100 animate-slide-up space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Data</label><input type="date" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none" value={registerDate} onChange={e => setRegisterDate(e.target.value)} /></div>
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Hora</label><input type="time" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none" value={registerTime} onChange={e => setRegisterTime(e.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Abordagem</label>
                      <select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none" value={consultationApproach} onChange={e => setConsultationApproach(e.target.value)}>
                        <option value="">Selecione...</option>
                        <option value="AvaliaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o Inicial">AvaliaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o Inicial</option>
                        <option value="TCC">TCC</option>
                        <option value="ABA">ABA</option>
                        <option value="IntegraÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o Sensorial">IntegraÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o Sensorial</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Sala</label>
                      <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none" placeholder="Ex: Sala 01" value={consultationRoom} onChange={e => setConsultationRoom(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Profissional ResponsÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡vel</label>
                    <input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" placeholder="Nome do Profissional" value={consultationProfessional} onChange={e => setConsultationProfessional(e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          )}
          
          <button onClick={handleSubmit} className="w-full bg-[#7a32fc] text-white font-bold py-4 rounded-xl shadow-lg shadow-[#7a32fc]/30 hover:opacity-90 transition-all mt-2 active:scale-95">
            {mode === 'create' ? 'Salvar ProntuÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡rio' : 'Salvar AlteraÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âµes'}
          </button>
        </div>
      </div>
    </div> 
  ); 
};




