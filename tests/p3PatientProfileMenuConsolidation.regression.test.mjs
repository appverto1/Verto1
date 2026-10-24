import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/PatientDashboard.tsx', 'utf8');
const menuDefinition = source.match(/const portalMenuItems = \[([\s\S]*?)\] as Array<\{ id: PortalSection;/);
assert.ok(menuDefinition, 'menu do portal precisa existir');
assert.match(menuDefinition[1], /\{ id: 'profile', label: 'Perfil'/, 'Perfil deve continuar acessível pelo hambúrguer');

const menus = [...source.matchAll(/portalMenuItems\.map\(\(item\) => \{([\s\S]*?)<LogOut size=\{18\} \/> Sair da Conta/g)];
assert.equal(menus.length, 2, 'menus infantil e adulto devem compartilhar o mesmo contrato');
for (const [, menu] of menus) {
  assert.doesNotMatch(menu, /<Settings size=\{18\} \/> Configurações/, 'não duplicar Configurações no hambúrguer');
  assert.match(menu, /setPortalSection\(item\.id\)/, 'navegação Perfil deve continuar funcionando');
}
assert.match(source, /const portalProfilePanel = \(/, 'painel de perfil preservado');
assert.equal((source.match(/portalSection === 'profile' && portalProfilePanel/g) || []).length, 2, 'perfil visível nos dois layouts');
assert.match(source, /Editar perfil e notificações/, 'edição acessível pelo Perfil');
assert.match(source, /onClick=\{\(\) => setIsSettingsOpen\(true\)\}/, 'ação abre editor existente');
assert.match(source, /Permitir notificações neste dispositivo/, 'preferência de notificações preservada');
assert.match(source, /onClick=\{handleSavePatientSettings\}/, 'Salvar continua autoridade de persistência');
console.log('p3PatientProfileMenuConsolidation.regression.test.mjs: ok');
