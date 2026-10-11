import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = (p) => fs.readFileSync(p, 'utf8');
const portal=source('src/components/PatientDashboard.tsx');
const anamnesis=source('src/components/Anamnesis.tsx');
const sw=source('public/sw.js');
const push=source('services/pushNotificationService.ts');
const cron=source('services/cronService.ts');
const announcements=source('services/clinicAnnouncementCronService.ts');
const server=source('server.ts');

// P1 3: browser permission is authoritative, not a locally stored subscription.
assert.match(portal,/const permission = Notification\.permission/);
assert.match(portal,/if \(permission !== 'granted'\) \{[\s\S]{0,140}setNotificationSubscriptionReady\(false\)/);
assert.match(portal,/window\.addEventListener\('focus', refreshOnFocus\)/);
assert.match(portal,/document\.addEventListener\('visibilitychange', refreshOnVisibility\)/);
assert.match(portal,/Notification\.permission === 'denied'/);
assert.match(portal,/setNotificationStatus\('denied'\)/);
assert.match(portal,/checked=\{notificationStatus === 'granted' && notificationSubscriptionReady\}/);
assert.match(portal,/role="alert"[\s\S]{0,280}Bloqueadas pelo navegador/);
assert.match(portal,/ícone de cadeado/);
const deniedCheck=portal.indexOf("if (Notification.permission === 'denied')");
const keyFetch=portal.indexOf("fetch('/api/push/vapid-public-key'",deniedCheck);
assert.ok(deniedCheck>=0&&keyFetch>deniedCheck, 'denied must fail before needless VAPID fetch');

// P1 4: keep the authenticated per-device lifecycle.
assert.match(portal,/navigator\.serviceWorker\.register\('\/sw\.js'\)/);
assert.match(portal,/pushManager\.getSubscription\(\)/);
assert.match(portal,/pushManager\.subscribe\(/);
assert.match(portal,/fetch\('\/api\/push\/subscribe'/);
assert.match(portal,/method: 'DELETE'/);
assert.match(portal,/await clearPushRenewalContext\(\)/);
assert.match(portal,/subscription\.unsubscribe\(\)/);
assert.match(sw,/pushsubscriptionchange/);
assert.match(sw,/fetch\("\/api\/push\/renew"/);
assert.match(push,/export async function renewPatientPushSubscription/);
const unsub=server.slice(server.indexOf('const handlePushUnsubscribe ='),server.indexOf('const handlePushRenew ='));
assert.match(unsub,/PUSH_UNSUBSCRIBE_ROLE_DENIED/);
assert.match(unsub,/\.eq\('user_id', actorUserId\)/);
assert.match(unsub,/\.eq\('deployment_env', vertoDeploymentEnv\)/);
const remover=push.slice(push.indexOf('export async function removePatientPushSubscription'),push.indexOf('export async function deleteInvalidPushSubscription'));
assert.match(remover,/\.eq\('patient_id', patientId\)/);
assert.match(remover,/\.eq\('user_id', actorUserId\)/);
assert.match(remover,/\.eq\('deployment_env', deploymentEnv\)/);

// P1 5: provider jobs/appointment cycles/portal reads are distinct durable layers.
assert.match(cron,/rpc\('claim_due_notification_jobs_v1'/);
assert.match(cron,/rpc\('finalize_notification_jobs_v1'/);
assert.match(cron,/rpc\('upsert_portal_notifications_batch_v1'/);
assert.match(cron,/validateClaimedAppointmentReminder\(job, appointment, patient,/);
assert.match(cron,/rpc\('mark_sent_appointment_notification_jobs_v1'/);
assert.match(cron,/buildPortalReminderIdempotencyKey/);
assert.match(cron,/reminderScheduleCycleKey/);
assert.match(announcements,/claim_due_clinic_announcements_v1/);
assert.match(announcements,/materialize_clinic_announcement_portal_notifications_v1/);
assert.match(portal,/const dedupePortalNotifications/);
assert.match(portal,/markPortalNotificationRead/);
assert.match(portal,/navigator\.serviceWorker\?\.addEventListener\?\.\('message', refreshFromPush/);

// P1 6: errors are attached to the unfinished draft instead of ephemeral toast alone.
assert.match(anamnesis,/questionErrors, setQuestionErrors/);
assert.match(anamnesis,/setQuestionErrors\(\(prev\) => \(\{ \.\.\.prev, \[sectionId\]: 'Escreva o texto da pergunta/);
assert.match(anamnesis,/pelo menos duas opções diferentes/);
assert.match(anamnesis,/focusQuestionEditor\(sectionId\)/);
assert.match(anamnesis,/aria-invalid=\{Boolean\(questionErrors\[section\.id\]/);
assert.match(anamnesis,/role="alert" className="text-xs font-semibold text-red-700"/);
assert.match(anamnesis,/Confirme ou cancele esta pergunta antes de salvar/);

// P1 7: new template is additive: a new model ID, not an overwrite.
assert.match(anamnesis,/\.\.\.createBlankAnamnesisTemplate\(\),[\s\S]{0,80}selectedTemplateId: null/);
assert.match(anamnesis,/setTemplateEditorIdentity\('new'\)/);
assert.match(anamnesis,/Criar uma nova ficha não altera nem substitui as fichas anteriores/);
assert.match(anamnesis,/A ficha anterior permanece salva e não será sobrescrita/);
console.log('PASS P1 3-7: permission denial, push lifecycle, notification queues, question validation, independent anamnesis');
