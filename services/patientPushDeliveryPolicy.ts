/** Limits how long the push provider may buffer a scheduled message.
 * The Android OS can still defer presentation; the service worker separately
 * rejects stale events once delivered. Inbox rows remain durable. */
export const reminderPushOptions = { TTL: 5 * 60, urgency: 'high' } as const;
export const clinicAnnouncementPushOptions = { TTL: 15 * 60, urgency: 'high' } as const;
