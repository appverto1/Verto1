// Single-run, fail-closed edit for oversized server.ts. Remove after patch.
import { readFileSync, writeFileSync } from 'node:fs';
const file='server.ts';
const original=readFileSync(file,'utf8');
const before=`  const handlePushUnsubscribe = async (req: any, res: any) => {
    try {
      const subscription = req.body?.subscription || req.body;
      const endpoint = sanitizeString(subscription?.endpoint, 2000);
      const user = req.session.user;
      const isPatientRole = sanitizeString(user?.role, 40).toLowerCase() === 'patient';
      const patientIds = await resolvePatientIdsForPush({
        supabase,
        patientId: sanitizeString(req.body?.patientId || req.body?.patient_id, 120),
        patientEmail: sanitizeEmail(req.body?.patientEmail || req.body?.patient_email || user?.email),
        userId: sanitizeString(user?.id, 120),
        clinicId: isPatientRole ? null : currentClinicId(user)
      });
      const result = await removePatientPushSubscription({
        supabase,
        deploymentEnv: vertoDeploymentEnv,
        patientId: patientIds[0] || '',
        endpoint
      });
      if (!result.success) return res.status(500).json({ success: false, error: result.error });
      return res.json({ success: true });
    } catch (error: any) {
      console.error('[Push] unsubscribe error:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Erro ao remover inscrição push.' });
    }
  };`;
const after=`  const handlePushUnsubscribe = async (req: any, res: any) => {
    try {
      const user = req.session.user;
      if (sanitizeString(user?.role, 40).toLowerCase() !== 'patient') {
        return res.status(403).json({ success: false, error: 'PUSH_UNSUBSCRIBE_ROLE_DENIED' });
      }
      const actorUserId = sanitizeString(user?.id, 120);
      const subscription = req.body?.subscription || req.body;
      const endpoint = sanitizeString(subscription?.endpoint, 2000);
      if (!isUuid(actorUserId) || !endpoint) {
        return res.status(400).json({ success: false, error: 'PUSH_UNSUBSCRIBE_SCOPE_INVALID' });
      }
      // Look up only the signed-in user's endpoint, never resolve a patient from
      // user-controlled IDs or email. Idempotent when absent.
      const { data: owned, error: lookupError } = await supabase
        .from('push_subscriptions')
        .select('patient_id')
        .eq('deployment_env', vertoDeploymentEnv)
        .eq('user_id', actorUserId)
        .eq('endpoint', endpoint)
        .maybeSingle();
      if (lookupError) return res.status(503).json({ success: false, error: 'PUSH_UNSUBSCRIBE_LOOKUP_FAILED' });
      if (!owned?.patient_id) return res.json({ success: true });
      const result = await removePatientPushSubscription({
        supabase,
        deploymentEnv: vertoDeploymentEnv,
        patientId: String(owned.patient_id),
        actorUserId,
        endpoint
      });
      if (!result.success) return res.status(503).json({ success: false, error: result.error });
      return res.json({ success: true });
    } catch (_error: any) {
      return res.status(500).json({ success: false, error: 'Erro ao remover inscrição push.' });
    }
  };`;
if(original.includes('PUSH_UNSUBSCRIBE_ROLE_DENIED')){console.log('Already applied');process.exit(0)}
if(original.split(before).length!==2)throw Error('Unexpected unsubscribe route source; abort');
const updated=original.replace(before,after);writeFileSync(file,updated,'utf8');console.log('Secure scoped unsubscribe installed; other routes unchanged');
