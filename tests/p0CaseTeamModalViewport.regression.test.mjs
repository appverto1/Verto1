import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression: when the record view scrolls/transforms, fixed elements nested
// inside it are not viewport-fixed. Both layers must portal to document.body.
const source = readFileSync('src/components/PatientProfessionalLinksPanel.tsx', 'utf8');
assert.match(source, /import \{ createPortal \} from 'react-dom'/);
assert.equal((source.match(/createPortal\(/g) || []).length, 2);
assert.equal((source.match(/, document\.body/g) || []).length, 2);

const manager = source.slice(source.indexOf("{showManager && typeof document"), source.indexOf("{pendingEndLink && typeof document"));
const confirm = source.slice(source.indexOf("{pendingEndLink && typeof document"));
assert.match(manager, /createPortal\([\s\S]*?className="fixed inset-0 z-\[200\]"/);
assert.match(manager, /aria-label="Fechar gerenciamento da equipe"/);
assert.match(manager, /aria-labelledby="case-team-manager-title"/);
assert.match(confirm, /createPortal\([\s\S]*?className="fixed inset-0 z-\[210\] flex items-center justify-center/);
assert.match(confirm, /max-h-\[calc\(100dvh-2rem\)\]/);
assert.match(confirm, /overflow-y-auto overscroll-contain/);
assert.match(confirm, /aria-modal="true"/);
assert.match(confirm, /onClick=\{\(\) => setPendingEndLink\(null\)\}/);
assert.match(confirm, /await end\(target\)/);
assert.match(confirm, /O histórico clínico e o vínculo encerrado serão preservados/);

console.log('p0CaseTeamModalViewport.regression.test.mjs: PASS');
