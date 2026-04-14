import React, { useState, useEffect } from 'react';
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
    "Bradesco Saúde",
    "SulAmérica",
    "Hapvida",
    "NotreDame Intermédica",
    "Care Plus",
    "Omint",
    "Porto Seguro Saúde",
    "Golden Cross",
    "Seguros Unimed",
    "Samp",
    "São Cristóvão Saúde",
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
    // Criança Script Fields
    dataHoje: new Date().toISOString().split('T')[0],
    profissional: "Dra. Raísa",
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
    temDiagnostico: "Não",
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
  const [consultationProfessional, setConsultationProfessional] = useState("Dra. Raísa");
  const [templateState, setTemplateState] = useState<AnamnesisTemplate>({ hiddenFields: [], customQuestions: [] });
  const [newQuestionLabel, setNewQuestionLabel] = useState("");
  const [newQuestionType, setNewQuestionType] = useState<'dissertativa' | 'multipla_escolha' | 'multipla_selecao'>('dissertativa');
  const [newQuestionOptions, setNewQuestionOptions] = useState("");
  const [newQuestionAppliesTo, setNewQuestionAppliesTo] = useState<'adult' | 'child' | 'both'>('both'); 
  
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
      customQuestions: Array.isArray(template?.customQuestions) ? template.customQuestions : []
    });
  }, [template]);

  useEffect(() => {
    if (!isOpen) return;
    const fieldLabelMap: Record<string, string> = {
      nome: "Nome Completo",
      nomeSocial: "Nome Social",
      telefone: "Telefone",
      genero: "Gênero",
      convenioNome: "Convênio",
      convenioCarteirinha: "Carteirinha",
      rg: "RG",
      cpf: "CPF",
      responsavelNome: "Nome do responsável",
      responsavelCpf: "CPF do responsável"
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
  const isFieldActive = (field: string) => !templateState.hiddenFields.includes(field);

  const toggleField = (field: string) => {
    setTemplateState((prev) => {
      const exists = prev.hiddenFields.includes(field);
      return {
        ...prev,
        hiddenFields: exists ? prev.hiddenFields.filter((f) => f !== field) : [...prev.hiddenFields, field]
      };
    });
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

  const saveTemplate = async () => {
    if (!onTemplateSave) return;
    await onTemplateSave(templateState);
    alert("Template de anamnese salvo para a clínica.");
  };

  const handleSubmit = () => { 
    const payload = { ...formData, formType, anamnesisTemplateVersion: templateState, ...(mode === 'create' && scheduleImmediate ? { scheduleImmediate, date: registerDate, time: registerTime, approach: consultationApproach, room: consultationRoom, professional: consultationProfessional } : {}) }; 
    onSave(payload); onClose(); 
  }; 

  if (!isOpen) return null; 

  return ( 
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}> 
      <div className="bg-white w-full max-w-4xl rounded-[32px] p-8 shadow-2xl animate-pop relative max-h-[90vh] overflow-y-auto custom-scrollbar" onClick={e => e.stopPropagation()}> 
        <div className="absolute top-6 right-6 flex items-center gap-3">
          <div className="bg-gray-100 p-1 rounded-xl flex gap-1">
            <button onClick={() => setFormType('adult')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${formType === 'adult' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400'}`}>Adulto</button>
            <button onClick={() => setFormType('child')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${formType === 'child' ? 'bg-white text-[#7a32fc] shadow-sm' : 'text-gray-400'}`}>Criança</button>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-red-500 transition-colors p-2"><X size={24}/></button> 
        </div>

        <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2"> 
          <div className="p-2 bg-[#7a32fc]/10 rounded-xl text-[#7a32fc]">{formType === 'child' ? <Baby size={24}/> : (mode === 'create' ? <UserPlus size={24} /> : <FileText size={24}/>)}</div> 
          {mode === 'create' ? `Prontuário de Admissão (${formType === 'child' ? 'Criança' : 'Adulto'})` : `Editar Ficha (${formType === 'child' ? 'Criança' : 'Adulto'})`} 
        </h2> 

        {canEditTemplate && (
          <details className="mb-4 bg-white border border-[#7a32fc]/20 rounded-2xl overflow-hidden group">
            <summary className="p-4 cursor-pointer font-bold text-[#7a32fc] flex justify-between items-center group-open:bg-[#F4F7FE] transition-colors">
              Personalização da Ficha da Clínica
              <ChevronDown className="group-open:rotate-180 transition-transform text-[#7a32fc]" size={20}/>
            </summary>
            <div className="p-4 border-t border-[#7a32fc]/10 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                {[
                  ['nome', 'Nome'],
                  ['nomeSocial', 'Nome Social'],
                  ['telefone', 'Telefone'],
                  ['genero', 'Gênero'],
                  ['convenioNome', 'Convênio'],
                  ['convenioCarteirinha', 'Carteirinha'],
                  ['rg', 'RG'],
                  ['cpf', 'CPF'],
                  ['responsavelNome', 'Responsável'],
                  ['responsavelCpf', 'CPF Responsável']
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2 border border-gray-200">
                    <input type="checkbox" checked={isFieldActive(key)} onChange={() => toggleField(key)} />
                    <span className="font-semibold text-gray-700">{label}</span>
                  </label>
                ))}
              </div>

              <div className="bg-gray-50 rounded-2xl border border-gray-200 p-3 space-y-3">
                <p className="text-xs font-bold text-gray-600 uppercase tracking-wider">Adicionar pergunta personalizada</p>
                <input type="text" value={newQuestionLabel} onChange={(e) => setNewQuestionLabel(e.target.value)} placeholder="Pergunta" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <select value={newQuestionType} onChange={(e) => setNewQuestionType(e.target.value as any)} className="bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none">
                    <option value="dissertativa">Dissertativa</option>
                    <option value="multipla_escolha">Múltipla escolha (1)</option>
                    <option value="multipla_selecao">Múltipla seleção</option>
                  </select>
                  <select value={newQuestionAppliesTo} onChange={(e) => setNewQuestionAppliesTo(e.target.value as any)} className="bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none">
                    <option value="both">Adulto e Criança</option>
                    <option value="adult">Só Adulto</option>
                    <option value="child">Só Criança</option>
                  </select>
                  <button type="button" onClick={handleAddCustomQuestion} className="bg-[#7a32fc] text-white rounded-xl font-bold text-xs uppercase tracking-wider">Adicionar</button>
                </div>
                {newQuestionType !== "dissertativa" && (
                  <input type="text" value={newQuestionOptions} onChange={(e) => setNewQuestionOptions(e.target.value)} placeholder="Opções separadas por vírgula" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none" />
                )}
              </div>

              {templateState.customQuestions.length > 0 && (
                <div className="space-y-2">
                  {templateState.customQuestions.map((q) => (
                    <div key={q.id} className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                      <div>
                        <p className="text-sm font-semibold text-gray-700">{q.label}</p>
                        <p className="text-[10px] uppercase tracking-wider text-gray-400">{q.type} • {q.appliesTo}</p>
                      </div>
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
                Salvar Personalização da Clínica
              </button>
            </div>
          </details>
        )}

        <div className="space-y-4"> 
          <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200"> 
            <h3 className="text-sm font-bold text-[#7a32fc] uppercase tracking-wider mb-4 flex items-center gap-2"><User size={16} /> Identificação</h3> 
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4"> 
              {isFieldActive('nome') && <div className="md:col-span-2"><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Nome Completo</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.nome} onChange={e => handleChange('nome', e.target.value)} /></div>} 
              <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. E-mail do Paciente</label><input type="email" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" placeholder="paciente@email.com" value={formData.email} onChange={e => handleChange('email', e.target.value)} /></div>
              <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. Nascimento</label><input type="date" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.dataNascimento} onChange={e => handleChange('dataNascimento', e.target.value)} /></div> 
              <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">4. Idade</label><input type="number" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.idade} onChange={e => handleChange('idade', e.target.value)} /></div> 
              {isFieldActive('genero') && <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">5. Gênero</label><select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.genero} onChange={e => handleChange('genero', e.target.value)}><option value="">Selecione...</option><option value="Masculino">Masculino</option><option value="Feminino">Feminino</option><option value="Outro">Outro</option></select></div>} 
              {formType === 'child' && (
                <React.Fragment>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Data de Hoje</label><input type="date" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.dataHoje} onChange={e => handleChange('dataHoje', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Profissional</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.profissional} onChange={e => handleChange('profissional', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">CRP</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.crp} onChange={e => handleChange('crp', e.target.value)} /></div>
                </React.Fragment>
              )}
              <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">6. Religião</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.religiao} onChange={e => handleChange('religiao', e.target.value)} /></div>
              {formType === 'adult' ? (
                <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">7. Estado Civil</label><select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.estadoCivil} onChange={e => handleChange('estadoCivil', e.target.value)}><option value="">Selecione...</option><option value="Solteiro(a)">Solteiro(a)</option><option value="Casado(a)">Casado(a)</option><option value="Divorciado(a)">Divorciado(a)</option><option value="Viúvo(a)">Viúvo(a)</option></select></div>
              ) : (
                <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">7. Série</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.serie} onChange={e => handleChange('serie', e.target.value)} placeholder="Ex: 2º ano Fundamental" /></div>
              )}
              <div className="md:col-span-1"><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">{formType === 'child' ? '8. Nome da Mãe' : '8. Profissão'}</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formType === 'child' ? formData.nomeMae : formData.profissao} onChange={e => handleChange(formType === 'child' ? 'nomeMae' : 'profissao', e.target.value)} /></div> 
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
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Convênio ou Particular</label>
                <select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.convenioTipo} onChange={e => handleChange('convenioTipo', e.target.value)}>
                  <option value="particular">Particular</option>
                  <option value="convenio">Convênio</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Convênio</label>
                <select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.convenioNome} onChange={e => handleChange('convenioNome', e.target.value)}>
                  <option value="">Selecione...</option>
                  {insuranceOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nº Carteirinha (Convênio)</label>
                <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.convenioCarteirinha} onChange={e => handleChange('convenioCarteirinha', e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Como conheceu a clínica</label>
                <select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.comoConheceu} onChange={e => handleChange('comoConheceu', e.target.value)}>
                  <option value="">Selecione...</option>
                  <option value="Google">Google</option>
                  <option value="Indicação">Indicação</option>
                  <option value="Email">Email</option>
                  <option value="WhatsApp">WhatsApp</option>
                  <option value="Rede Social">Rede Social</option>
                  <option value="Evento">Evento</option>
                  <option value="Convênio">Convênio</option>
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
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Número</label>
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
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Outras informações</label>
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
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nome do responsável</label>
                    <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.responsavelNome} onChange={e => handleChange('responsavelNome', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nascimento do responsável</label>
                    <input type="date" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.responsavelDataNascimento} onChange={e => handleChange('responsavelDataNascimento', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">CPF do responsável</label>
                    <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.responsavelCpf} onChange={e => handleChange('responsavelCpf', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Telefone do responsável</label>
                    <input type="tel" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.responsavelTelefone} onChange={e => handleChange('responsavelTelefone', e.target.value)} />
                  </div>
                </React.Fragment>
              )}
            </div>
          </div>

          {templateState.customQuestions.filter((q) => q.active && (q.appliesTo === 'both' || q.appliesTo === formType)).length > 0 && (
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
              <h3 className="text-sm font-bold text-[#7a32fc] uppercase tracking-wider mb-4 flex items-center gap-2">
                <ClipboardList size={16} /> Perguntas Personalizadas da Clínica
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
                <h3 className="text-sm font-bold text-[#7a32fc] uppercase tracking-wider mb-4 flex items-center gap-2"><UserPlus size={16} /> Família e Contato</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Telefone de Contato</label><input type="tel" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" placeholder="(00) 00000-0000" value={formData.telefone} onChange={e => handleChange('telefone', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Endereço</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.endereco} onChange={e => handleChange('endereco', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nome do Pai Biológico</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.nomePaiBiologico} onChange={e => handleChange('nomePaiBiologico', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nome de Irmãos e Idade</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.irmaosIdade} onChange={e => handleChange('irmaosIdade', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Estado Civil dos Pais Biológicos</label><select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.estadoCivilPais} onChange={e => handleChange('estadoCivilPais', e.target.value)}><option value="">Selecione...</option><option value="Casados">Casados</option><option value="Separados">Separados</option><option value="Divorciados">Divorciados</option><option value="Outro">Outro</option></select></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Se separados: Idade da criança na época</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.idadeSeparacao} onChange={e => handleChange('idadeSeparacao', e.target.value)} /></div>
                  <div className="md:col-span-2"><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Pessoas que atualmente moram com a criança</label><textarea className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc] resize-none" rows={2} value={formData.pessoasMoramCrianca} onChange={e => handleChange('pessoasMoramCrianca', e.target.value)}></textarea></div>
                </div>
              </div>

              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group" open>
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors">Diagnóstico e Medicação<ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-4 border-t border-gray-100">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">A criança já tem algum diagnóstico?</label><select className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-xs outline-none" value={formData.temDiagnostico} onChange={e => handleChange('temDiagnostico', e.target.value)}><option value="Não">Não</option><option value="Sim">Sim</option></select></div>
                    {formData.temDiagnostico === 'Sim' && <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Qual?</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-xs outline-none" value={formData.diagnosticoQual} onChange={e => handleChange('diagnosticoQual', e.target.value)} /></div>}
                  </div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Está sendo acompanhada por algum médico? Qual?</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-xs outline-none" value={formData.acompanhamentoMedico} onChange={e => handleChange('acompanhamentoMedico', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">MEDICAÇÃO ATUAL (Medicação, Para que, Dosagem, Quando iniciou)</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={3} value={formData.medicacaoAtual} onChange={e => handleChange('medicacaoAtual', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">ACOMPANHAMENTO MULTIDISCIPLINAR (Especialidade, Frequência, Quando iniciou)</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={3} value={formData.acompanhamentoMultidisciplinar} onChange={e => handleChange('acompanhamentoMultidisciplinar', e.target.value)}></textarea></div>
                </div>
              </details>

              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors">Desenvolvimento e Comportamento<ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-4 border-t border-gray-100">
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">DESENVOLVIMENTO GESTACIONAL</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={3} value={formData.desenvolvimentoGestacional} onChange={e => handleChange('desenvolvimentoGestacional', e.target.value)}></textarea></div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Sono</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.comportamentoSono} onChange={e => handleChange('comportamentoSono', e.target.value)}></textarea></div>
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Alimentação</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.comportamentoAlimentacao} onChange={e => handleChange('comportamentoAlimentacao', e.target.value)}></textarea></div>
                  </div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Desenvolvimento Social</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.desenvolvimentoSocial} onChange={e => handleChange('desenvolvimentoSocial', e.target.value)}></textarea></div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Estereotipias</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.estereotipias} onChange={e => handleChange('estereotipias', e.target.value)}></textarea></div>
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Sensibilidades</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.sensibilidades} onChange={e => handleChange('sensibilidades', e.target.value)}></textarea></div>
                  </div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Descreva dificuldades e habilidades que seu filho possui</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={3} value={formData.dificuldadesHabilidades} onChange={e => handleChange('dificuldadesHabilidades', e.target.value)}></textarea></div>
                </div>
              </details>

              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors">Escolaridade e Histórico Médico<ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-4 border-t border-gray-100">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nome da Escola</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-xs outline-none" value={formData.nomeEscola} onChange={e => handleChange('nomeEscola', e.target.value)} /></div>
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Tipo de Escola</label><select className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-xs outline-none" value={formData.tipoEscola} onChange={e => handleChange('tipoEscola', e.target.value)}><option value="">Selecione...</option><option value="Particular">Particular</option><option value="Municipal">Municipal</option><option value="Estadual">Estadual</option><option value="Outra">Outra</option></select></div>
                  </div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">HISTÓRICO MÉDICO da criança</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={3} value={formData.historicoMedicoCrianca} onChange={e => handleChange('historicoMedicoCrianca', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">HISTÓRICO MÉDICO da família</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={3} value={formData.historicoMedicoFamilia} onChange={e => handleChange('historicoMedicoFamilia', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Lista de interesses e possíveis reforçadores</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={3} value={formData.interessesReforcadores} onChange={e => handleChange('interessesReforcadores', e.target.value)}></textarea></div>
                </div>
              </details>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
                <h3 className="text-sm font-bold text-[#7a32fc] uppercase tracking-wider mb-4 flex items-center gap-2"><Phone size={16} /> Contatos</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2"><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Endereço Domiciliar</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" placeholder="Endereço completo" value={formData.endereco} onChange={e => handleChange('endereco', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. Telefone para Contato</label><input type="tel" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" placeholder="(00) 00000-0000" value={formData.telefone} onChange={e => handleChange('telefone', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. Pessoa de Referência</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" placeholder="Nome do contato" value={formData.pessoaReferencia} onChange={e => handleChange('pessoaReferencia', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">4. Telefone de Referência</label><input type="tel" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" placeholder="(00) 00000-0000" value={formData.telefoneReferencia} onChange={e => handleChange('telefoneReferencia', e.target.value)} /></div>
                </div>
              </div> 
              <h3 className="text-sm font-bold text-[#7a32fc] uppercase tracking-wider mt-6 mb-2 flex items-center gap-2"><Eye size={16} /> Observação por Áreas</h3> 
              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors">Família & Ambiente<ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-3 border-t border-gray-100">
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Pessoas com quem habita</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.familiaHabita} onChange={e => handleChange('familiaHabita', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. Constitution da família (Passado/Atualidade)</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.familiaConstituicao} onChange={e => handleChange('familiaConstituicao', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. Clima e atmosfera familiar</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.familiaClima} onChange={e => handleChange('familiaClima', e.target.value)}></textarea></div>
                </div>
              </details> 
              {['Pai', 'Mãe', 'Irmãos', 'Par', 'Filhos', 'Outros Membros Significativos'].map((entity, idx) => { 
                const prefix = entity.toLowerCase().split(' ')[0].normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 
                return ( 
                  <details key={idx} className="bg-white border border-gray-200 rounded-xl overflow-hidden group"> 
                    <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors">{entity}<ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary> 
                    <div className="p-4 space-y-3 border-t border-gray-100"> 
                      <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Dados pessoais</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData[`${prefix}Dados`] || ''} onChange={e => handleChange(`${prefix}Dados`, e.target.value)} /></div> 
                      <div className="grid grid-cols-2 gap-3"> 
                        <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. Relação Passada</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData[`${prefix}RelacaoPassada`] || ''} onChange={e => handleChange(`${prefix}RelacaoPassada`, e.target.value)}></textarea></div> 
                        <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. Relação Atual</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData[`${prefix}RelacaoAtual`] || ''} onChange={e => handleChange(`${prefix}RelacaoAtual`, e.target.value)}></textarea></div> 
                      </div> 
                    </div> 
                  </details> 
                ); 
              })} 
              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors">Relações Sociais<ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-3 border-t border-gray-100">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Relações Profissionais</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.relacoesProfissionais} onChange={e => handleChange('relacoesProfissionais', e.target.value)}></textarea></div>
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. Relações Afetivas</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.relacoesAfetivas} onChange={e => handleChange('relacoesAfetivas', e.target.value)}></textarea></div>
                  </div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. Relações Significativas (Passado/Atual)</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.relacoesSignificativas} onChange={e => handleChange('relacoesSignificativas', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">4. Descrição Geral Vida Social Atual</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.vidaSocialGeral} onChange={e => handleChange('vidaSocialGeral', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">5. Dificuldades Atuais na Vida Social</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.dificuldadesSociais} onChange={e => handleChange('dificuldadesSociais', e.target.value)}></textarea></div>
                </div>
              </details> 
              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors"><div className="flex items-center gap-2"><Briefcase size={16} /> Profissional</div><ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-3 border-t border-gray-100">
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Grau de Instrução</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.grauInstrucao} onChange={e => handleChange('grauInstrucao', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. Descrição da Área Profissional</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.descProfissional} onChange={e => handleChange('descProfissional', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. Dificuldades Atuais na Área Laboral</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.dificuldadesLaborais} onChange={e => handleChange('dificuldadesLaborais', e.target.value)}></textarea></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">4. Situação Econômica</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.situacaoEconomica} onChange={e => handleChange('situacaoEconomica', e.target.value)} /></div>
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">5. Dependência Econômica</label><input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7a32fc]" value={formData.dependenciaEconomica} onChange={e => handleChange('dependenciaEconomica', e.target.value)} /></div>
                  </div>
                </div>
              </details> 
              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors"><div className="flex items-center gap-2"><Heart size={16} /> Saúde e Higiene Pessoal</div><ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-3 border-t border-gray-100">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Alimentação</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.alimentacao} onChange={e => handleChange('alimentacao', e.target.value)} /></div>
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. Sono e Sonho</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.sonoSonho} onChange={e => handleChange('sonoSonho', e.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. Limpeza e Higiene</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.limpezaHigiene} onChange={e => handleChange('limpezaHigiene', e.target.value)} /></div>
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">4. Exercício Físico</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.exercicio} onChange={e => handleChange('exercicio', e.target.value)} /></div>
                  </div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">5. Controle Médico e Tratamentos</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.controleMedico} onChange={e => handleChange('controleMedico', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">6. Hábitos Nocivos</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.habitosNocivos} onChange={e => handleChange('habitosNocivos', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">7. Demais tratamentos de saúde</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.outrosTratamentos} onChange={e => handleChange('outrosTratamentos', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">8. Contato profissionais de saúde</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.contatoProfSaude} onChange={e => handleChange('contatoProfSaude', e.target.value)} /></div>
                </div>
              </details> 

              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors"><div className="flex items-center gap-2"><ShoppingBag size={16} /> Hobbies e Tempo Livre</div><ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-3 border-t border-gray-100">
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Interesses e afinidades passados e atuais</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.interesses} onChange={e => handleChange('interesses', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. Disponibilidade e tempo livre semanal</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.disponibilidadeTempo} onChange={e => handleChange('disponibilidadeTempo', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. Emprego positivo e negativo do tempo livre</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.empregoTempoLivre} onChange={e => handleChange('empregoTempoLivre', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">4. Interesses potenciais</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.interessesPotenciais} onChange={e => handleChange('interessesPotenciais', e.target.value)} /></div>
                </div>
              </details>

              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors"><div className="flex items-center gap-2"><Rocket size={16} /> Desenvolvimento Pessoal</div><ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-3 border-t border-gray-100">
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Atividades individuais de desenvolvimento pessoal (Passado/Atual)</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.atividadesIndividuais} onChange={e => handleChange('atividadesIndividuais', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. Atividades grupais de desenvolvimento pessoal (Passado/Atual)</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.atividadesGrupais} onChange={e => handleChange('atividadesGrupais', e.target.value)}></textarea></div>
                </div>
              </details>

              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors"><div className="flex items-center gap-2"><ClipboardList size={16} /> História Atual e Motivo da Consulta</div><ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-3 border-t border-gray-100">
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Motivo de Consulta</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.motivoConsulta} onChange={e => handleChange('motivoConsulta', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. Iniciativa do Tratamento</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.iniciativaTratamento} onChange={e => handleChange('iniciativaTratamento', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. Referência do terapeuta e motivo de eleição</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.referenciaTerapeuta} onChange={e => handleChange('referenciaTerapeuta', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">4. Expectativa do paciente quanto ao processo terapêutico</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.expectativa} onChange={e => handleChange('expectativa', e.target.value)}></textarea></div>
                </div>
              </details>

              <details className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <summary className="p-4 cursor-pointer font-bold text-gray-700 flex justify-between items-center group-open:bg-gray-50 transition-colors"><div className="flex items-center gap-2"><FileText size={16} /> Processos Terapêuticos Prévios</div><ChevronDown className="group-open:rotate-180 transition-transform text-gray-400" size={20}/></summary>
                <div className="p-4 space-y-3 border-t border-gray-100">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">1. Tipo de Tratamento</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.previoTipo} onChange={e => handleChange('previoTipo', e.target.value)} /></div>
                    <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">2. Duração</label><input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" value={formData.previoDuracao} onChange={e => handleChange('previoDuracao', e.target.value)} /></div>
                  </div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">3. Motivo da Consulta (Anterior)</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.previoMotivo} onChange={e => handleChange('previoMotivo', e.target.value)}></textarea></div>
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">4. Motivo de Interrupção</label><textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none resize-none" rows={2} value={formData.previoInterrupcao} onChange={e => handleChange('previoInterrupcao', e.target.value)}></textarea></div>
                </div>
              </details>
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
                        <option value="Avaliação Inicial">Avaliação Inicial</option>
                        <option value="TCC">TCC</option>
                        <option value="ABA">ABA</option>
                        <option value="Integração Sensorial">Integração Sensorial</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Sala</label>
                      <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none" placeholder="Ex: Sala 01" value={consultationRoom} onChange={e => setConsultationRoom(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Profissional Responsável</label>
                    <input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-sm outline-none" placeholder="Nome do Profissional" value={consultationProfessional} onChange={e => setConsultationProfessional(e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          )}
          
          <button onClick={handleSubmit} className="w-full bg-[#7a32fc] text-white font-bold py-4 rounded-xl shadow-lg shadow-[#7a32fc]/30 hover:opacity-90 transition-all mt-2 active:scale-95">
            {mode === 'create' ? 'Salvar Prontuário' : 'Salvar Alterações'}
          </button>
        </div>
      </div>
    </div> 
  ); 
};


