export type PatientViewMode = "cards" | "list";

const DEFAULT_PATIENT_VIEW_MODE: PatientViewMode = "cards";
const SHARED_PATIENT_VIEW_MODE_KEY = "patients:lastViewMode";

const isPatientViewMode = (value: unknown): value is PatientViewMode =>
  value === "cards" || value === "list";

export const getPatientViewPreferenceKey = (user: any) => {
  const userId = String(user?.id || user?.email || "").trim();
  const workspaceId =
    String(user?.activeWorkspaceId || user?.clinicId || "global").trim() ||
    "global";
  return userId ? `verto:patients:view:${userId}:${workspaceId}` : null;
};

export const readPatientViewPreference = (
  key: string | null,
): PatientViewMode => {
  if (typeof window === "undefined") return DEFAULT_PATIENT_VIEW_MODE;
  try {
    const scoped = key ? window.localStorage.getItem(key) : null;
    if (isPatientViewMode(scoped)) return scoped;
    const shared = window.localStorage.getItem(SHARED_PATIENT_VIEW_MODE_KEY);
    return isPatientViewMode(shared) ? shared : DEFAULT_PATIENT_VIEW_MODE;
  } catch {
    return DEFAULT_PATIENT_VIEW_MODE;
  }
};

export const writePatientViewPreference = (
  key: string | null,
  mode: PatientViewMode,
) => {
  if (typeof window === "undefined") return;
  try {
    if (key) window.localStorage.setItem(key, mode);
    window.localStorage.setItem(SHARED_PATIENT_VIEW_MODE_KEY, mode);
  } catch {
    // The current in-memory choice remains available when storage is blocked.
  }
};
