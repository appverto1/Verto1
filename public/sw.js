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
      actions: Array.isArray(payload.actions) && payload.actions.length > 0
        ? payload.actions
        : [
            { action: "confirm", title: "Confirmar" },
            { action: "reschedule", title: "Remarcar" },
            { action: "cancel", title: "Cancelar" },
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

const persistAppointmentResponse = async (appointmentId, action, source, reminderKind) => {
  const response = await fetch(`/api/notifications/appointments/${encodeURIComponent(appointmentId)}/respond`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, source, reminderKind }),
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
  
  // Map notification action to appointment status - MUST BE EXACT
  const actionToStatusMap = {
    confirm: "confirmed",        // User clicked "Confirmar"
    confirmed: "confirmed",      // Backward compatibility
    reschedule: "reschedule",    // User clicked "Remarcar"
    cancel: "canceled",          // User clicked "Cancelar"
    cancelled: "canceled",       // Backward compatibility
    canceled: "canceled"         // Fallback for normalized form
  };

  const patientStatus = actionToStatusMap[action];
  event.notification.close();

  if (!action || !patientStatus || !appointmentId) {
    event.waitUntil(focusOrOpen(targetUrl));
    return;
  }

  event.waitUntil(
    persistAppointmentResponse(appointmentId, action, "push_notification_action", reminderKind)
      .then(() => {
        // Send feedback notification with correct message for what user chose
        const feedbackMap = {
          confirmed: {
            title: "Presença Confirmada - Verto",
            body: "Sua presença foi confirmada. A clínica foi notificada.",
          },
          reschedule: {
            title: "Reagendamento Solicitado - Verto",
            body: "Solicitação de reagendamento registrada. A recepção entrará em contato.",
          },
          canceled: {
            title: "Consulta Cancelada - Verto",
            body: "Sua consulta foi cancelada e o horário foi liberado.",
          }
        };

        const feedback = feedbackMap[patientStatus] || {
          title: "Resposta Registrada - Verto",
          body: "Sua resposta foi registrada com sucesso.",
        };

        return Promise.all([
          broadcastAppointmentStatus(appointmentId, patientStatus),
          self.registration.showNotification(feedback.title, {
            body: feedback.body,
            icon: "/verto-3d-transparent.png",
            badge: "/verto-3d-transparent.png",
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
