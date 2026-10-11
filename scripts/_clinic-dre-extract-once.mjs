import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const branch = 'refs/heads/refactor/backend-clinic-dre-route-20261011';
assert.equal(process.env.GITHUB_REF, branch, 'do not rewrite from another branch');

const original = fs.readFileSync('server.ts', 'utf8');
const gitBlob = crypto.createHash('sha1')
  .update(Buffer.concat([Buffer.from('blob ' + Buffer.byteLength(original) + '\0'), Buffer.from(original)]))
  .digest('hex');
assert.equal(gitBlob, 'b5460aa69d3cee3ff6ec96849f61537974007997', 'server.ts changed: refuse to overwrite unknown state');

const start = "  app.get('/api/clinic/dre', checkAuth, async (req, res) => {";
const terminator = '\n  });';
const index = original.indexOf(start);
assert.ok(index >= 0 && original.indexOf(start, index + start.length) === -1, 'route must be unique');
const endIndex = original.indexOf(terminator, index);
assert.ok(endIndex > index, 'route must end exactly');
const extracted = original.slice(index, endIndex + terminator.length);
assert.equal(extracted.split('\n').length, 37, 'unexpected handler size');
assert.ok(extracted.includes("res.json({ success: true, data: dre });"));
assert.ok(extracted.includes("res.status(500).json({ error: 'Erro interno do servidor.' });"));

const importLine = "import { handleClinicDre } from './services/clinicDreHandler';\n";
const register = "  app.get('/api/clinic/dre', checkAuth, handleClinicDre);";
assert.ok(original.startsWith("import express from 'express';\n"), 'import anchor moved');
assert.ok(!original.includes('handleClinicDre'), 'extraction already exists');

const updated = original.replace("import express from 'express';\n", "import express from 'express';\n" + importLine).replace(extracted, register);
assert.equal(updated.replace(importLine, '').replace(register, extracted), original, 'byte-for-byte reversible');
assert.equal(updated.split('\n').length, original.split('\n').length - 35, 'unexpected reduction');

const handler = '// Extracted verbatim from server.ts; middleware registration remains in the entrypoint.\n'
  + 'export const handleClinicDre = async (req: any, res: any) => {'
  + extracted.slice(start.length, -terminator.length)
  + '\n};\n';
assert.ok(handler.includes('const clinicId = user.clinic_id || user.id;'));

fs.writeFileSync('server.ts', updated, 'utf8');
assert.ok(!fs.existsSync('services/clinicDreHandler.ts'), 'handler path already exists');
fs.writeFileSync('services/clinicDreHandler.ts', handler, 'utf8');
const summary = [
  '# Backend modularization: clinic DRE GET route',
  '',
  '- Baseline staging commit: `162a1c53c93aefaedb88cad36d9fbba8656b3724`.',
  '- Original server.ts Git blob: `b5460aa69d3cee3ff6ec96849f61537974007997` (102,066 lines).',
  '- Extracted exactly one `GET /api/clinic/dre` handler to `services/clinicDreHandler.ts`; route registration stays at its original position with exactly the same `checkAuth` middleware.',
  '- Business logic and response/error payload are copied byte-for-byte; no additional database query, environment access, auth change, data write or new dependency.',
  '- The one-time isolated writer validated original blob SHA, unique route anchor, original 37-line handler and exact reverse reconstruction before editing.',
  '- Resulting `server.ts` has ' + updated.split('\n').length + ' lines; direct reduction: 35 lines (35 / 102,066 = 0.0343%).',
  '- Node 20 focused test and Vite build are required by the temporary one-run workflow; full staging CI is required before merge. No production deployment.',
  '- The temporary writer script and workflow are removed from the resulting feature branch before PR; no privileged writer workflow goes to staging.',
  '- PR, merge and deploy: not performed at initial checkpoint; verify actual GitHub state and append evidence after checks.',
  ''
].join('\n');
fs.mkdirSync('docs/backend-modularization', { recursive: true });
fs.writeFileSync('docs/backend-modularization/20261011-clinic-dre-route.md', summary);
console.log('CLINIC_DRE_EXTRACTED', JSON.stringify({
  beforeLines: original.split('\n').length,
  afterLines: updated.split('\n').length,
  originalSha: gitBlob,
  handlerLines: extracted.split('\n').length
}));
