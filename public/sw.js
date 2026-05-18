const SW_VERSION = "appointments-click-v5";
const CONFIRM_ACTION = "verto_confirm_appointment";
const RESCHEDULE_ACTION = "verto_reschedule_appointment";
const CANCEL_ACTION = "verto_cancel_appointment";
const APPOINTMENT_NOTIFICATION_CTA = "Clique nesta notificacao para confirmar, remarcar ou cancelar.";
const VERTO_ICON = "/verto-3d-transparent.png";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
    `/${fallbackQuery ? `?${fallbackQuery}` : ""}`;

  event.waitUntil(
    self.registration.showNotification(payload.title || "Lembrete de Consulta - Verto", {
      body: payload.body || `Voce tem uma consulta agendada. ${APPOINTMENT_NOTIFICATION_CTA}`,
      icon: new URL(payload.icon || VERTO_ICON, self.location.origin).href,
      badge: new URL(payload.badge || VERTO_ICON, self.location.origin).href,
      tag: appointmentId ? `appointment-reminder-${appointmentId}-${reminderKind}` : undefined,
      renotify: Boolean(appointmentId),
      requireInteraction: true,
      timestamp: Date.now(),
      actions: [
        { action: CONFIRM_ACTION, title: "Confirmar" },
        { action: RESCHEDULE_ACTION, title: "Remarcar" },
        { action: CANCEL_ACTION, title: "Cancelar" },
      ],
      data: {
        url: targetUrl,
        appointmentId,
        reminderKind,
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

const persistAppointmentResponse = async (appointmentId, action, status, source, reminderKind) => {
  const response = await fetch(`/api/notifications/appointments/${encodeURIComponent(appointmentId)}/respond`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, status, source, reminderKind, swVersion: SW_VERSION }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || "Falha ao atualizar agendamento.");
  }
  return payload;
};

const broadcastAppointmentStatus = async (appointmentId, status) => {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach((client) => {
    client.postMessage({
      type: "APPOINTMENT_STATUS_UPDATED",
      appointmentId,
      status,
    });
  });
};

self.addEventListener("notificationclick", (event) => {
  const action = event.action || "";
  const appointmentId = event.notification?.data?.appointmentId || "";
  const targetUrl = event.notification?.data?.url || "/";
  const reminderKind = event.notification?.data?.reminderKind || "reminder";

  const actionToStatusMap = {
    [CONFIRM_ACTION]: "confirmed",
    [RESCHEDULE_ACTION]: "reschedule",
    [CANCEL_ACTION]: "canceled",
  };

  const patientStatus = actionToStatusMap[action];
  event.notification.close();

  if (!action || !appointmentId) {
    event.waitUntil(focusOrOpen(targetUrl));
    return;
  }

  if (!patientStatus) {
    const fallbackUrl = `${targetUrl}${targetUrl.includes("?") ? "&" : "?"}notification_action=${encodeURIComponent(action)}`;
    event.waitUntil(focusOrOpen(fallbackUrl));
    return;
  }

  event.waitUntil(
    persistAppointmentResponse(appointmentId, action, patientStatus, "push_notification_action", reminderKind)
      .then(() => {
        const feedbackMap = {
          confirmed: {
            title: "Presenca Confirmada - Verto",
            body: "Sua presenca foi confirmada. A clinica foi notificada.",
          },
          reschedule: {
            title: "Reagendamento Solicitado - Verto",
            body: "Solicitacao de reagendamento registrada. A recepcao entrara em contato.",
          },
          canceled: {
            title: "Consulta Cancelada - Verto",
            body: "Sua consulta foi cancelada e o horario foi liberado.",
          },
        };

        const feedback = feedbackMap[patientStatus] || {
          title: "Resposta Registrada - Verto",
          body: "Sua resposta foi registrada com sucesso.",
        };

        return Promise.all([
          broadcastAppointmentStatus(appointmentId, patientStatus),
          self.registration.showNotification(feedback.title, {
            body: feedback.body,
            icon: new URL(VERTO_ICON, self.location.origin).href,
            badge: new URL(VERTO_ICON, self.location.origin).href,
            tag: `appointment-response-${appointmentId}`,
            requireInteraction: false,
            data: { url: targetUrl, appointmentId },
          }),
        ]);
      })
      .catch(() => {
        const fallbackUrl = `${targetUrl}${targetUrl.includes("?") ? "&" : "?"}action=${encodeURIComponent(action)}`;
        return focusOrOpen(fallbackUrl);
      }),
  );
});
