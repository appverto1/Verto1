import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const expectedBranch = 'refactor/backend-patient-time-report-route-20261011';
const expectedBase = '5fc564ba5b11bef1f21b56e4f81fd6c43e587f60';
const expectedBlob = 'aa914fac455bbd82fab898843cdee795acccf33a';
assert.equal(process.env.GITHUB_REF, 'refs/heads/' + expectedBranch, 'must run only on feature branch');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'origin/staging'), expectedBase, 'staging changed: abort to prevent stale write');
assert.equal(git('rev-parse', 'HEAD:server.ts'), expectedBlob, 'server baseline changed: abort to prevent duplicate extraction');

const file = 'server.ts';
const original = readFileSync(file, 'utf8');
const anchor = "  app.get('/api/reports/time/patient', checkAuth, requireClinicCapability('reports.view'), async (req: any, res) => {";
const next = "  app.get('/api/reports/time/professional', checkAuth, requireClinicCapability('reports.view'), async (req: any, res) => {";
const start = original.indexOf(anchor);
const end = original.indexOf(next, start);
assert.ok(start > 0 && end > start, 'route boundaries');
assert.equal(original.indexOf(anchor, start + 1), -1, 'unique original route');
assert.ok(!original.includes('registerPatientTimeReportRoute(app'), 'do not repeat extraction');
const oldRegion = original.slice(start, end);
assert.ok(oldRegion.endsWith('  });\n\n'), 'original route self-contained');
const movedBlock = oldRegion.slice(0, -2);
const service = readFileSync('services/patientTimeReportRoute.ts', 'utf8');
assert.ok(service.includes(movedBlock), 'copied original handler verbatim, including auth/middleware');

const deps = [
  'checkAuth', 'requireClinicCapability', 'sanitizeString', 'currentClinicId',
  'sanitizeIsoDateTime', 'fetchTimeReportAppointments', 'buildPatientTimeReport'
];
const replacement = '  registerPatientTimeReportRoute(app, {\n' +
  deps.map((name) => '    ' + name + ',').join('\n') + '\n  });\n\n';
const originalImport = "import express from 'express';\n";
const newImport = originalImport + "import { registerPatientTimeReportRoute } from './services/patientTimeReportRoute';\n";
assert.ok(original.startsWith(originalImport), 'known import anchor');
assert.equal(original.split(originalImport).length, 2, 'unique import anchor');
const changed = original.slice(0, start) + replacement + original.slice(end);
const result = changed.replace(originalImport, newImport);
assert.equal(result.replace(newImport, originalImport).replace(replacement, oldRegion), original, 'byte-exact source reverse reconstruction');
assert.equal(original.split('\n').length - result.split('\n').length, 23, 'expected 23-line entrypoint reduction');
writeFileSync(file, result);
console.log('Source guard and byte-exact reversibility passed, server.ts reduced by 23 lines.');
