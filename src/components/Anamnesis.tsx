import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Pencil, RotateCcw, Plus, X } from 'lucide-react';
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
  onTemplateSave?: (template: AnamnesisTemplate) => Promise<any> | any;
  canEditTemplate?: boolean;
}

interface QuestionDraft {
  id: string;
  label: string;
  type: AnamnesisQuestionType;
  optionsText: string;
  required: boolean;
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
  onTemplateSave,
  canEditTemplate = false
}: AnamnesisModalProps) => {
  const [profileType, setProfileType] = useState<AnamnesisProfileType>('adult');
  const [view, setView] = useState<ModalView>('fill');
  const [templateState, setTemplateState] = useState<AnamnesisTemplate>(getDefaultAnamnesisTemplate());
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [editorSectionId, setEditorSectionId] = useState<string | null>(null);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [draftQuestion, setDraftQuestion] = useState<QuestionDraft | null>(null);
  const [templateDirty, setTemplateDirty] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const [scheduleImmediate, setScheduleImmediate] = useState(false);
  const [registerDate, setRegisterDate] = useState('');
  const [registerTime, setRegisterTime] = useState('');
  const [consultationApproach, setConsultationApproach] = useState('');
  const [consultationRoom, setConsultationRoom] = useState('');
  const [consultationProfessional, setConsultationProfessional] = useState('');
  const templateDraftStorageKey = `verto_anamnesis_template_draft_${profileType}`;

  useEffect(() => {
    if (!isOpen) return;

    const sourceTemplate = normalizeAnamnesisTemplate(template || getDefaultAnamnesisTemplate());
    setTemplateState(sourceTemplate);

    const inferredProfile: AnamnesisProfileType =
      initialData?.formType === 'child' || (typeof initialData?.idade === 'number' && initialData.idade <= 12) ? 'child' : 'adult';
    setProfileType(inferredProfile);

    const nextView: ModalView = canEditTemplate && initialData?.nome === 'Template da Clínica' ? 'template' : 'fill';
    setView(nextView);

    const profileTemplate = getProfileTemplate(sourceTemplate, inferredProfile);
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
    setEditingQuestionId(null);
    setDraftQuestion(null);
    setEditorSectionId(null);
    setScheduleImmediate(Boolean(initialData?.scheduleImmediate));
    setRegisterDate(initialData?.date || '');
    setRegisterTime(initialData?.time || '');
    setConsultationApproach(initialData?.approach || '');
    setConsultationRoom(initialData?.room || '');
    setConsultationProfessional(initialData?.professional || '');
    setTemplateDirty(false);
  }, [isOpen, initialData, template, canEditTemplate]);

  useEffect(() => {
    if (!isOpen || !canEditTemplate || view !== 'template') return;
    try {
      const raw = localStorage.getItem(templateDraftStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const draftTemplate = parsed?.template;
      if (!draftTemplate || typeof draftTemplate !== 'object') return;
      const shouldRestore = confirm('Existe um rascunho não salvo da ficha de anamnese. Deseja restaurar?');
      if (shouldRestore) {
        setTemplateState(normalizeAnamnesisTemplate(draftTemplate));
        setTemplateDirty(true);
      } else {
        localStorage.removeItem(templateDraftStorageKey);
      }
    } catch {
      // noop
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, canEditTemplate, view, profileType]);

  useEffect(() => {
    if (!isOpen || !canEditTemplate || view !== 'template') return;
    try {
      localStorage.setItem(
        templateDraftStorageKey,
        JSON.stringify({
          updatedAt: new Date().toISOString(),
          profileType,
          template: templateState
        })
      );
    } catch {
      // noop
    }
  }, [templateState, profileType, isOpen, canEditTemplate, view, templateDraftStorageKey]);

  useEffect(() => {
    if (!isOpen) return;
    let isActive = true;
    const loadLatestTemplate = async () => {
      try {
        const result = await dataService.getClinicAnamnesisTemplate();
        if (!isActive || !result?.success || !result?.data) return;
        const latest = normalizeAnamnesisTemplate(result.data);
        setTemplateState(latest);
      } catch {
        // usa template atual como fallback silencioso
      }
    };
    void loadLatestTemplate();
    return () => {
      isActive = false;
    };
  }, [isOpen]);

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
    setTemplateDirty(true);
    setTemplateState((prev) => {
      const copy = normalizeAnamnesisTemplate(prev);
      copy.profiles[profileType] = updater(copy.profiles[profileType]);
      return copy;
    });
  };

  const handleSectionTitleChange = (sectionId: string, title: string) => {
    updateTemplateProfile((profile) => ({
      ...profile,
      sections: profile.sections.map((section) =>
        section.id === sectionId ? { ...section, title: title.trim() || section.title } : section
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

  const toggleQuestion = (questionId: string) => {
    updateTemplateProfile((profile) => ({
      ...profile,
      questions: profile.questions.map((question) =>
        question.id === questionId ? { ...question, active: !question.active } : question
      )
    }));
  };

  const startQuestionEdit = (question: AnamnesisQuestion) => {
    setEditingQuestionId(question.id);
    setDraftQuestion({
      id: question.id,
      label: question.label,
      type: question.type,
      optionsText: (question.options || []).join(', '),
      required: question.required
    });
  };

  const saveQuestionEdit = (sectionId?: string) => {
    if (!draftQuestion) return;
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

      const nextOrder = Math.max(0, ...profile.questions.filter((question) => question.sectionId === sectionId).map((question) => question.order)) + 1;
      return {
        ...profile,
        questions: [
          ...profile.questions,
          {
            id: draftQuestion.id,
            sectionId: sectionId || 'personalizadas',
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

    setEditingQuestionId(null);
    setDraftQuestion(null);
    setEditorSectionId(null);
  };

  const startAddQuestion = (sectionId: string) => {
    setEditingQuestionId('new');
    setDraftQuestion({
      id: generateQuestionId(),
      label: '',
      type: 'dissertativa',
      optionsText: '',
      required: false
    });
    setEditorSectionId(sectionId);
    setExpandedSections((prev) => ({ ...prev, [sectionId]: true }));
  };

  const saveTemplate = async () => {
    if (!canEditTemplate || !onTemplateSave) return;
    setIsSavingTemplate(true);
    try {
      const normalized = normalizeAnamnesisTemplate(templateState);
      const savedTemplate = await onTemplateSave(normalized);
      setTemplateState(normalizeAnamnesisTemplate(savedTemplate || normalized));
      setTemplateDirty(false);
      try {
        localStorage.removeItem(templateDraftStorageKey);
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

  const resetTemplate = async () => {
    if (!canEditTemplate) return;
    try {
      const response = await fetch('/api/clinic/anamnesis-template/defaults', { credentials: 'include' });
      const result = await response.json();
      if (!result?.success || !result?.data) {
        throw new Error(result?.error || 'Falha ao buscar o template padrão.');
      }
      setTemplateState(normalizeAnamnesisTemplate(result.data));
      setTemplateDirty(false);
      try {
        localStorage.removeItem(templateDraftStorageKey);
      } catch {
        // noop
      }
    } catch (error: any) {
      showFeedback('error', error?.message || 'Não foi possível restaurar o template padrão.');
    }
  };

  const handleCloseModal = () => {
    if (canEditTemplate && view === 'template' && templateDirty) {
      const shouldLeave = confirm('Existem mudanças não salvas na ficha de anamnese. Deseja sair sem salvar?');
      if (!shouldLeave) return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[170] bg-black/50 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center">
      <div className="w-full max-w-6xl max-h-[96vh] overflow-y-auto rounded-3xl bg-white dark:bg-[#0b1b3a] shadow-2xl">
        <div className="sticky top-0 z-20 bg-white dark:bg-[#0b1b3a] border-b border-slate-200 dark:border-slate-700 px-5 sm:px-8 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100">Ficha de Anamnese</h2>
            <p className="text-sm text-slate-500 dark:text-slate-300">Modelo editável por perfil com versionamento.</p>
          </div>
          <button onClick={handleCloseModal} className="rounded-xl border border-slate-200 dark:border-slate-600 p-2 text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="px-5 sm:px-8 py-5 space-y-4">
          {feedback && (
            <div
              className={`rounded-xl border px-4 py-3 text-sm font-medium ${
                feedback.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-700/50 dark:bg-emerald-900/20 dark:text-emerald-200'
                  : feedback.type === 'error'
                    ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-700/50 dark:bg-red-900/20 dark:text-red-200'
                    : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-700/50 dark:bg-blue-900/20 dark:text-blue-200'
              }`}
            >
              {feedback.message}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={`rounded-xl px-4 py-2 text-sm font-semibold ${profileType === 'adult' ? 'bg-[#7a32fc] text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'}`}
              onClick={() => setProfileType('adult')}
            >
              Adulto
            </button>
            <button
              className={`rounded-xl px-4 py-2 text-sm font-semibold ${profileType === 'child' ? 'bg-[#7a32fc] text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'}`}
              onClick={() => setProfileType('child')}
            >
              Criança
            </button>
            {canEditTemplate && (
              <>
                <div className="mx-1 h-6 w-px bg-slate-200" />
                <button
                  className={`rounded-xl px-4 py-2 text-sm font-semibold ${view === 'fill' ? 'bg-slate-800 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'}`}
                  onClick={() => setView('fill')}
                >
                  Preenchimento
                </button>
                <button
                  className={`rounded-xl px-4 py-2 text-sm font-semibold ${view === 'template' ? 'bg-slate-800 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'}`}
                  onClick={() => setView('template')}
                >
                  Personalização da ficha
                </button>
              </>
            )}
          </div>

          {view === 'template' && canEditTemplate ? (
            <div className="space-y-4">
              {profileTemplate.sections
                .sort((a, b) => a.order - b.order)
                .map((section) => {
                  const sectionQuestions = profileTemplate.questions
                    .filter((question) => question.sectionId === section.id)
                    .sort((a, b) => a.order - b.order);
                  const expanded = expandedSections[section.id] ?? true;
                  return (
                    <div key={section.id} className="rounded-2xl border border-slate-200 dark:border-slate-700">
                      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-50 dark:bg-slate-800/60 rounded-t-2xl">
                        <div className="flex items-center gap-2">
                          <button
                            className="rounded-lg border border-slate-200 dark:border-slate-600 p-1 text-slate-500 dark:text-slate-300"
                            onClick={() => setExpandedSections((prev) => ({ ...prev, [section.id]: !expanded }))}
                          >
                            <ChevronDown size={16} className={expanded ? 'rotate-180' : ''} />
                          </button>
                          <input
                            value={section.title}
                            onChange={(event) => handleSectionTitleChange(section.id, event.target.value)}
                            className="rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-1 text-sm font-semibold text-slate-700 dark:text-slate-100 bg-white dark:bg-slate-900/60"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-200"
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
                            <div key={question.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900/40">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="font-semibold text-slate-800 dark:text-slate-100">
                                    {question.label}
                                    {question.required && <span className="ml-1 text-red-500">*</span>}
                                  </p>
                                  <p className="text-xs text-slate-500 dark:text-slate-300">Tipo: {QUESTION_TYPE_LABEL[question.type]}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    className="rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-1 text-xs font-semibold text-slate-700 dark:text-slate-100"
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

                          {editingQuestionId && draftQuestion && (editorSectionId === section.id || sectionQuestions.some((q) => q.id === editingQuestionId)) && (
                            <div className="rounded-xl border border-[#7a32fc]/30 bg-[#7a32fc]/5 p-3 space-y-2">
                              <h4 className="font-semibold text-slate-800 dark:text-slate-100">Editar pergunta</h4>
                              <input
                                className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm bg-white dark:bg-slate-900/60 text-slate-900 dark:text-slate-100"
                                placeholder="Texto da pergunta"
                                value={draftQuestion.label}
                                onChange={(event) => setDraftQuestion((prev) => (prev ? { ...prev, label: event.target.value } : prev))}
                              />
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <select
                                  className="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm bg-white dark:bg-slate-900/60 text-slate-900 dark:text-slate-100"
                                  value={draftQuestion.type}
                                  onChange={(event) =>
                                    setDraftQuestion((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            type: event.target.value as AnamnesisQuestionType
                                          }
                                        : prev
                                    )
                                  }
                                >
                                  {Object.keys(QUESTION_TYPE_LABEL).map((questionType) => (
                                    <option key={questionType} value={questionType}>
                                      {QUESTION_TYPE_LABEL[questionType as AnamnesisQuestionType]}
                                    </option>
                                  ))}
                                </select>
                                <label className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100">
                                  <input
                                    type="checkbox"
                                    checked={draftQuestion.required}
                                    onChange={(event) => setDraftQuestion((prev) => (prev ? { ...prev, required: event.target.checked } : prev))}
                                  />
                                  Obrigatória
                                </label>
                              </div>
                              {(draftQuestion.type === 'multipla_escolha' || draftQuestion.type === 'multipla_selecao') && (
                                <textarea
                                  rows={2}
                                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm resize-none bg-white dark:bg-slate-900/60 text-slate-900 dark:text-slate-100"
                                  placeholder="Opções separadas por vírgula"
                                  value={draftQuestion.optionsText}
                                  onChange={(event) => setDraftQuestion((prev) => (prev ? { ...prev, optionsText: event.target.value } : prev))}
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
                                  className="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-100"
                                  onClick={() => {
                                    setEditingQuestionId(null);
                                    setDraftQuestion(null);
                                    setEditorSectionId(null);
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
                <button onClick={resetTemplate} className="rounded-xl border border-slate-200 dark:border-slate-600 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-100">
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
                    <div key={section.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900/30">
                      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-300">{section.title}</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {sectionQuestions.map((question) => (
                          <div key={question.id} className="space-y-1">
                            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
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
                    Agendar primeira consulta agora
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
};
