(() => {
  try {
    const touchCapable = Number(navigator.maxTouchPoints || 0) > 0 || window.matchMedia?.('(pointer: coarse)')?.matches;
    if (!touchCapable) return;

    const minWidth = 280;
    const maxWidth = 768;
    const normalizeDimension = (value) => {
      const dimension = Math.round(Number(value || 0));
      return Number.isFinite(dimension) && dimension >= minWidth && dimension <= maxWidth ? dimension : null;
    };

    const phoneEdges = [
      window.screen?.width,
      window.screen?.height,
      window.screen?.availWidth,
      window.screen?.availHeight,
    ]
      .map(normalizeDimension)
      .filter(Boolean);
    const mobileAppWidth = phoneEdges.length > 0 ? Math.min(...phoneEdges) : null;
    if (!mobileAppWidth) return;

    const viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) return;

    viewport.setAttribute(
      'content',
      `width=${mobileAppWidth}, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes, viewport-fit=cover`,
    );

    // Preserve the old patient marker because the authenticated patient bootstrap guard still reads it.
    window.__VERTO_PATIENT_VIEWPORT_BOOTSTRAPPED__ = mobileAppWidth;
    window.__VERTO_MOBILE_APP_VIEWPORT_WIDTH__ = mobileAppWidth;
    document.documentElement.dataset.vertoMobileApp = 'true';
    document.documentElement.dataset.vertoMobileAppWidth = String(mobileAppWidth);
  } catch {
    // The standard device-width viewport from index.html remains the safe fallback.
  }
})();
