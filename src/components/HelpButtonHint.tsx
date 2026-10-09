import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function HelpButtonHint({ onClose }: { onClose: () => void }) {
  const [style, setStyle] = useState<React.CSSProperties | null>(null);
  useLayoutEffect(() => {
    const reposition = () => {
      const button = document.querySelector<HTMLElement>('[data-tutorial-anchor="help-center"]');
      if (!button) { setStyle(null); return; }
      const rect = button.getBoundingClientRect();
      const viewport = window.visualViewport;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      const offsetLeft = viewport?.offsetLeft || 0;
      const offsetTop = viewport?.offsetTop || 0;
      if (!rect.width || !rect.height || rect.right <= offsetLeft || rect.left >= offsetLeft + width) {
        setStyle(null);
        return;
      }
      const cardWidth = Math.max(1, Math.min(260, width - 24));
      const left = Math.max(offsetLeft + 12, Math.min(
        rect.left + rect.width / 2 - cardWidth / 2, offsetLeft + width - cardWidth - 12,
      ));
      const top = rect.bottom + 112 < offsetTop + height ? rect.bottom + 10
        : Math.max(offsetTop + 12, rect.top - 104);
      setStyle({ position: 'fixed', zIndex: 135, left, top, width: cardWidth,
        maxHeight: 'calc(100dvh - 24px)', overflowY: 'auto' });
    };
    reposition();
    const frame = requestAnimationFrame(reposition);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    window.visualViewport?.addEventListener('resize', reposition);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.visualViewport?.removeEventListener('resize', reposition);
    };
  }, []);
  if (!style) return null;
  return createPortal(
    <aside role="region" aria-label="Dica da Central de Ajuda"
      className="rounded-xl border border-violet-200 bg-white p-3 text-sm text-slate-700 shadow-lg"
      style={style}>
      <p>Precisa de ajuda? Clique no botão <strong>?</strong> para abrir a Central de Ajuda.</p>
      <button type="button" onClick={onClose} aria-label="Dispensar dica de ajuda"
        className="mt-2 rounded px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50">
        Entendi
      </button>
    </aside>,
    document.body,
  );
}
