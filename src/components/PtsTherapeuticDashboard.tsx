import React, { useMemo, useState } from 'react';
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  History,
  Pencil,
  ShieldAlert,
  Target,
} from 'lucide-react';
import { hydratePtsClinicalPayloadFromPlan } from '../utils/ptsClinicalWorkspace';
import { SecureImage } from './SecureMedia';
import { formatTherapeuticPlanDate, normalizeTherapeuticProgramStatus } from '../utils/therapeuticPlan';

type WorkspaceTab = 'evidence' | 'reviews' | 'history';

type PtsTherapeuticDashboardProps = {
  scope: any;
  availableScopes?: any[];
  professionals?: any[];
  sharedEvidence?: any[];
  legacyEvidence?: any[];
  loading?: boolean;
  isDark?: boolean;
  canEditScope?: boolean;
  canManagePlans?: boolean;
  onScopeChange: (scopeId: string) => void;
  onNewVersion: () => void;
  onRecordReview?: () => void;
  onRecordRisk?: () => void;
  onManagePlans: () => void;
  onOpenSourcePlan?: (planId: string) => void;
};

const TABS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'evidence', label: 'Evidências do cuidado' },
  { id: 'reviews', label: 'Reavaliações' },
  { id: 'history', label: 'Histórico' },
];

const initials = (value: unknown) => String(value || 'P')
  .trim()
  .split(/\s+/)
  .slice(0, 2)
  .map((part) => part.charAt(0).toUpperCase())
  .join('') || 'P';

const professionalPhotoSource = (professional: any) => String(
  professional?.profilePicture
  || professional?.profile_picture
  || professional?.profilePictureUrl
  || professional?.profile_picture_url
  || professional?.profilePhotoUrl
  || professional?.profile_photo_url
  || professional?.avatarUrl
  || professional?.avatar_url
  || professional?.photoUrl
  || professional?.photo_url
  || professional?.imageUrl
  || professional?.image_url
  || professional?.professional_profile?.profile_photo_url
  || professional?.professionalProfile?.profilePhotoUrl
  || ''
).trim();

const objectiveLines = (value: unknown): string[] => {
  const rows = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return rows
    .flatMap((row: any) => {
      const text = typeof row === 'string'
        ? row
        : row && typeof row === 'object'
          ? row.title || row.description || row.objective || ''
          : '';
      return String(text || '').split(/\r?\n/);
    })
    .map((line) => line.trim())
    .filter(Boolean);
};

const dateValue = (value: unknown) => {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const humanSpecialty = (value: unknown) => {
  const raw = String(value || '').trim();
  const normalized = raw.toLocaleLowerCase('pt-BR');
  if (!raw) return 'Especialidade';
  if (normalized.includes('fono')) return 'Fonoaudiologia';
  if (normalized.includes('terapeuta ocupacional') || normalized === 'to') return 'Terapia Ocupacional';
  if (normalized.includes('psicolog')) return 'Psicologia';
  if (normalized.includes('fisioter')) return 'Fisioterapia';
  if (normalized.includes('psicopedag')) return 'Psicopedagogia';
  return raw;
};

export function PtsTherapeuticDashboard({
  scope,
  availableScopes = [],
  professionals = [],
  sharedEvidence = [],
  legacyEvidence = [],
  loading = false,
  isDark = false,
  canEditScope = false,
  canManagePlans = false,
  onScopeChange,
  onNewVersion,
  onRecordReview,
  onRecordRisk,
  onManagePlans,
  onOpenSourcePlan,
}: PtsTherapeuticDashboardProps) {
  const [tab, setTab] = useState<WorkspaceTab>('evidence');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    reference: true,
    team: true,
    objectives: true,
    family: true,
    versions: true,
  });

  const pts = useMemo(() => hydratePtsClinicalPayloadFromPlan(scope), [scope]);
  const ptsEvents = useMemo(() => Array.isArray(scope?.pts_events) ? scope.pts_events : [], [scope?.pts_events]);
  const activeVersion = scope?.pts_lineage?.activeVersion || null;
  const draftVersion = scope?.pts_lineage?.draftVersion || null;
  const ptsReadModel = scope?.pts_read_model && typeof scope.pts_read_model === 'object' ? scope.pts_read_model : {};
  const hasActiveVersion = Boolean(activeVersion?.id) || String(scope?.status || '').toLowerCase() === 'active';
  const hasPtsDraft = Boolean(draftVersion?.id) || (!hasActiveVersion && String(scope?.status || '').toLowerCase() === 'draft');
  const activePtsVersionNumber = Number(activeVersion?.versionNumber || (hasActiveVersion ? scope?.edit_version : 0) || 1);
  const draftPtsVersionNumber = Number(draftVersion?.versionNumber || (!hasActiveVersion ? scope?.edit_version : 0) || activePtsVersionNumber + 1 || 1);

  const professionalById = useMemo(() => new Map(
    (Array.isArray(professionals) ? professionals : []).map((professional: any) => [String(professional.id), professional]),
  ), [professionals]);
  const caseTeamProfessionals = useMemo(() => {
    const activeTeam = (Array.isArray(professionals) ? professionals : [])
      .filter((professional: any) => String(professional?.id || '').trim());
    if (activeTeam.length > 0) {
      const seen = new Set<string>();
      return activeTeam.filter((professional: any) => {
        const id = String(professional?.id || '').trim();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }

    // Compatibility fallback for historical snapshots created before the case-team
    // projection was available. Current PTS screens should normally use the live,
    // relationship-authorized case team supplied by the server.
    const fallbackIds = Array.from(new Set([
      String(scope?.responsible_professional_id || ''),
      ...(Array.isArray(scope?.participant_professional_ids) ? scope.participant_professional_ids.map(String) : []),
    ].filter(Boolean)));
    return fallbackIds
      .map((professionalId) => professionalById.get(professionalId))
      .filter(Boolean);
  }, [professionals, professionalById, scope]);
  const responsible = professionalById.get(String(pts.caseManagerId || scope?.responsible_professional_id || ''))
    || professionalById.get(String(scope?.responsible_professional_id || ''))
    || null;
  const activeAuthor = professionalById.get(String(activeVersion?.authoredBy || '')) || null;
  const draftAuthor = professionalById.get(String(draftVersion?.authoredBy || '')) || null;

  const sharedObjectives = useMemo(() => {
    const fromGoals = pts.goals
      .filter((goal) => goal.status !== 'cancelled')
      .map((goal) => goal.title)
      .filter(Boolean);
    return fromGoals.length ? fromGoals : objectiveLines(scope?.common_objectives);
  }, [pts.goals, scope?.common_objectives]);

  const reviewEvents = useMemo(() => ptsEvents
    .filter((event: any) => ['REVIEW_RECORDED', 'TEAM_DECISION_RECORDED'].includes(String(event?.event_type || '').toUpperCase()))
    .slice()
    .sort((left: any, right: any) => dateValue(right?.occurred_at || right?.recorded_at) - dateValue(left?.occurred_at || left?.recorded_at)), [ptsEvents]);

  const legacyReviews = useMemo(() => {
    const eventSignatures = new Set(reviewEvents.map((event: any) => {
      const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
      const date = String(event?.occurred_at || event?.recorded_at || '').slice(0, 10);
      const detail = String(payload?.summary || payload?.decisions || '').trim().toLocaleLowerCase('pt-BR');
      return `${date}|${detail}`;
    }));
    return pts.reviews
      .filter((review) => {
        const date = String(review.completedAt || review.scheduledFor || '').slice(0, 10);
        const detail = String(review.summary || review.decisions || '').trim().toLocaleLowerCase('pt-BR');
        return !eventSignatures.has(`${date}|${detail}`);
      })
      .slice()
      .sort((left, right) => dateValue(right.completedAt || right.scheduledFor) - dateValue(left.completedAt || left.scheduledFor));
  }, [pts.reviews, reviewEvents]);

  const timelineEvents = useMemo(() => ptsEvents
    .slice()
    .sort((left: any, right: any) => dateValue(right?.occurred_at || right?.recorded_at) - dateValue(left?.occurred_at || left?.recorded_at)), [ptsEvents]);

  const displayNextReviewDate = String(ptsReadModel?.nextReviewDate || scope?.review_due_date || pts.nextReviewDate || '').slice(0, 10);
  const goalsInProgress = Number.isFinite(Number(ptsReadModel?.goalsInProgress))
    ? Number(ptsReadModel.goalsInProgress)
    : pts.goals.filter((goal) => ['pending', 'in_progress'].includes(goal.status)).length;
  const achievedGoals = Number.isFinite(Number(ptsReadModel?.achievedGoals))
    ? Number(ptsReadModel.achievedGoals)
    : pts.goals.filter((goal) => goal.status === 'achieved').length;
  const activeRisks = Number.isFinite(Number(ptsReadModel?.activeRisks))
    ? Number(ptsReadModel.activeRisks)
    : pts.risks.filter((risk) => risk.status === 'active').length;

  const surface = isDark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-200 bg-white';
  const inset = isDark ? 'border-slate-700 bg-slate-900/45' : 'border-slate-100 bg-slate-50/70';
  const text = isDark ? 'text-slate-100' : 'text-slate-900';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const secondaryButton = `inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:w-auto ${
    isDark ? 'border-slate-700 bg-slate-900/50 text-slate-200 hover:bg-slate-800' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
  }`;
  const neutralButton = `inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:w-auto ${
    isDark ? 'text-slate-300 hover:bg-slate-800 hover:text-slate-100' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
  }`;
  const reviewButton = `inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:w-auto ${
    isDark ? 'border-violet-400/30 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20' : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'
  }`;
  const riskButton = `inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 sm:w-auto ${
    isDark ? 'border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20' : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
  }`;
  const primaryButton = 'inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-medium text-white transition-colors hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:w-auto';
  const draftBadge = isDark
    ? 'border-amber-400/25 bg-amber-500/10 text-amber-200'
    : 'border-amber-200 bg-amber-50 text-amber-800';
  const activeBadge = isDark
    ? 'border-violet-400/25 bg-violet-500/10 text-violet-200'
    : 'border-violet-200 bg-violet-50 text-violet-700';

  const section = (id: string, title: string, content: React.ReactNode) => {
    const open = openSections[id] !== false;
    return (
      <section className={`border-b py-4 last:border-b-0 ${isDark ? 'border-slate-700' : 'border-slate-100'}`}>
        <button
          type="button"
          className="flex min-h-10 w-full items-center justify-between gap-3 text-left"
          onClick={() => setOpenSections((current) => ({ ...current, [id]: !open }))}
          aria-expanded={open}
        >
          <span className={`text-sm ${text}`}>{title}</span>
          {open ? <ChevronUp size={16} className={muted} /> : <ChevronDown size={16} className={muted} />}
        </button>
        {open && <div className="pb-1 pt-2">{content}</div>}
      </section>
    );
  };

  const eventTitle = (event: any) => {
    const eventType = String(event?.event_type || '').toUpperCase();
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
    if (eventType === 'VERSION_ACTIVATED') return `Versão ${payload?.versionNumber || ''} ativada`.trim();
    if (eventType === 'REVIEW_RECORDED') return 'Reavaliação registrada';
    if (eventType === 'RISK_OPENED') return 'Risco registrado';
    if (eventType === 'RISK_STATUS_UPDATED') return 'Risco atualizado';
    if (eventType === 'RISK_RESOLVED') return 'Risco resolvido';
    if (eventType === 'GOAL_STATUS_UPDATED') return 'Status de meta atualizado';
    if (eventType === 'TEAM_DECISION_RECORDED') return 'Decisão da equipe';
    return 'Evento clínico registrado';
  };

  const eventDetail = (event: any) => {
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
    return String(payload?.summary || payload?.decisions || payload?.title || payload?.note || '').trim();
  };

  return (
    <div className="space-y-5" data-testid="pts-therapeutic-dashboard">
      <header className={`rounded-2xl border p-4 sm:p-5 ${surface}`}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className={`text-xl font-semibold ${text}`}>Projeto Terapêutico Singular</h2>
              {hasActiveVersion ? (
                <span className={`rounded-full border px-2.5 py-1 text-xs ${activeBadge}`}>Ativo · v{activePtsVersionNumber}</span>
              ) : (
                <span className={`rounded-full border px-2.5 py-1 text-xs ${draftBadge}`}>Rascunho · v{draftPtsVersionNumber}</span>
              )}
            </div>
            <p className={`mt-1 text-sm ${muted}`}>Plano compartilhado da equipe assistencial.</p>
            {hasActiveVersion ? (
              <p className={`mt-2 text-xs leading-5 ${muted}`}>
                Ativado em {formatTherapeuticPlanDate(activeVersion?.activatedAt || scope?.updated_at || scope?.created_at)}
                {activeAuthor?.name ? ` · autoria: ${activeAuthor.name}` : ''}
                {responsible?.name ? ` · técnico de referência: ${responsible.name}` : ''}
              </p>
            ) : (
              <p className={`mt-2 text-xs leading-5 ${muted}`}>
                {draftAuthor?.name ? `Rascunho iniciado por ${draftAuthor.name}` : 'Rascunho em elaboração'}
                {draftVersion?.createdAt ? ` · ${formatTherapeuticPlanDate(draftVersion.createdAt)}` : ''}
              </p>
            )}

            {availableScopes.length > 1 && (
              <label className={`mt-3 inline-flex items-center gap-2 text-xs ${muted}`}>
                Documento em exibição
                <select
                  className={`rounded-lg border px-2 py-1.5 outline-none ${isDark ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-slate-200 bg-white text-slate-700'}`}
                  value={String(scope?.id || '')}
                  onChange={(event) => onScopeChange(event.target.value)}
                >
                  {availableScopes.map((item: any) => (
                    <option key={item.id} value={item.id}>PTS · v{item?.pts_lineage?.activeVersion?.versionNumber || item?.pts_lineage?.draftVersion?.versionNumber || item.edit_version || 1}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap xl:max-w-[520px] xl:justify-end">
            {canManagePlans && <button type="button" className={neutralButton} onClick={onManagePlans}>Voltar aos planos</button>}
            {hasActiveVersion && onRecordReview && <button type="button" className={reviewButton} onClick={onRecordReview}><CalendarClock size={15} /> Nova reavaliação</button>}
            {hasActiveVersion && onRecordRisk && <button type="button" className={riskButton} onClick={onRecordRisk}><ShieldAlert size={15} /> Registrar risco</button>}
            {canEditScope && (
              <button type="button" className={primaryButton} onClick={onNewVersion}>
                <Pencil size={15} /> {hasPtsDraft ? (hasActiveVersion ? 'Continuar rascunho' : 'Editar rascunho') : 'Criar nova versão'}
              </button>
            )}
          </div>
        </div>
      </header>

      {hasActiveVersion && hasPtsDraft && (
        <div className={`rounded-2xl border px-4 py-3 ${draftBadge}`} data-testid="pts-active-with-draft-notice">
          <p className="text-sm">Rascunho v{draftPtsVersionNumber} em elaboração. A versão v{activePtsVersionNumber} permanece como referência clínica ativa até a nova ativação.</p>
        </div>
      )}

      {hasActiveVersion && (
        <dl className={`grid gap-px overflow-hidden rounded-xl border sm:grid-cols-2 lg:grid-cols-4 ${isDark ? 'border-slate-700 bg-slate-700' : 'border-slate-100 bg-slate-100'}`} data-testid="pts-active-summary">
          {[
            { label: 'Metas em andamento', value: goalsInProgress },
            { label: 'Metas atingidas', value: achievedGoals },
            { label: 'Riscos ativos', value: activeRisks, isRisk: true },
            { label: 'Evidências compartilhadas', value: sharedEvidence.length },
          ].map(({ label, value, isRisk }) => (
            <div
              key={label}
              className={isRisk && Number(value) > 0
                ? isDark ? 'bg-rose-500/10 px-4 py-3' : 'bg-rose-50/70 px-4 py-3'
                : isDark ? 'bg-slate-900/80 px-4 py-3' : 'bg-white px-4 py-3'}
            >
              <dt className={`text-xs ${muted}`}>{label}</dt>
              <dd className={`mt-1 text-xl font-medium ${isRisk && Number(value) > 0 ? (isDark ? 'text-rose-200' : 'text-rose-700') : text}`}>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="grid gap-4 lg:min-h-[560px] lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className={`self-start rounded-2xl border px-4 lg:sticky lg:top-4 ${surface}`} aria-label="Índice do PTS">
          <div className="flex items-center gap-2 border-b py-4">
            <ClipboardList size={18} className="text-violet-500" />
            <h3 className={`text-base font-semibold ${text}`}>{hasActiveVersion ? 'Resumo do plano' : 'Estrutura do rascunho'}</h3>
          </div>

          {section('reference', 'Técnico de referência', (
            <div className="flex items-center gap-3">
              {professionalPhotoSource(responsible) ? (
                <SecureImage
                  src={professionalPhotoSource(responsible)}
                  alt={`Foto de ${responsible?.name || 'profissional de referência'}`}
                  className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-violet-100"
                />
              ) : (
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs ${isDark ? 'bg-violet-500/15 text-violet-200' : 'bg-violet-50 text-violet-700'}`}>{initials(responsible?.name)}</span>
              )}
              <div className="min-w-0">
                <p className={`truncate text-sm ${text}`}>{responsible?.name || 'Ainda não definido'}</p>
                <p className={`mt-0.5 truncate text-xs ${muted}`}>{responsible?.specialty || 'Referência do PTS'}</p>
              </div>
            </div>
          ))}

          {section('team', 'Equipe multidisciplinar', (
            <div className="space-y-2">
              {caseTeamProfessionals.map((professional: any) => {
                const professionalId = String(professional?.id || '');
                return (
                  <div key={professionalId} className="flex items-center gap-2.5">
                    {professionalPhotoSource(professional) ? (
                      <SecureImage src={professionalPhotoSource(professional)} alt={`Foto de ${professional?.name || 'profissional da equipe'}`} className="h-8 w-8 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>{initials(professional?.name)}</span>
                    )}
                    <div className="min-w-0">
                      <p className={`text-sm leading-5 ${text}`}>{professional?.name || 'Profissional da equipe'}</p>
                      <p className={`text-xs ${muted}`}>{professional?.specialty || 'Especialidade não informada'}</p>
                    </div>
                  </div>
                );
              })}
              {caseTeamProfessionals.length === 0 && <p className={`text-xs ${muted}`}>Nenhum profissional ativo na equipe do caso.</p>}
            </div>
          ))}

          {section('objectives', 'Objetivos compartilhados', (
            sharedObjectives.length > 0 ? (
              <ul className={`space-y-2 text-sm leading-5 ${text}`}>
                {sharedObjectives.slice(0, 5).map((objective, index) => (
                  <li key={`${objective}-${index}`} className="flex gap-2"><span className="text-violet-500">•</span><span>{objective}</span></li>
                ))}
              </ul>
            ) : <p className={`text-xs leading-5 ${muted}`}>Ainda não preenchido.</p>
          ))}

          {section('family', 'Prioridades familiares', (
            <p className={`whitespace-pre-line text-sm leading-5 ${pts.familyVoice ? text : muted}`}>
              {pts.familyVoice || 'Ainda não preenchido.'}
            </p>
          ))}

          {section('versions', 'Versões', (
            <div className="space-y-3">
              {hasPtsDraft && (
                <div className="flex gap-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  <div>
                    <p className={`text-sm ${text}`}>v{draftPtsVersionNumber} · Rascunho</p>
                    <p className={`mt-0.5 text-xs ${muted}`}>{draftVersion?.updatedAt ? `Atualizado em ${formatTherapeuticPlanDate(draftVersion.updatedAt)}` : 'Em elaboração'}</p>
                  </div>
                </div>
              )}
              {hasActiveVersion && (
                <div className="flex gap-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-500" />
                  <div>
                    <p className={`text-sm ${text}`}>v{activePtsVersionNumber} · Ativo</p>
                    <p className={`mt-0.5 text-xs ${muted}`}>{formatTherapeuticPlanDate(activeVersion?.activatedAt || scope?.updated_at || scope?.created_at)}</p>
                  </div>
                </div>
              )}
              {hasActiveVersion && <button type="button" className="text-xs text-violet-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2" onClick={() => setTab('history')}>Ver histórico completo</button>}
            </div>
          ))}
        </aside>

        <main className={`min-w-0 rounded-2xl border p-4 sm:p-5 ${surface}`}>
          {!hasActiveVersion ? (
            <div className="space-y-5" data-testid="pts-draft-overview">
              <div>
                <p className={`text-sm ${muted}`}>Rascunho em elaboração</p>
                <h3 className={`mt-1 text-lg font-semibold ${text}`}>Complete o planejamento antes de ativar o PTS</h3>
                <p className={`mt-2 max-w-2xl text-sm leading-6 ${muted}`}>Enquanto este documento estiver em rascunho, ele ainda não é a referência clínica operante. Evidências de progresso e reavaliações aparecem somente depois da ativação.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ['Visão compartilhada', pts.summary || pts.patientVoice || pts.familyVoice ? 'Preenchida' : 'Ainda não preenchida'],
                  ['Metas compartilhadas', pts.goals.length ? `${pts.goals.length} registrada(s)` : 'Ainda não preenchidas'],
                  ['Responsabilidades', pts.responsibilities.length ? `${pts.responsibilities.length} registrada(s)` : 'Ainda não preenchidas'],
                  ['Rede de apoio', pts.network.length ? `${pts.network.length} vínculo(s)` : 'Ainda não preenchida'],
                  ['Riscos', pts.risks.length ? `${pts.risks.length} registrado(s)` : 'Ainda não preenchidos'],
                  ['Próxima reavaliação', displayNextReviewDate ? formatTherapeuticPlanDate(displayNextReviewDate) : 'Ainda não definida'],
                ].map(([label, value]) => (
                  <div key={label} className={`rounded-xl border px-4 py-3 ${inset}`}>
                    <p className={`text-xs ${muted}`}>{label}</p>
                    <p className={`mt-1 text-sm ${text}`}>{value}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <nav className={`flex gap-1 overflow-x-auto border-b ${isDark ? 'border-slate-700' : 'border-slate-100'}`} aria-label="Áreas do PTS" role="tablist">
                {TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.id}
                    className={`relative shrink-0 rounded-t-lg px-3 pb-3 pt-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${tab === item.id ? (isDark ? 'bg-violet-500/10 text-violet-200' : 'bg-violet-50 text-violet-700') : (isDark ? 'text-slate-400 hover:bg-slate-800 hover:text-violet-200' : 'text-slate-500 hover:bg-slate-50 hover:text-violet-600')}`}
                    onClick={() => setTab(item.id)}
                  >
                    {item.label}
                    {tab === item.id && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t-full bg-violet-600" aria-hidden="true" />}
                  </button>
                ))}
              </nav>

              {tab === 'evidence' && (
                <div className="mt-5 space-y-4">
                  <div>
                    <h3 className={`text-base font-semibold ${text}`}>Evidências do cuidado</h3>
                    <p className={`mt-1 text-sm leading-6 ${muted}`}>Somente resumos explicitamente compartilhados com o PTS aparecem aqui. Os planos por especialidade continuam protegidos por vínculo e permissão próprios.</p>
                  </div>
                  {loading ? (
                    <div className={`flex min-h-48 items-center justify-center rounded-2xl border border-dashed text-sm ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Carregando evidências compartilhadas...</div>
                  ) : sharedEvidence.length > 0 ? (
                    <div className="space-y-3">
                      {sharedEvidence.map((evidence: any) => {
                        const sourceSpecialty = humanSpecialty(evidence?.sourceSpecialty);
                        const status = normalizeTherapeuticProgramStatus(evidence?.status);
                        return (
                          <article key={String(evidence?.id)} className={`rounded-2xl border p-4 ${surface}`} data-testid="pts-shared-evidence-card">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className={`text-xs ${muted}`}>{sourceSpecialty}</p>
                                  {evidence?.sharingMode === 'legacy_pts' && <span className={`rounded-full border px-2 py-0.5 text-[10px] ${isDark ? 'border-slate-600 text-slate-300' : 'border-slate-200 text-slate-500'}`}>Legado</span>}
                                </div>
                                <h4 className={`mt-1 text-base font-semibold ${text}`}>{evidence?.name || 'Evidência compartilhada'}</h4>
                                {evidence?.objective && <p className={`mt-2 text-sm leading-6 ${muted}`}>{evidence.objective}</p>}
                                <div className={`mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs ${isDark ? 'border-slate-700' : 'border-slate-100'} ${muted}`}>
                                  <span>Estado operacional: {status === 'teaching' ? 'Em ensino' : status === 'maintenance' ? 'Manutenção' : status === 'completed' ? 'Concluído' : status === 'paused' ? 'Pausado' : 'Rascunho'}</span>
                                  <span>Última evidência: {evidence?.lastAppliedAt ? formatTherapeuticPlanDate(evidence.lastAppliedAt) : 'Não registrada'}</span>
                                  <span>Revisão: {evidence?.reviewDueDate ? formatTherapeuticPlanDate(evidence.reviewDueDate) : 'Não definida'}</span>
                                </div>
                              </div>
                              {evidence?.canOpenSourcePlan === true && evidence?.sourcePlanId && onOpenSourcePlan && (
                                <button type="button" className={secondaryButton} onClick={() => onOpenSourcePlan(String(evidence.sourcePlanId))}>Ver no Plano de {sourceSpecialty}</button>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className={`flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed px-6 text-center ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
                      <Target size={28} className={isDark ? 'text-slate-600' : 'text-slate-300'} />
                      <p className={`mt-3 text-sm ${muted}`}>Nenhuma evidência foi compartilhada com este PTS ainda.</p>
                      <p className={`mt-1 max-w-xl text-xs leading-5 ${muted}`}>O conteúdo privado dos planos por especialidade não é carregado automaticamente nesta visão.</p>
                    </div>
                  )}

                  {legacyEvidence.length > 0 && (
                    <details className={`rounded-2xl border ${inset}`} data-testid="pts-legacy-evidence-section">
                      <summary className={`cursor-pointer px-4 py-3 text-sm ${text}`}>
                        Histórico clínico legado ({legacyEvidence.length})
                      </summary>
                      <div className={`border-t px-4 py-4 ${isDark ? 'border-slate-700' : 'border-slate-100'}`}>
                        <p className={`mb-3 text-xs leading-5 ${muted}`}>
                          Registros anteriores à separação entre PTS e planos por especialidade. São preservados somente para leitura histórica e não significam compartilhamento atual com o PTS.
                        </p>
                        <div className="space-y-2">
                          {legacyEvidence.map((evidence: any) => (
                            <article key={`legacy-${String(evidence?.id)}`} className={`rounded-xl border px-3 py-3 ${surface}`}>
                              <h4 className={`text-sm ${text}`}>{evidence?.name || 'Registro clínico legado'}</h4>
                              {evidence?.objective && <p className={`mt-1 text-xs leading-5 ${muted}`}>{evidence.objective}</p>}
                              <p className={`mt-2 text-[11px] ${muted}`}>Última evidência: {evidence?.lastAppliedAt ? formatTherapeuticPlanDate(evidence.lastAppliedAt) : 'Não registrada'}</p>
                            </article>
                          ))}
                        </div>
                      </div>
                    </details>
                  )}
                </div>
              )}

              {tab === 'reviews' && (
                <div className="mt-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className={`text-base font-semibold ${text}`}>Reavaliações e decisões</h3>
                      <p className={`mt-1 text-sm ${muted}`}>Eventos append-only preservam a versão publicada do plano.</p>
                    </div>
                    {onRecordReview && <button type="button" className={reviewButton} onClick={onRecordReview}><CalendarClock size={15} /> Nova reavaliação</button>}
                  </div>
                  {reviewEvents.length > 0 && reviewEvents.map((event: any) => (
                    <article key={String(event?.id)} className={`rounded-2xl border p-4 ${inset}`}>
                      <p className={`text-sm ${text}`}>{eventTitle(event)} · {formatTherapeuticPlanDate(event?.occurred_at || event?.recorded_at)}</p>
                      {eventDetail(event) && <p className={`mt-2 whitespace-pre-line text-sm leading-6 ${text}`}>{eventDetail(event)}</p>}
                      <p className={`mt-1 text-xs ${muted}`}>Registrado sem alterar a versão publicada do PTS.</p>
                    </article>
                  ))}
                  {legacyReviews.map((review) => (
                    <article key={`legacy-review-${review.id}`} className={`rounded-2xl border p-4 ${inset}`}>
                      <p className={`text-sm ${text}`}>Reavaliação anterior · {formatTherapeuticPlanDate(review.completedAt || review.scheduledFor)}</p>
                      {(review.summary || review.decisions) && <p className={`mt-2 whitespace-pre-line text-sm leading-6 ${text}`}>{review.summary || review.decisions}</p>}
                      <p className={`mt-1 text-xs ${muted}`}>Registro legado preservado somente para leitura.</p>
                    </article>
                  ))}
                  {reviewEvents.length === 0 && legacyReviews.length === 0 && (
                    <div className={`rounded-2xl border border-dashed p-8 text-center text-sm ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Nenhuma reavaliação longitudinal registrada neste PTS.</div>
                  )}
                </div>
              )}

              {tab === 'history' && (
                <div className="mt-5 space-y-4">
                  <div className={`rounded-2xl border p-4 ${inset}`}>
                    <div className="flex items-start gap-3">
                      <History size={18} className="mt-0.5 text-violet-500" />
                      <div>
                        <p className={`text-sm ${text}`}>Histórico longitudinal do PTS</p>
                        <p className={`mt-1 text-xs ${muted}`}>Versões publicadas permanecem imutáveis; eventos posteriores são acrescentados sem reescrever o passado.</p>
                      </div>
                    </div>
                  </div>
                  {timelineEvents.map((event: any) => (
                    <article key={String(event?.id)} className={`rounded-2xl border p-4 ${inset}`}>
                      <div className="flex items-start gap-3">
                        <CalendarClock size={18} className="mt-0.5 text-violet-500" />
                        <div className="min-w-0">
                          <p className={`text-sm ${text}`}>{eventTitle(event)} · {formatTherapeuticPlanDate(event?.occurred_at || event?.recorded_at)}</p>
                          {eventDetail(event) && <p className={`mt-2 whitespace-pre-line text-sm leading-6 ${text}`}>{eventDetail(event)}</p>}
                          {event?.occurred_under_version_number && <p className={`mt-1 text-xs ${muted}`}>Ocorreu sob PTS v{event.occurred_under_version_number}.</p>}
                        </div>
                      </div>
                    </article>
                  ))}
                  {legacyReviews.map((review) => (
                    <article key={`legacy-history-${review.id}`} className={`rounded-2xl border p-4 ${inset}`}>
                      <div className="flex items-start gap-3">
                        <CalendarClock size={18} className="mt-0.5 text-slate-400" />
                        <div className="min-w-0">
                          <p className={`text-sm ${text}`}>Reavaliação anterior · {formatTherapeuticPlanDate(review.completedAt || review.scheduledFor)}</p>
                          {(review.summary || review.decisions) && <p className={`mt-2 whitespace-pre-line text-sm leading-6 ${text}`}>{review.summary || review.decisions}</p>}
                          <p className={`mt-1 text-xs ${muted}`}>Registro legado preservado sem reescrever a versão publicada.</p>
                        </div>
                      </div>
                    </article>
                  ))}
                  {timelineEvents.length === 0 && legacyReviews.length === 0 && (
                    <div className={`rounded-2xl border border-dashed p-8 text-center text-sm ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Nenhum evento longitudinal registrado neste PTS.</div>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
