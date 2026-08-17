import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/components/Anamnesis.tsx', 'utf8');

// Each section owns its own question editor draft. Opening "Adicionar pergunta"
// in section B must not hide or overwrite a pending draft in section A.
assert.match(source, /useState<Record<string, QuestionEditorDraft>>\(\{\}\)/);
assert.match(source, /const existingEditor = questionEditors\[sectionId\]/);
assert.match(source, /setQuestionEditors\(\(prev\) => \(\{[\s\S]*?\.\.\.prev,[\s\S]*?\[sectionId\]: \{/);
assert.doesNotMatch(source, /Confirme ou cancele a pergunta que já está em edição antes de adicionar outra/);

// A section may still have only one active editor of its own; this prevents two
// drafts from the same section from fighting over the same visual slot.
assert.match(source, /Já existe uma pergunta em edição nesta seção/);

// New questions are appended to the complete profile question array; no other
// section is filtered out or rebuilt when confirming one question.
assert.match(source, /questions:\s*\[\s*\.\.\.profile\.questions,[\s\S]*?sectionId: targetSectionId/);
assert.doesNotMatch(source, /questions:\s*profile\.questions\.filter\([^\n]*sectionId/);

// Saving/cancelling removes only the editor for the target section, preserving
// drafts that are open in other sections.
assert.match(source, /const next = \{ \.\.\.prev \};[\s\S]*?delete next\[sectionId\];[\s\S]*?return next;/);

// React render must not sort the state-owned sections array in place.
assert.match(source, /profileTemplate\.sections\s*\.slice\(\)\s*\.sort/);

// All pending per-section drafts are part of the local snapshot, so F5 cannot
// silently discard an unfinished question in any section.
assert.match(source, /questionEditors\s*\n\s*\}\)\s*\n\s*\)/);
assert.match(source, /setQuestionEditors\(parsed\.questionEditors as Record<string, QuestionEditorDraft>\)/);

console.log('anamnesisQuestionPreservation.test.mjs: ok');
