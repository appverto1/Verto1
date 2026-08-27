import assert from 'node:assert/strict';
import fs from 'node:fs';

const builder = fs.readFileSync(
  new URL('../src/components/SalesModularProposalBuilder.tsx', import.meta.url),
  'utf8'
);
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

assert.match(
  builder,
  /profitability-assumptions\?context=new_proposal/,
  'o construtor precisa pedir premissas normalizadas para nova proposta'
);
assert.match(
  server,
  /req\.query\?\.context[\s\S]{0,160}new_proposal/,
  'o backend precisa distinguir o contexto de nova proposta'
);
assert.match(
  server,
  /buildSalesAssumptionsForNewProposal\(data\[0\]\)/,
  'o preview deve usar o mesmo rateio server-side do salvamento'
);

console.log('salesNewProposalAssumptionContext.regression.test.mjs: ok');
