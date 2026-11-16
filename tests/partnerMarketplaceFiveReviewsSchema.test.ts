import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const migration=readFileSync(new URL('../supabase/migrations/20261113200000_partner_marketplace_five_reviews_v1.sql',import.meta.url),'utf8');

test('review limit is five in both database constraint and atomic write RPC',()=>{
  assert.match(migration,/check\s*\(review_number between 1 and 5\)/i);
  assert.match(migration,/if v_number>5 then return false;/i);
  assert.match(migration,/pg_advisory_xact_lock\(/i,'serializes concurrent review attempts');
  assert.match(migration,/max\(review_number\)/i);
});

test('expanded reviews still require a verified contract and clinical authority',()=>{
  assert.match(migration,/l\.partner_confirmed_at is not null and l\.clinic_confirmed_at is not null/);
  assert.match(migration,/m\.user_id=p_user_id and m\.clinic_id=l\.clinic_id and m\.status='active'/);
  assert.match(migration,/m\.role in \('director','coordinator'\)/);
  assert.match(migration,/revoke all on function public\.verto_marketplace_save_review_v1[\s\S]*?from public,anon,authenticated;/);
  assert.match(migration,/grant execute on function public\.verto_marketplace_save_review_v1[\s\S]*?to service_role;/);
});
