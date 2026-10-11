import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createHelpContext } from '../services/helpCenterContext';

const currentClinicId = (user: any) => user?.clinicId === 'clinic-a' ? 'clinic-a' : null;
const helpContext = createHelpContext(currentClinicId);
const request = {
  session: { user: { id: 'user-a', role: 'biller', clinicId: 'clinic-a', clinicName: 'Fallback clinic' } },
  authorizationContext: {
    role: 'Director', userId: 'authorized-user', membershipId: 'membership-a', clinicName: 'Clinic A',
    capabilities: new Set(['clinic.view', 'help.view']), modules: ['mod-z', 'mod-a'],
  },
};
const ctx = helpContext(request);
assert.equal(ctx.clinicId, 'clinic-a');
assert.equal(ctx.audience, 'director');
assert.equal(ctx.clinicName, 'Clinic A');
assert.equal(ctx.userId, 'authorized-user');
assert.equal(ctx.membershipId, 'membership-a');
assert.deepEqual(ctx.capabilities, ['clinic.view', 'help.view']);
assert.deepEqual(ctx.modules, ['mod-z', 'mod-a']);
const hash = (caps: string[], modules: string[]) => createHash('sha256').update(JSON.stringify(['authorized-user', 'clinic-a', 'membership-a', 'director', [...caps].sort(), [...modules].sort()])).digest('hex');
assert.equal(ctx.contextKey, hash(ctx.capabilities, ctx.modules));
assert.equal(helpContext({...request, authorizationContext: {...request.authorizationContext, capabilities: ['help.view', 'clinic.view'], modules: ['mod-a', 'mod-z']}}).contextKey, ctx.contextKey);
assert.equal(helpContext({...request, session: {user: {...request.session.user, clinicId: 'clinic-b'}}}).clinicId, null);
const fallback = helpContext({session:{user:{id:'user-b',role:'THERAPIST',clinicId:'clinic-a',activeAccessContext:{clinicName:'From active'}}}});
assert.equal(fallback.audience,'therapist');
assert.equal(fallback.clinicName,'From active');
assert.deepEqual(fallback.capabilities,[]);
assert.deepEqual(fallback.modules,[]);
assert.equal(fallback.userId,'user-b');
assert.equal(fallback.membershipId,'');
console.log('helpCenterContext.test: PASS');
