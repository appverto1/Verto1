import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const admin = fs.readFileSync('src/components/AdminDashboard.tsx', 'utf8');

const createPatient = server.match(/app\.post\('\/api\/patients\/create-user'[\s\S]*?const isAuthEmailAlreadyRegisteredError/)?.[0] || '';
assert.match(createPatient, /requireClinicCapability\('patient\.create'\)/);
assert.match(createPatient, /req\.authorizationContext\?\.clinicId \|\| currentClinicId\(req\.session\.user\)/);
assert.doesNotMatch(createPatient, /req\.session\.user\?\.clinicId \|\| req\.session\.user\?\.id/);

const confirmation = server.match(/app\.get\('\/api\/appointments\/:appointmentId\/confirmation'[\s\S]*?const handleAppointmentStatusUpdate/)?.[0] || '';
assert.match(confirmation, /resolveClinicCapabilityContext\(actor\)/);
assert.match(confirmation, /authorizationContext\.clinicId !== appointmentClinicId/);
assert.match(confirmation, /calendar\.clinic\.view/);
assert.match(confirmation, /calendar\.team\.view/);
assert.match(confirmation, /calendar\.own\.view/);
assert.match(confirmation, /appointmentProfessionalId !== authorizationContext\.userId/);

assert.match(server, /app\.get\('\/api\/clinic\/dre', checkAuth, requireClinicCapability\('finance\.reports\.view'\)/);
assert.match(server, /CLINIC_DRE_NOT_IMPLEMENTED/);
assert.doesNotMatch(server, /Mock data for now/);
assert.doesNotMatch(server, /'Dra\. Raísa': 8500\.00/);
assert.match(server, /app\.post\('\/api\/protocol-import-requests', checkAuth, requireClinicCapability\('aba\.program\.edit'\)/);
assert.match(server, /app\.get\('\/api\/protocol-import-requests', noStoreDynamicResponse, checkAuth, requireClinicCapability\('aba\.program\.view'\)/);
assert.match(server, /app\.delete\('\/api\/protocol-import-requests\/:requestId', checkAuth, requireClinicCapability\('aba\.program\.edit'\)/);
assert.match(server, /ADMIN_REFUND_NOT_IMPLEMENTED/);
assert.match(server, /ADMIN_CHARGE_NOT_IMPLEMENTED/);
assert.doesNotMatch(server, /Reembolso processado com sucesso \(Simulado\)/);
assert.doesNotMatch(server, /Cobrança iniciada com sucesso \(Simulado\)/);
assert.match(admin, /Reembolso manual não está disponível/);
assert.match(admin, /Cobrança manual não está disponível/);


const profileRead = server.match(/app\.get\('\/api\/profile\/:userId'[\s\S]*?app\.get\('\/api\/profile\/:userId\/media'/)?.[0] || '';
assert.match(profileRead, /sanitizeString\(req\.session\.user\?\.id, 120\) !== sanitizeString\(req\.params\.userId, 120\)/);
assert.doesNotMatch(profileRead, /req\.session\.user\.role !== 'coordinator'/);
const profileMedia = server.match(/app\.get\('\/api\/profile\/:userId\/media'[\s\S]*?app\.post\('\/api\/profile\/:userId'/)?.[0] || '';
assert.match(profileMedia, /requesterId !== targetUserId/);
assert.doesNotMatch(profileMedia, /requesterRole !== 'coordinator'/);
const patientPhotoView = server.match(/app\.get\('\/api\/storage\/patient-photos\/view'[\s\S]*?app\.post\(\s*'\/api\/patients\/:id\/resend-activation'/)?.[0] || '';
assert.match(patientPhotoView, /ownerUserId === actorId/);
assert.match(patientPhotoView, /verifyProfessionalProfilePhotoAccess/);
assert.doesNotMatch(patientPhotoView, /\['admin', 'owner', 'director', 'coordinator'\]\.includes\(role\)/);

console.log('productionCriticalAuthorization.test.mjs: ok');

const appSource = fs.readFileSync('src/App.tsx', 'utf8');
assert.match(appSource, /user\.role === 'admin' \|\| user\.role === 'owner'[\s\S]*?<AdminDashboard/);
assert.match(appSource, /Acesso não configurado/);
assert.doesNotMatch(appSource, /user\.role === 'admin' \|\| user\.role === 'owner' \? \([\s\S]*?<AdminDashboard[\s\S]*?\) : \(\s*<AdminDashboard/);
