from pathlib import Path

SERVER = Path("server.ts")
PROTOCOLS = Path("src/components/Protocols.tsx")
ADMIN = Path("src/components/SuperAdminDashboard.tsx")
TEST = Path("tests/protocolGrantRevokeIntegration.regression.test.mjs")

def replace_one(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 occurrence, found {count}")
    return text.replace(old, new, 1)

def replace_between(text, start_marker, end_marker, replacement, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start + len(start_marker)) if start >= 0 else -1
    if start < 0 or end < 0:
        raise RuntimeError(f"{label}: markers missing ({start}, {end})")
    return text[:start] + replacement + text[end:]

server = SERVER.read_text(encoding="utf-8")
protocols = PROTOCOLS.read_text(encoding="utf-8")
admin = ADMIN.read_text(encoding="utf-8")

merge_fn = """function mergeApprovedProtocolsIntoClinicState(existingProtocols: any[], approvedProtocols: any[]) {
  const activeIdentityKeys = new Set(
    approvedProtocols.flatMap((protocol: any) => buildProtocolIdentityKeys(protocol))
  );
  const existing = normalizeProtocolArrayForRoute(existingProtocols);
  const merged = existing.filter((protocol: any) => {
    const origin = sanitizeString(protocol?.origin, 80).toLowerCase();
    const source = sanitizeString(protocol?.source, 80).toLowerCase();
    const isDerivedApprovedProjection = origin === 'verto_approved_import' || source === 'protocol_import_requests';
    if (!isDerivedApprovedProjection) return true;
    return buildProtocolIdentityKeys(protocol).some((key) => activeIdentityKeys.has(key));
  });
  const removed = existing.length - merged.length;
  const indexByIdentity = new Map<string, number>();
  const registerProtocol = (protocol: any, index: number) => {
    for (const key of buildProtocolIdentityKeys(protocol)) {
      if (!indexByIdentity.has(key)) indexByIdentity.set(key, index);
    }
  };

  merged.forEach(registerProtocol);
  let added = 0;
  let refreshed = 0;

  for (const protocol of approvedProtocols) {
    const keys = buildProtocolIdentityKeys(protocol);
    const existingIndex = keys.map((key) => indexByIdentity.get(key)).find((index) => typeof index === 'number');
    if (typeof existingIndex === 'number') {
      merged[existingIndex] = {
        ...merged[existingIndex],
        ...protocol,
        createdAt: merged[existingIndex]?.createdAt || protocol.createdAt || protocol.importedAt || null
      };
      refreshed += 1;
      registerProtocol(merged[existingIndex], existingIndex);
      continue;
    }
    merged.push(protocol);
    registerProtocol(protocol, merged.length - 1);
    added += 1;
  }

  return { protocols: merged, added, refreshed, removed };
}

"""
server = replace_between(server, "function mergeApprovedProtocolsIntoClinicState", "function buildProtocolAccessScopeKeys", merge_fn, "projection merge")
server = replace_one(server, "const synced = merged.added + merged.refreshed;", "const synced = merged.added + merged.refreshed + merged.removed;", "projection sync count")
server = replace_one(server, "          refreshed: merged.refreshed,\n          skipped:", "          refreshed: merged.refreshed,\n          removed: merged.removed,\n          skipped:", "projection audit removed count")
server = replace_one(server, "      refreshed: merged.refreshed,\n      skipped:", "      refreshed: merged.refreshed,\n      removed: merged.removed,\n      skipped:", "projection return removed count")

revoke_helper = """  const revokeProtocolGrantForRequest = async (params: {
    clinicId: string;
    requestId: string;
    actorId: string;
    actorName?: string | null;
    auditAction: string;
  }) => {
    const clinicId = sanitizeString(params.clinicId, 120);
    const requestId = sanitizeString(params.requestId, 120);
    const actorId = sanitizeString(params.actorId, 120);
    if (![clinicId, requestId, actorId].every(isUuid)) {
      throw new Error('PROTOCOL_GRANT_REVOKE_SCOPE_INVALID');
    }

    const { data: grant, error } = await supabase.rpc('revoke_clinic_protocol_grant_v1', {
      p_actor_id: actorId,
      p_request_id: requestId
    });
    if (error) throw error;

    const protocolSync = await syncApprovedProtocolsToClinicState({
      clinicId,
      performedBy: actorId,
      actorName: sanitizeString(params.actorName, 180) || 'Equipe Verto',
      auditAction: params.auditAction,
      forceAudit: true
    });
    if (protocolSync?.success === false) {
      throw new Error(protocolSync.error || 'PROTOCOL_GRANT_PROJECTION_SYNC_FAILED');
    }

    return { grant, protocolSync };
  };

"""
helper_anchor = "  const summarizePayloadForAudit = (input: any): string => {"
if server.count(helper_anchor) != 1:
    raise RuntimeError("revoke helper insertion anchor invalid")
server = server.replace(helper_anchor, revoke_helper + helper_anchor, 1)

active_old = """      const existingAuthorizedKeys = new Set(
        requests
          .filter((request) => String(request.status || '').toLowerCase() === 'approved')
          .map((request) => normalizeApprovedProtocolKey(request.canonicalKey || identifyVertoProtocolCandidate(request.canonicalName).canonicalKey))
      );"""
active_new = """      const authorizedProtocolKeySet = new Set(authorizedProtocolKeys);
      requests = requests.filter((request) => {
        const status = String(request.status || '').toLowerCase();
        if (status !== 'approved') return true;
        const canonicalKey = normalizeApprovedProtocolKey(
          request.canonicalKey || identifyVertoProtocolCandidate(request.canonicalName).canonicalKey
        );
        return authorizedProtocolKeySet.has(canonicalKey);
      });
      const existingAuthorizedKeys = new Set(
        requests
          .filter((request) => String(request.status || '').toLowerCase() === 'approved')
          .map((request) => normalizeApprovedProtocolKey(request.canonicalKey || identifyVertoProtocolCandidate(request.canonicalName).canonicalKey))
      );"""
server = replace_one(server, active_old, active_new, "clinic active grant filter")

clinic_revoke_route = """  app.post('/api/protocol-import-requests/:requestId/revoke', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('aba.program.edit'), async (req: any, res) => {
    try {
      const requestId = sanitizeString(req.params.requestId, 120);
      const user = req.session.user;
      const actorId = sanitizeString(user?.id || user?.user_id, 120);
      const clinicId = sanitizeString(currentClinicId(user), 120);
      if (!isUuid(requestId) || !isUuid(actorId) || !isUuid(clinicId)) {
        return res.status(400).json({ success: false, error: 'Escopo de revogacao invalido.' });
      }

      const { data: requestRow, error: requestError } = await supabase
        .from('protocol_import_requests')
        .select('id,clinic_id,status,approved_canonical_key')
        .eq('id', requestId)
        .eq('clinic_id', clinicId)
        .limit(1)
        .maybeSingle();
      if (requestError) throw requestError;
      if (!requestRow?.id) {
        return res.status(404).json({ success: false, error: 'Solicitacao de protocolo nao encontrada nesta clinica.' });
      }
      if (sanitizeString(requestRow.status, 40).toLowerCase() !== 'approved') {
        return res.status(409).json({ success: false, error: 'Somente uma liberacao aprovada pode ser revogada.' });
      }

      const canonicalKey = normalizeApprovedProtocolKey(requestRow.approved_canonical_key);
      if (!VERTO_PROTOCOL_BY_KEY.has(canonicalKey)) {
        return res.status(409).json({ success: false, error: 'O grant aprovado nao possui uma chave canonica valida.' });
      }

      const revokeResult = await revokeProtocolGrantForRequest({
        clinicId,
        requestId,
        actorId,
        actorName: sanitizeString(user?.name || user?.email || 'Equipe', 180),
        auditAction: 'sync_revoked_protocols_to_clinic_state'
      });
      const accessMap = await loadProtocolAccessMap();
      const scopeKey = 'clinic:' + clinicId;
      const protocolKeys = accessMap.get(scopeKey) || [];

      await persistActivityLog({
        userId: actorId,
        clinicId,
        actorName: sanitizeString(user?.name || user?.email || 'Equipe', 180),
        title: 'Protocolo removido da biblioteca',
        content: 'Grant ' + canonicalKey + ' revogado para a clinica atual.',
        type: 'protocol_access_updated',
        actionType: 'protocol_grant_revoked',
        payloadDetails: JSON.stringify({ requestId, canonicalKey, enabled: false, updatedAt: new Date().toISOString() })
      });

      return res.json({
        success: true,
        data: {
          requestId,
          canonicalKey,
          protocolKeys,
          revoked: true,
          protocolSync: {
            synced: revokeResult.protocolSync.synced,
            added: revokeResult.protocolSync.added,
            refreshed: revokeResult.protocolSync.refreshed,
            removed: revokeResult.protocolSync.removed
          }
        }
      });
    } catch (error: any) {
      const message = extractSupabaseErrorMessage(error);
      const status = message.includes('required') || message.includes('denied') ? 403
        : message.includes('not_found') ? 404
          : 409;
      logRouteDbError('/api/protocol-import-requests/:requestId/revoke [POST]', error, {
        requestId: sanitizeString(req.params.requestId, 120),
        clinicId: sanitizeString(currentClinicId(req.session?.user), 120)
      });
      return res.status(status).json({ success: false, error: 'Nao foi possivel remover o protocolo da biblioteca.' });
    }
  });

"""
delete_marker = "  app.delete('/api/protocol-import-requests/:requestId', checkAuth, async (req: any, res) => {"
if server.count(delete_marker) != 1:
    raise RuntimeError("clinic DELETE marker invalid")
server = server.replace(delete_marker, clinic_revoke_route + delete_marker, 1)

safe_delete_route = """  app.delete('/api/protocol-import-requests/:requestId', checkAuth, async (req: any, res) => {
    try {
      const requestId = sanitizeString(req.params.requestId, 120);
      const user = req.session.user;
      const userId = sanitizeString(user?.id, 120);
      const clinicId = sanitizeString(currentClinicId(user), 120);
      if (!requestId) {
        return res.status(400).json({ success: false, error: 'Informe a solicitacao de protocolo.' });
      }

      let lookup = supabase
        .from('protocol_import_requests')
        .select('id,status')
        .eq('id', requestId);
      if (isUuid(clinicId)) {
        lookup = lookup.eq('clinic_id', clinicId);
      } else if (userId) {
        lookup = lookup.eq('requester_user_id', userId);
      } else {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }

      const { data: requestRow, error: lookupError } = await lookup.limit(1).maybeSingle();
      if (lookupError) throw lookupError;
      if (!requestRow?.id) {
        return res.status(404).json({ success: false, error: 'Solicitacao de protocolo nao encontrada.' });
      }
      if (sanitizeString(requestRow.status, 40).toLowerCase() === 'approved') {
        return res.status(409).json({
          success: false,
          error: 'A revogacao de protocolo aprovado exige o fluxo canonico de grants.'
        });
      }

      let query = supabase
        .from('protocol_import_requests')
        .delete()
        .eq('id', requestId)
        .neq('status', 'approved');

      if (isUuid(clinicId)) {
        query = query.eq('clinic_id', clinicId);
      } else {
        query = query.eq('requester_user_id', userId);
      }

      const { error } = await query;
      if (error) throw error;

      void persistActivityLog({
        type: 'protocol_import_request_deleted',
        title: 'Solicitacao de protocolo excluida',
        details: 'Solicitacao de protocolo ' + requestId + ' excluida pelo solicitante.',
        userId,
        clinicId,
        payload: { requestId }
      });

      return res.json({ success: true });
    } catch (error: any) {
      logRouteDbError('/api/protocol-import-requests/:requestId [DELETE]', error, {
        requestId: sanitizeString(req.params.requestId, 120)
      });
      return res.status(500).json({ success: false, error: 'Nao foi possivel excluir a solicitacao de protocolo.' });
    }
  });
"""
server = replace_between(server, delete_marker, "\n  app.get('/api/admin/protocol-import-requests'", safe_delete_route, "safe pending request delete")

admin_guard = """      if (!enabled) {
        return res.status(409).json({ success: false, error: 'A revogacao de protocolo exige o fluxo canonico de grants.' });
      }

"""
server = replace_one(server, admin_guard, "", "legacy admin blanket revoke guard")

admin_select_old = """      const { data: requestRow, error: requestError } = await supabase
        .from('protocol_import_requests')
        .select('clinic_id')
        .eq('id', requestId)
        .maybeSingle();"""
admin_select_new = """      const { data: requestRow, error: requestError } = await supabase
        .from('protocol_import_requests')
        .select('clinic_id,status,approved_canonical_key')
        .eq('id', requestId)
        .maybeSingle();"""
server = replace_one(server, admin_select_old, admin_select_new, "admin request scope select")

admin_scope_end = """        return res.status(409).json({ success: false, error: 'A solicitacao nao pertence ao acervo informado.' });
      }

"""
admin_disable = """      if (!enabled) {
        const requestStatus = sanitizeString((requestRow as any)?.status, 40).toLowerCase();
        const approvedProtocolKey = normalizeApprovedProtocolKey((requestRow as any)?.approved_canonical_key);
        if (requestStatus !== 'approved' || !VERTO_PROTOCOL_BY_KEY.has(approvedProtocolKey) || approvedProtocolKey !== protocolKey) {
          return res.status(409).json({ success: false, error: 'O grant informado nao corresponde a uma liberacao aprovada desta clinica.' });
        }
        const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
        if (!isUuid(actorId)) {
          return res.status(401).json({ success: false, error: 'Identidade autenticada obrigatoria para revogar o acervo.' });
        }

        const revokeResult = await revokeProtocolGrantForRequest({
          clinicId: requestClinicId,
          requestId,
          actorId,
          actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Admin Verto', 180),
          auditAction: 'sync_revoked_protocols_to_clinic_state'
        });
        const accessMap = await loadProtocolAccessMap();
        const protocolKeys = accessMap.get(scopeKey) || [];
        const changedProtocol = VERTO_PROTOCOL_BY_KEY.get(approvedProtocolKey);

        await persistActivityLog({
          userId: actorId,
          clinicId: requestClinicId,
          actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Admin Verto', 180),
          title: 'Acervo de protocolos atualizado',
          content: 'Grant ' + approvedProtocolKey + ' revogado para ' + scopeKey + '.',
          type: 'protocol_access_updated',
          actionType: 'protocol_access_updated',
          payloadDetails: JSON.stringify({ scopeKey, protocolKeys, changedProtocolKey: approvedProtocolKey, requestId, enabled: false, updatedAt: new Date().toISOString() })
        });

        return res.json({ success: true, data: {
          scopeKey,
          protocolKeys,
          requestStatus: 'approved',
          canonicalKey: changedProtocol?.key || approvedProtocolKey,
          canonicalName: changedProtocol?.name || approvedProtocolKey,
          revoked: true,
          protocolSync: {
            synced: revokeResult.protocolSync.synced,
            added: revokeResult.protocolSync.added,
            refreshed: revokeResult.protocolSync.refreshed,
            removed: revokeResult.protocolSync.removed
          }
        } });
      }

"""
server = replace_one(server, admin_scope_end, admin_scope_end + admin_disable, "admin canonical disable path")

state_old = "  const [importedProtocolStatuses, setImportedProtocolStatuses] = useState<any[]>([]);"
state_new = """  const [importedProtocolStatuses, setImportedProtocolStatuses] = useState<any[]>([]);
  const [importedProtocolStatusesLoaded, setImportedProtocolStatusesLoaded] = useState(false);"""
protocols = replace_one(protocols, state_old, state_new, "clinic import loaded state")

load_old = """        if (!cancelled) {
          setImportedProtocolStatuses(Array.isArray(data.data) ? data.data : []);
        }
      } catch {
        if (!cancelled) setImportedProtocolStatuses([]);
      }"""
load_new = """        if (!cancelled) {
          setImportedProtocolStatuses(Array.isArray(data.data) ? data.data : []);
          setImportedProtocolStatusesLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setImportedProtocolStatuses([]);
          setImportedProtocolStatusesLoaded(true);
        }
      }"""
protocols = replace_one(protocols, load_old, load_new, "clinic authoritative load state")

handler_new = """  const handleDeleteImportedRequest = async (proto: any) => {
    const requestId = proto?.importRequestId;
    if (!requestId) return;
    const status = String(proto?.requestStatus || 'pending').toLowerCase();
    const message = status === 'approved'
      ? 'Remover "' + proto.title + '" dos protocolos liberados? O historico sera preservado.'
      : 'Excluir a solicitacao de "' + proto.title + '"? Ela sera removida da analise e nao aparecera mais na biblioteca.';
    if (!confirm(message)) return;

    if (String(requestId).startsWith('local-')) {
      setImportedProtocolStatuses((current) => current.filter((item: any) => String(item.id) !== String(requestId)));
      return;
    }

    try {
      const isApproved = status === 'approved';
      const endpoint = isApproved
        ? '/api/protocol-import-requests/' + encodeURIComponent(requestId) + '/revoke'
        : '/api/protocol-import-requests/' + encodeURIComponent(requestId);
      const response = await fetch(endpoint, {
        method: isApproved ? 'POST' : 'DELETE',
        credentials: 'include'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || (isApproved ? 'Nao foi possivel remover o protocolo liberado.' : 'Nao foi possivel excluir a solicitacao.'));
      }
      setImportedProtocolStatuses((current) => current.filter((item: any) => String(item.id) !== String(requestId)));
    } catch (error: any) {
      alert(error?.message || 'Nao foi possivel atualizar a biblioteca de protocolos.');
    }
  };"""
protocols = replace_between(protocols, "  const handleDeleteImportedRequest = async (proto: any) => {", "\n\n  const libraryProtocols =", handler_new, "clinic remove handler")

library_old = """  const libraryProtocols = protocols.map((protocol: any) => {
    if (!protocol?.isApprovedImport) return protocol;
    const { requestStatus, importRequestId, requestCreatedAt, requestReviewedAt, ...libraryProtocol } = protocol;
    return {
      ...libraryProtocol,
      isApprovedImport: false,
      isManualProtocol: false,
      origin: protocol.origin || 'verto_approved_import',
    };
  });"""
library_new = """  const activeApprovedProtocolKeys = new Set(
    importedProtocolStatuses
      .filter((item: any) => String(item.status || '').toLowerCase() === 'approved')
      .map((item: any) => {
        const licensed: any = getLicensedCanonicalProtocolForRequest(item);
        return String(licensed?.canonicalKey || item?.canonicalKey || '').trim();
      })
      .filter(Boolean)
  );
  const libraryProtocols = protocols
    .filter((protocol: any) => {
      if (!importedProtocolStatusesLoaded) return true;
      const origin = String(protocol?.origin || '').toLowerCase();
      const source = String(protocol?.source || '').toLowerCase();
      const isDerivedApprovedProjection = origin === 'verto_approved_import' || source === 'protocol_import_requests';
      if (!isDerivedApprovedProjection) return true;
      const canonicalKey = String(protocol?.canonicalKey || protocol?.id || '').trim();
      return Boolean(canonicalKey && activeApprovedProtocolKeys.has(canonicalKey));
    })
    .map((protocol: any) => {
      if (!protocol?.isApprovedImport) return protocol;
      const { requestStatus, importRequestId, requestCreatedAt, requestReviewedAt, ...libraryProtocol } = protocol;
      return {
        ...libraryProtocol,
        isApprovedImport: false,
        isManualProtocol: false,
        origin: protocol.origin || 'verto_approved_import',
      };
    });"""
protocols = replace_one(protocols, library_old, library_new, "clinic derived projection filter")

admin_old = """    setSavingProtocolAccess(saveKey);
    setProtocolRequests((current) => current.map((item) => (
      item.accessScopeKey === scopeKey
        ? { ...item, authorizedProtocolKeys: nextKeys(item.authorizedProtocolKeys) }
        : item
    )));

    try {"""
admin_new = """    setSavingProtocolAccess(saveKey);
    if (enabled) {
      setProtocolRequests((current) => current.map((item) => (
        item.accessScopeKey === scopeKey
          ? { ...item, authorizedProtocolKeys: nextKeys(item.authorizedProtocolKeys) }
          : item
      )));
    }

    try {"""
admin = replace_one(admin, admin_old, admin_new, "Super Admin disable authority")

test = r"""import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('server.ts', 'utf8');
const protocols = readFileSync('src/components/Protocols.tsx', 'utf8');
const admin = readFileSync('src/components/SuperAdminDashboard.tsx', 'utf8');

assert.match(server, /revokeProtocolGrantForRequest[\s\S]*supabase\.rpc\('revoke_clinic_protocol_grant_v1'/, 'server must invoke canonical revoke RPC');
assert.match(server, /\/api\/protocol-import-requests\/:requestId\/revoke'[\s\S]*requireClinicCapability\('aba\.program\.edit'\)/, 'clinic revoke endpoint must enforce effective capability');
assert.match(server, /\.eq\('id', requestId\)[\s\S]*\.eq\('clinic_id', clinicId\)/, 'clinic revoke must bind request to session clinic');
assert.match(server, /A revogacao de protocolo aprovado exige o fluxo canonico de grants/, 'approved DELETE must remain blocked');
assert.match(server, /\.delete\(\)[\s\S]*\.neq\('status', 'approved'\)/, 'legacy delete must exclude approved requests');
assert.match(server, /authorizedProtocolKeySet[\s\S]*status !== 'approved'[\s\S]*authorizedProtocolKeySet\.has/, 'clinic read model must hide revoked approved requests');
assert.match(server, /isDerivedApprovedProjection[\s\S]*activeIdentityKeys\.has/, 'sync must prune only derived inactive projections');
assert.match(server, /removed: merged\.removed/, 'sync must report projection removals');
assert.match(server, /app\.post\('\/api\/admin\/protocol-access'[\s\S]*if \(!enabled\)[\s\S]*revokeProtocolGrantForRequest/, 'Super Admin disable must use canonical revoke');
assert.doesNotMatch(server, /if \(!enabled\) \{\s*return res\.status\(409\).*fluxo canonico de grants/, 'valid admin revoke must not hit blanket guard');

const handlerStart = protocols.indexOf('const handleDeleteImportedRequest');
const handlerEnd = protocols.indexOf('const activeApprovedProtocolKeys', handlerStart);
const handler = protocols.slice(handlerStart, handlerEnd);
assert.match(handler, /status === 'approved'[\s\S]*\/revoke/, 'approved clinic removal must call revoke endpoint');
assert.match(handler, /method: isApproved \? 'POST' : 'DELETE'/, 'approved revoke and pending delete must stay separate');
assert.ok(handler.indexOf('await fetch') < handler.lastIndexOf('setImportedProtocolStatuses'), 'UI removal must occur after server response');
assert.match(protocols, /importedProtocolStatusesLoaded[\s\S]*isDerivedApprovedProjection[\s\S]*activeApprovedProtocolKeys\.has/, 'local projection must wait for and follow authoritative active grants');

const toggleStart = admin.indexOf('const handleToggleProtocolAccess');
const toggleEnd = admin.indexOf('const handleScanProtocolRequest', toggleStart);
const toggle = admin.slice(toggleStart, toggleEnd);
assert.match(toggle, /if \(enabled\) \{[\s\S]*setProtocolRequests/, 'only enable may retain optimistic preview');
assert.ok(toggle.indexOf('if (enabled)') < toggle.indexOf('await fetch'), 'disable must not mutate state before server authority');
assert.match(toggle, /const savedKeys = Array\.isArray\(data\.data\?\.protocolKeys\)/, 'Super Admin must reconcile saved keys from server');

console.log('protocolGrantRevokeIntegration.regression.test.mjs: ok');
"""
TEST.write_text(test, encoding="utf-8")
SERVER.write_text(server, encoding="utf-8")
PROTOCOLS.write_text(protocols, encoding="utf-8")
ADMIN.write_text(admin, encoding="utf-8")

print("factory-207 patch applied with all anchors verified")
