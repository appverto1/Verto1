import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const app=readFileSync('src/App.tsx','utf8');
const page=readFileSync('src/components/PublicSalesOffer.tsx','utf8');
const transport=readFileSync('src/services/publicSalesOfferTransport.ts','utf8');

test('public route is token-only and reachable without an authenticated user',()=>{
  assert.match(app,/window\.location\.pathname\.match\(\/\^\\\/oferta\\\/\(\[\^\/\]\+\)\\\/\?\$\/i\)/);
  assert.match(app,/isSalesOfferRoute \? \([\s\S]*?<PublicSalesOffer token=\{salesOfferToken\} \/>/);
  assert.doesNotMatch(app,/isSalesOfferRoute && user \?/);
  assert.match(transport,/credentials: 'omit'/);
  assert.doesNotMatch(transport,/Authorization|Bearer|getSupabase|localStorage|sessionStorage|credentials: 'include'/);
});
test('public data is read once via backend token and old offer is cleared before next token response',()=>{
  const load=page.split('const loadOffer = async () => {')[1]?.split('if (legacyPaymentReturnWithoutContext)')[0]||'';
  assert.match(load,/setOffer\(null\)/);
  assert.match(load,/setAcceptedAt\(null\)/);
  assert.match(load,/setCommercialConsent\(false\)/);
  assert.match(load,/setLoading\(true\)/);
  assert.ok(load.indexOf('setOffer(null)')<load.indexOf('await loadPublicSalesOfferResponse(token)'));
  assert.match(load,/response\.status === 404 && data\?\.error === 'OFFER_UNAVAILABLE'/);
  assert.match(load,/setOfferUnavailable\(true\)/);
  assert.match(load,/requireConfirmedPublicSalesOffer\(response, data\)/);
  assert.match(load,/if \(!cancelled\) \{[\s\S]*?setOffer\(confirmedOffer\)/);
  assert.match(load,/setAcceptedAt\(confirmedOffer\?\.acceptedAt \|\| null\)/);
  assert.match(page,/return \(\) => \{[\s\S]*?cancelled = true/);
  assert.match(transport,/encodeURIComponent\(token\)/);
});
test('historical and modular proposals show only the backend-provided public frozen data',()=>{
  assert.match(page,/offer\.offerType === 'modular' \? \(/);
  assert.match(page,/<ModularOfferDetails offer=\{offer\} \/>/);
  assert.match(page,/offer\.baseUnitAmountCents/);
  assert.match(page,/offer\.promotionalMonthlyAmountCents/);
  assert.match(page,/offer\.postDiscountMonthlyAmountCents/);
  assert.match(page,/selected from public|Proposta não disponível para nova contratação/);
  assert.match(page,/Continuar para cadastro do cartão/);
  assert.match(page,/const continueToCheckout = async/);
  assert.match(page,/const acceptModularOffer = async/);
  assert.doesNotMatch(transport,/supabase|stripe|checkout|\/accept|\/payment-status|\/director-session/i);
});
