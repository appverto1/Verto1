const SW_VERSION = "appointments-app-only-v7";
const APPOINTMENT_NOTIFICATION_CTA = "Toque para confirmar, remarcar ou cancelar.";
const VERTO_ICON = "/verto-3d-transparent.png";

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
            .filter((cacheName) => cacheName !== SW_VERSION)
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
  const brandLogo = payload.branding?.logoUrl || payload.data?.brandLogoUrl || "";

  event.waitUntil(
    self.registration.showNotification(payload.title || brandName, {
      body: payload.body || `Você tem uma consulta agendada. ${APPOINTMENT_NOTIFICATION_CTA}`,
      icon: new URL(payload.icon || VERTO_ICON, self.location.origin).href,
      badge: new URL(payload.badge || VERTO_ICON, self.location.origin).href,
      image: payload.image ? new URL(payload.image, self.location.origin).href : undefined,
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
