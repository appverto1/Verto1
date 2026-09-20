import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/InvitationModal.tsx', 'utf8');

for (const expected of [
  'Convide sua equipe',
  'Envie convites para as pessoas que vão trabalhar na clínica.',
  'Você pode convidar até ${maxMembers - 1} outros profissionais.',
  'Defina o papel de cada pessoa para organizar os acessos da equipe.',
  'Informe o e-mail e o papel',
  'A pessoa confirma o convite',
  'O acesso aparece na equipe',
  'Convidar profissional',
  'Defina o papel na clínica e, para atendimento, a especialidade clínica.',
  'max-h-[calc(100dvh-2rem)]',
  'overflow-y-auto',
  'overflow-x-hidden',
]) {
  assert.ok(source.includes(expected), `InvitationModal must preserve UX contract: ${expected}`);
}

for (const forbidden of [
  'Bem-vindo à Verto!',
  'Configurar Papéis e Convites',
  'Voce pode convidar ate',
  'profissionais que vao colaborar na clinica',
  'Sua configuracao permite no maximo',
]) {
  assert.ok(!source.includes(forbidden), `InvitationModal must not regress to old copy: ${forbidden}`);
}

for (const invariant of [
  "const canGrantDirector = actorRole === 'director';",
  "const canGrantAdministrativeRoles = actorRole === 'director' || actorRole === 'coordinator';",
  "const canCreateAccounts = actorRole === 'director' || actorRole === 'coordinator';",
  "role === 'therapist' && !specialty",
  'dataService.inviteToClinic(',
  "{canGrantDirector && <option value=\"director\">Diretor</option>}",
  "{canGrantAdministrativeRoles && <option value=\"coordinator\">Coordenador</option>}",
]) {
  assert.ok(source.includes(invariant), `InvitationModal must preserve behavior invariant: ${invariant}`);
}

console.log('[ok] InvitationModal UX contract preserved');
