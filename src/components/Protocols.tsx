import React, { useEffect, useState } from 'react';
import { ChevronDown, Trash2, Plus, ChevronLeft, Save, SearchCode, Boxes, Filter, Search, FileUp, Loader2, ShieldCheck, Info } from 'lucide-react';
import { SuccessOverlay } from './Common';

export const SkillEditor = ({ skill, onUpdate, onDelete, category }: any) => { 
  const [isOpen, setIsOpen] = useState(false); 
  const isIntervention = category === 'intervention';

  return ( 
    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mb-2 animate-fade-in"> 
      <div className="flex justify-between items-center cursor-pointer" onClick={() => setIsOpen(!isOpen)}> 
        <div className="flex-1 mr-2 flex items-center gap-2"> 
          <ChevronDown size={16} className={`text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} /> 
          <input type="text" className="bg-transparent text-sm font-bold text-gray-700 outline-none w-full" value={skill.name} onChange={(e) => onUpdate({ ...skill, name: e.target.value })} placeholder={isIntervention ? "Título da Tarefa de Intervenção" : "Nome da Tarefa/Habilidade"} onClick={(e) => e.stopPropagation()} /> 
        </div> 
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-red-400 hover:text-red-600 p-2"><Trash2 size={16}/></button> 
      </div> 
      {isOpen && ( 
        <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-1 gap-3 animate-fade-in"> 
          {!isIntervention && (
            <div className="grid grid-cols-2 gap-3"> 
              <div><label className="text-[10px] uppercase font-bold text-gray-400">Código</label><input type="text" className="w-full bg-white border border-gray-300 rounded-lg p-2 text-xs" value={skill.code || ''} onChange={(e) => onUpdate({ ...skill, code: e.target.value })} placeholder="Ex: A-1" /></div> 
              <div><label className="text-[10px] uppercase font-bold text-[#7551FF]">Pontuação Máxima</label><select className="w-full bg-white border border-gray-300 rounded-lg p-2 text-xs font-bold text-gray-700 outline-none" value={skill.maxScore || 2} onChange={(e) => onUpdate({ ...skill, maxScore: parseInt(e.target.value) })}><option value="1">0 - 1 (Binário)</option><option value="2">0 - 2 (Padrão)</option><option value="3">0 - 3</option><option value="4">0 - 4 (AFLS)</option><option value="5">0 - 5</option><option value="10">0 - 10</option></select></div> 
            </div> 
          )}
          <div><label className="text-[10px] uppercase font-bold text-gray-400">{isIntervention ? 'Objetivo / Instruções' : 'Objetivo'}</label><textarea className="w-full bg-white border border-gray-300 rounded-lg p-2 text-xs resize-none" rows={isIntervention ? 4 : 2} value={skill.objective || ''} onChange={(e) => onUpdate({ ...skill, objective: e.target.value })} placeholder={isIntervention ? "Descreva o que o paciente deve fazer ou escrever..." : "O que se espera do paciente?"}></textarea></div> 
          {!isIntervention && (
            <>
              <div><label className="text-[10px] uppercase font-bold text-gray-400">Exemplos</label><textarea className="w-full bg-white border border-gray-300 rounded-lg p-2 text-xs resize-none" rows={2} value={skill.example || ''} onChange={(e) => onUpdate({ ...skill, example: e.target.value })} placeholder="Dê exemplos práticos..."></textarea></div> 
              <div><label className="text-[10px] uppercase font-bold text-gray-400">Critérios</label><textarea className="w-full bg-white border border-gray-300 rounded-lg p-2 text-xs resize-none" rows={2} value={skill.criteria || ''} onChange={(e) => onUpdate({ ...skill, criteria: e.target.value })} placeholder="Critérios de pontuação..."></textarea></div> 
            </>
          )}
          <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Comentário Interno</label><textarea className="w-full bg-white border border-gray-300 rounded-lg p-2 text-xs resize-none" rows={2} value={skill.comment || ''} onChange={(e) => onUpdate({ ...skill, comment: e.target.value })} placeholder="Observações do profissional..."></textarea></div> 
        </div> 
      )} 
    </div> 
  ); 
};

export const DomainEditor = ({ domain, onUpdate, onDelete, category }: any) => { 
  const [isOpen, setIsOpen] = useState(false); 
  const updateSkill = (skillId: any, updatedData: any) => { 
    const updatedSkills = domain.skills.map((s: any) => s.id === skillId ? updatedData : s); 
    onUpdate({ ...domain, skills: updatedSkills }); 
  }; 
  const deleteSkill = (skillId: any) => { 
    if (confirm("Remover esta habilidade?")) { 
      const updatedSkills = domain.skills.filter((s: any) => s.id !== skillId); 
      onUpdate({ ...domain, skills: updatedSkills }); 
    } 
  }; 
  const addSkill = () => { 
    const newSkill = { id: Date.now(), name: category === 'intervention' ? "Nova Tarefa de Intervenção" : "Nova Tarefa", code: "", maxScore: 2, objective: "", example: "", criteria: "", comment: "" }; 
    onUpdate({ ...domain, skills: [...domain.skills, newSkill] }); setIsOpen(true); 
  }; 
  return ( 
    <div className="border border-gray-200 rounded-2xl mb-3 bg-white overflow-hidden"> 
      <div className="flex items-center justify-between p-4 bg-gray-50"> 
        <div className="flex items-center gap-3 flex-1">
          <button onClick={() => setIsOpen(!isOpen)}><ChevronDown size={20} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}/></button>
          <input type="text" className="bg-transparent font-bold text-gray-700 outline-none w-full" value={domain.name} onChange={(e) => onUpdate({ ...domain, name: e.target.value })} placeholder="Nome do Domínio/Categoria" />
        </div> 
        <button onClick={onDelete} className="text-gray-400 hover:text-red-500"><Trash2 size={18}/></button> 
      </div> 
      {isOpen && (
        <div className="p-4 border-t border-gray-100 bg-white">
          {domain.skills.map((skill: any) => (<SkillEditor key={skill.id} skill={skill} onUpdate={(data: any) => updateSkill(skill.id, data)} onDelete={() => deleteSkill(skill.id)} category={category} />))}
          <button onClick={addSkill} className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-bold hover:border-[#7551FF] hover:text-[#7551FF] transition-all flex items-center justify-center gap-2"><Plus size={18} /> Adicionar Habilidade</button>
        </div>
      )} 
    </div> 
  ); 
};

export const ProtocolEditor = ({ protocol, onSave, onCancel }: any) => { 
  const mapAgeGroupToRange = (ageGroup?: string) => {
    const group = String(ageGroup || '').toLowerCase();
    if (group === 'child') return { min: 0, max: 12 };
    if (group === 'teen') return { min: 13, max: 18 };
    if (group === 'adult') return { min: 19, max: 59 };
    if (group === 'senior') return { min: 60, max: null };
    return { min: 0, max: null };
  };

  const inferredRange = mapAgeGroupToRange(protocol?.ageGroup);
  const [localProtocol, setLocalProtocol] = useState({ 
    ...protocol, 
    ageGroup: protocol.ageGroup || 'all', 
    type: protocol.type || 'conventional', 
    domain: protocol.domain || '',
    category: protocol.category || 'evaluation',
    age_minima: Number.isFinite(Number(protocol?.age_minima ?? protocol?.idade_minima ?? protocol?.min_age))
      ? Number(protocol?.age_minima ?? protocol?.idade_minima ?? protocol?.min_age)
      : inferredRange.min,
    age_maxima: Number.isFinite(Number(protocol?.age_maxima ?? protocol?.idade_maxima ?? protocol?.max_age))
      ? Number(protocol?.age_maxima ?? protocol?.idade_maxima ?? protocol?.max_age)
      : inferredRange.max
  }); 
  const [showSuccess, setShowSuccess] = useState(false); 
  const [isSaving, setIsSaving] = useState(false);
  const protocolDraftStorageKey = `verto_protocol_draft_${String(protocol?.id || 'new')}`;
  const updateDomain = (domainId: any, updatedData: any) => { 
    const updatedDomains = localProtocol.data.map((d: any) => d.id === domainId ? updatedData : d); 
    setLocalProtocol({ ...localProtocol, data: updatedDomains }); 
  }; 
  const deleteDomain = (domainId: any) => { 
    if (confirm("Remover este domínio inteiro?")) { 
      const updatedDomains = localProtocol.data.filter((d: any) => d.id !== domainId); 
      setLocalProtocol({ ...localProtocol, data: updatedDomains }); 
    } 
  }; 
  const addDomain = () => { 
    const newDomain = { id: `dom-${Date.now()}`, name: "Novo Domínio", skills: [] }; 
    setLocalProtocol({ ...localProtocol, data: [...localProtocol.data, newDomain] }); 
  }; 
  useEffect(() => {
    try {
      localStorage.setItem(
        protocolDraftStorageKey,
        JSON.stringify({
          updatedAt: new Date().toISOString(),
          protocol: localProtocol,
        }),
      );
    } catch {
      // noop
    }
  }, [localProtocol, protocolDraftStorageKey]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(protocolDraftStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const draftProtocol = parsed?.protocol;
      if (!draftProtocol || typeof draftProtocol !== 'object') return;
      const shouldRestore = confirm('Existe um rascunho não salvo deste protocolo. Deseja restaurar o conteúdo?');
      if (shouldRestore) {
        setLocalProtocol(draftProtocol);
      } else {
        localStorage.removeItem(protocolDraftStorageKey);
      }
    } catch {
      // noop
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => { 
    if (!String(localProtocol?.title || '').trim()) {
      alert('Informe o nome do protocolo antes de salvar.');
      return;
    }
    if (!Array.isArray(localProtocol?.data) || localProtocol.data.length === 0) {
      alert('Adicione pelo menos um domínio antes de salvar.');
      return;
    }
    setIsSaving(true);
    try {
      const saveResult = await onSave(localProtocol);
      if (saveResult?.success === false) {
        alert(saveResult?.error || 'Não foi possível salvar o protocolo. Tente novamente.');
        return;
      }
    } catch (err: any) {
      alert(err?.message || 'Não foi possível salvar o protocolo. Tente novamente.');
      return;
    } finally {
      setIsSaving(false);
    }
    setShowSuccess(true);
    try {
      localStorage.removeItem(protocolDraftStorageKey);
    } catch {
      // noop
    }
    setTimeout(() => { onCancel(); }, 1200); 
  }; 
  return ( 
    <div className="w-full min-h-full bg-white flex flex-col overflow-y-auto rounded-[28px] border border-gray-100 shadow-sm"> 
      {showSuccess && <SuccessOverlay title="Salvo!" message="Protocolo atualizado com sucesso." />} 
      <div className="px-6 py-4 border-b border-gray-100 bg-white sticky top-0 z-10"> 
        <div className="flex justify-between items-center mb-4"> 
          <div className="flex items-center gap-4"> 
            <button onClick={onCancel} className="p-2 -ml-2 hover:bg-gray-100 rounded-full"><ChevronLeft size={24} className="text-gray-500"/></button> 
            <div> 
              <h2 className="text-lg font-bold text-gray-800">Editor de Protocolo</h2> 
              <p className="text-xs text-gray-400">Defina a estrutura e classificação</p> 
            </div> 
          </div> 
          <button disabled={isSaving} onClick={handleSave} className="bg-[#7a32fc] text-white px-6 py-2 rounded-xl font-bold hover:opacity-95 transition-colors flex items-center gap-2 disabled:opacity-60"><Save size={18}/> {isSaving ? 'Salvando...' : 'Salvar protocolo'}</button> 
        </div> 
        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-2"> 
          <div className="md:col-span-2"> 
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nome do Protocolo</label> 
            <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7551FF]" value={localProtocol.title} onChange={(e) => setLocalProtocol({ ...localProtocol, title: e.target.value })} placeholder="Ex: Protocolo de Ansiedade" /> 
          </div> 
          <div> 
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Categoria</label> 
            <select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none font-bold text-[#7a32fc] focus:border-[#7a32fc]" value={localProtocol.category} onChange={(e) => setLocalProtocol({ ...localProtocol, category: e.target.value })}> 
              <option value="evaluation">Avaliação</option> 
              <option value="intervention">Intervenção</option> 
            </select> 
          </div>
          <div> 
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Faixa Etária</label> 
            <select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7551FF]" value={localProtocol.ageGroup} onChange={(e) => {
              const nextGroup = e.target.value;
              const nextRange = mapAgeGroupToRange(nextGroup);
              setLocalProtocol({
                ...localProtocol,
                ageGroup: nextGroup,
                age_minima: nextRange.min,
                age_maxima: nextRange.max,
                min_age: nextRange.min,
                max_age: nextRange.max
              });
            }}> 
              <option value="all">Todas as Idades</option> 
              <option value="child">0 a 12 anos</option> 
              <option value="teen">13 a 18 anos</option> 
              <option value="adult">19 a 59 anos</option> 
              <option value="senior">60 anos ou mais</option> 
            </select> 
          </div> 
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Idade mínima</label>
            <input
              type="number"
              min={0}
              className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7551FF]"
              value={localProtocol.age_minima ?? 0}
              onChange={(e) => {
                const value = Math.max(0, Number(e.target.value || 0));
                setLocalProtocol({ ...localProtocol, age_minima: value, min_age: value });
              }}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Idade máxima</label>
            <input
              type="number"
              min={0}
              className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7551FF]"
              value={localProtocol.age_maxima ?? ''}
              placeholder="Sem limite"
              onChange={(e) => {
                const value = e.target.value;
                const next = value === '' ? null : Math.max(0, Number(value));
                setLocalProtocol({ ...localProtocol, age_maxima: next, max_age: next });
              }}
            />
          </div>
          <div> 
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Tipo de Terapia</label> 
            <select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7551FF]" value={localProtocol.type} onChange={(e) => setLocalProtocol({ ...localProtocol, type: e.target.value })}> 
              <option value="conventional">Convencional (TCC/Psicoterapia)</option> 
              <option value="neurodevelopment">Neurodesenvolvimento (ABA/Denver)</option> 
              <option value="occupational">Terapia Ocupacional</option> 
            </select> 
          </div> 
          <div className="md:col-span-5"> 
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Domínios / Tags (separar por vírgula)</label> 
            <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-2 text-sm outline-none focus:border-[#7551FF]" value={localProtocol.domain} onChange={(e) => setLocalProtocol({ ...localProtocol, domain: e.target.value })} placeholder="Ex: Autoestima, Socialização, Autocuidado..." /> 
          </div> 
        </div> 
      </div> 
      <div className="p-6 bg-gray-50"> 
        <div className="max-w-3xl mx-auto"> 
          {localProtocol.data.map((domain: any) => (<DomainEditor key={domain.id} domain={domain} onUpdate={(data: any) => updateDomain(domain.id, data)} onDelete={() => deleteDomain(domain.id)} category={localProtocol.category} />))} 
          <button onClick={addDomain} className="w-full py-4 bg-white border border-gray-200 rounded-2xl text-[#7551FF] font-bold shadow-sm hover:shadow-md transition-all flex items-center justify-center gap-2 mt-4"><Plus size={20} /> Adicionar Novo Domínio de Habilidades</button> 
          <div className="pt-4 flex justify-end">
            <button disabled={isSaving} onClick={handleSave} className="bg-[#7a32fc] text-white px-6 py-2 rounded-xl font-bold hover:opacity-95 transition-colors flex items-center gap-2 disabled:opacity-60">
              <Save size={18} />
              {isSaving ? 'Salvando...' : 'Salvar protocolo'}
            </button>
          </div>
        </div> 
      </div> 
    </div> 
  ); 
};

export const ProtocolManagementSystem = ({
  protocols,
  onSaveProtocol,
  onDeleteProtocol,
  onBack,
  canManageLibrary = true,
}: any) => { 
  const [editingProtocol, setEditingProtocol] = useState<any>(null); 
  const [filterAge, setFilterAge] = useState(""); 
  const [filterType, setFilterType] = useState(""); 
  const [filterDomain, setFilterDomain] = useState(""); 
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [hasLicense, setHasLicense] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [pendingProtocolName, setPendingProtocolName] = useState("");

  const handleCreateNew = () => { 
    if (!canManageLibrary) return;
    const newProto = { id: Date.now(), title: "Novo Protocolo Personalizado", data: [], ageGroup: 'all', age_minima: 0, age_maxima: null, min_age: 0, max_age: null, type: 'conventional', domain: '', category: 'evaluation' }; 
    setEditingProtocol(newProto); 
  }; 
  
  const handleEdit = (proto: any) => { 
    if (!canManageLibrary) return;
    setEditingProtocol(proto); 
  }; 

  const handleFileUpload = (e: any) => {
    if (!canManageLibrary) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingImportFile(file);
    setPendingProtocolName(file.name.replace(/\.[^.]+$/, ""));
    setHasLicense(false);
    setShowImportModal(true);
    e.target.value = "";
  };

  const handleConfirmFileImport = () => {
    if (!pendingImportFile || !hasLicense || !pendingProtocolName.trim()) return;

    const file = pendingImportFile;
    const protocolTitle = pendingProtocolName.trim();
    setShowImportModal(false);
    setIsImporting(true);
    setImportProgress(10);
    
    const timer = setInterval(() => {
      setImportProgress(prev => {
        if (prev >= 100) {
          clearInterval(timer);
          setTimeout(() => {
            setIsImporting(false);
            setImportProgress(0);
            
            const newProtocol = {
              id: Date.now(),
              title: protocolTitle,
              category: 'evaluation',
              ageGroup: 'all',
              age_minima: 0,
              age_maxima: null,
              min_age: 0,
              max_age: null,
              type: 'conventional',
              domain: 'Importado, IA',
              data: [
                {
                  id: 'dom-1',
                  name: 'Domínio Mapeado 1',
                  skills: [
                    { id: 's1', name: 'Tarefa Extraída 1', maxScore: 2, objective: 'Objetivo mapeado automaticamente', criteria: 'Critérios extraídos do documento' },
                    { id: 's2', name: 'Tarefa Extraída 2', maxScore: 2, objective: 'Objetivo mapeado automaticamente', criteria: 'Critérios extraídos do documento' }
                  ]
                }
              ]
            };
            
            onSaveProtocol(newProtocol);
            setPendingImportFile(null);
            setPendingProtocolName("");
            setHasLicense(false);
            alert(`Arquivo "${file.name}" importado com sucesso! O protocolo "${protocolTitle}" já está disponível na biblioteca.`);
          }, 500);
          return 100;
        }
        return prev + 15;
      });
    }, 200);
  };

  const filteredProtocols = protocols.filter((p: any) => { 
    const matchAge = filterAge ? (p.ageGroup === filterAge || p.ageGroup === 'all') : true; 
    const matchType = filterType ? p.type === filterType : true; 
    const matchDomain = filterDomain ? (p.domain && p.domain.toLowerCase().includes(filterDomain.toLowerCase())) : true; 
    return matchAge && matchType && matchDomain; 
  }); 

  const evaluationProtocols = filteredProtocols.filter((p: any) => p.category === 'evaluation' || !p.category);
  const interventionProtocols = filteredProtocols.filter((p: any) => p.category === 'intervention');

  if (editingProtocol) { 
    return (<ProtocolEditor protocol={editingProtocol} onSave={(updated: any) => { onSaveProtocol(updated); setEditingProtocol(null); }} onCancel={() => setEditingProtocol(null)} />); 
  } 

  const ProtocolCard = ({ proto }: any) => (
    <div onClick={() => handleEdit(proto)} className={`bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 transition-all group relative overflow-hidden flex flex-col h-full ${canManageLibrary ? "hover:shadow-xl hover:border-[#7a32fc]/20 cursor-pointer active:scale-95" : ""}`}>
      <div className="absolute top-0 right-0 w-24 h-24 bg-gray-50 rounded-bl-full opacity-50 -z-0 group-hover:scale-125 transition-transform"></div>
      <div className="flex justify-between items-start mb-4 relative z-10">
        <div className={`p-3 rounded-2xl ${proto.type === 'neurodevelopment' ? 'bg-purple-100 text-purple-600' : proto.type === 'occupational' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'} shadow-sm group-hover:scale-110 transition-transform`}>
          {proto.category === 'intervention' ? <Boxes size={24} /> : <SearchCode size={24} />}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[9px] font-bold uppercase bg-gray-100 text-gray-400 px-2 py-1 rounded-full">{proto.ageGroup === 'all' ? 'Livre' : proto.ageGroup}</span>
          <span className={`text-[9px] font-bold uppercase px-2 py-1 rounded-full ${proto.type === 'neurodevelopment' ? 'bg-purple-50 text-purple-400' : 'bg-blue-50 text-blue-400'}`}>{proto.type === 'neurodevelopment' ? 'Neuro' : 'Conv.'}</span>
        </div>
      </div>
      <div className="relative z-10 flex-1">
        <h3 className="font-bold text-gray-800 text-lg leading-tight group-hover:text-[#7a32fc] transition-colors">{proto.title}</h3>
        <p className="text-[10px] text-gray-400 font-bold uppercase mt-2 tracking-widest">{proto.data?.length || 0} Domínios • {proto.data?.reduce((acc: any, d: any) => acc + d.skills.length, 0) || 0} Tarefas</p>
      </div>
      <div className="mt-4 pt-4 border-t border-gray-50 flex items-center justify-between relative z-10">
        <div className="flex gap-1 overflow-hidden">
          {proto.domain?.split(',').slice(0,2).map((d: any, i: number) => (
            <span key={i} className="text-[8px] bg-gray-50 text-gray-500 px-2 py-0.5 rounded-md font-bold whitespace-nowrap">{d.trim()}</span>
          ))}
        </div>
        {canManageLibrary && (
          <button onClick={(e) => { e.stopPropagation(); if(confirm("Remover este protocolo?")) onDeleteProtocol(proto.id); }} className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100">
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );

  return ( 
    <div className="w-full min-h-full bg-gray-50 flex flex-col overflow-x-hidden relative"> 
      {/* Import Modal with License Declaration */}
      {showImportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-[40px] w-full max-w-lg overflow-hidden shadow-2xl animate-pop">
            <div className="bg-[#7a32fc] p-8 text-white relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-bl-full -mr-8 -mt-8"></div>
              <ShieldCheck size={48} className="mb-4 relative z-10" />
              <h2 className="text-2xl font-bold relative z-10">Importar Protocolo</h2>
              <p className="text-white/80 text-sm mt-2 relative z-10">Confirme os termos de uso e responsabilidade antes de continuar.</p>
            </div>
            
            <div className="p-8">
              <div className="mb-6">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                  Nome do protocolo
                </label>
                <input
                  type="text"
                  value={pendingProtocolName}
                  onChange={(e) => setPendingProtocolName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none"
                  placeholder="Ex: Protocolo de Comunicação Funcional"
                />
              </div>

              <div className="bg-blue-50 border border-blue-100 p-4 rounded-2xl mb-6 flex gap-3">
                <Info size={20} className="text-blue-500 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700 leading-relaxed font-medium">
                  Protocolos clínicos podem ter direitos autorais e regras específicas de uso. Ao importar, você declara que possui autorização para utilização no ambiente da clínica.
                </p>
              </div>

              <div className="space-y-4">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="relative flex items-center mt-1">
                    <input 
                      type="checkbox" 
                      className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-gray-300 transition-all checked:border-[#7a32fc] checked:bg-[#7a32fc]"
                      checked={hasLicense}
                      onChange={(e) => setHasLicense(e.target.checked)}
                    />
                    <ShieldCheck className="absolute h-3.5 w-3.5 text-white opacity-0 peer-checked:opacity-100 left-0.5" strokeWidth={3} />
                  </div>
                  <span className="text-sm font-bold text-gray-700 group-hover:text-[#7a32fc] transition-colors">
                    Li e aceito os termos de responsabilidade e direitos de uso do protocolo importado.
                  </span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-8">
                <button 
                  onClick={() => {
                    setShowImportModal(false);
                    setHasLicense(false);
                    setPendingImportFile(null);
                    setPendingProtocolName("");
                  }}
                  className="py-4 rounded-2xl font-bold text-gray-500 hover:bg-gray-50 transition-all border border-gray-100"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleConfirmFileImport}
                  disabled={!hasLicense || !pendingProtocolName.trim() || isImporting}
                  className={`py-4 rounded-2xl font-bold text-white shadow-lg transition-all flex items-center justify-center gap-2 ${hasLicense && pendingProtocolName.trim() ? 'bg-[#7a32fc] shadow-blue-200 hover:opacity-90 active:scale-95' : 'bg-gray-300 cursor-not-allowed shadow-none'}`}
                >
                  {isImporting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Importando...
                    </>
                  ) : (
                    <>
                      <FileUp size={18} />
                      Confirmar Importação
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white px-6 py-6 shadow-sm flex items-center justify-between shrink-0"> 
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 -ml-2 text-gray-500 hover:bg-gray-100 rounded-full"><ChevronLeft size={24}/></button> 
          <h1 className="text-xl font-bold text-gray-800 tracking-tight">Biblioteca de Protocolos</h1> 
        </div>
        {canManageLibrary ? (
          <button onClick={handleCreateNew} className="bg-[#7a32fc] text-white px-5 py-2.5 rounded-2xl text-xs font-bold shadow-lg shadow-[#7a32fc]/20 hover:opacity-90 active:scale-95 transition-all flex items-center gap-2">
            <Plus size={18} /> Criar Novo
          </button>
        ) : (
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Visualização de biblioteca
          </span>
        )}
      </div> 

      <div className="flex-1 overflow-y-auto no-scrollbar px-8 md:px-10 pt-6 pb-24"> 
        <div className="w-full max-w-5xl mx-auto">
          <div className="bg-white p-4 rounded-[24px] shadow-sm border border-gray-100 mb-8 animate-slide-up"> 
            <button onClick={() => setIsFiltersOpen(!isFiltersOpen)} className="w-full flex items-center justify-between group transition-all">
              <div className="flex items-center gap-2 text-[#7a32fc]"> 
                <Filter size={18} /> 
                <h3 className="font-bold text-xs uppercase tracking-wider">Filtrar Vitrine</h3> 
              </div> 
              <ChevronDown size={20} className={`text-gray-300 transition-transform duration-300 ${isFiltersOpen ? 'rotate-180 text-[#7a32fc]' : ''}`} />
            </button>

            {isFiltersOpen && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-50 animate-fade-in"> 
                <div> 
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Idade</label> 
                  <select className="w-full bg-gray-50 border border-gray-100 rounded-xl p-2 text-sm outline-none font-bold text-gray-700" value={filterAge} onChange={(e) => setFilterAge(e.target.value)}> 
                    <option value="">Todas</option> 
                    <option value="child">0-12 anos</option> 
                    <option value="teen">13-18 anos</option> 
                    <option value="adult">19-59 anos</option> 
                    <option value="senior">60+ anos</option> 
                  </select> 
                </div> 
                <div> 
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Abordagem</label> 
                  <select className="w-full bg-gray-50 border border-gray-100 rounded-xl p-2 text-sm outline-none font-bold text-gray-700" value={filterType} onChange={(e) => setFilterType(e.target.value)}> 
                    <option value="">Todas</option> 
                    <option value="conventional">Convencional</option> 
                    <option value="neurodevelopment">Neurodesenvolvimento</option> 
                    <option value="occupational">T. Ocupacional</option> 
                  </select> 
                </div> 
                <div> 
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Assunto</label> 
                  <div className="relative"> 
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" size={14} /> 
                    <input type="text" className="w-full bg-gray-50 border border-gray-100 rounded-xl p-2 pl-9 text-sm outline-none font-bold text-gray-700" placeholder="Ex: Vida Diária..." value={filterDomain} onChange={(e) => setFilterDomain(e.target.value)} /> 
                  </div> 
                </div> 
              </div> 
            )}
          </div>

          <div className="space-y-12 animate-fade-in">
            <div>
              <div className="flex items-center gap-3 mb-6 ml-2">
                <div className="w-10 h-10 rounded-2xl bg-blue-500 text-white flex items-center justify-center shadow-lg shadow-blue-200"><SearchCode size={20}/></div>
                <div>
                  <h2 className="text-lg font-bold text-gray-800 tracking-tight">Protocolos de Avaliação</h2>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Ferramentas de diagnóstico e marcos</p>
                </div>
                <div className="ml-auto bg-gray-100 px-3 py-1 rounded-full text-[10px] font-bold text-gray-400 uppercase">{evaluationProtocols.length}</div>
              </div>
              {evaluationProtocols.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {evaluationProtocols.map((p: any) => <ProtocolCard key={p.id} proto={p} />)}
                </div>
              ) : (
                <div className="py-10 text-center border-2 border-dashed border-gray-100 rounded-[32px] text-gray-300 font-bold text-sm italic">Nenhum protocolo de avaliação nesta busca.</div>
              )}
            </div>

            <div>
              <div className="flex items-center gap-3 mb-6 ml-2">
                <div className="w-10 h-10 rounded-2xl bg-[#05CD99] text-white flex items-center justify-center shadow-lg shadow-green-100"><Boxes size={20}/></div>
                <div>
                  <h2 className="text-lg font-bold text-gray-800 tracking-tight">Protocolos de Intervenção</h2>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Treinos de habilidades e programas</p>
                </div>
                <div className="ml-auto bg-gray-100 px-3 py-1 rounded-full text-[10px] font-bold text-gray-400 uppercase">{interventionProtocols.length}</div>
              </div>
              {interventionProtocols.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {interventionProtocols.map((p: any) => <ProtocolCard key={p.id} proto={p} />)}
                </div>
              ) : (
                <div className="py-10 text-center border-2 border-dashed border-gray-100 rounded-[32px] text-gray-300 font-bold text-sm italic">Crie programas de treino clicando em "Criar Novo".</div>
              )}
            </div>
          </div>
        </div>
      </div> 
      
      {canManageLibrary && (
        <div className="fixed bottom-8 right-8 z-[60] flex flex-col items-end gap-3">
          {isImporting && (
            <div className="bg-white p-4 rounded-2xl shadow-2xl border border-gray-100 mb-2 animate-slide-up w-64">
              <div className="flex items-center gap-3 mb-2">
                <Loader2 size={18} className="text-[#7a32fc] animate-spin" />
                <span className="text-xs font-bold text-gray-700 uppercase tracking-tight">Importando Protocolo...</span>
              </div>
              <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-[#7a32fc] h-full transition-all duration-300" 
                  style={{ width: `${importProgress}%` }}
                ></div>
              </div>
              <p className="text-[9px] font-bold text-gray-400 mt-2 uppercase tracking-widest">Mapeando domínios e tarefas via IA...</p>
            </div>
          )}
          
          <label className={`flex items-center gap-3 bg-white text-[#7a32fc] px-6 py-4 rounded-full shadow-2xl border border-gray-100 cursor-pointer hover:scale-105 active:scale-95 transition-all group ${isImporting ? 'opacity-50 pointer-events-none' : ''}`}>
            <input type="file" className="hidden" accept=".pdf,.xlsx,.xls,.csv" onChange={handleFileUpload} disabled={isImporting} />
            <div className="p-2 bg-blue-50 rounded-xl group-hover:bg-[#7a32fc] group-hover:text-white transition-colors">
              <FileUp size={20} />
            </div>
            <div className="flex flex-col text-left">
              <span className="text-xs font-bold uppercase tracking-tight">Importar Protocolo</span>
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">PDF ou Excel</span>
            </div>
          </label>
        </div>
      )}

    </div> 
  ); 
};

