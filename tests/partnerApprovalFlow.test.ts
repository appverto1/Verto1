import assert from 'node:assert/strict';
import test from 'node:test';
import { registerPartnershipRoutes } from '../services/partnerships/partnershipRoutes';

const partnerId = '33333333-3333-4333-8333-333333333333';
const ownerId = '11111111-1111-4111-8111-111111111111';

const fixture = (deliveryFails = false) => {
  let account: any = {
    id: partnerId, partner_kind: 'external', display_name: 'Parceiro Teste',
    contact_email: 'parceiro@example.test', status: 'pending', compliance_approved: false,
    approval_email_sent_at: null,
  };
  const emails: string[] = [];
  const routes: Record<string, any[]> = {};
  const app: any = {};
  for (const method of ['post','patch','get']) {
    app[method] = (path:string,...handlers:any[]) => { routes[method.toUpperCase()+' '+path] = handlers; };
  }
  const supabase: any = {
    from(table:string) {
      assert.equal(table,'verto_partner_accounts');
      const filters:Record<string,any> = {};
      let updated:Record<string,any>|null = null;
      const q:any = {
        select(){return q;},
        eq(key:string,value:unknown){filters[key] = value;return q;},
        update(values:Record<string,any>){updated=values;return q;},
        maybeSingle:async()=>{
          if(filters.id && filters.id!==account.id)return {data:null,error:null};
          if(updated && filters.status && filters.status!==account.status)return {data:null,error:null};
          if(updated)account={...account,...updated};
          return {data:{...account},error:null};
        },
        then(resolve:any) {
          if(updated && (!filters.status || filters.status===account.status))account={...account,...updated};
          return Promise.resolve({data:null,error:null}).then(resolve);
        },
      };
      return q;
    },
  };
  registerPartnershipRoutes(app,{
    supabase,checkAuth:()=>{},checkPlatformAdmin:()=>{},
    notifyPartnerApproval:async(_db:any,partner:any)=>{
      emails.push(partner.contact_email);
      if(deliveryFails)throw new Error('DELIVERY_FAILED');
    },
  });
  const call=async(method:string,path:string,body:any={},id=partnerId)=>{
    const handlers=routes[method+' '+path];
    assert.ok(handlers);
    const result:any={statusCode:200,body:null};
    const res:any={
      status(n:number){result.statusCode=n;return res;},
      json(v:any){result.body=v;return res;},
      setHeader(){return res;},
    };
    await handlers[handlers.length-1]({
      params:{id},body,is:()=>true,session:{user:{id:ownerId}},
    },res);
    return result;
  };
  return {call,emails,getAccount:()=>account,routes};
};

test('owner approval persists and sends only one activation invitation',async()=>{
  const f=fixture();
  const approved=await f.call('PATCH','/api/owner/partnerships/accounts/:id',{
    status:'approved',complianceApproved:true,
  });
  assert.equal(approved.statusCode,200);
  assert.equal(approved.body.invitationSent,true);
  assert.equal(f.getAccount().status,'approved');
  assert.equal(f.getAccount().compliance_approved,true);
  assert.ok(f.getAccount().approval_email_sent_at);
  assert.deepEqual(f.emails,['parceiro@example.test']);
  const again=await f.call('PATCH','/api/owner/partnerships/accounts/:id',{
    status:'approved',complianceApproved:true,
  });
  assert.equal(again.body.invitationSent,false);
  assert.equal(f.emails.length,1,'repeated approval must not send more email');
});

test('if email delivery fails, persisted approval is retained for manual retry',async()=>{
  const f=fixture(true);
  const response=await f.call('PATCH','/api/owner/partnerships/accounts/:id',{
    status:'approved',complianceApproved:true,
  });
  assert.equal(response.statusCode,502);
  assert.equal(response.body.error,'APPROVAL_SAVED_EMAIL_FAILED');
  assert.equal(response.body.approvalSaved,true);
  assert.equal(f.getAccount().status,'approved');
  assert.equal(f.getAccount().approval_email_sent_at,null);
});

test('an approved partner cannot be invited repeatedly within the cooldown',async()=>{
  const f=fixture();
  await f.call('PATCH','/api/owner/partnerships/accounts/:id',{
    status:'approved',complianceApproved:true,
  });
  const repeated=await f.call('POST','/api/owner/partnerships/accounts/:id/invite',{});
  assert.equal(repeated.statusCode,429);
  assert.equal(repeated.body.error,'INVITATION_ALREADY_SENT');
  assert.equal(f.emails.length,1);
  assert.equal(f.routes['POST /api/owner/partnerships/accounts/:id/invite'].length,4);
});
