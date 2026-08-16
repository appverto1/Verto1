import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/components/Anamnesis.tsx', 'utf8');

// Opening a second question editor must never overwrite an unfinished draft.
assert.match(source, /if \(draftQuestion && editingQuestionId\) \{[\s\S]*?Confirme ou cancele a pergunta que já está em edição antes de adicionar outra/);

// Editing another saved question while a draft is open is blocked for the same reason.
assert.match(source, /if \(draftQuestion && editingQuestionId && editingQuestionId !== question\.id\)/);

// New questions are appended to the complete profile question array; no other
// section is filtered out or rebuilt when confirming one question.
assert.match(source, /questions:\s*\[\s*\.\.\.profile\.questions,[\s\S]*?sectionId: targetSectionId/);
assert.doesNotMatch(source, /questions:\s*profile\.questions\.filter\([^\n]*sectionId/);

// The active section is frozen when the editor opens, so a later render cannot
// accidentally attach the new question to another section.
assert.match(source, /const targetSectionId = String\(editorSectionId \|\| sectionId \|\| ''\)\.trim\(\)/);

// React render must not sort the state-owned sections array in place.
assert.match(source, /profileTemplate\.sections\s*\.slice\(\)\s*\.sort/);

// Pending question draft is part of the local draft snapshot, so F5 cannot
// silently discard text that has not yet been confirmed.
assert.match(source, /editingQuestionId,\s*editorSectionId,\s*draftQuestion/);
assert.match(source, /setDraftQuestion\(parsed\.draftQuestion as QuestionDraft\)/);

console.log('anamnesisQuestionPreservation.test.mjs: ok');
