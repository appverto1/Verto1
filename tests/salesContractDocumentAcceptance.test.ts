import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { test } from 'node:test';
import { acceptPublicSalesModularOffer, requestPublicSalesCardCheckout } from '../src/services/publicSalesCardCheckout';
import { SALES_CONTRACT_DOCUMENT } from '../src/constants/salesContractDocument';

test('public contract document is versioned and rendered from the approved v2.2 text', () => {
  assert.equal(SALES_CONTRACT_DOCUMENT.version, 'contract-master-v2.2');
  assert.match(SALES_CONTRACT_DOCUMENT.url, /^\/legal\/contrato-mestre-verto-v2\.2\.html$/);
  const html = fs.readFileSync('public' + SALES_CONTRACT_DOCUMENT.url, 'utf8');
  const pre = html.match(/<pre>([\s\S]*?)<\/pre>/)?.[1];
  assert.ok(pre, 'the full contract document must be publicly reviewable');
  const text = pre!
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  assert.equal(crypto.createHash('sha256').update(text).digest('hex'),
    SALES_CONTRACT_DOCUMENT.sourceTextSha256, 'the published legal text must not drift');
  assert.match(text, /29\. VIGÊNCIA DA VERSÃO 2\.2/);
  assert.match(html, /<title>Contrato<\/title>/);
  assert.match(html, /<h1>Contrato<\/h1>/);
  assert.match(html, /Leia atentamente as condições deste contrato antes de confirmar o aceite da proposta comercial\./);
});

test('public acceptance records explicit document acknowledgement without changing checkout', async () => {
  const calls: Array<{url: string; init?: RequestInit}> = [];
  const request = (async (url: string, init?: RequestInit) => {
    calls.push({url, init});
    return new Response(JSON.stringify({success:true, acceptedAt:'2026-11-12T15:00:00.000Z', url:'https://checkout.stripe.com/c/pay/cs_test_fixture'}), {status:200});
  }) as typeof fetch;

  await acceptPublicSalesModularOffer('opaque-token', request);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/public/sales-offers/opaque-token/accept');
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    commercialValuesConsent: true,
    contractDocumentAcknowledged: true,
    contractDocumentVersion: SALES_CONTRACT_DOCUMENT.version
  });

  calls.length = 0;
  await requestPublicSalesCardCheckout('opaque-token', request);
  assert.equal(calls[0].url, '/api/public/sales-offers/opaque-token/checkout');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {acceptTerms:true});
});

test('backend rejects omitted document acknowledgement and does not overwrite historical acceptance', () => {
  const routes = fs.readFileSync('services/publicSalesCheckoutRoutes.ts', 'utf8');
  const accept = routes.slice(routes.indexOf('"/api/public/sales-offers/:token/accept"'),
    routes.indexOf('"/api/public/sales-offers/:token/checkout"'));
  assert.match(accept, /contractDocumentAcknowledged !== true/);
  assert.match(accept, /contractDocumentVersion !== SALES_CONTRACT_DOCUMENT\.version/);
  assert.match(accept, /CONTRACT_DOCUMENT_ACCEPTANCE_REQUIRED/);
  assert.match(accept, /sourceTextSha256: SALES_CONTRACT_DOCUMENT\.sourceTextSha256/);
  assert.match(accept, /if \(offer\.accepted_at\)/);
  assert.match(accept, /\.is\("accepted_at", null\)/);
  const ui = fs.readFileSync('src/components/PublicSalesOffer.tsx', 'utf8');
  assert.match(ui, /href=\{SALES_CONTRACT_DOCUMENT\.url\}/);
  assert.match(ui, />\s*Contrato\s*<\/a>/);
  assert.match(ui, /Declaro que li e aceito o Contrato e estou ciente/);
  assert.doesNotMatch(ui, /Contrato Mestre SaaS Verto \(versão 2\.2\)/);
});
