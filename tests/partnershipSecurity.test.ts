import assert from 'node:assert/strict';
import test from 'node:test';
import { registerPartnershipRoutes } from '../services/partnerships/partnershipRoutes';
import { createSensitiveApiMutationProtectionMiddleware, isExternalPreAuthMutationPath } from '../src/utils/sensitiveApiMutationProtection.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const partnerId = '22222222-2222-4222-8222-222222222222';
const leadId = '33333333-3333-4333-8333-333333333333';
const email = 'partner@example.test';
const account = { id: partnerId, user_id: null, display_name: 'Parceiro',
  contact_email: email, partner_kind: 'external', referral_code: 'VERTO-0123456789ABCDEF01',
  status: 'approved', compliance_approved: true, created_at: '2026-11-10T12:00:00Z' };

function fixture(options: { auth?: any; account?: any; rpc?: any; memberships?: any[]; insertError?: any } = {}) {
  const calls: any[] = [];
  const routes: Record<string, any[]> = {};
  const app: any = {};
  for (const method of ['get', 'post', 'patch']) {
    app[method] = (path: string, ...handlers: any[]) => { routes[method.toUpperCase() + ' ' + path] = handlers; };
  }
  const supabase = {
    auth: { getUser: async () => options.auth || {
      data: { user: { id: userId, email, email_confirmed_at: '2026-11-10T12:00:00Z' } },
      error: null,
    } },
    from: (table: string) => {
      const query: any = { filters: {} };
      query.select = () => query;
      query.insert = (values: any) => { calls.push({ type: 'insert', table, values }); return query; };
      query.single = async () => ({ data: options.insertError ? null : { status: 'pending' }, error: options.insertError || null });
      query.eq = (field: string, value: any) => { query.filters[field] = value; return query; };
      query.in = () => query;
      query.order = () => query;
      query.limit = () => (table === 'clinic_memberships'
        ? Promise.resolve({ data: options.memberships ?? [], error: null }) : query);
      query.maybeSingle = async () => {
        if (table === 'verto_partner_accounts') {
          const current = options.account === undefined ? account : options.account;
          if (query.filters.id && query.filters.id !== current?.id) return { data: null, error: null };
          if (query.filters.contact_email && query.filters.contact_email !== current?.contact_email) return { data: null, error: null };
          if (query.filters.partner_kind && query.filters.partner_kind !== current?.partner_kind) return { data: null, error: null };
          return { data: current, error: null };
        }
        if (table === 'users') return { data: { id: userId, name: 'Profissional', email }, error: null };
        return { data: null, error: null };
      };
      return query;
    },
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      if (options.rpc) return options.rpc;
      return { data: name === 'verto_partner_referral_overview_v1' ?
        [{ referral_id: leadId, clinic_name: 'Clínica Exemplo', lead_status: 'new', has_paid: false,
          referred_at: '2026-11-10T12:00:00Z' }] : true, error: null };
    },
  };
  const checkAuth = () => {};
  const checkPlatformAdmin = () => {};
  registerPartnershipRoutes(app, { supabase, checkAuth, checkPlatformAdmin });
  const req = (body: any = {}, session: any = null): any => ({
    body, session, is: () => 'application/json', params: {},
  });
  const run = async (method: string, path: string, request: any) => {
    const handlers = routes[method + ' ' + path];
    assert.ok(handlers, method + ' ' + path);
    const result: any = { statusCode: 200, headers: {}, body: null };
    const response: any = {
      status(code: number) { result.statusCode = code; return this; },
      setHeader(key: string, value: string) { result.headers[key] = value; return this; },
      json(body: any) { result.body = body; return this; },
    };
    await handlers[handlers.length - 1](request, response);
    return result;
  };
  return { routes, calls, req, run, checkAuth, checkPlatformAdmin };
}

test('unauthenticated partner cannot read the portal or select another partner', async () => {
  const f = fixture();
  const denied = await f.run('GET', '/api/partnerships/portal', f.req({}, {}));
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.body.error, 'PARTNER_LOGIN_REQUIRED');
});

test('only verified Supabase email matching a registered external partner can create a session', async () => {
  const f = fixture();
  const session: any = { save(cb: any) { cb(null); } };
  const logged = await f.run('POST', '/api/partnerships/auth/session',
    f.req({ accessToken: 'a'.repeat(60) }, session));
  assert.equal(logged.body.success, true);
  assert.equal(session.partnerAccountId, partnerId);
  assert.equal(session.partnerAuthUserId, userId);
  assert.equal(session.partnerEmail, email);
  const ownPortal = await f.run('GET', '/api/partnerships/portal', f.req({}, session));
  assert.equal(ownPortal.body.account.id, partnerId);
  assert.equal(ownPortal.body.referrals.length, 1);
  assert.equal(f.calls[0].args.p_partner_id, partnerId);
  assert.equal(ownPortal.headers['Cache-Control'], 'private, no-store');
});

test('an active clinical session cannot be silently turned into an external partner session', async () => {
  const f = fixture();
  const session: any = { user: { id: userId, role: 'therapist' }, save(cb: any) { cb(null); } };
  const response = await f.run('POST', '/api/partnerships/auth/session',
    f.req({ accessToken: 'a'.repeat(60) }, session));
  assert.equal(response.statusCode, 409);
  assert.equal(session.partnerAccountId, undefined);
});

test('a mismatching or unconfirmed identity fails closed before session creation', async () => {
  const unmatched = fixture({ account: null });
  const req = unmatched.req({ accessToken: 'a'.repeat(60) }, { save(cb: any) { cb(null); } });
  assert.equal((await unmatched.run('POST', '/api/partnerships/auth/session', req)).statusCode, 403);
  const unconfirmed = fixture({ auth: { data: { user: { id: userId, email } }, error: null } });
  assert.equal((await unconfirmed.run('POST', '/api/partnerships/auth/session', req)).statusCode, 401);
});

test('external partner access expires after twelve hours and owner routes retain both guards', async () => {
  const f = fixture();
  const past = Date.now() - 13 * 60 * 60 * 1000;
  const denied = await f.run('GET', '/api/partnerships/portal', f.req({}, {
    partnerAccountId: partnerId, partnerAuthUserId: userId, partnerEmail: email, partnerAuthAt: past,
  }));
  assert.equal(denied.statusCode, 401);
  for (const methodAndPath of [
    'GET /api/owner/partnerships/accounts',
    'POST /api/owner/partnerships/accounts',
    'PATCH /api/owner/partnerships/accounts/:id',
    'POST /api/owner/partnerships/referrals',
  ]) {
    const chain = f.routes[methodAndPath];
    assert.equal(chain[0], f.checkAuth, methodAndPath);
    assert.equal(chain[1], f.checkPlatformAdmin, methodAndPath);
  }
});

test('an owner referral cannot override an ineligible or already attributed lead', async () => {
  const f = fixture({ rpc: { data: false, error: null } });
  const denied = await f.run('POST', '/api/owner/partnerships/referrals',
    f.req({ partnerId, leadId }));
  assert.equal(denied.statusCode, 409);
  assert.equal(denied.body.error, 'REFERRAL_NOT_ELIGIBLE');
});

test('public application collects the login e-mail without creating clinical access', async () => {
  const f = fixture();
  const session: any = { save(cb: any) { cb(null); } };
  const result = await f.run('POST', '/api/partnerships/apply',
    f.req({ contactEmail: email, displayName: 'Parceiro Novo' }, session));
  assert.equal(result.statusCode, 201);
  assert.deepEqual(result.body, { success: true, status: 'pending' });
  const write = f.calls.find(call => call.type === 'insert');
  assert.equal(write.table, 'verto_partner_accounts');
  assert.equal(write.values.contact_email, email);
  assert.equal(write.values.display_name, 'Parceiro Novo');
  assert.equal(write.values.partner_kind, 'external');
  assert.equal(write.values.status, 'pending');
  assert.equal(write.values.compliance_approved, false);
  assert.equal(write.values.user_id, undefined);
  assert.equal(write.values.created_by, undefined);
  assert.match(write.values.referral_code, /^VERTO-[A-F0-9]{18}$/);
  assert.equal(session.partnerAccountId, undefined);
  assert.equal(f.routes['POST /api/partnerships/apply'].length, 2, 'rate limiter required');
});

test('public application rejects clinical sessions, forged authority and invalid e-mails', async () => {
  const f = fixture();
  const body = { contactEmail: email, displayName: 'Parceiro Novo' };
  for (const forged of [
    { ...body, status: 'approved', complianceApproved: true },
    { ...body, user_id: userId },
    { ...body, contactEmail: 'not-an-email' },
    { ...body, displayName: 'A'.repeat(181) },
  ]) {
    assert.equal((await f.run('POST','/api/partnerships/apply', f.req(forged))).statusCode,400);
  }
  const clinical = await f.run('POST', '/api/partnerships/apply',
    f.req(body, { user: { id: userId, role: 'therapist' } }));
  assert.equal(clinical.statusCode, 409);
  assert.equal(f.calls.length, 0);
});

test('duplicate public applications are neutral and never reset an existing approval', async () => {
  const f = fixture({ insertError: { code: '23505' } });
  const result = await f.run('POST', '/api/partnerships/apply', f.req({
    contactEmail: email, displayName: 'Alteração Não Autorizada',
  }));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { success: true, status: 'pending' });
  assert.equal(f.calls.filter(c => c.type === 'insert').length, 1);
});

test('pending or suspended partners cannot create or continue an external partner session', async () => {
  for (const status of ['pending', 'suspended']) {
    const f = fixture({ account: { ...account, status, compliance_approved: status === 'pending' ? false : true } });
    const session: any = { save(cb: any) { cb(null); } };
    const denied = await f.run('POST', '/api/partnerships/auth/session',
      f.req({ accessToken: 'a'.repeat(80) }, session));
    assert.equal(denied.statusCode, 403);
    assert.equal(session.partnerAccountId, undefined);
    assert.equal(denied.body.error, status === 'pending' ? 'PARTNER_APPROVAL_PENDING' : 'PARTNER_ACCESS_DENIED');
    const alreadyLogged: any = {
      partnerAccountId: partnerId, partnerAuthUserId: userId,
      partnerEmail: email, partnerAuthAt: Date.now(),
    };
    const portal = await f.run('GET', '/api/partnerships/portal', f.req({}, alreadyLogged));
    assert.equal(portal.statusCode, 403);
    assert.equal(portal.body.error, 'PARTNER_ACCESS_DENIED');
    assert.equal(f.calls.filter(c => c.name === 'verto_partner_referral_overview_v1').length, 0);
  }
});


test('public partner signup and login reach token validators only from a trusted origin', () => {
  const guard = createSensitiveApiMutationProtectionMiddleware({
    configuredAppBase: () => 'https://appverto.com.br',
  });
  const check = (path: string, method = 'POST', origin = 'https://appverto.com.br') => {
    let status = 200;
    let nextCalled = false;
    let payload: any = null;
    const req: any = {
      method, path, protocol: 'https',
      headers: origin ? { origin } : {},
      cookies: {},
      get: () => 'api.appverto.com.br',
    };
    const res: any = {
      status(code: number) { status = code; return this; },
      json(data: any) { payload = data; return this; },
    };
    guard(req, res, () => { nextCalled = true; });
    return { status, nextCalled, payload };
  };

  for (const path of ['/partnerships/apply', '/partnerships/auth/session']) {
    assert.equal(isExternalPreAuthMutationPath(path), true);
    assert.equal(check(path).nextCalled, true, path + ' must reach its own Supabase token validation');
    const crossSite = check(path, 'POST', 'https://attacker.example');
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.nextCalled, false);
    assert.equal(crossSite.payload.error, 'Origem inválida para operação sensível.');
    assert.equal(check(path, 'POST', '').nextCalled, false);
    assert.equal(check(path, 'PATCH').nextCalled, false);
  }

  for (const path of [
    '/partnerships/auth/logout',
    '/partnerships/marketplace/partner/confirm/11111111-1111-4111-8111-111111111111',
    '/partnerships/apply/other',
    '/owner/partnerships/accounts',
  ]) {
    assert.equal(isExternalPreAuthMutationPath(path), false);
    const blocked = check(path);
    assert.equal(blocked.nextCalled, false);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.payload.error, 'Requisição sensível sem autenticação válida.');
  }
});
