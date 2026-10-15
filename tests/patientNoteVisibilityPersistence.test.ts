import { readPatientPlanServerSource } from './helpers/patientPlanReadSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const clinical = fs.readFileSync('src/utils/clinicalPostResilience.ts', 'utf8');
const fallback = fs.readFileSync('src/utils/routeSchemaFallbacks.ts', 'utf8');
const server = readPatientPlanServerSource();
const migration = fs.readFileSync('supabase/migrations/20260817103000_patient_note_visibility_privacy_v1.sql', 'utf8');

assert.match(app, /resolvePatientNoteAudience\(n\)/,
  'notas reidratadas precisam voltar para a aba visual correta');
assert.match(app, /const uiVisibility = resolvePatientNoteAudience\(\{ visibility: normalizedVisibility \}\)/,
  'nota otimista precisa usar a mesma semântica visual da leitura persistida');

assert.match(clinical, /shared_with_professionals: portabilityScope === 'PROFESSIONALS'/,
  'compartilhamento com equipe deve persistir independentemente de portabilidade externa');
assert.match(clinical, /original_author_id: cleanString\(context\.userId/,
  'autor da nota deve vir da sessão, nunca do payload do navegador');
assert.match(clinical, /created_by: cleanString\(context\.userId/,
  'created_by deve ser autoridade server-side');

for (const column of ['visibility', 'original_id', 'created_by', 'original_author_id']) {
  assert.match(fallback, new RegExp(`'${column}'`), `leitura de notas deve incluir ${column}`);
}
assert.match(fallback, /visibility: audience/,
  'fallback deve normalizar shared_clinic/shared_patient para as abas da UI');

assert.match(server, /filterNotesForActor/,
  'backend deve aplicar visibilidade por ator depois da autorização do paciente');
assert.match(server, /canActorReadPatientNote/,
  'backend deve impedir vazamento de nota privada para colegas/gestores');
assert.match(server, /Somente o autor pode compartilhar uma cópia de anotação privada/,
  'cópia de nota privada deve ser autorizada pelo autor original');
assert.match(server, /patientEmail: sanitizeEmail\(req\.resolvedPatientEmail\)/,
  'e-mail do paciente deve vir do paciente resolvido no servidor');

assert.match(migration, /alter table public\.notes enable row level security/i,
  'notes deve permanecer protegida por RLS');
assert.match(migration, /drop policy if exists "notes_select_coord_reception"/i,
  'policy antiga não pode expor privadas para coordenação/recepção');
assert.match(migration, /patient_professional_links/i,
  'notas de equipe devem ser lidas pela equipe canônica do caso');
assert.match(migration, /visibility = 'shared_patient'/i,
  'portal do paciente precisa de escopo explícito');
assert.match(migration, /revoke insert, update, delete on public\.notes from authenticated/i,
  'browser não deve gravar nota clínica diretamente contornando validação server-side');
assert.doesNotMatch(migration, /delete\s+from|truncate\s+table|drop\s+table/i,
  'migration não pode apagar histórico de notas');

console.log('patientNoteVisibilityPersistence.test.ts: ok');
