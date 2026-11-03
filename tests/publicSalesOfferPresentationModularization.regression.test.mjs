import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/components/PublicSalesOffer.tsx', 'utf8');
const details = readFileSync('src/components/ModularPublicOfferDetails.tsx', 'utf8');
assert.match(page, /import \{ ModularOfferDetails \} from '\.\/ModularPublicOfferDetails'/);
assert.match(page, /export \{ ModularOfferDetails \}/);
assert.match(page, /<ModularOfferDetails offer=\{offer\} \/>/);
assert.match(details, /export const ModularOfferDetails/);
assert.match(details, /import type \{ ModularPublicOffer \} from '\.\/PublicSalesOffer'/);
assert.match(details, /Comece com os módulos necessários hoje/);
assert.match(details, /mantendo os mesmos módulos contratados e os preços por paciente/);
assert.match(details, /dias gratuitos/);
assert.match(page, /\/api\/public\/sales-offers\/\$\{encodeURIComponent\(token\)\}\/checkout/);
assert.match(page, /\/api\/public\/sales-offers\/\$\{encodeURIComponent\(token\)\}\/accept/);
assert.match(page, /supabase\.auth\.verifyOtp/);
assert.match(page, /intendedRole: 'director'/);
assert.doesNotMatch(details, /fetch\(|getSupabase\(|\.auth\.|\.rpc\(|localStorage|document\.|window\./);
console.log('publicSalesOfferPresentationModularization: PASS');
