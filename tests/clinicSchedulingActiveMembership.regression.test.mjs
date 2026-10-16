import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');

const specials = fs.readFileSync('src/utils/clinicalSpecialties.ts', 'utf8');
const cjs = ts.transpileModule(specials, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
}}).outputText;
const context = { exports: {}, Map, Set, String };
vm.runInNewContext(cjs, context);
const { activeClinicAppointmentSpecialty, clinicalSpecialtyScopeKey } = context.exports;
const activeTo = { role:'therapist', status:'active', clinicSpecialty:'Terapeuta Ocupacional' };
assert.equal(activeClinicAppointmentSpecialty(activeTo), 'Terapeuta Ocupacional');
for (const member of [
  { ...activeTo, status:'pending' },
  { ...activeTo, status:'inactive' },
  { ...activeTo, status:'revoked' },
  { ...activeTo, role:'director' },
  { ...activeTo, role:'coordinator' },
  { ...activeTo, role:'receptionist' },
  { role:'therapist', status:'active', specialty:'Terapeuta Ocupacional' },
  { role:'therapist', status:'active', clinicSpecialty:null, specialty:'Terapeuta Ocupacional' },
  { role:'therapist', status:'active', clinicSpecialty:'ABA' }
]) assert.equal(activeClinicAppointmentSpecialty(member), null);
assert.equal(clinicalSpecialtyScopeKey('ABA'), null);
assert.equal(clinicalSpecialtyScopeKey('Fonoaudiologia'), 'speech_therapy');
assert.equal(clinicalSpecialtyScopeKey('Terapia Ocupacional'), 'occupational_therapy');

const dashboard = fs.readFileSync('src/components/CoordinatorDashboard.tsx','utf8');
const ds = fs.readFileSync('src/services/dataService.ts','utf8');
const migration = fs.readFileSync('supabase/migrations/20261009234000_clinic_schedulable_specialties_v1.sql','utf8');
assert.match(dashboard,/Promise\.all\(\[\s*dataService\.getClinicMembers\(\),\s*dataService\.getClinicSchedulingSpecialties\(workspaceId\)/);
assert.match(dashboard,/clinicSpecialty: activeSpecialtiesById\.get/);
assert.match(dashboard,/const clinicSessionSpecialtyOptions = useMemo\([\s\S]*?activeClinicAppointmentSpecialty\(member\)/);
assert.match(dashboard,/const appointmentProfessionalOptions = useMemo\([\s\S]*?activeClinicAppointmentSpecialty\(member\)/);
assert.match(dashboard,/appointmentProfessionalOptions[\s\S]*?filter\(\(member\) => !sessionApproach \|\| clinicalSpecialtiesMatch/);
assert.match(dashboard,/sessionWeeklySlots\.some\(\(slot\) => !clinicalSpecialtiesMatch/);
assert.match(ds,/fetch\('\/api\/clinic\/scheduling-specialties'/);
assert.match(ds,/result\.clinicId !== clinicId/);
const route = fs.readFileSync('services/groupSessions/clinicSchedulingSpecialtyRoute.ts','utf8');
assert.match(route,/deps\.checkAuth/);
assert.match(route,/deps\.requireAnyClinicCapability/);
assert.match(route,/deps\.currentClinicId\(req\.session\?\.user\)/);
assert.match(route,/\.eq\('clinic_id',clinicId\)\.eq\('status','active'\)\.eq\('role','therapist'\)/);
assert.match(migration,/SECURITY DEFINER SET search_path = ''/);
assert.match(migration,/caller\.user_id = auth\.uid\(\)/);
assert.match(migration,/member\.role = 'therapist'/);
assert.match(migration,/member\.status = 'active'/);
assert.match(migration,/BEFORE INSERT OR UPDATE OF clinic_id, therapist_id, service_type, approach, scheduled_at/);
assert.match(migration,/appointment_clinical_specialty_key_v1\(NEW\.approach\) IS DISTINCT FROM v_appointment_key/);
assert.match(migration,/caller\.role IN \('director'/);
assert.match(migration,/LIMIT 1 FOR SHARE/);
assert.match(migration,/NEW\.service_type IS NULL AND NEW\.approach IS NULL/);
assert.match(migration,/c\.id = NEW\.clinic_id AND c\.is_demo IS TRUE/);
assert.match(migration,/OLD\.service_type IS NOT DISTINCT FROM NEW\.service_type/);
assert.doesNotMatch(migration,/\bUPDATE public\.appointments\s+SET\b|\bDELETE FROM public\.appointments\b/i);
console.log('clinicSchedulingActiveMembership.regression.test.mjs: PASS');
