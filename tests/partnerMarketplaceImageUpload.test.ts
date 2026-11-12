import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { registerPartnershipRoutes } from '../services/partnerships/partnershipRoutes';

const partnerId='33333333-3333-4333-8333-333333333333';
const authId='11111111-1111-4111-8111-111111111111';
const email='parceiro@example.test';
const png=Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOx6ip8AAAAASUVORK5CYII=',
  'base64',
);

function fixture() {
  const routes:Record<string,any[]>={};
  const uploads:any[]=[];
  const app:any={};
  for(const method of ['get','post','patch'])
    app[method]=(path:string,...handlers:any[])=>{routes[method.toUpperCase()+' '+path]=handlers;};
  const supabase:any={
    from(table:string){
      const q:any={
        select(){return q;},
        eq(){return q;},
        maybeSingle:async()=>({data:table==='verto_partner_accounts'
          ?{id:partnerId,partner_kind:'external',status:'approved',compliance_approved:true}:null,error:null}),
      };
      return q;
    },
    storage:{
      from(bucket:string){
        assert.equal(bucket,'verto-partner-images');
        return {
          upload:async(path:string,bytes:Buffer,opts:any)=>{
            uploads.push({path,bytes,opts});
            return {data:{path},error:null};
          },
        };
      },
    },
  };
  registerPartnershipRoutes(app,{supabase,checkAuth:()=>{},checkPlatformAdmin:()=>{}});
  const run=async(path:string,contentType:string,bytes=png,session:any={
    partnerAccountId:partnerId,partnerAuthUserId:authId,partnerEmail:email,partnerAuthAt:Date.now(),
  },length=bytes.length)=>{
    const handlers=routes['POST '+path];
    assert.ok(handlers,path+' registered');
    const req:any=Readable.from([bytes]);
    req.headers={'content-type':contentType,'content-length':String(length)};
    req.params={kind:'photo'};
    req.session=session;
    const result:any={statusCode:200,body:null};
    const res:any={status(n:number){result.statusCode=n;return res;},json(v:any){result.body=v;return res;}};
    await handlers[handlers.length-1](req,res);
    return result;
  };
  return {run,uploads,routes};
}

test('partner image accepts only own authenticated session with genuine image bytes',async()=>{
  const f=fixture();
  const ok=await f.run('/api/partnerships/marketplace/partner/image/:kind','image/png');
  assert.equal(ok.statusCode,201);
  assert.match(ok.body.path,new RegExp('^storage://verto-partner-images/'+partnerId+'/photo-[a-f0-9]{24}\\.png$'));
  assert.equal(f.uploads.length,1);
  assert.equal(f.uploads[0].opts.upsert,false);
  assert.equal(f.uploads[0].bytes.equals(png),true);
});

test('outsider cannot upload, even with a guessed partner identifier',async()=>{
  const f=fixture();
  const denied=await f.run('/api/partnerships/marketplace/partner/image/:kind',
    'image/png',png,{partnerAccountId:partnerId});
  assert.equal(denied.statusCode,401);
  assert.equal(f.uploads.length,0);
});

test('oversize and disguised content are denied before any storage write',async()=>{
  const f=fixture();
  const huge=await f.run('/api/partnerships/marketplace/partner/image/:kind',
    'image/png',png,undefined,10*1024*1024+1);
  assert.equal(huge.statusCode,413);
  const forged=await f.run('/api/partnerships/marketplace/partner/image/:kind','image/jpeg');
  assert.equal(forged.statusCode,400);
  assert.equal(f.uploads.length,0);
});
