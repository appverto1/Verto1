(() => {
  try {
    const hasPatientSessionHint = Boolean(localStorage.getItem('verto.patient-portal-session-hint.v1'));
    if (!hasPatientSessionHint) return;

    const touchCapable = Number(navigator.maxTouchPoints || 0) > 0 || window.matchMedia?.('(pointer: coarse)')?.matches;
    const screenWidth = Math.round(Number(window.screen?.width || 0));
    if (!touchCapable || screenWidth < 280 || screenWidth > 768) return;

    const viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) return;
    viewport.setAttribute(
      'content',
      `width=${screenWidth}, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes, viewport-fit=cover`,
    );
    window.__VERTO_PATIENT_VIEWPORT_BOOTSTRAPPED__ = screenWidth;
    document.documentElement.dataset.vertoPatientViewportWidth = String(screenWidth);
  } catch {
    // Local storage or media queries can be restricted. The standard viewport remains valid.
  }
})();
