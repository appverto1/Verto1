import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const hs = server.indexOf('function buildLegacyPortalPatientPhotoRepair');
const he = server.indexOf('async function resolveProfessionalProfilePhotoUrl', hs);
assert.notEqual(hs, -1);
assert.notEqual(he, -1);

const helperSource = server
  .slice(hs, he)
  .replace('function buildLegacyPortalPatientPhotoRepair(patient: any, user: any)', 'function buildLegacyPortalPatientPhotoRepair(patient, user)');
assert.match(helperSource, /explicitPortalPath/);
assert.match(helperSource, /pathFromExistingPortalUrl/);
assert.match(helperSource, /ownerPatientId[\s\S]*!== patientId/);

const extractPatientPhotosStoragePath = (raw) => {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (value.startsWith('/api/storage/patient-photos/view?')) {
    return new URLSearchParams(value.split('?')[1] || '').get('path');
  }
  return value.includes('/') ? value : null;
};
const sanitizeString = (value) => String(value || '').trim();
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
const sanitizeSessionUrl = (value) => String(value || '').trim() || null;
const buildPatientPhotoViewUrl = (path) => path ? `/api/storage/patient-photos/view?path=${encodeURIComponent(path)}` : null;
const buildLegacyPortalPatientPhotoRepair = new Function(
  'sanitizeString',
  'isUuid',
  'extractPatientPhotosStoragePath',
  'sanitizeSessionUrl',
  'buildPatientPhotoViewUrl',
  `${helperSource}; return buildLegacyPortalPatientPhotoRepair;`,
)(sanitizeString, isUuid, extractPatientPhotosStoragePath, sanitizeSessionUrl, buildPatientPhotoViewUrl);

const patientId = '11111111-1111-4111-8111-111111111111';
const otherPatientId = '22222222-2222-4222-8222-222222222222';
const ownedPath = `${patientId}/profile/profile-deadbeef.webp`;
const ownedProxy = `/api/storage/patient-photos/view?path=${encodeURIComponent(ownedPath)}`;

assert.deepEqual(
  buildLegacyPortalPatientPhotoRepair({ id: patientId }, { profilePicture: ownedProxy }),
  { portalProfilePicture: ownedProxy, portalProfilePicturePath: ownedPath },
  'legacy portal media owned by the resolved patient must repair the canonical patient PORTAL fields',
);
assert.equal(
  buildLegacyPortalPatientPhotoRepair({ id: patientId }, { profilePicture: `/api/storage/patient-photos/view?path=${encodeURIComponent(`${otherPatientId}/profile/profile-x.webp`)}` }),
  null,
  'cross-patient media must fail closed',
);
assert.equal(
  buildLegacyPortalPatientPhotoRepair({ id: patientId, portal_profile_picture_path: ownedPath }, { profilePicture: ownedProxy }),
  null,
  'existing canonical PORTAL identity must never be overwritten by legacy repair',
);

const cs = server.indexOf('const resolvePatientPortalContext = async');
const ce = server.indexOf('const readPatientMasteryGrowthEvents', cs);
const context = server.slice(cs, ce);
assert.match(context, /portal_profile_picture,portal_profile_picture_path/);
assert.match(context, /buildLegacyPortalPatientPhotoRepair\(row, user\)/);
assert.match(context, /\.eq\('id', primaryPatientId\)[\s\S]*\.eq\('clinic_id', clinicId\)[\s\S]*\.is\('portal_profile_picture_path', null\)/);
assert.doesNotMatch(context, /(^|[^a-z_])profile_picture_path:\s*legacyPortalPhotoRepair/m);

console.log('patientPortalPhotoCanonicalRepair.regression.test.mjs: ok');
