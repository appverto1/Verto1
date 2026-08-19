const SW_VERSION = "verto-branding-v19";
const VERTO_NOTIFICATION_ICON = "/branding/verto/verto-icon-192.png?v=20260818-1";
const VERTO_NOTIFICATION_BADGE = "/branding/verto/verto-notification-badge.png?v=20260818-1";
const LEGACY_VERTO_CACHE_NAMES = new Set(["appointments-clinic-branding-v11", "verto-branding-v12", "verto-branding-v13", "verto-branding-v14", "verto-branding-v15"]);
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
  const notificationType = String(payload.data?.notificationType || "").trim();
  const isClinicAnnouncement = notificationType === "clinic_announcement";
  // Avisos da clínica usam somente a identidade visual da própria clínica em formato compacto.
  // Não enviamos `image` para evitar o cartão expandido com uma imagem grande abaixo da mensagem.
  const iconUrl = isClinicAnnouncement
    ? asNotificationAssetUrl(brandLogo || payload.icon || "")
    : asNotificationAssetUrl(VERTO_NOTIFICATION_ICON);
  // Em avisos da clínica o logo deve aparecer somente como ícone compacto.
  // `badge` é reservado ao identificador monocromático do app/SO e alguns
  // navegadores rejeitam logos coloridos ou URLs remotas nesse campo.
  const badgeUrl = isClinicAnnouncement
    ? ""
    : asNotificationAssetUrl(VERTO_NOTIFICATION_BADGE);
  const imageUrl = isClinicAnnouncement
    ? ""
    : asNotificationAssetUrl(payload.image || brandLogo || VERTO_NOTIFICATION_ICON);
  const notificationOptions = {
    body: payload.body || `Você tem uma sessão agendada. ${APPOINTMENT_NOTIFICATION_CTA}`,
    ...(iconUrl ? { icon: iconUrl } : {}),
    ...(badgeUrl ? { badge: badgeUrl } : {}),
    ...(imageUrl ? { image: imageUrl } : {}),
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
  };

  event.waitUntil(
    (async () => {
      try {
        await self.registration.showNotification(title, notificationOptions);
      } catch (primaryError) {
        // Primeiro preserva icon/badge e remove apenas a imagem expandida, quando existir.
        let optionsWithoutImage = notificationOptions;
        if (Object.prototype.hasOwnProperty.call(notificationOptions, 'image')) {
          const { image: _failedImage, ...fallbackWithoutImage } = notificationOptions;
          optionsWithoutImage = fallbackWithoutImage;
          try {
            await self.registration.showNotification(title, optionsWithoutImage);
            optionsWithoutImage = null;
          } catch {
            // Se o navegador também rejeitar algum asset compacto, cai no fallback sem mídia.
          }
        }

        if (optionsWithoutImage) {
          const { icon: _failedIcon, badge: _failedBadge, ...fallbackWithoutAssets } = optionsWithoutImage;
          await self.registration.showNotification(title, fallbackWithoutAssets);
        }
      }
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      await Promise.all(windows.map((client) => client.postMessage({
        type: 'VERTO_PORTAL_NOTIFICATION',
        notificationType: payload.data?.notificationType || null,
        announcementId: payload.data?.announcementId || null,
        appointmentId: appointmentId || null,
        swVersion: SW_VERSION,
      })));
    })(),
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
