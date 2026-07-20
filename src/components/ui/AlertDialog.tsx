import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

type AlertDialogProps = {
  open: boolean;
  title: string;
  description: string;
  primaryLabel: string;
  destructiveLabel: string;
  onPrimaryAction: () => void;
  onDestructiveAction: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  isDark?: boolean;
};

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export const AlertDialog = ({
  open,
  title,
  description,
  primaryLabel,
  destructiveLabel,
  onPrimaryAction,
  onDestructiveAction,
  returnFocusRef,
  isDark = false,
}: AlertDialogProps) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onPrimaryActionRef = useRef(onPrimaryAction);

  useEffect(() => {
    onPrimaryActionRef.current = onPrimaryAction;
  }, [onPrimaryAction]);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => primaryButtonRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onPrimaryActionRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = (Array.from(dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR)) as HTMLElement[])
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
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
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.setTimeout(() => (returnFocusRef?.current || previousFocusRef.current)?.focus(), 0);
    };
  }, [open, returnFocusRef]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" data-testid="unsaved-changes-alert-root">
      <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-[1px]" aria-hidden="true" />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-alert-title"
        aria-describedby="unsaved-changes-alert-description"
        tabIndex={-1}
        className={`relative w-full max-w-md rounded-2xl border p-5 shadow-2xl outline-none sm:p-6 ${
          isDark ? 'border-slate-700 bg-[#101b2e] text-slate-100' : 'border-slate-200 bg-white text-slate-900'
        }`}
      >
        <h2 id="unsaved-changes-alert-title" className="text-lg font-semibold">{title}</h2>
        <p id="unsaved-changes-alert-description" className={`mt-2 text-sm leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
          {description}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className={`min-h-[42px] rounded-xl border px-4 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${
              isDark ? 'border-rose-400/40 text-rose-200 hover:bg-rose-500/10' : 'border-rose-200 text-rose-700 hover:bg-rose-50'
            }`}
            onClick={onDestructiveAction}
          >
            {destructiveLabel}
          </button>
          <button
            ref={primaryButtonRef}
            type="button"
            className="min-h-[42px] rounded-xl bg-violet-600 px-5 py-2.5 text-sm text-white transition-colors hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
            onClick={onPrimaryAction}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
