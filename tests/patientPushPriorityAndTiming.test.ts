import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reminderPushOptions, clinicAnnouncementPushOptions } from '../services/patientPushDeliveryPolicy';

assert.deepEqual(reminderPushOptions,{TTL:300,urgency:'high'});
assert.deepEqual(clinicAnnouncementPushOptions,{TTL:900,urgency:'high'});
const push=readFileSync('services/pushNotificationService.ts','utf8');
const queue=readFileSync('services/cronService.ts','utf8');
const worker=readFileSync('public/sw.js','utf8');
assert.match(push,/notificationType: 'appointment_reminder'/);
assert.match(push,/scheduledFor: params.scheduledFor/);
assert.match(queue,/scheduledFor: entry.job.scheduled_for/);
assert.match(worker,/maxArrivalDelayMs/);
assert.match(worker,/Notificação descartada por chegada tardia/);
console.log('patientPushPriorityAndTiming: urgent limited TTL and scheduled-UTC timestamps preserved');
