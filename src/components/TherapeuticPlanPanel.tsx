import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
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
  SlidersHorizontal,
  Sparkles,
  Target,
  Link2,
  X,
} from 'lucide-react';
import { ResponsiveDrawer } from './ui/ResponsiveDrawer';
import { dataService } from '../services/dataService';
import {
  THERAPEUTIC_MEASUREMENT_OPTIONS,
  THERAPEUTIC_PROGRAM_STATUS_LABELS,
  THERAPEUTIC_RECOMMENDATION_TYPE_LABELS,
  buildTherapeuticPlanSummary,
  filterTherapeuticRecommendationGroups,
  formatTherapeuticPlanDate,
  groupTherapeuticRecommendations,
  masteryCriterionLabel,
  normalizeTherapeuticPrograms,
  normalizeTherapeuticProgramStatus,
  recommendationHasTrustedProgramOrigin,
  resolveTherapeuticRecommendationActionPolicy,
  type TherapeuticRecommendationActionKind,
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

const CUSTOM_MASTERY_MEASURES = [
  ['accuracy_percent', 'Percentual de acerto'],
  ['independent_responses', 'Respostas independentes'],
  ['frequency', 'Frequência'],
  ['duration_seconds', 'Duração em segundos'],
  ['latency_seconds', 'Latência em segundos'],
  ['steps_percent', 'Etapas concluídas (%)'],
] as const;

const QUICK_SUGGESTIONS = [
  {
    id: 'request-help',
    label: 'Solicitar ajuda',
    name: 'Solicitar ajuda',
    category: 'COMUNICACAO',
    objective: 'Solicitar ajuda de forma funcional diante de uma dificuldade.',
    targets: ['Ajuda para abrir', 'Ajuda para alcançar', 'Ajuda para concluir'],
    measurementType: 'independent_prompted_no_response',
    masteryPreset: 'accuracy_80_3',
  },
  {
    id: 'wait',
    label: 'Esperar',
    name: 'Tolerância à espera',
    category: 'REGULACAO',
    objective: 'Esperar pelo item ou atividade sem tentar acessá-lo antes da indicação.',
    targets: ['Esperar 10 segundos', 'Esperar 20 segundos', 'Esperar 30 segundos'],
    measurementType: 'duration',
    masteryPreset: 'custom',
  },
  {
    id: 'instructions',
    label: 'Seguir instruções',
    name: 'Seguir instruções',
    category: 'AUTONOMIA',
    objective: 'Responder a instruções funcionais de forma independente.',
    targets: ['Instrução de uma etapa', 'Instrução em atividade', 'Instrução em ambiente natural'],
    measurementType: 'correct_incorrect',
    masteryPreset: 'accuracy_80_3',
  },
  {
    id: 'request-break',
    label: 'Pedir pausa',
    name: 'Solicitar pausa',
    category: 'COMUNICACAO',
    objective: 'Solicitar uma pausa de forma funcional antes de interromper a atividade.',
    targets: ['Pausa em atividade simples', 'Pausa em tarefa longa', 'Pausa em ambiente natural'],
    measurementType: 'independent_prompted_no_response',
    masteryPreset: 'accuracy_80_3',
  },
  {
    id: 'respond-name',
    label: 'Responder ao nome',
    name: 'Responder ao próprio nome',
    category: 'SOCIAL',
    objective: 'Orientar-se para a pessoa que chama seu nome em diferentes contextos.',
    targets: ['Responder a um metro', 'Responder durante brincadeira', 'Responder em ambiente natural'],
    measurementType: 'correct_incorrect',
    masteryPreset: 'accuracy_80_3',
  },
  {
    id: 'accept-interruption',
    label: 'Aceitar interrupção',
    name: 'Aceitar interrupções',
    category: 'REGULACAO',
    objective: 'Aceitar interrupções breves e retomar a atividade de forma segura.',
    targets: ['Interrupção de 5 segundos', 'Troca breve de material', 'Retomada da atividade'],
    measurementType: 'independent_prompted_no_response',
    masteryPreset: 'accuracy_80_3',
  },
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
  customMeasure: 'accuracy_percent',
  customOperator: 'gte',
  customValue: '80',
  customSessions: '3',
  customSessionMode: 'consecutive',
  reviewDueDate: '',
  advancedSettings: {
    antecedent: '',
    expectedResponse: '',
    materials: '',
    promptHierarchy: '',
    promptFading: '',
    reinforcement: '',
    errorCorrection: '',
    environments: '',
    people: '',
    stimuli: '',
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
  const value = Math.max(0, Number(form.customValue) || 0);
  const requiredSessions = Math.max(1, Math.min(30, Number(form.customSessions) || 1));
  const genericCriteria: Record<string, any> = {
    type: 'custom_measure',
    measure: form.customMeasure,
    operator: form.customOperator,
    value,
    requiredSessions,
    sessionMode: form.customSessionMode,
  };
  if (form.customMeasure === 'accuracy_percent' || form.customMeasure === 'steps_percent') {
    genericCriteria.minAccuracyPercent = Math.min(100, value);
  }
  if (form.customMeasure === 'independent_responses') {
    genericCriteria.requiredIndependentCorrectTrials = Math.max(1, Math.round(value));
  }
  if (form.customMeasure === 'duration_seconds') genericCriteria.durationSeconds = value;
  if (form.customMeasure === 'frequency') genericCriteria.requiredFrequency = Math.max(1, Math.round(value));
  if (form.customMeasure === 'latency_seconds') genericCriteria.maxLatencySeconds = value;
  return genericCriteria;
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
  const [targetFeedback, setTargetFeedback] = useState('');
  const [editingTargetIndex, setEditingTargetIndex] = useState<number | null>(null);
  const [editingTargetValue, setEditingTargetValue] = useState('');
  const [lockedTargetNames, setLockedTargetNames] = useState<string[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedSections, setAdvancedSections] = useState<Record<string, boolean>>({});
  const [closeConfirmationOpen, setCloseConfirmationOpen] = useState(false);
  const [pendingSuggestionId, setPendingSuggestionId] = useState('');
  const [suggestionBackup, setSuggestionBackup] = useState<ReturnType<typeof initialForm> | null>(null);
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
  const [recommendationsLoadingMore, setRecommendationsLoadingMore] = useState(false);
  const [recommendationsHasMore, setRecommendationsHasMore] = useState(false);
  const [recommendationsCursor, setRecommendationsCursor] = useState('');
  const [recommendationQuery, setRecommendationQuery] = useState('');
  const [recommendationScope, setRecommendationScope] = useState<'all' | 'untreated' | 'recent' | 'incomplete' | 'treated'>('all');
  const [recommendationType, setRecommendationType] = useState('all');
  const [recommendationOrigin, setRecommendationOrigin] = useState<'all' | 'protocol' | 'program'>('all');
  const [recommendationAssessmentId, setRecommendationAssessmentId] = useState('all');
  const [recommendationDomainId, setRecommendationDomainId] = useState('all');
  const [recommendationProgramId, setRecommendationProgramId] = useState('all');
  const [recommendationProfessionalId, setRecommendationProfessionalId] = useState('all');
  const [recommendationStatus, setRecommendationStatus] = useState('all');
  const [recommendationPeriodDays, setRecommendationPeriodDays] = useState<number | null>(null);
  const [recommendationFiltersOpen, setRecommendationFiltersOpen] = useState(false);
  const [recommendationActionId, setRecommendationActionId] = useState('');
  const [recommendationNotice, setRecommendationNotice] = useState('');
  const [expandedRecommendationKey, setExpandedRecommendationKey] = useState('');
  const [linkingRecommendationId, setLinkingRecommendationId] = useState('');
  const [selectedOriginTargetId, setSelectedOriginTargetId] = useState('');
  const [linkingOrigin, setLinkingOrigin] = useState(false);
  const [selectedProtocolId, setSelectedProtocolId] = useState('');
  const [selectedDomainId, setSelectedDomainId] = useState('');
  const [selectedSkillId, setSelectedSkillId] = useState('');
  const [openMenuId, setOpenMenuId] = useState('');
  const [actionProgramId, setActionProgramId] = useState('');
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [detailTab, setDetailTab] = useState('overview');
  const [newTargetName, setNewTargetName] = useState('');
  const requestSequence = useRef(0);
  const addProgramButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerScrollRef = useRef<HTMLDivElement | null>(null);
  const recommendationScrollTopRef = useRef(0);

  const programs = useMemo(() => normalizeTherapeuticPrograms(planData), [planData]);
  const objectives = Array.isArray(planData?.objectives) ? planData.objectives : [];
  const summary = useMemo(() => buildTherapeuticPlanSummary(programs, objectives), [objectives, programs]);
  const groupedRecommendations = useMemo(() => groupTherapeuticRecommendations(recommendations), [recommendations]);
  const visibleRecommendationGroups = useMemo(() => filterTherapeuticRecommendationGroups(groupedRecommendations, {
    query: recommendationQuery,
    scope: recommendationScope,
    type: recommendationType,
    origin: recommendationOrigin,
    assessmentId: recommendationAssessmentId,
    domainId: recommendationDomainId,
    programId: recommendationProgramId,
    professionalId: recommendationProfessionalId,
    status: recommendationStatus,
    periodDays: recommendationPeriodDays,
  }), [groupedRecommendations, recommendationAssessmentId, recommendationDomainId, recommendationOrigin, recommendationPeriodDays, recommendationProfessionalId, recommendationProgramId, recommendationQuery, recommendationScope, recommendationStatus, recommendationType]);
  const recommendationProfessionals = useMemo(() => {
    const byId = new Map<string, string>();
    groupedRecommendations.forEach((group) => {
      const context = group.representative?.clinical_context || group.representative?.clinicalContext || {};
      const professional = context?.responsible_professional || context?.responsibleProfessional || {};
      const id = String(professional?.id || '').trim();
      const label = String(professional?.display_name || professional?.displayName || professional?.name || '').trim();
      if (id && label) byId.set(id, label);
    });
    return Array.from(byId.entries()).map(([id, label]) => ({ id, label })).sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));
  }, [groupedRecommendations]);
  const selectedProgram = useMemo(
    () => programs.find((program: any) => String(program.id) === selectedProgramId) || null,
    [programs, selectedProgramId],
  );
  const hasUnsavedCreationChanges = useMemo(() => {
    const blank = initialForm();
    return Boolean(
      editingProgramId
      || targetInput.trim()
      || originContext?.id
      || JSON.stringify(form) !== JSON.stringify(blank),
    );
  }, [editingProgramId, form, originContext, targetInput]);

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

  useEffect(() => {
    if (creationStep !== 'recommendation' || recommendationsLoading) return undefined;
    const timer = window.setTimeout(() => {
      if (drawerScrollRef.current) drawerScrollRef.current.scrollTop = recommendationScrollTopRef.current;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [creationStep, recommendationsLoading]);

  const resetCreation = () => {
    setCreationStep(null);
    setCreationSource('manual');
    setOriginContext({});
    setForm(initialForm());
    setTargetInput('');
    setTargetFeedback('');
    setEditingTargetIndex(null);
    setEditingTargetValue('');
    setLockedTargetNames([]);
    setAdvancedOpen(false);
    setAdvancedSections({});
    setCloseConfirmationOpen(false);
    setPendingSuggestionId('');
    setSuggestionBackup(null);
    setFormError('');
    setEditingProgramId('');
    setOperationKey('');
    setSelectedProtocolId('');
    setSelectedDomainId('');
    setSelectedSkillId('');
    setExpandedRecommendationKey('');
    setLinkingRecommendationId('');
    setSelectedOriginTargetId('');
    setLinkingOrigin(false);
    setRecommendationActionId('');
    setRecommendationNotice('');
  };

  const requestCloseCreation = () => {
    if (saving || linkingOrigin || recommendationActionId) return;
    if (hasUnsavedCreationChanges) {
      setCloseConfirmationOpen(true);
      return;
    }
    resetCreation();
  };

  const goBackCreation = () => {
    setCloseConfirmationOpen(false);
    setFormError('');
    if (creationStep === 'review') {
      setCreationStep('form');
      return;
    }
    if (creationStep === 'form' && !editingProgramId) {
      if (creationSource === 'recommendation') setCreationStep('recommendation');
      else if (creationSource === 'template') setCreationStep('templates');
      else if (creationSource === 'protocol') setCreationStep('protocol');
      else setCreationStep('source');
      return;
    }
    setCreationStep('source');
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

  const loadRecommendations = async (force = false, append = false) => {
    if (append && (!recommendationsCursor || recommendationsLoadingMore)) return;
    if (append) setRecommendationsLoadingMore(true);
    else setRecommendationsLoading(true);
    const response = await dataService.getNextSessionRecommendations(patientId, {
      limit: 50,
      before: append ? recommendationsCursor : undefined,
      force,
    });
    if (response?.success === false) setFormError(response?.message || response?.error || 'Não foi possível carregar as recomendações.');
    else {
      const rows = unwrapList(response, 'recommendations');
      const visibleRows = rows.filter((item: any) => !['REJECTED', 'DISMISSED'].includes(String(item?.status || '').toUpperCase()));
      setRecommendations((current) => {
        if (!append) return visibleRows;
        const byId = new Map(current.map((item: any) => [String(item?.id), item]));
        visibleRows.forEach((item: any) => byId.set(String(item?.id), item));
        return Array.from(byId.values());
      });
      setRecommendationsHasMore(Boolean(response?.meta?.hasMore));
      setRecommendationsCursor(String(response?.meta?.nextCursor || ''));
    }
    if (append) setRecommendationsLoadingMore(false);
    else setRecommendationsLoading(false);
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
    setOriginContext({ id: template.id, label: template.name, sourceLabel: 'Modelo de programa' });
    setForm({
      ...initialForm(),
      name: String(template?.name || ''),
      objective: String(template?.objective || template?.description || ''),
      category: normalizeCategory(template?.category),
      targets: (Array.isArray(template?.suggested_targets) ? template.suggested_targets : []).map(String).filter(Boolean),
      measurementType: String(template?.measurement_type || 'independent_prompted_no_response'),
      masteryPreset: resolveMasteryPreset(mastery),
      customMeasure: String(mastery?.measure || 'accuracy_percent'),
      customOperator: String(mastery?.operator || 'gte'),
      customValue: String(mastery?.value ?? mastery?.minAccuracyPercent ?? mastery?.min_accuracy_percent ?? 80),
      customSessions: String(mastery?.requiredSessions ?? mastery?.required_sessions ?? 3),
      customSessionMode: String(mastery?.sessionMode || mastery?.session_mode || 'consecutive'),
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
      label: String(selectedSkill.name || ''),
      sourceLabel: 'Habilidade de protocolo',
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
    const context = recommendation?.clinical_context || recommendation?.clinicalContext || {};
    const target = context?.target || {};
    const targetId = String(target?.id || recommendation?.target_id || recommendation?.targetId || '').trim();
    const targetName = String(target?.name || '').trim();
    if (!recommendationHasTrustedProgramOrigin(recommendation) || !targetId || !targetName) {
      setFormError('Esta recomendação ainda não possui uma habilidade de origem confiável. Complete o vínculo antes de criar o programa.');
      return;
    }
    recommendationScrollTopRef.current = drawerScrollRef.current?.scrollTop || 0;
    const programCategory = normalizeCategory(context?.program?.category || 'OUTRO');
    const category = CATEGORY_OPTIONS.some(([value]) => value === programCategory) ? programCategory : 'OUTRO';
    const objective = String(target?.description || context?.program?.objective || targetName).trim();
    setOriginContext({
      id: recommendation.id,
      label: targetName,
      targetId,
      protocolId: context?.protocol?.id || target?.protocol_id || target?.protocolId || null,
      protocolTitle: context?.protocol?.title || target?.protocol_title || target?.protocolTitle || null,
      domainId: context?.domain?.id || target?.domain_id || target?.domainId || null,
      domainName: context?.domain?.name || target?.domain_name || target?.domainName || null,
      sourceLabel: THERAPEUTIC_RECOMMENDATION_TYPE_LABELS[String(recommendation?.recommendation_type || '').toUpperCase()] || 'Recomendação clínica',
      programName: context?.program?.name || null,
      period: context?.period || null,
      session: context?.source_session || context?.sourceSession || null,
      responsible: context?.responsible_professional?.display_name || context?.responsibleProfessional?.displayName || null,
      motive: context?.indicator?.reason || recommendation?.summary || recommendation?.rationale || null,
    });
    setForm({ ...initialForm(), name: targetName, objective, category, targets: [targetName] });
    setCreationStep('form');
  };

  const linkRecommendationTarget = async (recommendationId: string) => {
    if (!recommendationId || !selectedOriginTargetId || linkingOrigin) return;
    setLinkingOrigin(true);
    setFormError('');
    const response = await dataService.linkAbaRecommendationTarget(recommendationId, { targetId: selectedOriginTargetId });
    if (response?.success === false) {
      setFormError(response?.message || response?.error || 'Não foi possível vincular a habilidade de origem.');
      setLinkingOrigin(false);
      return;
    }
    setLinkingRecommendationId('');
    setSelectedOriginTargetId('');
    await loadRecommendations(true);
    setLinkingOrigin(false);
  };

  const addTargets = (rawValues: string | string[]) => {
    const values = (Array.isArray(rawValues) ? rawValues : String(rawValues || '').split(/[\n,;]+/))
      .map((value) => String(value || '').trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    if (!values.length) return;
    let added = 0;
    let duplicates = 0;
    setForm((current) => {
      const next = [...current.targets];
      const normalized = new Set(next.map((item) => item.toLocaleLowerCase('pt-BR')));
      for (const value of values) {
        const key = value.toLocaleLowerCase('pt-BR');
        if (normalized.has(key)) {
          duplicates += 1;
          continue;
        }
        if (next.length >= 50) break;
        normalized.add(key);
        next.push(value);
        added += 1;
      }
      return { ...current, targets: next };
    });
    setTargetInput('');
    setTargetFeedback(duplicates > 0
      ? `${added} alvo(s) adicionado(s). ${duplicates} duplicado(s) ignorado(s).`
      : `${added} alvo(s) adicionado(s).`);
  };

  const addTarget = (raw = targetInput) => addTargets(raw);

  const commitTargetEdit = () => {
    if (editingTargetIndex === null) return;
    const value = editingTargetValue.trim().replace(/\s+/g, ' ');
    if (!value) {
      setTargetFeedback('O alvo não pode ficar vazio.');
      return;
    }
    const duplicate = form.targets.some((target, index) => index !== editingTargetIndex && target.toLocaleLowerCase('pt-BR') === value.toLocaleLowerCase('pt-BR'));
    if (duplicate) {
      setTargetFeedback('Este alvo já foi adicionado.');
      return;
    }
    setForm((current) => ({ ...current, targets: current.targets.map((target, index) => index === editingTargetIndex ? value : target) }));
    setEditingTargetIndex(null);
    setEditingTargetValue('');
    setTargetFeedback('Alvo atualizado.');
  };

  const moveTarget = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= form.targets.length) return;
    setForm((current) => {
      const next = [...current.targets];
      [next[index], next[destination]] = [next[destination], next[index]];
      return { ...current, targets: next };
    });
  };

  const applyQuickSuggestion = (suggestionId: string, mode: 'empty' | 'replace') => {
    const suggestion = QUICK_SUGGESTIONS.find((item) => item.id === suggestionId);
    if (!suggestion) return;
    setSuggestionBackup(form);
    setForm((current) => {
      const base = initialForm();
      const replace = mode === 'replace';
      return {
        ...current,
        name: replace || !current.name.trim() ? suggestion.name : current.name,
        category: replace || current.category === base.category ? suggestion.category : current.category,
        objective: replace || !current.objective.trim() ? suggestion.objective : current.objective,
        targets: replace || current.targets.length === 0 ? [...suggestion.targets] : current.targets,
        measurementType: replace || current.measurementType === base.measurementType ? suggestion.measurementType : current.measurementType,
        masteryPreset: replace || current.masteryPreset === base.masteryPreset ? suggestion.masteryPreset : current.masteryPreset,
        customMeasure: suggestion.id === 'wait' && (replace || current.customMeasure === base.customMeasure) ? 'duration_seconds' : current.customMeasure,
        customValue: suggestion.id === 'wait' && (replace || current.customValue === base.customValue) ? '30' : current.customValue,
        customSessions: suggestion.id === 'wait' && (replace || current.customSessions === base.customSessions) ? '3' : current.customSessions,
      };
    });
    setPendingSuggestionId('');
    setTargetFeedback('Sugestão aplicada para revisão.');
  };

  const requestQuickSuggestion = (suggestionId: string) => {
    const suggestion = QUICK_SUGGESTIONS.find((item) => item.id === suggestionId);
    if (!suggestion) return;
    const base = initialForm();
    const conflicts = Boolean(
      (form.name.trim() && form.name !== suggestion.name)
      || (form.objective.trim() && form.objective !== suggestion.objective)
      || form.targets.length > 0
      || form.category !== base.category
      || form.measurementType !== base.measurementType
      || form.masteryPreset !== base.masteryPreset,
    );
    if (conflicts) {
      setPendingSuggestionId(suggestionId);
      return;
    }
    applyQuickSuggestion(suggestionId, 'empty');
  };

  const validateForm = () => {
    if (!form.name.trim()) return 'Informe o nome do programa.';
    if (!form.objective.trim()) return 'Informe o objetivo terapêutico.';
    if (!editingProgramId && form.targets.length === 0) return 'Adicione pelo menos um alvo inicial.';
    if (!form.measurementType) return 'Escolha como as respostas serão registradas.';
    if (form.masteryPreset === 'custom' && (!form.customMeasure || !form.customOperator)) return 'Complete a medida e o operador do critério personalizado.';
    if (form.masteryPreset === 'custom' && (!Number.isFinite(Number(form.customValue)) || Number(form.customValue) < 0)) return 'Informe um valor válido para o critério personalizado.';
    if (form.masteryPreset === 'custom' && (!Number.isFinite(Number(form.customSessions)) || Number(form.customSessions) < 1)) return 'Informe uma quantidade válida de sessões.';
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
      customMeasure: String(criteria?.measure || 'accuracy_percent'),
      customOperator: String(criteria?.operator || 'gte'),
      customValue: String(criteria?.value ?? criteria?.minAccuracyPercent ?? criteria?.min_accuracy_percent ?? 80),
      customSessions: String(criteria?.requiredSessions ?? criteria?.required_sessions ?? 3),
      customSessionMode: String(criteria?.sessionMode || criteria?.session_mode || 'consecutive'),
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

  const recommendationTypeOptions = useMemo<string[]>(() => Array.from(new Set<string>(
    groupedRecommendations
      .map((group) => String(group.representative?.recommendation_type || group.representative?.recommendationType || '').toUpperCase())
      .filter((value): value is string => Boolean(value)),
  )).sort((left, right) => (THERAPEUTIC_RECOMMENDATION_TYPE_LABELS[left] || left).localeCompare(THERAPEUTIC_RECOMMENDATION_TYPE_LABELS[right] || right, 'pt-BR')), [groupedRecommendations]);

  const recommendationTargetOptions = useMemo(() => (Array.isArray(planData?.targets) ? planData.targets : [])
    .map((target: any) => ({
      id: String(target?.id || '').trim(),
      label: String(target?.name || '').trim(),
      programId: String(target?.program_id || target?.programId || '').trim(),
    }))
    .filter((target: any) => target.id && target.label)
    .sort((left: any, right: any) => left.label.localeCompare(right.label, 'pt-BR')), [planData?.targets]);

  const recommendationAdvancedOptions = useMemo(() => {
    const assessments = new Map<string, string>();
    const domains = new Map<string, string>();
    const relatedPrograms = new Map<string, string>();
    const statuses = new Set<string>();
    groupedRecommendations.forEach((group) => {
      const recommendation = group.representative;
      const context = recommendation?.clinical_context || recommendation?.clinicalContext || {};
      const assessmentId = String(context?.assessment?.id || '').trim();
      const domainId = String(context?.domain?.id || '').trim();
      const programId = String(context?.program?.id || recommendation?.program_id || recommendation?.programId || '').trim();
      if (assessmentId) assessments.set(assessmentId, String(context?.assessment?.label || 'Avaliação clínica'));
      if (domainId) domains.set(domainId, String(context?.domain?.name || 'Domínio clínico'));
      if (programId) relatedPrograms.set(programId, String(context?.program?.name || 'Programa relacionado'));
      const status = String(recommendation?.status || '').trim().toUpperCase();
      if (status) statuses.add(status);
    });
    const sortedEntries = (source: Map<string, string>) => Array.from(source.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));
    return {
      assessments: sortedEntries(assessments),
      domains: sortedEntries(domains),
      programs: sortedEntries(relatedPrograms),
      statuses: Array.from(statuses).sort(),
    };
  }, [groupedRecommendations]);

  const openRecommendationProgram = (
    action: TherapeuticRecommendationActionKind,
    recommendation: any,
  ) => {
    const policy = resolveTherapeuticRecommendationActionPolicy(recommendation);
    const program = programs.find((item: any) => String(item.id) === policy.programId);
    if (!program) {
      setFormError('O programa relacionado não está disponível neste Plano terapêutico. Atualize os dados clínicos antes de continuar.');
      return;
    }
    recommendationScrollTopRef.current = drawerScrollRef.current?.scrollTop || 0;
    if (canManageStructure && ['configure_generalization', 'review_prompt_fading'].includes(action)) {
      editProgram(program);
      setAdvancedOpen(true);
      setAdvancedSections({ [policy.advancedSection || 'procedure']: true });
      return;
    }
    resetCreation();
    setSelectedProgramId(String(program.id));
    setDetailTab(policy.detailTab || 'overview');
  };

  const runRecommendationAction = async (
    action: TherapeuticRecommendationActionKind,
    recommendation: any,
  ) => {
    const recommendationId = String(recommendation?.id || '').trim();
    const policy = resolveTherapeuticRecommendationActionPolicy(recommendation);
    if (!recommendationId || recommendationActionId) return;
    if (action === 'create_program') {
      applyRecommendation(recommendation);
      return;
    }
    if (action === 'complete_origin') {
      setLinkingRecommendationId(recommendationId);
      return;
    }
    if (['open_program', 'review_regression', 'configure_generalization', 'review_prompt_fading', 'review_acquisition'].includes(action)) {
      openRecommendationProgram(action, recommendation);
      return;
    }
    setRecommendationActionId(recommendationId);
    setFormError('');
    setRecommendationNotice('');
    try {
      const context = recommendation?.clinical_context || recommendation?.clinicalContext || {};
      const response = action === 'schedule_maintenance'
        ? await dataService.scheduleMaintenanceForNextSession(policy.targetId, {
            patientId,
            masteryEvaluationId: context?.assessment?.id || null,
          })
        : await dataService.applyAbaRecommendationToNextSession(recommendationId, {
            idempotencyKey: newIdempotencyKey(`therapeutic-recommendation:${recommendationId}:${action}`),
          });
      if (response?.success === false) {
        setFormError(response?.message || response?.error || 'Não foi possível concluir esta ação clínica.');
        return;
      }
      setRecommendationNotice(response?.message || (action === 'schedule_maintenance'
        ? 'Manutenção agendada para uma próxima consulta.'
        : 'Recomendação adicionada ao planejamento da próxima sessão.'));
      await loadRecommendations(true);
    } catch (error: any) {
      setFormError(error?.message || 'Não foi possível concluir esta ação clínica. Tente novamente.');
    } finally {
      setRecommendationActionId('');
    }
  };

  const renderOriginContextCard = () => {
    if (creationSource === 'manual' && !editingProgramId) return null;
    const period = originContext?.period || {};
    const sessionDate = originContext?.session?.occurred_at || originContext?.session?.occurredAt;
    const periodLabel = sessionDate
      ? `Sessão de ${formatTherapeuticPlanDate(sessionDate)}`
      : period?.start || period?.period_start
        ? `${formatTherapeuticPlanDate(period.start || period.period_start)} a ${formatTherapeuticPlanDate(period.end || period.period_end)}`
        : '';
    return (
      <aside className={`rounded-2xl border p-4 ${isDark ? 'border-violet-400/25 bg-violet-500/10' : 'border-violet-200 bg-violet-50/70'}`} aria-label="Origem deste programa">
        <p className={`text-xs ${muted}`}>Origem deste programa</p>
        <p className={`mt-1 text-sm font-medium ${text}`}>{originContext?.sourceLabel || SOURCE_LABELS[creationSource]}</p>
        <div className={`mt-2 space-y-1 text-sm ${muted}`}>
          {originContext?.label && <p>Habilidade: {originContext.label}</p>}
          {originContext?.programName && <p>Programa atual: {originContext.programName}</p>}
          {(originContext?.protocolTitle || originContext?.domainName) && <p>Origem clínica: {[originContext.protocolTitle, originContext.domainName].filter(Boolean).join(' → ')}</p>}
          {originContext?.motive && <p>Motivo: {originContext.motive}</p>}
          {periodLabel && <p>Período: {periodLabel}</p>}
          {originContext?.responsible && <p>Responsável: {originContext.responsible}</p>}
        </div>
      </aside>
    );
  };

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
        <div className="space-y-4" data-testid="therapeutic-recommendations-step">
          <div className={`space-y-3 rounded-2xl border p-4 ${subpanel}`}>
            <label className="relative block">
              <Search size={16} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${muted}`} />
              <input className={`${field} pl-10`} value={recommendationQuery} onChange={(event) => setRecommendationQuery(event.target.value)} placeholder="Buscar habilidade, programa, protocolo ou recomendação" />
            </label>
            <div className="flex flex-wrap gap-2" aria-label="Filtros rápidos de recomendações">
              {([
                ['untreated', 'all', 'Pendentes'],
                ['all', 'ACQUISITION', 'Aquisição'],
                ['all', 'REGRESSION_ATTENTION', 'Regressão'],
                ['all', 'GENERALIZATION', 'Generalização'],
                ['all', 'MAINTENANCE_PROBE', 'Manutenção'],
                ['all', 'HELP', 'Ajuda'],
                ['incomplete', 'all', 'Contexto incompleto'],
                ['treated', 'all', 'Tratadas'],
              ] as const).map(([scope, type, label]) => {
                const active = recommendationScope === scope && recommendationType === type;
                return <button key={`${scope}-${type}`} type="button" className={`rounded-full border px-3 py-1.5 text-xs ${active ? 'border-violet-500 bg-violet-600 text-white' : isDark ? 'border-slate-600 text-slate-300' : 'border-slate-200 text-slate-600'}`} onClick={() => { setRecommendationScope(scope); setRecommendationType(type); }}>{label}</button>;
              })}
            </div>
            <button type="button" className={`inline-flex items-center gap-2 text-sm ${muted}`} aria-expanded={recommendationFiltersOpen} onClick={() => setRecommendationFiltersOpen((current) => !current)}><SlidersHorizontal size={15} /> Filtros avançados <ChevronDown size={15} className={`transition-transform ${recommendationFiltersOpen ? 'rotate-180' : ''}`} /></button>
            {recommendationFiltersOpen && <div className="grid grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-2">
              <label className={`text-xs ${muted}`}>Tipo<select className={`${field} mt-1.5`} value={recommendationType} onChange={(event) => setRecommendationType(event.target.value)}><option value="all">Todos os tipos</option><option value="ACQUISITION">Aquisição</option><option value="HELP">Redução de ajuda</option>{recommendationTypeOptions.map((type) => <option key={type} value={type}>{THERAPEUTIC_RECOMMENDATION_TYPE_LABELS[type] || type}</option>)}</select></label>
              <label className={`text-xs ${muted}`}>Origem<select className={`${field} mt-1.5`} value={recommendationOrigin} onChange={(event) => setRecommendationOrigin(event.target.value as 'all' | 'protocol' | 'program')}><option value="all">Todas as origens</option><option value="protocol">Protocolo</option><option value="program">Programa</option></select></label>
              <label className={`text-xs ${muted}`}>Avaliação<select className={`${field} mt-1.5`} value={recommendationAssessmentId} onChange={(event) => setRecommendationAssessmentId(event.target.value)}><option value="all">Todas as avaliações</option>{recommendationAdvancedOptions.assessments.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
              <label className={`text-xs ${muted}`}>Domínio<select className={`${field} mt-1.5`} value={recommendationDomainId} onChange={(event) => setRecommendationDomainId(event.target.value)}><option value="all">Todos os domínios</option>{recommendationAdvancedOptions.domains.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
              <label className={`text-xs ${muted}`}>Programa<select className={`${field} mt-1.5`} value={recommendationProgramId} onChange={(event) => setRecommendationProgramId(event.target.value)}><option value="all">Todos os programas</option>{recommendationAdvancedOptions.programs.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
              <label className={`text-xs ${muted}`}>Profissional<select className={`${field} mt-1.5`} value={recommendationProfessionalId} onChange={(event) => setRecommendationProfessionalId(event.target.value)}><option value="all">Todos os profissionais</option>{recommendationProfessionals.map((professional) => <option key={professional.id} value={professional.id}>{professional.label}</option>)}</select></label>
              <label className={`text-xs ${muted}`}>Status<select className={`${field} mt-1.5`} value={recommendationStatus} onChange={(event) => setRecommendationStatus(event.target.value)}><option value="all">Todos os status</option>{recommendationAdvancedOptions.statuses.map((status) => <option key={status} value={status}>{status === 'SUGGESTED' ? 'Pendente' : status === 'APPLIED_TO_NEXT_SESSION' ? 'Aplicada à próxima sessão' : status === 'ACCEPTED' ? 'Aceita' : status}</option>)}</select></label>
              <label className={`text-xs ${muted}`}>Período<select className={`${field} mt-1.5`} value={recommendationPeriodDays || 'all'} onChange={(event) => setRecommendationPeriodDays(event.target.value === 'all' ? null : Number(event.target.value))}><option value="all">Todo o histórico carregado</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select></label>
            </div>}
          </div>

          {recommendationNotice && <div className={`rounded-xl border px-4 py-3 text-sm ${isDark ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`} aria-live="polite">{recommendationNotice}</div>}

          {recommendationsLoading && <div className="space-y-3" aria-label="Carregando recomendações">{[0, 1, 2].map((item) => <div key={item} className={`animate-pulse rounded-2xl border p-5 ${subpanel}`}><div className={`h-3 w-24 rounded ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`} /><div className={`mt-4 h-5 w-3/5 rounded ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`} /><div className={`mt-3 h-3 w-full rounded ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`} /><div className={`mt-2 h-3 w-4/5 rounded ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`} /></div>)}</div>}

          {!recommendationsLoading && visibleRecommendationGroups.map((group) => {
            const recommendation = group.representative;
            const context = recommendation?.clinical_context || recommendation?.clinicalContext || {};
            const target = context?.target || {};
            const behavior = context?.behavior || {};
            const program = context?.program || {};
            const protocol = context?.protocol || {};
            const domain = context?.domain || {};
            const assessment = context?.assessment || {};
            const session = context?.source_session || context?.sourceSession || {};
            const period = context?.period || {};
            const responsible = context?.responsible_professional || context?.responsibleProfessional || {};
            const indicator = context?.indicator || {};
            const type = String(recommendation?.recommendation_type || recommendation?.recommendationType || '').toUpperCase();
            const typeLabel = THERAPEUTIC_RECOMMENDATION_TYPE_LABELS[type] || 'Recomendação clínica';
            const status = String(recommendation?.status || '').toUpperCase();
            const policyRecommendation = group.convertedProgram
              ? {
                  ...recommendation,
                  clinical_context: { ...context, converted_program: group.convertedProgram },
                }
              : recommendation;
            const actionPolicy = resolveTherapeuticRecommendationActionPolicy(policyRecommendation);
            const targetName = String(target?.name || behavior?.name || '').trim() || 'Origem clínica incompleta';
            const contextPath = protocol?.title
              ? [protocol.title, domain?.name, target?.name].filter(Boolean).join(' → ')
              : program?.name
                ? [`Programa “${program.name}”`, target?.name ? `Alvo “${target.name}”` : ''].filter(Boolean).join(' → ')
                : target?.name ? `Alvo “${target.name}”` : '';
            const motive = String(indicator?.reason || recommendation?.summary || recommendation?.rationale || 'Sem justificativa adicional.');
            const originLabel = session?.occurred_at || session?.occurredAt
              ? `Sessão de ${formatTherapeuticPlanDate(session.occurred_at || session.occurredAt)}`
              : period?.start || period?.period_start
                ? `Período analisado: ${formatTherapeuticPlanDate(period.start || period.period_start)} a ${formatTherapeuticPlanDate(period.end || period.period_end)}`
                : `Gerada em ${formatTherapeuticPlanDate(recommendation?.created_at || recommendation?.createdAt)}`;
            const isExpanded = expandedRecommendationKey === group.key;
            const contextIssues = Array.isArray(recommendation?.context_issues) ? recommendation.context_issues : [];
            const actionRecommendation = actionPolicy.primaryAction === 'create_program'
              ? group.occurrences.find((item: any) => recommendationHasTrustedProgramOrigin(item)) || recommendation
              : policyRecommendation;
            const primaryNeedsManager = actionPolicy.primaryAction === 'apply_next_session';
            const secondaryNeedsManager = actionPolicy.secondaryAction === 'apply_next_session';
            return (
              <article key={group.key} className={`rounded-2xl border p-5 ${subpanel}`} data-testid="therapeutic-recommendation-card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] ${isDark ? 'bg-violet-500/15 text-violet-200' : 'bg-violet-50 text-violet-700'}`}>{typeLabel}</span>
                  <div className="flex items-center gap-2">
                    {group.occurrenceCount > 1 && <span className={`text-xs ${muted}`}>{group.occurrenceCount} ocorrências</span>}
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${isDark ? 'border-slate-600 text-slate-300' : 'border-slate-200 text-slate-500'}`}>{status === 'APPLIED_TO_NEXT_SESSION' ? 'Tratada' : status === 'ACCEPTED' ? 'Aceita' : status === 'SUGGESTED' ? 'Pendente' : status || 'Pendente'}</span>
                  </div>
                </div>
                <h4 className={`mt-3 text-base font-medium ${text}`}>{targetName}</h4>
                {program?.name && <p className={`mt-1 text-sm ${muted}`}>Programa: {program.name}</p>}
                {target?.name && program?.name && <p className={`mt-1 text-sm ${muted}`}>Alvo: {target.name}</p>}
                {contextPath && <p className={`mt-1 text-sm ${muted}`}>Origem: {contextPath}</p>}
                <p className={`mt-3 text-sm leading-relaxed ${text}`}>{motive}</p>
                <div className={`mt-3 space-y-1 text-xs ${muted}`}>
                  <p>{originLabel}</p>
                  {responsible?.display_name && <p>Responsável: {responsible.display_name}</p>}
                </div>

                {group.convertedProgram && <div className={`mt-4 rounded-xl border px-3 py-2.5 text-sm ${isDark ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}><CheckCircle2 size={15} className="mr-2 inline" /> Programa criado: {group.convertedProgram.name}</div>}
                {!group.convertedProgram && !actionPolicy.contextComplete && <div className={`mt-4 rounded-xl border px-3 py-2.5 text-sm ${isDark ? 'border-amber-400/25 bg-amber-500/10 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-800'}`}><p className="font-medium">Contexto incompleto</p><p className="mt-1">Não foi possível identificar com segurança a habilidade ou o programa relacionado.</p></div>}

                {isExpanded && <div className={`mt-4 space-y-3 border-t pt-4 text-sm ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
                  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {protocol?.title && <div><dt className={`text-xs ${muted}`}>Protocolo</dt><dd className={`mt-1 ${text}`}>{protocol.title}</dd></div>}
                    {assessment?.label && <div><dt className={`text-xs ${muted}`}>Avaliação de origem</dt><dd className={`mt-1 ${text}`}>{assessment.label}</dd></div>}
                    {domain?.name && <div><dt className={`text-xs ${muted}`}>Domínio</dt><dd className={`mt-1 ${text}`}>{domain.name}</dd></div>}
                    {program?.name && <div><dt className={`text-xs ${muted}`}>Programa relacionado</dt><dd className={`mt-1 ${text}`}>{program.name}</dd></div>}
                    {target?.name && <div><dt className={`text-xs ${muted}`}>Habilidade / alvo</dt><dd className={`mt-1 ${text}`}>{target.name}</dd></div>}
                    {behavior?.name && <div><dt className={`text-xs ${muted}`}>Comportamento relacionado</dt><dd className={`mt-1 ${text}`}>{behavior.name}</dd></div>}
                    {indicator?.metric_name && <div><dt className={`text-xs ${muted}`}>Indicador</dt><dd className={`mt-1 ${text}`}>{indicator.metric_name}</dd></div>}
                    {target?.mastery_criteria && <div><dt className={`text-xs ${muted}`}>Critério esperado</dt><dd className={`mt-1 ${text}`}>{masteryCriterionLabel(target.mastery_criteria)}</dd></div>}
                  </dl>
                  {group.occurrenceCount > 1 && <div><p className={`text-xs ${muted}`}>Histórico de ocorrências</p><div className="mt-2 space-y-2">{group.occurrences.map((occurrence: any) => <div key={occurrence.id} className={`rounded-lg px-3 py-2 text-xs ${isDark ? 'bg-slate-800/70 text-slate-300' : 'bg-white text-slate-600'}`}>{formatTherapeuticPlanDate(occurrence.created_at || occurrence.createdAt)} · {THERAPEUTIC_RECOMMENDATION_TYPE_LABELS[String(occurrence.recommendation_type || '').toUpperCase()] || typeLabel}</div>)}</div></div>}
                  {contextIssues.length > 0 && <p className={`text-xs ${muted}`}>Contexto pendente: {contextIssues.join(', ')}.</p>}
                </div>}

                {canManageStructure && linkingRecommendationId === String(recommendation.id) && <div className={`mt-4 rounded-xl border p-3 ${isDark ? 'border-slate-600 bg-slate-900' : 'border-slate-200 bg-white'}`}>
                  <label className={`text-xs ${muted}`}>Vincular habilidade existente<select className={`${field} mt-1.5`} value={selectedOriginTargetId} onChange={(event) => setSelectedOriginTargetId(event.target.value)}><option value="">Selecione uma habilidade...</option>{recommendationTargetOptions.map((option: any) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
                  {!recommendationTargetOptions.length && <p className={`mt-2 text-xs ${muted}`}>Não há alvos estruturados disponíveis neste plano. Crie a partir de protocolo ou manualmente.</p>}
                  <div className="mt-3 flex justify-end gap-2"><button type="button" className={secondaryButton} disabled={linkingOrigin} onClick={() => { setLinkingRecommendationId(''); setSelectedOriginTargetId(''); }}>Cancelar</button><button type="button" className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={!selectedOriginTargetId || linkingOrigin} onClick={() => void linkRecommendationTarget(String(recommendation.id))}>{linkingOrigin ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />} Vincular habilidade</button></div>
                </div>}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className={secondaryButton} onClick={() => setExpandedRecommendationKey((current) => current === group.key ? '' : group.key)}>{isExpanded ? 'Ocultar contexto' : 'Abrir contexto'}</button>
                  {(!primaryNeedsManager || canManageStructure) && (actionPolicy.primaryAction !== 'complete_origin' || canManageStructure) && <button type="button" className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={recommendationActionId === String(recommendation.id)} onClick={() => { if (actionPolicy.primaryAction === 'complete_origin') setExpandedRecommendationKey(group.key); void runRecommendationAction(actionPolicy.primaryAction, actionRecommendation); }}>{recommendationActionId === String(recommendation.id) && <Loader2 size={15} className="animate-spin" />}{actionPolicy.primaryLabel}</button>}
                  {actionPolicy.secondaryAction && (!secondaryNeedsManager || canManageStructure) && <button type="button" className={secondaryButton} disabled={recommendationActionId === String(recommendation.id)} onClick={() => void runRecommendationAction(actionPolicy.secondaryAction as TherapeuticRecommendationActionKind, actionRecommendation)}>{actionPolicy.secondaryLabel}</button>}
                  {actionPolicy.primaryAction === 'complete_origin' && !canManageStructure && <span className={`self-center text-xs ${muted}`}>Origem deve ser vinculada por um coordenador.</span>}
                </div>
              </article>
            );
          })}

          {!recommendationsLoading && recommendationsHasMore && <div className="flex justify-center"><button type="button" className={secondaryButton} disabled={recommendationsLoadingMore} onClick={() => void loadRecommendations(false, true)}>{recommendationsLoadingMore ? <Loader2 size={15} className="animate-spin" /> : <History size={15} />} Carregar recomendações anteriores</button></div>}

          {!recommendationsLoading && !visibleRecommendationGroups.length && !recommendationsHasMore && <div className={`rounded-2xl border border-dashed p-8 text-center text-sm ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}><p>Nenhuma recomendação disponível para criar um programa.</p><div className="mt-4 flex flex-wrap justify-center gap-2"><button type="button" className={secondaryButton} onClick={() => setCreationStep('source')}>Voltar</button><button type="button" className={secondaryButton} onClick={() => chooseSource('manual')}>Criar manualmente</button><button type="button" className={secondaryButton} onClick={() => chooseSource('protocol')}>Criar a partir de protocolo</button></div></div>}
          {!recommendationsLoading && formError && <button type="button" className={secondaryButton} onClick={() => void loadRecommendations()}>Tentar carregar novamente</button>}
        </div>
      );
    }

    if (creationStep === 'form') {
      const measurementPreview = THERAPEUTIC_MEASUREMENT_OPTIONS.find((option) => option.value === form.measurementType)?.sessionPreview || [];
      const advancedField = (label: string, key: keyof typeof form.advancedSettings) => <label className={`text-xs ${muted}`}>{label}<textarea className={`${field} mt-1.5 min-h-[88px] resize-y`} value={form.advancedSettings[key]} onChange={(event) => setForm((current) => ({ ...current, advancedSettings: { ...current.advancedSettings, [key]: event.target.value } }))} /></label>;
      const advancedCount = (keys: Array<keyof typeof form.advancedSettings>) => keys.filter((key) => form.advancedSettings[key].trim()).length;
      const advancedSection = (id: string, label: string, keys: Array<keyof typeof form.advancedSettings>, content: React.ReactNode) => {
        const count = advancedCount(keys) + (id === 'management' && form.reviewDueDate ? 1 : 0);
        const open = Boolean(advancedSections[id]);
        return <section className={`rounded-xl border ${isDark ? 'border-slate-700 bg-slate-900/55' : 'border-slate-200 bg-white'}`}><button type="button" className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm ${text}`} aria-expanded={open} onClick={() => setAdvancedSections((current) => ({ ...current, [id]: !current[id] }))}><span>{label}{count > 0 && <span className={`ml-2 text-xs ${muted}`}>— {count} campo(s) preenchido(s)</span>}</span><ChevronDown size={16} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} /></button>{open && <div className="grid grid-cols-1 gap-4 border-t p-4 md:grid-cols-2">{content}</div>}</section>;
      };
      return (
        <div className="space-y-5">
          {renderOriginContextCard()}
          {creationSource === 'manual' && !editingProgramId && (
            <div className={`rounded-2xl border p-4 ${subpanel}`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><p className={`text-xs ${muted}`}>Sugestões rápidas para revisar</p>{suggestionBackup && <button type="button" className="text-xs text-violet-500 hover:underline" onClick={() => { setForm(suggestionBackup); setSuggestionBackup(null); setPendingSuggestionId(''); }}>Desfazer sugestão</button>}</div>
              <div className="mt-2 flex flex-wrap gap-2">{QUICK_SUGGESTIONS.map((suggestion) => <button key={suggestion.id} type="button" className={`rounded-full border px-3 py-1.5 text-xs ${isDark ? 'border-slate-600 text-slate-300 hover:border-violet-400' : 'border-slate-200 text-slate-600 hover:border-violet-300'}`} onClick={() => requestQuickSuggestion(suggestion.id)}>{suggestion.label}</button>)}</div>
              {pendingSuggestionId && <div className={`mt-3 rounded-xl border p-3 text-sm ${isDark ? 'border-amber-400/25 bg-amber-500/10 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-900'}`}><p>Já existem dados preenchidos. Como deseja aplicar esta sugestão?</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={secondaryButton} onClick={() => applyQuickSuggestion(pendingSuggestionId, 'empty')}>Preencher apenas campos vazios</button><button type="button" className="rounded-xl bg-violet-600 px-4 py-2 text-sm text-white" onClick={() => applyQuickSuggestion(pendingSuggestionId, 'replace')}>Substituir campos preenchidos</button><button type="button" className={secondaryButton} onClick={() => setPendingSuggestionId('')}>Cancelar</button></div></div>}
            </div>
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
                {form.targets.map((target, index) => {
                  const isPersistedTarget = lockedTargetNames.includes(target);
                  if (editingTargetIndex === index) {
                    return <span key={`${target}-${index}`} className={`inline-flex min-w-[260px] items-center gap-1.5 rounded-xl border p-1.5 ${isDark ? 'border-violet-400/40 bg-slate-800' : 'border-violet-300 bg-white'}`}><input className="min-w-0 flex-1 bg-transparent px-2 py-1 text-xs outline-none" value={editingTargetValue} autoFocus onChange={(event) => setEditingTargetValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitTargetEdit(); } if (event.key === 'Escape') { setEditingTargetIndex(null); setEditingTargetValue(''); } }} /><button type="button" className="rounded-lg p-1 text-emerald-500" aria-label="Salvar edição do alvo" onClick={commitTargetEdit}><Check size={14} /></button><button type="button" className="rounded-lg p-1 text-slate-400" aria-label="Cancelar edição do alvo" onClick={() => { setEditingTargetIndex(null); setEditingTargetValue(''); }}><X size={14} /></button></span>;
                  }
                  return (
                    <span key={`${target}-${index}`} className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs ${isDark ? 'bg-violet-500/15 text-violet-100' : 'bg-violet-50 text-violet-700'}`}>
                      {target}
                      <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={index === 0} aria-label={`Mover ${target} para cima`} onClick={() => moveTarget(index, -1)}><ArrowUp size={12} /></button>
                      <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={index === form.targets.length - 1} aria-label={`Mover ${target} para baixo`} onClick={() => moveTarget(index, 1)}><ArrowDown size={12} /></button>
                      {!isPersistedTarget && (
                        <><button type="button" className="rounded p-0.5" aria-label={`Editar ${target}`} onClick={() => { setEditingTargetIndex(index); setEditingTargetValue(target); }}><Pencil size={12} /></button><button type="button" className="rounded p-0.5" aria-label={`Remover ${target}`} onClick={() => setForm((current) => ({ ...current, targets: current.targets.filter((_item, itemIndex) => itemIndex !== index) }))}><X size={13} /></button></>
                      )}
                    </span>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-2">
                <input className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm outline-none" value={targetInput} onChange={(event) => setTargetInput(event.target.value)} onPaste={(event) => { const pasted = event.clipboardData.getData('text'); if (/[\n,;]/.test(pasted)) { event.preventDefault(); addTargets(pasted); } }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addTarget(); } }} placeholder="Digite um alvo e pressione Enter" />
                <button type="button" className="rounded-xl bg-violet-600 px-3 text-white" onClick={() => addTarget()} aria-label="Adicionar alvo"><Plus size={16} /></button>
              </div>
            </div>
            {targetFeedback && <p className={`mt-2 text-xs ${muted}`} aria-live="polite">{targetFeedback}</p>}
            {editingProgramId && <p className={`mt-2 text-xs ${muted}`}>Alvos já usados em sessões permanecem protegidos. Os novos serão incluídos ao salvar, sem apagar progresso.</p>}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className={`text-xs ${muted}`}>Como registrar<select className={`${field} mt-1.5`} value={form.measurementType} onChange={(event) => setForm((current) => ({ ...current, measurementType: event.target.value }))}>{THERAPEUTIC_MEASUREMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className={`text-xs ${muted}`}>Critério de domínio<select className={`${field} mt-1.5`} value={form.masteryPreset} onChange={(event) => setForm((current) => ({ ...current, masteryPreset: event.target.value }))}>{MASTERY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <div className={`rounded-xl border p-3 md:col-span-2 ${isDark ? 'border-slate-700 bg-slate-900/45' : 'border-slate-200 bg-slate-50'}`}><p className={`text-xs ${muted}`}>Durante a sessão, o aplicador verá:</p><div className="mt-2 flex flex-wrap gap-2">{measurementPreview.map((label) => <span key={label} className={`rounded-lg border px-3 py-2 text-xs ${isDark ? 'border-slate-600 bg-slate-800 text-slate-200' : 'border-slate-200 bg-white text-slate-700'}`}>{label}</span>)}</div></div>
          </div>
          {form.masteryPreset === 'custom' && <div className={`grid grid-cols-1 gap-3 rounded-2xl border p-4 sm:grid-cols-2 ${subpanel}`} data-testid="custom-mastery-fields">
            <label className={`text-xs ${muted}`}>Medida<select className={`${field} mt-1.5`} value={form.customMeasure} onChange={(event) => setForm((current) => ({ ...current, customMeasure: event.target.value }))}>{CUSTOM_MASTERY_MEASURES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className={`text-xs ${muted}`}>Operador<select className={`${field} mt-1.5`} value={form.customOperator} onChange={(event) => setForm((current) => ({ ...current, customOperator: event.target.value }))}><option value="gte">Maior ou igual a</option><option value="gt">Maior que</option><option value="eq">Igual a</option><option value="lte">Menor ou igual a</option></select></label>
            <label className={`text-xs ${muted}`}>Valor<input type="number" min="0" step="0.01" className={`${field} mt-1.5`} value={form.customValue} onChange={(event) => setForm((current) => ({ ...current, customValue: event.target.value }))} /></label>
            <label className={`text-xs ${muted}`}>Quantidade de sessões<input type="number" min="1" max="30" className={`${field} mt-1.5`} value={form.customSessions} onChange={(event) => setForm((current) => ({ ...current, customSessions: event.target.value }))} /></label>
            <label className={`text-xs ${muted}`}>Contagem das sessões<select className={`${field} mt-1.5`} value={form.customSessionMode} onChange={(event) => setForm((current) => ({ ...current, customSessionMode: event.target.value }))}><option value="consecutive">Consecutivas</option><option value="cumulative">Acumuladas</option></select></label>
          </div>}
          <div className={`rounded-2xl border ${subpanel}`}>
            <button type="button" className={`flex w-full items-center justify-between p-4 text-sm ${text}`} aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((current) => !current)}><span>Ajustes avançados <span className={muted}>(opcional)</span></span><ChevronDown size={17} className={`transition-transform ${advancedOpen ? 'rotate-180' : ''}`} /></button>
            {advancedOpen && <div className="space-y-3 border-t p-4">
              {advancedSection('procedure', 'Procedimento', ['antecedent', 'expectedResponse', 'materials', 'errorCorrection'], <>{advancedField('Instrução ou antecedente', 'antecedent')}{advancedField('Resposta esperada', 'expectedResponse')}{advancedField('Materiais', 'materials')}{advancedField('Correção de erro', 'errorCorrection')}</>)}
              {advancedSection('support', 'Ajuda e reforçamento', ['promptHierarchy', 'promptFading', 'reinforcement'], <>{advancedField('Hierarquia de ajuda', 'promptHierarchy')}{advancedField('Procedimento de fading', 'promptFading')}{advancedField('Reforçamento', 'reinforcement')}</>)}
              {advancedSection('generalization', 'Generalização e manutenção', ['generalization', 'environments', 'people', 'stimuli', 'maintenance', 'frequency'], <>{advancedField('Generalização', 'generalization')}{advancedField('Ambientes', 'environments')}{advancedField('Pessoas', 'people')}{advancedField('Estímulos', 'stimuli')}{advancedField('Manutenção', 'maintenance')}{advancedField('Frequência de sondagem', 'frequency')}</>)}
              {advancedSection('management', 'Gestão do programa', ['responsibleNotes', 'notes'], <>{advancedField('Responsáveis', 'responsibleNotes')}<label className={`text-xs ${muted}`}>Próxima revisão<input type="date" className={`${field} mt-1.5`} value={form.reviewDueDate} onChange={(event) => setForm((current) => ({ ...current, reviewDueDate: event.target.value }))} /></label>{advancedField('Observações', 'notes')}<div className={`rounded-xl border p-3 text-xs ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Origem registrada: {originContext?.sourceLabel || SOURCE_LABELS[creationSource]}</div></>)}
            </div>}
          </div>
        </div>
      );
    }

    if (creationStep === 'review') {
      const measurement = THERAPEUTIC_MEASUREMENT_OPTIONS.find((option) => option.value === form.measurementType);
      const advancedLabels: Record<string, string> = { antecedent: 'Instrução ou antecedente', expectedResponse: 'Resposta esperada', materials: 'Materiais', promptHierarchy: 'Hierarquia de ajuda', promptFading: 'Procedimento de fading', reinforcement: 'Reforçamento', errorCorrection: 'Correção de erro', environments: 'Ambientes', people: 'Pessoas', stimuli: 'Estímulos', generalization: 'Generalização', maintenance: 'Manutenção', frequency: 'Frequência de sondagem', responsibleNotes: 'Responsáveis', notes: 'Observações' };
      const filledAdvanced = Object.entries(form.advancedSettings).filter(([, value]) => String(value || '').trim());
      return <div className="space-y-4">{renderOriginContextCard()}<div className={`rounded-2xl border p-5 ${subpanel}`}><p className={`text-xs ${muted}`}>{editingProgramId ? 'Revisão da atualização' : `Adaptado para ${patientName}`}</p><h4 className={`mt-1 text-xl font-medium ${text}`}>{form.name}</h4><dl className="mt-5 grid grid-cols-1 gap-4 text-sm md:grid-cols-2"><div><dt className={muted}>Categoria</dt><dd className={`mt-1 ${text}`}>{CATEGORY_LABELS[form.category] || form.category}</dd></div><div><dt className={muted}>Origem</dt><dd className={`mt-1 ${text}`}>{SOURCE_LABELS[creationSource]}{originContext?.label ? ` · ${originContext.label}` : ''}</dd></div><div className="md:col-span-2"><dt className={muted}>Objetivo</dt><dd className={`mt-1 leading-relaxed ${text}`}>{form.objective}</dd></div><div><dt className={muted}>Registro</dt><dd className={`mt-1 ${text}`}>{measurement?.label}</dd></div><div><dt className={muted}>Critério de domínio</dt><dd className={`mt-1 ${text}`}>{masteryCriterionLabel(buildMasteryCriteria(form))}</dd></div><div><dt className={muted}>Responsáveis</dt><dd className={`mt-1 ${text}`}>{form.advancedSettings.responsibleNotes || 'Equipe clínica'}</dd></div><div><dt className={muted}>Próxima revisão</dt><dd className={`mt-1 ${text}`}>{formatTherapeuticPlanDate(form.reviewDueDate)}</dd></div></dl><div className={`mt-5 border-t pt-4 ${isDark ? 'border-slate-700' : 'border-slate-200'}`}><p className={`text-xs ${muted}`}>Alvos iniciais ({form.targets.length})</p><div className="mt-2 flex flex-wrap gap-2">{form.targets.map((target, index) => <span key={`${target}-${index}`} className={`rounded-lg px-3 py-1.5 text-xs ${isDark ? 'bg-slate-800 text-slate-200' : 'bg-white text-slate-700'}`}>{index + 1}. {target}</span>)}</div></div>{filledAdvanced.length > 0 && <div className={`mt-5 border-t pt-4 ${isDark ? 'border-slate-700' : 'border-slate-200'}`}><p className={`text-xs ${muted}`}>Configurações avançadas preenchidas</p><dl className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">{filledAdvanced.map(([key, value]) => <div key={key}><dt className={`text-xs ${muted}`}>{advancedLabels[key] || key}</dt><dd className={`mt-1 whitespace-pre-wrap text-sm ${text}`}>{String(value)}</dd></div>)}</dl></div>}</div></div>;
    }
    return null;
  };

  const renderCreationFooter = () => {
    if (closeConfirmationOpen) {
      const canSaveDraft = !editingProgramId && ['form', 'review'].includes(String(creationStep)) && !validateForm();
      return <div className="space-y-3" aria-live="polite"><p className={`text-sm ${text}`}>Há alterações não salvas neste programa.</p><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" className={secondaryButton} onClick={() => setCloseConfirmationOpen(false)}>Continuar editando</button><button type="button" className={secondaryButton} onClick={resetCreation}>Descartar alterações</button>{canSaveDraft && <button type="button" className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm text-white disabled:opacity-50" disabled={saving} onClick={() => void submitProgram('draft')}>{saving ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />} Salvar como rascunho</button>}</div></div>;
    }
    if (creationStep !== 'form' && creationStep !== 'review') return null;
    if (creationStep === 'form') {
      return <div className="flex flex-col-reverse justify-between gap-2 sm:flex-row"><button type="button" className={secondaryButton} disabled={saving} onClick={requestCloseCreation}>Cancelar</button><div className="flex flex-col-reverse gap-2 sm:flex-row"><button type="button" className={secondaryButton} disabled={saving} onClick={goBackCreation}><ChevronLeft size={16} /> Voltar</button><button type="button" className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm text-white hover:bg-violet-700 disabled:opacity-50" disabled={saving} onClick={continueToReview}>Revisar programa <ChevronLeft size={16} className="rotate-180" /></button></div></div>;
    }
    return <div className="flex flex-col-reverse justify-between gap-2 sm:flex-row"><button type="button" className={secondaryButton} disabled={saving} onClick={goBackCreation}><ChevronLeft size={16} /> Voltar</button><div className="flex flex-col-reverse gap-2 sm:flex-row"><button type="button" className={secondaryButton} disabled={saving} onClick={() => void submitProgram('draft')}>{saving ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />} {editingProgramId ? 'Salvar alterações' : 'Salvar como rascunho'}</button>{!editingProgramId && <button type="button" className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm text-white disabled:opacity-50" disabled={saving} onClick={() => void submitProgram('teaching')}>{saving ? <Loader2 size={16} className="animate-spin" /> : canManageStructure ? <Play size={16} /> : <Check size={16} />}{canManageStructure ? 'Ativar programa' : 'Enviar para aprovação'}</button>}</div></div>;
  };

  const creationTitle = editingProgramId
    ? 'Editar programa'
    : creationStep === 'source' ? 'Como deseja criar este programa?'
      : creationStep === 'templates' ? 'Biblioteca de programas'
        : creationStep === 'protocol' ? 'Criar a partir de protocolo'
          : creationStep === 'recommendation' ? 'Criar a partir de recomendação'
            : creationStep === 'review' ? 'Revise antes de salvar'
              : `Adaptar programa para ${patientName}`;
  const creationStage = creationStep === 'form'
    ? 'Adaptação'
    : creationStep === 'review'
      ? 'Revisão'
      : ['templates', 'protocol', 'recommendation'].includes(String(creationStep))
        ? 'Seleção'
        : 'Origem';
  const progressSteps = ['Origem', 'Seleção', 'Adaptação', 'Revisão'];
  const activeProgressIndex = Math.max(0, progressSteps.indexOf(creationStage));
  const creationProgress = <nav className="flex items-center gap-1 overflow-hidden" aria-label="Progresso da criação do programa">{progressSteps.map((step, index) => <React.Fragment key={step}><span className={`shrink-0 text-xs ${index === activeProgressIndex ? 'font-medium text-violet-500' : index < activeProgressIndex ? isDark ? 'text-emerald-300' : 'text-emerald-600' : muted}`} aria-current={index === activeProgressIndex ? 'step' : undefined}>{step}</span>{index < progressSteps.length - 1 && <span className={`min-w-2 flex-1 border-t ${index < activeProgressIndex ? 'border-emerald-400' : isDark ? 'border-slate-700' : 'border-slate-200'}`} aria-hidden="true" />}</React.Fragment>)}</nav>;

  const renderProgramCard = (program: any) => {
    const status = normalizeTherapeuticProgramStatus(program.status);
    const targets = Array.isArray(program.targets) ? program.targets : [];
    const targetCount = targets.length;
    const mastered = Number(program.masteredTargetCount || 0);
    const currentTarget = targets.find((target: any) => target.normalizedStatus === 'teaching') || (status === 'maintenance' ? targets.find((target: any) => target.normalizedStatus === 'maintenance') : null);
    const teachingTargets = targets.filter((target: any) => target.normalizedStatus === 'teaching').length;
    const waitingTargets = targets.filter((target: any) => target.normalizedStatus === 'not_started').length;
    const pausedTargets = targets.filter((target: any) => target.normalizedStatus === 'paused').length;
    const progress = targetCount ? Math.round((mastered / targetCount) * 100) : 0;
    const criteria = program.mastery_criteria || program.masteryCriteria || program.criteria;
    const hasConfiguredCriterion = Boolean(
      criteria && typeof criteria === 'object' && Object.values(criteria).some((value) => (
        typeof value === 'number' ? Number.isFinite(value) : Boolean(String(value || '').trim())
      ))
    );
    const criterionLabel = hasConfiguredCriterion ? masteryCriterionLabel(criteria) : 'Critério ainda não configurado';
    const hasRecordedApplications = Boolean(program.lastAppliedAt);
    const responsibleLabel = program?.advanced_settings?.responsibleNotes || program?.advancedSettings?.responsibleNotes || (Array.isArray(program.responsible_professional_ids) && program.responsible_professional_ids.length ? `${program.responsible_professional_ids.length} profissional(is)` : 'Equipe clínica');

    return (
      <article key={program.id} className={`relative rounded-2xl border p-5 ${panel}`} data-therapeutic-program-card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`text-xs ${muted}`}>Programa</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h4 className={`truncate text-base font-medium ${text}`}>{program.name}</h4>
              <span className={`rounded-full border px-2.5 py-1 text-[10px] ${statusClass(status)}`}>{THERAPEUTIC_PROGRAM_STATUS_LABELS[status]}</span>
            </div>
            <p className={`mt-1 text-xs ${muted}`}>{CATEGORY_LABELS[normalizeCategory(program.category)] || program.category} · {SOURCE_LABELS[String(program.origin_type || 'manual')] || 'Programa individual'}</p>
          </div>
          <button type="button" aria-label={`Mais ações para ${program.name}`} className={`min-h-[40px] min-w-[40px] rounded-lg p-2 ${isDark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-400 hover:bg-slate-100'}`} onClick={() => setOpenMenuId((current) => current === String(program.id) ? '' : String(program.id))}><MoreHorizontal size={18} /></button>
        </div>

        {openMenuId === String(program.id) && <div className={`absolute right-5 top-12 z-20 w-56 rounded-xl border p-1.5 shadow-xl ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}>
          {canManageStructure && !['completed', 'archived'].includes(status) && <button className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${isDark ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50'}`} onClick={() => editProgram(program)}><Pencil size={15} /> Editar</button>}
          {canManageStructure && status !== 'paused' && <button className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${isDark ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50'}`} onClick={() => void updateStatus(program, 'paused')}><Pause size={15} /> Pausar</button>}
          {canManageStructure && status !== 'maintenance' && !['completed', 'archived'].includes(status) && <button className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${isDark ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50'}`} onClick={() => void updateStatus(program, 'maintenance')}><Clock3 size={15} /> Mover para manutenção</button>}
          {canManageStructure && status !== 'completed' && <button className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${isDark ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50'}`} onClick={() => void updateStatus(program, 'completed')}><CheckCircle2 size={15} /> Concluir</button>}
          <button className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${isDark ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50'}`} onClick={() => void saveAsTemplate(program)}><Copy size={15} /> Duplicar como modelo</button>
        </div>}

        <div className={`mt-4 rounded-xl border px-3 py-3 ${isDark ? 'border-slate-700 bg-slate-800/40' : 'border-slate-100 bg-slate-50/70'}`}>
          <p className={`text-xs ${muted}`}>Alvo atual</p>
          <p className={`mt-1 text-sm ${text}`}>{currentTarget?.name || currentTarget?.target_name || 'Nenhum alvo ativo selecionado'}</p>
          {currentTarget?.normalizedStatus && <p className={`mt-1 text-xs ${muted}`}>{currentTarget.normalizedStatus === 'maintenance' ? 'Em manutenção' : 'Em ensino'}</p>}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
          <div><p className={muted}>Objetivo</p><p className={`mt-1 line-clamp-2 leading-relaxed ${text}`}>{program.objective || 'Objetivo não informado.'}</p></div>
          <div><p className={muted}>Critério</p><p className={`mt-1 line-clamp-2 leading-relaxed ${text}`}>{criterionLabel}</p></div>
          <div><p className={muted}>Alvos</p><p className={`mt-1 ${text}`}>{targetCount ? `${mastered} dominados · ${teachingTargets} em ensino${waitingTargets ? ` · ${waitingTargets} aguardando` : ''}${pausedTargets ? ` · ${pausedTargets} pausados` : ''}` : 'Nenhum alvo cadastrado'}</p></div>
          <div><p className={muted}>Responsável</p><p className={`mt-1 line-clamp-2 ${text}`}>{responsibleLabel}</p></div>
        </div>

        <div className={`mt-4 border-t pt-4 ${isDark ? 'border-slate-700' : 'border-slate-100'}`}>
          {hasRecordedApplications ? <>
            <div className={`mb-2 flex justify-between text-xs ${muted}`}><span>{mastered} de {targetCount} alvos dominados</span><span>{progress}%</span></div>
            <div className={`h-2 overflow-hidden rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} /></div>
          </> : <p className={`text-xs ${muted}`}>Nenhuma aplicação registrada.</p>}
          <div className={`mt-3 flex flex-wrap items-center justify-between gap-3 text-xs ${muted}`}>
            <span>Última aplicação: {hasRecordedApplications ? formatTherapeuticPlanDate(program.lastAppliedAt) : 'Não registrada'}</span>
            <span>Revisão: {formatTherapeuticPlanDate(program.review_due_date || program.reviewDueDate)}</span>
            <button type="button" className="min-h-[36px] text-sm text-violet-500 hover:text-violet-400" onClick={() => { setSelectedProgramId(String(program.id)); setDetailTab('overview'); }}>Abrir programa</button>
          </div>
        </div>
        {actionProgramId === String(program.id) && <div className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-slate-950/25 backdrop-blur-[1px]"><Loader2 size={22} className="animate-spin text-white" /></div>}
      </article>
    );
  };

  return (
    <section className="space-y-5" data-testid="therapeutic-plan-panel">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div><h2 className={`text-lg font-medium ${text}`}>Plano terapêutico</h2><p className={`mt-1 text-sm leading-relaxed ${muted}`}>Objetivos gerais, programas individualizados e alvos usados nas sessões.</p></div>
        <div className="flex flex-wrap gap-2">{typeof onStartSession === 'function' && programs.some((program: any) => ['teaching', 'maintenance'].includes(normalizeTherapeuticProgramStatus(program.status))) && <button type="button" className={secondaryButton} onClick={onStartSession}><Play size={16} /> Iniciar sessão</button>}{canCreate && <button ref={addProgramButtonRef} type="button" className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm text-white hover:bg-violet-700" onClick={startCreation}><Plus size={17} /> Adicionar programa</button>}</div>
      </div>

      {notice && <div className={`flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${isDark ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}><span>{notice}</span><button type="button" onClick={() => setNotice('')}><X size={15} /></button></div>}
      {error && <div className={`rounded-2xl border px-4 py-3 text-sm ${isDark ? 'border-rose-400/25 bg-rose-500/10 text-rose-100' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{error}<button type="button" className="ml-2 underline" onClick={() => void loadPlan(true)}>Tentar novamente</button></div>}

      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3 text-sm ${subpanel}`} data-therapeutic-plan-summary>
        <span className={text}>{summary.teaching} em ensino</span><span className={muted}>·</span>
        <span className={text}>{summary.maintenance} em manutenção</span><span className={muted}>·</span>
        <span className={text}>{summary.masteredTargets} alvos dominados</span>
        {summary.nextReview && <><span className={muted}>·</span><span className={muted}>revisão em {formatTherapeuticPlanDate(summary.nextReview)}</span></>}
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl p-1">{[['all', 'Todos'], ['teaching', 'Em ensino'], ['maintenance', 'Manutenção'], ['paused', 'Pausados'], ['completed', 'Concluídos']].map(([value, label]) => <button key={value} type="button" className={`shrink-0 rounded-lg px-3 py-2 text-xs transition-colors ${filter === value ? 'bg-violet-600 text-white' : isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => setFilter(value)}>{label}</button>)}</div>
        <label className="relative w-full md:max-w-xs"><Search size={15} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${muted}`} /><input className={`${field} pl-10`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar programa ou alvo" /></label>
      </div>

      {loading ? <div className={`flex items-center justify-center gap-2 rounded-2xl border border-dashed py-12 text-sm ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}><Loader2 size={18} className="animate-spin" /> Carregando Plano terapêutico...</div> : visiblePrograms.length ? <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{visiblePrograms.map(renderProgramCard)}</div> : <div className={`rounded-2xl border border-dashed py-12 text-center ${isDark ? 'border-slate-700' : 'border-slate-200'}`}><Target size={30} className={`mx-auto ${isDark ? 'text-slate-600' : 'text-slate-300'}`} /><p className={`mt-3 text-sm ${muted}`}>{query || filter !== 'all' ? 'Nenhum programa encontrado com estes filtros.' : 'Ainda não há programas individualizados neste plano.'}</p>{canCreate && !query && filter === 'all' && <button type="button" className="mt-4 text-sm text-violet-500" onClick={startCreation}>Adicionar o primeiro programa</button>}</div>}

      <ResponsiveDrawer
        open={Boolean(creationStep)}
        title={creationTitle}
        titleId="therapeutic-program-drawer-title"
        description="Adicione um programa de ensino ao Plano terapêutico."
        progress={creationProgress}
        onRequestClose={requestCloseCreation}
        returnFocusRef={addProgramButtonRef}
        scrollContainerRef={drawerScrollRef}
        isDark={isDark}
        headerLeading={creationStep && creationStep !== 'source' && !(editingProgramId && creationStep === 'form') ? <button type="button" className={`rounded-xl p-2 ${isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-100'}`} onClick={goBackCreation} aria-label="Voltar à etapa anterior"><ChevronLeft size={18} /></button> : null}
        footer={renderCreationFooter()}
      >
        {formError && <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${isDark ? 'border-rose-400/25 bg-rose-500/10 text-rose-100' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{formError}</div>}
        {renderCreationBody()}
      </ResponsiveDrawer>

      {selectedProgram && <div className="fixed inset-0 z-[115] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4"><div className={`flex max-h-[94vh] w-full max-w-5xl flex-col rounded-t-3xl border shadow-2xl sm:rounded-3xl ${panel}`} role="dialog" aria-modal="true"><header className={`flex items-start justify-between gap-3 border-b px-5 py-4 sm:px-6 ${isDark ? 'border-slate-700' : 'border-slate-100'}`}><div><div className="flex flex-wrap items-center gap-2"><h3 className={`text-xl font-medium ${text}`}>{selectedProgram.name}</h3><span className={`rounded-full border px-2.5 py-1 text-[10px] ${statusClass(selectedProgram.status)}`}>{THERAPEUTIC_PROGRAM_STATUS_LABELS[normalizeTherapeuticProgramStatus(selectedProgram.status)]}</span></div><p className={`mt-1 text-xs ${muted}`}>Origem: {SOURCE_LABELS[String(selectedProgram.origin_type || 'manual')] || 'Programa individual'} · Versão {selectedProgram.version || 1}</p></div><button type="button" className={`rounded-xl p-2 ${isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-100'}`} onClick={() => setSelectedProgramId('')}><X size={19} /></button></header><nav className={`flex gap-1 overflow-x-auto border-b px-5 py-2 sm:px-6 ${isDark ? 'border-slate-700' : 'border-slate-100'}`}>{[['overview', 'Visão geral'], ['targets', 'Alvos'], ['procedure', 'Procedimento'], ['progress', 'Progresso'], ['history', 'Histórico']].map(([value, label]) => <button key={value} type="button" className={`shrink-0 rounded-lg px-3 py-2 text-sm ${detailTab === value ? 'bg-violet-600 text-white' : isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => setDetailTab(value)}>{label}</button>)}</nav><div className="overflow-y-auto p-5 sm:p-6">{detailTab === 'overview' && <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><div className={`rounded-2xl border p-5 md:col-span-2 ${subpanel}`}><p className={`text-xs ${muted}`}>Objetivo</p><p className={`mt-2 leading-relaxed ${text}`}>{selectedProgram.objective || 'Não informado.'}</p></div><div className={`rounded-2xl border p-4 ${subpanel}`}><p className={`text-xs ${muted}`}>Critério de domínio</p><p className={`mt-1 text-sm ${text}`}>{masteryCriterionLabel(selectedProgram.mastery_criteria)}</p></div><div className={`rounded-2xl border p-4 ${subpanel}`}><p className={`text-xs ${muted}`}>Próxima revisão</p><p className={`mt-1 text-sm ${text}`}>{formatTherapeuticPlanDate(selectedProgram.review_due_date)}</p></div><div className={`rounded-2xl border p-4 ${subpanel}`}><p className={`text-xs ${muted}`}>Responsáveis</p><p className={`mt-1 text-sm ${text}`}>{Array.isArray(selectedProgram.responsible_professional_ids) && selectedProgram.responsible_professional_ids.length ? `${selectedProgram.responsible_professional_ids.length} profissional(is)` : 'Equipe clínica'}</p></div><div className={`rounded-2xl border p-4 ${subpanel}`}><p className={`text-xs ${muted}`}>Última aplicação</p><p className={`mt-1 text-sm ${text}`}>{formatTherapeuticPlanDate(selectedProgram.lastAppliedAt)}</p></div>{canManageStructure && !['completed', 'archived'].includes(normalizeTherapeuticProgramStatus(selectedProgram.status)) && <button type="button" className={secondaryButton} onClick={() => editProgram(selectedProgram)}><Pencil size={16} /> Editar programa</button>}</div>}{detailTab === 'targets' && <div className="space-y-3">{(selectedProgram.targets || []).map((target: any, index: number) => <div key={target.id || `${target.name}-${index}`} className={`flex items-center justify-between gap-3 rounded-2xl border p-4 ${subpanel}`}><div><p className={`font-medium ${text}`}>{target.name}</p><p className={`mt-1 text-xs ${muted}`}>{target.normalizedStatus === 'mastered' ? 'Dominado' : target.normalizedStatus === 'maintenance' ? 'Em manutenção' : target.normalizedStatus === 'paused' ? 'Pausado' : target.normalizedStatus === 'teaching' ? 'Em ensino' : 'Não iniciado'}</p></div><span className={`rounded-full px-2.5 py-1 text-xs ${target.normalizedStatus === 'mastered' ? isDark ? 'bg-emerald-500/15 text-emerald-200' : 'bg-emerald-50 text-emerald-700' : isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>{index + 1}</span></div>)}{canManageStructure && !['completed', 'archived'].includes(normalizeTherapeuticProgramStatus(selectedProgram.status)) && <div className={`flex flex-col gap-2 rounded-2xl border p-4 sm:flex-row ${subpanel}`}><input className={field} value={newTargetName} maxLength={240} onChange={(event) => setNewTargetName(event.target.value)} placeholder="Nome do novo alvo" /><button type="button" className="shrink-0 rounded-xl bg-violet-600 px-4 py-2.5 text-sm text-white disabled:opacity-50" disabled={!newTargetName.trim() || actionProgramId === String(selectedProgram.id)} onClick={() => void addTargetToProgram()}>{actionProgramId === String(selectedProgram.id) ? 'Adicionando...' : 'Adicionar alvo'}</button></div>}</div>}{detailTab === 'procedure' && <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{[['Instrução / antecedente', 'antecedent'], ['Resposta esperada', 'expectedResponse'], ['Materiais', 'materials'], ['Hierarquia de ajuda', 'promptHierarchy'], ['Reforçamento', 'reinforcement'], ['Correção de erro', 'errorCorrection'], ['Generalização', 'generalization'], ['Manutenção', 'maintenance']].map(([label, key]) => <div key={key} className={`rounded-2xl border p-4 ${subpanel}`}><p className={`text-xs ${muted}`}>{label}</p><p className={`mt-2 whitespace-pre-wrap text-sm leading-relaxed ${text}`}>{selectedProgram?.advanced_settings?.[key] || 'Não informado.'}</p></div>)}</div>}{detailTab === 'progress' && <div className="space-y-4"><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[['Alvos', selectedProgram.targets.length], ['Dominados', selectedProgram.masteredTargetCount], ['Em ensino', selectedProgram.targets.filter((target: any) => target.normalizedStatus === 'teaching').length], ['Aplicações recentes', selectedProgram.lastAppliedAt ? 1 : 0]].map(([label, value]) => <div key={String(label)} className={`rounded-2xl border p-4 ${subpanel}`}><p className={`text-xs ${muted}`}>{label}</p><p className={`mt-1 text-xl font-medium ${text}`}>{value}</p></div>)}</div><div className={`rounded-2xl border p-5 ${subpanel}`}><p className={`text-sm ${text}`}>Progresso por alvo</p><div className="mt-4 space-y-3">{selectedProgram.targets.map((target: any) => <div key={target.id}><div className={`mb-1 flex justify-between text-xs ${muted}`}><span>{target.name}</span><span>{target.normalizedStatus === 'mastered' ? '100%' : target.normalizedStatus === 'maintenance' ? '90%' : 'Em coleta'}</span></div><div className={`h-2 rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}><div className="h-full rounded-full bg-emerald-500" style={{ width: target.normalizedStatus === 'mastered' ? '100%' : target.normalizedStatus === 'maintenance' ? '90%' : '15%' }} /></div></div>)}</div></div></div>}{detailTab === 'history' && <div className="space-y-3">{(selectedProgram.history || []).map((event: any) => <div key={event.id} className={`flex gap-3 rounded-2xl border p-4 ${subpanel}`}><div className={`mt-0.5 rounded-lg p-2 ${isDark ? 'bg-slate-800 text-violet-300' : 'bg-violet-50 text-violet-600'}`}><History size={15} /></div><div><p className={`text-sm ${text}`}>{String(event.event_type || 'UPDATED').replaceAll('_', ' ').toLocaleLowerCase('pt-BR')}</p><p className={`mt-1 text-xs ${muted}`}>{formatTherapeuticPlanDate(event.created_at)}</p></div></div>)}{!(selectedProgram.history || []).length && <p className={`rounded-2xl border border-dashed p-8 text-center text-sm ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Nenhuma alteração registrada.</p>}</div>}</div></div></div>}
    </section>
  );
};
