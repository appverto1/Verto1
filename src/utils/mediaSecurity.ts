const SUPABASE_HOST_SUFFIX = ".supabase.co";

function parseHostsFromEnv(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function getConfiguredAllowedHosts(): Set<string> {
  const hosts = new Set<string>();
  const viteSupabaseUrl = (import.meta as any)?.env?.VITE_SUPABASE_URL as string | undefined;
  const customTrustedHosts = (import.meta as any)?.env?.VITE_TRUSTED_MEDIA_HOSTS as string | undefined;

  try {
    if (viteSupabaseUrl) {
      hosts.add(new URL(viteSupabaseUrl).hostname.toLowerCase());
    }
  } catch {
    // no-op
  }

  for (const host of parseHostsFromEnv(customTrustedHosts)) {
    hosts.add(host);
  }

  if (typeof window !== "undefined" && window.location?.hostname) {
    hosts.add(window.location.hostname.toLowerCase());
  }

  return hosts;
}

const ALLOWED_HOSTS = getConfiguredAllowedHosts();

export function isTrustedMediaUrl(rawUrl?: string | null): boolean {
  if (!rawUrl) return false;
  const value = rawUrl.trim();
  if (!value) return false;

  if (value.startsWith("data:image/")) return true;
  if (value.startsWith("data:application/pdf")) return true;
  if (value.startsWith("blob:")) return true;
  if (value.startsWith("/")) return true;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "https:" && protocol !== "http:") return false;
  if (protocol === "http:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  if (ALLOWED_HOSTS.has(host)) return true;
  if (host.endsWith(SUPABASE_HOST_SUFFIX)) return true;

  return false;
}

export function toTrustedMediaUrl(rawUrl?: string | null): string | null {
  return isTrustedMediaUrl(rawUrl) ? (rawUrl as string) : null;
}

export function sanitizeDescriptionForDisplay(input?: string | null): string {
  const source = typeof input === "string" ? input : "";
  if (!source) return "";
  // Desescapa entidades HTML comuns que podem ter sido escapadas múltiplas vezes
  let unescaped = source
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
  
  // Repete a desescapagem para lidar com HTML escapado múltiplas vezes
  let previousValue = "";
  while (previousValue !== unescaped) {
    previousValue = unescaped;
    unescaped = unescaped
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ');
  }
  
  return unescaped.replace(
    /https?:\/\/[^\s)]+/gi,
    "[link externo bloqueado por segurança]"
  );
}
