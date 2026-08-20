import fs from 'node:fs';
import assert from 'node:assert/strict';

const sessionMode = fs.readFileSync(new URL('../src/components/SessionMode.tsx', import.meta.url), 'utf8');

assert.doesNotMatch(sessionMode, /data-aba-clinical-suggestions/);
assert.doesNotMatch(sessionMode, /Planejamento sugerido para a próxima sessão/);
assert.doesNotMatch(sessionMode, /Fila de decisão clínica/);
assert.doesNotMatch(sessionMode, />Gerar sugestões</);

assert.match(sessionMode, /Comportamentos registrados/);

console.log('sessionClinicalSuggestionsRemoved.regression.test.mjs passed');
