import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isProfessionalLegalSession,
  ensureProfessionalTermsAccepted,
  registerProfessionalTermsRoutes,
  PROFESSIONAL_TERMS_SHA256,
} from '../services/legalProfessionalTermsRoutes.ts';

const roles = ['owner', 'admin', 'director', 'coordinator', 'supervisor', 'therapist', 'receptionist', 'biller'];
test('LGPD-04: active role, not an arbitrary client profile, controls professional-terms viewing', () => {
  for (const role of roles) assert.equal(isProfessionalLegalSession({ id: 'verified-server-id', role }), true);
  for (const role of ['patient', 'responsible', 'partner', '', null]) {
    assert.equal(isProfessionalLegalSession({ id: 'verified-server-id', role }), false);
  }
  assert.equal(isProfessionalLegalSession({ role: 'therapist' }), false);
  assert.match(PROFESSIONAL_TERMS_SHA256, /^[a-f0-9]{64}$/);
});

const createResult = () => ({
  statusCode: 200, headers: {} as Record<string, string>, response: null as any,
  status(code: number) { this.statusCode = code; return this; },
  setHeader(name: string, value: string) { this.headers[name] = value; return this; },
  type(value: string) { this.headers['Content-Type'] = value; return this; },
  send(value: unknown) { this.response = value; return this; },
  json(value: unknown) { this.response = value; return this; },
});

test('LGPD-04: direct GET is denied to patients, unauthenticated and expired/wrong invitations', async () => {
  const endpoints = new Map<string, Array<(req: any, res: any, next: () => unknown) => unknown>>();
  const app = { get(route: string, ...handlers: any[]) { endpoints.set(route, handlers); } };
  let dbReadCount = 0;
  const supabase = {
    from(table: string) {
      assert.equal(table, 'invitations');
      return {
        select(columns: string) { assert.equal(columns, 'email,status,expires_at'); return this; },
        eq() { return this; },
        async maybeSingle() {
          dbReadCount += 1;
          return { data: { email: 'pro@example.com', status: 'pending', expires_at: '2099-01-01T00:00:00Z' }, error: null };
        },
      };
    },
  };
  const checkAuth = (req: any, res: any, next: () => unknown) =>
    req.session?.user ? next() : res.status(401).json({ error: 'SERVER_SESSION_REQUIRED' });
  registerProfessionalTermsRoutes(app, { checkAuth, supabase });
  const handlers = endpoints.get('/api/legal/professional-terms')!;
  assert.equal(handlers.length, 3);
  const request = async (user?: any, query?: any) => {
    const req = { session: user ? { user } : null, query };
    const res = createResult();
    const nextAt = async (n: number): Promise<void> => {
      if (n >= handlers.length) return;
      await handlers[n](req, res, () => nextAt(n + 1));
    };
    await nextAt(0);
    return res;
  };
  const id = '123e4567-e89b-42d3-a456-426614174000';
  assert.equal((await request()).statusCode, 401);
  assert.equal((await request({ id: id, role: 'patient', email: 'pro@example.com' })).statusCode, 403);
  assert.equal((await request({ id: id, role: 'patient', email: 'attacker@example.com' }, { invitation_id: id })).statusCode, 403);
  assert.equal((await request({ id: id, role: 'therapist', email: 'pro@example.com' })).statusCode, 200);
  const allowed = await request({ id: id, role: 'patient', email: 'pro@example.com' }, { invitation_id: id });
  assert.equal(allowed.statusCode, 200);
  assert.match(String(allowed.response), /TERMOS DE USO DOS PROFISSIONAIS/);
  assert.equal(allowed.headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.equal(dbReadCount, 2);
});

test('LGPD-04: already-accepted onboarding does not write duplicate evidence', async () => {
  let writes = 0;
  const supabase = {
    from() { return {
      select() { return this; }, eq() { return this; }, limit() { return this; },
      async maybeSingle() { return { data: { user_id: 'verified' }, error: null }; },
      async upsert() { writes += 1; return { error: null }; },
    }; },
  };
  const previous = await ensureProfessionalTermsAccepted({
    supabase, userId: 'verified', explicitlyAccepted: false, contextKey: 'onboarding',
  });
  assert.equal(previous, true);
  assert.equal(writes, 0);
});

test('LGPD-04: explicit onboarding acceptance persists once with trusted document hash', async () => {
  let payload: any = null;
  const supabase = {
    from(table: string) {
      assert.equal(table, 'user_legal_acceptances');
      return {
        async upsert(record: any, opts: any) {
          payload = { record, opts };
          return { error: null };
        },
      };
    },
  };
  const stored = await ensureProfessionalTermsAccepted({
    supabase, userId: 'verified-user', explicitlyAccepted: true, contextKey: 'professional-onboarding',
  });
  assert.equal(stored, true);
  assert.equal(payload.record.user_id, 'verified-user');
  assert.equal(payload.record.document_sha256, PROFESSIONAL_TERMS_SHA256);
  assert.equal(payload.record.document_version, 'v1.1');
  assert.equal(payload.record.context_key, 'professional-onboarding');
  assert.equal(payload.opts.ignoreDuplicates, true);
});
