import type { RequestHandler } from 'express';

type InternalSchemaStatusDeps = {
  refreshAppointmentActionResolutionSchema: (refresh: boolean) => Promise<any>;
  APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION: string | number;
};

export function createInternalSchemaStatusHandler(deps: InternalSchemaStatusDeps): RequestHandler {
  const { refreshAppointmentActionResolutionSchema, APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION } = deps;
  return async (req: any, res) => {
    const state = await refreshAppointmentActionResolutionSchema(Boolean(req.query?.refresh));
    return res.json({
      success: true,
      data: {
        reschedule: {
          ready: state.approvalReady,
          availabilityReady: state.availabilityReady,
          approvalReady: state.approvalReady,
          expectedVersion: APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION,
          actualVersion: state.schemaVersion,
          reason: state.reason,
          approvalReason: state.approvalReason,
          stage: state.stage,
          retryable: state.retryable,
          checkedAt: state.checkedAt ? new Date(state.checkedAt).toISOString() : null,
          nextCheckAt: state.checkedAt ? new Date(state.checkedAt + state.ttlMs).toISOString() : null,
        }
      }
    });
  };
}
