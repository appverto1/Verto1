import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const s=readFileSync('server.ts','utf8');
const m=readFileSync('services/publicSalesLeadRoutes.ts','utf8');
const input=readFileSync('services/publicSalesLeadInput.ts','utf8');
const hash=(str)=>{let h=0x811c9dc5;for(let i=0;i<str.length;i++)h=Math.imul(h^str.charCodeAt(i),0x01000193)>>>0;return h.toString(16).padStart(8,'0');};
test('backend lead route remains extracted and its persistence handler is unchanged',()=>{
  const begin='      try {\\n        const { data, error }';
  const i=m.indexOf(begin),j=m.indexOf('\\n    },\\n  );',i);
  assert.ok(i>=0 && j>i);
  assert.equal(hash(m.slice(i,j)),'141a89ea','RPC, notification and responses must remain byte-identical');
  assert.match(m,/import \\{ parsePublicSalesLeadInput \\} from '\\.\\/publicSalesLeadInput'/);
  assert.match(m,/parsePublicSalesLeadInput\\(req, deps\\)/);
  assert.match(s,/import \\{ registerPublicSalesLeadRoute \\} from '\\.\\/services\\/publicSalesLeadRoutes'/);
  assert.match(s,/registerPublicSalesLeadRoute\\(app, \\{/);
  assert.doesNotMatch(s,/app\\.post\\(\\s*"\\/api\\/public\\/sales-leads"/);
});
test('original API abuse protection, persistence and idempotency are all preserved',()=>{
  assert.match(m,/"\/api\/public\/sales-leads",\s*publicSalesLeadIpLimiter,\s*publicSalesLeadIdentityLimiter/);
  assert.match(input,/SALES_PUBLIC_PAYLOAD_MAX_BYTES/);
  assert.match(input,/formStartedAt/);
  assert.match(m,/supabase\.rpc\("upsert_public_sales_lead"/);
  assert.match(input,/x-idempotency-key/);
  assert.match(m,/if \(eventCreated\)/);
  assert.match(m,/notifySalesOwnerForLead/);
  assert.match(m,/status\(201\)/);
  assert.match(s,/const publicSalesLeadIpLimiter = rateLimit/);
  assert.match(s,/const publicSalesLeadIdentityLimiter = rateLimit/);
});
