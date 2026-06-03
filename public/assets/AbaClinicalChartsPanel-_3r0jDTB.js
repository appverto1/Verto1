const LEGACY_ABA_CHARTS_RELOAD_KEY = "verto.legacyAbaChartsChunkReload.v1";

const reloadWithCacheBust = () => {
  if (typeof window === "undefined") return;

  try {
    if (window.sessionStorage.getItem(LEGACY_ABA_CHARTS_RELOAD_KEY) === "done") return;
    window.sessionStorage.setItem(LEGACY_ABA_CHARTS_RELOAD_KEY, "done");
  } catch {
    // The module only exists to recover stale clients; storage can be unavailable.
  }

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("verto_refresh", String(Date.now()));
  window.location.replace(nextUrl.href);
};

reloadWithCacheBust();

export function AbaClinicalChartsPanel() {
  return null;
}
