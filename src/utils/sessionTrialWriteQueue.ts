/**
 * Serialize legacy patient-record/PEI writes without blocking the collector UI.
 * Each click creates an independent trial ID and visible local record first.
 * Rejections do not stall later clinical attempts.
 */
export function createSessionTrialWriteQueue() {
  let tail: Promise<void> = Promise.resolve();
  return function enqueue<T>(write: () => T | Promise<T>): Promise<T> {
    const current = tail.then(write);
    tail = current.then(() => undefined, () => undefined);
    return current;
  };
}
