import assert from 'node:assert/strict';
import { registerGroupSessionPricePreviewRoute } from '../services/groupSessions/groupSessionPricePreviewRoute';
import { registerGroupSessionBookingPreviewRoute } from '../services/groupSessions/groupSessionBookingPreviewRoute';
import { registerGroupSessionFinancialRateRoutes } from '../services/groupSessions/groupSessionFinancialRateRoutes';

const clinicId = 'b138ce3b-e24e-4c26-918b-6b72f8c51f47';
const actorId = '8ca32b47-a4c2-4766-a068-84d8c1b5c43d';
const noop = (_req: any, _res: any, next: any) => next();
let dbCalls = 0;
type Captured = { method: string; path: string; handlers: any[] };
const captured: Captured[] = [];
const app: any = {
  post(path: string, ...handlers: any[]) { captured.push({method:'POST', path, handlers}); },
  patch(path: string, ...handlers: any[]) { captured.push({method:'PATCH', path, handlers}); }
};
const deps = {
  supabase: {
    from() { dbCalls++; throw new Error('unauthorized DB read'); },
    rpc() { dbCalls++; throw new Error('unauthorized DB write'); },
  },
  portalActionLimiter:noop,
  noStoreDynamicResponse:noop,
  checkAuth:noop,
  requireClinicModule:(_key: string) => noop,
  requireClinicCapability:(capability: string) => (req: any, res: any, next: any) => {
    if (req.allowedCapabilities.has(capability)) return next();
    return res.status(403).json({success:false,code:'CAPABILITY_DENIED'});
  },
  currentClinicId:() => clinicId,
  enforcePayloadLimit:() => true,
};
registerGroupSessionPricePreviewRoute(app, deps);
registerGroupSessionBookingPreviewRoute(app, deps);
registerGroupSessionFinancialRateRoutes(app, deps);

const byPath = (part: string) => {
  const match = captured.find(route => route.path.includes(part));
  assert.ok(match, 'missing route ' + part);
  return match;
};
const run = async (route: Captured, caps: string[]) => {
  const req = {
    session:{user:{id:actorId}},
    allowedCapabilities:new Set(caps),
    params:{ patientId:actorId, planId:actorId },
    body:{groupAmountCents:1000, specialty:'Fonoaudiologia', patientIds:['invalid']},
  };
  const response: any = {
    statusCode:200,
    body:null,
    status(code:number) {this.statusCode=code;return this;},
    json(payload:any) {this.body=payload;return this;},
  };
  for (const handler of route.handlers) {
    if (response.body) break;
    let proceeded=false;
    await handler(req,response,() => {proceeded=true;});
    if (!proceeded) break;
  }
  return response;
};
const price = byPath('price-preview');
const booking = byPath('booking-preview');
const update = byPath('group-rate');

let result=await run(price,['patient.demographics.edit']);
assert.equal(result.statusCode,403,'demographic permission must not reveal individual group prices');
result=await run(booking,['calendar.appointment.create','patient.demographics.edit']);
assert.equal(result.statusCode,403,'booking permission must not reveal financial prices');
result=await run(update,['patient.demographics.edit']);
assert.equal(result.statusCode,403,'demographic permission must not mutate patient group prices');
result=await run(update,['finance.entries.manage']);
assert.equal(result.statusCode,403,'finance access alone does not grant patient-demographic authority');
assert.equal(dbCalls,0,'all denials must run before any database request');

result=await run(price,['patient.demographics.edit','finance.entries.view']);
assert.equal(result.statusCode,400,'authorized price route must reach payload validation');
result=await run(booking,['calendar.appointment.create','patient.demographics.edit','finance.entries.view']);
assert.ok([409,422].includes(result.statusCode),'authorized booking route must reach payload validation');
assert.equal(dbCalls,0,'invalid payloads never spend database queries');
console.log('groupSessionFinancialCapabilityGuard.test.ts: ok');
