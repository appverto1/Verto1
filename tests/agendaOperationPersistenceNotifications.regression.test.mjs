import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const cron = fs.readFileSync(new URL('../services/cronService.ts', import.meta.url), 'utf8');
const push = fs.readFileSync(new URL('../services/pushNotificationService.ts', import.meta.url), 'utf8');
const dataService = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/components/CoordinatorDashboard.tsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260819134500_clinic_announcements_and_room_persistence.sql', import.meta.url), 'utf8');

assert.match(dataService, /getClinicRooms\(\)/);
assert.match(dataService, /createClinicRoom/);
assert.match(dataService, /updateClinicRoom/);
assert.match(app, /canonicalRoomsResult = await dataService\.getClinicRooms\(\)/);
assert.match(app, /clinic_rooms is canonical/);
assert.match(dashboard, /await dataService\.createClinicRoom/);
assert.match(dashboard, /await dataService\.updateClinicRoom/);
assert.doesNotMatch(dashboard.slice(dashboard.indexOf('const handleAddRoom'), dashboard.indexOf('const handleSaveClinicSettings')), /crypto\.randomUUID\(\).*setRooms/s);

const roomPatch = server.slice(server.indexOf("app.patch('/api/clinic/rooms/:roomId'"), server.indexOf("app.delete('/api/clinic/rooms/:roomId'"));
assert.match(roomPatch, /organization_id/);
assert.match(roomPatch, /clinic_id/);
assert.match(roomPatch, /Sala não encontrada nesta clínica/);

assert.match(cron, /'\* \* \* \* \*'/);
assert.match(cron, /QUIET_HOURS_START = 22/);
assert.match(cron, /QUIET_HOURS_END = 6/);
assert.match(cron, /getReminderDeliveryDueUtc/);
assert.match(cron, /buildReminderCandidateWindows/);
assert.match(cron, /Execução adiada pelo horário de não perturbe/);
assert.match(cron, /if \(step\.kind === '12h'\)[\s\S]*hasPatientResponse/);
assert.match(cron, /hoursBefore: 24/);
assert.match(cron, /hoursBefore: 12/);

assert.match(server, /\/api\/clinic\/announcements/);
assert.match(server, /communication\.clinic_notifications\.manage/);
assert.match(server, /requireClinicModule\('appointments_communication'\)/);
assert.match(push, /notificationType: 'clinic_announcement'/);
assert.match(server, /findPushSubscriptionsForRecipients/);
assert.match(push, /sendPatientPortalNotification/);
assert.match(dashboard, /<ClinicAnnouncementsPanel/);
assert.match(dashboard, /id: "notices", label: "Avisos"/);
assert.match(server, /latestPendingAppointmentReminder,[\s\S]*appointment_reminder/);

assert.match(migration, /create table if not exists public\.clinic_announcements/);
assert.match(migration, /create table if not exists public\.clinic_announcement_recipients/);
assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all on table public\.clinic_announcements from anon, authenticated/);
assert.match(migration, /grant all on table public\.clinic_announcements to service_role/);
assert.match(migration, /create or replace function public\.create_clinic_announcement_delivery_v1/);
assert.match(migration, /security definer/);
assert.match(migration, /insert into public\.portal_notifications/);
assert.match(migration, /grant execute on function public\.create_clinic_announcement_delivery_v1/);
assert.match(server, /create_clinic_announcement_delivery_v1/);
assert.match(server, /push counters update failed after atomic portal delivery/);

console.log('agendaOperationPersistenceNotifications.regression.test.mjs: ok');
