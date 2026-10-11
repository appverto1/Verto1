import type { Express } from 'express';
import { registerClinicalMeasurementV3CatalogRoutes } from './clinicalMeasurementV3CatalogRoutes';
import { registerClinicalMeasurementV3PlanRoutes } from './clinicalMeasurementV3PlanRoutes';
import { registerAbaReinforcerCatalogRoutes } from './abaReinforcerCatalogRoutes';
import type { ClinicalMeasurementV3Deps } from './clinicalMeasurementV3Shared';

export function registerClinicalMeasurementV3Routes(app: Express, deps: ClinicalMeasurementV3Deps) {
  registerClinicalMeasurementV3PlanRoutes(app, deps);
  registerClinicalMeasurementV3CatalogRoutes(app, deps);
  registerAbaReinforcerCatalogRoutes(app, deps);
}
