self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const appointmentId = payload.appointmentId || "";
  const reminderKind = payload.reminderKind || "reminder";
  const targetUrl =
    payload.url ||
    `/consulta${appointmentId ? `?appointment_id=${encodeURIComponent(appointmentId)}` : ""}`;

  event.waitUntil(
    self.registration.showNotification(payload.title || "Lembrete de Consulta - Verto", {
      body: payload.body || "Toque para confirmar, remarcar ou cancelar.",
      icon: "/verto-3d-transparent.png",
      badge: "/verto-3d-transparent.png",
      tag: appointmentId ? `appointment-reminder-${appointmentId}-${reminderKind}` : undefined,
      renotify: Boolean(appointmentId),
      requireInteraction: true,
      timestamp: Date.now(),
      actions: [
        { action: "confirmed", title: "Confirmar" },
        { action: "reschedule", title: "Remarcar" },
        { action: "canceled", title: "Cancelar" },
      ],
      data: {
        url: targetUrl,
        appointmentId,
        reminderKind,
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

const persistAppointmentStatus = async (appointmentId, status, source) => {
  const response = await fetch(`/api/appointments/${encodeURIComponent(appointmentId)}/status`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, source }),
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
  const statusByAction = {
    confirmed: "confirmed",
    reschedule: "reschedule",
    canceled: "canceled",
  };

  event.notification.close();

  if (!action || !statusByAction[action] || !appointmentId) {
    event.waitUntil(focusOrOpen(targetUrl));
    return;
  }

  event.waitUntil(
    persistAppointmentStatus(appointmentId, statusByAction[action], "system_notification_action")
      .then(() =>
        Promise.all([
          broadcastAppointmentStatus(appointmentId, statusByAction[action]),
          self.registration.showNotification("Resposta registrada - Verto", {
          body:
            action === "confirmed"
              ? "Presença confirmada na agenda da clínica."
              : action === "reschedule"
                ? "A recepção verá a consulta como Remarcar."
                : "Consulta cancelada e horário liberado na agenda.",
          icon: "/verto-3d-transparent.png",
          badge: "/verto-3d-transparent.png",
          tag: `appointment-response-${appointmentId}`,
          requireInteraction: false,
          data: { url: targetUrl, appointmentId },
          }),
        ]),
      )
      .catch(() => {
        const fallbackUrl = `${targetUrl}${targetUrl.includes("?") ? "&" : "?"}action=${encodeURIComponent(action)}`;
        return focusOrOpen(fallbackUrl);
      }),
  );
});
