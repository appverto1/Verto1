import { readPatientPlanServerSource } from './helpers/patientPlanReadSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  clinicalGraphLegacySnapshotVisibleToActor,
  filterClinicalGraphPlanScopesForActor,
} from '../src/utils/clinicalGraphScope';

const plans = [
  { id: 'pts', mode: 'interdisciplinary', specialty: null },
  { id: 'fono', mode: 'specialty', specialty: 'Fonoaudiólogo' },
  { id: 'to', mode: 'specialty', specialty: 'Terapeuta Ocupacional' },
];

assert.deepEqual(
  filterClinicalGraphPlanScopesForActor(plans, { actorRole: 'therapist', actorSpecialty: 'Fonoaudiologia' }).map((plan) => plan.id),
  ['pts', 'fono'],
  'ordinary therapist graph scope must keep shared PTS plus own specialty only',
);
assert.equal(
  clinicalGraphLegacySnapshotVisibleToActor('Fonoaudiólogo', { actorRole: 'therapist', actorSpecialty: 'Fonoaudiologia' }),
  true,
);
assert.equal(
  clinicalGraphLegacySnapshotVisibleToActor('Terapia Ocupacional', { actorRole: 'therapist', actorSpecialty: 'Fonoaudiologia' }),
  false,
  'legacy planless snapshots from another specialty must fail closed',
);
assert.deepEqual(
  filterClinicalGraphPlanScopesForActor(plans, { actorRole: 'supervisor', actorSpecialty: 'Fonoaudiologia', hasSupervisionAccess: true }).map((plan) => plan.id),
  ['pts', 'fono', 'to'],
  'supervisor may see all specialties only after patient/case supervision authorization has already succeeded',
);
assert.deepEqual(
  filterClinicalGraphPlanScopesForActor(plans, { actorRole: 'coordinator' }).map((plan) => plan.id),
  ['pts', 'fono', 'to'],
);
assert.deepEqual(
  filterClinicalGraphPlanScopesForActor(plans, { actorRole: 'receptionist' }),
  [],
);

const server = readPatientPlanServerSource();
assert.match(server, /req\.patientActorSpecialty\s*=\s*normalizeClinicalSpecialty\(evidence\.activeProfessionalProfile\?\.specialty\)/);
assert.match(server, /const graphVisiblePlanScopes = filterClinicalGraphPlanScopesForActor\(rebacVisiblePlans, graphActorScope\)/);
assert.match(server, /filterTherapeuticPlanProgramsForActor\(programResult\.data \|\| \[\], graphVisiblePlanScopes, accessContext\)/);
assert.match(server, /!planId\s*&&\s*!clinicalGraphLegacySnapshotVisibleToActor\(point\.specialty, graphActorScope\)/);

const createPlanRoute = fs.readFileSync('services/therapeuticPlanCreateHandler.ts', 'utf8');
assert.match(createPlanRoute, /THERAPEUTIC_PLAN_SPECIALTY_MISMATCH/);
assert.match(createPlanRoute, /participantSpecialties\.some/);

console.log('clinicalGraphRoleScopeP0.regression.test.ts: ok');
