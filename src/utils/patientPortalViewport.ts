const MOBILE_VIEWPORT_MIN_WIDTH = 280;
const MOBILE_VIEWPORT_MAX_WIDTH = 768;

export const resolvePatientPortalViewportWidth = (params: {
  screenWidth: number;
  touchCapable: boolean;
}): number | null => {
  const screenWidth = Math.round(Number(params.screenWidth || 0));
  if (!params.touchCapable) return null;
  if (!Number.isFinite(screenWidth)) return null;
  if (screenWidth < MOBILE_VIEWPORT_MIN_WIDTH || screenWidth > MOBILE_VIEWPORT_MAX_WIDTH) return null;
  return screenWidth;
};

export const VERTO_FIXED_VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes, viewport-fit=cover';

export const buildPatientPortalViewportContent = (_params: {
  screenWidth: number;
  touchCapable: boolean;
}) => VERTO_FIXED_VIEWPORT_CONTENT;
