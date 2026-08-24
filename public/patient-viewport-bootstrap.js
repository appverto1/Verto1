(() => {
  try {
    const viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) return;

    // Backward-compatible safety for a stale cached HTML document that still loads this file.
    // Never infer a numeric layout width from device dimensions: standalone PWA and
    // browser must share the same native responsive viewport contract.
    viewport.setAttribute(
      'content',
      'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes, viewport-fit=cover',
    );
  } catch {
    // index.html already declares the same safe device-width viewport.
  }
})();
