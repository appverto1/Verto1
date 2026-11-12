import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const read=(path)=>readFileSync(path,'utf8');
const compiled=ts.transpileModule(read('src/utils/patientProfileType.ts'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
}).outputText;
const {resolvePatientPortalKind}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));

// An explicitly saved portal wins over demographic age and prior category.
const saved=(profile,age,patient_group)=>({
  patient_profile_type:profile,panel_type:profile,
  type:profile==='KIDS'?'kids_tea':profile==='ABA'?'adult_tea':'adult_conventional',
  age,patient_group,
});
assert.equal(resolvePatientPortalKind(saved('ADULT',8,'adulto')),'ADULT_CONVENTIONAL');
assert.equal(resolvePatientPortalKind(saved('ABA',8,'adulto')),'ADULT_ABA');
assert.equal(resolvePatientPortalKind(saved('KIDS',41,'infantil')),'KIDS');
// Contradictory legacy rows do not become adult before a deliberate Save.
assert.equal(resolvePatientPortalKind(saved('ADULT',8,'infantil')),'KIDS');
assert.equal(resolvePatientPortalKind(saved('ABA',8,'infantil')),'KIDS');
assert.equal(resolvePatientPortalKind(saved('ADULT',41,'adulto')),'ADULT_CONVENTIONAL');
assert.equal(resolvePatientPortalKind(saved('ABA',41,'adulto')),'ADULT_ABA');

// Do not reinterpret partial/stale legacy defaults as a confirmed portal choice.
assert.equal(resolvePatientPortalKind({patient_profile_type:'ADULT',patient_group:'infantil',age:8}),'KIDS');
assert.equal(resolvePatientPortalKind({patient_profile_type:'ADULT',panel_type:'KIDS',type:'kids_tea',age:8}),'KIDS');
assert.equal(resolvePatientPortalKind({age:7}),'KIDS');

const coordinator=read('src/components/CoordinatorDashboard.tsx');
const app=read('src/App.tsx');
const profileRead=read('services/patientPortalRecordReadHandlers.ts');
const detail=read('src/components/PatientDetailView.tsx');
const registry=read('src/components/PatientRegistry.tsx');

assert.match(coordinator,/field === 'patientProfileType'/);
assert.match(coordinator,/grupo: portalProfile === 'KIDS'/);
assert.match(coordinator,/const canonicalProfileType = normalizePatientProfileType\(/);
assert.match(coordinator,/const portal = resolvePatientPortalKind\(patient\)/);
assert.match(coordinator,/const updateResult = await onUpdatePatient\(newPatient\)/);

assert.match(app,/const hasExplicitPortalPatch/);
assert.match(app,/const mustConfirmSavedPatientProfile = mustConfirmPatientCategory \|\| hasExplicitPortalPatch/);
assert.match(app,/requireServerAck: mustConfirmSavedPatientProfile/);
assert.match(app,/hasExplicitPortalPatch && confirmedProfileType !== updatedProfileType/);
assert.match(app,/rollbackOptimisticPatientState\(\)/);
assert.match(app,/const isAdultTask = resolvePatientPortalKind\(patient\) !== 'KIDS'/,
  'new tasks must follow the active portal type');
assert.match(app,/Boolean\(mergedTask.assignedTaskId\)/,
  'old tasks must retain their original storage type after switching portals');
assert.match(app,/const isKid = resolvePatientPortalKind\(targetPatient\) === 'KIDS'/,
  'clinical trial collection must follow the active portal, not demographic age');
assert.match(app,/verifiedPortalProfile \|\| user/,
  'current portal from canonical backend must govern patient tasks on login');
assert.match(app,/effectivePatientPortalKind === 'ADULT_CONVENTIONAL'/);
assert.match(app,/const effectivePatientDashboardUser = useMemo\(/,
  'patient portal props must be stable to prevent repetitive reads');
assert.match(app,/user=\{effectivePatientDashboardUser\}/);
assert.match(app,/patientPortalProfile.patientId/);

assert.match(profileRead,/resolveCanonicalPatientPortalScope\(req.session.user\)/);
assert.match(profileRead,/select\('patient_profile_type,panel_type,type,patient_group,age'\)/);
assert.match(profileRead,/\.eq\('id', portalScope.patientId\)/);
assert.match(profileRead,/\.eq\('clinic_id', portalScope.clinicId\)/);
assert.match(profileRead,/portalProfile: \{/);
assert.doesNotMatch(profileRead,/\.eq\('email',/,'guardian email must never choose a patient profile');

assert.match(registry,/resolvePatientPortalKind\(p\) === 'KIDS'/);
assert.match(detail,/const patientPortalKind = useMemo\(\(\) => resolvePatientPortalKind\(patient\)/);
assert.match(detail,/patientPortalKind === 'KIDS' && activeTab !== 'history'/,
  'old adult assigned tasks are loaded only when pediatric history is opened');
assert.match(detail,/isKidsProfile \|\| familyDiaryEntries.length > 0/,
  'old pediatric family diary remains available on an adult portal');
assert.doesNotMatch(detail,/if \(!isKidsProfile\) return baseHistory;/,
  'legacy family notes must not vanish when changing portal');

console.log('patientPortalAuthoritativeMode.regression: PASS');
