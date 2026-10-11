// Only the original non-production diagnostics handler was moved here.
export function createHealthDetailsHandler(deps: {
  isProd: boolean;
  deploymentReleaseId: () => string | undefined;
  supabase: any;
  getStripe: () => unknown;
}) {
  return async (_req: any, res: any) => {
    const { isProd, deploymentReleaseId, supabase, getStripe } = deps;
    if (isProd) {
      return res.status(404).json({ error: 'Not found' });
    }

    const release = deploymentReleaseId();
    const status: any = {
      release,
      supabase: 'unknown',
      stripe: 'unknown',
      env: {
        NODE_ENV: process.env.NODE_ENV,
        HAS_SUPABASE_URL: !!process.env.SUPABASE_URL,
        HAS_SUPABASE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        HAS_STRIPE_KEY: !!process.env.STRIPE_SECRET_KEY,
        HAS_DATABASE_URL: !!process.env.DATABASE_URL
      }
    };

    try {
      const { error } = await supabase.from('users').select('count', { count: 'exact', head: true });
      status.supabase = error ? `error: ${error.message}` : 'ok';
    } catch (err: any) {
      status.supabase = `exception: ${err.message}`;
    }

    try {
      getStripe();
      status.stripe = 'ok';
    } catch (err: any) {
      status.stripe = `error: ${err.message}`;
    }

    return res.json(status);
  };
}
