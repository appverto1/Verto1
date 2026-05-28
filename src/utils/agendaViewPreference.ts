export type AgendaView = "day" | "week" | "month";

export const CALENDAR_LAST_VIEW_MODE_KEY = "calendar:lastViewMode";

const DEFAULT_AGENDA_VIEW: AgendaView = "month";

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
  if (typeof window === "undefined") return DEFAULT_AGENDA_VIEW;
  try {
    const saved = key ? window.localStorage.getItem(key) : null;
    if (isAgendaView(saved)) return saved;
    const sharedSaved = window.localStorage.getItem(CALENDAR_LAST_VIEW_MODE_KEY);
    return isAgendaView(sharedSaved) ? sharedSaved : DEFAULT_AGENDA_VIEW;
  } catch {
    return DEFAULT_AGENDA_VIEW;
  }
};

export const writeAgendaViewPreference = (
  key: string | null,
  view: AgendaView,
) => {
  if (typeof window === "undefined") return;
  try {
    if (key) window.localStorage.setItem(key, view);
    window.localStorage.setItem(CALENDAR_LAST_VIEW_MODE_KEY, view);
  } catch {
    // Storage can be unavailable in private mode; the in-memory view still works.
  }
};
