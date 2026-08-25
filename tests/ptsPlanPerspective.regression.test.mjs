import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/components/PtsTherapeuticDashboard.tsx', 'utf8');
const panel = fs.readFileSync('src/components/TherapeuticPlanPanel.tsx', 'utf8');
const charts = fs.readFileSync('src/components/ClinicalOutcomesDashboard.tsx', 'utf8');

assert.match(dashboard, /data-testid="pts-plan-perspective-selector"/);
assert.match(dashboard, /<option value="pts">Visão do PTS<\/option>/);
assert.match(dashboard, /String\(item\.specialty \|\| 'Plano da especialidade'\).*v\{item\.edit_version \|\| 1\}/s);
assert.match(dashboard, /perspectivePrograms = useMemo/);
assert.match(dashboard, /const displayScope = activePerspectiveScope \|\| scope/);
assert.match(dashboard, /PTS · \${perspectiveLabel}/);
assert.match(dashboard, /therapeutic_plan_id \|\| program\?\.therapeuticPlanId/);
assert.match(dashboard, /onAddProgramForScope\(String\(activePerspectiveScope\.id\)\)/);
assert.match(dashboard, /onEditPerspectiveScope\(activePerspectiveScope\)/);
assert.match(dashboard, /A estrutura do PTS permanece única; a perspectiva apenas filtra os programas e evidências da especialidade\./);

assert.match(panel, /const specialtyScopes = useMemo/);
assert.match(panel, /const ptsWorkspacePrograms = useMemo/);
assert.match(panel, /specialtyScopes=\{specialtyScopes\}/);
assert.match(panel, /programs=\{ptsWorkspacePrograms\}/);
assert.match(panel, /onAddProgramForScope=\{\(scopeId\) => startCreationForScope\(scopeId\)\}/);
assert.match(panel, /onEditPerspectiveScope=\{\(scope\) => startEditingScope\(scope\)\}/);
assert.match(panel, /const programPlanScope = planScopes\.find/);

// Plano e Gráficos usam a mesma identidade visual para a visão integrada e as especialidades.
assert.match(charts, /<option value="pts">Visão do PTS<\/option>/);
assert.match(charts, /specialtyPlans\.map\(\(plan\)/);

console.log('ptsPlanPerspective.regression.test.mjs: ok');
