import React, { useEffect, useRef } from 'react';

type ResponsiveDrawerProps = {
  open: boolean;
  title: string;
  titleId: string;
  description?: string;
  onRequestClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  headerLeading?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  isDark?: boolean;
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export const ResponsiveDrawer = ({
  open,
  title,
  titleId,
  description,
  onRequestClose,
  returnFocusRef,
  scrollContainerRef,
  headerLeading,
  footer,
  children,
  isDark = false,
}: ResponsiveDrawerProps) => {
  const drawerRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const onRequestCloseRef = useRef(onRequestClose);

  useEffect(() => {
    onRequestCloseRef.current = onRequestClose;
  }, [onRequestClose]);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    const focusTimer = window.setTimeout(() => titleRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onRequestCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = (Array.from(drawerRef.current.querySelectorAll(FOCUSABLE_SELECTOR)) as HTMLElement[])
        .filter((element) => element.offsetParent !== null && element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) {
        event.preventDefault();
        titleRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      window.setTimeout(() => returnFocusRef?.current?.focus(), 0);
    };
  }, [open, returnFocusRef]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120]" data-testid="therapeutic-program-drawer-root">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-slate-950/45 backdrop-blur-[1px]"
        onClick={onRequestClose}
        aria-label="Fechar painel de criação"
        tabIndex={-1}
      />
      <aside
        ref={drawerRef}
        className={`absolute inset-y-0 right-0 flex h-[100dvh] w-full max-w-[820px] flex-col overflow-hidden border-l shadow-2xl sm:w-[min(820px,calc(100vw-2rem))] ${
          isDark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-200 bg-white'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="therapeutic-program-drawer"
      >
        <header
          className={`flex shrink-0 items-center justify-between gap-3 border-b px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] sm:px-6 ${
            isDark ? 'border-slate-700' : 'border-slate-100'
          }`}
          data-testid="therapeutic-program-drawer-header"
        >
          <div className="flex min-w-0 items-center gap-3">
            {headerLeading}
            <div className="min-w-0">
              <h2
                ref={titleRef}
                id={titleId}
                tabIndex={-1}
                className={`truncate text-lg font-medium outline-none ${isDark ? 'text-slate-100' : 'text-slate-900'}`}
              >
                {title}
              </h2>
              {description && <p className={`mt-1 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{description}</p>}
            </div>
          </div>
          <button
            type="button"
            className={`shrink-0 rounded-xl p-2 ${isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-100'}`}
            onClick={onRequestClose}
            aria-label="Fechar"
          >
            <span aria-hidden="true" className="text-xl leading-none">×</span>
          </button>
        </header>

        <div
          ref={scrollContainerRef}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-5 sm:px-6"
          data-testid="therapeutic-program-drawer-scroll"
        >
          {children}
        </div>

        {footer && (
          <footer
            className={`shrink-0 border-t px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 ${
              isDark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-100 bg-white'
            }`}
            data-testid="therapeutic-program-drawer-footer"
          >
            {footer}
          </footer>
        )}
      </aside>
    </div>
  );
};
