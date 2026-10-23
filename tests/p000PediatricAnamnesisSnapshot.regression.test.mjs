import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read=(p)=>readFileSync(p,'utf8');
const profileSrc=read('src/utils/patientProfileType.ts');
const compiled=ts.transpileModule(profileSrc,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const profile=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));

assert.equal(profile.resolvePatientProfileTypeForCategory('infantil','ADULT'),'KIDS');
assert.equal(profile.resolvePatientProfileTypeForCategory('adolescente','ADULT'),'KIDS');
assert.equal(profile.resolvePatientProfileTypeForCategory('adulto','ABA'),'ABA');
assert.equal(profile.resolvePatientProfileTypeForCategory('idoso','KIDS'),'ADULT');
assert.equal(profile.resolvePatientPortalKind({patient_group:'infantil',patient_profile_type:'ADULT',age:7}),'KIDS');
assert.equal(profile.resolvePatientPortalKind({patient_group:'adulto',patient_profile_type:'ABA',age:35}),'ADULT_ABA');

const app=read('src/App.tsx');
const snapshot=app.slice(app.indexOf('const buildPatientAnamnesisSnapshot ='),app.indexOf('const enrichUserFromSessionMetadata ='));
assert.match(snapshot,/const canonicalCategory = coalescePatientText\(source\?\.grupo, source\?\.patient_group, source\?\.group, existing\?\.grupo\)/);
assert.match(snapshot,/const canonicalProfile = resolvePatientProfileTypeForCategory\(/);
assert.match(snapshot,/grupo: canonicalCategory/);
assert.match(snapshot,/patientProfileType: canonicalProfile,\s*panelType: canonicalProfile/);
assert.doesNotMatch(snapshot,/patientProfileType: normalizePatientProfileType/,'old ADULT snapshot defaults must not override category');

const data=read('src/services/dataService.ts');
assert.match(data,/group: patient\?\.patient_group \|\| patient\?\.group \|\| recordPayload\?\.grupo \|\| null/,'server-saved group must precede stale offline anamnesis');
assert.match(data,/async confirmPatientCategoryOnServer\(/,'read-back confirms persisted category');
assert.match(app,/requireServerAck: mustConfirmPatientCategory/,'category updates wait for server acknowledgement');
assert.match(app,/confirmPatientCategoryOnServer\(/,'category update read-back must be enforced');

console.log('p000PediatricAnamnesisSnapshot: PASS');
