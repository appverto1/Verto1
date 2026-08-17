import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Pencil, RotateCcw, Plus, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import {
  AnamnesisProfileType,
  AnamnesisQuestion,
  AnamnesisQuestionType,
  AnamnesisTemplate,
  buildQuestionLabelMap,
  getDefaultAnamnesisTemplate,
  getProfileTemplate,
  normalizeAnamnesisTemplate
} from '../lib/anamnesisSchema';
import { dataService } from '../services/dataService';

type ModalMode = 'create' | 'edit';

type ModalView = 'fill' | 'template';

interface AnamnesisModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: any;
  onSave: (payload: any) => void;
  mode?: ModalMode;
  template?: any;
  savedTemplates?: any[];
  onTemplateSave?: (template: AnamnesisTemplate) => Promise<any> | any;
  onTemplateSelect?: (template: any) => void;
  onTemplateDelete?: (templateId: string) => Promise<any> | any;
  canEditTemplate?: boolean;
  loadLatestTemplate?: boolean;
  templateManagerLabel?: string;
  maxSavedTemplates?: number;
}

interface QuestionDraft {
  id: string;
  label: string;
  type: AnamnesisQuestionType;
  optionsText: string;
  required: boolean;
}

interface QuestionEditorDraft {
  editingQuestionId: string;
  draftQuestion: QuestionDraft;
}

const QUESTION_TYPE_LABEL: Record<AnamnesisQuestionType, string> = {
  dissertativa: 'Dissertativa',
  multipla_escolha: 'Multipla escolha',
  multipla_selecao: 'Multipla selecao',
  data: 'Data',
  numero: 'Numero',
  telefone: 'Telefone',
  sim_nao: 'Sim/Não'
};

const toBoolean = (value: any): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['sim', 'true', '1', 'yes'].includes(value.trim().toLowerCase());
  return Boolean(value);
};

const normalizeOptions = (text: string): string[] =>
  text
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean)
    .slice(0, 30);

const getFieldValue = (value: any, questionType: AnamnesisQuestionType): any => {
  if (questionType === 'sim_nao') {
    if (value === '' || value === null || value === undefined) return '';
    return toBoolean(value);
  }

  if (questionType === 'multipla_selecao') {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
    return [];
  }

  return value ?? '';
};

const serializeQuestionValue = (value: any, questionType: AnamnesisQuestionType) => {
  if (questionType === 'sim_nao') {
    if (value === '') return false;
    return Boolean(value);
  }
  if (questionType === 'multipla_selecao') {
    return Array.isArray(value) ? value : [];
  }
  return value ?? '';
};

const generateQuestionId = () => `q_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`;

const createBlankAnamnesisTemplate = (): AnamnesisTemplate => ({
  version: 1,
  profiles: {
    adult: {
      sections: [{ id: 'personalizadas', title: 'Perguntas da ficha', order: 1, active: true }],
      questions: []
    },
    child: {
      sections: [{ id: 'personalizadas', title: 'Perguntas da ficha', order: 1, active: true }],
      questions: []
    }
  }
});

const monthsToYearsInput = (value: any): string => {
  const months = Number(value);
  if (!Number.isFinite(months) || months < 0) return '';
  return String(Math.floor(months / 12));
};

const yearsInputToMonths = (value: string, endOfYear = false): number | null => {
  const parsed = Number(String(value || '').replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const years = Math.floor(parsed);
  return endOfYear ? years * 12 + 11 : years * 12;
};

function QuestionField({
  question,
  value,
  onChange
}: {
  question: AnamnesisQuestion;
  value: any;
  onChange: (value: any) => void;
}) {
  const commonClassName = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#7a32fc]/20';

  if (question.type === 'dissertativa') {
    return (
      <textarea
        rows={2}
        className={`${commonClassName} resize-none`}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (question.type === 'data') {
    return (
      <input
        type="date"
        className={commonClassName}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (question.type === 'numero') {
    return (
      <input
        type="number"
        className={commonClassName}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (question.type === 'telefone') {
    return (
      <input
        type="tel"
        className={commonClassName}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (question.type === 'sim_nao') {
    return (
      <select
        className={commonClassName}
        value={value === '' ? '' : value ? 'sim' : 'nao'}
        onChange={(event) => {
          if (!event.target.value) {
            onChange('');
          } else {
            onChange(event.target.value === 'sim');
          }
        }}
      >
        <option value="">Selecione...</option>
        <option value="sim">Sim</option>
        <option value="nao">Não</option>
      </select>
    );
  }

  if (question.type === 'multipla_escolha') {
    return (
      <select
        className={commonClassName}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Selecione...</option>
        {(question.options || []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="space-y-2">
      {(question.options || []).map((option) => {
        const checked = Array.isArray(value) ? value.includes(option) : false;
        return (
          <label key={option} className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => {
                const current = Array.isArray(value) ? value : [];
                if (event.target.checked) {
                  onChange([...current, option]);
                } else {
                  onChange(current.filter((item) => item !== option));
                }
              }}
            />
            {option}
          </label>
        );
      })}
    </div>
  );
}

export const AnamnesisModal = ({
  isOpen,
  onClose,
  initialData,
  onSave,
  mode = 'create',
  template,
  savedTemplates = [],
  onTemplateSave,
  onTemplateSelect,
  onTemplateDelete,
  canEditTemplate = false,
  loadLatestTemplate = true,
  templateManagerLabel = 'Ficha personalizada',
  maxSavedTemplates = 5
}: AnamnesisModalProps) => {
  const [profileType, setProfileType] = useState<AnamnesisProfileType>('adult');
  const [view, setView] = useState<ModalView>('fill');
  const [templateState, setTemplateState] = useState<AnamnesisTemplate>(getDefaultAnamnesisTemplate());
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [questionEditors, setQuestionEditors] = useState<Record<string, QuestionEditorDraft>>({});
  const [templateDirty, setTemplateDirty] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [templateName, setTemplateName] = useState('Ficha personalizada');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateAgeMinYears, setTemplateAgeMinYears] = useState('');
  const [templateAgeMaxYears, setTemplateAgeMaxYears] = useState('');
  const [templatePatientProfileType, setTemplatePatientProfileType] = useState('');
  const [templateEditorIdentity, setTemplateEditorIdentity] = useState(() =>
    String((template as any)?.selectedTemplateId || (template as any)?.id || 'new')
  );
  const templateDirtyRef = useRef(false);
  const questionEditorsRef = useRef<Record<string, QuestionEditorDraft>>({});
  const wasOpenRef = useRef(false);

  const [scheduleImmediate, setScheduleImmediate] = useState(false);
  const [registerDate, setRegisterDate] = useState('');
  const [registerTime, setRegisterTime] = useState('');
  const [consultationApproach, setConsultationApproach] = useState('');
  const [consultationRoom, setConsultationRoom] = useState('');
  const [consultationProfessional, setConsultationProfessional] = useState('');
  const templateScopeKey = String((template as any)?.templateScope || (template as any)?.scope || 'clinic').toLowerCase();
  const templateDraftStorageKey = `verto_anamnesis_template_draft_${templateScopeKey}_${templateEditorIdentity}`;

  const markTemplateDirty = (dirty: boolean) => {
    templateDirtyRef.current = dirty;
    setTemplateDirty(dirty);
  };

  const applyTemplateToEditor = (source: any, markClean = true) => {
    const normalized = normalizeAnamnesisTemplate(source || getDefaultAnamnesisTemplate());
    const selectedTemplateId = String(source?.selectedTemplateId || source?.id || '').trim() || null;
    setTemplateState({
      ...normalized,
      selectedTemplateId,
      templateScope: source?.templateScope || source?.scope || templateScopeKey,
      scope: source?.templateScope || source?.scope || templateScopeKey
    } as any);
    setTemplateName(String(source?.templateName || source?.name || 'Ficha personalizada').slice(0, 80));
    setTemplateDescription(String(source?.templateDescription || source?.description || '').slice(0, 240));
    setTemplateAgeMinYears(monthsToYearsInput(source?.ageMinMonths ?? source?.age_min_months));
    setTemplateAgeMaxYears(monthsToYearsInput(source?.ageMaxMonths ?? source?.age_max_months));
    setTemplatePatientProfileType(String(source?.patientProfileType || source?.patient_profile_type || '').toUpperCase());
    setTemplateEditorIdentity(selectedTemplateId || 'new');
    if (markClean) markTemplateDirty(false);
  };

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }

    const firstOpen = !wasOpenRef.current;
    // A refresh/refetch do pai não pode arrancar uma ficha que o profissional está
    // editando. Troca de ficha ocorre apenas por ação explícita dentro do modal.
    if (!firstOpen && (templateDirtyRef.current || Object.keys(questionEditorsRef.current).length > 0)) return;
    wasOpenRef.current = true;

    const sourceTemplate = template || getDefaultAnamnesisTemplate();
    applyTemplateToEditor(sourceTemplate, true);

    const inferredProfile: AnamnesisProfileType =
      initialData?.formType === 'child' || (typeof initialData?.idade === 'number' && initialData.idade <= 12) ? 'child' : 'adult';
    setProfileType(inferredProfile);

    const nextView: ModalView = canEditTemplate && (initialData?.manageTemplate === true || initialData?.nome === 'Template da Clínica' || initialData?.nome === 'Template Profissional') ? 'template' : 'fill';
    setView(nextView);

    const normalizedSource = normalizeAnamnesisTemplate(sourceTemplate);
    const profileTemplate = getProfileTemplate(normalizedSource, inferredProfile);
    const initialValues: Record<string, any> = { ...(initialData || {}) };
    profileTemplate.questions.forEach((question) => {
      initialValues[question.id] = getFieldValue(initialValues[question.id], question.type);
    });

    setFormData(initialValues);
    setExpandedSections(
      profileTemplate.sections.reduce((acc, section) => {
        acc[section.id] = true;
        return acc;
      }, {} as Record<string, boolean>)
    );
    setQuestionEditors({});
    setScheduleImmediate(Boolean(initialData?.scheduleImmediate));
    setRegisterDate(initialData?.date || '');
    setRegisterTime(initialData?.time || '');
    setConsultationApproach(initialData?.approach || '');
    setConsultationRoom(initialData?.room || '');
    setConsultationProfessional(initialData?.professional || '');
  }, [isOpen, template, canEditTemplate]);

  useEffect(() => {
    questionEditorsRef.current = questionEditors;
  }, [questionEditors]);

  useEffect(() => {
    if (!isOpen || !canEditTemplate || view !== 'template' || templateDirtyRef.current) return;
    try {
      const raw = localStorage.getItem(templateDraftStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const draftTemplate = parsed?.template;
      if (!draftTemplate || typeof draftTemplate !== 'object') return;
      const shouldRestore = confirm('Existe um rascunho não salvo desta ficha de anamnese. Deseja restaurar?');
      if (shouldRestore) {
        setTemplateState(draftTemplate as AnamnesisTemplate);
        setTemplateName(String(parsed?.templateName || 'Ficha personalizada').slice(0, 80));
        setTemplateDescription(String(parsed?.templateDescription || '').slice(0, 240));
        setTemplateAgeMinYears(String(parsed?.templateAgeMinYears || ''));
        setTemplateAgeMaxYears(String(parsed?.templateAgeMaxYears || ''));
        setTemplatePatientProfileType(String(parsed?.templatePatientProfileType || ''));
        if (parsed?.questionEditors && typeof parsed.questionEditors === 'object') {
          setQuestionEditors(parsed.questionEditors as Record<string, QuestionEditorDraft>);
        } else if (parsed?.draftQuestion && typeof parsed.draftQuestion === 'object') {
          // Compatibilidade com rascunhos criados antes do editor por seção.
          const legacySectionId = String(parsed?.editorSectionId || '').trim();
          if (legacySectionId) {
            setQuestionEditors({
              [legacySectionId]: {
                editingQuestionId: String(parsed?.editingQuestionId || parsed.draftQuestion.id || 'new'),
                draftQuestion: parsed.draftQuestion as QuestionDraft
              }
            });
          }
        }
        markTemplateDirty(true);
      } else {
        localStorage.removeItem(templateDraftStorageKey);
      }
    } catch {
      // noop
    }
  }, [isOpen, canEditTemplate, view, templateDraftStorageKey]);

  useEffect(() => {
    if (!isOpen || !canEditTemplate || view !== 'template' || (!templateDirty && Object.keys(questionEditors).length === 0)) return;
    try {
      localStorage.setItem(
        templateDraftStorageKey,
        JSON.stringify({
          updatedAt: new Date().toISOString(),
          template: templateState,
          templateName,
          templateDescription,
          templateAgeMinYears,
          templateAgeMaxYears,
          templatePatientProfileType,
          selectedTemplateId: (templateState as any)?.selectedTemplateId || null,
          questionEditors
        })
      );
    } catch {
      // noop
    }
  }, [templateState, templateName, templateDescription, templateAgeMinYears, templateAgeMaxYears, templatePatientProfileType, templateDirty, questionEditors, isOpen, canEditTemplate, view, templateDraftStorageKey]);

  useEffect(() => {
    if (!isOpen || !loadLatestTemplate || templateDirtyRef.current || Object.keys(questionEditorsRef.current).length > 0) return;
    let isActive = true;
    const loadLatest = async () => {
      try {
        const result = await dataService.getClinicAnamnesisTemplate();
        if (!isActive || !result?.success || !result?.data || templateDirtyRef.current || Object.keys(questionEditorsRef.current).length > 0) return;
        const latest = normalizeAnamnesisTemplate(result.data);
        setTemplateState((prev) => ({
          ...latest,
          selectedTemplateId: (prev as any)?.selectedTemplateId || null,
          templateScope: (prev as any)?.templateScope || templateScopeKey,
          scope: (prev as any)?.scope || templateScopeKey
        } as any));
      } catch {
        // usa template atual como fallback silencioso
      }
    };
    void loadLatest();
    return () => {
      isActive = false;
    };
  }, [isOpen, loadLatestTemplate, templateScopeKey]);

  useEffect(() => {
    if (!isOpen) return;
    const currentProfile = getProfileTemplate(templateState, profileType);
    setExpandedSections((prev) => {
      const next = { ...prev };
      currentProfile.sections.forEach((section) => {
        if (typeof next[section.id] !== 'boolean') next[section.id] = true;
      });
      return next;
    });
    setFormData((prev) => {
      const next = { ...prev };
      currentProfile.questions.forEach((question) => {
        next[question.id] = getFieldValue(next[question.id], question.type);
      });
      return next;
    });
  }, [templateState, profileType, isOpen]);

  const profileTemplate = useMemo(() => getProfileTemplate(templateState, profileType), [templateState, profileType]);
  const questionsBySection = useMemo(() => {
    const map = new Map<string, AnamnesisQuestion[]>();
    profileTemplate.sections
      .filter((section) => section.active)
      .forEach((section) => {
        map.set(
          section.id,
          profileTemplate.questions
            .filter((question) => question.sectionId === section.id && question.active)
            .sort((a, b) => a.order - b.order)
        );
      });
    return map;
  }, [profileTemplate]);

  const questionLabelMap = useMemo(() => buildQuestionLabelMap(templateState), [templateState]);

  if (!isOpen) return null;

  const showFeedback = (type: 'success' | 'error' | 'info', message: string) => {
    setFeedback({ type, message });
    window.setTimeout(() => setFeedback(null), 3200);
  };

  const setQuestionValue = (question: AnamnesisQuestion, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [question.id]: value
    }));
  };

  const handleSubmitForm = () => {
    const profileQuestions = profileTemplate.questions.filter((question) => question.active);
    for (const question of profileQuestions) {
      if (!question.required) continue;
      const value = formData[question.id];
      if (question.type === 'multipla_selecao' && (!Array.isArray(value) || value.length === 0)) {
        showFeedback('error', `Preencha o campo obrigatório: ${question.label}`);
        return;
      }
      if ((question.type === 'sim_nao' && value === '') || (question.type !== 'sim_nao' && String(value ?? '').trim() === '')) {
        showFeedback('error', `Preencha o campo obrigatório: ${question.label}`);
        return;
      }
    }

    const serializedAnswers: Record<string, any> = {};
    profileQuestions.forEach((question) => {
      serializedAnswers[question.id] = serializeQuestionValue(formData[question.id], question.type);
    });

    const payload: Record<string, any> = {
      ...serializedAnswers,
      formType: profileType,
      template_version: templateState.version,
      template_snapshot: {
        profileType,
        sections: profileTemplate.sections,
        questions: profileTemplate.questions
      },
      anamnesisTemplateVersion: {
        version: templateState.version,
        profileType
      },
      questionLabels: questionLabelMap
    };

    if (mode === 'create' && scheduleImmediate) {
      payload.scheduleImmediate = true;
      payload.date = registerDate;
      payload.time = registerTime;
      payload.approach = consultationApproach;
      payload.room = consultationRoom;
      payload.professional = consultationProfessional;
    }

    onSave(payload);
  };

  const updateTemplateProfile = (updater: (profile: typeof profileTemplate) => typeof profileTemplate) => {
    markTemplateDirty(true);
    setTemplateState((prev) => {
      // Não normalizar a cada tecla: normalização substitui string vazia por fallback
      // e tornava impossível apagar completamente o título de uma seção.
      const copy = JSON.parse(JSON.stringify(prev)) as AnamnesisTemplate;
      copy.profiles[profileType] = updater(copy.profiles[profileType]);
      return copy;
    });
  };

  const handleSectionTitleChange = (sectionId: string, title: string) => {
    updateTemplateProfile((profile) => ({
      ...profile,
      sections: profile.sections.map((section) =>
        section.id === sectionId ? { ...section, title } : section
      )
    }));
  };

  const toggleSection = (sectionId: string) => {
    updateTemplateProfile((profile) => ({
      ...profile,
      sections: profile.sections.map((section) =>
        section.id === sectionId ? { ...section, active: !section.active } : section
      )
    }));
  };

  const addTemplateSection = () => {
    const nextOrder = Math.max(0, ...profileTemplate.sections.map((section) => Number(section.order) || 0)) + 1;
    const sectionId = `sec_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`;
    updateTemplateProfile((profile) => ({
      ...profile,
      sections: [
        ...profile.sections,
        {
          id: sectionId,
          title: `Nova seção ${nextOrder}`,
          order: nextOrder,
          active: true
        }
      ]
    }));
    setExpandedSections((prev) => ({ ...prev, [sectionId]: true }));
  };

  const toggleQuestion = (questionId: string) => {
    updateTemplateProfile((profile) => ({
      ...profile,
      questions: profile.questions.map((question) =>
        question.id === questionId ? { ...question, active: !question.active } : question
      )
    }));
  };

  const focusQuestionEditor = (sectionId: string) => {
    if (typeof document === 'undefined') return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById(`anamnesis-question-editor-${sectionId}`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        });
      });
    });
  };

  const startQuestionEdit = (question: AnamnesisQuestion) => {
    const existingEditor = questionEditors[question.sectionId];
    if (existingEditor && existingEditor.editingQuestionId !== question.id) {
      showFeedback('info', 'Confirme ou cancele a pergunta que já está em edição nesta seção antes de abrir outra.');
      setExpandedSections((prev) => ({ ...prev, [question.sectionId]: true }));
      focusQuestionEditor(question.sectionId);
      return;
    }

    setQuestionEditors((prev) => ({
      ...prev,
      [question.sectionId]: {
        editingQuestionId: question.id,
        draftQuestion: {
          id: question.id,
          label: question.label,
          type: question.type,
          optionsText: (question.options || []).join(', '),
          required: question.required
        }
      }
    }));
    setExpandedSections((prev) => ({ ...prev, [question.sectionId]: true }));
    focusQuestionEditor(question.sectionId);
  };

  const updateQuestionDraft = (sectionId: string, updater: (draft: QuestionDraft) => QuestionDraft) => {
    setQuestionEditors((prev) => {
      const editor = prev[sectionId];
      if (!editor) return prev;
      return {
        ...prev,
        [sectionId]: {
          ...editor,
          draftQuestion: updater(editor.draftQuestion)
        }
      };
    });
  };

  const cancelQuestionEdit = (sectionId: string) => {
    setQuestionEditors((prev) => {
      if (!prev[sectionId]) return prev;
      const next = { ...prev };
      delete next[sectionId];
      return next;
    });
  };

  const saveQuestionEdit = (sectionId: string) => {
    const editor = questionEditors[sectionId];
    if (!editor) return;
    const { draftQuestion } = editor;
    const targetSectionId = String(sectionId || '').trim();
    const isChoiceType = draftQuestion.type === 'multipla_escolha' || draftQuestion.type === 'multipla_selecao';
    const options = isChoiceType ? normalizeOptions(draftQuestion.optionsText) : [];

    if (!draftQuestion.label.trim()) {
      showFeedback('error', 'Informe o texto da pergunta.');
      return;
    }
    if (isChoiceType && options.length === 0) {
      showFeedback('error', 'Perguntas de múltipla escolha precisam de opções.');
      return;
    }

    updateTemplateProfile((profile) => {
      const exists = profile.questions.some((question) => question.id === draftQuestion.id);
      if (!exists && !profile.sections.some((section) => section.id === targetSectionId)) {
        return profile;
      }
      if (exists) {
        return {
          ...profile,
          questions: profile.questions.map((question) =>
            question.id === draftQuestion.id
              ? {
                  ...question,
                  label: draftQuestion.label.trim(),
                  type: draftQuestion.type,
                  options: options.length ? options : undefined,
                  required: draftQuestion.required
                }
              : question
          )
        };
      }

      const nextOrder = Math.max(0, ...profile.questions.filter((question) => question.sectionId === targetSectionId).map((question) => question.order)) + 1;
      return {
        ...profile,
        // Adição é estritamente aditiva: nenhuma pergunta de outra seção é filtrada,
        // substituída ou reconstruída quando uma nova pergunta é confirmada.
        questions: [
          ...profile.questions,
          {
            id: draftQuestion.id,
            sectionId: targetSectionId,
            label: draftQuestion.label.trim(),
            type: draftQuestion.type,
            options: options.length ? options : undefined,
            required: draftQuestion.required,
            active: true,
            order: nextOrder
          }
        ]
      };
    });

    cancelQuestionEdit(sectionId);
  };

  const startAddQuestion = (sectionId: string) => {
    const existingEditor = questionEditors[sectionId];
    if (existingEditor) {
      showFeedback('info', 'Já existe uma pergunta em edição nesta seção. Confirme ou cancele antes de adicionar outra.');
      setExpandedSections((prev) => ({ ...prev, [sectionId]: true }));
      focusQuestionEditor(sectionId);
      return;
    }

    setQuestionEditors((prev) => ({
      ...prev,
      [sectionId]: {
        editingQuestionId: 'new',
        draftQuestion: {
          id: generateQuestionId(),
          label: '',
          type: 'dissertativa',
          optionsText: '',
          required: false
        }
      }
    }));
    setExpandedSections((prev) => ({ ...prev, [sectionId]: true }));
    focusQuestionEditor(sectionId);
  };

  const saveTemplate = async () => {
    if (!canEditTemplate || !onTemplateSave) return;
    if (Object.keys(questionEditors).length > 0) {
      showFeedback('info', 'Confirme ou cancele as perguntas em edição antes de salvar a ficha.');
      return;
    }
    const cleanName = templateName.trim();
    if (!cleanName) {
      showFeedback('error', 'Dê um nome para a ficha antes de salvar.');
      return;
    }
    const hasUntitledSection = (['adult', 'child'] as AnamnesisProfileType[]).some((profile) =>
      templateState.profiles[profile].sections.some((section) => !String(section.title || '').trim())
    );
    if (hasUntitledSection) {
      showFeedback('error', 'Dê um nome para todas as seções antes de salvar.');
      return;
    }
    setIsSavingTemplate(true);
    const draftKeyToClear = templateDraftStorageKey;
    try {
      const normalized = {
        ...normalizeAnamnesisTemplate(templateState),
        templateName: cleanName,
        templateDescription: templateDescription.trim(),
        ageMinMonths: yearsInputToMonths(templateAgeMinYears),
        ageMaxMonths: yearsInputToMonths(templateAgeMaxYears, true),
        patientProfileType: templatePatientProfileType || null,
        selectedTemplateId: (templateState as any)?.selectedTemplateId || null
      };
      const savedTemplate = await onTemplateSave(normalized);
      const nextTemplate = savedTemplate || normalized;
      applyTemplateToEditor({
        ...nextTemplate,
        selectedTemplateId: (nextTemplate as any)?.selectedTemplateId || (normalized as any).selectedTemplateId || null,
        templateName: (nextTemplate as any)?.templateName || cleanName,
        templateDescription: (nextTemplate as any)?.templateDescription || templateDescription.trim(),
        ageMinMonths: (nextTemplate as any)?.ageMinMonths ?? (normalized as any).ageMinMonths,
        ageMaxMonths: (nextTemplate as any)?.ageMaxMonths ?? (normalized as any).ageMaxMonths,
        patientProfileType: (nextTemplate as any)?.patientProfileType || templatePatientProfileType || null
      }, true);
      try {
        localStorage.removeItem(draftKeyToClear);
      } catch {
        // noop
      }
      showFeedback('success', 'Template de anamnese atualizado com sucesso.');
    } catch (error: any) {
      showFeedback('error', error?.message || 'Não foi possível salvar o template.');
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const startBlankTemplate = () => {
    if (savedTemplates.length >= maxSavedTemplates) {
      showFeedback('error', `Limite de ${maxSavedTemplates} fichas salvas atingido. Remova uma ficha para criar outra.`);
      return;
    }
    if (templateDirtyRef.current && !confirm('Há alterações não salvas na ficha atual. Deseja descartá-las e criar uma nova ficha?')) return;
    try {
      localStorage.removeItem(templateDraftStorageKey);
    } catch {
      // noop
    }
    const blank = {
      ...createBlankAnamnesisTemplate(),
      selectedTemplateId: null,
      templateScope: templateScopeKey,
      scope: templateScopeKey
    } as any;
    setTemplateState(blank);
    setTemplateEditorIdentity('new');
    setTemplateName(`${templateManagerLabel} ${Math.min(savedTemplates.length + 1, maxSavedTemplates)}`);
    setTemplateDescription('');
    setTemplateAgeMinYears('');
    setTemplateAgeMaxYears('');
    setTemplatePatientProfileType('');
    markTemplateDirty(true);
    setView('template');
    setExpandedSections({ personalizadas: true });
    showFeedback('info', 'Ficha em branco criada. Adicione seções/perguntas e salve para persistir.');
  };

  const resetTemplate = async () => {
    if (!canEditTemplate) return;
    try {
      const response = await fetch('/api/clinic/anamnesis-template/defaults', { credentials: 'include' });
      const result = await response.json();
      if (!result?.success || !result?.data) {
        throw new Error(result?.error || 'Falha ao buscar o template padrão.');
      }
      const selectedTemplateId = (templateState as any)?.selectedTemplateId || null;
      setTemplateState({
        ...normalizeAnamnesisTemplate(result.data),
        selectedTemplateId,
        templateScope: templateScopeKey,
        scope: templateScopeKey
      } as any);
      markTemplateDirty(true);
      showFeedback('info', 'Ficha original restaurada no editor. Clique em Salvar mudanças para persistir.');
    } catch (error: any) {
      showFeedback('error', error?.message || 'Não foi possível restaurar o template padrão.');
    }
  };

  const handleSavedTemplateSelect = (item: any) => {
    const nextId = String(item?.id || item?.selectedTemplateId || '').trim();
    const currentId = String((templateState as any)?.selectedTemplateId || '').trim();
    if (nextId && nextId === currentId) return;
    if (templateDirtyRef.current && !confirm('Há alterações não salvas na ficha atual. Deseja descartá-las e abrir outra ficha?')) return;
    try {
      localStorage.removeItem(templateDraftStorageKey);
    } catch {
      // noop
    }
    applyTemplateToEditor(item, true);
    const nextProfile = getProfileTemplate(normalizeAnamnesisTemplate(item), profileType);
    setExpandedSections(nextProfile.sections.reduce((acc, section) => {
      acc[section.id] = true;
      return acc;
    }, {} as Record<string, boolean>));
    setQuestionEditors({});
    onTemplateSelect?.(item);
  };

  const handleCloseModal = () => {
    if (canEditTemplate && view === 'template' && (templateDirty || Object.keys(questionEditors).length > 0)) {
      const shouldLeave = confirm('Existem mudanças não salvas na ficha de anamnese. Deseja sair sem salvar?');
      if (!shouldLeave) return;
    }
    onClose();
  };

  const modalContent = (
    <div className="fixed inset-0 z-[170] bg-black/45 backdrop-blur-sm p-3 sm:p-6 flex items-start justify-center overflow-y-auto">
      <div className="w-full max-w-6xl max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-3rem)] overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="sticky top-0 z-20 bg-white border-b border-slate-200 px-5 sm:px-8 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl sm:text-3xl font-bold text-slate-900">Ficha de Anamnese</h2>
            <p className="text-sm text-slate-500">Modelo editável por perfil com versionamento.</p>
          </div>
          <button onClick={handleCloseModal} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>

        <div className="px-5 sm:px-8 py-5 space-y-4">
          {feedback && (
            <div
              className={`rounded-xl border px-4 py-3 text-sm font-medium ${
                feedback.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : feedback.type === 'error'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-blue-200 bg-blue-50 text-blue-700'
              }`}
            >
              {feedback.message}
            </div>
          )}
          {canEditTemplate && view === 'template' && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Fichas salvas</p>
                  <p className="text-sm font-normal text-slate-600">Até {maxSavedTemplates} fichas ativas, com segmentação por idade e perfil.</p>
                </div>
                <button
                  type="button"
                  onClick={startBlankTemplate}
                  disabled={savedTemplates.length >= maxSavedTemplates}
                  className="rounded-xl bg-[#7a32fc] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Plus size={14} className="inline mr-2" />
                  Nova ficha do zero
                </button>
              </div>

              {savedTemplates.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {savedTemplates.map((item) => {
                    const itemId = String(item?.id || item?.selectedTemplateId || '');
                    const currentId = String((templateState as any)?.selectedTemplateId || '');
                    const isActive = itemId && itemId === currentId;
                    return (
                      <button
                        type="button"
                        key={itemId || item?.name}
                        onClick={() => handleSavedTemplateSelect(item)}
                        className={`min-w-[210px] rounded-xl border px-3 py-2 text-left text-sm transition-all ${
                          isActive ? 'border-[#7a32fc] bg-white text-[#7a32fc] shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-[#7a32fc]/40'
                        }`}
                      >
                        <span className="block truncate font-bold">{item?.name || item?.templateName || 'Ficha sem nome'}</span>
                        <span className="block text-[11px] font-semibold text-slate-400">
                          {item?.ageMinMonths != null || item?.ageMaxMonths != null
                            ? `${monthsToYearsInput(item?.ageMinMonths) || '0'}-${monthsToYearsInput(item?.ageMaxMonths) || '+18'} anos`
                            : 'Todas as idades'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1">Nome da ficha</label>
                  <input
                    value={templateName}
                    onChange={(event) => {
                      setTemplateName(event.target.value);
                      markTemplateDirty(true);
                    }}
                    maxLength={80}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#7a32fc]/20"
                    placeholder="Ex: Anamnese infantil 6-11"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1">Idade mín.</label>
                  <input
                    type="number"
                    min="0"
                    value={templateAgeMinYears}
                    onChange={(event) => {
                      setTemplateAgeMinYears(event.target.value);
                      markTemplateDirty(true);
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#7a32fc]/20"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1">Idade máx.</label>
                  <input
                    type="number"
                    min="0"
                    value={templateAgeMaxYears}
                    onChange={(event) => {
                      setTemplateAgeMaxYears(event.target.value);
                      markTemplateDirty(true);
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#7a32fc]/20"
                    placeholder="Sem limite"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1">Perfil</label>
                  <select
                    value={templatePatientProfileType}
                    onChange={(event) => {
                      setTemplatePatientProfileType(event.target.value);
                      markTemplateDirty(true);
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#7a32fc]/20"
                  >
                    <option value="">Todos</option>
                    <option value="KIDS_TEA">Infantil ABA</option>
                    <option value="TEEN">Adolescente</option>
                    <option value="ABA">Adulto ABA</option>
                    <option value="ADULT">Adulto</option>
                  </select>
                </div>
                <div className="md:col-span-5">
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1">Descrição interna</label>
                  <input
                    value={templateDescription}
                    onChange={(event) => {
                      setTemplateDescription(event.target.value);
                      markTemplateDirty(true);
                    }}
                    maxLength={240}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#7a32fc]/20"
                    placeholder="Opcional: quando usar esta ficha"
                  />
                </div>
              </div>

              {(templateState as any)?.selectedTemplateId && onTemplateDelete && (
                <button
                  type="button"
                  onClick={async () => {
                    const id = String((templateState as any)?.selectedTemplateId || '');
                    if (!id) return;
                    const shouldDelete = confirm('Remover esta ficha salva? As respostas já enviadas não serão apagadas.');
                    if (!shouldDelete) return;
                    try {
                      await onTemplateDelete(id);
                      showFeedback('success', 'Ficha removida da lista ativa.');
                    } catch (error: any) {
                      showFeedback('error', error?.message || 'Não foi possível remover a ficha.');
                    }
                  }}
                  className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50"
                >
                  Remover ficha salva
                </button>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={`rounded-xl px-4 py-2 text-sm font-semibold ${profileType === 'adult' ? 'bg-[#7a32fc] text-white' : 'bg-slate-100 text-slate-700'}`}
              onClick={() => setProfileType('adult')}
            >
              Adulto
            </button>
            <button
              className={`rounded-xl px-4 py-2 text-sm font-semibold ${profileType === 'child' ? 'bg-[#7a32fc] text-white' : 'bg-slate-100 text-slate-700'}`}
              onClick={() => setProfileType('child')}
            >
              Criança
            </button>
            {canEditTemplate && (
              <>
                <div className="mx-1 h-6 w-px bg-slate-200" />
                <button
                  className={`rounded-xl px-4 py-2 text-sm font-semibold ${view === 'fill' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'}`}
                  onClick={() => setView('fill')}
                >
                  Preenchimento
                </button>
                <button
                  className={`rounded-xl px-4 py-2 text-sm font-semibold ${view === 'template' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'}`}
                  onClick={() => setView('template')}
                >
                  Personalização da ficha
                </button>
              </>
            )}
          </div>

          {view === 'template' && canEditTemplate ? (
            <div className="space-y-4">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={addTemplateSection}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:border-[#7a32fc]/40 hover:text-[#7a32fc]"
                >
                  <Plus size={14} className="inline mr-2" />
                  Adicionar seção
                </button>
              </div>
              {profileTemplate.sections
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((section) => {
                  const sectionQuestions = profileTemplate.questions
                    .filter((question) => question.sectionId === section.id)
                    .sort((a, b) => a.order - b.order);
                  const expanded = expandedSections[section.id] ?? true;
                  const questionEditor = questionEditors[section.id];
                  const draftQuestion = questionEditor?.draftQuestion || null;
                  return (
                    <div key={section.id} className="rounded-2xl border border-slate-200">
                      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-50 rounded-t-2xl">
                        <div className="flex items-center gap-2">
                          <button
                            className="rounded-lg border border-slate-200 p-1 text-slate-500"
                            onClick={() => setExpandedSections((prev) => ({ ...prev, [section.id]: !expanded }))}
                          >
                            <ChevronDown size={16} className={expanded ? 'rotate-180' : ''} />
                          </button>
                          <input
                            value={section.title}
                            onChange={(event) => handleSectionTitleChange(section.id, event.target.value)}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-sm font-semibold text-slate-700 bg-white"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
                            onClick={() => startAddQuestion(section.id)}
                          >
                            <Plus size={14} className="inline mr-1" />
                            Adicionar pergunta
                          </button>
                          <button
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${section.active ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}
                            onClick={() => toggleSection(section.id)}
                          >
                            {section.active ? 'Desativar seção' : 'Reativar seção'}
                          </button>
                        </div>
                      </div>

                      {expanded && (
                        <div className="p-4 space-y-2">
                          {sectionQuestions.map((question) => (
                            <div key={question.id} className="rounded-xl border border-slate-200 p-3 bg-white">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="font-semibold text-slate-800">
                                    {question.label}
                                    {question.required && <span className="ml-1 text-red-500">*</span>}
                                  </p>
                                  <p className="text-xs text-slate-500">Tipo: {QUESTION_TYPE_LABEL[question.type]}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700"
                                    onClick={() => startQuestionEdit(question)}
                                  >
                                    <Pencil size={12} className="inline mr-1" />
                                    Editar
                                  </button>
                                  <button
                                    className={`rounded-lg px-2 py-1 text-xs font-semibold ${question.active ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}
                                    onClick={() => toggleQuestion(question.id)}
                                  >
                                    {question.active ? 'Desativar' : 'Reativar'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}

                          {questionEditor && draftQuestion && (
                            <div id={`anamnesis-question-editor-${section.id}`} className="rounded-xl border border-[#7a32fc]/30 bg-[#7a32fc]/5 p-3 space-y-2">
                              <h4 className="font-semibold text-slate-800">{questionEditor.editingQuestionId === 'new' ? 'Nova pergunta' : 'Editar pergunta'}</h4>
                              <input
                                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white text-slate-900"
                                placeholder="Texto da pergunta"
                                value={draftQuestion.label}
                                onChange={(event) => updateQuestionDraft(section.id, (prev) => ({ ...prev, label: event.target.value }))}
                              />
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <select
                                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white text-slate-900"
                                  value={draftQuestion.type}
                                  onChange={(event) =>
                                    updateQuestionDraft(section.id, (prev) => ({
                                      ...prev,
                                      type: event.target.value as AnamnesisQuestionType
                                    }))
                                  }
                                >
                                  {Object.keys(QUESTION_TYPE_LABEL).map((questionType) => (
                                    <option key={questionType} value={questionType}>
                                      {QUESTION_TYPE_LABEL[questionType as AnamnesisQuestionType]}
                                    </option>
                                  ))}
                                </select>
                                <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800">
                                  <input
                                    type="checkbox"
                                    checked={draftQuestion.required}
                                    onChange={(event) => updateQuestionDraft(section.id, (prev) => ({ ...prev, required: event.target.checked }))}
                                  />
                                  Obrigatória
                                </label>
                              </div>
                              {(draftQuestion.type === 'multipla_escolha' || draftQuestion.type === 'multipla_selecao') && (
                                <textarea
                                  rows={2}
                                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none bg-white text-slate-900"
                                  placeholder="Opções separadas por vírgula"
                                  value={draftQuestion.optionsText}
                                  onChange={(event) => updateQuestionDraft(section.id, (prev) => ({ ...prev, optionsText: event.target.value }))}
                                />
                              )}
                              <div className="flex items-center gap-2">
                                <button
                                  className="rounded-lg bg-[#7a32fc] px-3 py-2 text-sm font-semibold text-white"
                                  onClick={() => saveQuestionEdit(section.id)}
                                >
                                  Confirmar pergunta
                                </button>
                                <button
                                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600"
                                  onClick={() => {
                                    cancelQuestionEdit(section.id);
                                  }}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button onClick={resetTemplate} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
                  <RotateCcw size={14} className="inline mr-2" />
                  Restaurar ficha original
                </button>
                <button
                  onClick={saveTemplate}
                  disabled={isSavingTemplate}
                  className="rounded-xl bg-[#7a32fc] px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {isSavingTemplate ? 'Salvando...' : 'Salvar mudanças'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {profileTemplate.sections
                .filter((section) => section.active)
                .sort((a, b) => a.order - b.order)
                .map((section) => {
                  const sectionQuestions = questionsBySection.get(section.id) || [];
                  if (sectionQuestions.length === 0) return null;

                  return (
                    <div key={section.id} className="rounded-2xl border border-slate-200 p-4 bg-white">
                      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">{section.title}</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {sectionQuestions.map((question) => (
                          <div key={question.id} className="space-y-1">
                            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              {question.label}
                              {question.required && <span className="ml-1 text-red-500">*</span>}
                            </label>
                            <QuestionField
                              question={question}
                              value={formData[question.id]}
                              onChange={(value) => setQuestionValue(question, value)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

              {mode === 'create' && (
                <div className="rounded-2xl border border-slate-200 p-4">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
                    <input type="checkbox" checked={scheduleImmediate} onChange={() => setScheduleImmediate((prev) => !prev)} />
                    Agendar primeira sessão agora
                  </label>
                  {scheduleImmediate && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <input
                        type="date"
                        value={registerDate}
                        onChange={(event) => setRegisterDate(event.target.value)}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      />
                      <input
                        type="time"
                        value={registerTime}
                        onChange={(event) => setRegisterTime(event.target.value)}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      />
                      <input
                        type="text"
                        value={consultationApproach}
                        placeholder="Abordagem"
                        onChange={(event) => setConsultationApproach(event.target.value)}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      />
                      <input
                        type="text"
                        value={consultationRoom}
                        placeholder="Sala"
                        onChange={(event) => setConsultationRoom(event.target.value)}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      />
                      <input
                        type="text"
                        value={consultationProfessional}
                        placeholder="Profissional"
                        onChange={(event) => setConsultationProfessional(event.target.value)}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm sm:col-span-2"
                      />
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={handleSubmitForm}
                className="w-full rounded-xl bg-[#7a32fc] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-[#7a32fc]/30 hover:opacity-90"
              >
                <Check size={16} className="inline mr-2" />
                {mode === 'create' ? 'Salvar prontuário' : 'Salvar alterações'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modalContent;
  return createPortal(modalContent, document.body);
};
