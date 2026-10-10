import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

const dashboards = [
  'src/components/CoordinatorDashboard.tsx',
  'src/components/TherapistDashboard.tsx',
  'src/components/ReceptionistDashboard.tsx',
  'src/components/AdminDashboard.tsx',
];

for (const path of dashboards) {
  const source = read(path);
  assert.match(source, /onMouseEnter=\{\(\) => setIsSidebarExpanded\(true\)\}/, `${path} must expand on pointer hover`);
  assert.match(source, /onMouseLeave=\{\(\) => setIsSidebarExpanded\(false\)\}/, `${path} must collapse when pointer leaves`);
  assert.match(source, /onFocusCapture=\{\(\) => setIsSidebarExpanded\(true\)\}/, `${path} must remain keyboard accessible`);
  assert.doesNotMatch(source, /Expandir menu lateral|Recolher menu lateral|toggleSidebarExpanded/, `${path} must not require an expand/collapse button`);
  assert.doesNotMatch(source, /verto:[a-z-]+-sidebar-expanded/, `${path} must not persist an obsolete click-toggle preference`);
}

const coordinator = read('src/components/CoordinatorDashboard.tsx');
assert.ok(
  (coordinator.match(/onMouseEnter=\{\(\) => setIsSidebarExpanded\(true\)\}/g) || []).length >= 2,
  'Coordinator main and patient-record sidebars must both expand on hover',
);

// Only the professional's left sidebar deliberately keeps its original wordmark.
assert.match(
  read('src/components/TherapistDashboard.tsx'),
  /<LogoVerto size=\{40\} showText=\{isSidebarExpanded\} preserveProfessionalSidebarBrand \/>/,
  'Professional sidebar must keep its previous brand asset without changing hover behavior',
);
for (const path of [
  'src/components/ReceptionistDashboard.tsx',
  'src/components/AdminDashboard.tsx',
]) {
  assert.match(read(path), /<LogoVerto size=\{40\} showText=\{isSidebarExpanded\} \/>/, `${path} must use the canonical full Verto logo when expanded`);
}

console.log('sidebarHoverExpansion.regression.test.mjs: ok');
