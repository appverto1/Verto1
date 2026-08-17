import assert from 'node:assert/strict';
import fs from 'node:fs';

const anamnesis = fs.readFileSync('src/components/Anamnesis.tsx', 'utf8');

// Draft/editor state must not be replaced by a background parent refetch while
// the clinician is actively editing a new or existing template.
assert.match(anamnesis, /const templateDirtyRef = useRef\(false\)/);
assert.match(anamnesis, /if \(!firstOpen && \(templateDirtyRef\.current \|\| Object\.keys\(questionEditorsRef\.current\)\.length > 0\)\) return;/);
assert.match(anamnesis, /Troca de ficha ocorre apenas por ação explícita dentro do modal/);
assert.match(anamnesis, /const handleSavedTemplateSelect = \(item: any\) =>/);
assert.match(anamnesis, /onClick=\{\(\) => handleSavedTemplateSelect\(item\)\}/);
assert.match(anamnesis, /const currentId = String\(\(templateState as any\)\?\.selectedTemplateId \|\| ''\)/);
assert.doesNotMatch(anamnesis, /currentId = String\(\(templateState as any\)\?\.selectedTemplateId \|\| \(template as any\)\?\.selectedTemplateId/);

// Section titles are raw controlled inputs during editing. Empty is allowed in
// the input so Backspace/Delete works; validation happens only before save.
assert.match(anamnesis, /section\.id === sectionId \? \{ \.\.\.section, title \} : section/);
assert.doesNotMatch(anamnesis, /title: title\.trim\(\) \|\| section\.title/);
assert.match(anamnesis, /JSON\.parse\(JSON\.stringify\(prev\)\) as AnamnesisTemplate/);
assert.match(anamnesis, /hasUntitledSection[\s\S]*?Dê um nome para todas as seções antes de salvar/);

// Unsaved draft includes metadata as well as questions/sections; clean opens do
// not continuously overwrite localStorage with a fake "draft".
assert.match(anamnesis, /!templateDirty && Object\.keys\(questionEditors\)\.length === 0/);
assert.match(anamnesis, /templateName,[\s\S]*?templateDescription,[\s\S]*?templateAgeMinYears,[\s\S]*?templateAgeMaxYears,[\s\S]*?templatePatientProfileType/);
assert.match(anamnesis, /setTemplateName\(String\(parsed\?\.templateName/);
assert.match(anamnesis, /setTemplateDescription\(String\(parsed\?\.templateDescription/);

console.log('anamnesisEditorPersistenceStability.test.mjs: ok');
