import React, { useState, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronRight } from 'lucide-react';

type TutorialCloseReason = 'pause' | 'skip' | 'complete';

const findVisibleTutorialTarget = (targetId: string) => {
  const anchored = Array.from(document.querySelectorAll<HTMLElement>('[data-tutorial-anchor]'))
    .filter((element) => element.dataset.tutorialAnchor === targetId);
  const legacy = document.getElementById(targetId);
  const candidates = legacy ? [...anchored, legacy] : anchored;
  return candidates.find((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }) || null;
};

export const TutorialOverlay = ({
  steps,
  onClose,
  currentStepIndex,
  onStepChange,
}: {
  steps: Array<{ targetId: string; title: string; content: string; placement?: string }>;
  onClose: (reason?: TutorialCloseReason) => void;
  currentStepIndex: number;
  onStepChange: (index: number) => void;
}) => {
  const [coords, setCoords] = useState<any>(null);
  const updatePosition = useCallback(() => {
    const step = steps[currentStepIndex];
    if (!step) return;
    const element = findVisibleTutorialTarget(step.targetId);
    if (!element) {
      setCoords(null);
      return;
    }
    const rect = element.getBoundingClientRect();
    setCoords({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      placement: step.placement || 'bottom',
    });
  }, [currentStepIndex, steps]);

  useLayoutEffect(() => {
    setCoords(null);
    const step = steps[currentStepIndex];
    const element = step ? findVisibleTutorialTarget(step.targetId) : null;
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    updatePosition();
    const timer = window.setTimeout(updatePosition, 140);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.clearTimeout(timer);
    };
  }, [updatePosition, currentStepIndex, steps]);

  if (!coords || typeof document === 'undefined') return null;
  const step = steps[currentStepIndex];
  if (!step) return null;
  const isLast = currentStepIndex === steps.length - 1;
  // Keep the entire card inside the *visible* viewport, including zoom/mobile.
  // The old fixed 320px assumption produced a negative left on small screens.
  const viewportWidth = Math.max(1, window.visualViewport?.width || window.innerWidth);
  const viewportHeight = Math.max(1, window.visualViewport?.height || window.innerHeight);
  const edge = 12;
  const cardWidth = Math.max(1, Math.min(320, viewportWidth - edge * 2));
  const cardHeight = Math.min(300, viewportHeight - edge * 2);
  const suggestedLeft = coords.left + coords.width / 2 - cardWidth / 2;
  const left = Math.max(edge, Math.min(suggestedLeft, viewportWidth - cardWidth - edge));
  const spaceBelow = viewportHeight - (coords.top + coords.height);
  const placeBelow = step.placement === 'bottom'
    ? spaceBelow >= cardHeight + edge || spaceBelow >= coords.top
    : !(coords.top >= cardHeight + edge || coords.top > spaceBelow);
  const suggestedTop = placeBelow
    ? coords.top + coords.height + edge
    : coords.top - cardHeight - edge;
  const top = Math.max(edge, Math.min(suggestedTop, viewportHeight - cardHeight - edge));
  const cardStyle: React.CSSProperties = {
    top, left, width: cardWidth, maxWidth: 'calc(100vw - 24px)',
    maxHeight: 'calc(100dvh - 24px)', overflowY: 'auto',
    position: 'absolute', zIndex: 142,
  };

  // The tutorial may be mounted inside a sticky/animated header. A local
  // z-index cannot escape that stacking context and its card falls behind
  // patient drawers/modals. Portal the entire layer above clinical surfaces.
  return createPortal(
    <div className="fixed inset-0 z-[1000] overflow-hidden" role="dialog" aria-modal="true" aria-label="Tutorial guiado da Verto">
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: coords.top - 5,
          left: coords.left - 5,
          width: coords.width + 10,
          height: coords.height + 10,
          borderRadius: '16px',
          boxShadow: '0 0 0 4px #4318FF, 0 0 0 9999px rgba(0,0,0,0.6)',
          zIndex: 141,
          pointerEvents: 'none',
          transition: 'all 0.25s ease',
        }}
      />
      <div className="tutorial-card" style={{ ...cardStyle, zIndex: 142 }}>
        {placeBelow && <div className="tutorial-arrow arrow-top" />}
        {!placeBelow && <div className="tutorial-arrow arrow-bottom" />}
        <div className="flex justify-between items-center mb-2">
          {steps.length > 1 && (
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              Passo {currentStepIndex + 1} de {steps.length}
            </span>
          )}
          <button type="button" onClick={() => onClose('pause')} aria-label="Pausar tutorial" title="Pausar e retomar depois">
            <X size={16} className="text-gray-400 hover:text-gray-600" />
          </button>
        </div>
        <h3 className="font-bold text-gray-800 text-lg mb-1">{step.title}</h3>
        <p className="text-gray-600 text-sm mb-4 leading-relaxed">{step.content}</p>
        <div className="flex flex-wrap justify-between items-center gap-2">
          {steps.length > 1 && (
            <button
              type="button"
              onClick={() => onClose('skip')}
              className="text-xs font-bold text-gray-400 hover:text-rose-600"
            >
              Pular tutorial
            </button>
          )}
          <div className="ml-auto flex items-center gap-3">
            {currentStepIndex > 0 && (
              <button
                type="button"
                onClick={() => onStepChange(currentStepIndex - 1)}
                className="text-xs font-bold text-gray-400 hover:text-[#4318FF]"
              >
                Voltar
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? onClose('complete') : onStepChange(currentStepIndex + 1))}
              className="bg-[#4318FF] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-lg shadow-[#4318FF]/30 hover:opacity-90 transition-all flex items-center gap-2"
            >
              {isLast ? (steps.length === 1 ? 'Entendi' : 'Concluir') : 'Próximo'} <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
