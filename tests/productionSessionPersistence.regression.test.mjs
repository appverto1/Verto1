import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const dataService = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');

const sessionSaveBlock = server.match(/req\.session\.save\(async \(err\) => \{[\s\S]{0,5000}?delete req\.session\.isFirstLogin;\n\s*\}\);/)?.[0] || '';
assert.ok(sessionSaveBlock, 'login session-save block must exist');
assert.match(sessionSaveBlock, /if \(requiresDistributedRuntimeState\(\)\) \{/);
assert.match(sessionSaveBlock, /error: 'SERVER_SESSION_PERSISTENCE_REQUIRED'/);
assert.match(sessionSaveBlock, /saveExpressSession\(req\)/);
assert.match(sessionSaveBlock, /invalidateActiveSession\(/);
assert.match(sessionSaveBlock, /res\.clearCookie\('verto-session'\)/);
assert.ok(
  sessionSaveBlock.indexOf("error: 'SERVER_SESSION_PERSISTENCE_REQUIRED'") < sessionSaveBlock.indexOf("sessionPersistence: 'bearer_fallback'"),
  'production/distributed runtime must fail closed before development bearer fallback'
);

assert.match(dataService, /result\?\.message \|\| result\?\.error \|\| 'Não foi possível criar o acesso do paciente'/);
assert.match(dataService, /SERVER_SESSION_REQUIRED/);
assert.match(dataService, /requiresReauthentication/);

console.log('productionSessionPersistence.regression.test.mjs: ok');
