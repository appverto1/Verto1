import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const admin=readFileSync('src/components/SuperAdminDashboard.tsx','utf8');
const kanban=readFileSync('src/components/CommercialKanban.tsx','utf8');
const routes=readFileSync('services/salesProspectingRoutes.ts','utf8');

test('desktop sidebar is fixed, compact only for Kanban, and keeps mobile hamburger',()=>{
  const shell=admin.split('<aside id="super-admin-navigation"')[1]?.split('</aside>')[0];
  assert.ok(shell,'existing Super Admin navigation remains');
  assert.match(admin,/compactDesktopMenu = activeTab === 'leads' && commercialView === 'kanban'/);
  assert.match(shell,/fixed inset-y-0 left-0/);
  assert.doesNotMatch(shell,/md:sticky/);
  assert.match(shell,/md:w-\[66px\]/);
  assert.match(shell,/md:w-72/);
  assert.match(shell,/Navegação compacta Super Admin/);
  assert.match(shell,/aria-label=\{nav.label\}/);
  assert.match(admin,/md:ml-\[66px\]/);
  assert.match(admin,/md:ml-72/);
  assert.match(admin,/aria-label="Abrir menu de navegação"/);
  assert.match(admin,/\bMenu,/);
  assert.match(admin,/<Menu size=\{24\}/);
  assert.match(admin,/setMobileMenuOpen\(true\)/);
});

test('production keeps the existing unrestricted-by-feature-flag commercial view',()=>{
  assert.match(admin,/activeTab === 'leads' && commercialView === 'kanban' && \(/);
  assert.match(admin,/<CommercialKanban/);
  assert.doesNotMatch(admin,/VITE_FEATURE_COMMERCIAL_PROSPECTING/);
});

test('Kanban keeps live notes, immediate fields, inline channels and column drag',()=>{
  assert.match(kanban,/notesPreviewId/);
  assert.match(kanban,/request\('\/api\/owner\/sales\/kanban\/opportunities\/'\+notesPreviewId\)/);
  assert.match(kanban,/value=\{leadDraft\.notes\}/);
  assert.match(kanban,/checked=\{inlineChannelIds\.includes\(channel\.id\)\}/);
  assert.match(kanban,/application\/x-verto-kanban-column/);
  assert.match(kanban,/aria-label="Adicionar coluna"/);
  assert.match(kanban,/<details className="group rounded-xl border border-violet-200/);
  assert.doesNotMatch(kanban,/Editar oportunidade|Editar colunas/);
});

test('Kanban mutations remain server-authorized without direct browser database writes',()=>{
  assert.match(routes,/checkAuth, checkPlatformAdmin/);
  assert.match(routes,/user\?\.mfaVerified !== true/);
  assert.match(kanban,/method:'PATCH',headers:\{'X-Idempotency-Key':key\}/);
  assert.match(kanban,/method:'PUT',headers:\{'X-Idempotency-Key':key\}/);
  assert.doesNotMatch(kanban,/\.from\('patients'\)|\.from\('clinics'\)|\.from\('auth\.users'\)/);
});

test('release scope guard rejects database, clinical, auth and infrastructure files',()=>{
  const source=readFileSync('scripts/check-kanban-release-scope.mjs','utf8');
  assert.match(source,/const ALLOWED = new Set/);
  assert.match(source,/src\/components\/CommercialKanban\.tsx/);
  assert.match(source,/src\/components\/SuperAdminDashboard\.tsx/);
  assert.match(source,/const disallowed = changed\.filter\(path=>!ALLOWED\.has\(path\)\)/);
  assert.match(source,/const missing = REQUIRED\.filter/);
  assert.match(source,/\['diff','--no-ext-diff','--no-renames','--name-only'/);
  assert.match(source,/SCOPE_GUARD_FAIL/);
  assert.doesNotMatch(source,/execFileSync\('npm'|execFileSync\('railway'/);
});
