const baseUrl = String(process.env.ABA_V3_SMOKE_BASE_URL || '').replace(/\/$/, '');
const clinicCookie = String(process.env.ABA_V3_SMOKE_CLINIC_COOKIE || process.env.ABA_V3_SMOKE_COOKIE || '').trim();
const adminCookie = String(process.env.ABA_V3_SMOKE_ADMIN_COOKIE || '').trim();
const organizationId = String(process.env.ABA_V3_SMOKE_ORGANIZATION_ID || '').trim();
const patientId = String(process.env.ABA_V3_SMOKE_PATIENT_ID || '').trim();
const programId = String(process.env.ABA_V3_SMOKE_PROGRAM_ID || '').trim();
const targetId = String(process.env.ABA_V3_SMOKE_TARGET_ID || '').trim();
const sessionId = String(process.env.ABA_V3_SMOKE_SESSION_ID || '').trim();
const expectDark = !['0', 'false', 'no', 'off'].includes(String(process.env.ABA_V3_SMOKE_EXPECT_DARK ?? 'true').trim().toLowerCase());

if (!/^https?:\/\//i.test(baseUrl) || !clinicCookie || !adminCookie || !organizationId || !patientId || !targetId) {
  console.error('Configure ABA_V3_SMOKE_BASE_URL, ABA_V3_SMOKE_CLINIC_COOKIE, ABA_V3_SMOKE_ADMIN_COOKIE, ABA_V3_SMOKE_ORGANIZATION_ID, ABA_V3_SMOKE_PATIENT_ID e ABA_V3_SMOKE_TARGET_ID. ABA_V3_SMOKE_PROGRAM_ID/SESSION_ID são opcionais.');
  process.exit(2);
}

const requestOrigin = new URL(baseUrl).origin;

const request = async (path, cookie, options = {}) => {
  const method = String(options.method || 'GET').toUpperCase();
  const requiresCsrfProof = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Cookie: cookie,
      Accept: 'application/json',
      ...(requiresCsrfProof ? { Origin: requestOrigin, Referer: `${requestOrigin}/` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: 'manual'
  });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return { status: response.status, ok: response.ok, body };
};

const query = new URLSearchParams({ organizationId, targetId });
if (programId) query.set('programId', programId);
const drainQuery = new URLSearchParams({
  organizationId,
  scopeType: programId ? 'TARGET' : 'PATIENT',
  patientId
});
if (programId) {
  drainQuery.set('programId', programId);
  drainQuery.set('targetId', targetId);
}

const snapshotQuery = new URLSearchParams({ organizationId, patientId });
const beforeSnapshot = await request(`/api/aba/v3/admin/preflight-snapshot?${snapshotQuery.toString()}`, adminCookie);

const checks = [];
checks.push(['preflight-snapshot-before', beforeSnapshot]);
checks.push(['chart-catalog', await request(`/api/aba/v3/patients/${encodeURIComponent(patientId)}/chart-catalog?days=30`, clinicCookie)]);
checks.push(['chart-series', await request(`/api/aba/v3/patients/${encodeURIComponent(patientId)}/targets/${encodeURIComponent(targetId)}/chart-series?days=30&limit=30`, clinicCookie)]);
checks.push(['pilot-readiness', await request(`/api/aba/v3/patients/${encodeURIComponent(patientId)}/pilot-readiness?${query.toString()}`, adminCookie)]);
checks.push(['drain-status', await request(`/api/aba/v3/admin/drain-status?${drainQuery.toString()}`, adminCookie)]);
if (sessionId) {
  checks.push(['session-collection-plan', await request(`/api/aba/v3/sessions/${encodeURIComponent(sessionId)}/collection-plan`, clinicCookie, {
    method: 'POST', body: { patient_id: patientId, target_ids: [targetId] }
  })]);
}

const afterSnapshot = await request(`/api/aba/v3/admin/preflight-snapshot?${snapshotQuery.toString()}`, adminCookie);
checks.push(['preflight-snapshot-after', afterSnapshot]);

let failed = false;
for (const [name, result] of checks) {
  const code = result?.body?.code ? ` code=${result.body.code}` : '';
  console.log(`[${result.ok ? 'ok' : 'fail'}] ${name}: HTTP ${result.status}${code}`);
  if (!result.ok || result?.body?.success === false) failed = true;
}

const beforeSnapshotData = beforeSnapshot?.body?.data;
const afterSnapshotData = afterSnapshot?.body?.data;
if (beforeSnapshotData && afterSnapshotData) {
  const beforeFingerprint = String(beforeSnapshotData.scope_fingerprint || '');
  const afterFingerprint = String(afterSnapshotData.scope_fingerprint || '');
  const fingerprintsMatch = Boolean(beforeFingerprint) && beforeFingerprint === afterFingerprint;
  console.log(`[info] preflight fingerprint before=${beforeFingerprint} after=${afterFingerprint} match=${fingerprintsMatch}`);
  if (!fingerprintsMatch) {
    console.error('[fail] O escopo ABA V3 mudou durante o preflight dark. Não avance para rollout.');
    failed = true;
  }
  if (expectDark) {
    if (beforeSnapshotData.rollout_dark !== true || afterSnapshotData.rollout_dark !== true) {
      console.error('[fail] Há rollout V3 habilitado no escopo durante um smoke que deveria estar dark.');
      failed = true;
    }
    if (beforeSnapshotData.darkPreflightProfile !== true || afterSnapshotData.darkPreflightProfile !== true) {
      console.error('[fail] Runtime não está no perfil READ+PREFLIGHT dark esperado.');
      failed = true;
    }
  }
}

const readiness = checks.find(([name]) => name === 'pilot-readiness')?.[1]?.body?.data;
if (readiness) {
  console.log(`[info] readiness=${Boolean(readiness.ready)} blockers=${JSON.stringify(readiness.blockers || [])}`);
  console.log(`[info] runtime=${JSON.stringify(readiness.runtime || {})}`);
  if (expectDark) {
    const runtime = readiness.runtime || {};
    const darkRuntime = runtime.readApiEnabled === true
      && runtime.preflightApiEnabled === true
      && runtime.collectionApiEnabled === false
      && runtime.rolloutAdminEnabled === false
      && runtime.uiBuildFlagEnabled === false;
    if (!darkRuntime) {
      console.error('[fail] runtime não está no perfil de preflight dark esperado.');
      failed = true;
    }
  }
}

const drain = checks.find(([name]) => name === 'drain-status')?.[1]?.body?.data;
if (drain) {
  console.log(`[info] drained=${Boolean(drain.drained)} blockers=${JSON.stringify(drain.blockers || [])}`);
  if (expectDark && !drain.drained) failed = true;
}

const plan = checks.find(([name]) => name === 'session-collection-plan')?.[1]?.body?.data;
if (plan) {
  console.log(`[info] session-plan complete=${Boolean(plan.complete)} targets=${JSON.stringify(plan.targets || [])}`);
  if (plan.complete === false) failed = true;
}

if (failed) process.exit(1);
console.log('[ok] ABA V3 pre-production smoke passed. Scope fingerprint remained unchanged and no rollout state was mutated.');
