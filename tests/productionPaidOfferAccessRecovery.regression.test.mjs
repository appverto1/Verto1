import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const offer = readFileSync('src/components/PublicSalesOffer.tsx','utf8');
const access = readFileSync('src/components/ActivationAccess.tsx','utf8');
assert.match(offer,/response\.status === 404 && data\?\.error === 'OFFER_UNAVAILABLE'/,'404 remains strictly scoped to known unavailable-offer errors');
assert.match(offer,/setOfferUnavailable\(true\)/,'unavailable link shown without pretending the payment failed');
assert.match(offer,/offerUnavailable \? \([\s\S]*?Proposta não disponível para nova contratação/,'neutral status rather than expired-only');
assert.match(offer,/Este link pode ter sido concluído, revogado ou expirado/,'do not falsely claim paid status');
assert.match(offer,/não faça outro pagamento/,'never suggest a duplicate charge');
assert.match(offer,/e-mail de ativação comercial/,'direct customer to existing safe activation');
assert.match(offer,/setError\(''\)/,'clear stale error on resolved unavailable state');
assert.match(access,/const requestExistingAccountRecovery = async/,'recovery only by explicit user interaction');
assert.match(access,/fetch\('\/api\/auth\/password\/recovery\/email\/request'/,'reuse server recovery route and rate limit');
assert.match(access,/onClick=\{requestExistingAccountRecovery\}/,'explicit button to send recovery');
assert.match(access,/Se o e-mail estiver cadastrado/,'no account enumeration');
assert.match(access,/if \(!loginRes\?\.success\)/,'do not bypass credential rejection');
console.log('productionPaidOfferAccessRecovery.regression: PASS');
