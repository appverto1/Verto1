/** One bounded external request. Never retries writes that may have committed remotely. */
export class ExternalRequestTimeoutError extends Error {
  constructor() {
    super('O serviço externo demorou para responder. Confira se a ação foi concluída antes de tentar novamente.');
    this.name = 'ExternalRequestTimeoutError';
  }
}

export async function fetchExternalWithTimeout(
  url: string,
  init: RequestInit,
  options: { timeoutMs: number; request?: typeof fetch },
): Promise<Response> {
  const request = options.request || fetch;
  const timeoutMs = Math.max(1, Math.min(30_000, Math.floor(options.timeoutMs)));
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener('abort', onCallerAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);

  try {
    return await request(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new ExternalRequestTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', onCallerAbort);
  }
}
