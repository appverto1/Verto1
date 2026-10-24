import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/PatientDashboard.tsx', 'utf8');
const start = source.indexOf("{selectedTask && typeof document !== 'undefined' && createPortal(");
const end = source.indexOf(', document.body)}', start);
assert.ok(start > 0 && end > start, 'o modal da tarefa deve ser renderizado no document.body');
const modal = source.slice(start, end);
assert.match(source, /import \{ createPortal \} from 'react-dom';/, 'portal React deve estar importado');
assert.match(modal, /role="dialog" aria-modal="true"/, 'modal deve ter semântica acessível');
assert.match(modal, /fixed inset-0 z-\[1000\] flex items-center justify-center/, 'overlay ocupa viewport e centraliza conteúdo');
assert.match(modal, /max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto/, 'rolagem limitada ao modal em telas pequenas');
assert.match(modal, /aria-label="Fechar tarefa"[^>]*onClick=\{\(event\) => \{[^}]*closeTaskModal\(\)/, 'botão de fechar permanece visível e acionável');
assert.match(modal, /onClick=\{handleConfirmTask\}/, 'confirmação da tarefa preservada');
assert.match(source, /const result = await onCompleteTask\(selectedTask, taskEnergy, finalNote\)/, 'persistência mantém autoridade original');
assert.match(source, /taskSubmitInFlightRef\.current/, 'bloqueio contra submissão duplicada permanece');
console.log('p3PatientTaskModalViewport.regression.test.mjs: OK');
