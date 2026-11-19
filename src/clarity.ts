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

  // Clarity's Performance widget already computes field LCP, INP and CLS (p75).
  // Only low-cardinality labels are sent; never send URL parameters, patient IDs,
  // clinic identifiers, user details or clinical content as analytics tags.
  const path = window.location?.pathname?.toLowerCase() || '/';
  const pageGroup =
    /^\/parcerias(?:\/|$)/.test(path) ? 'partners'
    : /^\/rede-de-cuidado(?:\/|$)/.test(path) ? 'care-network'
    : /^\/evolucao-compartilhada(?:\/|$)/.test(path) ? 'shared-timeline'
    : /^\/ativacao(?:\/|$)/.test(path) ? 'activation'
    : /^\/(?:oferta|proposta|contrato|sales)(?:\/|$)/.test(path) ? 'sales'
    : path === '/' ? 'app'
    : 'other';
  const rawConnection = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType
    : undefined;
  const connection = ['slow-2g', '2g', '3g', '4g'].includes(rawConnection || '')
    ? rawConnection : 'unknown';
  win.clarity('set', 'verto_page_group', pageGroup);
  win.clarity('set', 'verto_connection_type', connection);

  // Do not compete with React's first paint and the LCP image for bandwidth.
  // The queued Clarity function remains available for events before page load.
  const loadScript = () => {
    if (document.querySelector(`script[data-clarity-id="${CLARITY_TAG_ID}"]`)) return;
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.clarity.ms/tag/${CLARITY_TAG_ID}`;
    script.dataset.clarityId = CLARITY_TAG_ID;
    document.head.appendChild(script);
  };
  if (document.readyState === 'complete') loadScript();
  else window.addEventListener('load', loadScript, { once: true });
}
