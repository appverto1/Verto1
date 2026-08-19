type PushRenewalRegistration = ServiceWorkerRegistration & {
  active?: ServiceWorker | null;
  waiting?: ServiceWorker | null;
  installing?: ServiceWorker | null;
};

const resolveWorker = (registration: PushRenewalRegistration | null | undefined) =>
  registration?.active ||
  registration?.waiting ||
  registration?.installing ||
  (typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : null);

export const persistPushRenewalContext = async (
  registration: PushRenewalRegistration,
  renewalToken: unknown,
  vapidPublicKey: unknown,
) => {
  const token = String(renewalToken || '').trim();
  const publicKey = String(vapidPublicKey || '').trim();
  if (!token || !publicKey) return false;

  let worker = resolveWorker(registration);
  if (!worker && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const readyRegistration = await navigator.serviceWorker.ready;
      worker = resolveWorker(readyRegistration);
    } catch {
      worker = null;
    }
  }
  if (!worker) return false;

  worker.postMessage({
    type: 'VERTO_PUSH_RENEWAL_CONTEXT',
    renewalToken: token,
    vapidPublicKey: publicKey,
  });
  return true;
};
