// One-time, fail-closed surgery on the oversized legacy server.ts.
// This script is intentionally removed after its reviewed patch lands.
import { readFileSync, writeFileSync } from 'node:fs';
const file = 'server.ts';
const source = readFileSync(file, 'utf8');
const marker = "  app.post(\n    '/api/aba/v3/trials',";
const route = `  // Persist exposure state without fabricating an ABA V3 trial.
  app.post(
    '/api/aba/v3/target-exposures',
    requireAbaV3CollectionFeature,
    checkAuth,
    requireClinicCapability('aba.trial.record'),
    checkPatientAccess,
    async (req: any, res) => {
      try {
        if (!enforcePayloadLimit(req, res, 16 * 1024, 'Exposição de target ABA V3')) return;
        const patientId = sanitizeString(req.resolvedPatientId || req.body?.patient_id || req.body?.patientId, 120);
        const organizationId = sanitizeString(req.resolvedPatientClinicId || currentClinicId(req.session.user), 120);
        const actorId = sanitizeString(req.session.user?.id, 120);
        const sessionId = sanitizeString(req.body?.session_id || req.body?.sessionId, 180);
        const targetId = sanitizeString(req.body?.target_id || req.body?.targetId, 180);
        const clientEventId = sanitizeString(req.body?.client_event_id || req.body?.clientEventId, 240);
        const status = sanitizeString(req.body?.status, 40).toUpperCase();
        if (!isUuid(patientId) || !isUuid(organizationId) || !isUuid(actorId)
          || !sessionId || !targetId || !clientEventId || status !== 'NO_OPPORTUNITY') {
          return res.status(400).json({ success: false, code: 'ABA_V3_EXPOSURE_INVALID', error: 'Estado de exposição ABA V3 inválido.' });
        }
        const sessionScope = await resolveAbaSessionReadScope(sessionId, req.session.user);
        if (!sessionScope.ok) return res.status((sessionScope as any).status || 404).json({ success: false, error: (sessionScope as any).error });
        if (sanitizeString((sessionScope as any).patientId, 120) !== patientId
          || sanitizeString((sessionScope as any).clinicId, 120) !== organizationId) {
          return res.status(403).json({ success: false, code: 'ABA_V3_COLLECTION_SCOPE_DENIED', error: 'Sessão fora do escopo do paciente.' });
        }
        const writeScope = await assertAbaSessionCanAcceptClinicalWrite(sessionId, organizationId, req.session.user);
        if (!writeScope.ok) return res.status(writeScope.status || 409).json({ success: false, error: writeScope.error });
        const targetReadiness = await assertAbaV3Pr9bTargetReady(organizationId, patientId, targetId);
        if (!targetReadiness.ok) return res.status(targetReadiness.status || 409).json({ success: false, code: targetReadiness.code, error: targetReadiness.error });
        const { data, error } = await supabase.rpc('set_aba_session_target_exposure_v3', {
          p_organization_id: organizationId,
          p_patient_id: patientId,
          p_session_id: sessionId,
          p_target_id: targetId,
          p_status: 'NO_OPPORTUNITY',
          p_reason_code: 'NO_OPPORTUNITY_REPORTED',
          p_reason_text: null,
          p_actor_id: actorId
        });
        if (error) return handleAbaV3CollectionRpcError(res, error);
        if (!data?.id || data.exposure_status !== 'NO_OPPORTUNITY') {
          return res.status(503).json({ success: false, code: 'ABA_V3_EXPOSURE_UNCONFIRMED', error: 'Estado de exposição não confirmado no servidor.' });
        }
        res.setHeader('Cache-Control', 'private, no-store');
        return res.json({ success: true, data: { id: data.id, status: data.exposure_status, stateVersion: data.state_version } });
      } catch (_error: any) {
        return res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
      }
    }
  );

`;
if(source.includes("'/api/aba/v3/target-exposures'")) {
  console.log('Already applied; no duplicate route.');
  process.exit(0);
}
const count = source.split(marker).length - 1;
if(count !== 1) throw new Error('Server insertion anchor changed: expected exactly one match, got ' + count);
const next = source.replace(marker, route + marker);
if(next.length - source.length !== route.length) throw new Error('Unexpected modification length');
writeFileSync(file,next,'utf8');
console.log('Patched one ABA V3 exposure route into server.ts');
