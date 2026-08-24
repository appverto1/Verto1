export const VERTO_FIXED_VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes, viewport-fit=cover';

export type MobileAppViewportParams = {
  screenWidth?: number;
  screenHeight?: number;
  availableWidth?: number;
  availableHeight?: number;
  touchCapable?: boolean;
};

/**
 * Compatibility shim for older imports.
 * Verto no longer derives CSS viewport width from screen/available dimensions.
 * Browser and installed PWA use the same native device-width contract.
 */
export const resolveMobileAppViewportWidth = (_params?: MobileAppViewportParams): null => null;

export const resolvePatientPortalViewportWidth = resolveMobileAppViewportWidth;

export const buildPatientPortalViewportContent = (_params?: MobileAppViewportParams) =>
  VERTO_FIXED_VIEWPORT_CONTENT;
