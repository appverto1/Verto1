import { readProtocolImportServerSource } from './helpers/protocolImportSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = readProtocolImportServerSource();

assert.match(server, /from\('clinic_protocol_grants'\)[\s\S]{0,180}select\('clinic_id, canonical_key'\)[\s\S]{0,120}is\('revoked_at', null\)/,
  'admin protocol access must read active canonical grants');
assert.match(server, /from\('clinic_protocol_grants'\)[\s\S]{0,180}select\('source_request_id, canonical_key'\)[\s\S]{0,180}eq\('clinic_id', safeClinicId\)/,
  'clinic_state compatibility sync must start from tenant-scoped canonical grants');
assert.match(server, /rpc\('approve_protocol_import_request_v1',[\s\S]{0,180}p_request_id: requestId[\s\S]{0,120}p_canonical_key: canonicalKey/,
  'approve route must use the atomic approval RPC');
assert.match(server, /scopeKey !== `clinic:\$\{requestClinicId\}`/,
  'legacy access route must bind request to its clinic scope');
assert.match(server, /if \(!enabled\) \{[\s\S]{0,180}revogacao de protocolo exige o fluxo canonico de grants/,
  'legacy toggle must not emulate revocation outside the canonical grant contract');
assert.doesNotMatch(server, /from\('activity_logs'\)[\s\S]{0,180}eq\('type', 'protocol_access_updated'\)/,
  'activity log must not remain the protocol access source of truth');

console.log('protocol request canonical grant regression: PASS');
