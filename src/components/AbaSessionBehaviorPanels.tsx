import { X } from 'lucide-react';

export type AbaActiveDuration = {
  id: string;
  behaviorName: string;
  startedAt: string;
};

type DurationPanelProps = {
  events: AbaActiveDuration[];
  nowMs: number;
  lockedStops: Record<string, boolean>;
  elapsed: (startedAt: string, nowMs: number) => string;
  onStop: (eventId: string) => void;
  onOpenAbc: (behaviorName: string) => void;
};

/**
 * Presentation only: the clinical event lifecycle stays owned by SessionMode.
 * This panel never starts, stores or persists an event.
 */
export const AbaActiveDurationsPanel = ({ events, nowMs, lockedStops, elapsed, onStop, onOpenAbc }: DurationPanelProps) => (
  <section data-aba-active-duration-panel aria-label="Comportamentos em duração" className="rounded-xl border border-purple-100 bg-white p-2">
    <div className="flex flex-col gap-1.5">
      {events.map((event) => (
        <div key={event.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-[#F4F7FE] px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-800" title={event.behaviorName}>{event.behaviorName}</span>
          <span className="shrink-0 tabular-nums text-sm font-bold text-[#7a32fc]" aria-label={`Duração de ${event.behaviorName}`}>{elapsed(event.startedAt, nowMs)}</span>
          <button
            type="button"
            onClick={() => onStop(event.id)}
            disabled={Boolean(lockedStops[`duration:end:${event.id}`])}
            aria-label={`Parar duração de ${event.behaviorName}`}
            className="min-h-[40px] shrink-0 rounded-lg bg-[#1B254B] px-3 text-xs font-bold text-white disabled:opacity-60"
          >
            Stop
          </button>
          <button
            type="button"
            onClick={() => onOpenAbc(event.behaviorName)}
            aria-label={`Abrir ABC de ${event.behaviorName}`}
            className="min-h-[40px] shrink-0 rounded-lg border border-purple-100 bg-white px-3 text-xs font-bold text-[#7a32fc]"
          >
            ABC
          </button>
        </div>
      ))}
    </div>
  </section>
);

type BehaviorOption = { id: string; name: string };

type AbcPanelProps = {
  completed: boolean;
  minimized: boolean;
  behaviors: BehaviorOption[];
  behaviorId: string;
  selectedBehaviorName: string;
  antecedent: string;
  consequence: string;
  location: string;
  severity: number;
  note: string;
  antecedentOptions: string[];
  consequenceOptions: string[];
  locationOptions: string[];
  severityOptions: number[];
  saving: boolean;
  onChangeBehavior: (id: string) => void;
  onChangeAntecedent: (antecedent: string) => void;
  onChangeConsequence: (consequence: string) => void;
  onChangeLocation: (location: string) => void;
  onChangeSeverity: (severity: number) => void;
  onChangeNote: (note: string) => void;
  onToggleMinimized: () => void;
  onClose: () => void;
  onSave: () => void;
};

/**
 * A non-modal, nonblocking editor during live collection.
 * The completed-session editor retains the pre-existing modal backdrop.
 * Save stays explicit and delegated to the clinical persistence handler.
 */
export const AbaQuickAbcPanel = ({
  completed, minimized, behaviors, behaviorId, selectedBehaviorName,
  antecedent, consequence, location, severity, note,
  antecedentOptions, consequenceOptions, locationOptions, severityOptions,
  saving, onChangeBehavior, onChangeAntecedent, onChangeConsequence,
  onChangeLocation, onChangeSeverity, onChangeNote,
  onToggleMinimized, onClose, onSave
}: AbcPanelProps) => (
  <div
    data-aba-abc-nonblocking={completed ? undefined : 'true'}
    className={completed
      ? 'fixed inset-0 z-[140] flex items-end justify-center bg-black/30 p-3 sm:items-center sm:p-4'
      : 'pointer-events-none fixed inset-x-2 top-[calc(5.5rem+env(safe-area-inset-top))] z-[140] flex justify-end sm:inset-x-auto sm:right-4'}
  >
    <div className={completed
      ? 'w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-purple-100 bg-white p-4 shadow-2xl'
      : 'pointer-events-auto w-full max-w-[320px] max-h-[min(56dvh,430px)] overflow-y-auto rounded-2xl border border-purple-100 bg-white p-3 shadow-lg sm:max-w-sm'}>
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-bold text-gray-800" title={selectedBehaviorName}>ABC · {selectedBehaviorName}</p>
        <div className="flex shrink-0 items-center gap-1">
          {!completed && (
            <button type="button" onClick={onToggleMinimized} className="min-h-[36px] rounded-lg px-2 text-xs font-semibold text-[#7a32fc]" aria-label={minimized ? 'Expandir ABC' : 'Minimizar ABC'}>
              {minimized ? 'Abrir' : 'Reduzir'}
            </button>
          )}
          <button type="button" onClick={onClose} className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Fechar ABC">
            <X size={17} />
          </button>
        </div>
      </div>
      {(!minimized || completed) && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] font-bold text-gray-500">
              Comportamento
              <select value={behaviorId} onChange={(event) => onChangeBehavior(event.target.value)} className="mt-1 w-full min-w-0 rounded-lg border border-blue-100 bg-[#F4F7FE] px-2 py-2 text-xs text-gray-700">
                {behaviors.map((behavior) => <option key={behavior.id} value={behavior.id}>{behavior.name}</option>)}
              </select>
            </label>
            <label className="text-[10px] font-bold text-gray-500">
              Antecedente
              <select value={antecedent} onChange={(event) => onChangeAntecedent(event.target.value)} className="mt-1 w-full min-w-0 rounded-lg border border-blue-100 bg-[#F4F7FE] px-2 py-2 text-xs text-gray-700">
                {antecedentOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="text-[10px] font-bold text-gray-500">
              Consequência
              <select value={consequence} onChange={(event) => onChangeConsequence(event.target.value)} className="mt-1 w-full min-w-0 rounded-lg border border-blue-100 bg-[#F4F7FE] px-2 py-2 text-xs text-gray-700">
                {consequenceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="text-[10px] font-bold text-gray-500">
              Local
              <select value={location} onChange={(event) => onChangeLocation(event.target.value)} className="mt-1 w-full min-w-0 rounded-lg border border-blue-100 bg-[#F4F7FE] px-2 py-2 text-xs text-gray-700">
                {locationOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="col-span-2 text-[10px] font-bold text-gray-500">
              Severidade
              <select value={severity} onChange={(event) => onChangeSeverity(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-blue-100 bg-[#F4F7FE] px-2 py-2 text-xs text-gray-700">
                {severityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <details className="col-span-2">
              <summary className="cursor-pointer py-1 text-[10px] font-bold text-gray-500">Observação opcional</summary>
              <textarea value={note} onChange={(event) => onChangeNote(event.target.value)} maxLength={600} className="mt-1 min-h-[64px] w-full resize-y rounded-lg border border-blue-100 bg-[#F4F7FE] p-2 text-xs text-gray-700" />
            </details>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={onClose} className="min-h-[40px] flex-1 rounded-lg bg-gray-100 px-2 text-xs font-semibold text-gray-600">Cancelar</button>
            <button type="button" onClick={onSave} disabled={saving} className="min-h-[40px] flex-1 rounded-lg bg-[#7a32fc] px-2 text-xs font-semibold text-white disabled:opacity-60">Salvar ABC</button>
          </div>
        </>
      )}
    </div>
  </div>
);
