import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  Clock3,
  Copy,
  FileText,
  History,
  Library,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import { dataService } from '../services/dataService';
import {
  THERAPEUTIC_MEASUREMENT_OPTIONS,
  THERAPEUTIC_PROGRAM_STATUS_LABELS,
  buildTherapeuticPlanSummary,
  formatTherapeuticPlanDate,
  masteryCriterionLabel,
  normalizeTherapeuticPrograms,
  normalizeTherapeuticProgramStatus,
} from '../utils/therapeuticPlan';

type CreationStep = null | 'source' | 'templates' | 'protocol' | 'recommendation' | 'form' | 'review';
type CreationSource = 'manual' | 'template' | 'protocol' | 'recommendation';

const CATEGORY_OPTIONS = [
  ['COMUNICACAO', 'Comunicação'],
  ['SOCIAL', 'Social'],
  ['AUTONOMIA', 'Autonomia'],
  ['BRINCADEIRA', 'Brincadeira'],
  ['ACADEMICO', 'Acadêmico'],
  ['REGULACAO', 'Regulação'],
  ['SEGURANCA', 'Segurança'],
  ['MOTRICIDADE', 'Motricidade'],
  ['CUIDADOS_PESSOAIS', 'Cuidados pessoais'],
  ['OUTRO', 'Outro'],
] as const;

const CATEGORY_LABELS = Object.fromEntries(CATEGORY_OPTIONS);

const MASTERY_OPTIONS = [
  { value: 'accuracy_80_3', label: '80% em 3 sessões' },
  { value: 'accuracy_90_2', label: '90% em 2 sessões' },
  { value: 'independent_5', label: '5 respostas independentes' },
  { value: 'all_steps', label: 'Todos os passos sem ajuda' },
  { value: 'custom', label: 'Critério personalizado' },
] as const;

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Criação manual',
  template: 'Modelo',
  protocol: 'Protocolo',
  recommendation: 'Recomendação clínica',
  legacy: 'Estrutura legada',
};

const initialForm = () => ({
  name: '',
  objective: '',
  category: 'COMUNICACAO',
  targets: [] as string[],
  measurementType: 'independent_prompted_no_response',
  masteryPreset: 'accuracy_80_3',
  customAccuracy: '80',
  customSessions: '3',
  reviewDueDate: '',
  advancedSettings: {
    antecedent: '',
    expectedResponse: '',
    materials: '',
    promptHierarchy: '',
    reinforcement: '',
    errorCorrection: '',
    environments: '',
    generalization: '',
    maintenance: '',
    frequency: '',
    responsibleNotes: '',
    notes: '',
  },
});

const newIdempotencyKey = (prefix: string) => {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${suffix}`;
};

const unwrapList = (response: any, key?: string) => {
  const data = response?.data ?? response;
  if (key && Array.isArray(data?.[key])) return data[key];
  if (Array.isArray(data)) return data;
  return [];
};

const normalizeCategory = (value: any) => String(value || 'OUTRO').trim().toUpperCase();

const resolveMasteryPreset = (criteria: any) => {
  const accuracy = Number(criteria?.minAccuracyPercent ?? criteria?.min_accuracy_percent);
  const sessions = Number(criteria?.requiredSessions ?? criteria?.required_sessions);
  const independent = Number(criteria?.requiredIndependentCorrectTrials ?? criteria?.required_independent_correct_trials);
  if (accuracy === 80 && sessions === 3) return 'accuracy_80_3';
  if (accuracy === 90 && sessions === 2) return 'accuracy_90_2';
  if (independent === 5) return 'independent_5';
  if (String(criteria?.type || '').toLowerCase() === 'steps_independent') return 'all_steps';
  return 'custom';
};

const buildMasteryCriteria = (form: ReturnType<typeof initialForm>) => {
  if (form.masteryPreset === 'accuracy_80_3') return { type: 'accuracy_sessions', minAccuracyPercent: 80, requiredSessions: 3 };
  if (form.masteryPreset === 'accuracy_90_2') return { type: 'accuracy_sessions', minAccuracyPercent: 90, requiredSessions: 2 };
  if (form.masteryPreset === 'independent_5') return { type: 'independent_trials', requiredIndependentCorrectTrials: 5 };
  if (form.masteryPreset === 'all_steps') return { type: 'steps_independent', minAccuracyPercent: 100, requiredSessions: 1 };
  return {
    type: 'accuracy_sessions',
    minAccuracyPercent: Math.max(1, Math.min(100, Number(form.customAccuracy) || 80)),
    requiredSessions: Math.max(1, Math.min(30, Number(form.customSessions) || 3)),
  };
};

const sourceCardClass = (dark: boolean) => `group flex min-h-[150px] flex-col items-start rounded-2xl border p-5 text-left transition-all ${
  dark
    ? 'border-slate-700 bg-slate-900/55 text-slate-100 hover:border-violet-400/60 hover:bg-slate-900'
    : 'border-slate-200 bg-white text-slate-800 hover:border-violet-300 hover:shadow-sm'
}`;

export const TherapeuticPlanPanel = ({ patient, protocols = [], userRole, isDark = false, onStartSession }: any) => {
  const patientId = String(patient?.id || '').trim();
  const patientName = String(patient?.name || patient?.nome || 'Paciente').trim() || 'Paciente';
  const normalizedRole = String(userRole || '').trim().toLowerCase();
  const canManageStructure = ['owner', 'admin', 'coordinator'].includes(normalizedRole);
  const canCreate = !['patient', 'paciente', 'guardian', 'responsavel', 'responsável'].includes(normalizedRole);
  const [planData, setPlanData] = useState<any>({ programs: [], objectives: [], targets: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [creationStep, setCreationStep] = useState<CreationStep>(null);
  const [creationSource, setCreationSource] = useState<CreationSource>('manual');
  const [originContext, setOriginContext] = useState<any>({});
  const [form, setForm] = useState(initialForm);
  const [targetInput, setTargetInput] = useState('');
  const [lockedTargetNames, setLockedTargetNames] = useState<string[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [operationKey, setOperationKey] = useState('');
  const [editingProgramId, setEditingProgramId] = useState('');
  const [templates, setTemplates] = useState<any[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateScope, setTemplateScope] = useState('all');
  const [templateCategory, setTemplateCategory] = useState('all');
  const [templateQuery, setTemplateQuery] = useState('');
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [selectedProtocolId, setSelectedProtocolId] = useState('');
  const [selectedDomainId, setSelectedDomainId] = useState('');
  const [selectedSkillId, setSelectedSkillId] = useState('');
  const [openMenuId, setOpenMenuId] = useState('');
  const [actionProgramId, setActionProgramId] = useState('');
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [detailTab, setDetailTab] = useState('overview');
  const [newTargetName, setNewTargetName] = useState('');
  const requestSequence = useRef(0);

  const programs = useMemo(() => normalizeTherapeuticPrograms(planData), [planData]);
  const objectives = Array.isArray(planData?.objectives) ? planData.objectives : [];
  const summary = useMemo(() => buildTherapeuticPlanSummary(programs, objectives), [objectives, programs]);
  const selectedProgram = useMemo(
    () => programs.find((program: any) => String(program.id) === selectedProgramId) || null,
    [programs, selectedProgramId],
  );

  const panel = isDark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-200 bg-white';
  const subpanel = isDark ? 'border-slate-700 bg-slate-900/45' : 'border-slate-100 bg-slate-50/75';
  const text = isDark ? 'text-slate-100' : 'text-slate-900';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const field = `w-full rounded-xl border px-3.5 py-3 text-sm outline-none transition-colors focus:border-violet-500 ${
    isDark ? 'border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-600' : 'border-slate-200 bg-white text-slate-800 placeholder:text-slate-400'
  }`;
  const secondaryButton = `inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
    isDark ? 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
  }`;

  const loadPlan = async (force = false) => {
    if (!patientId) return;
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError('');
    const response = await dataService.getPatientTherapeuticPlan(patientId, { force });
    if (sequence !== requestSequence.current) return;
    if (response?.success === false) {
      setError(response?.message || response?.error || 'Não foi possível carregar o Plano terapêutico.');
      setLoading(false);
      return;
    }
    const data = response?.data || {};
    setPlanData({
      programs: Array.isArray(data?.programs) ? data.programs : [],
      objectives: Array.isArray(data?.objectives) ? data.objectives : [],
      targets: Array.isArray(data?.targets) ? data.targets : [],
    });
    setLoading(false);
  };

  useEffect(() => {
    requestSequence.current += 1;
    setPlanData({ programs: [], objectives: [], targets: [] });
    setSelectedProgramId('');
    void loadPlan(false);
    return () => {
      requestSequence.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const resetCreation = () => {
    setCreationStep(null);
    setCreationSource('manual');
    setOriginContext({});
    setForm(initialForm());
    setTargetInput('');
    setLockedTargetNames([]);
    setAdvancedOpen(false);
    setFormError('');
    setEditingProgramId('');
    setOperationKey('');
    setSelectedProtocolId('');
    setSelectedDomainId('');
    setSelectedSkillId('');
  };

  const startCreation = () => {
    resetCreation();
    setOperationKey(newIdempotencyKey(`therapeutic-program:${patientId}`));
    setCreationStep('source');
  };

  const loadTemplates = async () => {
    if (templates.length > 0) return;
    setTemplatesLoading(true);
    const response = await dataService.getTherapeuticProgramTemplates();
    if (response?.success === false) setFormError(response?.message || response?.error || 'Não foi possível carregar os modelos.');
    else setTemplates(unwrapList(response));
    setTemplatesLoading(false);
  };

  const loadRecommendations = async () => {
    setRecommendationsLoading(true);
    const response = await dataService.getNextSessionRecommendations(patientId, { limit: 100 });
    if (response?.success === false) setFormError(response?.message || response?.error || 'Não foi possível carregar as recomendações.');
    else {
      const rows = unwrapList(response, 'recommendations');
      setRecommendations(rows.filter((item: any) => !['REJECTED', 'DISMISSED'].includes(String(item?.status || '').toUpperCase())));
    }
    setRecommendationsLoading(false);
  };

  const chooseSource = (source: CreationSource) => {
    setCreationSource(source);
    setFormError('');
    if (source === 'template') {
      setCreationStep('templates');
      void loadTemplates();
    } else if (source === 'protocol') {
      setCreationStep('protocol');
    } else if (source === 'recommendation') {
      setCreationStep('recommendation');
      void loadRecommendations();
    } else {
      setCreationStep('form');
    }
  };

  const applyTemplate = (template: any) => {
    const mastery = template?.mastery_criteria || template?.masteryCriteria || {};
    setOriginContext({ id: template.id, label: template.name });
    setForm({
      ...initialForm(),
      name: String(template?.name || ''),
      objective: String(template?.objective || template?.description || ''),
      category: normalizeCategory(template?.category),
      targets: (Array.isArray(template?.suggested_targets) ? template.suggested_targets : []).map(String).filter(Boolean),
      measurementType: String(template?.measurement_type || 'independent_prompted_no_response'),
      masteryPreset: resolveMasteryPreset(mastery),
      customAccuracy: String(mastery?.minAccuracyPercent ?? mastery?.min_accuracy_percent ?? 80),
      customSessions: String(mastery?.requiredSessions ?? mastery?.required_sessions ?? 3),
      advancedSettings: { ...initialForm().advancedSettings, ...(template?.advanced_settings || {}) },
    });
    setCreationStep('form');
  };

  const selectedProtocol = useMemo(
    () => (Array.isArray(protocols) ? protocols : []).find((protocol: any) => String(protocol?.id) === selectedProtocolId),
    [protocols, selectedProtocolId],
  );
  const selectedDomain = useMemo(
    () => (Array.isArray(selectedProtocol?.data) ? selectedProtocol.data : []).find((domain: any) => String(domain?.id) === selectedDomainId),
    [selectedDomainId, selectedProtocol],
  );
  const selectedSkill = useMemo(
    () => (Array.isArray(selectedDomain?.skills) ? selectedDomain.skills : []).find((skill: any) => String(skill?.id) === selectedSkillId),
    [selectedDomain, selectedSkillId],
  );

  const applyProtocolSkill = () => {
    if (!selectedProtocol || !selectedDomain || !selectedSkill) {
      setFormError('Escolha protocolo, domínio e habilidade.');
      return;
    }
    setOriginContext({
      id: String(selectedSkill.id),
      protocolId: String(selectedProtocol.id),
      protocolTitle: selectedProtocol.title,
      domainId: String(selectedDomain.id),
      domainName: selectedDomain.name,
    });
    setForm({
      ...initialForm(),
      name: String(selectedSkill?.name || 'Novo programa'),
      objective: String(selectedSkill?.objective || selectedSkill?.criteria || selectedSkill?.name || ''),
      category: normalizeCategory(selectedDomain?.name),
      targets: (Array.isArray(selectedSkill?.targets) && selectedSkill.targets.length > 0
        ? selectedSkill.targets.map((target: any) => String(target?.name || target))
        : [String(selectedSkill?.name || '')]).filter(Boolean),
    });
    setCreationStep('form');
  };

  const applyRecommendation = (recommendation: any) => {
    const name = String(recommendation?.title || recommendation?.suggested_action || recommendation?.suggestedAction || 'Novo programa');
    const objective = String(recommendation?.summary || recommendation?.rationale || recommendation?.clinical_note || recommendation?.clinicalNote || name);
    setOriginContext({ id: recommendation?.id, label: name });
    setForm({ ...initialForm(), name, objective, targets: [name] });
    setCreationStep('form');
  };

  const addTarget = (raw = targetInput) => {
    const target = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!target) return;
    if (form.targets.some((item) => item.toLocaleLowerCase('pt-BR') === target.toLocaleLowerCase('pt-BR'))) {
      setTargetInput('');
      return;
    }
    setForm((current) => ({ ...current, targets: [...current.targets, target].slice(0, 50) }));
    setTargetInput('');
  };

  const validateForm = () => {
    if (!form.name.trim()) return 'Informe o nome do programa.';
    if (!form.objective.trim()) return 'Informe o objetivo terapêutico.';
    if (!editingProgramId && form.targets.length === 0) return 'Adicione pelo menos um alvo inicial.';
    if (!form.measurementType) return 'Escolha como as respostas serão registradas.';
    return '';
  };

  const continueToReview = () => {
    const validation = validateForm();
    if (validation) {
      setFormError(validation);
      return;
    }
    setFormError('');
    setCreationStep('review');
  };

  const submitProgram = async (status: 'draft' | 'teaching') => {
    const validation = validateForm();
    if (validation) {
      setFormError(validation);
      return;
    }
    if (saving) return;
    setSaving(true);
    setFormError('');
    const payload = {
      name: form.name.trim(),
      objective: form.objective.trim(),
      category: form.category,
      targets: form.targets,
      measurementType: form.measurementType,
      masteryCriteria: buildMasteryCriteria(form),
      advancedSettings: form.advancedSettings,
      reviewDueDate: form.reviewDueDate || null,
      originType: creationSource,
      originId: originContext?.id || null,
      protocolId: originContext?.protocolId || null,
      protocolTitle: originContext?.protocolTitle || null,
      domainId: originContext?.domainId || null,
      domainName: originContext?.domainName || null,
      status,
      idempotencyKey: operationKey || newIdempotencyKey(`therapeutic-program:${patientId}`),
    };
    const response = editingProgramId
      ? await dataService.updateTherapeuticProgram(patientId, editingProgramId, {
          ...payload,
          expectedVersion: Number(programs.find((program: any) => String(program.id) === editingProgramId)?.version || 1),
          reason: 'Programa atualizado pelo Plano terapêutico',
        })
      : await dataService.createTherapeuticProgram(patientId, payload);
    if (response?.success === false) {
      setFormError(response?.message || response?.error || 'Não foi possível salvar o programa.');
      setSaving(false);
      return;
    }
    setNotice(response?.message || (editingProgramId ? 'Programa atualizado e versionado.' : 'Programa salvo no Plano terapêutico.'));
    resetCreation();
    await loadPlan(true);
    setSaving(false);
  };

  const editProgram = (program: any) => {
    const criteria = program?.mastery_criteria || program?.masteryCriteria || {};
    const existingTargets = (Array.isArray(program?.targets) ? program.targets : [])
      .map((target: any) => String(target?.name || '').trim())
      .filter(Boolean);
    setCreationSource((['template', 'protocol', 'recommendation'].includes(String(program?.origin_type)) ? program.origin_type : 'manual') as CreationSource);
    setOriginContext({
      id: program?.origin_id,
      protocolId: program?.protocol_id,
      protocolTitle: program?.protocol_title,
      domainId: program?.domain_id,
      domainName: program?.domain_name,
    });
    setForm({
      ...initialForm(),
      name: String(program?.name || ''),
      objective: String(program?.objective || program?.description || ''),
      category: normalizeCategory(program?.category),
      targets: existingTargets,
      measurementType: String(program?.measurement_type || program?.measurementType || 'independent_prompted_no_response'),
      masteryPreset: resolveMasteryPreset(criteria),
      customAccuracy: String(criteria?.minAccuracyPercent ?? criteria?.min_accuracy_percent ?? 80),
      customSessions: String(criteria?.requiredSessions ?? criteria?.required_sessions ?? 3),
      reviewDueDate: String(program?.review_due_date || '').slice(0, 10),
      advancedSettings: { ...initialForm().advancedSettings, ...(program?.advanced_settings || {}) },
    });
    setLockedTargetNames(existingTargets);
    setEditingProgramId(String(program.id));
    setOperationKey(newIdempotencyKey(`therapeutic-program-update:${program.id}`));
    setCreationStep('form');
    setSelectedProgramId('');
    setFormError('');
  };

  const updateStatus = async (program: any, status: string) => {
    if (actionProgramId) return;
    setActionProgramId(String(program.id));
    setOpenMenuId('');
    const response = await dataService.updateTherapeuticProgramStatus(patientId, String(program.id), {
      status,
      expectedVersion: Number(program?.version || 1),
      reason: `Fase alterada para ${THERAPEUTIC_PROGRAM_STATUS_LABELS[status as keyof typeof THERAPEUTIC_PROGRAM_STATUS_LABELS] || status}`,
      idempotencyKey: newIdempotencyKey(`therapeutic-program-status:${program.id}:${status}`),
    });
    if (response?.success === false) setNotice(response?.message || response?.error || 'Não foi possível alterar a fase do programa.');
    else {
      setNotice(response?.message || 'Fase do programa atualizada.');
      await loadPlan(true);
    }
    setActionProgramId('');
  };

  const saveAsTemplate = async (program: any) => {
    if (actionProgramId) return;
    setActionProgramId(String(program.id));
    const response = await dataService.saveTherapeuticProgramTemplate({
      programId: program.id,
      idempotencyKey: newIdempotencyKey(`program-template:${program.id}`),
    });
    setNotice(response?.success === false
      ? response?.message || response?.error || 'Não foi possível salvar o modelo.'
      : response?.message || 'Modelo salvo sem dados do paciente.');
    if (response?.success !== false) setTemplates([]);
    setActionProgramId('');
    setOpenMenuId('');
  };

  const addTargetToProgram = async () => {
    const name = newTargetName.trim();
    if (!selectedProgram || !name || actionProgramId) return;
    setActionProgramId(String(selectedProgram.id));
    const response = await dataService.addTherapeuticProgramTarget(patientId, String(selectedProgram.id), {
      name,
      idempotencyKey: newIdempotencyKey(`therapeutic-target:${selectedProgram.id}`),
    });
    if (response?.success === false) setNotice(response?.message || response?.error || 'Não foi possível adicionar o alvo.');
    else {
      setNewTargetName('');
      setNotice('Alvo adicionado ao programa.');
      await loadPlan(true);
    }
    setActionProgramId('');
  };

  const visiblePrograms = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR');
    return programs.filter((program: any) => {
      const status = normalizeTherapeuticProgramStatus(program?.status);
      const filterMatch = filter === 'all' || status === filter;
      const textValue = `${program?.name || ''} ${program?.objective || ''} ${program?.category || ''} ${(program?.targets || []).map((target: any) => target?.name || '').join(' ')}`.toLocaleLowerCase('pt-BR');
      return filterMatch && (!needle || textValue.includes(needle));
    });
  }, [filter, programs, query]);

  const visibleTemplates = useMemo(() => {
    const needle = templateQuery.trim().toLocaleLowerCase('pt-BR');
    return templates.filter((template: any) => {
      const scope = String(template?.source_scope || '').toUpperCase();
      const scopeMatch = templateScope === 'all'
        || (templateScope === 'verto' && scope === 'VERTO')
        || (templateScope === 'clinic' && scope === 'CLINIC')
        || (templateScope === 'mine' && scope === 'PERSONAL');
      const categoryMatch = templateCategory === 'all' || normalizeCategory(template?.category) === templateCategory;
      const textValue = `${template?.name || ''} ${template?.description || ''} ${template?.objective || ''}`.toLocaleLowerCase('pt-BR');
      return scopeMatch && categoryMatch && (!needle || textValue.includes(needle));
    });
  }, [templateCategory, templateQuery, templateScope, templates]);

  const statusClass = (statusValue: any) => {
    const status = normalizeTherapeuticProgramStatus(statusValue);
    if (status === 'teaching') return isDark ? 'bg-violet-500/15 text-violet-200 border-violet-400/30' : 'bg-violet-50 text-violet-700 border-violet-200';
    if (status === 'maintenance') return isDark ? 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30' : 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (status === 'completed') return isDark ? 'bg-sky-500/15 text-sky-200 border-sky-400/30' : 'bg-sky-50 text-sky-700 border-sky-200';
    if (status === 'paused') return isDark ? 'bg-amber-500/15 text-amber-200 border-amber-400/30' : 'bg-amber-50 text-amber-700 border-amber-200';
    return isDark ? 'bg-slate-700 text-slate-300 border-slate-600' : 'bg-slate-100 text-slate-600 border-slate-200';
  };

  const renderCreationBody = () => {
    if (creationStep === 'source') {
      return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button type="button" className={sourceCardClass(isDark)} onClick={() => chooseSource('template')}>
            <Library size={22} className="mb-5 text-violet-500" />
            <span className="text-base font-medium">Usar modelo pronto</span>
            <span className={`mt-2 text-sm leading-relaxed ${muted}`}>Escolha uma estrutura da biblioteca e adapte apenas o necessário.</span>
          </button>
          <button type="button" className={sourceCardClass(isDark)} onClick={() => chooseSource('manual')}>
            <Pencil size={22} className="mb-5 text-sky-500" />
            <span className="text-base font-medium">Criar manualmente</span>
            <span className={`mt-2 text-sm leading-relaxed ${muted}`}>Descreva o que deseja ensinar e monte os primeiros alvos.</span>
          </button>
          <button type="button" className={sourceCardClass(isDark)} onClick={() => chooseSource('protocol')}>
            <BookOpen size={22} className="mb-5 text-emerald-500" />
            <span className="text-base font-medium">Criar a partir de protocolo</span>
            <span className={`mt-2 text-sm leading-relaxed ${muted}`}>Transforme uma habilidade avaliada em programa individualizado.</span>
          </button>
          <button type="button" className={sourceCardClass(isDark)} onClick={() => chooseSource('recommendation')}>
            <Sparkles size={22} className="mb-5 text-amber-500" />
            <span className="text-base font-medium">Criar a partir de recomendação</span>
            <span className={`mt-2 text-sm leading-relaxed ${muted}`}>Use uma recomendação clínica registrada e revise antes de ativar.</span>
          </button>
        </div>
      );
    }

    if (creationStep === 'templates') {
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto]">
            <label className="relative">
              <Search size={16} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${muted}`} />
              <input className={`${field} pl-10`} value={templateQuery} onChange={(event) => setTemplateQuery(event.target.value)} placeholder="Buscar por nome, habilidade ou categoria" />
            </label>
            <select className={field} value={templateScope} onChange={(event) => setTemplateScope(event.target.value)}>
              <option value="all">Todas as fontes</option><option value="verto">Modelos Verto</option><option value="clinic">Biblioteca da clínica</option><option value="mine">Meus modelos</option>
            </select>
            <select className={field} value={templateCategory} onChange={(event) => setTemplateCategory(event.target.value)}>
              <option value="all">Todas as categorias</option>
              {CATEGORY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          {templatesLoading ? <div className={`flex items-center justify-center gap-2 py-12 text-sm ${muted}`}><Loader2 size={18} className="animate-spin" /> Carregando biblioteca...</div> : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {visibleTemplates.map((template: any) => (
                <article key={template.id} className={`rounded-2xl border p-4 ${subpanel}`}>
                  <div className="flex items-start justify-between gap-3"><div><p className={`font-medium ${text}`}>{template.name}</p><p className={`mt-1 text-xs ${muted}`}>{CATEGORY_LABELS[normalizeCategory(template.category)] || template.category}</p></div><span className={`rounded-full border px-2.5 py-1 text-[10px] ${isDark ? 'border-slate-600 text-slate-300' : 'border-slate-200 text-slate-500'}`}>{String(template.source_scope || 'CLINIC') === 'VERTO' ? 'Verto' : String(template.source_scope || '') === 'PERSONAL' ? 'Meu modelo' : 'Clínica'}</span></div>
                  <p className={`mt-3 line-clamp-3 text-sm leading-relaxed ${muted}`}>{template.objective || template.description}</p>
                  <p className={`mt-3 text-xs ${muted}`}>{Array.isArray(template.suggested_targets) ? template.suggested_targets.length : 0} alvos sugeridos · {masteryCriterionLabel(template.mastery_criteria)}</p>
                  <button type="button" className="mt-4 inline-flex min-h-[38px] items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-700" onClick={() => applyTemplate(template)}>Usar este modelo <ChevronLeft size={15} className="rotate-180" /></button>
                </article>
              ))}
              {!visibleTemplates.length && <p className={`col-span-full rounded-2xl border border-dashed p-8 text-center text-sm ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Nenhum modelo encontrado com estes filtros.</p>}
            </div>
          )}
        </div>
      );
    }

    if (creationStep === 'protocol') {
      return (
        <div className="space-y-4">
          <p className={`text-sm leading-relaxed ${muted}`}>O protocolo fica registrado como origem. Depois da criação, o programa passa a ser individual e não será sobrescrito por alterações futuras no protocolo.</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className={`text-xs ${muted}`}>Protocolo<select className={`${field} mt-1.5`} value={selectedProtocolId} onChange={(event) => { setSelectedProtocolId(event.target.value); setSelectedDomainId(''); setSelectedSkillId(''); }}><option value="">Selecione...</option>{(Array.isArray(protocols) ? protocols : []).map((protocol: any) => <option key={protocol.id} value={protocol.id}>{protocol.title}</option>)}</select></label>
            <label className={`text-xs ${muted}`}>Domínio<select className={`${field} mt-1.5`} value={selectedDomainId} disabled={!selectedProtocolId} onChange={(event) => { setSelectedDomainId(event.target.value); setSelectedSkillId(''); }}><option value="">Selecione...</option>{(selectedProtocol?.data || []).map((domain: any) => <option key={domain.id} value={domain.id}>{domain.name}</option>)}</select></label>
            <label className={`text-xs ${muted}`}>Habilidade<select className={`${field} mt-1.5`} value={selectedSkillId} disabled={!selectedDomainId} onChange={(event) => setSelectedSkillId(event.target.value)}><option value="">Selecione...</option>{(selectedDomain?.skills || []).map((skill: any) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>
          </div>
          {selectedSkill && <div className={`rounded-2xl border p-4 ${subpanel}`}><p className={`font-medium ${text}`}>{selectedSkill.name}</p><p className={`mt-2 text-sm leading-relaxed ${muted}`}>{selectedSkill.objective || selectedSkill.criteria || 'Sem descrição adicional.'}</p></div>}
          <button type="button" className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm text-white disabled:opacity-50" disabled={!selectedSkill} onClick={applyProtocolSkill}>Adaptar esta habilidade</button>
        </div>
      );
    }

    if (creationStep === 'recommendation') {
      return (
        <div className="space-y-3">
          {recommendationsLoading && <div className={`flex items-center justify-center gap-2 py-12 text-sm ${muted}`}><Loader2 size={18} className="animate-spin" /> Carregando recomendações...</div>}
          {!recommendationsLoading && recommendations.map((recommendation: any) => (
            <article key={recommendation.id} className={`rounded-2xl border p-4 ${subpanel}`}>
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className={`font-medium ${text}`}>{recommendation.title || recommendation.suggested_action || 'Recomendação clínica'}</p><p className={`mt-1 text-sm leading-relaxed ${muted}`}>{recommendation.summary || recommendation.rationale || recommendation.clinical_note || 'Sem justificativa adicional.'}</p><p className={`mt-2 text-xs ${muted}`}>Origem: {formatTherapeuticPlanDate(recommendation.created_at || recommendation.createdAt)}</p></div><button type="button" className="shrink-0 rounded-xl bg-violet-600 px-4 py-2.5 text-sm text-white" onClick={() => applyRecommendation(recommendation)}>Criar programa</button></div>
            </article>
          ))}
          {!recommendationsLoading && !recommendations.length && <p className={`rounded-2xl border border-dashed p-8 text-center text-sm ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Não há recomendações disponíveis para transformar em programa.</p>}
        </div>
      );
    }

    if (creationStep === 'form') {
      return (
        <div className="space-y-5">
          {creationSource === 'manual' && !editingProgramId && (
            <div className={`rounded-2xl border p-4 ${subpanel}`}><p className={`text-xs ${muted}`}>Sugestões rápidas</p><div className="mt-2 flex flex-wrap gap-2">{['Solicitar ajuda', 'Esperar', 'Seguir instruções', 'Pedir pausa', 'Responder ao nome', 'Aceitar interrupção'].map((suggestion) => <button key={suggestion} type="button" className={`rounded-full border px-3 py-1.5 text-xs ${isDark ? 'border-slate-600 text-slate-300 hover:border-violet-400' : 'border-slate-200 text-slate-600 hover:border-violet-300'}`} onClick={() => setForm((current) => ({ ...current, name: suggestion, objective: current.objective || `Desenvolver ${suggestion.toLocaleLowerCase('pt-BR')} de forma funcional.`, targets: current.targets.length ? current.targets : [suggestion] }))}>{suggestion}</button>)}</div></div>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className={`text-xs ${muted}`}>Nome do programa<input className={`${field} mt-1.5`} value={form.name} maxLength={240} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: Solicitar ajuda" /></label>
            <label className={`text-xs ${muted}`}>Categoria<select className={`${field} mt-1.5`} value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>{CATEGORY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
          <label className={`block text-xs ${muted}`}>Objetivo terapêutico<textarea className={`${field} mt-1.5 min-h-[92px] resize-y`} value={form.objective} maxLength={1000} onChange={(event) => setForm((current) => ({ ...current, objective: event.target.value }))} placeholder="O que se pretende desenvolver?" /></label>
          <div>
            <label className={`text-xs ${muted}`}>{editingProgramId ? 'Alvos do programa' : 'Alvos iniciais'}</label>
            <div className={`mt-1.5 rounded-2xl border p-3 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}>
              <div className="flex flex-wrap gap-2">
                {form.targets.map((target) => {
                  const isPersistedTarget = lockedTargetNames.includes(target);
                  return (
                    <span key={target} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${isDark ? 'bg-violet-500/15 text-violet-100' : 'bg-violet-50 text-violet-700'}`}>
                      {target}
                      {!isPersistedTarget && (
                        <button type="button" aria-label={`Remover ${target}`} onClick={() => setForm((current) => ({ ...current, targets: current.targets.filter((item) => item !== target) }))}>
                          <X size={13} />
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-2">
                <input className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm outline-none" value={targetInput} onChange={(event) => setTargetInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addTarget(); } }} placeholder="Digite um alvo e pressione Enter" />
                <button type="button" className="rounded-xl bg-violet-600 px-3 text-white" onClick={() => addTarget()} aria-label="Adicionar alvo"><Plus size={16} /></button>
              </div>
            </div>
            {editingProgramId && <p className={`mt-2 text-xs ${muted}`}>Alvos já usados em sessões permanecem protegidos. Os novos serão incluídos ao salvar, sem apagar progresso.</p>}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><label className={`text-xs ${muted}`}>Como registrar<select className={`${field} mt-1.5`} value={form.measurementType} onChange={(event) => setForm((current) => ({ ...current, measurementType: event.target.value }))}>{THERAPEUTIC_MEASUREMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className={`text-xs ${muted}`}>Critério de domínio<select className={`${field} mt-1.5`} value={form.masteryPreset} onChange={(event) => setForm((current) => ({ ...current, masteryPreset: event.target.value }))}>{MASTERY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div>
          {form.masteryPreset === 'custom' && <div className="grid grid-cols-2 gap-3"><label className={`text-xs ${muted}`}>Percentual<input type="number" min="1" max="100" className={`${field} mt-1.5`} value={form.customAccuracy} onChange={(event) => setForm((current) => ({ ...current, customAccuracy: event.target.value }))} /></label><label className={`text-xs ${muted}`}>Sessões consecutivas<input type="number" min="1" max="30" className={`${field} mt-1.5`} value={form.customSessions} onChange={(event) => setForm((current) => ({ ...current, customSessions: event.target.value }))} /></label></div>}
          <div className={`rounded-2xl border ${subpanel}`}><button type="button" className={`flex w-full items-center justify-between p-4 text-sm ${text}`} onClick={() => setAdvancedOpen((current) => !current)}><span>Ajustes avançados <span className={muted}>(opcional)</span></span><ChevronDown size={17} className={`transition-transform ${advancedOpen ? 'rotate-180' : ''}`} /></button>{advancedOpen && <div className="grid grid-cols-1 gap-4 border-t p-4 md:grid-cols-2"><label className={`text-xs ${muted}`}>Instrução ou antecedente<textarea className={`${field} mt-1.5`} value={form.advancedSettings.antecedent} onChange={(event) => setForm((current) => ({ ...current, advancedSettings: { ...current.advancedSettings, antecedent: event.target.value } }))} /></label><label className={`text-xs ${muted}`}>Resposta esperada<textarea className={`${field} mt-1.5`} value={form.advancedSettings.expectedResponse} onChange={(event) => setForm((current) => ({ ...current, advancedSettings: { ...current.advancedSettings, expectedResponse: event.target.value } }))} /></label><label className={`text-xs ${muted}`}>Materiais<textarea className={`${field} mt-1.5`} value={form.advancedSettings.materials} onChange={(event) => setForm((current) => ({ ...current, advancedSettings: { ...current.advancedSettings, materials: event.target.value } }))} /></label><label className={`text-xs ${muted}`}>Hierarquia de ajuda<textarea className={`${field} mt-1.5`} value={form.advancedSettings.promptHierarchy} onChange={(event) => setForm((current) => ({ ...current, advancedSettings: { ...current.advancedSettings, promptHierarchy: event.target.value } }))} /></label><label className={`text-xs ${muted}`}>Reforçamento<textarea className={`${field} mt-1.5`} value={form.advancedSettings.reinforcement} onChange={(event) => setForm((current) => ({ ...current, advancedSettings: { ...current.advancedSettings, reinforcement: event.target.value } }))} /></label><label className={`text-xs ${muted}`}>Correção de erro<textarea className={`${field} mt-1.5`} value={form.advancedSettings.errorCorrection} onChange={(event) => setForm((current) => ({ ...current, advancedSettings: { ...current.advancedSettings, errorCorrection: event.target.value } }))} /></label><label className={`text-xs ${muted}`}>Generalização<textarea className={`${field} mt-1.5`} value={form.advancedSettings.generalization} onChange={(event) => setForm((current) => ({ ...current, advancedSettings: { ...current.advancedSettings, generalization: event.target.value } }))} /></label><label className={`text-xs ${muted}`}>Manutenção<textarea className={`${field} mt-1.5`} value={form.advancedSettings.maintenance} onChange={(event) => setForm((current) => ({ ...current, advancedSettings: { ...current.advancedSettings, maintenance: event.target.value } }))} /></label><label className={`text-xs ${muted}`}>Próxima revisão<input type="date" className={`${field} mt-1.5`} value={form.reviewDueDate} onChange={(event) => setForm((current) => ({ ...current, reviewDueDate: event.target.value }))} /></label><label className={`text-xs ${muted}`}>Observações<textarea className={`${field} mt-1.5`} value={form.advancedSettings.notes} onChange={(event) => setForm((current) => ({ ...current, advancedSettings: { ...current.advancedSettings, notes: event.target.value } }))} /></label></div>}</div>
          <div className="flex justify-end"><button type="button" className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm text-white hover:bg-violet-700" onClick={continueToReview}>Revisar programa <ChevronLeft size={16} className="rotate-180" /></button></div>
        </div>
      );
    }

    if (creationStep === 'review') {
      const measurement = THERAPEUTIC_MEASUREMENT_OPTIONS.find((option) => option.value === form.measurementType);
      return <div className="space-y-4"><div className={`rounded-2xl border p-5 ${subpanel}`}><p className={`text-xs ${muted}`}>{editingProgramId ? 'Revisão da atualização' : `Adaptado para ${patientName}`}</p><h4 className={`mt-1 text-xl font-medium ${text}`}>{form.name}</h4><dl className="mt-5 grid grid-cols-1 gap-4 text-sm md:grid-cols-2"><div><dt className={muted}>Categoria</dt><dd className={`mt-1 ${text}`}>{CATEGORY_LABELS[form.category] || form.category}</dd></div><div><dt className={muted}>Origem</dt><dd className={`mt-1 ${text}`}>{SOURCE_LABELS[creationSource]}{originContext?.label ? ` · ${originContext.label}` : ''}</dd></div><div className="md:col-span-2"><dt className={muted}>Objetivo</dt><dd className={`mt-1 leading-relaxed ${text}`}>{form.objective}</dd></div><div><dt className={muted}>Alvos iniciais</dt><dd className={`mt-1 ${text}`}>{form.targets.length}</dd></div><div><dt className={muted}>Registro</dt><dd className={`mt-1 ${text}`}>{measurement?.label}</dd></div><div><dt className={muted}>Domínio</dt><dd className={`mt-1 ${text}`}>{masteryCriterionLabel(buildMasteryCriteria(form))}</dd></div><div><dt className={muted}>Próxima revisão</dt><dd className={`mt-1 ${text}`}>{formatTherapeuticPlanDate(form.reviewDueDate)}</dd></div></dl></div><div className="flex flex-col-reverse justify-end gap-2 sm:flex-row"><button type="button" className={secondaryButton} disabled={saving} onClick={() => void submitProgram('draft')}>{saving ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />} {editingProgramId ? 'Salvar alterações' : 'Salvar como rascunho'}</button>{!editingProgramId && <button type="button" className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm text-white disabled:opacity-50" disabled={saving} onClick={() => void submitProgram('teaching')}>{saving ? <Loader2 size={16} className="animate-spin" /> : canManageStructure ? <Play size={16} /> : <Check size={16} />}{canManageStructure ? 'Ativar programa' : 'Enviar para aprovação'}</button>}</div></div>;
    }
    return null;
  };

  return (
    <section className="space-y-5" data-testid="therapeutic-plan-panel">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div><p className={`text-sm leading-relaxed ${muted}`}>Objetivos gerais, programas individualizados e alvos usados nas sessões.</p></div>
        <div className="flex flex-wrap gap-2">{typeof onStartSession === 'function' && programs.some((program: any) => ['teaching', 'maintenance'].includes(normalizeTherapeuticProgramStatus(program.status))) && <button type="button" className={secondaryButton} onClick={onStartSession}><Play size={16} /> Iniciar sessão</button>}{canCreate && <button type="button" className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm text-white hover:bg-violet-700" onClick={startCreation}><Plus size={17} /> Adicionar programa</button>}</div>
      </div>

      {notice && <div className={`flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${isDark ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}><span>{notice}</span><button type="button" onClick={() => setNotice('')}><X size={15} /></button></div>}
      {error && <div className={`rounded-2xl border px-4 py-3 text-sm ${isDark ? 'border-rose-400/25 bg-rose-500/10 text-rose-100' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{error}<button type="button" className="ml-2 underline" onClick={() => void loadPlan(true)}>Tentar novamente</button></div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Em ensino', summary.teaching], ['Em manutenção', summary.maintenance], ['Alvos dominados', summary.masteredTargets], ['Próxima revisão', formatTherapeuticPlanDate(summary.nextReview)]].map(([label, value]) => <div key={String(label)} className={`rounded-2xl border p-4 ${subpanel}`}><p className={`text-xs ${muted}`}>{label}</p><p className={`mt-1 text-lg font-medium ${text}`}>{value}</p></div>)}
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl p-1">{[['all', 'Todos'], ['teaching', 'Em ensino'], ['maintenance', 'Manutenção'], ['paused', 'Pausados'], ['completed', 'Concluídos']].map(([value, label]) => <button key={value} type="button" className={`shrink-0 rounded-lg px-3 py-2 text-xs transition-colors ${filter === value ? 'bg-violet-600 text-white' : isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => setFilter(value)}>{label}</button>)}</div>
        <label className="relative w-full md:max-w-xs"><Search size={15} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${muted}`} /><input className={`${field} pl-10`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar programa ou alvo" /></label>
      </div>

      {loading ? <div className={`flex items-center justify-center gap-2 rounded-2xl border border-dashed py-12 text-sm ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}><Loader2 size={18} className="animate-spin" /> Carregando Plano terapêutico...</div> : visiblePrograms.length ? <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{visiblePrograms.map((program: any) => {
        const status = normalizeTherapeuticProgramStatus(program.status);
        const targetCount = program.targets.length;
        const mastered = program.masteredTargetCount;
        const progress = targetCount ? Math.round((mastered / targetCount) * 100) : 0;
        return <article key={program.id} className={`relative rounded-2xl border p-5 ${panel}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className={`truncate text-base font-medium ${text}`}>{program.name}</h4><span className={`rounded-full border px-2.5 py-1 text-[10px] ${statusClass(status)}`}>{THERAPEUTIC_PROGRAM_STATUS_LABELS[status]}</span></div><p className={`mt-1 text-xs ${muted}`}>{CATEGORY_LABELS[normalizeCategory(program.category)] || program.category} · {SOURCE_LABELS[String(program.origin_type || 'manual')] || 'Programa individual'}</p></div><button type="button" className={`rounded-lg p-2 ${isDark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-400 hover:bg-slate-100'}`} onClick={() => setOpenMenuId((current) => current === String(program.id) ? '' : String(program.id))}><MoreHorizontal size={18} /></button></div>{openMenuId === String(program.id) && <div className={`absolute right-5 top-12 z-20 w-56 rounded-xl border p-1.5 shadow-xl ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}>{canManageStructure && !['completed', 'archived'].includes(status) && <button className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${isDark ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50'}`} onClick={() => editProgram(program)}><Pencil size={15} /> Editar</button>}{canManageStructure && status !== 'paused' && <button className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${isDark ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50'}`} onClick={() => void updateStatus(program, 'paused')}><Pause size={15} /> Pausar</button>}{canManageStructure && status !== 'maintenance' && !['completed', 'archived'].includes(status) && <button className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${isDark ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50'}`} onClick={() => void updateStatus(program, 'maintenance')}><Clock3 size={15} /> Mover para manutenção</button>}{canManageStructure && status !== 'completed' && <button className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${isDark ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50'}`} onClick={() => void updateStatus(program, 'completed')}><CheckCircle2 size={15} /> Concluir</button>}<button className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${isDark ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50'}`} onClick={() => void saveAsTemplate(program)}><Copy size={15} /> Duplicar como modelo</button></div>}<p className={`mt-4 line-clamp-2 text-sm leading-relaxed ${muted}`}>{program.objective || 'Objetivo não informado.'}</p><div className="mt-5"><div className={`mb-2 flex justify-between text-xs ${muted}`}><span>{mastered} de {targetCount} alvos dominados</span><span>{progress}%</span></div><div className={`h-2 overflow-hidden rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} /></div></div><div className={`mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 ${isDark ? 'border-slate-700' : 'border-slate-100'}`}><div className={`text-xs ${muted}`}><span>Última aplicação: {formatTherapeuticPlanDate(program.lastAppliedAt)}</span><span className="mx-2">·</span><span>{masteryCriterionLabel(program.mastery_criteria)}</span></div><button type="button" className="text-sm text-violet-500 hover:text-violet-400" onClick={() => { setSelectedProgramId(String(program.id)); setDetailTab('overview'); }}>Abrir programa</button></div>{actionProgramId === String(program.id) && <div className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-slate-950/25 backdrop-blur-[1px]"><Loader2 size={22} className="animate-spin text-white" /></div>}</article>;
      })}</div> : <div className={`rounded-2xl border border-dashed py-12 text-center ${isDark ? 'border-slate-700' : 'border-slate-200'}`}><Target size={30} className={`mx-auto ${isDark ? 'text-slate-600' : 'text-slate-300'}`} /><p className={`mt-3 text-sm ${muted}`}>{query || filter !== 'all' ? 'Nenhum programa encontrado com estes filtros.' : 'Ainda não há programas individualizados neste plano.'}</p>{canCreate && !query && filter === 'all' && <button type="button" className="mt-4 text-sm text-violet-500" onClick={startCreation}>Adicionar o primeiro programa</button>}</div>}

      {creationStep && <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4"><div className={`flex max-h-[94vh] w-full max-w-5xl flex-col rounded-t-3xl border shadow-2xl sm:rounded-3xl ${panel}`} role="dialog" aria-modal="true"><header className={`flex items-center justify-between gap-3 border-b px-5 py-4 sm:px-6 ${isDark ? 'border-slate-700' : 'border-slate-100'}`}><div className="flex min-w-0 items-center gap-3">{creationStep !== 'source' && <button type="button" className={`rounded-xl p-2 ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`} onClick={() => setCreationStep(creationStep === 'review' ? 'form' : 'source')}><ChevronLeft size={18} /></button>}<div><h3 className={`text-lg font-medium ${text}`}>{editingProgramId ? 'Editar programa' : creationStep === 'source' ? 'Como deseja criar este programa?' : creationStep === 'templates' ? 'Biblioteca de programas' : creationStep === 'protocol' ? 'Criar a partir de protocolo' : creationStep === 'recommendation' ? 'Criar a partir de recomendação' : creationStep === 'review' ? 'Revise antes de salvar' : `Adaptar programa para ${patientName}`}</h3><p className={`mt-0.5 text-xs ${muted}`}>Escolher → adaptar → ativar</p></div></div><button type="button" className={`rounded-xl p-2 ${isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-100'}`} onClick={resetCreation}><X size={19} /></button></header><div className="overflow-y-auto p-5 sm:p-6">{formError && <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${isDark ? 'border-rose-400/25 bg-rose-500/10 text-rose-100' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{formError}</div>}{renderCreationBody()}</div></div></div>}

      {selectedProgram && <div className="fixed inset-0 z-[115] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4"><div className={`flex max-h-[94vh] w-full max-w-5xl flex-col rounded-t-3xl border shadow-2xl sm:rounded-3xl ${panel}`} role="dialog" aria-modal="true"><header className={`flex items-start justify-between gap-3 border-b px-5 py-4 sm:px-6 ${isDark ? 'border-slate-700' : 'border-slate-100'}`}><div><div className="flex flex-wrap items-center gap-2"><h3 className={`text-xl font-medium ${text}`}>{selectedProgram.name}</h3><span className={`rounded-full border px-2.5 py-1 text-[10px] ${statusClass(selectedProgram.status)}`}>{THERAPEUTIC_PROGRAM_STATUS_LABELS[normalizeTherapeuticProgramStatus(selectedProgram.status)]}</span></div><p className={`mt-1 text-xs ${muted}`}>Origem: {SOURCE_LABELS[String(selectedProgram.origin_type || 'manual')] || 'Programa individual'} · Versão {selectedProgram.version || 1}</p></div><button type="button" className={`rounded-xl p-2 ${isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-100'}`} onClick={() => setSelectedProgramId('')}><X size={19} /></button></header><nav className={`flex gap-1 overflow-x-auto border-b px-5 py-2 sm:px-6 ${isDark ? 'border-slate-700' : 'border-slate-100'}`}>{[['overview', 'Visão geral'], ['targets', 'Alvos'], ['procedure', 'Procedimento'], ['progress', 'Progresso'], ['history', 'Histórico']].map(([value, label]) => <button key={value} type="button" className={`shrink-0 rounded-lg px-3 py-2 text-sm ${detailTab === value ? 'bg-violet-600 text-white' : isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => setDetailTab(value)}>{label}</button>)}</nav><div className="overflow-y-auto p-5 sm:p-6">{detailTab === 'overview' && <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><div className={`rounded-2xl border p-5 md:col-span-2 ${subpanel}`}><p className={`text-xs ${muted}`}>Objetivo</p><p className={`mt-2 leading-relaxed ${text}`}>{selectedProgram.objective || 'Não informado.'}</p></div><div className={`rounded-2xl border p-4 ${subpanel}`}><p className={`text-xs ${muted}`}>Critério de domínio</p><p className={`mt-1 text-sm ${text}`}>{masteryCriterionLabel(selectedProgram.mastery_criteria)}</p></div><div className={`rounded-2xl border p-4 ${subpanel}`}><p className={`text-xs ${muted}`}>Próxima revisão</p><p className={`mt-1 text-sm ${text}`}>{formatTherapeuticPlanDate(selectedProgram.review_due_date)}</p></div><div className={`rounded-2xl border p-4 ${subpanel}`}><p className={`text-xs ${muted}`}>Responsáveis</p><p className={`mt-1 text-sm ${text}`}>{Array.isArray(selectedProgram.responsible_professional_ids) && selectedProgram.responsible_professional_ids.length ? `${selectedProgram.responsible_professional_ids.length} profissional(is)` : 'Equipe clínica'}</p></div><div className={`rounded-2xl border p-4 ${subpanel}`}><p className={`text-xs ${muted}`}>Última aplicação</p><p className={`mt-1 text-sm ${text}`}>{formatTherapeuticPlanDate(selectedProgram.lastAppliedAt)}</p></div>{canManageStructure && !['completed', 'archived'].includes(normalizeTherapeuticProgramStatus(selectedProgram.status)) && <button type="button" className={secondaryButton} onClick={() => editProgram(selectedProgram)}><Pencil size={16} /> Editar programa</button>}</div>}{detailTab === 'targets' && <div className="space-y-3">{(selectedProgram.targets || []).map((target: any, index: number) => <div key={target.id || `${target.name}-${index}`} className={`flex items-center justify-between gap-3 rounded-2xl border p-4 ${subpanel}`}><div><p className={`font-medium ${text}`}>{target.name}</p><p className={`mt-1 text-xs ${muted}`}>{target.normalizedStatus === 'mastered' ? 'Dominado' : target.normalizedStatus === 'maintenance' ? 'Em manutenção' : target.normalizedStatus === 'paused' ? 'Pausado' : target.normalizedStatus === 'teaching' ? 'Em ensino' : 'Não iniciado'}</p></div><span className={`rounded-full px-2.5 py-1 text-xs ${target.normalizedStatus === 'mastered' ? isDark ? 'bg-emerald-500/15 text-emerald-200' : 'bg-emerald-50 text-emerald-700' : isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>{index + 1}</span></div>)}{canManageStructure && !['completed', 'archived'].includes(normalizeTherapeuticProgramStatus(selectedProgram.status)) && <div className={`flex flex-col gap-2 rounded-2xl border p-4 sm:flex-row ${subpanel}`}><input className={field} value={newTargetName} maxLength={240} onChange={(event) => setNewTargetName(event.target.value)} placeholder="Nome do novo alvo" /><button type="button" className="shrink-0 rounded-xl bg-violet-600 px-4 py-2.5 text-sm text-white disabled:opacity-50" disabled={!newTargetName.trim() || actionProgramId === String(selectedProgram.id)} onClick={() => void addTargetToProgram()}>{actionProgramId === String(selectedProgram.id) ? 'Adicionando...' : 'Adicionar alvo'}</button></div>}</div>}{detailTab === 'procedure' && <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{[['Instrução / antecedente', 'antecedent'], ['Resposta esperada', 'expectedResponse'], ['Materiais', 'materials'], ['Hierarquia de ajuda', 'promptHierarchy'], ['Reforçamento', 'reinforcement'], ['Correção de erro', 'errorCorrection'], ['Generalização', 'generalization'], ['Manutenção', 'maintenance']].map(([label, key]) => <div key={key} className={`rounded-2xl border p-4 ${subpanel}`}><p className={`text-xs ${muted}`}>{label}</p><p className={`mt-2 whitespace-pre-wrap text-sm leading-relaxed ${text}`}>{selectedProgram?.advanced_settings?.[key] || 'Não informado.'}</p></div>)}</div>}{detailTab === 'progress' && <div className="space-y-4"><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[['Alvos', selectedProgram.targets.length], ['Dominados', selectedProgram.masteredTargetCount], ['Em ensino', selectedProgram.targets.filter((target: any) => target.normalizedStatus === 'teaching').length], ['Aplicações recentes', selectedProgram.lastAppliedAt ? 1 : 0]].map(([label, value]) => <div key={String(label)} className={`rounded-2xl border p-4 ${subpanel}`}><p className={`text-xs ${muted}`}>{label}</p><p className={`mt-1 text-xl font-medium ${text}`}>{value}</p></div>)}</div><div className={`rounded-2xl border p-5 ${subpanel}`}><p className={`text-sm ${text}`}>Progresso por alvo</p><div className="mt-4 space-y-3">{selectedProgram.targets.map((target: any) => <div key={target.id}><div className={`mb-1 flex justify-between text-xs ${muted}`}><span>{target.name}</span><span>{target.normalizedStatus === 'mastered' ? '100%' : target.normalizedStatus === 'maintenance' ? '90%' : 'Em coleta'}</span></div><div className={`h-2 rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}><div className="h-full rounded-full bg-emerald-500" style={{ width: target.normalizedStatus === 'mastered' ? '100%' : target.normalizedStatus === 'maintenance' ? '90%' : '15%' }} /></div></div>)}</div></div></div>}{detailTab === 'history' && <div className="space-y-3">{(selectedProgram.history || []).map((event: any) => <div key={event.id} className={`flex gap-3 rounded-2xl border p-4 ${subpanel}`}><div className={`mt-0.5 rounded-lg p-2 ${isDark ? 'bg-slate-800 text-violet-300' : 'bg-violet-50 text-violet-600'}`}><History size={15} /></div><div><p className={`text-sm ${text}`}>{String(event.event_type || 'UPDATED').replaceAll('_', ' ').toLocaleLowerCase('pt-BR')}</p><p className={`mt-1 text-xs ${muted}`}>{formatTherapeuticPlanDate(event.created_at)}</p></div></div>)}{!(selectedProgram.history || []).length && <p className={`rounded-2xl border border-dashed p-8 text-center text-sm ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Nenhuma alteração registrada.</p>}</div>}</div></div></div>}
    </section>
  );
};
