import { restoreProductionClinicalWrites } from './productionClinicalWriteSource.mjs';
import { readFileSync } from 'node:fs';
import { extractedClinicalArrow, readClinicalServerSource } from './clinicalReadSource.mjs';
export const patientPlanReadManifest = JSON.parse(readFileSync('docs/backend-modularization/20261015-patient-plan-reads.json', 'utf8'));
export function extractedPatientPlanArrow(route) {
  let arrow = extractedClinicalArrow(route);
  for (const [original, annotated] of route.typeOnlyReplacements || []) {
    if (arrow.split(annotated).length !== 2) throw new Error(`Missing type-only annotation ${route.name}`);
    arrow = arrow.replace(annotated, original);
  }
  return arrow;
}
export function restorePatientPlanReads(source) {
  for (const route of patientPlanReadManifest.routes) {
    if (source.split(route.replacement).length !== 2) throw new Error(`Missing/duplicate patient route ${route.name}`);
    source = source.replace(route.replacement, extractedPatientPlanArrow(route));
  }
  return source.replace(patientPlanReadManifest.imports, '');
}
export const readPatientPlanServerSource = () => restoreProductionClinicalWrites(restorePatientPlanReads(readClinicalServerSource()));
