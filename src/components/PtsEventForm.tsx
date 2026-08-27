import React, { useMemo, useState } from 'react';
import { CalendarClock, Loader2, ShieldAlert } from 'lucide-react';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '../utils/dateTimeLocal';

type PtsEventKind = 'review' | 'risk';

type PtsEventSubmitPayload = {
  eventType: 'REVIEW_RECORDED' | 'RISK_OPENED';
  occurredAt: string;
  payload: Record<string, string>;
};

export function PtsEventForm({
  kind,
  clinicTimeZone,
  isDark = false,
  saving = false,
  onCancel,
  onSubmit,
}: {
  kind: PtsEventKind;
  clinicTimeZone?: string;
  isDark?: boolean;
  saving?: boolean;
  onCancel: () => void;
  onSubmit: (payload: PtsEventSubmitPayload) => Promise<void> | void;
}) {
  const [occurredAt, setOccurredAt] = useState(() => toDateTimeLocalValue(new Date(), clinicTimeZone));
  const [summary, setSummary] = useState('');
  const [decisions, setDecisions] = useState('');
  const [nextReviewDate, setNextReviewDate] = useState('');
  const [riskTitle, setRiskTitle] = useState('');
  const [riskSeverity, setRiskSeverity] = useState('medium');
  const [riskDescription, setRiskDescription] = useState('');
  const [riskResponsePlan, setRiskResponsePlan] = useState('');
  const [validationMessage, setValidationMessage] = useState('');

  const isReview = kind === 'review';
  const field = `w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-violet-500 ${
    isDark
      ? 'border-slate-700 bg-slate-950/50 text-slate-100 placeholder:text-slate-500'
      : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400'
  }`;
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const text = isDark ? 'text-slate-100' : 'text-slate-900';
  const inset = isDark ? 'border-slate-700 bg-slate-950/35' : 'border-slate-100 bg-slate-50';
  const secondaryButton = `inline-flex min-h-10 items-center justify-center rounded-xl border px-4 text-sm transition-colors ${
    isDark ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
  }`;

  const canSubmit = useMemo(() => {
    if (!fromDateTimeLocalValue(occurredAt, clinicTimeZone)) return false;
    if (isReview) return Boolean(summary.trim() || decisions.trim());
    return Boolean(riskTitle.trim());
  }, [clinicTimeZone, decisions, isReview, occurredAt, riskTitle, summary]);

  const submit = async () => {
    setValidationMessage('');
    const occurredAtIso = fromDateTimeLocalValue(occurredAt, clinicTimeZone);
    if (!occurredAtIso) {
      setValidationMessage('Informe uma data e hora válidas.');
      return;
    }
    if (new Date(occurredAtIso).getTime() > Date.now() + 5 * 60_000) {
      setValidationMessage('A data do registro não pode estar no futuro.');
      return;
    }
    if (isReview) {
      if (!summary.trim() && !decisions.trim()) {
        setValidationMessage('Registre ao menos a síntese da reavaliação ou uma decisão da equipe.');
        return;
      }
      await onSubmit({
        eventType: 'REVIEW_RECORDED',
        occurredAt: occurredAtIso,
        payload: {
          summary: summary.trim(),
          decisions: decisions.trim(),
          ...(nextReviewDate ? { nextReviewDate } : {}),
        },
      });
      return;
    }
    if (!riskTitle.trim()) {
      setValidationMessage('Informe o risco ou situação de atenção.');
      return;
    }
    await onSubmit({
      eventType: 'RISK_OPENED',
      occurredAt: occurredAtIso,
      payload: {
        title: riskTitle.trim(),
        severity: riskSeverity,
        description: riskDescription.trim(),
        responsePlan: riskResponsePlan.trim(),
      },
    });
  };

  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className={`rounded-2xl border p-4 ${inset}`}>
        <div className="flex items-start gap-3">
          {isReview ? <CalendarClock size={20} className="mt-0.5 text-violet-500" /> : <ShieldAlert size={20} className="mt-0.5 text-violet-500" />}
          <div>
            <h3 className={`text-sm font-semibold ${text}`}>{isReview ? 'Nova reavaliação' : 'Novo registro de risco'}</h3>
            <p className={`mt-1 text-xs leading-5 ${muted}`}>
              Este registro será acrescentado ao histórico do PTS sem reabrir nem alterar a versão publicada.
            </p>
          </div>
        </div>
      </div>

      <label className={`block text-xs ${muted}`}>
        Data e hora do acontecimento
        <input
          className={`${field} mt-1.5`}
          type="datetime-local"
          value={occurredAt}
          max={toDateTimeLocalValue(new Date(Date.now() + 5 * 60_000), clinicTimeZone)}
          onChange={(event) => setOccurredAt(event.target.value)}
        />
      </label>

      {isReview ? (
        <>
          <label className={`block text-xs ${muted}`}>
            Síntese da reavaliação
            <textarea
              className={`${field} mt-1.5 min-h-28 resize-y`}
              maxLength={3000}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Registre o que foi observado desde a última revisão."
            />
          </label>
          <label className={`block text-xs ${muted}`}>
            Decisões e mudanças pactuadas
            <textarea
              className={`${field} mt-1.5 min-h-28 resize-y`}
              maxLength={3000}
              value={decisions}
              onChange={(event) => setDecisions(event.target.value)}
              placeholder="Registre somente decisões tomadas nesta reavaliação."
            />
          </label>
          <label className={`block text-xs ${muted}`}>
            Próxima reavaliação
            <input className={`${field} mt-1.5`} type="date" value={nextReviewDate} onChange={(event) => setNextReviewDate(event.target.value)} />
          </label>
        </>
      ) : (
        <>
          <label className={`block text-xs ${muted}`}>
            Risco ou situação de atenção
            <input
              className={`${field} mt-1.5`}
              maxLength={180}
              value={riskTitle}
              onChange={(event) => setRiskTitle(event.target.value)}
              placeholder="Descreva o risco de forma objetiva."
            />
          </label>
          <label className={`block text-xs ${muted}`}>
            Gravidade
            <select className={`${field} mt-1.5`} value={riskSeverity} onChange={(event) => setRiskSeverity(event.target.value)}>
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
              <option value="critical">Crítica</option>
            </select>
          </label>
          <label className={`block text-xs ${muted}`}>
            Sinais, contexto e fatores associados
            <textarea
              className={`${field} mt-1.5 min-h-24 resize-y`}
              maxLength={1600}
              value={riskDescription}
              onChange={(event) => setRiskDescription(event.target.value)}
            />
          </label>
          <label className={`block text-xs ${muted}`}>
            Conduta combinada e critérios de escalonamento
            <textarea
              className={`${field} mt-1.5 min-h-24 resize-y`}
              maxLength={2200}
              value={riskResponsePlan}
              onChange={(event) => setRiskResponsePlan(event.target.value)}
            />
          </label>
        </>
      )}

      {validationMessage && (
        <div className={`rounded-xl border px-3.5 py-3 text-sm ${isDark ? 'border-rose-400/25 bg-rose-500/10 text-rose-100' : 'border-rose-200 bg-rose-50 text-rose-700'}`} role="alert">
          {validationMessage}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <button type="button" className={secondaryButton} disabled={saving} onClick={onCancel}>Cancelar</button>
        <button
          type="submit"
          disabled={saving || !canSubmit}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving && <Loader2 size={15} className="animate-spin" />}
          {saving ? 'Registrando...' : isReview ? 'Registrar reavaliação' : 'Registrar risco'}
        </button>
      </div>
    </form>
  );
}
