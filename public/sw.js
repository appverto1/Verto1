const SW_VERSION = "verto-branding-v13";
const VERTO_NOTIFICATION_ICON = "/branding/verto/verto-icon-192.png?v=20260716-2";
const VERTO_NOTIFICATION_BADGE = "/branding/verto/verto-notification-badge.png?v=20260716-2";
const LEGACY_VERTO_CACHE_NAMES = new Set(["appointments-clinic-branding-v11", "verto-branding-v12"]);
const APPOINTMENT_NOTIFICATION_CTA = "Toque para confirmar, remarcar ou cancelar.";

const isGenericBrandName = (value) => {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return !normalized || ["clinica", "sua clinica", "minha clinica", "clinica verto", "verto"].includes(normalized);
};

const isVertoFallbackAsset = (value) =>
  /(?:^|\/)(?:verto-3d(?:-transparent)?|logoverto|verto-logo)\.(?:png|webp|jpe?g)(?:$|[?#])/i.test(String(value || "")) ||
  /(?:^|\/)branding\/verto\/(?:verto-[a-z0-9-]+\.png|favicon\.ico)(?:$|[?#])/i.test(String(value || ""));

const asNotificationAssetUrl = (value) => {
  const source = String(value || "").trim();
  if (!source) return "";
  try {
    return new URL(source, self.location.origin).href;
  } catch {
    return "";
  }
};

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if ("caches" in self) {
        const cacheNames = await self.caches.keys();
        await Promise.all(
          cacheNames
            .filter((cacheName) => LEGACY_VERTO_CACHE_NAMES.has(cacheName))
            .map((cacheName) => self.caches.delete(cacheName)),
        );
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const appointmentId = payload.appointmentId || "";
  const reminderKind = payload.reminderKind || "reminder";
  const fallbackQuery = new URLSearchParams({
    ...(appointmentId ? { appointment_id: appointmentId } : {}),
    ...(payload.dateLabel ? { appointment_date: payload.dateLabel } : {}),
    ...(payload.timeLabel ? { appointment_time: payload.timeLabel } : {}),
  }).toString();
  const targetUrl =
    payload.url ||
    payload.data?.url ||
    `/${fallbackQuery ? `?${fallbackQuery}` : ""}`;
  const brandName = payload.branding?.displayName || payload.data?.brandName || "Clínica";
  const rawBrandLogo = payload.branding?.logoUrl || payload.data?.brandLogoUrl || "";
  const brandLogo = isVertoFallbackAsset(rawBrandLogo) ? "" : rawBrandLogo;
  const title = isGenericBrandName(payload.title) && !isGenericBrandName(brandName)
    ? brandName
    : (payload.title || brandName);
  const payloadIcon = isVertoFallbackAsset(payload.icon) ? VERTO_NOTIFICATION_ICON : payload.icon;
  const iconUrl = asNotificationAssetUrl(brandLogo || payloadIcon || VERTO_NOTIFICATION_ICON);
  const badgeUrl = asNotificationAssetUrl(VERTO_NOTIFICATION_BADGE);

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || `Você tem uma consulta agendada. ${APPOINTMENT_NOTIFICATION_CTA}`,
      ...(iconUrl ? { icon: iconUrl } : {}),
      ...(badgeUrl ? { badge: badgeUrl } : {}),
      tag: payload.tag || (appointmentId ? `appointment-reminder-${appointmentId}-${reminderKind}` : undefined),
      renotify: Boolean(appointmentId),
      requireInteraction: true,
      timestamp: Date.now(),
      data: {
        ...(payload.data || {}),
        url: targetUrl,
        appointmentId,
        reminderKind,
        brandName,
        brandLogoUrl: brandLogo || null,
        swVersion: SW_VERSION,
      },
      vibrate: [120, 60, 120],
    }),
  );
});

const focusOrOpen = async (targetUrl) => {
  const destination = new URL(targetUrl || "/", self.location.origin).href;
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    if ("focus" in client) {
      await client.navigate(destination);
      return client.focus();
    }
  }
  return self.clients.openWindow(destination);
};

self.addEventListener("notificationclick", (event) => {
  const baseTargetUrl = event.notification?.data?.url || "/";
  const target = new URL(baseTargetUrl, self.location.origin);
  const targetUrl = target.href;
  event.notification.close();
  event.waitUntil(focusOrOpen(targetUrl));
});
