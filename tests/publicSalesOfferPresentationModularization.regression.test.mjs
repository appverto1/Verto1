import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const page=readFileSync('src/components/PublicSalesOffer.tsx','utf8');
const detail=readFileSync('src/components/ModularPublicOfferDetails.tsx','utf8');
const builder=readFileSync('src/components/SalesModularProposalBuilder.tsx','utf8');
const transport=readFileSync('src/services/publicSalesOfferTransport.ts','utf8');
const fingerprint=(value)=>{let h=0x811c9dc5;for(let i=0;i<value.length;i++)h=Math.imul(h^value.charCodeAt(i),0x01000193)>>>0;return h.toString(16).padStart(8,'0');};

test('Codex presentation extraction remains byte-identical to staging JSX logic',()=>{
  const idx=detail.indexOf('export const ModularOfferDetails =');
  assert.ok(idx>=0);
  assert.equal(fingerprint(detail.slice(idx).trimEnd()),'369d83c5');
  assert.doesNotMatch(page,/export const ModularOfferDetails =/);
  assert.match(page,/import \{ ModularOfferDetails \} from '\.\/ModularPublicOfferDetails';/);
  assert.match(page,/export \{ ModularOfferDetails \} from '\.\/ModularPublicOfferDetails';/);
  assert.match(page,/<ModularOfferDetails offer=\{offer\} \/>/);
  assert.match(builder,/ModularOfferDetails/);
});
test('view remains a pure frozen-snapshot presentation, not a payment or authorization authority',()=>{
  assert.match(detail,/offer\.promotionalMonthlyAmountCents/);
  assert.match(detail,/offer\.postDiscountMonthlyAmountCents/);
  assert.match(detail,/offer\.capacityBlockPhases/);
  assert.match(detail,/offer\.basePackage\?\.capacity/);
  assert.match(detail,/item\.offerDiscount\.priceAfterExpirationCents/);
  assert.match(detail,/trialDays/);
  assert.match(detail,/formatSalesCommercialDate/);
  assert.doesNotMatch(detail,/\bfetch\s*\(|getSupabase\(|\.auth\.|\.rpc\(|localStorage|document\.|window\.|\bcheckout\s*\(|setState/);
  assert.match(page,/loadPublicSalesOfferResponse\(token\)/);
  assert.match(page,/requestPublicSalesCardCheckout/);
  assert.match(page,/const acceptModularOffer = async/);
  assert.match(page,/const continueToCheckout = async/);
  assert.match(page,/intendedRole: 'director'/);
  assert.match(transport,/credentials: 'omit'/);
  assert.doesNotMatch(transport,/Authorization|Bearer|getSupabase|credentials: 'include'/);
});
