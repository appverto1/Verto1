const baseUrl = String(process.env.ABA_V3_SMOKE_BASE_URL || '').replace(/\/$/, '');
const clinicCookie = String(process.env.ABA_V3_SMOKE_CLINIC_COOKIE || process.env.ABA_V3_SMOKE_COOKIE || '').trim();
const adminCookie = String(process.env.ABA_V3_SMOKE_ADMIN_COOKIE || clinicCookie).trim();
const organizationId = String(process.env.ABA_V3_SMOKE_ORGANIZATION_ID || '').trim();
const patientId = String(process.env.ABA_V3_SMOKE_PATIENT_ID || '').trim();
const targetId = String(process.env.ABA_V3_SMOKE_TARGET_ID || '').trim();

if (!/^https?:\/\//i.test(baseUrl) || !clinicCookie || !adminCookie || !organizationId || !patientId) {
  console.error('Configure ABA_V3_SMOKE_BASE_URL, ABA_V3_SMOKE_CLINIC_COOKIE, ABA_V3_SMOKE_ADMIN_COOKIE, ABA_V3_SMOKE_ORGANIZATION_ID e ABA_V3_SMOKE_PATIENT_ID. ABA_V3_SMOKE_TARGET_ID é opcional.');
  process.exit(2);
}

const request = async (path, cookie) => {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Cookie: cookie, Accept: 'application/json' },
    redirect: 'manual'
  });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return { status: response.status, ok: response.ok, body };
};

const checks = [];
checks.push(['chart-catalog', await request(`/api/aba/v3/patients/${encodeURIComponent(patientId)}/chart-catalog?days=30`, clinicCookie)]);
checks.push(['pilot-readiness', await request(`/api/aba/v3/patients/${encodeURIComponent(patientId)}/pilot-readiness?organizationId=${encodeURIComponent(organizationId)}${targetId ? `&targetId=${encodeURIComponent(targetId)}` : ''}`, adminCookie)]);
if (targetId) {
  checks.push(['chart-series', await request(`/api/aba/v3/patients/${encodeURIComponent(patientId)}/targets/${encodeURIComponent(targetId)}/chart-series?days=30&limit=30`, clinicCookie)]);
}

let failed = false;
for (const [name, result] of checks) {
  const code = result?.body?.code ? ` code=${result.body.code}` : '';
  console.log(`[${result.ok ? 'ok' : 'fail'}] ${name}: HTTP ${result.status}${code}`);
  if (!result.ok || result?.body?.success === false) failed = true;
}

const readiness = checks.find(([name]) => name === 'pilot-readiness')?.[1]?.body?.data;
if (readiness) {
  console.log(`[info] readiness=${Boolean(readiness.ready)} blockers=${JSON.stringify(readiness.blockers || [])}`);
  console.log(`[info] runtime=${JSON.stringify(readiness.runtime || {})}`);
}

if (failed) process.exit(1);
console.log('[ok] ABA V3 pilot read-only smoke passed. No rollout state was mutated.');
