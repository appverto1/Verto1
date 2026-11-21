import assert from 'node:assert/strict';
import { createAbaSessionStartHandler, createAbaSessionCompleteHandler, createAbaSessionPatchHandler } from '../services/abaSessionWriteHandlers';
import { createPatientListHandler, createPatientRegistrationHandler, createPatientDemographicsWriteHandler } from '../services/patientRegistryHandlers';
import { createProfessionalOnboardingCompletionHandler, createProfessionalProfileSaveHandler } from '../services/professionalProfileWriteHandlers';
import { createPatientFilePermissionsReadHandler, createPatientFilePermissionsWriteHandler, createPatientFileAuditedAccessHandler, createPatientFileUploadHandler, createPatientFileDeleteHandler } from '../services/patientFileOperationsHandlers';

function mockResponse() {
  const res: any = { code: 200, body: undefined };
  res.status = (code: number) => { res.code = code; return res; };
  res.json = (body: any) => { res.body = body; return res; };
  return res;
}
const ident = (v: unknown) => String(v ?? '');
{
  const res = mockResponse();
  await createPatientListHandler(() => ({ sanitizeString: ident, isUuid: () => true, parseBoundedListLimit: () => 200 }))({ query: {}, session: { user: {} } }, res);
  assert.equal(res.code, 403, 'Patient listing must require authoritative capability context');
  assert.equal(res.body.error, 'CLINIC_CAPABILITY_CONTEXT_REQUIRED');
}
{
  const res = mockResponse();
  await createProfessionalOnboardingCompletionHandler(() => ({}))({ params: { userId: 'victim' }, session: { user: { id: 'attacker' } } }, res);
  assert.equal(res.code, 401, 'Professional onboarding must reject mismatched account identifiers');
}
{
  const res = mockResponse();
  await createPatientFilePermissionsReadHandler(() => ({ sanitizeString: ident, currentClinicId: () => 'clinic', isUuid: () => false }))({ params: { patientId: 'bad', fileId: 'bad' }, session: { user: { id: 'actor' } } }, res);
  assert.equal(res.code, 400, 'File permission reads must reject invalid UUIDs before any database call');
}
{
  const res = mockResponse();
  await createPatientFilePermissionsWriteHandler(() => ({ enforcePayloadLimit: () => true, sanitizeString: ident, currentClinicId: () => 'clinic', isPatientFileAccessScope: () => false }))({ params: { patientId: 'p', fileId: 'f' }, body: { accessScope: 'BAD' }, session: { user: { id: 'actor' } } }, res);
  assert.equal(res.code, 400, 'File permission writes must reject invalid access scopes before persistence');
  assert.equal(res.body.code, 'PATIENT_FILE_ACCESS_SCOPE_INVALID');
}
{
  const res = mockResponse();
  await createAbaSessionPatchHandler(() => ({ enforcePayloadLimit: () => true, sanitizeString: ident, currentClinicId: () => 'clinic', normalizeAbaSessionStatus: () => 'completed' }))({ params: { sessionId: 'session' }, body: { status: 'completed' }, session: { user: { id: 'actor' } } }, res);
  assert.equal(res.code, 409, 'ABA PATCH must never bypass atomic completion');
  assert.equal(res.body.code, 'USE_ATOMIC_SESSION_COMPLETION');
}
{
  const res = mockResponse();
  await createProfessionalProfileSaveHandler(() => ({}))({ params: { userId: 'victim' }, session: { user: { id: 'attacker' } } }, res);
  assert.equal(res.code, 403, 'Profile Save must reject another account');
}
{
  const res = mockResponse();
  await createPatientFileAuditedAccessHandler(() => ({ enforcePayloadLimit: () => true, sanitizeString: ident, currentClinicId: () => 'clinic', isUuid: () => false }))({ params: { patientId: 'bad', fileId: 'file' }, body: { action: 'VIEW' }, session: { user: { id: 'actor' } } }, res);
  assert.equal(res.code, 400, 'Audited file access must validate patient ID');
}
{
  const res = mockResponse();
  await createPatientFileUploadHandler(() => ({ enforcePayloadLimit: () => false }))({ headers: {}, session: { user: {} } }, res);
  assert.equal(res.body, undefined, 'Upload rejected by size gate must not call storage');
}
console.log('Clinical extraction safety checks PASS');
