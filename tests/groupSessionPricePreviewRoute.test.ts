import assert from 'node:assert/strict';
import { registerGroupSessionPricePreviewRoute } from '../services/groupSessions/groupSessionPricePreviewRoute';

const names:string[]=[];
let route:any=null;
const middleware = (...args:any[]) => (req:any,res:any,next:any)=>next?.();
const app:any = {
  post(url:string,...handlers:any[]) {
    names.push(url);
    route=handlers;
  }
};
const capabilities:string[]=[];
const modules:string[]=[];
registerGroupSessionPricePreviewRoute(app,{
  supabase:{ from(){ throw new Error('should not hit DB for invalid payload'); } },
  checkAuth:middleware(), noStoreDynamicResponse:middleware(),
  portalActionLimiter:middleware(),
  requireClinicCapability(capability:string) {capabilities.push(capability);return middleware();},
  requireClinicModule(moduleKey:string) {modules.push(moduleKey);return middleware();},
  currentClinicId() {return 'b138ce3b-e24e-4c26-918b-6b72f8c51f47';},
  enforcePayloadLimit(){return true;}
});
assert.deepEqual(names,['/api/appointments/groups/price-preview']);
assert.deepEqual(capabilities,['patient.demographics.edit','finance.entries.view']);
assert.deepEqual(modules,['appointments_communication']);
assert.equal(route.length,7,'auth/module/capabilities/limiter/no-cache + handler');
const result:any={statusCode:200,body:null};
result.status=function(code:number){this.statusCode=code;return this;};
result.json=function(body:any){this.body=body;return this;};
await route.at(-1)({session:{user:{id:'abc'}},body:{specialty:'Fonoaudiologia',patientIds:['invalid']}},result);
assert.equal(result.statusCode,400);
assert.deepEqual(result.body,{success:false,code:'GROUP_PREVIEW_PATIENTS_INVALID'});
console.log('groupSessionPricePreviewRoute.test.ts: ok');
