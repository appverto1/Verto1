import type { RequestHandler } from 'express';

type HealthRouteDeps = {
  deploymentReleaseId: () => string;
  cleanObject: (value: any) => any;
};

export function createHealthRouteHandler(deps: HealthRouteDeps): RequestHandler {
  const { deploymentReleaseId, cleanObject } = deps;
  return async (_req, res) => {
    const release = deploymentReleaseId();
    return res.json(cleanObject({ status: 'ok', release }));
  };
}
