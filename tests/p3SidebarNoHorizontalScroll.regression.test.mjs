import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const navs = [
  ['src/components/TherapistDashboard.tsx', 1],
  ['src/components/ReceptionistDashboard.tsx', 1],
  ['src/components/CoordinatorDashboard.tsx', 4],
  ['src/components/AdminDashboard.tsx', 1],
  ['src/components/SuperAdminDashboard.tsx', 1],
];

for (const [path, expected] of navs) {
  const source = read(path);
  const matches = [...source.matchAll(/<nav className="([^"]+)"/g)]
    .filter(([, classes]) => classes.includes('overflow-y-auto'));
  assert.equal(matches.length, expected, `${path}: todos os menus roláveis devem estar cobertos`);
  for (const [, classes] of matches) {
    assert.match(classes, /\boverflow-x-hidden\b/, `${path}: rolagem horizontal proibida`);
    assert.match(classes, /\boverflow-y-auto\b/, `${path}: preservar rolagem vertical`);
  }
}

for (const path of [
  'src/components/TherapistDashboard.tsx',
  'src/components/ReceptionistDashboard.tsx',
  'src/components/AdminDashboard.tsx',
  'src/components/SuperAdminDashboard.tsx',
]) {
  const source = read(path);
  const sidebar = source.match(/<aside\s+className=\{?[`"'][^\n]+/);
  assert.ok(sidebar, `${path}: sidebar principal deve existir`);
  assert.match(sidebar[0], /overflow-x-hidden/, `${path}: sidebar não pode rolar horizontalmente`);
}

const coordinator = read('src/components/CoordinatorDashboard.tsx');
assert.match(coordinator, /h-screen shrink-0 overflow-hidden bg-white hidden lg:flex/, 'menu desktop do coordenador preservado');
assert.match(coordinator, /onFocusCapture=\{\(\) => setIsSidebarExpanded\(true\)\}/, 'acessibilidade por teclado preservada');
console.log('p3SidebarNoHorizontalScroll.regression.test.mjs: ok');
