import assert from 'node:assert/strict';
import fs from 'node:fs';

// One-time, bounded source edit for a >4MB server.ts that exceeds the remote
// contents API upload limit. Fails closed unless the expected route is intact.
const path = 'server.ts';
const source = fs.readFileSync(path, 'utf8');
const routeStart = source.indexOf("app.patch('/api/notes/:noteId'");
const routeEnd = source.indexOf("app.delete('/api/notes/:noteId'", routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'exact existing notes PATCH route expected');
const route = source.slice(routeStart, routeEnd);
const original = `      if (!(await canAccessPatientInCurrentClinic(sanitizeString(existing.patient_id, 120), req.session.user))) {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }
      const actorId = sanitizeString(req.session.user?.id, 120);`;
const replacement = `      const notePatientId = sanitizeString(existing.patient_id, 120);
      if (!(await canAccessPatientInCurrentClinic(notePatientId, req.session.user))) {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }
      // The server derives the patient and family visibility from the existing
      // stored note. Frontend IDs, roles and score are not authorization sources.
      const existingFamilyNote = ['family_note', 'photo'].includes(String(existing.type || '').toLowerCase())
        || String(existing.visibility || '').toLowerCase() === 'family';
      const targetsFamily = ['family_note', 'photo'].includes(String(req.body?.type || '').toLowerCase())
        || String(req.body?.visibility || '').toLowerCase() === 'family';
      const scoreProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'score');
      if (existingFamilyNote || targetsFamily || scoreProvided) {
        if (!(await canAccessPatientInCurrentClinic(notePatientId, req.session.user, 'write'))) {
          return res.status(403).json({ success: false, error: 'Sem autorização para alterar o reconhecimento clínico deste paciente.' });
        }
      }
      if ((existingFamilyNote || targetsFamily) && scoreProvided && req.body.score !== 0 && req.body.score !== 1) {
        return res.status(400).json({ success: false, error: 'A estrelinha deve ser 0 ou 1.' });
      }
      const actorId = sanitizeString(req.session.user?.id, 120);`;
assert.equal(route.split(original).length, 2, 'source anchor should appear exactly once in note PATCH route');
const updatedRoute = route.replace(original, replacement);
const updated = source.slice(0, routeStart) + updatedRoute + source.slice(routeEnd);
assert.equal(updated.length - source.length, replacement.length - original.length);
fs.writeFileSync(path, updated, 'utf8');
console.log('Bounded clinical notes write permission patch applied');
