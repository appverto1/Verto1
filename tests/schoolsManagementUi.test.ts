import assert from 'node:assert/strict';
import fs from 'node:fs';

const schools = fs.readFileSync('src/components/SchoolsManagement.tsx', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');

assert.match(schools, /Instituições vinculadas/);
assert.match(schools, /Nova instituição/);
assert.match(schools, /Revisar cadastros/);
assert.match(schools, /Limpar filtros/);
assert.match(schools, /totalInstitutionsLabel/);
assert.doesNotMatch(schools, /Relacionamento escolar estruturado/);
assert.doesNotMatch(schools, />Escolas<\/h2>/);
assert.doesNotMatch(schools, /> Nova escola<\/button>/);
assert.doesNotMatch(schools, /escola\(s\)/);
assert.match(coordinator, /activeTab === "schools"[\s\S]{0,80}"Relacionamentos"/);
assert.match(coordinator, /activeTab === "schools"[\s\S]{0,80}"Rede escolar"/);

for (const persistedCall of [
  'dataService.getSchools',
  'dataService.createSchool',
  'dataService.updateSchool',
  'dataService.getSchoolDetail'
]) {
  assert.match(schools, new RegExp(persistedCall.replace('.', '\\.')));
}

console.log('schoolsManagementUi.test.ts: OK');
