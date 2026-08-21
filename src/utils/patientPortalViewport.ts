const MOBILE_VIEWPORT_MIN_WIDTH = 280;
const MOBILE_VIEWPORT_MAX_WIDTH = 768;

export type MobileAppViewportParams = {
  screenWidth: number;
  screenHeight?: number;
  availableWidth?: number;
  availableHeight?: number;
  touchCapable: boolean;
};

const normalizeViewportDimension = (value: unknown): number | null => {
  const dimension = Math.round(Number(value || 0));
  if (!Number.isFinite(dimension)) return null;
  if (dimension < MOBILE_VIEWPORT_MIN_WIDTH || dimension > MOBILE_VIEWPORT_MAX_WIDTH) return null;
  return dimension;
};

/**
 * Resolve the physical/logical phone width independently of the browser layout viewport.
 * This keeps Verto in its mobile app shell even when Android Chrome is rendering the page
 * with a desktop-like layout viewport (for example after a desktop-site preference).
 */
export const resolveMobileAppViewportWidth = (params: MobileAppViewportParams): number | null => {
  if (!params.touchCapable) return null;

  // Use the shortest valid physical screen edge instead of the browser layout viewport.
  // On Android this remains phone-sized even when Chrome is rendering a desktop-like page.
  // It is also orientation-stable because portrait/landscape only swap the two edges.
  const phoneEdgeCandidates = [params.screenWidth, params.screenHeight, params.availableWidth, params.availableHeight]
    .map((value) => normalizeViewportDimension(value))
    .filter((value): value is number => value !== null);

  return phoneEdgeCandidates.length > 0 ? Math.min(...phoneEdgeCandidates) : null;
};

// Backward-compatible export used by the patient-session bootstrap guard.
export const resolvePatientPortalViewportWidth = resolveMobileAppViewportWidth;

export const VERTO_FIXED_VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes, viewport-fit=cover';

export const buildPatientPortalViewportContent = (params: MobileAppViewportParams) => {
  const mobileAppWidth = resolveMobileAppViewportWidth(params);
  if (!mobileAppWidth) return VERTO_FIXED_VIEWPORT_CONTENT;

  return `width=${mobileAppWidth}, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes, viewport-fit=cover`;
};
