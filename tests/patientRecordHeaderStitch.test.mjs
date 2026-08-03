import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const patientView = readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const teamPanel = readFileSync('src/components/PatientProfessionalLinksPanel.tsx', 'utf8');
const coordinator = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');

assert.match(patientView, /rounded-\[28px\]/, 'o cabeçalho clínico deve usar a superfície compacta aprovada');
assert.match(patientView, /bg-\[#7046b8\]/, 'o WhatsApp deve acompanhar a identidade visual roxa aprovada');
assert.match(patientView, /border-b-2/, 'as abas devem usar indicador inferior em vez de bloco cinza alto');
assert.match(patientView, /lg:grid-cols-\[minmax\(13rem,16rem\)_minmax\(0,1fr\)\]/, 'responsável e equipe devem compartilhar a mesma faixa compacta');
assert.match(teamPanel, /min-h-\[4\.75rem\]/, 'os cartões da equipe devem permanecer compactos e alinhados');
assert.match(teamPanel, /border-t px-3/, 'encerrar vínculo deve permanecer em rodapé secundário');
assert.match(coordinator, /lg:p-5/, 'o prontuário deve reduzir o espaçamento externo excessivo');

console.log('patientRecordHeaderStitch.test.mjs: ok');
