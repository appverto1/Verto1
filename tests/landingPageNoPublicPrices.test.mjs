import assert from 'node:assert/strict';
import fs from 'node:fs';

const landingPage = fs.readFileSync('src/components/LandingPage.tsx', 'utf8');

assert.doesNotMatch(landingPage, /PUBLIC_ACTIVE_PATIENT_PRICE/i);
assert.doesNotMatch(landingPage, /R\$\s*\d/i);
assert.doesNotMatch(landingPage, /\d+[.,]\d{2}\s*por paciente/i);
assert.doesNotMatch(landingPage, /pre[cç]o\s+(?:mensal|por paciente)/i);
assert.doesNotMatch(landingPage, /valor\s+(?:mensal|por paciente)/i);

console.log('landingPageNoPublicPrices.test.mjs: ok');
