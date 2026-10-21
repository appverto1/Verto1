import assert from 'node:assert/strict';
import fs from 'node:fs';

const file = 'server.ts';
const source = fs.readFileSync(file, 'utf8');
const start = source.indexOf("app.patch('/api/notes/:noteId'");
const end = source.indexOf("app.delete('/api/notes/:noteId'", start);
assert.ok(start >= 0 && end > start);
const route = source.slice(start, end);
const old = `      const existingFamilyNote = ['family_note', 'photo'].includes(String(existing.type || '').toLowerCase())
        || String(existing.visibility || '').toLowerCase() === 'family';
      const targetsFamily = ['family_note', 'photo'].includes(String(req.body?.type || '').toLowerCase())
        || String(req.body?.visibility || '').toLowerCase() === 'family';`;
const replacement = `      const existingFamilyNote = ['family_note', 'photo'].includes(String(existing.type || '').toLowerCase())
        || String(existing.visibility || '').toLowerCase() === 'family'
        || /fam[ií]lia/i.test(String(existing.subject || ''))
        || /registro da fam[ií]lia/i.test(String(existing.text || ''));
      const targetsFamily = ['family_note', 'photo'].includes(String(req.body?.type || '').toLowerCase())
        || String(req.body?.visibility || '').toLowerCase() === 'family'
        || /fam[ií]lia/i.test(String(req.body?.subject || ''))
        || /registro da fam[ií]lia/i.test(String(req.body?.text || ''));`;
assert.equal(route.split(old).length, 2, 'patch source shape changed; fail closed');
const updated = source.slice(0,start) + route.replace(old,replacement) + source.slice(end);
assert.equal(updated.length - source.length, replacement.length - old.length);
fs.writeFileSync(file, updated, 'utf8');
console.log('Legacy family subjects are now protected by patient write scope');
