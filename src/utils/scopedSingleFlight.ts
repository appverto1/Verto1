/**
 * Coalesce concurrent, identical reads within one mounted portal instance.
 *
 * Never retains resolved data, so a confirmed Save remains authoritative. The
 * caller owns its scope and must clear when changing identities/workspaces.
 * "force" is for post-write/domain-event and explicit refresh actions.
 */
export function createScopedSingleFlight<T>() {
  const inFlight = new Map<string, Promise<T>>();

  const release = (key: string, request: Promise<T>) => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  };

  return {
    run(key: string, fetcher: () => Promise<T>, force = false): Promise<T> {
      const current = force ? undefined : inFlight.get(key);
      if (current) return current;
      const request = Promise.resolve().then(fetcher);
      inFlight.set(key, request);
      // Handle both completion paths without creating an unobserved rejection.
      void request.then(() => release(key, request), () => release(key, request));
      return request;
    },
    clear(): void {
      inFlight.clear();
    },
  };
}
