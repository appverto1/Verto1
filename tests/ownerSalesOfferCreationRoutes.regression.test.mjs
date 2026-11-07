import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

const server = readFileSync('server.ts', 'utf8');
const module = readFileSync('services/ownerSalesOfferCreationRoutes.ts', 'utf8');
const section = (begin, end) => module.split(begin + '\n')[1]?.split(end)[0] || '';
const sha = text => createHash('sha256').update(text).digest('hex');

test('item05 preserves original offer prepare handlers byte-for-byte', () => {
 assert.equal(sha(section('  // BEGIN ITEM05 ORIGINAL PREPARATION', '  // END ITEM05 ORIGINAL PREPARATION')), '660f49ff54ba19c0fd8e6e7fd7e05ede415ee18598d5938abf0d6cd76e3fa30b');
 assert.match(module, /hasVerifiedMfaSession/);
 assert.match(module, /create_sales_modular_offer_v3/);
 assert.match(module, /PROPOSAL_CONTRACT_EMAIL_MISMATCH/);
 assert.match(module, /PROPOSAL_SNAPSHOT_CONFLICT/);
});

test('item05 preserves HTTP route byte-for-byte, middleware order, token and idempotency', () => {
 assert.equal(sha(section('  // BEGIN ITEM05 ORIGINAL ROUTE', '  // END ITEM05 ORIGINAL ROUTE')), 'fd634961a18611943c85da1ed1c2ee23be8858ec1c4cb4dfd1d979fc3039c5dd');
 assert.match(module, /"\/api\/owner\/sales\/offers",\s*checkAuth,\s*checkPlatformAdmin/);
 assert.match(module, /"x-idempotency-key"/);
 assert.match(module, /stripeCouponId/);
 assert.match(module, /deriveSalesOfferPublicToken/);
 assert.match(module, /hashSalesOfferToken/);
 assert.equal((server.match(/registerOwnerSalesOfferCreationRoute\(\{/g) || []).length, 1);
 assert.doesNotMatch(server, /app\.post\(\s*"\/api\/owner\/sales\/offers"/);
});
