// Exact original statement block of GET /api/ready; lazy dependencies preserve request-time values.
export function createReadyRouteHandler(getDeps: () => any) {
  return async (_req: any, res: any) => {
    const { deploymentReleaseId, supabase, ensureOtpTableAvailability, sessionPool, requiresDistributedRuntimeState, checkDistributedRuntimeState, isProd, cleanObject } = getDeps();

    const release = deploymentReleaseId();
    const checks = {
      supabase: false,
      otpStorage: false,
      sessionStore: !isProd,
      distributedRuntimeState: !requiresDistributedRuntimeState()
    };

    try {
      const { error } = await supabase
        .from('users')
        .select('id')
        .limit(1);
      checks.supabase = !error;
    } catch {
      checks.supabase = false;
    }

    try {
      checks.otpStorage = await ensureOtpTableAvailability(true);
    } catch {
      checks.otpStorage = false;
    }

    if (sessionPool) {
      try {
        await sessionPool.query('select 1');
        checks.sessionStore = true;
      } catch {
        checks.sessionStore = false;
      }
    }

    if (requiresDistributedRuntimeState()) {
      try {
        checks.distributedRuntimeState = await checkDistributedRuntimeState(supabase);
      } catch {
        checks.distributedRuntimeState = false;
      }
    }

    const ready = checks.supabase && checks.otpStorage && checks.sessionStore && checks.distributedRuntimeState;
    return res.status(ready ? 200 : 503).json(cleanObject({
      status: ready ? 'ready' : 'not_ready',
      release,
      ...(isProd ? {} : { checks })
    }));

  };
}
