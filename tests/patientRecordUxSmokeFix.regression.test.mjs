import assert from 'node:assert/strict';
import fs from 'node:fs';

const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const detail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const links = fs.readFileSync('src/components/PatientProfessionalLinksPanel.tsx', 'utf8');
const schoolDialog = fs.readFileSync('src/components/SchoolEnrollmentDialog.tsx', 'utf8');
const pts = fs.readFileSync('src/components/PtsTherapeuticDashboard.tsx', 'utf8');
const indexHtml = fs.readFileSync('index.html', 'utf8');

assert.match(
  coordinator,
  /onClick=\{goBackFromPatientRecord\}/,
  'patient-record back action returns to the actual previous page',
);
assert.match(coordinator, /setPatientReturnTab\(activeTab\)/);

assert.match(links, /Carregando equipe do caso/);
assert.match(links, /case-team-skeleton/);
assert.match(links, /managementResolved && \(serverCanManage \|\| canManage\)/);
assert.match(links, /setPendingEndLink\(link\)/);
assert.match(links, /Encerrar vínculo com \{pendingEndLink/);
assert.match(links, /O histórico clínico e o vínculo encerrado serão preservados/);
assert.match(links, /if \(caseRole === 'supervisor'\) return \['Supervisão', specialty\]/);
assert.match(links, /return specialty \|\| 'Especialidade não informada'/);
assert.doesNotMatch(
  links,
  /patientProfessionalCaseRoleLabel\(link\.case_role\).*link\.specialty/,
  'ordinary case cards must not prepend the generic therapist role to a real specialty',
);

assert.match(schoolDialog, /createPortal\(/);
assert.match(schoolDialog, /document\.body/);
assert.match(schoolDialog, /z-\[180\]/);

assert.match(pts, /Editar na nova versão do PTS/);
assert.match(pts, /Editar prioridades familiares/);
assert.equal(
  (pts.match(/onClick=\{onNewVersion\}/g) || []).length >= 2,
  true,
  'PTS summary shortcuts must preserve versioned editing instead of introducing an inline second source of truth',
);

assert.match(detail, /min-h-12 min-w-\[7\.5rem\][\s\S]{0,120}?sm:flex-1/);
assert.match(detail, /patientPhotoPolicy === 'CLINIC'/);
assert.match(detail, /Adicionar foto do paciente/);
assert.match(detail, /portalPatientPhotoSource/);

assert.match(indexHtml, /width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes/);
assert.doesNotMatch(indexHtml, /minimum-scale=0/);

console.log('patientRecordUxSmokeFix.regression.test.mjs: ok');
