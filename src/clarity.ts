const CLARITY_TAG_ID = 'wx86vhv0dd';

type ClarityWindow = Window & {
  clarity?: ((...args: any[]) => void) & { q?: any[] };
};

export function installClarityTracking() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const win = window as ClarityWindow;
  if (win.clarity || document.querySelector(`script[data-clarity-id="${CLARITY_TAG_ID}"]`)) return;

  win.clarity = (...args: any[]) => {
    (win.clarity!.q = win.clarity!.q || []).push(args);
  };

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${CLARITY_TAG_ID}`;
  script.dataset.clarityId = CLARITY_TAG_ID;
  document.head.appendChild(script);
}
