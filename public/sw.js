const SW_VERSION = "verto-branding-v23";
const VERTO_NOTIFICATION_ICON = "/branding/verto/verto-icon-192.png?v=20260818-1";
const VERTO_NOTIFICATION_BADGE = "/branding/verto/verto-notification-badge.png?v=20260818-1";
const LEGACY_VERTO_CACHE_NAMES = new Set(["appointments-clinic-branding-v11", "verto-branding-v12", "verto-branding-v13", "verto-branding-v14", "verto-branding-v15"]);
const APPOINTMENT_NOTIFICATION_CTA = "Toque para confirmar, remarcar ou cancelar.";
const PUSH_RENEWAL_CACHE = "verto-push-renewal-v1";
const PUSH_RENEWAL_CONTEXT_URL = "/__verto_push_renewal_context__";

const urlBase64ToUint8Array = (base64String) => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
};

const writePushRenewalContext = async (context) => {
  const renewalToken = String(context?.renewalToken || "").trim();
  const vapidPublicKey = String(context?.vapidPublicKey || "").trim();
  if (!renewalToken || !vapidPublicKey || !("caches" in self)) return false;
  const cache = await self.caches.open(PUSH_RENEWAL_CACHE);
  await cache.put(
    new Request(PUSH_RENEWAL_CONTEXT_URL, { method: "GET" }),
    new Response(JSON.stringify({ renewalToken, vapidPublicKey }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    }),
  );
  return true;
};

const readPushRenewalContext = async () => {
  if (!("caches" in self)) return null;
  const cache = await self.caches.open(PUSH_RENEWAL_CACHE);
  const response = await cache.match(PUSH_RENEWAL_CONTEXT_URL);
  if (!response) return null;
  try {
    const value = await response.json();
    const renewalToken = String(value?.renewalToken || "").trim();
    const vapidPublicKey = String(value?.vapidPublicKey || "").trim();
    return renewalToken && vapidPublicKey ? { renewalToken, vapidPublicKey } : null;
  } catch {
    return null;
  }
};

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
  /(?:^|\/)branding\/verto\/(?:verto-[a-z0-9-]+\.(?:png|svg)|favicon\.ico)(?:$|[?#])/i.test(String(value || ""));

const asNotificationAssetUrl = (value) => {
  const source = String(value || "").trim();
  if (!source) return "";
  try {
    const url = new URL(source, self.location.origin);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
};

// Native Android notification icons are square. Rendering a wide clinic logo
// directly into the OS icon slot stretches it. Letterbox the original inside
// a 192px square on the device; do not create the large "image" notification.
// The result is bounded/in-memory only: no extra Supabase reads or uploads.
const compactClinicIconCache = new Map();
const fitClinicLogoForNotification = async (source) => {
  if (!source || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap !== "function" ||
      typeof fetch !== "function" || typeof btoa !== "function") return source;
  if (compactClinicIconCache.has(source)) return compactClinicIconCache.get(source);
  try {
    const response = await fetch(source, { mode: "cors", credentials: "omit", cache: "force-cache" });
    if (!response.ok || Number(response.headers?.get?.("content-length") || 0) > 1_000_000) return source;
    const original = await response.blob();
    if (!/^image\/(png|jpeg|webp|gif)$/i.test(original.type) || original.size > 1_000_000) return source;
    const bitmap = await createImageBitmap(original);
    try {
      if (!bitmap.width || !bitmap.height) return source;
      const canvas = new OffscreenCanvas(192, 192);
      const context = canvas.getContext("2d");
      if (!context) return source;
      const maxSide = 168;
      const ratio = Math.min(maxSide / bitmap.width, maxSide / bitmap.height);
      const width = Math.max(1, Math.round(bitmap.width * ratio));
      const height = Math.max(1, Math.round(bitmap.height * ratio));
      context.clearRect(0, 0, 192, 192);
      context.drawImage(bitmap, (192 - width) / 2, (192 - height) / 2, width, height);
      const png = await canvas.convertToBlob({ type: "image/png" });
      if (png.type !== "image/png" || png.size > 120_000) return source;
      const bytes = new Uint8Array(await png.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      const squareIcon = `data:image/png;base64,${btoa(binary)}`;
      if (compactClinicIconCache.size >= 8) compactClinicIconCache.clear();
      compactClinicIconCache.set(source, squareIcon);
      return squareIcon;
    } finally {
      bitmap.close?.();
    }
  } catch {
    // Older SWs/browsers or cross-origin images may block rasterization.
    // Keep the original icon and, ultimately, the existing text-only fallback.
    return source;
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

self.addEventListener("message", (event) => {
  if (event.data?.type !== "VERTO_PUSH_RENEWAL_CONTEXT") return;
  event.waitUntil(writePushRenewalContext(event.data));
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    try {
      const context = await readPushRenewalContext();
      if (!context) return;

      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(context.vapidPublicKey),
      });
      const response = await fetch("/api/push/renew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        cache: "no-store",
        body: JSON.stringify({
          renewalToken: context.renewalToken,
          oldEndpoint: event.oldSubscription?.endpoint || null,
          subscription: subscription.toJSON(),
        }),
      });
      if (!response.ok) return;
      const result = await response.json().catch(() => ({}));
      if (result?.renewalToken) {
        await writePushRenewalContext({
          renewalToken: result.renewalToken,
          vapidPublicKey: context.vapidPublicKey,
        });
      }
    } catch (error) {
      console.warn("[push] subscription self-heal failed", error);
    }
  })());
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
  // Preserve the portal inbox regardless of device timing. A late Android/FCM
  // delivery must not present a scheduled reminder as if it had arrived on time.
  // A missing/invalid legacy timestamp is NOT a reason to suppress a message.
  const scheduledForMs = Date.parse(String(payload.data?.scheduledFor || ""));
  const maxArrivalDelayMs = isClinicAnnouncement
    ? 15 * 60 * 1000
    : (notificationType === "appointment_reminder" ? 30 * 60 * 1000 : 0);
  if (maxArrivalDelayMs > 0 && Number.isFinite(scheduledForMs) &&
    Date.now() - scheduledForMs > maxArrivalDelayMs) {
    console.warn("[push] Notificação descartada por chegada tardia ao dispositivo.", {
      notificationType, overdueMinutes: Math.ceil((Date.now() - scheduledForMs) / 60000),
    });
    return;
  }
  // Lembretes e avisos usam SOMENTE o ícone compacto. A propriedade `image`
  // cria um cartão grande no Android e não é permitida, inclusive para payloads legados.
  const iconUrl = isClinicAnnouncement
    ? asNotificationAssetUrl(brandLogo || payload.icon || "")
    : asNotificationAssetUrl(brandLogo || payload.icon || VERTO_NOTIFICATION_ICON);
  // Em avisos da clínica o logo deve aparecer somente como ícone compacto.
  // `badge` é reservado ao identificador monocromático do app/SO e alguns
  // navegadores rejeitam logos coloridos ou URLs remotas nesse campo.
  const badgeUrl = isClinicAnnouncement
    ? ""
    : asNotificationAssetUrl(VERTO_NOTIFICATION_BADGE);
  const originalBody = payload.body || `Você tem uma sessão agendada. ${APPOINTMENT_NOTIFICATION_CTA}`;
  const reminderDelayed = notificationType === "appointment_reminder" &&
    Number.isFinite(scheduledForMs) &&
    Date.now() - scheduledForMs > 5 * 60 * 1000;
  const notificationOptions = {
    body: reminderDelayed ? `${originalBody} (Entregue com atraso.)` : originalBody,
    ...(iconUrl ? { icon: iconUrl } : {}),
    ...(badgeUrl ? { badge: badgeUrl } : {}),
    tag: payload.tag || (appointmentId ? `appointment-reminder-${appointmentId}-${reminderKind}` : undefined),
    renotify: Boolean(appointmentId),
    requireInteraction: true,
    timestamp: Date.now(),
    data: {
      ...(payload.data || {}),
      deploymentEnv: payload.data?.deploymentEnv || payload.deploymentEnv || null,
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
      // The clinic icon is normalized only for notifications, never for the
      // original clinic branding used elsewhere in the application.
      const compactIcon = brandLogo && iconUrl
        ? await fitClinicLogoForNotification(iconUrl)
        : iconUrl;
      if (compactIcon) notificationOptions.icon = compactIcon;
      try {
        await self.registration.showNotification(title, notificationOptions);
      } catch (primaryError) {
        // If a browser rejects an inline PNG, retry its original clinic URL.
        // Otherwise preserve the existing text-only fallback.
        let recovered = false;
        if (compactIcon && compactIcon !== iconUrl && iconUrl) {
          try {
            await self.registration.showNotification(title, { ...notificationOptions, icon: iconUrl });
            recovered = true;
          } catch {
            // Both image formats failed. Present the message without an icon.
          }
        }
        if (!recovered) {
          try {
            await self.registration.showNotification(title, {
              body: notificationOptions.body,
              tag: notificationOptions.tag,
              data: notificationOptions.data,
            });
          } catch (fallbackError) {
            console.warn("[push] Falha ao exibir notificação no dispositivo.", {
              notificationType,
              reason: String(fallbackError?.name || "NOTIFICATION_DISPLAY_FAILED"),
            });
            throw fallbackError;
          }
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
