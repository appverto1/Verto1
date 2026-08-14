import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const settings = fs.readFileSync(path.join(root, 'src/components/ClinicGlobalSettingsPanel.tsx'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');

assert.match(
  settings,
  /<div className="lg:col-span-2">\s*<RoleCapabilityMatrix[\s\S]*?moduleAccessMode=\{moduleAccessMode\}[\s\S]*?organizationModules=\{organizationModules\}/,
  'clinic settings permission matrix must span the full two-column settings grid and receive module context',
);
assert.match(
  dashboard,
  /<div className="space-y-4 md:col-span-2">[\s\S]*?<RoleCapabilityMatrix[\s\S]*?moduleAccessMode=\{moduleAccessMode\}[\s\S]*?organizationModules=\{organizationModules\}/,
  'coordinator settings permission matrix must also span the full grid and respect contracted modules',
);

console.log('roleCapabilityMatrixFullWidth.test.mjs: ok');
