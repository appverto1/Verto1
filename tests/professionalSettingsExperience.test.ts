import assert from 'node:assert/strict';
import fs from 'node:fs';

const settings = fs.readFileSync('src/components/ClinicGlobalSettingsPanel.tsx', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const anamnesis = fs.readFileSync('src/components/Anamnesis.tsx', 'utf8');
const therapeuticLibrary = fs.readFileSync('src/components/TherapeuticProgramLibrary.tsx', 'utf8');
const protocols = fs.readFileSync('src/components/Protocols.tsx', 'utf8');

assert.match(settings, /Perfil profissional/);
assert.match(settings, /Meu perfil profissional/);
assert.match(settings, /Cadastro e credenciais profissionais/);
assert.match(settings, /Disponibilidade nesta clínica/);
assert.match(settings, /getMemberWorkSchedule\(memberId\)/);
assert.match(settings, /updateMemberWorkSchedule\(memberId, schedule\)/);
assert.match(settings, /Minhas fichas de anamnese/);
assert.match(settings, /Minha biblioteca terapêutica/);
assert.match(settings, /font-normal text-slate-800/);
assert.doesNotMatch(settings, /Meu Perfil Profissional/);

assert.match(coordinator, /professionalProfile: "Meu perfil profissional"/);
assert.match(coordinator, /activeTab === "professionalProfile"[\s\S]*?mode="professional"/);
assert.match(coordinator, /activeTab === "settings"[\s\S]*?mode="clinic"/);
assert.match(coordinator, /maxSavedTemplates=\{isTherapist \? 15 : 10\}/);
assert.match(coordinator, /templateScope: isTherapist \? 'personal' : 'clinic'/);
assert.match(coordinator, /dataService\.getUserProfile\(professionalId\)/);
assert.match(coordinator, /globalProfile\?\.full_name[\s\S]*billingProfile\?\.display_name/);
assert.match(coordinator, /globalProfile\?\.council_number[\s\S]*billingProfile\?\.council_number/);
assert.match(coordinator, /globalProfile\?\.mini_curriculum[\s\S]*globalMetadata\?\.miniCurriculum/);

assert.match(anamnesis, /maxSavedTemplates\?: number/);
assert.match(anamnesis, /savedTemplates\.length >= maxSavedTemplates/);
assert.match(anamnesis, /Até \{maxSavedTemplates\} fichas ativas/);

assert.match(therapeuticLibrary, /Criar modelo pessoal/);
assert.match(therapeuticLibrary, /templateScope === 'PERSONAL'/);
assert.match(therapeuticLibrary, /Meu modelo pessoal/);
assert.match(protocols, /verto:protocols:library-section/);

console.log('professionalSettingsExperience.test.ts: ok');
