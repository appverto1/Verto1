import React, { useEffect, useState } from 'react';
import { ChevronDown, Trash2, Plus, ChevronLeft, Save, SearchCode, Boxes, Filter, Search, FileUp, Loader2, ShieldCheck, Info, Camera, Smartphone, Clock, CheckCircle2 } from 'lucide-react';
import { SuccessOverlay } from './Common';
import { AFLS_ADULT_SOCIAL_PARTICIPATION_PROTOCOL } from '../constants/aflsProtocol';
import { VBMAPP_LEVEL_1_CANONICAL_PROTOCOL } from '../constants/vbmappLevel1Protocol';
import { VBMAPP_LEVEL_2_CANONICAL_PROTOCOL } from '../constants/vbmappLevel2Protocol';
import { VBMAPP_LEVEL_3_CANONICAL_PROTOCOL } from '../constants/vbmappLevel3Protocol';
import { dataService } from '../services/dataService';

const getLicensedCanonicalProtocolForRequest = (request: any) => {
  const source = `${request?.canonicalKey || ''} ${request?.canonicalName || ''} ${request?.protocolName || ''}`.toLowerCase();
  if (source.includes('afls') || source.includes('participacao-social') || source.includes('participação social')) {
    return AFLS_ADULT_SOCIAL_PARTICIPATION_PROTOCOL;
  }
  if (
    source.includes('vb-mapp-level-3')
    || source.includes('vb-mapp-nivel-3')
    || source.includes('vbmapp3')
    || source.includes('vb-mapp3')
    || source.includes('nivel 3')
    || source.includes('30 a 48')
  ) {
    return VBMAPP_LEVEL_3_CANONICAL_PROTOCOL;
  }
  if (
    source.includes('vb-mapp-level-2')
    || source.includes('vb-mapp-nivel-2')
    || source.includes('vbmapp2')
    || source.includes('vb-mapp2')
    || source.includes('nivel 2')
    || source.includes('18 a 30')
  ) {
    return VBMAPP_LEVEL_2_CANONICAL_PROTOCOL;
  }
  if (source.includes('vb-mapp') || source.includes('vbmapp') || source.includes('vb mapp')) {
    return VBMAPP_LEVEL_1_CANONICAL_PROTOCOL;
  }
  return null;
};

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
  const [isDarkTheme, setIsDarkTheme] = useState(() => document.body.classList.contains('theme-dark'));
  const [showImportModal, setShowImportModal] = useState(false);
  const [hasLicense, setHasLicense] = useState(false);
  const [isCompleteProtocol, setIsCompleteProtocol] = useState(false);
  const [pendingProtocolName, setPendingProtocolName] = useState("");
  const [pendingAgeFrom, setPendingAgeFrom] = useState("18");
  const [pendingAgeTo, setPendingAgeTo] = useState("");
  const [requestedScreenshotPage, setRequestedScreenshotPage] = useState(4);
  const [selectedScreenshotFile, setSelectedScreenshotFile] = useState<File | null>(null);
  const [importStatusMessage, setImportStatusMessage] = useState("");
  const [importedProtocolStatuses, setImportedProtocolStatuses] = useState<any[]>([]);

  useEffect(() => {
    const syncTheme = () => setIsDarkTheme(document.body.classList.contains('theme-dark'));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const nextRandomScreenshotPage = () => Math.floor(Math.random() * 11) + 2;
  const ageOptions = Array.from({ length: 121 }, (_, age) => age);
  const deriveApplicableAgeGroup = (ageFromValue: string, ageToValue: string) => {
    const from = Number(ageFromValue || 0);
    const to = ageToValue === "" ? null : Number(ageToValue);
    if (from >= 18) return "adult";
    if (to !== null && to <= 12) return "child";
    if (from >= 13 && to !== null && to <= 17) return "teen";
    return "all";
  };
  const formatAgeRange = (ageFrom?: any, ageTo?: any, fallbackGroup?: string) => {
    const from = Number(ageFrom);
    const hasFrom = Number.isFinite(from);
    const hasTo = ageTo !== null && ageTo !== undefined && ageTo !== "";
    const to = hasTo ? Number(ageTo) : null;
    if (hasFrom) return `${from} ate ${Number.isFinite(to as number) ? to : "+"} anos`;
    if (fallbackGroup === "child") return "0 ate 12 anos";
    if (fallbackGroup === "teen") return "13 ate 17 anos";
    if (fallbackGroup === "adult") return "18+ anos";
    return "Livre";
  };
  const formatProtocolRequestDateTime = (value: any) => {
    if (!value) return "data nao informada";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "data nao informada";
    return date.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  };
  const manualProtocolBackupKey = 'verto_manual_protocol_editor_snapshot';
  const persistManualProtocolSnapshot = (nextProtocols: any[]) => {
    try {
      localStorage.setItem(
        manualProtocolBackupKey,
        JSON.stringify({
          updatedAt: new Date().toISOString(),
          protocols: nextProtocols,
        }),
      );
    } catch {
      // O banco continua sendo a fonte principal; este backup e apenas redundancia local.
    }
  };
  const prepareManualProtocolForPersistence = (protocol: any) => {
    const nowIso = new Date().toISOString();
    const existingId = protocol?.id ? String(protocol.id) : '';
    return {
      ...protocol,
      id: existingId || `manual-protocol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      origin: protocol?.origin || (protocol?.isApprovedImport ? 'verto_approved_import' : 'manual_editor'),
      isManualProtocol: protocol?.isManualProtocol ?? !protocol?.isApprovedImport,
      createdAt: protocol?.createdAt || nowIso,
      updatedAt: nowIso,
      version: Number(protocol?.version || 0) + 1,
    };
  };
  const persistProtocolListImmediately = async (nextProtocols: any[]) => {
    persistManualProtocolSnapshot(nextProtocols);
    const result = await dataService.saveClinicState({ protocols: nextProtocols });
    if (result?.success === false) {
      console.warn('[protocol-library] saved local protocol backup; remote persistence pending:', result?.warning || result?.error);
    }
    return result;
  };

  const resetImportState = () => {
    setShowImportModal(false);
    setHasLicense(false);
    setIsCompleteProtocol(false);
    setPendingProtocolName("");
    setPendingAgeFrom("18");
    setPendingAgeTo("");
    setRequestedScreenshotPage(nextRandomScreenshotPage());
    setSelectedScreenshotFile(null);
    setImportStatusMessage("");
  };

  const openImportModal = () => {
    if (!canManageLibrary) return;
    setPendingProtocolName("");
    setPendingAgeFrom("18");
    setPendingAgeTo("");
    setRequestedScreenshotPage(nextRandomScreenshotPage());
    setSelectedScreenshotFile(null);
    setHasLicense(false);
    setIsCompleteProtocol(false);
    setImportStatusMessage("");
    setShowImportModal(true);
  };

  useEffect(() => {
    if (!canManageLibrary) return;
    let cancelled = false;

    const loadImportedStatuses = async () => {
      try {
        const response = await fetch('/api/protocol-import-requests', { credentials: 'include' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) return;
        if (!cancelled) {
          setImportedProtocolStatuses(Array.isArray(data.data) ? data.data : []);
        }
      } catch {
        if (!cancelled) setImportedProtocolStatuses([]);
      }
    };

    loadImportedStatuses();
    return () => {
      cancelled = true;
    };
  }, [canManageLibrary]);

  const handleCreateNew = () => { 
    if (!canManageLibrary) return;
    const newProto = { id: Date.now(), title: "Novo Protocolo Personalizado", data: [], ageGroup: 'all', age_minima: 0, age_maxima: null, min_age: 0, max_age: null, type: 'conventional', domain: '', category: 'evaluation' }; 
    setEditingProtocol(newProto); 
  }; 
  
  const handleEdit = (proto: any) => { 
    if (!canManageLibrary) return;
    setEditingProtocol(proto); 
  }; 

  const handleScreenshotFileChange = (file: File | null) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      alert("Envie screenshots em PNG, JPG ou WEBP.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      alert("Cada screenshot deve ter no maximo 8 MB.");
      return;
    }
    setSelectedScreenshotFile(file);
    setHasLicense(false);
    setIsCompleteProtocol(false);
  };

  const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Nao foi possivel ler o arquivo."));
    reader.readAsDataURL(file);
  });

  const handleConfirmFileImport = async () => {
    const protocolTitle = pendingProtocolName.trim();
    if (!protocolTitle || !hasLicense || !isCompleteProtocol || !selectedScreenshotFile) return;
    const ageMin = Number(pendingAgeFrom || 0);
    const ageMax = pendingAgeTo === "" ? null : Number(pendingAgeTo);
    if (!Number.isFinite(ageMin) || ageMin < 0 || ageMin > 120 || (ageMax !== null && (!Number.isFinite(ageMax) || ageMax < ageMin))) {
      alert("Confira a idade do protocolo. O campo 'ate' precisa ser maior ou igual ao campo 'de'.");
      return;
    }
    const applicableAgeGroup = deriveApplicableAgeGroup(pendingAgeFrom, pendingAgeTo);

    setIsImporting(true);
    setImportProgress(10);
    setImportStatusMessage("Enviando print para validacao segura da Verto...");

    try {
      const dataUrl = await readFileAsDataUrl(selectedScreenshotFile);
      setImportProgress(45);
      const response = await fetch("/api/protocol-import-requests", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evidenceMode: "screenshots",
          protocolName: protocolTitle,
          applicableAgeGroup,
          ageMin,
          ageMax,
          screenshotChallenges: [{
            pageNumber: requestedScreenshotPage,
            prompt: `Envie um print nitido da pagina ${requestedScreenshotPage} do protocolo.`,
            fileName: selectedScreenshotFile.name,
            fileType: selectedScreenshotFile.type,
            fileSize: selectedScreenshotFile.size,
            dataUrl
          }],
          rightsAccepted: hasLicense,
          fullProtocolConfirmed: isCompleteProtocol
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Nao foi possivel enviar o protocolo.");
      }

      setImportProgress(100);
      setImportStatusMessage(`Solicitacao criada. Sugestao Verto: ${data.data?.suggestedCanonicalName || "analise manual"}.`);
      setImportedProtocolStatuses((current) => ([
        {
          id: data.data?.id || `local-${Date.now()}`,
          protocolName: protocolTitle,
          status: 'pending',
          canonicalName: data.data?.suggestedCanonicalName || 'Analise manual',
          confidence: Number(data.data?.suggestedConfidence || 0),
          applicableAgeGroup,
          ageMin,
          ageMax,
          createdAt: new Date().toISOString(),
          reviewedAt: null
        },
        ...current
      ]));
      setTimeout(() => {
        setIsImporting(false);
        setImportProgress(0);
        resetImportState();
        alert(`Protocolo "${protocolTitle}" enviado com sucesso.`);
      }, 650);
    } catch (error: any) {
      setIsImporting(false);
      setImportProgress(0);
      setImportStatusMessage("");
      alert(error?.message || "Nao foi possivel enviar o protocolo para validacao.");
    }
  };

  const handleDeleteImportedRequest = async (proto: any) => {
    const requestId = proto?.importRequestId;
    if (!requestId) return;
    const status = String(proto?.requestStatus || 'pending').toLowerCase();
    const message = status === 'approved'
      ? `Excluir "${proto.title}" dos protocolos liberados? Isso remove esta liberacao da sua lista.`
      : `Excluir a solicitacao de "${proto.title}"? Ela sera removida da analise e nao aparecera mais na biblioteca.`;
    if (!confirm(message)) return;

    setImportedProtocolStatuses((current) => current.filter((item: any) => String(item.id) !== String(requestId)));
    if (String(requestId).startsWith('local-')) return;

    try {
      const response = await fetch(`/api/protocol-import-requests/${encodeURIComponent(requestId)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Nao foi possivel excluir a solicitacao.');
      }
    } catch (error: any) {
      alert(error?.message || 'Nao foi possivel excluir a solicitacao.');
      setImportedProtocolStatuses((current) => {
        if (current.some((item: any) => String(item.id) === String(requestId))) return current;
        return [{
          id: requestId,
          protocolName: proto.title,
          status: proto.requestStatus || 'pending',
          canonicalName: proto.domain || 'Em validacao',
          confidence: 0,
          applicableAgeGroup: proto.ageGroup || 'all',
          ageMin: proto.ageMin ?? null,
          ageMax: proto.ageMax ?? null,
          createdAt: proto.requestCreatedAt || new Date().toISOString(),
          reviewedAt: proto.requestReviewedAt || null
        }, ...current];
      });
    }
  };

  const filteredProtocols = protocols.filter((p: any) => { 
    const matchAge = filterAge ? (p.ageGroup === filterAge || p.ageGroup === 'all') : true; 
    const matchType = filterType ? p.type === filterType : true; 
    const matchDomain = filterDomain ? (p.domain && p.domain.toLowerCase().includes(filterDomain.toLowerCase())) : true; 
    return matchAge && matchType && matchDomain; 
  }); 

  const now = Date.now();
  const temporaryImportedProtocols = importedProtocolStatuses
    .filter((item: any) => {
      const status = String(item.status || 'pending').toLowerCase();
      if (status === 'approved') return false;
      if (status !== 'rejected') return true;
      const baseDate = item.reviewedAt || item.createdAt;
      const expiry = new Date(baseDate || Date.now()).getTime() + (48 * 60 * 60 * 1000);
      return Number.isFinite(expiry) && expiry > now;
    })
    .map((item: any) => ({
      id: `temporary-request-${item.id}`,
      title: item.protocolName || 'Protocolo importado',
      ageGroup: item.applicableAgeGroup || 'all',
      ageMin: item.ageMin ?? null,
      ageMax: item.ageMax ?? null,
      type: 'conventional',
      domain: item.canonicalName || 'Em validacao',
      category: 'evaluation',
      data: [],
      isTemporaryRequest: true,
      importRequestId: item.id,
      requestStatus: String(item.status || 'pending').toLowerCase(),
      requestCreatedAt: item.createdAt || null,
      requestReviewedAt: item.reviewedAt || null
    }))
    .filter((item: any) => {
      const matchAge = filterAge ? (item.ageGroup === filterAge || item.ageGroup === 'all') : true;
      const matchType = filterType ? item.type === filterType : true;
      const domainSource = `${item.title} ${item.domain}`.toLowerCase();
      const matchDomain = filterDomain ? domainSource.includes(filterDomain.toLowerCase()) : true;
      return matchAge && matchType && matchDomain;
    });

  const approvedImportedProtocols = importedProtocolStatuses
    .filter((item: any) => String(item.status || 'pending').toLowerCase() === 'approved')
    .map((item: any) => {
      const canonicalProtocol: any = getLicensedCanonicalProtocolForRequest(item);
      return {
        ...(canonicalProtocol || {}),
        id: `approved-request-${item.id}`,
        title: canonicalProtocol?.title || item.protocolName || 'Protocolo liberado',
        ageGroup: canonicalProtocol?.ageGroup || item.applicableAgeGroup || 'all',
        ageMin: canonicalProtocol?.age_minima ?? canonicalProtocol?.min_age ?? item.ageMin ?? null,
        ageMax: canonicalProtocol?.age_maxima ?? canonicalProtocol?.max_age ?? item.ageMax ?? null,
        type: canonicalProtocol?.type || 'conventional',
        domain: canonicalProtocol?.domain || item.canonicalName || 'Liberado pela Verto',
        category: canonicalProtocol?.category || 'evaluation',
        data: canonicalProtocol?.data || [],
        isApprovedImport: true,
        importRequestId: item.id,
        requestStatus: 'approved',
        requestCreatedAt: item.createdAt || null,
        requestReviewedAt: item.reviewedAt || null
      };
    })
    .filter((item: any) => {
      const matchAge = filterAge ? (item.ageGroup === filterAge || item.ageGroup === 'all') : true;
      const matchType = filterType ? item.type === filterType : true;
      const domainSource = `${item.title} ${item.domain}`.toLowerCase();
      const matchDomain = filterDomain ? domainSource.includes(filterDomain.toLowerCase()) : true;
      return matchAge && matchType && matchDomain;
    });

  const baseEvaluationProtocols = filteredProtocols.filter((p: any) => p.category === 'evaluation' || !p.category);
  const evaluationProtocols = baseEvaluationProtocols;
  const interventionProtocols = filteredProtocols.filter((p: any) => p.category === 'intervention');

  const handlePersistedManualProtocolSave = async (updated: any) => {
    const protocolForSave = prepareManualProtocolForPersistence(updated);
    const exists = protocols.some((old: any) => String(old.id) === String(protocolForSave.id));
    const nextProtocols = exists
      ? protocols.map((old: any) => String(old.id) === String(protocolForSave.id) ? protocolForSave : old)
      : [...protocols, protocolForSave];
    await onSaveProtocol(protocolForSave, nextProtocols);
    await persistProtocolListImmediately(nextProtocols);
    setEditingProtocol(null);
    return { success: true };
  };

  const handlePersistedManualProtocolDelete = async (protocolId: any) => {
    const nextProtocols = protocols.filter((p: any) => String(p.id) !== String(protocolId));
    persistManualProtocolSnapshot(nextProtocols);
    onDeleteProtocol(protocolId, nextProtocols);
    await persistProtocolListImmediately(nextProtocols);
  };

  if (editingProtocol) { 
    return (<ProtocolEditor protocol={editingProtocol} onSave={handlePersistedManualProtocolSave} onCancel={() => setEditingProtocol(null)} />); 
  } 

  const ProtocolCard = ({ proto }: any) => {
    const isTemporaryRequest = Boolean(proto?.isTemporaryRequest);
    const isApprovedImport = Boolean(proto?.isApprovedImport);
    const requestStatus = String(proto?.requestStatus || 'pending').toLowerCase();
    const statusLabel = requestStatus === 'approved' ? 'Aprovado' : requestStatus === 'rejected' ? 'Recusado' : 'Em analise';
    const statusDotClass = requestStatus === 'approved'
      ? 'bg-emerald-400'
      : requestStatus === 'rejected'
        ? 'bg-rose-400'
        : 'bg-amber-400';
    const statusChipClass = requestStatus === 'approved'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/20'
      : requestStatus === 'rejected'
        ? 'bg-rose-500/15 text-rose-300 border-rose-400/20'
        : 'bg-amber-500/15 text-amber-300 border-amber-400/20';

    return (
    <div
      onClick={() => {
        if (isTemporaryRequest) return;
        if (isApprovedImport && !(proto.data?.length)) return;
        handleEdit(proto);
      }}
      className={`${isDarkTheme ? 'bg-[#101a2d] shadow-black/20 text-slate-100' : 'bg-white shadow-slate-200/70 text-slate-900'} p-6 rounded-[32px] shadow-2xl border transition-all group relative overflow-hidden flex flex-col h-full ${isDarkTheme ? (isTemporaryRequest || isApprovedImport ? 'border-white/15' : 'border-white/10') : 'border-slate-200'} ${canManageLibrary && !isTemporaryRequest && (!isApprovedImport || proto.data?.length) ? "hover:shadow-[#7a32fc]/10 hover:border-[#7a32fc]/40 cursor-pointer active:scale-95" : ""}`}
    >
      <div className="absolute top-0 right-0 w-24 h-24 bg-slate-400/20 rounded-bl-full opacity-70 -z-0 group-hover:scale-125 transition-transform"></div>
      <div className="flex justify-between items-start mb-4 relative z-10">
        <div className={`p-3 rounded-2xl ${proto.type === 'neurodevelopment' ? 'bg-purple-100 text-purple-600' : proto.type === 'occupational' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'} shadow-sm group-hover:scale-110 transition-transform`}>
          {proto.category === 'intervention' ? <Boxes size={24} /> : <SearchCode size={24} />}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`text-[9px] font-bold uppercase px-2 py-1 rounded-full ${isDarkTheme ? 'bg-white/10 text-slate-200' : 'bg-slate-100 text-slate-700'}`}>{formatAgeRange(proto.ageMin ?? proto.age_minima ?? proto.min_age, proto.ageMax ?? proto.age_maxima ?? proto.max_age, proto.ageGroup)}</span>
          <span className={`text-[9px] font-bold uppercase px-2 py-1 rounded-full ${proto.type === 'neurodevelopment' ? 'bg-purple-50 text-purple-400' : 'bg-blue-50 text-blue-400'}`}>{proto.type === 'neurodevelopment' ? 'Neuro' : 'Conv.'}</span>
        </div>
      </div>
      <div className="relative z-10 flex-1">
        <h3 className={`font-bold text-lg leading-tight group-hover:text-[#b794ff] transition-colors ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>{proto.title}</h3>
        {(isTemporaryRequest || isApprovedImport) ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass}`} />
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${statusChipClass}`}>
                {statusLabel}
              </span>
            </div>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
              Enviado em {formatProtocolRequestDateTime(proto.requestCreatedAt)}
            </p>
          </div>
        ) : (
          <p className={`text-[10px] font-bold uppercase mt-2 tracking-widest ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>{proto.data?.length || 0} Domínios • {proto.data?.reduce((acc: any, d: any) => acc + d.skills.length, 0) || 0} Tarefas</p>
        )}
      </div>
      <div className={`mt-4 pt-4 flex items-center justify-between relative z-10 ${isDarkTheme ? 'border-t border-white/10' : 'border-t border-slate-200'}`}>
        <div className="flex gap-1 overflow-hidden">
          {isTemporaryRequest ? (
            <span className="text-[9px] bg-white/10 text-slate-300 px-2 py-1 rounded-md font-bold whitespace-nowrap">
              Solicitacao temporaria
            </span>
          ) : isApprovedImport ? (
            <span className="text-[9px] bg-emerald-500/15 text-emerald-300 px-2 py-1 rounded-md font-bold whitespace-nowrap">
              Liberado pela Verto
            </span>
          ) : (
            proto.domain?.split(',').slice(0,2).map((d: any, i: number) => (
              <span key={i} className={`text-[8px] px-2 py-0.5 rounded-md font-bold whitespace-nowrap ${isDarkTheme ? 'bg-white/10 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>{d.trim()}</span>
            ))
          )}
        </div>
        {canManageLibrary && !isTemporaryRequest && !isApprovedImport && (
          <button
            type="button"
            title="Excluir protocolo"
            onClick={(e) => {
              e.stopPropagation();
              if(confirm(`Excluir o protocolo "${proto.title}" da biblioteca? Essa acao remove o protocolo para a equipe.`)) {
                void handlePersistedManualProtocolDelete(proto.id);
              }
            }}
            className="inline-flex items-center gap-1 rounded-xl bg-red-500/10 px-3 py-2 text-[10px] font-black uppercase text-red-300 hover:bg-red-500 hover:text-white transition-all"
          >
            <Trash2 size={16} />
            Excluir
          </button>
        )}
        {canManageLibrary && (isTemporaryRequest || isApprovedImport) && (
          <button
            type="button"
            title="Excluir solicitação"
            onClick={(e) => {
              e.stopPropagation();
              void handleDeleteImportedRequest(proto);
            }}
            className="inline-flex items-center gap-1 rounded-xl bg-red-500/10 px-3 py-2 text-[10px] font-black uppercase text-red-300 hover:bg-red-500 hover:text-white transition-all"
          >
            <Trash2 size={16} />
            Excluir
          </button>
        )}
      </div>
    </div>
  )};

  return ( 
    <div className={`w-full min-h-full flex flex-col overflow-x-hidden relative ${isDarkTheme ? 'bg-[#0b1220] text-slate-100' : 'bg-[#f3f6fb] text-slate-900'}`}> 
      {/* Import Modal with License Declaration */}
      {showImportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 animate-fade-in">
          <div className="bg-[#101a2d] border border-white/10 rounded-[28px] w-full max-w-md max-h-[92vh] overflow-hidden shadow-2xl animate-pop">
            <div className="bg-gradient-to-br from-[#7a32fc] to-[#2f7df4] p-6 text-white relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-bl-full -mr-8 -mt-8"></div>
              <ShieldCheck size={40} className="mb-3 relative z-10" />
              <h2 className="text-xl font-bold relative z-10">Importar Protocolo Inteligente</h2>
              <p className="text-white/80 text-xs mt-2 relative z-10">Preencha os dados e envie 1 print da pagina pedida pela Verto.</p>
            </div>
            
            <div className="p-5 sm:p-6 overflow-y-auto max-h-[calc(92vh-132px)]">
              <div className="mb-4">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                  Nome do protocolo
                </label>
                <input
                  type="text"
                  value={pendingProtocolName}
                  onChange={(e) => setPendingProtocolName(e.target.value)}
                  className="w-full bg-[#0b1220] border border-white/10 rounded-xl p-3 text-sm outline-none text-white"
                  placeholder="Ex: Protocolo de Comunicação Funcional"
                />
              </div>

              <div className="mb-4">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                  Idade do protocolo
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">De</span>
                    <select
                      value={pendingAgeFrom}
                      onChange={(e) => {
                        const nextFrom = e.target.value;
                        setPendingAgeFrom(nextFrom);
                        if (pendingAgeTo !== "" && Number(pendingAgeTo) < Number(nextFrom)) setPendingAgeTo(nextFrom);
                      }}
                      className="w-full bg-[#0b1220] border border-white/10 rounded-xl p-3 text-sm outline-none text-white"
                    >
                      {ageOptions.map((age) => (
                        <option key={age} value={age}>{age} anos</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Ate</span>
                    <select
                      value={pendingAgeTo}
                      onChange={(e) => setPendingAgeTo(e.target.value)}
                      className="w-full bg-[#0b1220] border border-white/10 rounded-xl p-3 text-sm outline-none text-white"
                    >
                      <option value="">Sem limite</option>
                      {ageOptions
                        .filter((age) => age >= Number(pendingAgeFrom || 0))
                        .map((age) => (
                          <option key={age} value={age}>{age} anos</option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 p-3.5">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-300 mb-3">Como tirar o print</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-[#0b1220] p-3 border border-white/10">
                    <div className="flex items-center gap-2 mb-2 text-white font-black text-sm">
                      <Camera size={16} />
                      Windows
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Abra o protocolo, va ate a pagina pedida e pressione <strong>Windows + Shift + S</strong>. Recorte a pagina inteira e salve em PNG ou JPG.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[#0b1220] p-3 border border-white/10">
                    <div className="flex items-center gap-2 mb-2 text-white font-black text-sm">
                      <Smartphone size={16} />
                      Celular
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Voce pode fazer screenshot no celular ou tirar foto da tela, desde que a numeracao da pagina e o conteudo fiquem legiveis.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mb-4 overflow-hidden rounded-3xl border border-amber-300/60 bg-gradient-to-br from-amber-400/20 via-violet-500/20 to-[#111a33] shadow-lg shadow-amber-950/20">
                <div className="flex items-start gap-3 p-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-300 text-[#1a2140] shadow-lg shadow-amber-950/20">
                    <Camera size={22} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-100">Atencao: print obrigatorio</p>
                    <p className="mt-1 text-xl font-black leading-tight text-white">
                      Envie a pagina <span className="text-amber-200">{requestedScreenshotPage}</span> do protocolo.
                    </p>
                    <p className="mt-2 text-xs font-semibold leading-relaxed text-amber-50/90">
                      Esse print ajuda a Verto a validar que sua clinica possui autorizacao para usar esse material. Sem uma imagem legivel da pagina pedida, a solicitacao pode ser recusada.
                    </p>
                  </div>
                </div>
              </div>

              <label className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-white/15 px-4 py-3.5 cursor-pointer hover:border-[#7a32fc] transition-all mb-4">
                <div>
                  <p className="text-xs font-black text-[#b794ff] uppercase">Enviar print</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {selectedScreenshotFile?.name || "PNG, JPG ou WEBP"}
                  </p>
                </div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => handleScreenshotFileChange(e.target.files?.[0] || null)}
                />
                <FileUp size={18} className="text-slate-300" />
              </label>

              {selectedScreenshotFile && (
                <>
                  <div className="bg-blue-500/10 border border-blue-400/20 p-3.5 rounded-2xl mb-4 flex gap-3">
                    <Info size={20} className="text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-100 leading-relaxed font-medium">
                      Protocolos clinicos podem ter direitos autorais e regras especificas de uso. Ao enviar esse print, voce confirma que a clinica tem permissao para utilizar este protocolo dentro da Verto.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <label className="flex items-start gap-3 cursor-pointer group">
                      <div className="relative flex items-center mt-1">
                        <input 
                          type="checkbox" 
                          className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-slate-500 transition-all checked:border-[#05CD99] checked:bg-[#05CD99]"
                          checked={isCompleteProtocol}
                          onChange={(e) => setIsCompleteProtocol(e.target.checked)}
                        />
                        <ShieldCheck className="absolute h-3.5 w-3.5 text-white opacity-0 peer-checked:opacity-100 left-0.5" strokeWidth={3} />
                      </div>
                      <span className="text-sm font-bold text-slate-200 group-hover:text-white transition-colors">
                        Confirmo que esse print corresponde a pagina pedida pela Verto e pertence ao protocolo completo da clinica.
                      </span>
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer group">
                      <div className="relative flex items-center mt-1">
                        <input 
                          type="checkbox" 
                          className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-slate-500 transition-all checked:border-[#7a32fc] checked:bg-[#7a32fc]"
                          checked={hasLicense}
                          onChange={(e) => setHasLicense(e.target.checked)}
                        />
                        <ShieldCheck className="absolute h-3.5 w-3.5 text-white opacity-0 peer-checked:opacity-100 left-0.5" strokeWidth={3} />
                      </div>
                      <span className="text-sm font-bold text-slate-200 group-hover:text-white transition-colors">
                        Li e aceito os termos de responsabilidade e direitos de uso do protocolo.
                      </span>
                    </label>
                  </div>
                </>
              )}
              {importStatusMessage && (
                <p className="mt-5 text-xs font-bold text-blue-100 bg-blue-500/10 border border-blue-400/20 rounded-2xl px-4 py-3">
                  {importStatusMessage}
                </p>
              )}

              <div className="grid grid-cols-2 gap-3 mt-6">
                <button 
                  onClick={resetImportState}
                  className="py-3.5 rounded-2xl font-bold text-slate-300 hover:bg-white/5 transition-all border border-white/10"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleConfirmFileImport}
                  disabled={!hasLicense || !isCompleteProtocol || !pendingProtocolName.trim() || !selectedScreenshotFile || isImporting}
                  className={`py-3.5 rounded-2xl font-bold text-white shadow-lg transition-all flex items-center justify-center gap-2 ${hasLicense && isCompleteProtocol && pendingProtocolName.trim() && selectedScreenshotFile ? 'bg-[#7a32fc] shadow-blue-950 hover:opacity-90 active:scale-95' : 'bg-slate-700 cursor-not-allowed shadow-none'}`}
                >
                  {isImporting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <FileUp size={18} />
                      Confirmar evidencias
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={`${isDarkTheme ? 'bg-[#101a2d] border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.28)]' : 'bg-white border-slate-200 shadow-sm'} border-b px-6 py-6 flex items-center justify-between shrink-0`}> 
        <div className="flex items-center gap-4">
          <button onClick={onBack} className={`p-2 -ml-2 rounded-full ${isDarkTheme ? 'text-slate-300 hover:bg-white/10' : 'text-slate-500 hover:bg-slate-100'}`}><ChevronLeft size={24}/></button> 
          <h1 className={`text-xl font-bold tracking-tight ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>Biblioteca de Protocolos</h1> 
        </div>
        {canManageLibrary ? (
          <button onClick={handleCreateNew} className="bg-[#7a32fc] text-white px-5 py-2.5 rounded-2xl text-xs font-bold shadow-lg shadow-[#7a32fc]/20 hover:opacity-90 active:scale-95 transition-all flex items-center gap-2">
            <Plus size={18} /> Criar Novo
          </button>
        ) : (
          <span className={`text-[10px] font-bold uppercase tracking-widest ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
            Visualização de biblioteca
          </span>
        )}
      </div> 

      <div className={`flex-1 overflow-y-auto no-scrollbar px-8 md:px-10 pt-6 pb-24 ${isDarkTheme ? 'bg-[radial-gradient(circle_at_top_left,rgba(122,50,252,0.16),transparent_32%),linear-gradient(180deg,#0b1220,#111827)]' : 'bg-[radial-gradient(circle_at_top_left,rgba(122,50,252,0.08),transparent_36%),linear-gradient(180deg,#f8fafc,#eef2f7)]'}`}> 
        <div className="w-full max-w-5xl mx-auto">
          <div className={`${isDarkTheme ? 'bg-[#101a2d] shadow-black/20 border-white/10' : 'bg-white shadow-slate-200/70 border-slate-200'} p-4 rounded-[24px] shadow-2xl border mb-8 animate-slide-up`}> 
            <button onClick={() => setIsFiltersOpen(!isFiltersOpen)} className="w-full flex items-center justify-between group transition-all">
              <div className="flex items-center gap-2 text-[#7a32fc]"> 
                <Filter size={18} /> 
                <h3 className="font-bold text-xs uppercase tracking-wider">Filtrar Vitrine</h3> 
              </div> 
              <ChevronDown size={20} className={`transition-transform duration-300 ${isDarkTheme ? 'text-slate-300' : 'text-slate-500'} ${isFiltersOpen ? 'rotate-180 text-[#b794ff]' : ''}`} />
            </button>

            {isFiltersOpen && (
              <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 animate-fade-in ${isDarkTheme ? 'border-t border-white/10' : 'border-t border-slate-200'}`}> 
                <div> 
                  <label className={`block text-[10px] font-bold uppercase mb-1 ml-1 ${isDarkTheme ? 'text-gray-400' : 'text-slate-500'}`}>Idade</label> 
                  <select className={`w-full rounded-xl p-2 text-sm outline-none font-bold ${isDarkTheme ? 'bg-[#0b1220] border border-white/10 text-slate-100' : 'bg-white border border-slate-300 text-slate-700'}`} value={filterAge} onChange={(e) => setFilterAge(e.target.value)}> 
                    <option value="">Todas</option> 
                    <option value="child">0-12 anos</option> 
                    <option value="teen">13-18 anos</option> 
                    <option value="adult">19-59 anos</option> 
                    <option value="senior">60+ anos</option> 
                  </select> 
                </div> 
                <div> 
                  <label className={`block text-[10px] font-bold uppercase mb-1 ml-1 ${isDarkTheme ? 'text-gray-400' : 'text-slate-500'}`}>Abordagem</label> 
                  <select className={`w-full rounded-xl p-2 text-sm outline-none font-bold ${isDarkTheme ? 'bg-[#0b1220] border border-white/10 text-slate-100' : 'bg-white border border-slate-300 text-slate-700'}`} value={filterType} onChange={(e) => setFilterType(e.target.value)}> 
                    <option value="">Todas</option> 
                    <option value="conventional">Convencional</option> 
                    <option value="neurodevelopment">Neurodesenvolvimento</option> 
                    <option value="occupational">T. Ocupacional</option> 
                  </select> 
                </div> 
                <div> 
                  <label className={`block text-[10px] font-bold uppercase mb-1 ml-1 ${isDarkTheme ? 'text-gray-400' : 'text-slate-500'}`}>Assunto</label> 
                  <div className="relative"> 
                    <Search className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDarkTheme ? 'text-gray-300' : 'text-slate-400'}`} size={14} /> 
                    <input type="text" className={`w-full rounded-xl p-2 pl-9 text-sm outline-none font-bold ${isDarkTheme ? 'bg-[#0b1220] border border-white/10 text-slate-100' : 'bg-white border border-slate-300 text-slate-700'}`} placeholder="Ex: Vida Diária..." value={filterDomain} onChange={(e) => setFilterDomain(e.target.value)} /> 
                  </div> 
                </div> 
              </div> 
            )}
          </div>

          <div className="space-y-12 animate-fade-in">
            {temporaryImportedProtocols.length > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-6 ml-2">
                  <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-lg shadow-amber-900/20"><Clock size={20}/></div>
                  <div>
                    <h2 className={`text-lg font-bold tracking-tight ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>Solicitações em análise</h2>
                    <p className={`text-[10px] font-bold uppercase tracking-widest ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>Envios temporários, recusados somem em 48 horas</p>
                  </div>
                  <div className="ml-auto bg-amber-500/15 px-3 py-1 rounded-full text-[10px] font-bold text-amber-300 uppercase">{temporaryImportedProtocols.length}</div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {temporaryImportedProtocols.map((p: any) => <ProtocolCard key={p.id} proto={p} />)}
                </div>
              </div>
            )}

            {approvedImportedProtocols.length > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-6 ml-2">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-900/20"><CheckCircle2 size={20}/></div>
                  <div>
                    <h2 className={`text-lg font-bold tracking-tight ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>Protocolos liberados</h2>
                    <p className={`text-[10px] font-bold uppercase tracking-widest ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>Aprovados pela Verto, separados das solicitações</p>
                  </div>
                  <div className="ml-auto bg-emerald-500/15 px-3 py-1 rounded-full text-[10px] font-bold text-emerald-300 uppercase">{approvedImportedProtocols.length}</div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {approvedImportedProtocols.map((p: any) => <ProtocolCard key={p.id} proto={p} />)}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center gap-3 mb-6 ml-2">
                <div className="w-10 h-10 rounded-2xl bg-blue-500 text-white flex items-center justify-center shadow-lg shadow-blue-200"><SearchCode size={20}/></div>
                <div>
                  <h2 className={`text-lg font-bold tracking-tight ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>Protocolos de Avaliação</h2>
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>Ferramentas de diagnóstico e marcos</p>
                </div>
                <div className={`ml-auto px-3 py-1 rounded-full text-[10px] font-bold uppercase ${isDarkTheme ? 'bg-white/10 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>{evaluationProtocols.length}</div>
              </div>
              {evaluationProtocols.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {evaluationProtocols.map((p: any) => <ProtocolCard key={p.id} proto={p} />)}
                </div>
              ) : (
                <div className={`py-10 text-center border-2 border-dashed rounded-[32px] font-bold text-sm italic ${isDarkTheme ? 'border-white/10 text-slate-500' : 'border-slate-300 text-slate-500 bg-white/60'}`}>Nenhum protocolo de avaliação nesta busca.</div>
              )}
            </div>

            <div>
              <div className="flex items-center gap-3 mb-6 ml-2">
                <div className="w-10 h-10 rounded-2xl bg-[#05CD99] text-white flex items-center justify-center shadow-lg shadow-green-100"><Boxes size={20}/></div>
                <div>
                  <h2 className={`text-lg font-bold tracking-tight ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>Protocolos de Intervenção</h2>
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>Treinos de habilidades e programas</p>
                </div>
                <div className={`ml-auto px-3 py-1 rounded-full text-[10px] font-bold uppercase ${isDarkTheme ? 'bg-white/10 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>{interventionProtocols.length}</div>
              </div>
              {interventionProtocols.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {interventionProtocols.map((p: any) => <ProtocolCard key={p.id} proto={p} />)}
                </div>
              ) : (
                <div className={`py-10 text-center border-2 border-dashed rounded-[32px] font-bold text-sm italic ${isDarkTheme ? 'border-white/10 text-slate-500' : 'border-slate-300 text-slate-500 bg-white/60'}`}>Crie programas de treino clicando em "Criar Novo".</div>
              )}
            </div>
          </div>
        </div>
      </div> 
      
      {canManageLibrary && (
        <div className="fixed bottom-8 right-8 z-[60] flex flex-col items-end gap-3">
          {isImporting && (
            <div className={`${isDarkTheme ? 'bg-[#101a2d] border-white/10' : 'bg-white border-slate-200'} p-4 rounded-2xl shadow-2xl border mb-2 animate-slide-up w-64`}>
              <div className="flex items-center gap-3 mb-2">
                <Loader2 size={18} className="text-[#7a32fc] animate-spin" />
                <span className={`text-xs font-bold uppercase tracking-tight ${isDarkTheme ? 'text-slate-100' : 'text-slate-800'}`}>Enviando Protocolo...</span>
              </div>
              <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-[#7a32fc] h-full transition-all duration-300" 
                  style={{ width: `${importProgress}%` }}
                ></div>
              </div>
              <p className={`text-[9px] font-bold mt-2 uppercase tracking-widest ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>Solicitando validação e match Verto...</p>
            </div>
          )}
          
          <button type="button" onClick={openImportModal} className={`flex items-center gap-3 text-[#7a32fc] px-6 py-4 rounded-full shadow-2xl border hover:scale-105 active:scale-95 transition-all group ${isDarkTheme ? 'bg-[#101a2d] border-white/10' : 'bg-white border-slate-200'} ${isImporting ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="p-2 bg-blue-50 rounded-xl group-hover:bg-[#7a32fc] group-hover:text-white transition-colors">
              <FileUp size={20} />
            </div>
            <div className="flex flex-col text-left">
              <span className="text-xs font-bold uppercase tracking-tight">Importar Protocolo Inteligente</span>
              <span className={`text-[9px] font-bold uppercase tracking-widest ${isDarkTheme ? 'text-gray-400' : 'text-slate-500'}`}>1 print seguro</span>
            </div>
          </button>
        </div>
      )}

    </div> 
  ); 
};

