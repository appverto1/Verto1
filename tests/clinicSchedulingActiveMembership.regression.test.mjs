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
assert.match(ds,/\.rpc\('clinic_scheduling_specialties_v1', \{ p_clinic_id: clinicId \}\)/);
assert.match(migration,/SECURITY DEFINER SET search_path = ''/);
assert.match(migration,/caller\.user_id = auth\.uid\(\)/);
assert.match(migration,/member\.role = 'therapist'/);
assert.match(migration,/member\.status = 'active'/);
assert.match(migration,/BEFORE INSERT OR UPDATE OF clinic_id, therapist_id, service_type, scheduled_at/);
assert.match(migration,/LIMIT 1 FOR SHARE/);
assert.match(migration,/OLD\.service_type IS NOT DISTINCT FROM NEW\.service_type/);
assert.doesNotMatch(migration,/\bUPDATE public\.appointments\s+SET\b|\bDELETE FROM public\.appointments\b/i);
console.log('clinicSchedulingActiveMembership.regression.test.mjs: PASS');
