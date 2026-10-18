/** Limits how long the push provider may buffer a scheduled message.
 * The Android OS can still defer presentation; the service worker separately
 * rejects stale events once delivered. Inbox rows remain durable. */
// Android/FCM may briefly defer a high-priority push while the app is sleeping.
// A five-minute TTL caused legitimate 24h reminders to disappear silently.
// Limit eventual delivery to 30 min; retain appointment / portal persistence.
export const REMINDER_MAX_DEVICE_DELAY_MINUTES = 30;
export const reminderPushOptions = { TTL: REMINDER_MAX_DEVICE_DELAY_MINUTES * 60, urgency: 'high' } as const;
export const clinicAnnouncementPushOptions = { TTL: 15 * 60, urgency: 'high' } as const;
