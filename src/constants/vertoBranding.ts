export const VERTO_BRAND_VERSION = '20260818-1';
export const VERTO_HORIZONTAL_LOGO_VERSION = '20260826-1';

const withBrandVersion = (path: string) => `${path}?v=${VERTO_BRAND_VERSION}`;

export const VERTO_BRAND_ASSETS = {
  symbol: withBrandVersion('/branding/verto/verto-symbol.png'),
  horizontalLogo: `/branding/verto/verto-logo-horizontal.png?v=${VERTO_HORIZONTAL_LOGO_VERSION}`,
  favicon16: withBrandVersion('/branding/verto/verto-favicon-16.png'),
  favicon32: withBrandVersion('/branding/verto/verto-favicon-32.png'),
  appleTouchIcon: withBrandVersion('/branding/verto/verto-apple-touch-icon.png'),
  pwaIcon192: withBrandVersion('/branding/verto/verto-icon-192.png'),
  pwaIcon512: withBrandVersion('/branding/verto/verto-icon-512.png'),
  maskableIcon: withBrandVersion('/branding/verto/verto-maskable-icon.png'),
  notificationIcon: withBrandVersion('/branding/verto/verto-icon-192.png'),
  notificationBadge: withBrandVersion('/branding/verto/verto-notification-badge.png'),
} as const;

// E-mail clients require an absolute URL. The file remains hosted by Verto,
// alongside the local assets used by the web application.
export const VERTO_EMAIL_HORIZONTAL_LOGO_URL =
  `https://www.appverto.com.br${VERTO_BRAND_ASSETS.horizontalLogo}`;

export const isVertoInstitutionalAsset = (value: unknown) => {
  const normalized = String(value || '').trim().toLowerCase();
  return (
    /(?:^|\/)(?:verto-3d(?:-transparent)?|logoverto|verto-logo)\.(?:png|webp|jpe?g)(?:$|[?#])/.test(normalized) ||
    /(?:^|\/)branding\/verto\/(?:verto-[a-z0-9-]+\.png|favicon\.ico)(?:$|[?#])/.test(normalized)
  );
};
