export type AgendaView = "day" | "week" | "month";

const DEFAULT_AGENDA_VIEW: AgendaView = "week";

const isAgendaView = (value: unknown): value is AgendaView =>
  value === "day" || value === "week" || value === "month";

export const getAgendaViewPreferenceKey = (user: any) => {
  const userId = String(user?.id || user?.email || "").trim();
  const workspaceId =
    String(user?.activeWorkspaceId || user?.clinicId || "global").trim() ||
    "global";
  return userId ? `verto:agenda:view:${userId}:${workspaceId}` : null;
};

export const readAgendaViewPreference = (key: string | null): AgendaView => {
  if (!key || typeof window === "undefined") return DEFAULT_AGENDA_VIEW;
  try {
    const saved = window.localStorage.getItem(key);
    return isAgendaView(saved) ? saved : DEFAULT_AGENDA_VIEW;
  } catch {
    return DEFAULT_AGENDA_VIEW;
  }
};

export const writeAgendaViewPreference = (
  key: string | null,
  view: AgendaView,
) => {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, view);
  } catch {
    // Storage can be unavailable in private mode; the in-memory view still works.
  }
};
