import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type AbaPinnedShortcutItem = {
  id: string;
  name: string;
  method: string;
  severity: number;
  color: string;
  active: boolean;
  elapsed?: string;
  disabled?: boolean;
};

type Gesture = {
  id: string;
  pointerId: number;
  x: number;
  y: number;
  held: boolean;
  cancelled: boolean;
  timeout: ReturnType<typeof setTimeout>;
};

const LONG_HOLD_MS = 430;
const CANCEL_SCROLL_PX = 12;
const degrees = [1, 2, 3, 4, 5];

export const AbaPinnedBehaviorStrip = ({
  items, onRegister, onSelectSeverity,
}: {
  items: AbaPinnedShortcutItem[];
  onRegister: (id: string, severity: number) => void;
  onSelectSeverity: (id: string, severity: number) => void;
}) => {
  const gestureRef = useRef<Gesture | null>(null);
  const [picker, setPicker] = useState<{ id: string; top: number; left: number } | null>(null);
  const [busySelection, setBusySelection] = useState(false);

  useEffect(() => () => {
    if (gestureRef.current) clearTimeout(gestureRef.current.timeout);
  }, []);

  const openSeverity = (id: string, anchor: HTMLButtonElement) => {
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - 248, rect.left + rect.width / 2 - 120));
    const top = rect.top >= 74 ? rect.top - 66 : rect.bottom + 8;
    setPicker({ id, top, left });
  };

  const start = (event: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0 || busySelection) return;
    if (gestureRef.current) clearTimeout(gestureRef.current.timeout);
    setPicker(null);
    const anchor = event.currentTarget;
    const gesture: Gesture = {
      id, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      held: false, cancelled: false, timeout: 0 as unknown as ReturnType<typeof setTimeout>,
    };
    gesture.timeout = setTimeout(() => {
      if (gestureRef.current !== gesture || gesture.cancelled) return;
      gesture.held = true;
      openSeverity(id, anchor);
    }, LONG_HOLD_MS);
    gestureRef.current = gesture;
    try { anchor.setPointerCapture(event.pointerId); } catch { /* Native fallback still works. */ }
  };

  const move = (event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.held) return;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > CANCEL_SCROLL_PX) {
      gesture.cancelled = true;
      clearTimeout(gesture.timeout);
    }
  };

  const finish = (event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    clearTimeout(gesture.timeout);
    gestureRef.current = null;
    if (gesture.cancelled) return;
    if (!gesture.held) {
      const item = items.find((value) => value.id === gesture.id);
      if (item && !item.disabled) onRegister(item.id, item.severity);
      return;
    }
    // Pointer capture keeps the original button as the event target. Hit-test
    // the actual release coordinates to select the chosen degree reliably.
    const hit = typeof document === 'undefined' ? null : document.elementFromPoint(event.clientX, event.clientY);
    const target = hit?.closest('[data-aba-severity-degree]') as HTMLElement | null;
    if (!target || target.dataset.abaSeverityBehavior !== gesture.id) return;
    const degree = Number(target.dataset.abaSeverityDegree);
    if (degrees.includes(degree)) {
      setPicker(null);
      setBusySelection(true);
      try { onSelectSeverity(gesture.id, degree); }
      finally { setBusySelection(false); }
    }
  };

  const cancel = () => {
    if (gestureRef.current) clearTimeout(gestureRef.current.timeout);
    gestureRef.current = null;
  };

  return (
    <>
      <div data-aba-pinned-behavior-strip role="group" aria-label="Comportamentos fixados"
        className="flex min-w-0 snap-x gap-2 overflow-x-auto overscroll-x-contain pb-1 scrollbar-thin"
        style={{ touchAction: 'pan-x' }}>
        {items.map((item) => (
          <button key={item.id} type="button"
            data-aba-pinned-behavior={item.id}
            data-aba-dock-shortcut={item.id}
            disabled={item.disabled || busySelection}
            aria-label={item.name + ', severidade ' + item.severity + '. Toque para registrar; segure para escolher grau.'}
            title={item.name + ' · grau ' + item.severity}
            onPointerDown={(event) => start(event, item.id)}
            onPointerMove={move}
            onPointerUp={finish}
            onPointerCancel={cancel}
            onContextMenu={(event) => { event.preventDefault(); openSeverity(item.id, event.currentTarget); }}
            onClick={(event) => {
              // Synthetic click from touch/mouse is already handled on pointerup.
              if (event.detail === 0 && !picker) onRegister(item.id, item.severity);
            }}
            className={'relative flex min-h-[48px] min-w-[106px] max-w-[176px] shrink-0 snap-start flex-col items-center justify-center gap-0.5 rounded-2xl border px-3 py-2 text-center text-[11px] font-semibold shadow-sm transition active:scale-[0.98] disabled:opacity-50 ' +
              (item.active ? 'border-violet-400 bg-violet-600 text-white' : 'border-slate-200 bg-white text-slate-700')}>
            <span className="max-w-full truncate">{item.name}</span>
            <span className="text-[10px] font-normal opacity-75">
              {item.active && item.elapsed ? item.elapsed : (item.method === 'duration' ? 'Duração' : item.method === 'partial_interval' ? 'Intervalos' : '+1')}
              {' · G'}{item.severity}
            </span>
          </button>
        ))}
      </div>
      {picker && typeof document !== 'undefined' && createPortal(
        <div className="fixed z-[260] flex gap-1 rounded-2xl border border-violet-200 bg-white p-1.5 shadow-xl"
          role="group" aria-label="Escolher grau de severidade"
          style={{ top: picker.top, left: picker.left }}>
          {degrees.map((degree) => (
            <button key={degree} type="button"
              data-aba-severity-degree={degree}
              data-aba-severity-behavior={picker.id}
              disabled={busySelection}
              onClick={() => { setPicker(null); onSelectSeverity(picker.id, degree); }}
              aria-label={'Registrar com severidade ' + degree}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 text-sm font-semibold text-violet-800 hover:bg-violet-600 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600">
              {degree}
            </button>
          ))}
        </div>, document.body
      )}
    </>
  );
};
