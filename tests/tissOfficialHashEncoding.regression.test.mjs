import assert from 'node:assert/strict';
import fs from 'node:fs';

const security = fs.readFileSync('src/services/tissOfficial/security.ts', 'utf8');
const generator = fs.readFileSync('src/services/tissOfficial/versions/communication040300/generator.ts', 'utf8');
const validator = fs.readFileSync('src/services/tissOfficial/versions/communication040300/validator.ts', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

// ANS TISS: documento oficial e bytes de transporte usam ISO-8859-1.
assert.match(generator, /<\?xml version="1\.0" encoding="ISO-8859-1"\?>/);
assert.doesNotMatch(generator, /<\?xml version="1\.0" encoding="UTF-8"\?>/);
assert.match(validator, /Buffer\.from\(xml, "latin1"\)/);
assert.match(generator, /sha256Hex\(Buffer\.from\(xml, "latin1"\)\)/);
assert.match(server, /application\/xml; charset=iso-8859-1/);
assert.match(server, /Buffer\.from\(xmlContent, 'latin1'\)/);

// Hash do epílogo deve usar somente valores de elementos folha, sem aparar o conteúdo.
const hashSection = security.slice(
  security.indexOf('export function calculateTissEpilogueHash'),
  security.indexOf('export function canonicalJson'),
);
assert.match(hashSection, /transactionXml\.matchAll/);
assert.match(hashSection, /\(\[\^<>\]\*\)/);
assert.doesNotMatch(hashSection, /match\[1\]\.trim\(\)|match\[2\]\.trim\(\)/);
assert.match(hashSection, /Buffer\.from\(concatenated, "latin1"\)/);
assert.match(hashSection, /createHash\("md5"\)/);

// A serialização final precisa ser revalidada antes de persistir/exportar.
assert.match(generator, /recalculatedEpilogueHash = calculateTissEpilogueHash\(xml\)/);
assert.match(generator, /TISS_OFFICIAL_EPILOGUE_HASH_MISMATCH/);

console.log('tissOfficialHashEncoding.regression: ok');
