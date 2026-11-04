import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const s=readFileSync('server.ts','utf8');
const m=readFileSync('services/publicSalesLeadRoutes.ts','utf8');
const hash=(str)=>{let h=0x811c9dc5;for(let i=0;i<str.length;i++)h=Math.imul(h^str.charCodeAt(i),0x01000193)>>>0;return h.toString(16).padStart(8,'0');};
test('the extracted backend route is byte-for-byte identical to the frozen original',()=>{
  const begin='  app.post(\n    "/api/public/sales-leads",';
  const i=m.indexOf(begin),j=m.lastIndexOf('\n}\n');
  assert.ok(i>=0 && j>i);
  const old=m.slice(i,j).replace('async (req: any, res: any) => {','async (req: any, res) => {');
  assert.equal(hash(old),'96ec6eef');
  assert.match(s,/import \{ registerPublicSalesLeadRoute \} from '\.\/services\/publicSalesLeadRoutes'/);
  assert.match(s,/registerPublicSalesLeadRoute\(app, \{/);
  assert.doesNotMatch(s,/app\.post\(\s*"\/api\/public\/sales-leads"/);
});
test('original API abuse protection, persistence and idempotency are all preserved',()=>{
  assert.match(m,/"\/api\/public\/sales-leads",\s*publicSalesLeadIpLimiter,\s*publicSalesLeadIdentityLimiter/);
  assert.match(m,/SALES_PUBLIC_PAYLOAD_MAX_BYTES/);
  assert.match(m,/formStartedAt/);
  assert.match(m,/supabase\.rpc\("upsert_public_sales_lead"/);
  assert.match(m,/x-idempotency-key/);
  assert.match(m,/if \(eventCreated\)/);
  assert.match(m,/notifySalesOwnerForLead/);
  assert.match(m,/status\(201\)/);
  assert.match(s,/const publicSalesLeadIpLimiter = rateLimit/);
  assert.match(s,/const publicSalesLeadIdentityLimiter = rateLimit/);
});
